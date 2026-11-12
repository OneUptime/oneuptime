import { PagingMethodChoice, splitMethodLabel } from "./PagingLadderMethods";
import { loadCustomNotificationChannels } from "../../../Utils/CustomNotificationChannels";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import UserMattermost from "Common/Models/DatabaseModels/UserMattermost";
import UserMicrosoftTeams from "Common/Models/DatabaseModels/UserMicrosoftTeams";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import UserSlack from "Common/Models/DatabaseModels/UserSlack";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import UserTelegram from "Common/Models/DatabaseModels/UserTelegram";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "Common/Models/DatabaseModels/UserWhatsApp";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import {
  PAGING_LADDER_APPLY_ROUTE,
  PagingLadderCell,
  PagingLadderRule,
  PagingLadderStep,
  PagingMethodColumn,
  getChannelForPagingMethodColumn,
  getPagingLadderCells,
} from "Common/Types/NotificationRule/PagingLadder";
import ObjectID from "Common/Types/ObjectID";
import { isExpoPushDeviceType } from "Common/Types/PushNotification/ExpoPushDeviceType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import NotificationMethodUtil from "Common/UI/Utils/NotificationMethodUtil";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * WHAT HOW TO REACH ME READS AND WRITES (#6820).
 *
 * Reads: the project's severities (the grid's cards), the person's rules -
 * their ids and method ids only, never a method's number or address, so an
 * admin's view of a member reads nothing readiness did not already mask -
 * and, on your own page, your methods.
 *
 * Writes: a ladder, in one request (POST /paging-ladder/apply), which the
 * server turns into the rows of every card (PagingLadderService).
 */

export interface PagingLadderData {
  cells: Array<PagingLadderCell>;
  rules: Array<PagingLadderRule>;
  // By severity id: the colour each card's title draws.
  severityColors: Record<string, string>;
}

// What a save did, as the server says.
export interface PagingLadderSaveResult {
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  unchangedCount: number;
}

// The columns a ladder reads off a rule: ids, never a method's identifier.
export const PAGING_LADDER_RULE_SELECT: Record<string, boolean> = {
  _id: true,
  ruleType: true,
  incidentSeverityId: true,
  alertSeverityId: true,
  notifyAfterMinutes: true,
  isOptOut: true,
  pushNotificationLevel: true,
  repeatEveryMinutes: true,
  userEmailId: true,
  userSmsId: true,
  userCallId: true,
  userPushId: true,
  userWhatsAppId: true,
  userTelegramId: true,
  userSlackId: true,
  userMicrosoftTeamsId: true,
  userMattermostId: true,
  userWebhookId: true,
  customNotificationChannelId: true,
};

export class PagingLadderSaveError extends Error {}

const readSeverities: (
  modelType: typeof IncidentSeverity | typeof AlertSeverity,
) => Promise<Array<IncidentSeverity | AlertSeverity>> = async (
  modelType: typeof IncidentSeverity | typeof AlertSeverity,
): Promise<Array<IncidentSeverity | AlertSeverity>> => {
  const result: ListResult<IncidentSeverity | AlertSeverity> =
    await ModelAPI.getList<IncidentSeverity | AlertSeverity>({
      modelType: modelType,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        name: true,
        color: true,
        isArchived: true,
      },
      // Most severe first, as the project's severity settings list them.
      sort: {
        order: SortOrder.Ascending,
      },
    });

  return result.data;
};

export const loadPagingLadderData: (
  userId: ObjectID,
) => Promise<PagingLadderData> = async (
  userId: ObjectID,
): Promise<PagingLadderData> => {
  const [incidentSeverities, alertSeverities, ruleList]: [
    Array<IncidentSeverity | AlertSeverity>,
    Array<IncidentSeverity | AlertSeverity>,
    ListResult<UserNotificationRule>,
  ] = await Promise.all([
    readSeverities(IncidentSeverity),
    readSeverities(AlertSeverity),
    ModelAPI.getList<UserNotificationRule>({
      modelType: UserNotificationRule,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
        userId: userId,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: PAGING_LADDER_RULE_SELECT as never,
      sort: {},
    }),
  ]);

  const severityColors: Record<string, string> = {};

  for (const severity of [...incidentSeverities, ...alertSeverities]) {
    if (severity.id && severity.color) {
      severityColors[severity.id.toString()] = severity.color.toString();
    }
  }

  return {
    cells: getPagingLadderCells({
      incidentSeverities: incidentSeverities,
      alertSeverities: alertSeverities,
    }),
    rules: ruleList.data as unknown as Array<PagingLadderRule>,
    severityColors: severityColors,
  };
};

const toChoice: (data: {
  column: PagingMethodColumn;
  model: BaseModel;
  isVerified: boolean;
  hasPushLevel?: boolean | undefined;
}) => PagingMethodChoice | null = (data: {
  column: PagingMethodColumn;
  model: BaseModel;
  isVerified: boolean;
  hasPushLevel?: boolean | undefined;
}): PagingMethodChoice | null => {
  if (!data.model.id) {
    return null;
  }

  const label: { title: string; identifier: string } = splitMethodLabel(
    NotificationMethodUtil.getLabel(data.model),
  );

  return {
    methodColumn: data.column,
    methodId: data.model.id.toString(),
    channel: getChannelForPagingMethodColumn(data.column),
    title: label.title,
    identifier: label.identifier,
    isVerified: data.isVerified,
    hasPushLevel: Boolean(data.hasPushLevel),
  };
};

/*
 * Your own methods: every verified one, and the emails and phone numbers
 * still waiting for their code, which the ladder offers to verify there.
 */
export const loadOwnPagingMethods: (
  userId: ObjectID,
) => Promise<Array<PagingMethodChoice>> = async (
  userId: ObjectID,
): Promise<Array<PagingMethodChoice>> => {
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  const list: <TModel extends BaseModel>(data: {
    modelType: { new (): TModel };
    select: JSONObject;
    verifiedOnly: boolean;
  }) => Promise<Array<TModel>> = async <TModel extends BaseModel>(data: {
    modelType: { new (): TModel };
    select: JSONObject;
    verifiedOnly: boolean;
  }): Promise<Array<TModel>> => {
    const result: ListResult<TModel> = await ModelAPI.getList<TModel>({
      modelType: data.modelType,
      query: {
        projectId: projectId,
        userId: userId,
        ...(data.verifiedOnly ? { isVerified: true } : {}),
      } as never,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: data.select as never,
      sort: {},
    });

    return result.data;
  };

  const [
    emails,
    smses,
    calls,
    whatsApps,
    pushDevices,
    telegrams,
    slacks,
    teamsAccounts,
    mattermostAccounts,
    webhooks,
  ]: [
    Array<UserEmail>,
    Array<UserSMS>,
    Array<UserCall>,
    Array<UserWhatsApp>,
    Array<UserPush>,
    Array<UserTelegram>,
    Array<UserSlack>,
    Array<UserMicrosoftTeams>,
    Array<UserMattermost>,
    Array<UserWebhook>,
  ] = await Promise.all([
    list<UserEmail>({
      modelType: UserEmail,
      select: { email: true, isVerified: true },
      verifiedOnly: false,
    }),
    list<UserSMS>({
      modelType: UserSMS,
      select: { phone: true, isVerified: true },
      verifiedOnly: false,
    }),
    list<UserCall>({
      modelType: UserCall,
      select: { phone: true, isVerified: true },
      verifiedOnly: false,
    }),
    list<UserWhatsApp>({
      modelType: UserWhatsApp,
      select: { phone: true, isVerified: true },
      verifiedOnly: false,
    }),
    list<UserPush>({
      modelType: UserPush,
      select: { deviceName: true, deviceType: true },
      verifiedOnly: true,
    }),
    list<UserTelegram>({
      modelType: UserTelegram,
      select: { telegramUserHandle: true, telegramChatId: true },
      verifiedOnly: true,
    }),
    list<UserSlack>({
      modelType: UserSlack,
      select: { slackUserName: true, slackUserId: true },
      verifiedOnly: true,
    }),
    list<UserMicrosoftTeams>({
      modelType: UserMicrosoftTeams,
      select: { microsoftTeamsUserName: true, microsoftTeamsUserId: true },
      verifiedOnly: true,
    }),
    list<UserMattermost>({
      modelType: UserMattermost,
      select: { mattermostUserName: true, mattermostUserId: true },
      verifiedOnly: true,
    }),
    // Webhooks have no verification step: every one is usable.
    list<UserWebhook>({
      modelType: UserWebhook,
      select: { name: true },
      verifiedOnly: false,
    }),
  ]);

  /*
   * The server's custom channels, which nobody owns, never waited for: a
   * list that cannot be read leaves the rest as it is.
   */
  let customChannels: Array<CustomNotificationChannel> = [];

  try {
    customChannels = await loadCustomNotificationChannels();
  } catch {
    customChannels = [];
  }

  const choices: Array<PagingMethodChoice | null> = [
    ...pushDevices.map((model: UserPush) => {
      return toChoice({
        column: "userPushId",
        model: model,
        isVerified: true,
        hasPushLevel: isExpoPushDeviceType(model.deviceType),
      });
    }),
    ...emails.map((model: UserEmail) => {
      return toChoice({
        column: "userEmailId",
        model: model,
        isVerified: Boolean(model.isVerified),
      });
    }),
    ...slacks.map((model: UserSlack) => {
      return toChoice({
        column: "userSlackId",
        model: model,
        isVerified: true,
      });
    }),
    ...teamsAccounts.map((model: UserMicrosoftTeams) => {
      return toChoice({
        column: "userMicrosoftTeamsId",
        model: model,
        isVerified: true,
      });
    }),
    ...mattermostAccounts.map((model: UserMattermost) => {
      return toChoice({
        column: "userMattermostId",
        model: model,
        isVerified: true,
      });
    }),
    ...telegrams.map((model: UserTelegram) => {
      return toChoice({
        column: "userTelegramId",
        model: model,
        isVerified: true,
      });
    }),
    ...whatsApps.map((model: UserWhatsApp) => {
      return toChoice({
        column: "userWhatsAppId",
        model: model,
        isVerified: Boolean(model.isVerified),
      });
    }),
    ...smses.map((model: UserSMS) => {
      return toChoice({
        column: "userSmsId",
        model: model,
        isVerified: Boolean(model.isVerified),
      });
    }),
    ...calls.map((model: UserCall) => {
      return toChoice({
        column: "userCallId",
        model: model,
        isVerified: Boolean(model.isVerified),
      });
    }),
    ...webhooks.map((model: UserWebhook) => {
      return toChoice({
        column: "userWebhookId",
        model: model,
        isVerified: true,
      });
    }),
    ...customChannels.map((model: CustomNotificationChannel) => {
      return toChoice({
        column: "customNotificationChannelId",
        model: model,
        isVerified: true,
      });
    }),
  ];

  return choices.filter(
    (choice: PagingMethodChoice | null): choice is PagingMethodChoice => {
      return choice !== null;
    },
  );
};

// The body a save sends: the person (left out for your own) and the steps.
export const getPagingLadderSaveBody: (data: {
  userId?: ObjectID | undefined;
  steps: ReadonlyArray<PagingLadderStep>;
}) => JSONObject = (data: {
  userId?: ObjectID | undefined;
  steps: ReadonlyArray<PagingLadderStep>;
}): JSONObject => {
  const body: JSONObject = {
    steps: data.steps.map((step: PagingLadderStep): JSONObject => {
      const sent: JSONObject = {
        methodColumn: step.methodColumn,
        methodId: step.methodId,
        notifyAfterMinutes: step.notifyAfterMinutes,
      };

      if (step.methodColumn === "userPushId") {
        if (step.pushNotificationLevel) {
          sent["pushNotificationLevel"] = step.pushNotificationLevel;
        }

        if (step.repeatEveryMinutes !== undefined) {
          sent["repeatEveryMinutes"] = step.repeatEveryMinutes;
        }
      }

      return sent;
    }),
  };

  if (data.userId) {
    body["userId"] = data.userId.toString();
  }

  return body;
};

export const savePagingLadder: (data: {
  userId?: ObjectID | undefined;
  steps: ReadonlyArray<PagingLadderStep>;
}) => Promise<PagingLadderSaveResult> = async (data: {
  userId?: ObjectID | undefined;
  steps: ReadonlyArray<PagingLadderStep>;
}): Promise<PagingLadderSaveResult> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        PAGING_LADDER_APPLY_ROUTE,
      ),
      data: getPagingLadderSaveBody(data),
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw new PagingLadderSaveError(API.getFriendlyMessage(response));
  }

  const body: JSONObject = (response.data || {}) as JSONObject;

  return {
    createdCount: Number(body["createdCount"]) || 0,
    updatedCount: Number(body["updatedCount"]) || 0,
    deletedCount: Number(body["deletedCount"]) || 0,
    unchangedCount: Number(body["unchangedCount"]) || 0,
  };
};
