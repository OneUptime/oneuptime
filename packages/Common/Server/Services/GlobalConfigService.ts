import DatabaseService from "./DatabaseService";
import { StatementContext } from "../Utils/Database/StatementOutcome";
import Model from "../../Models/DatabaseModels/GlobalConfig";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import ObjectID from "../../Types/ObjectID";
import { OnCreate, OnFind, OnUpdate } from "../Types/Database/Hooks";
import FindBy from "../Types/Database/FindBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TelegramVerificationToken from "../Utils/TelegramVerificationToken";
import GlobalCache from "../Infrastructure/GlobalCache";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../Utils/Realtime/RealtimeAccessChanges";
import { clearGlobalSsoAuthorizationCaches } from "../Utils/GlobalSsoAuthorization";
import SsoRequirementChanges from "../Utils/SsoRequirementChanges";
import Exception from "../../Types/Exception/Exception";
import TwilioPhoneNumbers from "../../Types/CallAndSMS/TwilioPhoneNumbers";
import TwilioConfigUses from "../../Types/CallAndSMS/TwilioConfigUse";
import TwilioConfigWrite, {
  TwilioUseAndNumbers,
} from "../../Types/CallAndSMS/TwilioConfigWrite";
import { GLOBAL_TWILIO_CONFIG_USE_SELECT } from "../Utils/TwilioConfigSelect";
import CallAndSmsProviders, {
  CALL_AND_SMS_GATEWAY_URL_TITLE,
} from "../../Types/CallAndSMS/CallAndSmsProvider";
import SSRFProtection from "../Utils/SSRFProtection";
import crypto from "crypto";

/*
 * How long a server keeps whether push notifications are turned off before
 * it reads the switch again: the push sender asks for every push. A write
 * drops this server's copy at once; another server's runs out within this.
 */
export const PUSH_NOTIFICATIONS_TURNED_OFF_CACHE_TTL_MS: number = 10_000;

/*
 * A gateway's signing secret: 32 random bytes as 64 hex digits, as a custom
 * channel's is (CustomNotificationChannelService.generateSecret).
 */
const CALL_AND_SMS_GATEWAY_SECRET_BYTES: number = 32;

// The gateway's columns, stored or a write's.
interface CallAndSmsGatewayColumns {
  callAndSmsProvider?: unknown;
  callAndSmsGatewayUrl?: unknown;
  callAndSmsGatewaySecret?: unknown;
}

// The columns of the server's Twilio account - stored, or a write's - its numbers' check reads.
interface TwilioAccountColumns {
  twilioUsedFor?: unknown;
  twilioAccountSID?: unknown;
  twilioPrimaryPhoneNumber?: unknown;
  twilioSmsPhoneNumbers?: unknown;
}

// The server account's use and numbers, as TwilioConfigWrite reads them.
const twilioUseAndNumbersOf: (
  config: TwilioAccountColumns,
) => TwilioUseAndNumbers = (
  config: TwilioAccountColumns,
): TwilioUseAndNumbers => {
  return {
    use: config.twilioUsedFor,
    primaryPhoneNumber: config.twilioPrimaryPhoneNumber,
    smsPhoneNumbers: config.twilioSmsPhoneNumbers,
  };
};

/*
 * The columns that hold this installation's license state and identity. They
 * are written only by OneUptime itself - the license client (activation,
 * refresh, the daily usage report), the first-boot stamp of the Enterprise
 * Edition and the data migrations - and every one of those writes runs with
 * isRoot. A master admin reaches GlobalConfig through the generic CRUD API
 * too, and master admins bypass the (empty) column ACLs, so without this list
 * one PUT could forge a license expiry, raise the seat limit, restart the
 * unlicensed trial or swap the instance id an instance-bound license
 * is checked against.
 *
 * enterpriseLicenseNotificationEmail and enterpriseLicenseExpiryReminderDays
 * are deliberately NOT here: they are settings the oneuptime.com admin edits
 * from the Admin Dashboard.
 */
export const ROOT_ONLY_LICENSE_COLUMNS: ReadonlyArray<keyof Model> = [
  "instanceId",
  "enterpriseCompanyName",
  "enterpriseLicenseKey",
  "enterpriseLicenseExpiresAt",
  "enterpriseLicenseToken",
  "enterpriseLicenseIsEvaluation",
  "enterpriseLicenseUserLimit",
  "enterpriseLicenseCurrentUserCount",
  "enterpriseLicenseUserCountUpdatedAt",
  "enterpriseLicenseInstances",
  "enterpriseEditionFirstSeenAt",
  /*
   * A self-hosted installation billed through a cloud marketplace is
   * licensed by the marketplace's answers recorded here (verifiedAt): a
   * forged one would license the installation for free.
   */
  "enterpriseMarketplaceBilling",
];

/*
 * The installation's branding (GlobalConfig.branding*). The enterprise module
 * writes and reads them, as root, behind its own checks of whether this
 * installation may change its branding at all; the generic API neither
 * writes them (assertBrandingColumnsWrittenByRootOnly) nor reads them back
 * (onBeforeFind drops them), so a value stored while it was allowed is never
 * served once it is not.
 */
export const ROOT_ONLY_BRANDING_COLUMNS: ReadonlyArray<keyof Model> = [
  "brandingProductName",
  "brandingWebsiteUrl",
  "brandingLogo",
  "brandingDarkLogo",
  "brandingFavicon",
  "brandingUpdatedAt",
];

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
   * The one read of the server's Require SSO for Login in flight, if any:
   * when the minute runs out - or the rule is forgotten, and every page's
   * live updates are asked again at once - every request that asks shares
   * it, rather than each reading the row. A read is kept only while it is
   * still the current one: forgetting the rule clears the slot, so a read
   * that was on the wire when the rule changed answers its own callers but
   * never puts the old rule back for the minute.
   */
  private requireSsoForLoginLookup: Promise<boolean> | null = null;
  /*
   * The public Telegram webhook is hit without a OneUptime session. The value
   * cache lives in Redis so every app replica observes the same generation.
   * Only the in-flight promise is process-local: it collapses a cache-miss
   * burst to one Postgres read per replica without retaining a retired secret.
   */
  private telegramWebhookSecretTokenLoad:
    | TelegramWebhookSecretTokenLoad
    | undefined = undefined;
  /*
   * This server's copy of whether push notifications are turned off for the
   * whole server (GlobalConfig.disablePushNotifications), for
   * PUSH_NOTIFICATIONS_TURNED_OFF_CACHE_TTL_MS, dropped when it is written.
   */
  private pushNotificationsTurnedOffCache: InMemoryTTLCache<boolean> =
    new InMemoryTTLCache(1);

  public constructor() {
    super(Model);
  }

  /*
   * Whether push notifications are turned off for the whole server. Throws
   * when it cannot be read, and keeps nothing: the push sender refuses
   * rather than take a failed read for "on", since the switch is there for
   * installations whose rules let nothing out through the push services.
   */
  @CaptureSpan()
  public async getPushNotificationsTurnedOff(): Promise<boolean> {
    const key: string = "global";
    const cached: boolean | undefined =
      this.pushNotificationsTurnedOffCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const config: Model | null = await this.findOneBy({
      query: {},
      select: { disablePushNotifications: true },
      props: { isRoot: true },
    });

    const value: boolean = Boolean(config?.disablePushNotifications);

    this.pushNotificationsTurnedOffCache.set(
      key,
      value,
      PUSH_NOTIFICATIONS_TURNED_OFF_CACHE_TTL_MS,
    );

    return value;
  }

  // Drops this server's copy of the push switch, so the next push reads it.
  public forgetPushNotificationsTurnedOff(): void {
    this.pushNotificationsTurnedOffCache.clear();
  }

  // A new signing secret for the server's SMS and call gateway.
  public static generateCallAndSmsGatewaySecret(): string {
    return crypto
      .randomBytes(CALL_AND_SMS_GATEWAY_SECRET_BYTES)
      .toString("hex");
  }

  /*
   * Drops this server's cached instance-wide sign-in rules - Require SSO for
   * Login, and what it knows of the global SSO and OIDC providers (whether
   * each is on, and the projects it signs people in to) - so the next
   * request reads them again. Called when they change, here or on another
   * server (RealtimeAccessChanges).
   */
  public forgetSignInRules(): void {
    this.forgetRequireSsoForLogin();
    clearGlobalSsoAuthorizationCaches();
  }

  // Drops this server's copy of Require SSO for Login, and the read in flight.
  private forgetRequireSsoForLogin(): void {
    this.requireSsoForLoginCache.clear();
    this.requireSsoForLoginLookup = null;
  }

  /*
   * Instance-wide: must every user sign in with SSO to access projects?
   * (Master admins are exempted by the enforcement layer, not here.) Kept
   * for 60s, or read from the row - by one read for every caller asking at
   * once. Throws when it cannot be read, and keeps nothing: a read that
   * fails is no answer, and callers refuse rather than take it for "not
   * required" (UserMiddleware.getUserTenantAccessPermissionWithTenantId).
   */
  @CaptureSpan()
  public async getRequireSsoForLogin(): Promise<boolean> {
    const key: string = "global";
    const cached: boolean | undefined = this.requireSsoForLoginCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const inFlight: Promise<boolean> | null = this.requireSsoForLoginLookup;

    if (inFlight) {
      return await inFlight;
    }

    const lookup: Promise<boolean> = this.findOneBy({
      query: {},
      select: { requireSsoForLogin: true },
      props: { isRoot: true },
    })
      .then((config: Model | null): boolean => {
        const value: boolean = Boolean(config?.requireSsoForLogin);

        // Only while this read is still the current one (see requireSsoForLoginLookup).
        if (this.requireSsoForLoginLookup === lookup) {
          this.requireSsoForLoginCache.set(key, value, 60_000);
        }

        return value;
      })
      .finally((): void => {
        if (this.requireSsoForLoginLookup === lookup) {
          this.requireSsoForLoginLookup = null;
        }
      });

    this.requireSsoForLoginLookup = lookup;

    return await lookup;
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

  /*
   * Refuses any write to ROOT_ONLY_LICENSE_COLUMNS that does not come from
   * OneUptime itself. An explicit null counts as a write: clearing the license
   * token is as much a forgery as setting one.
   */
  public assertLicenseColumnsWrittenByRootOnly(
    data: unknown,
    props: DatabaseCommonInteractionProps,
  ): void {
    if (props.isRoot) {
      return;
    }

    const writtenColumns: Array<string> = ROOT_ONLY_LICENSE_COLUMNS.filter(
      (column: keyof Model): boolean => {
        return (
          (data as Record<string, unknown>)[column as string] !== undefined
        );
      },
    ).map((column: keyof Model): string => {
      return column as string;
    });

    if (writtenColumns.length === 0) {
      return;
    }

    throw new NotAuthorizedException(
      `${writtenColumns.join(", ")} can only be changed by OneUptime itself. ` +
        "Use the license dialog in the Admin Dashboard to activate or refresh the Enterprise license.",
    );
  }

  /*
   * Refuses any write to ROOT_ONLY_BRANDING_COLUMNS that does not come from
   * OneUptime itself. The refusal is the generic "not allowed" a column a
   * caller may not write gets, naming no column: the generic API must not
   * confirm that these columns exist.
   */
  public assertBrandingColumnsWrittenByRootOnly(
    data: unknown,
    props: DatabaseCommonInteractionProps,
  ): void {
    if (props.isRoot) {
      return;
    }

    const isWritten: boolean = ROOT_ONLY_BRANDING_COLUMNS.some(
      (column: keyof Model): boolean => {
        return (
          (data as Record<string, unknown>)[column as string] !== undefined
        );
      },
    );

    if (isWritten) {
      throw new NotAuthorizedException(
        "You do not have permission to change these settings.",
      );
    }
  }

  /*
   * The branding columns, removed from what a caller other than OneUptime
   * itself selects or filters on: read back through the generic API, they
   * would show values the enterprise module has decided not to apply.
   */
  public dropBrandingColumnsFromRead(findBy: FindBy<Model>): FindBy<Model> {
    if (findBy.props.isRoot) {
      return findBy;
    }

    const without: <T>(value: T) => T = <T>(value: T): T => {
      if (!value || typeof value !== "object") {
        return value;
      }

      const copy: Record<string, unknown> = {
        ...(value as unknown as Record<string, unknown>),
      };

      for (const column of ROOT_ONLY_BRANDING_COLUMNS) {
        delete copy[column as string];
      }

      return copy as unknown as T;
    };

    return {
      ...findBy,
      select: without(findBy.select),
      query: without(findBy.query),
    };
  }

  /*
   * The server's numbers for SMS (Admin Dashboard > Settings > Call and
   * SMS), refused when they are typed rather than when an alert goes out -
   * as a project's are (ProjectCallSMSConfigService).
   */
  private assertTwilioSmsNumbersAreValid(
    data: CreateBy<Model>["data"] | UpdateBy<Model>["data"],
  ): void {
    TwilioPhoneNumbers.assertListIsValid({
      title: "Twilio SMS Phone Numbers",
      text: (data as { twilioSmsPhoneNumbers?: unknown }).twilioSmsPhoneNumbers,
    });
  }

  /*
   * What the server's Twilio account is used for (calls and SMS, SMS only
   * or calls only - Types/CallAndSMS/TwilioConfigUse) must be one of the
   * uses.
   */
  private assertTwilioUseIsValid(
    data: CreateBy<Model>["data"] | UpdateBy<Model>["data"],
  ): void {
    const error: string | null = TwilioConfigUses.getUseError(
      (data as { twilioUsedFor?: unknown }).twilioUsedFor,
    );

    if (error) {
      throw new BadDataException(error);
    }
  }

  /*
   * An update that changes what the server's Twilio account is used for,
   * or its number or SMS numbers, leaves an account that is set up - one
   * with an account SID - with the numbers that use takes, as a project's
   * config must have them (ProjectCallSMSConfigService, TwilioConfigWrite):
   * a number to make calls from unless it is used for SMS only, and SMS
   * numbers when it is. Without an account SID nothing goes through it, and
   * the numbers are not asked for. An update that changes none of them is
   * let through as it always was.
   */
  private async assertTwilioNumbersKeptForUse(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: TwilioAccountColumns = updateBy.data as TwilioAccountColumns;
    const written: TwilioUseAndNumbers = twilioUseAndNumbersOf(data);

    if (TwilioConfigWrite.getWrittenKeys(written).length === 0) {
      return;
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      GLOBAL_TWILIO_CONFIG_USE_SELECT,
    );

    for (const row of rows) {
      const accountSid: unknown =
        data.twilioAccountSID !== undefined
          ? data.twilioAccountSID
          : row.twilioAccountSID;

      // No account: nothing goes through it, whatever its numbers.
      if (!accountSid || !String(accountSid).trim()) {
        continue;
      }

      const error: string | null = TwilioConfigWrite.getUpdateError({
        stored: twilioUseAndNumbersOf(row),
        written: written,
      });

      if (error) {
        throw new BadDataException(error);
      }
    }
  }

  /*
   * What the server sends its SMS and calls through (Twilio, or its own
   * gateway - Types/CallAndSMS/CallAndSmsProvider) must be one of the two.
   */
  private assertCallAndSmsProviderIsValid(
    data: CreateBy<Model>["data"] | UpdateBy<Model>["data"],
  ): void {
    const error: string | null = CallAndSmsProviders.getProviderError(
      (data as CallAndSmsGatewayColumns).callAndSmsProvider,
    );

    if (error) {
      throw new BadDataException(error);
    }
  }

  /*
   * An update that touches the SMS and call gateway leaves one the server
   * can send through. Its URL is a web address OneUptime may post to - on
   * the installation's private network too, where a gateway usually is, as
   * a custom channel's may be (SSRFProtection) - and there is one whenever
   * the server is set to send through the gateway. Whenever there is a URL
   * there is a signing secret: made here when there is none, or when it is
   * cleared, which is how an admin replaces it. An update that touches none
   * of the three is let through as it always was.
   */
  private async prepareCallAndSmsGateway(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: CallAndSmsGatewayColumns =
      updateBy.data as CallAndSmsGatewayColumns;

    if (
      data.callAndSmsProvider === undefined &&
      data.callAndSmsGatewayUrl === undefined &&
      data.callAndSmsGatewaySecret === undefined
    ) {
      return;
    }

    if (data.callAndSmsGatewayUrl !== undefined) {
      if (
        data.callAndSmsGatewayUrl !== null &&
        typeof data.callAndSmsGatewayUrl !== "string"
      ) {
        throw new BadDataException(
          `${CALL_AND_SMS_GATEWAY_URL_TITLE} must be a web address.`,
        );
      }

      const url: string = (data.callAndSmsGatewayUrl || "").trim();

      if (url) {
        await SSRFProtection.validateWebhookTargetIsSafe(url, {
          allowPrivateNetworkTargets: true,
        });
      }

      data.callAndSmsGatewayUrl = url || null;
    }

    if (data.callAndSmsGatewaySecret !== undefined) {
      if (
        data.callAndSmsGatewaySecret !== null &&
        typeof data.callAndSmsGatewaySecret !== "string"
      ) {
        throw new BadDataException("Gateway Signing Secret must be text.");
      }

      data.callAndSmsGatewaySecret =
        (data.callAndSmsGatewaySecret || "").trim() || null;
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        callAndSmsProvider: true,
        callAndSmsGatewayUrl: true,
        callAndSmsGatewaySecret: true,
      },
    );

    for (const row of rows) {
      const provider: unknown =
        data.callAndSmsProvider !== undefined && data.callAndSmsProvider !== null
          ? data.callAndSmsProvider
          : row.callAndSmsProvider;

      const url: unknown =
        data.callAndSmsGatewayUrl !== undefined
          ? data.callAndSmsGatewayUrl
          : row.callAndSmsGatewayUrl;

      const secret: unknown =
        data.callAndSmsGatewaySecret !== undefined
          ? data.callAndSmsGatewaySecret
          : row.callAndSmsGatewaySecret;

      if (CallAndSmsProviders.isGateway(provider) && !url) {
        throw new BadDataException(
          `To send SMS and calls through your own gateway, add its ${CALL_AND_SMS_GATEWAY_URL_TITLE}.`,
        );
      }

      if (url && !secret) {
        data.callAndSmsGatewaySecret = Service.generateCallAndSmsGatewaySecret();
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    return {
      findBy: this.dropBrandingColumnsFromRead(findBy),
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    this.assertLicenseColumnsWrittenByRootOnly(createBy.data, createBy.props);
    this.assertBrandingColumnsWrittenByRootOnly(createBy.data, createBy.props);
    this.assertTwilioSmsNumbersAreValid(createBy.data);
    this.assertTwilioUseIsValid(createBy.data);
    this.assertCallAndSmsProviderIsValid(createBy.data);

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    this.assertLicenseColumnsWrittenByRootOnly(updateBy.data, updateBy.props);
    this.assertBrandingColumnsWrittenByRootOnly(updateBy.data, updateBy.props);
    this.assertTwilioSmsNumbersAreValid(updateBy.data);
    this.assertTwilioUseIsValid(updateBy.data);
    await this.assertTwilioNumbersKeptForUse(updateBy);
    this.assertCallAndSmsProviderIsValid(updateBy.data);
    await this.prepareCallAndSmsGateway(updateBy);

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
    const currentConfig: Model | null =
      (
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          clickhouseCapacityNotificationThresholdPercent: true,
          clickhouseDataPruningThresholdPercent: true,
          clickhouseDataPruningTargetPercent: true,
        })
      )[0] || null;

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

  /*
   * Writing the server's Require SSO for Login on - turning it on, or saving
   * it on again - needs an SSO provider that signs people in to every
   * project that does not require SSO itself (Utils/SsoRequirementChanges):
   * checked once the caller has passed every permission check, under the
   * lock on the server's sign-in rules, held until the write is done
   * (onUpdateSuccess) - kept once more right before it, taken again and the
   * check run again should it be gone by then, and kept alive while it is
   * written (SsoRequirementChanges.beforeWrite).
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await SsoRequirementChanges.beforeServerUpdate({ updateBy });

    // What the rule is now, so turning it off is told only when it was on.
    await SsoRequirementChanges.rememberServerRuleBefore(updateBy);

    await SsoRequirementChanges.beforeWrite(updateBy);
  }

  /*
   * An update that failed once it held the lock: it is given back - or, when
   * the database may still apply the write, kept until it would have
   * cancelled it (SsoRequirementChanges).
   */
  @CaptureSpan()
  protected override async onUpdateError(
    error: Exception,
    onUpdate?: OnUpdate<Model> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    if (onUpdate) {
      await SsoRequirementChanges.afterFailedUpdate(
        onUpdate.updateBy,
        error,
        failedStatement,
      );
    }

    return error;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await SsoRequirementChanges.afterUpdate(onUpdate.updateBy);

    if (
      (onUpdate.updateBy.data as { requireSsoForLogin?: unknown })
        .requireSsoForLogin !== undefined
    ) {
      this.forgetRequireSsoForLogin();
    }

    // Turned on or off: this server's next push reads the switch again.
    if (
      (onUpdate.updateBy.data as { disablePushNotifications?: unknown })
        .disablePushNotifications !== undefined
    ) {
      this.forgetPushNotificationsTurnedOff();
    }

    /*
     * Turned on or off: every server reads the rule again at once, rather
     * than when its cached copy runs out a minute later. Turned on, the live
     * updates already open are asked again as their joins were, so a page
     * that no longer meets it stops hearing at once, as its API requests are
     * refused. That is told even when it was on already: turning it off
     * takes no lock, so it may have been turned off a moment before this
     * write landed. Turned off, people signed in with a password are let
     * back in at once on every server, not only on this one; saved off
     * again while off, nobody is told.
     */
    if (SsoRequirementChanges.takeWhetherServerRuleChanged(onUpdate.updateBy)) {
      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SignInRulesChanged,
      });
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
