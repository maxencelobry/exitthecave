import { chromium, type Page } from "playwright";
import { searchConfig } from "../../config/search.js";

const SEARCH_URL = `https://candidat.francetravail.fr/offres/recherche?emission=1&lieux=${searchConfig.franceTravail.locationCode}&offresPartenaires=true&range=0-19&rayon=${searchConfig.franceTravail.radiusKm}&tri=1`;
const OFFER_SELECTOR = 'a.media.with-fav[href*="/offres/recherche/detail/"]';

export interface FranceTravailResult {
    title: string;
    url: string;
    extra: {
        company: string | null;
        location: string | null;
        contract: string | null;
        workTime: string | null;
        publishedAt: string | null;
    };
}

export class FranceTravailScrapper {
    async scrap(): Promise<FranceTravailResult[]> {
        const results = new Map<string, FranceTravailResult>();
        const browser = await chromium.launch({ headless: true });

        try {
            const page = await browser.newPage();
            this.log(`Ouverture de ${SEARCH_URL}`);
            await page.goto(SEARCH_URL, {
                waitUntil: "domcontentloaded",
                timeout: 30_000,
            });
            await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
            await page.waitForTimeout(500);

            await this.applyLastDayFilter(page);
            await this.sortByDate(page);
            await this.collectPages(page, results);

            this.log(`${results.size} offre(s) trouvée(s)`);
            return [...results.values()];
        } catch (error) {
            this.logError("La collecte a rencontré une erreur", error);
            return [...results.values()];
        } finally {
            await browser.close().catch((error) => this.logError("Fermeture du navigateur impossible", error));
        }
    }

    private async applyLastDayFilter(page: Page): Promise<void> {
        this.log("Application du filtre : Date de création → Un jour");

        await page.addStyleTag({
            content: [
                "pe-cookies { display: none !important; }",
                "#filter-date-creation + .dropdown-menu { display: block !important; visibility: visible !important; opacity: 1 !important; }",
            ].join("\n"),
        });

        const filter = page.locator("#filter-date-creation");
        await filter.evaluate((element) => element.parentElement?.classList.add("open"));

        const option = page.locator('input[name="emissionRadioGroup"][value="1"]');
        await page.locator('input[name="emissionRadioGroup"]').evaluateAll((elements) => {
            for (const element of elements) {
                (element as HTMLInputElement).checked = element === elements[0];
                element.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });
        this.log(`Option sélectionnée : ${await option.isChecked()}`);

        const response = page
            .waitForResponse((candidate) => candidate.url().includes("emploi.rechercheoffre.rechercheform"), {
                timeout: 15_000,
            })
            .catch(() => undefined);
        await page.locator("#btnSubmitDateCreation").evaluate((element) => (element as HTMLElement).click());
        await response;
        await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
        await page.waitForTimeout(1_500);
        this.log(`Filtre appliqué (${page.url()})`);
        this.log(
            `Résultat affiché : ${(
                await page
                    .locator("h1")
                    .first()
                    .innerText()
                    .catch(() => "inconnu")
            )
                .replace(/\s+/g, " ")
                .trim()}`,
        );
    }

    private async collectPages(page: Page, results: Map<string, FranceTravailResult>): Promise<void> {
        const visitedNextLinks = new Set<string>();
        let pageNumber = 1;

        while (true) {
            const cards = page.locator(OFFER_SELECTOR);
            const entries = await cards.evaluateAll((elements) =>
                elements.map((element) => ({
                    href: (element as HTMLAnchorElement).href,
                    title: element.querySelector(".media-heading-title")?.textContent?.trim() ?? "",
                    location: element.querySelector(".subtext span")?.textContent?.trim() ?? "",
                    company: (() => {
                        const subtext =
                            element.querySelector(".subtext")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
                        const location =
                            element.querySelector(".subtext span")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
                        return subtext
                            .replace(location, "")
                            .replace(/\s*-\s*$/, "")
                            .trim();
                    })(),
                    contract: element.querySelector(".contrat")?.childNodes[0]?.textContent?.trim() ?? "",
                    workTime: element.querySelector(".type-contrat")?.textContent?.trim() ?? "",
                    publishedAt: element.querySelector(".date")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
                })),
            );
            this.log(`Page ${pageNumber} : ${entries.length} carte(s) détectée(s)`);
            let newResults = 0;
            for (const entry of entries) {
                if (results.has(entry.href)) continue;
                results.set(entry.href, {
                    title: entry.title,
                    url: entry.href,
                    extra: {
                        company: entry.company || null,
                        location: entry.location || null,
                        contract: entry.contract || null,
                        workTime: entry.workTime || null,
                        publishedAt: entry.publishedAt || null,
                    },
                });
                newResults += 1;
            }
            this.log(`Page ${pageNumber} : ${newResults} nouvelle(s) offre(s), ${results.size} au total`);
            if (newResults === 0) {
                this.log("Pagination arrêtée : aucune nouvelle offre détectée");
                return;
            }

            const next = page.locator('a[href*="afficherplusderesultats"]').last();
            if ((await next.count()) === 0) {
                this.log("Fin de la pagination");
                return;
            }

            const nextHref = await next.getAttribute("href");
            if (!nextHref || visitedNextLinks.has(nextHref)) {
                this.log("Pagination arrêtée : lien suivant absent ou déjà parcouru");
                return;
            }

            visitedNextLinks.add(nextHref);
            this.log("Clic sur les 20 offres suivantes");
            const previousCount = await cards.count();
            await next.click({ force: true });
            await cards
                .nth(previousCount)
                .waitFor({ state: "attached", timeout: 15_000 })
                .catch(() => undefined);
            await page.waitForTimeout(800);
            pageNumber += 1;
        }
    }

    private async sortByDate(page: Page): Promise<void> {
        this.log("Tri par date : double clic demandé par France Travail");

        for (let attempt = 1; attempt <= 2; attempt += 1) {
            const sortButton = page.locator("#sort1");
            if ((await sortButton.count()) === 0) {
                this.logError("Bouton de tri introuvable", "#sort1");
                return;
            }

            await sortButton.click({ force: true });
            const dateOption = page.getByText("Date", { exact: true }).last();
            if ((await dateOption.count()) === 0) {
                this.logError("Option de tri par date introuvable", "Date");
                return;
            }

            await dateOption.click({ force: true });
            await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
            await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
            await page.waitForTimeout(800);
            this.log(`Tri par date appliqué (${attempt}/2)`);
        }
    }

    private log(message: string): void {
        console.log(`[France Travail] ${message}`);
    }

    private logError(message: string, error: unknown): void {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[France Travail] ${message} : ${detail}`);
    }
}
