import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  WORKSPACE_CHANNEL_LINK_ROUTE,
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "Common/Types/Workspace/WorkspaceChannelLink";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE "OPEN IN SLACK" / "OPEN IN MICROSOFT TEAMS" BUTTONS OF A RECORD'S PAGE.
 *
 * An incident, alert, episode or scheduled maintenance event that a
 * workspace notification rule made a channel for shows a button in its
 * header that opens that channel - Datadog's "Open Slack": the room where
 * the incident is being worked is one click from its page. One button per
 * workspace; a record with two Slack channels gets one Open in Slack that
 * lists both. No channel, no button.
 *
 * React-free so the rules can be tested on their own.
 */
export interface ChannelLinkGroup {
  workspaceType: WorkspaceType;
  // "Open in Slack": a translation key.
  label: string;
  icon: IconProp;
  links: Array<WorkspaceChannelLink>;
}

export const CHANNEL_LINK_TEXT: {
  openInSlack: string;
  openInMicrosoftTeams: string;
} = {
  openInSlack: translationKey("Open in Slack"),
  openInMicrosoftTeams: translationKey("Open in Microsoft Teams"),
};

// Slack first: the order the record's channels are listed in everywhere.
const WORKSPACE_ORDER: Array<WorkspaceType> = [
  WorkspaceType.Slack,
  WorkspaceType.MicrosoftTeams,
];

export function getChannelLinkGroups(
  links: Array<WorkspaceChannelLink>,
): Array<ChannelLinkGroup> {
  const groups: Array<ChannelLinkGroup> = [];

  for (const workspaceType of WORKSPACE_ORDER) {
    const ofType: Array<WorkspaceChannelLink> = links.filter(
      (link: WorkspaceChannelLink) => {
        return link.workspaceType === workspaceType;
      },
    );

    if (ofType.length === 0) {
      continue;
    }

    groups.push({
      workspaceType: workspaceType,
      label:
        workspaceType === WorkspaceType.Slack
          ? CHANNEL_LINK_TEXT.openInSlack
          : CHANNEL_LINK_TEXT.openInMicrosoftTeams,
      icon:
        workspaceType === WorkspaceType.Slack
          ? IconProp.Slack
          : IconProp.MicrosoftTeams,
      links: ofType,
    });
  }

  return groups;
}

/*
 * A channel as its menu item names it: "#incident-42-checkout" in Slack,
 * where channels are written with their #, the bare name in Teams.
 */
export function getChannelLinkLabel(link: WorkspaceChannelLink): string {
  const name: string = link.channelName.trim();

  if (!name) {
    return link.workspaceType === WorkspaceType.Slack ? "#channel" : "Channel";
  }

  if (link.workspaceType === WorkspaceType.Slack && !name.startsWith("#")) {
    return `#${name}`;
  }

  return name;
}

export function getChannelLinkRoute(data: {
  recordType: WorkspaceChannelRecordType;
  recordId: ObjectID;
}): string {
  return `${WORKSPACE_CHANNEL_LINK_ROUTE}/${data.recordType}/${data.recordId.toString()}`;
}

/*
 * A rule creates a record's channel a moment after the record itself, so
 * whoever declared an incident lands on its page before the channel exists.
 * While the record is new and has no channel, the page looks again a few
 * times, then stops: a record that still has none after that has no rule
 * that makes one.
 */
export const CHANNEL_LINK_RECHECK_DELAYS_MS: ReadonlyArray<number> = [
  3000, 7000, 15000, 30000,
];
export const CHANNEL_LINK_RECHECK_WINDOW_MS: number = 5 * 60 * 1000;
// Clocks disagree a little; a record "a few seconds in the future" is new.
const CLOCK_SKEW_MS: number = 60 * 1000;

export function getChannelLinkRecheckDelay(data: {
  recordStartedAt: Date | undefined;
  now: Date;
  linkCount: number;
  attempt: number;
}): number | null {
  if (data.linkCount > 0 || !data.recordStartedAt) {
    return null;
  }

  const age: number = data.now.getTime() - data.recordStartedAt.getTime();

  if (
    Number.isNaN(age) ||
    age < -CLOCK_SKEW_MS ||
    age > CHANNEL_LINK_RECHECK_WINDOW_MS
  ) {
    return null;
  }

  return CHANNEL_LINK_RECHECK_DELAYS_MS[data.attempt] ?? null;
}
