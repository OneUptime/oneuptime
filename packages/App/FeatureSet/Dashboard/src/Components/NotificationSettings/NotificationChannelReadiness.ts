import {
  EnabledProjectChannels,
  ProjectNotificationChannel,
} from "../NotificationMethods/ProjectNotificationChannelsCopy";
import { fetchProjectNotificationChannels } from "../NotificationMethods/ProjectNotificationChannels";
import {
  NotificationMethodsTab,
  getNotificationMethodsTabQuery,
} from "../NotificationMethods/NotificationMethodsTabQuery";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import UserMattermost from "Common/Models/DatabaseModels/UserMattermost";
import UserMicrosoftTeams from "Common/Models/DatabaseModels/UserMicrosoftTeams";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import UserSlack from "Common/Models/DatabaseModels/UserSlack";
import UserTelegram from "Common/Models/DatabaseModels/UserTelegram";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "Common/Models/DatabaseModels/UserWhatsApp";
import Route from "Common/Types/API/Route";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import GlobalConfigUtil, {
  GlobalConfigVars,
} from "Common/UI/Utils/GlobalConfig";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

/*
 * CAN THIS CHANNEL REACH YOU YET?
 *
 * A switch in Notification Settings turns a channel on for an event, and the
 * update then goes to every verified method the person has on that channel
 * in this project (UserNotificationSettingService). A switch on a channel
 * with nothing behind it - no verified phone number for SMS, no registered
 * device for push - turned "on" just the same and sent nothing, and nothing
 * on the page said so (the setup checklist's "Your notification settings
 * point at channels that work" was the only place that did).
 *
 * So the page asks, once, what can reach the person, channel by channel:
 *
 *   Ready     - a verified method on it, and nothing turned it off;
 *   NotSetUp  - no verified method of theirs on it here yet: they can add
 *               one in Notification Methods;
 *   TurnedOff - the project has the channel off (SMS, calls, WhatsApp and
 *               Telegram cost money, and a project switches them on), or the
 *               server has push notifications off;
 *   Unknown   - it could not be checked. "We could not check" is never
 *               "off": such a channel is offered as it always was, and the
 *               server decides (ProjectNotificationChannels says the same of
 *               the project's switches).
 *
 * A channel that can reach the person is a column of the matrix. One that
 * cannot is not offered for new switches: it is listed under "Not set up
 * yet" with a link to set it up, and is a column only of a card where one
 * of its switches is already on, so that switch can be turned off.
 *
 * Custom channels are the server's: there is nothing of the person's behind
 * them to set up, so their column is Ready whenever it is shown.
 *
 * The answer is the person's own method rows, counted as they are now - not
 * the on-call readiness summary, which the server caches for a minute and
 * would still say "not set up" right after somebody verified their phone in
 * the next tab and came back.
 */

export type NotificationChannelKey =
  | "alertByEmail"
  | "alertBySMS"
  | "alertByCall"
  | "alertByPush"
  | "alertByWhatsApp"
  | "alertByTelegram"
  | "alertBySlack"
  | "alertByMicrosoftTeams"
  | "alertByMattermost"
  | "alertByWebhook"
  | "alertByCustomChannel";

// A column of the matrix: the channel, as Notification Settings lists it.
export interface NotificationChannelDefinition {
  key: NotificationChannelKey;
  label: string;
  icon: IconProp;
  color: Color;
  /*
   * Set on the chat workspaces: their column is shown only when the project
   * has connected that workspace, since nothing can reach anybody through a
   * workspace the project never connected.
   */
  workspaceType?: WorkspaceType | undefined;
  /*
   * Set on the custom channels' column: shown only while the server has a
   * custom channel on, since nothing goes through one it does not have.
   */
  isCustomChannels?: boolean | undefined;
}

export enum ChannelReach {
  Ready = "Ready",
  NotSetUp = "NotSetUp",
  TurnedOff = "TurnedOff",
  Unknown = "Unknown",
}

// What the page reads to answer, channel by channel.
export interface ChannelReadinessFacts {
  /*
   * How many verified methods the person has on each channel in this
   * project (a webhook needs no verifying), or null where it could not be
   * read.
   */
  verifiedMethodCounts: Partial<Record<NotificationChannelKey, number | null>>;
  // The project's four paid channels; null when they could not be read.
  projectChannels: Readonly<EnabledProjectChannels> | null;
  // Whether the server has push notifications off; null when not known.
  isPushTurnedOff: boolean | null;
}

// Nothing could be checked: every channel is offered, as before.
export const UNKNOWN_CHANNEL_READINESS: ChannelReadinessFacts = Object.freeze({
  verifiedMethodCounts: {},
  projectChannels: null,
  isPushTurnedOff: null,
});

// The channels a project switches on and off (ProjectNotificationChannelsCopy).
const PROJECT_CHANNEL_BY_KEY: Readonly<
  Partial<Record<NotificationChannelKey, ProjectNotificationChannel>>
> = {
  alertBySMS: ProjectNotificationChannel.SMS,
  alertByCall: ProjectNotificationChannel.Call,
  alertByWhatsApp: ProjectNotificationChannel.WhatsApp,
  alertByTelegram: ProjectNotificationChannel.Telegram,
};

export const getChannelReach: (
  channel: NotificationChannelKey,
  facts: ChannelReadinessFacts,
) => ChannelReach = (
  channel: NotificationChannelKey,
  facts: ChannelReadinessFacts,
): ChannelReach => {
  if (channel === "alertByCustomChannel") {
    return ChannelReach.Ready;
  }

  const projectChannel: ProjectNotificationChannel | undefined =
    PROJECT_CHANNEL_BY_KEY[channel];

  if (
    projectChannel &&
    facts.projectChannels &&
    !facts.projectChannels[projectChannel]
  ) {
    return ChannelReach.TurnedOff;
  }

  if (channel === "alertByPush" && facts.isPushTurnedOff === true) {
    return ChannelReach.TurnedOff;
  }

  const count: number | null | undefined = facts.verifiedMethodCounts[channel];

  if (count === null || count === undefined) {
    return ChannelReach.Unknown;
  }

  return count > 0 ? ChannelReach.Ready : ChannelReach.NotSetUp;
};

/*
 * Whether a channel takes new switches: one that can reach the person, or
 * one nobody could check.
 */
export const canChannelReach: (reach: ChannelReach) => boolean = (
  reach: ChannelReach,
): boolean => {
  return reach === ChannelReach.Ready || reach === ChannelReach.Unknown;
};

/*
 * Whether a card shows a channel's column: a channel that can reach the
 * person always; one that cannot only while one of the card's switches on
 * it is on, so it can be turned off (and says why it sends nothing).
 */
export const isChannelColumnShown: (data: {
  reach: ChannelReach;
  isOnForAnEvent: boolean;
}) => boolean = (data: {
  reach: ChannelReach;
  isOnForAnEvent: boolean;
}): boolean => {
  return canChannelReach(data.reach) || data.isOnForAnEvent;
};

/*
 * Where a channel is set up: the tab of Notification Methods it is on.
 * Custom channels are the server's, with nothing to set up.
 */
export const getChannelSetUpTab: (
  channel: NotificationChannelKey,
) => NotificationMethodsTab | null = (
  channel: NotificationChannelKey,
): NotificationMethodsTab | null => {
  switch (channel) {
    case "alertByEmail":
    case "alertBySMS":
    case "alertByCall":
    case "alertByWhatsApp":
    case "alertByTelegram":
      return NotificationMethodsTab.DirectContact;
    case "alertBySlack":
    case "alertByMicrosoftTeams":
    case "alertByMattermost":
      return NotificationMethodsTab.WorkspaceApps;
    case "alertByPush":
      return NotificationMethodsTab.PushNotifications;
    case "alertByWebhook":
      return NotificationMethodsTab.Webhooks;
    case "alertByCustomChannel":
      return null;
  }
};

// The address that sets a channel up, populated for the current project.
export const getChannelSetUpRoute: (
  channel: NotificationChannelKey,
) => Route | null = (channel: NotificationChannelKey): Route | null => {
  const tab: NotificationMethodsTab | null = getChannelSetUpTab(channel);

  if (!tab) {
    return null;
  }

  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_METHODS] as Route,
  );
  const query: Record<string, string> = getNotificationMethodsTabQuery(tab);

  return Object.keys(query).length > 0 ? route.addQueryParams(query) : route;
};

type CountMethods = (data: {
  projectId: ObjectID;
  userId: ObjectID;
}) => Promise<number>;

/*
 * The person's verified methods on each channel in this project, as the
 * server picks them to send to: isVerified, except a webhook, which has
 * nothing to verify. Custom channels have none.
 */
const METHOD_COUNTS: ReadonlyArray<{
  channel: NotificationChannelKey;
  count: CountMethods;
}> = [
  {
    channel: "alertByEmail",
    count: (data: { projectId: ObjectID; userId: ObjectID }) => {
      return ModelAPI.count<UserEmail>({
        modelType: UserEmail,
        query: {
          projectId: data.projectId,
          userId: data.userId,
          isVerified: true,
        },
      });
    },
  },
  {
    channel: "alertBySMS",
    count: (data: { projectId: ObjectID; userId: ObjectID }) => {
      return ModelAPI.count<UserSMS>({
        modelType: UserSMS,
        query: {
          projectId: data.projectId,
          userId: data.userId,
          isVerified: true,
        },
      });
    },
  },
  {
    channel: "alertByCall",
    count: (data: { projectId: ObjectID; userId: ObjectID }) => {
      return ModelAPI.count<UserCall>({
        modelType: UserCall,
        query: {
          projectId: data.projectId,
          userId: data.userId,
          isVerified: true,
        },
      });
    },
  },
  {
    channel: "alertByPush",
    count: (data: { projectId: ObjectID; userId: ObjectID }) => {
      return ModelAPI.count<UserPush>({
        modelType: UserPush,
        query: {
          projectId: data.projectId,
          userId: data.userId,
          isVerified: true,
        },
      });
    },
  },
  {
    channel: "alertByWhatsApp",
    count: (data: { projectId: ObjectID; userId: ObjectID }) => {
      return ModelAPI.count<UserWhatsApp>({
        modelType: UserWhatsApp,
        query: {
          projectId: data.projectId,
          userId: data.userId,
          isVerified: true,
        },
      });
    },
  },
  {
    channel: "alertByTelegram",
    count: (data: { projectId: ObjectID; userId: ObjectID }) => {
      return ModelAPI.count<UserTelegram>({
        modelType: UserTelegram,
        query: {
          projectId: data.projectId,
          userId: data.userId,
          isVerified: true,
        },
      });
    },
  },
  {
    channel: "alertBySlack",
    count: (data: { projectId: ObjectID; userId: ObjectID }) => {
      return ModelAPI.count<UserSlack>({
        modelType: UserSlack,
        query: {
          projectId: data.projectId,
          userId: data.userId,
          isVerified: true,
        },
      });
    },
  },
  {
    channel: "alertByMicrosoftTeams",
    count: (data: { projectId: ObjectID; userId: ObjectID }) => {
      return ModelAPI.count<UserMicrosoftTeams>({
        modelType: UserMicrosoftTeams,
        query: {
          projectId: data.projectId,
          userId: data.userId,
          isVerified: true,
        },
      });
    },
  },
  {
    channel: "alertByMattermost",
    count: (data: { projectId: ObjectID; userId: ObjectID }) => {
      return ModelAPI.count<UserMattermost>({
        modelType: UserMattermost,
        query: {
          projectId: data.projectId,
          userId: data.userId,
          isVerified: true,
        },
      });
    },
  },
  {
    channel: "alertByWebhook",
    count: (data: { projectId: ObjectID; userId: ObjectID }) => {
      return ModelAPI.count<UserWebhook>({
        modelType: UserWebhook,
        query: {
          projectId: data.projectId,
          userId: data.userId,
        },
      });
    },
  },
];

export type NotificationChannelReadinessFetcher = (data: {
  projectId: ObjectID;
  userId: ObjectID;
}) => Promise<ChannelReadinessFacts>;

/*
 * Every read on its own: one refused (a permission, a timeout) leaves its
 * channel Unknown and the others answered.
 */
export const fetchNotificationChannelReadiness: NotificationChannelReadinessFetcher =
  async (data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<ChannelReadinessFacts> => {
    const [counts, projectChannels, isPushTurnedOff]: [
      Array<number | null>,
      EnabledProjectChannels | null,
      boolean | null,
    ] = await Promise.all([
      Promise.all(
        METHOD_COUNTS.map(
          async (method: {
            channel: NotificationChannelKey;
            count: CountMethods;
          }): Promise<number | null> => {
            try {
              return await method.count(data);
            } catch {
              return null;
            }
          },
        ),
      ),
      fetchProjectNotificationChannels(data.projectId).catch((): null => {
        return null;
      }),
      GlobalConfigUtil.fetchVars()
        .then((vars: GlobalConfigVars): boolean => {
          return vars.disablePushNotifications === true;
        })
        .catch((): null => {
          return null;
        }),
    ]);

    const verifiedMethodCounts: Partial<
      Record<NotificationChannelKey, number | null>
    > = {};

    METHOD_COUNTS.forEach(
      (
        method: { channel: NotificationChannelKey; count: CountMethods },
        index: number,
      ): void => {
        verifiedMethodCounts[method.channel] = counts[index] ?? null;
      },
    );

    return {
      verifiedMethodCounts: verifiedMethodCounts,
      projectChannels: projectChannels,
      isPushTurnedOff: isPushTurnedOff,
    };
  };

/*
 * Where the answers come from. Tests hand in their own; null puts the server
 * back.
 */
export default class NotificationChannelReadiness {
  private static fetcher: NotificationChannelReadinessFetcher =
    fetchNotificationChannelReadiness;

  public static setFetcher(
    fetcher: NotificationChannelReadinessFetcher | null,
  ): void {
    NotificationChannelReadiness.fetcher =
      fetcher || fetchNotificationChannelReadiness;
  }

  public static read(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<ChannelReadinessFacts> {
    return NotificationChannelReadiness.fetcher(data);
  }
}

/*
 * The facts for a component: null while they are on their way, and
 * UNKNOWN_CHANNEL_READINESS when they could not be read at all. Read again
 * whenever the page is opened, so a phone verified a moment ago counts.
 */
export const useNotificationChannelReadiness: (data: {
  projectId: ObjectID | null;
  userId: ObjectID | null;
}) => ChannelReadinessFacts | null = (data: {
  projectId: ObjectID | null;
  userId: ObjectID | null;
}): ChannelReadinessFacts | null => {
  const [facts, setFacts] = useState<ChannelReadinessFacts | null>(null);
  const projectKey: string = data.projectId?.toString() || "";
  const userKey: string = data.userId?.toString() || "";

  useEffect(() => {
    let isMounted: boolean = true;

    if (!projectKey || !userKey) {
      setFacts(UNKNOWN_CHANNEL_READINESS);
      return;
    }

    setFacts(null);

    NotificationChannelReadiness.read({
      projectId: new ObjectID(projectKey),
      userId: new ObjectID(userKey),
    })
      .then((answer: ChannelReadinessFacts) => {
        if (isMounted) {
          setFacts(answer);
        }
      })
      .catch(() => {
        if (isMounted) {
          setFacts(UNKNOWN_CHANNEL_READINESS);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [projectKey, userKey]);

  return facts;
};
