import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  getLocalePath,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  ALL_CLEAR,
  ATTENTION_LIST_LABEL,
  EVENTS_IN_24_HOURS,
  IN_HAND_SUMMARY,
  IN_HAND_TITLE,
  LAST_EVENT,
  MY_OPEN_CASES_LABEL,
  NEEDS_ATTENTION_TITLE,
  NONE_OPEN,
  NONE_URGENT,
  NOTHING_WAITING,
  NOT_SET_UP_FIGURE,
  NOT_SET_UP_SUMMARY,
  NOT_SET_UP_TITLE,
  NO_EVENTS_YET,
  OPEN_CASES_FIGURE,
  OVERVIEW_READ_FAILED_TITLE,
  PLAYBOOKS_ON_FIGURE,
  QUIET_SOURCE_AFTER_IN_MS,
  QUIET_SUMMARY,
  QUIET_SUMMARY_SOURCES_SILENT,
  QUIET_SUMMARY_WITHOUT_PLAYBOOKS,
  QUIET_TITLE,
  RECOMMENDED_ON,
  RULES_ON_FIGURE,
  SET_UP_DETECTIONS,
  SET_UP_PLAYBOOKS,
  SET_UP_SECURITY,
  SET_UP_SOURCES,
  SIEM_DESTINATIONS,
  SOURCES_FIGURE,
  STATUS_READ_FAILED,
  STEPS_TO_APPROVE,
  STEPS_WAITING_LABEL,
  SecurityAttentionItem,
  SecurityAttentionKey,
  SecurityHeadline,
  SecurityHeadlineAction,
  SecurityHeadlineKind,
  SecurityOverviewQueue,
  SecurityOverviewText,
  SecurityStageView,
  SecurityStatusTone,
  UNASSIGNED_OPEN_CASES_LABEL,
  URGENT_OPEN_CASES,
  formatSecurityOverviewValues,
  getSecurityAttentionItems,
  getSecurityHeadline,
  getSecurityStageViews,
  isSecuritySourceSilent,
  isSecurityWatching,
  translateSecurityOverviewText,
} from "../../FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityOverviewStatusModel";
import { SecuritySetupStatus } from "../../FeatureSet/Dashboard/src/Components/SecurityOverview/SecuritySetupModel";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PluralTemplate,
  TemplateValues,
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The top of the Security Overview, decided without a renderer: what the
 * band says first (what waits for a person, cases in hand, nothing watched
 * yet, or all quiet - and when the sources went silent), and what each of
 * the pipeline's four cells says, how it is coloured and where it opens.
 * Everything comes from the two reads the page already makes, so these
 * feed it nothing else. The last describe holds every sentence the card can
 * say to en.json and to its own wording in every locale.
 */

const NOW: Date = new Date("2026-10-23T12:00:00.000Z");
const MINUTE_IN_MS: number = 60 * 1000;
const LATIN_DIGIT: RegExp = /[0-9]/;
const DAY_IN_MS: number = 24 * 60 * MINUTE_IN_MS;

function ago(milliseconds: number): Date {
  return new Date(NOW.getTime() - milliseconds);
}

function status(
  overrides: Partial<SecuritySetupStatus> = {},
): SecuritySetupStatus {
  return {
    connections: 0,
    logsSourceEnabled: false,
    telemetrySourcesEnabled: 0,
    eventsLast24Hours: 0,
    lastEventAt: null,
    enabledRules: 0,
    recommendedRules: 20,
    recommendedRulesOn: 0,
    threatIntelFeeds: 0,
    openCases: 0,
    enabledPlaybooks: 0,
    destinations: 0,
    ...overrides,
  };
}

// Your logs, every recommended rule, a playbook, and events today.
const SET_UP: Partial<SecuritySetupStatus> = {
  logsSourceEnabled: true,
  eventsLast24Hours: 1234,
  lastEventAt: ago(MINUTE_IN_MS),
  enabledRules: 20,
  recommendedRulesOn: 20,
  enabledPlaybooks: 1,
};

function queue(
  overrides: Partial<SecurityOverviewQueue> = {},
): SecurityOverviewQueue {
  return {
    openCases: 0,
    criticalOpenCases: 0,
    highOpenCases: 0,
    myOpenCases: 0,
    unassignedOpenCases: 0,
    runsWaitingForApproval: 0,
    ...overrides,
  };
}

function headline(
  queueOverrides: Partial<SecurityOverviewQueue>,
  value: SecuritySetupStatus | null,
): SecurityHeadline {
  return getSecurityHeadline({
    queue: queue(queueOverrides),
    status: value,
    now: NOW,
  });
}

function views(
  value: SecuritySetupStatus,
  queueOverrides: Partial<SecurityOverviewQueue> = {},
): Array<SecurityStageView> {
  return getSecurityStageViews({
    status: value,
    queue: queue(queueOverrides),
    now: NOW,
  });
}

function view(
  value: SecuritySetupStatus,
  key: string,
  queueOverrides: Partial<SecurityOverviewQueue> = {},
): SecurityStageView {
  return views(value, queueOverrides).find((stage: SecurityStageView) => {
    return stage.key === key;
  })!;
}

const ENGLISH: Translator = createTranslator(undefined, "en");

function say(text: SecurityOverviewText | null): string | null {
  return text ? translateSecurityOverviewText(ENGLISH, text) : null;
}

// A cell as a reader takes it in: the figure, then the status line.
function read(stage: SecurityStageView): [string, string | null] {
  return [say(stage.figure)!, say(stage.status)];
}

describe("the band", () => {
  test("nothing open and Security watching: All quiet, the test attack, and what happens when a rule finds a threat", () => {
    const quiet: SecurityHeadline = headline({}, status(SET_UP));

    expect(quiet).toMatchObject({
      kind: SecurityHeadlineKind.Quiet,
      tone: SecurityStatusTone.Success,
      icon: IconProp.ShieldCheck,
      title: QUIET_TITLE,
      items: [],
      action: SecurityHeadlineAction.TestAttack,
    });
    expect(QUIET_TITLE).toBe("All quiet");
    expect(say(quiet.summary)).toBe(
      "No open case and nothing waiting for an approval. When a rule finds a threat, its case opens here and your playbooks run on it.",
    );
  });

  test("All quiet says playbooks run only when one is on, and promises none without the set-up figures", () => {
    expect(
      headline({}, status({ ...SET_UP, enabledPlaybooks: 0 })).summary,
    ).toEqual({ text: QUIET_SUMMARY_WITHOUT_PLAYBOOKS });
    expect(headline({}, null).summary).toEqual({
      text: QUIET_SUMMARY_WITHOUT_PLAYBOOKS,
    });
    expect(headline({}, status(SET_UP)).summary).toEqual({
      text: QUIET_SUMMARY,
    });
    expect(QUIET_SUMMARY_WITHOUT_PLAYBOOKS).not.toContain("playbook");
  });

  test("sources that sent something once and nothing for a day: All quiet says when the last event came, so a silence is not a clean bill of health", () => {
    const silent: SecurityHeadline = headline(
      {},
      status({
        ...SET_UP,
        eventsLast24Hours: 0,
        lastEventAt: ago(3 * DAY_IN_MS),
      }),
    );

    expect(silent.kind).toBe(SecurityHeadlineKind.Quiet);
    // Still quiet: nothing is open, and the test attack is still offered.
    expect(silent.tone).toBe(SecurityStatusTone.Success);
    expect(silent.action).toBe(SecurityHeadlineAction.TestAttack);
    expect(say(silent.summary)).toBe(
      "No open case and nothing waiting for an approval, but the last security event arrived 3 days ago.",
    );
  });

  test("a source that never sent anything has not gone quiet: nothing arrived yet", () => {
    expect(
      headline(
        {},
        status({ ...SET_UP, eventsLast24Hours: 0, lastEventAt: null }),
      ).summary,
    ).toEqual({ text: QUIET_SUMMARY });
  });

  test("nothing open and nothing that can open a case: nothing is being watched yet, with Set up Security - never All quiet", () => {
    for (const value of [
      status(),
      // Rules, and nothing for them to read.
      status({ enabledRules: 5, enabledPlaybooks: 1 }),
      // A threat intel feed, and nothing for it to match.
      status({ threatIntelFeeds: 2 }),
      // Your logs, and nothing to find threats in them.
      status({ logsSourceEnabled: true, enabledPlaybooks: 1 }),
      status({
        logsSourceEnabled: true,
        eventsLast24Hours: 40,
        lastEventAt: ago(MINUTE_IN_MS),
      }),
    ]) {
      const notWatching: SecurityHeadline = headline({}, value);

      expect(notWatching).toMatchObject({
        kind: SecurityHeadlineKind.NotSetUp,
        tone: SecurityStatusTone.Neutral,
        icon: IconProp.EyeSlash,
        title: NOT_SET_UP_TITLE,
        summary: { text: NOT_SET_UP_SUMMARY },
        items: [],
        action: SecurityHeadlineAction.SetUp,
      });
    }

    // A source and a rule are enough to watch; a playbook only responds.
    expect(headline({}, status({ connections: 1, enabledRules: 1 })).kind).toBe(
      SecurityHeadlineKind.Quiet,
    );
    expect(NOT_SET_UP_TITLE).toBe("Nothing is being watched for threats yet");
  });

  test("a connected product watches without a rule of OneUptime's: its alerts open cases, so the band is All quiet, not Set up Security", () => {
    /*
     * CrowdStrike, Sentinel, Google SecOps and the rest import their alerts
     * and open cases from High up by default (the connection's Open Cases
     * From Severity). Telling such a team nothing is being watched would be
     * wrong, and Set up Security would push rules they do not want.
     */
    const connectionOnly: SecurityHeadline = headline(
      {},
      status({
        connections: 1,
        eventsLast24Hours: 40,
        lastEventAt: ago(MINUTE_IN_MS),
      }),
    );

    expect(connectionOnly.kind).toBe(SecurityHeadlineKind.Quiet);
    expect(connectionOnly.action).toBe(SecurityHeadlineAction.TestAttack);
    // The Detections cell still says OneUptime's own rules are not on.
    expect(
      read(
        view(
          status({
            connections: 1,
            eventsLast24Hours: 40,
            lastEventAt: ago(MINUTE_IN_MS),
          }),
          "detections",
        ),
      ),
    ).toEqual(["Not set up", "Turn on rules"]);
  });

  test("a threat intel feed reading your logs watches without a rule: its matches open cases", () => {
    expect(
      headline({}, status({ logsSourceEnabled: true, threatIntelFeeds: 1 }))
        .kind,
    ).toBe(SecurityHeadlineKind.Quiet);
  });

  test("something waits for a person: Needs attention, each count a link to the page that lists it, in the docs' order, and only what has a count", () => {
    const busy: SecurityHeadline = headline(
      {
        openCases: 6,
        criticalOpenCases: 2,
        highOpenCases: 2,
        myOpenCases: 2,
        unassignedOpenCases: 2,
        runsWaitingForApproval: 1,
      },
      status(SET_UP),
    );

    expect(busy.kind).toBe(SecurityHeadlineKind.NeedsAttention);
    expect(busy.title).toBe(NEEDS_ATTENTION_TITLE);
    expect(NEEDS_ATTENTION_TITLE).toBe("Needs attention");
    expect(busy.summary).toBeNull();
    expect(busy.action).toBe(SecurityHeadlineAction.None);
    expect(
      busy.items.map((item: SecurityAttentionItem) => {
        return [
          item.key,
          item.count,
          ENGLISH.translatePlural(item.label, item.count),
          item.page,
          item.icon,
        ];
      }),
    ).toEqual([
      [
        SecurityAttentionKey.Mine,
        2,
        "open cases assigned to you",
        PageMap.SECURITY_CASES_ASSIGNED_TO_ME,
        IconProp.User,
      ],
      [
        SecurityAttentionKey.Unassigned,
        2,
        "open cases nobody has picked up",
        PageMap.SECURITY_CASES_UNASSIGNED,
        IconProp.Inbox,
      ],
      [
        SecurityAttentionKey.Approvals,
        1,
        "playbook step waiting for approval",
        PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL,
        IconProp.PauseCircle,
      ],
    ]);

    // One step waiting and nothing else: just that link, never "0 ..." rows.
    expect(
      getSecurityAttentionItems(queue({ runsWaitingForApproval: 1 })).map(
        (item: SecurityAttentionItem) => {
          return item.key;
        },
      ),
    ).toEqual([SecurityAttentionKey.Approvals]);
    expect(getSecurityAttentionItems(queue())).toEqual([]);
  });

  test("red only while a critical or high case is open, as Home keeps red for incidents; amber for everything else that waits", () => {
    expect(
      headline({ openCases: 1, unassignedOpenCases: 1 }, status(SET_UP)).tone,
    ).toBe(SecurityStatusTone.Warning);
    expect(headline({ runsWaitingForApproval: 2 }, status(SET_UP)).tone).toBe(
      SecurityStatusTone.Warning,
    );
    expect(
      headline({ openCases: 1, myOpenCases: 1 }, status(SET_UP)).tone,
    ).toBe(SecurityStatusTone.Warning);
    expect(
      headline(
        { openCases: 2, highOpenCases: 1, unassignedOpenCases: 1 },
        status(SET_UP),
      ).tone,
    ).toBe(SecurityStatusTone.Danger);
    expect(
      headline(
        { openCases: 1, criticalOpenCases: 1, myOpenCases: 1 },
        status(SET_UP),
      ).tone,
    ).toBe(SecurityStatusTone.Danger);
  });

  test("cases open, every one someone else's and nothing held: in hand, without a number the pipeline already shows", () => {
    const inHand: SecurityHeadline = headline(
      { openCases: 4, criticalOpenCases: 1 },
      status(SET_UP),
    );

    expect(inHand).toMatchObject({
      kind: SecurityHeadlineKind.InHand,
      tone: SecurityStatusTone.Info,
      icon: IconProp.UserGroup,
      title: IN_HAND_TITLE,
      summary: { text: IN_HAND_SUMMARY },
      items: [],
      action: SecurityHeadlineAction.None,
    });
    expect(say(inHand.summary)).not.toMatch(/\d/);
  });

  test("what waits for a person outranks a project nothing watches, and cases in hand do too", () => {
    expect(
      headline({ openCases: 1, unassignedOpenCases: 1 }, status()).kind,
    ).toBe(SecurityHeadlineKind.NeedsAttention);
    expect(headline({ openCases: 1 }, status()).kind).toBe(
      SecurityHeadlineKind.InHand,
    );
  });

  test("without the set-up figures, the overview alone decides: it never claims nothing is watched", () => {
    expect(headline({}, null).kind).toBe(SecurityHeadlineKind.Quiet);
    expect(headline({ openCases: 2 }, null).kind).toBe(
      SecurityHeadlineKind.InHand,
    );
    expect(headline({ myOpenCases: 1, openCases: 1 }, null).kind).toBe(
      SecurityHeadlineKind.NeedsAttention,
    );
  });
});

describe("watching, and gone quiet", () => {
  test("watching takes something that can open a case: a connection, or your logs with a rule or a threat intel feed", () => {
    // Nothing, or one half of a pair.
    expect(isSecurityWatching(status())).toBe(false);
    expect(isSecurityWatching(status({ logsSourceEnabled: true }))).toBe(false);
    expect(isSecurityWatching(status({ enabledRules: 3 }))).toBe(false);
    expect(isSecurityWatching(status({ threatIntelFeeds: 3 }))).toBe(false);
    // A playbook responds to cases; it opens none.
    expect(
      isSecurityWatching(
        status({ logsSourceEnabled: true, enabledPlaybooks: 2 }),
      ),
    ).toBe(false);

    // Your logs, read by a rule or by a feed.
    expect(
      isSecurityWatching(status({ logsSourceEnabled: true, enabledRules: 3 })),
    ).toBe(true);
    // Your other OneUptime data counts the same, and needs a rule the same.
    expect(
      isSecurityWatching(
        status({ telemetrySourcesEnabled: 2, enabledRules: 1 }),
      ),
    ).toBe(true);
    expect(isSecurityWatching(status({ telemetrySourcesEnabled: 2 }))).toBe(
      false,
    );
    expect(
      isSecurityWatching(
        status({ logsSourceEnabled: true, threatIntelFeeds: 1 }),
      ),
    ).toBe(true);
    // A connected product, whose alerts open cases on their own.
    expect(isSecurityWatching(status({ connections: 1 }))).toBe(true);
    expect(
      isSecurityWatching(status({ connections: 1, enabledRules: 3 })),
    ).toBe(true);
  });

  test("a source has gone quiet after a whole day without an event, and not a minute sooner", () => {
    const silentFor: (milliseconds: number) => boolean = (
      milliseconds: number,
    ): boolean => {
      return isSecuritySourceSilent(
        status({
          ...SET_UP,
          eventsLast24Hours: 0,
          lastEventAt: ago(milliseconds),
        }),
        NOW,
      );
    };

    expect(QUIET_SOURCE_AFTER_IN_MS).toBe(DAY_IN_MS);
    expect(silentFor(DAY_IN_MS - MINUTE_IN_MS)).toBe(false);
    expect(silentFor(DAY_IN_MS)).toBe(true);
    expect(silentFor(30 * DAY_IN_MS)).toBe(true);
    // Events today, a source that never sent anything, or no source at all.
    expect(
      isSecuritySourceSilent(
        status({ ...SET_UP, lastEventAt: ago(3 * DAY_IN_MS) }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isSecuritySourceSilent(
        status({ ...SET_UP, eventsLast24Hours: 0, lastEventAt: null }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isSecuritySourceSilent(
        status({ eventsLast24Hours: 0, lastEventAt: ago(3 * DAY_IN_MS) }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("the pipeline's cells", () => {
  test("four cells in the order Security works, each opening its part's page once it is set up", () => {
    expect(
      views(status(SET_UP)).map((stage: SecurityStageView) => {
        return [stage.key, stage.title, stage.icon, stage.page, stage.isReady];
      }),
    ).toEqual([
      [
        "sources",
        "Sources",
        IconProp.Link,
        PageMap.SECURITY_EVENTS_CONNECTIONS,
        true,
      ],
      [
        "detections",
        "Detections",
        IconProp.ShieldCheck,
        PageMap.SECURITY_EVENTS_DETECTION_RULES,
        true,
      ],
      [
        "cases",
        "Security Cases",
        IconProp.ShieldExclamation,
        PageMap.SECURITY_CASES,
        true,
      ],
      [
        "playbooks",
        "Playbooks",
        IconProp.Bolt,
        PageMap.SECURITY_PLAYBOOKS,
        true,
      ],
    ]);
  });

  test("a part not set up reads Not set up in grey, says what to do, and opens where it is done - never an amber card", () => {
    const fresh: Array<SecurityStageView> = views(status());

    expect(
      fresh.map((stage: SecurityStageView) => {
        return [
          stage.key,
          stage.isReady,
          read(stage),
          stage.figureTone,
          stage.statusTone,
          stage.statusIcon,
          stage.page,
        ];
      }),
    ).toEqual([
      [
        "sources",
        false,
        ["Not set up", "Connect a source"],
        SecurityStatusTone.Neutral,
        SecurityStatusTone.Neutral,
        IconProp.Add,
        PageMap.SECURITY_EVENTS_CONNECTIONS,
      ],
      [
        "detections",
        false,
        ["Not set up", "Turn on rules"],
        SecurityStatusTone.Neutral,
        SecurityStatusTone.Neutral,
        IconProp.Add,
        // Rules are added in the library, not the (empty) list of the project's own.
        PageMap.SECURITY_EVENTS_RULE_LIBRARY,
      ],
      [
        "cases",
        true,
        ["None open", "All clear"],
        SecurityStatusTone.Success,
        SecurityStatusTone.Success,
        IconProp.CheckCircle,
        PageMap.SECURITY_CASES,
      ],
      [
        "playbooks",
        false,
        ["Not set up", "Add a playbook"],
        SecurityStatusTone.Neutral,
        SecurityStatusTone.Neutral,
        IconProp.Add,
        PageMap.SECURITY_PLAYBOOKS,
      ],
    ]);
    expect([
      NOT_SET_UP_FIGURE,
      SET_UP_SOURCES,
      SET_UP_DETECTIONS,
      SET_UP_PLAYBOOKS,
    ]).toEqual([
      "Not set up",
      "Connect a source",
      "Turn on rules",
      "Add a playbook",
    ]);
  });

  test("sources: events today read as fine; a day without one as gone quiet, in amber, with when; never anything as no events yet", () => {
    const today: SecurityStageView = view(
      status({ ...SET_UP, connections: 1, eventsLast24Hours: 18432 }),
      "sources",
    );

    expect(read(today)).toEqual(["2 sources", "18,432 events in 24 hours"]);
    expect([today.statusTone, today.statusIcon]).toEqual([
      SecurityStatusTone.Success,
      IconProp.CheckCircle,
    ]);

    const silent: SecurityStageView = view(
      status({
        ...SET_UP,
        eventsLast24Hours: 0,
        lastEventAt: ago(3 * DAY_IN_MS),
      }),
      "sources",
    );

    expect(read(silent)).toEqual(["1 source", "Last event 3 days ago"]);
    expect([silent.statusTone, silent.statusIcon]).toEqual([
      SecurityStatusTone.Warning,
      IconProp.SignalSlash,
    ]);
    // The figure is still a plain count: the status line carries the alarm.
    expect(silent.figureTone).toBe(SecurityStatusTone.Success);

    const never: SecurityStageView = view(
      status({ ...SET_UP, eventsLast24Hours: 0, lastEventAt: null }),
      "sources",
    );

    expect(read(never)).toEqual(["1 source", "No events yet"]);
    expect([never.statusTone, never.statusIcon]).toEqual([
      SecurityStatusTone.Neutral,
      IconProp.Clock,
    ]);
  });

  test("a last event within the day but no count (a read that failed) is said without alarm, and one from a clock ahead reads as now", () => {
    const recent: SecurityStageView = view(
      status({
        ...SET_UP,
        eventsLast24Hours: 0,
        lastEventAt: ago(5 * MINUTE_IN_MS),
      }),
      "sources",
    );

    expect(read(recent)).toEqual(["1 source", "Last event 5 minutes ago"]);
    expect(recent.statusTone).toBe(SecurityStatusTone.Neutral);

    const ahead: SecurityStageView = view(
      status({
        ...SET_UP,
        eventsLast24Hours: 0,
        lastEventAt: new Date(NOW.getTime() + 10 * MINUTE_IN_MS),
      }),
      "sources",
    );

    expect(say(ahead.status)).toBe("Last event now");
    expect(say(ahead.status)).not.toContain("in 10 minutes");
  });

  test("your logs count as one source beside the connections", () => {
    expect(
      read(view(status({ ...SET_UP, connections: 3 }), "sources"))[0],
    ).toBe("4 sources");
    expect(
      read(
        view(
          status({ ...SET_UP, connections: 2, logsSourceEnabled: false }),
          "sources",
        ),
      )[0],
    ).toBe("2 sources");
  });

  test("detections: every recommended rule on reads as fine, fewer as a plain fact, and a library with none recommended says nothing", () => {
    const all: SecurityStageView = view(status(SET_UP), "detections");

    expect(read(all)).toEqual(["20 rules on", "20 of 20 recommended"]);
    expect([all.statusTone, all.statusIcon]).toEqual([
      SecurityStatusTone.Success,
      IconProp.CheckCircle,
    ]);

    const some: SecurityStageView = view(
      status({ ...SET_UP, enabledRules: 8, recommendedRulesOn: 3 }),
      "detections",
    );

    expect(read(some)).toEqual(["8 rules on", "3 of 20 recommended"]);
    expect([some.statusTone, some.statusIcon]).toEqual([
      SecurityStatusTone.Neutral,
      IconProp.LightBulb,
    ]);

    const one: SecurityStageView = view(
      status({
        ...SET_UP,
        enabledRules: 1,
        recommendedRules: 0,
        recommendedRulesOn: 0,
      }),
      "detections",
    );

    expect(read(one)).toEqual(["1 rule on", null]);
    // More on than the library recommends never reads as "21 of 20".
    expect(
      say(
        view(status({ ...SET_UP, recommendedRulesOn: 21 }), "detections")
          .status,
      ),
    ).toBe("20 of 20 recommended");
  });

  test("cases: none open is all clear; critical or high open are red and counted; others are amber, none of them urgent", () => {
    const none: SecurityStageView = view(status(SET_UP), "cases");

    expect(read(none)).toEqual(["None open", "All clear"]);
    expect(none.statusTone).toBe(SecurityStatusTone.Success);

    const urgent: SecurityStageView = view(
      status({ ...SET_UP, openCases: 6 }),
      "cases",
      { openCases: 6, criticalOpenCases: 2, highOpenCases: 2 },
    );

    expect(read(urgent)).toEqual(["6 open cases", "2 critical · 2 high"]);
    expect([urgent.figureTone, urgent.statusTone, urgent.statusIcon]).toEqual([
      SecurityStatusTone.Danger,
      SecurityStatusTone.Danger,
      IconProp.Alert,
    ]);

    const calm: SecurityStageView = view(
      status({ ...SET_UP, openCases: 1 }),
      "cases",
      { openCases: 1 },
    );

    expect(read(calm)).toEqual(["1 open case", "None critical or high"]);
    expect([calm.figureTone, calm.statusTone]).toEqual([
      SecurityStatusTone.Warning,
      SecurityStatusTone.Neutral,
    ]);
  });

  test("playbooks: a step held for an approval reads in amber; otherwise nothing waiting", () => {
    const held: SecurityStageView = view(
      status({ ...SET_UP, enabledPlaybooks: 3 }),
      "playbooks",
      { runsWaitingForApproval: 1 },
    );

    expect(read(held)).toEqual(["3 playbooks on", "1 step to approve"]);
    expect([held.statusTone, held.statusIcon]).toEqual([
      SecurityStatusTone.Warning,
      IconProp.PauseCircle,
    ]);
    expect(
      say(
        view(status(SET_UP), "playbooks", { runsWaitingForApproval: 2 }).status,
      ),
    ).toBe("2 steps to approve");

    const clear: SecurityStageView = view(status(SET_UP), "playbooks");

    expect(read(clear)).toEqual(["1 playbook on", "Nothing waiting"]);
    expect(clear.statusTone).toBe(SecurityStatusTone.Success);
  });
});

describe("words", () => {
  test("each kind of sentence is looked up whole, and filled the way the reader's language writes it", () => {
    const german: Translator = createTranslator((text: string) => {
      return (
        {
          [LAST_EVENT]: "Letztes Ereignis {{time}}",
          [NONE_OPEN]: "Keiner offen",
          [RECOMMENDED_ON]: "{{on}} von {{total}} empfohlenen",
          [SOURCES_FIGURE.other]: "{{count}} Quellen",
          [`${SOURCES_FIGURE.other}_one`]: "{{count}} Quelle",
        } as Record<string, string>
      )[text];
    }, "de");

    expect(
      translateSecurityOverviewText(german, {
        template: LAST_EVENT,
        since: ago(3 * DAY_IN_MS),
        now: NOW,
      }),
    ).toBe("Letztes Ereignis vor 3 Tagen");
    expect(translateSecurityOverviewText(german, { text: NONE_OPEN })).toBe(
      "Keiner offen",
    );
    expect(
      translateSecurityOverviewText(german, {
        template: RECOMMENDED_ON,
        values: { on: 3, total: 20 },
      }),
    ).toBe("3 von 20 empfohlenen");
    expect(
      translateSecurityOverviewText(german, {
        plural: SOURCES_FIGURE,
        count: 1234,
      }),
    ).toBe("1.234 Quellen");
    expect(
      translateSecurityOverviewText(german, {
        plural: SOURCES_FIGURE,
        count: 1,
      }),
    ).toBe("1 Quelle");
    // A sentence the language has no words for reads whole in English.
    expect(translateSecurityOverviewText(german, { text: ALL_CLEAR })).toBe(
      "All clear",
    );
  });

  test("a template's numbers are written the reader's way, as a plural's count is", () => {
    const german: Translator = createTranslator((text: string) => {
      return (
        {
          [RECOMMENDED_ON]: "{{on}} von {{total}} empfohlenen",
          [URGENT_OPEN_CASES]: "{{critical}} kritisch · {{high}} hoch",
        } as Record<string, string>
      )[text];
    }, "de");

    expect(
      translateSecurityOverviewText(german, {
        template: RECOMMENDED_ON,
        values: { on: 1200, total: 2400 },
      }),
    ).toBe("1.200 von 2.400 empfohlenen");
    expect(
      translateSecurityOverviewText(ENGLISH, {
        template: URGENT_OPEN_CASES,
        values: { critical: 1500, high: 2 },
      }),
    ).toBe("1,500 critical · 2 high");

    // Persian digits beside Persian digits: never "3" next to a Persian 8.
    const persianLocale: Record<string, unknown> = readLocale("fa");
    const persian: Translator = createTranslator((text: string) => {
      const value: unknown = persianLocale[text];

      return typeof value === "string" ? value : undefined;
    }, "fa");
    const recommended: string = translateSecurityOverviewText(persian, {
      template: RECOMMENDED_ON,
      values: { on: 3, total: 20 },
    });
    const rules: string = translateSecurityOverviewText(persian, {
      plural: RULES_ON_FIGURE,
      count: 8,
    });

    expect(recommended).toContain(persian.formatNumber(3));
    expect(recommended).toContain(persian.formatNumber(20));
    expect(rules).toContain(persian.formatNumber(8));
    expect(`${recommended} ${rules}`).not.toMatch(LATIN_DIGIT);

    // Words stay as they are; only numbers are written out.
    expect(
      formatSecurityOverviewValues(ENGLISH, { name: "Okta", count: 12000 }),
    ).toEqual({ name: "Okta", count: "12,000" });
  });
});

/*
 * Every sentence the card can say, as its translation key: the model's
 * words in every state, recorded through a translator, and the words the
 * component draws from the model's constants.
 */
function everyKey(): Array<string> {
  const keys: Set<string> = new Set<string>();
  const addPlural: (template: PluralTemplate) => void = (
    template: PluralTemplate,
  ): void => {
    keys.add(template.other);
    keys.add(`${template.other}_one`);
  };
  const recording: Translator = {
    ...ENGLISH,
    translateText: (text: string | undefined): string | undefined => {
      if (text) {
        keys.add(text);
      }
      return text;
    },
    translateTemplate: (template: string, values?: TemplateValues): string => {
      keys.add(template);
      return ENGLISH.translateTemplate(template, values);
    },
    translatePlural: (
      template: PluralTemplate,
      count: number,
      values?: TemplateValues,
    ): string => {
      addPlural(template);
      return ENGLISH.translatePlural(template, count, values);
    },
  };
  const statuses: Array<SecuritySetupStatus> = [
    status(),
    status(SET_UP),
    status({ ...SET_UP, enabledPlaybooks: 0, recommendedRulesOn: 3 }),
    status({
      ...SET_UP,
      eventsLast24Hours: 0,
      lastEventAt: ago(3 * DAY_IN_MS),
    }),
    status({ ...SET_UP, eventsLast24Hours: 0, lastEventAt: null }),
    status({ ...SET_UP, openCases: 3 }),
  ];
  const queues: Array<SecurityOverviewQueue> = [
    queue(),
    queue({ openCases: 3 }),
    queue({ openCases: 3, highOpenCases: 1 }),
    queue({
      openCases: 3,
      myOpenCases: 1,
      unassignedOpenCases: 1,
      runsWaitingForApproval: 1,
    }),
  ];

  for (const value of [...statuses, null]) {
    for (const queued of queues) {
      const band: SecurityHeadline = getSecurityHeadline({
        queue: queued,
        status: value,
        now: NOW,
      });

      recording.translateText(band.title);
      if (band.summary) {
        translateSecurityOverviewText(recording, band.summary);
      }
      for (const item of band.items) {
        recording.translatePlural(item.label, item.count);
      }

      if (value) {
        for (const stage of getSecurityStageViews({
          status: value,
          queue: queued,
          now: NOW,
        })) {
          recording.translateText(stage.title);
          translateSecurityOverviewText(recording, stage.figure);
          if (stage.status) {
            translateSecurityOverviewText(recording, stage.status);
          }
        }
      }
    }
  }

  // What the component draws straight from the model.
  for (const key of [
    ATTENTION_LIST_LABEL,
    SET_UP_SECURITY,
    STATUS_READ_FAILED,
    OVERVIEW_READ_FAILED_TITLE,
  ]) {
    keys.add(key);
  }
  addPlural(SIEM_DESTINATIONS);

  return Array.from(keys);
}

// Japanese, Korean and Chinese have no "one" form: their _one keys are never read.
const WITHOUT_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

/*
 * The sentences this card brought, which every language words its own way.
 * The rest are labels the product already uses elsewhere - Sources,
 * Playbooks, Not set up, All clear - whose translations the docs quote as
 * each language draws them: they are held only to be in every file.
 */
const CARD_SENTENCES: Array<string> = [
  QUIET_SUMMARY_WITHOUT_PLAYBOOKS,
  QUIET_SUMMARY_SOURCES_SILENT,
  IN_HAND_TITLE,
  IN_HAND_SUMMARY,
  NOT_SET_UP_TITLE,
  NOT_SET_UP_SUMMARY,
  SET_UP_SECURITY,
  SET_UP_SOURCES,
  SET_UP_DETECTIONS,
  SET_UP_PLAYBOOKS,
  NO_EVENTS_YET,
  LAST_EVENT,
  NONE_URGENT,
  STEPS_TO_APPROVE.other,
  `${STEPS_TO_APPROVE.other}_one`,
  ATTENTION_LIST_LABEL,
  STATUS_READ_FAILED,
  OVERVIEW_READ_FAILED_TITLE,
];

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(getLocalePath(code), "utf8"));
}

describe("every sentence the card can say, in every language", () => {
  const keys: Array<string> = everyKey();

  test("the walk reaches the card's sentences in every state", () => {
    for (const expected of [
      QUIET_TITLE,
      QUIET_SUMMARY,
      QUIET_SUMMARY_WITHOUT_PLAYBOOKS,
      QUIET_SUMMARY_SOURCES_SILENT,
      NEEDS_ATTENTION_TITLE,
      IN_HAND_TITLE,
      IN_HAND_SUMMARY,
      NOT_SET_UP_TITLE,
      NOT_SET_UP_SUMMARY,
      NOT_SET_UP_FIGURE,
      SET_UP_SOURCES,
      SET_UP_DETECTIONS,
      SET_UP_PLAYBOOKS,
      NO_EVENTS_YET,
      LAST_EVENT,
      RECOMMENDED_ON,
      NONE_OPEN,
      ALL_CLEAR,
      URGENT_OPEN_CASES,
      NONE_URGENT,
      NOTHING_WAITING,
      EVENTS_IN_24_HOURS.other,
      RULES_ON_FIGURE.other,
      OPEN_CASES_FIGURE.other,
      PLAYBOOKS_ON_FIGURE.other,
      STEPS_TO_APPROVE.other,
      MY_OPEN_CASES_LABEL.other,
      UNASSIGNED_OPEN_CASES_LABEL.other,
      STEPS_WAITING_LABEL.other,
      "Sources",
      "Detections",
      "Security Cases",
      "Playbooks",
    ]) {
      expect([expected, keys.includes(expected)]).toEqual([expected, true]);
    }
  });

  test("en.json has every one, each plural with its one sentence", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const key of keys) {
      if (key.endsWith("_one")) {
        expect([key, typeof english[key]]).toEqual([key, "string"]);
        continue;
      }
      expect([key, english[key]]).toEqual([key, key]);
    }
    expect(english[`${STEPS_TO_APPROVE.other}_one`]).toBe(STEPS_TO_APPROVE.one);
  });

  test.each(TRANSLATED_LOCALES)(
    "%s has every one, and its own wording of the card's own sentences",
    (code: string) => {
      const locale: Record<string, unknown> = readLocale(code);
      const english: Record<string, unknown> = readLocale("en");

      expect(
        keys.filter((key: string): boolean => {
          return typeof locale[key] !== "string";
        }),
      ).toEqual([]);
      expect(
        CARD_SENTENCES.filter((key: string): boolean => {
          if (key.endsWith("_one") && WITHOUT_ONE_FORM.includes(code)) {
            return false;
          }
          return locale[key] === english[key];
        }),
      ).toEqual([]);
    },
  );

  test("the card's own sentences are among what it says", () => {
    expect(
      CARD_SENTENCES.filter((key: string): boolean => {
        return !keys.includes(key);
      }),
    ).toEqual([]);
  });

  test("a time since keeps its place in every language's sentence", () => {
    for (const code of TRANSLATED_LOCALES) {
      const locale: Record<string, unknown> = readLocale(code);

      for (const key of [LAST_EVENT, QUIET_SUMMARY_SOURCES_SILENT]) {
        expect([code, key, String(locale[key]).includes("{{time}}")]).toEqual([
          code,
          key,
          true,
        ]);
      }
    }
  });
});
