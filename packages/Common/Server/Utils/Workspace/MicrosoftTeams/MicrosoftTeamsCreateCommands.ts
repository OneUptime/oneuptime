import { TurnContext } from "botbuilder";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "./Actions/Auth";
import MicrosoftTeamsIncidentActions, {
  MicrosoftTeamsNewIncidentFormChoices,
} from "./Actions/Incident";
import MicrosoftTeamsScheduledMaintenanceActions, {
  MicrosoftTeamsNewScheduledMaintenanceFormChoices,
} from "./Actions/ScheduledMaintenance";
import MicrosoftTeamsMessageSize from "./MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies from "./MicrosoftTeamsReplies";
import MicrosoftTeamsTimezone from "./MicrosoftTeamsTimezone";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * "create incident" and "create maintenance" typed to the Microsoft Teams bot.
 *
 * Each answers with exactly one message: the form, or a reason it cannot be
 * shown that says what to do next (issue #4111 answered both with a generic
 * "Sorry, I encountered an error...", twice).
 *
 * 1. In a personal chat the sender is the only one who can submit the form,
 *    so a sender without a connected account, who is not a member of the
 *    project, or who may not create the thing, is told so before filling it
 *    in, not after. In a channel or group chat anyone there may submit it, and
 *    the submit checks whoever does, so the form is posted for everyone.
 * 2. The form's lists (monitors, labels, on-call policies...) are read in name
 *    order up to a cap, and the card is fitted to a size budget that Teams
 *    accepts; a card Teams still refuses as too large is sent again smaller,
 *    and finally without the lists at all.
 */

export interface CreateFormText {
  // "an incident", "a scheduled maintenance event": what the form creates.
  what: string;
  // Below the project in the dashboard, where the same thing can be created.
  dashboardRoute: string;
  // Completes "To ...": why the sender needs a connected account.
  purpose: string;
  // The lists that are left off a card refused as too large.
  lists: string;
}

const INCIDENT_FORM: CreateFormText = {
  what: "an incident",
  dashboardRoute: "/incidents/create",
  purpose: "create incidents from Microsoft Teams",
  lists: "monitors, labels and on-call policies",
};

const SCHEDULED_MAINTENANCE_FORM: CreateFormText = {
  what: "a scheduled maintenance event",
  dashboardRoute: "/scheduled-maintenance-events/create",
  purpose: "schedule maintenance from Microsoft Teams",
  lists: "monitors and labels",
};

export default class MicrosoftTeamsCreateCommands {
  @CaptureSpan()
  public static async handleCreateIncidentCommand(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
    initialTitle?: string | undefined;
  }): Promise<void> {
    const { turnContext, activity, projectId } = data;

    if (
      this.isPersonalConversation(activity) &&
      !(await this.authorizeSender({
        turnContext: turnContext,
        activity: activity,
        projectId: projectId,
        form: INCIDENT_FORM,
      }))
    ) {
      return;
    }

    let choices: MicrosoftTeamsNewIncidentFormChoices;

    try {
      choices =
        await MicrosoftTeamsIncidentActions.getNewIncidentFormChoices(
          projectId,
        );
    } catch (error) {
      await this.replyFormCouldNotLoad({
        turnContext: turnContext,
        projectId: projectId,
        form: INCIDENT_FORM,
        error: error,
      });
      return;
    }

    if (choices.severities.choices.length === 0) {
      const severitySettingsUrl: string | null =
        await MicrosoftTeamsReplies.getDashboardLink({
          projectId: projectId,
          route: "/incidents/settings/severity",
        });

      await MicrosoftTeamsReplies.sendBestEffort(
        turnContext,
        `An incident needs a severity, and this project has no incident severities yet. Add one in OneUptime under ${
          severitySettingsUrl
            ? mdText`[Incidents → Settings → Incident Severity](${severitySettingsUrl})`
            : "Incidents → Settings → Incident Severity"
        }, then try again.`,
      );
      return;
    }

    const createInOneUptimeUrl: string | null =
      await MicrosoftTeamsReplies.getDashboardLink({
        projectId: projectId,
        route: INCIDENT_FORM.dashboardRoute,
      });

    await this.sendForm({
      turnContext: turnContext,
      projectId: projectId,
      form: INCIDENT_FORM,
      createInOneUptimeUrl: createInOneUptimeUrl,
      buildCard: (budgetInBytes: number): JSONObject => {
        return MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
          choices: choices,
          budgetInBytes: budgetInBytes,
          initialTitle: data.initialTitle,
          createInOneUptimeUrl: createInOneUptimeUrl,
        });
      },
    });
  }

  @CaptureSpan()
  public static async handleCreateScheduledMaintenanceCommand(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
    initialTitle?: string | undefined;
  }): Promise<void> {
    const { turnContext, activity, projectId } = data;

    if (
      this.isPersonalConversation(activity) &&
      !(await this.authorizeSender({
        turnContext: turnContext,
        activity: activity,
        projectId: projectId,
        form: SCHEDULED_MAINTENANCE_FORM,
        // Submitting checks the same permission.
        createPermission: {
          modelType: ScheduledMaintenance,
          action: "create a scheduled maintenance event",
        },
      }))
    ) {
      return;
    }

    let choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices;

    try {
      choices =
        await MicrosoftTeamsScheduledMaintenanceActions.getNewScheduledMaintenanceFormChoices(
          projectId,
        );
    } catch (error) {
      await this.replyFormCouldNotLoad({
        turnContext: turnContext,
        projectId: projectId,
        form: SCHEDULED_MAINTENANCE_FORM,
        error: error,
      });
      return;
    }

    const createInOneUptimeUrl: string | null =
      await MicrosoftTeamsReplies.getDashboardLink({
        projectId: projectId,
        route: SCHEDULED_MAINTENANCE_FORM.dashboardRoute,
      });

    // The zone the start and end are typed in; see MicrosoftTeamsTimezone.
    const timezone: string | undefined =
      MicrosoftTeamsTimezone.getTimezoneFromActivity(activity);

    await this.sendForm({
      turnContext: turnContext,
      projectId: projectId,
      form: SCHEDULED_MAINTENANCE_FORM,
      createInOneUptimeUrl: createInOneUptimeUrl,
      buildCard: (budgetInBytes: number): JSONObject => {
        return MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
          {
            choices: choices,
            budgetInBytes: budgetInBytes,
            initialTitle: data.initialTitle,
            createInOneUptimeUrl: createInOneUptimeUrl,
            timezone: timezone,
          },
        );
      },
    });
  }

  // A 1:1 chat with the bot, where whoever asks for a form is the one to submit it.
  private static isPersonalConversation(activity: JSONObject): boolean {
    return (
      ((activity["conversation"] as JSONObject | undefined)?.[
        "conversationType"
      ] as string | undefined) === "personal"
    );
  }

  /*
   * True when the sender can submit the form. Otherwise the sender is told
   * why (no connected account, not a project member, no permission) and this
   * returns false.
   */
  private static async authorizeSender(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
    form: CreateFormText;
    createPermission?:
      | {
          modelType: DatabaseBaseModelType;
          action: string;
        }
      | undefined;
  }): Promise<boolean> {
    const { turnContext, activity, projectId, form } = data;

    const teamsUserId: string =
      ((activity["from"] as JSONObject | undefined)?.["aadObjectId"] as
        | string
        | undefined) || "";

    if (!teamsUserId) {
      logger.warn(
        "A Microsoft Teams create command arrived without the sender's AAD object id",
        {
          projectId: projectId.toString(),
        },
      );
      await MicrosoftTeamsReplies.sendBestEffort(
        turnContext,
        `Sorry, I couldn't tell who sent this message, so I can't open the form to create ${form.what}. Please try again.`,
      );
      return false;
    }

    try {
      const userId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: teamsUserId,
          projectId: projectId,
        });

      const props: DatabaseCommonInteractionProps =
        await WorkspaceActionAuthorization.getProjectMemberProps({
          userId: userId,
          projectId: projectId,
        });

      if (data.createPermission) {
        await WorkspaceActionAuthorization.assertCanCreate({
          props: props,
          modelType: data.createPermission.modelType,
          action: data.createPermission.action,
        });
      }

      return true;
    } catch (error) {
      if (error instanceof MicrosoftTeamsAccountNotLinkedException) {
        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          await MicrosoftTeamsReplies.getAccountNotLinkedMessage({
            projectId: projectId,
            purpose: form.purpose,
          }),
        );
        return false;
      }

      if (error instanceof NotAuthorizedException) {
        await MicrosoftTeamsReplies.sendBestEffort(turnContext, error.message);
        return false;
      }

      MicrosoftTeamsReplies.logFailure(
        "Could not check the Microsoft Teams sender of a create command",
        error,
        {
          projectId: projectId.toString(),
        },
      );
      await MicrosoftTeamsReplies.sendBestEffort(
        turnContext,
        `Sorry, I couldn't open the form to create ${form.what} because OneUptime could not check your account just now. Please try again in a minute.`,
      );
      return false;
    }
  }

  private static async sendForm(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
    form: CreateFormText;
    createInOneUptimeUrl: string | null;
    buildCard: (budgetInBytes: number) => JSONObject;
  }): Promise<void> {
    try {
      await MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: data.turnContext,
        buildCard: data.buildCard,
      });
    } catch (error) {
      MicrosoftTeamsReplies.logFailure(
        `Microsoft Teams did not accept the form to create ${data.form.what}`,
        error,
        {
          projectId: data.projectId.toString(),
        },
      );

      await MicrosoftTeamsReplies.sendBestEffort(
        data.turnContext,
        this.getFormNotAcceptedMessage({
          form: data.form,
          error: error,
          createInOneUptimeUrl: data.createInOneUptimeUrl,
        }),
      );
    }
  }

  private static async replyFormCouldNotLoad(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
    form: CreateFormText;
    error: unknown;
  }): Promise<void> {
    MicrosoftTeamsReplies.logFailure(
      `Could not load the Microsoft Teams form to create ${data.form.what}`,
      data.error,
      {
        projectId: data.projectId.toString(),
      },
    );

    const createInOneUptimeUrl: string | null =
      await MicrosoftTeamsReplies.getDashboardLink({
        projectId: data.projectId,
        route: data.form.dashboardRoute,
      });

    await MicrosoftTeamsReplies.sendBestEffort(
      data.turnContext,
      `Sorry, I couldn't open the form to create ${data.form.what} because OneUptime could not load the lists it needs just now. Please try again in a minute, ${this.getCreateInOneUptimeHint(
        createInOneUptimeUrl,
        "or create it",
      )}`,
    );
  }

  public static getFormNotAcceptedMessage(data: {
    form: CreateFormText;
    error: unknown;
    createInOneUptimeUrl: string | null;
  }): string {
    const createInOneUptime: string = this.getCreateInOneUptimeHint(
      data.createInOneUptimeUrl,
      "You can create it",
    );

    if (MicrosoftTeamsMessageSize.isMessageTooLargeError(data.error)) {
      return `Sorry, I couldn't open the form to create ${data.form.what}: Microsoft Teams refused it as too large, even without the lists of ${data.form.lists}. ${createInOneUptime}`;
    }

    const statusCode: number | undefined =
      MicrosoftTeamsMessageSize.getErrorStatusCode(data.error);
    const code: string | undefined = MicrosoftTeamsMessageSize.getErrorCode(
      data.error,
    );
    const teamsReason: string = [statusCode, code]
      .filter((part: string | number | undefined) => {
        return part !== undefined && part !== "";
      })
      .join(" ");

    return `Sorry, I couldn't open the form to create ${data.form.what}: Microsoft Teams did not accept it${
      teamsReason ? ` (${teamsReason})` : ""
    }. ${createInOneUptime}`;
  }

  private static getCreateInOneUptimeHint(
    createInOneUptimeUrl: string | null,
    lead: string,
  ): string {
    return createInOneUptimeUrl
      ? `${lead} in OneUptime instead: ${createInOneUptimeUrl}`
      : `${lead} in OneUptime instead.`;
  }
}
