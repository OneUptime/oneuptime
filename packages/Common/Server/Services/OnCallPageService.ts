import Alert from "../../Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import { formatAwayUntil } from "../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import { toOnCallPersonPageMessage } from "../../Types/OnCallDutyPolicy/OnCallPersonPage";
import {
  MAX_ON_CALL_DIRECT_PAGE_TARGETS,
  OnCallDirectPageTargets,
  countOnCallDirectPageTargets,
} from "../../Types/OnCallDutyPolicy/OnCallDirectPage";
import Sleep from "../../Types/Sleep";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../Types/Database/Permissions/Index";
import QueryHelper from "../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Utils/Logger";
import ProjectMembership from "../Utils/TeamMember/ProjectMembership";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import CallerPlan from "../Utils/Billing/CallerPlan";
import AlertFeedService from "./AlertFeedService";
import AlertService from "./AlertService";
import AlertSeverityService from "./AlertSeverityService";
import IncidentFeedService from "./IncidentFeedService";
import IncidentService from "./IncidentService";
import {
  OnCallNotPagedReason,
  OnCallNotPagedTarget,
  OnCallPagedTarget,
} from "./OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService, {
  OnCallDirectPageRun,
} from "./OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import TeamService from "./TeamService";
import UserService from "./UserService";

/*
 * PAGING PEOPLE: THE ONE CALL.
 *
 * `OnCallPageService.page` pages people about something, for whoever asks -
 * a workflow's Page steps today, a chat command tomorrow. One call says:
 *
 *   WHO          people (by id or by the email address they sign in with),
 *                teams (every member), on-call schedules (whoever is on call
 *                right now) and on-call policies (their escalation rules),
 *                in any mix;
 *   ABOUT WHAT   an incident, an alert, or something new - a title and a
 *                message, which become a new alert. A page about an
 *                incident or an alert that is there already can carry a
 *                message of its own, kept on its runs (pageMessage);
 *   AS WHOM      the caller's own props: what they may not read is not
 *                found, and what they may not do is refused.
 *
 * A PAGE IS ALWAYS ABOUT AN INCIDENT OR AN ALERT. That is what paging means
 * in OneUptime: each person is reached through their own On-Call Rules for
 * that kind of record and its severity, the paging goes on - a call after
 * ten minutes, a push that repeats - until the record is acknowledged, and
 * acknowledging the page acknowledges the record. So a page about something
 * new creates an alert: the record people acknowledge and resolve, with a
 * feed that says who was paged, in the Alerts list and in Slack and
 * Microsoft Teams like any other. An alert rather than an incident, because
 * an alert is the internal "somebody needs to look at this": it shows on no
 * status page and tells no customer.
 *
 * PEOPLE, TEAMS AND SCHEDULES ARE PAGED DIRECTLY: all at once, with no
 * on-call policy behind the page (Types/OnCallDutyPolicy/OnCallDirectPage).
 * A person who is away is covered or skipped as their user overrides say.
 * ON-CALL POLICIES RUN AS THEY ALWAYS DO, escalation rules and repeats
 * included.
 *
 * WHAT THE CALLER GETS BACK is who was paged, which policies started, who
 * was not paged and why - as names and sentences, ready to show - and the
 * record the page is about. A target that cannot be found, or that reaches
 * nobody, does not stop the others: one stale id must not cost the page.
 * When nothing named can be found at all, nothing is created and the call
 * throws. When the targets exist but reach nobody (everybody is away, a
 * schedule has nobody on call), the record and the page are still written,
 * so the record says a page was tried and why it reached nobody, and
 * `isAnyonePaged` is false.
 */

// Who to page. At least one of them.
export interface OnCallPageTargets {
  // People, by their user id.
  userIds?: Array<ObjectID> | undefined;
  // People, by the email address they sign in with.
  userEmails?: Array<string> | undefined;
  // Every member of each team.
  teamIds?: Array<ObjectID> | undefined;
  // Whoever is on call in each schedule right now.
  onCallScheduleIds?: Array<ObjectID> | undefined;
  // Each policy's own escalation rules.
  onCallDutyPolicyIds?: Array<ObjectID> | undefined;
}

// A page about something new: it becomes an alert.
export interface OnCallPageNewAlert {
  title: string;
  // Markdown.
  description?: string | undefined;
  // One of the project's alert severities. The most severe when left out.
  alertSeverityId?: ObjectID | undefined;
  /*
   * Markdown: where the page came from, for whoever opens the alert - "Paged
   * by Simon from Slack". A workflow's page says its workflow when left out.
   */
  rootCause?: string | undefined;
}

// What the page is about: exactly one of the three.
export interface OnCallPageAbout {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  newAlert?: OnCallPageNewAlert | undefined;
  /*
   * For a page about an incident or an alert that is there already: what
   * the person who paged wrote to the people it pages - "Can you check the
   * database?". Kept on the page's runs (pageMessage), where their Slack and
   * Microsoft Teams message quotes it and the people paged read it
   * (OnCallPersonPage). A page about something new says it in its alert's
   * title instead, so this is not taken with `newAlert`.
   */
  message?: string | undefined;
}

export interface OnCallPageRequest {
  projectId: ObjectID;
  targets: OnCallPageTargets;
  about: OnCallPageAbout;
  /*
   * Who asks, as any request of theirs is made: a person's props, an API
   * key's, a workflow step's (WorkflowPrincipal). Root for OneUptime itself.
   */
  props: DatabaseCommonInteractionProps;
  /*
   * How long the page may wait for a record that was created moments ago to
   * get its Slack and Microsoft Teams channels, so the page shows up in
   * them (waitUntilRecordIsSetUp). The default suits a background job; a
   * caller with less time passes what it has, and 0 does not wait.
   */
  maxWaitForRecordInMs?: number | undefined;
}

export enum OnCallPageRecordType {
  Incident = "Incident",
  Alert = "Alert",
}

// The incident or the alert a page is about.
export interface OnCallPageRecord {
  type: OnCallPageRecordType;
  id: ObjectID;
  // "Incident INC-8", "Alert #12".
  label: string;
  title: string;
  // Its page in the Dashboard.
  url: URL;
  // Whether this call created it: an alert for a page about something new.
  isNew: boolean;
}

// One person who was paged directly.
export interface OnCallPagedPerson {
  userId: ObjectID;
  name: string;
  email: string | null;
  // The team they were paged as a member of, when they were.
  teamName: string | null;
  // The schedule they are on call in, when that is why they were paged.
  scheduleName: string | null;
  // Whom they cover, when a user override sent the page to them.
  coveringForName: string | null;
}

// One on-call policy that was started.
export interface OnCallPageStartedPolicy {
  onCallDutyPolicyId: ObjectID;
  name: string;
}

export interface OnCallPageResult {
  record: OnCallPageRecord;
  // Everybody paged directly, once each.
  paged: Array<OnCallPagedPerson>;
  startedPolicies: Array<OnCallPageStartedPolicy>;
  /*
   * Who and what was not paged, each as a sentence: "Alex Kim was not
   * paged: they are away until 2026-10-17 09:00 UTC, and nobody is named to
   * cover for them.", "Nobody is on call in schedule Primary right now."
   */
  notPaged: Array<string>;
  // Whether anybody was paged directly, or a policy started.
  isAnyonePaged: boolean;
  // The direct page's run, when people, teams or schedules were named.
  directPageExecutionLogId: ObjectID | null;
  // The whole of it in a few sentences, ready to show or to post.
  summary: string;
}

// A target the caller named that could be read, by its name.
interface NamedTarget {
  id: ObjectID;
  name: string;
}

interface ResolvedTargets {
  users: Array<User>;
  teams: Array<NamedTarget>;
  schedules: Array<NamedTarget>;
  policies: Array<NamedTarget>;
  // What was named and could not be paged, each as a sentence.
  notFound: Array<string>;
}

// A record is being set up for this long after it is created, at most.
export const ON_CALL_PAGE_RECORD_SETUP_AGE_IN_MS: number = 2 * 60 * 1000;

// How long a page waits for a new record's channels, unless told otherwise.
export const ON_CALL_PAGE_DEFAULT_MAX_WAIT_FOR_RECORD_IN_MS: number = 20 * 1000;

// How often it looks.
export const ON_CALL_PAGE_RECORD_SETUP_POLL_INTERVAL_IN_MS: number = 500;

// How many of the people paged a summary names before "and N others".
const MAX_NAMES_IN_SUMMARY: number = 5;

/*
 * What somebody who may start on-call runs, and may not page people directly,
 * is told first (assertCallerMayPageDirectly). Why follows it.
 */
export const ON_CALL_DIRECT_PAGE_NOT_ALLOWED_MESSAGE: string =
  "Paging people, teams or on-call schedules directly takes access to every on-call policy of the project.";

export class Service {
  @CaptureSpan()
  public async page(pageRequest: OnCallPageRequest): Promise<OnCallPageResult> {
    /*
     * On the caller's plan, read here when their props do not carry it, as
     * the create itself reads it (CallerPlan.withPlanFor): the check below
     * is asked before anything is created, and a plan check never reads
     * "no plan" as any plan - it refuses it. Props built outside an API
     * request without the plan - a chat's, before they carried it - were
     * refused every page on OneUptime Cloud ("OneUptime could not confirm
     * which plan this project is on").
     */
    const request: OnCallPageRequest = {
      ...pageRequest,
      props: await CallerPlan.withPlanFor({
        props: pageRequest.props,
        modelType: OnCallDutyPolicyExecutionLog,
        type: DatabaseRequestType.Create,
      }),
    };
    const projectId: ObjectID = request.projectId;
    const props: DatabaseCommonInteractionProps = request.props;

    this.assertRequestIsWellFormed(request);

    /*
     * May the caller page at all: the permission to start an on-call run,
     * on a plan that includes on-call. Asked before anything is read, so no
     * answer below tells somebody who may not page which ids the project
     * has.
     */
    ModelPermission.checkTableWritePermission(
      OnCallDutyPolicyExecutionLog,
      props,
      DatabaseRequestType.Create,
    );

    if (this.namesDirectTargets(request.targets)) {
      await this.assertCallerMayPageDirectly(request);
    }

    const targets: ResolvedTargets = await this.resolveTargets(request);

    const resolvedCount: number =
      targets.users.length +
      targets.teams.length +
      targets.schedules.length +
      targets.policies.length;

    // Nothing named can be paged: nothing is created.
    if (resolvedCount === 0) {
      throw new BadDataException(
        `Nobody was paged. ${targets.notFound.join(" ")}`.trim(),
      );
    }

    const record: OnCallPageRecord = await this.resolveRecord({
      request: request,
      // A new alert runs the policies itself, once it is set up.
      policiesForNewAlert: targets.policies,
    });

    const directTargets: OnCallDirectPageTargets = {
      userIds: targets.users.map((user: User): ObjectID => {
        return user.id!;
      }),
      teamIds: targets.teams.map((team: NamedTarget): ObjectID => {
        return team.id;
      }),
      onCallScheduleIds: targets.schedules.map(
        (schedule: NamedTarget): ObjectID => {
          return schedule.id;
        },
      ),
    };

    const hasDirectTargets: boolean =
      countOnCallDirectPageTargets(directTargets) > 0;

    /*
     * A record created moments ago is still getting its Slack and Microsoft
     * Teams channels. Its own on-call policies wait for them, and so does a
     * page of this kind - the policies of an existing record, and every
     * direct page.
     */
    if (hasDirectTargets || (!record.isNew && targets.policies.length > 0)) {
      await this.waitUntilRecordIsSetUp({
        record: record,
        maxWaitInMs:
          request.maxWaitForRecordInMs ??
          ON_CALL_PAGE_DEFAULT_MAX_WAIT_FOR_RECORD_IN_MS,
      });
    }

    const notPaged: Array<string> = [...targets.notFound];
    const startedPolicies: Array<OnCallPageStartedPolicy> = [];

    /*
     * What the person who paged wrote, for a page about a record that is
     * there already: kept on each run the page starts (pageMessage).
     */
    const pageMessage: string = record.isNew
      ? ""
      : toOnCallPersonPageMessage(request.about.message);

    if (record.isNew) {
      // Named on the new alert, which starts them as it starts its own.
      for (const policy of targets.policies) {
        startedPolicies.push({
          onCallDutyPolicyId: policy.id,
          name: policy.name,
        });
      }
    } else {
      for (const policy of targets.policies) {
        try {
          await this.startPolicy({
            projectId: projectId,
            policy: policy,
            record: record,
            props: props,
            pageMessage: pageMessage,
          });

          startedPolicies.push({
            onCallDutyPolicyId: policy.id,
            name: policy.name,
          });
        } catch (err) {
          // One policy that cannot start does not stop the others.
          logger.error(
            err as Error,
            {
              projectId: projectId.toString(),
            } as LogAttributes,
          );

          notPaged.push(
            `On-call policy ${policy.name} could not be started: ${this.asSentence(
              (err as Error)?.message || "an error occurred",
            )}`,
          );
        }
      }
    }

    let paged: Array<OnCallPagedPerson> = [];
    let directPageExecutionLogId: ObjectID | null = null;

    if (hasDirectTargets) {
      const run: OnCallDirectPageRun =
        await OnCallDutyPolicyExecutionLogService.startDirectPage({
          projectId: projectId,
          targets: directTargets,
          triggeredByIncidentId:
            record.type === OnCallPageRecordType.Incident
              ? record.id
              : undefined,
          triggeredByAlertId:
            record.type === OnCallPageRecordType.Alert ? record.id : undefined,
          startedBy: {
            userId: props.userId,
            workflowId: props.workflowId,
            workflowName: props.workflowName,
          },
          ...(pageMessage ? { pageMessage: pageMessage } : {}),
        });

      directPageExecutionLogId = run.executionLogId;

      const named: {
        paged: Array<OnCallPagedPerson>;
        notPaged: Array<string>;
      } = await this.nameOutcome({
        paged: run.outcome.paged,
        notPaged: run.outcome.notPaged,
        targets: targets,
      });

      paged = named.paged;
      notPaged.push(...named.notPaged);
    }

    const isAnyonePaged: boolean =
      paged.length > 0 || startedPolicies.length > 0;

    return {
      record: record,
      paged: paged,
      startedPolicies: startedPolicies,
      notPaged: notPaged,
      isAnyonePaged: isAnyonePaged,
      directPageExecutionLogId: directPageExecutionLogId,
      summary: this.getSummary({
        record: record,
        paged: paged,
        startedPolicies: startedPolicies,
        notPaged: notPaged,
      }),
    };
  }

  /*
   * A request says who to page and about what, once: a page with nobody to
   * page, with nothing to be about, or about two things at once is a
   * mistake in whatever built it.
   */
  private assertRequestIsWellFormed(request: OnCallPageRequest): void {
    const targets: OnCallPageTargets = request.targets || {};

    const targetCount: number =
      (targets.userIds?.length || 0) +
      (targets.userEmails?.length || 0) +
      (targets.teamIds?.length || 0) +
      (targets.onCallScheduleIds?.length || 0) +
      (targets.onCallDutyPolicyIds?.length || 0);

    if (targetCount === 0) {
      throw new BadDataException(
        "A page needs somebody to page: a person, a team, an on-call schedule or an on-call policy.",
      );
    }

    if (targetCount > MAX_ON_CALL_DIRECT_PAGE_TARGETS) {
      throw new BadDataException(
        `A page names at most ${MAX_ON_CALL_DIRECT_PAGE_TARGETS} people, teams, on-call schedules and on-call policies. This one names ${targetCount}.`,
      );
    }

    const about: OnCallPageAbout = request.about || {};

    const aboutCount: number = [
      about.incidentId,
      about.alertId,
      about.newAlert,
    ].filter(Boolean).length;

    if (aboutCount === 0) {
      throw new BadDataException(
        "A page is about an incident, an alert, or something new with a title. Name one of them.",
      );
    }

    if (aboutCount > 1) {
      throw new BadDataException(
        "A page is about one thing: an incident, an alert, or something new with a title. Name only one of them.",
      );
    }

    if (about.newAlert && !(about.newAlert.title || "").trim()) {
      throw new BadDataException(
        "A page about something new needs a title: it is what the people paged are told.",
      );
    }

    // Its alert's title says what a page about something new is about.
    if (about.newAlert && (about.message || "").trim()) {
      throw new BadDataException(
        "A page about something new says what it is about in its alert's title. Leave the message out.",
      );
    }
  }

  // Whether a request names anybody to page with no policy behind the page.
  private namesDirectTargets(targets: OnCallPageTargets): boolean {
    return (
      (targets.userIds?.length || 0) +
        (targets.userEmails?.length || 0) +
        (targets.teamIds?.length || 0) +
        (targets.onCallScheduleIds?.length || 0) >
      0
    );
  }

  /*
   * MAY THE CALLER PAGE PEOPLE WITH NO POLICY BEHIND THE PAGE.
   *
   * A direct page is a run that names no on-call policy. OneUptime writes
   * that run itself - the run's own service refuses one from anybody else -
   * so before it does, the caller is asked exactly what creating the run
   * themselves would ask of them (DatabaseService.checkCallerMayCreate): the
   * permission to start on-call runs, each column of one, and - as the run
   * belongs to no policy - a read of on-call policies that reaches the whole
   * project and a permission to start runs that is not limited to some
   * labels or to what they own.
   *
   * So somebody allowed to start only the on-call policies under one team's
   * label cannot page whoever they like by leaving the policy out. An
   * on-call policy named in the page is started as the caller, and held to
   * its own labels and owners as it always is (startPolicy).
   *
   * Asked before anything the caller named is read, like the check above.
   * The refusal says what it is about in a sentence of its own, then why in
   * the words the permission check gave.
   */
  private async assertCallerMayPageDirectly(
    request: OnCallPageRequest,
  ): Promise<void> {
    const run: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();

    run.projectId = request.projectId;
    run.userNotificationEventType = request.about.incidentId
      ? UserNotificationEventType.IncidentCreated
      : UserNotificationEventType.AlertCreated;

    try {
      await OnCallDutyPolicyExecutionLogService.checkCallerMayCreate({
        data: run,
        props: request.props,
      });
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(
          `${ON_CALL_DIRECT_PAGE_NOT_ALLOWED_MESSAGE} ${err.message}`,
        );
      }

      throw err;
    }
  }

  /*
   * Everything the caller named, read as the caller reads it: a team, a
   * schedule or a policy they may not read is not found, exactly as one
   * that is not there. People are held to the project's members - nobody
   * else is ever paged on its behalf - by id or by email address.
   *
   * An id that is not an id at all - a name, half a line - is answered as
   * one nobody has, without being asked of the database.
   */
  private async resolveTargets(
    request: OnCallPageRequest,
  ): Promise<ResolvedTargets> {
    const projectId: ObjectID = request.projectId;
    const props: DatabaseCommonInteractionProps = request.props;
    const notFound: Array<string> = [];

    // ---- people -------------------------------------------------------------

    const namedUserIds: Array<ObjectID> = this.unique(request.targets.userIds);
    const userIds: Array<ObjectID> = namedUserIds.filter(this.isReadableId);
    const userEmails: Array<string> = Array.from(
      new Set<string>(
        (request.targets.userEmails || [])
          .map((email: string): string => {
            return (email || "").toString().trim().toLowerCase();
          })
          .filter((email: string): boolean => {
            return email.length > 0;
          }),
      ),
    );

    const usersById: Array<User> =
      userIds.length > 0
        ? await UserService.findBy({
            query: {
              _id: QueryHelper.any(userIds),
            },
            select: {
              _id: true,
              name: true,
              email: true,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: {
              isRoot: true,
            },
          })
        : [];

    const usersByEmail: Array<User> =
      userEmails.length > 0
        ? await UserService.findBy({
            query: {
              email: QueryHelper.any(userEmails),
            },
            select: {
              _id: true,
              name: true,
              email: true,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: {
              isRoot: true,
            },
          })
        : [];

    const memberUserIds: Set<string> =
      usersById.length + usersByEmail.length > 0
        ? await ProjectMembership.getMemberUserIds({
            projectId: projectId,
            userIds: [...usersById, ...usersByEmail].map(
              (user: User): ObjectID => {
                return user.id!;
              },
            ),
          })
        : new Set<string>();

    const isMember: (user: User | undefined) => user is User = (
      user: User | undefined,
    ): user is User => {
      return Boolean(
        user?.id && memberUserIds.has(user.id.toString().toLowerCase()),
      );
    };

    const users: Array<User> = [];
    const seenUserIds: Set<string> = new Set<string>();

    const addUser: (user: User) => void = (user: User): void => {
      const key: string = user.id!.toString().toLowerCase();

      if (!seenUserIds.has(key)) {
        seenUserIds.add(key);
        users.push(user);
      }
    };

    for (const userId of namedUserIds) {
      const user: User | undefined = usersById.find(
        (candidate: User): boolean => {
          return this.isSameId(candidate.id, userId);
        },
      );

      /*
       * Somebody who is not a member - they left, never accepted, or the id
       * is nobody's - is answered the same way: whether an id is somebody's
       * outside this project is nobody's to learn here.
       */
      if (!isMember(user)) {
        notFound.push(
          `No member of this project has the ID ${userId.toString()}.`,
        );
        continue;
      }

      addUser(user);
    }

    for (const email of userEmails) {
      const user: User | undefined = usersByEmail.find(
        (candidate: User): boolean => {
          return candidate.email?.toString().toLowerCase() === email;
        },
      );

      if (!isMember(user)) {
        notFound.push(`No member of this project has the email ${email}.`);
        continue;
      }

      addUser(user);
    }

    // ---- teams, schedules and policies ------------------------------------

    const teamIds: Array<ObjectID> = this.unique(request.targets.teamIds);
    const readableTeamIds: Array<ObjectID> = teamIds.filter(this.isReadableId);

    const teamsFound: Array<Team> =
      readableTeamIds.length > 0
        ? await TeamService.findBy({
            query: {
              _id: QueryHelper.any(readableTeamIds),
              projectId: projectId,
            },
            select: {
              _id: true,
              name: true,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: props,
          })
        : [];

    const teams: Array<NamedTarget> = [];

    for (const teamId of teamIds) {
      const team: Team | undefined = teamsFound.find(
        (candidate: Team): boolean => {
          return this.isSameId(candidate.id, teamId);
        },
      );

      if (!team?.id) {
        notFound.push(`No team has the ID ${teamId.toString()}.`);
        continue;
      }

      teams.push({ id: team.id, name: team.name || "Unnamed team" });
    }

    const scheduleIds: Array<ObjectID> = this.unique(
      request.targets.onCallScheduleIds,
    );

    const readableScheduleIds: Array<ObjectID> = scheduleIds.filter(
      this.isReadableId,
    );

    const schedulesFound: Array<OnCallDutyPolicySchedule> =
      readableScheduleIds.length > 0
        ? await OnCallDutyPolicyScheduleService.findBy({
            query: {
              _id: QueryHelper.any(readableScheduleIds),
              projectId: projectId,
            },
            select: {
              _id: true,
              name: true,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: props,
          })
        : [];

    const schedules: Array<NamedTarget> = [];

    for (const scheduleId of scheduleIds) {
      const schedule: OnCallDutyPolicySchedule | undefined =
        schedulesFound.find((candidate: OnCallDutyPolicySchedule): boolean => {
          return this.isSameId(candidate.id, scheduleId);
        });

      if (!schedule?.id) {
        notFound.push(
          `No on-call schedule has the ID ${scheduleId.toString()}.`,
        );
        continue;
      }

      schedules.push({
        id: schedule.id,
        name: schedule.name || "Unnamed schedule",
      });
    }

    const policyIds: Array<ObjectID> = this.unique(
      request.targets.onCallDutyPolicyIds,
    );

    const readablePolicyIds: Array<ObjectID> = policyIds.filter(
      this.isReadableId,
    );

    const policiesFound: Array<OnCallDutyPolicy> =
      readablePolicyIds.length > 0
        ? await OnCallDutyPolicyService.findBy({
            query: {
              _id: QueryHelper.any(readablePolicyIds),
              projectId: projectId,
            },
            select: {
              _id: true,
              name: true,
              isArchived: true,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: props,
          })
        : [];

    const policies: Array<NamedTarget> = [];

    for (const policyId of policyIds) {
      const policy: OnCallDutyPolicy | undefined = policiesFound.find(
        (candidate: OnCallDutyPolicy): boolean => {
          return this.isSameId(candidate.id, policyId);
        },
      );

      if (!policy?.id) {
        notFound.push(`No on-call policy has the ID ${policyId.toString()}.`);
        continue;
      }

      const name: string = policy.name || "Unnamed policy";

      // An archived policy pages no one (OnCallDutyPolicyArchive).
      if (policy.isArchived === true) {
        notFound.push(
          `On-call policy ${name} is archived, so it pages no one.`,
        );
        continue;
      }

      policies.push({ id: policy.id, name: name });
    }

    return {
      users: users,
      teams: teams,
      schedules: schedules,
      policies: policies,
      notFound: notFound,
    };
  }

  /*
   * The record the page is about: the incident or the alert the caller
   * named, read as the caller reads it - or a new alert, created as the
   * caller, for a page about something new.
   */
  private async resolveRecord(data: {
    request: OnCallPageRequest;
    policiesForNewAlert: Array<NamedTarget>;
  }): Promise<OnCallPageRecord> {
    const request: OnCallPageRequest = data.request;
    const projectId: ObjectID = request.projectId;
    const props: DatabaseCommonInteractionProps = request.props;

    if (request.about.incidentId) {
      const incident: Incident | null = this.isReadableId(
        request.about.incidentId,
      )
        ? await IncidentService.findOneBy({
            query: {
              _id: request.about.incidentId,
              projectId: projectId,
            },
            select: {
              _id: true,
              title: true,
              incidentNumber: true,
              incidentNumberWithPrefix: true,
            },
            props: props,
          })
        : null;

      if (!incident?.id) {
        throw new BadDataException(
          `Nobody was paged. No incident has the ID ${request.about.incidentId.toString()}.`,
        );
      }

      return {
        type: OnCallPageRecordType.Incident,
        id: incident.id,
        label: `Incident ${incident.incidentNumberWithPrefix || "#" + (incident.incidentNumber ?? "")}`,
        title: incident.title || "",
        url: await IncidentService.getIncidentLinkInDashboard(
          projectId,
          incident.id,
        ),
        isNew: false,
      };
    }

    if (request.about.alertId) {
      const alert: Alert | null = this.isReadableId(request.about.alertId)
        ? await AlertService.findOneBy({
            query: {
              _id: request.about.alertId,
              projectId: projectId,
            },
            select: {
              _id: true,
              title: true,
              alertNumber: true,
              alertNumberWithPrefix: true,
            },
            props: props,
          })
        : null;

      if (!alert?.id) {
        throw new BadDataException(
          `Nobody was paged. No alert has the ID ${request.about.alertId.toString()}.`,
        );
      }

      return this.getAlertRecord({
        projectId: projectId,
        alert: alert,
        isNew: false,
      });
    }

    return await this.createAlert({
      request: request,
      newAlert: request.about.newAlert!,
      policies: data.policiesForNewAlert,
    });
  }

  private async getAlertRecord(data: {
    projectId: ObjectID;
    alert: Alert;
    isNew: boolean;
  }): Promise<OnCallPageRecord> {
    return {
      type: OnCallPageRecordType.Alert,
      id: data.alert.id!,
      label: `Alert ${data.alert.alertNumberWithPrefix || "#" + (data.alert.alertNumber ?? "")}`,
      title: data.alert.title || "",
      url: await AlertService.getAlertLinkInDashboard(
        data.projectId,
        data.alert.id!,
      ),
      isNew: data.isNew,
    };
  }

  /*
   * The alert a page about something new becomes: its title and message,
   * at the severity asked for - the project's most severe when none is, as
   * every alert OneUptime raises without one is - and with the on-call
   * policies the page names, which the alert then runs like any it is
   * created with. Created as the caller, so it is theirs to be allowed.
   */
  private async createAlert(data: {
    request: OnCallPageRequest;
    newAlert: OnCallPageNewAlert;
    policies: Array<NamedTarget>;
  }): Promise<OnCallPageRecord> {
    const projectId: ObjectID = data.request.projectId;
    const props: DatabaseCommonInteractionProps = data.request.props;

    let alertSeverityId: ObjectID | undefined = data.newAlert.alertSeverityId;

    /*
     * A severity the page names is one of the project's own, or the page is
     * told so in the words every other id it names is answered in - before
     * an alert is created that nobody would then be paged about.
     */
    if (alertSeverityId) {
      const namedSeverity: AlertSeverity | null = this.isReadableId(
        alertSeverityId,
      )
        ? await AlertSeverityService.findOneBy({
            query: {
              _id: alertSeverityId,
              projectId: projectId,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          })
        : null;

      if (!namedSeverity?.id) {
        throw new BadDataException(
          `Nobody was paged. No alert severity has the ID ${alertSeverityId.toString()}.`,
        );
      }
    }

    if (!alertSeverityId) {
      const severity: AlertSeverity | null =
        await AlertSeverityService.findOneBy({
          query: {
            projectId: projectId,
            // A default OneUptime picks itself: never an archived severity.
            isArchived: false,
          },
          sort: {
            order: SortOrder.Ascending,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!severity?.id) {
        throw new BadDataException(
          "Nobody was paged. This project has no alert severities, and a page about something new is an alert. Add one in Project Settings.",
        );
      }

      alertSeverityId = severity.id;
    }

    const alert: Alert = new Alert();

    alert.projectId = projectId;
    alert.title = data.newAlert.title.trim();
    alert.alertSeverityId = alertSeverityId;

    const description: string = (data.newAlert.description || "").trim();

    if (description) {
      alert.description = description;
    }

    if (data.policies.length > 0) {
      alert.onCallDutyPolicies = data.policies.map(
        (policy: NamedTarget): OnCallDutyPolicy => {
          const onCallDutyPolicy: OnCallDutyPolicy = new OnCallDutyPolicy();
          onCallDutyPolicy.id = policy.id;
          return onCallDutyPolicy;
        },
      );
    }

    // Where the alert came from, for whoever opens it.
    const workflowName: string = (props.workflowName || "").trim();
    const rootCause: string = (data.newAlert.rootCause || "").trim();

    if (rootCause) {
      alert.rootCause = rootCause;
    } else if (workflowName) {
      alert.rootCause =
        mdText`Created by workflow **${workflowName}** to page people.`.toString();
    }

    const createdAlert: Alert = await AlertService.create({
      data: alert,
      props: props,
    });

    return this.getAlertRecord({
      projectId: projectId,
      alert: createdAlert,
      isNew: true,
    });
  }

  /*
   * A RECORD CREATED MOMENTS AGO IS STILL BEING SET UP.
   *
   * Creating an incident or an alert answers at once and carries on behind:
   * its Slack and Microsoft Teams channels are created, its people are
   * added to them, and then its "created" entry is written to its feed and
   * posted. A workflow that starts on the record being created runs at the
   * same moment - and a page sent then would find no channel to say who it
   * paged in, nor to add those people to.
   *
   * So a page about a record less than two minutes old waits for that
   * record's "created" feed entry, which is written right after its
   * channels are: a moment, usually. It waits at most `maxWaitInMs`, and
   * then pages anyway - a page that is late in a channel is better than one
   * that is late on a phone. A record older than that is paged about at
   * once.
   */
  @CaptureSpan()
  public async waitUntilRecordIsSetUp(data: {
    record: { type: OnCallPageRecordType; id: ObjectID };
    maxWaitInMs: number;
  }): Promise<void> {
    if (data.maxWaitInMs <= 0) {
      return;
    }

    const startedAt: number = OneUptimeDate.getCurrentDate().getTime();

    try {
      const createdAt: Date | null = await this.getRecordCreatedAt(data.record);

      if (
        !createdAt ||
        OneUptimeDate.getCurrentDate().getTime() - createdAt.getTime() >
          ON_CALL_PAGE_RECORD_SETUP_AGE_IN_MS
      ) {
        return;
      }

      while (!(await this.hasCreatedFeedEntry(data.record))) {
        const waitedInMs: number =
          OneUptimeDate.getCurrentDate().getTime() - startedAt;

        if (waitedInMs >= data.maxWaitInMs) {
          logger.debug(
            `Paging about ${data.record.type} ${data.record.id.toString()} without waiting longer for its channels.`,
          );
          return;
        }

        await Sleep.sleep(
          Math.min(
            ON_CALL_PAGE_RECORD_SETUP_POLL_INTERVAL_IN_MS,
            data.maxWaitInMs - waitedInMs,
          ),
        );
      }
    } catch (err) {
      // Never a reason not to page.
      logger.error(err as Error);
    }
  }

  private async getRecordCreatedAt(record: {
    type: OnCallPageRecordType;
    id: ObjectID;
  }): Promise<Date | null> {
    if (record.type === OnCallPageRecordType.Incident) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: record.id,
        select: {
          createdAt: true,
        },
        props: {
          isRoot: true,
        },
      });

      return incident?.createdAt ? new Date(incident.createdAt) : null;
    }

    const alert: Alert | null = await AlertService.findOneById({
      id: record.id,
      select: {
        createdAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    return alert?.createdAt ? new Date(alert.createdAt) : null;
  }

  // Whether the record's "created" entry is in its feed yet.
  private async hasCreatedFeedEntry(record: {
    type: OnCallPageRecordType;
    id: ObjectID;
  }): Promise<boolean> {
    if (record.type === OnCallPageRecordType.Incident) {
      return Boolean(
        await IncidentFeedService.findOneBy({
          query: {
            incidentId: record.id,
            incidentFeedEventType: IncidentFeedEventType.IncidentCreated,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        }),
      );
    }

    return Boolean(
      await AlertFeedService.findOneBy({
        query: {
          alertId: record.id,
          alertFeedEventType: AlertFeedEventType.AlertCreated,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      }),
    );
  }

  /*
   * Starts an on-call policy for a record that is already there, as the
   * caller: the execution log the Dashboard's Execute On-Call Policy
   * creates. The log service pages from there.
   */
  private async startPolicy(data: {
    projectId: ObjectID;
    policy: NamedTarget;
    record: OnCallPageRecord;
    props: DatabaseCommonInteractionProps;
    // What the person who paged wrote, kept on the run. Empty for none.
    pageMessage?: string | undefined;
  }): Promise<void> {
    const executionLog: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();

    executionLog.projectId = data.projectId;
    executionLog.onCallDutyPolicyId = data.policy.id;

    if (data.record.type === OnCallPageRecordType.Incident) {
      executionLog.triggeredByIncidentId = data.record.id;
      executionLog.userNotificationEventType =
        UserNotificationEventType.IncidentCreated;
    } else {
      executionLog.triggeredByAlertId = data.record.id;
      executionLog.userNotificationEventType =
        UserNotificationEventType.AlertCreated;
    }

    const created: OnCallDutyPolicyExecutionLog =
      await OnCallDutyPolicyExecutionLogService.create({
        data: executionLog,
        props: data.props,
      });

    /*
     * The message is OneUptime's to write (no caller may), once the run is
     * created as the caller: its chat message quotes it from the next time
     * it is brought up to date - a moment after its first post at most.
     * Never a reason the policy is not started.
     */
    if (data.pageMessage && created.id) {
      try {
        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: created.id,
          data: {
            pageMessage: data.pageMessage,
          },
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        logger.error(err as Error, {
          projectId: data.projectId.toString(),
        } as LogAttributes);
      }
    }
  }

  /*
   * Who a direct page paged and did not, by name: the people from the
   * project's users, the teams and schedules from what the caller named.
   */
  private async nameOutcome(data: {
    paged: Array<OnCallPagedTarget>;
    notPaged: Array<OnCallNotPagedTarget>;
    targets: ResolvedTargets;
  }): Promise<{
    paged: Array<OnCallPagedPerson>;
    notPaged: Array<string>;
  }> {
    const userIds: Array<ObjectID> = this.unique(
      [
        ...data.paged.flatMap(
          (target: OnCallPagedTarget): Array<ObjectID | null> => {
            return [target.userId, target.coveringForUserId];
          },
        ),
        ...data.notPaged.map(
          (target: OnCallNotPagedTarget): ObjectID | null => {
            return target.userId;
          },
        ),
      ].filter((userId: ObjectID | null): userId is ObjectID => {
        return Boolean(userId);
      }),
    );

    /*
     * Everybody a page reaches is somebody the engine found for the caller's
     * own targets - a member of a team they named, whoever is on call in a
     * schedule they named, whoever covers a person they named.
     */
    const users: Array<User> =
      userIds.length > 0
        ? await UserService.findBy({
            query: {
              _id: QueryHelper.any(userIds),
            },
            select: {
              _id: true,
              name: true,
              email: true,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: {
              isRoot: true,
            },
          })
        : [];

    const findUser: (userId: ObjectID | null) => User | undefined = (
      userId: ObjectID | null,
    ): User | undefined => {
      if (!userId) {
        return undefined;
      }

      return users.find((user: User): boolean => {
        return this.isSameId(user.id, userId);
      });
    };

    const nameOfUser: (userId: ObjectID | null) => string = (
      userId: ObjectID | null,
    ): string => {
      const user: User | undefined = findUser(userId);

      return (
        user?.name?.toString().trim() ||
        user?.email?.toString().trim() ||
        "Someone"
      );
    };

    const nameOf: (
      list: Array<NamedTarget>,
      id: ObjectID | null,
    ) => string | null = (
      list: Array<NamedTarget>,
      id: ObjectID | null,
    ): string | null => {
      if (!id) {
        return null;
      }

      return (
        list.find((target: NamedTarget): boolean => {
          return this.isSameId(target.id, id);
        })?.name || null
      );
    };

    const paged: Array<OnCallPagedPerson> = data.paged.map(
      (target: OnCallPagedTarget): OnCallPagedPerson => {
        return {
          userId: target.userId,
          name: nameOfUser(target.userId),
          email: findUser(target.userId)?.email?.toString() || null,
          teamName: nameOf(data.targets.teams, target.teamId),
          scheduleName: nameOf(data.targets.schedules, target.scheduleId),
          coveringForName: target.coveringForUserId
            ? nameOfUser(target.coveringForUserId)
            : null,
        };
      },
    );

    const notPaged: Array<string> = data.notPaged.map(
      (target: OnCallNotPagedTarget): string => {
        switch (target.reason) {
          case OnCallNotPagedReason.Away:
            return target.awayUntil
              ? `${nameOfUser(target.userId)} was not paged: they are away until ${formatAwayUntil(target.awayUntil)}, and nobody is named to cover for them.`
              : `${nameOfUser(target.userId)} was not paged: they are away, and nobody is named to cover for them.`;
          case OnCallNotPagedReason.NotAProjectMember:
            return `${nameOfUser(target.userId)} was not paged: they are not a member of this project.`;
          case OnCallNotPagedReason.NobodyOnCall:
            return `Nobody is on call in schedule ${nameOf(data.targets.schedules, target.scheduleId) || "(unnamed)"} right now.`;
          // A direct page never pages the next person in a rotation; said all the same.
          case OnCallNotPagedReason.NobodyNextInRotation:
            return `Nobody is next in the rotation of schedule ${nameOf(data.targets.schedules, target.scheduleId) || "(unnamed)"} right now.`;
          // A direct page pages everybody as it starts; said all the same.
          case OnCallNotPagedReason.PassedOn:
            return `${nameOfUser(target.userId)} was not paged: they escalated this page.`;
          case OnCallNotPagedReason.EmptyTeam:
          default:
            return `Team ${nameOf(data.targets.teams, target.teamId) || "(unnamed)"} has no members.`;
        }
      },
    );

    return {
      paged: paged,
      // The same sentence once, however many targets it is true of.
      notPaged: Array.from(new Set<string>(notPaged)),
    };
  }

  /*
   * The whole page in a few sentences: who was paged about what, which
   * policies started, and who was not paged and why.
   */
  private getSummary(data: {
    record: OnCallPageRecord;
    paged: Array<OnCallPagedPerson>;
    startedPolicies: Array<OnCallPageStartedPolicy>;
    notPaged: Array<string>;
  }): string {
    const sentences: Array<string> = [];

    if (data.paged.length > 0) {
      sentences.push(
        `Paged ${this.joinNames(
          data.paged.map((person: OnCallPagedPerson): string => {
            return this.describePagedPerson(person);
          }),
        )} about ${data.record.label}.`,
      );
    }

    if (data.startedPolicies.length > 0) {
      sentences.push(
        `Started on-call ${data.startedPolicies.length === 1 ? "policy" : "policies"} ${this.joinNames(
          data.startedPolicies.map(
            (policy: OnCallPageStartedPolicy): string => {
              return policy.name;
            },
          ),
        )} for ${data.record.label}.`,
      );
    }

    if (sentences.length === 0) {
      sentences.push(`Nobody was paged about ${data.record.label}.`);
    }

    return [...sentences, ...data.notPaged].join(" ");
  }

  // "Jane Doe", "Jane Doe (on call in Primary)", "Sam Lee (covering for Alex Kim)".
  private describePagedPerson(person: OnCallPagedPerson): string {
    const notes: Array<string> = [];

    if (person.scheduleName) {
      notes.push(`on call in ${person.scheduleName}`);
    } else if (person.teamName) {
      notes.push(`member of ${person.teamName}`);
    }

    if (person.coveringForName) {
      notes.push(`covering for ${person.coveringForName}`);
    }

    return notes.length > 0
      ? `${person.name} (${notes.join(", ")})`
      : person.name;
  }

  // "A", "A and B", "A, B and C", and past five names "A, B, C, D, E and 3 others".
  private joinNames(names: Array<string>): string {
    if (names.length > MAX_NAMES_IN_SUMMARY) {
      const others: number = names.length - MAX_NAMES_IN_SUMMARY;

      return `${names.slice(0, MAX_NAMES_IN_SUMMARY).join(", ")} and ${others} ${others === 1 ? "other" : "others"}`;
    }

    if (names.length <= 1) {
      return names[0] || "";
    }

    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  }

  // A message as a sentence of its own, ending once.
  private asSentence(message: string): string {
    const trimmed: string = message.trim();
    const last: string = trimmed.charAt(trimmed.length - 1);

    return last === "." || last === "!" || last === "?"
      ? trimmed
      : `${trimmed}.`;
  }

  /*
   * Whether an id can be one of a record's at all. One that cannot - a
   * name, a line cut short - is not asked of the database, which would
   * answer with an error about its type rather than with "not found".
   */
  private isReadableId: (id: ObjectID) => boolean = (id: ObjectID): boolean => {
    return ObjectID.isValidUUID(id.toString());
  };

  /*
   * Whether two ids name the same record. The database reads an id whatever
   * its case and hands it back in lower case, so an id named in upper case
   * is found - and is the record that was found.
   */
  private isSameId(
    a: ObjectID | null | undefined,
    b: ObjectID | null | undefined,
  ): boolean {
    if (!a || !b) {
      return false;
    }

    return a.toString().toLowerCase() === b.toString().toLowerCase();
  }

  // Each id once, in the order it was named.
  private unique(ids: Array<ObjectID> | undefined): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const result: Array<ObjectID> = [];

    for (const id of ids || []) {
      const key: string = (id?.toString() || "").toLowerCase();

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(id);
    }

    return result;
  }
}

export default new Service();
