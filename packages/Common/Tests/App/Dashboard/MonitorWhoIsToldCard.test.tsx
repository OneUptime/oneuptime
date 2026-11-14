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

/*
 * Read by a self-hosted server's member, whatever the environment says: a
 * server failure's reference goes to whoever runs the server
 * (serverNextWithReferenceSelfHosted). CI's config.env sets
 * BILLING_ENABLED=true, which reads as OneUptime's cloud and sends the
 * reader to support instead.
 */
jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mockedConfig;
});

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
import OneUptimeDate from "../../../Types/Date";
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
import {
  OnCallTestPageNotPagedCode,
  OnCallTestPageReachedThroughCode,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import {
  createTranslator,
  getGlobalTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
} from "../../../Types/Exception/UnexplainedError";
import fs from "fs";
import path from "path";
import { isolated } from "../../Helpers/IsolateMarks";

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

// A Tailwind variant that follows the window's width, not the card's.
const WINDOW_WIDTH_VARIANT: RegExp = /(^|\s)(sm|md|lg|xl|2xl):/u;
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);
const MIDDLE_DOT: string = String.fromCharCode(0xb7);

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
  test("owners only owner rules add are said to be added by owner rules, named", () => {
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
      "It emails the owners added by owner rules (Ben Ito and Checkout SRE).",
    );
  });

  test("owner rules that add owners nobody can be named still say owner rules added them", () => {
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
    ).toBe("It emails the owners added by owner rules.");
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
        "OneUptime marks it Offline and opens a Critical incident. It emails the owners added by owner rules (Ben Ito). It pages Ana Lopez through Primary.",
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

  test("Recheck is busy while it works - its own look, no hover, not the locked fade - and can be pressed again after", async () => {
    let finishRecheck: (value: WhoIsToldResult) => void = (): void => {};
    getForMonitor.mockResolvedValueOnce(result([offline()]));
    getForMonitor.mockReturnValueOnce(
      new Promise<WhoIsToldResult>(
        (resolve: (value: WhoIsToldResult) => void) => {
          finishRecheck = resolve;
        },
      ),
    );
    renderCard();

    const recheck: HTMLElement = await screen.findByTestId(
      "who-is-told-recheck",
    );

    // At rest it can be pressed, and answers the pointer.
    expect(recheck).toBeEnabled();
    expect(recheck).toHaveTextContent("Recheck");
    expect(recheck).toHaveClass("hover:underline");
    expect(recheck).not.toHaveAttribute("aria-busy", "true");

    await act(async () => {
      fireEvent.click(recheck);
    });

    /*
     * Busy: it cannot be pressed again, says what it is doing, keeps its
     * colour, and neither underlines under the pointer nor fades as if locked.
     */
    const busy: HTMLElement = screen.getByTestId("who-is-told-recheck");
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveTextContent("Checking...");
    expect(busy).toHaveClass("text-indigo-700");
    expect(busy).not.toHaveClass("hover:underline");
    expect(busy).not.toHaveClass("opacity-50");
    expect(busy).not.toHaveClass("cursor-not-allowed");
    expect(busy.className).not.toMatch(/(^|\s)disabled:/u);

    await act(async () => {
      finishRecheck(result([offline()]));
    });

    await waitFor(() => {
      expect(screen.getByTestId("who-is-told-recheck")).toBeEnabled();
    });
    const again: HTMLElement = screen.getByTestId("who-is-told-recheck");
    expect(again).toHaveTextContent("Recheck");
    expect(again).toHaveClass("hover:underline");
    expect(again).not.toHaveAttribute("aria-busy", "true");
  });

  test("a failed read says so, in words", async () => {
    getForMonitor.mockRejectedValue(new Error("Monitor not found."));
    renderCard();

    expect(await screen.findByTestId("who-is-told-error")).toHaveTextContent(
      "Couldn't work out who is told. Monitor not found.",
    );
  });

  /*
   * #7307: the read's error is API.getFriendlyMessage's answer. A gateway's
   * 502 or 504 is SERVER_DOWN_MESSAGE and a server failure comes with its
   * reference: the card said them as they came, half in English in every
   * other language, the reference with no copy button. It says why and what
   * to do next now (ErrorSentence), the reference in code with its button.
   */
  test("a gateway's 502 or 504: the server did not answer, try again in a few minutes - never the English it came as", async () => {
    getForMonitor.mockRejectedValue(new Error(SERVER_DOWN_MESSAGE));
    renderCard();

    const error: HTMLElement = await screen.findByTestId("who-is-told-error");

    expect(error.textContent).toBe(
      "Couldn't work out who is told. The OneUptime server did not answer. It may be starting or restarting. Try again in a few minutes.",
    );
    expect(error.textContent).not.toContain(SERVER_DOWN_MESSAGE);
    expect(error.textContent).not.toContain("Error connecting to server");
    expect(within(error).getByTestId("error-in-sentence")).toHaveAttribute(
      "data-error-kind",
      "ServerDown",
    );
    expect(screen.getByTestId("who-is-told-try-again")).toBeInTheDocument();
  });

  test("a server failure with its reference: why, what next, and the reference in code with a copy button", async () => {
    getForMonitor.mockRejectedValue(
      new Error(getUnexplainedServerErrorMessage("1f0c9a2b")),
    );
    renderCard();

    const error: HTMLElement = await screen.findByTestId("who-is-told-error");

    expect(error.textContent).toBe(
      "Couldn't work out who is told. The server ran into a problem it could not explain. Try again. If it keeps failing, give this reference to whoever runs your OneUptime server: 1f0c9a2b.",
    );

    const reference: HTMLElement = within(error).getByTestId("error-reference");

    expect(within(reference).getByText("1f0c9a2b").tagName).toBe("CODE");
    expect(
      within(reference).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
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

  /*
   * The card sits in the overview's side column from 1280 px up, so the
   * chain is laid out by the card's own width (a container query), never
   * the window's: a row's name over its value in the side column and on a
   * phone, beside it once the chain is 28rem wide. The browser suite
   * (WhenThisGoesDown.spec.ts) measures where each lands.
   */
  test("the chain is laid out by the card's own width, not the window's", async () => {
    getForMonitor.mockResolvedValue(result([offline()]));
    renderCard();

    fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));

    const chain: HTMLElement = screen.getByTestId("who-is-told-chain");

    expect(chain).toHaveClass("[container-type:inline-size]");
    // A name with no space in it breaks rather than run out of the card.
    expect(chain).toHaveClass("[overflow-wrap:anywhere]");

    const rows: Array<HTMLElement> = [
      screen.getByTestId("who-is-told-rules"),
      screen.getByTestId("who-is-told-status-pages"),
    ];

    for (const row of rows) {
      const name: HTMLElement = row.firstElementChild as HTMLElement;

      expect(row).toHaveClass(
        "flex-col",
        "[@container(min-width:28rem)]:flex-row",
      );
      expect(name).toHaveClass("[@container(min-width:28rem)]:w-40");
      expect(row.className).not.toMatch(WINDOW_WIDTH_VARIANT);
      expect(name.className).not.toMatch(WINDOW_WIDTH_VARIANT);
    }
  });

  test("On-call policy, a defined term, is drawn in capitals as every row's name is", async () => {
    getForMonitor.mockResolvedValue(result([offline()]));
    renderCard();

    fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));

    const term: HTMLElement = screen.getByTestId("defined-term");
    const name: HTMLElement | null = term.closest(".uppercase");

    expect(term.tagName).toBe("BUTTON");
    expect(term).toHaveTextContent("On-call policy");
    expect(name).not.toBeNull();
    // A button sets its text's case back to none: the name sets it again.
    expect(name).toHaveClass("[&_button]:uppercase");
    // The same name as every other row's.
    expect(name!.className).toBe(
      (screen.getByTestId("who-is-told-rules").firstElementChild as Element)
        .className,
    );
  });

  /*
   * A person's line: whether a page reaches them, in a column of its own,
   * then their name, how the policy reaches them and by what - each set off
   * by a mark that keeps to the fact before it, so a line that wraps never
   * starts with one.
   */
  test("a person's line: its icon in a column of its own, then the name, how and by what", async () => {
    getForMonitor.mockResolvedValue(
      result([
        offline({
          events: [
            event({
              policies: [
                policy({
                  people: [
                    person({ reachedThrough: "Team Platform" }),
                    person({
                      userId: BEN,
                      name: "Ben Ito",
                      channels: [],
                      isReachable: false,
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

    const lines: Array<HTMLElement> =
      screen.getAllByTestId("who-is-told-person");
    const mark: string = `${NO_BREAK_SPACE}${MIDDLE_DOT} `;

    expect(
      lines.map((line: HTMLElement): string => {
        const words: HTMLParagraphElement | null = line.querySelector("p");

        // The icon first, beside the words and never inside them.
        expect(line.children).toHaveLength(2);
        expect(line.children[0]!.querySelector("svg")).not.toBeNull();
        expect(line.children[1]).toBe(words);
        expect(words!.querySelector("svg")).toBeNull();

        return words!.textContent || "";
      }),
    ).toEqual([
      `Ana Lopez${mark}Team Platform${mark}SMS, Email`,
      `Ben Ito${mark}Can't be paged`,
    ]);
  });

  /*
   * Why each is paged and who is not, from the codes the server sends
   * (#7261): in English, the server's own English, word for word - a name
   * set apart only where it reads the other way.
   */
  describe("why each is paged and who is not", () => {
    const AWAY_UNTIL: string = "2026-11-14T09:00:00.000Z";

    function awayTime(): string {
      return OneUptimeDate.getDateAsUserFriendlyFormattedString(
        OneUptimeDate.fromString(AWAY_UNTIL),
      );
    }

    function notPagedEnglish(): Array<string> {
      return [
        `Lee Park is away until ${awayTime()}, with nobody covering.`,
        "Team Night shift has no members.",
        "Nobody is next in the rotation of schedule Weekend.",
        "Dana Wu is not a member of this project.",
        "The first escalation rule pages nobody yet. Add people, a team or a schedule to it.",
      ];
    }

    function codedPolicy(): WhoIsToldPolicy {
      const english: Array<string> = notPagedEnglish();

      return policy({
        levelCount: 2,
        people: [
          person({
            reachedThrough: "Team Platform",
            reachedThroughCode: {
              code: OnCallTestPageReachedThroughCode.Team,
              name: "Platform",
            },
          }),
          person({
            userId: BEN,
            name: "Ben Ito",
            reachedThrough: "Covering for Ana Lopez",
            reachedThroughCode: {
              code: OnCallTestPageReachedThroughCode.CoveringFor,
              name: "Ana Lopez",
            },
          }),
          person({
            userId: "68102222-0000-4000-8000-0000000000d3",
            name: "Cho Park",
            reachedThrough: "Schedule Primary",
            reachedThroughCode: {
              code: OnCallTestPageReachedThroughCode.Schedule,
              name: "Primary",
            },
          }),
          // A Persian team's name on an English page.
          person({
            userId: "68102222-0000-4000-8000-0000000000d4",
            name: "Dan Moss",
            reachedThrough: "Team \u0634\u0628",
            reachedThroughCode: {
              code: OnCallTestPageReachedThroughCode.Team,
              name: "\u0634\u0628",
            },
          }),
        ],
        notPaged: english,
        notPagedCodes: [
          {
            code: OnCallTestPageNotPagedCode.AwayWithNobodyCovering,
            userName: "Lee Park",
            awayUntil: AWAY_UNTIL,
            message: english[0]!,
          },
          {
            code: OnCallTestPageNotPagedCode.TeamHasNoMembers,
            teamName: "Night shift",
            message: english[1]!,
          },
          {
            code: OnCallTestPageNotPagedCode.NobodyNextInRotation,
            scheduleName: "Weekend",
            message: english[2]!,
          },
          {
            code: OnCallTestPageNotPagedCode.NotProjectMember,
            userName: "Dana Wu",
            message: english[3]!,
          },
          {
            code: OnCallTestPageNotPagedCode.LevelNamesNobody,
            levelOrder: 1,
            message: english[4]!,
          },
        ],
      });
    }

    async function drawChain(paging: WhoIsToldPolicy): Promise<void> {
      getForMonitor.mockResolvedValue(
        result([offline({ events: [event({ policies: [paging] })] })]),
      );
      renderCard();

      fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));
    }

    function textsOf(testId: string): Array<string> {
      return screen
        .queryAllByTestId(testId)
        .map((element: HTMLElement): string => {
          return element.textContent || "";
        });
    }

    test("worded from the server's codes, they read as its English, word for word", async () => {
      await drawChain(codedPolicy());

      expect(textsOf("who-is-told-reached-through")).toEqual([
        "Team Platform",
        "Covering for Ana Lopez",
        "Schedule Primary",
        `Team ${isolated("\u0634\u0628")}`,
      ]);
      expect(textsOf("who-is-told-not-paged")).toEqual(notPagedEnglish());
    });

    test("a server that sends no codes: its English, as before", async () => {
      const coded: WhoIsToldPolicy = codedPolicy();
      const older: WhoIsToldPolicy = {
        ...coded,
        people: coded.people.map((item: WhoIsToldPerson): WhoIsToldPerson => {
          const olderPerson: WhoIsToldPerson = { ...item };
          delete olderPerson.reachedThroughCode;
          return olderPerson;
        }),
      };
      delete older.notPagedCodes;

      await drawChain(older);

      expect(textsOf("who-is-told-reached-through")).toEqual([
        "Team Platform",
        "Covering for Ana Lopez",
        "Schedule Primary",
        "Team \u0634\u0628",
      ]);
      expect(textsOf("who-is-told-not-paged")).toEqual(notPagedEnglish());
    });

    test("somebody the level names directly has no line of how, and a policy whose level reaches everyone none of who not", async () => {
      await drawChain(
        policy({ people: [person()], notPaged: [], notPagedCodes: [] }),
      );

      expect(screen.getByTestId("who-is-told-person")).toBeInTheDocument();
      expect(textsOf("who-is-told-reached-through")).toEqual([]);
      expect(textsOf("who-is-told-not-paged")).toEqual([]);
      expect(screen.queryByTestId("who-is-told-not-paged-row")).toBeNull();
    });

    /*
     * A target that reaches nobody is a gap in who is paged, drawn as one:
     * a row of the policy's own list after its people, the warning in the
     * icon column a person who can't be paged has, the sentence where the
     * names are - never a note under the list, read as one more line about
     * the person above it. A policy whose first level reaches nobody at all
     * draws its list of rows too.
     */
    test("each target that reaches nobody is a row of the policy's list, after its people, its warning beside it", async () => {
      const nobody: WhoIsToldPolicy = policy({
        id: "68102222-0000-4000-8000-0000000000a2",
        name: "Database",
        people: [],
        notPaged: ["Team DBA has no members."],
        notPagedCodes: [
          {
            code: OnCallTestPageNotPagedCode.TeamHasNoMembers,
            teamName: "DBA",
            message: "Team DBA has no members.",
          },
        ],
      });

      getForMonitor.mockResolvedValue(
        result([
          offline({
            events: [event({ policies: [codedPolicy(), nobody] })],
          }),
        ]),
      );
      renderCard();

      fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));

      const blocks: Array<HTMLElement> =
        screen.getAllByTestId("who-is-told-policy");

      // One list a policy: who it reaches, then each target that reaches nobody.
      const rowsOf: (block: HTMLElement) => Array<string> = (
        block: HTMLElement,
      ): Array<string> => {
        expect(block.querySelectorAll("ul")).toHaveLength(1);

        return Array.from(block.querySelectorAll("ul > li")).map(
          (row: Element): string => {
            return row.getAttribute("data-testid") || "";
          },
        );
      };

      expect(blocks).toHaveLength(2);
      expect(rowsOf(blocks[0]!)).toEqual([
        ...new Array<string>(4).fill("who-is-told-person"),
        ...new Array<string>(5).fill("who-is-told-not-paged-row"),
      ]);
      expect(rowsOf(blocks[1]!)).toEqual(["who-is-told-not-paged-row"]);
      expect(
        within(blocks[1]!).getByTestId("who-is-told-not-paged"),
      ).toHaveTextContent("Team DBA has no members.");

      // No sentence is left outside a policy's list.
      for (const block of blocks) {
        for (const line of within(block).queryAllByTestId(
          "who-is-told-not-paged",
        )) {
          expect(line.closest("li")).toHaveAttribute(
            "data-testid",
            "who-is-told-not-paged-row",
          );
        }
      }

      const personIcon: SVGElement = screen
        .getAllByTestId("who-is-told-person")[0]!
        .querySelector("svg")!;
      const rows: Array<HTMLElement> = screen.getAllByTestId(
        "who-is-told-not-paged-row",
      );

      expect(rows).toHaveLength(6);

      for (const row of rows) {
        const icon: SVGElement | null = row.children[0]!.querySelector("svg");
        const words: HTMLElement = within(row).getByTestId(
          "who-is-told-not-paged",
        );

        // The warning first, in the people's icon column, beside the words.
        expect(row.children).toHaveLength(2);
        expect(icon).not.toBeNull();
        expect(icon).toHaveClass("text-amber-600", "h-4", "w-4", "shrink-0");
        expect(personIcon).toHaveClass("h-4", "w-4", "shrink-0");
        expect(row.children[1]).toBe(words);
        expect(words.querySelector("svg")).toBeNull();
        expect(words).toHaveClass("min-w-0", "break-words");
      }
    });
  });

  // An Icon draws a div of its own, which a paragraph can't hold.
  test("no icon of the card is drawn inside a paragraph", async () => {
    const errors: SpyInstance<typeof console.error> = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {});
    getForMonitor.mockResolvedValue(result([offline()]));
    renderCard();

    fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));

    const card: HTMLElement = screen.getByTestId("monitor-who-is-told-card");

    expect(screen.getByTestId("who-is-told-no-breaks")).toHaveTextContent(
      "Nothing stops the chain.",
    );
    expect(screen.getByTestId("who-is-told-no-breaks").tagName).toBe("DIV");
    expect(card.querySelectorAll("svg").length).toBeGreaterThan(1);
    expect(card.querySelectorAll("p div, p svg")).toHaveLength(0);
    expect(
      errors.mock.calls
        .map((call: Array<unknown>): string => {
          return call.map(String).join(" ");
        })
        .filter((message: string): boolean => {
          return message.includes("validateDOMNesting");
        }),
    ).toEqual([]);
  });

  test("a failed read can be read again from the card, which loads while it does", async () => {
    let answer: (value: WhoIsToldResult) => void = (): void => {};
    getForMonitor.mockRejectedValueOnce(new Error("Gateway Timeout"));
    getForMonitor.mockReturnValueOnce(
      new Promise<WhoIsToldResult>(
        (resolve: (value: WhoIsToldResult) => void) => {
          answer = resolve;
        },
      ),
    );
    renderCard();

    const again: HTMLElement = await screen.findByTestId(
      "who-is-told-try-again",
    );

    expect(screen.getByTestId("who-is-told-error")).toHaveTextContent(
      "Couldn't work out who is told. Gateway Timeout",
    );
    expect(again.tagName).toBe("BUTTON");
    expect(again).toHaveAttribute("type", "button");
    expect(again).toHaveTextContent("Try again");

    await act(async () => {
      fireEvent.click(again);
    });

    expect(screen.getByTestId("who-is-told-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("who-is-told-error")).toBeNull();
    expect(getForMonitor).toHaveBeenCalledTimes(2);
    // Read as the card first reads it: the server's answer of a minute ago.
    expect(getForMonitor.mock.calls[1]![0]).toEqual({
      monitorId: MONITOR_ID,
      refresh: false,
    });

    await act(async () => {
      answer(result([offline()]));
    });

    expect(await screen.findByTestId("who-is-told-summary")).toHaveTextContent(
      "OneUptime marks it Offline and opens a Critical incident.",
    );
    expect(screen.queryByTestId("who-is-told-try-again")).toBeNull();
  });
});
