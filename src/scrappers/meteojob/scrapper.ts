import { chromium, type Page } from "playwright";
import { searchConfig } from "../../config/search.js";

const SEARCH_URL = `https://www.meteojob.com/jobs?where=${encodeURIComponent(searchConfig.location.city)}&sorting=DATE&facetSince=1&distance=${searchConfig.location.radiusKm}`;
const OFFER_SELECTOR = 'article a[href*="/jobs/"]';

export interface MeteojobResult {
  title: string;
  url: string;
  extra: {
    company: string | null;
    location: string | null;
    contract: string | null;
    publishedAt: string | null;
    visibleInfo: string[];
  };
}

export class MeteojobScrapper {
  async scrap(): Promise<MeteojobResult[]> {
    const results = new Map<string, MeteojobResult>();
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      this.log(`Ouverture de ${SEARCH_URL}`);
      await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(1_000);
      await page.addStyleTag({
        content: "#tarteaucitronRoot { display: none !important; }",
      });

      await this.applyLastDayFilter(page);
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
    const filter = page.getByRole("checkbox", { name: /Hier/ });
    if (await filter.count() === 0) {
      this.log("Filtre 24 heures indisponible");
      return;
    }

    const isChecked = await filter.evaluate((element) => (element as HTMLInputElement).checked);
    if (!isChecked) {
      await filter.click();
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(1_000);
    }
    this.log("Filtre appliqué : depuis hier");
  }

  private async collectPages(page: Page, results: Map<string, MeteojobResult>): Promise<void> {
    for (let pageNumber = 1; pageNumber <= 500; pageNumber += 1) {
      const entries = await page.locator("article").evaluateAll((articles) => articles.map((article) => {
        const link = article.querySelector('a[href*="/jobs/"]') as HTMLAnchorElement | null;
        const title = article.querySelector("h2")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const paragraphs = [...article.querySelectorAll("p")]
          .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
          .filter(Boolean);
        const visibleInfo = (article.textContent ?? "")
          .split(/\n+/)
          .map((value) => value.replace(/\s+/g, " ").trim())
          .filter((value) => value && value !== title);
        const publishedAt = visibleInfo.find((value) => /hier|il y a \d+ heure/i.test(value)) ?? null;
        const location = visibleInfo.find((value) => /\(\d{2}\)|france/i.test(value)) ?? null;
        const contract = visibleInfo.find((value) => /CDI|CDD|Intérim|Alternance|Indépendant/i.test(value)) ?? null;

        return {
          title,
          href: link?.href ?? "",
          company: paragraphs[0] ?? null,
          location,
          contract,
          publishedAt,
          visibleInfo,
        };
      }));

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
            publishedAt: entry.publishedAt,
            visibleInfo: entry.visibleInfo,
          },
        });
        newResults += 1;
      }
      this.log(`Page ${pageNumber} : ${newResults} nouvelle(s) offre(s), ${results.size} au total`);

      const next = page.getByRole("button", { name: "Page suivante", exact: true });
      if (await next.count() === 0 || !(await next.isEnabled()) || newResults === 0) return;
      const nextUrl = new URL(page.url());
      nextUrl.searchParams.set("page", String(pageNumber + 1));
      await page.goto(nextUrl.toString(), { waitUntil: "commit", timeout: 15_000 });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (await page.locator(OFFER_SELECTOR).count() > 0) break;
        await page.waitForTimeout(500);
      }
    }
  }

  private log(message: string): void {
    console.log(`[Meteojob] ${message}`);
  }

  private logError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[Meteojob] ${message} : ${detail}`);
  }
}
