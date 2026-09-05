import { connect } from "puppeteer-real-browser";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { searchConfig } from "../../config.js";

const OFFER_SELECTOR = [
    'a.base-card__full-link[href*="/jobs/view/"]',
    'a.job-card-list__title[href*="/jobs/view/"]',
    'a.job-card-container__link[href*="/jobs/view/"]',
    'a[href*="/jobs/view/"]',
].join(",");
const MORE_RESULTS_SELECTOR = [
    "button.infinite-scroller__show-more-button",
    "button[aria-label*='Voir plus']",
    "button[aria-label*='Show more']",
    "button[aria-label*='Suivant']",
    "button[aria-label*='Next']",
    "a[aria-label*='Suivant']",
    "a[aria-label*='Next']",
].join(",");
const CARD_SELECTOR = 'div[role="button"][componentkey^="job-card-component-ref-"]';

export interface LinkedinResult {
    title: string;
    url: string;
    extra: {
        company: string | null;
        location: string | null;
        publishedAt: string | null;
        visibleInfo: string[];
    };
}

export class LinkedinScrapper {
    async scrap(): Promise<LinkedinResult[]> {
        const results = new Map<string, LinkedinResult>();
        let browser: Awaited<ReturnType<typeof connect>>["browser"] | undefined;
        try {
            const profilePath = join(process.cwd(), "data", "browser-state", "linkedin-profile");
            await mkdir(profilePath, { recursive: true });
            const connection = await connect({
                headless: false,
                turnstile: false,
                customConfig: { userDataDir: profilePath },
            });
            browser = connection.browser;
            const page = connection.page;
            this.log(`Ouverture de ${searchConfig.linkedin.searchUrl}`);
            await page.goto(searchConfig.linkedin.searchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            let bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
            let publicCards = await page.$$eval(OFFER_SELECTOR, (links) => links.length).catch(() => 0);
            if (page.url().includes("/uas/login") || (publicCards === 0 && /sign in|se connecter/i.test(bodyText))) {
                this.log("Connexion manuelle requise : connecte-toi dans la fenêtre LinkedIn ouverte");
                await page.waitForFunction(() => !window.location.pathname.includes("/uas/login"), {
                    timeout: 120_000,
                });
                this.log("Connexion détectée, rechargement de la recherche LinkedIn");
                await page.goto(searchConfig.linkedin.searchUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 30_000,
                });
                await new Promise((resolve) => setTimeout(resolve, 2_000));
                bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
                publicCards = await page.$$eval(OFFER_SELECTOR, (links) => links.length).catch(() => 0);
            }
            for (let scrollNumber = 0; scrollNumber < 8; scrollNumber += 1) {
                await page.evaluate(() => {
                    window.scrollBy(0, Math.max(window.innerHeight * 0.8, 500));
                    for (const element of document.querySelectorAll<HTMLElement>("*") ) {
                        if (element.scrollHeight > element.clientHeight + 100) {
                            element.scrollTop = element.scrollHeight;
                        }
                    }
                }).catch(() => undefined);
                await new Promise((resolve) => setTimeout(resolve, 700));
            }
            publicCards = await page.$$eval(OFFER_SELECTOR, (links) => links.length).catch(() => 0);
            this.log(`Page finale : ${page.url()} | titre : ${await page.title().catch(() => "inconnu")}`);
            this.log(`Liens d'offres détectés : ${publicCards}`);
            if (!publicCards) {
                const diagnostics = await page.evaluate(() => ({
                    jobLinks: document.querySelectorAll('a[href*="/jobs/view/"]').length,
                    resultItems: document.querySelectorAll("li.jobs-search-results__list-item, .job-card-container").length,
                    text: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 240),
                })).catch(() => ({ jobLinks: 0, resultItems: 0, text: "" }));
                this.log(`Diagnostic : ${JSON.stringify(diagnostics)}`);
            }
            if (
                /captcha|access denied|authwall|checkpoint|authentification/i.test(bodyText) ||
                (publicCards === 0 && /sign in|se connecter|join linkedin/i.test(bodyText))
            ) {
                this.logError("Connexion ou blocage LinkedIn détecté", "collecte publique arrêtée");
                return [];
            }
            for (let pageNumber = 1; pageNumber <= searchConfig.linkedin.maxPages; pageNumber += 1) {
                const entries = await page.$$eval(CARD_SELECTOR, (cards) =>
                    cards.map((card) => {
                        const paragraphs = Array.from(card.querySelectorAll("p"))
                            .map((paragraph) => paragraph.innerText.replace(/\s+/g, " ").trim())
                            .filter(Boolean);
                        const componentKey = card.getAttribute("componentkey") ?? "";
                        const jobId = componentKey.replace("job-card-component-ref-", "");
                        const publishedAt = paragraphs.find((value) => /publication|publié/i.test(value)) ?? "";
                        const title =
                            card.querySelector("p span")?.textContent?.replace(/\s+/g, " ").trim() ??
                            paragraphs[0] ??
                            "";
                        return {
                            href: jobId ? `https://www.linkedin.com/jobs/view/${jobId}` : "",
                            title,
                            company: paragraphs[1] ?? "",
                            location: paragraphs[2] ?? "",
                            publishedAt,
                        };
                    }),
                );
                let newResults = 0;
                for (const entry of entries) {
                    if (!entry.href || !entry.title || results.has(entry.href)) continue;
                    results.set(entry.href, {
                        title: entry.title,
                        url: entry.href,
                        extra: {
                            company: entry.company || null,
                            location: entry.location || null,
                            publishedAt: entry.publishedAt || null,
                            visibleInfo: [entry.company, entry.location, entry.publishedAt].filter(Boolean),
                        },
                    });
                    newResults += 1;
                }
                this.log(`Page ${pageNumber} : ${newResults} nouvelle(s) offre(s), ${results.size} au total`);
                if (!newResults) break;
                const next = await page.$(`[aria-label="Page ${pageNumber + 1}"]`);
                if (next) {
                    await next.click();
                } else {
                    const clickedNext = await page
                        .$$eval("button, a", (elements) => {
                            const element = elements.find((candidate) =>
                                /^(suivant|next)$/i.test(candidate.textContent?.replace(/\s+/g, " ").trim() ?? ""),
                            ) as HTMLElement | undefined;
                            element?.click();
                            return Boolean(element);
                        })
                        .catch(() => false);
                    if (!clickedNext) {
                        const moreResults = await page.$(MORE_RESULTS_SELECTOR);
                        if (!moreResults) break;
                        await moreResults.click();
                    }
                }
                await new Promise((resolve) => setTimeout(resolve, 2_000));
            }
            return [...results.values()];
        } catch (error) {
            this.logError("La collecte LinkedIn a rencontré une erreur", error);
            return [...results.values()];
        } finally {
            await browser?.close().catch((error) => this.logError("Fermeture du navigateur impossible", error));
        }
    }

    private log(message: string): void {
        console.log(`[LinkedIn] ${message}`);
    }

    private logError(message: string, error: unknown): void {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[LinkedIn] ${message} : ${detail}`);
    }
}
