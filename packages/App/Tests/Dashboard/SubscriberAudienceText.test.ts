import IncidentStatusPageScopeCopy, {
  formatScopeText,
} from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import {
  buildSubscriberAudienceView,
  describeNotifiedStatusPage,
  isHeldBackByStatusPageScope,
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
 * and why, and the notes - or nothing. It is worked out apart from React, so
 * every case is pinned here as the exact text an English reader sees - and,
 * through a fake translation, that every piece of it goes through the locale
 * lookup with its placeholders filled in afterwards.
 *
 * "Can we please remove this warning banner as well?" - the maintainer, of
 * "No status page subscribers will be notified: no monitors are attached.
 * Subscribers hear about an incident through the monitors their status pages
 * list.", which sat under 'Notify Status Page Subscribers' on every incident
 * declared without a monitor. Under a "notify subscribers" checkbox the
 * summary now says nothing when no status page subscriber was going to hear
 * about the incident anyway, and warns only when the incident's status page
 * scope keeps a page from being told. The confirmation before sending a
 * notification again still always answers.
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

interface ViewOptions {
  translate?: TranslateFunction;
  // The confirmation before sending a notification again.
  saysWhenNobodyIsNotified?: boolean;
}

// What the summary says, or null when it says nothing.
function viewOrNothing(
  partial: Partial<IncidentSubscriberAudienceResult>,
  options: ViewOptions = {},
): SubscriberAudienceView | null {
  return buildSubscriberAudienceView({
    audience: audience(partial),
    translate: options.translate || english,
    saysWhenNobodyIsNotified: options.saysWhenNobodyIsNotified,
  });
}

// What the summary says, where it says something.
function view(
  partial: Partial<IncidentSubscriberAudienceResult>,
  translate: TranslateFunction = english,
  saysWhenNobodyIsNotified: boolean = false,
): SubscriberAudienceView {
  const result: SubscriberAudienceView | null = viewOrNothing(partial, {
    translate: translate,
    saysWhenNobodyIsNotified: saysWhenNobodyIsNotified,
  });

  expect(result).not.toBeNull();

  return result!;
}

// The confirmation before sending a notification again.
function confirmationView(
  partial: Partial<IncidentSubscriberAudienceResult>,
): SubscriberAudienceView {
  return view(partial, english, true);
}

function excluded(
  name: string,
  reason: IncidentSubscriberAudienceExclusionReason,
): IncidentSubscriberAudienceResult["excludedStatusPages"][number] {
  return { statusPageId: `id-${name}`, name: name, reason: reason };
}

// The removed banner, and the two notices that only repeated a box.
const REMOVED_TEXT: Array<string> = [
  "No status page subscribers will be notified: no monitors are attached.",
  "Subscribers hear about an incident through the monitors their status pages list.",
  "Status page subscribers will not be notified: 'Notify Status Page Subscribers' is off.",
  "Nothing will be sent: private incidents are hidden from all status pages.",
];

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

  /*
   * Whoever ticks "notify" on a public note cannot see from there that the
   * incident is hidden, so a hidden incident is said under the checkbox and
   * in the confirmation alike - even one on no monitor.
   */
  test.each([
    ["under a checkbox", false],
    ["in a confirmation", true],
  ])(
    "a hidden incident is said %s",
    (_label: string, saysWhenNobodyIsNotified: boolean) => {
      expect(
        viewOrNothing(
          { isHiddenFromStatusPages: true, hasMonitors: false },
          { saysWhenNobodyIsNotified: saysWhenNobodyIsNotified },
        )?.headline,
      ).toBe(IncidentStatusPageScopeCopy.audienceHiddenIncident);
    },
  );
});

describe("under a 'notify subscribers' checkbox, when no one will be notified", () => {
  /*
   * Nobody was going to hear about the incident anyway, and nothing about
   * its status page scope is why: the summary says nothing at all. The
   * first is the banner the maintainer asked to remove.
   */
  test.each([
    ["the incident is on no monitor", { hasMonitors: false }],
    ["no status page lists its monitors", {}],
    [
      "the pages that show it have no subscribers yet",
      { statusPages: [{ ...SITE_03, subscriberCounts: counts({}) }] },
    ],
    [
      "it is limited to pages that show it, and they have no subscribers yet",
      {
        isScoped: true,
        statusPages: [
          { ...SITE_03, subscriberCounts: counts({}) },
          { ...SITE_07, subscriberCounts: counts({}) },
        ],
      },
    ],
    [
      "the only page that lists its monitors does not show incidents",
      {
        excludedStatusPages: [
          excluded(
            "Internal",
            IncidentSubscriberAudienceExclusionReason.HidesIncidents,
          ),
        ],
      },
    ],
    [
      "the only page left out was sent it in full already",
      {
        excludedStatusPages: [
          excluded(
            "Site 07",
            IncidentSubscriberAudienceExclusionReason.AlreadyNotified,
          ),
        ],
      },
    ],
    [
      "a page without subscribers shows it, and one that hides incidents does not",
      {
        statusPages: [{ ...SITE_03, subscriberCounts: counts({}) }],
        excludedStatusPages: [
          excluded(
            "Internal",
            IncidentSubscriberAudienceExclusionReason.HidesIncidents,
          ),
        ],
      },
    ],
  ])(
    "says nothing when %s",
    (_label: string, partial: Partial<IncidentSubscriberAudienceResult>) => {
      expect(viewOrNothing(partial)).toBeNull();
      expect(
        viewOrNothing(partial, { saysWhenNobodyIsNotified: false }),
      ).toBeNull();
    },
  );

  test("no page will show it, because a page only shows incidents limited to it: the pages left out, and why", () => {
    expect(
      view({
        excludedStatusPages: [
          excluded(
            "Site 05",
            IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents,
          ),
        ],
      }),
    ).toEqual({
      tone: "warning",
      headline: IncidentStatusPageScopeCopy.audienceNoStatusPages,
      pages: [],
      notNotified: ["Site 05 (only shows incidents limited to it)"],
      notes: [],
    });
  });

  test("limited to other pages than the ones that list its monitors: the pages left out", () => {
    expect(
      view({
        isScoped: true,
        excludedStatusPages: [
          excluded(
            "Site 03",
            IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope,
          ),
        ],
      }),
    ).toEqual({
      tone: "warning",
      headline: IncidentStatusPageScopeCopy.audienceNoStatusPages,
      pages: [],
      notNotified: [
        "Site 03 (not one of the pages this incident is limited to)",
      ],
      notes: [],
    });
  });

  test("limited to a page that lists none of its monitors: that page, and why", () => {
    expect(
      view({
        isScoped: true,
        selectedStatusPagesNotListingMonitors: [
          { statusPageId: "d", name: "Site 09" },
        ],
      }),
    ).toEqual({
      tone: "warning",
      headline: IncidentStatusPageScopeCopy.audienceNoStatusPages,
      pages: [],
      notNotified: ["Site 09 (lists none of these monitors)"],
      notes: [],
    });
  });

  /*
   * The one case the removed banner caught that matters: status pages are
   * picked, but no monitor is attached, so none of them will show it. The
   * server lists every picked page as not listing the monitors then.
   */
  test("pages picked but no monitor attached: every picked page, and why", () => {
    expect(
      view({
        hasMonitors: false,
        isScoped: true,
        selectedStatusPagesNotListingMonitors: [
          { statusPageId: "c", name: "Site 03" },
          { statusPageId: "d", name: "Site 09" },
        ],
      }),
    ).toEqual({
      tone: "warning",
      headline: IncidentStatusPageScopeCopy.audienceNoStatusPages,
      pages: [],
      notNotified: [
        "Site 03 (lists none of these monitors)",
        "Site 09 (lists none of these monitors)",
      ],
      notes: [],
    });
  });

  test("the pages it is limited to have no subscribers, and the scope leaves out a page that lists its monitors", () => {
    expect(
      view({
        isScoped: true,
        statusPages: [{ ...SITE_07, subscriberCounts: counts({}) }],
        excludedStatusPages: [
          excluded(
            "Site 03",
            IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope,
          ),
        ],
      }),
    ).toEqual({
      tone: "warning",
      headline: IncidentStatusPageScopeCopy.audienceNoSubscribers,
      pages: ["Site 07 (no subscribers yet)"],
      notNotified: [
        "Site 03 (not one of the pages this incident is limited to)",
      ],
      notes: [],
    });
  });

  test("once it speaks, every page left out is listed, the ones the scope does not decide too", () => {
    expect(
      view({
        excludedStatusPages: [
          excluded(
            "Internal",
            IncidentSubscriberAudienceExclusionReason.HidesIncidents,
          ),
          excluded(
            "Site 05",
            IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents,
          ),
        ],
      }).notNotified,
    ).toEqual([
      "Internal (does not show incidents)",
      "Site 05 (only shows incidents limited to it)",
    ]);
  });
});

describe("in the confirmation before sending a notification again", () => {
  test("no monitor: no page will show it", () => {
    expect(confirmationView({ hasMonitors: false })).toEqual({
      tone: "warning",
      headline: IncidentStatusPageScopeCopy.audienceNoStatusPages,
      pages: [],
      notNotified: [],
      notes: [],
    });
  });

  test("no page lists its monitors: no page will show it", () => {
    expect(confirmationView({}).headline).toBe(
      IncidentStatusPageScopeCopy.audienceNoStatusPages,
    );
  });

  test("pages without subscribers: nobody, with the pages listed", () => {
    expect(
      confirmationView({
        statusPages: [{ ...SITE_03, subscriberCounts: counts({}) }],
      }),
    ).toEqual({
      tone: "warning",
      headline: IncidentStatusPageScopeCopy.audienceNoSubscribers,
      pages: ["Site 03 (no subscribers yet)"],
      notNotified: [],
      notes: [],
    });
  });

  test("a Retry that every page was sent in full already: nobody, and why", () => {
    expect(
      confirmationView({
        excludedStatusPages: [
          excluded(
            "Site 07",
            IncidentSubscriberAudienceExclusionReason.AlreadyNotified,
          ),
        ],
      }),
    ).toEqual({
      tone: "warning",
      headline: IncidentStatusPageScopeCopy.audienceNoStatusPages,
      pages: [],
      notNotified: ["Site 07 (already sent this notification in full)"],
      notes: [],
    });
  });

  test("a page that does not show incidents: nobody, and why", () => {
    expect(
      confirmationView({
        excludedStatusPages: [
          excluded(
            "Internal",
            IncidentSubscriberAudienceExclusionReason.HidesIncidents,
          ),
        ],
      }).notNotified,
    ).toEqual(["Internal (does not show incidents)"]);
  });

  test("who it reaches reads the same as under a checkbox", () => {
    const partial: Partial<IncidentSubscriberAudienceResult> = {
      isScoped: true,
      statusPages: [SITE_03, SITE_07],
      excludedStatusPages: [
        excluded(
          "Site 05",
          IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope,
        ),
      ],
    };

    expect(confirmationView(partial)).toEqual(view(partial));
    expect(view(partial).tone).toBe("info");
  });
});

describe("isHeldBackByStatusPageScope", () => {
  test("nothing left out: no", () => {
    expect(isHeldBackByStatusPageScope(audience({}))).toBe(false);
    expect(
      isHeldBackByStatusPageScope(audience({ statusPages: [SITE_03] })),
    ).toBe(false);
  });

  test.each([
    [IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope, true],
    [IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents, true],
    [IncidentSubscriberAudienceExclusionReason.HidesIncidents, false],
    [IncidentSubscriberAudienceExclusionReason.AlreadyNotified, false],
  ])(
    "a page left out because %s: %s",
    (reason: IncidentSubscriberAudienceExclusionReason, expected: boolean) => {
      expect(
        isHeldBackByStatusPageScope(
          audience({ excludedStatusPages: [excluded("Site 05", reason)] }),
        ),
      ).toBe(expected);
    },
  );

  test("every reason a page can be left out is decided", () => {
    const decided: Array<string> = [
      IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope,
      IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents,
      IncidentSubscriberAudienceExclusionReason.HidesIncidents,
      IncidentSubscriberAudienceExclusionReason.AlreadyNotified,
    ];

    expect(
      Object.values(IncidentSubscriberAudienceExclusionReason).sort(),
    ).toEqual(decided.sort());
  });

  test("a picked page that lists none of the monitors: yes, with monitors or without", () => {
    for (const hasMonitors of [true, false]) {
      expect(
        isHeldBackByStatusPageScope(
          audience({
            hasMonitors: hasMonitors,
            selectedStatusPagesNotListingMonitors: [
              { statusPageId: "d", name: "Site 09" },
            ],
          }),
        ),
      ).toBe(true);
    }
  });

  test("one page the scope decides is enough, among others it does not", () => {
    expect(
      isHeldBackByStatusPageScope(
        audience({
          excludedStatusPages: [
            excluded(
              "Internal",
              IncidentSubscriberAudienceExclusionReason.HidesIncidents,
            ),
            excluded(
              "Site 05",
              IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents,
            ),
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("the removed notices", () => {
  test("the copy no longer has them", () => {
    const keys: Array<string> = Object.keys(IncidentStatusPageScopeCopy);

    expect(keys).not.toContain("audienceNoMonitors");
    expect(keys).not.toContain("audienceNotifyOff");
    expect(keys).not.toContain("audiencePrivateIncident");

    for (const text of Object.values(IncidentStatusPageScopeCopy)) {
      for (const removed of REMOVED_TEXT) {
        expect(text).not.toContain(removed);
      }

      expect(text).not.toMatch(/no monitors are attached/i);
    }
  });

  test("nothing the summary can say mentions monitors being attached", () => {
    const audiences: Array<Partial<IncidentSubscriberAudienceResult>> = [
      { hasMonitors: false },
      {
        hasMonitors: false,
        selectedStatusPagesNotListingMonitors: [
          { statusPageId: "d", name: "Site 09" },
        ],
      },
      { hasMonitors: false, isHiddenFromStatusPages: true },
      {},
      { statusPages: [{ ...SITE_03, subscriberCounts: counts({}) }] },
    ];

    for (const partial of audiences) {
      for (const saysWhenNobodyIsNotified of [false, true]) {
        const result: SubscriberAudienceView | null = viewOrNothing(partial, {
          saysWhenNobodyIsNotified: saysWhenNobodyIsNotified,
        });

        const said: string = JSON.stringify(result);

        expect(said).not.toMatch(/monitors are attached/i);
        expect(said).not.toMatch(/hear about an incident/i);
      }
    }
  });
});

describe("buildSubscriberAudienceView, translated", () => {
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
