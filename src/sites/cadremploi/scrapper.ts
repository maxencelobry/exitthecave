import { connect } from "puppeteer-real-browser";
import { searchConfig } from "../../config.js";

const SEARCH_URL = `https://www.cadremploi.fr/emploi/liste_offres?ville=${searchConfig.cadremploi.locationSlug}&rayon=${searchConfig.location.radiusKm}`;
const OFFER_SELECTOR = 'h2 a[href*="detail_offre?offreId="]';

export interface CadremploiResult {
    title: string;
    url: string;
    extra: { visibleInfo: string[] };
}

export class CadremploiScrapper {
    async scrap(): Promise<CadremploiResult[]> {
        const results = new Map<string, CadremploiResult>();
        let browser: Awaited<ReturnType<typeof connect>>["browser"] | undefined;

        try {
            const connection = await connect({ headless: false, turnstile: true });
            browser = connection.browser;
            const page = connection.page;
            this.log(`Ouverture de ${SEARCH_URL}`);
            await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            await page.evaluate(() => {
                const dateButton = [...document.querySelectorAll("button")].find(
                    (element) => element.textContent?.trim() === "Date",
                );
                (dateButton as HTMLButtonElement | undefined)?.click();
            });
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            await page.waitForSelector(OFFER_SELECTOR, { timeout: 15_000 }).catch(() => undefined);

            const heading = await page.$eval("h1", (element) => element.textContent ?? "").catch(() => "");
            this.log(`Résultat affiché : ${heading.replace(/\s+/g, " ").trim()}`);
            if (/blocked|access denied|captcha|sorry/i.test(heading)) {
                this.logError("Accès automatisé encore bloqué par Cadremploi", heading);
                return [];
            }

            const expectedCount = Number(heading.match(/[\d\s]+(?= offres?)/i)?.[0]?.replace(/\s/g, "") ?? 0);
            await this.collectPages(page, results, expectedCount);
            this.log(`${results.size} offre(s) trouvée(s)`);
            return [...results.values()];
        } catch (error) {
            this.logError("La collecte a rencontré une erreur", error);
            return [...results.values()];
        } finally {
            await browser?.close().catch((error) => this.logError("Fermeture du navigateur impossible", error));
        }
    }

    private async collectPages(
        page: Awaited<ReturnType<typeof connect>>["page"],
        results: Map<string, CadremploiResult>,
        expectedCount: number,
    ): Promise<void> {
        for (let pageNumber = 1; pageNumber <= 500; pageNumber += 1) {
            const entries = await page.$$eval(OFFER_SELECTOR, (links) =>
                links.map((link) => {
                    const card = link.parentElement?.parentElement;
                    const visibleInfo = (card?.textContent ?? link.textContent ?? "")
                        .split(/\n+/)
                        .map((value) => value.replace(/\s+/g, " ").trim())
                        .filter(Boolean);
                    return {
                        href: (link as HTMLAnchorElement).href,
                        title: link.textContent?.replace(/\s+/g, " ").trim() ?? "",
                        visibleInfo,
                    };
                }),
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
            this.log(`Page ${pageNumber} : ${newResults} nouvelle(s) offre(s), ${results.size} au total`);

            const hasNext = await page.$$eval(
                "button",
                (buttons, nextPage) => buttons.some((button) => button.textContent?.trim() === String(nextPage)),
                pageNumber + 1,
            );
            if (!hasNext || newResults === 0 || (expectedCount > 0 && results.size >= expectedCount)) return;
            const nextUrl = new URL(page.url());
            nextUrl.searchParams.set("page", String(pageNumber + 1));
            await page.goto(nextUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
            for (let attempt = 0; attempt < 30; attempt += 1) {
                if ((await page.$$eval(OFFER_SELECTOR, (links) => links.length)) > 0) break;
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        }
    }

    private log(message: string): void {
        console.log(`[Cadremploi] ${message}`);
    }

    private logError(message: string, error: unknown): void {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[Cadremploi] ${message} : ${detail}`);
    }
}
