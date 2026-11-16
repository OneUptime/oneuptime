import NotificationChannelReadiness, {
  ChannelReadinessFacts,
  NotificationChannelKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationSettings/NotificationChannelReadiness";
import { EnabledProjectChannels } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import { ProjectNotificationChannel } from "../../../Utils/Project/NotificationChannels";

/*
 * What can reach the person, for Notification Settings
 * (Components/NotificationSettings/NotificationChannelReadiness), answered
 * from what the test says instead of the method tables, the project row and
 * the server's config.
 *
 * Left alone, every channel has a verified method and every project channel
 * is on: the matrix offers every column, as it did before it asked. A test
 * names the channels that have no method (`notSetUp`), a project channel
 * that is off (`projectChannelsOff`), push turned off on the server, or a
 * read that fails or is held until `release`.
 */

export const EVERY_METHOD_CHANNEL: ReadonlyArray<NotificationChannelKey> = [
  "alertByEmail",
  "alertBySMS",
  "alertByCall",
  "alertByPush",
  "alertByWhatsApp",
  "alertByTelegram",
  "alertBySlack",
  "alertByMicrosoftTeams",
  "alertByMattermost",
  "alertByWebhook",
];

export interface StubbedNotificationChannelReadiness {
  // How often it was read.
  reads: number;
  release: () => void;
}

export function stubNotificationChannelReadiness(
  options: {
    notSetUp?: ReadonlyArray<NotificationChannelKey> | undefined;
    // Channels whose methods could not be counted.
    unknown?: ReadonlyArray<NotificationChannelKey> | undefined;
    projectChannelsOff?: ReadonlyArray<ProjectNotificationChannel> | undefined;
    // The project's switches could not be read.
    isProjectUnknown?: boolean | undefined;
    isPushTurnedOff?: boolean | undefined;
    fail?: boolean | undefined;
    hold?: boolean | undefined;
  } = {},
): StubbedNotificationChannelReadiness {
  let releaseHeld: () => void = (): void => {
    return undefined;
  };
  const held: Promise<void> = options.hold
    ? new Promise<void>((resolve: () => void): void => {
        releaseHeld = resolve;
      })
    : Promise.resolve();

  const stubbed: StubbedNotificationChannelReadiness = {
    reads: 0,
    release: (): void => {
      releaseHeld();
    },
  };

  const counts: Partial<Record<NotificationChannelKey, number | null>> = {};

  for (const channel of EVERY_METHOD_CHANNEL) {
    counts[channel] = options.unknown?.includes(channel)
      ? null
      : options.notSetUp?.includes(channel)
        ? 0
        : 1;
  }

  const projectChannels: EnabledProjectChannels = {
    [ProjectNotificationChannel.SMS]: true,
    [ProjectNotificationChannel.Call]: true,
    [ProjectNotificationChannel.WhatsApp]: true,
    [ProjectNotificationChannel.Telegram]: true,
  };

  for (const channel of options.projectChannelsOff || []) {
    projectChannels[channel] = false;
  }

  NotificationChannelReadiness.setFetcher(
    async (): Promise<ChannelReadinessFacts> => {
      stubbed.reads++;
      await held;

      if (options.fail) {
        throw new Error("Could not read your notification methods.");
      }

      return {
        verifiedMethodCounts: counts,
        projectChannels: options.isProjectUnknown ? null : projectChannels,
        isPushTurnedOff: Boolean(options.isPushTurnedOff),
      };
    },
  );

  return stubbed;
}

// Puts the server back, for the next suite.
export function resetNotificationChannelReadiness(): void {
  NotificationChannelReadiness.setFetcher(null);
}
