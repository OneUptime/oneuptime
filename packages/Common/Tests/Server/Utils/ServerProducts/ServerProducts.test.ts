import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import ServerProducts, {
  OFF_PRODUCTS_CACHE_TTL_MS,
  ServerProductsClass,
} from "../../../../Server/Utils/ServerProducts/ServerProducts";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../../Types/Exception/ForbiddenException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ProductKey from "../../../../Types/Product/ProductKey";
import {
  ServerProductOffReason,
  ServerProductsPreset,
  TELEMETRY_INGESTION_PRODUCTS,
  getOffByPreset,
  getOffFromOn,
} from "../../../../Types/Product/ServerProducts";
import {
  ServerProductsAnswer,
  ServerProductsSource,
} from "../../../../Types/Product/ServerProductsAnswer";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE PRODUCTS THIS SERVER SWITCHES OFF, ON THE SERVER (#6815).
 *
 * What an admin saved (GlobalConfig.serverProducts) wins; until then the
 * starting value (SERVER_PRODUCTS); and stopped ingestion turns the
 * telemetry products off. The list is kept for a few seconds, dropped on a
 * write, and a failed read answers "everything on" rather than hiding a
 * server's products or refusing every write.
 */

let stored: JSONObject | null = null;
let readCount: number = 0;
let startingValue: string = "";
let isIngestionStopped: boolean = false;
let written: Array<JSONObject> = [];

const USER_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

const service: ServerProductsClass = new ServerProductsClass();

beforeEach(() => {
  stored = null;
  readCount = 0;
  startingValue = "";
  isIngestionStopped = false;
  written = [];

  jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockImplementation(async (): Promise<GlobalConfig | null> => {
      readCount++;
      const config: GlobalConfig = new GlobalConfig();
      config.serverProducts = (stored || undefined) as never;
      return config;
    });
  jest
    .spyOn(GlobalConfigService, "writeServerProducts")
    .mockImplementation(async (settings: JSONObject): Promise<void> => {
      written.push(settings);
      stored = settings;
    });

  const readStartingValue: () => string = (): string => {
    return startingValue;
  };
  const readIngestionStopped: () => boolean = (): boolean => {
    return isIngestionStopped;
  };

  for (const target of [service, ServerProducts]) {
    jest
      .spyOn(target, "getStartingValueText")
      .mockImplementation(readStartingValue);
    jest
      .spyOn(target, "isTelemetryIngestionStopped")
      .mockImplementation(readIngestionStopped);
    target.forget();
  }
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("what is off", () => {
  test("nothing saved and no starting value: everything is on", async () => {
    expect(await service.getOff()).toEqual({});
  });

  test("the starting value applies until an admin saves", async () => {
    startingValue = "monitoring-and-status-pages";

    expect(await service.getOffProducts()).toEqual(
      getOffByPreset(ServerProductsPreset.MonitoringAndStatusPages),
    );
  });

  test("what an admin saved wins over the starting value", async () => {
    startingValue = "monitoring-and-status-pages";
    stored = { off: [ProductKey.Alerts] };

    expect(await service.getOff()).toEqual({
      [ProductKey.Alerts]: ServerProductOffReason.SwitchedOff,
    });
  });

  test("stopped ingestion turns the telemetry products off, for that reason", async () => {
    isIngestionStopped = true;

    const off: Partial<Record<ProductKey, ServerProductOffReason>> =
      await service.getOff();

    expect(Object.keys(off).sort()).toEqual(
      [...TELEMETRY_INGESTION_PRODUCTS].sort(),
    );
    expect(await service.getOffReason(ProductKey.Logs)).toBe(
      ServerProductOffReason.TelemetryIngestionStopped,
    );
    expect(await service.getOffReason(ProductKey.Monitors)).toBeNull();
  });

  test("is kept for a few seconds, and read again after", async () => {
    jest.useFakeTimers({
      now: new Date("2026-11-12T10:00:00.000Z"),
      doNotFake: ["nextTick", "setImmediate", "performance", "hrtime"],
    });

    await service.getOff();
    await service.getOff();
    expect(readCount).toBe(1);

    stored = { off: [ProductKey.Logs] };
    jest.setSystemTime(
      new Date(
        new Date("2026-11-12T10:00:00.000Z").getTime() +
          OFF_PRODUCTS_CACHE_TTL_MS +
          1,
      ),
    );

    expect(await service.getOff()).toEqual({
      [ProductKey.Logs]: ServerProductOffReason.SwitchedOff,
    });
    expect(readCount).toBe(2);
  });

  test("a write drops this server's copy at once", async () => {
    await service.getOff();

    await service.switchProduct({
      product: ProductKey.Traces,
      isOn: false,
      byUserId: USER_ID,
    });

    expect(await service.getOff()).toEqual({
      [ProductKey.Traces]: ServerProductOffReason.SwitchedOff,
    });
  });

  test("a read that fails answers every product on, and is not kept", async () => {
    (
      GlobalConfigService.findOneById as unknown as jest.Mock
    ).mockImplementation(async () => {
      throw new Error("The database is not reachable.");
    });

    expect(await service.getOff()).toEqual({});

    (
      GlobalConfigService.findOneById as unknown as jest.Mock
    ).mockImplementation(async (): Promise<GlobalConfig> => {
      const config: GlobalConfig = new GlobalConfig();
      config.serverProducts = { off: [ProductKey.Logs] } as never;
      return config;
    });

    expect(await service.getOff()).toEqual({
      [ProductKey.Logs]: ServerProductOffReason.SwitchedOff,
    });
  });

  test("getFirstOff names the first product given that is off", async () => {
    stored = { off: [ProductKey.Traces, ProductKey.Logs] };

    expect(
      await service.getFirstOff([
        ProductKey.Monitors,
        ProductKey.Traces,
        ProductKey.Logs,
      ]),
    ).toEqual({
      product: ProductKey.Traces,
      reason: ServerProductOffReason.SwitchedOff,
    });
    expect(await service.getFirstOff([ProductKey.Monitors])).toBeNull();
    expect(await service.getFirstOff([])).toBeNull();
  });
});

describe("refusing what an off product cannot do", () => {
  test("throws a ForbiddenException that says what happened and who can switch it on", async () => {
    stored = { off: [ProductKey.StatusPages] };

    const refusal: Promise<void> = service.assertProductIsOn(
      ProductKey.StatusPages,
    );

    await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
    await expect(refusal).rejects.toThrow(
      "Status Pages is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.",
    );
  });

  test("names DISABLE_TELEMETRY_INGESTION when that is why", async () => {
    isIngestionStopped = true;

    await expect(service.assertProductIsOn(ProductKey.Logs)).rejects.toThrow(
      "DISABLE_TELEMETRY_INGESTION",
    );
  });

  test("lets a product that is on through", async () => {
    stored = { off: [ProductKey.StatusPages] };

    await expect(
      service.assertProductIsOn(ProductKey.Monitors),
    ).resolves.toBeUndefined();
  });
});

describe("what an admin changes", () => {
  test("a preset saves its products off, with who and when", async () => {
    await service.applyPreset({
      preset: ServerProductsPreset.IncidentResponse,
      byUserId: USER_ID,
    });

    expect(written).toHaveLength(1);
    expect(written[0]!["off"]).toEqual(
      getOffByPreset(ServerProductsPreset.IncidentResponse),
    );
    expect(written[0]!["changedByUserId"]).toBe(USER_ID.toString());
    expect(typeof written[0]!["changedAt"]).toBe("string");
  });

  test.each([["everything-but-logs"], [undefined], [3]])(
    "a preset that is not one (%p) is refused, and nothing is written",
    async (preset: unknown) => {
      await expect(
        service.applyPreset({ preset: preset, byUserId: USER_ID }),
      ).rejects.toBeInstanceOf(BadDataException);
      expect(written).toEqual([]);
    },
  );

  test("one switch starts from the starting value when nothing is saved, and saving makes it the admin's", async () => {
    startingValue = "monitoring-and-status-pages";

    await service.switchProduct({
      product: ProductKey.Alerts,
      isOn: true,
      byUserId: USER_ID,
    });

    expect(written[0]!["off"]).toEqual(
      getOffFromOn([
        ...[
          ProductKey.Monitors,
          ProductKey.Incidents,
          ProductKey.OnCall,
          ProductKey.StatusPages,
          ProductKey.ScheduledMaintenance,
        ],
        ProductKey.Alerts,
      ]),
    );
  });

  test("one switch starts from what is saved", async () => {
    stored = { off: [ProductKey.Logs] };

    await service.switchProduct({
      product: ProductKey.Logs,
      isOn: true,
      byUserId: null,
    });

    expect(written[0]!["off"]).toEqual([]);
    expect(written[0]!["changedByUserId"]).toBeNull();
  });

  test.each([
    [
      { product: "nope", isOn: false },
      "Choose one of the products, by its key, such as logs or status-pages.",
    ],
    [
      { product: ProductKey.Logs, isOn: "no" },
      "Say whether to switch the product on: isOn must be true or false.",
    ],
    [
      { product: ProductKey.ProjectSettings, isOn: false },
      "Users, Teams and Project Settings are always on: every project needs them to run itself.",
    ],
  ])(
    "refuses %j",
    async (body: { product: unknown; isOn: unknown }, message: string) => {
      const refusal: Promise<void> = service.switchProduct({
        ...body,
        byUserId: USER_ID,
      });

      await expect(refusal).rejects.toBeInstanceOf(BadDataException);
      await expect(refusal).rejects.toThrow(message);
      expect(written).toEqual([]);
    },
  );
});

describe("the Admin Dashboard's answer", () => {
  test("on a server nobody configured: everything, from the starting value", async () => {
    const answer: ServerProductsAnswer = await service.getAnswer();

    expect(answer).toEqual({
      off: {},
      switchedOff: [],
      preset: ServerProductsPreset.Everything,
      source: ServerProductsSource.StartingValue,
      startingValue: "",
      startingValueUnknownNames: [],
      isTelemetryIngestionStopped: false,
      shouldSuggestStoppingIngestion: false,
      changedAt: null,
    });
  });

  test("says where the switches come from, and names what SERVER_PRODUCTS got wrong", async () => {
    startingValue = " monitors,logz ";

    const answer: ServerProductsAnswer = await service.getAnswer();

    expect(answer.source).toBe(ServerProductsSource.StartingValue);
    expect(answer.startingValue).toBe("monitors,logz");
    expect(answer.startingValueUnknownNames).toEqual(["logz"]);
    expect(answer.switchedOff).toEqual(getOffFromOn([ProductKey.Monitors]));
    expect(answer.preset).toBeNull();
  });

  test("a saved preset is the current one, and suggests stopping ingestion", async () => {
    await service.applyPreset({
      preset: ServerProductsPreset.MonitoringAndStatusPages,
      byUserId: USER_ID,
    });

    const answer: ServerProductsAnswer = await service.getAnswer();

    expect(answer.source).toBe(ServerProductsSource.Saved);
    expect(answer.preset).toBe(ServerProductsPreset.MonitoringAndStatusPages);
    expect(answer.shouldSuggestStoppingIngestion).toBe(true);
    expect(answer.changedAt).not.toBeNull();
  });

  test("while ingestion is stopped, says so, and does not suggest it", async () => {
    isIngestionStopped = true;
    stored = {
      off: getOffByPreset(ServerProductsPreset.MonitoringAndStatusPages),
    };

    const answer: ServerProductsAnswer = await service.getAnswer();

    expect(answer.isTelemetryIngestionStopped).toBe(true);
    expect(answer.shouldSuggestStoppingIngestion).toBe(false);
    expect(answer.off[ProductKey.Logs]).toBe(
      ServerProductOffReason.TelemetryIngestionStopped,
    );
  });
});
