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
 * that will be notified, the pages that will not be and why, and notes - or
 * nothing at all.
 *
 * Under a "notify subscribers" checkbox (declaring an incident, writing a
 * public note) it speaks when someone will be notified, and when the
 * incident's status page scope is why the pages that list its monitors will
 * not be: those are the mistakes worth catching before anything is sent.
 * When no status page subscriber was ever going to hear about the incident -
 * it is on no monitor, no status page lists its monitors, the pages that
 * show it have no subscribers yet - it says nothing. Most incidents are like
 * that, and a project that does not use status pages would otherwise see a
 * warning on every one.
 *
 * The confirmation before sending a notification again always answers
 * (`saysWhenNobodyIsNotified`): who it reaches, no one included, is what is
 * being confirmed.
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

/*
 * Whether the incident's status page scope keeps a status page from hearing
 * about it: the incident is limited to other pages, it is not limited and a
 * page that lists its monitors only shows incidents limited to it, or a page
 * it is limited to lists none of its monitors (or it is on no monitor at
 * all). Each is something the person can fix in the scope. A page that does
 * not show incidents at all, or that a Retry skips because it was sent the
 * notification already, is not: nothing about this incident would change it.
 */
export const isHeldBackByStatusPageScope: (
  audience: IncidentSubscriberAudienceResult,
) => boolean = (audience: IncidentSubscriberAudienceResult): boolean => {
  if (audience.selectedStatusPagesNotListingMonitors.length > 0) {
    return true;
  }

  return audience.excludedStatusPages.some(
    (statusPage: IncidentSubscriberAudienceExcludedStatusPage): boolean => {
      return (
        statusPage.reason ===
          IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope ||
        statusPage.reason ===
          IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents
      );
    },
  );
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

export interface BuildSubscriberAudienceViewData {
  audience: IncidentSubscriberAudienceResult;
  translate: TranslateFunction;
  /*
   * Say so when no one will be notified, whatever the reason. Off, the view
   * is null then, unless the incident's status page scope is the reason
   * (isHeldBackByStatusPageScope).
   */
  saysWhenNobodyIsNotified?: boolean | undefined;
}

/*
 * What the summary says, or null when it has nothing to say: no one will be
 * notified, and nothing about the incident's status page scope is why (see
 * the header). A hidden incident is always said: whoever ticks "notify" on a
 * note cannot see from there that the incident is hidden.
 */
export const buildSubscriberAudienceView: (
  data: BuildSubscriberAudienceViewData,
) => SubscriberAudienceView | null = (
  data: BuildSubscriberAudienceViewData,
): SubscriberAudienceView | null => {
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

  if (!IncidentSubscriberAudience.reachesAnyone(audience)) {
    if (
      !data.saysWhenNobodyIsNotified &&
      !isHeldBackByStatusPageScope(audience)
    ) {
      return null;
    }

    // No page will show it - with no monitor, no page can.
    if (pageCount === 0) {
      return {
        tone: "warning",
        headline: translate(IncidentStatusPageScopeCopy.audienceNoStatusPages),
        pages: [],
        notNotified: notNotified,
        notes: [],
      };
    }

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
