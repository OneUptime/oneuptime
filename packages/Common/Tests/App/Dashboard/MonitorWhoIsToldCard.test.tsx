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

import MonitorWhoIsToldCard, {
  WhoIsToldPlace,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorWhoIsToldCard";
import OnCallTestPageApi from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageApi";
import MonitorDraftWhoIsTold, {
  getDraftLabelIds,
  getMonitorDraft,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorDraftWhoIsTold";
import WhoIsToldApi, {
  getWhoIsToldUrl,
  isWhoIsToldResult,
  WhoIsToldDraftInput,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldApi";
import {
  BREAK_SENTENCES,
  getBreakSentence,
  getDeclaresSentence,
  getFixLink,
  getOwnerMatchSentence,
  getOwnersSentences,
  getPagedOwnersSentence,
  getPrivateSentences,
  getWhoIsToldCriteriaSentences,
  getWhoIsToldSentences,
  getWhoIsToldSummary,
  WhoIsToldFixLink,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldWords";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Navigation from "../../../UI/Utils/Navigation";
import ProductEvents from "../../../UI/Utils/ProductEvents";
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
  WhoIsToldOwnerAddedBy,
  WhoIsToldOwnerKind,
  WhoIsToldOwnerNotReached,
  WhoIsToldOwnerProblem,
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

/*
 * The card reads its monitor's last fire drill too (#9386, LastFireDrill):
 * none here, stood in for as every other read of the server is.
 */
beforeEach(() => {
  jest.spyOn(OnCallTestPageApi, "lastFireDrill").mockResolvedValue(null);
});

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
  project: { hasOnCallPolicies: boolean } = { hasOnCallPolicies: true },
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
      projectHasOnCallPolicies: project.hasOnCallPolicies,
    }),
    ...overrides,
  };
}

describe("the card's first words", () => {
  test("says what happens, who is emailed and who is paged, as the issue words it", () => {
    expect(getWhoIsToldSentences(result([offline()]), translator)).toEqual([
      "OneUptime marks it Offline and opens an incident (Critical).",
      "It emails the Project Owners (Owner One).",
      "It pages Ana Lopez through Primary.",
    ]);
  });

  /*
   * A new project's incident severities are named "Critical Incident" and
   * the rest: "opens a {{severity}} incident" read "opens a Critical
   * Incident incident" on every monitor's page (#7368). The severity is in
   * brackets now, as the Website down summary sets it.
   */
  test("with the severity a new project starts with, the sentence names the incident once", () => {
    const first: string = getWhoIsToldSentences(
      result([
        offline({ events: [event({ severityName: "Critical Incident" })] }),
      ]),
      translator,
    )[0]!;

    expect(first).toBe(
      "OneUptime marks it Offline and opens an incident (Critical Incident).",
    );
    expect(first).not.toMatch(/Incident incident/i);
    expect(first.match(/\bincident\b/g)).toHaveLength(1);
  });

  test("and an alert's, its severity in brackets too", () => {
    for (const name of ["High", "Low"]) {
      const first: string = getWhoIsToldSentences(
        result([
          offline({
            statusName: undefined,
            events: [
              event({
                kind: OnCallTestPageRecordKind.Alert,
                severityName: name,
              }),
            ],
          }),
        ]),
        translator,
      )[0]!;

      expect(first).toBe(`OneUptime opens an alert (${name}).`);
    }
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
      "OneUptime opens an alert (Warning).",
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
        "OneUptime marks it Offline and opens an incident (Critical). It emails the owners added by owner rules (Ben Ito). It pages Ana Lopez through Primary.",
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
    // No on-call policy yet (#7369), for incidents and alerts alike.
    for (const recordKind of [
      OnCallTestPageRecordKind.Incident,
      OnCallTestPageRecordKind.Alert,
    ]) {
      expect(
        brk({
          kind: WhoIsToldBreakKind.NobodyPaged,
          fix: WhoIsToldFix.OnCallGuidedSetup,
          recordKind: recordKind,
        }),
      ).toBe("Nobody is paged: this project has no on-call policy yet.");
    }
    expect(BREAK_SENTENCES.nobodyPagedNoPolicy).toBe(
      "Nobody is paged: this project has no on-call policy yet.",
    );
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
        kind: WhoIsToldBreakKind.NobodyPaged,
        fix: WhoIsToldFix.IncidentOnCallRules,
      })!.route.toString(),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES] as Route,
      ).toString(),
    );
    // No on-call policy yet (#7369): the on-call guided setup, by the same words.
    expect(
      link({
        kind: WhoIsToldBreakKind.NobodyPaged,
        fix: WhoIsToldFix.OnCallGuidedSetup,
        recordKind: OnCallTestPageRecordKind.Alert,
      }),
    ).toEqual({
      text: "Set Up Paging",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_GUIDED_SETUP] as Route,
      ),
    });
    expect(
      link({
        kind: WhoIsToldBreakKind.NobodyPaged,
        fix: WhoIsToldFix.OnCallGuidedSetup,
      })!.route.toString(),
    ).toContain("/on-call-duty/setup");
    // Every fix has its words.
    for (const fix of Object.values(WhoIsToldFix)) {
      const found: WhoIsToldFixLink | null = link({
        kind: WhoIsToldBreakKind.NobodyPaged,
        fix: fix,
      });

      if (fix === WhoIsToldFix.ServerSettings) {
        expect(found).toBeNull();
        continue;
      }

      expect(found?.text.length || 0).toBeGreaterThan(3);
    }
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
      "OneUptime marks it Offline and opens an incident (Critical). It emails the Project Owners (Owner One). It pages Ana Lopez through Primary.",
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

  test("the chain names a new project's Critical Incident once: An incident (Critical Incident)", async () => {
    getForMonitor.mockResolvedValue(
      result([
        offline({ events: [event({ severityName: "Critical Incident" })] }),
      ]),
    );
    renderCard();

    fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));

    const chain: HTMLElement = screen.getByTestId("who-is-told-chain");

    expect(chain).toHaveTextContent("An incident (Critical Incident)");
    expect(chain).not.toHaveTextContent(/Critical Incident incident/i);
    expect(screen.getByTestId("who-is-told-summary")).not.toHaveTextContent(
      /Critical Incident incident/i,
    );
  });

  /*
   * #7369: a new project's first monitor, before any on-call policy. Set Up
   * Paging opened the incident on-call rules builder, whose rules page
   * policies the project does not have; it opens the on-call guided setup,
   * which makes one that pages for every new incident and alert. With a
   * policy, it still opens the rules (the test above).
   */
  test("a project with no on-call policy yet: Set Up Paging opens the on-call guided setup, and the break says why", async () => {
    getForMonitor.mockResolvedValue(
      result(
        [offline({ events: [event({ rules: [], policies: [] })] })],
        {},
        {
          hasOnCallPolicies: false,
        },
      ),
    );
    renderCard();

    const brk: HTMLElement = await screen.findByTestId("who-is-told-break");

    expect(brk).toHaveAttribute("data-kind", WhoIsToldBreakKind.NobodyPaged);
    expect(brk).toHaveTextContent(
      "Nobody is paged: this project has no on-call policy yet.",
    );
    expect(brk).not.toHaveTextContent("no on-call rule matches");

    const fix: HTMLElement = within(brk).getByTestId("who-is-told-fix");

    expect(fix).toHaveTextContent("Set Up Paging");
    expect(fix.getAttribute("href")).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_GUIDED_SETUP] as Route,
      ).toString(),
    );
    expect(fix.getAttribute("href")).not.toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES] as Route,
      ).toString(),
    );
    expect(screen.getByTestId("who-is-told-summary")).toHaveTextContent(
      "Nobody is paged.",
    );
  });

  test("an alert that pages nobody, with no policy yet, goes to the guided setup too", async () => {
    getForMonitor.mockResolvedValue(
      result(
        [
          offline({
            events: [
              event({
                kind: OnCallTestPageRecordKind.Alert,
                rules: [],
                policies: [],
              }),
            ],
          }),
        ],
        {},
        { hasOnCallPolicies: false },
      ),
    );
    renderCard();

    const brk: HTMLElement = await screen.findByTestId("who-is-told-break");

    expect(
      within(brk).getByTestId("who-is-told-fix").getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_GUIDED_SETUP] as Route,
      ).toString(),
    );
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
    expect(chain).toHaveTextContent("An incident (Critical)");
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
      "An incident (Critical)",
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
   * #7528: somebody no rule of theirs covers the severity for is paged by
   * what the project's fallback picks - their email alone, though they
   * verified a number too. Their line lists only that, and says why after
   * it, so "Email" never reads as a gap in their own rules.
   */
  test("somebody the fallback pages: the channels it picks, then why, after the same mark", async () => {
    getForMonitor.mockResolvedValue(
      result([
        offline({
          events: [
            event({
              policies: [
                policy({
                  people: [
                    person(),
                    person({
                      userId: BEN,
                      name: "Ben Ito",
                      reachedThrough: "Schedule Primary",
                      channels: [OnCallPageChannel.Email],
                      isFallback: true,
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

    const mark: string = `${NO_BREAK_SPACE}${MIDDLE_DOT} `;
    const lines: Array<HTMLElement> =
      screen.getAllByTestId("who-is-told-person");

    expect(
      lines.map((line: HTMLElement): string => {
        return line.querySelector("p")!.textContent || "";
      }),
    ).toEqual([
      `Ana Lopez${mark}SMS, Email`,
      `Ben Ito${mark}Schedule Primary${mark}Email${mark}Picked by the fallback: no on-call rule of theirs covers this severity`,
    ]);
    // Said once, on the fallback's line only.
    expect(screen.getAllByTestId("who-is-told-fallback")).toHaveLength(1);
    expect(lines[1]).toContainElement(
      screen.getByTestId("who-is-told-fallback"),
    );
    expect(lines[1]).toHaveAttribute("data-reachable", "true");
  });

  test("somebody the fallback can't page says they can't be paged, and nothing of what it picks", async () => {
    getForMonitor.mockResolvedValue(
      result([
        offline({
          events: [
            event({
              policies: [
                policy({
                  people: [
                    person({
                      channels: [],
                      isFallback: true,
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

    expect(screen.getByTestId("who-is-told-person")).toHaveTextContent(
      "Can't be paged",
    );
    expect(screen.queryByTestId("who-is-told-fallback")).toBeNull();
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
      "OneUptime marks it Offline and opens an incident (Critical).",
    );
    expect(screen.queryByTestId("who-is-told-try-again")).toBeNull();
  });
});

/*
 * AN OWNER THE PAGE REACHES FIRST (#8860). The owners' Created email leaves
 * out an owner the on-call page reached already (#7987), and the card says
 * so: the email's sentence names whom it still reaches, and a sentence of
 * its own says who is paged instead - by what the server worked out
 * (pagedOwners), never by a name matched here.
 */
describe("the card says an owner the page reaches first is not emailed as an owner too", () => {
  function pagedOwners(
    overrides: Partial<WhoIsToldEvent["owners"]> = {},
  ): WhoIsToldEvent["owners"] {
    return {
      source: WhoIsToldOwnersSource.Named,
      userNames: ["Ben Ito"],
      teamNames: [],
      pagedOwners: [{ userId: ANA, name: "Ana Lopez" }],
      ...overrides,
    };
  }

  test("some owners still emailed: whom the email reaches, then who is paged instead", () => {
    expect(
      getWhoIsToldSentences(
        result([offline({ events: [event({ owners: pagedOwners() })] })]),
        translator,
      ),
    ).toEqual([
      "OneUptime marks it Offline and opens an incident (Critical).",
      "It emails its owners (Ben Ito).",
      "Ana Lopez is paged, so isn't emailed as an owner too.",
      "It pages Ana Lopez through Primary.",
    ]);
  });

  test("the one-person project: its Project Owner is paged, and no email is said to reach anybody", () => {
    const sentences: Array<string> = getWhoIsToldSentences(
      result([
        offline({
          events: [
            event({
              owners: pagedOwners({
                source: WhoIsToldOwnersSource.ProjectOwners,
                userNames: [],
              }),
            }),
          ],
        }),
      ]),
      translator,
    );

    expect(sentences).toEqual([
      "OneUptime marks it Offline and opens an incident (Critical).",
      "Ana Lopez is paged, so isn't emailed as a Project Owner too.",
      "It pages Ana Lopez through Primary.",
    ]);
    expect(sentences.join(" ")).not.toContain("It emails");
  });

  test("several owners paged: said in the plural, the first few by name and the rest counted", () => {
    const owners: WhoIsToldEvent["owners"] = pagedOwners({
      userNames: [],
      pagedOwners: [
        { userId: "1", name: "Ana Lopez" },
        { userId: "2", name: "Ben Ito" },
        { userId: "3", name: "Cara Diaz" },
        { userId: "4", name: "Dan Okafor" },
      ],
    });

    expect(getPagedOwnersSentence(owners, translator)).toBe(
      "Ana Lopez, Ben Ito, Cara Diaz and 1 more are paged, so aren't emailed as owners too.",
    );
    expect(
      getPagedOwnersSentence(
        pagedOwners({
          pagedOwners: [
            { userId: "1", name: "Ana Lopez" },
            { userId: "2", name: "Ben Ito" },
          ],
        }),
        translator,
      ),
    ).toBe("Ana Lopez and Ben Ito are paged, so aren't emailed as owners too.");
  });

  test("a team still emailed is named as the email's", () => {
    expect(
      getOwnersSentences(
        pagedOwners({ userNames: [], teamNames: ["Checkout SRE"] }),
        translator,
      ),
    ).toEqual([
      "It emails its owners (Checkout SRE).",
      "Ana Lopez is paged, so isn't emailed as an owner too.",
    ]);
  });

  test("nobody paged first, or an older server's answer: the card says what it always said", () => {
    const asBefore: WhoIsToldEvent["owners"] = {
      source: WhoIsToldOwnersSource.Named,
      userNames: ["Ana Lopez", "Ben Ito"],
      teamNames: [],
    };

    expect(getOwnersSentences(asBefore, translator)).toEqual([
      "It emails its owners (Ana Lopez and Ben Ito).",
    ]);
    expect(getPagedOwnersSentence(asBefore, translator)).toBeNull();
    expect(
      getOwnersSentences({ ...asBefore, pagedOwners: [] }, translator),
    ).toEqual(["It emails its owners (Ana Lopez and Ben Ito)."]);
  });

  test("a status change's owners are said as they always were", () => {
    expect(
      getWhoIsToldSentences(
        result([
          offline({
            events: [],
            statusOwners: {
              source: WhoIsToldOwnersSource.MonitorOwners,
              userNames: ["Ana Lopez"],
              teamNames: [],
            },
          }),
        ]),
        translator,
      ),
    ).toEqual([
      "OneUptime marks it Offline. It opens no incident or alert, so nobody is paged.",
      "It emails the monitor's owners (Ana Lopez).",
    ]);
  });

  describe("in the chain", () => {
    afterEach(() => {
      cleanup();
      jest.restoreAllMocks();
    });

    async function drawChain(owners: WhoIsToldEvent["owners"]): Promise<void> {
      jest
        .spyOn(WhoIsToldApi, "getForMonitor")
        .mockResolvedValue(
          result([offline({ events: [event({ owners: owners })] })]),
        );

      render(
        <MemoryRouter>
          <MonitorWhoIsToldCard monitorId={MONITOR_ID} />
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));
    }

    test("the Emails row names whom the email reaches, and under it who is paged instead", async () => {
      await drawChain(pagedOwners());

      const chain: HTMLElement = screen.getByTestId("who-is-told-chain");

      expect(chain).toHaveTextContent("Ben Ito");
      expect(screen.getByTestId("who-is-told-paged-owners")).toHaveTextContent(
        "Ana Lopez is paged, so isn't emailed as an owner too.",
      );
      expect(screen.getByTestId("who-is-told-summary")).toHaveTextContent(
        "It emails its owners (Ben Ito). Ana Lopez is paged, so isn't emailed as an owner too.",
      );
    });

    test("every owner paged: Nobody is emailed, and the line under it says why", async () => {
      await drawChain(
        pagedOwners({
          source: WhoIsToldOwnersSource.ProjectOwners,
          userNames: [],
        }),
      );

      expect(screen.getByTestId("who-is-told-chain")).toHaveTextContent(
        "Nobody",
      );
      expect(screen.getByTestId("who-is-told-paged-owners")).toHaveTextContent(
        "Ana Lopez is paged, so isn't emailed as a Project Owner too.",
      );
    });

    test("nobody paged first: no line under the Emails row", async () => {
      await drawChain({
        source: WhoIsToldOwnersSource.Named,
        userNames: ["Ana Lopez"],
        teamNames: [],
      });

      expect(screen.queryByTestId("who-is-told-paged-owners")).toBeNull();
    });
  });
});

/*
 * WHAT A NEW RECORD'S OWN RULES MAKE OF IT, ON THE CARD (#7212, #7213,
 * #7214, #7216, #7572): private records and who may see them, the label
 * rules that change who is paged, the group a status page shows the monitor
 * through, the incident an alert's incident rule declares, and the owners
 * no Created email reaches - each in the reader's words, from what the
 * server worked out.
 */
describe("what the record's own rules make of it", () => {
  const PRIVACY_RULE: { id: string; name: string } = {
    id: "68102222-0000-4000-8000-0000000000f1",
    name: "Payments are private",
  };
  const TEAM_ID: string = "68102222-0000-4000-8000-0000000000e1";
  const DEVICE_ID: string = "68102222-0000-4000-8000-0000000000e2";

  function renderWith(answer: WhoIsToldResult): void {
    jest.spyOn(WhoIsToldApi, "getForMonitor").mockResolvedValue(answer);

    render(
      <MemoryRouter>
        <MonitorWhoIsToldCard monitorId={MONITOR_ID} />
      </MemoryRouter>,
    );
  }

  async function openChain(): Promise<HTMLElement> {
    fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));
    return screen.getByTestId("who-is-told-chain");
  }

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("a private record (#7213)", () => {
    test("one the reader can't see: what opens and that it is private - nothing of whom it tells", async () => {
      const hidden: WhoIsToldEvent = {
        kind: OnCallTestPageRecordKind.Incident,
        title: "",
        severityName: "Critical",
        owners: {
          source: WhoIsToldOwnersSource.Named,
          userNames: [],
          teamNames: [],
        },
        ownerRules: [],
        rules: [],
        policies: [],
        statusPages: [],
        isPrivate: true,
        privacyRules: [{ id: PRIVACY_RULE.id, name: "" }],
        isHidden: true,
      };
      renderWith(result([offline({ events: [hidden] })]));

      expect(
        await screen.findByTestId("who-is-told-summary"),
      ).toHaveTextContent(
        "OneUptime marks it Offline and opens an incident (Critical). It's private, so you can't see who it tells.",
      );
      expect(screen.getByTestId("who-is-told-summary")).not.toHaveTextContent(
        "Nobody is paged",
      );

      const chain: HTMLElement = await openChain();
      const block: HTMLElement = within(chain).getByTestId("who-is-told-event");

      expect(block).toHaveAttribute("data-hidden", "true");
      expect(
        within(block).getByTestId("who-is-told-private"),
      ).toHaveTextContent(
        "Privacy rule A rule you can't see makes it private.It's private, so you can't see who it tells.",
      );
      // No row of whom it tells: no emails, no rules, no policy.
      expect(block).not.toHaveTextContent("Emails");
      expect(block).not.toHaveTextContent("On-call rules");
      expect(
        within(block).queryByTestId("who-is-told-status-pages"),
      ).toBeNull();
    });

    test("one the reader can see: why it is private, who can see it, and why no status page shows it", async () => {
      renderWith(
        result([
          offline({
            events: [
              event({
                isPrivate: true,
                privacyRules: [PRIVACY_RULE],
                statusPages: [],
                isPrivateOffStatusPages: true,
              }),
            ],
          }),
        ]),
      );

      const chain: HTMLElement = await openChain();

      expect(
        within(chain).getByTestId("who-is-told-private"),
      ).toHaveTextContent(
        "Privacy rule Payments are private makes it private.Only its owners, Project Owners and Project Admins can see it.",
      );
      expect(
        within(chain).getByTestId("who-is-told-status-pages"),
      ).toHaveTextContent("None: it's private");
      // Who it tells is said as for any incident.
      expect(chain).toHaveTextContent("Ana Lopez");
    });

    test("the criteria makes it private: said so, with no rule named", async () => {
      renderWith(
        result([
          offline({
            events: [event({ isPrivate: true, privacyRules: [] })],
          }),
        ]),
      );

      const chain: HTMLElement = await openChain();

      expect(
        within(chain).getByTestId("who-is-told-private"),
      ).toHaveTextContent("The criteria makes it private.");
    });

    test("several privacy rules are said together, in the plural", () => {
      expect(
        getPrivateSentences(
          event({
            isPrivate: true,
            privacyRules: [
              PRIVACY_RULE,
              { id: "68102222-0000-4000-8000-0000000000f2", name: "Checkout" },
            ],
          }),
          translator,
        )[0],
      ).toBe(
        "Privacy rules Payments are private and Checkout make it private.",
      );
    });
  });

  test("the label rules whose labels change which on-call rules page it (#7212)", async () => {
    renderWith(
      result([
        offline({
          events: [
            event({
              labelRules: [
                {
                  id: "68102222-0000-4000-8000-0000000000c1",
                  name: "Tag checkout",
                },
                { id: "68102222-0000-4000-8000-0000000000c2", name: "" },
              ],
            }),
          ],
        }),
      ]),
    );

    const row: HTMLElement = within(await openChain()).getByTestId(
      "who-is-told-label-rules",
    );

    expect(row).toHaveTextContent(
      "Tag checkout, A rule you can't seeTheir labels change which on-call rules page it.",
    );
  });

  test("no label rule changes who is paged: no Label Rules row", async () => {
    renderWith(result([offline()]));

    expect(
      within(await openChain()).queryByTestId("who-is-told-label-rules"),
    ).toBeNull();
  });

  /*
   * AN ALERT OWNER RULE (#9407): the on-call rule matches on who owns the
   * alert, and the chain says which owner made it match, under the rule.
   */
  describe("the owners that make an on-call rule match (#9407)", () => {
    const PAYMENTS_RULE: string = "68102222-0000-4000-8000-0000000000c3";
    const NIGHT_RULE: string = "68102222-0000-4000-8000-0000000000c4";

    function ownedAlert(
      overrides: Partial<WhoIsToldEvent> = {},
    ): WhoIsToldEvent {
      return event({
        kind: OnCallTestPageRecordKind.Alert,
        rules: [
          { id: PAYMENTS_RULE, name: "Payments' alerts" },
          { id: NIGHT_RULE, name: "" },
        ],
        ownerMatches: [
          { ruleId: PAYMENTS_RULE, ownerNames: ["Payments", "Ana Lopez"] },
          { ruleId: NIGHT_RULE, ownerNames: ["Night shift"] },
        ],
        ...overrides,
      });
    }

    test("each matched rule's owners are said under On-call rules, a rule the reader can't see as such", async () => {
      renderWith(result([offline({ events: [ownedAlert()] })]));

      const row: HTMLElement = within(await openChain()).getByTestId(
        "who-is-told-rules",
      );
      const lines: Array<string> = within(row)
        .getAllByTestId("who-is-told-owner-match")
        .map((line: HTMLElement): string => {
          return line.textContent || "";
        });

      expect(row).toHaveTextContent("Payments' alerts, A rule you can't see");
      expect(lines).toEqual([
        "It's owned by Payments, Ana Lopez, so Payments' alerts matches.",
        "It's owned by Night shift, so a rule you can't see matches.",
      ]);
    });

    test("no rule its owners make match: no such line, and the row reads as before", async () => {
      renderWith(
        result([
          offline({ events: [ownedAlert({ ownerMatches: undefined })] }),
        ]),
      );

      const row: HTMLElement = within(await openChain()).getByTestId(
        "who-is-told-rules",
      );

      expect(within(row).queryByTestId("who-is-told-owner-match")).toBeNull();
      expect(row).toHaveTextContent(
        "On-call rulesPayments' alerts, A rule you can't see",
      );
    });

    test("a private alert the reader can't see says nothing of its owners", async () => {
      renderWith(
        result([
          offline({
            events: [
              ownedAlert({
                isPrivate: true,
                isHidden: true,
                title: "",
                rules: [],
                ownerMatches: undefined,
              }),
            ],
          }),
        ]),
      );

      const chain: HTMLElement = await openChain();

      expect(within(chain).queryByTestId("who-is-told-owner-match")).toBeNull();
      expect(chain).not.toHaveTextContent("Payments");
    });

    test("in the reader's language, the rule and owners set apart as names", () => {
      const german: Translator = localeTranslator("de");

      expect(
        getOwnerMatchSentence({
          match: { ruleId: PAYMENTS_RULE, ownerNames: ["Payments"] },
          rules: [{ id: PAYMENTS_RULE, name: "Payments' alerts" }],
          translator: german,
        }),
      ).toContain("Eigentümer:");
      expect(
        getOwnerMatchSentence({
          match: { ruleId: PAYMENTS_RULE, ownerNames: ["Payments"] },
          rules: [{ id: PAYMENTS_RULE, name: "" }],
          translator: german,
        }),
      ).toContain("eine Regel, die Sie nicht sehen können");
    });
  });

  test("a status page names the monitor group it shows the monitor through, one the reader can't see as such (#7214)", async () => {
    renderWith(
      result([
        offline({
          events: [
            event({
              statusPages: [
                {
                  id: "s2",
                  name: "Payments status",
                  groups: [
                    { id: "g1", name: "Checkout" },
                    { id: "g2", name: "" },
                  ],
                },
                { id: "s", name: "Public status", groups: [] },
              ],
            }),
          ],
        }),
      ]),
    );

    expect(
      within(await openChain()).getByTestId("who-is-told-status-pages"),
    ).toHaveTextContent(
      "Payments status (through Checkout, a group you can't see), Public status",
    );
  });

  describe("the incident an alert incident rule declares (#7216)", () => {
    function alertThatDeclares(
      declaration: Partial<NonNullable<WhoIsToldEvent["declares"]>> = {},
    ): WhoIsToldEvent {
      return event({
        kind: OnCallTestPageRecordKind.Alert,
        severityName: "High",
        rules: [],
        policies: [],
        statusPages: [],
        declares: {
          rule: {
            id: "68102222-0000-4000-8000-0000000000b1",
            name: "Database alerts",
          },
          waitInMinutes: 30,
          incident: event({ title: "Checkout API is offline" }),
          ...declaration,
        },
      });
    }

    test("the first words say the alert becomes an incident, and who the incident pages", async () => {
      renderWith(
        result([
          offline({ statusName: undefined, events: [alertThatDeclares()] }),
        ]),
      );

      expect(
        await screen.findByTestId("who-is-told-summary"),
      ).toHaveTextContent(
        "OneUptime opens an alert (High). It emails the Project Owners (Owner One). If it's still open after 30 minutes, alert incident rule Database alerts declares an incident (Critical) from it. It pages Ana Lopez through Primary.",
      );
      // Not "Nobody is paged": the incident pages.
      expect(screen.getByTestId("who-is-told-summary")).not.toHaveTextContent(
        "Nobody is paged",
      );
      expect(screen.getByTestId("who-is-told-no-breaks")).toBeInTheDocument();
    });

    test("the chain shows the incident under the alert, told as any incident", async () => {
      renderWith(
        result([
          offline({ events: [alertThatDeclares({ waitInMinutes: 0 })] }),
        ]),
      );

      const declares: HTMLElement = within(await openChain()).getByTestId(
        "who-is-told-declares",
      );

      expect(
        within(declares).getByTestId("who-is-told-declares-sentence"),
      ).toHaveTextContent(
        "Alert incident rule Database alerts declares an incident (Critical) from it right away.",
      );

      const incident: HTMLElement =
        within(declares).getByTestId("who-is-told-event");

      expect(incident).toHaveAttribute(
        "data-kind",
        OnCallTestPageRecordKind.Incident,
      );
      expect(incident).toHaveTextContent("Checkout API is offline");
      expect(incident).toHaveTextContent("Primary");
      expect(incident).toHaveTextContent("Public status");
    });

    test("a rule the reader can't see is said as such, never by an empty name, one minute in the singular", () => {
      expect(
        getDeclaresSentence(
          {
            rule: { id: "r", name: "" },
            waitInMinutes: 1,
            incident: event(),
          },
          translator,
        ),
      ).toBe(
        // The count kept on the line of the word it counts.
        `If it's still open after 1${NO_BREAK_SPACE}minute, an alert incident rule you can't see declares an incident (Critical) from it.`,
      );
      expect(
        getDeclaresSentence(
          {
            rule: { id: "r", name: "" },
            waitInMinutes: 0,
            incident: event(),
          },
          translator,
        ),
      ).toBe(
        "An alert incident rule you can't see declares an incident (Critical) from it right away.",
      );
    });
  });

  describe("owners no Created email reaches (#7572)", () => {
    function withOwnersNotReached(
      notReached: Array<WhoIsToldOwnerNotReached>,
      kind: OnCallTestPageRecordKind = OnCallTestPageRecordKind.Incident,
    ): WhoIsToldResult {
      const opened: WhoIsToldEvent = event({
        kind: kind,
        owners: {
          source: WhoIsToldOwnersSource.Named,
          userNames: ["Ben Ito"],
          teamNames: [],
          notReached: notReached,
        },
      });

      // Two criteria name the same owners: each is said once.
      return result([
        offline({ events: [opened] }),
        offline({ id: "degraded", name: "Degraded", events: [opened] }),
      ]);
    }

    test("each, why, where they are named, and the page that puts it right", async () => {
      renderWith(
        withOwnersNotReached([
          {
            kind: WhoIsToldOwnerKind.User,
            id: "68102222-0000-4000-8000-0000000000a9",
            name: "",
            problem: WhoIsToldOwnerProblem.NotInProject,
            addedBy: WhoIsToldOwnerAddedBy.Criteria,
          },
          {
            kind: WhoIsToldOwnerKind.Team,
            id: TEAM_ID,
            name: "Night Shift",
            problem: WhoIsToldOwnerProblem.TeamHasNobodyInProject,
            addedBy: WhoIsToldOwnerAddedBy.OwnerRule,
            rule: { id: "o", name: "Checkout owners" },
          },
          {
            kind: WhoIsToldOwnerKind.Team,
            id: "68102222-0000-4000-8000-0000000000a8",
            name: "",
            problem: WhoIsToldOwnerProblem.TeamOfAnotherProject,
            addedBy: WhoIsToldOwnerAddedBy.NetworkDevice,
            networkDeviceId: DEVICE_ID,
          },
          {
            kind: WhoIsToldOwnerKind.User,
            id: "68102222-0000-4000-8000-0000000000a7",
            name: "",
            problem: WhoIsToldOwnerProblem.NotInProject,
            addedBy: WhoIsToldOwnerAddedBy.OwnerRule,
            rule: { id: "o2", name: "" },
          },
        ]),
      );

      const list: HTMLElement = await screen.findByTestId(
        "who-is-told-owners-not-emailed",
      );

      expect(list).toHaveAttribute("aria-label", "Owners who aren't emailed");

      const lines: Array<HTMLElement> = within(list).getAllByTestId(
        "who-is-told-owner-not-emailed",
      );

      expect(
        lines.map((line: HTMLElement): string => {
          return line.textContent || "";
        }),
      ).toEqual([
        "Someone named as an owner isn't a member of this project, so isn't emailed.Named in the criteria.Open Criteria",
        "Team Night Shift has nobody in it who is a member of this project, so nobody is emailed through it.Added by owner rule Checkout owners.Open Team",
        "A team of another project is named as an owner, so nobody is emailed through it.An owner of the network device this monitor watches.Open Network Device",
        "Someone named as an owner isn't a member of this project, so isn't emailed.Added by an owner rule you can't see.Open Owner Rules",
      ]);

      const hrefs: Array<string | null> = within(list)
        .getAllByTestId("who-is-told-owner-fix")
        .map((link: HTMLElement): string | null => {
          return link.getAttribute("href");
        });

      expect(hrefs).toEqual([
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_CRITERIA] as Route,
          { modelId: MONITOR_ID },
        ).toString(),
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.TEAM_VIEW_MEMBERS] as Route,
          { modelId: new ObjectID(TEAM_ID) },
        ).toString(),
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.NETWORK_DEVICE_VIEW_OWNERS] as Route,
          { modelId: new ObjectID(DEVICE_ID) },
        ).toString(),
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENTS_SETTINGS_OWNER_RULES] as Route,
        ).toString(),
      ]);
      // Not a break: the email still goes out, to Ben Ito.
      expect(screen.getByTestId("who-is-told-no-breaks")).toBeInTheDocument();
    });

    test("an alert's owner rule opens the alerts' owner rules", async () => {
      renderWith(
        withOwnersNotReached(
          [
            {
              kind: WhoIsToldOwnerKind.User,
              id: "68102222-0000-4000-8000-0000000000a7",
              name: "",
              problem: WhoIsToldOwnerProblem.NotInProject,
              addedBy: WhoIsToldOwnerAddedBy.OwnerRule,
              rule: { id: "o2", name: "Alert owners" },
            },
          ],
          OnCallTestPageRecordKind.Alert,
        ),
      );

      expect(
        await screen.findByTestId("who-is-told-owner-fix"),
      ).toHaveAttribute(
        "href",
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.ALERTS_SETTINGS_OWNER_RULES] as Route,
        ).toString(),
      );
    });

    test("nobody left out: no list", async () => {
      renderWith(result([offline()]));

      await screen.findByTestId("who-is-told-summary");
      expect(screen.queryByTestId("who-is-told-owners-not-emailed")).toBeNull();
    });
  });
});

/*
 * A RECHECK THAT FAILS (#7308) keeps the answer on the card: the summary,
 * the breaks and the open chain stay, Checked keeps the time of the last
 * read that worked, and why checking again failed is said under them, in
 * the reader's words - until a read works, or the monitor changes. A first
 * read that fails says so in place of the answer, with Try again.
 */
describe("a Recheck that fails", () => {
  const CHECKED_AT: string = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  function answer(): WhoIsToldResult {
    return result([offline()], { checkedAt: CHECKED_AT });
  }

  async function renderAndRecheck(
    getForMonitor: SpyInstance<typeof WhoIsToldApi.getForMonitor>,
    refreshToken?: number,
  ): Promise<{ rerender: (token: number) => void }> {
    const view: ReturnType<typeof render> = render(
      <MemoryRouter>
        <MonitorWhoIsToldCard
          monitorId={MONITOR_ID}
          refreshToken={refreshToken}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId("who-is-told-chain-toggle"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("who-is-told-recheck"));
    });

    await waitFor(() => {
      expect(getForMonitor).toHaveBeenCalledTimes(2);
    });

    return {
      rerender: (token: number): void => {
        view.rerender(
          <MemoryRouter>
            <MonitorWhoIsToldCard monitorId={MONITOR_ID} refreshToken={token} />
          </MemoryRouter>,
        );
      },
    };
  }

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("keeps the summary, the breaks and the open chain, and says why under them", async () => {
    const getForMonitor: SpyInstance<typeof WhoIsToldApi.getForMonitor> =
      jest.spyOn(WhoIsToldApi, "getForMonitor");
    getForMonitor.mockResolvedValueOnce(answer());
    getForMonitor.mockRejectedValueOnce(new Error(SERVER_DOWN_MESSAGE));

    await renderAndRecheck(getForMonitor);

    const note: HTMLElement = await screen.findByTestId(
      "who-is-told-recheck-error",
    );

    expect(note.textContent).toBe(
      "Couldn't check again. The OneUptime server did not answer. It may be starting or restarting. Try again in a few minutes.",
    );
    expect(within(note).getByTestId("error-in-sentence")).toHaveAttribute(
      "data-error-kind",
      "ServerDown",
    );
    expect(screen.getByTestId("who-is-told-summary")).toHaveTextContent(
      "OneUptime marks it Offline and opens an incident (Critical).",
    );
    expect(screen.getByTestId("who-is-told-chain")).toBeInTheDocument();
    expect(screen.queryByTestId("who-is-told-error")).toBeNull();
    expect(screen.queryByTestId("who-is-told-try-again")).toBeNull();
    // Checked is the last read that worked, and Recheck is there to try again.
    expect(screen.getByTestId("monitor-who-is-told-card")).toHaveTextContent(
      "Checked 5 minutes ago",
    );
    expect(screen.getByTestId("who-is-told-recheck")).toBeEnabled();
    // The note comes after Checked and Recheck.
    expect(
      screen.getByTestId("who-is-told-recheck").compareDocumentPosition(note) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a Recheck that then works clears it, and Checked moves on", async () => {
    const getForMonitor: SpyInstance<typeof WhoIsToldApi.getForMonitor> =
      jest.spyOn(WhoIsToldApi, "getForMonitor");
    getForMonitor.mockResolvedValueOnce(answer());
    getForMonitor.mockRejectedValueOnce(new Error("Gateway Timeout"));
    getForMonitor.mockResolvedValueOnce(
      result([offline()], { checkedAt: new Date().toISOString() }),
    );

    await renderAndRecheck(getForMonitor);

    expect(
      await screen.findByTestId("who-is-told-recheck-error"),
    ).toHaveTextContent("Couldn't check again. Gateway Timeout");

    await act(async () => {
      fireEvent.click(screen.getByTestId("who-is-told-recheck"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("who-is-told-recheck-error")).toBeNull();
    });
    expect(getForMonitor.mock.calls[2]![0]).toEqual({
      monitorId: MONITOR_ID,
      refresh: true,
    });
    expect(
      screen.getByTestId("monitor-who-is-told-card"),
    ).not.toHaveTextContent("Checked 5 minutes ago");
  });

  test("the monitor changing clears it", async () => {
    const getForMonitor: SpyInstance<typeof WhoIsToldApi.getForMonitor> =
      jest.spyOn(WhoIsToldApi, "getForMonitor");
    getForMonitor.mockResolvedValueOnce(answer());
    getForMonitor.mockRejectedValueOnce(new Error("Gateway Timeout"));
    let finish: (value: WhoIsToldResult) => void = (): void => {};
    getForMonitor.mockReturnValueOnce(
      new Promise<WhoIsToldResult>(
        (resolve: (value: WhoIsToldResult) => void) => {
          finish = resolve;
        },
      ),
    );

    const view: { rerender: (token: number) => void } = await renderAndRecheck(
      getForMonitor,
      1,
    );

    await screen.findByTestId("who-is-told-recheck-error");

    await act(async () => {
      view.rerender(2);
    });

    // Gone at once: it was about the monitor as it was.
    expect(screen.queryByTestId("who-is-told-recheck-error")).toBeNull();
    expect(getForMonitor.mock.calls[2]![0]).toEqual({
      monitorId: MONITOR_ID,
      refresh: false,
    });

    await act(async () => {
      finish(answer());
    });
  });

  test("a first read that fails still says so in place of the answer, with Try again", async () => {
    jest
      .spyOn(WhoIsToldApi, "getForMonitor")
      .mockRejectedValue(new Error("Gateway Timeout"));

    render(
      <MemoryRouter>
        <MonitorWhoIsToldCard monitorId={MONITOR_ID} />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("who-is-told-error")).toHaveTextContent(
      "Couldn't work out who is told. Gateway Timeout",
    );
    expect(screen.getByTestId("who-is-told-try-again")).toBeInTheDocument();
    expect(screen.queryByTestId("who-is-told-recheck-error")).toBeNull();
  });
});

/*
 * WHAT PEOPLE DO WITH THE CARD (#7079): Show the chain opened, and a fix
 * followed - where the card is, and the kinds of break, never a name.
 */
describe("the card's activation events", () => {
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("Show the chain sends where, how many breaks and which kinds - once, on opening", async () => {
    const send: SpyInstance<typeof ProductEvents.send> = jest
      .spyOn(ProductEvents, "send")
      .mockImplementation((): void => {});
    jest
      .spyOn(WhoIsToldApi, "getForMonitor")
      .mockResolvedValue(
        result([offline({ events: [event({ rules: [], policies: [] })] })]),
      );

    render(
      <MemoryRouter>
        <MonitorWhoIsToldCard
          monitorId={MONITOR_ID}
          place={WhoIsToldPlace.MonitorCriteria}
        />
      </MemoryRouter>,
    );

    const toggle: HTMLElement = await screen.findByTestId(
      "who-is-told-chain-toggle",
    );

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(send.mock.calls).toEqual([
      [
        ProductEventName.WhoIsToldChainOpened,
        {
          place: "monitor_criteria",
          break_count: 1,
          break_kinds: WhoIsToldBreakKind.NobodyPaged,
          owners_not_emailed_count: 0,
        },
      ],
    ]);
    expect(JSON.stringify(send.mock.calls)).not.toContain("Checkout API");
  });

  test("a fix followed sends where, the break's kind and the page", async () => {
    const send: SpyInstance<typeof ProductEvents.send> = jest
      .spyOn(ProductEvents, "send")
      .mockImplementation((): void => {});
    jest
      .spyOn(WhoIsToldApi, "getForMonitor")
      .mockResolvedValue(
        result([offline({ events: [event({ rules: [], policies: [] })] })]),
      );
    jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});

    render(
      <MemoryRouter>
        <MonitorWhoIsToldCard monitorId={MONITOR_ID} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId("who-is-told-fix"));

    expect(send).toHaveBeenCalledWith(ProductEventName.WhoIsToldFixOpened, {
      place: "monitor_overview",
      kind: WhoIsToldBreakKind.NobodyPaged,
      fix: WhoIsToldFix.IncidentOnCallRules,
    });
  });
});

/*
 * A MONITOR NOT CREATED YET (#7055): Create Monitor's criteria, read for
 * the monitor the form holds - in a section of the form, its fixes opening
 * in a new tab so the form is never left, and no Criteria page to link to.
 */
describe("When this goes down on Create Monitor", () => {
  function draftSteps(): MonitorSteps {
    return new MonitorSteps();
  }

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("the form's monitor is read at once, as a draft, and said as any monitor's", async () => {
    const getForDraft: SpyInstance<typeof WhoIsToldApi.getForDraft> = jest
      .spyOn(WhoIsToldApi, "getForDraft")
      .mockResolvedValue({ ...result([offline()]), monitorId: "" });
    const getForMonitor: SpyInstance<typeof WhoIsToldApi.getForMonitor> =
      jest.spyOn(WhoIsToldApi, "getForMonitor");
    const label: ObjectID = ObjectID.generate();

    render(
      <MemoryRouter>
        <MonitorDraftWhoIsTold
          monitorType={MonitorType.Website}
          name="Payments API"
          monitorSteps={draftSteps()}
          labels={[{ _id: label.toString() }, "not-an-id"]}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("who-is-told-summary")).toHaveTextContent(
      "OneUptime marks it Offline and opens an incident (Critical).",
    );
    expect(getForMonitor).not.toHaveBeenCalled();

    const draft: WhoIsToldDraftInput = getForDraft.mock.calls[0]![0].draft;

    expect(draft.name).toBe("Payments API");
    expect(draft.monitorType).toBe(MonitorType.Website);
    expect(draft.monitorId).toBeUndefined();
    expect(
      draft.labelIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([label.toString()]);

    // A section of the form: its title over it, no Checked line or Recheck.
    expect(
      screen.getByRole("heading", { name: "When this goes down" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("who-is-told-recheck")).toBeNull();
  });

  test("a break's fix opens in a new tab, and criteria that do nothing link to no Criteria page", async () => {
    jest.spyOn(WhoIsToldApi, "getForDraft").mockResolvedValue({
      ...result([offline({ events: [event({ rules: [], policies: [] })] })]),
      monitorId: "",
      breaks: [
        makeWhoIsToldBreak({
          kind: WhoIsToldBreakKind.NothingHappens,
          fix: WhoIsToldFix.MonitorCriteria,
        }),
        makeWhoIsToldBreak({
          kind: WhoIsToldBreakKind.NobodyPaged,
          fix: WhoIsToldFix.IncidentOnCallRules,
          recordKind: OnCallTestPageRecordKind.Incident,
        }),
      ],
    });

    render(
      <MemoryRouter>
        <MonitorDraftWhoIsTold
          monitorType={MonitorType.Website}
          name="Payments API"
          monitorSteps={draftSteps()}
        />
      </MemoryRouter>,
    );

    await screen.findAllByTestId("who-is-told-break");

    const fixes: Array<HTMLElement> = screen.getAllByTestId("who-is-told-fix");

    // Only Set Up Paging: the criteria are the form itself.
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toHaveTextContent("Set Up Paging");
    expect(fixes[0]).toHaveAttribute("target", "_blank");
  });

  test("criteria changed: read again a moment later, the last answer kept meanwhile", async () => {
    const getForDraft: SpyInstance<typeof WhoIsToldApi.getForDraft> = jest
      .spyOn(WhoIsToldApi, "getForDraft")
      .mockResolvedValue({ ...result([offline()]), monitorId: "" });

    const view: ReturnType<typeof render> = render(
      <MemoryRouter>
        <MonitorDraftWhoIsTold
          monitorType={MonitorType.Website}
          name="Payments API"
          monitorSteps={draftSteps()}
        />
      </MemoryRouter>,
    );

    await screen.findByTestId("who-is-told-summary");
    expect(getForDraft).toHaveBeenCalledTimes(1);

    view.rerender(
      <MemoryRouter>
        <MonitorDraftWhoIsTold
          monitorType={MonitorType.Website}
          name="Payments API v2"
          monitorSteps={draftSteps()}
        />
      </MemoryRouter>,
    );

    // Not at once: the person may still be typing.
    expect(getForDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("who-is-told-summary")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(getForDraft).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );
    expect(getForDraft.mock.calls[1]![0].draft.name).toBe("Payments API v2");
  });

  test("a Manual monitor, or one with no type yet, has nothing to work out", () => {
    const getForDraft: SpyInstance<typeof WhoIsToldApi.getForDraft> =
      jest.spyOn(WhoIsToldApi, "getForDraft");

    render(
      <MemoryRouter>
        <MonitorDraftWhoIsTold
          monitorType={MonitorType.Manual}
          name="Payment provider"
          monitorSteps={draftSteps()}
        />
        <MonitorDraftWhoIsTold
          monitorType={undefined}
          name=""
          monitorSteps={draftSteps()}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("monitor-draft-who-is-told")).toBeNull();
    expect(getForDraft).not.toHaveBeenCalled();
  });

  test("the steps as the form was seeded with them, as JSON, are read too", () => {
    expect(
      getMonitorDraft({
        monitorType: MonitorType.Website,
        name: "Payments API",
        monitorSteps: new MonitorSteps().toJSON(),
      })?.monitorSteps,
    ).toBeInstanceOf(MonitorSteps);
    expect(
      getMonitorDraft({
        monitorType: MonitorType.Website,
        name: "Payments API",
        monitorSteps: { _type: "Not steps" },
      }),
    ).toBeNull();
    expect(getDraftLabelIds(["not-an-id", 7, null])).toEqual([]);
  });
});

/*
 * WHAT ONE CRITERIA SETS OFF (#7074): a Test Monitor result says what the
 * criteria it matched would do, in the card's own words - for that
 * criteria, not the first one that opens something.
 */
describe("what one criteria sets off", () => {
  test("the status, what opens and who it tells, as the card's first words say them", () => {
    expect(getWhoIsToldCriteriaSentences(offline(), translator)).toEqual([
      "OneUptime marks it Offline and opens an incident (Critical).",
      "It emails the Project Owners (Owner One).",
      "It pages Ana Lopez through Primary.",
    ]);
  });

  test("the criteria asked for, not the first that opens something", () => {
    const degraded: WhoIsToldCriteria = offline({
      id: "slow",
      name: "Slow",
      statusName: "Degraded",
      events: [
        event({
          kind: OnCallTestPageRecordKind.Alert,
          severityName: "Low",
          rules: [],
          policies: [],
        }),
      ],
    });

    // The card speaks of the first; the test's result of the one matched.
    expect(
      getWhoIsToldSentences(result([offline(), degraded]), translator)[0],
    ).toBe("OneUptime marks it Offline and opens an incident (Critical).");
    expect(getWhoIsToldCriteriaSentences(degraded, translator)).toEqual([
      "OneUptime marks it Degraded and opens an alert (Low).",
      "It emails the Project Owners (Owner One).",
      "Nobody is paged.",
    ]);
  });

  test("an incident and an alert: each is said, the status once", () => {
    const both: WhoIsToldCriteria = offline({
      events: [
        event(),
        event({
          kind: OnCallTestPageRecordKind.Alert,
          severityName: "High",
          rules: [],
          policies: [],
        }),
      ],
    });

    const sentences: Array<string> = getWhoIsToldCriteriaSentences(
      both,
      translator,
    );

    expect(sentences[0]).toBe(
      "OneUptime marks it Offline and opens an incident (Critical).",
    );
    expect(sentences).toContain("OneUptime opens an alert (High).");
    expect(
      sentences.filter((sentence: string) => {
        return sentence.includes("marks it");
      }),
    ).toHaveLength(1);
  });

  test("a criteria that only sets a status says so, and who its owners are", () => {
    expect(
      getWhoIsToldCriteriaSentences(
        {
          id: "online",
          name: "Online",
          statusName: "Operational",
          statusOwners: {
            source: WhoIsToldOwnersSource.MonitorOwners,
            userNames: ["Ben Ito"],
            teamNames: [],
          },
          events: [],
        },
        translator,
      ),
    ).toEqual([
      "OneUptime marks it Operational. It opens no incident or alert, so nobody is paged.",
      "It emails the monitor's owners (Ben Ito).",
    ]);
  });

  test("a private record the reader can't see says only that it is private", () => {
    const hidden: WhoIsToldCriteria = offline({
      events: [
        {
          ...event(),
          owners: {
            source: WhoIsToldOwnersSource.Named,
            userNames: [],
            teamNames: [],
          },
          policies: [],
          rules: [],
          isPrivate: true,
          isHidden: true,
        },
      ],
    });

    const sentences: Array<string> = getWhoIsToldCriteriaSentences(
      hidden,
      translator,
    );

    expect(sentences).toEqual([
      "OneUptime marks it Offline and opens an incident (Critical).",
      "It's private, so you can't see who it tells.",
    ]);
    expect(sentences.join(" ")).not.toContain("Ana Lopez");
  });

  test("a criteria that sets nothing off has no sentences: its caller says so", () => {
    expect(
      getWhoIsToldCriteriaSentences(
        { id: "none", name: "None", events: [] },
        translator,
      ),
    ).toEqual([]);
  });
});
