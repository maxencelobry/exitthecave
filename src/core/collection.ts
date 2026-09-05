import { AsyncLocalStorage } from "node:async_hooks";

export type SourceReport = {
    state: "running" | "completed" | "partial" | "login_required" | "error" | "disabled";
    reason: string;
    pages: number;
    collected: number;
    newOffers?: number;
};
const context = new AsyncLocalStorage<{ report: SourceReport; changed: () => void }>();

export function reportResume(): void {
    const current = context.getStore();
    if (!current) return;
    current.report.state = "running";
    current.report.reason = "Connexion établie, collecte en cours.";
    current.changed();
}

export function reportStop(reason: string, complete = false): void {
    const current = context.getStore();
    if (!current) return;
    if (current.report.state === "error" || current.report.state === "login_required") return;
    if (complete && current.report.state === "partial") return;
    current.report.state = complete ? "completed" : "partial";
    current.report.reason = reason;
    current.changed();
}

export function reportProgress(pages: number, collected: number): void {
    const current = context.getStore();
    if (!current) return;
    current.report.pages = Math.max(current.report.pages, pages);
    current.report.collected = Math.max(current.report.collected, collected);
    current.changed();
}

export function reportError(message: string): void {
    const current = context.getStore();
    if (!current) return;
    current.report.state = /connexion|identifiants|authentification/i.test(message) ? "login_required" : "error";
    current.report.reason = message;
    current.changed();
}

export async function runSource<T>(report: SourceReport, changed: () => void, collect: () => Promise<T[]>): Promise<T[]> {
    return context.run({ report, changed }, async () => {
        try {
            const offers = await collect();
            report.collected = offers.length;
            if (report.state === "running") {
                report.state = "partial";
                report.reason = "Parcours arrêté sans confirmation de fin.";
            } else if (report.state === "error" && offers.length) report.state = "partial";
            changed();
            return offers;
        } catch (error) {
            console.error("[Collecte] Échec du collecteur :", error);
            reportError("Le collecteur a échoué. Consulter le journal local.");
            return [];
        }
    });
}
