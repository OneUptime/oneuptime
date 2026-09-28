import IncidentStatusPageScopeCopy, {
  formatScopeText,
} from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import {
  buildSubscriberAudienceView,
  describeNotifiedStatusPage,
  SubscriberAudienceView,
  TranslateFunction,
} from "../../FeatureSet/Dashboard/src/Components/Incident/SubscriberAudienceText";
import IncidentSubscriberAudience, {
  IncidentSubscriberAudienceCounts,
  IncidentSubscriberAudienceExclusionReason,
  IncidentSubscriberAudienceResult,
} from "Common/Types/StatusPage/IncidentSubscriberAudience";
import { describe, expect, test } from "@jest/globals";

/*
 * What the "Will notify" summary says for an audience (SubscriberAudienceText):
 * the headline, one line per page with its "up to" counts, the pages left out
 * and why, and the notes. It is worked out apart from React, so every case is
 * pinned here as the exact text an English reader sees - and, through a fake
 * translation, that every piece of it goes through the locale lookup with its
 * placeholders filled in afterwards.
 */

const english: TranslateFunction = (text: string): string => {
  return text;
};

// Marks every looked-up string, so a test can see what was translated.
const marked: TranslateFunction = (text: string): string => {
  return `<${text}>`;
};

function counts(
  partial: Partial<IncidentSubscriberAudienceCounts>,
): IncidentSubscriberAudienceCounts {
  return {
    ...IncidentSubscriberAudience.getEmptyCounts(),
    ...partial,
  };
}

function audience(
  partial: Partial<IncidentSubscriberAudienceResult>,
): IncidentSubscriberAudienceResult {
  return {
    hasMonitors: true,
    isScoped: false,
    isHiddenFromStatusPages: false,
    statusPages: [],
    hiddenStatusPageCount: 0,
    excludedStatusPages: [],
    selectedStatusPagesNotListingMonitors: [],
    ...partial,
  };
}

function view(
  partial: Partial<IncidentSubscriberAudienceResult>,
  translate: TranslateFunction = english,
): SubscriberAudienceView {
  return buildSubscriberAudienceView({
    audience: audience(partial),
    translate: translate,
  });
}

const SITE_03: IncidentSubscriberAudienceResult["statusPages"][number] = {
  statusPageId: "b0000000-0000-4000-8000-000000000003",
  name: "Site 03",
  subscriberCounts: counts({ email: 41 }),
};

const SITE_07: IncidentSubscriberAudienceResult["statusPages"][number] = {
  statusPageId: "b0000000-0000-4000-8000-000000000007",
  name: "Site 07",
  subscriberCounts: counts({ email: 18 }),
};

describe("formatScopeText", () => {
  test("fills every placeholder, every time it appears", () => {
    expect(
      formatScopeText("{{name}} and {{name}} (up to {{counts}})", {
        name: "Site 03",
        counts: "4 SMS",
      }),
    ).toBe("Site 03 and Site 03 (up to 4 SMS)");
  });

  test("leaves text without placeholders alone", () => {
    expect(formatScopeText("Will notify:", { name: "x" })).toBe("Will notify:");
  });
});

describe("describeNotifiedStatusPage", () => {
  test("the issue's example: a page with email subscribers", () => {
    expect(describeNotifiedStatusPage(SITE_03, english)).toBe(
      "Site 03 (up to 41 email)",
    );
  });

  test("every channel with anyone on it, in order", () => {
    expect(
      describeNotifiedStatusPage(
        {
          ...SITE_03,
          subscriberCounts: counts({
            webhook: 2,
            email: 41,
            sms: 3,
            slack: 1,
            microsoftTeams: 4,
          }),
        },
        english,
      ),
    ).toBe(
      "Site 03 (up to 41 email, 3 SMS, 1 Slack, 4 Microsoft Teams, 2 webhook)",
    );
  });

  test("a page with nobody on it says so", () => {
    expect(
      describeNotifiedStatusPage(
        { ...SITE_03, subscriberCounts: counts({}) },
        english,
      ),
    ).toBe("Site 03 (no subscribers yet)");
  });

  test("the templates are looked up, and the values go in afterwards", () => {
    expect(describeNotifiedStatusPage(SITE_03, marked)).toBe(
      "<Site 03 (up to <41 email>)>",
    );
  });
});

describe("buildSubscriberAudienceView", () => {
  test("the issue's example: two scoped pages", () => {
    expect(view({ isScoped: true, statusPages: [SITE_03, SITE_07] })).toEqual({
      tone: "info",
      headline: "Will notify:",
      pages: ["Site 03 (up to 41 email)", "Site 07 (up to 18 email)"],
      notNotified: [],
      notes: [
        IncidentStatusPageScopeCopy.audienceOnceEachNote,
        IncidentStatusPageScopeCopy.audienceUpToNote,
      ],
    });
  });

  test("an unscoped incident sends once per subscription, so no once-each note", () => {
    expect(view({ statusPages: [SITE_03, SITE_07] }).notes).toEqual([
      IncidentStatusPageScopeCopy.audienceUpToNote,
    ]);
  });

  test("a scoped incident on one page has nothing to merge", () => {
    expect(view({ isScoped: true, statusPages: [SITE_03] }).notes).toEqual([
      IncidentStatusPageScopeCopy.audienceUpToNote,
    ]);
  });

  test("no once-each note when only webhook, Slack or Teams are reached", () => {
    expect(
      view({
        isScoped: true,
        statusPages: [
          { ...SITE_03, subscriberCounts: counts({ webhook: 1 }) },
          { ...SITE_07, subscriberCounts: counts({ slack: 2 }) },
        ],
      }).notes,
    ).toEqual([IncidentStatusPageScopeCopy.audienceUpToNote]);
  });

  test("pages the viewer cannot see are summed up, never named", () => {
    expect(
      view({ statusPages: [SITE_03], hiddenStatusPageCount: 1 }).pages,
    ).toEqual([
      "Site 03 (up to 41 email)",
      "1 more status page you do not have access to",
    ]);

    expect(
      view({ statusPages: [SITE_03], hiddenStatusPageCount: 4 }).pages,
    ).toEqual([
      "Site 03 (up to 41 email)",
      "4 more status pages you do not have access to",
    ]);
  });

  test("only hidden pages still reach someone", () => {
    const result: SubscriberAudienceView = view({ hiddenStatusPageCount: 2 });

    expect(result.tone).toBe("info");
    expect(result.headline).toBe("Will notify:");
    expect(result.pages).toEqual([
      "2 more status pages you do not have access to",
    ]);
  });

  test("the pages left out, with why", () => {
    expect(
      view({
        statusPages: [SITE_03],
        excludedStatusPages: [
          {
            statusPageId: "a",
            name: "Site 05",
            reason:
              IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope,
          },
          {
            statusPageId: "b",
            name: "Site 06",
            reason:
              IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents,
          },
          {
            statusPageId: "c",
            name: "Internal",
            reason: IncidentSubscriberAudienceExclusionReason.HidesIncidents,
          },
        ],
        selectedStatusPagesNotListingMonitors: [
          { statusPageId: "d", name: "Site 09" },
        ],
      }).notNotified,
    ).toEqual([
      "Site 05 (not one of the pages this incident is limited to)",
      "Site 06 (only shows incidents limited to it)",
      "Internal (does not show incidents)",
      "Site 09 (lists none of these monitors)",
    ]);
  });

  test("a page a Retry of the 'created' notification skips, with why", () => {
    expect(
      view({
        statusPages: [SITE_03],
        excludedStatusPages: [
          {
            statusPageId: "a",
            name: "Site 07",
            reason: IncidentSubscriberAudienceExclusionReason.AlreadyNotified,
          },
        ],
      }).notNotified,
    ).toEqual(["Site 07 (already sent this notification in full)"]);
  });

  test("every reason a page is left out has its words", () => {
    for (const reason of Object.values(
      IncidentSubscriberAudienceExclusionReason,
    )) {
      const line: string = view({
        statusPages: [SITE_03],
        excludedStatusPages: [
          { statusPageId: "a", name: "Site 07", reason: reason },
        ],
      }).notNotified[0]!;

      expect(line.startsWith("Site 07 (")).toBe(true);
      expect(line).not.toContain("undefined");
    }
  });

  test("a hidden incident: nothing will be sent, whatever it reaches", () => {
    expect(
      view({ isHiddenFromStatusPages: true, statusPages: [SITE_03] }),
    ).toEqual({
      tone: "warning",
      headline: IncidentStatusPageScopeCopy.audienceHiddenIncident,
      pages: [],
      notNotified: [],
      notes: [],
    });
  });

  test("no monitors: nobody, and why", () => {
    expect(view({ hasMonitors: false })).toEqual({
      tone: "warning",
      headline: IncidentStatusPageScopeCopy.audienceNoMonitors,
      pages: [],
      notNotified: [],
      notes: [],
    });
  });

  test("no page will show it: nobody, with the pages left out", () => {
    const result: SubscriberAudienceView = view({
      excludedStatusPages: [
        {
          statusPageId: "a",
          name: "Site 05",
          reason:
            IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents,
        },
      ],
    });

    expect(result.tone).toBe("warning");
    expect(result.headline).toBe(
      IncidentStatusPageScopeCopy.audienceNoStatusPages,
    );
    expect(result.pages).toEqual([]);
    expect(result.notNotified).toEqual([
      "Site 05 (only shows incidents limited to it)",
    ]);
  });

  test("pages without subscribers: nobody, with the pages listed", () => {
    const result: SubscriberAudienceView = view({
      statusPages: [{ ...SITE_03, subscriberCounts: counts({}) }],
    });

    expect(result.tone).toBe("warning");
    expect(result.headline).toBe(
      IncidentStatusPageScopeCopy.audienceNoSubscribers,
    );
    expect(result.pages).toEqual(["Site 03 (no subscribers yet)"]);
    expect(result.notes).toEqual([]);
  });

  test("every fixed string goes through the translation", () => {
    const result: SubscriberAudienceView = view(
      {
        isScoped: true,
        statusPages: [SITE_03, SITE_07],
        hiddenStatusPageCount: 1,
      },
      marked,
    );

    expect(result.headline).toBe(
      `<${IncidentStatusPageScopeCopy.audienceWillNotify}>`,
    );
    expect(result.pages[2]).toBe(
      `<${IncidentStatusPageScopeCopy.audienceOneHiddenPage}>`,
    );
    expect(result.notes).toEqual([
      `<${IncidentStatusPageScopeCopy.audienceOnceEachNote}>`,
      `<${IncidentStatusPageScopeCopy.audienceUpToNote}>`,
    ]);
  });

  test("a translation that moves the placeholders still gets the values", () => {
    const reordered: TranslateFunction = (text: string): string => {
      if (text === IncidentStatusPageScopeCopy.audiencePageWithCounts) {
        return "[{{counts}}] {{name}}";
      }

      if (text === IncidentStatusPageScopeCopy.audienceEmailCount) {
        return "courriel x{{number}}";
      }

      return text;
    };

    expect(view({ statusPages: [SITE_03] }, reordered).pages).toEqual([
      "[courriel x41] Site 03",
    ]);
  });
});
