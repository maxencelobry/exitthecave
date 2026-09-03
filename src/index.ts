import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApecScrapper } from "./scrappers/apec/scrapper.js";
import { CadremploiScrapper } from "./scrappers/cadremploi/scrapper.js";
import { writeJson } from "./exporters/json.js";
import { FranceTravailScrapper } from "./scrappers/francetravail/scrapper.js";
import { GlassdoorScrapper } from "./scrappers/glassdoor/scrapper.js";
import { HelloworkScrapper } from "./scrappers/hellowork/scrapper.js";
import { MeteojobScrapper } from "./scrappers/meteojob/scrapper.js";
import { writeCsv } from "./exporters/csv.js";
import { enrichOffers, filterOffers } from "./filters/offers.js";
import { JobijobaScrapper } from "./scrappers/jobijoba/scrapper.js";
import { searchConfig } from "./config/search.js";
import { archiveCsv, filterSeenOffers, loadSeenUrls } from "./storage/offer-history.js";
import { FranceTravailApiScrapper } from "./scrappers/francetravail-api/scrapper.js";

type Offer = { title: string; url: string; extra: unknown };

function mergeOffers(primary: Offer[], supplemental: Offer[]): Offer[] {
    const merged = new Map(primary.map((offer) => [offer.url, offer]));
    for (const offer of supplemental) {
        const existing = merged.get(offer.url);
        if (!existing) {
            merged.set(offer.url, offer);
            continue;
        }
        const existingExtra = existing.extra && typeof existing.extra === "object" ? existing.extra : {};
        const supplementalExtra = offer.extra && typeof offer.extra === "object" ? offer.extra : {};
        merged.set(offer.url, { ...existing, ...offer, extra: { ...existingExtra, ...supplementalExtra } });
    }
    return [...merged.values()];
}

(async () => {
    const enabled = searchConfig.scrapers.enabled;
    const [franceTravailBrowser, franceTravailApi, meteojob, hellowork, glassdoor, cadremploi, apec, jobijoba] =
        await Promise.all([
            enabled.franceTravail ? new FranceTravailScrapper().scrap() : Promise.resolve([]),
            enabled.franceTravail && searchConfig.franceTravail.api.enabled
                ? new FranceTravailApiScrapper().scrap()
                : Promise.resolve([]),
            enabled.meteojob ? new MeteojobScrapper().scrap() : Promise.resolve([]),
            enabled.hellowork ? new HelloworkScrapper().scrap() : Promise.resolve([]),
            enabled.glassdoor ? new GlassdoorScrapper().scrap() : Promise.resolve([]),
            enabled.cadremploi ? new CadremploiScrapper().scrap() : Promise.resolve([]),
            enabled.apec ? new ApecScrapper().scrap() : Promise.resolve([]),
            enabled.jobijoba ? new JobijobaScrapper().scrap() : Promise.resolve([]),
        ]);

    const results = {
        franceTravail: filterOffers(enrichOffers(mergeOffers(franceTravailBrowser, franceTravailApi))),
        meteojob: filterOffers(enrichOffers(meteojob)),
        hellowork: filterOffers(enrichOffers(hellowork)),
        glassdoor: filterOffers(enrichOffers(glassdoor)),
        cadremploi: filterOffers(enrichOffers(cadremploi)),
        apec: filterOffers(enrichOffers(apec)),
        jobijoba: filterOffers(enrichOffers(jobijoba)),
    };
    const dataPath = join(process.cwd(), "data");
    const outputPath = join(dataPath, "jobs.json");
    const csvOutputPath = join(dataPath, "jobs.csv");
    const resultsDirectory = join(dataPath, searchConfig.history.directoryName);
    const historyPath = join(dataPath, "results.json");
    const seenUrls = searchConfig.history.enabled
        ? await loadSeenUrls(resultsDirectory, historyPath, csvOutputPath)
        : new Set<string>();
    const freshResults = Object.fromEntries(
        Object.entries(results).map(([site, offers]) => [site, filterSeenOffers(offers, seenUrls)]),
    );
    const skippedOffers =
        Object.values(results).reduce((total, offers) => total + offers.length, 0) -
        Object.values(freshResults).reduce((total, offers) => total + offers.length, 0);
    const csvOffers = Object.entries(results).flatMap(([site, offers]) =>
        (freshResults[site] ?? []).map((offer) => ({
            site,
            title: offer.title,
            url: offer.url,
            extra: offer.extra,
        })),
    );

    await mkdir(dataPath, { recursive: true });
    const freshStats = Object.fromEntries(
        Object.entries(freshResults).map(([site, offers]) => [site, { offers: offers.length }]),
    );
    await writeFile(
        outputPath,
        writeJson({ generatedAt: new Date().toISOString(), stats: freshStats, results: freshResults }),
    );
    const csvContent = writeCsv(csvOffers);
    await writeFile(csvOutputPath, csvContent, "utf8");
    const archivePath = await archiveCsv(resultsDirectory, csvContent).catch((error) => {
        console.error(`[History] Impossible d'archiver la collecte : ${String(error)}`);
        return null;
    });

    for (const [site, siteStats] of Object.entries(freshStats))
        console.log(`[Stats] ${site} : ${siteStats.offers} offre(s)`);
    if (searchConfig.history.enabled) console.log(`[History] ${skippedOffers} offre(s) déjà connue(s) ignorée(s)`);
    if (archivePath) console.log(`[History] Archive CSV sauvegardée : ${archivePath}`);
    console.log(`[Stats] JSON sauvegardé : ${outputPath}`);
    console.log(`[Stats] CSV sauvegardé : ${csvOutputPath} (${csvOffers.length} ligne(s))`);

    console.log(JSON.stringify(freshResults, null, 2));
})();
