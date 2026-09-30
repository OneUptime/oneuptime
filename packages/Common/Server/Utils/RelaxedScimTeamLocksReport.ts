import EnterpriseEdition, {
  EnterpriseFeatureStateChange,
} from "../Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../Enterprise/EnterpriseFeature";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "../Enterprise/EnterpriseLicenseSnapshot";
import ProjectSCIMService from "../Services/ProjectSCIMService";
import logger from "./Logger";
import PositiveNumber from "../../Types/PositiveNumber";
import ProjectSCIM from "../../Models/DatabaseModels/ProjectSCIM";

// How many project ids the log line names; the count is always exact.
export const MAX_IDS_LISTED: number = 20;

/*
 * The SCIM Push Groups team locks that are configured but not enforced (see
 * EditionEnforcement.areScimTeamLocksEnforced): left over from an Enterprise
 * Edition install on a Community Edition process, or configured on an
 * Enterprise install whose license no longer covers SCIM.
 */
export interface RelaxedScimTeamLocksSummary {
  scimConfigurationsWithPushGroups: number;
  projectIdsWithScimPushGroups: Array<string>;
}

/*
 * Why the locks in a report are not enforced:
 *
 *   community        a Community Edition process, which has no SCIM endpoint
 *                    at all;
 *   lapsed-license   an Enterprise install whose license no longer covers
 *                    SCIM (EnterpriseEdition.isFeatureActive). Nothing is
 *                    reported unless isScimRelaxed.
 */
export type RelaxedScimTeamLocksContext =
  | { reason: "community" }
  | { reason: "lapsed-license"; isScimRelaxed: boolean };

const COMMUNITY_CONTEXT: RelaxedScimTeamLocksContext = { reason: "community" };

/*
 * Tells the operator which SCIM Push Groups team locks this server is not
 * enforcing, so that never happens silently:
 *
 *   - Community Edition: moving from the Enterprise image to the Community
 *     one keeps the database as it is, so a SCIM configuration with Push
 *     Groups on still says so - but the SCIM endpoints are part of the
 *     Enterprise Edition, so its team locks are relaxed rather than leaving
 *     teams nobody can manage. Logged once per process at boot.
 *   - Enterprise Edition: when the license stops covering SCIM, the same
 *     locks are relaxed until a license is activated. Logged each time SCIM
 *     stops (EnterpriseEdition reports each change once), including a
 *     license that has already lapsed at boot.
 */
export default class RelaxedScimTeamLocksReport {
  private static hasRun: boolean = false;

  private static stopWatchingLicense: (() => void) | null = null;

  /*
   * Called once at boot, after the enterprise loader. On the Community
   * Edition it logs the relaxed locks once per process. On the Enterprise
   * Edition it starts watching the license (once per process) and reports
   * whenever SCIM stops. Never throws: a failed check is logged and boot
   * carries on. Returns what the Community Edition report found (null when
   * it did not run or the check failed).
   */
  public static async logRelaxedEnforcementOnce(): Promise<RelaxedScimTeamLocksSummary | null> {
    if (EnterpriseEdition.isLoaded()) {
      RelaxedScimTeamLocksReport.watchLicenseOnce();
      return null;
    }

    if (RelaxedScimTeamLocksReport.hasRun) {
      return null;
    }

    RelaxedScimTeamLocksReport.hasRun = true;

    return await RelaxedScimTeamLocksReport.report(COMMUNITY_CONTEXT);
  }

  /*
   * Collects and logs the relaxed locks. Never throws. Returns what it found
   * (null when the check failed).
   */
  public static async report(
    context: RelaxedScimTeamLocksContext,
  ): Promise<RelaxedScimTeamLocksSummary | null> {
    try {
      const summary: RelaxedScimTeamLocksSummary =
        await RelaxedScimTeamLocksReport.collect();

      const message: string | null = RelaxedScimTeamLocksReport.describe(
        summary,
        context,
      );

      if (message) {
        logger.warn(message);
      }

      return summary;
    } catch (err) {
      logger.error(
        context.reason === "community"
          ? "Community Edition: could not check for SCIM Push Groups team locks left over from an Enterprise Edition install."
          : "OneUptime Enterprise license lapsed: could not check which SCIM Push Groups team locks are no longer enforced.",
      );
      logger.error(err);
      return null;
    }
  }

  /*
   * Watches the Enterprise license for SCIM stopping, once per process. The
   * first look happens here, so a license that has already lapsed at boot is
   * reported like a lapse at runtime.
   */
  private static watchLicenseOnce(): void {
    if (RelaxedScimTeamLocksReport.stopWatchingLicense) {
      return;
    }

    RelaxedScimTeamLocksReport.stopWatchingLicense =
      EnterpriseEdition.onFeatureStateChange(
        (change: EnterpriseFeatureStateChange): void => {
          RelaxedScimTeamLocksReport.onFeatureStateChange(change);
        },
      );

    try {
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
    } catch (err) {
      logger.error(err);
    }
  }

  private static onFeatureStateChange(
    change: EnterpriseFeatureStateChange,
  ): void {
    if (!change.stopped.includes(EnterpriseFeature.SCIM)) {
      return;
    }

    void RelaxedScimTeamLocksReport.report({
      reason: "lapsed-license",
      isScimRelaxed: true,
    });
  }

  // Reads the stored settings, as root.
  public static async collect(): Promise<RelaxedScimTeamLocksSummary> {
    const [scimCount, scimConfigurations]: [
      PositiveNumber,
      Array<ProjectSCIM>,
    ] = await Promise.all([
      ProjectSCIMService.countBy({
        query: { enablePushGroups: true },
        props: { isRoot: true },
      }),
      ProjectSCIMService.findBy({
        query: { enablePushGroups: true },
        select: { projectId: true },
        limit: MAX_IDS_LISTED,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    return {
      scimConfigurationsWithPushGroups: scimCount.toNumber(),
      projectIdsWithScimPushGroups: RelaxedScimTeamLocksReport.toIds(
        scimConfigurations.map((scim: ProjectSCIM) => {
          return scim.projectId?.toString();
        }),
      ),
    };
  }

  // The log line, or null when nothing is relaxed.
  public static describe(
    summary: RelaxedScimTeamLocksSummary,
    context: RelaxedScimTeamLocksContext = COMMUNITY_CONTEXT,
  ): string | null {
    const isScimRelaxed: boolean =
      context.reason === "community" || context.isScimRelaxed;

    if (!isScimRelaxed || summary.scimConfigurationsWithPushGroups <= 0) {
      return null;
    }

    const relaxed: string = `${summary.scimConfigurationsWithPushGroups} SCIM configuration(s) with Push Groups on, whose teams can be edited in OneUptime again${RelaxedScimTeamLocksReport.describeIds(
      summary.projectIdsWithScimPushGroups,
      summary.scimConfigurationsWithPushGroups,
    )}`;

    if (context.reason === "lapsed-license") {
      return (
        "OneUptime Enterprise license lapsed: this server has SCIM Push Groups team locks that it no longer enforces, " +
        "because SCIM provisioning has stopped until a license that includes it is activated. " +
        `Not enforced: ${relaxed}. ` +
        "The settings are kept unchanged and are enforced again as soon as a license is activated, without a restart."
      );
    }

    return (
      "Community Edition: this server has SCIM Push Groups team locks from an Enterprise Edition install that it does not enforce, " +
      "because SCIM provisioning is part of the OneUptime Enterprise Edition. " +
      `Not enforced: ${relaxed}. ` +
      `The settings are kept unchanged and are enforced again when this server runs the Enterprise Edition image with a valid license (or during its ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial, or the ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period after a license expires).`
    );
  }

  // Test suites only: allow the next call to run again and stop watching.
  public static resetForTests(): void {
    RelaxedScimTeamLocksReport.hasRun = false;

    if (RelaxedScimTeamLocksReport.stopWatchingLicense) {
      RelaxedScimTeamLocksReport.stopWatchingLicense();
      RelaxedScimTeamLocksReport.stopWatchingLicense = null;
    }
  }

  private static toIds(values: Array<string | undefined>): Array<string> {
    return values
      .filter((value: string | undefined): value is string => {
        return Boolean(value);
      })
      .slice(0, MAX_IDS_LISTED);
  }

  private static describeIds(ids: Array<string>, total: number): string {
    if (ids.length === 0) {
      return "";
    }

    const more: string =
      total > ids.length ? ` and ${total - ids.length} more` : "";

    return ` (project ids: ${ids.join(", ")}${more})`;
  }
}
