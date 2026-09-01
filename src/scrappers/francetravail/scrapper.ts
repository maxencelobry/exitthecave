import {
	applyFranceTravailSearchFilters,
	buildFranceTravailSearchPlan,
	type SearchPage,
} from "./search.js";

export class FranceTravailScrapper {
	private readonly plan;
	private results: unknown[] = [];

	constructor(
		private readonly searchUrl = "https://candidat.francetravail.fr/offres/emploi/trappes/v236",
	) {
		this.plan = buildFranceTravailSearchPlan(searchUrl);
	}

	async scrap(page?: SearchPage): Promise<void> {
		if (page) {
			await applyFranceTravailSearchFilters(page, this.plan.url);
		}
	}

	getResults(): unknown[] {
		return this.results;
	}
}
