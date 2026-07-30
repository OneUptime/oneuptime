/*
 * Write-time enforcement of the monitoring-interval rules.
 *
 * MonitoringIntervalUtil owns the rules and is tested exhaustively on its own.
 * What is pinned here is the wiring: that every path which can store an
 * interval actually runs them, with the right monitor type and the right
 * billing flag - because the dashboard dropdown is not a control. Anyone can
 * POST a raw cron string, and before this change nothing in MonitorService
 * validated the field at all.
 */

let mockIsBillingEnabled: boolean = false;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actualEnvironmentConfig: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  );

  const mockedEnvironmentConfig: Record<string, unknown> = Object.assign(
    {},
    actualEnvironmentConfig,
    {
      __esModule: true,
    },
  );

  /*
   * defineProperty rather than a getter in the object literal: the literal
   * would be flattened by TypeScript's object-spread downlevelling
   * (Object.assign reads the getter once and stores its value), leaving the
   * flag permanently false.
   */
  Object.defineProperty(mockedEnvironmentConfig, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mockedEnvironmentConfig;
});

import MonitorService from "../../../Server/Services/MonitorService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type OnBeforeCreateFunction = (createBy: CreateBy<Monitor>) => Promise<unknown>;

const onBeforeCreate: OnBeforeCreateFunction = (
  createBy: CreateBy<Monitor>,
): Promise<unknown> => {
  return (MonitorService as any).onBeforeCreate(createBy);
};

type OnBeforeUpdateFunction = (updateBy: UpdateBy<Monitor>) => Promise<unknown>;

const onBeforeUpdate: OnBeforeUpdateFunction = (
  updateBy: UpdateBy<Monitor>,
): Promise<unknown> => {
  return (MonitorService as any).onBeforeUpdate(updateBy);
};

type MakeCreateByFunction = (data: {
  monitorType: MonitorType;
  monitoringInterval?: string | undefined;
}) => CreateBy<Monitor>;

const makeCreateBy: MakeCreateByFunction = (data: {
  monitorType: MonitorType;
  monitoringInterval?: string | undefined;
}): CreateBy<Monitor> => {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = data.monitorType;

  if (data.monitoringInterval) {
    monitor.monitoringInterval = data.monitoringInterval;
  }

  return {
    data: monitor,
    props: {
      tenantId: PROJECT_ID,
    },
  } as CreateBy<Monitor>;
};

type MakeUpdateByFunction = (data: {
  monitoringInterval?: string | undefined;
  monitorType?: MonitorType | undefined;
}) => UpdateBy<Monitor>;

const makeUpdateBy: MakeUpdateByFunction = (data: {
  monitoringInterval?: string | undefined;
  monitorType?: MonitorType | undefined;
}): UpdateBy<Monitor> => {
  const updateData: Record<string, unknown> = {};

  if (data.monitoringInterval) {
    updateData["monitoringInterval"] = data.monitoringInterval;
  }

  if (data.monitorType) {
    updateData["monitorType"] = data.monitorType;
  }

  return {
    query: {
      projectId: PROJECT_ID,
    },
    data: updateData,
    props: {
      tenantId: PROJECT_ID,
    },
    limit: 10,
    skip: 0,
  } as unknown as UpdateBy<Monitor>;
};

type MakeMonitorFunction = (monitorType: MonitorType) => Monitor;

const makeMonitor: MakeMonitorFunction = (
  monitorType: MonitorType,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = monitorType;
  return monitor;
};

describe("MonitorService monitoring interval validation", () => {
  beforeEach(() => {
    mockIsBillingEnabled = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockIsBillingEnabled = false;
  });

  describe("onBeforeCreate", () => {
    it("rejects a sub-minute interval when billing is enabled", async () => {
      mockIsBillingEnabled = true;

      await expect(
        onBeforeCreate(
          makeCreateBy({
            monitorType: MonitorType.Website,
            monitoringInterval: "*/10 * * * * *",
          }),
        ),
      ).rejects.toThrow(/self-hosted/);
    });

    it.each(["* * * * * *", "*/5 * * * * *"])(
      "rejects %s even when billing is disabled - ten seconds is the floor",
      async (monitoringInterval: string) => {
        await expect(
          onBeforeCreate(
            makeCreateBy({
              monitorType: MonitorType.Website,
              monitoringInterval: monitoringInterval,
            }),
          ),
        ).rejects.toThrow(/must be one of/);
      },
    );

    it("rejects a sub-minute interval that is not on the allow-list", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({
            monitorType: MonitorType.Website,
            monitoringInterval: "*/45 * * * * *",
          }),
        ),
      ).rejects.toThrow(/must be one of/);
    });

    it.each([
      MonitorType.SyntheticMonitor,
      MonitorType.CustomJavaScriptCode,
      MonitorType.SSLCertificate,
      MonitorType.Logs,
      MonitorType.Metrics,
      MonitorType.Kubernetes,
      MonitorType.Host,
    ])(
      "rejects a sub-minute interval for %s even when billing is disabled",
      async (monitorType: MonitorType) => {
        await expect(
          onBeforeCreate(
            makeCreateBy({
              monitorType: monitorType,
              monitoringInterval: "*/10 * * * * *",
            }),
          ),
        ).rejects.toThrow(/do not support sub-minute/);
      },
    );

    it("rejects an unparseable interval", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({
            monitorType: MonitorType.Website,
            monitoringInterval: "every ten seconds please",
          }),
        ),
      ).rejects.toThrow(/Invalid monitoring interval/);
    });

    it.each(["*/10 * * * * *", "*/20 * * * * *", "*/30 * * * * *"])(
      "accepts %s for a probe-polled monitor on a self-hosted instance",
      async (monitoringInterval: string) => {
        /*
         * The create hook keeps going into work that needs a database, so
         * what is asserted is that it does not fail on the interval - any
         * later failure is a different concern.
         */
        let thrownMessage: string = "";

        try {
          await onBeforeCreate(
            makeCreateBy({
              monitorType: MonitorType.Website,
              monitoringInterval: monitoringInterval,
            }),
          );
        } catch (err) {
          thrownMessage = (err as Error).message;
        }

        expect(thrownMessage).not.toMatch(/monitoring interval/i);
        expect(thrownMessage).not.toMatch(/self-hosted/);
        expect(thrownMessage).not.toMatch(/sub-minute/);
      },
    );

    it.each(["* * * * *", "*/5 * * * *", "0 0 * * *"])(
      "leaves the existing interval %s alone under both billing states",
      async (monitoringInterval: string) => {
        for (const isBillingEnabled of [true, false]) {
          mockIsBillingEnabled = isBillingEnabled;

          let thrownMessage: string = "";

          try {
            await onBeforeCreate(
              makeCreateBy({
                monitorType: MonitorType.Website,
                monitoringInterval: monitoringInterval,
              }),
            );
          } catch (err) {
            thrownMessage = (err as Error).message;
          }

          expect(thrownMessage).not.toMatch(/monitoring interval/i);
          expect(thrownMessage).not.toMatch(/sub-minute/);
        }
      },
    );
  });

  describe("onBeforeUpdate", () => {
    it("rejects a sub-minute interval when billing is enabled", async () => {
      mockIsBillingEnabled = true;

      await expect(
        onBeforeUpdate(makeUpdateBy({ monitoringInterval: "*/10 * * * * *" })),
      ).rejects.toThrow(/self-hosted/);
    });

    it.each(["* * * * * *", "*/5 * * * * *", "*/45 * * * * *"])(
      "rejects %s even when billing is disabled",
      async (monitoringInterval: string) => {
        await expect(
          onBeforeUpdate(
            makeUpdateBy({ monitoringInterval: monitoringInterval }),
          ),
        ).rejects.toThrow(/must be one of/);
      },
    );

    it("rejects an unparseable interval", async () => {
      await expect(
        onBeforeUpdate(makeUpdateBy({ monitoringInterval: "nonsense" })),
      ).rejects.toThrow(/Invalid monitoring interval/);
    });

    /*
     * The update payload usually carries only the interval, so the type check
     * has to look at the rows the query matches. This is also the path
     * MonitorTemplateService.syncLinkedMonitors takes when it pushes a
     * template's interval onto its monitors.
     */
    it("reads the matched monitors to check type eligibility for a sub-minute interval", async () => {
      const findBySpy: jest.SpyInstance<any, any> = getJestSpyOn(
        MonitorService,
        "findBy",
      ).mockResolvedValue([
        makeMonitor(MonitorType.Website),
        makeMonitor(MonitorType.SyntheticMonitor),
      ] as never);

      await expect(
        onBeforeUpdate(makeUpdateBy({ monitoringInterval: "*/10 * * * * *" })),
      ).rejects.toThrow(/do not support sub-minute/);

      expect(findBySpy).toHaveBeenCalled();
    });

    it("allows a sub-minute interval when every matched monitor is eligible", async () => {
      getJestSpyOn(MonitorService, "findBy").mockResolvedValue([
        makeMonitor(MonitorType.Website),
        makeMonitor(MonitorType.Ping),
        makeMonitor(MonitorType.API),
      ] as never);

      await expect(
        onBeforeUpdate(makeUpdateBy({ monitoringInterval: "*/20 * * * * *" })),
      ).resolves.toBeDefined();
    });

    it("does not read the database for a minute-or-coarser interval", async () => {
      const findBySpy: jest.SpyInstance<any, any> = getJestSpyOn(
        MonitorService,
        "findBy",
      ).mockResolvedValue([] as never);

      await expect(
        onBeforeUpdate(makeUpdateBy({ monitoringInterval: "*/5 * * * *" })),
      ).resolves.toBeDefined();

      expect(findBySpy).not.toHaveBeenCalled();
    });

    it("skips the extra read when the payload already carries the monitor type", async () => {
      const findBySpy: jest.SpyInstance<any, any> = getJestSpyOn(
        MonitorService,
        "findBy",
      ).mockResolvedValue([] as never);

      await expect(
        onBeforeUpdate(
          makeUpdateBy({
            monitoringInterval: "*/10 * * * * *",
            monitorType: MonitorType.Ping,
          }),
        ),
      ).resolves.toBeDefined();

      expect(findBySpy).not.toHaveBeenCalled();
    });

    it("rejects a sub-minute interval carried alongside an ineligible monitor type", async () => {
      await expect(
        onBeforeUpdate(
          makeUpdateBy({
            monitoringInterval: "*/10 * * * * *",
            monitorType: MonitorType.SyntheticMonitor,
          }),
        ),
      ).rejects.toThrow(/do not support sub-minute/);
    });

    it("does nothing when the update does not touch the interval", async () => {
      const findBySpy: jest.SpyInstance<any, any> = getJestSpyOn(
        MonitorService,
        "findBy",
      ).mockResolvedValue([] as never);

      await expect(onBeforeUpdate(makeUpdateBy({}))).resolves.toBeDefined();

      expect(findBySpy).not.toHaveBeenCalled();
    });

    it.each(["* * * * *", "*/5 * * * *", "0 0 * * 0"])(
      "leaves the existing interval %s alone under both billing states",
      async (monitoringInterval: string) => {
        for (const isBillingEnabled of [true, false]) {
          mockIsBillingEnabled = isBillingEnabled;

          await expect(
            onBeforeUpdate(
              makeUpdateBy({ monitoringInterval: monitoringInterval }),
            ),
          ).resolves.toBeDefined();
        }
      },
    );
  });
});
