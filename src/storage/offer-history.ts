import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

type Offer = {
    title: string;
    url: string;
    extra: unknown;
};

type HistoryFile = {
    urls?: unknown;
};

function normalizeUrl(value: string): string {
    try {
        const url = new URL(value.trim());
        url.hash = "";
        return url.toString().replace(/\/$/, "");
    } catch {
        return value.trim();
    }
}

function extractCsvUrls(content: string): string[] {
    const lines = content.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0]?.split(";").map((header) => header.trim().replace(/^"|"$/g, "")) ?? [];
    const urlIndex = headers.findIndex((header) => header.toLowerCase() === "lien" || header.toLowerCase() === "url");
    if (urlIndex < 0) return [];

    return lines.slice(1).flatMap((line) => {
        const values = line.match(/(?:"(?:[^"]|"")*"|[^;])+/g) ?? [];
        const value = values[urlIndex]?.replace(/^"|"$/g, "").replace(/""/g, '"').trim();
        return value ? [value] : [];
    });
}

async function addCsvUrls(filePath: string, urls: Set<string>): Promise<void> {
    try {
        const content = await readFile(filePath, "utf8");
        for (const url of extractCsvUrls(content)) urls.add(normalizeUrl(url));
    } catch {
        // An unavailable or malformed archive must not stop the scraping run.
    }
}

export async function loadSeenUrls(
    resultsDirectory: string,
    legacyHistoryPath: string,
    legacyCsvPath: string,
): Promise<Set<string>> {
    const urls = new Set<string>();

    try {
        const files = await readdir(resultsDirectory, { withFileTypes: true });
        for (const file of files.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))) {
            await addCsvUrls(`${resultsDirectory}/${file.name}`, urls);
        }
    } catch {
        // The archive directory is created after the first successful run.
    }

    if (urls.size === 0) {
        try {
            const content = await readFile(legacyHistoryPath, "utf8");
            const history = JSON.parse(content) as HistoryFile;
            for (const url of Array.isArray(history.urls) ? history.urls : []) {
                if (typeof url === "string") urls.add(normalizeUrl(url));
            }
        } catch {
            // The old JSON history is optional and only used for migration.
        }
    }

    if (urls.size === 0) await addCsvUrls(legacyCsvPath, urls);
    return urls;
}

export function filterSeenOffers(offers: Offer[], seenUrls: Set<string>): Offer[] {
    return offers.filter((offer) => !seenUrls.has(normalizeUrl(offer.url)));
}

export async function archiveCsv(resultsDirectory: string, csvContent: string): Promise<string> {
    await mkdir(resultsDirectory, { recursive: true });
    const fileName = `jobs-${new Date().toISOString().replace(/[.:]/g, "-")}.csv`;
    const filePath = `${resultsDirectory}/${fileName}`;
    await writeFile(filePath, csvContent, "utf8");
    return filePath;
}
