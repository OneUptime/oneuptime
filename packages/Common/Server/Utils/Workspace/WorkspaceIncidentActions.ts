import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadContext,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import WorkspaceIncidentNumberWordReader, {
  WorkspaceIncidentNumberWord,
} from "./WorkspaceIncidentNumberWord";
import type { WorkspaceCustomFieldsForm } from "./WorkspaceIncidentCustomFields";
import IncidentMemberService from "../../Services/IncidentMemberService";
import IncidentRoleService from "../../Services/IncidentRoleService";
import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import IncidentStateService from "../../Services/IncidentStateService";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import OnCallPageService, {
  OnCallPageResult,
  OnCallPageTargets,
} from "../../Services/OnCallPageService";
import TeamMemberService from "../../Services/TeamMemberService";
import QueryHelper from "../../Types/Database/QueryHelper";
import ModelPermission from "../../Types/Database/Permissions/Index";
import TablePermission from "../../Types/Database/Permissions/TablePermission";
import { PermissionHelper } from "../../../Types/Permission";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
  WorkspaceRecordName,
} from "./WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "./WorkspaceActionAuthorization";
import WorkspaceCommands, { WorkspaceCommandName } from "./WorkspaceCommands";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "./WorkspaceMemberActions";
import WorkspaceMessageTime from "./WorkspaceMessageTime";
import WorkspacePage, {
  WORKSPACE_PAGE_FORM_TEXT,
  WORKSPACE_PAGE_MAX_WAIT_FOR_RECORD_IN_MS,
} from "./WorkspacePage";
import { MAX_ON_CALL_DIRECT_PAGE_TARGETS } from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import { toOnCallPersonPageMessage } from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";

/*
 * ACTING ON AN INCIDENT FROM SLACK OR MICROSOFT TEAMS.
 *
 * Customer feedback: "incident actions (set a custom fields, escalate to
 * someone else, etc.) cannot be triggered directly from Slack (requiring
 * users to use the web UI), and the /incident command only creates
 * incidents."
 *
 * An incident's message in a channel carries what responders press most,
 * and a menu (⋯) of the rest - the same in Slack and in Microsoft Teams,
 * whose card is drawn from the same blocks:
 *
 *   👀 Acknowledge Incident   ✅ Resolve Incident   📄 Add Note
 *   🔗 View Incident   ⋯ ⚠️ Change Severity
 *                       ➡️ Change Incident State
 *                       👤 Assign Role
 *                       📟 Page Someone
 *                       📝 Edit Custom Fields
 *
 * Page Someone is "escalate to someone else": people, a team, whoever is on
 * call in a schedule, or an on-call policy, paged about this incident
 * (OnCallPageService) - so it holds what Execute On-Call Policy did, and
 * more. A message posted before the menu keeps its buttons, and they keep
 * working.
 *
 * The incident is also a command away, wherever its message is:
 *
 *   /oneuptime incident 42        (Teams: incident 42) - #42 and INC-42 too
 *   /oneuptime incident           typed in the incident's own channel
 *
 * answer with the incident - its number, title, severity, state and who
 * holds its roles - and the same buttons and menu (getCard): in Slack only
 * to the person who asked.
 *
 * Every action acts as the member the chat account is connected to, with
 * their own permissions, as the dashboard's same change does: changing the
 * severity or the custom fields is the incident's update, assigning a role
 * an incident member, paging the page OneUptime's other pages are. So the
 * feed and the incident's channels tell of each change as they do of one
 * made in OneUptime, credited to them.
 */

/*
 * The incident message's buttons and menu, as both chats draw them. A
 * button pressed again after connecting an account is named by its text
 * without the emoji (WorkspaceConnectRequest).
 */
export const WORKSPACE_INCIDENT_BUTTONS: {
  acknowledge: string;
  resolve: string;
  addNote: string;
  view: string;
  changeSeverity: string;
  changeState: string;
  assignRole: string;
  pageSomeone: string;
  editCustomFields: string;
} = {
  acknowledge: "👀 Acknowledge Incident",
  resolve: "✅ Resolve Incident",
  addNote: "📄 Add Note",
  view: "🔗 View Incident",
  changeSeverity: "⚠️ Change Severity",
  changeState: "➡️ Change Incident State",
  assignRole: "👤 Assign Role",
  pageSomeone: "📟 Page Someone",
  editCustomFields: "📝 Edit Custom Fields",
};

/*
 * What each form of the menu says, in Slack's modal and Microsoft Teams'
 * card alike. A Slack modal's title holds 24 characters.
 */
export const WORKSPACE_INCIDENT_FORM_TEXT: {
  severityTitle: string;
  severityLabel: string;
  severityPlaceholder: string;
  roleTitle: string;
  roleLabel: string;
  rolePlaceholder: string;
  personLabel: string;
  personPlaceholder: string;
  pageTitle: string;
  pageHint: string;
  pageMessageHint: string;
  customFieldsTitle: string;
  customFieldsHint: string;
  save: string;
  assign: string;
  page: string;
  cancel: string;
} = {
  severityTitle: "Change Severity",
  severityLabel: "Incident Severity",
  severityPlaceholder: "Select Incident Severity",
  roleTitle: "Assign Role",
  roleLabel: "Role",
  rolePlaceholder: "Select a role",
  personLabel: "Person",
  personPlaceholder: "Select a person",
  pageTitle: "Page Someone",
  /*
   * A page a person asks for goes on until one of the people it paged
   * answers it (OnCallPersonPage): somebody else acknowledging the incident
   * does not stop it.
   */
  pageHint:
    "They are paged about this incident until one of them answers. A schedule pages whoever is on call in it now; a policy pages through its escalation rules.",
  /*
   * The page's own message: the incident says what the page is about.
   * Optional, as the field itself says (Slack's "(optional)", no "*" in
   * Microsoft Teams).
   */
  pageMessageHint: "The people you page see it with the incident.",
  customFieldsTitle: "Edit Custom Fields",
  customFieldsHint: "Leave a field empty to clear it.",
  save: "Save",
  assign: "Assign",
  page: "Page",
  cancel: "Cancel",
};

export type { WorkspaceIncidentNumberWord };

// The incident, with its buttons and menu, as a command answers it.
export interface WorkspaceIncidentCard {
  messageBlocks: Array<WorkspaceMessageBlock>;
  // What a notification of it shows: "INC-42 Checkout is down".
  text: string;
}

// A severity the form offers.
export interface WorkspaceIncidentChoice {
  id: ObjectID;
  name: string;
}

// A role the form offers.
export interface WorkspaceIncidentRoleChoice {
  id: ObjectID;
  name: string;
  // A role that takes one person (Incident Commander) moves to the new one.
  canAssignMultipleUsers: boolean;
}

// Somebody who holds a role on the incident.
export interface WorkspaceIncidentRoleHolder {
  memberId: ObjectID;
  roleId: ObjectID;
  roleName: string;
  userId: ObjectID;
  name: string;
}

// A person the role form offers.
export interface WorkspaceIncidentPersonChoice {
  userId: ObjectID;
  name: string;
  // As the list shows it: "Nawaz Dhandala (you)".
  label: string;
}

export interface WorkspaceIncidentRoleForm {
  roles: Array<WorkspaceIncidentRoleChoice>;
  people: Array<WorkspaceIncidentPersonChoice>;
  // People past the first WORKSPACE_INCIDENT_MAX_PEOPLE: not listed.
  notShownPeopleCount: number;
  holders: Array<WorkspaceIncidentRoleHolder>;
}

/*
 * What a form of the menu asks of the member before it opens, and when it
 * is submitted: the row the action creates - an incident member, an
 * on-call run - or the incident's columns it changes.
 */
export type WorkspaceIncidentFormCheck =
  | {
      kind: "create";
      modelType: DatabaseBaseModelType;
      // Completes "You do not have permission to ...".
      action: string;
    }
  | {
      kind: "update";
      // The incident's columns the action writes, as an update names them.
      data: Record<string, unknown>;
      action: string;
    };

// The incident a form is about, as its member read it.
export interface WorkspaceIncidentForForm {
  event: WorkspaceEventRecord;
  title: string;
}

// What assigning a role came to.
export interface WorkspaceRoleAssignment {
  roleName: string;
  personName: string;
  // Nothing was written: they hold the role already.
  isHeldAlready: boolean;
  // Who had the role before, when it takes one person.
  replacedNames: Array<string>;
}

// How many people the role form lists: Slack shows 100 options.
export const WORKSPACE_INCIDENT_MAX_PEOPLE: number = 100;

// A run of spaces and line breaks: a title on the card is one line.
const WHITESPACE_RUN: RegExp = /\s+/g;

// How many roles that take one person the role form's hint names.
const ROLE_HINT_MAX_NAMES: number = 3;

export default class WorkspaceIncidentActions {
  /*
   * The incident message's buttons and its menu (⋯), every one carrying
   * the incident's id: Slack's ids, which Microsoft Teams' card of the
   * message presses too.
   */
  public static getButtonsBlock(data: {
    incidentId: ObjectID;
    incidentLink: URL;
    actions: WorkspaceIncidentActionIds;
  }): WorkspacePayloadButtons {
    const value: string = data.incidentId.toString();

    const button: (
      title: string,
      actionId: string,
    ) => WorkspaceMessagePayloadButton = (
      title: string,
      actionId: string,
    ): WorkspaceMessagePayloadButton => {
      return {
        _type: "WorkspaceMessagePayloadButton",
        title: title,
        value: value,
        actionId: actionId,
      };
    };

    return {
      _type: "WorkspacePayloadButtons",
      buttons: [
        button(
          WORKSPACE_INCIDENT_BUTTONS.acknowledge,
          data.actions.acknowledge,
        ),
        button(WORKSPACE_INCIDENT_BUTTONS.resolve, data.actions.resolve),
        button(WORKSPACE_INCIDENT_BUTTONS.addNote, data.actions.addNote),
        {
          ...button(WORKSPACE_INCIDENT_BUTTONS.view, data.actions.view),
          url: data.incidentLink,
        },
      ],
      menuButtons: [
        button(
          WORKSPACE_INCIDENT_BUTTONS.changeSeverity,
          data.actions.changeSeverity,
        ),
        button(
          WORKSPACE_INCIDENT_BUTTONS.changeState,
          data.actions.changeState,
        ),
        button(WORKSPACE_INCIDENT_BUTTONS.assignRole, data.actions.assignRole),
        button(
          WORKSPACE_INCIDENT_BUTTONS.pageSomeone,
          data.actions.pageSomeone,
        ),
        button(
          WORKSPACE_INCIDENT_BUTTONS.editCustomFields,
          data.actions.editCustomFields,
        ),
      ],
    };
  }

  /*
   * May the member do what a form of the menu does, to this incident: the
   * row it creates or the columns it changes (`check`), and a read of the
   * incident, as theirs - an incident they may not read is refused with why
   * (WorkspaceActionAuthorization.getUnreadableRefusal). Asked before the
   * form opens, so nobody fills one in for nothing, and again when it is
   * submitted. Throws NotAuthorizedException (or PaymentRequiredException,
   * below the plan), worded for the chat; hands back the incident as they
   * read it.
   */
  @CaptureSpan()
  public static async authorizeForForm(data: {
    incidentId: ObjectID;
    props: DatabaseCommonInteractionProps;
    check: WorkspaceIncidentFormCheck;
  }): Promise<WorkspaceIncidentForForm> {
    const { check } = data;

    if (check.kind === "create") {
      await WorkspaceActionAuthorization.assertCanCreate({
        props: data.props,
        modelType: check.modelType,
        action: check.action,
      });
    } else {
      await WorkspaceActionAuthorization.assertCanUpdate({
        props: data.props,
        modelType: Incident,
        data: check.data,
        action: check.action,
      });
    }

    const found: { record: Incident; event: WorkspaceEventRecord } =
      await WorkspaceMemberActions.readEventForMember<Incident>({
        event: { type: WorkspaceEventType.Incident, id: data.incidentId },
        props: data.props,
        select: {
          title: true,
        },
        action: check.action,
      });

    return { event: found.event, title: found.record.title || "" };
  }

  // What a form of the menu opens with: "🚨 INC-42 Checkout is down".
  public static getFormHeading(
    incident: WorkspaceIncidentForForm,
  ): MarkdownText {
    const number: string =
      incident.event.numberWithPrefix ||
      (incident.event.number !== null ? `#${incident.event.number}` : "");

    return number
      ? mdText`🚨 **${number}** ${incident.title}`
      : mdText`🚨 ${incident.title}`;
  }

  /*
   * A word naming an incident by its number - "42", "#42", "INC-42" - or
   * null for anything else, a title (WorkspaceIncidentNumberWordReader).
   */
  public static readNumberWord(
    text: string | null | undefined,
  ): WorkspaceIncidentNumberWord | null {
    return WorkspaceIncidentNumberWordReader.read(text);
  }

  /*
   * The incident a number names, read as the member: in their project,
   * under their labels and owners. "INC-42" is incident 42 only when that
   * is how its number reads ("inc-42" too); "42" and "#42" are any incident
   * 42. Null for none they may read.
   */
  @CaptureSpan()
  public static async findByNumber(data: {
    projectId: ObjectID;
    word: WorkspaceIncidentNumberWord;
    props: DatabaseCommonInteractionProps;
  }): Promise<ObjectID | null> {
    let incident: Incident | null = null;

    try {
      incident = await IncidentService.findOneBy({
        query: {
          projectId: data.projectId,
          incidentNumber: data.word.number,
        },
        select: {
          _id: true,
          incidentNumberWithPrefix: true,
        },
        props: data.props,
      });
    } catch (err) {
      if (!WorkspaceActionAuthorization.isReadRefusal(err)) {
        throw err;
      }
    }

    if (!incident?.id) {
      return null;
    }

    if (
      !data.word.isPlainNumber &&
      (incident.incidentNumberWithPrefix || "").toLowerCase() !==
        data.word.word.toLowerCase()
    ) {
      return null;
    }

    return incident.id;
  }

  /*
   * The incident a channel was made for - its own channel, which a
   * notification rule created - read as OneUptime: which channels are an
   * incident's own is OneUptime's to know, and nothing of the incident is
   * told from it. Null for any other channel: one many incidents are posted
   * to belongs to none. Asked before anything of the person who asked, so a
   * command in any other channel reads nothing of them twice.
   */
  @CaptureSpan()
  public static async findChannelOwner(data: {
    projectId: ObjectID;
    channelId: string;
  }): Promise<ObjectID | null> {
    if (!data.channelId) {
      return null;
    }

    const owner: Incident | null = await IncidentService.findOneBy({
      query: {
        projectId: data.projectId,
        postUpdatesToWorkspaceChannels: QueryHelper.jsonContains([
          { id: data.channelId },
        ]),
      },
      select: {
        _id: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
    });

    return owner?.id || null;
  }

  // Whether the member may read the incident: in their project, labels, owners.
  @CaptureSpan()
  public static async isReadable(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    try {
      return Boolean(
        await IncidentService.findOneBy({
          query: {
            _id: data.incidentId.toString(),
            projectId: data.projectId,
          },
          select: {
            _id: true,
          },
          props: data.props,
        }),
      );
    } catch (err) {
      if (!WorkspaceActionAuthorization.isReadRefusal(err)) {
        throw err;
      }

      return false;
    }
  }

  /*
   * The incident as a command answers it, read as the member - its number
   * and title first, in bold, then what it is now, each on a line of its
   * own:
   *
   *   🚨 INC-42 · Checkout is down
   *   Severity: Critical · State: Identified · Declared today at 5:15 PM
   *   👤 Incident Commander: Nawaz Dhandala
   *   [👀 Acknowledge Incident] [✅ Resolve Incident] [📄 Add Note]
   *   [🔗 View Incident] [⋯]
   *
   * "Declared", not "since": a command shows any incident, a resolved one
   * too, which is not resolved "since" it began. Asked in the incident's own
   * channel, it says how to declare another incident instead, which is what
   * the command did there before. Null for an incident they may not read.
   */
  @CaptureSpan()
  public static async getCard(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    workspaceType: WorkspaceType;
    actions: WorkspaceIncidentActionIds;
    isAskedInItsChannel?: boolean | undefined;
  }): Promise<WorkspaceIncidentCard | null> {
    let incident: Incident | null = null;

    try {
      incident = await IncidentService.findOneBy({
        query: {
          _id: data.incidentId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          title: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          declaredAt: true,
          createdAt: true,
          currentIncidentState: {
            name: true,
          },
          incidentSeverity: {
            name: true,
          },
        },
        props: data.props,
      });
    } catch (err) {
      if (!WorkspaceActionAuthorization.isReadRefusal(err)) {
        throw err;
      }
    }

    if (!incident?.id) {
      return null;
    }

    const link: URL = await IncidentService.getIncidentLinkInDashboard(
      data.projectId,
      incident.id,
    );
    const number: string =
      incident.incidentNumberWithPrefix || `#${incident.incidentNumber ?? ""}`;
    const title: string = incident.title || "";

    /*
     * Each line a block of its own: Slack stacks them as lines, and Teams
     * runs lines of one text block together unless a blank line parts them.
     */
    const messageBlocks: Array<WorkspaceMessageBlock> = [
      {
        _type: "WorkspacePayloadMarkdown",
        text: WorkspaceIncidentActions.getCardHeading({
          number: number,
          title: title,
          link: link.toString(),
        }).toString(),
      } as WorkspacePayloadMarkdown,
    ];

    const facts: MarkdownText | null = WorkspaceIncidentActions.getFactsLine({
      severity: incident.incidentSeverity?.name || null,
      state: incident.currentIncidentState?.name || null,
      declaredAt: WorkspaceIncidentActions.toDate(
        incident.declaredAt || incident.createdAt,
      ),
    });

    if (facts) {
      messageBlocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: facts.toString(),
      } as WorkspacePayloadMarkdown);
    }

    const holders: Array<WorkspaceIncidentRoleHolder> =
      await WorkspaceIncidentActions.readHolders({
        incidentId: incident.id,
        projectId: data.projectId,
        props: data.props,
      });

    const rolesLine: MarkdownText | null =
      WorkspaceIncidentActions.getHoldersMarkdown(holders);

    if (rolesLine) {
      messageBlocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: rolesLine.toString(),
      } as WorkspacePayloadMarkdown);
    }

    messageBlocks.push(
      WorkspaceIncidentActions.getButtonsBlock({
        incidentId: incident.id,
        incidentLink: link,
        actions: data.actions,
      }),
    );

    if (data.isAskedInItsChannel) {
      messageBlocks.push({
        _type: "WorkspacePayloadContext",
        text: WorkspaceIncidentActions.getDeclareAnotherMarkdown(
          data.workspaceType,
        ).toString(),
      } as WorkspacePayloadContext);
    }

    return {
      messageBlocks: messageBlocks,
      text: `${number} ${title}`.trim(),
    };
  }

  /*
   * The card's first line: "🚨 INC-42 · Checkout is down", in bold, the
   * number linked to the incident. The title is text: Markdown in it does
   * not act.
   */
  public static getCardHeading(data: {
    number: string;
    title: string;
    link: string;
  }): MarkdownText {
    const title: string = data.title.replace(WHITESPACE_RUN, " ").trim();

    return title
      ? mdText`🚨 **[${data.number}](${data.link})** · **${title}**`
      : mdText`🚨 **[${data.number}](${data.link})**`;
  }

  /*
   * What the incident is now, on the card's second line: "Severity:
   * Critical · State: Identified · Declared today at 5:15 PM", each part
   * there only when the incident has it. Null for none. The moment reads in
   * each reader's own time (WorkspaceMessageTime).
   */
  public static getFactsLine(data: {
    severity: string | null;
    state: string | null;
    declaredAt: Date | null;
  }): MarkdownText | null {
    const parts: Array<MarkdownText> = [];

    if (data.severity) {
      parts.push(mdText`Severity: ${data.severity}`);
    }

    if (data.state) {
      parts.push(mdText`State: ${data.state}`);
    }

    if (data.declaredAt) {
      parts.push(
        mdText`Declared ${WorkspaceMessageTime.dateAndTime(data.declaredAt)}`,
      );
    }

    return parts.length > 0 ? FeedMarkdown.join(parts, " · ") : null;
  }

  /*
   * What a command answers for a number no incident the member may read
   * has, and how to declare one instead.
   */
  public static getNotFoundAnswer(data: {
    word: string;
    workspaceType: WorkspaceType;
  }): WorkspaceAnswer {
    const usage: string = WorkspaceCommands.getUsage({
      workspaceType: data.workspaceType,
      command: WorkspaceCommandName.Incident,
    });
    const verb: string =
      data.workspaceType === WorkspaceType.Slack ? "run" : "type";

    return {
      markdown:
        mdText`🔍 There is no incident ${data.word} in this project, or you do not have access to it. To declare a new incident, ${verb} ${WorkspaceIncidentActions.typed(
          data.workspaceType,
          usage,
        )} followed by its title.`.toString(),
      text: `There is no incident ${data.word} in this project`,
    };
  }

  // The severities the form offers: those the member may read, in order.
  @CaptureSpan()
  public static async getSeverityChoices(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<WorkspaceIncidentChoice>> {
    const severities: Array<IncidentSeverity> =
      await WorkspaceActionAuthorization.findReadable({
        service: IncidentSeverityService,
        props: data.props,
        query: {
          projectId: data.projectId,
          // Offered for a new pick: never an archived value.
          isArchived: false,
        },
        select: {
          _id: true,
          name: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
      });

    return severities
      .filter((severity: IncidentSeverity): boolean => {
        return Boolean(severity.id && severity.name);
      })
      .map((severity: IncidentSeverity): WorkspaceIncidentChoice => {
        return { id: severity.id!, name: severity.name! };
      });
  }

  // The severity the incident has, read as the member: what the form opens on.
  @CaptureSpan()
  public static async getSeverityId(data: {
    event: WorkspaceEventRecord;
    props: DatabaseCommonInteractionProps;
  }): Promise<ObjectID | null> {
    const incident: Incident | null = await IncidentService.findOneBy({
      query: {
        _id: data.event.id.toString(),
        projectId: data.event.projectId,
      },
      select: {
        _id: true,
        incidentSeverityId: true,
      },
      props: data.props,
    });

    return incident?.incidentSeverityId || null;
  }

  /*
   * Changes the incident's severity, as the member: the incident's update
   * the dashboard's severity makes, refused where the dashboard would
   * refuse it. Nothing is written for the severity it has already.
   */
  @CaptureSpan()
  public static async changeSeverity(data: {
    event: WorkspaceEventRecord;
    severityId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<{ isChanged: boolean; severityName: string }> {
    let severity: IncidentSeverity | null = null;
    let readError: unknown = undefined;

    try {
      severity = await IncidentSeverityService.findOneBy({
        query: {
          _id: data.severityId.toString(),
          projectId: data.event.projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        props: data.props,
      });
    } catch (err) {
      if (!(err instanceof NotAuthorizedException)) {
        throw err;
      }

      readError = err;
    }

    if (!severity?.id) {
      throw await WorkspaceActionAuthorization.getUnreadableRefusal({
        action: "change the severity of this incident",
        service: IncidentSeverityService,
        id: data.severityId,
        props: data.props,
        readError: readError,
      });
    }

    const severityName: string = severity.name || "";
    const currentId: ObjectID | null =
      await WorkspaceIncidentActions.getSeverityId(data);

    if (
      currentId &&
      currentId.toString().toLowerCase() ===
        severity.id.toString().toLowerCase()
    ) {
      return { isChanged: false, severityName: severityName };
    }

    const updatedCount: number = await IncidentService.updateOneById({
      id: data.event.id,
      data: {
        incidentSeverityId: severity.id,
      },
      props: data.props,
    });

    /*
     * An incident they may read but not change - outside their labels or
     * owners - changes nothing: they are told why, never that it changed.
     */
    if (updatedCount === 0) {
      throw await WorkspaceIncidentActions.getUnwrittenError({
        incidentId: data.event.id,
        props: data.props,
      });
    }

    return { isChanged: true, severityName: severityName };
  }

  /*
   * What the role form offers, read as the member: the project's incident
   * roles (the primary one first), its people, and who holds each role on
   * the incident now.
   */
  @CaptureSpan()
  public static async getRoleForm(data: {
    event: WorkspaceEventRecord;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceIncidentRoleForm> {
    const projectId: ObjectID = data.event.projectId;

    const [roles, members, holders]: [
      Array<IncidentRole>,
      Array<TeamMember>,
      Array<WorkspaceIncidentRoleHolder>,
    ] = await Promise.all([
      WorkspaceActionAuthorization.findReadable({
        service: IncidentRoleService,
        props: data.props,
        query: {
          projectId: projectId,
          // Offered for a new pick: never an archived value.
          isArchived: false,
        },
        select: {
          _id: true,
          name: true,
          canAssignMultipleUsers: true,
        },
        sort: {
          isPrimaryRole: SortOrder.Descending,
          name: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
      }),
      WorkspaceActionAuthorization.findReadable({
        service: TeamMemberService,
        props: data.props,
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
      WorkspaceIncidentActions.readHolders({
        incidentId: data.event.id,
        projectId: projectId,
        props: data.props,
      }),
    ]);

    const seen: Set<string> = new Set<string>();
    const people: Array<WorkspaceIncidentPersonChoice> = [];

    for (const member of members) {
      const userId: ObjectID | undefined =
        member.userId || member.user?.id || undefined;

      if (!userId || seen.has(userId.toString().toLowerCase())) {
        continue;
      }

      seen.add(userId.toString().toLowerCase());

      const name: string =
        WorkspaceIncidentActions.getUserName(member.user) || "Someone";
      const isYou: boolean =
        userId.toString().toLowerCase() ===
        (data.props.userId?.toString().toLowerCase() || "");

      people.push({
        userId: userId,
        name: name,
        label: isYou ? `${name} (you)` : name,
      });
    }

    /*
     * By name, with whoever opened the form first: "I'll take it" is what
     * most people pick, and it stays listed in a project of more people
     * than the form shows.
     */
    const yourId: string = data.props.userId?.toString().toLowerCase() || "";

    people.sort(
      (a: WorkspaceIncidentPersonChoice, b: WorkspaceIncidentPersonChoice) => {
        const isA: boolean = a.userId.toString().toLowerCase() === yourId;
        const isB: boolean = b.userId.toString().toLowerCase() === yourId;

        if (isA !== isB) {
          return isA ? -1 : 1;
        }

        return a.name.localeCompare(b.name);
      },
    );

    return {
      roles: roles
        .filter((role: IncidentRole): boolean => {
          return Boolean(role.id && role.name);
        })
        .map((role: IncidentRole): WorkspaceIncidentRoleChoice => {
          return {
            id: role.id!,
            name: role.name!,
            canAssignMultipleUsers: Boolean(role.canAssignMultipleUsers),
          };
        }),
      people: people.slice(0, WORKSPACE_INCIDENT_MAX_PEOPLE),
      notShownPeopleCount: Math.max(
        0,
        people.length - WORKSPACE_INCIDENT_MAX_PEOPLE,
      ),
      holders: holders,
    };
  }

  /*
   * Gives a person a role on the incident, as the member: the incident
   * member the dashboard's Roles card adds, so the feed says who was added
   * as what, and the incident's channels invite them as for any other. A
   * role that takes one person (Incident Commander) moves to them: whoever
   * had it is taken off it first - only when the member may take people
   * off roles, so it never ends up with two.
   */
  @CaptureSpan()
  public static async assignRole(data: {
    event: WorkspaceEventRecord;
    roleId: ObjectID;
    userId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceRoleAssignment> {
    const projectId: ObjectID = data.event.projectId;

    let role: IncidentRole | null = null;
    let readError: unknown = undefined;

    try {
      role = await IncidentRoleService.findOneBy({
        query: {
          _id: data.roleId.toString(),
          projectId: projectId,
        },
        select: {
          _id: true,
          name: true,
          canAssignMultipleUsers: true,
        },
        props: data.props,
      });
    } catch (err) {
      if (!(err instanceof NotAuthorizedException)) {
        throw err;
      }

      readError = err;
    }

    if (!role?.id) {
      throw await WorkspaceActionAuthorization.getUnreadableRefusal({
        action: "assign a role on this incident",
        service: IncidentRoleService,
        id: data.roleId,
        props: data.props,
        readError: readError,
      });
    }

    const roleName: string = role.name || "";

    const holders: Array<WorkspaceIncidentRoleHolder> = (
      await WorkspaceIncidentActions.readHolders({
        incidentId: data.event.id,
        projectId: projectId,
        props: data.props,
      })
    ).filter((holder: WorkspaceIncidentRoleHolder): boolean => {
      return holder.roleId.toString() === role.id!.toString();
    });

    const personName: string = await WorkspaceIncidentActions.getPersonName({
      userId: data.userId,
      projectId: projectId,
    });

    if (
      holders.some((holder: WorkspaceIncidentRoleHolder): boolean => {
        return (
          holder.userId.toString().toLowerCase() ===
          data.userId.toString().toLowerCase()
        );
      })
    ) {
      return {
        roleName: roleName,
        personName: personName,
        isHeldAlready: true,
        replacedNames: [],
      };
    }

    const replaced: Array<WorkspaceIncidentRoleHolder> =
      role.canAssignMultipleUsers ? [] : holders;

    /*
     * Taking somebody off a role is the member's to be allowed, first. Told
     * in one go - the role, who would come off it, and the permissions that
     * allow it - not as the table's own refusal, which names "Incident
     * Member" rather than the role.
     */
    if (replaced.length > 0) {
      try {
        ModelPermission.checkTableWritePermission(
          IncidentMember,
          data.props,
          DatabaseRequestType.Delete,
        );
      } catch (err) {
        if (err instanceof NotAuthorizedException) {
          const needed: Array<string> = PermissionHelper.getPermissionTitles(
            TablePermission.getTablePermission(
              IncidentMember,
              DatabaseRequestType.Delete,
            ),
          );

          throw new NotAuthorizedException(
            `${roleName} takes one person, and you do not have permission to take ${WorkspaceIncidentActions.joinNames(
              replaced.map((holder: WorkspaceIncidentRoleHolder): string => {
                return holder.name;
              }),
            )} off it.${
              needed.length > 0
                ? ` You need one of these permissions: ${needed.join(", ")}.`
                : ""
            }`,
          );
        }

        throw err;
      }
    }

    const member: IncidentMember = new IncidentMember();
    member.projectId = projectId;
    member.incidentId = data.event.id;
    member.userId = data.userId;
    member.incidentRoleId = role.id;

    await IncidentMemberService.create({
      data: member,
      props: data.props,
    });

    for (const holder of replaced) {
      await IncidentMemberService.deleteOneById({
        id: holder.memberId,
        props: data.props,
      });
    }

    return {
      roleName: roleName,
      personName: personName,
      isHeldAlready: false,
      replacedNames: replaced.map(
        (holder: WorkspaceIncidentRoleHolder): string => {
          return holder.name;
        },
      ),
    };
  }

  /*
   * Pages people, a team, whoever is on call in a schedule, or an on-call
   * policy about the incident, as the member - the page OneUptime's other
   * pages are (OnCallPageService): each person through their own on-call
   * rules, until somebody acknowledges the incident. Its progress shows in
   * the incident's own channels, as one message kept up to date.
   */
  @CaptureSpan()
  public static async page(data: {
    event: WorkspaceEventRecord;
    targets: OnCallPageTargets;
    props: DatabaseCommonInteractionProps;
    // What the person paging wrote to the people paged: the page's message.
    message?: string | undefined;
  }): Promise<OnCallPageResult> {
    if (WorkspacePage.countTargets(data.targets) === 0) {
      throw new BadDataException("Pick who to page.");
    }

    const message: string = toOnCallPersonPageMessage(data.message);

    return await OnCallPageService.page({
      projectId: data.event.projectId,
      targets: data.targets,
      about: {
        incidentId: data.event.id,
        ...(message ? { message: message } : {}),
      },
      props: data.props,
      maxWaitForRecordInMs: WORKSPACE_PAGE_MAX_WAIT_FOR_RECORD_IN_MS,
    });
  }

  /*
   * What a submitted page form is told when it cannot page - nobody picked,
   * or more than a page names - in the Page someone form's words; null when
   * it can.
   */
  public static getPageProblem(picked: Array<string>): string | null {
    const count: number = WorkspacePage.countTargets(
      WorkspacePage.readTargets(picked),
    );

    if (count === 0) {
      return WORKSPACE_PAGE_FORM_TEXT.pickWho;
    }

    if (count > MAX_ON_CALL_DIRECT_PAGE_TARGETS) {
      return WORKSPACE_PAGE_FORM_TEXT.pickFewer;
    }

    return null;
  }

  /*
   * What a page about the incident came to, for whoever paged - quoting the
   * message they wrote, when they wrote one.
   */
  public static getPagedAnswer(
    result: OnCallPageResult,
    message?: string | undefined,
  ): WorkspaceAnswer {
    return WorkspacePage.getPagedAnswer({
      result: result,
      message: toOnCallPersonPageMessage(message),
      isShownAtPlace: false,
      canBeShownAtPlace: false,
    });
  }

  // "⚠️ Incident INC-42 is now Critical."
  @CaptureSpan()
  public static async getSeverityAnswer(data: {
    event: WorkspaceEventRecord;
    severityName: string;
    isChanged: boolean;
  }): Promise<WorkspaceAnswer> {
    const record: WorkspaceRecordName =
      await WorkspaceActionAnswers.getRecordName(data.event);
    const recordMarkdown: MarkdownText =
      WorkspaceActionAnswers.getRecordMarkdown(record);

    if (!data.isChanged) {
      return {
        markdown:
          mdText`${recordMarkdown} is already **${data.severityName}**. Nothing changed.`.toString(),
        text: `${record.label} is already ${data.severityName}`,
      };
    }

    return {
      markdown:
        mdText`⚠️ ${recordMarkdown} is now **${data.severityName}**.`.toString(),
      text: `${record.label} is now ${data.severityName}`,
    };
  }

  // "👤 Nawaz Dhandala is now Incident Commander on Incident INC-42."
  @CaptureSpan()
  public static async getRoleAnswer(data: {
    event: WorkspaceEventRecord;
    assignment: WorkspaceRoleAssignment;
  }): Promise<WorkspaceAnswer> {
    const record: WorkspaceRecordName =
      await WorkspaceActionAnswers.getRecordName(data.event);
    const recordMarkdown: MarkdownText =
      WorkspaceActionAnswers.getRecordMarkdown(record);
    const { assignment } = data;

    if (assignment.isHeldAlready) {
      return {
        markdown:
          mdText`**${assignment.personName}** is already **${assignment.roleName}** on ${recordMarkdown}. Nothing changed.`.toString(),
        text: `${assignment.personName} is already ${assignment.roleName} on ${record.label}`,
      };
    }

    const replaced: MarkdownText =
      assignment.replacedNames.length > 0
        ? mdText`, in place of ${WorkspaceIncidentActions.joinBoldNames(
            assignment.replacedNames,
          )}`
        : FeedMarkdown.empty();

    return {
      markdown:
        mdText`👤 **${assignment.personName}** is now **${assignment.roleName}** on ${recordMarkdown}${replaced}.`.toString(),
      text: `${assignment.personName} is now ${assignment.roleName} on ${record.label}`,
    };
  }

  // "➡️ You moved Incident INC-42 to Identified."
  @CaptureSpan()
  public static async getStateChangedAnswer(data: {
    event: WorkspaceEventRecord;
    stateId: ObjectID;
  }): Promise<WorkspaceAnswer> {
    const record: WorkspaceRecordName =
      await WorkspaceActionAnswers.getRecordName(data.event);
    const recordMarkdown: MarkdownText =
      WorkspaceActionAnswers.getRecordMarkdown(record);

    // The state's name, as OneUptime names it: the member just moved to it.
    const state: IncidentState | null = await IncidentStateService.findOneBy({
      query: {
        _id: data.stateId.toString(),
        projectId: data.event.projectId,
      },
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    const stateName: string = state?.name || "its new state";

    return {
      markdown:
        mdText`➡️ You moved ${recordMarkdown} to **${stateName}**.`.toString(),
      text: `You moved ${record.label} to ${stateName}`,
    };
  }

  // "📄 You added a private note to Incident INC-42."
  @CaptureSpan()
  public static async getNoteAddedAnswer(data: {
    incidentId: ObjectID;
    isPublic: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceAnswer> {
    const found: { record: Incident; event: WorkspaceEventRecord } | null =
      await WorkspaceMemberActions.findEventForMember<Incident>({
        event: { type: WorkspaceEventType.Incident, id: data.incidentId },
        props: data.props,
        select: {
          _id: true,
        },
      });

    const kind: string = data.isPublic ? "public" : "private";

    if (!found) {
      return {
        markdown:
          mdText`📄 You added a ${kind} note to the incident.`.toString(),
        text: `You added a ${kind} note to the incident`,
      };
    }

    const record: WorkspaceRecordName =
      await WorkspaceActionAnswers.getRecordName(found.event);

    return {
      markdown:
        mdText`📄 You added a ${kind} note to ${WorkspaceActionAnswers.getRecordMarkdown(
          record,
        )}.`.toString(),
      text: `You added a ${kind} note to ${record.label}`,
    };
  }

  // "📝 Updated Customer Impact and Region on Incident INC-42."
  @CaptureSpan()
  public static async getCustomFieldsAnswer(data: {
    event: WorkspaceEventRecord;
    changedNames: Array<string>;
  }): Promise<WorkspaceAnswer> {
    const record: WorkspaceRecordName =
      await WorkspaceActionAnswers.getRecordName(data.event);
    const recordMarkdown: MarkdownText =
      WorkspaceActionAnswers.getRecordMarkdown(record);

    if (data.changedNames.length === 0) {
      return {
        markdown:
          mdText`Nothing changed: the custom fields of ${recordMarkdown} are as they were.`.toString(),
        text: `Nothing changed on ${record.label}`,
      };
    }

    return {
      markdown: mdText`📝 Updated ${WorkspaceIncidentActions.joinBoldNames(
        data.changedNames,
      )} on ${recordMarkdown}.`.toString(),
      text: `Updated ${WorkspaceIncidentActions.joinNames(
        data.changedNames,
      )} on ${record.label}`,
    };
  }

  /*
   * What a form says instead of opening with nothing to offer - no
   * severity, role or custom field - and where to add one. The product's
   * name is the one the installation goes by.
   */
  public static getNoSeveritiesMessage(): string {
    return `This project has no incident severities you can pick. Add one in ${ProductBrandingText.getProductName()} under Incidents → Settings → Incident Severity, or ask a project admin for access to them.`;
  }

  public static getNoRolesMessage(): string {
    return `This project has no incident roles you can assign. Add one in ${ProductBrandingText.getProductName()} under Incidents → Settings → Incident Roles, or ask a project admin for access to them.`;
  }

  public static getNoCustomFieldsMessage(): string {
    return `This project has no incident custom fields yet. Add them in ${ProductBrandingText.getProductName()} under Incidents → Settings → Custom Fields.`;
  }

  public static getOnlyCopiedCustomFieldsMessage(): string {
    return `Every custom field of this incident is copied from its monitor, so there is nothing to edit here. Change them on the monitor in ${ProductBrandingText.getProductName()}.`;
  }

  /*
   * Why, and where to go instead: a chat form cannot upload a file, and the
   * incident's Custom Fields page in OneUptime is where its files are added
   * and downloaded.
   */
  public static getOnlyFileCustomFieldsMessage(): string {
    return `The custom fields you can edit here hold files, which can't be uploaded from chat. Add and download them in ${ProductBrandingText.getProductName()}, on the incident's Custom Fields page.`;
  }

  /*
   * Why the custom fields form has nothing to ask: the project has no
   * incident custom fields, every one is copied from the incident's
   * monitor, or the ones that are not hold files.
   */
  public static getNothingToEditCustomFieldsMessage(data: {
    form: WorkspaceCustomFieldsForm;
  }): string {
    if ((data.form.fileFieldNames || []).length > 0) {
      return WorkspaceIncidentActions.getOnlyFileCustomFieldsMessage();
    }

    if (data.form.copiedFieldNames.length > 0) {
      return WorkspaceIncidentActions.getOnlyCopiedCustomFieldsMessage();
    }

    return WorkspaceIncidentActions.getNoCustomFieldsMessage();
  }

  /*
   * What the custom fields form says under its fields, in both chats: that
   * an emptied field is cleared, and what it leaves out - fields copied from
   * the incident's monitor, and fields past what one form holds. The zone a
   * time is read in is said at the time itself (Teams' time input names it;
   * Slack's picker shows each person their own).
   */
  public static getCustomFieldsNote(data: {
    form: WorkspaceCustomFieldsForm;
  }): MarkdownText {
    const { form } = data;
    const parts: Array<MarkdownText> = [
      mdText`${WORKSPACE_INCIDENT_FORM_TEXT.customFieldsHint}`,
    ];

    if (form.copiedFieldNames.length > 0) {
      const isOne: boolean = form.copiedFieldNames.length === 1;

      parts.push(
        mdText`${WorkspaceIncidentActions.joinBoldNames(
          form.copiedFieldNames,
        )} ${isOne ? "is" : "are"} copied from the incident's monitor, so ${isOne ? "it is" : "they are"} not here.`,
      );
    }

    const fileFieldNames: Array<string> = form.fileFieldNames || [];

    if (fileFieldNames.length > 0) {
      const isOne: boolean = fileFieldNames.length === 1;

      parts.push(
        mdText`${WorkspaceIncidentActions.joinBoldNames(
          fileFieldNames,
        )} ${isOne ? "holds" : "hold"} files: add and download them in ${ProductBrandingText.getProductName()}.`,
      );
    }

    if (form.notShownCount > 0) {
      const isOne: boolean = form.notShownCount === 1;

      parts.push(
        mdText`${form.notShownCount} more ${isOne ? "field doesn't" : "fields don't"} fit here: edit ${isOne ? "it" : "them"} in ${ProductBrandingText.getProductName()}.`,
      );
    }

    return FeedMarkdown.join(parts, " ");
  }

  /*
   * What the role form says under its fields, as plain text: the roles that
   * take one person, by name, and what picking someone for one does -
   * "Incident Commander takes one person: picking someone replaces whoever
   * has it." The form's heading says who has each role now. Empty when every
   * role takes several people. Three roles are named at most.
   */
  public static getRoleHint(roles: Array<WorkspaceIncidentRoleChoice>): string {
    const names: Array<string> = roles
      .filter((role: WorkspaceIncidentRoleChoice): boolean => {
        return !role.canAssignMultipleUsers;
      })
      .map((role: WorkspaceIncidentRoleChoice): string => {
        return role.name;
      });

    if (names.length === 0) {
      return "";
    }

    const replaces: string = "picking someone replaces whoever has it.";

    if (names.length === 1) {
      return `${names[0]!} takes one person: ${replaces}`;
    }

    const named: Array<string> =
      names.length > ROLE_HINT_MAX_NAMES
        ? [
            ...names.slice(0, ROLE_HINT_MAX_NAMES),
            `${names.length - ROLE_HINT_MAX_NAMES} more ${
              names.length - ROLE_HINT_MAX_NAMES === 1 ? "role" : "roles"
            }`,
          ]
        : names;

    return `${WorkspaceIncidentActions.joinNames(named)} take one person each: ${replaces}`;
  }

  // Who holds which role: "👤 Incident Commander: Nawaz Dhandala · Scribe: Ana Ruiz".
  public static getHoldersMarkdown(
    holders: Array<WorkspaceIncidentRoleHolder>,
  ): MarkdownText | null {
    if (holders.length === 0) {
      return null;
    }

    const roleOrder: Array<string> = [];
    const byRole: Map<string, { name: string; people: Array<string> }> =
      new Map<string, { name: string; people: Array<string> }>();

    for (const holder of holders) {
      const key: string = holder.roleId.toString();

      if (!byRole.has(key)) {
        roleOrder.push(key);
        byRole.set(key, { name: holder.roleName, people: [] });
      }

      byRole.get(key)!.people.push(holder.name);
    }

    return mdText`👤 ${FeedMarkdown.join(
      roleOrder.map((key: string): MarkdownText => {
        const role: { name: string; people: Array<string> } = byRole.get(key)!;

        return mdText`${role.name}: ${WorkspaceIncidentActions.joinBoldNames(
          role.people,
        )}`;
      }),
      " · ",
    )}`;
  }

  /*
   * Who holds a role on the incident, read as the member: in the order they
   * were given it. None when they may not read the incident's members.
   */
  @CaptureSpan()
  public static async readHolders(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<WorkspaceIncidentRoleHolder>> {
    let members: Array<IncidentMember> = [];

    try {
      members = await IncidentMemberService.findBy({
        query: {
          projectId: data.projectId,
          incidentId: data.incidentId,
        },
        select: {
          _id: true,
          userId: true,
          incidentRoleId: true,
          user: {
            _id: true,
            name: true,
            email: true,
          },
          incidentRole: {
            _id: true,
            name: true,
          },
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: data.props,
      });
    } catch (err) {
      if (!WorkspaceActionAuthorization.isReadRefusal(err)) {
        throw err;
      }

      logger.debug("A chat member may not read an incident's role holders.", {
        projectId: data.projectId.toString(),
      });
    }

    const holders: Array<WorkspaceIncidentRoleHolder> = [];

    for (const member of members) {
      if (!member.id || !member.userId || !member.incidentRoleId) {
        continue;
      }

      holders.push({
        memberId: member.id,
        roleId: member.incidentRoleId,
        roleName: member.incidentRole?.name || "Role",
        userId: member.userId,
        name: WorkspaceIncidentActions.getUserName(member.user) || "Someone",
      });
    }

    return holders;
  }

  // "a, b and c", each in bold.
  public static joinBoldNames(names: Array<string>): MarkdownText {
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

  // "a, b and c".
  public static joinNames(names: Array<string>): string {
    if (names.length <= 1) {
      return names[0] || "";
    }

    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  }

  /*
   * Asked in an incident's own channel, the command shows the incident; how
   * to declare another, in each chat's words.
   */
  public static getDeclareAnotherMarkdown(
    workspaceType: WorkspaceType,
  ): MarkdownText {
    const usage: string = WorkspaceCommands.getUsage({
      workspaceType: workspaceType,
      command: WorkspaceCommandName.Incident,
    });

    return workspaceType === WorkspaceType.Slack
      ? mdText`To declare a new incident instead, run ${WorkspaceIncidentActions.typed(
          workspaceType,
          usage,
        )} followed by its title.`
      : mdText`To declare a new incident instead, type ${WorkspaceIncidentActions.typed(
          workspaceType,
          usage,
        )} followed by its title.`;
  }

  /*
   * Why an update of the incident wrote nothing, as the chat answers it: a
   * permission the member lacks on it (its labels, its owners), or - gone
   * since it was read - an incident not there, said as one they may not
   * read is.
   */
  public static async getUnwrittenError(data: {
    incidentId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Error> {
    const error: Error = await IncidentService.getUnwrittenByIdError({
      id: data.incidentId,
      props: data.props,
      type: DatabaseRequestType.Update,
    });

    if (error instanceof NotAuthorizedException) {
      return error;
    }

    // Not readable to them any more: why, as for any record a chat names.
    return await WorkspaceMemberActions.getUnreadableRefusal({
      event: { type: WorkspaceEventType.Incident, id: data.incidentId },
      props: data.props,
    });
  }

  // A person's name, as a list shows it: their name, or their email.
  private static getUserName(user: User | undefined | null): string {
    if (!user) {
      return "";
    }

    return user.name?.toString().trim() || user.email?.toString().trim() || "";
  }

  // The name of somebody given a role, read as OneUptime: they are named.
  private static async getPersonName(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<string> {
    const member: TeamMember | null = await TeamMemberService.findOneBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
      },
      select: {
        user: {
          _id: true,
          name: true,
          email: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    return WorkspaceIncidentActions.getUserName(member?.user) || "Someone";
  }

  // Something to type, as each chat writes it: code in Slack, bold in Teams.
  private static typed(
    workspaceType: WorkspaceType,
    text: string,
  ): MarkdownText {
    return workspaceType === WorkspaceType.Slack
      ? FeedMarkdown.code(text)
      : mdText`**${text}**`;
  }

  private static toDate(value: Date | string | undefined | null): Date | null {
    if (!value) {
      return null;
    }

    const date: Date = value instanceof Date ? value : new Date(value);

    return isNaN(date.getTime()) ? null : date;
  }
}

/*
 * The action ids of the incident's buttons and menu in a chat: Slack's,
 * which a Microsoft Teams card drawn from the same blocks presses too.
 */
export interface WorkspaceIncidentActionIds {
  acknowledge: string;
  resolve: string;
  addNote: string;
  view: string;
  changeSeverity: string;
  changeState: string;
  assignRole: string;
  pageSomeone: string;
  editCustomFields: string;
}
