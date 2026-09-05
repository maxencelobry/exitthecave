import { LinkedinScrapper } from "./scrappers/linkedin/scrapper.js";

const offers = await new LinkedinScrapper().scrap();
console.log(`[LinkedIn] Collecte terminée : ${offers.length} offre(s)`);
