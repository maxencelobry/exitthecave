import { searchConfig } from "./config.js";

type Offer = {
    title: string;
    url: string;
    extra: unknown;
};

function asArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalize(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function asFields(extra: unknown): Record<string, unknown> {
    return extra && typeof extra === "object" ? (extra as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

const CONTRACTS = [
    "CDI",
    "CDD",
    "Intérim",
    "Alternance",
    "Stage",
    "Freelance",
    "Indépendant",
    "Saisonnier",
    "Fonction publique",
    "Fonctionnaire",
] as const;

function firstMatch(values: string[], pattern: RegExp): string | null {
    for (const value of values) {
        const match = value.match(pattern);
        if (match?.[0]) return match[0].trim();
    }
    return null;
}

function lastMatch(values: string[], pattern: RegExp): string | null {
    let result: string | null = null;
    for (const value of values) {
        const matches = [...value.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))];
        if (matches.length > 0) result = matches.at(-1)?.[0]?.trim() ?? result;
    }
    return result;
}

function cleanContract(values: string[]): string | null {
    for (const contract of CONTRACTS) {
        if (values.some((value) => new RegExp(`\\b${contract.replace("é", "[eé]")}\\b`, "i").test(value))) {
            return contract;
        }
    }
    return null;
}

function cleanDate(values: string[]): string | null {
    for (const value of values) {
        const candidate = value.replace(/\s+/g, " ").trim().replace(/^publi(?:é|ée|e)\s+/i, "");
        if (
            /^(?:\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/i.test(
                candidate,
            )
        )
            return candidate;
        if (/^(?:moins d'une heure|il y a \d+\s*(?:minute|heure|jour)s?|hier|aujourd'hui|aujourd’hui)$/i.test(candidate))
            return candidate;
    }
    return null;
}

function cleanSalary(values: string[]): string | null {
    return firstMatch(
        values,
        /\d[\d\s.,]*\s*(?:k\s*)?(?:€|k€)?\s*(?:-|à)\s*\d[\d\s.,]*\s*(?:k\s*)?€(?:\s*(?:par|\/)\s*(?:an|mois|heure))?|\d[\d\s.,]*\s*(?:k\s*)?€(?:\s*(?:par|\/)\s*(?:an|mois|heure))?/i,
    );
}

function cleanDescription(value: string, excludedValues: string[]): string | null {
    const description = value.replace(/\s+/g, " ").trim();
    if (!description) return null;
    if (/^(?:compétences\s*:|sponsorisé|candidature facile|voir l'offre|voir l’offre)/i.test(description)) return null;
    const normalizedDescription = normalize(description);
    if (excludedValues.some((excluded) => excluded && normalize(excluded) === normalizedDescription)) return null;
    return description;
}

function isMetadata(value: string, metadata: string[]): boolean {
    const normalizedValue = normalize(value);
    return (
        metadata.some((item) => item && normalize(item) === normalizedValue) ||
        cleanContract([value]) !== null ||
        cleanDate([value]) !== null ||
        cleanSalary([value]) !== null
    );
}

function cleanLocation(value: string): string {
    return value.replace(/^(?:CDI|CDD|Intérim|Alternance|Stage|Freelance|Indépendant)\b[\s-]*/i, "").trim();
}

function extractCardDescription(sourceInfo: string[], title: string, metadata: string[]): string | null {
    const card = sourceInfo.find((value) => value.includes(title));
    if (!card) return null;

    const tail = card.slice(card.indexOf(title) + title.length).trim();
    const markers = [cleanSalary([tail]), cleanContract([tail]), cleanDate([tail])]
        .filter((value): value is string => Boolean(value))
        .map((value) => tail.indexOf(value))
        .filter((index) => index > 0);
    const beforeFirstMarker = tail.slice(0, Math.min(...markers, tail.length)).trim();
    const beforeDescription = beforeFirstMarker.length >= 30 ? cleanDescription(beforeFirstMarker, metadata) : null;
    if (beforeDescription) return beforeDescription;

    const salary = cleanSalary([tail]);
    if (!salary) return null;
    const afterSalary = tail
        .slice(tail.indexOf(salary) + salary.length)
        .replace(/^\s*(?:\(fourni par l['’]employeur\)|candidature facile|brut annuel|par heure)+/gi, "")
        .replace(/\s*(?:sponsorisé|voir l'offre|voir l’offre)\s*$/i, "")
        .trim();
    return afterSalary.length >= 30 ? cleanDescription(afterSalary, metadata) : null;
}

function extractCardLocation(sourceInfo: string[], title: string, salary: string | null): string | null {
    if (!salary) return null;
    const card = sourceInfo.find((value) => value.includes(title));
    if (!card) return null;
    const tail = card.slice(card.indexOf(title) + title.length);
    const beforeSalary = tail
        .slice(0, tail.indexOf(salary))
        .replace(/(?:CDI|CDD|Intérim|Alternance|Stage)\s*$/i, "")
        .trim();
    return beforeSalary && beforeSalary.length <= 60 && !/[.!?]/.test(beforeSalary)
        ? cleanLocation(beforeSalary)
        : null;
}

export function shouldSkipOffer(offer: Offer): boolean {
    const fields = asFields(offer.extra);
    const location = normalize(asString(fields.location));
    const contract = normalize(asString(fields.contract));
    const visibleInfo = Array.isArray(fields.visibleInfo)
        ? fields.visibleInfo.filter((value): value is string => typeof value === "string").map(normalize)
        : [];
    const title = normalize(offer.title);

    const excludedBroadLocation = searchConfig.filters.excludedBroadLocations.some(
        (value) => location === normalize(value),
    );
    const excludedContract = searchConfig.filters.excludedContracts.some((value) => {
        const normalizedValue = normalize(value);
        return (
            contract.includes(normalizedValue) ||
            visibleInfo.some((info) => info === normalizedValue) ||
            title.startsWith(`${normalizedValue} `)
        );
    });

    return excludedBroadLocation || excludedContract;
}

export function filterOffers<T extends Offer>(offers: T[]): T[] {
    return offers.filter((offer) => !shouldSkipOffer(offer));
}

export function enrichOffers<T extends Offer>(offers: T[]): T[] {
    return offers.map((offer) => {
        const fields = asFields(offer.extra);
        const sourceInfo = asArray(fields.visibleInfo)
            .map((value) => value.replace(/\s+/g, " ").trim())
            .filter(Boolean);
        const text = sourceInfo.join(" | ");
        const contract = cleanContract([asString(fields.contract), ...sourceInfo]);
        const salary = cleanSalary([asString(fields.salary), ...sourceInfo]);
        const publishedAt = cleanDate([asString(fields.publishedAt), ...sourceInfo]);
        const rawLocation =
            asString(fields.location) ||
            lastMatch(sourceInfo, /[A-ZÀ-ÖØ-Ý][\p{L}'-]+(?:[ -][\p{L}'-]+)*\s*(?:\(\d{2}\)|-\s*\d{2}|\(à \d+ km)/u) ||
            extractCardLocation(sourceInfo, offer.title, salary);
        const location = rawLocation ? cleanLocation(rawLocation) : null;
        const metadata = [
            offer.title,
            asString(fields.company),
            contract ?? "",
            salary ?? "",
            location ?? "",
            publishedAt ?? "",
        ];
        const description =
            cleanDescription(asString(fields.description), metadata) ||
            extractCardDescription(sourceInfo, offer.title, metadata) ||
            sourceInfo
                .filter((value) => value.length < 250)
                .filter((value) => !isMetadata(value, metadata))
                .map((value) => cleanDescription(value, metadata))
                .find(Boolean) ||
            null;
        const visibleInfo = [
            asString(fields.company),
            location,
            contract,
            salary,
            asString(fields.workTime),
            publishedAt,
            description,
        ].filter((value): value is string => Boolean(value));

        return {
            ...offer,
            extra: {
                ...fields,
                rawText: text || null,
                contract,
                salary,
                location,
                publishedAt,
                description,
                visibleInfo,
            },
        } as T;
    });
}
