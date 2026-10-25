import { TurnContext } from "./Botbuilder";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { WorkspaceCommandName } from "../WorkspaceCommands";
import MicrosoftTeamsIncidentActions, {
  MicrosoftTeamsNewIncidentFormChoices,
} from "./Actions/Incident";
import MicrosoftTeamsScheduledMaintenanceActions, {
  MicrosoftTeamsNewScheduledMaintenanceFormChoices,
} from "./Actions/ScheduledMaintenance";
import MicrosoftTeamsMessageSize from "./MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies from "./MicrosoftTeamsReplies";
import MicrosoftTeamsCommands from "./MicrosoftTeamsCommands";
import MicrosoftTeamsTimezone from "./MicrosoftTeamsTimezone";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * "incident" and "maintenance" typed to the Microsoft Teams bot - or "create
 * incident" and "create maintenance", as they were typed before the words
 * were Slack's too (WorkspaceCommands).
 *
 * Each answers with exactly one message: the form, or a reason it cannot be
 * shown that says what to do next (issue #4111 answered both with a generic
 * "Sorry, I encountered an error...", twice).
 *
 * 1. The form is filled in as the person who asked for it, with their own
 *    permissions - in a personal chat, a channel or a group chat alike. A
 *    sender without a connected account, who is not a member of the project,
 *    or who may not create the thing, is told so instead of getting the form,
 *    and the form lists only the monitors, labels, on-call policies and the
 *    rest that the sender may read (WorkspaceActionAuthorization
 *    .findReadable). In a channel or group chat anyone there may submit it,
 *    and the submit is made as whoever does, with their own permissions: it
 *    names only what they may name.
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
  /*
   * The command that opens the form: what a sender without a connected
   * account types again once it is (MicrosoftTeamsConnectPrompt).
   */
  command: WorkspaceCommandName;
  // The lists that are left off a card refused as too large.
  lists: string;
}

const INCIDENT_FORM: CreateFormText = {
  what: "an incident",
  dashboardRoute: "/incidents/create",
  command: WorkspaceCommandName.Incident,
  lists: "monitors, labels and on-call policies",
};

const SCHEDULED_MAINTENANCE_FORM: CreateFormText = {
  what: "a scheduled maintenance event",
  dashboardRoute: "/scheduled-maintenance-events/create",
  command: WorkspaceCommandName.Maintenance,
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

    const props: DatabaseCommonInteractionProps | null =
      await this.authorizeSender({
        turnContext: turnContext,
        activity: activity,
        projectId: projectId,
        form: INCIDENT_FORM,
        // Submitting checks the same permission.
        createPermission: {
          modelType: Incident,
          action: "declare an incident",
        },
      });

    if (!props) {
      return;
    }

    let choices: MicrosoftTeamsNewIncidentFormChoices;

    try {
      choices = await MicrosoftTeamsIncidentActions.getNewIncidentFormChoices(
        projectId,
        props,
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
        mdText`An incident needs a severity, and this project has no incident severities yet. Add one in OneUptime under ${
          severitySettingsUrl
            ? mdText`[Incidents → Settings → Incident Severity](${severitySettingsUrl})`
            : "Incidents → Settings → Incident Severity"
        }, then try again.`.toString(),
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

    const props: DatabaseCommonInteractionProps | null =
      await this.authorizeSender({
        turnContext: turnContext,
        activity: activity,
        projectId: projectId,
        form: SCHEDULED_MAINTENANCE_FORM,
        // Submitting checks the same permission.
        createPermission: {
          modelType: ScheduledMaintenance,
          action: "create a scheduled maintenance event",
        },
      });

    if (!props) {
      return;
    }

    let choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices;

    try {
      choices =
        await MicrosoftTeamsScheduledMaintenanceActions.getNewScheduledMaintenanceFormChoices(
          projectId,
          props,
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

  /*
   * The sender's own props when they may fill the form in: a connected
   * account of a current member who may create the thing. Otherwise the
   * sender is told why (no connected account, not a project member, no
   * permission) and this returns null (MicrosoftTeamsCommands).
   */
  private static async authorizeSender(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
    form: CreateFormText;
    createPermission: {
      modelType: DatabaseBaseModelType;
      action: string;
    };
  }): Promise<DatabaseCommonInteractionProps | null> {
    return await MicrosoftTeamsCommands.authorizeSender({
      turnContext: data.turnContext,
      activity: data.activity,
      projectId: data.projectId,
      does: `open the form to create ${data.form.what}`,
      commandName: "create",
      connect: {
        purpose: data.createPermission.action,
        command: data.form.command,
      },
      createPermission: data.createPermission,
    });
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
      mdText`Sorry, I couldn't open the form to create ${data.form.what} because OneUptime could not load the lists it needs just now. Please try again in a minute, ${this.getCreateInOneUptimeHint(
        createInOneUptimeUrl,
        "or create it",
      )}`.toString(),
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
      return mdText`Sorry, I couldn't open the form to create ${data.form.what}: Microsoft Teams refused it as too large, even without the lists of ${data.form.lists}. ${createInOneUptime}`.toString();
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

    return mdText`Sorry, I couldn't open the form to create ${data.form.what}: Microsoft Teams did not accept it${
      teamsReason ? mdText` (${teamsReason})` : ""
    }. ${createInOneUptime}`.toString();
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
