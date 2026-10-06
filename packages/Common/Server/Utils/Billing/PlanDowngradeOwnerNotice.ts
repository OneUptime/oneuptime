import { DashboardClientUrl, getAllEnvVars } from "../../EnvironmentConfig";
import ApiKeyService from "../../Services/ApiKeyService";
import ProjectSCIMService from "../../Services/ProjectSCIMService";
import ProjectService from "../../Services/ProjectService";
import StatusPageSCIMService from "../../Services/StatusPageSCIMService";
import QueryHelper from "../../Types/Database/QueryHelper";
import PlanCutoffCredentialAccess from "./PlanCutoffCredentialAccess";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import Project from "../../../Models/DatabaseModels/Project";
import URL from "../../../Types/API/URL";
import { PlanCutoffCredential } from "../../../Types/Billing/PlanCutoffCredentials";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import SafeHtml from "../../../Types/SafeHtml";

/*
 * The project's owners hear it when a plan change stops the project's API
 * keys or SCIM connections (Types/Billing/PlanCutoffCredentials).
 *
 * Once, when it happens: ProjectService.changePlan tells them after it has
 * written the new plan, and only about what that move stopped - what worked
 * on the old plan and does not on the new one. A move that stops nothing,
 * an upgrade, or a move between two plans that both lack them, sends
 * nothing; so does a project that has no keys or connections left to stop.
 *
 * It reuses the email the product already sends a project's owners about
 * billing and limits (ProjectService.sendEmailToProjectOwners), so it
 * reaches the same people the same way and adds no channel or setting.
 *
 * It never throws: a plan change that was made stays made, whether or not
 * its owners could be told.
 */

// What a plan change stopped: the counts of what worked before it.
export interface StoppedByPlanChange {
  apiKeys: number;
  scimConnections: number;
}

export enum PlanDowngradeNoticeOutcome {
  // Nothing worked before that does not work now: nobody was told.
  NothingStopped = "NothingStopped",
  // The owners were emailed.
  Told = "Told",
  // Counting or emailing failed; logged.
  Failed = "Failed",
}

// Where the plan is changed in the dashboard, under a project's own route.
export const PROJECT_BILLING_SETTINGS_PATH: string = "settings/billing";

export default class PlanDowngradeOwnerNotice {
  /*
   * The kinds of credential a move from `fromPlan` to `toPlan` stops: the
   * ones the old plan includes and the new one does not. An unknown old
   * plan (a project that had none) stops nothing - nothing worked on it.
   */
  public static getCredentialsStoppedByMove(data: {
    fromPlan: PlanType | null;
    toPlan: PlanType;
  }): Array<PlanCutoffCredential> {
    if (!data.fromPlan) {
      return [];
    }

    return [
      PlanCutoffCredential.ApiKey,
      PlanCutoffCredential.ProjectSCIM,
      PlanCutoffCredential.StatusPageSCIM,
    ].filter((credential: PlanCutoffCredential): boolean => {
      return (
        PlanCutoffCredentialAccess.isOnPlan({
          credential,
          currentPlan: data.fromPlan,
        }) &&
        !PlanCutoffCredentialAccess.isOnPlan({
          credential,
          currentPlan: data.toPlan,
        })
      );
    });
  }

  /*
   * How many of the project's credentials of those kinds there are to stop:
   * its API keys that have not expired (an expired key stopped already),
   * and its SCIM connections, the project's and its status pages'.
   */
  @CaptureSpan()
  public static async countStopped(data: {
    projectId: ObjectID;
    credentials: Array<PlanCutoffCredential>;
  }): Promise<StoppedByPlanChange> {
    const stopped: StoppedByPlanChange = { apiKeys: 0, scimConnections: 0 };

    if (data.credentials.includes(PlanCutoffCredential.ApiKey)) {
      const apiKeys: PositiveNumber = await ApiKeyService.countBy({
        query: {
          projectId: data.projectId,
          expiresAt: QueryHelper.greaterThan(OneUptimeDate.getCurrentDate()),
        },
        props: { isRoot: true },
      });

      stopped.apiKeys = apiKeys.toNumber();
    }

    if (data.credentials.includes(PlanCutoffCredential.ProjectSCIM)) {
      const projectScim: PositiveNumber = await ProjectSCIMService.countBy({
        query: { projectId: data.projectId },
        props: { isRoot: true },
      });

      stopped.scimConnections += projectScim.toNumber();
    }

    if (data.credentials.includes(PlanCutoffCredential.StatusPageSCIM)) {
      const statusPageScim: PositiveNumber =
        await StatusPageSCIMService.countBy({
          query: { projectId: data.projectId },
          props: { isRoot: true },
        });

      stopped.scimConnections += statusPageScim.toNumber();
    }

    return stopped;
  }

  /*
   * Tell the project's owners what moving from `fromPlanId` to `toPlanId`
   * stopped, if it stopped anything. Never throws.
   */
  @CaptureSpan()
  public static async notifyIfStopped(data: {
    projectId: ObjectID;
    fromPlanId: string | null | undefined;
    toPlanId: string;
  }): Promise<PlanDowngradeNoticeOutcome> {
    try {
      const fromPlan: PlanType | null = PlanDowngradeOwnerNotice.getPlanType(
        data.fromPlanId,
      );
      const toPlan: PlanType | null = PlanDowngradeOwnerNotice.getPlanType(
        data.toPlanId,
      );

      if (!toPlan) {
        return PlanDowngradeNoticeOutcome.NothingStopped;
      }

      const credentials: Array<PlanCutoffCredential> =
        PlanDowngradeOwnerNotice.getCredentialsStoppedByMove({
          fromPlan,
          toPlan,
        });

      if (credentials.length === 0) {
        return PlanDowngradeNoticeOutcome.NothingStopped;
      }

      const stopped: StoppedByPlanChange =
        await PlanDowngradeOwnerNotice.countStopped({
          projectId: data.projectId,
          credentials,
        });

      if (stopped.apiKeys === 0 && stopped.scimConnections === 0) {
        return PlanDowngradeNoticeOutcome.NothingStopped;
      }

      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: { name: true },
        props: { isRoot: true },
      });

      await ProjectService.sendEmailToProjectOwners(
        data.projectId,
        PlanDowngradeOwnerNotice.getSubject({
          stopped,
          projectName: project?.name,
        }),
        PlanDowngradeOwnerNotice.getHtml({
          projectId: data.projectId,
          projectName: project?.name,
          fromPlan: fromPlan!,
          toPlan,
          stopped,
        }),
      );

      return PlanDowngradeNoticeOutcome.Told;
    } catch (error) {
      logger.error(
        `Billing: could not tell the owners of project ${data.projectId.toString()} what its plan change stopped: ${error}`,
      );

      return PlanDowngradeNoticeOutcome.Failed;
    }
  }

  // "API keys and SCIM stopped working in Acme Production".
  public static getSubject(data: {
    stopped: StoppedByPlanChange;
    projectName?: string | undefined;
  }): string {
    const project: string = data.projectName?.trim() || "your project";

    if (data.stopped.apiKeys > 0 && data.stopped.scimConnections > 0) {
      return `API keys and SCIM stopped working in ${project}`;
    }

    if (data.stopped.apiKeys > 0) {
      return `API keys stopped working in ${project}`;
    }

    return `SCIM provisioning stopped in ${project}`;
  }

  /*
   * The email's body, as the HTML the owners' email places it in
   * (SimpleMessage's info block): what moved, what stopped and what that
   * means, that nothing was deleted, and where to upgrade - with the link.
   */
  public static getHtml(data: {
    projectId: ObjectID;
    projectName?: string | undefined;
    fromPlan: PlanType;
    toPlan: PlanType;
    stopped: StoppedByPlanChange;
  }): string {
    const project: string = data.projectName?.trim() || "Your project";
    const apiKeyPlan: PlanType | null =
      PlanCutoffCredentialAccess.getRequiredPlan(PlanCutoffCredential.ApiKey);
    const scimPlan: PlanType | null =
      PlanCutoffCredentialAccess.getRequiredPlan(
        PlanCutoffCredential.ProjectSCIM,
      );

    const paragraphs: Array<string> = [
      SafeHtml.escape(
        `${project} moved from the ${data.fromPlan} plan to the ${data.toPlan} plan.`,
      ),
    ];

    if (data.stopped.apiKeys > 0) {
      const keys: string =
        data.stopped.apiKeys === 1
          ? "The project's API key"
          : `The project's ${data.stopped.apiKeys} API keys`;

      paragraphs.push(
        SafeHtml.escape(
          `${keys} stopped working: API keys need the ${apiKeyPlan} plan. Every request made with one is refused - from Terraform, the CLI, an MCP client or your own scripts - until the project is back on ${apiKeyPlan}.`,
        ),
      );
    }

    if (data.stopped.scimConnections > 0) {
      const connections: string =
        data.stopped.scimConnections === 1
          ? "The project's SCIM connection"
          : `The project's ${data.stopped.scimConnections} SCIM connections`;

      paragraphs.push(
        SafeHtml.escape(
          `${connections} stopped working: SCIM needs the ${scimPlan} plan. Your identity provider can no longer add people to the project or remove them, so remove anyone who leaves by hand until the project is back on ${scimPlan}.`,
        ),
      );
    }

    const nothingDeleted: string =
      "Nothing was deleted. Upgrade the project in Project Settings > Billing and they work again as they are, with no new keys and no new setup";

    const settingsLink: URL | null = PlanDowngradeOwnerNotice.getSettingsLink(
      data.projectId,
    );

    if (settingsLink) {
      const link: string = SafeHtml.escape(settingsLink.toString());

      paragraphs.push(
        `${SafeHtml.escape(`${nothingDeleted}:`)} <br/> <a href="${link}">${link}</a>`,
      );
    } else {
      paragraphs.push(SafeHtml.escape(`${nothingDeleted}.`));
    }

    paragraphs.push(
      SafeHtml.escape(
        "Project owners get this email when a plan change stops the project's API keys or SCIM connections.",
      ),
    );

    return paragraphs.join(" <br/> <br/> ");
  }

  /*
   * The project's Billing settings page, or null when the dashboard's
   * address is not configured (no HOST): the sentence already says where
   * it is. Built from the configured address, like the other owner emails'
   * links.
   */
  public static getSettingsLink(projectId: ObjectID): URL | null {
    if (!DashboardClientUrl || !DashboardClientUrl.hostname?.toString()) {
      return null;
    }

    return URL.fromString(DashboardClientUrl.toString()).addRoute(
      `/${projectId.toString()}/${PROJECT_BILLING_SETTINGS_PATH}`,
    );
  }

  // A plan id's plan, or null when it is not one of the configured plans.
  private static getPlanType(
    planId: string | null | undefined,
  ): PlanType | null {
    if (!planId) {
      return null;
    }

    try {
      return SubscriptionPlan.getPlanType(planId, getAllEnvVars());
    } catch {
      return null;
    }
  }
}
