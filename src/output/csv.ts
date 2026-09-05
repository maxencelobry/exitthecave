type CsvOffer = {
    site: string;
    title: string;
    url: string;
    extra: unknown;
};

function asText(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(" | ");
    return value == null ? "" : String(value);
}

function csvCell(value: unknown): string {
    const text = asText(value).replace(/\r?\n|\r/g, " ");
    return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function cleanContract(value: string): string {
    const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const contracts: Array<[RegExp, string]> = [
        [/\bcdi\b/, "CDI"],
        [/\bcdd\b/, "CDD"],
        [/\binterim\b/, "Intérim"],
        [/\balternance\b/, "Alternance"],
        [/\bapprentissage\b/, "Apprentissage"],
        [/\bstage\b/, "Stage"],
        [/\bfreelance\b/, "Freelance"],
        [/\bindependant\b/, "Indépendant"],
    ];
    return contracts.find(([pattern]) => pattern.test(normalized))?.[1] ?? "";
}

function cleanPublishedAt(value: string): string {
    const candidate = value.replace(/\s+/g, " ").trim().replace(/^publi(?:é|ée|e)\s+/i, "");
    if (/^(?:\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/i.test(candidate))
        return candidate;
    if (/^(?:moins d'une heure|il y a \d+\s*(?:minute|heure|jour)s?|hier|aujourd'hui|aujourd’hui)$/i.test(candidate))
        return candidate;
    return "";
}

export function writeCsv(offers: CsvOffer[]): string {
    const headers = [
        "site",
        "lien",
        "intitulé",
        "entreprise",
        "localisation",
        "contrat",
        "salaire",
        "temps_de_travail",
        "date_publication",
        "description",
        "extra",
    ];
    const rows = offers.map(({ site, title, url, extra }) => {
        const fields = extra && typeof extra === "object" ? (extra as Record<string, unknown>) : {};
        const visibleInfo = Array.isArray(fields.visibleInfo) ? fields.visibleInfo : [];
        const searchableInfo = visibleInfo.map(asText).join(" | ");
        const contract = cleanContract(asText(fields.contract) || searchableInfo.split(" | ").find((value) => cleanContract(value)) || "");
        const location =
            asText(fields.location) || searchableInfo.match(/[^|]*(?:\(\d{2}\)|-\s*\d{2})[^|]*/i)?.[0]?.trim() || "";
        const publishedAt = cleanPublishedAt(asText(fields.publishedAt)) ||
            searchableInfo.split(" | ").map(cleanPublishedAt).find(Boolean) ||
            "";

        return [
            site,
            url,
            title,
            fields.company,
            location,
            contract,
            fields.salary,
            fields.workTime,
            publishedAt,
            fields.description,
            JSON.stringify(extra),
        ]
            .map(csvCell)
            .join(";");
    });

    return `\uFEFF${headers.map(csvCell).join(";")}\r\n${rows.join("\r\n")}\r\n`;
}
