import ProductKey, { PRODUCT_KEYS } from "../../../Types/Product/ProductKey";
import { ALWAYS_SHOWN_PRODUCTS } from "../../../Types/Product/ProjectProducts";
import {
  PRESET_TITLES,
  PRODUCTS_OF_PRESET,
  SERVER_PRODUCTS_ENV_VAR,
  SERVER_PRODUCTS_PRESETS,
  SERVER_PRODUCTS_SETTINGS_PATH,
  SWITCHABLE_PRODUCTS,
  ServerProductOffReason,
  ServerProductsOff,
  ServerProductsPreset,
  ServerProductsSettings,
  ServerProductsStartingValue,
  TELEMETRY_INGESTION_PRODUCTS,
  getOffByPreset,
  getOffFromOn,
  getOffProducts,
  getPresetOf,
  getProductOffMessage,
  getServerProductsOff,
  isProductOffOnServer,
  isServerProductOffReason,
  isServerProductsPreset,
  isSwitchableProduct,
  parseServerProductsSettings,
  parseServerProductsStartingValue,
  shouldSuggestStoppingIngestion,
  toServerProductsSettingsJSON,
  withPreset,
  withProductSwitched,
} from "../../../Types/Product/ServerProducts";
import { describe, expect, test } from "@jest/globals";

/*
 * THE PRODUCTS A SERVER SWITCHES OFF FOR EVERY PROJECT (#6815): the pure
 * rules the server, the Dashboard and the Admin Dashboard share.
 */

const NOW: Date = new Date("2026-11-12T10:00:00.000Z");

describe("which products a server can switch off", () => {
  test("every product but Users, Teams and Project Settings", () => {
    expect(SWITCHABLE_PRODUCTS).toHaveLength(
      PRODUCT_KEYS.length - ALWAYS_SHOWN_PRODUCTS.length,
    );

    for (const product of ALWAYS_SHOWN_PRODUCTS) {
      expect(isSwitchableProduct(product)).toBe(false);
      expect(SWITCHABLE_PRODUCTS).not.toContain(product);
    }

    expect(isSwitchableProduct(ProductKey.Logs)).toBe(true);
    expect(isSwitchableProduct(ProductKey.AIChat)).toBe(true);
  });

  test("in the products menu's order", () => {
    expect(SWITCHABLE_PRODUCTS).toEqual(
      PRODUCT_KEYS.filter((product: ProductKey): boolean => {
        return !ALWAYS_SHOWN_PRODUCTS.includes(product);
      }),
    );
  });
});

describe("the presets", () => {
  test("are offered smallest first, each with a title", () => {
    expect(SERVER_PRODUCTS_PRESETS).toEqual([
      ServerProductsPreset.MonitoringAndStatusPages,
      ServerProductsPreset.IncidentResponse,
      ServerProductsPreset.Everything,
    ]);

    let previous: number = 0;

    for (const preset of SERVER_PRODUCTS_PRESETS) {
      expect(PRESET_TITLES[preset].length).toBeGreaterThan(0);
      expect(PRODUCTS_OF_PRESET[preset].length).toBeGreaterThan(previous);
      previous = PRODUCTS_OF_PRESET[preset].length;
    }
  });

  test("Monitoring and status pages keeps the products a monitor flows through, and paging", () => {
    expect(
      PRODUCTS_OF_PRESET[ServerProductsPreset.MonitoringAndStatusPages],
    ).toEqual([
      ProductKey.Monitors,
      ProductKey.Incidents,
      ProductKey.OnCall,
      ProductKey.StatusPages,
      ProductKey.ScheduledMaintenance,
    ]);
  });

  test("Incident response adds alerts, SLOs, workflows and runbooks to it", () => {
    const monitoring: ReadonlyArray<ProductKey> =
      PRODUCTS_OF_PRESET[ServerProductsPreset.MonitoringAndStatusPages];
    const incidentResponse: ReadonlyArray<ProductKey> =
      PRODUCTS_OF_PRESET[ServerProductsPreset.IncidentResponse];

    for (const product of monitoring) {
      expect(incidentResponse).toContain(product);
    }

    expect(
      incidentResponse.filter((product: ProductKey): boolean => {
        return !monitoring.includes(product);
      }),
    ).toEqual([
      ProductKey.Alerts,
      ProductKey.Slos,
      ProductKey.Workflows,
      ProductKey.Runbooks,
    ]);
  });

  test("Everything keeps every product a server can switch off", () => {
    expect(PRODUCTS_OF_PRESET[ServerProductsPreset.Everything]).toEqual(
      SWITCHABLE_PRODUCTS,
    );
    expect(getOffByPreset(ServerProductsPreset.Everything)).toEqual([]);
  });

  test("a preset switches off every other product, never Users, Teams or Project Settings", () => {
    const off: Array<ProductKey> = getOffByPreset(
      ServerProductsPreset.MonitoringAndStatusPages,
    );

    expect(off).toHaveLength(SWITCHABLE_PRODUCTS.length - 5);
    expect(off).toContain(ProductKey.Logs);
    expect(off).toContain(ProductKey.Alerts);
    expect(off).not.toContain(ProductKey.Monitors);
    expect(off).not.toContain(ProductKey.OnCall);

    for (const product of ALWAYS_SHOWN_PRODUCTS) {
      expect(off).not.toContain(product);
    }
  });

  test("getOffFromOn leaves out the products to keep, in the menu's order", () => {
    expect(getOffFromOn(SWITCHABLE_PRODUCTS)).toEqual([]);
    expect(getOffFromOn([])).toEqual(SWITCHABLE_PRODUCTS);
    expect(getOffFromOn([ProductKey.Logs]).includes(ProductKey.Logs)).toBe(
      false,
    );
  });

  test("getPresetOf names the preset the products are exactly, or none", () => {
    for (const preset of SERVER_PRODUCTS_PRESETS) {
      expect(getPresetOf(getOffByPreset(preset))).toBe(preset);
      // The order the list comes in does not matter.
      expect(getPresetOf([...getOffByPreset(preset)].reverse())).toBe(preset);
    }

    expect(getPresetOf([ProductKey.Logs])).toBeNull();
    expect(
      getPresetOf([
        ...getOffByPreset(ServerProductsPreset.MonitoringAndStatusPages),
        ProductKey.Monitors,
      ]),
    ).toBeNull();
    // Products that can never be off do not change the answer.
    expect(getPresetOf([ProductKey.ProjectSettings])).toBe(
      ServerProductsPreset.Everything,
    );
  });

  test("isServerProductsPreset knows only the presets", () => {
    expect(isServerProductsPreset("incident-response")).toBe(true);
    expect(isServerProductsPreset("everything")).toBe(true);
    expect(isServerProductsPreset("Everything")).toBe(false);
    expect(isServerProductsPreset("logs")).toBe(false);
    expect(isServerProductsPreset(undefined)).toBe(false);
  });
});

describe("what an admin saved (GlobalConfig.serverProducts)", () => {
  test("nothing saved is null: the starting value applies", () => {
    expect(parseServerProductsSettings(null)).toBeNull();
    expect(parseServerProductsSettings(undefined)).toBeNull();
    expect(parseServerProductsSettings("logs")).toBeNull();
    expect(parseServerProductsSettings([ProductKey.Logs])).toBeNull();
    expect(parseServerProductsSettings({ off: "logs" })).toBeNull();
  });

  test("keeps known products a server can switch off, in the menu's order", () => {
    const settings: ServerProductsSettings | null = parseServerProductsSettings(
      {
        off: [
          ProductKey.Traces,
          "not-a-product",
          ProductKey.Logs,
          ProductKey.ProjectSettings,
          ProductKey.Users,
          ProductKey.Logs,
        ],
        changedAt: NOW.toISOString(),
        changedByUserId: "user-1",
      },
    );

    expect(settings).toEqual({
      off: [ProductKey.Logs, ProductKey.Traces],
      changedAt: NOW.toISOString(),
      changedByUserId: "user-1",
    });
  });

  test("an empty list is saved: everything on, on purpose", () => {
    expect(parseServerProductsSettings({ off: [] })).toEqual({
      off: [],
      changedAt: null,
      changedByUserId: null,
    });
  });

  test("goes back and forth through JSON unchanged", () => {
    const settings: ServerProductsSettings = withPreset({
      preset: ServerProductsPreset.IncidentResponse,
      userId: "user-2",
      now: NOW,
    });

    expect(
      parseServerProductsSettings(
        JSON.parse(JSON.stringify(toServerProductsSettingsJSON(settings))),
      ),
    ).toEqual(settings);
  });
});

describe("the starting value (SERVER_PRODUCTS)", () => {
  test("is read from SERVER_PRODUCTS", () => {
    expect(SERVER_PRODUCTS_ENV_VAR).toBe("SERVER_PRODUCTS");
  });

  test.each([
    undefined,
    null,
    "",
    "   ",
    "everything",
    "EVERYTHING",
    " everything ",
  ])("%p keeps every product on", (value: string | null | undefined) => {
    const startingValue: ServerProductsStartingValue =
      parseServerProductsStartingValue(value);

    expect(startingValue.off).toEqual([]);
    expect(startingValue.preset).toBe(ServerProductsPreset.Everything);
    expect(startingValue.unknownNames).toEqual([]);
  });

  test.each(SERVER_PRODUCTS_PRESETS)("the preset %s", (preset: string) => {
    const startingValue: ServerProductsStartingValue =
      parseServerProductsStartingValue(preset);

    expect(startingValue.off).toEqual(
      getOffByPreset(preset as ServerProductsPreset),
    );
    expect(startingValue.preset).toBe(preset);
  });

  test("a list names the products to keep on, by key, with commas or spaces", () => {
    const startingValue: ServerProductsStartingValue =
      parseServerProductsStartingValue(
        "monitors, incidents  status-pages,on-call",
      );

    expect(startingValue.off).toEqual(
      getOffFromOn([
        ProductKey.Monitors,
        ProductKey.Incidents,
        ProductKey.StatusPages,
        ProductKey.OnCall,
      ]),
    );
    expect(startingValue.off).not.toContain(ProductKey.Monitors);
    expect(startingValue.off).toContain(ProductKey.Logs);
    expect(startingValue.unknownNames).toEqual([]);
  });

  test("a list that is a preset's products is recognised as that preset", () => {
    expect(
      parseServerProductsStartingValue(
        "monitors,incidents,on-call,status-pages,scheduled-maintenance",
      ).preset,
    ).toBe(ServerProductsPreset.MonitoringAndStatusPages);
    expect(parseServerProductsStartingValue("monitors,logs").preset).toBeNull();
  });

  test("names it does not know are reported, and left out", () => {
    const startingValue: ServerProductsStartingValue =
      parseServerProductsStartingValue("monitors,status-page,logz");

    expect(startingValue.unknownNames).toEqual(["status-page", "logz"]);
    expect(startingValue.off).toEqual(getOffFromOn([ProductKey.Monitors]));
  });

  test("a value that names no product at all keeps everything on: a typo never switches a server off", () => {
    const startingValue: ServerProductsStartingValue =
      parseServerProductsStartingValue("monitoring");

    expect(startingValue.off).toEqual([]);
    expect(startingValue.preset).toBe(ServerProductsPreset.Everything);
    expect(startingValue.unknownNames).toEqual(["monitoring"]);
  });

  test("Users, Teams and Project Settings alone keep everything on, as they are always on", () => {
    expect(
      parseServerProductsStartingValue("users,teams,project-settings").off,
    ).toEqual([]);
  });

  test("a preset among other names is read as a list, and reported", () => {
    const startingValue: ServerProductsStartingValue =
      parseServerProductsStartingValue("incident-response,logs");

    expect(startingValue.unknownNames).toEqual(["incident-response"]);
    expect(startingValue.off).toEqual(getOffFromOn([ProductKey.Logs]));
  });
});

describe("what is off on the server, and why", () => {
  const saved: ServerProductsSettings = {
    off: [ProductKey.Alerts],
    changedAt: null,
    changedByUserId: null,
  };

  test("what an admin saved wins over the starting value", () => {
    expect(
      getServerProductsOff({
        settings: saved,
        startingValue: [ProductKey.Logs, ProductKey.Traces],
        isTelemetryIngestionStopped: false,
      }),
    ).toEqual({ [ProductKey.Alerts]: ServerProductOffReason.SwitchedOff });
  });

  test("an empty save switches everything on, whatever the starting value", () => {
    expect(
      getServerProductsOff({
        settings: { off: [], changedAt: null, changedByUserId: null },
        startingValue: [ProductKey.Logs],
        isTelemetryIngestionStopped: false,
      }),
    ).toEqual({});
  });

  test("until an admin saves, the starting value applies", () => {
    expect(
      getServerProductsOff({
        settings: null,
        startingValue: [ProductKey.Logs],
        isTelemetryIngestionStopped: false,
      }),
    ).toEqual({ [ProductKey.Logs]: ServerProductOffReason.SwitchedOff });
  });

  test("nothing saved and no starting value: everything is on, so an upgrade changes nothing", () => {
    expect(
      getServerProductsOff({
        settings: null,
        startingValue: [],
        isTelemetryIngestionStopped: false,
      }),
    ).toEqual({});
  });

  test("stopped ingestion turns the telemetry products off, for that reason, and wins", () => {
    const off: ServerProductsOff = getServerProductsOff({
      settings: {
        off: [ProductKey.Logs, ProductKey.Alerts],
        changedAt: null,
        changedByUserId: null,
      },
      startingValue: [],
      isTelemetryIngestionStopped: true,
    });

    for (const product of TELEMETRY_INGESTION_PRODUCTS) {
      expect(off[product]).toBe(
        ServerProductOffReason.TelemetryIngestionStopped,
      );
    }

    expect(off[ProductKey.Alerts]).toBe(ServerProductOffReason.SwitchedOff);
    expect(off[ProductKey.Monitors]).toBeUndefined();
  });

  test("the telemetry products are the ones only ingestion feeds", () => {
    expect(TELEMETRY_INGESTION_PRODUCTS).toEqual([
      ProductKey.Logs,
      ProductKey.Metrics,
      ProductKey.Traces,
      ProductKey.Profiles,
      ProductKey.Exceptions,
    ]);
  });

  test("never switches off Users, Teams or Project Settings", () => {
    const off: ServerProductsOff = getServerProductsOff({
      settings: null,
      startingValue: [...PRODUCT_KEYS],
      isTelemetryIngestionStopped: true,
    });

    for (const product of ALWAYS_SHOWN_PRODUCTS) {
      expect(off[product]).toBeUndefined();
    }
  });

  test("getOffProducts lists them in the menu's order; isProductOffOnServer asks one", () => {
    const off: ServerProductsOff = {
      [ProductKey.Traces]: ServerProductOffReason.SwitchedOff,
      [ProductKey.Monitors]: ServerProductOffReason.SwitchedOff,
    };

    expect(getOffProducts(off)).toEqual([
      ProductKey.Monitors,
      ProductKey.Traces,
    ]);
    expect(isProductOffOnServer(off, ProductKey.Traces)).toBe(true);
    expect(isProductOffOnServer(off, ProductKey.Logs)).toBe(false);
  });

  test("isServerProductOffReason knows the two reasons only", () => {
    expect(isServerProductOffReason("switched-off")).toBe(true);
    expect(isServerProductOffReason("telemetry-ingestion-stopped")).toBe(true);
    expect(isServerProductOffReason("hidden")).toBe(false);
    expect(isServerProductOffReason(true)).toBe(false);
  });
});

describe("stopping ingestion, suggested", () => {
  const everyTelemetryProductOff: ServerProductsOff = Object.fromEntries(
    TELEMETRY_INGESTION_PRODUCTS.map((product: ProductKey) => {
      return [product, ServerProductOffReason.SwitchedOff];
    }),
  );

  test("when every telemetry product is switched off while ingestion still runs", () => {
    expect(
      shouldSuggestStoppingIngestion({
        off: everyTelemetryProductOff,
        isTelemetryIngestionStopped: false,
      }),
    ).toBe(true);
  });

  test("not while one telemetry product is still on", () => {
    const off: ServerProductsOff = { ...everyTelemetryProductOff };
    delete off[ProductKey.Traces];

    expect(
      shouldSuggestStoppingIngestion({
        off: off,
        isTelemetryIngestionStopped: false,
      }),
    ).toBe(false);
  });

  test("not once ingestion is stopped", () => {
    expect(
      shouldSuggestStoppingIngestion({
        off: everyTelemetryProductOff,
        isTelemetryIngestionStopped: true,
      }),
    ).toBe(false);
  });

  test("the preset that keeps no telemetry product suggests it", () => {
    expect(
      shouldSuggestStoppingIngestion({
        off: getServerProductsOff({
          settings: withPreset({
            preset: ServerProductsPreset.MonitoringAndStatusPages,
            userId: null,
            now: NOW,
          }),
          startingValue: [],
          isTelemetryIngestionStopped: false,
        }),
        isTelemetryIngestionStopped: false,
      }),
    ).toBe(true);
  });
});

describe("what an admin changes", () => {
  test("withPreset saves the preset's products off, with who and when", () => {
    expect(
      withPreset({
        preset: ServerProductsPreset.IncidentResponse,
        userId: "user-1",
        now: NOW,
      }),
    ).toEqual({
      off: getOffByPreset(ServerProductsPreset.IncidentResponse),
      changedAt: NOW.toISOString(),
      changedByUserId: "user-1",
    });
  });

  test("withProductSwitched switches one product, from what is off now", () => {
    const off: ServerProductsSettings = withProductSwitched({
      currentOff: [ProductKey.Logs],
      product: ProductKey.Traces,
      isOn: false,
      userId: "user-1",
      now: NOW,
    });

    expect(off.off).toEqual([ProductKey.Logs, ProductKey.Traces]);
    expect(off.changedByUserId).toBe("user-1");

    expect(
      withProductSwitched({
        currentOff: off.off,
        product: ProductKey.Logs,
        isOn: true,
        userId: null,
        now: NOW,
      }).off,
    ).toEqual([ProductKey.Traces]);
  });

  test("switching on a product that is on, or off one that is off, changes nothing", () => {
    expect(
      withProductSwitched({
        currentOff: [ProductKey.Logs],
        product: ProductKey.Logs,
        isOn: false,
        userId: null,
        now: NOW,
      }).off,
    ).toEqual([ProductKey.Logs]);
    expect(
      withProductSwitched({
        currentOff: [],
        product: ProductKey.Logs,
        isOn: true,
        userId: null,
        now: NOW,
      }).off,
    ).toEqual([]);
  });

  test("a product that is always on stays on", () => {
    expect(
      withProductSwitched({
        currentOff: [],
        product: ProductKey.ProjectSettings,
        isOn: false,
        userId: null,
        now: NOW,
      }).off,
    ).toEqual([]);
  });
});

describe("the words of a refusal", () => {
  test("says what is off, who can switch it on, where, and that nothing was deleted", () => {
    const message: string = getProductOffMessage({
      product: ProductKey.StatusPages,
      reason: ServerProductOffReason.SwitchedOff,
    });

    expect(message).toBe(
      "Status Pages is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.",
    );
    expect(message).toContain(SERVER_PRODUCTS_SETTINGS_PATH);
  });

  test("names the setting when ingestion is stopped", () => {
    expect(
      getProductOffMessage({
        product: ProductKey.Logs,
        reason: ServerProductOffReason.TelemetryIngestionStopped,
      }),
    ).toBe(
      "Logs is off because telemetry ingestion is stopped on this server. A server admin can start it again by setting DISABLE_TELEMETRY_INGESTION to false and restarting OneUptime. Nothing was deleted.",
    );
  });

  test("every product's message is a sentence that names it", () => {
    for (const product of SWITCHABLE_PRODUCTS) {
      const message: string = getProductOffMessage({
        product: product,
        reason: ServerProductOffReason.SwitchedOff,
      });

      expect(message).toMatch(/^[A-Z].*\.$/);
      expect(message).not.toContain(product);
    }
  });
});
