import { chromium, type Page } from "playwright";
import { searchConfig } from "../../config/search.js";

const SEARCH_URL = `https://www.hellowork.com/fr-fr/emploi/recherche.html?k=&k_autocomplete=&l=${encodeURIComponent(`${searchConfig.location.city} ${searchConfig.location.postalCode}`)}&st=date&msa=0&ray=${searchConfig.location.radiusKm}&d=h`;
const OFFER_SELECTOR = 'a[href*="/fr-fr/emplois/"][href$=".html"]';

export interface HelloworkResult {
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

export class HelloworkScrapper {
  async scrap(): Promise<HelloworkResult[]> {
    const results = new Map<string, HelloworkResult>();
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      this.log(`Ouverture de ${SEARCH_URL}`);
      await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(1_000);
      await page.addStyleTag({
        content: [
          "dialog.hw-cc-modal__wrapper { display: none !important; }",
          ".hw-cc-notice-content { display: none !important; }",
        ].join("\n"),
      });
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

  private async collectPages(page: Page, results: Map<string, HelloworkResult>): Promise<void> {
    for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
      const entries = await page.locator(OFFER_SELECTOR).evaluateAll((links) => links.map((link) => {
        const card = link.closest("li") ?? link.closest("article") ?? link.parentElement;
        const title = card?.querySelector("h3 p")?.textContent?.replace(/\s+/g, " ").trim()
          ?? link.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const paragraphs = [...(card?.querySelectorAll("h3 p") ?? [])]
          .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
          .filter(Boolean);
        const visibleInfo = (card?.textContent ?? "")
          .split(/\n+/)
          .map((value) => value.replace(/\s+/g, " ").trim())
          .filter((value) => value && value !== title);

        return {
          href: (link as HTMLAnchorElement).href,
          title,
          company: paragraphs[1] ?? null,
          location: visibleInfo.find((value) => /-\s*\d{2}|\(\d{2}\)/.test(value)) ?? null,
          contract: visibleInfo.find((value) => /CDI|CDD|Intérim|Alternance|Freelance/i.test(value)) ?? null,
          publishedAt: visibleInfo.find((value) => /heure|hier|jour/i.test(value)) ?? null,
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

      const next = page.getByRole("button", { name: String(pageNumber + 1), exact: true });
      if (await next.count() === 0 || newResults === 0) return;
      const nextUrl = new URL(page.url());
      nextUrl.searchParams.set("p", String(pageNumber + 1));
      await page.goto(nextUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(800);
    }
  }

  private log(message: string): void {
    console.log(`[HelloWork] ${message}`);
  }

  private logError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[HelloWork] ${message} : ${detail}`);
  }
}
