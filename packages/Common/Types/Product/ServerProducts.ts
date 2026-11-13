import { JSONObject } from "../JSON";
import { getProductTitle } from "./ProductCatalog";
import ProductKey, {
  PRODUCT_KEYS,
  isProductKey,
  parseProductKeys,
} from "./ProductKey";
import { isHideableProduct } from "./ProjectProducts";

/*
 * THE PRODUCTS A SERVER SWITCHES OFF FOR EVERY PROJECT (#6815, #2471).
 *
 * Many self-hosted servers run OneUptime for one job: watch some websites,
 * publish a status page. Their admin switches the rest off on Admin
 * Dashboard > Settings > Products, with a switch per product or a preset in
 * one click, and every project on the server shows only what is left.
 *
 * Off is stronger than anything a project or a person chooses
 * (ProjectProducts.getProductPlacement): an off product is in no menu, not
 * on Home, not found by Search, not under More products, not pinned, and on
 * Project Settings > Products it reads "Switched off on this server" instead
 * of a switch. Its pages say it is switched off and who can switch it on,
 * and the API refuses to create, change or delete its records
 * (Server/Utils/ServerProducts). Reads keep working: products that are on
 * show records of others (an incident names its monitors).
 *
 * Off changes what people see and use, never what is kept or what runs:
 * nothing is deleted, monitors keep checking, published status pages stay
 * up, and telemetry keeps arriving unless the admin also stops ingestion
 * (DISABLE_TELEMETRY_INGESTION).
 *
 * WHERE THE LIST COMES FROM
 *
 *   1. What an admin saved on the Admin Dashboard: GlobalConfig.
 *      serverProducts, read with parseServerProductsSettings. Once saved,
 *      it is the source.
 *   2. Until then, the starting value: SERVER_PRODUCTS in config.env (Helm:
 *      products.onThisServer), for servers configured as code
 *      (parseServerProductsStartingValue). Unset, every product is on, so an
 *      upgrade changes nothing.
 *   3. On top of either, when DISABLE_TELEMETRY_INGESTION is set, the
 *      telemetry products (TELEMETRY_INGESTION_PRODUCTS) are off too, for
 *      that reason: nothing new can reach them.
 *
 * Pure: the server, the Dashboard, the Admin Dashboard and their tests read
 * it.
 */

/*
 * The products a server can switch off: every product but Users, Teams and
 * Project Settings, which a project needs to run itself - the same ones a
 * project can never hide.
 */
export const isSwitchableProduct: (product: ProductKey) => boolean =
  isHideableProduct;

export const SWITCHABLE_PRODUCTS: ReadonlyArray<ProductKey> =
  PRODUCT_KEYS.filter(isSwitchableProduct);

// One click on the Admin Dashboard: the products it keeps on.
export enum ServerProductsPreset {
  MonitoringAndStatusPages = "monitoring-and-status-pages",
  IncidentResponse = "incident-response",
  Everything = "everything",
}

// The presets, smallest first, as the page offers them.
export const SERVER_PRODUCTS_PRESETS: ReadonlyArray<ServerProductsPreset> = [
  ServerProductsPreset.MonitoringAndStatusPages,
  ServerProductsPreset.IncidentResponse,
  ServerProductsPreset.Everything,
];

/*
 * What each preset keeps on. Monitoring and status pages is the server that
 * watches websites and tells customers (#528): a monitor opens an incident,
 * the person who looks after it is paged, the status page shows it, and
 * planned work is announced. On-Call Duty is in it because a monitor that
 * can tell nobody is not monitoring: "Know when my website is down", the
 * first thing Home offers, ends in a test page through an on-call policy.
 * Incident response adds what a team on call uses to answer and learn:
 * alerts, SLOs, workflows and runbooks.
 */
export const PRODUCTS_OF_PRESET: Readonly<
  Record<ServerProductsPreset, ReadonlyArray<ProductKey>>
> = {
  [ServerProductsPreset.MonitoringAndStatusPages]: [
    ProductKey.Monitors,
    ProductKey.Incidents,
    ProductKey.OnCall,
    ProductKey.StatusPages,
    ProductKey.ScheduledMaintenance,
  ],
  [ServerProductsPreset.IncidentResponse]: [
    ProductKey.Monitors,
    ProductKey.Incidents,
    ProductKey.Alerts,
    ProductKey.OnCall,
    ProductKey.StatusPages,
    ProductKey.ScheduledMaintenance,
    ProductKey.Slos,
    ProductKey.Workflows,
    ProductKey.Runbooks,
  ],
  [ServerProductsPreset.Everything]: SWITCHABLE_PRODUCTS,
};

export const PRESET_TITLES: Readonly<Record<ServerProductsPreset, string>> = {
  [ServerProductsPreset.MonitoringAndStatusPages]:
    "Monitoring and status pages",
  [ServerProductsPreset.IncidentResponse]: "Incident response",
  [ServerProductsPreset.Everything]: "Everything",
};

export const isServerProductsPreset: (
  value: unknown,
) => value is ServerProductsPreset = (
  value: unknown,
): value is ServerProductsPreset => {
  return (
    typeof value === "string" &&
    (SERVER_PRODUCTS_PRESETS as ReadonlyArray<string>).includes(value)
  );
};

// The products a server keeps on, as a list of the ones it switches off.
export const getOffFromOn: (
  on: ReadonlyArray<ProductKey>,
) => Array<ProductKey> = (on: ReadonlyArray<ProductKey>): Array<ProductKey> => {
  return SWITCHABLE_PRODUCTS.filter((product: ProductKey): boolean => {
    return !on.includes(product);
  });
};

// The products a preset switches off, in the menu's order.
export const getOffByPreset: (
  preset: ServerProductsPreset,
) => Array<ProductKey> = (preset: ServerProductsPreset): Array<ProductKey> => {
  return getOffFromOn(PRODUCTS_OF_PRESET[preset]);
};

// The preset these products are, exactly, or null for a choice of one's own.
export const getPresetOf: (
  off: ReadonlyArray<ProductKey>,
) => ServerProductsPreset | null = (
  off: ReadonlyArray<ProductKey>,
): ServerProductsPreset | null => {
  const offSet: Set<ProductKey> = new Set(
    off.filter((product: ProductKey): boolean => {
      return isSwitchableProduct(product);
    }),
  );

  for (const preset of SERVER_PRODUCTS_PRESETS) {
    const byPreset: Array<ProductKey> = getOffByPreset(preset);

    if (
      byPreset.length === offSet.size &&
      byPreset.every((product: ProductKey): boolean => {
        return offSet.has(product);
      })
    ) {
      return preset;
    }
  }

  return null;
};

/*
 * The products that show only what telemetry ingestion brings - OpenTelemetry
 * logs, metrics, traces and profiles, Fluentd, Syslog and Pyroscope - and are
 * off while DISABLE_TELEMETRY_INGESTION is set. Monitors write their own
 * results, so the products built on them (and on records) stay on.
 */
export const TELEMETRY_INGESTION_PRODUCTS: ReadonlyArray<ProductKey> = [
  ProductKey.Logs,
  ProductKey.Metrics,
  ProductKey.Traces,
  ProductKey.Profiles,
  ProductKey.Exceptions,
];

// Why a product is off on this server.
export enum ServerProductOffReason {
  // An admin switched it off, or SERVER_PRODUCTS left it out.
  SwitchedOff = "switched-off",
  // DISABLE_TELEMETRY_INGESTION is set: nothing new can reach it.
  TelemetryIngestionStopped = "telemetry-ingestion-stopped",
}

export const isServerProductOffReason: (
  value: unknown,
) => value is ServerProductOffReason = (
  value: unknown,
): value is ServerProductOffReason => {
  return (
    value === ServerProductOffReason.SwitchedOff ||
    value === ServerProductOffReason.TelemetryIngestionStopped
  );
};

// What is off on a server, and why: product -> reason. Absent is on.
export type ServerProductsOff = Partial<
  Record<ProductKey, ServerProductOffReason>
>;

// What an admin saved, as GlobalConfig.serverProducts holds it.
export interface ServerProductsSettings {
  // The products switched off, in the menu's order.
  off: Array<ProductKey>;
  // When it was saved, and by whom (a master admin's user id), if known.
  changedAt: string | null;
  changedByUserId: string | null;
}

/*
 * What an admin saved, or null when nobody has (the starting value applies).
 * Unknown products, and the ones a server can never switch off, are left
 * out: a stored value never switches off Project Settings.
 */
export const parseServerProductsSettings: (
  value: unknown,
) => ServerProductsSettings | null = (
  value: unknown,
): ServerProductsSettings | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;

  if (!Array.isArray(json["off"])) {
    return null;
  }

  const off: Array<ProductKey> = parseProductKeys(json["off"]);

  return {
    off: SWITCHABLE_PRODUCTS.filter((product: ProductKey): boolean => {
      return off.includes(product);
    }),
    changedAt: typeof json["changedAt"] === "string" ? json["changedAt"] : null,
    changedByUserId:
      typeof json["changedByUserId"] === "string"
        ? json["changedByUserId"]
        : null,
  };
};

export const toServerProductsSettingsJSON: (
  settings: ServerProductsSettings,
) => JSONObject = (settings: ServerProductsSettings): JSONObject => {
  return {
    off: [...settings.off],
    changedAt: settings.changedAt,
    changedByUserId: settings.changedByUserId,
  };
};

// The environment variable that sets the starting value (config.env, Helm).
export const SERVER_PRODUCTS_ENV_VAR: string = "SERVER_PRODUCTS";

export interface ServerProductsStartingValue {
  // The products it switches off, in the menu's order.
  off: Array<ProductKey>;
  // The preset it names, when it names one (or is empty: Everything).
  preset: ServerProductsPreset | null;
  // Names it held that are neither a preset nor a product, to warn about.
  unknownNames: Array<string>;
}

/*
 * The starting value SERVER_PRODUCTS gives: empty or "everything" keeps
 * every product on; a preset's name, that preset; otherwise a list of the
 * products to keep on, by their keys, separated by commas or spaces
 * ("monitors, incidents, status-pages"). Users, Teams and Project Settings
 * are always on. A value that names no product at all keeps everything on -
 * a typo must not switch a whole server off - and every name it did not
 * know is reported, so the server can say so in its log.
 */
export const parseServerProductsStartingValue: (
  value: string | undefined | null,
) => ServerProductsStartingValue = (
  value: string | undefined | null,
): ServerProductsStartingValue => {
  const names: Array<string> = (value || "")
    .split(/[\s,]+/)
    .map((name: string): string => {
      return name.trim().toLowerCase();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });

  if (names.length === 0) {
    return {
      off: [],
      preset: ServerProductsPreset.Everything,
      unknownNames: [],
    };
  }

  if (names.length === 1 && isServerProductsPreset(names[0])) {
    const preset: ServerProductsPreset = names[0];

    return { off: getOffByPreset(preset), preset: preset, unknownNames: [] };
  }

  const on: Array<ProductKey> = [];
  const unknownNames: Array<string> = [];

  for (const name of names) {
    if (isProductKey(name)) {
      if (!on.includes(name)) {
        on.push(name);
      }

      continue;
    }

    if (!unknownNames.includes(name)) {
      unknownNames.push(name);
    }
  }

  const switchableOn: Array<ProductKey> = on.filter(isSwitchableProduct);

  if (switchableOn.length === 0) {
    return {
      off: [],
      preset: ServerProductsPreset.Everything,
      unknownNames: unknownNames,
    };
  }

  const off: Array<ProductKey> = getOffFromOn(switchableOn);

  return { off: off, preset: getPresetOf(off), unknownNames: unknownNames };
};

/*
 * What is off on the server, and why: what an admin saved or, until then,
 * the starting value - and, while ingestion is stopped, the telemetry
 * products, for that reason. Ingestion's reason wins: switching such a
 * product on brings nothing back while nothing can arrive.
 */
export const getServerProductsOff: (data: {
  settings: ServerProductsSettings | null;
  startingValue: ReadonlyArray<ProductKey>;
  isTelemetryIngestionStopped: boolean;
}) => ServerProductsOff = (data: {
  settings: ServerProductsSettings | null;
  startingValue: ReadonlyArray<ProductKey>;
  isTelemetryIngestionStopped: boolean;
}): ServerProductsOff => {
  const switchedOff: ReadonlyArray<ProductKey> = data.settings
    ? data.settings.off
    : data.startingValue;

  const off: ServerProductsOff = {};

  for (const product of SWITCHABLE_PRODUCTS) {
    if (
      data.isTelemetryIngestionStopped &&
      TELEMETRY_INGESTION_PRODUCTS.includes(product)
    ) {
      off[product] = ServerProductOffReason.TelemetryIngestionStopped;
      continue;
    }

    if (switchedOff.includes(product)) {
      off[product] = ServerProductOffReason.SwitchedOff;
    }
  }

  return off;
};

// The products that are off, in the menu's order.
export const getOffProducts: (off: ServerProductsOff) => Array<ProductKey> = (
  off: ServerProductsOff,
): Array<ProductKey> => {
  return PRODUCT_KEYS.filter((product: ProductKey): boolean => {
    return Boolean(off[product]);
  });
};

export const isProductOffOnServer: (
  off: ServerProductsOff,
  product: ProductKey,
) => boolean = (off: ServerProductsOff, product: ProductKey): boolean => {
  return Boolean(off[product]);
};

/*
 * Whether the page should say "You can also stop telemetry ingestion to
 * save memory": every telemetry product is switched off, and ingestion
 * still runs, receiving data nothing on this server shows.
 */
export const shouldSuggestStoppingIngestion: (data: {
  off: ServerProductsOff;
  isTelemetryIngestionStopped: boolean;
}) => boolean = (data: {
  off: ServerProductsOff;
  isTelemetryIngestionStopped: boolean;
}): boolean => {
  if (data.isTelemetryIngestionStopped) {
    return false;
  }

  return TELEMETRY_INGESTION_PRODUCTS.every((product: ProductKey): boolean => {
    return data.off[product] === ServerProductOffReason.SwitchedOff;
  });
};

// The settings after an admin applies a preset.
export const withPreset: (data: {
  preset: ServerProductsPreset;
  userId: string | null;
  now: Date;
}) => ServerProductsSettings = (data: {
  preset: ServerProductsPreset;
  userId: string | null;
  now: Date;
}): ServerProductsSettings => {
  return {
    off: getOffByPreset(data.preset),
    changedAt: data.now.toISOString(),
    changedByUserId: data.userId,
  };
};

/*
 * The settings after an admin switches one product on or off, starting from
 * what is switched off now (saved, or the starting value). A product that
 * can never be switched off is left as it is.
 */
export const withProductSwitched: (data: {
  currentOff: ReadonlyArray<ProductKey>;
  product: ProductKey;
  isOn: boolean;
  userId: string | null;
  now: Date;
}) => ServerProductsSettings = (data: {
  currentOff: ReadonlyArray<ProductKey>;
  product: ProductKey;
  isOn: boolean;
  userId: string | null;
  now: Date;
}): ServerProductsSettings => {
  const off: Set<ProductKey> = new Set(data.currentOff);

  if (isSwitchableProduct(data.product)) {
    if (data.isOn) {
      off.delete(data.product);
    } else {
      off.add(data.product);
    }
  }

  return {
    off: SWITCHABLE_PRODUCTS.filter((product: ProductKey): boolean => {
      return off.has(product);
    }),
    changedAt: data.now.toISOString(),
    changedByUserId: data.userId,
  };
};

/*
 * Where a server's admin switches products on, as a person reads it - the
 * same words in the API's refusal, on the "switched off" page and in Ask
 * AI's answer.
 */
export const SERVER_PRODUCTS_SETTINGS_PATH: string =
  "Admin Dashboard > Settings > Products";

/*
 * Why a product is off, and what to do next, in one or two sentences: what
 * the API answers when it refuses a change, and what Ask AI is told to say.
 * Nothing in it is anybody's data.
 */
export const getProductOffMessage: (data: {
  product: ProductKey;
  reason: ServerProductOffReason;
}) => string = (data: {
  product: ProductKey;
  reason: ServerProductOffReason;
}): string => {
  const title: string = getProductTitle(data.product);

  if (data.reason === ServerProductOffReason.TelemetryIngestionStopped) {
    return `${title} is off because telemetry ingestion is stopped on this server. A server admin can start it again by setting DISABLE_TELEMETRY_INGESTION to false and restarting OneUptime. Nothing was deleted.`;
  }

  return `${title} is switched off on this server. A server admin can switch it on in ${SERVER_PRODUCTS_SETTINGS_PATH}. Nothing was deleted.`;
};
