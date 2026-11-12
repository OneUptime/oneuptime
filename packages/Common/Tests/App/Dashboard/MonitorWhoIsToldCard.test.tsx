/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import MonitorWhoIsToldCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorWhoIsToldCard";
import WhoIsToldApi, {
  getWhoIsToldUrl,
  isWhoIsToldResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldApi";
import {
  BREAK_SENTENCES,
  getBreakSentence,
  getFixLink,
  getWhoIsToldSentences,
  getWhoIsToldSummary,
  WhoIsToldFixLink,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldWords";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldChannels,
  WhoIsToldCriteria,
  WhoIsToldEvent,
  WhoIsToldFix,
  WhoIsToldOwnersSource,
  WhoIsToldPerson,
  WhoIsToldPersonProblem,
  WhoIsToldPolicy,
  WhoIsToldResult,
  WhoIsToldServerChannel,
  getWhoIsToldBreaks,
  makeWhoIsToldBreak,
} from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { OnCallTestPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import {
  createTranslator,
  getGlobalTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import fs from "fs";
import path from "path";

/*
 * "WHEN THIS GOES DOWN" ON A MONITOR'S OVERVIEW (#6810): what happens and
 * who is told, in two or three sentences first, every break named with a
 * link to the page that puts it right, and the chain itself one click away.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "68102222-0000-4000-8000-000000000001",
);
const POLICY_ID: string = "68102222-0000-4000-8000-0000000000a1";
const ANA: string = "68102222-0000-4000-8000-0000000000d1";
const BEN: string = "68102222-0000-4000-8000-0000000000d2";

const translator: Translator = getGlobalTranslator();

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

// The Dashboard's own words in `language`, as the card reads them there.
function localeTranslator(language: string): Translator {
  const words: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;

  return createTranslator((text: string): string | undefined => {
    const value: unknown = words[text];
    return typeof value === "string" ? value : undefined;
  }, language);
}

function channels(): WhoIsToldChannels {
  return {
    isBillingEnabled: false,
    isSmsOn: true,
    isCallOn: true,
    isWhatsAppOn: true,
    isTelegramOn: true,
    hasOwnTwilioForSms: false,
    hasOwnTwilioForCalls: false,
    serverCanSendEmail: true,
    serverCanSendSms: true,
    serverCanCall: true,
  };
}

function person(overrides: Partial<WhoIsToldPerson> = {}): WhoIsToldPerson {
  return {
    userId: ANA,
    name: "Ana Lopez",
    channels: [OnCallPageChannel.SMS, OnCallPageChannel.Email],
    isFallback: false,
    isReachable: true,
    ...overrides,
  };
}

function policy(overrides: Partial<WhoIsToldPolicy> = {}): WhoIsToldPolicy {
  return {
    id: POLICY_ID,
    name: "Primary",
    isHidden: false,
    isNamedByCriteria: false,
    ruleIds: ["r"],
    levelCount: 1,
    people: [person()],
    notPaged: [],
    ...overrides,
  };
}

function event(overrides: Partial<WhoIsToldEvent> = {}): WhoIsToldEvent {
  return {
    kind: OnCallTestPageRecordKind.Incident,
    title: "Checkout API is offline",
    severityName: "Critical",
    owners: {
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: ["Owner One"],
      teamNames: [],
    },
    ownerRules: [],
    rules: [{ id: "r", name: "Every incident" }],
    policies: [policy()],
    statusPages: [{ id: "s", name: "Public status" }],
    ...overrides,
  };
}

function offline(
  overrides: Partial<WhoIsToldCriteria> = {},
): WhoIsToldCriteria {
  return {
    id: "offline",
    name: "Offline",
    statusName: "Offline",
    statusColor: "#ef4444",
    events: [event()],
    ...overrides,
  };
}

function result(
  criteria: Array<WhoIsToldCriteria>,
  overrides: Partial<WhoIsToldResult> = {},
): WhoIsToldResult {
  return {
    monitorId: MONITOR_ID.toString(),
    monitorName: "Checkout API",
    checkedAt: new Date().toISOString(),
    criteria: criteria,
    channels: channels(),
    breaks: getWhoIsToldBreaks({
      criteria: criteria,
      channels: channels(),
      projectHasIncidentOnCallRules: true,
      projectHasAlertOnCallRules: false,
    }),
    ...overrides,
  };
}

describe("the card's first words", () => {
  test("says what happens, who is emailed and who is paged, as the issue words it", () => {
    expect(getWhoIsToldSentences(result([offline()]), translator)).toEqual([
      "OneUptime marks it Offline and opens a Critical incident.",
      "It emails the project's owners (Owner One).",
      "It pages Ana Lopez through Primary.",
    ]);
  });

  test("nobody paged, said plainly", () => {
    expect(
      getWhoIsToldSentences(
        result([offline({ events: [event({ rules: [], policies: [] })] })]),
        translator,
      )[2],
    ).toBe("Nobody is paged.");
  });

  test("an alert without a status change, its owners named by the criteria", () => {
    expect(
      getWhoIsToldSentences(
        result([
          offline({
            statusName: undefined,
            events: [
              event({
                kind: OnCallTestPageRecordKind.Alert,
                severityName: "Warning",
                owners: {
                  source: WhoIsToldOwnersSource.Named,
                  userNames: ["Ana Lopez"],
                  teamNames: ["Platform"],
                },
              }),
            ],
          }),
        ]),
        translator,
      ).slice(0, 2),
    ).toEqual([
      "OneUptime opens a Warning alert.",
      "It emails its owners (Ana Lopez and Platform).",
    ]);
  });

  // #7076: when only the project's owner rules add owners, the sentence says so.
  test("owners only owner rules add are said to be theirs, named", () => {
    expect(
      getWhoIsToldSentences(
        result([
          offline({
            events: [
              event({
                owners: {
                  source: WhoIsToldOwnersSource.OwnerRules,
                  userNames: ["Ben Ito"],
                  teamNames: ["Checkout SRE"],
                },
                ownerRules: [{ id: "o", name: "Checkout monitors" }],
              }),
            ],
          }),
        ]),
        translator,
      )[1],
    ).toBe(
      "It emails the owners its owner rules add (Ben Ito and Checkout SRE).",
    );
  });

  test("owner rules that add owners nobody can be named still say whose owners they are", () => {
    expect(
      getWhoIsToldSentences(
        result([
          offline({
            events: [
              event({
                owners: {
                  source: WhoIsToldOwnersSource.OwnerRules,
                  userNames: [],
                  teamNames: [],
                },
              }),
            ],
          }),
        ]),
        translator,
      )[1],
    ).toBe("It emails the owners its owner rules add.");
  });

  test("many people are counted rather than listed", () => {
    const people: Array<WhoIsToldPerson> = [ANA, BEN, "c", "d"].map(
      (id: string, index: number): WhoIsToldPerson => {
        return person({ userId: id, name: `Person ${index}` });
      },
    );

    expect(
      getWhoIsToldSentences(
        result([
          offline({ events: [event({ policies: [policy({ people })] })] }),
        ]),
        translator,
      )[2],
    ).toBe("It pages 4 people through Primary.");
  });

  test("a policy the reader may not see: paging is set up, and nothing of who", () => {
    expect(
      getWhoIsToldSentences(
        result([
          offline({
            events: [
              event({
                policies: [policy({ isHidden: true, name: "", people: [] })],
              }),
            ],
          }),
        ]),
        translator,
      )[2],
    ).toBe(
      "It pages the people on call through an on-call policy you can't see.",
    );
  });

  test("policies that reach nobody who can be paged", () => {
    expect(
      getWhoIsToldSentences(
        result([
          offline({
            events: [
              event({
                policies: [
                  policy({
                    people: [person({ isReachable: false, channels: [] })],
                  }),
                ],
              }),
            ],
          }),
        ]),
        translator,
      )[2],
    ).toBe("Its on-call policies reach nobody who can be paged right now.");
  });

  test("a monitor that only changes its status says nobody is paged, and who is emailed of the change", () => {
    expect(
      getWhoIsToldSentences(
        result([
          offline({
            events: [],
            statusOwners: {
              source: WhoIsToldOwnersSource.MonitorOwners,
              userNames: ["Watcher"],
              teamNames: [],
            },
          }),
        ]),
        translator,
      ),
    ).toEqual([
      "OneUptime marks it Offline. It opens no incident or alert, so nobody is paged.",
      "It emails the monitor's owners (Watcher).",
    ]);
  });

  test("more criteria that open something are counted", () => {
    expect(
      getWhoIsToldSentences(
        result([offline(), offline({ id: "degraded", name: "Degraded" })]),
        translator,
      )[3],
    ).toBe("1 more criteria opens an incident or alert.");
  });

  test("nothing at all, when no criteria does anything", () => {
    expect(getWhoIsToldSentences(result([]), translator)).toEqual([]);
    expect(getWhoIsToldSummary(result([]), translator)).toBe("");
  });

  /*
   * #7078: the card reads in every language, and its first words read as
   * one paragraph in each: Japanese and Chinese put nothing after their
   * full-width stop, every other language a space after each sentence.
   */
  describe("as one paragraph, as the reader's script writes one", () => {
    const owned: WhoIsToldResult = result([
      offline({
        events: [
          event({
            owners: {
              source: WhoIsToldOwnersSource.OwnerRules,
              userNames: ["Ben Ito"],
              teamNames: [],
            },
            ownerRules: [{ id: "o", name: "Checkout monitors" }],
          }),
        ],
      }),
    ]);

    test("English: a space after each sentence", () => {
      expect(getWhoIsToldSummary(owned, translator)).toBe(
        "OneUptime marks it Offline and opens a Critical incident. It emails the owners its owner rules add (Ben Ito). It pages Ana Lopez through Primary.",
      );
    });

    test.each(["ja", "zh-CN", "zh-TW"])(
      "%s: in its own words, nothing after a full-width stop",
      (language: string) => {
        const reader: Translator = localeTranslator(language);
        const sentences: Array<string> = getWhoIsToldSentences(owned, reader);

        expect(sentences).toHaveLength(3);

        for (const sentence of sentences) {
          // The language's own sentence, ended as it ends one.
          expect(sentence).toMatch(/。$/u);
          expect(sentence).not.toMatch(/\b(emails|pages|opens)\b/);
        }

        const summary: string = getWhoIsToldSummary(owned, reader);

        expect(summary).toBe(sentences.join(""));
        expect(summary).not.toContain("。 ");
        expect(summary).toContain("Ben Ito");
      },
    );

    test.each(["de", "fa", "ar", "da", "ko"])(
      "%s: in its own words, a space after each sentence",
      (language: string) => {
        const reader: Translator = localeTranslator(language);
        const sentences: Array<string> = getWhoIsToldSentences(owned, reader);

        expect(sentences).not.toEqual(getWhoIsToldSentences(owned, translator));
        expect(getWhoIsToldSummary(owned, reader)).toBe(sentences.join(" "));
      },
    );
  });
});

describe("a break, in the reader's words, with where to fix it", () => {
  test("each kind has its own sentence", () => {
    const brk: (data: Omit<WhoIsToldBreak, "message">) => string = (
      data: Omit<WhoIsToldBreak, "message">,
    ): string => {
      return getBreakSentence(makeWhoIsToldBreak(data), translator);
    };

    expect(
      brk({
        kind: WhoIsToldBreakKind.NobodyPaged,
        fix: WhoIsToldFix.IncidentOnCallRules,
        recordKind: OnCallTestPageRecordKind.Incident,
      }),
    ).toBe(BREAK_SENTENCES.nobodyPagedIncidents);
    expect(
      brk({
        kind: WhoIsToldBreakKind.NobodyPaged,
        fix: WhoIsToldFix.AlertOnCallRules,
        recordKind: OnCallTestPageRecordKind.Alert,
      }),
    ).toBe(BREAK_SENTENCES.nobodyPagedAlerts);
    expect(
      brk({
        kind: WhoIsToldBreakKind.PolicyHasNoLevels,
        fix: WhoIsToldFix.OnCallPolicy,
        policyId: POLICY_ID,
        policyName: "Primary",
      }),
    ).toBe(
      "On-call policy Primary has no escalation rules, so it pages nobody.",
    );
    expect(
      brk({
        kind: WhoIsToldBreakKind.PolicyReachesNobody,
        fix: WhoIsToldFix.OnCallPolicy,
        policyId: POLICY_ID,
      }),
    ).toBe(BREAK_SENTENCES.hiddenPolicyReachesNobody);
    expect(
      brk({
        kind: WhoIsToldBreakKind.PersonUnreachable,
        fix: WhoIsToldFix.OnCallReadiness,
        userName: "Ben Ito",
        problem: WhoIsToldPersonProblem.OptedOut,
      }),
    ).toBe("Ben Ito opted out of pages of this severity.");
    expect(
      brk({
        kind: WhoIsToldBreakKind.ChannelOff,
        fix: WhoIsToldFix.ProjectNotificationSettings,
        channel: OnCallPageChannel.Call,
      }),
    ).toBe(
      "Phone call is off in this project, so pages that use it are not sent.",
    );
    expect(
      brk({
        kind: WhoIsToldBreakKind.ServerCannotSend,
        fix: WhoIsToldFix.ServerSettings,
        channel: WhoIsToldServerChannel.SMS,
      }),
    ).toBe(BREAK_SENTENCES.serverCannotSend[WhoIsToldServerChannel.SMS]);

    for (const kind of Object.values(WhoIsToldBreakKind)) {
      expect(
        brk({ kind: kind, fix: WhoIsToldFix.MonitorCriteria }).length,
      ).toBeGreaterThan(10);
    }
  });

  test("each fix opens the page that changes it", () => {
    const link: (
      data: Omit<WhoIsToldBreak, "message">,
    ) => WhoIsToldFixLink | null = (
      data: Omit<WhoIsToldBreak, "message">,
    ): WhoIsToldFixLink | null => {
      return getFixLink({
        brk: makeWhoIsToldBreak(data),
        monitorId: MONITOR_ID,
        translator: translator,
      });
    };

    expect(
      link({
        kind: WhoIsToldBreakKind.NothingHappens,
        fix: WhoIsToldFix.MonitorCriteria,
      })!.route.toString(),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.MONITOR_VIEW_CRITERIA] as Route,
        {
          modelId: MONITOR_ID,
        },
      ).toString(),
    );
    expect(
      link({
        kind: WhoIsToldBreakKind.NobodyPaged,
        fix: WhoIsToldFix.IncidentOnCallRules,
      }),
    ).toMatchObject({ text: "Set Up Paging" });
    expect(
      link({
        kind: WhoIsToldBreakKind.OnlyIncidentsHaveRules,
        fix: WhoIsToldFix.AlertOnCallRules,
      })!.route.toString(),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ALERTS_SETTINGS_ON_CALL_RULES] as Route,
      ).toString(),
    );
    expect(
      link({
        kind: WhoIsToldBreakKind.PolicyHasNoLevels,
        fix: WhoIsToldFix.OnCallPolicy,
        policyId: POLICY_ID,
        policyName: "Primary",
      })!.route.toString(),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route,
        { modelId: new ObjectID(POLICY_ID) },
      ).toString(),
    );
    // A policy the reader may not see: the list of policies, not its page.
    expect(
      link({
        kind: WhoIsToldBreakKind.PolicyHasNoLevels,
        fix: WhoIsToldFix.OnCallPolicy,
        policyId: POLICY_ID,
      })!.route.toString(),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route,
      ).toString(),
    );
    expect(
      link({
        kind: WhoIsToldBreakKind.NoBalance,
        fix: WhoIsToldFix.ProjectBilling,
      }),
    ).toMatchObject({ text: "Open Billing" });
    // The server's settings are not the Dashboard's.
    expect(
      link({
        kind: WhoIsToldBreakKind.ServerCannotSend,
        fix: WhoIsToldFix.ServerSettings,
      }),
    ).toBeNull();
  });
});

describe("the request", () => {
  test("one GET for the monitor, with refresh only when asked", () => {
    expect(getWhoIsToldUrl({ monitorId: MONITOR_ID }).toString()).toContain(
      `/who-is-told/monitor/${MONITOR_ID.toString()}`,
    );
    expect(getWhoIsToldUrl({ monitorId: MONITOR_ID }).toString()).not.toContain(
      "refresh",
    );
    expect(
      getWhoIsToldUrl({ monitorId: MONITOR_ID, refresh: true }).toString(),
    ).toContain("refresh=true");
  });
});

describe("the answer's shape", () => {
  test("only an answer with criteria, breaks, channels and a time is drawn", () => {
    expect(isWhoIsToldResult(result([offline()]))).toBe(true);
    expect(isWhoIsToldResult({ data: [], count: 0 })).toBe(false);
    expect(isWhoIsToldResult(null)).toBe(false);
    expect(isWhoIsToldResult([])).toBe(false);
    expect(isWhoIsToldResult({ ...result([]), channels: undefined })).toBe(
      false,
    );
    expect(isWhoIsToldResult({ ...result([]), checkedAt: 5 })).toBe(false);
  });
});

describe("MonitorWhoIsToldCard", () => {
  let getForMonitor: SpyInstance<typeof WhoIsToldApi.getForMonitor>;

  function renderCard(): void {
    render(
      <MemoryRouter>
        <MonitorWhoIsToldCard monitorId={MONITOR_ID} />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    getForMonitor = jest.spyOn(WhoIsToldApi, "getForMonitor");
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("loads once, then says what happens and that nothing stops the chain", async () => {
    getForMonitor.mockResolvedValue(result([offline()]));
    renderCard();

    expect(screen.getByTestId("who-is-told-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("who-is-told-summary")).toHaveTextContent(
      "OneUptime marks it Offline and opens a Critical incident. It emails the project's owners (Owner One). It pages Ana Lopez through Primary.",
    );
    expect(screen.getByTestId("who-is-told-no-breaks")).toBeInTheDocument();
    expect(screen.getByText("When this goes down")).toBeInTheDocument();
    expect(getForMonitor).toHaveBeenCalledTimes(1);
    expect(getForMonitor.mock.calls[0]![0]).toEqual({
      monitorId: MONITOR_ID,
      refresh: false,
    });
  });

  test("names each break, with a link to the page that fixes it", async () => {
    getForMonitor.mockResolvedValue(
      result([offline({ events: [event({ rules: [], policies: [] })] })]),
    );
    renderCard();

    const brk: HTMLElement = await screen.findByTestId("who-is-told-break");

    expect(brk).toHaveAttribute("data-kind", WhoIsToldBreakKind.NobodyPaged);
    expect(brk).toHaveTextContent(BREAK_SENTENCES.nobodyPagedIncidents);

    const fix: HTMLElement = within(brk).getByTestId("who-is-told-fix");

    expect(fix).toHaveTextContent("Set Up Paging");
    expect(fix.getAttribute("href")).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES] as Route,
      ).toString(),
    );
    expect(screen.queryByTestId("who-is-told-no-breaks")).toBeNull();
  });

  test("the chain is folded until asked for, and the toggle says which way it is", async () => {
    getForMonitor.mockResolvedValue(result([offline()]));
    renderCard();

    const toggle: HTMLElement = await screen.findByTestId(
      "who-is-told-chain-toggle",
    );

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Show the chain");
    expect(screen.queryByTestId("who-is-told-chain")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Hide the chain");

    const chain: HTMLElement = screen.getByTestId("who-is-told-chain");

    expect(chain).toHaveTextContent("When Offline matches");
    expect(chain).toHaveTextContent("A Critical incident");
    expect(chain).toHaveTextContent("Every incident");
    expect(chain).toHaveTextContent("Public status");
    expect(
      within(chain).getByText("Primary").closest("a")?.getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route,
        { modelId: new ObjectID(POLICY_ID) },
      ).toString(),
    );

    const ana: HTMLElement = within(chain).getByTestId("who-is-told-person");

    expect(ana).toHaveAttribute("data-reachable", "true");
    expect(ana).toHaveTextContent("Ana Lopez");
    expect(ana).toHaveTextContent("SMS, Email");

    fireEvent.click(toggle);

    expect(screen.queryByTestId("who-is-told-chain")).toBeNull();
  });

  /*
   * #7076: the chain says the title what opens would get, and which owner
   * rules add owners to it; #7077: every status page it shows on, a page
   * the reader may not see without its name.
   */
  test("the chain says the title, the owner rules that add owners and every status page", async () => {
    getForMonitor.mockResolvedValue(
      result([
        offline({
          events: [
            event({
              owners: {
                source: WhoIsToldOwnersSource.Named,
                userNames: ["Ana Lopez", "Ben Ito"],
                teamNames: [],
              },
              ownerRules: [{ id: "o", name: "Checkout monitors" }],
              statusPages: [
                { id: "s1", name: "Payments status" },
                { id: "s2", name: "Public status" },
              ],
            }),
          ],
        }),
      ]),
    );
    renderCard();

    fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));

    expect(screen.getByTestId("who-is-told-title")).toHaveTextContent(
      "Checkout API is offline",
    );
    expect(screen.getByTestId("who-is-told-owner-rules")).toHaveTextContent(
      "Owner Rules",
    );
    expect(screen.getByTestId("who-is-told-owner-rules")).toHaveTextContent(
      "Checkout monitors",
    );
    expect(screen.getByTestId("who-is-told-chain")).toHaveTextContent(
      "Ana Lopez, Ben Ito",
    );
    expect(screen.getByTestId("who-is-told-status-pages")).toHaveTextContent(
      "Payments status, Public status",
    );
  });

  test("an owner rule or a status page the reader may not see keeps its place, without its name", async () => {
    getForMonitor.mockResolvedValue(
      result([
        offline({
          events: [
            event({
              owners: {
                source: WhoIsToldOwnersSource.OwnerRules,
                userNames: ["Ben Ito"],
                teamNames: [],
              },
              ownerRules: [{ id: "o", name: "" }],
              statusPages: [
                { id: "s1", name: "" },
                { id: "s2", name: "Public status" },
              ],
            }),
          ],
        }),
      ]),
    );
    renderCard();

    fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));

    expect(screen.getByTestId("who-is-told-owner-rules")).toHaveTextContent(
      "A rule you can't see",
    );
    expect(screen.getByTestId("who-is-told-status-pages")).toHaveTextContent(
      "A status page you can't see, Public status",
    );
    // Who it emails is what the incident will say.
    expect(screen.getByTestId("who-is-told-chain")).toHaveTextContent(
      "Ben Ito",
    );
  });

  test("no owner rule adds anyone, no status page shows it, no title: none of those rows is drawn", async () => {
    getForMonitor.mockResolvedValue(
      result([offline({ events: [event({ title: "", statusPages: [] })] })]),
    );
    renderCard();

    fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));

    expect(screen.getByTestId("who-is-told-chain")).toHaveTextContent(
      "A Critical incident",
    );
    expect(screen.queryByTestId("who-is-told-title")).toBeNull();
    expect(screen.queryByTestId("who-is-told-owner-rules")).toBeNull();
    expect(screen.queryByTestId("who-is-told-status-pages")).toBeNull();
  });

  test("a title in another script reads its own way, apart from the card's words", async () => {
    getForMonitor.mockResolvedValue(
      result([offline({ events: [event({ title: "واجهة الدفع متوقفة" })] })]),
    );
    renderCard();

    fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));

    const title: HTMLElement = screen.getByTestId("who-is-told-title");

    expect(title.tagName).toBe("P");
    expect(title).toHaveAttribute("dir", "rtl");
  });

  test("somebody who can't be paged says so in the chain", async () => {
    getForMonitor.mockResolvedValue(
      result([
        offline({
          events: [
            event({
              policies: [
                policy({
                  people: [
                    person({
                      isReachable: false,
                      channels: [],
                      problem: WhoIsToldPersonProblem.NoVerifiedMethod,
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ]),
    );
    renderCard();

    fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));

    expect(screen.getByTestId("who-is-told-person")).toHaveAttribute(
      "data-reachable",
      "false",
    );
    expect(screen.getByTestId("who-is-told-person")).toHaveTextContent(
      "Can't be paged",
    );
    expect(screen.getByTestId("who-is-told-break")).toHaveTextContent(
      "Ana Lopez has no verified notification method.",
    );
  });

  test("a policy the reader may not see is in the chain, without its name or people", async () => {
    getForMonitor.mockResolvedValue(
      result([
        offline({
          events: [
            event({
              rules: [{ id: "r", name: "" }],
              policies: [policy({ isHidden: true, name: "", people: [] })],
            }),
          ],
        }),
      ]),
    );
    renderCard();

    fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));

    expect(screen.getByTestId("who-is-told-hidden-policy")).toBeInTheDocument();
    expect(screen.getByTestId("who-is-told-rules")).toHaveTextContent(
      "A rule you can't see",
    );
    expect(screen.queryByTestId("who-is-told-person")).toBeNull();
  });

  test("Recheck asks the server to work it out again", async () => {
    getForMonitor.mockResolvedValue(result([offline()]));
    renderCard();

    const recheck: HTMLElement = await screen.findByTestId(
      "who-is-told-recheck",
    );

    await act(async () => {
      fireEvent.click(recheck);
    });

    await waitFor(() => {
      expect(getForMonitor).toHaveBeenCalledTimes(2);
    });
    expect(getForMonitor.mock.calls[1]![0]).toEqual({
      monitorId: MONITOR_ID,
      refresh: true,
    });
  });

  test("a failed read says so, in words", async () => {
    getForMonitor.mockRejectedValue(new Error("Monitor not found."));
    renderCard();

    expect(await screen.findByTestId("who-is-told-error")).toHaveTextContent(
      "Couldn't work out who is told. Monitor not found.",
    );
  });

  test("a monitor whose criteria do nothing names that break, with Criteria to fix it", async () => {
    getForMonitor.mockResolvedValue(result([]));
    renderCard();

    const brk: HTMLElement = await screen.findByTestId("who-is-told-break");

    expect(brk).toHaveAttribute("data-kind", WhoIsToldBreakKind.NothingHappens);
    expect(within(brk).getByTestId("who-is-told-fix")).toHaveTextContent(
      "Open Criteria",
    );
    expect(screen.queryByTestId("who-is-told-summary")).toBeNull();
    expect(screen.queryByTestId("who-is-told-chain-toggle")).toBeNull();
  });
});
