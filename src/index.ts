import { FranceTravailScrapper } from "./scrappers/francetravail/scrapper.js";

(async() => {
	const scrapper = new FranceTravailScrapper();

	await scrapper.scrap();

	console.log(scrapper.getResults());
})();