import PageMap from "../../Utils/PageMap";

/*
 * Where a visitor asks for a new link to manage their subscription: the
 * Subscribe page of a channel the status page offers, whose Manage Existing
 * Subscription tab sends the link to the subscription's own contact. Email,
 * SMS, Slack and Microsoft Teams have that tab; webhooks do not. The first
 * channel the page offers, in the order the Subscribe side menu lists them.
 *
 * The manage page shows it when its link has expired or is not valid, and
 * the unsubscribe page when its link is out of date. Null when the page
 * offers none of those channels: there is then no page to send the visitor
 * to, and the message says what to do on its own.
 *
 * React-free, so App's tests can read it.
 */

export interface ManageLinkChannels {
  enableEmailSubscribers: boolean;
  enableSMSSubscribers: boolean;
  enableSlackSubscribers: boolean;
  enableMicrosoftTeamsSubscribers: boolean;
}

interface ChannelPages {
  isOffered: (channels: ManageLinkChannels) => boolean;
  page: PageMap;
  previewPage: PageMap;
}

const CHANNEL_PAGES: ReadonlyArray<ChannelPages> = [
  {
    isOffered: (channels: ManageLinkChannels): boolean => {
      return channels.enableEmailSubscribers;
    },
    page: PageMap.SUBSCRIBE_EMAIL,
    previewPage: PageMap.PREVIEW_SUBSCRIBE_EMAIL,
  },
  {
    isOffered: (channels: ManageLinkChannels): boolean => {
      return channels.enableSMSSubscribers;
    },
    page: PageMap.SUBSCRIBE_SMS,
    previewPage: PageMap.PREVIEW_SUBSCRIBE_SMS,
  },
  {
    isOffered: (channels: ManageLinkChannels): boolean => {
      return channels.enableSlackSubscribers;
    },
    page: PageMap.SUBSCRIBE_SLACK,
    previewPage: PageMap.PREVIEW_SUBSCRIBE_SLACK,
  },
  {
    isOffered: (channels: ManageLinkChannels): boolean => {
      return channels.enableMicrosoftTeamsSubscribers;
    },
    page: PageMap.SUBSCRIBE_MICROSOFT_TEAMS,
    previewPage: PageMap.PREVIEW_SUBSCRIBE_MICROSOFT_TEAMS,
  },
];

export function getManageLinkRequestPage(data: {
  channels: ManageLinkChannels;
  isPreview: boolean;
}): PageMap | null {
  for (const channel of CHANNEL_PAGES) {
    if (channel.isOffered(data.channels)) {
      return data.isPreview ? channel.previewPage : channel.page;
    }
  }

  return null;
}
