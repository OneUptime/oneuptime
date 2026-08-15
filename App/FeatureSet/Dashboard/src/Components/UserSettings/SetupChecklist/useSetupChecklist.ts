import {
  CustomFieldProbe,
  DeliverableSettingsProbe,
  IncomingCallProbe,
  OnCallShiftAlertProbe,
  SetupChecklist,
  WorkspaceProbe,
  buildSetupChecklist,
} from "./ChecklistModel";
import {
  ReadinessMethodWire,
  ReadinessSummaryWire,
  UserReadinessWire,
  getVerifiedMethods,
  parseReadinessSummary,
} from "../../OnCallPolicy/Readiness/ReadinessTypes";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectUserProfile from "Common/Models/DatabaseModels/ProjectUserProfile";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import UserIncomingCallNumber from "Common/Models/DatabaseModels/UserIncomingCallNumber";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useCallback, useEffect, useState } from "react";

/*
 * Everything the setup checklist needs, loaded in one pass.
 *
 * THE SHAPE OF THE LOAD IS THE POINT. There is exactly one REQUIRED request -
 * the per-user readiness payload - and everything else is a PROBE that is
 * allowed to fail on its own without taking the page with it. That split is
 * deliberate:
 *
 *   - readiness is the whole paging half of the checklist, and there is no
 *     honest way to draw the page without it. If it fails the page says so.
 *   - every other request answers ONE optional row. A reader whose permissions
 *     do not stretch to reading the project's incoming call policies should
 *     still see their notification methods and rules; losing the whole page
 *     over a row they may not even need is a worse outcome than omitting it.
 *
 * So each probe is its own try/catch and reports `isKnown: false` when it
 * fails. The model layer turns an unknown probe into NO step, never into a step
 * claiming the reader has not done something. "We could not check" and "you
 * have not done it" are different statements, and only one of them is a task.
 *
 * WHY NOT ONE ENDPOINT. Readiness already exists, is cached server-side for
 * 60 seconds, and is the same payload the admin readiness surfaces render - so
 * this page and the admin's cannot disagree about whether somebody is
 * reachable. The remaining probes are ordinary model reads, each already
 * permitted to the signed-in user by the same access control that lets them
 * open the page the probe is about. Adding a bespoke aggregate endpoint would
 * have meant a second implementation of readiness' rules on the server, which
 * is precisely the drift this reuses its way out of.
 */

export interface SetupChecklistState {
  isLoading: boolean;
  /** Non-empty only when the REQUIRED readiness read failed. */
  error: string;
  checklist: SetupChecklist | null;
  reload: () => Promise<void>;
}

export interface UseSetupChecklistOptions {
  userId: ObjectID | null;
  projectId: ObjectID | null;
}

/*
 * Notification Settings' seven channel columns, paired with the readiness
 * method type that makes each one deliverable.
 *
 * This pairing is the entire "your settings point at channels that work" check.
 * The settings page will happily turn a switch green for a channel the reader
 * has no address on, and nothing on that page ever says the resulting mail goes
 * nowhere.
 */
interface SettingChannel {
  column: keyof UserNotificationSetting;
  methodType: string;
  label: string;
}

const SETTING_CHANNELS: Array<SettingChannel> = [
  { column: "alertByEmail", methodType: "Email", label: "Email" },
  { column: "alertBySMS", methodType: "SMS", label: "SMS" },
  { column: "alertByCall", methodType: "Call", label: "Call" },
  { column: "alertByPush", methodType: "Push", label: "Push" },
  { column: "alertByWhatsApp", methodType: "WhatsApp", label: "WhatsApp" },
  { column: "alertByTelegram", methodType: "Telegram", label: "Telegram" },
  { column: "alertByWebhook", methodType: "Webhook", label: "Webhook" },
];

/*
 * The unknown answer for each probe, named once so that a `catch` cannot
 * accidentally invent a more optimistic default than the one intended.
 */
const UNKNOWN_ON_CALL_SHIFT_ALERTS: OnCallShiftAlertProbe = {
  isKnown: false,
  hasAnyChannelEnabled: false,
};

const UNKNOWN_DELIVERABLE_SETTINGS: DeliverableSettingsProbe = {
  isKnown: false,
  undeliverableChannels: [],
};

const UNKNOWN_INCOMING_CALL: IncomingCallProbe = {
  isKnown: false,
  hasPolicyInProject: false,
  hasVerifiedNumber: false,
};

const UNKNOWN_WORKSPACE: WorkspaceProbe = {
  isKnown: false,
  isConnectedForProject: false,
  isConnectedForUser: false,
};

const UNKNOWN_CUSTOM_FIELDS: CustomFieldProbe = {
  isKnown: false,
  fieldCount: 0,
  filledFieldCount: 0,
};

interface NotificationSettingProbes {
  onCallShiftAlerts: OnCallShiftAlertProbe;
  deliverableSettings: DeliverableSettingsProbe;
}

/**
 * Which of the seven channels this project has switched OFF, as readiness
 * method types.
 *
 * Only the four paid channels can be switched off; Push, Email and Webhook are
 * never gated. `isKnown: false` means the project row could not be read, and
 * the deliverability check then falls back to verified-only rather than
 * inventing a switch state - it will under-warn rather than warn about a
 * channel that is actually fine.
 */
interface EnabledChannelsProbe {
  isKnown: boolean;
  disabledMethodTypes: Array<string>;
}

interface ProjectSettingsProbe {
  isKnown: boolean;
  isFallbackEnabled: boolean;
  disabledMethodTypes: Array<string>;
}

type LoadProjectSettingsFunction = (
  projectId: ObjectID,
) => Promise<ProjectSettingsProbe>;

/*
 * The four channel switches all default to FALSE on a Project, which is why
 * this read is worth making at all: in a project that has never turned SMS on,
 * a responder whose only verified method is SMS is unreachable, and both the
 * headline and the deliverability row have to say so.
 */
const loadProjectSettings: LoadProjectSettingsFunction = async (
  projectId: ObjectID,
): Promise<ProjectSettingsProbe> => {
  try {
    const project: Project | null = await ModelAPI.getItem<Project>({
      modelType: Project,
      id: projectId,
      select: {
        disableOnCallNotificationFallback: true,
        enableSmsNotifications: true,
        enableCallNotifications: true,
        enableWhatsAppNotifications: true,
        enableTelegramNotifications: true,
      },
    });

    const disabled: Array<string> = [];

    if (!project?.enableSmsNotifications) {
      disabled.push("SMS");
    }

    if (!project?.enableCallNotifications) {
      disabled.push("Call");
    }

    if (!project?.enableWhatsAppNotifications) {
      disabled.push("WhatsApp");
    }

    if (!project?.enableTelegramNotifications) {
      disabled.push("Telegram");
    }

    return {
      isKnown: true,
      isFallbackEnabled: !project?.disableOnCallNotificationFallback,
      disabledMethodTypes: disabled,
    };
  } catch {
    return {
      isKnown: false,
      isFallbackEnabled: true,
      disabledMethodTypes: [],
    };
  }
};

type LoadNotificationSettingsFunction = (params: {
  projectId: ObjectID;
  userId: ObjectID;
  readiness: UserReadinessWire;
  enabledChannels: EnabledChannelsProbe;
}) => Promise<NotificationSettingProbes>;

/*
 * One read serving two steps. The rows are small, there are at most a few dozen
 * of them, and both questions are answered by looking at the same seven columns
 * - so splitting this into two requests would double the cost to ask the same
 * table the same thing twice.
 */
const loadNotificationSettingProbes: LoadNotificationSettingsFunction =
  async (params: {
    projectId: ObjectID;
    userId: ObjectID;
    readiness: UserReadinessWire;
    enabledChannels: EnabledChannelsProbe;
  }): Promise<NotificationSettingProbes> => {
    const result: ListResult<UserNotificationSetting> =
      await ModelAPI.getList<UserNotificationSetting>({
        modelType: UserNotificationSetting,
        query: {
          projectId: params.projectId,
          userId: params.userId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          eventType: true,
          alertByEmail: true,
          alertBySMS: true,
          alertByCall: true,
          alertByPush: true,
          alertByWhatsApp: true,
          alertByTelegram: true,
          alertByWebhook: true,
        },
        sort: {},
      });

    const rows: Array<UserNotificationSetting> = result.data;

    const rosterRow: UserNotificationSetting | undefined = rows.find(
      (row: UserNotificationSetting): boolean => {
        return (
          row.eventType ===
          NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER
        );
      },
    );

    const hasAnyChannelEnabled: boolean = Boolean(
      rosterRow &&
        SETTING_CHANNELS.some((channel: SettingChannel): boolean => {
          return Boolean(rosterRow[channel.column]);
        }),
    );

    /*
     * A channel counts as deliverable only when the reader has a method on it
     * that is BOTH verified AND on a channel this project has switched on -
     * which is exactly the server's own definition of a usable method
     * (OnCallReadinessService.buildUserReadiness).
     *
     * Both halves matter, and each was a way to get this wrong. An address the
     * reader typed but never confirmed is the case this step exists to surface,
     * so an unverified row must not satisfy it. And readiness deliberately
     * reports a method on a project-disabled channel as `isVerified: true` -
     * the verification really did happen - so filtering on verified alone would
     * score a switched-off channel as working and print a false all-clear to
     * the one person who most needs the warning.
     */
    const usableMethodTypes: Set<string> = new Set<string>(
      getVerifiedMethods(params.readiness)
        .filter((method: ReadinessMethodWire): boolean => {
          return params.enabledChannels.isKnown
            ? !params.enabledChannels.disabledMethodTypes.includes(
                method.methodType,
              )
            : true;
        })
        .map((method: ReadinessMethodWire): string => {
          return method.methodType;
        }),
    );

    const undeliverableChannels: Array<string> = SETTING_CHANNELS.filter(
      (channel: SettingChannel): boolean => {
        if (usableMethodTypes.has(channel.methodType)) {
          return false;
        }

        return rows.some((row: UserNotificationSetting): boolean => {
          return Boolean(row[channel.column]);
        });
      },
    ).map((channel: SettingChannel): string => {
      return channel.label;
    });

    return {
      onCallShiftAlerts: {
        isKnown: true,
        hasAnyChannelEnabled: hasAnyChannelEnabled,
      },
      deliverableSettings: {
        isKnown: true,
        undeliverableChannels: undeliverableChannels,
      },
    };
  };

type LoadIncomingCallFunction = (params: {
  projectId: ObjectID;
  userId: ObjectID;
}) => Promise<IncomingCallProbe>;

const loadIncomingCallProbe: LoadIncomingCallFunction = async (params: {
  projectId: ObjectID;
  userId: ObjectID;
}): Promise<IncomingCallProbe> => {
  const policyCount: number = await ModelAPI.count<IncomingCallPolicy>({
    modelType: IncomingCallPolicy,
    query: {
      projectId: params.projectId,
    },
  });

  /*
   * The reader's own number is only worth asking about when this project
   * routes inbound calls at all, and skipping the second read when it does not
   * keeps the common case to one request.
   */
  if (policyCount === 0) {
    return {
      isKnown: true,
      hasPolicyInProject: false,
      hasVerifiedNumber: false,
    };
  }

  const verifiedNumberCount: number =
    await ModelAPI.count<UserIncomingCallNumber>({
      modelType: UserIncomingCallNumber,
      query: {
        projectId: params.projectId,
        userId: params.userId,
        isVerified: true,
      },
    });

  return {
    isKnown: true,
    hasPolicyInProject: true,
    hasVerifiedNumber: verifiedNumberCount > 0,
  };
};

type LoadWorkspaceFunction = (params: {
  projectId: ObjectID;
  userId: ObjectID;
  workspaceType: WorkspaceType;
}) => Promise<WorkspaceProbe>;

const loadWorkspaceProbe: LoadWorkspaceFunction = async (params: {
  projectId: ObjectID;
  userId: ObjectID;
  workspaceType: WorkspaceType;
}): Promise<WorkspaceProbe> => {
  const projectConnectionCount: number =
    await ModelAPI.count<WorkspaceProjectAuthToken>({
      modelType: WorkspaceProjectAuthToken,
      query: {
        projectId: params.projectId,
        workspaceType: params.workspaceType,
      },
    });

  if (projectConnectionCount === 0) {
    return {
      isKnown: true,
      isConnectedForProject: false,
      isConnectedForUser: false,
    };
  }

  /*
   * Queried by user and workspace type without a project filter, matching what
   * the Slack and Microsoft Teams settings pages themselves do - the row
   * carries a projectId, but those pages treat the personal link as global and
   * a checklist that disagreed with the page it links to would be worse than
   * one that shares its imprecision.
   */
  const userConnectionCount: number =
    await ModelAPI.count<WorkspaceUserAuthToken>({
      modelType: WorkspaceUserAuthToken,
      query: {
        userId: params.userId,
        workspaceType: params.workspaceType,
      },
    });

  return {
    isKnown: true,
    isConnectedForProject: true,
    isConnectedForUser: userConnectionCount > 0,
  };
};

type LoadCustomFieldsFunction = (params: {
  projectId: ObjectID;
  userId: ObjectID;
}) => Promise<CustomFieldProbe>;

const loadCustomFieldProbe: LoadCustomFieldsFunction = async (params: {
  projectId: ObjectID;
  userId: ObjectID;
}): Promise<CustomFieldProbe> => {
  const fields: ListResult<TeamMemberCustomField> =
    await ModelAPI.getList<TeamMemberCustomField>({
      modelType: TeamMemberCustomField,
      query: {
        projectId: params.projectId,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        name: true,
      },
      sort: {},
    });

  if (fields.data.length === 0) {
    return {
      isKnown: true,
      fieldCount: 0,
      filledFieldCount: 0,
    };
  }

  const profiles: ListResult<ProjectUserProfile> =
    await ModelAPI.getList<ProjectUserProfile>({
      modelType: ProjectUserProfile,
      query: {
        projectId: params.projectId,
        userId: params.userId,
      },
      limit: 1,
      skip: 0,
      select: {
        customFields: true,
      },
      sort: {},
    });

  /*
   * Counted by VALUE, never by row existence: opening the Custom Fields page
   * creates an empty ProjectUserProfile as a side effect, so "has a profile
   * row" is true for anyone who has ever looked at the page and says nothing
   * about whether they filled anything in.
   */
  const values: JSONObject = (profiles.data[0]?.customFields ||
    {}) as JSONObject;

  const filledFieldCount: number = fields.data.filter(
    (field: TeamMemberCustomField): boolean => {
      const value: unknown = field.name ? values[field.name] : undefined;

      if (value === undefined || value === null) {
        return false;
      }

      return String(value).trim().length > 0;
    },
  ).length;

  return {
    isKnown: true,
    fieldCount: fields.data.length,
    filledFieldCount: filledFieldCount,
  };
};

const useSetupChecklist: (
  options: UseSetupChecklistOptions,
) => SetupChecklistState = (
  options: UseSetupChecklistOptions,
): SetupChecklistState => {
  /*
   * Keyed on the strings, not the ObjectIDs. Callers build both from global
   * utils on every render, so an ObjectID in the dependency array never
   * compares equal and the effect would refetch forever.
   */
  const userIdString: string = options.userId?.toString() || "";
  const projectIdString: string = options.projectId?.toString() || "";

  const [isLoading, setIsLoading] = useState<boolean>(
    Boolean(userIdString && projectIdString),
  );
  const [error, setError] = useState<string>("");
  const [checklist, setChecklist] = useState<SetupChecklist | null>(null);

  const load: (isRecheck?: boolean) => Promise<void> = useCallback(
    async (isRecheck?: boolean): Promise<void> => {
      if (!userIdString || !projectIdString) {
        return;
      }

      const projectId: ObjectID = new ObjectID(projectIdString);
      const userId: ObjectID = new ObjectID(userIdString);

      setIsLoading(true);
      setError("");

      let readiness: UserReadinessWire;

      try {
        const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
          `/on-call-readiness/user/${userIdString}`,
        );

        /*
         * Readiness is cached server-side for 60 seconds, which is right for a
         * page load and wrong for the Recheck button: the whole reason somebody
         * presses it is that they have just fixed something in another tab, and a
         * button that re-reads a cache computed before the fix reports the old
         * answer and reads as broken. `refresh` is the server's documented
         * bypass. It is deliberately NOT set on the automatic load, where the
         * cache is doing its job.
         */
        if (isRecheck) {
          url.addQueryParam("refresh", "true");
        }

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: url,
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        /*
         * The per-user route answers with a bare UserReadiness rather than a
         * summary, so it is wrapped into the one shape ReadinessTypes knows how
         * to read. Hand-rolling a second reader for this payload is how the two
         * would drift apart the next time the server adds a field.
         */
        const summary: ReadinessSummaryWire = parseReadinessSummary({
          users: [response.data],
        } as JSONObject);

        const parsed: UserReadinessWire | undefined = summary.users[0];

        if (!parsed || !parsed.userId) {
          throw new Error("Could not read your notification setup.");
        }

        readiness = parsed;
      } catch (err) {
        setError(API.getFriendlyMessage(err));
        setChecklist(null);
        setIsLoading(false);
        return;
      }

      /*
       * The project's own switches, read once and used twice: the fallback flag
       * decides whether a rule gap is a delayed page or a lost one, and the four
       * channel flags decide which of the reader's verified methods can actually
       * carry anything.
       *
       * It is awaited BEFORE the probe fan-out rather than inside it because the
       * notification-settings probe genuinely depends on the channel flags - a
       * deliverability answer computed without them scores a switched-off
       * channel as working. The remaining probes do not depend on it and run
       * concurrently below.
       */
      const projectSettings: ProjectSettingsProbe =
        await loadProjectSettings(projectId);

      const isFallbackEnabled: boolean = projectSettings.isFallbackEnabled;
      const isFallbackKnown: boolean = projectSettings.isKnown;

      /*
       * The probes run together rather than in sequence: they are independent
       * reads of different tables and the page waits for the slowest, not the
       * sum. Each resolves to its own unknown value on failure, so one refused
       * request cannot suppress the others.
       */
      const [
        notificationSettings,
        incomingCall,
        slack,
        microsoftTeams,
        customFields,
      ]: [
        NotificationSettingProbes,
        IncomingCallProbe,
        WorkspaceProbe,
        WorkspaceProbe,
        CustomFieldProbe,
      ] = await Promise.all([
        loadNotificationSettingProbes({
          projectId: projectId,
          userId: userId,
          readiness: readiness,
          enabledChannels: {
            isKnown: projectSettings.isKnown,
            disabledMethodTypes: projectSettings.disabledMethodTypes,
          },
        }).catch((): NotificationSettingProbes => {
          return {
            onCallShiftAlerts: UNKNOWN_ON_CALL_SHIFT_ALERTS,
            deliverableSettings: UNKNOWN_DELIVERABLE_SETTINGS,
          };
        }),
        loadIncomingCallProbe({
          projectId: projectId,
          userId: userId,
        }).catch((): IncomingCallProbe => {
          return UNKNOWN_INCOMING_CALL;
        }),
        loadWorkspaceProbe({
          projectId: projectId,
          userId: userId,
          workspaceType: WorkspaceType.Slack,
        }).catch((): WorkspaceProbe => {
          return UNKNOWN_WORKSPACE;
        }),
        loadWorkspaceProbe({
          projectId: projectId,
          userId: userId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }).catch((): WorkspaceProbe => {
          return UNKNOWN_WORKSPACE;
        }),
        loadCustomFieldProbe({
          projectId: projectId,
          userId: userId,
        }).catch((): CustomFieldProbe => {
          return UNKNOWN_CUSTOM_FIELDS;
        }),
      ]);

      setChecklist(
        buildSetupChecklist({
          readiness: readiness,
          isFallbackEnabled: isFallbackEnabled,
          isFallbackKnown: isFallbackKnown,
          onCallShiftAlerts: notificationSettings.onCallShiftAlerts,
          deliverableSettings: notificationSettings.deliverableSettings,
          incomingCall: incomingCall,
          slack: slack,
          microsoftTeams: microsoftTeams,
          customFields: customFields,
        }),
      );

      setIsLoading(false);
    },
    [userIdString, projectIdString],
  );

  useEffect(() => {
    if (!userIdString || !projectIdString) {
      setIsLoading(false);
      setChecklist(null);
      setError("");
      return;
    }

    load().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, [userIdString, projectIdString, load]);

  const recheck: () => Promise<void> = useCallback(async (): Promise<void> => {
    await load(true);
  }, [load]);

  return {
    isLoading: isLoading,
    error: error,
    checklist: checklist,
    reload: recheck,
  };
};

export default useSetupChecklist;
