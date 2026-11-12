import { PluralTemplate } from "Common/Types/Translator";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ServerProductsPreset } from "Common/Types/Product/ServerProducts";

/*
 * THE WORDS OF ADMIN DASHBOARD > SETTINGS > PRODUCTS (issue #6815).
 *
 * Kept free of React so the page and its tests read these exact strings.
 * Each is a key of the Admin Dashboard's locales, in every language
 * (Tests/App/AdminDashboard/AdminServerProductsLocales).
 */

export const ServerProductsCopy: {
  cardTitle: string;
  cardDescription: string;
  presetsLabel: string;
  current: string;
  apply: string;
  ownChoice: PluralTemplate;
  presetProductCount: PluralTemplate;
  whatOffMeansTitle: string;
  nothingDeleted: string;
  keepsRunning: string;
  apiRefuses: string;
  startingValue: string;
  startingValueUnknown: string;
  ingestionStopped: string;
  suggestStoppingIngestion: string;
  oneByOneTitle: string;
  oneByOneDescription: PluralTemplate;
  showProducts: string;
  hideProducts: string;
  offWhileIngestionStopped: string;
  alwaysOnTitle: string;
  alwaysOn: string;
  saved: string;
  loadError: string;
} = {
  cardTitle: translationKey("Products on this server"),
  cardDescription: translationKey(
    "Choose what every project on this server offers. A product that is off is gone from every project's menu, Home and Search, and its pages say it is switched off.",
  ),
  presetsLabel: translationKey("Start from"),
  current: translationKey("Current"),
  apply: translationKey("Use this"),
  ownChoice: {
    one: "Your own choice: {{on}} of {{count}} product is on.",
    other: "Your own choice: {{on}} of {{count}} products are on.",
  },
  presetProductCount: {
    one: "{{count}} product",
    other: "{{count}} products",
  },
  whatOffMeansTitle: translationKey("What switching off does"),
  nothingDeleted: translationKey(
    "Nothing is deleted. A product switched on again comes back as it was.",
  ),
  keepsRunning: translationKey(
    "What already runs keeps running: monitors keep checking, published status pages stay up, and telemetry keeps arriving unless you also stop ingestion.",
  ),
  apiRefuses: translationKey(
    "The API refuses to create, change or delete its records, and Ask AI leaves it out.",
  ),
  startingValue: translationKey(
    "Set by SERVER_PRODUCTS={{value}} in this server's configuration, until you change it here.",
  ),
  startingValueUnknown: translationKey(
    "SERVER_PRODUCTS names {{names}}, which is neither a preset nor a product, so it was left out.",
  ),
  ingestionStopped: translationKey(
    "Telemetry ingestion is stopped on this server (DISABLE_TELEMETRY_INGESTION), so Logs, Metrics, Traces, Profiles and Exceptions are off. To switch them on, set it to false and restart OneUptime.",
  ),
  suggestStoppingIngestion: translationKey(
    "Every telemetry product is off. You can also stop telemetry ingestion to save memory: set DISABLE_TELEMETRY_INGESTION=true (Helm: telemetry.disableIngestion) and restart OneUptime.",
  ),
  oneByOneTitle: translationKey("Choose products one by one"),
  oneByOneDescription: {
    one: "{{on}} of {{count}} product is on. Each switch saves the moment it is flipped.",
    other:
      "{{on}} of {{count}} products are on. Each switch saves the moment it is flipped.",
  },
  showProducts: translationKey("Show Products"),
  hideProducts: translationKey("Hide Products"),
  offWhileIngestionStopped: translationKey(
    "Off while telemetry ingestion is stopped.",
  ),
  alwaysOnTitle: translationKey("Users, Teams and Project Settings"),
  alwaysOn: translationKey(
    "Always on: every project needs them to run itself.",
  ),
  saved: translationKey("Saved"),
  loadError: translationKey(
    "The products on this server could not be read. Reload the page to try again.",
  ),
};

export const PRESET_DESCRIPTIONS: Readonly<
  Record<ServerProductsPreset, string>
> = {
  [ServerProductsPreset.MonitoringAndStatusPages]: translationKey(
    "Monitors, incidents, on-call, status pages and scheduled maintenance: watch your websites and tell your customers.",
  ),
  [ServerProductsPreset.IncidentResponse]: translationKey(
    "Adds alerts, SLOs, workflows and runbooks, for a team that answers incidents.",
  ),
  [ServerProductsPreset.Everything]: translationKey(
    "Every product, as a new server starts.",
  ),
};

// The data-testids, for the page and its suites.
export const SERVER_PRODUCTS_PAGE_TEST_ID: string = "server-products";
export const getPresetTestId: (preset: string) => string = (
  preset: string,
): string => {
  return `server-products-preset-${preset}`;
};
export const getServerProductSwitchTestId: (product: string) => string = (
  product: string,
): string => {
  return `server-product-switch-${product}`;
};
export const SERVER_PRODUCTS_ONE_BY_ONE_TOGGLE_TEST_ID: string =
  "server-products-one-by-one";
export const SERVER_PRODUCTS_INGESTION_STOPPED_TEST_ID: string =
  "server-products-ingestion-stopped";
export const SERVER_PRODUCTS_SUGGEST_STOPPING_TEST_ID: string =
  "server-products-suggest-stopping-ingestion";
export const SERVER_PRODUCTS_STARTING_VALUE_TEST_ID: string =
  "server-products-starting-value";
export const SERVER_PRODUCTS_OWN_CHOICE_TEST_ID: string =
  "server-products-own-choice";
