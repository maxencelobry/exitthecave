import { LinkedinScrapper } from "./scrapers/linkedin.js";

const offers = await new LinkedinScrapper().scrap();
console.log(`[LinkedIn] Collecte terminée : ${offers.length} offre(s)`);
