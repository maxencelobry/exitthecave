export interface FranceTravailSearchPlan {
	url: string;
	sort: "Date";
	createdWithinDays: 1;
}

interface Clickable {
	click(): Promise<void>;
}

export interface SearchPage {
	goto(url: string): Promise<void>;
	getByRole(role: string, options: { name: string | RegExp; exact?: boolean }): Clickable;
	locator(selector: string): Clickable;
}

export function buildFranceTravailSearchPlan(url: string): FranceTravailSearchPlan {
	return {
		url,
		sort: "Date",
		createdWithinDays: 1,
	};
}

export async function applyFranceTravailSearchFilters(
	page: SearchPage,
	url: string,
): Promise<void> {
	await page.goto(url);
	await page.getByRole("button", { name: /Trier par/ }).click();
	await page.getByRole("menuitem", { name: "Date", exact: true }).click();
	await page
		.getByRole("button", { name: /Afficher les filtres de Date de création/ })
		.click();
	await page.locator('input[name="emissionRadioGroup"][value="1"]').click();
	await page
		.getByRole("button", { name: /Appliquer le filtre de date/ })
		.click();
}
