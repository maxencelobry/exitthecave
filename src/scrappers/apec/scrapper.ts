import { chromium, type Page } from "playwright";
import { searchConfig } from "../../config/search.js";

const SEARCH_URL = `https://www.apec.fr/candidat/recherche-emploi.html/emploi?lieux=${searchConfig.apec.locationId}&distance=${searchConfig.location.radiusKm}&sortsType=DATE&typesConvention=143684&typesConvention=143685&typesConvention=143686&typesConvention=143687&typesConvention=143706&anciennetePublication=101850`;
const OFFER_SELECTOR = 'a[href*="/emploi/detail-offre/"]';

export interface ApecResult {
    title: string;
    url: string;
    extra: { visibleInfo: string[] };
}

export class ApecScrapper {
    async scrap(): Promise<ApecResult[]> {
        const results = new Map<string, ApecResult>();
        const browser = await chromium.launch({ headless: true });

        try {
            const page = await browser.newPage();
            this.log(`Ouverture de ${SEARCH_URL}`);
            await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
            await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
            await page.waitForTimeout(1_000);

            const body = await page
                .locator("body")
                .innerText()
                .catch(() => "");
            const expectedCount = Number(body.match(/([\d\s]+)\s+Offres correspondent/i)?.[1]?.replace(/\s/g, "") ?? 0);
            this.log(`Résultat affiché : ${expectedCount || "inconnu"} offre(s)`);
            await this.collectPages(page, results, expectedCount);
            this.log(`${results.size} offre(s) trouvée(s)`);
            return [...results.values()];
        } catch (error) {
            this.logError("La collecte a rencontré une erreur", error);
            return [...results.values()];
        } finally {
            await browser.close().catch((error) => this.logError("Fermeture du navigateur impossible", error));
        }
    }

    private async collectPages(page: Page, results: Map<string, ApecResult>, expectedCount: number): Promise<void> {
        for (let pageNumber = 0; pageNumber <= 500; pageNumber += 1) {
            const entries = await page.locator(OFFER_SELECTOR).evaluateAll((links) =>
                links.map((link) => ({
                    href: (link as HTMLAnchorElement).href,
                    title: link.querySelector("h2")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
                    visibleInfo: (link.textContent ?? "")
                        .split(/\n+/)
                        .map((value) => value.replace(/\s+/g, " ").trim())
                        .filter(Boolean),
                })),
            );
            let newResults = 0;
            for (const entry of entries) {
                if (expectedCount > 0 && results.size >= expectedCount) break;
                if (!entry.href || results.has(entry.href)) continue;
                results.set(entry.href, {
                    title: entry.title,
                    url: entry.href,
                    extra: { visibleInfo: entry.visibleInfo },
                });
                newResults += 1;
            }
            this.log(`Page ${pageNumber + 1} : ${newResults} nouvelle(s) offre(s), ${results.size} au total`);

            if (newResults === 0 || (expectedCount > 0 && results.size >= expectedCount)) return;
            const nextUrl = new URL(page.url());
            nextUrl.searchParams.set("page", String(pageNumber + 1));
            await page.goto(nextUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
            await page.waitForTimeout(800);
        }
    }

    private log(message: string): void {
        console.log(`[APEC] ${message}`);
    }

    private logError(message: string, error: unknown): void {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[APEC] ${message} : ${detail}`);
    }
}
