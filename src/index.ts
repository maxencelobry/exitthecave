import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApecScrapper } from "./scrappers/apec/scrapper.js";
import { CadremploiScrapper } from "./scrappers/cadremploi/scrapper.js";
import { FranceTravailScrapper } from "./scrappers/francetravail/scrapper.js";
import { GlassdoorScrapper } from "./scrappers/glassdoor/scrapper.js";
import { HelloworkScrapper } from "./scrappers/hellowork/scrapper.js";
import { MeteojobScrapper } from "./scrappers/meteojob/scrapper.js";
import { writeCsv } from "./exporters/csv.js";

(async() => {
    const [franceTravail, meteojob, hellowork, glassdoor, cadremploi, apec] = await Promise.all([
      new FranceTravailScrapper().scrap(),
      new MeteojobScrapper().scrap(),
      new HelloworkScrapper().scrap(),
      new GlassdoorScrapper().scrap(),
      new CadremploiScrapper().scrap(),
      new ApecScrapper().scrap(),
    ]);

	const results = { franceTravail, meteojob, hellowork, glassdoor, cadremploi, apec };
	const stats = Object.fromEntries(Object.entries(results).map(([site, offers]) => [site, { offers: offers.length }]));
	const dataPath = join(process.cwd(), "data");
	const outputPath = join(dataPath, "jobs.json");
	const csvOutputPath = join(dataPath, "jobs.csv");
	const csvOffers = Object.entries(results).flatMap(([site, offers]) =>
		offers.map((offer) => ({ site, title: offer.title, url: offer.url, extra: offer.extra })),
	);

	await mkdir(dataPath, { recursive: true });
	await writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), stats, results }, null, 2));
	await writeFile(csvOutputPath, writeCsv(csvOffers), "utf8");

	for (const [site, siteStats] of Object.entries(stats)) console.log(`[Stats] ${site} : ${siteStats.offers} offre(s)`);
	console.log(`[Stats] JSON sauvegardé : ${outputPath}`);
	console.log(`[Stats] CSV sauvegardé : ${csvOutputPath} (${csvOffers.length} ligne(s))`);

	console.log(JSON.stringify(results, null, 2));
})();
