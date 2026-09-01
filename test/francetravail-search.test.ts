import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
	applyFranceTravailSearchFilters,
	buildFranceTravailSearchPlan,
} from "../src/scrappers/francetravail/search.ts";

test("prépare une recherche France Travail triée par date sur un jour", () => {
	const plan = buildFranceTravailSearchPlan(
		"https://candidat.francetravail.fr/offres/emploi/trappes/v236",
	);

	assert.equal(plan.url, "https://candidat.francetravail.fr/offres/emploi/trappes/v236");
	assert.deepEqual(plan.sort, "Date");
	assert.deepEqual(plan.createdWithinDays, 1);
});

test("applique le tri par date puis le filtre de création sur un jour", async () => {
	const calls: string[] = [];
	const page = {
		goto: async (url: string) => calls.push(`goto:${url}`),
		getByRole: (role: string, options: { name: string | RegExp; exact?: boolean }) => ({
			click: async () => calls.push(`${role}:${String(options.name)}`),
		}),
		locator: (selector: string) => ({
			click: async () => calls.push(`locator:${selector}`),
		}),
	};

	await applyFranceTravailSearchFilters(
		page,
		"https://candidat.francetravail.fr/offres/emploi/trappes/v236",
	);

	assert.deepEqual(calls, [
		"goto:https://candidat.francetravail.fr/offres/emploi/trappes/v236",
		"button:/Trier par/",
		"menuitem:Date",
		"button:/Afficher les filtres de Date de création/",
		'locator:input[name="emissionRadioGroup"][value="1"]',
		"button:/Appliquer le filtre de date/",
	]);
});
