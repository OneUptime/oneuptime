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
 * The one place core asks "which edition is this, and what may it do?".
 *
 * Two predicates, on purpose:
 *
 *   isLoaded()            the ee code is in this process. Governs RUNTIME
 *                         security behaviour (SSO/SCIM protocol routes, SSO
 *                         enforcement, SCIM team locks, audit recording). Never
 *                         tied to the license, so a lapsed license can never
 *                         silently weaken a security control.
 *   isFeatureAvailable()  the license. Governs creating/updating enterprise
 *                         configuration, the enterprise admin dashboards and
 *                         the query console.
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

  // Test suites only: forget the registered module so the next test starts on CE.
  public static resetForTests(): void {
    EnterpriseEdition.module = null;
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

  // The ee audit-log recorder, or null when nothing should be recorded (CE).
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

  /*
   * Whether configured SSO requirements (project, global, status page) are
   * enforced. On whenever ee is loaded, whatever the license says; off only on
   * the Community Edition, where the SSO login routes do not exist and
   * enforcing them would lock everyone out.
   */
  public static shouldEnforceSso(): boolean {
    return EnterpriseEdition.isLoaded();
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
