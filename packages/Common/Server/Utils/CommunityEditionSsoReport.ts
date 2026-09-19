import EnterpriseEdition, {
  EnterpriseFeatureStateChange,
} from "../Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../Enterprise/EnterpriseFeature";
import GlobalConfigService from "../Services/GlobalConfigService";
import ProjectSCIMService from "../Services/ProjectSCIMService";
import ProjectService from "../Services/ProjectService";
import StatusPageService from "../Services/StatusPageService";
import logger from "./Logger";
import PositiveNumber from "../../Types/PositiveNumber";
import Project from "../../Models/DatabaseModels/Project";
import ProjectSCIM from "../../Models/DatabaseModels/ProjectSCIM";
import StatusPage from "../../Models/DatabaseModels/StatusPage";

// How many ids of each kind the log line names; the counts are always exact.
export const MAX_IDS_LISTED_PER_KIND: number = 20;

/*
 * The SSO requirements and SCIM team locks that are configured but not
 * enforced (see EditionEnforcement): left over from an Enterprise Edition
 * install on a Community Edition process, or configured on an Enterprise
 * install whose license has lapsed.
 */
export interface RelaxedEnforcementSummary {
  instanceRequiresSso: boolean;
  projectsRequiringSso: number;
  projectIdsRequiringSso: Array<string>;
  statusPagesRequiringSso: number;
  statusPageIdsRequiringSso: Array<string>;
  scimConfigurationsWithPushGroups: number;
  projectIdsWithScimPushGroups: Array<string>;
}

/*
 * Why the settings in a report are not enforced:
 *
 *   community        a Community Edition process, which has no SSO login and
 *                    no SCIM endpoint at all;
 *   lapsed-license   an Enterprise install whose license no longer covers SSO
 *                    and/or SCIM (EnterpriseEdition.isFeatureActive). Only the
 *                    relaxed half is reported.
 */
export type RelaxedEnforcementContext =
  | { reason: "community" }
  | { reason: "lapsed-license"; isSsoRelaxed: boolean; isScimRelaxed: boolean };

const COMMUNITY_CONTEXT: RelaxedEnforcementContext = { reason: "community" };

/*
 * Tells the operator which configured security settings this server is not
 * enforcing, so that never happens silently:
 *
 *   - Community Edition: moving from the Enterprise image to the Community
 *     one keeps the database as it is, so a project that required SSO still
 *     says so - but the SSO login routes are part of the Enterprise Edition,
 *     so the requirement is relaxed rather than locking everyone out. Logged
 *     once per process at boot.
 *   - Enterprise Edition: when the license lapses, SSO and SCIM stop and the
 *     same settings are relaxed until a license is activated. Logged each time
 *     SSO or SCIM stops (EnterpriseEdition reports each change once),
 *     including a license that has already lapsed at boot.
 */
export default class CommunityEditionSsoReport {
  private static hasRun: boolean = false;

  private static stopWatchingLicense: (() => void) | null = null;

  /*
   * Called once at boot, after the enterprise loader. On the Community
   * Edition it logs the relaxed settings once per process. On the Enterprise
   * Edition it starts watching the license (once per process) and reports
   * whenever SSO or SCIM stops. Never throws: a failed check is logged and
   * boot carries on. Returns what the Community Edition report found (null
   * when it did not run or the check failed).
   */
  public static async logRelaxedEnforcementOnce(): Promise<RelaxedEnforcementSummary | null> {
    if (EnterpriseEdition.isLoaded()) {
      CommunityEditionSsoReport.watchLicenseOnce();
      return null;
    }

    if (CommunityEditionSsoReport.hasRun) {
      return null;
    }

    CommunityEditionSsoReport.hasRun = true;

    return await CommunityEditionSsoReport.report(COMMUNITY_CONTEXT);
  }

  /*
   * Collects and logs the relaxed settings. Never throws. Returns what it
   * found (null when the check failed).
   */
  public static async report(
    context: RelaxedEnforcementContext,
  ): Promise<RelaxedEnforcementSummary | null> {
    try {
      const summary: RelaxedEnforcementSummary =
        await CommunityEditionSsoReport.collect();

      const message: string | null = CommunityEditionSsoReport.describe(
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
          ? "Community Edition: could not check for SSO requirements and SCIM team locks left over from an Enterprise Edition install."
          : "OneUptime Enterprise license lapsed: could not check which SSO requirements and SCIM team locks are no longer enforced.",
      );
      logger.error(err);
      return null;
    }
  }

  /*
   * Watches the Enterprise license for SSO or SCIM stopping, once per
   * process. The first look happens here, so a license that has already
   * lapsed at boot is reported like a lapse at runtime.
   */
  private static watchLicenseOnce(): void {
    if (CommunityEditionSsoReport.stopWatchingLicense) {
      return;
    }

    CommunityEditionSsoReport.stopWatchingLicense =
      EnterpriseEdition.onFeatureStateChange(
        (change: EnterpriseFeatureStateChange): void => {
          CommunityEditionSsoReport.onFeatureStateChange(change);
        },
      );

    try {
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
    } catch (err) {
      logger.error(err);
    }
  }

  private static onFeatureStateChange(
    change: EnterpriseFeatureStateChange,
  ): void {
    const isSsoRelaxed: boolean = change.stopped.includes(
      EnterpriseFeature.SSO,
    );
    const isScimRelaxed: boolean = change.stopped.includes(
      EnterpriseFeature.SCIM,
    );

    if (!isSsoRelaxed && !isScimRelaxed) {
      return;
    }

    void CommunityEditionSsoReport.report({
      reason: "lapsed-license",
      isSsoRelaxed,
      isScimRelaxed,
    });
  }

  // Reads the stored (not the masked) settings. Root reads are never masked.
  public static async collect(): Promise<RelaxedEnforcementSummary> {
    const [
      instanceRequiresSso,
      projectCount,
      projects,
      statusPageCount,
      statusPages,
      scimCount,
      scimConfigurations,
    ]: [
      boolean,
      PositiveNumber,
      Array<Project>,
      PositiveNumber,
      Array<StatusPage>,
      PositiveNumber,
      Array<ProjectSCIM>,
    ] = await Promise.all([
      GlobalConfigService.getRequireSsoForLogin(),
      ProjectService.countBy({
        query: { requireSsoForLogin: true },
        props: { isRoot: true },
      }),
      ProjectService.findBy({
        query: { requireSsoForLogin: true },
        select: { _id: true },
        limit: MAX_IDS_LISTED_PER_KIND,
        skip: 0,
        props: { isRoot: true },
      }),
      StatusPageService.countBy({
        query: { requireSsoForLogin: true },
        props: { isRoot: true },
      }),
      StatusPageService.findBy({
        query: { requireSsoForLogin: true },
        select: { _id: true },
        limit: MAX_IDS_LISTED_PER_KIND,
        skip: 0,
        props: { isRoot: true },
      }),
      ProjectSCIMService.countBy({
        query: { enablePushGroups: true },
        props: { isRoot: true },
      }),
      ProjectSCIMService.findBy({
        query: { enablePushGroups: true },
        select: { projectId: true },
        limit: MAX_IDS_LISTED_PER_KIND,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    return {
      instanceRequiresSso: Boolean(instanceRequiresSso),
      projectsRequiringSso: projectCount.toNumber(),
      projectIdsRequiringSso: CommunityEditionSsoReport.toIds(
        projects.map((project: Project) => {
          return project.id?.toString() || project._id?.toString();
        }),
      ),
      statusPagesRequiringSso: statusPageCount.toNumber(),
      statusPageIdsRequiringSso: CommunityEditionSsoReport.toIds(
        statusPages.map((statusPage: StatusPage) => {
          return statusPage.id?.toString() || statusPage._id?.toString();
        }),
      ),
      scimConfigurationsWithPushGroups: scimCount.toNumber(),
      projectIdsWithScimPushGroups: CommunityEditionSsoReport.toIds(
        scimConfigurations.map((scim: ProjectSCIM) => {
          return scim.projectId?.toString();
        }),
      ),
    };
  }

  // The log line, or null when nothing is relaxed.
  public static describe(
    summary: RelaxedEnforcementSummary,
    context: RelaxedEnforcementContext = COMMUNITY_CONTEXT,
  ): string | null {
    const isSsoRelaxed: boolean =
      context.reason === "community" || context.isSsoRelaxed;
    const isScimRelaxed: boolean =
      context.reason === "community" || context.isScimRelaxed;

    const relaxed: Array<string> = [];

    if (isSsoRelaxed && summary.instanceRequiresSso) {
      relaxed.push(
        'the instance-wide "Require SSO for Login" setting (Admin Dashboard > Settings > Authentication)',
      );
    }

    if (isSsoRelaxed && summary.projectsRequiringSso > 0) {
      relaxed.push(
        `${summary.projectsRequiringSso} project(s) that require SSO for login${CommunityEditionSsoReport.describeIds(
          summary.projectIdsRequiringSso,
          summary.projectsRequiringSso,
        )}`,
      );
    }

    if (isSsoRelaxed && summary.statusPagesRequiringSso > 0) {
      relaxed.push(
        `${summary.statusPagesRequiringSso} private status page(s) that require SSO for login${CommunityEditionSsoReport.describeIds(
          summary.statusPageIdsRequiringSso,
          summary.statusPagesRequiringSso,
        )}`,
      );
    }

    if (isScimRelaxed && summary.scimConfigurationsWithPushGroups > 0) {
      relaxed.push(
        `${summary.scimConfigurationsWithPushGroups} SCIM configuration(s) with Push Groups on, whose teams can be edited in OneUptime again${CommunityEditionSsoReport.describeIds(
          summary.projectIdsWithScimPushGroups,
          summary.scimConfigurationsWithPushGroups,
          "project ids",
        )}`,
      );
    }

    if (relaxed.length === 0) {
      return null;
    }

    if (context.reason === "lapsed-license") {
      const stopped: string =
        isSsoRelaxed && isScimRelaxed
          ? "SSO login and SCIM provisioning have"
          : isSsoRelaxed
            ? "SSO login has"
            : "SCIM provisioning has";

      return (
        "OneUptime Enterprise license lapsed: this server has security settings that it no longer enforces, " +
        `because ${stopped} stopped until a license that includes ${isSsoRelaxed && isScimRelaxed ? "them" : "it"} is activated. ` +
        (isSsoRelaxed
          ? "Users of these projects and status pages sign in with email and password instead (users who only ever signed in with SSO can reset their password). "
          : "") +
        `Not enforced: ${relaxed.join("; ")}. ` +
        "The settings are kept unchanged and are enforced again as soon as a license is activated, without a restart."
      );
    }

    return (
      "Community Edition: this server has security settings from an Enterprise Edition install that it does not enforce, " +
      "because SSO login and SCIM provisioning are part of the OneUptime Enterprise Edition. " +
      "Users of these projects and status pages sign in with email and password instead. " +
      `Not enforced: ${relaxed.join("; ")}. ` +
      "The settings are kept unchanged and are enforced again when this server runs the Enterprise Edition image with a valid license (or during its 14-day trial or grace period)."
    );
  }

  // Test suites only: allow the next call to run again and stop watching.
  public static resetForTests(): void {
    CommunityEditionSsoReport.hasRun = false;

    if (CommunityEditionSsoReport.stopWatchingLicense) {
      CommunityEditionSsoReport.stopWatchingLicense();
      CommunityEditionSsoReport.stopWatchingLicense = null;
    }
  }

  private static toIds(values: Array<string | undefined>): Array<string> {
    return values
      .filter((value: string | undefined): value is string => {
        return Boolean(value);
      })
      .slice(0, MAX_IDS_LISTED_PER_KIND);
  }

  private static describeIds(
    ids: Array<string>,
    total: number,
    label: string = "ids",
  ): string {
    if (ids.length === 0) {
      return "";
    }

    const more: string =
      total > ids.length ? ` and ${total - ids.length} more` : "";

    return ` (${label}: ${ids.join(", ")}${more})`;
  }
}
