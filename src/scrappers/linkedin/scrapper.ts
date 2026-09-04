import { connect } from "puppeteer-real-browser";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { searchConfig } from "../../config/search.js";

const OFFER_SELECTOR = 'a.base-card__full-link[href*="/jobs/view/"]';

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
            const profilePath = join(process.cwd(), "storage-state", "linkedin-profile");
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
                await page.waitForFunction(
                    (selector) => !window.location.pathname.includes("/uas/login") && document.querySelectorAll(selector).length > 0,
                    { timeout: 120_000 },
                    OFFER_SELECTOR,
                );
                bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
                publicCards = await page.$$eval(OFFER_SELECTOR, (links) => links.length).catch(() => 0);
            }
            if (
                /captcha|access denied|authwall|checkpoint|authentification/i.test(bodyText) ||
                (publicCards === 0 && /sign in|se connecter|join linkedin/i.test(bodyText))
            ) {
                this.logError("Connexion ou blocage LinkedIn détecté", "collecte publique arrêtée");
                return [];
            }
            for (let pageNumber = 1; pageNumber <= searchConfig.linkedin.maxPages; pageNumber += 1) {
                const entries = await page.$$eval(OFFER_SELECTOR, (links) =>
                    links.map((link) => {
                        const card = link.closest("li") ?? link.parentElement;
                        const text = (selector: string) =>
                            card?.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
                        return {
                            href: (link as HTMLAnchorElement).href.split("?")[0],
                            title: text(".base-search-card__title") || link.textContent?.replace(/\s+/g, " ").trim() || "",
                            company: text(".base-search-card__subtitle"),
                            location: text(".job-search-card__location"),
                            publishedAt: text(".job-search-card__listdate"),
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
                const next = await page.$('a[aria-label="Next"], a.next, button[aria-label="Next"]');
                if (!next) break;
                await next.click();
                await new Promise((resolve) => setTimeout(resolve, 1_000));
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
