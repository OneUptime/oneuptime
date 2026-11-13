import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF A PRODUCT SWITCHED OFF ON THE SERVER (issue #6815): the page
 * an address of it opens (ServerProductOffPage), and its row on Project
 * Settings > Products.
 *
 * Each says what happened and what to do next - who can switch it on, and
 * where - and that nothing was deleted (Docs/ux/README.md#errors). Kept free
 * of React so the components and the tests read these exact strings. Every
 * sentence is wrapped in translationKey() so npm run i18n:extract finds it.
 */

export const ServerProductOffCopy: {
  switchedOffTitle: string;
  switchedOffDescription: string;
  neededBySetupDescription: string;
  ingestionStoppedTitle: string;
  ingestionStoppedDescription: string;
  askAdmin: string;
  askAdminForIngestion: string;
  openSettings: string;
  goHome: string;
  rowSwitchedOff: string;
  rowIngestionStopped: string;
  rowSwitchedOffReason: string;
  rowIngestionStoppedReason: string;
} = {
  switchedOffTitle: translationKey(
    "{{product}} is switched off on this server",
  ),
  switchedOffDescription: translationKey(
    "A server admin switched {{product}} off for every project on this server. Nothing was deleted: it comes back as it was when it is switched on again.",
  ),
  neededBySetupDescription: translationKey(
    "This page also uses {{product}}, which a server admin switched off for every project on this server. Nothing was deleted.",
  ),
  ingestionStoppedTitle: translationKey("{{product}} is off on this server"),
  ingestionStoppedDescription: translationKey(
    "Telemetry ingestion is stopped on this server, so no new logs, metrics, traces or profiles arrive. Nothing was deleted.",
  ),
  askAdmin: translationKey(
    "Ask a server admin to switch it on in Admin Dashboard > Settings > Products.",
  ),
  askAdminForIngestion: translationKey(
    "A server admin can start it again: set DISABLE_TELEMETRY_INGESTION to false and restart OneUptime.",
  ),
  openSettings: translationKey("Open Admin Dashboard > Settings > Products"),
  goHome: translationKey("Go to Home"),
  rowSwitchedOff: translationKey("Switched off on this server"),
  rowIngestionStopped: translationKey("Off: telemetry ingestion is stopped"),
  rowSwitchedOffReason: translationKey(
    "A server admin switched this off for every project. They can switch it on in Admin Dashboard > Settings > Products.",
  ),
  rowIngestionStoppedReason: translationKey(
    "Telemetry ingestion is stopped on this server (DISABLE_TELEMETRY_INGESTION), so nothing new reaches it.",
  ),
};

// Where a master admin switches products on, in the Admin Dashboard.
export const ADMIN_SERVER_PRODUCTS_PATH: string = "/settings/products";

// The data-testids, for the components and their suites.
export const SERVER_PRODUCT_OFF_PAGE_TEST_ID: string = "server-product-off";
export const SERVER_PRODUCT_OFF_OPEN_SETTINGS_TEST_ID: string =
  "server-product-off-open-settings";
export const SERVER_PRODUCT_OFF_GO_HOME_TEST_ID: string =
  "server-product-off-go-home";
