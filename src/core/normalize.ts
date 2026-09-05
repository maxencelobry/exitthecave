import type { NormalizedJob, RawOffer } from "./job.js";

function text(value: unknown): string | null {
    if (typeof value !== "string") return value == null ? null : String(value);
    const result = value.replace(/\s+/g, " ").trim();
    return result || null;
}

function fieldsOf(extra: unknown): Record<string, unknown> {
    return extra && typeof extra === "object" && !Array.isArray(extra) ? (extra as Record<string, unknown>) : {};
}

function list(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map(text).filter((value): value is string => Boolean(value));
}

function normalizeKey(value: string | null): string {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function canonicalContract(value: string | null): string | null {
    if (!value) return null;
    const normalized = normalizeKey(value);
    const contracts: Array<[string, string]> = [
        ["cdi", "CDI"],
        ["cdd", "CDD"],
        ["interim", "Intérim"],
        ["alternance", "Alternance"],
        ["apprentissage", "Apprentissage"],
        ["stage", "Stage"],
        ["freelance", "Freelance"],
        ["independant", "Indépendant"],
        ["saisonnier", "Saisonnier"],
        ["fonction publique", "Fonction publique"],
    ];
    return contracts.find(([key]) => normalized.includes(key))?.[1] ?? value;
}

function parsedDate(value: string | null): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    const relative = value.toLocaleLowerCase("fr").match(/(?:il y a|moins de)\s*(\d+)?\s*(minute|heure|jour)/);
    if (!relative) return null;
    const amount = Number(relative[1] ?? 0);
    const units = { minute: 60_000, heure: 3_600_000, jour: 86_400_000 };
    return Date.now() - amount * units[relative[2] as keyof typeof units];
}

function freshness(publishedAt: string | null): Pick<NormalizedJob, "freshnessLabel" | "freshnessScore"> {
    const timestamp = parsedDate(publishedAt);
    if (timestamp === null) return { freshnessLabel: "unknown", freshnessScore: 0 };
    const age = Date.now() - timestamp;
    if (age < 24 * 60 * 60 * 1000) return { freshnessLabel: "today", freshnessScore: 100 };
    if (age < 3 * 24 * 60 * 60 * 1000) return { freshnessLabel: "recent", freshnessScore: 75 };
    if (age < 30 * 24 * 60 * 60 * 1000) return { freshnessLabel: "old", freshnessScore: 35 };
    return { freshnessLabel: "old", freshnessScore: 10 };
}

function reliability(
    site: string,
    company: string | null,
    salary: string | null,
    description: string | null,
    url: string,
): Pick<NormalizedJob, "reliabilityScore" | "reliabilityReasons"> {
    let score = 0;
    const reasons: string[] = [];
    if (site === "franceTravail") {
        score += 30;
        reasons.push("source officielle ou partenaire référencé");
    } else {
        score += 15;
        reasons.push("source emploi identifiée");
    }
    if (company) {
        score += 25;
        reasons.push("entreprise identifiée");
    }
    if (salary) {
        score += 15;
        reasons.push("salaire renseigné");
    }
    if (description && description.length >= 120) {
        score += 20;
        reasons.push("description suffisamment détaillée");
    } else if (description) {
        score += 8;
        reasons.push("description présente");
    }
    if (/^https?:\/\//i.test(url)) {
        score += 10;
        reasons.push("lien valide");
    }
    return { reliabilityScore: Math.min(100, score), reliabilityReasons: reasons };
}

export function normalizeOffer(site: string, offer: RawOffer): NormalizedJob {
    const fields = fieldsOf(offer.extra);
    const company = text(fields.company);
    const location = text(fields.location);
    const contract = canonicalContract(text(fields.contract));
    const salary = text(fields.salary);
    const workTime = text(fields.workTime);
    const remote = text(fields.remote ?? fields.telework ?? fields.teletravail);
    const experience = text(fields.experience ?? fields.experienceLevel);
    const description = text(fields.description);
    const publishedAt = text(fields.publishedAt);
    const skills = [...new Set([...list(fields.skills), ...list(fields.competences)])];
    const fingerprint = [offer.title, company, location]
        .map((value) => normalizeKey(text(value)))
        .join("|");
    const freshnessInfo = freshness(publishedAt);
    const reliabilityInfo = reliability(site, company, salary, description, offer.url);

    return {
        fingerprint,
        site,
        title: text(offer.title) ?? "Sans intitulé",
        url: offer.url,
        company,
        location,
        contract,
        salary,
        workTime,
        remote,
        experience,
        skills,
        publishedAt,
        ...freshnessInfo,
        ...reliabilityInfo,
        description,
        extra: fields,
    };
}

export function deduplicateJobs(jobs: NormalizedJob[]): NormalizedJob[] {
    const byKey = new Map<string, NormalizedJob>();
    const aliases = new Map<string, string>();
    for (const job of jobs) {
        const key = aliases.get(`url:${job.url}`) ?? aliases.get(`fingerprint:${job.fingerprint}`) ?? job.url;
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, job);
            aliases.set(`url:${job.url}`, key);
            aliases.set(`fingerprint:${job.fingerprint}`, key);
            continue;
        }
        const merged = {
            ...existing,
            ...job,
            company: job.company ?? existing.company,
            location: job.location ?? existing.location,
            contract: job.contract ?? existing.contract,
            salary: job.salary ?? existing.salary,
            description: job.description ?? existing.description,
            extra: {
                ...existing.extra,
                ...job.extra,
                sourceUrls: [
                    ...new Set([
                        existing.url,
                        job.url,
                        ...list(existing.extra.sourceUrls),
                        ...list(job.extra.sourceUrls),
                    ]),
                ],
                sources: [
                    ...new Set([
                        existing.site,
                        job.site,
                        ...list(existing.extra.sources),
                        ...list(job.extra.sources),
                    ]),
                ],
            },
        };
        byKey.set(key, merged);
        aliases.set(`url:${job.url}`, key);
        aliases.set(`fingerprint:${job.fingerprint}`, key);
    }
    return [...byKey.values()];
}
