import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/GlobalConfig";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import ObjectID from "../../Types/ObjectID";
import { OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import UpdateBy from "../Types/Database/UpdateBy";
import BadDataException from "../../Types/Exception/BadDataException";
import TelegramVerificationToken from "../Utils/TelegramVerificationToken";
import GlobalCache from "../Infrastructure/GlobalCache";

const TELEGRAM_WEBHOOK_SECRET_CACHE_NAMESPACE: string =
  "global-config-security";
const TELEGRAM_WEBHOOK_SECRET_GENERATION_KEY: string =
  "telegram-webhook-secret-generation";
const TELEGRAM_WEBHOOK_SECRET_INITIAL_GENERATION: string = "initial";
const TELEGRAM_WEBHOOK_SECRET_MISSING_VALUE: string = "__not_configured__";
const TELEGRAM_WEBHOOK_SECRET_CACHE_TTL_SECONDS: number = 5;

interface TelegramWebhookSecretTokenLoadResult {
  value: string | undefined;
  isCurrentGeneration: boolean;
}

interface TelegramWebhookSecretTokenLoad {
  generation: string;
  promise: Promise<TelegramWebhookSecretTokenLoadResult>;
}

export class Service extends DatabaseService<Model> {
  /*
   * Caches the instance-wide "Require SSO for Login" flag. This is read on the
   * authenticated request path (per project), so it must not hit Postgres every
   * time. Refreshed at most once per 60s and invalidated on update below.
   */
  private requireSsoForLoginCache: InMemoryTTLCache<boolean> =
    new InMemoryTTLCache(10_000);
  /*
   * The public Telegram webhook is hit without a OneUptime session. The value
   * cache lives in Redis so every app replica observes the same generation.
   * Only the in-flight promise is process-local: it collapses a cache-miss
   * burst to one Postgres read per replica without retaining a retired secret.
   */
  private telegramWebhookSecretTokenLoad:
    | TelegramWebhookSecretTokenLoad
    | undefined = undefined;

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
  public async getTelegramWebhookSecretToken(): Promise<string | undefined> {
    while (true) {
      const generation: string =
        await this.getTelegramWebhookSecretTokenGeneration();
      const cacheKey: string =
        this.getTelegramWebhookSecretTokenCacheKey(generation);
      const cached: string | null = await GlobalCache.getString(
        TELEGRAM_WEBHOOK_SECRET_CACHE_NAMESPACE,
        cacheKey,
      );

      if (cached !== null) {
        return cached === TELEGRAM_WEBHOOK_SECRET_MISSING_VALUE
          ? undefined
          : cached;
      }

      const existingLoad: TelegramWebhookSecretTokenLoad | undefined =
        this.telegramWebhookSecretTokenLoad;

      /*
       * Cache expiry is visible to every public webhook request at once. Share
       * the database read for that generation so a burst cannot turn one
       * expiry into one root Postgres query per request.
       */
      const load: TelegramWebhookSecretTokenLoad =
        existingLoad?.generation === generation
          ? existingLoad
          : {
              generation,
              promise: this.loadTelegramWebhookSecretToken(
                generation,
                cacheKey,
              ),
            };

      if (load !== existingLoad) {
        this.telegramWebhookSecretTokenLoad = load;
      }

      try {
        const result: TelegramWebhookSecretTokenLoadResult = await load.promise;

        /*
         * A rotation that completed during the database read makes the result
         * unreachable through the new generation key. Loop so this request
         * also joins the new generation instead of authenticating with the
         * value that was retired while it waited.
         */
        if (result.isCurrentGeneration) {
          return result.value;
        }
      } finally {
        /*
         * An invalidation can start a newer-generation load while this one is
         * still pending. The older promise must not clear that newer flight.
         */
        if (this.telegramWebhookSecretTokenLoad === load) {
          this.telegramWebhookSecretTokenLoad = undefined;
        }
      }
    }
  }

  private async getTelegramWebhookSecretTokenGeneration(): Promise<string> {
    return (
      (await GlobalCache.getString(
        TELEGRAM_WEBHOOK_SECRET_CACHE_NAMESPACE,
        TELEGRAM_WEBHOOK_SECRET_GENERATION_KEY,
      )) || TELEGRAM_WEBHOOK_SECRET_INITIAL_GENERATION
    );
  }

  private getTelegramWebhookSecretTokenCacheKey(generation: string): string {
    return `telegram-webhook-secret:${generation}`;
  }

  private async loadTelegramWebhookSecretToken(
    generation: string,
    cacheKey: string,
  ): Promise<TelegramWebhookSecretTokenLoadResult> {
    const config: Model | null = await this.findOneBy({
      query: {
        _id: ObjectID.getZeroObjectID().toString(),
      },
      select: {
        telegramWebhookSecretToken: true,
      },
      props: {
        isRoot: true,
      },
    });
    const value: string | undefined =
      config?.telegramWebhookSecretToken?.trim() || undefined;

    /*
     * A read begun before a rotation may return after the update has committed.
     * Check the shared generation before populating Redis; an old replica can
     * still finish its query, but it cannot republish the retired value under
     * the generation every other replica now reads.
     */
    if (generation !== (await this.getTelegramWebhookSecretTokenGeneration())) {
      return {
        value: undefined,
        isCurrentGeneration: false,
      };
    }

    await GlobalCache.setString(
      TELEGRAM_WEBHOOK_SECRET_CACHE_NAMESPACE,
      cacheKey,
      value || TELEGRAM_WEBHOOK_SECRET_MISSING_VALUE,
      { expiresInSeconds: TELEGRAM_WEBHOOK_SECRET_CACHE_TTL_SECONDS },
    );

    return {
      value,
      isCurrentGeneration:
        generation === (await this.getTelegramWebhookSecretTokenGeneration()),
    };
  }

  private async rotateTelegramWebhookSecretTokenGeneration(): Promise<void> {
    await GlobalCache.setString(
      TELEGRAM_WEBHOOK_SECRET_CACHE_NAMESPACE,
      TELEGRAM_WEBHOOK_SECRET_GENERATION_KEY,
      ObjectID.generate().toString(),
    );
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.telegramWebhookSecretToken !== undefined) {
      const secret: unknown = updateBy.data.telegramWebhookSecretToken;

      if (
        secret !== null &&
        secret !== "" &&
        !TelegramVerificationToken.isWebhookSecretStrong(secret)
      ) {
        throw new BadDataException(
          "Telegram webhook secret token must be 32-100 characters and contain only letters, numbers, underscores, or hyphens.",
        );
      }

      if (typeof secret === "string") {
        updateBy.data.telegramWebhookSecretToken = secret.trim();
      }

      /*
       * Move every replica to a fresh shared generation before the write. A
       * request during the transaction may still read the currently committed
       * secret, but it cannot repopulate the generation used before rotation.
       * The success hook rotates once more after commit. If the write fails,
       * this generation simply continues to cache the still-valid old value.
       */
      await this.rotateTelegramWebhookSecretTokenGeneration();
    }

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

    if (
      (onUpdate.updateBy.data as { telegramWebhookSecretToken?: unknown })
        .telegramWebhookSecretToken !== undefined
    ) {
      await this.rotateTelegramWebhookSecretTokenGeneration();
    }

    return onUpdate;
  }
}

export default new Service();
