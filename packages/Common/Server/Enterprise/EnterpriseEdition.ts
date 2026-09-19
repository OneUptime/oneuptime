import EnterpriseFeature from "./EnterpriseFeature";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseSnapshotUtil,
  SeatUsage,
} from "./EnterpriseLicenseSnapshot";
import EnterpriseServerModule, {
  AuditLogRecorder,
} from "./EnterpriseServerModule";
/*
 * EnvironmentConfig never imports anything under Server/Enterprise, so this
 * import cannot form a cycle. IsBillingEnabled is only ever read inside a
 * function body: the compiled CommonJS reads the live module binding at call
 * time, which is what lets a test pin billing by mocking EnvironmentConfig.
 */
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import type { DatabaseBaseModelType } from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";

/*
 * Which enterprise feature each enterprise configuration model belongs to,
 * keyed by table name. Kept here so the model files themselves stay unchanged;
 * a model marked requiresEnterprise that is missing from this map is caught by
 * the facade's test.
 */
const ENTERPRISE_FEATURE_BY_TABLE_NAME: ReadonlyMap<string, EnterpriseFeature> =
  new Map<string, EnterpriseFeature>([
    ["GlobalSSO", EnterpriseFeature.SSO],
    ["GlobalOIDC", EnterpriseFeature.SSO],
    ["GlobalSSOProject", EnterpriseFeature.SSO],
    ["GlobalOIDCProject", EnterpriseFeature.SSO],
    ["ProjectSSO", EnterpriseFeature.SSO],
    ["ProjectOIDC", EnterpriseFeature.SSO],
    ["StatusPageSSO", EnterpriseFeature.SSO],
    ["StatusPageOIDC", EnterpriseFeature.SSO],
    ["ProjectSCIM", EnterpriseFeature.SCIM],
    ["StatusPageSCIM", EnterpriseFeature.SCIM],
    ["TeamComplianceSetting", EnterpriseFeature.TeamCompliance],
  ]);

/*
 * The features whose RUNTIME behaviour stops when a self-hosted license
 * lapses (see isFeatureActive), in the order the lapse log names them.
 */
export const RUNTIME_ENTERPRISE_FEATURES: ReadonlyArray<EnterpriseFeature> = [
  EnterpriseFeature.SSO,
  EnterpriseFeature.SCIM,
  EnterpriseFeature.AuditLogs,
];

// How the lapse log names each feature.
const FEATURE_NAMES: ReadonlyMap<EnterpriseFeature, string> = new Map<
  EnterpriseFeature,
  string
>([
  [EnterpriseFeature.SSO, "single sign-on (SSO)"],
  [EnterpriseFeature.SCIM, "SCIM provisioning"],
  [EnterpriseFeature.AuditLogs, "audit logging"],
  [EnterpriseFeature.TeamCompliance, "team compliance"],
  [EnterpriseFeature.InstanceHealth, "the OneUptime Health dashboards"],
]);

/*
 * One change in which enterprise features are active, as isFeatureActive
 * observed it. Reported once per change, to the log and to every listener
 * registered with EnterpriseEdition.onFeatureStateChange.
 */
export interface EnterpriseFeatureStateChange {
  // Features that were active and have stopped.
  stopped: Array<EnterpriseFeature>;
  // Features that were stopped and are active again.
  resumed: Array<EnterpriseFeature>;
  // The license snapshot the change was decided on.
  snapshot: EnterpriseLicenseSnapshot;
}

export type EnterpriseFeatureStateListener = (
  change: EnterpriseFeatureStateChange,
) => void;

/*
 * The one place core asks "which edition is this, and what may it do?".
 *
 * Three questions, on purpose:
 *
 *   isLoaded()            the ee code is present in this process, whatever the
 *                         license says. Decides which enterprise routers and
 *                         jobs exist and which edition operators are told they
 *                         run.
 *   isFeatureActive()     the ee code is present AND the feature is licensed
 *                         right now. Governs RUNTIME behaviour: SSO sign-in
 *                         and "Require SSO for login" enforcement, SCIM
 *                         provisioning and its team locks, audit-log
 *                         recording. When a self-hosted license lapses these
 *                         stop, exactly as on the Community Edition, and they
 *                         resume without a restart when a license is
 *                         activated. An UNKNOWN license state counts as
 *                         active (see isFeatureActive).
 *   isFeatureAvailable()  the license, failing closed. Governs creating and
 *                         updating enterprise configuration, the enterprise
 *                         admin Health dashboards and the query console.
 *
 * "Lapsed" means what isFeatureAvailableSync treats as unavailable with
 * billing off: no license after the 14-day trial (counted from
 * GlobalConfig.enterpriseEditionFirstSeenAt), a license that expired more
 * than the 14-day grace period ago, an invalid license, or a license whose
 * feature list leaves the feature out. During the trial and the grace period
 * nothing stops. With billing on (OneUptime Cloud) both license questions
 * answer yes whenever ee is loaded: plan tiers gate the features there.
 */
export default class EnterpriseEdition {
  public static readonly COMMUNITY_EDITION_MESSAGE: string =
    "This is a OneUptime Enterprise Edition feature and is not available in the Community Edition. " +
    "Run the OneUptime Enterprise Edition image to use it. " +
    "See https://oneuptime.com/enterprise/overview for details.";

  public static readonly LICENSE_REQUIRED_MESSAGE: string =
    "This OneUptime Enterprise feature needs a valid Enterprise license that includes it. " +
    "Enterprise configuration you already have keeps working and can still be viewed or deleted, " +
    "but it cannot be created or changed until a master admin adds or renews the license " +
    "from the edition label in the Admin Dashboard header.";

  private static module: EnterpriseServerModule | null = null;

  /*
   * The last active/stopped answer isFeatureActive gave per feature, from a
   * KNOWN license state. A feature never seen here counts as active: that is
   * how the process starts (an unknown license state is active), so a license
   * that is already lapsed at boot is reported like any other lapse.
   */
  private static lastKnownFeatureState: Map<EnterpriseFeature, boolean> =
    new Map<EnterpriseFeature, boolean>();

  private static hasWarnedAboutUnreadLicense: boolean = false;

  private static hasWarnedAboutUnreadableLicense: boolean = false;

  private static featureStateListeners: Array<EnterpriseFeatureStateListener> =
    [];

  public static register(enterpriseModule: EnterpriseServerModule): void {
    if (!enterpriseModule) {
      throw new Error("EnterpriseEdition.register needs a module.");
    }

    if (EnterpriseEdition.module) {
      throw new Error(
        "An enterprise module is already registered. The enterprise module is loaded once per process.",
      );
    }

    EnterpriseEdition.module = enterpriseModule;
  }

  public static isLoaded(): boolean {
    return EnterpriseEdition.module !== null;
  }

  public static getModule(): EnterpriseServerModule | null {
    return EnterpriseEdition.module;
  }

  /*
   * Test suites only: forget the registered module, the feature states seen so
   * far, the one-time warnings and the listeners, so the next test starts on
   * a fresh Community Edition process.
   */
  public static resetForTests(): void {
    EnterpriseEdition.module = null;
    EnterpriseEdition.lastKnownFeatureState.clear();
    EnterpriseEdition.hasWarnedAboutUnreadLicense = false;
    EnterpriseEdition.hasWarnedAboutUnreadableLicense = false;
    EnterpriseEdition.featureStateListeners = [];
  }

  /*
   * Whether the feature's runtime behaviour runs right now: SSO sign-in and
   * "Require SSO for login" enforcement (SSO), SCIM provisioning and its team
   * locks (SCIM), audit-log recording (AuditLogs). Synchronous, because it is
   * asked on every request that could need it; the license changes at runtime
   * and routers are mounted once, so callers ask per request.
   *
   *   no enterprise module        false (the Community Edition)
   *   billing on                  true (OneUptime Cloud: plan tiers gate)
   *   license state UNKNOWN       true: the first snapshot has not loaded yet,
   *                               or reading the cached one threw. An unknown
   *                               state must never lock anyone out or switch
   *                               SSO enforcement off. The loader waits
   *                               (bounded) for the first snapshot before any
   *                               router is mounted, so the window is small.
   *                               Warned about once per process.
   *   otherwise                   the license entitles the feature (valid or
   *                               grace, feature included)
   *
   * A change of answer from a known state is logged once per change (a
   * warning when features stop, info when they resume) and reported to the
   * onFeatureStateChange listeners.
   */
  public static isFeatureActive(feature: EnterpriseFeature): boolean {
    const enterpriseModule: EnterpriseServerModule | null =
      EnterpriseEdition.module;

    if (!enterpriseModule) {
      return false;
    }

    if (IsBillingEnabled) {
      return true;
    }

    let snapshot: EnterpriseLicenseSnapshot | null = null;

    try {
      snapshot = enterpriseModule.licensing.getCachedSnapshot();
    } catch (err) {
      if (!EnterpriseEdition.hasWarnedAboutUnreadableLicense) {
        EnterpriseEdition.hasWarnedAboutUnreadableLicense = true;
        logger.warn(
          "EnterpriseEdition: could not read the cached license snapshot. Until it can be read, SSO, SCIM and audit logging keep running as if licensed. This warning is logged once per process.",
        );
        logger.warn(err);
      }

      return true;
    }

    if (!snapshot) {
      if (!EnterpriseEdition.hasWarnedAboutUnreadLicense) {
        EnterpriseEdition.hasWarnedAboutUnreadLicense = true;
        logger.warn(
          "EnterpriseEdition: the license has not been read yet. Until it is, SSO, SCIM and audit logging keep running as if licensed. This warning is logged once per process.",
        );
      }

      return true;
    }

    const isActive: boolean = EnterpriseLicenseSnapshotUtil.entitles(
      snapshot,
      feature,
    );

    if (EnterpriseEdition.getLastKnownFeatureState(feature) !== isActive) {
      EnterpriseEdition.recordFeatureStateChange(snapshot, feature);
    }

    return isActive;
  }

  /*
   * Registers a listener for changes in which features are active (see
   * isFeatureActive). Called synchronously, from inside isFeatureActive, once
   * per change; a listener that throws is logged and never breaks the caller.
   * Returns a function that removes the listener.
   */
  public static onFeatureStateChange(
    listener: EnterpriseFeatureStateListener,
  ): () => void {
    EnterpriseEdition.featureStateListeners.push(listener);

    return (): void => {
      EnterpriseEdition.featureStateListeners =
        EnterpriseEdition.featureStateListeners.filter(
          (registered: EnterpriseFeatureStateListener): boolean => {
            return registered !== listener;
          },
        );
    };
  }

  /*
   * Synchronous availability, for synchronous permission checks. Reads the
   * module's cached snapshot; no snapshot yet, or any error, means false (fail
   * closed: an enterprise configuration write is refused, never allowed by
   * accident).
   */
  public static isFeatureAvailableSync(feature: EnterpriseFeature): boolean {
    const enterpriseModule: EnterpriseServerModule | null =
      EnterpriseEdition.module;

    if (!enterpriseModule) {
      return false;
    }

    if (IsBillingEnabled) {
      return true;
    }

    let snapshot: EnterpriseLicenseSnapshot | null = null;

    try {
      snapshot = enterpriseModule.licensing.getCachedSnapshot();
    } catch (err) {
      logger.warn(
        "EnterpriseEdition: could not read the cached license snapshot; treating the feature as unavailable.",
      );
      logger.warn(err);
      return false;
    }

    return EnterpriseLicenseSnapshotUtil.entitles(snapshot, feature);
  }

  public static async isFeatureAvailable(
    feature: EnterpriseFeature,
  ): Promise<boolean> {
    const enterpriseModule: EnterpriseServerModule | null =
      EnterpriseEdition.module;

    if (!enterpriseModule) {
      return false;
    }

    if (IsBillingEnabled) {
      return true;
    }

    const snapshot: EnterpriseLicenseSnapshot | null =
      await EnterpriseEdition.getLicenseSnapshot();

    return EnterpriseLicenseSnapshotUtil.entitles(snapshot, feature);
  }

  public static assertFeatureAvailableSync(feature: EnterpriseFeature): void {
    if (EnterpriseEdition.isFeatureAvailableSync(feature)) {
      return;
    }

    throw EnterpriseEdition.createUnavailableException();
  }

  public static async assertFeatureAvailable(
    feature: EnterpriseFeature,
  ): Promise<void> {
    if (await EnterpriseEdition.isFeatureAvailable(feature)) {
      return;
    }

    throw EnterpriseEdition.createUnavailableException();
  }

  /*
   * The license snapshot, or null on the Community Edition. A failed read falls
   * back to the cached snapshot (the provider's last good one), then to null.
   */
  public static async getLicenseSnapshot(): Promise<EnterpriseLicenseSnapshot | null> {
    const enterpriseModule: EnterpriseServerModule | null =
      EnterpriseEdition.module;

    if (!enterpriseModule) {
      return null;
    }

    try {
      return await enterpriseModule.licensing.getSnapshot();
    } catch (err) {
      logger.warn(
        "EnterpriseEdition: could not load the license snapshot; falling back to the cached one.",
      );
      logger.warn(err);
    }

    try {
      return enterpriseModule.licensing.getCachedSnapshot();
    } catch (err) {
      logger.warn(err);
      return null;
    }
  }

  // Seat usage for display, or null on the Community Edition or on error.
  public static async getSeatUsage(): Promise<SeatUsage | null> {
    const enterpriseModule: EnterpriseServerModule | null =
      EnterpriseEdition.module;

    if (!enterpriseModule) {
      return null;
    }

    try {
      return await enterpriseModule.licensing.getSeatUsage();
    } catch (err) {
      logger.warn("EnterpriseEdition: could not compute seat usage.");
      logger.warn(err);
      return null;
    }
  }

  /*
   * Throws when the license has no seat left for one more user. The Community
   * Edition has no seat limit, so this is a no-op there. Errors from the
   * provider propagate: refusing the new user IS the provider's answer.
   */
  public static async assertSeatAvailableForNewUser(): Promise<void> {
    const enterpriseModule: EnterpriseServerModule | null =
      EnterpriseEdition.module;

    if (!enterpriseModule) {
      return;
    }

    await enterpriseModule.licensing.assertSeatAvailableForNewUser();
  }

  /*
   * The ee audit-log recorder, or null when there is none (CE). Handed out
   * whatever the license says: the recorder itself asks
   * isFeatureActive(AuditLogs) before recording each entry, so recording
   * stops while the license is lapsed and resumes when it is renewed.
   */
  public static getAuditLogRecorder(): AuditLogRecorder | null {
    const enterpriseModule: EnterpriseServerModule | null =
      EnterpriseEdition.module;

    if (!enterpriseModule) {
      return null;
    }

    try {
      return enterpriseModule.getAuditLogRecorder();
    } catch (err) {
      logger.error(
        "EnterpriseEdition: the enterprise module failed to provide its audit log recorder.",
      );
      logger.error(err);
      return null;
    }
  }

  public static getModelFeature(
    modelType: DatabaseBaseModelType,
  ): EnterpriseFeature | null {
    let tableName: string | null = null;

    try {
      tableName = new modelType().tableName;
    } catch (err) {
      logger.warn(err);
      return null;
    }

    return EnterpriseEdition.getFeatureForTableName(tableName);
  }

  public static getFeatureForTableName(
    tableName: string | null | undefined,
  ): EnterpriseFeature | null {
    if (!tableName) {
      return null;
    }

    return ENTERPRISE_FEATURE_BY_TABLE_NAME.get(tableName) || null;
  }

  // Every table name the facade maps to a feature (for guard tests).
  public static getMappedTableNames(): Array<string> {
    return Array.from(ENTERPRISE_FEATURE_BY_TABLE_NAME.keys());
  }

  // How the lapse log names a feature.
  public static getFeatureName(feature: EnterpriseFeature): string {
    return FEATURE_NAMES.get(feature) || feature;
  }

  /*
   * The log line for features that stopped, or null when none did. Public so
   * the wording can be tested without driving a lapse.
   */
  public static describeStoppedFeatures(
    stopped: Array<EnterpriseFeature>,
    snapshot: EnterpriseLicenseSnapshot,
  ): string | null {
    if (stopped.length === 0) {
      return null;
    }

    const names: string = EnterpriseEdition.joinFeatureNames(stopped);
    const verb: string = stopped.length === 1 ? "has" : "have";
    const isUsable: boolean = EnterpriseLicenseSnapshotUtil.isUsable(snapshot);

    const parts: Array<string> = [
      isUsable
        ? `The OneUptime Enterprise license does not include ${names}: ${stopped.length === 1 ? "it" : "they"} ${verb} stopped until a license that includes ${stopped.length === 1 ? "it" : "them"} is activated.`
        : `The OneUptime Enterprise license has lapsed (status: ${snapshot.status}): ${names} ${verb} stopped until a license is activated.`,
    ];

    if (stopped.includes(EnterpriseFeature.SSO)) {
      parts.push(
        '"Require SSO for login" is not enforced meanwhile: users sign in with their password, and users who only ever signed in with SSO can reset their password.',
      );
    }

    if (snapshot.message) {
      parts.push(`License status: ${snapshot.message}`);
    }

    parts.push(
      "A master admin can activate or renew the license from the edition label in the Admin Dashboard header.",
    );

    return parts.join(" ");
  }

  // The log line for features that resumed, or null when none did.
  public static describeResumedFeatures(
    resumed: Array<EnterpriseFeature>,
  ): string | null {
    if (resumed.length === 0) {
      return null;
    }

    return `The OneUptime Enterprise license covers ${EnterpriseEdition.joinFeatureNames(resumed)} again: ${resumed.length === 1 ? "it has" : "they have"} resumed.`;
  }

  private static getLastKnownFeatureState(feature: EnterpriseFeature): boolean {
    const known: boolean | undefined =
      EnterpriseEdition.lastKnownFeatureState.get(feature);

    return known === undefined ? true : known;
  }

  /*
   * Called only when `trigger` changed state. Re-reads every runtime feature
   * from the same snapshot, so a lapse that stops several of them is logged
   * as one line and the others are not reported again on their next check.
   */
  private static recordFeatureStateChange(
    snapshot: EnterpriseLicenseSnapshot,
    trigger: EnterpriseFeature,
  ): void {
    const features: Array<EnterpriseFeature> = [...RUNTIME_ENTERPRISE_FEATURES];

    if (!features.includes(trigger)) {
      features.push(trigger);
    }

    const stopped: Array<EnterpriseFeature> = [];
    const resumed: Array<EnterpriseFeature> = [];

    for (const feature of features) {
      const wasActive: boolean =
        EnterpriseEdition.getLastKnownFeatureState(feature);
      const isActive: boolean = EnterpriseLicenseSnapshotUtil.entitles(
        snapshot,
        feature,
      );

      EnterpriseEdition.lastKnownFeatureState.set(feature, isActive);

      if (wasActive && !isActive) {
        stopped.push(feature);
      }

      if (!wasActive && isActive) {
        resumed.push(feature);
      }
    }

    try {
      const stoppedMessage: string | null =
        EnterpriseEdition.describeStoppedFeatures(stopped, snapshot);

      if (stoppedMessage) {
        logger.warn(stoppedMessage);
      }

      const resumedMessage: string | null =
        EnterpriseEdition.describeResumedFeatures(resumed);

      if (resumedMessage) {
        logger.info(resumedMessage);
      }
    } catch {
      // Logging must never change the answer isFeatureActive gives.
    }

    const change: EnterpriseFeatureStateChange = {
      stopped,
      resumed,
      snapshot,
    };

    for (const listener of [...EnterpriseEdition.featureStateListeners]) {
      try {
        listener(change);
      } catch (err) {
        logger.error(
          "EnterpriseEdition: a listener for enterprise feature state changes failed.",
        );
        logger.error(err);
      }
    }
  }

  private static joinFeatureNames(features: Array<EnterpriseFeature>): string {
    const names: Array<string> = features.map(
      (feature: EnterpriseFeature): string => {
        return EnterpriseEdition.getFeatureName(feature);
      },
    );

    if (names.length <= 1) {
      return names.join("");
    }

    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }

  private static createUnavailableException(): PaymentRequiredException {
    if (!EnterpriseEdition.isLoaded()) {
      return new PaymentRequiredException(
        EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
      );
    }

    return new PaymentRequiredException(
      EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
    );
  }
}
