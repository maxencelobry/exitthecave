import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonObject = Record<string, unknown>;
type FranceTravailRadiusKm = 5 | 10 | 20 | 30 | 40 | 50 | 100;

const configPath = join(process.cwd(), "data", "config.json");
const allowedFranceTravailRadii = [5, 10, 20, 30, 40, 50, 100] as const;

function object(value: unknown): JsonObject {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function string(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value.trim() : fallback;
}

function optionalString(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null;
    return typeof value === "string" ? value.trim() || null : null;
}

function strings(value: unknown): string[] {
    return Array.isArray(value)
        ? value
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean)
        : [];
}

function targetRoles(value: unknown): Array<{ name: string; synonyms: string[]; priority: "must_have" | "nice_to_have" }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        const role = object(item);
        const name = string(role.name);
        if (!name) return [];
        return [{
            name,
            synonyms: strings(role.synonyms),
            priority: role.priority === "nice_to_have" ? "nice_to_have" as const : "must_have" as const,
        }];
    });
}

function weightedKeywords(value: unknown): Array<{ term: string; weight: number }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        const keyword = object(item);
        const term = string(keyword.term);
        const weight = typeof keyword.weight === "number" && Number.isFinite(keyword.weight) && keyword.weight > 0
            ? keyword.weight
            : 0;
        return term && weight ? [{ term, weight }] : [];
    });
}

function positiveNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function enabledSites(value: unknown): Record<string, boolean> {
    const source = object(value);
    const names = ["franceTravail", "meteojob", "hellowork", "glassdoor", "cadremploi", "apec", "jobijoba", "linkedin"];
    return Object.fromEntries(names.map((name) => [name, boolean(source[name], false)]));
}

function citySlug(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("fr")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

function loadConfig(): JsonObject {
    try {
        const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
        const config = object(parsed);
        if (!config.location || !config.scrapers) throw new Error("location ou scrapers manquant");
        return config;
    } catch (error) {
        throw new Error(`Configuration invalide dans ${configPath} : ${String(error)}`);
    }
}

const rawConfig = loadConfig();
const rawHistory = object(rawConfig.history);
const rawScrapers = object(rawConfig.scrapers);
const rawLocation = object(rawConfig.location);
const rawFilters = object(rawConfig.filters);
const rawFranceTravail = object(rawConfig.franceTravail);
const rawApec = object(rawConfig.apec);
const rawGlassdoor = object(rawConfig.glassdoor);
const rawCadremploi = object(rawConfig.cadremploi);
const rawJobijoba = object(rawConfig.jobijoba);
const rawLinkedin = object(rawConfig.linkedin);
const rawProfile = object(rawConfig.profile);
const rawMustHave = object(rawProfile.mustHave);
const rawNiceToHave = object(rawProfile.niceToHave);
const rawExclusions = object(rawProfile.exclusions);
const rawPreferences = object(rawProfile.preferences);
const rawInterface = object(rawConfig.interface);

const radiusKm = positiveNumber(rawLocation.radiusKm, 10);
const city = string(rawLocation.city);
const citySlugValue = citySlug(city) || "ville";
const departmentCode = string(rawLocation.departmentCode);
const rawFranceTravailRadius = positiveNumber(rawFranceTravail.radiusKm, 20);
const franceTravailRadius = allowedFranceTravailRadii.includes(
    rawFranceTravailRadius as (typeof allowedFranceTravailRadii)[number],
)
    ? rawFranceTravailRadius
    : 20;

export const searchConfig = {
    history: {
        enabled: boolean(rawHistory.enabled, true),
        directoryName: string(rawHistory.directoryName, "history"),
    },
    scrapers: {
        enabled: enabledSites(rawScrapers.enabled),
    },
    location: {
        city,
        postalCode: string(rawLocation.postalCode),
        departmentCode,
        inseeCode: string(rawLocation.inseeCode),
        radiusKm,
    },
    filters: {
        excludedBroadLocations: strings(rawFilters.excludedBroadLocations),
        excludedContracts: strings(rawFilters.excludedContracts),
        ignoredCompanies: strings(rawFilters.ignoredCompanies),
    },
    franceTravail: {
        locationCode: string(rawFranceTravail.locationCode, string(rawLocation.inseeCode, string(rawLocation.postalCode))),
        radiusKm: franceTravailRadius as FranceTravailRadiusKm,
        credentialsFile: optionalString(rawFranceTravail.credentialsFile),
        api: {
            enabled: boolean(object(rawFranceTravail.api).enabled, false),
        },
    },
    apec: {
        locationId: string(rawApec.locationId, string(rawLocation.inseeCode)),
    },
    glassdoor: {
        locationPath: string(rawGlassdoor.locationPath, `${citySlugValue}-emplois-SRCH_IL.0,10.htm`),
        radiusMiles: positiveNumber(rawGlassdoor.radiusMiles, Math.max(1, Math.round(radiusKm * 0.621371))),
    },
    cadremploi: {
        locationSlug: string(rawCadremploi.locationSlug, `${citySlugValue}-${departmentCode}`.replace(/-$/, "")),
    },
    jobijoba: {
        radiusKm: positiveNumber(rawJobijoba.radiusKm, radiusKm),
    },
    linkedin: {
        searchUrl: string(
            rawLinkedin.searchUrl,
            "https://www.linkedin.com/jobs/search-results/?keywords=publi%C3%A9%20au%20cours%20des%20derni%C3%A8res%2024%20heures&origin=SEMANTIC_SEARCH_LANDING_PAGE",
        ),
        maxPages: Math.round(positiveNumber(rawLinkedin.maxPages, 50)),
        loadDescriptions: boolean(rawLinkedin.loadDescriptions, false),
    },
    profile: {
        contractScoring: {
            preferred: rawProfile.contractScoring ? strings(object(rawProfile.contractScoring).preferred) : ["CDI", "CDD"],
            avoided: rawProfile.contractScoring ? strings(object(rawProfile.contractScoring).avoided) : ["Alternance", "Apprentissage", "Stage"],
        },
        weightedKeywords: weightedKeywords(rawProfile.weightedKeywords),
        targetTitles: strings(rawProfile.targetTitles),
        targetRoles: targetRoles(rawProfile.targetRoles),
        keywords: strings(rawProfile.keywords),
        skills: strings(rawProfile.skills),
        languages: strings(rawProfile.languages),
        experience: strings(rawProfile.experience),
        education: strings(rawProfile.education),
        contracts: strings(rawProfile.contracts),
        workPreferences: strings(rawProfile.workPreferences),
        mustHave: {
            skills: strings(rawMustHave.skills),
            contracts: strings(rawMustHave.contracts),
            languages: strings(rawMustHave.languages),
            education: strings(rawMustHave.education),
            experience: strings(rawMustHave.experience),
        },
        niceToHave: {
            skills: strings(rawNiceToHave.skills),
            software: strings(rawNiceToHave.software),
            sectors: strings(rawNiceToHave.sectors),
        },
        exclusions: {
            roles: strings(rawExclusions.roles),
            contracts: strings(rawExclusions.contracts),
            locations: strings(rawExclusions.locations),
            companies: strings(rawExclusions.companies),
        },
        preferences: {
            remote: strings(rawPreferences.remote),
            salaryMinimum: typeof rawPreferences.salaryMinimum === "number" && rawPreferences.salaryMinimum > 0
                ? rawPreferences.salaryMinimum
                : null,
            workTime: strings(rawPreferences.workTime),
            maximumDistanceKm: positiveNumber(rawPreferences.maximumDistanceKm, radiusKm),
        },
    },
    interface: {
        language: string(rawInterface.language, "fr"),
        defaultSort: string(rawInterface.defaultSort, "newest"),
        showDescriptionByDefault: boolean(rawInterface.showDescriptionByDefault, true),
        showExtraFieldsByDefault: boolean(rawInterface.showExtraFieldsByDefault, true),
    },
} as const;
