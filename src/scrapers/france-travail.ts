import { FranceTravailApiScrapper, type FranceTravailApiOptions } from "./france-travail-api.js";
import { FranceTravailBrowserScrapper } from "./france-travail-browser.js";
import { searchConfig } from "../config.js";

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
        const [browserOffers, apiOffers] = await Promise.all([
            new FranceTravailBrowserScrapper().scrap(),
            searchConfig.franceTravail.api.enabled
                ? new FranceTravailApiScrapper().scrap(options)
                : Promise.resolve([]),
        ]);
        const combined = mergeOffers([
            ...browserOffers.map((offer) => ({ ...offer, extra: { ...offer.extra } })),
            ...apiOffers.map((offer) => ({ ...offer, extra: { ...offer.extra } })),
        ]);
        console.log(`[France Travail] Fusion browser/API : ${combined.length} offre(s) unique(s)`);
        return combined;
    }
}
