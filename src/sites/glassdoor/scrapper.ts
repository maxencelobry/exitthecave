import { connect } from "puppeteer-real-browser";
import { searchConfig } from "../../config.js";

const SEARCH_URL = `https://www.glassdoor.fr/Emploi/${searchConfig.glassdoor.locationPath}?fromAge=1&sortBy=date_desc&radius=${searchConfig.glassdoor.radiusMiles}`;
const OFFER_SELECTOR = 'a[href*="/job-listing/"]';

export interface GlassdoorResult {
    title: string;
    url: string;
    extra: { visibleInfo: string[] };
}

export class GlassdoorScrapper {
    async scrap(): Promise<GlassdoorResult[]> {
        const results = new Map<string, GlassdoorResult>();
        let browser: Awaited<ReturnType<typeof connect>>["browser"] | undefined;

        try {
            const connection = await connect({ headless: false, turnstile: true });
            browser = connection.browser;
            const page = connection.page;
            this.log(`Ouverture de ${SEARCH_URL}`);
            await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            await this.dismissLoginModal(page);

            const heading = await page.$eval("h1", (element) => element.textContent ?? "").catch(() => "");
            this.log(`Résultat affiché : ${heading.replace(/\s+/g, " ").trim()}`);
            if (/humans only|access denied|captcha|blocked/i.test(heading)) {
                this.logError("Accès automatisé encore bloqué par Glassdoor", heading);
                return [];
            }

            await this.collectPages(page, results);
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
        results: Map<string, GlassdoorResult>,
    ): Promise<void> {
        for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
            await this.dismissLoginModal(page);
            const entries = await page.$$eval(OFFER_SELECTOR, (links) =>
                links.map((link) => {
                    const card = link.closest("li") ?? link.parentElement;
                    return {
                        href: (link as HTMLAnchorElement).href,
                        title: link.textContent?.replace(/\s+/g, " ").trim() ?? "",
                        visibleInfo: (card?.textContent ?? link.textContent ?? "")
                            .split(/\n+/)
                            .map((value) => value.replace(/\s+/g, " ").trim())
                            .filter(Boolean),
                    };
                }),
            );
            let newResults = 0;
            for (const entry of entries) {
                if (!entry.href || results.has(entry.href)) continue;
                results.set(entry.href, {
                    title: entry.title,
                    url: entry.href,
                    extra: { visibleInfo: entry.visibleInfo },
                });
                newResults += 1;
            }
            this.log(`Page ${pageNumber} : ${newResults} nouvelle(s) offre(s), ${results.size} au total`);

            const before = await page.$$eval(OFFER_SELECTOR, (links) => links.length);
            const clicked = await page.evaluate(() => {
                const button = [...document.querySelectorAll("button")].find((element) =>
                    /Voir plus d'offres d'emplois/i.test(element.textContent ?? ""),
                );
                if (!button || (button as HTMLButtonElement).disabled) return false;
                (button as HTMLButtonElement).click();
                return true;
            });
            if (!clicked || newResults === 0) return;

            for (let attempt = 0; attempt < 30; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                await this.dismissLoginModal(page);
                if ((await page.$$eval(OFFER_SELECTOR, (links) => links.length)) > before) break;
            }
        }
    }

    private async dismissLoginModal(page: Awaited<ReturnType<typeof connect>>["page"]): Promise<void> {
        const closed = await page.evaluate(() => {
            const modal = [...document.querySelectorAll('[role="dialog"], dialog, [class*="modal"]')].find((element) =>
                /Ne manquez plus aucune opportunité|Créez une alerte emploi|accès unique/i.test(
                    element.textContent ?? "",
                ),
            );
            if (!modal) return false;

            const closeButton = [...modal.querySelectorAll("button, [role=button]")].find((element) =>
                /close|fermer|×|✕|✖/i.test(
                    `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""} ${element.textContent ?? ""}`,
                ),
            );
            if (!closeButton) return false;
            (closeButton as HTMLElement).click();
            return true;
        });

        if (closed) {
            this.log("Modale de connexion/alerte fermée");
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
    }

    private log(message: string): void {
        console.log(`[Glassdoor] ${message}`);
    }

    private logError(message: string, error: unknown): void {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[Glassdoor] ${message} : ${detail}`);
    }
}
