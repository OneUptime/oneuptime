import {
  DashboardClientUrl,
  getAllEnvVars,
  IsBillingEnabled,
} from "../../EnvironmentConfig";
import ApiKeyService from "../../Services/ApiKeyService";
import ProjectSCIMService from "../../Services/ProjectSCIMService";
import ProjectService, { CurrentPlan } from "../../Services/ProjectService";
import StatusPageSCIMService from "../../Services/StatusPageSCIMService";
import QueryHelper from "../../Types/Database/QueryHelper";
import PlanCutoffCredentialAccess from "./PlanCutoffCredentialAccess";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "../../../Models/DatabaseModels/StatusPageSCIM";
import URL from "../../../Types/API/URL";
import {
  getCredentialsStoppedByMove,
  PLAN_CUTOFF_CREDENTIALS,
  PlanCutoffCredential,
} from "../../../Types/Billing/PlanCutoffCredentials";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import SafeHtml from "../../../Types/SafeHtml";

/*
 * The project's owners hear it when the project's plan stops its API keys
 * or limits its SCIM connections (Types/Billing/PlanCutoffCredentials):
 * below Growth every request made with one of its API keys is refused;
 * below Scale its SCIM connections only remove people - adding people and
 * changing them is refused.
 *
 * When it happens: ProjectService.changePlan tells them after it has written
 * the new plan, and only about what that move stopped - what worked on the
 * old plan and does not on the new one (notifyIfStopped). A move that stops
 * nothing, an upgrade, or a move between two plans that both lack them,
 * sends nothing; so does a project that has no keys or connections left to
 * stop.
 *
 * And once, for the projects that were already below those plans when the
 * cut-off shipped - they met the 402s with no word from us
 * (notifyProjectsAlreadyBelowPlan, run once by the data migration
 * NotifyOwnersOfStoppedApiKeysAndScim). Their owners are told what stopped
 * on the plan the project is on, in the same words. Once is the project
 * row's planCutoffNoticeSentAt: one conditional UPDATE claims it while it is
 * empty (ProjectService.claimPlanCutoffNotice), and a plan change that tells
 * the owners writes it too, so however often, and on however many workers,
 * the one-time notice runs, no project's owners hear it twice. Billing off
 * (self-hosted) has no plans: nothing is sent.
 *
 * It reuses the email the product already sends a project's owners about
 * billing and limits (ProjectService.sendEmailToProjectOwners - the current
 * members of its owner teams), so it reaches the same people the same way
 * and adds no channel or setting.
 *
 * It never throws: a plan change that was made stays made, and one project
 * that cannot be told never stops the others.
 */

// What a plan stopped: the counts of what worked before it.
export interface StoppedByPlanChange {
  apiKeys: number;
  scimConnections: number;
}

export enum PlanDowngradeNoticeOutcome {
  // Nothing worked before that does not work now: nobody was told.
  NothingStopped = "NothingStopped",
  // The owners were emailed.
  Told = "Told",
  // The owners were told already (planCutoffNoticeSentAt): not again.
  AlreadyTold = "AlreadyTold",
  // The project has no plan to read - it is gone, or never got one.
  NoPlan = "NoPlan",
  // Counting or emailing failed; logged.
  Failed = "Failed",
}

// What the one-time notice did, project by project.
export interface AlreadyBelowPlanNoticeSummary {
  // Projects that have API keys that have not expired, or SCIM connections.
  projects: number;
  told: number;
  alreadyTold: number;
  nothingStopped: number;
  noPlan: number;
  failed: number;
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
    return getCredentialsStoppedByMove({
      fromPlan: data.fromPlan,
      toPlan: data.toPlan,
      isOnPlan: (credential: PlanCutoffCredential, plan: PlanType): boolean => {
        return PlanCutoffCredentialAccess.isOnPlan({
          credential,
          currentPlan: plan,
        });
      },
    });
  }

  // The kinds of credential `plan` stops: the ones it does not include.
  public static getCredentialsStoppedOnPlan(
    plan: PlanType,
  ): Array<PlanCutoffCredential> {
    return PLAN_CUTOFF_CREDENTIALS.filter(
      (credential: PlanCutoffCredential): boolean => {
        return !PlanCutoffCredentialAccess.isOnPlan({
          credential,
          currentPlan: plan,
        });
      },
    );
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
    // None of a kind the move did not stop.
    const none: Promise<number> = Promise.resolve(0);

    const [apiKeys, projectScim, statusPageScim]: Array<number> =
      await Promise.all([
        data.credentials.includes(PlanCutoffCredential.ApiKey)
          ? ApiKeyService.countBy({
              query: {
                projectId: data.projectId,
                expiresAt: QueryHelper.greaterThan(
                  OneUptimeDate.getCurrentDate(),
                ),
              },
              props: { isRoot: true },
            }).then((count: PositiveNumber): number => {
              return count.toNumber();
            })
          : none,
        data.credentials.includes(PlanCutoffCredential.ProjectSCIM)
          ? ProjectSCIMService.countBy({
              query: { projectId: data.projectId },
              props: { isRoot: true },
            }).then((count: PositiveNumber): number => {
              return count.toNumber();
            })
          : none,
        data.credentials.includes(PlanCutoffCredential.StatusPageSCIM)
          ? StatusPageSCIMService.countBy({
              query: { projectId: data.projectId },
              props: { isRoot: true },
            }).then((count: PositiveNumber): number => {
              return count.toNumber();
            })
          : none,
      ]);

    return {
      apiKeys: apiKeys || 0,
      scimConnections: (projectScim || 0) + (statusPageScim || 0),
    };
  }

  /*
   * Tell the project's owners what moving from `fromPlanId` to `toPlanId`
   * stopped, if it stopped anything, and record that they were told
   * (planCutoffNoticeSentAt). Never throws.
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

      await PlanDowngradeOwnerNotice.sendNotice({
        projectId: data.projectId,
        fromPlan: fromPlan,
        toPlan: toPlan,
        stopped: stopped,
      });

      await PlanDowngradeOwnerNotice.recordToldNow(data.projectId);

      return PlanDowngradeNoticeOutcome.Told;
    } catch (error) {
      logger.error(
        `Billing: could not tell the owners of project ${data.projectId.toString()} what its plan change stopped: ${error}`,
      );

      return PlanDowngradeNoticeOutcome.Failed;
    }
  }

  /*
   * Once: tell the owners of a project that is below the plans its API keys
   * or SCIM connections need what stopped on the plan it is on - unless they
   * were told already, by a plan change or by an earlier run. Never throws.
   */
  @CaptureSpan()
  public static async notifyIfAlreadyBelowPlan(data: {
    projectId: ObjectID;
  }): Promise<PlanDowngradeNoticeOutcome> {
    let plan: PlanType | null = null;

    try {
      const currentPlan: CurrentPlan = await ProjectService.getCurrentPlan(
        data.projectId,
      );
      plan = currentPlan.plan;
    } catch (error) {
      // A project that is gone, or never got a plan, is below no plan.
      if (error instanceof BadDataException) {
        return PlanDowngradeNoticeOutcome.NoPlan;
      }

      logger.error(
        `Billing: could not read the plan of project ${data.projectId.toString()} to tell its owners what it stops: ${error}`,
      );

      return PlanDowngradeNoticeOutcome.Failed;
    }

    if (!plan) {
      return PlanDowngradeNoticeOutcome.NoPlan;
    }

    let claimedAt: Date | null = null;

    try {
      const credentials: Array<PlanCutoffCredential> =
        PlanDowngradeOwnerNotice.getCredentialsStoppedOnPlan(plan);

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

      const now: Date = OneUptimeDate.getCurrentDate();

      if (
        !(await ProjectService.claimPlanCutoffNotice({
          projectId: data.projectId,
          now: now,
        }))
      ) {
        return PlanDowngradeNoticeOutcome.AlreadyTold;
      }

      claimedAt = now;

      await PlanDowngradeOwnerNotice.sendNotice({
        projectId: data.projectId,
        fromPlan: null,
        toPlan: plan,
        stopped: stopped,
      });

      return PlanDowngradeNoticeOutcome.Told;
    } catch (error) {
      logger.error(
        `Billing: could not tell the owners of project ${data.projectId.toString()} that its ${plan} plan stops its API keys or limits its SCIM connections: ${error}`,
      );

      /*
       * Not sent: give the claim back, so a later run tells them after all.
       * A failure to give it back is logged and leaves them untold.
       */
      if (claimedAt) {
        await ProjectService.releasePlanCutoffNotice({
          projectId: data.projectId,
          claimedAt: claimedAt,
        }).catch((releaseError: unknown) => {
          logger.error(
            `Billing: could not give back the plan cut-off notice claim of project ${data.projectId.toString()}: ${releaseError}`,
          );
        });
      }

      return PlanDowngradeNoticeOutcome.Failed;
    }
  }

  /*
   * The one-time notice, for every project that may be below the plans its
   * credentials need: the projects with API keys that have not expired, or
   * with SCIM connections - their own or their status pages'. One project at
   * a time; safe to run again, and on several workers at once
   * (notifyIfAlreadyBelowPlan). Billing off: no plans, nothing read or sent.
   */
  @CaptureSpan()
  public static async notifyProjectsAlreadyBelowPlan(): Promise<AlreadyBelowPlanNoticeSummary> {
    const summary: AlreadyBelowPlanNoticeSummary = {
      projects: 0,
      told: 0,
      alreadyTold: 0,
      nothingStopped: 0,
      noPlan: 0,
      failed: 0,
    };

    if (!IsBillingEnabled) {
      return summary;
    }

    const projectIds: Array<ObjectID> =
      await PlanDowngradeOwnerNotice.getProjectsWithCredentials();

    summary.projects = projectIds.length;

    for (const projectId of projectIds) {
      const outcome: PlanDowngradeNoticeOutcome =
        await PlanDowngradeOwnerNotice.notifyIfAlreadyBelowPlan({
          projectId,
        });

      switch (outcome) {
        case PlanDowngradeNoticeOutcome.Told:
          summary.told++;
          break;
        case PlanDowngradeNoticeOutcome.AlreadyTold:
          summary.alreadyTold++;
          break;
        case PlanDowngradeNoticeOutcome.NothingStopped:
          summary.nothingStopped++;
          break;
        case PlanDowngradeNoticeOutcome.NoPlan:
          summary.noPlan++;
          break;
        default:
          summary.failed++;
      }
    }

    return summary;
  }

  /*
   * The projects that have an API key that has not expired, or a SCIM
   * connection - their own or a status page's - each once.
   */
  public static async getProjectsWithCredentials(): Promise<Array<ObjectID>> {
    const [apiKeys, projectScim, statusPageScim]: [
      Array<ApiKey>,
      Array<ProjectSCIM>,
      Array<StatusPageSCIM>,
    ] = await Promise.all([
      ApiKeyService.findAllBy({
        query: {
          expiresAt: QueryHelper.greaterThan(OneUptimeDate.getCurrentDate()),
        },
        select: { projectId: true },
        props: { isRoot: true },
      }),
      ProjectSCIMService.findAllBy({
        query: {},
        select: { projectId: true },
        props: { isRoot: true },
      }),
      StatusPageSCIMService.findAllBy({
        query: {},
        select: { projectId: true },
        props: { isRoot: true },
      }),
    ]);

    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const row of [...apiKeys, ...projectScim, ...statusPageScim]) {
      if (row.projectId) {
        projectIds.set(row.projectId.toString().toLowerCase(), row.projectId);
      }
    }

    return Array.from(projectIds.values());
  }

  // The email itself: to the project's owners, about what `toPlan` stopped.
  private static async sendNotice(data: {
    projectId: ObjectID;
    fromPlan: PlanType | null;
    toPlan: PlanType;
    stopped: StoppedByPlanChange;
  }): Promise<void> {
    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: { name: true },
      props: { isRoot: true },
    });

    await ProjectService.sendEmailToProjectOwners(
      data.projectId,
      PlanDowngradeOwnerNotice.getSubject({
        stopped: data.stopped,
        projectName: project?.name,
      }),
      PlanDowngradeOwnerNotice.getHtml({
        projectId: data.projectId,
        projectName: project?.name,
        fromPlan: data.fromPlan,
        toPlan: data.toPlan,
        stopped: data.stopped,
      }),
    );
  }

  /*
   * After a plan change told the owners: so the one-time notice does not
   * tell them again. Best effort - the email went out either way.
   */
  private static async recordToldNow(projectId: ObjectID): Promise<void> {
    try {
      await ProjectService.markPlanCutoffNoticeSent({
        projectId: projectId,
        now: OneUptimeDate.getCurrentDate(),
      });
    } catch (error) {
      logger.error(
        `Billing: could not record that the owners of project ${projectId.toString()} were told what its plan change stopped: ${error}`,
      );
    }
  }

  /*
   * "API keys stopped working in Acme Production", "SCIM stopped adding
   * people in Acme Production", or both in one subject.
   */
  public static getSubject(data: {
    stopped: StoppedByPlanChange;
    projectName?: string | undefined;
  }): string {
    const project: string = data.projectName?.trim() || "your project";

    if (data.stopped.apiKeys > 0 && data.stopped.scimConnections > 0) {
      return `API keys stopped working and SCIM stopped adding people in ${project}`;
    }

    if (data.stopped.apiKeys > 0) {
      return `API keys stopped working in ${project}`;
    }

    return `SCIM stopped adding people in ${project}`;
  }

  /*
   * The email's body, as the HTML the owners' email places it in
   * (SimpleMessage's info block): why - the move, or for the one-time notice
   * (no `fromPlan`) the plan the project is on - what stopped and what that
   * means, that people can still be removed through SCIM, that nothing was
   * deleted, and where to upgrade - with the link.
   */
  public static getHtml(data: {
    projectId: ObjectID;
    projectName?: string | undefined;
    // The plan the project moved from; null for the one-time notice.
    fromPlan: PlanType | null;
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
    // Until the project is back on a plan it was on, or on one it may never have been on.
    const untilOn: string = data.fromPlan ? "back on" : "on";

    const paragraphs: Array<string> = [
      SafeHtml.escape(
        data.fromPlan
          ? `${project} moved from the ${data.fromPlan} plan to the ${data.toPlan} plan.`
          : `API keys and SCIM provisioning now work only on the plans that include them, and ${project} is on the ${data.toPlan} plan.`,
      ),
    ];

    if (data.stopped.apiKeys > 0) {
      const keys: string =
        data.stopped.apiKeys === 1
          ? "The project's API key"
          : `The project's ${data.stopped.apiKeys} API keys`;

      paragraphs.push(
        SafeHtml.escape(
          `${keys} stopped working: API keys need the ${apiKeyPlan} plan. Every request made with one is refused - from Terraform, the CLI, an MCP client or your own scripts - until the project is ${untilOn} ${apiKeyPlan}.`,
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
          `${connections} stopped adding people: SCIM needs the ${scimPlan} plan. Your identity provider can still remove people from the project, so anyone who leaves loses their access as before, but it can no longer add people or change them until the project is ${untilOn} ${scimPlan}.`,
        ),
      );
    }

    const nothingDeleted: string = `Nothing was deleted. Upgrade the project in Project Settings > Billing and they work fully again as they are: ${PlanDowngradeOwnerNotice.getNothingToRedo(
      data.stopped,
    )}`;

    const settingsLink: URL | null = PlanDowngradeOwnerNotice.getSettingsLink(
      data.projectId,
    );

    if (settingsLink) {
      const link: string = SafeHtml.escape(settingsLink.toString());

      paragraphs.push(
        `${SafeHtml.escape(`${nothingDeleted}.`)} <br/> <a href="${link}">${link}</a>`,
      );
    } else {
      paragraphs.push(SafeHtml.escape(`${nothingDeleted}.`));
    }

    paragraphs.push(
      SafeHtml.escape(
        data.fromPlan
          ? "Project owners get this email when a plan change stops the project's API keys or SCIM provisioning."
          : "Project owners get this email once, because the project was already below these plans when API keys and SCIM provisioning started to need them.",
      ),
    );

    return paragraphs.join(" <br/> <br/> ");
  }

  // What need not be done again once the project is back on the plan.
  private static getNothingToRedo(stopped: StoppedByPlanChange): string {
    if (stopped.apiKeys > 0 && stopped.scimConnections > 0) {
      return "no new keys to make, and nothing to set up again in your identity provider";
    }

    if (stopped.apiKeys > 0) {
      return "there are no new keys to make";
    }

    return "nothing needs setting up again in your identity provider";
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
