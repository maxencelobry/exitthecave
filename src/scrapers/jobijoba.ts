import { chromium, type Page } from "playwright";
import { searchConfig } from "../config.js";

const SEARCH_URL = `https://www.jobijoba.com/fr/query/?where=${encodeURIComponent(searchConfig.location.city)}&where_type=city&perimeter=${searchConfig.jobijoba.radiusKm}&period=24_hours`;
const OFFER_SELECTOR = "a.offer-link";

export interface JobijobaResult {
    title: string;
    url: string;
    extra: {
        company: string | null;
        location: string | null;
        contract: string | null;
        salary: string | null;
        category: string | null;
        publishedAt: string | null;
        description: string | null;
        visibleInfo: string[];
    };
}

export class JobijobaScrapper {
    async scrap(): Promise<JobijobaResult[]> {
        const results = new Map<string, JobijobaResult>();
        const browser = await chromium.launch({ headless: true });

        try {
            const page = await browser.newPage();
            this.log(`Ouverture de ${SEARCH_URL}`);
            await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
            await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
            await page.waitForTimeout(1_000);
            const bodyText = await page
                .locator("body")
                .innerText()
                .catch(() => "");
            const expectedCount = Number(
                bodyText.match(/Filtrer parmi ([\d\s]+) offres?/i)?.[1]?.replace(/\s/g, "") ?? 0,
            );
            this.log(`Résultat affiché : ${expectedCount || "inconnu"} offre(s)`);
            await this.collectPages(page, results);
            if (expectedCount > 0 && results.size < expectedCount) {
                this.logError(
                    `Pagination incomplète (${results.size}/${expectedCount})`,
                    "Jobijoba ne fournit plus de bouton suivant",
                );
            }
            this.log(`${results.size} offre(s) trouvée(s)`);
            return [...results.values()];
        } catch (error) {
            this.logError("La collecte a rencontré une erreur", error);
            return [...results.values()];
        } finally {
            await browser.close().catch((error) => this.logError("Fermeture du navigateur impossible", error));
        }
    }

    private async collectPages(page: Page, results: Map<string, JobijobaResult>): Promise<void> {
        for (let pageNumber = 1; pageNumber <= 200; pageNumber += 1) {
            const entries = await page.locator(OFFER_SELECTOR).evaluateAll((links) =>
                links.map((link) => {
                    const text = (selector: string): string =>
                        link.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
                    const features = [...link.querySelectorAll(".offer-features .feature")]
                        .map((feature) => feature.textContent?.replace(/\s+/g, " ").trim() ?? "")
                        .filter(Boolean);
                    const contract =
                        features.find((value) =>
                            /CDI|CDD|Intérim|Alternance|Stage|Indépendant|Freelance/i.test(value),
                        ) ?? null;
                    const salary = features.find((value) => /€|euros|salaire/i.test(value)) ?? null;
                    const location =
                        features.find((value) => /\(à \d+ km|\b\d{2}\b/.test(value)) ?? features[0] ?? null;
                    const company =
                        features.find((value) => value !== location && value !== contract && value !== salary) ?? null;
                    const title = text(".offer-header-title");
                    const publishedAt = text(".publication_date") || null;
                    const description = text(".description") || null;
                    const category =
                        features.find(
                            (value) =>
                                value !== location && value !== contract && value !== salary && value !== company,
                        ) ?? null;

                    return {
                        href: (link as HTMLAnchorElement).href,
                        title,
                        company,
                        location,
                        contract,
                        salary,
                        category,
                        publishedAt,
                        description,
                        visibleInfo: [...features, publishedAt, description].filter((value): value is string =>
                            Boolean(value),
                        ),
                    };
                }),
            );

            let newResults = 0;
            for (const entry of entries) {
                if (!entry.href || results.has(entry.href)) continue;
                results.set(entry.href, {
                    title: entry.title,
                    url: entry.href,
                    extra: {
                        company: entry.company,
                        location: entry.location,
                        contract: entry.contract,
                        salary: entry.salary,
                        category: entry.category,
                        publishedAt: entry.publishedAt,
                        description: entry.description,
                        visibleInfo: entry.visibleInfo,
                    },
                });
                newResults += 1;
            }
            this.log(`Page ${pageNumber} : ${newResults} nouvelle(s) offre(s), ${results.size} au total`);

            const next = page.locator(".next").last();
            if ((await next.count()) === 0 || newResults === 0) return;
            const before = await page.locator(OFFER_SELECTOR).count();
            await next.click();
            for (let attempt = 0; attempt < 30; attempt += 1) {
                await page.waitForTimeout(500);
                if ((await page.locator(OFFER_SELECTOR).count()) > before) break;
            }
        }
    }

    private log(message: string): void {
        console.log(`[Jobijoba] ${message}`);
    }

    private logError(message: string, error: unknown): void {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[Jobijoba] ${message} : ${detail}`);
    }
}
