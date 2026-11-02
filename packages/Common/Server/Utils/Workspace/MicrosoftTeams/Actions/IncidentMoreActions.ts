import { TurnContext } from "../Botbuilder";
import IncidentMember from "../../../../../Models/DatabaseModels/IncidentMember";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH } from "../../../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import { OnCallPageResult } from "../../../../Services/OnCallPageService";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import logger from "../../../Logger";
import {
  WorkspaceAnswer,
  WorkspaceLatePress,
} from "../../WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import WorkspaceIncidentActions, {
  WORKSPACE_INCIDENT_FORM_TEXT,
  WorkspaceIncidentCard,
  WorkspaceIncidentChoice,
  WorkspaceIncidentForForm,
  WorkspaceIncidentFormCheck,
  WorkspaceIncidentNumberWord,
  WorkspaceIncidentPersonChoice,
  WorkspaceIncidentRoleChoice,
  WorkspaceIncidentRoleForm,
  WorkspaceRoleAssignment,
} from "../../WorkspaceIncidentActions";
import WorkspaceIncidentCustomFields, {
  WorkspaceCustomFieldDefinition,
  WorkspaceCustomFieldInput,
  WorkspaceCustomFieldInputKind,
  WorkspaceCustomFieldsForm,
  WorkspaceCustomFieldsSubmission,
  WorkspaceCustomFieldSubmittedValue,
} from "../../WorkspaceIncidentCustomFields";
import WorkspaceMemberActions from "../../WorkspaceMemberActions";
import WorkspacePage, {
  WORKSPACE_PAGE_FORM_TEXT,
  WorkspacePageChoice,
  WorkspacePageChoiceGroup,
  WorkspacePageTargetKind,
} from "../../WorkspacePage";
import { WorkspaceCommandName } from "../../WorkspaceCommands";
import { SLACK_INCIDENT_ACTION_IDS } from "../../Slack/Messages/Incident";
import MicrosoftTeamsUtil from "../MicrosoftTeams";
import MicrosoftTeamsActionAnswer from "../MicrosoftTeamsActionAnswer";
import MicrosoftTeamsCardChoices, {
  MicrosoftTeamsCardChoice,
  MicrosoftTeamsCardChoiceList,
} from "../MicrosoftTeamsCardChoices";
import MicrosoftTeamsCommands from "../MicrosoftTeamsCommands";
import MicrosoftTeamsMessageSize from "../MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies, {
  MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
} from "../MicrosoftTeamsReplies";
import MicrosoftTeamsTimezone, {
  MicrosoftTeamsUserTimezone,
} from "../MicrosoftTeamsTimezone";
import { MicrosoftTeamsIncidentActionType } from "./ActionTypes";
import MicrosoftTeamsAuthAction from "./Auth";
import ProductBrandingText from "../../../ProductBrandingText";
import moment from "moment-timezone";

/*
 * AN INCIDENT'S MENU (…) IN MICROSOFT TEAMS, AND THE INCIDENT `incident 42`
 * SHOWS - Slack's, through cards (WorkspaceIncidentActions).
 *
 * The incident's card is drawn from the same blocks as its Slack message,
 * its menu as the card's overflow menu, each item pressed by Slack's id.
 * Each answers with a card of its own - a form, filled in as the person who
 * pressed it may see the incident - and that card, submitted, makes the
 * change as whoever submits it, with their own permissions: anyone in a
 * channel may submit a card, so the submitter is checked, never the person
 * the card was sent to. A card that did what it does is removed, so nobody
 * submits it twice, and the conversation is told what it did, mentioning
 * who did it - Teams has no message only one person sees. A refusal is
 * thrown, for the bot's invoke handler to tell them
 * (MicrosoftTeamsUtil.handleBotInvokeActivity).
 *
 * Teams cannot do two things Slack does. Its overflow menu is the card's
 * secondary actions, which an older client draws as more buttons. And a
 * card's field cannot be answered under it before the card is gone: a value
 * that does not fit its field is answered in the conversation, and the card
 * stays, to be fixed and submitted again.
 */

// The cards' fields.
export const MICROSOFT_TEAMS_SEVERITY_FIELD: string = "incidentSeverity";
export const MICROSOFT_TEAMS_ROLE_FIELD: string = "incidentRole";
export const MICROSOFT_TEAMS_ROLE_PERSON_FIELD: string = "incidentRolePerson";
export const MICROSOFT_TEAMS_PAGE_FIELD: string = "incidentPageTargets";
export const MICROSOFT_TEAMS_PAGE_ABOUT_INCIDENT_MESSAGE_FIELD: string =
  "incidentPageMessage";

// A Date and time field's two inputs: its day, and its time.
const DATE_SUFFIX: string = "__date";
const TIME_SUFFIX: string = "__time";

// A choice's kind, as the page card's one list says it before its name.
const PAGE_CHOICE_PREFIXES: Record<WorkspacePageTargetKind, string> = {
  [WorkspacePageTargetKind.Schedule]: "Schedule",
  [WorkspacePageTargetKind.Person]: "Person",
  [WorkspacePageTargetKind.Team]: "Team",
  [WorkspacePageTargetKind.Policy]: "Policy",
};

// The longest text a card's text input takes.
const MAX_TEXT_INPUT_LENGTH: number = 3000;

export default class MicrosoftTeamsIncidentMoreActions {
  public static isAction(actionType: string): boolean {
    switch (actionType) {
      case MicrosoftTeamsIncidentActionType.ViewChangeIncidentSeverity:
      case MicrosoftTeamsIncidentActionType.SubmitChangeIncidentSeverity:
      case MicrosoftTeamsIncidentActionType.ViewAssignIncidentRole:
      case MicrosoftTeamsIncidentActionType.SubmitAssignIncidentRole:
      case MicrosoftTeamsIncidentActionType.ViewPageAboutIncident:
      case MicrosoftTeamsIncidentActionType.SubmitPageAboutIncident:
      case MicrosoftTeamsIncidentActionType.ViewEditIncidentCustomFields:
      case MicrosoftTeamsIncidentActionType.SubmitEditIncidentCustomFields:
        return true;
      default:
        return false;
    }
  }

  /*
   * A press of the menu, or one of its cards submitted, as the member who
   * pressed it (`databaseProps`, a current member's, as the invoke handler
   * reads them).
   */
  @CaptureSpan()
  public static async handle(data: {
    actionType: string;
    actionValue: string;
    value: JSONObject;
    projectId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    switch (data.actionType) {
      case MicrosoftTeamsIncidentActionType.ViewChangeIncidentSeverity:
        return await MicrosoftTeamsIncidentMoreActions.sendSeverityCard(data);
      case MicrosoftTeamsIncidentActionType.SubmitChangeIncidentSeverity:
        return await MicrosoftTeamsIncidentMoreActions.submitSeverity(data);
      case MicrosoftTeamsIncidentActionType.ViewAssignIncidentRole:
        return await MicrosoftTeamsIncidentMoreActions.sendRoleCard(data);
      case MicrosoftTeamsIncidentActionType.SubmitAssignIncidentRole:
        return await MicrosoftTeamsIncidentMoreActions.submitRole(data);
      case MicrosoftTeamsIncidentActionType.ViewPageAboutIncident:
        return await MicrosoftTeamsIncidentMoreActions.sendPageCard(data);
      case MicrosoftTeamsIncidentActionType.SubmitPageAboutIncident:
        return await MicrosoftTeamsIncidentMoreActions.submitPage(data);
      case MicrosoftTeamsIncidentActionType.ViewEditIncidentCustomFields:
        return await MicrosoftTeamsIncidentMoreActions.sendCustomFieldsCard(
          data,
        );
      case MicrosoftTeamsIncidentActionType.SubmitEditIncidentCustomFields:
        return await MicrosoftTeamsIncidentMoreActions.submitCustomFields(data);
      default:
        throw new BadDataException("Invalid Action Type");
    }
  }

  /*
   * "incident 42" - or #42, INC-42 - typed to the bot: that incident, with
   * its buttons and menu; and plain "incident" typed in an incident's own
   * channel: that incident, and how to declare another. False - nothing
   * answered - for anything else: the incident form opens, as it always did.
   */
  @CaptureSpan()
  public static async handleIncidentCommand(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
    text: string;
  }): Promise<boolean> {
    const word: WorkspaceIncidentNumberWord | null =
      WorkspaceIncidentActions.readNumberWord(data.text);

    if (word) {
      return await MicrosoftTeamsIncidentMoreActions.showIncidentByNumber({
        ...data,
        word: word,
      });
    }

    if (data.text.trim()) {
      return false;
    }

    return await MicrosoftTeamsIncidentMoreActions.showIncidentOfChannel(data);
  }

  private static async showIncidentByNumber(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
    word: WorkspaceIncidentNumberWord;
  }): Promise<boolean> {
    const props: DatabaseCommonInteractionProps | null =
      await MicrosoftTeamsCommands.authorizeSender({
        turnContext: data.turnContext,
        activity: data.activity,
        projectId: data.projectId,
        does: "show this incident",
        commandName: WorkspaceCommandName.Incident,
        connect: {
          purpose: "see this incident",
          /*
           * With the number: typed again without it, the command would
           * open the incident form instead of showing this incident.
           */
          command: `${WorkspaceCommandName.Incident} ${data.word.word}`,
        },
      });

    if (!props) {
      return true;
    }

    const incidentId: ObjectID | null =
      await WorkspaceIncidentActions.findByNumber({
        projectId: data.projectId,
        word: data.word,
        props: props,
      });

    if (incidentId) {
      await MicrosoftTeamsIncidentMoreActions.replyWithCard({
        turnContext: data.turnContext,
        projectId: data.projectId,
        incidentId: incidentId,
        props: props,
        isAskedInItsChannel: false,
      });
      return true;
    }

    // "INC" and digits that are no incident's number: a title after all.
    if (!data.word.isPlainNumber) {
      return false;
    }

    await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer: WorkspaceIncidentActions.getNotFoundAnswer({
        word: data.word.word,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    });

    return true;
  }

  /*
   * Plain "incident" in a channel OneUptime made for an incident: that
   * incident. Asked of a sender OneUptime cannot act as - not connected, not
   * a member - it answers nothing, and the incident form's own check tells
   * them, as it always did.
   */
  private static async showIncidentOfChannel(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
  }): Promise<boolean> {
    const channelId: string = MicrosoftTeamsIncidentMoreActions.getChannelId(
      data.activity,
    );

    if (!channelId) {
      return false;
    }

    let props: DatabaseCommonInteractionProps;
    let incidentId: ObjectID | null;

    try {
      incidentId = await WorkspaceIncidentActions.findChannelOwner({
        projectId: data.projectId,
        channelId: channelId,
      });

      if (!incidentId) {
        return false;
      }

      props = await MicrosoftTeamsIncidentMoreActions.getSenderProps(data);

      if (
        !(await WorkspaceIncidentActions.isReadable({
          projectId: data.projectId,
          incidentId: incidentId,
          props: props,
        }))
      ) {
        return false;
      }
    } catch (err) {
      /*
       * Not connected, not a member, or the channel could not be read: the
       * incident form, as the command always opened - its own check asks
       * them to connect, or tells them why.
       */
      logger.debug(
        "Could not tell whether a Microsoft Teams command came from an incident's channel.",
        { projectId: data.projectId.toString() },
      );
      logger.debug(err);
      return false;
    }

    await MicrosoftTeamsIncidentMoreActions.replyWithCard({
      turnContext: data.turnContext,
      projectId: data.projectId,
      incidentId: incidentId,
      props: props,
      isAskedInItsChannel: true,
    });

    return true;
  }

  // Change Severity

  private static readonly SEVERITY_CHECK: WorkspaceIncidentFormCheck = {
    kind: "update",
    data: { incidentSeverityId: ObjectID.generate() },
    action: "change the severity of this incident",
  };

  private static async sendSeverityCard(data: {
    actionValue: string;
    projectId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const incident: WorkspaceIncidentForForm =
      await MicrosoftTeamsIncidentMoreActions.authorize({
        actionValue: data.actionValue,
        props: data.databaseProps,
        check: MicrosoftTeamsIncidentMoreActions.SEVERITY_CHECK,
      });

    const [choices, currentId]: [
      Array<WorkspaceIncidentChoice>,
      ObjectID | null,
    ] = await Promise.all([
      WorkspaceIncidentActions.getSeverityChoices({
        projectId: data.projectId,
        props: data.databaseProps,
      }),
      WorkspaceIncidentActions.getSeverityId({
        event: incident.event,
        props: data.databaseProps,
      }),
    ]);

    if (choices.length === 0) {
      throw new NotAuthorizedException(
        WorkspaceIncidentActions.getNoSeveritiesMessage(),
      );
    }

    await MicrosoftTeamsIncidentMoreActions.sendCard({
      turnContext: data.turnContext,
      summary: WORKSPACE_INCIDENT_FORM_TEXT.severityTitle,
      buildCard: (): JSONObject => {
        return MicrosoftTeamsIncidentMoreActions.buildSeverityCard({
          incident: incident,
          choices: choices,
          currentId: currentId,
        });
      },
    });
  }

  public static buildSeverityCard(data: {
    incident: WorkspaceIncidentForForm;
    choices: Array<WorkspaceIncidentChoice>;
    currentId: ObjectID | null;
  }): JSONObject {
    const choices: Array<MicrosoftTeamsCardChoice> =
      MicrosoftTeamsCardChoices.toChoices(
        data.choices.map((choice: WorkspaceIncidentChoice) => {
          return { _id: choice.id.toString(), name: choice.name };
        }),
      );

    const current: string | undefined = data.currentId
      ? choices.find((choice: MicrosoftTeamsCardChoice): boolean => {
          return (
            choice.value.toLowerCase() ===
            data.currentId!.toString().toLowerCase()
          );
        })?.value
      : undefined;

    return MicrosoftTeamsIncidentMoreActions.form({
      title: WORKSPACE_INCIDENT_FORM_TEXT.severityTitle,
      incident: data.incident,
      body: [
        {
          type: "Input.ChoiceSet",
          id: MICROSOFT_TEAMS_SEVERITY_FIELD,
          label: WORKSPACE_INCIDENT_FORM_TEXT.severityLabel,
          placeholder: WORKSPACE_INCIDENT_FORM_TEXT.severityPlaceholder,
          style: "compact",
          isRequired: true,
          errorMessage: "Pick a severity.",
          choices: choices,
          ...(current ? { value: current } : {}),
        },
      ],
      submit: WORKSPACE_INCIDENT_FORM_TEXT.save,
      action: MicrosoftTeamsIncidentActionType.SubmitChangeIncidentSeverity,
    });
  }

  private static async submitSeverity(data: {
    actionValue: string;
    value: JSONObject;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const severityId: string = MicrosoftTeamsIncidentMoreActions.toText(
      data.value[MICROSOFT_TEAMS_SEVERITY_FIELD],
    );

    if (!ObjectID.isValidUUID(severityId)) {
      return await MicrosoftTeamsIncidentMoreActions.replyText(
        data.turnContext,
        "Pick a severity, then press Save again.",
      );
    }

    const incident: WorkspaceIncidentForForm =
      await MicrosoftTeamsIncidentMoreActions.authorize({
        actionValue: data.actionValue,
        props: data.databaseProps,
        check: MicrosoftTeamsIncidentMoreActions.SEVERITY_CHECK,
      });

    const result: { isChanged: boolean; severityName: string } =
      await WorkspaceIncidentActions.changeSeverity({
        event: incident.event,
        severityId: new ObjectID(severityId),
        props: data.databaseProps,
      });

    await MicrosoftTeamsIncidentMoreActions.confirm(
      data.turnContext,
      await WorkspaceIncidentActions.getSeverityAnswer({
        event: incident.event,
        severityName: result.severityName,
        isChanged: result.isChanged,
      }),
    );

    // Done: the card goes, so nobody submits it twice.
    await MicrosoftTeamsReplies.deleteBestEffort(
      data.turnContext,
      data.turnContext.activity.replyToId,
    );
  }

  // Assign Role

  private static readonly ROLE_CHECK: WorkspaceIncidentFormCheck = {
    kind: "create",
    modelType: IncidentMember,
    action: "assign a role on this incident",
  };

  private static async sendRoleCard(data: {
    actionValue: string;
    projectId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const incident: WorkspaceIncidentForForm =
      await MicrosoftTeamsIncidentMoreActions.authorize({
        actionValue: data.actionValue,
        props: data.databaseProps,
        check: MicrosoftTeamsIncidentMoreActions.ROLE_CHECK,
      });

    const form: WorkspaceIncidentRoleForm =
      await WorkspaceIncidentActions.getRoleForm({
        event: incident.event,
        props: data.databaseProps,
      });

    if (form.roles.length === 0) {
      throw new NotAuthorizedException(
        WorkspaceIncidentActions.getNoRolesMessage(),
      );
    }

    await MicrosoftTeamsIncidentMoreActions.sendCard({
      turnContext: data.turnContext,
      summary: WORKSPACE_INCIDENT_FORM_TEXT.roleTitle,
      buildCard: (budgetInBytes: number): JSONObject => {
        return MicrosoftTeamsIncidentMoreActions.buildRoleCard({
          incident: incident,
          form: form,
          userId: data.databaseProps.userId,
          budgetInBytes: budgetInBytes,
        });
      },
    });
  }

  public static buildRoleCard(data: {
    incident: WorkspaceIncidentForForm;
    form: WorkspaceIncidentRoleForm;
    userId: ObjectID | undefined;
    budgetInBytes: number;
  }): JSONObject {
    const roles: Array<MicrosoftTeamsCardChoice> =
      MicrosoftTeamsCardChoices.toChoices(
        data.form.roles.map((role: WorkspaceIncidentRoleChoice) => {
          return { _id: role.id.toString(), name: role.name };
        }),
      );

    const people: MicrosoftTeamsCardChoiceList = {
      choices: MicrosoftTeamsCardChoices.toChoices(
        data.form.people.map((person: WorkspaceIncidentPersonChoice) => {
          return { _id: person.userId.toString(), name: person.label };
        }),
      ),
      totalCount: data.form.people.length + data.form.notShownPeopleCount,
    };

    return MicrosoftTeamsCardChoices.fitCardToBudget<"people">({
      lists: { people: people },
      trimmableKeys: ["people"],
      budgetInBytes: data.budgetInBytes,
      buildCard: (
        shown: Record<"people", MicrosoftTeamsCardChoiceList>,
      ): JSONObject => {
        const you: string | undefined = data.userId
          ? shown.people.choices.find(
              (choice: MicrosoftTeamsCardChoice): boolean => {
                return (
                  choice.value.toLowerCase() ===
                  data.userId!.toString().toLowerCase()
                );
              },
            )?.value
          : undefined;

        const body: Array<JSONObject> = [];

        const holders: MarkdownText | null =
          WorkspaceIncidentActions.getHoldersMarkdown(data.form.holders);

        if (holders) {
          body.push(MicrosoftTeamsIncidentMoreActions.textBlock(holders));
        }

        body.push({
          type: "Input.ChoiceSet",
          id: MICROSOFT_TEAMS_ROLE_FIELD,
          label: WORKSPACE_INCIDENT_FORM_TEXT.roleLabel,
          placeholder: WORKSPACE_INCIDENT_FORM_TEXT.rolePlaceholder,
          style: "compact",
          isRequired: true,
          errorMessage: "Pick a role.",
          choices: roles,
          // The primary role - Incident Commander - first, and picked.
          ...(roles[0] ? { value: roles[0].value } : {}),
        });

        body.push({
          type: "Input.ChoiceSet",
          id: MICROSOFT_TEAMS_ROLE_PERSON_FIELD,
          label: WORKSPACE_INCIDENT_FORM_TEXT.personLabel,
          placeholder: WORKSPACE_INCIDENT_FORM_TEXT.personPlaceholder,
          style: "compact",
          isRequired: true,
          errorMessage: "Pick a person.",
          choices: shown.people.choices,
          // "I'll take it": the person it was sent to, picked.
          ...(you ? { value: you } : {}),
        });

        const hint: string = WorkspaceIncidentActions.getRoleHint(
          data.form.roles,
        );

        if (hint) {
          // Role names are text: Markdown in them does not act.
          body.push(
            MicrosoftTeamsCardChoices.buildNoteElement(
              mdText`${hint}`.toString(),
            ),
          );
        }

        const notShown: string | null =
          MicrosoftTeamsCardChoices.getNotShownNote({
            list: shown.people,
            pluralNoun: "people",
            addLaterHint: `Assign anyone else in ${ProductBrandingText.getProductName()}.`,
          });

        if (notShown) {
          body.push(MicrosoftTeamsCardChoices.buildNoteElement(notShown));
        }

        return MicrosoftTeamsIncidentMoreActions.form({
          title: WORKSPACE_INCIDENT_FORM_TEXT.roleTitle,
          incident: data.incident,
          body: body,
          submit: WORKSPACE_INCIDENT_FORM_TEXT.assign,
          action: MicrosoftTeamsIncidentActionType.SubmitAssignIncidentRole,
        });
      },
    }).card;
  }

  private static async submitRole(data: {
    actionValue: string;
    value: JSONObject;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const roleId: string = MicrosoftTeamsIncidentMoreActions.toText(
      data.value[MICROSOFT_TEAMS_ROLE_FIELD],
    );
    const userId: string = MicrosoftTeamsIncidentMoreActions.toText(
      data.value[MICROSOFT_TEAMS_ROLE_PERSON_FIELD],
    );

    if (!ObjectID.isValidUUID(roleId) || !ObjectID.isValidUUID(userId)) {
      return await MicrosoftTeamsIncidentMoreActions.replyText(
        data.turnContext,
        "Pick a role and a person, then press Assign again.",
      );
    }

    const incident: WorkspaceIncidentForForm =
      await MicrosoftTeamsIncidentMoreActions.authorize({
        actionValue: data.actionValue,
        props: data.databaseProps,
        check: MicrosoftTeamsIncidentMoreActions.ROLE_CHECK,
      });

    const assignment: WorkspaceRoleAssignment =
      await WorkspaceIncidentActions.assignRole({
        event: incident.event,
        roleId: new ObjectID(roleId),
        userId: new ObjectID(userId),
        props: data.databaseProps,
      });

    await MicrosoftTeamsIncidentMoreActions.confirm(
      data.turnContext,
      await WorkspaceIncidentActions.getRoleAnswer({
        event: incident.event,
        assignment: assignment,
      }),
    );

    // Done: the card goes, so nobody submits it twice.
    await MicrosoftTeamsReplies.deleteBestEffort(
      data.turnContext,
      data.turnContext.activity.replyToId,
    );
  }

  // Page Someone

  private static readonly PAGE_CHECK: WorkspaceIncidentFormCheck = {
    kind: "create",
    modelType: OnCallDutyPolicyExecutionLog,
    action: "page someone about this incident",
  };

  private static async sendPageCard(data: {
    actionValue: string;
    projectId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const incident: WorkspaceIncidentForForm =
      await MicrosoftTeamsIncidentMoreActions.authorize({
        actionValue: data.actionValue,
        props: data.databaseProps,
        check: MicrosoftTeamsIncidentMoreActions.PAGE_CHECK,
      });

    // Resolved already: nobody is paged, and they are told who resolved it.
    if ((await WorkspaceMemberActions.getStanding(incident.event)).isResolved) {
      await MicrosoftTeamsActionAnswer.replyAlready({
        turnContext: data.turnContext,
        event: incident.event,
        press: WorkspaceLatePress.Page,
      });
      return;
    }

    const choices: Array<WorkspacePageChoiceGroup> =
      await WorkspacePage.getChoices({
        projectId: data.projectId,
        props: data.databaseProps,
      });

    if (choices.length === 0) {
      throw new NotAuthorizedException(
        "There is nobody you can page in this project yet: no on-call schedules, people, teams or on-call policies are available to you.",
      );
    }

    await MicrosoftTeamsIncidentMoreActions.sendCard({
      turnContext: data.turnContext,
      summary: WORKSPACE_INCIDENT_FORM_TEXT.pageTitle,
      buildCard: (budgetInBytes: number): JSONObject => {
        return MicrosoftTeamsIncidentMoreActions.buildPageCard({
          incident: incident,
          choices: choices,
          budgetInBytes: budgetInBytes,
        });
      },
    });
  }

  public static buildPageCard(data: {
    incident: WorkspaceIncidentForForm;
    choices: Array<WorkspacePageChoiceGroup>;
    budgetInBytes: number;
  }): JSONObject {
    const lists: Record<string, MicrosoftTeamsCardChoiceList> = {};
    const keys: Array<string> = [];

    for (const group of data.choices) {
      keys.push(group.kind);
      lists[group.kind] = {
        choices: group.choices.map(
          (choice: WorkspacePageChoice): MicrosoftTeamsCardChoice => {
            return {
              title: `${PAGE_CHOICE_PREFIXES[group.kind]} · ${choice.label}`,
              value: choice.value,
            };
          },
        ),
        totalCount: group.choices.length + (group.notShownCount || 0),
      };
    }

    return MicrosoftTeamsCardChoices.fitCardToBudget<string>({
      lists: lists,
      trimmableKeys: keys,
      budgetInBytes: data.budgetInBytes,
      buildCard: (
        shown: Record<string, MicrosoftTeamsCardChoiceList>,
      ): JSONObject => {
        const body: Array<JSONObject> = [
          {
            type: "Input.ChoiceSet",
            id: MICROSOFT_TEAMS_PAGE_FIELD,
            label: WORKSPACE_PAGE_FORM_TEXT.whoLabel,
            placeholder: WORKSPACE_PAGE_FORM_TEXT.whoPlaceholder,
            style: "compact",
            isMultiSelect: true,
            isRequired: true,
            errorMessage: WORKSPACE_PAGE_FORM_TEXT.pickWho,
            choices: keys.flatMap(
              (key: string): Array<MicrosoftTeamsCardChoice> => {
                return shown[key]?.choices || [];
              },
            ),
          },
          MicrosoftTeamsCardChoices.buildNoteElement(
            WORKSPACE_INCIDENT_FORM_TEXT.pageHint,
          ),
        ];

        /*
         * What the list leaves out is said under the list itself; the
         * page's own message follows (pushed below), optional - the
         * incident says what the page is about.
         */
        const message: Array<JSONObject> = [
          {
            type: "Input.Text",
            id: MICROSOFT_TEAMS_PAGE_ABOUT_INCIDENT_MESSAGE_FIELD,
            label: WORKSPACE_PAGE_FORM_TEXT.messageLabel,
            placeholder: WORKSPACE_PAGE_FORM_TEXT.messagePlaceholder,
            isMultiline: true,
            maxLength: ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH,
          },
          MicrosoftTeamsCardChoices.buildNoteElement(
            WORKSPACE_INCIDENT_FORM_TEXT.pageMessageHint,
          ),
        ];

        const leftOut: number = keys.reduce(
          (count: number, key: string): number => {
            return (
              count +
              (lists[key]!.totalCount - (shown[key]?.choices.length || 0))
            );
          },
          0,
        );

        if (leftOut > 0) {
          body.push(
            MicrosoftTeamsCardChoices.buildNoteElement(
              `${leftOut} more ${leftOut === 1 ? "choice" : "choices"} could not fit on this card: page their team or on-call schedule instead.`,
            ),
          );
        }

        body.push(...message);

        return MicrosoftTeamsIncidentMoreActions.form({
          title: WORKSPACE_INCIDENT_FORM_TEXT.pageTitle,
          incident: data.incident,
          body: body,
          submit: WORKSPACE_INCIDENT_FORM_TEXT.page,
          action: MicrosoftTeamsIncidentActionType.SubmitPageAboutIncident,
        });
      },
    }).card;
  }

  private static async submitPage(data: {
    actionValue: string;
    value: JSONObject;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const picked: Array<string> = MicrosoftTeamsIncidentMoreActions.toList(
      data.value[MICROSOFT_TEAMS_PAGE_FIELD],
    );
    // Optional, and on cards sent before it was asked: none.
    const message: string =
      typeof data.value[MICROSOFT_TEAMS_PAGE_ABOUT_INCIDENT_MESSAGE_FIELD] ===
      "string"
        ? (data.value[
            MICROSOFT_TEAMS_PAGE_ABOUT_INCIDENT_MESSAGE_FIELD
          ] as string)
        : "";

    const problem: string | null =
      WorkspaceIncidentActions.getPageProblem(picked);

    // Said in the conversation, so with what to do next, as the others are.
    if (problem) {
      return await MicrosoftTeamsIncidentMoreActions.replyText(
        data.turnContext,
        MicrosoftTeamsIncidentMoreActions.thenPressAgain(
          problem,
          WORKSPACE_INCIDENT_FORM_TEXT.page,
        ),
      );
    }

    const incident: WorkspaceIncidentForForm =
      await MicrosoftTeamsIncidentMoreActions.authorize({
        actionValue: data.actionValue,
        props: data.databaseProps,
        check: MicrosoftTeamsIncidentMoreActions.PAGE_CHECK,
      });

    if ((await WorkspaceMemberActions.getStanding(incident.event)).isResolved) {
      await MicrosoftTeamsActionAnswer.replyAlready({
        turnContext: data.turnContext,
        event: incident.event,
        press: WorkspaceLatePress.Page,
      });
      return;
    }

    const result: OnCallPageResult = await WorkspaceIncidentActions.page({
      event: incident.event,
      targets: WorkspacePage.readTargets(picked),
      props: data.databaseProps,
      // The page's own message, when they wrote one.
      ...(message.trim() ? { message: message } : {}),
    });

    await MicrosoftTeamsIncidentMoreActions.confirm(
      data.turnContext,
      WorkspaceIncidentActions.getPagedAnswer(result, message),
    );

    // Paged: the card goes, so nobody pages with it twice.
    await MicrosoftTeamsReplies.deleteBestEffort(
      data.turnContext,
      data.turnContext.activity.replyToId,
    );
  }

  // Edit Custom Fields

  private static readonly CUSTOM_FIELDS_CHECK: WorkspaceIncidentFormCheck = {
    kind: "update",
    data: { customFields: {} },
    action: "edit the custom fields of this incident",
  };

  private static async sendCustomFieldsCard(data: {
    actionValue: string;
    projectId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const incident: WorkspaceIncidentForForm =
      await MicrosoftTeamsIncidentMoreActions.authorize({
        actionValue: data.actionValue,
        props: data.databaseProps,
        check: MicrosoftTeamsIncidentMoreActions.CUSTOM_FIELDS_CHECK,
      });

    const form: WorkspaceCustomFieldsForm =
      await MicrosoftTeamsIncidentMoreActions.readCustomFieldsForm({
        incident: incident,
        props: data.databaseProps,
      });

    if (form.inputs.length === 0) {
      throw new NotAuthorizedException(
        WorkspaceIncidentActions.getNothingToEditCustomFieldsMessage({
          form: form,
        }),
      );
    }

    const timezone: MicrosoftTeamsUserTimezone = MicrosoftTeamsTimezone.resolve(
      {
        activity: data.turnContext.activity as unknown as JSONObject,
      },
    );

    await MicrosoftTeamsIncidentMoreActions.sendCard({
      turnContext: data.turnContext,
      summary: WORKSPACE_INCIDENT_FORM_TEXT.customFieldsTitle,
      buildCard: (): JSONObject => {
        return MicrosoftTeamsIncidentMoreActions.buildCustomFieldsCard({
          incident: incident,
          form: form,
          timezone: timezone,
        });
      },
    });
  }

  public static buildCustomFieldsCard(data: {
    incident: WorkspaceIncidentForForm;
    form: WorkspaceCustomFieldsForm;
    timezone: MicrosoftTeamsUserTimezone;
  }): JSONObject {
    const body: Array<JSONObject> = [];

    for (const input of data.form.inputs) {
      body.push(
        ...MicrosoftTeamsIncidentMoreActions.getCustomFieldElements({
          input: input,
          timezone: data.timezone,
        }),
      );
    }

    // The note under the fields: what an emptied field does, what is left off.
    body.push(
      MicrosoftTeamsCardChoices.buildNoteElement(
        WorkspaceIncidentActions.getCustomFieldsNote({
          form: data.form,
        }).toString(),
      ),
    );

    return MicrosoftTeamsIncidentMoreActions.form({
      title: WORKSPACE_INCIDENT_FORM_TEXT.customFieldsTitle,
      incident: data.incident,
      body: body,
      submit: WORKSPACE_INCIDENT_FORM_TEXT.save,
      action: MicrosoftTeamsIncidentActionType.SubmitEditIncidentCustomFields,
      // The submit reads a time in the zone the card showed it in.
      extraData: data.timezone.timezone
        ? { timezone: data.timezone.timezone }
        : {},
    });
  }

  private static async submitCustomFields(data: {
    actionValue: string;
    value: JSONObject;
    projectId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const incident: WorkspaceIncidentForForm =
      await MicrosoftTeamsIncidentMoreActions.authorize({
        actionValue: data.actionValue,
        props: data.databaseProps,
        check: MicrosoftTeamsIncidentMoreActions.CUSTOM_FIELDS_CHECK,
      });

    const definitions: Array<WorkspaceCustomFieldDefinition> =
      await WorkspaceIncidentCustomFields.readDefinitions({
        projectId: data.projectId,
        props: data.databaseProps,
      });

    const values: { stored: JSONObject; monitorCount: number } | null =
      await WorkspaceIncidentCustomFields.readIncidentValues({
        incidentId: incident.event.id,
        projectId: data.projectId,
        props: data.databaseProps,
      });

    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: definitions,
        stored: values?.stored || {},
        monitorCount: values?.monitorCount || 0,
      });

    const timezone: MicrosoftTeamsUserTimezone = MicrosoftTeamsTimezone.resolve(
      {
        activity: data.turnContext.activity as unknown as JSONObject,
        timezoneFromCard: data.value["timezone"],
      },
    );

    const submission: WorkspaceCustomFieldsSubmission =
      WorkspaceIncidentCustomFields.readSubmission({
        inputs: form.inputs,
        definitions: definitions,
        stored: values?.stored || {},
        submitted: MicrosoftTeamsIncidentMoreActions.getSubmittedCustomFields({
          value: data.value,
          inputs: form.inputs,
          timezone: timezone,
        }),
      });

    // A value that does not fit its field: said, and the card stays.
    const problems: Array<MarkdownText> = [];

    for (const input of form.inputs) {
      const problem: string | undefined = submission.problems[input.inputId];

      if (problem) {
        problems.push(mdText`**${input.name}**: ${problem}`);
      }
    }

    if (problems.length > 0) {
      await MicrosoftTeamsActionAnswer.reply({
        turnContext: data.turnContext,
        answer: {
          markdown:
            mdText`Nothing was saved. Fix these, then press Save again:\n\n${FeedMarkdown.bulletList(
              problems,
            )}`.toString(),
          text: "Nothing was saved: some fields need fixing",
        },
      });
      return;
    }

    const changedNames: Array<string> = submission.changes.map(
      (change: { name: string; value: unknown }): string => {
        return change.name;
      },
    );

    if (changedNames.length > 0) {
      await WorkspaceIncidentCustomFields.save({
        incidentId: incident.event.id,
        projectId: data.projectId,
        changes: submission.changes,
        props: data.databaseProps,
      });
    }

    await MicrosoftTeamsIncidentMoreActions.confirm(
      data.turnContext,
      await WorkspaceIncidentActions.getCustomFieldsAnswer({
        event: incident.event,
        changedNames: changedNames,
      }),
    );

    // Saved: the card goes, so nobody submits it twice.
    await MicrosoftTeamsReplies.deleteBestEffort(
      data.turnContext,
      data.turnContext.activity.replyToId,
    );
  }

  /*
   * One custom field's inputs on a card: its name as the label, its
   * description under it, what the incident holds as it opens. A Date and
   * time field is two inputs - its day, and its time in the person's zone.
   */
  public static getCustomFieldElements(data: {
    input: WorkspaceCustomFieldInput;
    timezone: MicrosoftTeamsUserTimezone;
  }): Array<JSONObject> {
    const { input } = data;
    const elements: Array<JSONObject> = [];

    switch (input.kind) {
      case WorkspaceCustomFieldInputKind.Text:
      case WorkspaceCustomFieldInputKind.LongText:
        elements.push({
          type: "Input.Text",
          id: input.inputId,
          label: input.name,
          isMultiline: input.kind === WorkspaceCustomFieldInputKind.LongText,
          maxLength: MAX_TEXT_INPUT_LENGTH,
          ...(input.initialText
            ? {
                value: input.initialText.substring(0, MAX_TEXT_INPUT_LENGTH),
              }
            : {}),
        });
        break;
      case WorkspaceCustomFieldInputKind.Number:
        elements.push({
          type: "Input.Number",
          id: input.inputId,
          label: input.name,
          ...(input.initialText ? { value: Number(input.initialText) } : {}),
        });
        break;
      case WorkspaceCustomFieldInputKind.YesNo:
      case WorkspaceCustomFieldInputKind.Dropdown:
      case WorkspaceCustomFieldInputKind.MultiSelect:
        elements.push({
          type: "Input.ChoiceSet",
          id: input.inputId,
          label: input.name,
          style: "compact",
          isMultiSelect:
            input.kind === WorkspaceCustomFieldInputKind.MultiSelect,
          choices: input.options.map(
            (option: { value: string; label: string }) => {
              return { title: option.label, value: option.value };
            },
          ),
          ...(input.initialOption ? { value: input.initialOption } : {}),
          ...(input.initialOptions.length > 0
            ? { value: input.initialOptions.join(",") }
            : {}),
        });
        break;
      case WorkspaceCustomFieldInputKind.Date:
        elements.push({
          type: "Input.Date",
          id: input.inputId,
          label: input.name,
          ...(input.initialDate ? { value: input.initialDate } : {}),
        });
        break;
      case WorkspaceCustomFieldInputKind.DateTime: {
        const zoned: moment.Moment | null = input.initialDateTime
          ? data.timezone.timezone
            ? moment(input.initialDateTime).tz(data.timezone.timezone)
            : moment(input.initialDateTime).utcOffset(
                data.timezone.utcOffsetInMinutes || 0,
              )
          : null;

        elements.push({
          type: "Input.Date",
          id: `${input.inputId}${DATE_SUFFIX}`,
          label: input.name,
          ...(zoned ? { value: zoned.format("YYYY-MM-DD") } : {}),
        });
        /*
         * The time says the zone it is read in, where it is typed: Teams'
         * time input has none of its own.
         */
        elements.push({
          type: "Input.Time",
          id: `${input.inputId}${TIME_SUFFIX}`,
          label: `Time in ${data.timezone.label}`,
          ...(zoned ? { value: zoned.format("HH:mm") } : {}),
        });
        break;
      }
    }

    if (input.description) {
      elements.push(
        MicrosoftTeamsCardChoices.buildNoteElement(
          mdText`${input.description}`.toString(),
        ),
      );
    }

    return elements;
  }

  // Shared

  /*
   * The incident, with its buttons and menu - the blocks of its message,
   * drawn as a card - in the conversation the command was typed in.
   */
  private static async replyWithCard(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
    incidentId: ObjectID;
    props: DatabaseCommonInteractionProps;
    isAskedInItsChannel: boolean;
  }): Promise<void> {
    const card: WorkspaceIncidentCard | null =
      await WorkspaceIncidentActions.getCard({
        incidentId: data.incidentId,
        projectId: data.projectId,
        props: data.props,
        workspaceType: WorkspaceType.MicrosoftTeams,
        actions: SLACK_INCIDENT_ACTION_IDS,
        isAskedInItsChannel: data.isAskedInItsChannel,
      });

    if (!card) {
      return;
    }

    await MicrosoftTeamsReplies.sendBestEffort(data.turnContext, {
      attachments: [
        {
          contentType: MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
          content: MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
            messageBlocks: card.messageBlocks,
          }),
        },
      ],
      summary: card.text,
    });
  }

  /*
   * May the person who pressed do what a card does to the incident - and
   * the incident as they read it. A refusal is thrown, worded for them.
   */
  private static async authorize(data: {
    actionValue: string;
    props: DatabaseCommonInteractionProps;
    check: WorkspaceIncidentFormCheck;
  }): Promise<WorkspaceIncidentForForm> {
    if (!data.actionValue || !ObjectID.isValidUUID(data.actionValue)) {
      throw new NotAuthorizedException(
        `Could not ${data.check.action}: ${WorkspaceActionAuthorization.getNotFoundReason("incident")}`,
      );
    }

    return await WorkspaceIncidentActions.authorizeForForm({
      incidentId: new ObjectID(data.actionValue),
      props: data.props,
      check: data.check,
    });
  }

  /*
   * A form card: its title, the incident it is about, its fields, and the
   * one button that submits it, carrying the incident's id.
   */
  private static form(data: {
    title: string;
    incident: WorkspaceIncidentForForm;
    body: Array<JSONObject>;
    submit: string;
    action: string;
    extraData?: JSONObject | undefined;
  }): JSONObject {
    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: data.title,
          size: "Large",
          weight: "Bolder",
          wrap: true,
        },
        MicrosoftTeamsIncidentMoreActions.textBlock(
          WorkspaceIncidentActions.getFormHeading(data.incident),
        ),
        ...data.body,
      ],
      actions: [
        {
          type: "Action.Submit",
          title: data.submit,
          style: "positive",
          data: {
            action: data.action,
            actionValue: data.incident.event.id.toString(),
            ...(data.extraData || {}),
          },
        },
      ],
    };
  }

  // A card, fitted to what Teams takes, as a reply.
  private static async sendCard(data: {
    turnContext: TurnContext;
    summary: string;
    buildCard: (budgetInBytes: number) => JSONObject;
  }): Promise<void> {
    await MicrosoftTeamsReplies.sendCardWithinSizeLimit({
      turnContext: data.turnContext,
      buildCard: data.buildCard,
      summary: data.summary,
    });
  }

  /*
   * What a submitted card did, said in the conversation, mentioning who did
   * it: anyone in a channel may submit a card, and Teams has no message only
   * they see (MicrosoftTeamsActionAnswer). Its summary is what a
   * notification shows. Best-effort: the action is done, and a reply Teams
   * refuses must not read as a failed action, which invites a repeat.
   */
  private static async confirm(
    turnContext: TurnContext,
    answer: WorkspaceAnswer,
  ): Promise<void> {
    await MicrosoftTeamsActionAnswer.reply({
      turnContext: turnContext,
      answer: answer,
    });
  }

  /*
   * A field's problem, and what to do next: "Pick who to page, then press
   * Page again." Slack says the problem under the field instead.
   */
  private static thenPressAgain(problem: string, button: string): string {
    const sentence: string = problem.endsWith(".")
      ? problem.substring(0, problem.length - 1)
      : problem;

    return `${sentence}, then press ${button} again.`;
  }

  // A card's field left wrong: said, mentioning them; the card stays.
  private static async replyText(
    turnContext: TurnContext,
    message: string,
  ): Promise<void> {
    await MicrosoftTeamsActionAnswer.reply({
      turnContext: turnContext,
      answer: {
        markdown: mdText`${message}`.toString(),
        text: message,
      },
    });
  }

  // A card's text block of Markdown, wrapped.
  private static textBlock(markdown: MarkdownText): JSONObject {
    return {
      type: "TextBlock",
      text: MicrosoftTeamsMessageSize.fitMarkdownText(markdown.toString()),
      wrap: true,
    };
  }

  // The values a submitted custom fields card holds, by input id.
  private static getSubmittedCustomFields(data: {
    value: JSONObject;
    inputs: Array<WorkspaceCustomFieldInput>;
    timezone: MicrosoftTeamsUserTimezone;
  }): Record<string, WorkspaceCustomFieldSubmittedValue> {
    const submitted: Record<string, WorkspaceCustomFieldSubmittedValue> = {};

    for (const input of data.inputs) {
      if (input.kind === WorkspaceCustomFieldInputKind.DateTime) {
        const dateKey: string = `${input.inputId}${DATE_SUFFIX}`;
        const timeKey: string = `${input.inputId}${TIME_SUFFIX}`;

        if (
          !Object.prototype.hasOwnProperty.call(data.value, dateKey) &&
          !Object.prototype.hasOwnProperty.call(data.value, timeKey)
        ) {
          continue;
        }

        const date: string = MicrosoftTeamsIncidentMoreActions.toText(
          data.value[dateKey],
        );
        const time: string = MicrosoftTeamsIncidentMoreActions.toText(
          data.value[timeKey],
        );

        if (!date && !time) {
          submitted[input.inputId] = null;
          continue;
        }

        // A day with no time, or a time with no day: asked again.
        submitted[input.inputId] =
          MicrosoftTeamsTimezone.toDate({
            date: date,
            time: time || "00:00",
            timezone: data.timezone,
          }) || "not a time";
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(data.value, input.inputId)) {
        continue;
      }

      const raw: JSONValue | undefined = data.value[input.inputId];

      submitted[input.inputId] =
        typeof raw === "number" || typeof raw === "boolean"
          ? raw
          : MicrosoftTeamsIncidentMoreActions.toText(raw);
    }

    return submitted;
  }

  // The form, as the incident and the project's fields read now.
  private static async readCustomFieldsForm(data: {
    incident: WorkspaceIncidentForForm;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceCustomFieldsForm> {
    const definitions: Array<WorkspaceCustomFieldDefinition> =
      await WorkspaceIncidentCustomFields.readDefinitions({
        projectId: data.incident.event.projectId,
        props: data.props,
      });

    const values: { stored: JSONObject; monitorCount: number } | null =
      await WorkspaceIncidentCustomFields.readIncidentValues({
        incidentId: data.incident.event.id,
        projectId: data.incident.event.projectId,
        props: data.props,
      });

    return WorkspaceIncidentCustomFields.buildForm({
      definitions: definitions,
      stored: values?.stored || {},
      monitorCount: values?.monitorCount || 0,
    });
  }

  /*
   * The sender's props, when OneUptime can act as them: a connected account
   * of a current member. Thrown otherwise; nothing is answered here.
   */
  private static async getSenderProps(data: {
    activity: JSONObject;
    projectId: ObjectID;
  }): Promise<DatabaseCommonInteractionProps> {
    const teamsUserId: string =
      ((data.activity["from"] as JSONObject | undefined)?.["aadObjectId"] as
        | string
        | undefined) || "";

    if (!teamsUserId) {
      throw new NotAuthorizedException("The sender is not known.");
    }

    const userId: ObjectID =
      await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
        teamsUserId: teamsUserId,
        projectId: data.projectId,
      });

    return await WorkspaceActionAuthorization.getProjectMemberProps({
      userId: userId,
      projectId: data.projectId,
    });
  }

  // The Teams channel a message was typed in; "" for a chat.
  private static getChannelId(activity: JSONObject): string {
    const channel: JSONObject | undefined = (
      activity["channelData"] as JSONObject | undefined
    )?.["channel"] as JSONObject | undefined;

    return typeof channel?.["id"] === "string" ? (channel["id"] as string) : "";
  }

  // A card's value as text.
  private static toText(value: JSONValue | undefined): string {
    if (typeof value === "string") {
      return value.trim();
    }

    if (typeof value === "number") {
      return String(value);
    }

    return "";
  }

  // A multi-select's picks: Teams sends them joined with commas.
  private static toList(value: JSONValue | undefined): Array<string> {
    return MicrosoftTeamsIncidentMoreActions.toText(value)
      .split(",")
      .map((item: string): string => {
        return item.trim();
      })
      .filter((item: string): boolean => {
        return item.length > 0;
      });
  }
}
