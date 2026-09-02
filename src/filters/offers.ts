import { searchConfig } from "../config/search.js";

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
        const visibleInfo = asArray(fields.visibleInfo);
        const text = visibleInfo.join(" | ");
        const afterTitle = text.slice(Math.max(text.indexOf(offer.title) + offer.title.length, 0)).trim();
        const contract =
            asString(fields.contract) ||
            afterTitle.match(/\b(CDI|CDD|Intérim|Alternance|Stage|Freelance|Indépendant)\b/i)?.[1] ||
            null;
        const salary =
            asString(fields.salary) ||
            afterTitle
                .match(
                    /\d[\d\s.,]*\s*(?:k\s*)?€\s*(?:-|à)\s*\d[\d\s.,]*\s*(?:k\s*)?€(?:\s*(?:par|\/)??\s*(?:an|mois|heure))?/i,
                )?.[0]
                ?.trim() ||
            null;
        const publishedAt =
            asString(fields.publishedAt) ||
            afterTitle.match(
                /\b\d{2}\/\d{2}\/\d{4}\b|(?:moins d'une heure|il y a \d+ (?:minute|heure|jour)s?|hier|aujourd'hui)/i,
            )?.[0] ||
            null;
        const afterContract = contract
            ? afterTitle.slice(afterTitle.search(new RegExp(`\\b${contract}\\b`, "i")) + contract.length)
            : afterTitle;
        const location =
            asString(fields.location) ||
            afterContract.match(/[A-ZÀ-ÖØ-Ý][\p{L}'-]+(?:[ -][\p{L}'-]+)*\s*(?:\(\d{2}\)|-\s*\d{2})/u)?.[0] ||
            null;
        const description =
            asString(fields.description) ||
            afterTitle
                .replace(salary || "", "")
                .replace(contract || "", "")
                .replace(location || "", "")
                .replace(publishedAt || "", "")
                .trim() ||
            null;

        return {
            ...offer,
            extra: {
                ...fields,
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
