import { FranceTravailApiScrapper, type FranceTravailApiOptions } from "./api.js";
import { FranceTravailBrowserScrapper } from "./browser.js";
import { searchConfig } from "../../config.js";
import { runSource, reportStop, reportError, reportProgress, type SourceReport } from "../../core/collection.js";

type FranceTravailOffer = {
    title: string;
    url: string;
    extra: Record<string, unknown>;
};

function mergeOffers(offers: FranceTravailOffer[]): FranceTravailOffer[] {
    const merged = new Map<string, FranceTravailOffer>();
    for (const offer of offers) {
        const current = merged.get(offer.url);
        merged.set(offer.url, current ? { ...current, ...offer, extra: { ...current.extra, ...offer.extra } } : offer);
    }
    return [...merged.values()];
}

export class FranceTravailScrapper {
    async scrap(options: FranceTravailApiOptions = {}): Promise<FranceTravailOffer[]> {
        const browserReport: SourceReport = { state: "running", reason: "", pages: 0, collected: 0 };
        const apiReport: SourceReport = { state: "running", reason: "", pages: 0, collected: 0 };
        const [browserOffers, apiOffers] = await Promise.all([
            runSource(browserReport, () => {}, () => new FranceTravailBrowserScrapper().scrap()),
            searchConfig.franceTravail.api.enabled
                ? runSource(apiReport, () => {}, () => new FranceTravailApiScrapper().scrap(options))
                : Promise.resolve([]),
        ]);
        const combined = mergeOffers([
            ...browserOffers.map((offer) => ({ ...offer, extra: { ...offer.extra } })),
            ...apiOffers.map((offer) => ({ ...offer, extra: { ...offer.extra } })),
        ]);
        const reports = [browserReport, ...(searchConfig.franceTravail.api.enabled ? [apiReport] : [])];
        reportProgress(reports.reduce((total, report) => total + report.pages, 0), combined.length);
        const reason = reports.map((report, index) => `${index ? "API" : "Site"} : ${report.reason}`).join(" · ");
        if (!combined.length && reports.some((report) => ["error", "login_required"].includes(report.state))) reportError(reason);
        else reportStop(reason, reports.every((report) => report.state === "completed"));
        console.log(`[France Travail] Fusion browser/API : ${combined.length} offre(s) unique(s)`);
        return combined;
    }
}
