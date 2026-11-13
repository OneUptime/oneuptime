import { PlanType } from "../Billing/SubscriptionPlan";
import { JSONObject } from "../JSON";
import ProductKey, { PRODUCT_KEYS, parseProductKeys } from "./ProductKey";
import { parsePinnedProducts } from "./ProductPins";
import { ProductUsage, isProductUsage } from "./ProductUsage";
import { ProjectProductsChosenBy, isHideableProduct } from "./ProjectProducts";
import {
  ServerProductsOff,
  isServerProductOffReason,
  isSwitchableProduct,
} from "./ServerProducts";

/*
 * THE ONE ANSWER THE DASHBOARD READS ABOUT A PROJECT'S PRODUCTS (#6814):
 * GET /api/project-products, for the project in the `tenantid` header and
 * the person asking. Read once per page load and kept (the Dashboard's
 * ProjectProducts store), it holds what the products menu, Home, Search and
 * Project Settings > Products draw:
 *
 *   - the products the project hides (ProjectProducts.ts);
 *   - the products this person pinned (ProductPins.ts);
 *   - what is in use (ProductUsage.ts), for the products this person may
 *     read;
 *   - the plan each product needs, where the project's plan cannot use it
 *     (OneUptime Cloud: "Growth Plan" beside Workflows on the Free plan);
 *   - whether this person may choose the project's products, and if so the
 *     hidden products that have data (Home's "Logs is hidden in this
 *     project and has data");
 *   - the products switched off on the whole server, and why (#6815,
 *     Types/Product/ServerProducts): stronger than anything the project or
 *     the person chose, so every place that lists products leaves them out,
 *     and their pages say they are off.
 *
 * The routes below change it, and each answers with the new answer:
 *
 *   POST /project-products/visibility  { product, isShown } - show or hide
 *                                      one product; { showAll: true } -
 *                                      show every product. An Owner, an
 *                                      Admin, or anyone with Edit Project.
 *   POST /project-products/pins        { pinned: [...] } - this person's
 *                                      pins, in order, at most five.
 *
 * Server/API/ProjectProductsAPI.ts serves them; Server/Services/
 * ProjectProductsService.ts works the answer out.
 */

export const PROJECT_PRODUCTS_ROUTE: string = "/project-products";
export const PROJECT_PRODUCTS_VISIBILITY_ROUTE: string =
  "/project-products/visibility";
export const PROJECT_PRODUCTS_PINS_ROUTE: string = "/project-products/pins";

export interface ProjectProductsAnswer {
  // The products the project hides, in the menu's order.
  hidden: Array<ProductKey>;
  /*
   * Where the project's list came from: its goals, a member, or null when
   * nothing was chosen (every product shown).
   */
  chosenBy: ProjectProductsChosenBy | null;
  // The products this person pinned, in the order they were pinned.
  pinned: Array<ProductKey>;
  /*
   * What is in use, for the products whose use is known and this person
   * may read. A product left out has no mark.
   */
  usage: Partial<Record<ProductKey, ProductUsage>>;
  /*
   * The plan each product needs, for the products the project's plan cannot
   * use. Empty without billing.
   */
  neededPlans: Partial<Record<ProductKey, PlanType>>;
  // This person may show and hide the project's products.
  canChooseProducts: boolean;
  /*
   * The hidden products that have data, which nobody chose to keep hidden.
   * Empty for anyone who may not choose the project's products.
   */
  hiddenWithData: Array<ProductKey>;
  /*
   * The products switched off on this server, and why (#6815): product ->
   * reason, absent when on. The same for every project and every person.
   */
  offOnServer: ServerProductsOff;
}

// What the Dashboard draws before (or without) an answer: every product shown.
export const getEmptyProjectProductsAnswer: () => ProjectProductsAnswer =
  (): ProjectProductsAnswer => {
    return {
      hidden: [],
      chosenBy: null,
      pinned: [],
      usage: {},
      neededPlans: {},
      canChooseProducts: false,
      hiddenWithData: [],
      offOnServer: {},
    };
  };

const parseHidden: (value: unknown) => Array<ProductKey> = (
  value: unknown,
): Array<ProductKey> => {
  const keys: Array<ProductKey> = parseProductKeys(value);

  return PRODUCT_KEYS.filter((product: ProductKey): boolean => {
    return isHideableProduct(product) && keys.includes(product);
  });
};

const parseUsage: (
  value: unknown,
) => Partial<Record<ProductKey, ProductUsage>> = (
  value: unknown,
): Partial<Record<ProductKey, ProductUsage>> => {
  const usage: Partial<Record<ProductKey, ProductUsage>> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return usage;
  }

  for (const product of PRODUCT_KEYS) {
    const state: unknown = (value as JSONObject)[product];

    if (isProductUsage(state)) {
      usage[product] = state;
    }
  }

  return usage;
};

const PLAN_TYPES: ReadonlyArray<string> = Object.values(PlanType);

/*
 * What is off on the server, as sent: known products a server can switch
 * off, each with a known reason; anything else is left out (on).
 */
export const parseServerProductsOff: (value: unknown) => ServerProductsOff = (
  value: unknown,
): ServerProductsOff => {
  const off: ServerProductsOff = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return off;
  }

  for (const product of PRODUCT_KEYS) {
    const reason: unknown = (value as JSONObject)[product];

    if (isSwitchableProduct(product) && isServerProductOffReason(reason)) {
      off[product] = reason;
    }
  }

  return off;
};

const parseNeededPlans: (
  value: unknown,
) => Partial<Record<ProductKey, PlanType>> = (
  value: unknown,
): Partial<Record<ProductKey, PlanType>> => {
  const plans: Partial<Record<ProductKey, PlanType>> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return plans;
  }

  for (const product of PRODUCT_KEYS) {
    const plan: unknown = (value as JSONObject)[product];

    if (typeof plan === "string" && PLAN_TYPES.includes(plan)) {
      plans[product] = plan as PlanType;
    }
  }

  return plans;
};

/*
 * An answer as sent or stored, read safely: anything unknown is left out,
 * and a value that is not an answer at all reads as null.
 */
export const parseProjectProductsAnswer: (
  value: unknown,
) => ProjectProductsAnswer | null = (
  value: unknown,
): ProjectProductsAnswer | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;
  const hidden: Array<ProductKey> = parseHidden(json["hidden"]);
  const chosenBy: unknown = json["chosenBy"];

  return {
    hidden: hidden,
    chosenBy:
      chosenBy === ProjectProductsChosenBy.Goals ||
      chosenBy === ProjectProductsChosenBy.Member
        ? chosenBy
        : null,
    pinned: parsePinnedProducts(json["pinned"]),
    usage: parseUsage(json["usage"]),
    neededPlans: parseNeededPlans(json["neededPlans"]),
    canChooseProducts: json["canChooseProducts"] === true,
    hiddenWithData: parseProductKeys(json["hiddenWithData"]).filter(
      (product: ProductKey): boolean => {
        return hidden.includes(product);
      },
    ),
    offOnServer: parseServerProductsOff(json["offOnServer"]),
  };
};

export const toProjectProductsAnswerJSON: (
  answer: ProjectProductsAnswer,
) => JSONObject = (answer: ProjectProductsAnswer): JSONObject => {
  const usage: JSONObject = {};

  for (const product of PRODUCT_KEYS) {
    const state: ProductUsage | undefined = answer.usage[product];

    if (state) {
      usage[product] = state;
    }
  }

  const neededPlans: JSONObject = {};

  for (const product of PRODUCT_KEYS) {
    const plan: PlanType | undefined = answer.neededPlans[product];

    if (plan) {
      neededPlans[product] = plan;
    }
  }

  const offOnServer: JSONObject = {};

  for (const product of PRODUCT_KEYS) {
    const reason: string | undefined = answer.offOnServer[product];

    if (reason) {
      offOnServer[product] = reason;
    }
  }

  return {
    hidden: [...answer.hidden],
    chosenBy: answer.chosenBy,
    pinned: [...answer.pinned],
    usage: usage,
    neededPlans: neededPlans,
    canChooseProducts: answer.canChooseProducts,
    hiddenWithData: [...answer.hiddenWithData],
    offOnServer: offOnServer,
  };
};
