import { connect } from "puppeteer-real-browser";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { searchConfig } from "../../config.js";

const CARD_SELECTOR = 'div[role="button"][componentkey^="job-card-component-ref-"]';

type LinkedinPage = Awaited<ReturnType<typeof connect>>["page"];

type LinkedinEntry = {
    href: string;
    title: string;
    company: string;
    location: string;
    publishedAt: string;
};

export interface LinkedinResult {
    title: string;
    url: string;
    extra: {
        company: string | null;
        location: string | null;
        publishedAt: string | null;
        description: string | null;
        visibleInfo: string[];
    };
}

export class LinkedinScrapper {
    async scrap(): Promise<LinkedinResult[]> {
        const results = new Map<string, LinkedinResult>();
        let browser: Awaited<ReturnType<typeof connect>>["browser"] | undefined;
        try {
            const profilePath = join(process.cwd(), "data", "browser-state", "linkedin");
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
            let visibleCards = await page.$$eval(CARD_SELECTOR, (cards) => cards.length).catch(() => 0);
            if (page.url().includes("/uas/login") || (visibleCards === 0 && /sign in|se connecter/i.test(bodyText))) {
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
                visibleCards = await page.$$eval(CARD_SELECTOR, (cards) => cards.length).catch(() => 0);
            }
            this.log(`Page finale : ${page.url()} | titre : ${await page.title().catch(() => "inconnu")}`);
            this.log(`Cartes d'offres visibles : ${visibleCards}`);
            if (!visibleCards) {
                const diagnostics = await page.evaluate((selector) => ({
                    jobLinks: document.querySelectorAll('a[href*="/jobs/view/"]').length,
                    resultItems: document.querySelectorAll(selector).length,
                    text: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 240),
                }), CARD_SELECTOR).catch(() => ({ jobLinks: 0, resultItems: 0, text: "" }));
                this.log(`Diagnostic : ${JSON.stringify(diagnostics)}`);
            }
            if (
                /captcha|access denied|authwall|checkpoint|authentification/i.test(bodyText) ||
                (visibleCards === 0 && /sign in|se connecter|join linkedin/i.test(bodyText))
            ) {
                this.logError("Connexion ou blocage LinkedIn détecté", "collecte publique arrêtée");
                return [];
            }
            for (let pageNumber = 1; pageNumber <= searchConfig.linkedin.maxPages; pageNumber += 1) {
                const newResults = await this.collectScrollablePage(page, results);
                this.log(`Page ${pageNumber} : ${newResults} nouvelle(s) offre(s), ${results.size} au total`);
                if (!newResults || pageNumber === searchConfig.linkedin.maxPages) break;
                const clickedNext = await this.openNextPage(page, pageNumber + 1);
                if (!clickedNext) break;
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

    private async collectScrollablePage(
        page: LinkedinPage,
        results: Map<string, LinkedinResult>,
    ): Promise<number> {
        const initialSize = results.size;
        let stagnantPasses = 0;

        for (let pass = 0; pass < 120; pass += 1) {
            const entries = await this.readVisibleEntries(page);
            let addedThisPass = 0;
            for (const entry of entries) {
                if (!entry.href || !entry.title || results.has(entry.href)) continue;
                const description = searchConfig.linkedin.loadDescriptions
                    ? await this.loadVisibleDescription(page, entry.href)
                    : null;
                results.set(entry.href, {
                    title: entry.title,
                    url: entry.href,
                    extra: {
                        company: entry.company || null,
                        location: entry.location || null,
                        publishedAt: entry.publishedAt || null,
                        description,
                        visibleInfo: [entry.company, entry.location, entry.publishedAt].filter(Boolean),
                    },
                });
                addedThisPass += 1;
            }

            stagnantPasses = addedThisPass ? 0 : stagnantPasses + 1;
            const scroll = await page.evaluate((selector) => {
                const card = document.querySelector<HTMLElement>(selector);
                let container = card?.parentElement ?? null;
                while (container && container !== document.body) {
                    if (container.scrollHeight > container.clientHeight + 100 && container.clientHeight > 200) break;
                    container = container.parentElement;
                }
                if (!container || container === document.body) return { moved: false, atEnd: true };
                const before = container.scrollTop;
                const maximum = container.scrollHeight - container.clientHeight;
                container.scrollTop = Math.min(maximum, before + Math.max(300, container.clientHeight * 0.72));
                return { moved: container.scrollTop > before + 1, atEnd: container.scrollTop >= maximum - 2 };
            }, CARD_SELECTOR).catch(() => ({ moved: false, atEnd: true }));

            if ((!scroll.moved && scroll.atEnd) || (scroll.atEnd && stagnantPasses >= 2) || stagnantPasses >= 5) break;
            await new Promise((resolve) => setTimeout(resolve, 450));
        }

        return results.size - initialSize;
    }

    private async readVisibleEntries(page: LinkedinPage): Promise<LinkedinEntry[]> {
        return page.$$eval(CARD_SELECTOR, (cards) =>
            cards.map((card) => {
                const rawParagraphs = Array.from(card.querySelectorAll("p"))
                    .map((paragraph) => paragraph.innerText.trim())
                    .filter(Boolean);
                const paragraphs = rawParagraphs.map((value) => value.replace(/\s+/g, " ").trim());
                const componentKey = card.getAttribute("componentkey") ?? "";
                const jobId = componentKey.replace("job-card-component-ref-", "");
                const titleLines = rawParagraphs[0]?.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) ?? [];
                const title = titleLines.at(-1) ?? paragraphs[0] ?? "";
                const publicationText = rawParagraphs.find((value) => /(?:re)?publication/i.test(value)) ?? "";
                const publishedAt = publicationText
                    .match(/(?:re)?publication\s+([^\n·]+)/i)?.[1]
                    ?.replace(/\s+/g, " ")
                    .trim() ?? "";
                return {
                    href: jobId ? `https://www.linkedin.com/jobs/view/${jobId}` : "",
                    title,
                    company: paragraphs[1] ?? "",
                    location: paragraphs[2] ?? "",
                    publishedAt,
                };
            }),
        ).catch(() => []);
    }

    private async openNextPage(page: LinkedinPage, nextPageNumber: number): Promise<boolean> {
        const currentIds = new Set(await page.$$eval(CARD_SELECTOR, (cards) =>
            cards.flatMap((card) => {
                const id = card.getAttribute("componentkey");
                return id ? [id] : [];
            }),
        ).catch((): string[] => []));
        const nextUrl = new URL(page.url());
        nextUrl.searchParams.delete("currentJobId");
        nextUrl.searchParams.set("start", String((nextPageNumber - 1) * 25));

        try {
            await page.goto(nextUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            const nextIds = await page.$$eval(CARD_SELECTOR, (cards) =>
                cards.map((card) => card.getAttribute("componentkey")).filter(Boolean),
            );
            return nextIds.some((id) => id && !currentIds.has(id));
        } catch (error) {
            this.logError(`Impossible d'ouvrir la page ${nextPageNumber}`, error);
            return false;
        }
    }

    private async loadVisibleDescription(
        page: LinkedinPage,
        url: string,
    ): Promise<string | null> {
        const jobId = url.match(/\/jobs\/view\/(\d+)/)?.[1];
        if (!jobId) return null;
        const card = await page.$(`[componentkey="job-card-component-ref-${jobId}"]`);
        if (!card) return null;

        await card.click().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const description = await page
            .evaluate(() => {
                const candidates = [
                    ...document.querySelectorAll<HTMLElement>(
                        ".jobs-description__content, .jobs-description-content__text, .jobs-box__html-content, [data-testid='expandable-text-box'], [id^='JobDetails_AboutTheJob_'], [class*='description'], [class*='markup']",
                    ),
                ]
                    .map((element) =>
                        element.innerText
                            .replace(/^À propos de l’offre d’emploi\s*/i, "")
                            .replace(/^About the job\s*/i, "")
                            .replace(/\s+/g, " ")
                            .trim(),
                    )
                    .filter((text) => text.length >= 80 && !/^(description|about the job)$/i.test(text));
                return candidates.sort((left, right) => right.length - left.length)[0] ?? null;
            })
            .catch(() => null);
        if (description) this.log(`Description récupérée : ${description.length} caractère(s)`);
        return description;
    }

    private log(message: string): void {
        console.log(`[LinkedIn] ${message}`);
    }

    private logError(message: string, error: unknown): void {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[LinkedIn] ${message} : ${detail}`);
    }
}
