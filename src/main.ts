import { mkdir, writeFile, rename } from "node:fs/promises";
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
import { runSource, type SourceReport } from "./core/collection.js";

export async function collectOffers(options: FranceTravailApiOptions = {}): Promise<RawOffer[]> {
    const enabled = searchConfig.scrapers.enabled;
    const reportPath = join(process.cwd(), "data", "latest", "collection.json");
    await mkdir(join(process.cwd(), "data", "latest"), { recursive: true });
    const sources: Record<string, SourceReport> = Object.fromEntries(Object.entries(enabled).map(([name, active]) =>
        [name, { state: active ? "running" : "disabled", reason: active ? "Collecte en cours" : "Source désactivée", pages: 0, collected: 0 }]));
    const collection = { startedAt: new Date().toISOString(), finishedAt: null as string | null, pid: process.pid, state: "running", sources };
    let pending = Promise.resolve();
    const changed = () => {
        const snapshot = JSON.stringify(collection, null, 2);
        pending = pending.then(async () => {
            await writeFile(`${reportPath}.tmp`, snapshot, "utf8");
            await rename(`${reportPath}.tmp`, reportPath);
        }).catch((error) => console.error("[Diagnostic]", error));
    };
    changed();
    const collect = <T>(name: string, work: () => Promise<T[]>) => enabled[name]
        ? runSource(sources[name]!, changed, work) : Promise.resolve([] as T[]);
    const [franceTravail, meteojob, hellowork, glassdoor, cadremploi, apec, jobijoba, linkedin] =
        await Promise.all([
            collect("franceTravail", () => new FranceTravailScrapper().scrap(options)),
            collect("meteojob", () => new MeteojobScrapper().scrap()),
            collect("hellowork", () => new HelloworkScrapper().scrap()),
            collect("glassdoor", () => new GlassdoorScrapper().scrap()),
            collect("cadremploi", () => new CadremploiScrapper().scrap()),
            collect("apec", () => new ApecScrapper().scrap()),
            collect("jobijoba", () => new JobijobaScrapper().scrap()),
            collect("linkedin", () => new LinkedinScrapper().scrap()),
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
    const latestDirectory = join(dataPath, "latest");
    const outputPath = join(latestDirectory, "jobs.json");
    const csvOutputPath = join(latestDirectory, "jobs.csv");
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

    await mkdir(latestDirectory, { recursive: true });
    const freshStats = Object.fromEntries(
        Object.entries(freshResults).map(([site, offers]) => [site, { offers: offers.length }]),
    );
    for (const [site, stats] of Object.entries(freshStats)) sources[site]!.newOffers = stats.offers;
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
    collection.finishedAt = new Date().toISOString();
    collection.state = Object.values(sources).some((source) => !["completed", "disabled"].includes(source.state)) ? "partial" : "completed";
    changed();
    await pending;
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
