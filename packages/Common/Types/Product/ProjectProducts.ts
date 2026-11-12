import ProductKey, { PRODUCT_KEYS, parseProductKeys } from "./ProductKey";
import ProjectGoal, {
  parseProjectGoals,
} from "../WelcomeChecklist/ProjectGoal";
import { JSONObject } from "../JSON";

/*
 * THE PRODUCTS A PROJECT SHOWS (#6814).
 *
 * OneUptime has 47 products, and a team that watches ten websites and runs a
 * status page uses four of them. A project can hide the ones it does not
 * use (Project Settings > Products), so its menu, Home and Search's list
 * show what it uses.
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
 *   null     nothing chosen: every product is shown. Every project from
 *            before this, and a new project until its goals are chosen.
 *   {...}    the products it hides, and where the list came from:
 *            - "goals": set when the project's goals were chosen (#6803):
 *              Essentials, Settings, what the goals need and anything
 *              already in use are shown, the rest hidden. Chosen again when
 *              the goals change, while it is still "goals".
 *            - "member": somebody changed it on Project Settings > Products.
 *              The goals never change it again.
 *
 * A server can switch products off for every project (#6815). That is a
 * layer on top of this one, stronger than the project's choice and than a
 * person's pins: see getProductPlacement.
 *
 * Pure: the server, the Dashboard and their tests read it.
 */

// The products a problem flows through, shown in every project's menu by default.
export const ESSENTIAL_PRODUCTS: ReadonlyArray<ProductKey> = [
  ProductKey.Monitors,
  ProductKey.Incidents,
  ProductKey.Alerts,
  ProductKey.OnCall,
  ProductKey.StatusPages,
  ProductKey.ScheduledMaintenance,
  ProductKey.Slos,
];

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

/*
 * What each goal needs beyond Essentials (#6803's question "What do you want
 * to do first?"). Uptime, on-call and status pages are Essentials already.
 * Telemetry is what "See my logs, metrics and traces" opens on, and what a
 * team that sends it looks at next; infrastructure is the platforms most
 * people watch first, with the metrics and dashboards they report into.
 * Everything else is one click away under More products, and comes back by
 * itself once it has data (getProductsHiddenByGoals never hides what is in
 * use).
 */
export const PRODUCTS_OF_GOAL: Readonly<
  Record<ProjectGoal, ReadonlyArray<ProductKey>>
> = {
  [ProjectGoal.Uptime]: [],
  [ProjectGoal.OnCall]: [],
  [ProjectGoal.StatusPage]: [],
  [ProjectGoal.Telemetry]: [
    ProductKey.Logs,
    ProductKey.Metrics,
    ProductKey.Traces,
    ProductKey.Exceptions,
    ProductKey.Services,
    ProductKey.Dashboards,
  ],
  [ProjectGoal.Infrastructure]: [
    ProductKey.Metrics,
    ProductKey.Hosts,
    ProductKey.Kubernetes,
    ProductKey.Docker,
    ProductKey.Cloud,
    ProductKey.Dashboards,
  ],
  // What an import brings is in use once it lands, so it is never hidden.
  [ProjectGoal.Import]: [],
  // Explore hides nothing: see GOALS_THAT_SHOW_EVERYTHING.
  [ProjectGoal.Explore]: [],
};

// A project "just looking around" sees everything.
export const GOALS_THAT_SHOW_EVERYTHING: ReadonlyArray<ProjectGoal> = [
  ProjectGoal.Explore,
];

export enum ProjectProductsChosenBy {
  // Worked out from the project's goals when they were chosen.
  Goals = "goals",
  // Changed by a member on Project Settings > Products.
  Member = "member",
}

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

const isChosenBy: (value: unknown) => value is ProjectProductsChosenBy = (
  value: unknown,
): value is ProjectProductsChosenBy => {
  return (
    value === ProjectProductsChosenBy.Goals ||
    value === ProjectProductsChosenBy.Member
  );
};

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
 * are left out, so a stored value never hides Project Settings.
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

  if (!Array.isArray(json["hidden"])) {
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
    chosenBy: isChosenBy(json["chosenBy"])
      ? json["chosenBy"]
      : ProjectProductsChosenBy.Member,
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
 * The products a project's goals leave hidden: everything but Essentials,
 * Settings, what the goals need and what the project already uses. None
 * while the goals are unanswered (null), skipped ([]) or "just looking
 * around" - those projects see the whole menu, as before.
 */
export const getProductsHiddenByGoals: (data: {
  goals: ReadonlyArray<ProjectGoal> | null;
  inUse: ReadonlyArray<ProductKey>;
}) => Array<ProductKey> = (data: {
  goals: ReadonlyArray<ProjectGoal> | null;
  inUse: ReadonlyArray<ProductKey>;
}): Array<ProductKey> => {
  const goals: Array<ProjectGoal> =
    parseProjectGoals(data.goals ? [...data.goals] : null) || [];

  if (
    goals.length === 0 ||
    goals.some((goal: ProjectGoal): boolean => {
      return GOALS_THAT_SHOW_EVERYTHING.includes(goal);
    })
  ) {
    return [];
  }

  const shown: Set<ProductKey> = new Set<ProductKey>([
    ...ESSENTIAL_PRODUCTS,
    ...data.inUse,
  ]);

  for (const goal of goals) {
    for (const product of PRODUCTS_OF_GOAL[goal]) {
      shown.add(product);
    }
  }

  return HIDEABLE_PRODUCTS.filter((product: ProductKey): boolean => {
    return !shown.has(product);
  });
};

/*
 * The settings a project's goals give it, or null when it should be left
 * alone: a member already chose its products, which the goals never undo.
 * A project whose goals hide nothing keeps settings that say so, still
 * "goals", so a later change of goals can hide what the new ones do not
 * need.
 */
export const getProjectProductSettingsFromGoals: (data: {
  current: ProjectProductSettings | null;
  goals: ReadonlyArray<ProjectGoal> | null;
  inUse: ReadonlyArray<ProductKey>;
  now: Date;
}) => ProjectProductSettings | null = (data: {
  current: ProjectProductSettings | null;
  goals: ReadonlyArray<ProjectGoal> | null;
  inUse: ReadonlyArray<ProductKey>;
  now: Date;
}): ProjectProductSettings | null => {
  if (
    data.current &&
    data.current.chosenBy === ProjectProductsChosenBy.Member
  ) {
    return null;
  }

  return {
    hidden: getProductsHiddenByGoals({ goals: data.goals, inUse: data.inUse }),
    keptHiddenWithData: [],
    chosenBy: ProjectProductsChosenBy.Goals,
    changedAt: data.now.toISOString(),
    changedByUserId: null,
  };
};

/*
 * The settings after a member shows or hides one product. Hiding a product
 * that has data keeps it hidden on purpose (Home does not ask about it);
 * showing one forgets that. A product that can never be hidden is left as
 * it is.
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

// Every product shown again, by a member: the goals leave it alone after this.
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
 *   2. Hidden: the project hides it. Under More products, found by Search,
 *      still pinned by whoever pinned it - the same menu for every member.
 *   3. Listed: in its category, on Home and in Search's list.
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
