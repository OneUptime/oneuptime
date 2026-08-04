/*
 * A monitor template stores a monitoring interval and pushes it onto every
 * monitor created from it (MonitorTemplateService.syncLinkedMonitors ->
 * MonitorService.updateBy). MonitorService.onBeforeUpdate would catch a bad
 * value at sync time, but by then it is already saved on the template and the
 * operator sees the failure somewhere far from where they typed it. These
 * tests pin the check at the template itself.
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

  Object.defineProperty(mockedEnvironmentConfig, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mockedEnvironmentConfig;
});

import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type OnBeforeCreateFunction = (
  createBy: CreateBy<MonitorTemplate>,
) => Promise<unknown>;

const onBeforeCreate: OnBeforeCreateFunction = (
  createBy: CreateBy<MonitorTemplate>,
): Promise<unknown> => {
  return (MonitorTemplateService as any).onBeforeCreate(createBy);
};

type OnBeforeUpdateFunction = (
  updateBy: UpdateBy<MonitorTemplate>,
) => Promise<unknown>;

const onBeforeUpdate: OnBeforeUpdateFunction = (
  updateBy: UpdateBy<MonitorTemplate>,
): Promise<unknown> => {
  return (MonitorTemplateService as any).onBeforeUpdate(updateBy);
};

type MakeCreateByFunction = (data: {
  monitorType: MonitorType;
  monitoringInterval: string;
}) => CreateBy<MonitorTemplate>;

const makeCreateBy: MakeCreateByFunction = (data: {
  monitorType: MonitorType;
  monitoringInterval: string;
}): CreateBy<MonitorTemplate> => {
  const template: MonitorTemplate = new MonitorTemplate();
  template.monitorType = data.monitorType;
  template.monitoringInterval = data.monitoringInterval;

  return {
    data: template,
    props: {
      tenantId: PROJECT_ID,
    },
  } as CreateBy<MonitorTemplate>;
};

type MakeUpdateByFunction = (data: {
  monitoringInterval?: string | undefined;
  monitorType?: MonitorType | undefined;
}) => UpdateBy<MonitorTemplate>;

const makeUpdateBy: MakeUpdateByFunction = (data: {
  monitoringInterval?: string | undefined;
  monitorType?: MonitorType | undefined;
}): UpdateBy<MonitorTemplate> => {
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
  } as unknown as UpdateBy<MonitorTemplate>;
};

type MakeTemplateFunction = (monitorType: MonitorType) => MonitorTemplate;

const makeTemplate: MakeTemplateFunction = (
  monitorType: MonitorType,
): MonitorTemplate => {
  const template: MonitorTemplate = new MonitorTemplate();
  template.monitorType = monitorType;
  return template;
};

describe("MonitorTemplateService monitoring interval validation", () => {
  beforeEach(() => {
    mockIsBillingEnabled = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockIsBillingEnabled = false;
  });

  describe("onBeforeCreate", () => {
    it("accepts a supported sub-minute interval on a self-hosted instance", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({
            monitorType: MonitorType.Website,
            monitoringInterval: "*/20 * * * * *",
          }),
        ),
      ).resolves.toBeDefined();
    });

    it("rejects a sub-minute interval when billing is enabled", async () => {
      mockIsBillingEnabled = true;

      await expect(
        onBeforeCreate(
          makeCreateBy({
            monitorType: MonitorType.Website,
            monitoringInterval: "*/20 * * * * *",
          }),
        ),
      ).rejects.toThrow(/self-hosted/);
    });

    it.each(["* * * * * *", "*/5 * * * * *", "*/45 * * * * *"])(
      "rejects %s even when billing is disabled",
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

    it("rejects a sub-minute interval for an ineligible monitor type", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({
            monitorType: MonitorType.SyntheticMonitor,
            monitoringInterval: "*/10 * * * * *",
          }),
        ),
      ).rejects.toThrow(/do not support sub-minute/);
    });

    it.each(["* * * * *", "*/5 * * * *", "0 0 * * *"])(
      "leaves the existing interval %s alone under both billing states",
      async (monitoringInterval: string) => {
        for (const isBillingEnabled of [true, false]) {
          mockIsBillingEnabled = isBillingEnabled;

          await expect(
            onBeforeCreate(
              makeCreateBy({
                monitorType: MonitorType.Website,
                monitoringInterval: monitoringInterval,
              }),
            ),
          ).resolves.toBeDefined();
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

    it("checks the matched templates' monitor types when the payload omits them", async () => {
      const findBySpy: jest.SpyInstance<any, any> = getJestSpyOn(
        MonitorTemplateService,
        "findBy",
      ).mockResolvedValue([
        makeTemplate(MonitorType.Website),
        makeTemplate(MonitorType.CustomJavaScriptCode),
      ] as never);

      await expect(
        onBeforeUpdate(makeUpdateBy({ monitoringInterval: "*/10 * * * * *" })),
      ).rejects.toThrow(/do not support sub-minute/);

      expect(findBySpy).toHaveBeenCalled();
    });

    it("allows a sub-minute interval when every matched template is eligible", async () => {
      getJestSpyOn(MonitorTemplateService, "findBy").mockResolvedValue([
        makeTemplate(MonitorType.Website),
        makeTemplate(MonitorType.Ping),
      ] as never);

      await expect(
        onBeforeUpdate(makeUpdateBy({ monitoringInterval: "*/30 * * * * *" })),
      ).resolves.toBeDefined();
    });

    it("does not read the database for a minute-or-coarser interval", async () => {
      const findBySpy: jest.SpyInstance<any, any> = getJestSpyOn(
        MonitorTemplateService,
        "findBy",
      ).mockResolvedValue([] as never);

      await expect(
        onBeforeUpdate(makeUpdateBy({ monitoringInterval: "*/15 * * * *" })),
      ).resolves.toBeDefined();

      expect(findBySpy).not.toHaveBeenCalled();
    });

    it("does nothing when the update does not touch the interval", async () => {
      const findBySpy: jest.SpyInstance<any, any> = getJestSpyOn(
        MonitorTemplateService,
        "findBy",
      ).mockResolvedValue([] as never);

      await expect(onBeforeUpdate(makeUpdateBy({}))).resolves.toBeDefined();

      expect(findBySpy).not.toHaveBeenCalled();
    });
  });
});
