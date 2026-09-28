import IncidentSubscriberAudience, {
  IncidentSubscriberAudienceChannel,
  IncidentSubscriberAudienceExcludedStatusPage,
  IncidentSubscriberAudienceExclusionReason,
  IncidentSubscriberAudienceNamedStatusPage,
  IncidentSubscriberAudienceResult,
  IncidentSubscriberAudienceStatusPage,
} from "Common/Types/StatusPage/IncidentSubscriberAudience";
import IncidentStatusPageScopeCopy, {
  formatScopeText,
} from "./IncidentStatusPageScopeCopy";

/*
 * What the "Will notify" summary says for an audience, worked out apart from
 * React so it can be tested on its own: a headline, one line per status page
 * that will be notified, the pages that will not be and why, and notes.
 *
 * `translate` looks a string up in the active locale by its English text
 * (useTranslateValue's translateString); placeholders are filled in after the
 * lookup, so every locale keeps them.
 */

export type SubscriberAudienceTone = "info" | "warning";

export interface SubscriberAudienceView {
  tone: SubscriberAudienceTone;
  headline: string;
  pages: Array<string>;
  notNotified: Array<string>;
  notes: Array<string>;
}

export type TranslateFunction = (text: string) => string;

const CHANNEL_TEXT: Record<IncidentSubscriberAudienceChannel, string> = {
  email: IncidentStatusPageScopeCopy.audienceEmailCount,
  sms: IncidentStatusPageScopeCopy.audienceSmsCount,
  slack: IncidentStatusPageScopeCopy.audienceSlackCount,
  microsoftTeams: IncidentStatusPageScopeCopy.audienceMicrosoftTeamsCount,
  webhook: IncidentStatusPageScopeCopy.audienceWebhookCount,
};

const EXCLUSION_TEXT: Record<
  IncidentSubscriberAudienceExclusionReason,
  string
> = {
  [IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope]:
    IncidentStatusPageScopeCopy.audienceOutsideScope,
  [IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents]:
    IncidentStatusPageScopeCopy.audienceOnlyShowsScoped,
  [IncidentSubscriberAudienceExclusionReason.HidesIncidents]:
    IncidentStatusPageScopeCopy.audienceHidesIncidents,
  [IncidentSubscriberAudienceExclusionReason.AlreadyNotified]:
    IncidentStatusPageScopeCopy.audienceAlreadyNotified,
};

// "Site 03 (up to 41 email, 3 SMS)", or "Site 05 (no subscribers yet)".
export const describeNotifiedStatusPage: (
  statusPage: IncidentSubscriberAudienceStatusPage,
  translate: TranslateFunction,
) => string = (
  statusPage: IncidentSubscriberAudienceStatusPage,
  translate: TranslateFunction,
): string => {
  const channels: Array<string> =
    IncidentSubscriberAudience.getNonEmptyChannels(
      statusPage.subscriberCounts,
    ).map(
      (entry: {
        channel: IncidentSubscriberAudienceChannel;
        count: number;
      }): string => {
        return formatScopeText(translate(CHANNEL_TEXT[entry.channel]), {
          number: entry.count,
        });
      },
    );

  if (channels.length === 0) {
    return formatScopeText(
      translate(IncidentStatusPageScopeCopy.audiencePageWithoutSubscribers),
      {
        name: statusPage.name,
      },
    );
  }

  return formatScopeText(
    translate(IncidentStatusPageScopeCopy.audiencePageWithCounts),
    {
      name: statusPage.name,
      counts: channels.join(", "),
    },
  );
};

export const buildSubscriberAudienceView: (data: {
  audience: IncidentSubscriberAudienceResult;
  translate: TranslateFunction;
}) => SubscriberAudienceView = (data: {
  audience: IncidentSubscriberAudienceResult;
  translate: TranslateFunction;
}): SubscriberAudienceView => {
  const audience: IncidentSubscriberAudienceResult = data.audience;
  const translate: TranslateFunction = data.translate;

  if (audience.isHiddenFromStatusPages) {
    return {
      tone: "warning",
      headline: translate(IncidentStatusPageScopeCopy.audienceHiddenIncident),
      pages: [],
      notNotified: [],
      notes: [],
    };
  }

  if (!audience.hasMonitors) {
    return {
      tone: "warning",
      headline: translate(IncidentStatusPageScopeCopy.audienceNoMonitors),
      pages: [],
      notNotified: [],
      notes: [],
    };
  }

  const pages: Array<string> = audience.statusPages.map(
    (statusPage: IncidentSubscriberAudienceStatusPage): string => {
      return describeNotifiedStatusPage(statusPage, translate);
    },
  );

  if (audience.hiddenStatusPageCount === 1) {
    pages.push(translate(IncidentStatusPageScopeCopy.audienceOneHiddenPage));
  } else if (audience.hiddenStatusPageCount > 1) {
    pages.push(
      formatScopeText(
        translate(IncidentStatusPageScopeCopy.audienceHiddenPages),
        {
          number: audience.hiddenStatusPageCount,
        },
      ),
    );
  }

  const notNotified: Array<string> = [
    ...audience.excludedStatusPages.map(
      (statusPage: IncidentSubscriberAudienceExcludedStatusPage): string => {
        return formatScopeText(translate(EXCLUSION_TEXT[statusPage.reason]), {
          name: statusPage.name,
        });
      },
    ),
    ...audience.selectedStatusPagesNotListingMonitors.map(
      (statusPage: IncidentSubscriberAudienceNamedStatusPage): string => {
        return formatScopeText(
          translate(IncidentStatusPageScopeCopy.audienceNotListingMonitors),
          {
            name: statusPage.name,
          },
        );
      },
    ),
  ];

  const pageCount: number =
    audience.statusPages.length + audience.hiddenStatusPageCount;

  if (pageCount === 0) {
    return {
      tone: "warning",
      headline: translate(IncidentStatusPageScopeCopy.audienceNoStatusPages),
      pages: [],
      notNotified: notNotified,
      notes: [],
    };
  }

  if (!IncidentSubscriberAudience.reachesAnyone(audience)) {
    return {
      tone: "warning",
      headline: translate(IncidentStatusPageScopeCopy.audienceNoSubscribers),
      pages: pages,
      notNotified: notNotified,
      notes: [],
    };
  }

  const notes: Array<string> = [];

  /*
   * An email address or phone number on several of a scoped incident's pages
   * is sent one message (SubscriberNotificationDeliveryRecord); say so when
   * that can happen.
   */
  const reachesEmailOrSms: boolean =
    audience.hiddenStatusPageCount > 0 ||
    audience.statusPages.some(
      (statusPage: IncidentSubscriberAudienceStatusPage): boolean => {
        return (
          statusPage.subscriberCounts.email > 0 ||
          statusPage.subscriberCounts.sms > 0
        );
      },
    );

  if (audience.isScoped && pageCount > 1 && reachesEmailOrSms) {
    notes.push(translate(IncidentStatusPageScopeCopy.audienceOnceEachNote));
  }

  notes.push(translate(IncidentStatusPageScopeCopy.audienceUpToNote));

  return {
    tone: "info",
    headline: translate(IncidentStatusPageScopeCopy.audienceWillNotify),
    pages: pages,
    notNotified: notNotified,
    notes: notes,
  };
};
