import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import BadDataException from "../../../Types/Exception/BadDataException";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

type GlobalConfigServiceWithUpdateHook = {
  onBeforeUpdate(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<OnUpdate<GlobalConfig>>;
};

function makeUpdateBy(data: Record<string, unknown>): UpdateBy<GlobalConfig> {
  return {
    query: {},
    data,
    limit: 1,
    skip: 0,
    props: {
      isRoot: true,
    },
  } as unknown as UpdateBy<GlobalConfig>;
}

describe("GlobalConfigService ClickHouse capacity settings", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("normalizes integer form strings before persisting", async () => {
    jest.spyOn(GlobalConfigService, "findOneBy").mockResolvedValue({
      clickhouseCapacityNotificationThresholdPercent: 80,
      clickhouseDataPruningThresholdPercent: 90,
      clickhouseDataPruningTargetPercent: 80,
    } as GlobalConfig);

    const result: OnUpdate<GlobalConfig> = await (
      GlobalConfigService as unknown as GlobalConfigServiceWithUpdateHook
    ).onBeforeUpdate(
      makeUpdateBy({
        clickhouseCapacityNotificationThresholdPercent: "85",
        clickhouseDataPruningThresholdPercent: "95",
        clickhouseDataPruningTargetPercent: "75",
      }),
    );

    expect(
      result.updateBy.data.clickhouseCapacityNotificationThresholdPercent,
    ).toBe(85);
    expect(result.updateBy.data.clickhouseDataPruningThresholdPercent).toBe(95);
    expect(result.updateBy.data.clickhouseDataPruningTargetPercent).toBe(75);
  });

  test("rejects a normalized target that is not below the trigger", async () => {
    jest.spyOn(GlobalConfigService, "findOneBy").mockResolvedValue({
      clickhouseCapacityNotificationThresholdPercent: 80,
      clickhouseDataPruningThresholdPercent: 90,
      clickhouseDataPruningTargetPercent: 80,
    } as GlobalConfig);

    await expect(
      (
        GlobalConfigService as unknown as GlobalConfigServiceWithUpdateHook
      ).onBeforeUpdate(
        makeUpdateBy({
          clickhouseDataPruningThresholdPercent: "85",
          clickhouseDataPruningTargetPercent: "85",
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });
});
