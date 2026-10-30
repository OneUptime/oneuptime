import IncidentMember from "../../../../../Models/DatabaseModels/IncidentMember";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH } from "../../../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import {
  WorkspaceDatePickerBlock,
  WorkspaceDateTimePickerBlock,
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspaceNumberInputBlock,
  WorkspacePayloadContext,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
  WorkspaceTextBoxBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import { OnCallPageResult } from "../../../../Services/OnCallPageService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import logger from "../../../Logger";
import ProductBrandingText from "../../../ProductBrandingText";
import Response from "../../../Response";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
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
} from "../../WorkspacePage";
import { SLACK_INCIDENT_ACTION_IDS } from "../Messages/Incident";
import SlackActionType from "./ActionTypes";
import SlackActionAnswer, { SlackAnswerPlace } from "./Answer";
import { SlackAction, SlackRequest } from "./Auth";
import SlackActionAuthorization, {
  SlackActionRequester,
} from "./Authorization";

/*
 * AN INCIDENT'S MENU (⋯) IN SLACK, AND THE INCIDENT A COMMAND SHOWS.
 *
 * The forms of the menu on an incident's message (WorkspaceIncidentActions)
 * - Change Severity, Assign Role, Page Someone, Edit Custom Fields; Change
 * Incident State is the form it always had (SlackIncidentActions) - and
 * `/oneuptime incident 42`, which answers with the incident and its buttons,
 * only to the person who ran it.
 *
 * Each form opens as the member the Slack account is connected to: someone
 * who may not do what it does is told so where they pressed, and no form
 * opens. A form's submission is checked at once - a field left wrong is
 * answered under it, and the form stays open - then the form closes and the
 * change is made, as the member. The incident's feed, and through it the
 * incident's channels, tell of the change as of one made in OneUptime. So
 * the person is answered only where that is not where they are - a press on
 * the incident a command showed, which only they see - and when nothing
 * changed, or a page went out (who was paged, or why nobody was).
 */

// The forms' fields: Slack's block and action ids.
export const SEVERITY_FIELD: string = "incidentSeverity";
export const ROLE_FIELD: string = "incidentRole";
export const ROLE_PERSON_FIELD: string = "incidentRolePerson";
export const PAGE_ABOUT_INCIDENT_FIELD: string = "incidentPageTargets";
export const PAGE_ABOUT_INCIDENT_MESSAGE_FIELD: string = "incidentPageMessage";

// The longest a Slack text input takes.
const MAX_TEXT_INPUT_LENGTH: number = 3000;

export default class SlackIncidentMoreActions {
  public static isAction(actionType: SlackActionType | undefined): boolean {
    switch (actionType) {
      case SlackActionType.ViewChangeIncidentSeverity:
      case SlackActionType.SubmitChangeIncidentSeverity:
      case SlackActionType.ViewAssignIncidentRole:
      case SlackActionType.SubmitAssignIncidentRole:
      case SlackActionType.ViewPageAboutIncident:
      case SlackActionType.SubmitPageAboutIncident:
      case SlackActionType.ViewEditIncidentCustomFields:
      case SlackActionType.SubmitEditIncidentCustomFields:
      case SlackActionType.ShowIncident:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async handle(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    switch (data.action.actionType) {
      case SlackActionType.ShowIncident:
        return await SlackIncidentMoreActions.showIncidentByNumber(data);
      case SlackActionType.ViewChangeIncidentSeverity:
        return await SlackIncidentMoreActions.viewChangeSeverity(data);
      case SlackActionType.SubmitChangeIncidentSeverity:
        return await SlackIncidentMoreActions.submitChangeSeverity(data);
      case SlackActionType.ViewAssignIncidentRole:
        return await SlackIncidentMoreActions.viewAssignRole(data);
      case SlackActionType.SubmitAssignIncidentRole:
        return await SlackIncidentMoreActions.submitAssignRole(data);
      case SlackActionType.ViewPageAboutIncident:
        return await SlackIncidentMoreActions.viewPage(data);
      case SlackActionType.SubmitPageAboutIncident:
        return await SlackIncidentMoreActions.submitPage(data);
      case SlackActionType.ViewEditIncidentCustomFields:
        return await SlackIncidentMoreActions.viewEditCustomFields(data);
      case SlackActionType.SubmitEditIncidentCustomFields:
        return await SlackIncidentMoreActions.submitEditCustomFields(data);
      default:
        return Response.sendErrorResponse(
          data.req,
          data.res,
          new BadDataException("Invalid Action Type"),
        );
    }
  }

  /*
   * `/oneuptime incident 42` - or #42, INC-42: the incident of that number,
   * with its buttons and menu, only to the person who ran it. A word that
   * only looked like a number ("IPv6") is a title: the incident form opens
   * with it, as the command always did (`declare`).
   */
  @CaptureSpan()
  public static async showIncidentByNumber(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
    declare?: (() => Promise<void>) | undefined;
  }): Promise<void> {
    const word: WorkspaceIncidentNumberWord | null =
      WorkspaceIncidentActions.readNumberWord(data.action.actionValue);

    // Slack's three seconds: answered as soon as what to do is known.
    const answerSlack: () => void = (): void => {
      if (!data.res.headersSent) {
        Response.sendTextResponse(data.req, data.res, "");
      }
    };

    const found: {
      props: DatabaseCommonInteractionProps;
      incidentId: ObjectID | null;
    } | null = await SlackIncidentMoreActions.refuseInPlace({
      requester: data.slackRequest,
      action: "see this incident",
      run: async (
        props: DatabaseCommonInteractionProps,
      ): Promise<{
        props: DatabaseCommonInteractionProps;
        incidentId: ObjectID | null;
      }> => {
        return {
          props: props,
          incidentId: word
            ? await WorkspaceIncidentActions.findByNumber({
                projectId: data.slackRequest.projectId!,
                word: word,
                props: props,
              })
            : null,
        };
      },
      beforeRefusal: answerSlack,
    });

    if (!found) {
      return;
    }

    if (found.incidentId) {
      answerSlack();

      await SlackIncidentMoreActions.answerWithCard({
        slackRequest: data.slackRequest,
        props: found.props,
        incidentId: found.incidentId,
        isAskedInItsChannel: false,
      });
      return;
    }

    // "INC" and digits that are no incident's number: a title after all.
    if (word && !word.isPlainNumber && data.declare) {
      return await data.declare();
    }

    answerSlack();

    await SlackIncidentMoreActions.sendAnswer({
      slackRequest: data.slackRequest,
      answer: WorkspaceIncidentActions.getNotFoundAnswer({
        word: word?.word || data.action.actionValue || "",
        workspaceType: WorkspaceType.Slack,
      }),
    });
  }

  /*
   * `/oneuptime incident`, with nothing after it, typed in an incident's own
   * channel: that incident, as a number shows it, and how to declare another
   * instead. False - nothing answered - in any other channel, or for a
   * channel's incident the member may not read: the command opens the
   * incident form there, as it always did. Answers Slack first when it
   * answers at all.
   */
  @CaptureSpan()
  public static async showIncidentOfChannel(data: {
    slackRequest: SlackRequest;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<boolean> {
    const { slackRequest } = data;

    if (
      !slackRequest.slackChannelId ||
      !slackRequest.userId ||
      !slackRequest.projectId
    ) {
      return false;
    }

    let props: DatabaseCommonInteractionProps;
    let incidentId: ObjectID | null;

    try {
      incidentId = await WorkspaceIncidentActions.findChannelOwner({
        projectId: slackRequest.projectId,
        channelId: slackRequest.slackChannelId,
      });

      if (!incidentId) {
        return false;
      }

      props = await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: slackRequest.userId,
        projectId: slackRequest.projectId,
      });

      if (
        !(await WorkspaceIncidentActions.isReadable({
          projectId: slackRequest.projectId,
          incidentId: incidentId,
          props: props,
        }))
      ) {
        return false;
      }
    } catch (err) {
      /*
       * Not a member, or the channel could not be read: the incident form,
       * as the command always opened - its own check tells them why.
       */
      logger.debug(
        "Could not tell whether a Slack command came from an incident's channel.",
        { projectId: slackRequest.projectId.toString() },
      );
      logger.debug(err);
      return false;
    }

    Response.sendTextResponse(data.req, data.res, "");

    await SlackIncidentMoreActions.answerWithCard({
      slackRequest: slackRequest,
      props: props,
      incidentId: incidentId,
      isAskedInItsChannel: true,
    });

    return true;
  }

  /*
   * After a button on a message only its presser sees did what it does -
   * Acknowledge on the incident a command showed - what it did: nobody else
   * sees that message, and the incident's channels may be elsewhere. A press
   * on a channel's message is answered by the post that tells the channel.
   */
  @CaptureSpan()
  public static async answerDoneIfPrivate(data: {
    slackRequest: SlackRequest;
    answer: () => Promise<WorkspaceAnswer>;
  }): Promise<void> {
    if (!data.slackRequest.isFromPrivateMessage) {
      return;
    }

    try {
      await SlackIncidentMoreActions.sendAnswer({
        slackRequest: data.slackRequest,
        answer: await data.answer(),
      });
    } catch (err) {
      // What it did stands, answered or not.
      logger.debug("Could not tell a Slack user what their press did.");
      logger.debug(err);
    }
  }

  // Change Severity

  private static readonly SEVERITY_CHECK: WorkspaceIncidentFormCheck = {
    kind: "update",
    data: { incidentSeverityId: ObjectID.generate() },
    action: "change the severity of this incident",
  };

  @CaptureSpan()
  private static async viewChangeSeverity(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    SlackIncidentMoreActions.clear(data);

    const form: {
      incident: WorkspaceIncidentForForm;
      choices: Array<WorkspaceIncidentChoice>;
      currentId: ObjectID | null;
    } | null = await SlackIncidentMoreActions.authorizeForm({
      slackRequest: data.slackRequest,
      incidentId: data.action.actionValue,
      check: SlackIncidentMoreActions.SEVERITY_CHECK,
      read: async (
        props: DatabaseCommonInteractionProps,
        incident: WorkspaceIncidentForForm,
      ) => {
        return {
          incident: incident,
          choices: await WorkspaceIncidentActions.getSeverityChoices({
            projectId: data.slackRequest.projectId!,
            props: props,
          }),
          currentId: await WorkspaceIncidentActions.getSeverityId({
            event: incident.event,
            props: props,
          }),
        };
      },
    });

    if (!form) {
      return;
    }

    if (form.choices.length === 0) {
      return await SlackActionAuthorization.sendRefusal({
        requester: data.slackRequest,
        message: WorkspaceIncidentActions.getNoSeveritiesMessage(),
      });
    }

    const severity: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: WORKSPACE_INCIDENT_FORM_TEXT.severityLabel,
      blockId: SEVERITY_FIELD,
      placeholder: WORKSPACE_INCIDENT_FORM_TEXT.severityPlaceholder,
      options: form.choices.map((choice: WorkspaceIncidentChoice) => {
        return { label: choice.name, value: choice.id.toString() };
      }),
      ...(form.currentId ? { initialValue: form.currentId.toString() } : {}),
    };

    await SlackIncidentMoreActions.openForm({
      slackRequest: data.slackRequest,
      modalBlock: {
        _type: "WorkspaceModalBlock",
        title: WORKSPACE_INCIDENT_FORM_TEXT.severityTitle,
        submitButtonTitle: WORKSPACE_INCIDENT_FORM_TEXT.save,
        cancelButtonTitle: WORKSPACE_INCIDENT_FORM_TEXT.cancel,
        actionId: SlackActionType.SubmitChangeIncidentSeverity,
        actionValue: form.incident.event.id.toString(),
        blocks: [SlackIncidentMoreActions.heading(form.incident), severity],
      },
    });
  }

  @CaptureSpan()
  private static async submitChangeSeverity(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const severityId: string = SlackIncidentMoreActions.toString(
      data.slackRequest.viewValues?.[SEVERITY_FIELD],
    );

    if (!ObjectID.isValidUUID(severityId)) {
      return SlackIncidentMoreActions.answerFieldErrors(data, {
        [SEVERITY_FIELD]: "Pick a severity.",
      });
    }

    SlackIncidentMoreActions.clear(data);

    const authorized: {
      props: DatabaseCommonInteractionProps;
      incident: WorkspaceIncidentForForm;
    } | null = await SlackIncidentMoreActions.authorizeForm({
      slackRequest: data.slackRequest,
      incidentId: data.action.actionValue,
      check: SlackIncidentMoreActions.SEVERITY_CHECK,
      read: async (
        props: DatabaseCommonInteractionProps,
        incident: WorkspaceIncidentForForm,
      ) => {
        return { props: props, incident: incident };
      },
    });

    if (!authorized) {
      return;
    }

    const result: { isChanged: boolean; severityName: string } | null =
      await SlackActionAuthorization.runForRequester({
        requester: data.slackRequest,
        action: "change the severity",
        run: async (): Promise<{
          isChanged: boolean;
          severityName: string;
        }> => {
          return await WorkspaceIncidentActions.changeSeverity({
            event: authorized.incident.event,
            severityId: new ObjectID(severityId),
            props: authorized.props,
          });
        },
      });

    if (!result) {
      return;
    }

    const answer: () => Promise<WorkspaceAnswer> = async () => {
      return await WorkspaceIncidentActions.getSeverityAnswer({
        event: authorized.incident.event,
        severityName: result.severityName,
        isChanged: result.isChanged,
      });
    };

    // Nothing changed is news only to them; a change, to the channel too.
    if (!result.isChanged) {
      return await SlackIncidentMoreActions.sendAnswer({
        slackRequest: data.slackRequest,
        answer: await answer(),
      });
    }

    await SlackIncidentMoreActions.answerDoneIfPrivate({
      slackRequest: data.slackRequest,
      answer: answer,
    });
  }

  // Assign Role

  private static readonly ROLE_CHECK: WorkspaceIncidentFormCheck = {
    kind: "create",
    modelType: IncidentMember,
    action: "assign a role on this incident",
  };

  @CaptureSpan()
  private static async viewAssignRole(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    SlackIncidentMoreActions.clear(data);

    const form: {
      incident: WorkspaceIncidentForForm;
      roles: WorkspaceIncidentRoleForm;
      userId: ObjectID | undefined;
    } | null = await SlackIncidentMoreActions.authorizeForm({
      slackRequest: data.slackRequest,
      incidentId: data.action.actionValue,
      check: SlackIncidentMoreActions.ROLE_CHECK,
      read: async (
        props: DatabaseCommonInteractionProps,
        incident: WorkspaceIncidentForForm,
      ) => {
        return {
          incident: incident,
          roles: await WorkspaceIncidentActions.getRoleForm({
            event: incident.event,
            props: props,
          }),
          userId: props.userId,
        };
      },
    });

    if (!form) {
      return;
    }

    if (form.roles.roles.length === 0) {
      return await SlackActionAuthorization.sendRefusal({
        requester: data.slackRequest,
        message: WorkspaceIncidentActions.getNoRolesMessage(),
      });
    }

    const blocks: Array<WorkspaceMessageBlock> = [
      SlackIncidentMoreActions.heading(
        form.incident,
        WorkspaceIncidentActions.getHoldersMarkdown(form.roles.holders),
      ),
    ];

    const role: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: WORKSPACE_INCIDENT_FORM_TEXT.roleLabel,
      blockId: ROLE_FIELD,
      placeholder: WORKSPACE_INCIDENT_FORM_TEXT.rolePlaceholder,
      options: form.roles.roles.map((choice: WorkspaceIncidentRoleChoice) => {
        return { label: choice.name, value: choice.id.toString() };
      }),
      // The primary role - Incident Commander - first, and picked.
      initialValue: form.roles.roles[0]!.id.toString(),
    };

    blocks.push(role);

    const isYouListed: boolean = form.roles.people.some(
      (person: WorkspaceIncidentPersonChoice): boolean => {
        return (
          person.userId.toString().toLowerCase() ===
          (form.userId?.toString().toLowerCase() || "")
        );
      },
    );

    const person: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: WORKSPACE_INCIDENT_FORM_TEXT.personLabel,
      blockId: ROLE_PERSON_FIELD,
      placeholder: WORKSPACE_INCIDENT_FORM_TEXT.personPlaceholder,
      options: form.roles.people.map(
        (choice: WorkspaceIncidentPersonChoice) => {
          return { label: choice.label, value: choice.userId.toString() };
        },
      ),
      // "I'll take it": the person who opened the form, picked.
      ...(isYouListed && form.userId
        ? { initialValue: form.userId.toString() }
        : {}),
      description: [
        WorkspaceIncidentActions.getRoleHint(form.roles.roles),
        SlackIncidentMoreActions.getNotListedNote({
          count: form.roles.notShownPeopleCount,
          instead: `assign them in ${ProductBrandingText.getProductName()}.`,
        }),
      ]
        .filter((sentence: string): boolean => {
          return sentence.length > 0;
        })
        .join(" "),
    };

    blocks.push(person);

    await SlackIncidentMoreActions.openForm({
      slackRequest: data.slackRequest,
      modalBlock: {
        _type: "WorkspaceModalBlock",
        title: WORKSPACE_INCIDENT_FORM_TEXT.roleTitle,
        submitButtonTitle: WORKSPACE_INCIDENT_FORM_TEXT.assign,
        cancelButtonTitle: WORKSPACE_INCIDENT_FORM_TEXT.cancel,
        actionId: SlackActionType.SubmitAssignIncidentRole,
        actionValue: form.incident.event.id.toString(),
        blocks: blocks,
      },
    });
  }

  @CaptureSpan()
  private static async submitAssignRole(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const roleId: string = SlackIncidentMoreActions.toString(
      data.slackRequest.viewValues?.[ROLE_FIELD],
    );
    const userId: string = SlackIncidentMoreActions.toString(
      data.slackRequest.viewValues?.[ROLE_PERSON_FIELD],
    );

    const errors: Record<string, string> = {};

    if (!ObjectID.isValidUUID(roleId)) {
      errors[ROLE_FIELD] = "Pick a role.";
    }

    if (!ObjectID.isValidUUID(userId)) {
      errors[ROLE_PERSON_FIELD] = "Pick a person.";
    }

    if (Object.keys(errors).length > 0) {
      return SlackIncidentMoreActions.answerFieldErrors(data, errors);
    }

    SlackIncidentMoreActions.clear(data);

    const authorized: {
      props: DatabaseCommonInteractionProps;
      incident: WorkspaceIncidentForForm;
    } | null = await SlackIncidentMoreActions.authorizeForm({
      slackRequest: data.slackRequest,
      incidentId: data.action.actionValue,
      check: SlackIncidentMoreActions.ROLE_CHECK,
      read: async (
        props: DatabaseCommonInteractionProps,
        incident: WorkspaceIncidentForForm,
      ) => {
        return { props: props, incident: incident };
      },
    });

    if (!authorized) {
      return;
    }

    const assignment: WorkspaceRoleAssignment | null =
      await SlackActionAuthorization.runForRequester({
        requester: data.slackRequest,
        action: "assign the role",
        run: async (): Promise<WorkspaceRoleAssignment> => {
          return await WorkspaceIncidentActions.assignRole({
            event: authorized.incident.event,
            roleId: new ObjectID(roleId),
            userId: new ObjectID(userId),
            props: authorized.props,
          });
        },
      });

    if (!assignment) {
      return;
    }

    const answer: () => Promise<WorkspaceAnswer> = async () => {
      return await WorkspaceIncidentActions.getRoleAnswer({
        event: authorized.incident.event,
        assignment: assignment,
      });
    };

    if (assignment.isHeldAlready) {
      return await SlackIncidentMoreActions.sendAnswer({
        slackRequest: data.slackRequest,
        answer: await answer(),
      });
    }

    await SlackIncidentMoreActions.answerDoneIfPrivate({
      slackRequest: data.slackRequest,
      answer: answer,
    });
  }

  // Page Someone

  private static readonly PAGE_CHECK: WorkspaceIncidentFormCheck = {
    kind: "create",
    modelType: OnCallDutyPolicyExecutionLog,
    action: "page someone about this incident",
  };

  @CaptureSpan()
  private static async viewPage(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    SlackIncidentMoreActions.clear(data);

    const form: {
      incident: WorkspaceIncidentForForm;
      isResolved: boolean;
      choices: Array<WorkspacePageChoiceGroup>;
    } | null = await SlackIncidentMoreActions.authorizeForm({
      slackRequest: data.slackRequest,
      incidentId: data.action.actionValue,
      check: SlackIncidentMoreActions.PAGE_CHECK,
      read: async (
        props: DatabaseCommonInteractionProps,
        incident: WorkspaceIncidentForForm,
      ) => {
        const isResolved: boolean = (
          await WorkspaceMemberActions.getStanding(incident.event)
        ).isResolved;

        return {
          incident: incident,
          isResolved: isResolved,
          choices: isResolved
            ? []
            : await WorkspacePage.getChoices({
                projectId: data.slackRequest.projectId!,
                props: props,
              }),
        };
      },
    });

    if (!form) {
      return;
    }

    // Resolved already: nobody is paged, and they are told who resolved it.
    if (form.isResolved) {
      await SlackActionAnswer.answerAlready({
        source: data.slackRequest,
        event: form.incident.event,
        press: WorkspaceLatePress.Page,
      });
      return;
    }

    if (form.choices.length === 0) {
      return await SlackActionAuthorization.sendRefusal({
        requester: data.slackRequest,
        message:
          "There is nobody you can page in this project yet: no on-call schedules, people, teams or on-call policies are available to you.",
      });
    }

    const who: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: WORKSPACE_PAGE_FORM_TEXT.whoLabel,
      blockId: PAGE_ABOUT_INCIDENT_FIELD,
      placeholder: WORKSPACE_PAGE_FORM_TEXT.whoPlaceholder,
      options: [],
      optionGroups: form.choices.map((group: WorkspacePageChoiceGroup) => {
        return {
          label: group.label,
          options: group.choices.map((choice: WorkspacePageChoice) => {
            return { label: choice.label, value: choice.value };
          }),
        };
      }),
      multiSelect: true,
      description: [
        WORKSPACE_INCIDENT_FORM_TEXT.pageHint,
        SlackIncidentMoreActions.getNotListedNote({
          count: form.choices.reduce(
            (count: number, group: WorkspacePageChoiceGroup): number => {
              return count + (group.notShownCount || 0);
            },
            0,
          ),
          instead: "page their team or on-call schedule instead.",
        }),
      ]
        .filter((sentence: string): boolean => {
          return sentence.length > 0;
        })
        .join(" "),
    };

    /*
     * The page's own message, as `/oneuptime page` in the incident's
     * channel takes it: optional - the incident says what it is about.
     */
    const message: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: WORKSPACE_PAGE_FORM_TEXT.messageLabel,
      blockId: PAGE_ABOUT_INCIDENT_MESSAGE_FIELD,
      placeholder: WORKSPACE_PAGE_FORM_TEXT.messagePlaceholder,
      description: WORKSPACE_INCIDENT_FORM_TEXT.pageMessageHint,
      optional: true,
      maxLength: ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH,
    };

    await SlackIncidentMoreActions.openForm({
      slackRequest: data.slackRequest,
      modalBlock: {
        _type: "WorkspaceModalBlock",
        title: WORKSPACE_INCIDENT_FORM_TEXT.pageTitle,
        submitButtonTitle: WORKSPACE_INCIDENT_FORM_TEXT.page,
        cancelButtonTitle: WORKSPACE_INCIDENT_FORM_TEXT.cancel,
        actionId: SlackActionType.SubmitPageAboutIncident,
        actionValue: form.incident.event.id.toString(),
        blocks: [
          SlackIncidentMoreActions.heading(form.incident),
          who,
          message,
        ],
      },
    });
  }

  @CaptureSpan()
  private static async submitPage(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const picked: Array<string> = SlackIncidentMoreActions.toStrings(
      data.slackRequest.viewValues?.[PAGE_ABOUT_INCIDENT_FIELD],
    );
    // Optional, and on forms opened before it was asked: none.
    const pageMessage: unknown =
      data.slackRequest.viewValues?.[PAGE_ABOUT_INCIDENT_MESSAGE_FIELD];
    const message: string = typeof pageMessage === "string" ? pageMessage : "";

    const problem: string | null =
      WorkspaceIncidentActions.getPageProblem(picked);

    if (problem) {
      return SlackIncidentMoreActions.answerFieldErrors(data, {
        [PAGE_ABOUT_INCIDENT_FIELD]: problem,
      });
    }

    SlackIncidentMoreActions.clear(data);

    const authorized: {
      props: DatabaseCommonInteractionProps;
      incident: WorkspaceIncidentForForm;
    } | null = await SlackIncidentMoreActions.authorizeForm({
      slackRequest: data.slackRequest,
      incidentId: data.action.actionValue,
      check: SlackIncidentMoreActions.PAGE_CHECK,
      read: async (
        props: DatabaseCommonInteractionProps,
        incident: WorkspaceIncidentForForm,
      ) => {
        return { props: props, incident: incident };
      },
    });

    if (!authorized) {
      return;
    }

    if (
      (await WorkspaceMemberActions.getStanding(authorized.incident.event))
        .isResolved
    ) {
      await SlackActionAnswer.answerAlready({
        source: data.slackRequest,
        event: authorized.incident.event,
        press: WorkspaceLatePress.Page,
      });
      return;
    }

    const result: OnCallPageResult | null =
      await SlackActionAuthorization.runForRequester({
        requester: data.slackRequest,
        action: "page",
        run: async (): Promise<OnCallPageResult> => {
          return await WorkspaceIncidentActions.page({
            event: authorized.incident.event,
            targets: WorkspacePage.readTargets(picked),
            props: authorized.props,
            // The page's own message, when they wrote one.
            ...(message.trim() ? { message: message } : {}),
          });
        },
      });

    if (!result) {
      return;
    }

    // Who was paged, or why nobody was: always, as a page from chat is.
    await SlackIncidentMoreActions.sendAnswer({
      slackRequest: data.slackRequest,
      answer: WorkspaceIncidentActions.getPagedAnswer(result, message),
    });
  }

  // Edit Custom Fields

  private static readonly CUSTOM_FIELDS_CHECK: WorkspaceIncidentFormCheck = {
    kind: "update",
    data: { customFields: {} },
    action: "edit the custom fields of this incident",
  };

  @CaptureSpan()
  private static async viewEditCustomFields(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    SlackIncidentMoreActions.clear(data);

    const form: {
      incident: WorkspaceIncidentForForm;
      fields: WorkspaceCustomFieldsForm;
    } | null = await SlackIncidentMoreActions.authorizeForm({
      slackRequest: data.slackRequest,
      incidentId: data.action.actionValue,
      check: SlackIncidentMoreActions.CUSTOM_FIELDS_CHECK,
      read: async (
        props: DatabaseCommonInteractionProps,
        incident: WorkspaceIncidentForForm,
      ) => {
        return {
          incident: incident,
          fields: await SlackIncidentMoreActions.readCustomFieldsForm({
            incident: incident,
            props: props,
          }),
        };
      },
    });

    if (!form) {
      return;
    }

    if (form.fields.inputs.length === 0) {
      return await SlackActionAuthorization.sendRefusal({
        requester: data.slackRequest,
        message:
          form.fields.copiedFieldNames.length > 0
            ? WorkspaceIncidentActions.getOnlyCopiedCustomFieldsMessage()
            : WorkspaceIncidentActions.getNoCustomFieldsMessage(),
      });
    }

    const blocks: Array<WorkspaceMessageBlock> = [
      SlackIncidentMoreActions.heading(form.incident),
      ...form.fields.inputs.map((input: WorkspaceCustomFieldInput) => {
        return SlackIncidentMoreActions.getCustomFieldBlock(input);
      }),
      {
        _type: "WorkspacePayloadContext",
        text: WorkspaceIncidentActions.getCustomFieldsNote({
          form: form.fields,
        }).toString(),
      } as WorkspacePayloadContext,
    ];

    await SlackIncidentMoreActions.openForm({
      slackRequest: data.slackRequest,
      modalBlock: {
        _type: "WorkspaceModalBlock",
        title: WORKSPACE_INCIDENT_FORM_TEXT.customFieldsTitle,
        submitButtonTitle: WORKSPACE_INCIDENT_FORM_TEXT.save,
        cancelButtonTitle: WORKSPACE_INCIDENT_FORM_TEXT.cancel,
        actionId: SlackActionType.SubmitEditIncidentCustomFields,
        actionValue: form.incident.event.id.toString(),
        blocks: blocks,
      },
    });
  }

  @CaptureSpan()
  private static async submitEditCustomFields(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest } = data;

    /*
     * Checked before Slack is answered, so a value that does not fit its
     * field is said under it, on the form, which stays open: the reads it
     * takes are the form's own.
     */
    let prepared: {
      props: DatabaseCommonInteractionProps;
      incident: WorkspaceIncidentForForm;
      definitions: Array<WorkspaceCustomFieldDefinition>;
      submission: WorkspaceCustomFieldsSubmission;
    } | null;

    try {
      prepared = await SlackIncidentMoreActions.refuseInPlace({
        requester: slackRequest,
        action: SlackIncidentMoreActions.CUSTOM_FIELDS_CHECK.action,
        run: async (props: DatabaseCommonInteractionProps) => {
          const incident: WorkspaceIncidentForForm =
            await WorkspaceIncidentActions.authorizeForForm({
              incidentId: SlackIncidentMoreActions.toIncidentId(
                data.action.actionValue,
              ),
              props: props,
              check: SlackIncidentMoreActions.CUSTOM_FIELDS_CHECK,
            });

          const definitions: Array<WorkspaceCustomFieldDefinition> =
            await WorkspaceIncidentCustomFields.readDefinitions({
              projectId: slackRequest.projectId!,
              props: props,
            });

          const values: { stored: JSONObject; monitorCount: number } | null =
            await WorkspaceIncidentCustomFields.readIncidentValues({
              incidentId: incident.event.id,
              projectId: slackRequest.projectId!,
              props: props,
            });

          const form: WorkspaceCustomFieldsForm =
            WorkspaceIncidentCustomFields.buildForm({
              definitions: definitions,
              stored: values?.stored || {},
              monitorCount: values?.monitorCount || 0,
            });

          return {
            props: props,
            incident: incident,
            definitions: definitions,
            submission: WorkspaceIncidentCustomFields.readSubmission({
              inputs: form.inputs,
              definitions: definitions,
              stored: values?.stored || {},
              submitted: SlackIncidentMoreActions.getSubmittedCustomFields(
                slackRequest,
                form.inputs,
              ),
            }),
          };
        },
        beforeRefusal: () => {
          SlackIncidentMoreActions.clear(data);
        },
      });
    } catch (err) {
      SlackIncidentMoreActions.clear(data);
      throw err;
    }

    if (!prepared) {
      return;
    }

    if (Object.keys(prepared.submission.problems).length > 0) {
      return SlackIncidentMoreActions.answerFieldErrors(
        data,
        prepared.submission.problems,
      );
    }

    SlackIncidentMoreActions.clear(data);

    const changedNames: Array<string> = prepared.submission.changes.map(
      (change: { name: string; value: unknown }): string => {
        return change.name;
      },
    );

    if (changedNames.length === 0) {
      return await SlackIncidentMoreActions.sendAnswer({
        slackRequest: slackRequest,
        answer: await WorkspaceIncidentActions.getCustomFieldsAnswer({
          event: prepared.incident.event,
          changedNames: [],
        }),
      });
    }

    const authorized: {
      props: DatabaseCommonInteractionProps;
      incident: WorkspaceIncidentForForm;
    } = prepared;

    const isSaved: boolean | null =
      await SlackActionAuthorization.runForRequester({
        requester: slackRequest,
        action: "save the custom fields",
        run: async (): Promise<boolean> => {
          await WorkspaceIncidentCustomFields.save({
            incidentId: authorized.incident.event.id,
            projectId: slackRequest.projectId!,
            changes: prepared!.submission.changes,
            props: authorized.props,
          });
          return true;
        },
      });

    if (!isSaved) {
      return;
    }

    await SlackIncidentMoreActions.answerDoneIfPrivate({
      slackRequest: slackRequest,
      answer: async () => {
        return await WorkspaceIncidentActions.getCustomFieldsAnswer({
          event: authorized.incident.event,
          changedNames: changedNames,
        });
      },
    });
  }

  /*
   * One custom field's input in Slack: its name as the label, its
   * description as the hint, what the incident holds as it opens - every
   * one optional.
   */
  public static getCustomFieldBlock(
    input: WorkspaceCustomFieldInput,
  ): WorkspaceMessageBlock {
    const description: string | undefined = input.description || undefined;

    switch (input.kind) {
      case WorkspaceCustomFieldInputKind.LongText: {
        const block: WorkspaceTextAreaBlock = {
          _type: "WorkspaceTextAreaBlock",
          label: input.name,
          blockId: input.inputId,
          placeholder: input.name,
          optional: true,
          description: description,
          ...(input.initialText
            ? {
                initialValue: input.initialText.substring(
                  0,
                  MAX_TEXT_INPUT_LENGTH,
                ),
              }
            : {}),
        };
        return block;
      }
      case WorkspaceCustomFieldInputKind.Number: {
        const block: WorkspaceNumberInputBlock = {
          _type: "WorkspaceNumberInputBlock",
          label: input.name,
          blockId: input.inputId,
          optional: true,
          description: description,
          ...(input.initialText ? { initialValue: input.initialText } : {}),
        };
        return block;
      }
      case WorkspaceCustomFieldInputKind.YesNo:
      case WorkspaceCustomFieldInputKind.Dropdown:
      case WorkspaceCustomFieldInputKind.MultiSelect: {
        const block: WorkspaceDropdownBlock = {
          _type: "WorkspaceDropdownBlock",
          label: input.name,
          blockId: input.inputId,
          placeholder:
            input.kind === WorkspaceCustomFieldInputKind.MultiSelect
              ? "Select options"
              : "Select an option",
          options: input.options.map(
            (option: { value: string; label: string }) => {
              return { label: option.label, value: option.value };
            },
          ),
          optional: true,
          description: description,
          multiSelect: input.kind === WorkspaceCustomFieldInputKind.MultiSelect,
          ...(input.initialOption ? { initialValue: input.initialOption } : {}),
          ...(input.initialOptions.length > 0
            ? { initialValues: input.initialOptions }
            : {}),
        };
        return block;
      }
      case WorkspaceCustomFieldInputKind.Date: {
        const block: WorkspaceDatePickerBlock = {
          _type: "WorkspaceDatePickerBlock",
          label: input.name,
          blockId: input.inputId,
          optional: true,
          description: description,
          ...(input.initialDate ? { initialDate: input.initialDate } : {}),
        };
        return block;
      }
      case WorkspaceCustomFieldInputKind.DateTime: {
        const block: WorkspaceDateTimePickerBlock = {
          _type: "WorkspaceDateTimePickerBlock",
          label: input.name,
          blockId: input.inputId,
          optional: true,
          description: description,
          ...(input.initialDateTime
            ? { initialDateTime: input.initialDateTime }
            : {}),
        };
        return block;
      }
      default: {
        const block: WorkspaceTextBoxBlock = {
          _type: "WorkspaceTextBoxBlock",
          label: input.name,
          blockId: input.inputId,
          placeholder: input.name,
          optional: true,
          description: description,
          ...(input.initialText
            ? {
                initialValue: input.initialText.substring(
                  0,
                  MAX_TEXT_INPUT_LENGTH,
                ),
              }
            : {}),
        };
        return block;
      }
    }
  }

  // The values a submitted custom fields form holds, by input id.
  private static getSubmittedCustomFields(
    slackRequest: SlackRequest,
    inputs: Array<WorkspaceCustomFieldInput>,
  ): Record<string, WorkspaceCustomFieldSubmittedValue> {
    const values: JSONObject = (slackRequest.viewValues ||
      {}) as unknown as JSONObject;
    const submitted: Record<string, WorkspaceCustomFieldSubmittedValue> = {};

    for (const input of inputs) {
      if (Object.prototype.hasOwnProperty.call(values, input.inputId)) {
        submitted[input.inputId] = values[
          input.inputId
        ] as unknown as WorkspaceCustomFieldSubmittedValue;
      }
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

  // Shared

  /*
   * The incident, with its buttons and menu, only to the person who asked
   * (SlackActionAnswer.answerWithBlocks).
   */
  private static async answerWithCard(data: {
    slackRequest: SlackRequest;
    props: DatabaseCommonInteractionProps;
    incidentId: ObjectID;
    isAskedInItsChannel: boolean;
  }): Promise<void> {
    const place: SlackAnswerPlace | null = SlackActionAnswer.getPlace(
      data.slackRequest,
    );

    if (!place) {
      return;
    }

    const card: WorkspaceIncidentCard | null =
      await WorkspaceIncidentActions.getCard({
        incidentId: data.incidentId,
        projectId: data.slackRequest.projectId!,
        props: data.props,
        workspaceType: WorkspaceType.Slack,
        actions: SLACK_INCIDENT_ACTION_IDS,
        isAskedInItsChannel: data.isAskedInItsChannel,
      });

    if (!card) {
      return;
    }

    await SlackActionAnswer.answerWithBlocks({
      place: place,
      messageBlocks: card.messageBlocks,
      text: card.text,
    });
  }

  /*
   * The member the Slack account is connected to, when they may do what a
   * form does to the incident, and what the form needs, read as them;
   * otherwise they are told why where they pressed, and null comes back.
   */
  private static async authorizeForm<T>(data: {
    slackRequest: SlackRequest;
    incidentId: string | undefined;
    check: WorkspaceIncidentFormCheck;
    read: (
      props: DatabaseCommonInteractionProps,
      incident: WorkspaceIncidentForForm,
    ) => Promise<T>;
  }): Promise<T | null> {
    return await SlackIncidentMoreActions.refuseInPlace({
      requester: data.slackRequest,
      action: data.check.action,
      run: async (props: DatabaseCommonInteractionProps): Promise<T> => {
        const incident: WorkspaceIncidentForForm =
          await WorkspaceIncidentActions.authorizeForForm({
            incidentId: SlackIncidentMoreActions.toIncidentId(data.incidentId),
            props: props,
            check: data.check,
          });

        return await data.read(props, incident);
      },
    });
  }

  /*
   * Runs `run` as the member the Slack account is connected to. A refusal -
   * not a member, no permission, not on the plan - is told to them where
   * they pressed, and null comes back. Anything else is thrown.
   */
  private static async refuseInPlace<T>(data: {
    requester: SlackActionRequester;
    action: string;
    run: (props: DatabaseCommonInteractionProps) => Promise<T>;
    // Before a refusal is told: answers Slack, when the caller has not yet.
    beforeRefusal?: (() => void) | undefined;
  }): Promise<T | null> {
    const { requester } = data;

    try {
      if (!requester.userId || !requester.projectId) {
        throw new NotAuthorizedException(
          `You do not have permission to ${data.action}.`,
        );
      }

      const props: DatabaseCommonInteractionProps =
        await WorkspaceActionAuthorization.getProjectMemberProps({
          userId: requester.userId,
          projectId: requester.projectId,
        });

      return await data.run(props);
    } catch (err) {
      if (
        !(err instanceof NotAuthorizedException) &&
        !(err instanceof PaymentRequiredException)
      ) {
        throw err;
      }

      logger.debug("Slack incident action refused: " + err.message, {
        projectId: requester.projectId?.toString(),
      });

      if (data.beforeRefusal) {
        data.beforeRefusal();
      }

      await SlackActionAuthorization.sendRefusal({
        requester: requester,
        message: err.message,
      });

      return null;
    }
  }

  /*
   * Opens a form, carrying where it was opened. Slack lets a press open a
   * form for three seconds; one that took longer is told to press again.
   */
  private static async openForm(data: {
    slackRequest: SlackRequest;
    modalBlock: WorkspaceModalBlock;
  }): Promise<void> {
    try {
      await SlackActionAnswer.showModal({
        source: data.slackRequest,
        modalBlock: data.modalBlock,
      });
    } catch (err) {
      logger.debug("Slack did not open an incident's form.", {
        projectId: data.slackRequest.projectId?.toString(),
      });
      logger.debug(err);

      await SlackActionAuthorization.sendRefusal({
        requester: data.slackRequest,
        message: `${ProductBrandingText.getProductName()} couldn't open the form in time. Please try again.`,
      });
    }
  }

  // An answer only the person sees, where they pressed. Never throws.
  private static async sendAnswer(data: {
    slackRequest: SlackRequest;
    answer: WorkspaceAnswer;
  }): Promise<void> {
    const place: SlackAnswerPlace | null = SlackActionAnswer.getPlace(
      data.slackRequest,
    );

    if (!place) {
      return;
    }

    await SlackActionAnswer.answer({ place: place, answer: data.answer });
  }

  // A form's heading: the incident, and what else the form says above it.
  private static heading(
    incident: WorkspaceIncidentForForm,
    more?: MarkdownText | null,
  ): WorkspacePayloadMarkdown {
    const heading: MarkdownText =
      WorkspaceIncidentActions.getFormHeading(incident);

    return {
      _type: "WorkspacePayloadMarkdown",
      text: (more
        ? FeedMarkdown.join([heading, more], "\n")
        : heading
      ).toString(),
    };
  }

  /*
   * "52 more people aren't listed: assign them in OneUptime." - people past
   * what a list holds, and what to do about them (`instead`).
   */
  private static getNotListedNote(data: {
    count: number;
    instead: string;
  }): string {
    if (data.count <= 0) {
      return "";
    }

    return data.count === 1
      ? `1 more person isn't listed: ${data.instead}`
      : `${data.count} more people aren't listed: ${data.instead}`;
  }

  // Slack is answered at once: the press, or the form, is taken.
  private static clear(data: {
    req: ExpressRequest;
    res: ExpressResponse;
  }): void {
    if (!data.res.headersSent) {
      Response.sendJsonObjectResponse(data.req, data.res, {
        response_action: "clear",
      });
    }
  }

  // A submitted form with a field left wrong: said under it, the form open.
  private static answerFieldErrors(
    data: { req: ExpressRequest; res: ExpressResponse },
    errors: Record<string, string>,
  ): void {
    return Response.sendJsonObjectResponse(data.req, data.res, {
      response_action: "errors",
      errors: errors as JSONObject,
    });
  }

  // The incident a form or a button carries, as OneUptime wrote it.
  private static toIncidentId(value: string | undefined): ObjectID {
    if (!value || !ObjectID.isValidUUID(value)) {
      throw new NotAuthorizedException(
        `Could not do that: ${WorkspaceActionAuthorization.getNotFoundReason("incident")}`,
      );
    }

    return new ObjectID(value);
  }

  // A form's value as one string: a single select's pick.
  private static toString(value: unknown): string {
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }

    return "";
  }

  // A form's value as a list of strings: a multi-select's picks.
  private static toStrings(value: unknown): Array<string> {
    if (Array.isArray(value)) {
      return value
        .map((item: unknown): string => {
          return typeof item === "string" || typeof item === "number"
            ? String(item)
            : "";
        })
        .filter((item: string): boolean => {
          return item.length > 0;
        });
    }

    return typeof value === "string" && value ? [value] : [];
  }
}
