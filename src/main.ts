import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ApecScrapper } from "./sites/apec/scrapper.js";
import { CadremploiScrapper } from "./sites/cadremploi/scrapper.js";
import { writeJson } from "./output/json.js";
import { FranceTravailScrapper } from "./sites/francetravail/scrapper.js";
import { GlassdoorScrapper } from "./sites/glassdoor/scrapper.js";
import { HelloworkScrapper } from "./sites/hellowork/scrapper.js";
import { MeteojobScrapper } from "./sites/meteojob/scrapper.js";
import { writeCsv } from "./output/csv.js";
import { enrichOffers, filterOffers } from "./core/filters.js";
import { JobijobaScrapper } from "./sites/jobijoba/scrapper.js";
import { LinkedinScrapper } from "./sites/linkedin/scrapper.js";
import { searchConfig } from "./config.js";
import { archiveCsv, filterSeenOffers, loadSeenUrls } from "./core/history.js";
import type { RawOffer } from "./core/job.js";
import type { FranceTravailApiOptions } from "./sites/francetravail/api.js";

export async function collectOffers(options: FranceTravailApiOptions = {}): Promise<RawOffer[]> {
    const enabled = searchConfig.scrapers.enabled;
    const [franceTravail, meteojob, hellowork, glassdoor, cadremploi, apec, jobijoba, linkedin] =
        await Promise.all([
            enabled.franceTravail ? new FranceTravailScrapper().scrap(options) : Promise.resolve([]),
            enabled.meteojob ? new MeteojobScrapper().scrap() : Promise.resolve([]),
            enabled.hellowork ? new HelloworkScrapper().scrap() : Promise.resolve([]),
            enabled.glassdoor ? new GlassdoorScrapper().scrap() : Promise.resolve([]),
            enabled.cadremploi ? new CadremploiScrapper().scrap() : Promise.resolve([]),
            enabled.apec ? new ApecScrapper().scrap() : Promise.resolve([]),
            enabled.jobijoba ? new JobijobaScrapper().scrap() : Promise.resolve([]),
            enabled.linkedin ? new LinkedinScrapper().scrap() : Promise.resolve([]),
        ]);

    const results = {
        franceTravail: filterOffers(enrichOffers(franceTravail)),
        meteojob: filterOffers(enrichOffers(meteojob)),
        hellowork: filterOffers(enrichOffers(hellowork)),
        glassdoor: filterOffers(enrichOffers(glassdoor)),
        cadremploi: filterOffers(enrichOffers(cadremploi)),
        apec: filterOffers(enrichOffers(apec)),
        jobijoba: filterOffers(enrichOffers(jobijoba)),
        linkedin: filterOffers(enrichOffers(linkedin)),
    };
    const allOffers = Object.entries(results).flatMap(([site, offers]) =>
        offers.map((offer) => ({ site, title: offer.title, url: offer.url, extra: offer.extra })),
    );
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
    return allOffers;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    collectOffers().catch((error) => {
        console.error(`[Collecte] Erreur fatale : ${String(error)}`);
        process.exitCode = 1;
    });
