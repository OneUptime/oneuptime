import AlertOnCallRuleService from "./AlertOnCallRuleService";
import IncidentOnCallRuleService from "./IncidentOnCallRuleService";
import MonitorService from "./MonitorService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import OnCallReadinessService, {
  ReadinessSummary,
} from "./OnCallReadinessService";
import ProjectMilestoneService, {
  ReachedMilestone,
} from "./ProjectMilestoneService";
import ProjectProductsService from "./ProjectProductsService";
import ProjectService from "./ProjectService";
import SampleProjectService from "./SampleProjectService";
import StatusPageService from "./StatusPageService";
import TeamMemberService from "./TeamMemberService";
import ToolImportRunService from "./ToolImportRunService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import ServerProducts from "../Utils/ServerProducts/ServerProducts";
import logger from "../Utils/Logger";
import CallerPermission from "../Utils/Permission/CallerPermission";
import ServerSendingStatus from "../Utils/ServerSending/ServerSendingStatus";
import AlertOnCallRule from "../../Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../Models/DatabaseModels/Project";
import ActivationMilestone from "../../Types/Analytics/ActivationMilestone";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import ToolImportRunStatus from "../../Types/ToolImport/ToolImportRunStatus";
import ProjectGoal, {
  parseProjectGoals,
} from "../../Types/WelcomeChecklist/ProjectGoal";
import {
  LegacyChecklistCounts,
  WelcomeAudience,
  WelcomeChecklist,
  WelcomeStep,
  buildWelcomeChecklist,
  getStepsForGoals,
  getWelcomeAudience,
  isLegacyChecklistComplete,
  needsOnCallRuleCheck,
  shouldAskForGoals,
} from "../../Types/WelcomeChecklist/WelcomeChecklist";
import {
  WelcomeChecklistAnswer,
  getEmptyWelcomeChecklistAnswer,
} from "../../Types/WelcomeChecklist/WelcomeChecklistAnswer";
import {
  WelcomeChecklistFinishedBy,
  WelcomeChecklistState,
  hasAcknowledgedTestPage,
  isWelcomeChecklistFinished,
  isWelcomeChecklistHiddenFor,
  needsLegacyCheck,
  parseWelcomeChecklistState,
  toWelcomeChecklistStateJSON,
  withTestPageAcknowledgedBy,
  withWelcomeChecklistFinished,
  withWelcomeChecklistHiddenFor,
} from "../../Types/WelcomeChecklist/WelcomeChecklistState";
import { EntityManager } from "typeorm";

/*
 * THE WELCOME CHECKLIST ON HOME, ON THE SERVER (issue #6803).
 *
 * One answer for the project and the person asking (getAnswer): whether to
 * ask what the project came to do, the steps its goals bring with what is
 * done - by outcome, from the project's activation milestones (#6830) - and
 * what is next, what the plan holds back, and whether this person hid the
 * card. Kept on the project (Project.goals and Project.welcomeChecklistState)
 * so every member and every device sees the same thing.
 *
 * The pure rules are in Types/WelcomeChecklist: which steps a goal brings,
 * when each is done, what the plan holds back, when to ask. This file reads
 * what they need and writes what they decide:
 *
 *   - the milestones, always (one indexed read);
 *   - the on-call rules and their policies' responders, only while "who is
 *     told" is a step that no milestone has finished;
 *   - finished imports, only while importing is a step left to do;
 *   - the checklist before this one's four counts, once, for a project that
 *     existed before it (needsLegacyCheck);
 *   - whether the server can send email, for a master admin of a
 *     self-hosted server.
 *
 * Writes go straight to the project's row (changeState), not through
 * ProjectService's update: they are the server's own bookkeeping, and would
 * otherwise run the project's update hooks and fill its audit log every
 * time Home ticks a step.
 *
 * Every write changes the state as it stands when it is written, never as
 * it was read a moment before (#7043): the row is read and locked, the
 * change applied, and the row written, in one transaction. So two writers
 * keep both their changes - two people acknowledging one policy's test at
 * once, or Home finishing the checklist while somebody acknowledges one.
 */

// Who may choose the project's goals: the people who set it up.
export const WELCOME_CHECKLIST_SET_UP_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

// How many policies run by rules are asked about their responders, at most.
export const MAX_POLICIES_CHECKED_FOR_RESPONDERS: number = 5;

// How many enabled rules of each kind are read, at most.
export const MAX_RULES_READ: number = 50;

export interface WelcomeChecklistCaller {
  projectId: ObjectID;
  userId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

interface ProjectChecklistRow {
  goals: Array<ProjectGoal> | null;
  state: WelcomeChecklistState;
  isFreePlan: boolean;
}

export default class WelcomeChecklistService {
  // Whether the caller set the project up: an Owner, an Admin or a master admin.
  public static isSetUpCaller(props: DatabaseCommonInteractionProps): boolean {
    if (props.isMasterAdmin) {
      return true;
    }

    return CallerPermission.holdsAnyOf(props, [
      ...WELCOME_CHECKLIST_SET_UP_PERMISSIONS,
    ]);
  }

  public static async getAnswer(
    caller: WelcomeChecklistCaller,
  ): Promise<WelcomeChecklistAnswer> {
    const row: ProjectChecklistRow = await this.readProject(caller.projectId);
    let state: WelcomeChecklistState = row.state;

    const isSetUpCaller: boolean = this.isSetUpCaller(caller.props);
    const audience: WelcomeAudience = getWelcomeAudience({
      isMasterAdmin: Boolean(caller.props.isMasterAdmin),
      isProjectOwnerOrAdmin: isSetUpCaller,
    });

    const answer: WelcomeChecklistAnswer = {
      ...getEmptyWelcomeChecklistAnswer(),
      audience: audience,
      goals: row.goals,
      canChooseGoals: isSetUpCaller,
      isHiddenForMe: isWelcomeChecklistHiddenFor(
        state,
        caller.userId.toString(),
      ),
      hasAcknowledgedTestPage: hasAcknowledgedTestPage(
        state,
        caller.userId.toString(),
      ),
    };

    /*
     * A sample project (issue #6808) has no checklist: it was made set up,
     * with made-up records, and nothing done in it is a step of anyone's
     * own setup. Home shows no Welcome card there, and the goal question
     * is never asked.
     */
    if (await ProjectService.isSampleProject(caller.projectId)) {
      answer.canChooseGoals = false;
      answer.isFinished = true;
      return answer;
    }

    /*
     * An invited member gets no steps: the owner's checklist is not theirs.
     * Home draws their own first hour (#6807) - can OneUptime reach me,
     * when am I on call - from their personal checklist and their shifts,
     * which the browser reads; all this answer adds is whether a test page
     * has reached them (above) and, while their card shows, whether the
     * server can send email. Nothing of the project's is read for them.
     */
    if (audience === WelcomeAudience.InvitedMember) {
      answer.isFinished = isWelcomeChecklistFinished(state);

      if (!answer.isHiddenForMe) {
        answer.canSendEmail = await this.canServerSendEmail();
      }

      return answer;
    }

    if (needsLegacyCheck(state)) {
      state = await this.checkLegacyChecklist(caller.projectId, state);
    }

    if (isWelcomeChecklistFinished(state)) {
      answer.isFinished = true;
      return answer;
    }

    const reached: Set<ActivationMilestone> = await this.readMilestones(
      caller.projectId,
    );

    const steps: Array<WelcomeStep> = getStepsForGoals(row.goals);
    const readerIsServerAdmin: boolean =
      !IsBillingEnabled && Boolean(caller.props.isMasterAdmin);

    const [hasRuleThatPagesSomeone, hasFinishedImport, serverCanSendEmail]: [
      boolean,
      boolean,
      boolean,
    ] = await Promise.all([
      needsOnCallRuleCheck({ steps: steps, reached: reached })
        ? this.hasRuleThatPagesSomeone(caller.projectId)
        : Promise.resolve(false),
      steps.includes(WelcomeStep.Import)
        ? this.hasFinishedImport(caller.projectId)
        : Promise.resolve(false),
      this.canServerSendEmail(),
    ]);

    const checklist: WelcomeChecklist = buildWelcomeChecklist({
      goals: row.goals,
      // A step of a product switched off on the server is left out (#6815).
      offProducts: await ServerProducts.getOffProducts(),
      facts: {
        reached: reached,
        hasRuleThatPagesSomeone: hasRuleThatPagesSomeone,
        hasFinishedImport: hasFinishedImport,
        serverCanSendEmail: serverCanSendEmail,
      },
      plan: { isFreePlan: row.isFreePlan },
      readerIsServerAdmin: readerIsServerAdmin,
    });

    answer.canSendEmail = serverCanSendEmail;
    /*
     * Whether the card may offer a sample project (#6808): to someone who
     * set the project up, on a server that lets them make projects.
     */
    answer.canExploreSampleProject =
      isSetUpCaller && (await this.canExploreSampleProject(caller));
    answer.steps = checklist.steps;
    answer.doneCount = checklist.doneCount;
    answer.totalCount = checklist.totalCount;

    if (checklist.isProjectFinished) {
      /*
       * Finished for everyone, once: later visits read nothing else. This
       * answer still carries the steps, all done, so the browser that sees
       * the last one tick off sends home/checklist_finished.
       */
      await this.changeState(
        caller.projectId,
        (current: WelcomeChecklistState): WelcomeChecklistState => {
          return withWelcomeChecklistFinished(
            current,
            WelcomeChecklistFinishedBy.Outcomes,
            OneUptimeDate.getCurrentDate(),
          );
        },
      );

      answer.isFinished = true;
      return answer;
    }

    answer.shouldAskForGoals = shouldAskForGoals({
      goals: row.goals,
      canChooseGoals: isSetUpCaller,
      isFinished: false,
      reached: reached,
    });

    return answer;
  }

  /*
   * Whether this server lets the caller make a sample project (#6808). The
   * card offers none when that cannot be told: the offer is a help, and
   * the route that makes one asks again.
   */
  private static async canExploreSampleProject(
    caller: WelcomeChecklistCaller,
  ): Promise<boolean> {
    try {
      return await SampleProjectService.canCreateFor({
        isMasterAdmin: Boolean(caller.props.isMasterAdmin),
      });
    } catch (err) {
      logger.debug(
        `Could not tell whether a sample project may be made for project ${caller.projectId.toString()}; it is not offered.`,
      );
      logger.debug(err);
      return false;
    }
  }

  /*
   * Chooses the project's goals ([] skips the question). Only someone who
   * set the project up may; the route checks it, and so does this.
   */
  public static async chooseGoals(
    caller: WelcomeChecklistCaller,
    goals: unknown,
  ): Promise<Array<ProjectGoal>> {
    if (!this.isSetUpCaller(caller.props)) {
      throw new BadDataException(
        "Only a Project Owner or Project Admin can choose what this project is for.",
      );
    }

    if (!Array.isArray(goals)) {
      throw new BadDataException("goals must be a list.");
    }

    const chosen: Array<ProjectGoal> = parseProjectGoals(goals) || [];

    if (chosen.length !== new Set(goals).size) {
      throw new BadDataException(
        "goals may only hold uptime, on_call, status_page, telemetry, infrastructure, import or explore.",
      );
    }

    await this.changeState(
      caller.projectId,
      (current: WelcomeChecklistState): WelcomeChecklistState => {
        return {
          ...current,
          goalsChosenAt: OneUptimeDate.getCurrentDate().toISOString(),
          goalsChosenByUserId: caller.userId.toString(),
        };
      },
      { goals: chosen },
    );

    /*
     * The products the goals need (#6814): Essentials and what the goals
     * name are shown, the rest move under More products - unless a member
     * already chose the project's products. Never throws.
     */
    await ProjectProductsService.applyGoals({
      projectId: caller.projectId,
      goals: chosen,
    });

    return chosen;
  }

  // Hides the card for the caller, or shows it again.
  public static async setHiddenForCaller(
    caller: WelcomeChecklistCaller,
    isHidden: boolean,
  ): Promise<void> {
    await this.changeState(
      caller.projectId,
      (current: WelcomeChecklistState): WelcomeChecklistState => {
        return withWelcomeChecklistHiddenFor(
          current,
          caller.userId.toString(),
          isHidden,
        );
      },
    );
  }

  /*
   * Notes that a member acknowledged a test page in this project: a page
   * reached them, and their first hour on Home is done (#6807). Every
   * person who acknowledges one is noted - each who answers a policy's
   * test, not only the first (#7043) - and once: a later acknowledgement
   * reads the row and stops, without taking its lock.
   */
  public static async noteTestPageAcknowledged(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    const row: ProjectChecklistRow = await this.readProject(data.projectId);

    if (hasAcknowledgedTestPage(row.state, data.userId.toString())) {
      return;
    }

    await this.changeState(
      data.projectId,
      (current: WelcomeChecklistState): WelcomeChecklistState => {
        return withTestPageAcknowledgedBy(current, data.userId.toString());
      },
    );
  }

  /*
   * The same, from the acknowledgement of a test page: never throws and
   * never waits, so the acknowledgement does not fail because of it.
   */
  public static noteTestPageAcknowledgedInBackground(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): void {
    this.noteTestPageAcknowledged(data).catch((err: Error) => {
      logger.error("Could not note the acknowledged test page:");
      logger.error(err);
    });
  }

  /*
   * What the caller's browser remembered of the checklist before this one
   * (issue #6803: read the old local storage keys once): one it dismissed
   * stays hidden for them, one it saw finished stays finished.
   */
  public static async takeBrowserState(
    caller: WelcomeChecklistCaller,
    data: { wasDismissed: boolean; wasFinished: boolean },
  ): Promise<void> {
    if (!data.wasDismissed && !data.wasFinished) {
      return;
    }

    /*
     * Finished is the whole project's, so only someone who set it up may
     * say so: anybody else's browser only hides the card for them.
     */
    const finishes: boolean =
      data.wasFinished && this.isSetUpCaller(caller.props);

    await this.changeState(
      caller.projectId,
      (current: WelcomeChecklistState): WelcomeChecklistState => {
        let state: WelcomeChecklistState = current;

        if (data.wasDismissed) {
          state = withWelcomeChecklistHiddenFor(
            state,
            caller.userId.toString(),
            true,
          );
        }

        if (finishes) {
          state = withWelcomeChecklistFinished(
            state,
            WelcomeChecklistFinishedBy.Browser,
            OneUptimeDate.getCurrentDate(),
          );
        }

        return state;
      },
    );
  }

  // The plan's name a project row holds, or the plan its plan id names.
  public static isOnFreePlan(project: {
    planName?: PlanType | undefined | null;
    paymentProviderPlanId?: string | undefined | null;
  }): boolean {
    if (!IsBillingEnabled) {
      return false;
    }

    if (project.planName) {
      return project.planName === PlanType.Free;
    }

    if (!project.paymentProviderPlanId) {
      return false;
    }

    return (
      SubscriptionPlan.getSubscriptionPlanById(
        project.paymentProviderPlanId,
      )?.getName() === PlanType.Free
    );
  }

  private static async readProject(
    projectId: ObjectID,
  ): Promise<ProjectChecklistRow> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        goals: true,
        welcomeChecklistState: true,
        planName: true,
        paymentProviderPlanId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      throw new NotFoundException("Project not found.");
    }

    return {
      goals: parseProjectGoals(project.goals),
      state: parseWelcomeChecklistState(project.welcomeChecklistState),
      isFreePlan: this.isOnFreePlan(project),
    };
  }

  private static async readMilestones(
    projectId: ObjectID,
  ): Promise<Set<ActivationMilestone>> {
    const reached: Array<ReachedMilestone> =
      await ProjectMilestoneService.getReachedMilestones(projectId);

    return new Set(
      reached.map((item: ReachedMilestone): ActivationMilestone => {
        return item.milestone;
      }),
    );
  }

  /*
   * Whether somebody would be told: an enabled incident or alert on-call
   * rule runs a policy that can reach at least one responder. Until a test
   * page (#6811) has been acknowledged, or a real page has reached
   * someone, this is how the checklist knows. A policy that no rule runs,
   * or that pages nobody reachable, does not count.
   */
  public static async hasRuleThatPagesSomeone(
    projectId: ObjectID,
  ): Promise<boolean> {
    try {
      const policyIds: Array<string> =
        await this.readPoliciesRunByRules(projectId);

      for (const policyId of policyIds.slice(
        0,
        MAX_POLICIES_CHECKED_FOR_RESPONDERS,
      )) {
        try {
          const readiness: ReadinessSummary =
            await OnCallReadinessService.getReadinessForPolicy(
              new ObjectID(policyId),
              projectId,
            );

          if (readiness.readyCount + readiness.partiallyReadyCount > 0) {
            return true;
          }
        } catch (err) {
          // A policy that went away between the reads pages nobody.
          logger.debug(err);
        }
      }

      return false;
    } catch (err) {
      logger.error("Could not check whether an on-call rule pages someone:");
      logger.error(err as Error);
      return false;
    }
  }

  // The ids of the policies enabled incident and alert on-call rules run.
  public static async readPoliciesRunByRules(
    projectId: ObjectID,
  ): Promise<Array<string>> {
    const [incidentRules, alertRules]: [
      Array<IncidentOnCallRule>,
      Array<AlertOnCallRule>,
    ] = await Promise.all([
      IncidentOnCallRuleService.findBy({
        query: { projectId: projectId, isEnabled: true },
        select: { _id: true, onCallDutyPolicies: { _id: true } },
        skip: 0,
        limit: MAX_RULES_READ,
        props: { isRoot: true },
      }),
      AlertOnCallRuleService.findBy({
        query: { projectId: projectId, isEnabled: true },
        select: { _id: true, onCallDutyPolicies: { _id: true } },
        skip: 0,
        limit: MAX_RULES_READ,
        props: { isRoot: true },
      }),
    ]);

    const policyIds: Array<string> = [];

    for (const rule of [...incidentRules, ...alertRules]) {
      for (const policy of (rule.onCallDutyPolicies ||
        []) as Array<OnCallDutyPolicy>) {
        const id: string | undefined = policy?._id?.toString();

        if (id && !policyIds.includes(id)) {
          policyIds.push(id);
        }
      }
    }

    return policyIds;
  }

  public static async hasFinishedImport(projectId: ObjectID): Promise<boolean> {
    try {
      const finished: number = (
        await ToolImportRunService.countBy({
          query: {
            projectId: projectId,
            status: ToolImportRunStatus.Completed,
          },
          props: { isRoot: true },
        })
      ).toNumber();

      return finished > 0;
    } catch (err) {
      logger.error("Could not read the project's imports:");
      logger.error(err as Error);
      return false;
    }
  }

  private static async canServerSendEmail(): Promise<boolean> {
    if (IsBillingEnabled) {
      return true;
    }

    try {
      return await ServerSendingStatus.canSendEmailPublicly();
    } catch {
      // Nothing to say: the step only ever helps.
      return true;
    }
  }

  /*
   * The checklist before this one, for a project that existed before it:
   * its four counts, read once, and the checklist stored as finished when
   * they say it was - so a project that finished it never sees a checklist
   * come back. Kept as looked at either way.
   */
  public static async checkLegacyChecklist(
    projectId: ObjectID,
    state: WelcomeChecklistState,
  ): Promise<WelcomeChecklistState> {
    let counts: LegacyChecklistCounts;

    try {
      counts = await this.readLegacyCounts(projectId);
    } catch (err) {
      logger.error("Could not read the old checklist's counts:");
      logger.error(err as Error);
      // Looked at next time instead.
      return state;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    return await this.changeState(
      projectId,
      (current: WelcomeChecklistState): WelcomeChecklistState => {
        // Looked at by somebody else meanwhile: theirs stands.
        if (!needsLegacyCheck(current)) {
          return current;
        }

        const next: WelcomeChecklistState = {
          ...current,
          legacyCheckedAt: now.toISOString(),
        };

        return isLegacyChecklistComplete(counts)
          ? withWelcomeChecklistFinished(
              next,
              WelcomeChecklistFinishedBy.Legacy,
              now,
            )
          : next;
      },
    );
  }

  public static async readLegacyCounts(
    projectId: ObjectID,
  ): Promise<LegacyChecklistCounts> {
    const query: { projectId: ObjectID } = { projectId: projectId };

    const [monitors, statusPages, teamMembers, onCallPolicies]: Array<number> =
      await Promise.all([
        MonitorService.countBy({ query: query, props: { isRoot: true } }),
        StatusPageService.countBy({ query: query, props: { isRoot: true } }),
        TeamMemberService.countBy({ query: query, props: { isRoot: true } }),
        OnCallDutyPolicyService.countBy({
          query: query,
          props: { isRoot: true },
        }),
      ]).then((counts: Array<{ toNumber: () => number }>): Array<number> => {
        return counts.map((count: { toNumber: () => number }): number => {
          return count.toNumber();
        });
      });

    return {
      monitors: monitors || 0,
      statusPages: statusPages || 0,
      teamMembers: teamMembers || 0,
      onCallPolicies: onCallPolicies || 0,
    };
  }

  /*
   * CHANGES THE PROJECT'S CHECKLIST STATE AS IT STANDS NOW (#7043): in one
   * transaction, the row is read and locked (FOR UPDATE), `change` is given
   * the state it holds, and what it returns is written - with the goals,
   * when they are chosen. A writer that comes meanwhile waits for the lock,
   * then reads the state with this change in it, so no change is lost. A
   * change that leaves the state as it was writes nothing. Returns the state
   * as it now stands.
   */
  private static async changeState(
    projectId: ObjectID,
    change: (state: WelcomeChecklistState) => WelcomeChecklistState,
    options?: { goals?: Array<ProjectGoal> | undefined } | undefined,
  ): Promise<WelcomeChecklistState> {
    return await ProjectService.getRepository().manager.transaction(
      async (manager: EntityManager): Promise<WelcomeChecklistState> => {
        const rows: Array<{ welcomeChecklistState?: unknown }> =
          await manager.query(
            `SELECT "welcomeChecklistState" FROM "Project" WHERE "_id" = $1 AND "deletedAt" IS NULL FOR UPDATE`,
            [projectId.toString()],
          );

        if (!rows || rows.length === 0) {
          throw new NotFoundException("Project not found.");
        }

        const current: WelcomeChecklistState = parseWelcomeChecklistState(
          rows[0]!.welcomeChecklistState,
        );
        const next: WelcomeChecklistState = change(current);
        const json: string = JSON.stringify(toWelcomeChecklistStateJSON(next));

        if (options?.goals) {
          await manager.query(
            `UPDATE "Project" SET "goals" = $1, "welcomeChecklistState" = $2 WHERE "_id" = $3`,
            [JSON.stringify(options.goals), json, projectId.toString()],
          );

          return next;
        }

        if (
          next === current ||
          json === JSON.stringify(toWelcomeChecklistStateJSON(current))
        ) {
          return current;
        }

        await manager.query(
          `UPDATE "Project" SET "welcomeChecklistState" = $1 WHERE "_id" = $2`,
          [json, projectId.toString()],
        );

        return next;
      },
    );
  }
}
