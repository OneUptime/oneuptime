import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
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
 * The SSO requirements and SCIM team locks that a Community Edition process
 * finds configured - left over from an Enterprise Edition install - and does
 * not enforce (see EditionEnforcement).
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
 * Tells the operator of a Community Edition install which security settings
 * it is not enforcing. Moving from the Enterprise image to the Community one
 * keeps the database as it is, so a project that required SSO still says so -
 * but the SSO login routes are part of the Enterprise Edition, so the
 * requirement is relaxed rather than locking everyone out. That must not
 * happen silently: this logs it once per process at boot.
 */
export default class CommunityEditionSsoReport {
  private static hasRun: boolean = false;

  /*
   * Logs the relaxed settings once per process, and only on the Community
   * Edition. Never throws: a failed check is logged and boot carries on.
   * Returns what it found (null when it did not run or the check failed).
   */
  public static async logRelaxedEnforcementOnce(): Promise<RelaxedEnforcementSummary | null> {
    if (EnterpriseEdition.isLoaded()) {
      return null;
    }

    if (CommunityEditionSsoReport.hasRun) {
      return null;
    }

    CommunityEditionSsoReport.hasRun = true;

    try {
      const summary: RelaxedEnforcementSummary =
        await CommunityEditionSsoReport.collect();

      const message: string | null =
        CommunityEditionSsoReport.describe(summary);

      if (message) {
        logger.warn(message);
      }

      return summary;
    } catch (err) {
      logger.error(
        "Community Edition: could not check for SSO requirements and SCIM team locks left over from an Enterprise Edition install.",
      );
      logger.error(err);
      return null;
    }
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
  public static describe(summary: RelaxedEnforcementSummary): string | null {
    const relaxed: Array<string> = [];

    if (summary.instanceRequiresSso) {
      relaxed.push(
        'the instance-wide "Require SSO for Login" setting (Admin Dashboard > Settings > Authentication)',
      );
    }

    if (summary.projectsRequiringSso > 0) {
      relaxed.push(
        `${summary.projectsRequiringSso} project(s) that require SSO for login${CommunityEditionSsoReport.describeIds(
          summary.projectIdsRequiringSso,
          summary.projectsRequiringSso,
        )}`,
      );
    }

    if (summary.statusPagesRequiringSso > 0) {
      relaxed.push(
        `${summary.statusPagesRequiringSso} private status page(s) that require SSO for login${CommunityEditionSsoReport.describeIds(
          summary.statusPageIdsRequiringSso,
          summary.statusPagesRequiringSso,
        )}`,
      );
    }

    if (summary.scimConfigurationsWithPushGroups > 0) {
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

    return (
      "Community Edition: this server has security settings from an Enterprise Edition install that it does not enforce, " +
      "because SSO login and SCIM provisioning are part of the OneUptime Enterprise Edition. " +
      "Users of these projects and status pages sign in with email and password instead. " +
      `Not enforced: ${relaxed.join("; ")}. ` +
      "The settings are kept unchanged and are enforced again when this server runs the Enterprise Edition image."
    );
  }

  // Test suites only: allow the next call to run again.
  public static resetForTests(): void {
    CommunityEditionSsoReport.hasRun = false;
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
