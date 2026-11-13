import { JSONObject } from "../JSON";
import ProductKey, { PRODUCT_KEYS, parseProductKeys } from "./ProductKey";
import { parseServerProductsOff } from "./ProjectProductsAnswer";
import {
  ServerProductsOff,
  ServerProductsPreset,
  isServerProductsPreset,
  isSwitchableProduct,
} from "./ServerProducts";

/*
 * WHAT ADMIN DASHBOARD > SETTINGS > PRODUCTS READS AND CHANGES (#6815).
 *
 *   GET  /global-config/server-products   the answer below. A master admin,
 *                                         or the server's master API key
 *                                         (read-only: `npm run doctor`).
 *   POST /global-config/server-products   { preset } - one click: the
 *                                         products a preset keeps on;
 *                                         { product, isOn } - one switch.
 *                                         A master admin. Answers the new
 *                                         answer.
 *
 * Server/Utils/ServerProducts works it out, Types/Product/ServerProducts
 * holds the rules.
 */

export const SERVER_PRODUCTS_ROUTE: string = "/global-config/server-products";

// Where the switches' positions come from.
export enum ServerProductsSource {
  // A master admin saved the page.
  Saved = "saved",
  // Nobody has: SERVER_PRODUCTS, or every product on when it is unset.
  StartingValue = "starting-value",
}

export interface ServerProductsAnswer {
  // What is off on the server, and why (switched off, or ingestion stopped).
  off: ServerProductsOff;
  // The products the switches leave off, in the menu's order.
  switchedOff: Array<ProductKey>;
  // The preset the switches match exactly, or null for a choice of one's own.
  preset: ServerProductsPreset | null;
  source: ServerProductsSource;
  // SERVER_PRODUCTS as config.env or Helm set it, or "" when unset.
  startingValue: string;
  // Names SERVER_PRODUCTS held that are neither a preset nor a product.
  startingValueUnknownNames: Array<string>;
  // DISABLE_TELEMETRY_INGESTION is set.
  isTelemetryIngestionStopped: boolean;
  /*
   * Every telemetry product is switched off while ingestion still runs: "You
   * can also stop telemetry ingestion to save memory".
   */
  shouldSuggestStoppingIngestion: boolean;
  // When an admin last saved the page, if one did.
  changedAt: string | null;
}

export const parseServerProductsAnswer: (
  value: unknown,
) => ServerProductsAnswer | null = (
  value: unknown,
): ServerProductsAnswer | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;
  const switchedOff: Array<ProductKey> = parseProductKeys(json["switchedOff"]);

  return {
    off: parseServerProductsOff(json["off"]),
    switchedOff: PRODUCT_KEYS.filter((product: ProductKey): boolean => {
      return isSwitchableProduct(product) && switchedOff.includes(product);
    }),
    preset: isServerProductsPreset(json["preset"]) ? json["preset"] : null,
    source:
      json["source"] === ServerProductsSource.Saved
        ? ServerProductsSource.Saved
        : ServerProductsSource.StartingValue,
    startingValue:
      typeof json["startingValue"] === "string" ? json["startingValue"] : "",
    startingValueUnknownNames: Array.isArray(json["startingValueUnknownNames"])
      ? (json["startingValueUnknownNames"] as Array<unknown>).filter(
          (name: unknown): name is string => {
            return typeof name === "string";
          },
        )
      : [],
    isTelemetryIngestionStopped: json["isTelemetryIngestionStopped"] === true,
    shouldSuggestStoppingIngestion:
      json["shouldSuggestStoppingIngestion"] === true,
    changedAt: typeof json["changedAt"] === "string" ? json["changedAt"] : null,
  };
};

export const toServerProductsAnswerJSON: (
  answer: ServerProductsAnswer,
) => JSONObject = (answer: ServerProductsAnswer): JSONObject => {
  const off: JSONObject = {};

  for (const product of PRODUCT_KEYS) {
    const reason: string | undefined = answer.off[product];

    if (reason) {
      off[product] = reason;
    }
  }

  return {
    off: off,
    switchedOff: [...answer.switchedOff],
    preset: answer.preset,
    source: answer.source,
    startingValue: answer.startingValue,
    startingValueUnknownNames: [...answer.startingValueUnknownNames],
    isTelemetryIngestionStopped: answer.isTelemetryIngestionStopped,
    shouldSuggestStoppingIngestion: answer.shouldSuggestStoppingIngestion,
    changedAt: answer.changedAt,
  };
};
