import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/GlobalConfig";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import ObjectID from "../../Types/ObjectID";
import { OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import UpdateBy from "../Types/Database/UpdateBy";
import BadDataException from "../../Types/Exception/BadDataException";

export class Service extends DatabaseService<Model> {
  /*
   * Caches the instance-wide "Require SSO for Login" flag. This is read on the
   * authenticated request path (per project), so it must not hit Postgres every
   * time. Refreshed at most once per 60s and invalidated on update below.
   */
  private requireSsoForLoginCache: InMemoryTTLCache<boolean> =
    new InMemoryTTLCache(10_000);

  public constructor() {
    super(Model);
  }

  /*
   * Instance-wide: must every user sign in with SSO to access projects?
   * (Master admins are exempted by the enforcement layer, not here.)
   */
  @CaptureSpan()
  public async getRequireSsoForLogin(): Promise<boolean> {
    const key: string = "global";
    const cached: boolean | undefined = this.requireSsoForLoginCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const config: Model | null = await this.findOneBy({
      query: {},
      select: { requireSsoForLogin: true },
      props: { isRoot: true },
    });

    const value: boolean = Boolean(config?.requireSsoForLogin);
    this.requireSsoForLoginCache.set(key, value, 60_000);
    return value;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const capacitySettingKeys: Array<keyof Model> = [
      "clickhouseCapacityNotificationEnabled",
      "clickhouseCapacityNotificationThresholdPercent",
      "clickhouseDataPruningEnabled",
      "clickhouseDataPruningThresholdPercent",
      "clickhouseDataPruningTargetPercent",
    ];

    const isCapacitySettingUpdate: boolean = capacitySettingKeys.some(
      (key: keyof Model): boolean => {
        return updateBy.data[key] !== undefined;
      },
    );

    if (!isCapacitySettingUpdate) {
      return {
        updateBy,
        carryForward: null,
      };
    }

    /*
     * GlobalConfig updates are partial. Load the current singleton values so
     * cross-field validation still compares the effective pruning threshold
     * and target when the request changes only one of them.
     */
    const currentConfig: Model | null = await this.findOneBy({
      query: updateBy.query,
      select: {
        clickhouseCapacityNotificationThresholdPercent: true,
        clickhouseDataPruningThresholdPercent: true,
        clickhouseDataPruningTargetPercent: true,
      },
      props: {
        isRoot: true,
      },
    });

    const normalizePercent: (value: unknown, fieldName: string) => number = (
      value: unknown,
      fieldName: string,
    ): number => {
      let normalizedValue: unknown = value;

      if (typeof normalizedValue === "string") {
        const trimmedValue: string = normalizedValue.trim();
        normalizedValue =
          trimmedValue === "" ? Number.NaN : Number(trimmedValue);
      }

      if (
        typeof normalizedValue !== "number" ||
        !Number.isFinite(normalizedValue) ||
        !Number.isInteger(normalizedValue) ||
        normalizedValue < 1 ||
        normalizedValue > 100
      ) {
        throw new BadDataException(
          `${fieldName} must be an integer between 1 and 100.`,
        );
      }

      return normalizedValue;
    };

    if (
      updateBy.data.clickhouseCapacityNotificationThresholdPercent !== undefined
    ) {
      updateBy.data.clickhouseCapacityNotificationThresholdPercent =
        normalizePercent(
          updateBy.data
            .clickhouseCapacityNotificationThresholdPercent as unknown,
          "ClickHouse capacity notification threshold",
        );
    }

    if (updateBy.data.clickhouseDataPruningThresholdPercent !== undefined) {
      updateBy.data.clickhouseDataPruningThresholdPercent = normalizePercent(
        updateBy.data.clickhouseDataPruningThresholdPercent as unknown,
        "ClickHouse data pruning threshold",
      );
    }

    if (updateBy.data.clickhouseDataPruningTargetPercent !== undefined) {
      updateBy.data.clickhouseDataPruningTargetPercent = normalizePercent(
        updateBy.data.clickhouseDataPruningTargetPercent as unknown,
        "ClickHouse data pruning target",
      );
    }

    const getEffectivePercent: (
      updatedValue: unknown,
      currentValue: number | undefined,
      defaultValue: number,
      fieldName: string,
    ) => number = (
      updatedValue: unknown,
      currentValue: number | undefined,
      defaultValue: number,
      fieldName: string,
    ): number => {
      const value: unknown =
        updatedValue !== undefined
          ? updatedValue
          : currentValue ?? defaultValue;

      return normalizePercent(value, fieldName);
    };

    getEffectivePercent(
      updateBy.data.clickhouseCapacityNotificationThresholdPercent,
      currentConfig?.clickhouseCapacityNotificationThresholdPercent,
      80,
      "ClickHouse capacity notification threshold",
    );

    const pruningThresholdPercent: number = getEffectivePercent(
      updateBy.data.clickhouseDataPruningThresholdPercent,
      currentConfig?.clickhouseDataPruningThresholdPercent,
      90,
      "ClickHouse data pruning threshold",
    );

    const pruningTargetPercent: number = getEffectivePercent(
      updateBy.data.clickhouseDataPruningTargetPercent,
      currentConfig?.clickhouseDataPruningTargetPercent,
      80,
      "ClickHouse data pruning target",
    );

    if (pruningTargetPercent >= pruningThresholdPercent) {
      throw new BadDataException(
        "ClickHouse data pruning target must be lower than the pruning threshold.",
      );
    }

    return {
      updateBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (
      (onUpdate.updateBy.data as { requireSsoForLogin?: unknown })
        .requireSsoForLogin !== undefined
    ) {
      this.requireSsoForLoginCache.clear();
    }

    return onUpdate;
  }
}

export default new Service();
