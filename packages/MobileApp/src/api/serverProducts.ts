import type { AxiosResponse } from "axios";
import apiClient from "./client";

/*
 * THE PRODUCTS THE SERVER HAS SWITCHED OFF (#7478).
 *
 * A self-hosted server's admin can switch whole products off for every
 * project (Admin Dashboard > Settings > Products). The web then leaves them
 * out of every menu, Home and the bell, and the server refuses to change
 * their records. The app leaves them out too: no Monitors or On-Call tab, no
 * Incidents, Alerts or Security in the Inbox, and nothing of them on Home,
 * while their product is off.
 *
 * The list is the server's, the same in every project, and rides in each
 * project's products answer (GET /api/project-products, `offOnServer`: a
 * product's key -> why it is off). The keys are the server's
 * (Common/Types/Product/ProductKey); the app reads only those it draws.
 * Anything it cannot read - an older server with no such answer, a refusal,
 * a network failure - is "nothing off": switching a product off is about
 * what people see, never a lock, and the app must not hide a working
 * product for want of an answer.
 */

// The products the app has a tab, an Inbox category or a Home section for.
export enum AppProduct {
  Monitors = "monitors",
  Incidents = "incidents",
  Alerts = "alerts",
  OnCall = "on-call",
  SecurityEvents = "security-events",
}

export const APP_PRODUCTS: ReadonlyArray<AppProduct> = [
  AppProduct.Monitors,
  AppProduct.Incidents,
  AppProduct.Alerts,
  AppProduct.OnCall,
  AppProduct.SecurityEvents,
];

// Why the server says a product is off (Types/Product/ServerProducts).
const OFF_REASONS: ReadonlyArray<string> = [
  "switched-off",
  "telemetry-ingestion-stopped",
];

export const PROJECT_PRODUCTS_PATH: string = "/api/project-products";

// The app's products a products answer says are off, from its offOnServer.
export function readProductsOffOnServer(data: unknown): Set<AppProduct> {
  const off: Set<AppProduct> = new Set<AppProduct>();

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return off;
  }

  const offOnServer: unknown = (data as Record<string, unknown>)["offOnServer"];

  if (
    !offOnServer ||
    typeof offOnServer !== "object" ||
    Array.isArray(offOnServer)
  ) {
    return off;
  }

  for (const product of APP_PRODUCTS) {
    const reason: unknown = (offOnServer as Record<string, unknown>)[product];

    if (typeof reason === "string" && OFF_REASONS.includes(reason)) {
      off.add(product);
    }
  }

  return off;
}

// What the server has switched off, as one of the person's projects says it.
export async function fetchProductsOffOnServer(
  projectId: string,
): Promise<Set<AppProduct>> {
  const response: AxiosResponse = await apiClient.get(PROJECT_PRODUCTS_PATH, {
    headers: { tenantid: projectId },
  });

  return readProductsOffOnServer(response.data);
}
