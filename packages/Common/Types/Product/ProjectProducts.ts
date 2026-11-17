import ProductKey, { PRODUCT_KEYS, parseProductKeys } from "./ProductKey";
import { JSONObject } from "../JSON";

/*
 * THE PRODUCTS A PROJECT SHOWS (#6814).
 *
 * OneUptime has 47 products, and a team that watches ten websites and runs a
 * status page uses four of them. A project can hide the ones it does not
 * use (Project Settings > Products), so its menu, Home and Search's list
 * show what it uses.
 *
 * Only a member hides a product. Every product is shown until someone who
 * may edit the project hides it on Project Settings > Products. Nothing
 * hides one by itself: not the project's goals (what it came to do, as
 * answered on Home), not a product that is not set up yet, not one nobody
 * has opened.
 *
 * Hidden is not off. A hidden product is left out of the products menu's
 * categories, the Recently visited row, Home's Explore and Your project
 * card, Search's list while browsing and the keyboard shortcuts list. It is
 * still under More products at the foot of the menu, Search still finds it,
 * its pages, addresses and API keep working, and its data keeps arriving.
 * A product a person pinned stays pinned (ProductPins.ts): the menu is the
 * same for every member, and a pin is that person's own.
 *
 * The list is kept on the project, in Project.productSettings, as this
 * file's ProjectProductSettings. Read it with parseProjectProductSettings,
 * never as it is stored:
 *
 *   null     nothing chosen: every product is shown.
 *   {...}    the products a member hid on Project Settings > Products.
 *
 * Choosing a project's goals used to hide every product they did not name,
 * in a list marked "goals" (LEGACY_GOALS_CHOSEN_BY). Nobody chose that
 * list, so it reads as nothing chosen: every product is shown again, and a
 * member's first change starts from every product shown.
 *
 * A server can switch products off for every project (#6815). That is a
 * layer on top of this one, stronger than the project's choice and than a
 * person's pins: see getProductPlacement.
 *
 * Pure: the server, the Dashboard and their tests read it.
 */

/*
 * The project's own settings, which can never be hidden: hiding Project
 * Settings would hide the page that shows it again.
 */
export const ALWAYS_SHOWN_PRODUCTS: ReadonlyArray<ProductKey> = [
  ProductKey.Users,
  ProductKey.Teams,
  ProductKey.ProjectSettings,
];

export const isHideableProduct: (product: ProductKey) => boolean = (
  product: ProductKey,
): boolean => {
  return !ALWAYS_SHOWN_PRODUCTS.includes(product);
};

// Every product a project may hide, in the menu's order.
export const HIDEABLE_PRODUCTS: ReadonlyArray<ProductKey> =
  PRODUCT_KEYS.filter(isHideableProduct);

export enum ProjectProductsChosenBy {
  // Changed by a member on Project Settings > Products: the only source.
  Member = "member",
}

/*
 * How a list the project's goals set used to be marked (#6814's first
 * version). Still found in projects that chose their goals then, and in
 * answers a browser remembered: read as nothing chosen, since nobody chose
 * it. Never written.
 */
export const LEGACY_GOALS_CHOSEN_BY: string = "goals";

export interface ProjectProductSettings {
  // The products the project hides, in the menu's order.
  hidden: Array<ProductKey>;
  /*
   * Hidden products somebody chose to keep hidden although they have data:
   * hidden on Project Settings > Products while in use, or "Keep hidden" on
   * Home's line. Home does not ask about them again.
   */
  keptHiddenWithData: Array<ProductKey>;
  chosenBy: ProjectProductsChosenBy;
  // When the list last changed, and who changed it (a member's id), if anyone.
  changedAt: string | null;
  changedByUserId: string | null;
}

const toKeptHidden: (
  kept: ReadonlyArray<ProductKey>,
  hidden: ReadonlyArray<ProductKey>,
) => Array<ProductKey> = (
  kept: ReadonlyArray<ProductKey>,
  hidden: ReadonlyArray<ProductKey>,
): Array<ProductKey> => {
  return PRODUCT_KEYS.filter((product: ProductKey): boolean => {
    return kept.includes(product) && hidden.includes(product);
  });
};

/*
 * The project's settings as stored, or null when nothing was chosen (every
 * product shown). Unknown products and products that can never be hidden
 * are left out, so a stored value never hides Project Settings. A list the
 * goals set (LEGACY_GOALS_CHOSEN_BY) is null too: nobody chose it.
 */
export const parseProjectProductSettings: (
  value: unknown,
) => ProjectProductSettings | null = (
  value: unknown,
): ProjectProductSettings | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;

  if (
    !Array.isArray(json["hidden"]) ||
    json["chosenBy"] === LEGACY_GOALS_CHOSEN_BY
  ) {
    return null;
  }

  const hidden: Array<ProductKey> = PRODUCT_KEYS.filter(
    (product: ProductKey): boolean => {
      return (
        isHideableProduct(product) &&
        parseProductKeys(json["hidden"]).includes(product)
      );
    },
  );

  return {
    hidden: hidden,
    keptHiddenWithData: toKeptHidden(
      parseProductKeys(json["keptHiddenWithData"]),
      hidden,
    ),
    // A member's, whatever it says: nothing else writes one.
    chosenBy: ProjectProductsChosenBy.Member,
    changedAt: typeof json["changedAt"] === "string" ? json["changedAt"] : null,
    changedByUserId:
      typeof json["changedByUserId"] === "string"
        ? json["changedByUserId"]
        : null,
  };
};

export const toProjectProductSettingsJSON: (
  settings: ProjectProductSettings,
) => JSONObject = (settings: ProjectProductSettings): JSONObject => {
  return {
    hidden: [...settings.hidden],
    keptHiddenWithData: [...settings.keptHiddenWithData],
    chosenBy: settings.chosenBy,
    changedAt: settings.changedAt,
    changedByUserId: settings.changedByUserId,
  };
};

// The products a project hides (none when nothing was chosen).
export const getHiddenProducts: (
  settings: ProjectProductSettings | null,
) => Array<ProductKey> = (
  settings: ProjectProductSettings | null,
): Array<ProductKey> => {
  return settings ? [...settings.hidden] : [];
};

export const isProductHidden: (
  settings: ProjectProductSettings | null,
  product: ProductKey,
) => boolean = (
  settings: ProjectProductSettings | null,
  product: ProductKey,
): boolean => {
  return getHiddenProducts(settings).includes(product);
};

/*
 * The settings after a member shows or hides one product: only that product
 * changes. Hiding a product that has data keeps it hidden on purpose (Home
 * does not ask about it); showing one forgets that. A product that can
 * never be hidden is left as it is.
 */
export const withProductShown: (data: {
  current: ProjectProductSettings | null;
  product: ProductKey;
  isShown: boolean;
  isInUse: boolean;
  userId: string;
  now: Date;
}) => ProjectProductSettings = (data: {
  current: ProjectProductSettings | null;
  product: ProductKey;
  isShown: boolean;
  isInUse: boolean;
  userId: string;
  now: Date;
}): ProjectProductSettings => {
  const hidden: Set<ProductKey> = new Set<ProductKey>(
    getHiddenProducts(data.current),
  );
  const kept: Set<ProductKey> = new Set<ProductKey>(
    data.current ? data.current.keptHiddenWithData : [],
  );

  if (isHideableProduct(data.product)) {
    if (data.isShown) {
      hidden.delete(data.product);
      kept.delete(data.product);
    } else {
      hidden.add(data.product);

      if (data.isInUse) {
        kept.add(data.product);
      }
    }
  }

  const hiddenList: Array<ProductKey> = PRODUCT_KEYS.filter(
    (product: ProductKey): boolean => {
      return hidden.has(product);
    },
  );

  return {
    hidden: hiddenList,
    keptHiddenWithData: toKeptHidden([...kept], hiddenList),
    chosenBy: ProjectProductsChosenBy.Member,
    changedAt: data.now.toISOString(),
    changedByUserId: data.userId,
  };
};

// Every product shown again, by a member.
export const withEveryProductShown: (data: {
  userId: string;
  now: Date;
}) => ProjectProductSettings = (data: {
  userId: string;
  now: Date;
}): ProjectProductSettings => {
  return {
    hidden: [],
    keptHiddenWithData: [],
    chosenBy: ProjectProductsChosenBy.Member,
    changedAt: data.now.toISOString(),
    changedByUserId: data.userId,
  };
};

/*
 * The hidden products Home asks an admin about: hidden, in use, and not
 * kept hidden on purpose ("Logs is hidden in this project and has data").
 */
export const getHiddenProductsWithData: (data: {
  settings: ProjectProductSettings | null;
  inUse: ReadonlyArray<ProductKey>;
}) => Array<ProductKey> = (data: {
  settings: ProjectProductSettings | null;
  inUse: ReadonlyArray<ProductKey>;
}): Array<ProductKey> => {
  if (!data.settings) {
    return [];
  }

  const settings: ProjectProductSettings = data.settings;

  return settings.hidden.filter((product: ProductKey): boolean => {
    return (
      data.inUse.includes(product) &&
      !settings.keptHiddenWithData.includes(product)
    );
  });
};

/*
 * Where a product is drawn for this project, in order of strength:
 *
 *   1. Off: switched off on the server (#6815). Never drawn, not even
 *      pinned or under More products; #6815 also blocks its pages and API.
 *   2. Hidden: a member hid it on Project Settings > Products. Under More
 *      products, found by Search, still pinned by whoever pinned it - the
 *      same menu for every member.
 *   3. Listed: in its category, on Home and in Search's list. Every other
 *      product, whether it is in use, not set up yet or never opened.
 */
export enum ProductPlacement {
  Listed = "listed",
  Hidden = "hidden",
  Off = "off",
}

export const getProductPlacement: (data: {
  product: ProductKey;
  hidden: ReadonlyArray<ProductKey>;
  offOnServer?: ReadonlyArray<ProductKey> | undefined;
}) => ProductPlacement = (data: {
  product: ProductKey;
  hidden: ReadonlyArray<ProductKey>;
  offOnServer?: ReadonlyArray<ProductKey> | undefined;
}): ProductPlacement => {
  if ((data.offOnServer || []).includes(data.product)) {
    return ProductPlacement.Off;
  }

  if (isHideableProduct(data.product) && data.hidden.includes(data.product)) {
    return ProductPlacement.Hidden;
  }

  return ProductPlacement.Listed;
};
