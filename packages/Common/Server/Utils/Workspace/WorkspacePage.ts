import Alert from "../../../Models/DatabaseModels/Alert";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceLiveMessage from "../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceUserGroup from "../../../Models/DatabaseModels/WorkspaceUserGroup";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { MAX_ON_CALL_DIRECT_PAGE_TARGETS } from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import WorkspaceLiveMessageKey, {
  WorkspaceLiveMessageDestinationType,
  WorkspaceLiveMessagePageRecordType,
} from "../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import OnCallPageService, {
  OnCallPagedPerson,
  OnCallPageNewAlert,
  OnCallPageRecordType,
  OnCallPageResult,
  OnCallPageStartedPolicy,
  OnCallPageTargets,
} from "../../Services/OnCallPageService";
import { toOnCallPersonPageMessage } from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";
import UserService from "../../Services/UserService";
import WorkspaceLiveMessageService from "../../Services/WorkspaceLiveMessageService";
import WorkspaceUserGroupService from "../../Services/WorkspaceUserGroupService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ProjectMembership from "../TeamMember/ProjectMembership";
import OnCallPolicyRunMessage from "./LiveMessages/OnCallPolicyRunMessage";
import { WHAT_TO_DO_WHEN_NOBODY_WAS_REACHED } from "./LiveMessages/OnCallPolicyRunMessageView";
import { WorkspaceAnswer } from "./WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "./WorkspaceActionAuthorization";
import WorkspaceCommands, { WorkspaceCommandName } from "./WorkspaceCommands";
import WorkspacePageAbout, {
  WorkspacePageRecord,
  WorkspacePageSubject,
} from "./WorkspacePageAbout";
import WorkspacePageTextReader, {
  WorkspacePageGroup,
  WorkspacePagePerson,
  WorkspacePageText,
} from "./WorkspacePageText";

/*
 * PAGING SOMEBODY FROM A CHAT: `/oneuptime page` in Slack, "page" typed to
 * the Microsoft Teams bot (customer feedback #4: "How can we manually
 * trigger a page to someone -- e.g. /oneuptime page @nawaz some-message?").
 *
 *   /oneuptime page @nawaz The checkout API is throwing 500s
 *
 * pages Nawaz at once - as a workflow's Page step does (OnCallPageService,
 * the one call that pages): through his own on-call rules (call, SMS, push,
 * email), until somebody acknowledges. WHERE IT IS ASKED FOR DECIDES WHAT
 * IT IS ABOUT (WorkspacePageAbout, one rule for both chats): in an
 * incident's or an alert's own channel, that incident or alert - nothing
 * new is made, the message is optional and goes with the page as its
 * message, and the page goes on until somebody it paged answers it
 * (OnCallPersonPage) -
 *
 *   /oneuptime page @nawaz           (in #inc-42: Nawaz, about INC-42)
 *
 * - and anywhere else, something new: a new alert whose title is the
 * message, said so in the form and in the answer. The channel the command
 * was run in shows the page as one message, edited as it goes - who was
 * paged and how, who acknowledged - with the alarm when nobody does
 * (OnCallPolicyRunMessage, a page request place).
 *
 * A Slack user group or a Microsoft Teams tag OneUptime keeps equal to
 * whoever is on call (WorkspaceUserGroup, customer feedback #3) is paged
 * the same way when it is @mentioned: as the on-call schedules it follows,
 * so whoever is on call in them now is paged -
 *
 *   /oneuptime page @payments-oncall The checkout API is throwing 500s
 *
 * Anything else opens a form (a Slack modal, a Microsoft Teams card) with
 * what was typed filled in: who to page - people, a team, whoever is on call
 * in a schedule, an on-call policy - and the message. That is how a team, a
 * schedule or a policy is paged: by picking it, never by a name that only
 * happened to start the message.
 *
 * Who may page: whoever may start an on-call run and create an alert in the
 * project, as the member their chat account is connected to - the
 * permissions a page asks of a workflow's caller too (assertMayPage) - and,
 * in a record's own channel, read that record. A
 * person @mentioned is paged as the OneUptime member their chat account is
 * connected to, or whose email address the chat has for them; somebody
 * OneUptime cannot tell is never guessed at - the form opens, and says so.
 */

// The kinds of thing a page names, as a form's choice spells them.
export enum WorkspacePageTargetKind {
  Schedule = "schedule",
  Person = "user",
  Team = "team",
  Policy = "policy",
}

// One thing a form offers to page.
export interface WorkspacePageChoice {
  // What the form submits: "schedule:<id>", "user:<id>".
  value: string;
  // Its name, as typed: "Primary". What a message's start is matched with.
  name: string;
  // As the list shows it: "Primary · Nawaz Dhandala is on call".
  label: string;
}

// One kind of thing a form offers, in the order the form lists them.
export interface WorkspacePageChoiceGroup {
  kind: WorkspacePageTargetKind;
  // "On-call schedules", "People", "Teams", "On-call policies".
  label: string;
  choices: Array<WorkspacePageChoice>;
  /*
   * How many more of this kind there are than the list holds - the
   * project's people past the first WORKSPACE_PAGE_MAX_CHOICES_PER_KIND.
   * A form says so, and how to page them anyway: by an @mention.
   */
  notShownCount?: number | undefined;
}

/*
 * Where a page was asked for: the channel or chat its run is shown in, as
 * one message edited as it goes (OnCallPolicyRunMessage).
 */
export interface WorkspacePagePlace {
  workspaceType: WorkspaceType;
  destinationType: WorkspaceLiveMessageDestinationType;
  channelId: string;
  channelName?: string | undefined;
  // A Microsoft Teams channel's team.
  teamId?: string | undefined;
}

/*
 * A person a chat @mentioned, with what the chat could tell of them: the
 * OneUptime user their chat account is connected to, the email address the
 * chat has for them, their name there.
 */
export interface WorkspacePageCandidate {
  person: WorkspacePagePerson;
  connectedUserId?: ObjectID | undefined;
  email?: string | undefined;
  chatName?: string | undefined;
}

// A person OneUptime can page.
export interface WorkspacePageResolvedPerson {
  userId: ObjectID;
  name: string;
}

// The people a chat @mentioned, as OneUptime can tell them.
export interface WorkspacePagePeople {
  people: Array<WorkspacePageResolvedPerson>;
  /*
   * Who could not be told, each as a sentence the form says: "OneUptime
   * can't tell who @nawaz is: their Slack account isn't connected to
   * OneUptime."
   */
  notTold: Array<string>;
}

/*
 * A group a chat @mentioned that follows on-call schedules: a Slack user
 * group or a Microsoft Teams tag OneUptime keeps equal to whoever is on call
 * in them (WorkspaceUserGroup).
 */
export interface WorkspacePagePagedGroup {
  // As the chat wrote it, without the "@": "payments-oncall".
  name: string;
  // The on-call schedules it follows that the member may read.
  scheduleIds: Array<ObjectID>;
}

// The groups a chat @mentioned, as OneUptime can page them.
export interface WorkspacePageGroups {
  // Paged as the on-call schedules they follow.
  paged: Array<WorkspacePagePagedGroup>;
  /*
   * Not paged, and said in the form instead: @here, and a group that
   * follows no on-call schedule the member may read.
   */
  notPaged: Array<WorkspacePageGroup>;
}

// What a form opens with: what was typed, read.
export interface WorkspacePageFormPrefill {
  // The choices picked already: the people @mentioned, a name typed first.
  values: Array<string>;
  message: string;
  // Said above the form: who was named that it cannot pick.
  notes: Array<string>;
}

// What a page came to, for the person who paged.
export interface WorkspacePageOutcome {
  result: OnCallPageResult;
  // Whether the place it was asked from shows the page's run now.
  isShownAtPlace: boolean;
  /*
   * What to tell the person who paged, only them: null when the place
   * shows it all.
   */
  answer: WorkspaceAnswer | null;
}

/*
 * How long a page from a chat waits for its new alert's Slack and Microsoft
 * Teams channels (OnCallPageService.waitUntilRecordIsSetUp), so the run's
 * message is posted in them too. Usually a second or two; a person waits
 * for the confirmation, so not the twenty seconds a workflow may.
 */
export const WORKSPACE_PAGE_MAX_WAIT_FOR_RECORD_IN_MS: number = 5000;

// How many of each kind a form offers: Slack shows 100 options a group.
export const WORKSPACE_PAGE_MAX_CHOICES_PER_KIND: number = 100;

// The longest a choice's label is: Slack shows 75 characters of an option.
export const WORKSPACE_PAGE_MAX_CHOICE_LABEL_LENGTH: number = 75;

// An alert's title holds this much.
export const WORKSPACE_PAGE_MAX_TITLE_LENGTH: number = 500;

// What a refusal to page says it is about: "You do not have permission to ...".
export const WORKSPACE_PAGE_ACTION: string = "page people";

/*
 * What the Page someone form says, in Slack's modal and Microsoft Teams'
 * card alike: the same form in both chats, in the same words.
 */
export const WORKSPACE_PAGE_FORM_TEXT: {
  title: string;
  whoLabel: string;
  whoPlaceholder: string;
  whoHint: string;
  messageLabel: string;
  messagePlaceholder: string;
  // A page about something new: the message is its alert's title.
  messageHint: string;
  submit: string;
  pickWho: string;
  pickFewer: string;
  writeMessage: string;
} = {
  // Slack shows 24 characters of a modal's title.
  title: "Page someone",
  whoLabel: "Who to page",
  whoPlaceholder: "Pick people, a team or a schedule",
  // What a schedule and a policy page: a policy does not page all at once.
  whoHint:
    "A schedule pages whoever is on call in it now. A policy pages through its escalation rules.",
  messageLabel: "Message",
  messagePlaceholder: "What should they look at?",
  // Who reads the message, and where it goes: a new alert, named by it.
  messageHint: "The people you page get this as the title of a new alert.",
  submit: "Page",
  // A field left wrong, said under it - the hint above says why it matters.
  pickWho: "Pick who to page.",
  pickFewer: `Pick ${MAX_ON_CALL_DIRECT_PAGE_TARGETS} at most.`,
  writeMessage: "Write what the page is about.",
};

const WHITE_SPACE_RUN: RegExp = /\s+/g;

export default class WorkspacePage {
  /*
   * May the member page: start an on-call run, and create the alert a page
   * about something new is. Throws NotAuthorizedException, worded for the
   * chat, when they may not - before a form is shown, so nobody fills one in
   * for nothing. A page of people, teams or schedules asks one more thing
   * when it is made (OnCallPageService): access to every on-call policy.
   */
  @CaptureSpan()
  public static async assertMayPage(
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    await WorkspaceActionAuthorization.assertCanCreate({
      props: props,
      modelType: OnCallDutyPolicyExecutionLog,
      action: WORKSPACE_PAGE_ACTION,
    });

    await WorkspaceActionAuthorization.assertCanCreate({
      props: props,
      modelType: Alert,
      action: WORKSPACE_PAGE_ACTION,
    });
  }

  /*
   * The people a chat @mentioned, as OneUptime members: the user their chat
   * account is connected to, or else the member with the email address the
   * chat has for them. Only members of the project are paged; whoever is
   * not one, or cannot be told, is said by name instead - never guessed.
   */
  @CaptureSpan()
  public static async resolvePeople(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    candidates: Array<WorkspacePageCandidate>;
  }): Promise<WorkspacePagePeople> {
    const emails: Array<string> = Array.from(
      new Set<string>(
        data.candidates
          .filter((candidate: WorkspacePageCandidate): boolean => {
            return !candidate.connectedUserId && Boolean(candidate.email);
          })
          .map((candidate: WorkspacePageCandidate): string => {
            return candidate.email!.trim().toLowerCase();
          }),
      ),
    );

    const usersByEmail: Array<User> =
      emails.length > 0
        ? await UserService.findBy({
            query: {
              email: QueryHelper.any(emails),
            },
            select: {
              _id: true,
              email: true,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: {
              isRoot: true,
            },
          })
        : [];

    // Each candidate's OneUptime user, when the chat could tell it.
    const userIdOf: (candidate: WorkspacePageCandidate) => ObjectID | null = (
      candidate: WorkspacePageCandidate,
    ): ObjectID | null => {
      if (candidate.connectedUserId) {
        return candidate.connectedUserId;
      }

      const email: string = (candidate.email || "").trim().toLowerCase();

      if (!email) {
        return null;
      }

      return (
        usersByEmail.find((user: User): boolean => {
          return user.email?.toString().toLowerCase() === email;
        })?.id || null
      );
    };

    const userIds: Array<ObjectID> = data.candidates
      .map(userIdOf)
      .filter((userId: ObjectID | null): userId is ObjectID => {
        return Boolean(userId);
      });

    const memberUserIds: Set<string> =
      userIds.length > 0
        ? await ProjectMembership.getMemberUserIds({
            projectId: data.projectId,
            userIds: userIds,
          })
        : new Set<string>();

    const names: Map<string, string> = await WorkspacePage.getUserNames(
      userIds.filter((userId: ObjectID): boolean => {
        return memberUserIds.has(userId.toString().toLowerCase());
      }),
    );

    const people: Array<WorkspacePageResolvedPerson> = [];
    const notTold: Array<string> = [];
    const workspaceName: string = WorkspacePage.getWorkspaceName(
      data.workspaceType,
    );
    const productName: string = ProductBrandingText.getProductName();

    for (const candidate of data.candidates) {
      const mentioned: string = WorkspacePage.getMentionedName(candidate);
      const userId: ObjectID | null = userIdOf(candidate);

      // Each note says what to do about it, under the form it opens.
      if (!userId) {
        notTold.push(
          `${productName} can't tell who ${mentioned} is: their ${workspaceName} account isn't connected to ${productName}. Pick them below.`,
        );
        continue;
      }

      const key: string = userId.toString().toLowerCase();

      if (!memberUserIds.has(key)) {
        notTold.push(
          `${mentioned} isn't a member of this project, so ${productName} can't page them.`,
        );
        continue;
      }

      const isNamed: boolean = people.some(
        (person: WorkspacePageResolvedPerson): boolean => {
          return person.userId.toString().toLowerCase() === key;
        },
      );

      if (!isNamed) {
        people.push({
          userId: userId,
          name:
            names.get(key) ||
            candidate.chatName?.trim() ||
            candidate.person.name.trim() ||
            "Someone",
        });
      }
    }

    return { people: people, notTold: notTold };
  }

  /*
   * The groups a chat @mentioned, as OneUptime pages them. A Slack user
   * group or a Microsoft Teams tag that follows on-call schedules in the
   * project (WorkspaceUserGroup, connected on a schedule's page) is paged
   * as those schedules: whoever is on call in them when the page goes out -
   * who the group holds, and anybody on call it could not hold (not in the
   * chat, a guest) too. Read as the member: a group or a schedule they may
   * not read pages nobody, as the form does not offer it either. @here, and
   * any other group, is not paged: the form says so.
   *
   * A Slack user group is matched by its id. Microsoft Teams mentions a tag
   * with an id of its own: a tag is matched by it, or else by its name when
   * exactly one tag of that name follows schedules in the project.
   */
  @CaptureSpan()
  public static async resolveGroups(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    groups: Array<WorkspacePageGroup>;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspacePageGroups> {
    const hasAnyGroup: boolean = data.groups.some(
      (group: WorkspacePageGroup): boolean => {
        return Boolean(group.workspaceGroupId);
      },
    );

    if (!hasAnyGroup) {
      return { paged: [], notPaged: [...data.groups] };
    }

    const rows: Array<WorkspaceUserGroup> =
      await WorkspaceActionAuthorization.findReadable({
        service: WorkspaceUserGroupService,
        props: data.props,
        query: {
          projectId: data.projectId,
          workspaceType: data.workspaceType,
        },
        select: {
          _id: true,
          workspaceGroupId: true,
          name: true,
          onCallDutyPolicySchedules: {
            _id: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
      });

    const rowOf: (group: WorkspacePageGroup) => WorkspaceUserGroup | null = (
      group: WorkspacePageGroup,
    ): WorkspaceUserGroup | null => {
      if (!group.workspaceGroupId) {
        return null;
      }

      const byId: WorkspaceUserGroup | undefined = rows.find(
        (row: WorkspaceUserGroup): boolean => {
          return row.workspaceGroupId === group.workspaceGroupId;
        },
      );

      if (byId || data.workspaceType !== WorkspaceType.MicrosoftTeams) {
        return byId || null;
      }

      const name: string = group.name.trim().toLowerCase();
      const byName: Array<WorkspaceUserGroup> = rows.filter(
        (row: WorkspaceUserGroup): boolean => {
          return (
            Boolean(name) && (row.name || "").trim().toLowerCase() === name
          );
        },
      );

      return byName.length === 1 ? byName[0]! : null;
    };

    const matches: Array<{
      group: WorkspacePageGroup;
      row: WorkspaceUserGroup | null;
    }> = data.groups.map((group: WorkspacePageGroup) => {
      return { group: group, row: rowOf(group) };
    });

    const scheduleIds: Array<ObjectID> = [];

    for (const match of matches) {
      for (const schedule of match.row?.onCallDutyPolicySchedules || []) {
        if (
          schedule.id &&
          !scheduleIds.some((id: ObjectID): boolean => {
            return id.toString() === schedule.id!.toString();
          })
        ) {
          scheduleIds.push(schedule.id);
        }
      }
    }

    const readable: Array<OnCallDutyPolicySchedule> =
      scheduleIds.length > 0
        ? await WorkspaceActionAuthorization.findReadable({
            service: OnCallDutyPolicyScheduleService,
            props: data.props,
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(scheduleIds),
            },
            select: {
              _id: true,
            },
            limit: LIMIT_PER_PROJECT,
          })
        : [];

    const readableIds: Set<string> = new Set<string>(
      readable
        .filter((schedule: OnCallDutyPolicySchedule): boolean => {
          return Boolean(schedule.id);
        })
        .map((schedule: OnCallDutyPolicySchedule): string => {
          return schedule.id!.toString().toLowerCase();
        }),
    );

    const paged: Array<WorkspacePagePagedGroup> = [];
    const notPaged: Array<WorkspacePageGroup> = [];
    const pagedRowIds: Set<string> = new Set<string>();

    for (const match of matches) {
      const ids: Array<ObjectID> = scheduleIds.filter(
        (scheduleId: ObjectID): boolean => {
          return (
            readableIds.has(scheduleId.toString().toLowerCase()) &&
            (match.row?.onCallDutyPolicySchedules || []).some(
              (schedule: OnCallDutyPolicySchedule): boolean => {
                return schedule.id?.toString() === scheduleId.toString();
              },
            )
          );
        },
      );

      if (!match.row?.id || ids.length === 0) {
        notPaged.push(match.group);
        continue;
      }

      // The same group, mentioned twice: paged once.
      if (pagedRowIds.has(match.row.id.toString())) {
        continue;
      }

      pagedRowIds.add(match.row.id.toString());
      paged.push({
        name: match.group.name || match.row.name || "",
        scheduleIds: ids,
      });
    }

    return { paged: paged, notPaged: notPaged };
  }

  /*
   * Whether what was typed pages at once: somebody to page - people
   * OneUptime can tell, groups that follow on-call schedules - nobody named
   * that it cannot page, and a message. Otherwise the form opens.
   */
  public static isReadyToPage(data: {
    text: WorkspacePageText;
    people: WorkspacePagePeople;
    groups: WorkspacePageGroups;
    // What the page is about: something new when left out.
    about?: WorkspacePageSubject | undefined;
  }): boolean {
    return (
      data.people.people.length + data.groups.paged.length > 0 &&
      data.people.notTold.length === 0 &&
      data.groups.notPaged.length === 0 &&
      data.text.unknownNames.length === 0 &&
      (data.text.message.length > 0 ||
        !WorkspacePage.isMessageRequired(data.about))
    );
  }

  /*
   * Whether a page needs a message: one about something new does - it is
   * the title of its alert, what the people paged are told. One about an
   * incident or an alert does not: the record says what it is about, and a
   * message is what the person paging adds to it.
   */
  public static isMessageRequired(
    about: WorkspacePageSubject | undefined,
  ): boolean {
    return !about?.record;
  }

  /*
   * What the form says under its message: where it goes, and whether it is
   * needed - "Optional. The people you page see it with Incident INC-18.";
   * "The people you page get this as the title of a new alert."; and, in
   * the channel of an incident that is resolved, why the page is about
   * something new: "Incident INC-18 is resolved, so the people you page get
   * this as the title of a new alert."
   */
  public static getMessageHint(about: WorkspacePageSubject | undefined): string {
    if (about?.record) {
      return `Optional. The people you page see it with ${about.record.name.label}.`;
    }

    if (about?.resolvedRecord) {
      return `${about.resolvedRecord.label} is resolved, so the people you page get this as the title of a new alert.`;
    }

    return WORKSPACE_PAGE_FORM_TEXT.messageHint;
  }

  /*
   * What a form about an incident or an alert is told when the record was
   * resolved after it opened: there is nothing left to page about, and its
   * message - optional there - is no new alert's title.
   */
  public static getResolvedSinceMessage(
    about: WorkspacePageSubject | undefined,
  ): string {
    const label: string = about?.resolvedRecord?.label || "It";

    return `${label} was resolved after the form opened, so nobody was paged.`;
  }

  /*
   * Who a page from what was typed pages: the people @mentioned, and the
   * on-call schedules the groups @mentioned follow - each once.
   */
  public static getTargets(data: {
    people: WorkspacePagePeople;
    groups: WorkspacePageGroups;
  }): OnCallPageTargets {
    const targets: OnCallPageTargets = {
      userIds: data.people.people.map(
        (person: WorkspacePageResolvedPerson): ObjectID => {
          return person.userId;
        },
      ),
    };

    const scheduleIds: Array<ObjectID> = [];

    for (const group of data.groups.paged) {
      for (const scheduleId of group.scheduleIds) {
        if (
          !scheduleIds.some((id: ObjectID): boolean => {
            return id.toString() === scheduleId.toString();
          })
        ) {
          scheduleIds.push(scheduleId);
        }
      }
    }

    if (scheduleIds.length > 0) {
      targets.onCallScheduleIds = scheduleIds;
    }

    return targets;
  }

  /*
   * Who a page from what was typed pages, as the person who paged put it:
   * the people by name, a group as it was @mentioned ("@payments-oncall").
   */
  public static getPagedNames(data: {
    people: WorkspacePagePeople;
    groups: WorkspacePageGroups;
  }): Array<string> {
    return [
      ...data.people.people.map(
        (person: WorkspacePageResolvedPerson): string => {
          return person.name;
        },
      ),
      ...data.groups.paged.map((group: WorkspacePagePagedGroup): string => {
        return `@${group.name}`;
      }),
    ];
  }

  /*
   * What a form offers to page, read as the member reads it - the on-call
   * schedules (with who is on call in each now), the project's people, its
   * teams and its live on-call policies - each in name order, up to
   * WORKSPACE_PAGE_MAX_CHOICES_PER_KIND. A kind the member may not read is
   * left out. The member is marked "(you)" among the people.
   */
  @CaptureSpan()
  public static async getChoices(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<WorkspacePageChoiceGroup>> {
    const { projectId, props } = data;

    const [schedules, members, teams, policies]: [
      Array<OnCallDutyPolicySchedule>,
      Array<TeamMember>,
      Array<Team>,
      Array<OnCallDutyPolicy>,
    ] = await Promise.all([
      WorkspaceActionAuthorization.findReadable({
        service: OnCallDutyPolicyScheduleService,
        props: props,
        query: {
          projectId: projectId,
        },
        select: {
          _id: true,
          name: true,
          currentUserOnRoster: {
            _id: true,
            name: true,
            email: true,
          },
        },
        sort: {
          name: SortOrder.Ascending,
        },
        limit: WORKSPACE_PAGE_MAX_CHOICES_PER_KIND,
      }),
      WorkspaceActionAuthorization.findReadable({
        service: TeamMemberService,
        props: props,
        query: {
          projectId: projectId,
          hasAcceptedInvitation: true,
        },
        select: {
          _id: true,
          userId: true,
          user: {
            _id: true,
            name: true,
            email: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
      }),
      WorkspaceActionAuthorization.findReadable({
        service: TeamService,
        props: props,
        query: {
          projectId: projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
        limit: WORKSPACE_PAGE_MAX_CHOICES_PER_KIND,
      }),
      WorkspaceActionAuthorization.findReadable({
        service: OnCallDutyPolicyService,
        props: props,
        query: {
          projectId: projectId,
          // Archived policies page no one, so they are not offered.
          isArchived: false,
        },
        select: {
          _id: true,
          name: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
        limit: WORKSPACE_PAGE_MAX_CHOICES_PER_KIND,
      }),
    ]);

    const groups: Array<WorkspacePageChoiceGroup> = [];

    const scheduleChoices: Array<WorkspacePageChoice> = schedules
      .filter((schedule: OnCallDutyPolicySchedule): boolean => {
        return Boolean(schedule.id);
      })
      .map((schedule: OnCallDutyPolicySchedule): WorkspacePageChoice => {
        const name: string =
          schedule.name?.toString().trim() || "Unnamed schedule";
        const onCall: string = WorkspacePage.getUserName(
          schedule.currentUserOnRoster,
        );

        return {
          value: WorkspacePage.toValue(
            WorkspacePageTargetKind.Schedule,
            schedule.id!,
          ),
          name: name,
          label: WorkspacePage.toScheduleLabel(name, onCall),
        };
      });

    if (scheduleChoices.length > 0) {
      groups.push({
        kind: WorkspacePageTargetKind.Schedule,
        label: "On-call schedules",
        choices: scheduleChoices,
      });
    }

    // Each member once, in name order; the person paging marked.
    const seen: Set<string> = new Set<string>();
    const people: Array<WorkspacePageChoice> = [];

    for (const member of members) {
      const userId: ObjectID | undefined =
        member.userId || member.user?.id || undefined;

      if (!userId || seen.has(userId.toString().toLowerCase())) {
        continue;
      }

      seen.add(userId.toString().toLowerCase());

      const name: string = WorkspacePage.getUserName(member.user) || "Someone";
      const isYou: boolean =
        userId.toString().toLowerCase() ===
        (props.userId?.toString().toLowerCase() || "");

      people.push({
        value: WorkspacePage.toValue(WorkspacePageTargetKind.Person, userId),
        name: name,
        label: WorkspacePage.toLabel(isYou ? `${name} (you)` : name),
      });
    }

    people.sort((a: WorkspacePageChoice, b: WorkspacePageChoice): number => {
      return a.name.localeCompare(b.name);
    });

    if (people.length > 0) {
      const notShownCount: number = Math.max(
        0,
        people.length - WORKSPACE_PAGE_MAX_CHOICES_PER_KIND,
      );

      groups.push({
        kind: WorkspacePageTargetKind.Person,
        label: "People",
        choices: people.slice(0, WORKSPACE_PAGE_MAX_CHOICES_PER_KIND),
        ...(notShownCount > 0 ? { notShownCount: notShownCount } : {}),
      });
    }

    const teamChoices: Array<WorkspacePageChoice> = teams
      .filter((team: Team): boolean => {
        return Boolean(team.id);
      })
      .map((team: Team): WorkspacePageChoice => {
        const name: string = team.name?.toString().trim() || "Unnamed team";

        return {
          value: WorkspacePage.toValue(WorkspacePageTargetKind.Team, team.id!),
          name: name,
          label: WorkspacePage.toLabel(name),
        };
      });

    if (teamChoices.length > 0) {
      groups.push({
        kind: WorkspacePageTargetKind.Team,
        label: "Teams",
        choices: teamChoices,
      });
    }

    const policyChoices: Array<WorkspacePageChoice> = policies
      .filter((policy: OnCallDutyPolicy): boolean => {
        return Boolean(policy.id);
      })
      .map((policy: OnCallDutyPolicy): WorkspacePageChoice => {
        const name: string = policy.name?.toString().trim() || "Unnamed policy";

        return {
          value: WorkspacePage.toValue(
            WorkspacePageTargetKind.Policy,
            policy.id!,
          ),
          name: name,
          label: WorkspacePage.toLabel(name),
        };
      });

    if (policyChoices.length > 0) {
      groups.push({
        kind: WorkspacePageTargetKind.Policy,
        label: "On-call policies",
        choices: policyChoices,
      });
    }

    return groups;
  }

  /*
   * What a form opens with, from what was typed after "page": the people
   * @mentioned that OneUptime can tell, picked; the on-call schedules a
   * group @mentioned follows (`groups`, resolveGroups), picked; a
   * schedule's, a team's or a policy's name the text starts with, picked,
   * the rest the message; and a note for each person or group it could not
   * pick, worded for the chat the form is in.
   */
  public static getPrefill(data: {
    text: WorkspacePageText;
    people: WorkspacePagePeople;
    // The groups @mentioned, resolved; none paged when left out.
    groups?: WorkspacePageGroups | undefined;
    choices: Array<WorkspacePageChoiceGroup>;
    workspaceType: WorkspaceType;
  }): WorkspacePageFormPrefill {
    const values: Array<string> = [];
    const offered: Array<WorkspacePageChoice> = data.choices.flatMap(
      (group: WorkspacePageChoiceGroup): Array<WorkspacePageChoice> => {
        return group.choices;
      },
    );

    const pick: (value: string) => boolean = (value: string): boolean => {
      const isOffered: boolean = offered.some(
        (choice: WorkspacePageChoice): boolean => {
          return choice.value === value;
        },
      );

      if (isOffered && !values.includes(value)) {
        values.push(value);
      }

      return isOffered;
    };

    const notes: Array<string> = [...data.people.notTold];

    // "run /oneuptime page" in Slack, "type page" to the Teams bot.
    const pageUsage: string = WorkspaceCommands.getUsage({
      workspaceType: data.workspaceType,
      command: WorkspaceCommandName.Page,
    });
    const runPageAgain: string =
      data.workspaceType === WorkspaceType.Slack
        ? `run ${pageUsage}`
        : `type ${pageUsage}`;

    for (const person of data.people.people) {
      /*
       * A member the form's list leaves out (past its first hundred) is
       * said by name: a form cannot pick what it does not offer. An
       * @mention and a message page them at once, list or no list.
       */
      if (
        !pick(
          WorkspacePage.toValue(WorkspacePageTargetKind.Person, person.userId),
        )
      ) {
        notes.push(
          `${person.name} isn't in the list below. To page them, ${runPageAgain} again with them @mentioned and a message.`,
        );
      }
    }

    const groups: WorkspacePageGroups = data.groups || {
      paged: [],
      notPaged: data.text.groups,
    };

    for (const group of groups.paged) {
      let isAnyPicked: boolean = false;

      for (const scheduleId of group.scheduleIds) {
        if (
          pick(
            WorkspacePage.toValue(WorkspacePageTargetKind.Schedule, scheduleId),
          )
        ) {
          isAnyPicked = true;
        }
      }

      if (!isAnyPicked) {
        notes.push(
          `The on-call schedules @${group.name} follows aren't in the list below. To page them, ${runPageAgain} again with @${group.name} and a message.`,
        );
      }
    }

    for (const group of groups.notPaged) {
      notes.push(
        WorkspacePage.getGroupNote({
          group: group,
          workspaceType: data.workspaceType,
        }),
      );
    }

    for (const name of data.text.unknownNames) {
      notes.push(
        `${ProductBrandingText.getProductName()} can't tell who ${name} is. Pick them below.`,
      );
    }

    let message: string = data.text.message;

    // Nobody @mentioned: a name the text starts with is who to page.
    if (
      data.text.people.length === 0 &&
      data.text.groups.length === 0 &&
      data.text.unknownNames.length === 0
    ) {
      const named: Array<WorkspacePageChoice> = offered.filter(
        (choice: WorkspacePageChoice): boolean => {
          return !choice.value.startsWith(`${WorkspacePageTargetKind.Person}:`);
        },
      );

      const name: string | null = WorkspacePageTextReader.startsWithName(
        message,
        named.map((choice: WorkspacePageChoice): string => {
          return choice.name;
        }),
      );

      if (name) {
        for (const choice of named) {
          if (choice.name.trim().toLowerCase() === name.trim().toLowerCase()) {
            pick(choice.value);
          }
        }

        message = WorkspacePageTextReader.afterName(message, name);
      }
    }

    return {
      values: values,
      message: message,
      notes: notes,
    };
  }

  /*
   * A form's picks as the targets of a page: "user:<id>" a person,
   * "team:<id>" a team, and so on. Anything else - a value no form of
   * OneUptime's writes - is left out.
   */
  public static readTargets(values: Array<string>): OnCallPageTargets {
    const targets: {
      userIds: Array<ObjectID>;
      teamIds: Array<ObjectID>;
      onCallScheduleIds: Array<ObjectID>;
      onCallDutyPolicyIds: Array<ObjectID>;
    } = {
      userIds: [],
      teamIds: [],
      onCallScheduleIds: [],
      onCallDutyPolicyIds: [],
    };

    for (const value of values) {
      const separator: number = value.indexOf(":");

      if (separator === -1) {
        continue;
      }

      const kind: string = value.substring(0, separator);
      const id: string = value.substring(separator + 1).trim();

      if (!ObjectID.isValidUUID(id)) {
        continue;
      }

      switch (kind) {
        case WorkspacePageTargetKind.Person:
          targets.userIds.push(new ObjectID(id));
          break;
        case WorkspacePageTargetKind.Team:
          targets.teamIds.push(new ObjectID(id));
          break;
        case WorkspacePageTargetKind.Schedule:
          targets.onCallScheduleIds.push(new ObjectID(id));
          break;
        case WorkspacePageTargetKind.Policy:
          targets.onCallDutyPolicyIds.push(new ObjectID(id));
          break;
        default:
          break;
      }
    }

    return targets;
  }

  // How many people, teams, schedules and policies targets name.
  public static countTargets(targets: OnCallPageTargets): number {
    return (
      (targets.userIds?.length || 0) +
      (targets.userEmails?.length || 0) +
      (targets.teamIds?.length || 0) +
      (targets.onCallScheduleIds?.length || 0) +
      (targets.onCallDutyPolicyIds?.length || 0)
    );
  }

  /*
   * What a form's submission is told when it cannot page, worded for the
   * field it is about; null when it can.
   */
  public static getFormProblems(data: {
    values: Array<string>;
    message: string;
    /*
     * Whether the page needs a message (isMessageRequired): one about
     * something new does. Needed when left out.
     */
    isMessageRequired?: boolean | undefined;
  }): { who?: string | undefined; message?: string | undefined } | null {
    const problems: { who?: string; message?: string } = {};
    const count: number = WorkspacePage.countTargets(
      WorkspacePage.readTargets(data.values),
    );

    if (count === 0) {
      problems.who = WORKSPACE_PAGE_FORM_TEXT.pickWho;
    } else if (count > MAX_ON_CALL_DIRECT_PAGE_TARGETS) {
      problems.who = WORKSPACE_PAGE_FORM_TEXT.pickFewer;
    }

    if (data.isMessageRequired !== false && !data.message.trim()) {
      problems.message = WORKSPACE_PAGE_FORM_TEXT.writeMessage;
    }

    return problems.who || problems.message ? problems : null;
  }

  /*
   * THE PAGE. Pages `targets`, as the member (`props`), through
   * OnCallPageService, about what `about` says (WorkspacePageAbout): the
   * open incident or alert of the channel it was asked in, with the message
   * as the page's own, or something new - a new alert whose title is the
   * message. Its runs are shown where it was asked for (`place`): the place
   * is kept for the record, and the run of the people it paged is brought
   * up to date there now (OnCallPolicyRunMessage). The run of a policy it
   * started follows there as soon as it starts.
   *
   * Hands back what came of it, and what to tell the person who paged when
   * the place does not show it. Throws what OnCallPageService throws - a
   * refusal, a page that names nobody pageable - for the chat to answer.
   */
  @CaptureSpan()
  public static async page(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    workspaceType: WorkspaceType;
    targets: OnCallPageTargets;
    message: string;
    // What the page is about: something new when left out.
    about?: WorkspacePageSubject | undefined;
    place?: WorkspacePagePlace | undefined;
  }): Promise<WorkspacePageOutcome> {
    const record: WorkspacePageRecord | null = data.about?.record || null;

    const result: OnCallPageResult = await OnCallPageService.page({
      projectId: data.projectId,
      targets: data.targets,
      about: record
        ? {
            ...WorkspacePageAbout.getRecordAbout(record),
            // The page's own message: the record says what it is about.
            ...(data.message.trim()
              ? { message: toOnCallPersonPageMessage(data.message) }
              : {}),
          }
        : {
            newAlert: await WorkspacePage.getNewAlert({
              props: data.props,
              workspaceType: data.workspaceType,
              message: data.message,
            }),
          },
      props: data.props,
      maxWaitForRecordInMs: WORKSPACE_PAGE_MAX_WAIT_FOR_RECORD_IN_MS,
    });

    // What the answer quotes: the alert's title, or the page's message.
    const title: string = record
      ? toOnCallPersonPageMessage(data.message)
      : WorkspacePage.getTitle(data.message);

    let isShownAtPlace: boolean = false;

    if (data.place) {
      await WorkspacePage.keepPlace({
        projectId: data.projectId,
        result: result,
        place: data.place,
        pagedByUserId: data.props.userId,
      });

      if (result.directPageExecutionLogId) {
        try {
          // Posted there now - not when a later change to the run is.
          await OnCallPolicyRunMessage.syncRun(result.directPageExecutionLogId);

          isShownAtPlace =
            (
              await WorkspaceLiveMessageService.findByMessageKey({
                projectId: data.projectId,
                messageKey: WorkspaceLiveMessageKey.forOnCallPolicyRun(
                  result.directPageExecutionLogId,
                ),
                channelId: data.place.channelId,
              })
            ).length > 0;
        } catch (err) {
          logger.error(
            "A page from a chat went out, but its message could not be shown where it was asked for.",
            { projectId: data.projectId.toString() },
          );
          logger.error(err, { projectId: data.projectId.toString() });
        }
      }
    }

    /*
     * Shown where it was asked for, the page needs no other answer - unless
     * it started a policy, whose run is shown there once it starts: until
     * then, the person is told it did.
     */
    const answer: WorkspaceAnswer | null =
      isShownAtPlace && result.startedPolicies.length === 0
        ? null
        : WorkspacePage.getPagedAnswer({
            result: result,
            message: title,
            isShownAtPlace: isShownAtPlace,
            canBeShownAtPlace: Boolean(data.place),
          });

    return {
      result: result,
      isShownAtPlace: isShownAtPlace,
      answer: answer,
    };
  }

  /*
   * What the person who paged is told, only them, when the place they paged
   * from does not show it all:
   *
   *   📟 Paged Nawaz Dhandala about Alert #12: “The checkout API is down”
   *
   * - or, where the people's run is shown, what it does not show yet: the
   * policies the page started, whose runs follow there once they start.
   */
  public static getPagedAnswer(data: {
    result: OnCallPageResult;
    message: string;
    // Whether the place shows the run of the people paged.
    isShownAtPlace: boolean;
    // Whether the page was asked from a place it could be shown in.
    canBeShownAtPlace: boolean;
  }): WorkspaceAnswer {
    const { result } = data;
    const record: MarkdownText = mdText`**[${result.record.label}](${result.record.url.toString()})**`;
    const message: string = data.message.trim();
    const about: MarkdownText = message
      ? mdText`: “${message}”`
      : FeedMarkdown.empty();

    const lines: Array<MarkdownText> = [];
    const textParts: Array<string> = [];

    // The people's run is in the conversation already: the rest, only.
    const isPeopleShown: boolean =
      data.isShownAtPlace && result.paged.length > 0;

    if (result.paged.length > 0 && !isPeopleShown) {
      const who: { markdown: MarkdownText; text: string } =
        WorkspacePage.getPagedWho(result.paged);

      lines.push(mdText`📟 Paged ${who.markdown} about ${record}${about}`);
      textParts.push(`Paged ${who.text} about ${result.record.label}`);
    }

    if (result.startedPolicies.length > 0) {
      const names: Array<string> = result.startedPolicies.map(
        (policy: OnCallPageStartedPolicy): string => {
          return policy.name;
        },
      );
      const noun: string =
        result.startedPolicies.length === 1
          ? "on-call policy"
          : "on-call policies";

      lines.push(
        result.paged.length > 0 && !isPeopleShown
          ? mdText`Started ${noun} ${WorkspacePage.joinBoldNames(names)} too.`
          : mdText`📟 Started ${noun} ${WorkspacePage.joinBoldNames(names)} for ${record}${about}`,
      );
      textParts.push(
        `Started ${noun} ${WorkspacePage.joinNames(names)} for ${result.record.label}`,
      );
    }

    const isNobodyPaged: boolean = lines.length === 0;

    if (isNobodyPaged) {
      lines.push(mdText`⚠️ Nobody was paged about ${record}${about}`);
      textParts.push(`Nobody was paged about ${result.record.label}`);
    }

    // Who was not paged, and why: the service's own sentences.
    if (result.notPaged.length > 0) {
      lines.push(
        FeedMarkdown.bulletList(
          result.notPaged.map((sentence: string): MarkdownText => {
            return mdText`${sentence}`;
          }),
        ),
      );
    }

    /*
     * A page that reached nobody has no progress to follow anywhere: what
     * to do next, as the run's own message says it where it can be shown.
     */
    if (isNobodyPaged) {
      lines.push(WHAT_TO_DO_WHEN_NOBODY_WAS_REACHED);
    } else if (
      data.canBeShownAtPlace &&
      !data.isShownAtPlace &&
      result.directPageExecutionLogId
    ) {
      lines.push(
        mdText`${ProductBrandingText.getProductName()} can't post in this conversation, so the page's progress isn't shown here. Follow it on the ${result.record.type === OnCallPageRecordType.Incident ? "incident" : "alert"}.`,
      );
    } else if (data.canBeShownAtPlace && result.startedPolicies.length > 0) {
      lines.push(
        result.startedPolicies.length === 1
          ? mdText`The policy's progress follows here as it pages.`
          : mdText`Each policy's progress follows here as it pages.`,
      );
    }

    return {
      markdown: FeedMarkdown.join(lines, "\n\n").toString(),
      text: textParts.join(". "),
    };
  }

  /*
   * Who a page paged, as the person who paged named them - a team first,
   * then its people: "**Platform** (Nawaz and Sam) and **Alex**". People
   * paged as members of the same team are named together, after it, in the
   * order they were paged; somebody named on their own is named alone.
   */
  public static getPagedWho(paged: Array<OnCallPagedPerson>): {
    markdown: MarkdownText;
    text: string;
  } {
    const entries: Array<{ team: string | null; names: Array<string> }> = [];

    for (const person of paged) {
      const team: string | null = (person.teamName || "").trim() || null;
      const entry: { team: string | null; names: Array<string> } | undefined =
        team
          ? entries.find(
              (candidate: { team: string | null; names: Array<string> }) => {
                return candidate.team === team;
              },
            )
          : undefined;

      if (entry) {
        entry.names.push(person.name);
      } else {
        entries.push({ team: team, names: [person.name] });
      }
    }

    const markdown: Array<MarkdownText> = entries.map(
      (entry: { team: string | null; names: Array<string> }): MarkdownText => {
        return entry.team
          ? mdText`**${entry.team}** (${WorkspacePage.joinNames(entry.names)})`
          : WorkspacePage.joinBoldNames(entry.names);
      },
    );

    const text: Array<string> = entries.map(
      (entry: { team: string | null; names: Array<string> }): string => {
        return entry.team
          ? `${entry.team} (${WorkspacePage.joinNames(entry.names)})`
          : WorkspacePage.joinNames(entry.names);
      },
    );

    return {
      markdown:
        markdown.length <= 1
          ? markdown[0] || FeedMarkdown.empty()
          : mdText`${FeedMarkdown.join(markdown.slice(0, -1), ", ")} and ${markdown[markdown.length - 1]!}`,
      text: WorkspacePage.joinNames(text),
    };
  }

  /*
   * What a form says under its list when the project has more people than
   * the list holds: they can still be paged, by an @mention. Empty when
   * the list holds everybody.
   */
  public static getNotShownNote(
    choices: Array<WorkspacePageChoiceGroup>,
  ): string {
    const count: number = choices.reduce(
      (total: number, group: WorkspacePageChoiceGroup): number => {
        return total + (group.notShownCount || 0);
      },
      0,
    );

    if (count <= 0) {
      return "";
    }

    return count === 1
      ? "1 more person isn't listed. @mention anyone to page them at once."
      : `${count} more people aren't listed. @mention anyone to page them at once.`;
  }

  /*
   * A group the chat @mentioned that a page cannot name: @here, or a user
   * group (a Microsoft Teams tag) that follows no on-call schedule the
   * member may read - which is what makes one pageable: connecting it on a
   * schedule's page (WorkspaceUserGroup). Said the same way in both chats,
   * the fact first, with the verb the schedule's card uses (Connect), and
   * then what to do in the form.
   */
  public static getGroupNote(data: {
    group: WorkspacePageGroup;
    workspaceType: WorkspaceType;
  }): string {
    const productName: string = ProductBrandingText.getProductName();
    const pickBelow: string =
      "Pick the on-call schedule, the team or the people below.";

    if (!data.group.workspaceGroupId) {
      return `${productName} can't page @${data.group.name}. ${pickBelow}`;
    }

    return `${productName} can't page @${data.group.name}: it isn't connected to an on-call schedule you can see. ${pickBelow}`;
  }

  /*
   * The alert a page about something new creates: the message on one line
   * as its title, the whole message as its description when the title is
   * not all of it, and where it came from as its root cause - who paged,
   * from which chat.
   */
  private static async getNewAlert(data: {
    props: DatabaseCommonInteractionProps;
    workspaceType: WorkspaceType;
    message: string;
  }): Promise<OnCallPageNewAlert> {
    const title: string = WorkspacePage.getTitle(data.message);
    const fullMessage: string = data.message.trim();

    // Who paged, as the alert says where it came from.
    const pagerName: string = data.props.userId
      ? (await WorkspacePage.getUserNames([data.props.userId])).get(
          data.props.userId.toString().toLowerCase(),
        ) || ""
      : "";

    return {
      title: title,
      // The message as typed, when the title is not all of it.
      ...(fullMessage !== title ? { description: fullMessage } : {}),
      rootCause: (pagerName
        ? mdText`Created by **${pagerName}** from ${WorkspacePage.getWorkspaceName(data.workspaceType)} to page people.`
        : mdText`Created from ${WorkspacePage.getWorkspaceName(data.workspaceType)} to page people.`
      ).toString(),
    };
  }

  // The page's title: the message on one line, cut to what an alert holds.
  public static getTitle(message: string): string {
    const title: string = message.replace(WHITE_SPACE_RUN, " ").trim();

    if (title.length <= WORKSPACE_PAGE_MAX_TITLE_LENGTH) {
      return title;
    }

    return `${title.substring(0, WORKSPACE_PAGE_MAX_TITLE_LENGTH - 1).trimEnd()}…`;
  }

  // "Slack", "Microsoft Teams".
  public static getWorkspaceName(workspaceType: WorkspaceType): string {
    return workspaceType === WorkspaceType.Slack ? "Slack" : "Microsoft Teams";
  }

  // A choice's value: "schedule:<id>".
  public static toValue(kind: WorkspacePageTargetKind, id: ObjectID): string {
    return `${kind}:${id.toString()}`;
  }

  /*
   * Keeps where the page was asked for as a place of its alert, once a
   * channel: every run of the alert is shown there too
   * (OnCallPolicyRunMessage). A place that cannot be kept only means the
   * page is not followed there - it is never a reason not to page.
   */
  private static async keepPlace(data: {
    projectId: ObjectID;
    result: OnCallPageResult;
    place: WorkspacePagePlace;
    pagedByUserId?: ObjectID | undefined;
  }): Promise<void> {
    const messageKey: string = WorkspaceLiveMessageKey.forOnCallPageRequest(
      data.result.record.type === OnCallPageRecordType.Incident
        ? WorkspaceLiveMessagePageRecordType.Incident
        : WorkspaceLiveMessagePageRecordType.Alert,
      data.result.record.id,
    );

    try {
      const kept: Array<WorkspaceLiveMessage> =
        await WorkspaceLiveMessageService.findByMessageKey({
          projectId: data.projectId,
          messageKey: messageKey,
          channelId: data.place.channelId,
        });

      if (kept.length > 0) {
        return;
      }

      const place: WorkspaceLiveMessage = new WorkspaceLiveMessage();
      place.projectId = data.projectId;
      place.workspaceType = data.place.workspaceType;
      place.messageKey = messageKey;
      place.destinationType = data.place.destinationType;
      place.channelId = data.place.channelId.substring(0, 100);

      if (data.place.channelName) {
        place.channelName = data.place.channelName.substring(0, 100);
      }

      if (data.place.teamId) {
        place.teamId = data.place.teamId.substring(0, 100);
      }

      // A place, not a message: it has no id of its own.
      place.messageId = "";

      if (data.pagedByUserId) {
        place.messageData = {
          pagedByUserId: data.pagedByUserId.toString(),
        };
      }

      await WorkspaceLiveMessageService.create({
        data: place,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(
        "Could not keep where a page from a chat was asked for; its progress is not shown there.",
        { projectId: data.projectId.toString() },
      );
      logger.error(err, { projectId: data.projectId.toString() });
    }
  }

  // The OneUptime names of `userIds`, by lower-cased id.
  private static async getUserNames(
    userIds: Array<ObjectID>,
  ): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();

    if (userIds.length === 0) {
      return names;
    }

    const users: Array<User> = await UserService.findBy({
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
    });

    for (const user of users) {
      if (user.id) {
        names.set(
          user.id.toString().toLowerCase(),
          WorkspacePage.getUserName(user),
        );
      }
    }

    return names;
  }

  // A user's name, or their email address; empty for neither.
  private static getUserName(
    user: { name?: unknown; email?: unknown } | undefined | null,
  ): string {
    const name: string = user?.name ? String(user.name).trim() : "";

    if (name) {
      return name;
    }

    return user?.email ? String(user.email).trim() : "";
  }

  // "@nawaz", as the person was mentioned.
  private static getMentionedName(candidate: WorkspacePageCandidate): string {
    const name: string =
      candidate.person.name.trim() || candidate.chatName?.trim() || "";

    return name ? `@${name}` : "a person you mentioned";
  }

  /*
   * "Primary (Nawaz Dhandala on call now)", "Primary (nobody on call now)":
   * a schedule pages whoever is on call in it when the page goes out. A long
   * name is cut before who is on call is.
   */
  private static toScheduleLabel(name: string, onCall: string): string {
    const who: string = onCall
      ? ` (${onCall} on call now)`
      : " (nobody on call now)";
    const room: number = WORKSPACE_PAGE_MAX_CHOICE_LABEL_LENGTH - who.length;
    const shortName: string = name.replace(WHITE_SPACE_RUN, " ").trim();

    if (room < 8) {
      return WorkspacePage.toLabel(`${shortName}${who}`);
    }

    return WorkspacePage.toLabel(
      shortName.length <= room
        ? `${shortName}${who}`
        : `${shortName.substring(0, room - 1).trimEnd()}…${who}`,
    );
  }

  // A label a list shows, cut to what Slack shows of an option.
  private static toLabel(label: string): string {
    const text: string = label.replace(WHITE_SPACE_RUN, " ").trim();

    if (text.length <= WORKSPACE_PAGE_MAX_CHOICE_LABEL_LENGTH) {
      return text;
    }

    return `${text.substring(0, WORKSPACE_PAGE_MAX_CHOICE_LABEL_LENGTH - 1).trimEnd()}…`;
  }

  // "A", "A and B", "A, B and C". Text.
  private static joinNames(names: Array<string>): string {
    if (names.length <= 1) {
      return names[0] || "";
    }

    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  }

  // "**A**", "**A** and **B**", "**A**, **B** and **C**". Each name is text.
  private static joinBoldNames(names: Array<string>): MarkdownText {
    const bold: Array<MarkdownText> = names.map(
      (name: string): MarkdownText => {
        return mdText`**${name}**`;
      },
    );

    if (bold.length <= 1) {
      return bold[0] || FeedMarkdown.empty();
    }

    return mdText`${FeedMarkdown.join(bold.slice(0, -1), ", ")} and ${bold[bold.length - 1]!}`;
  }
}
