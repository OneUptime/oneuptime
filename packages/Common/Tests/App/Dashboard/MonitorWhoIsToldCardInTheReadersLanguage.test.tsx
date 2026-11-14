/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import type { SpyInstance } from "jest-mock";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The words the card is drawn in, read by the translation hook below:
 * a Dashboard language's own locale file, or English's with each wording
 * marked "⟦like this⟧". `asked` is every text the card looked up.
 */
const mockReader: {
  language: string;
  words: Record<string, unknown>;
  asked: Set<string>;
} = { language: "en", words: {}, asked: new Set<string>() };

jest.mock("../../../UI/Utils/Translation", () => {
  const lookup: (text: string | undefined) => string | undefined = (
    text: string | undefined,
  ): string | undefined => {
    if (typeof text !== "string" || !text) {
      return text;
    }

    mockReader.asked.add(text);

    const value: unknown = mockReader.words[text];

    return typeof value === "string" && value ? value : text;
  };

  return {
    __esModule: true,
    default: () => {
      return {
        language: mockReader.language,
        translateString: lookup,
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? lookup(value) : value;
        },
      };
    },
  };
});

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
import WhoIsToldApi from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldApi";
import {
  makeWhoIsToldBreak,
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
} from "../../../Types/Monitor/WhoIsTold";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageNotPaged,
  OnCallTestPageNotPagedCode,
  OnCallTestPageReachedThroughCode,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import { joinSentences } from "../../../UI/Components/DeleteConfirmation/DeleteConsequences";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * "WHEN THIS GOES DOWN", DRAWN IN THE READER'S LANGUAGE (#7078).
 *
 * The words tests read the locale files key by key, and the paragraph
 * tests run the card's sentences through them. This draws the card itself -
 * the summary, every kind of break with its link, the chain opened with
 * its rows, owner rules, status pages and the names a reader can't see,
 * Recheck - and reads what the reader would read:
 *
 * - every word on it comes from the Dashboard's words (none written
 *   straight into the page), so each one reaches the translators;
 * - in Arabic, Persian, Hindi, Japanese, Korean, Russian and Chinese, no
 *   English is left on it but the names it was given and the language's
 *   own wording ("رسائل SMS");
 * - in German, the rows #7076 and #7077 added read in German.
 *
 * One thing is not the card's words and stays out of it: the time ("5
 * minutes ago", the date somebody is back) is written by the dates of the
 * page's language. Why a person is paged and why a policy's target reaches
 * nobody are the card's words since the server sends them as codes
 * (#7261): only a server from before them has its English shown.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "70780000-0000-4000-8000-000000000001",
);
const PRIMARY_ID: string = "70780000-0000-4000-8000-0000000000a1";
const SECONDARY_ID: string = "70780000-0000-4000-8000-0000000000a2";
const HIDDEN_POLICY_ID: string = "70780000-0000-4000-8000-0000000000a3";
const ANA: string = "70780000-0000-4000-8000-0000000000d1";
const BEN: string = "70780000-0000-4000-8000-0000000000d2";
const CHO: string = "70780000-0000-4000-8000-0000000000d3";
const DAN: string = "70780000-0000-4000-8000-0000000000d4";

// The names the card is given: data, drawn as written in every language.
const NAMES: ReadonlyArray<string> = [
  "Checkout API is offline",
  "Checkout API is slow",
  "Checkout API",
  "Checkout monitors",
  "Every incident",
  "Payments status",
  "Public status",
  "Ana Lopez",
  "Ben Ito",
  "Cho Park",
  "Dan Moss",
  "Owner One",
  "Platform",
  "Primary",
  "Secondary",
  "Offline",
  "Degraded",
  "Slow",
  "Critical",
  "Minor",
  "Lee Park",
  "Night shift",
  "Weekend",
];

const LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readWords(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readWords("en");

// English's words, each marked, so a word drawn without them stands out.
function markedEnglish(): Record<string, unknown> {
  const marked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(ENGLISH)) {
    marked[key] = typeof value === "string" ? `⟦${value}⟧` : value;
  }

  return marked;
}

function channels(): WhoIsToldChannels {
  return {
    isBillingEnabled: true,
    isSmsOn: true,
    isCallOn: true,
    isWhatsAppOn: true,
    isTelegramOn: true,
    hasOwnTwilioForSms: false,
    hasOwnTwilioForCalls: false,
    serverCanSendEmail: null,
    serverCanSendSms: null,
    serverCanCall: null,
  };
}

function person(overrides: Partial<WhoIsToldPerson> = {}): WhoIsToldPerson {
  return {
    userId: ANA,
    name: "Ana Lopez",
    channels: [OnCallPageChannel.SMS, OnCallPageChannel.Call],
    isFallback: false,
    isReachable: true,
    ...overrides,
  };
}

function policy(overrides: Partial<WhoIsToldPolicy> = {}): WhoIsToldPolicy {
  return {
    id: PRIMARY_ID,
    name: "Primary",
    isHidden: false,
    isNamedByCriteria: false,
    ruleIds: ["every-incident"],
    levelCount: 2,
    people: [person()],
    notPaged: [],
    ...overrides,
  };
}

const HIDDEN_POLICY: WhoIsToldPolicy = policy({
  id: HIDDEN_POLICY_ID,
  name: "",
  isHidden: true,
  people: [],
});

function event(overrides: Partial<WhoIsToldEvent> = {}): WhoIsToldEvent {
  return {
    kind: OnCallTestPageRecordKind.Incident,
    title: "Checkout API is offline",
    severityName: "Critical",
    owners: {
      source: WhoIsToldOwnersSource.Named,
      userNames: ["Ana Lopez", "Ben Ito"],
      teamNames: ["Platform"],
    },
    ownerRules: [
      { id: "checkout-monitors", name: "Checkout monitors" },
      { id: "hidden-owner-rule", name: "" },
    ],
    rules: [
      { id: "every-incident", name: "Every incident" },
      { id: "hidden-rule", name: "" },
    ],
    policies: [
      policy({
        people: [
          person(),
          person({
            userId: BEN,
            name: "Ben Ito",
            channels: [OnCallPageChannel.Email],
            isFallback: true,
          }),
          person({
            userId: CHO,
            name: "Cho Park",
            channels: [],
            isReachable: false,
            problem: WhoIsToldPersonProblem.OptedOut,
          }),
          person({ userId: DAN, name: "", channels: [OnCallPageChannel.Push] }),
        ],
      }),
      HIDDEN_POLICY,
    ],
    statusPages: [
      { id: "payments-status", name: "Payments status" },
      { id: "public-status", name: "Public status" },
      { id: "hidden-status-page", name: "" },
    ],
    ...overrides,
  };
}

// One of each break, in each of its wordings.
const EVERY_BREAK: Array<WhoIsToldBreak> = [
  {
    kind: WhoIsToldBreakKind.NothingHappens,
    fix: WhoIsToldFix.MonitorCriteria,
  },
  {
    kind: WhoIsToldBreakKind.NobodyPaged,
    fix: WhoIsToldFix.IncidentOnCallRules,
    recordKind: OnCallTestPageRecordKind.Incident,
  },
  {
    kind: WhoIsToldBreakKind.NobodyPaged,
    fix: WhoIsToldFix.AlertOnCallRules,
    recordKind: OnCallTestPageRecordKind.Alert,
  },
  {
    kind: WhoIsToldBreakKind.OnlyIncidentsHaveRules,
    fix: WhoIsToldFix.AlertOnCallRules,
  },
  {
    kind: WhoIsToldBreakKind.PolicyHasNoLevels,
    fix: WhoIsToldFix.OnCallPolicy,
    policyId: SECONDARY_ID,
    policyName: "Secondary",
  },
  {
    kind: WhoIsToldBreakKind.PolicyHasNoLevels,
    fix: WhoIsToldFix.OnCallPolicy,
    policyId: HIDDEN_POLICY_ID,
  },
  {
    kind: WhoIsToldBreakKind.PolicyReachesNobody,
    fix: WhoIsToldFix.OnCallPolicy,
    policyId: SECONDARY_ID,
    policyName: "Secondary",
  },
  {
    kind: WhoIsToldBreakKind.PolicyReachesNobody,
    fix: WhoIsToldFix.OnCallPolicy,
    policyId: HIDDEN_POLICY_ID,
  },
  ...Object.values(WhoIsToldPersonProblem).map(
    (problem: WhoIsToldPersonProblem): Omit<WhoIsToldBreak, "message"> => {
      return {
        kind: WhoIsToldBreakKind.PersonUnreachable,
        fix: WhoIsToldFix.OnCallReadiness,
        userId: CHO,
        userName: "Cho Park",
        problem: problem,
      };
    },
  ),
  {
    kind: WhoIsToldBreakKind.PersonUnreachable,
    fix: WhoIsToldFix.OnCallReadiness,
    userId: DAN,
  },
  ...Object.values(OnCallPageChannel).map(
    (channel: OnCallPageChannel): Omit<WhoIsToldBreak, "message"> => {
      return {
        kind: WhoIsToldBreakKind.ChannelOff,
        fix: WhoIsToldFix.ProjectNotificationSettings,
        channel: channel,
      };
    },
  ),
  { kind: WhoIsToldBreakKind.NoBalance, fix: WhoIsToldFix.ProjectBilling },
  ...Object.values(WhoIsToldServerChannel).map(
    (channel: WhoIsToldServerChannel): Omit<WhoIsToldBreak, "message"> => {
      return {
        kind: WhoIsToldBreakKind.ServerCannotSend,
        fix: WhoIsToldFix.ServerSettings,
        channel: channel,
      };
    },
  ),
].map((brk: Omit<WhoIsToldBreak, "message">): WhoIsToldBreak => {
  return makeWhoIsToldBreak(brk);
});

function result(
  criteria: Array<WhoIsToldCriteria>,
  breaks: Array<WhoIsToldBreak> = [],
): WhoIsToldResult {
  return {
    monitorId: MONITOR_ID.toString(),
    monitorName: "Checkout API",
    checkedAt: new Date().toISOString(),
    criteria: criteria,
    channels: channels(),
    breaks: breaks,
  };
}

/*
 * Why each is paged, and who is not, as a server of this release sends
 * them: a code with the names it names, beside its English (#7261).
 */
const AWAY_UNTIL: string = "2026-11-14T09:00:00.000Z";

// The date somebody is back, as the page's dates write it - and the test page's dialog.
function awayTime(): string {
  return OneUptimeDate.getDateAsUserFriendlyFormattedString(
    OneUptimeDate.fromString(AWAY_UNTIL),
  );
}

const PAGED_THROUGH_A_TEAM: WhoIsToldPerson = person({
  reachedThrough: "Team Platform",
  reachedThroughCode: {
    code: OnCallTestPageReachedThroughCode.Team,
    name: "Platform",
  },
});

const PAGED_AS_NEXT_IN_ROTATION: WhoIsToldPerson = person({
  userId: BEN,
  name: "Ben Ito",
  reachedThrough: "Schedule Primary (next in rotation)",
  reachedThroughCode: {
    code: OnCallTestPageReachedThroughCode.ScheduleNextInRotation,
    name: "Primary",
  },
});

// Named by the level itself: no "why them".
const PAGED_BY_NAME: WhoIsToldPerson = person({
  userId: CHO,
  name: "Cho Park",
});

const NOT_PAGED_ENGLISH: Array<string> = [
  `Lee Park is away until ${awayTime()}, with nobody covering.`,
  "Team Night shift has no members.",
  "Nobody is on call in schedule Weekend now.",
];

const NOT_PAGED_CODES: Array<OnCallTestPageNotPaged> = [
  {
    code: OnCallTestPageNotPagedCode.AwayWithNobodyCovering,
    userName: "Lee Park",
    awayUntil: AWAY_UNTIL,
    message: NOT_PAGED_ENGLISH[0]!,
  },
  {
    code: OnCallTestPageNotPagedCode.TeamHasNoMembers,
    teamName: "Night shift",
    message: NOT_PAGED_ENGLISH[1]!,
  },
  {
    code: OnCallTestPageNotPagedCode.NobodyOnCall,
    scheduleName: "Weekend",
    message: NOT_PAGED_ENGLISH[2]!,
  },
];

const CODED_POLICY: WhoIsToldPolicy = policy({
  people: [PAGED_THROUGH_A_TEAM, PAGED_AS_NEXT_IN_ROTATION, PAGED_BY_NAME],
  notPaged: NOT_PAGED_ENGLISH,
  notPagedCodes: NOT_PAGED_CODES,
});

// The same policy from a server from before the codes: its English only.
function withoutCodes(coded: WhoIsToldPolicy): WhoIsToldPolicy {
  const older: WhoIsToldPolicy = {
    ...coded,
    people: coded.people.map((item: WhoIsToldPerson): WhoIsToldPerson => {
      const olderPerson: WhoIsToldPerson = { ...item };
      delete olderPerson.reachedThroughCode;
      return olderPerson;
    }),
  };

  delete older.notPagedCodes;

  return older;
}

function answerWith(paging: WhoIsToldPolicy): WhoIsToldResult {
  return result([
    {
      id: "offline",
      name: "Offline",
      statusName: "Offline",
      events: [event({ policies: [paging] })],
    },
  ]);
}

const MANY_PEOPLE: Array<WhoIsToldPerson> = [
  person(),
  person({ userId: BEN, name: "Ben Ito" }),
  person({ userId: CHO, name: "Cho Park" }),
  person({ userId: DAN, name: "Dan Moss" }),
];

interface Answer {
  name: string;
  result: WhoIsToldResult;
}

// What the card can be asked to say, one answer each: every sentence it has.
const ANSWERS: ReadonlyArray<Answer> = [
  {
    name: "a criteria per kind, owners named and added by rules, every break",
    result: result(
      [
        {
          id: "offline",
          name: "Offline",
          statusName: "Offline",
          statusColor: "#ef4444",
          events: [event()],
        },
        {
          id: "slow",
          name: "Slow",
          events: [
            event({
              kind: OnCallTestPageRecordKind.Alert,
              title: "Checkout API is slow",
              severityName: "Minor",
              owners: {
                source: WhoIsToldOwnersSource.OwnerRules,
                userNames: ["Owner One"],
                teamNames: [],
              },
              ownerRules: [
                { id: "checkout-monitors", name: "Checkout monitors" },
              ],
              rules: [],
              policies: [],
              statusPages: [],
            }),
          ],
        },
        {
          id: "degraded",
          name: "Degraded",
          statusName: "Degraded",
          statusOwners: {
            source: WhoIsToldOwnersSource.MonitorOwners,
            userNames: ["Owner One"],
            teamNames: [],
          },
          events: [],
        },
      ],
      EVERY_BREAK,
    ),
  },
  {
    name: "an alert, owners added by owner rules, paged through a policy you can't see",
    result: result([
      {
        id: "slow",
        name: "Slow",
        events: [
          event({
            kind: OnCallTestPageRecordKind.Alert,
            owners: {
              source: WhoIsToldOwnersSource.OwnerRules,
              userNames: [],
              teamNames: [],
            },
            policies: [HIDDEN_POLICY],
            statusPages: [],
          }),
        ],
      },
    ]),
  },
  {
    name: "the project's owners, and nobody who can be paged",
    result: result([
      {
        id: "offline",
        name: "Offline",
        statusName: "Offline",
        events: [
          event({
            owners: {
              source: WhoIsToldOwnersSource.ProjectOwners,
              userNames: [],
              teamNames: [],
            },
            ownerRules: [],
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
      },
      {
        id: "slow",
        name: "Slow",
        events: [event({ kind: OnCallTestPageRecordKind.Alert })],
      },
      {
        id: "degraded",
        name: "Degraded",
        events: [event({ severityName: "Minor" })],
      },
    ]),
  },
  {
    name: "more owners and more people than it names, by name",
    result: result([
      {
        id: "slow",
        name: "Slow",
        events: [
          event({
            owners: {
              source: WhoIsToldOwnersSource.ProjectOwners,
              userNames: ["Ana Lopez", "Ben Ito", "Cho Park", "Dan Moss"],
              teamNames: ["Platform"],
            },
            policies: [policy({ people: MANY_PEOPLE })],
          }),
        ],
      },
    ]),
  },
  {
    name: "why each is paged and who is not, as the server's codes",
    result: answerWith(CODED_POLICY),
  },
  {
    name: "nobody paged",
    result: result([
      {
        id: "offline",
        name: "Offline",
        events: [event({ rules: [], policies: [] })],
      },
    ]),
  },
  {
    name: "a status only",
    result: result([
      {
        id: "degraded",
        name: "Degraded",
        statusName: "Degraded",
        statusOwners: {
          source: WhoIsToldOwnersSource.MonitorOwners,
          userNames: [],
          teamNames: [],
        },
        events: [],
      },
    ]),
  },
  {
    name: "nothing happens",
    result: result(
      [],
      [
        makeWhoIsToldBreak({
          kind: WhoIsToldBreakKind.NothingHappens,
          fix: WhoIsToldFix.MonitorCriteria,
        }),
      ],
    ),
  },
];

function readIn(language: string, words: Record<string, unknown>): void {
  mockReader.language = language;
  mockReader.words = words;
  mockReader.asked = new Set<string>();
}

// The card drawn with `answer`, its chain open when it has one.
async function drawCard(answer: WhoIsToldResult): Promise<RenderResult> {
  jest.spyOn(WhoIsToldApi, "getForMonitor").mockResolvedValue(answer);

  const drawn: RenderResult = render(
    <MemoryRouter>
      <MonitorWhoIsToldCard monitorId={MONITOR_ID} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.queryByTestId("who-is-told-loading")).toBeNull();
  });

  const toggle: HTMLElement | null = screen.queryByTestId(
    "who-is-told-chain-toggle",
  );

  if (toggle) {
    fireEvent.click(toggle);
    expect(screen.getByTestId("who-is-told-chain")).toBeInTheDocument();
  }

  return drawn;
}

/*
 * What a reader reads on the card: its text, and each label a screen
 * reader says - without the time, which the page's dates write.
 */
function readCard(drawn: RenderResult): Array<string> {
  const copy: HTMLElement = drawn.container.cloneNode(true) as HTMLElement;

  for (const time of Array.from(copy.querySelectorAll("time"))) {
    time.remove();
  }

  const labels: Array<string> = Array.from(
    copy.querySelectorAll("[aria-label]"),
  ).map((element: Element): string => {
    return element.getAttribute("aria-label") || "";
  });

  return [copy.textContent || "", ...labels];
}

// `text` without the marked words (innermost first) and the given names.
function withoutWords(text: string, names: ReadonlyArray<string>): string {
  let rest: string = text;
  let before: string = "";

  while (rest !== before) {
    before = rest;
    rest = rest.replace(/⟦[^⟦⟧]*⟧/g, " ");
  }

  for (const name of [...names].sort((a: string, b: string): number => {
    return b.length - a.length;
  })) {
    rest = rest.split(name).join(" ");
  }

  return rest;
}

const HAS_A_LETTER: RegExp = /\p{L}/u;

// The words of `text` that have letters.
function wordsIn(text: string): Array<string> {
  return text.split(/\s+/).filter((word: string): boolean => {
    return HAS_A_LETTER.test(word);
  });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  readIn("en", {});
});

// The words left on what `read` holds once marked words and `names` are out.
function unmarkedWords(
  read: ReadonlyArray<string>,
  names: ReadonlyArray<string>,
): Array<string> {
  return read.flatMap((text: string): Array<string> => {
    return wordsIn(withoutWords(text, names));
  });
}

describe("every word on the card comes from the Dashboard's words", () => {
  test.each(ANSWERS)("$name", async (answer: Answer): Promise<void> => {
    readIn("en", markedEnglish());
    const drawn: RenderResult = await drawCard(answer.result);

    const read: Array<string> = readCard(drawn);

    // The marked words are the ones drawn: the hook is the card's.
    expect(read.join(" ")).toContain("⟦");
    expect(unmarkedWords(read, NAMES)).toEqual([]);
  });

  test("while it loads, while it checks again, and when it fails", async () => {
    readIn("en", markedEnglish());
    const getForMonitor: SpyInstance<typeof WhoIsToldApi.getForMonitor> =
      jest.spyOn(WhoIsToldApi, "getForMonitor");

    getForMonitor.mockReturnValueOnce(new Promise<WhoIsToldResult>(() => {}));

    const loading: RenderResult = render(
      <MemoryRouter>
        <MonitorWhoIsToldCard monitorId={MONITOR_ID} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("who-is-told-loading")).toBeInTheDocument();
    expect(unmarkedWords(readCard(loading), [])).toEqual([]);
    cleanup();

    getForMonitor
      .mockResolvedValueOnce(ANSWERS[0]!.result)
      .mockReturnValueOnce(new Promise<WhoIsToldResult>(() => {}));

    const checking: RenderResult = render(
      <MemoryRouter>
        <MonitorWhoIsToldCard monitorId={MONITOR_ID} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId("who-is-told-recheck"));

    expect(screen.getByTestId("who-is-told-recheck")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByTestId("who-is-told-recheck")).toHaveTextContent(
      `⟦${ENGLISH["Checking..."] as string}⟧`,
    );
    expect(unmarkedWords(readCard(checking), NAMES)).toEqual([]);
    cleanup();

    getForMonitor.mockRejectedValueOnce(new Error("Gateway Timeout"));

    const failed: RenderResult = render(
      <MemoryRouter>
        <MonitorWhoIsToldCard monitorId={MONITOR_ID} />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("who-is-told-error")).toBeInTheDocument();
    expect(unmarkedWords(readCard(failed), ["Gateway Timeout"])).toEqual([]);
  });
});

/*
 * Languages written in another script: a word in Latin letters on the card
 * is English that never went through the language's words - unless it is in
 * a name the card was given, or in the language's own wording of what the
 * card said (Arabic writes "رسائل SMS", Russian "Push-уведомление"). Which
 * words a language may keep in English is WhoIsToldWordsInEveryLanguage's
 * question; this one is whether all of them reach the reader.
 */
const OTHER_SCRIPTS: ReadonlyArray<string> = [
  "ar",
  "fa",
  "hi",
  "ja",
  "ko",
  "ru",
  "zh-CN",
  "zh-TW",
];

function latinWords(text: string): Array<string> {
  return text.match(/[A-Za-z]+/g) || [];
}

describe("in a language written in another script, no English is left", () => {
  test.each(OTHER_SCRIPTS)("%s", async (language: string): Promise<void> => {
    const words: Record<string, unknown> = readWords(language);
    const leftInEnglish: Array<string> = [];

    for (const answer of ANSWERS) {
      readIn(language, words);
      const drawn: RenderResult = await drawCard(answer.result);
      const read: Array<string> = readCard(drawn);

      const ownLatinWords: Set<string> = new Set<string>(
        Array.from(mockReader.asked).flatMap((text: string): Array<string> => {
          const value: unknown = words[text];
          return typeof value === "string" ? latinWords(value) : [];
        }),
      );

      for (const text of read) {
        for (const word of latinWords(
          withoutWords(text, [...NAMES, awayTime()]),
        )) {
          if (!ownLatinWords.has(word)) {
            leftInEnglish.push(`${answer.name}: ${word}`);
          }
        }
      }

      cleanup();
      jest.restoreAllMocks();
    }

    expect(leftInEnglish).toEqual([]);
  });
});

/*
 * A person's line sets its facts off as the reader's language does: a
 * middle dot, or a bullet in a language whose zero is a dot (Persian) -
 * each mark kept to the fact before it by a no-break space, so a line that
 * wraps never starts with one.
 */
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

describe("a person's facts, set off as the reader's language does", () => {
  test.each([
    ["en", String.fromCharCode(0xb7)],
    ["de", String.fromCharCode(0xb7)],
    ["fa", String.fromCharCode(0x2022)],
  ])("%s", async (language: string, mark: string): Promise<void> => {
    readIn(language, readWords(language));

    await drawCard(
      result([
        {
          id: "offline",
          name: "Offline",
          statusName: "Offline",
          statusColor: "#ef4444",
          events: [
            event({
              policies: [
                policy({
                  people: [person({ reachedThrough: "Team Platform" })],
                }),
              ],
            }),
          ],
        },
      ]),
    );

    const words: HTMLElement = screen
      .getByTestId("who-is-told-person")
      .querySelector("p") as HTMLElement;
    const facts: Array<string> = (words.textContent || "").split(
      `${NO_BREAK_SPACE}${mark} `,
    );

    expect(facts).toHaveLength(3);
    expect(facts.slice(0, 2)).toEqual(["Ana Lopez", "Team Platform"]);
    expect(facts[2]!.trim()).not.toBe("");
  });
});

/*
 * #7307: a read that failed with an error nobody explained - a gateway's
 * 502 or 504, a server failure with its reference - read half in English
 * on a German or a Persian card ("... wer benachrichtigt wird. Error
 * connecting to server. Please try again in few minutes."). The card's
 * sentence reads wholly in the reader's language now: its own words, then
 * why it failed and what to do next, the reference in code with a copy
 * button named in the language, and Try again.
 */
describe("a failed read, wholly in the reader's language", () => {
  const TEMPLATE: string = "Couldn't work out who is told. {{error}}";

  async function drawFailure(
    language: string,
    message: string,
  ): Promise<{ words: Record<string, string>; error: HTMLElement }> {
    const words: Record<string, string> = readWords(language) as Record<
      string,
      string
    >;

    readIn(language, words);
    jest
      .spyOn(WhoIsToldApi, "getForMonitor")
      .mockRejectedValue(new Error(message));

    render(
      <MemoryRouter>
        <MonitorWhoIsToldCard monitorId={MONITOR_ID} />
      </MemoryRouter>,
    );

    return {
      words: words,
      error: await screen.findByTestId("who-is-told-error"),
    };
  }

  test.each(["de", "fa"])(
    "%s: a gateway's 502 or 504",
    async (language: string): Promise<void> => {
      const { words, error } = await drawFailure(language, SERVER_DOWN_MESSAGE);

      expect(words[TEMPLATE]).toBeTruthy();
      expect(words[TEMPLATE]).not.toBe(TEMPLATE);
      expect(withoutIsolateMarks(error.textContent || "").trim()).toBe(
        words[TEMPLATE]!.replace(
          "{{error}}",
          joinSentences([
            words[UnexplainedErrorWords.serverDownWhy]!,
            words[UnexplainedErrorWords.serverDownNext]!,
          ]),
        ).trim(),
      );
      expect(error.textContent).not.toContain(SERVER_DOWN_MESSAGE);

      // None of it in English.
      for (const english of [
        "Couldn't work out who is told.",
        UnexplainedErrorWords.serverDownWhy,
        UnexplainedErrorWords.serverDownNext,
      ]) {
        expect(error.textContent).not.toContain(english);
      }

      // Persian's own script: the only Latin letters are OneUptime's name.
      if (language === "fa") {
        expect(
          (error.textContent || "")
            .replace(/OneUptime/g, "")
            .match(/[A-Za-z]+/g),
        ).toBeNull();
      }
      expect(screen.getByTestId("who-is-told-try-again")).toHaveTextContent(
        words["Try again"]!,
      );
    },
  );

  test.each(["de", "fa"])(
    "%s: a server failure with its reference, and its copy button",
    async (language: string): Promise<void> => {
      const { words, error } = await drawFailure(
        language,
        getUnexplainedServerErrorMessage("1f0c9a2b"),
      );
      const text: string = withoutIsolateMarks(error.textContent || "");

      expect(text.startsWith(words[TEMPLATE]!.split("{{error}}")[0]!)).toBe(
        true,
      );
      expect(text).toContain(
        joinSentences([
          words[UnexplainedErrorWords.serverWhy]!,
          words[UnexplainedErrorWords.serverNextWithReferenceSelfHosted]!,
        ]),
      );
      expect(text).not.toContain("The server ran into a problem");
      expect(text).not.toContain("give this reference");

      const reference: HTMLElement =
        within(error).getByTestId("error-reference");
      const code: HTMLElement = within(reference).getByText("1f0c9a2b");

      expect(code.tagName).toBe("CODE");
      expect(code).toHaveAttribute("dir", "ltr");
      expect(
        within(reference).getByRole("button", { name: words["Copy"]! }),
      ).toBeInTheDocument();
    },
  );
});

describe("in German, the rows #7076 and #7077 added", () => {
  test("owner rules, status pages and the names a reader can't see", async () => {
    const german: Record<string, unknown> = readWords("de");
    readIn("de", german);

    await drawCard(ANSWERS[0]!.result);

    const ownerRules: HTMLElement = screen.getAllByTestId(
      "who-is-told-owner-rules",
    )[0]!;
    const statusPages: HTMLElement = screen.getByTestId(
      "who-is-told-status-pages",
    );

    for (const english of [
      "Owner Rules",
      "A rule you can't see",
      "Status pages",
      "A status page you can't see",
    ]) {
      expect(german[english]).toEqual(expect.any(String));
      expect(german[english]).not.toBe(english);
    }

    expect(ownerRules).toHaveTextContent(german["Owner Rules"] as string);
    expect(ownerRules).toHaveTextContent("Checkout monitors");
    expect(ownerRules).toHaveTextContent(
      german["A rule you can't see"] as string,
    );
    expect(statusPages).toHaveTextContent(german["Status pages"] as string);
    expect(statusPages).toHaveTextContent("Payments status");
    expect(statusPages).toHaveTextContent(
      german["A status page you can't see"] as string,
    );

    const card: string = screen.getByTestId("monitor-who-is-told-card")
      .textContent as string;

    expect(card).not.toContain("Owner Rules");
    expect(card).not.toContain("you can't see");
    expect(card).not.toContain("Status pages");
  });
});

/*
 * WHY SOMEBODY IS PAGED, AND WHY NOBODY IS, IN THE READER'S WORDS (#7261).
 *
 * The server sends a person's "why them" and a policy's targets that reach
 * nobody as codes with the names they name, beside its English; the card
 * words them as the test page's dialog does (OnCallTestPageWords): each
 * name set apart from words that read the other way, the date somebody is
 * back written as the dialog writes it. A server that sends no codes, or a
 * code this Dashboard does not know, has its English shown - each such
 * line read left to right on a right-to-left page.
 */
const RIGHT_TO_LEFT_LANGUAGES: ReadonlyArray<string> = ["fa"];

// A sentence of `words`, its values in as the card puts them in.
function wordedIn(
  language: string,
  words: Record<string, unknown>,
  key: string,
  values: Record<string, string>,
): string {
  let sentence: string = words[key] as string;

  expect(typeof sentence).toBe("string");
  expect(sentence).toBeTruthy();

  for (const [name, value] of Object.entries(values)) {
    // A Latin name or a date in a sentence read from the right is set apart.
    sentence = sentence.replace(
      `{{${name}}}`,
      RIGHT_TO_LEFT_LANGUAGES.includes(language) ? isolated(value) : value,
    );
  }

  return sentence;
}

function textsOf(testId: string): Array<string> {
  return screen.queryAllByTestId(testId).map((element: HTMLElement): string => {
    return element.textContent || "";
  });
}

describe("why somebody is paged, and why nobody is, in the reader's words (#7261)", () => {
  test.each(["de", "fa"])(
    "%s: a team, a schedule's next in rotation, somebody away, a team with nobody in it and a schedule with nobody on call",
    async (language: string): Promise<void> => {
      const words: Record<string, unknown> = readWords(language);
      readIn(language, words);

      await drawCard(answerWith(CODED_POLICY));

      expect(textsOf("who-is-told-reached-through")).toEqual([
        wordedIn(language, words, "Team {{name}}", { name: "Platform" }),
        wordedIn(language, words, "Schedule {{name}} (next in rotation)", {
          name: "Primary",
        }),
      ]);

      const notPaged: Array<HTMLElement> = screen.getAllByTestId(
        "who-is-told-not-paged",
      );

      expect(
        notPaged.map((line: HTMLElement): string => {
          return line.textContent || "";
        }),
      ).toEqual([
        wordedIn(
          language,
          words,
          "{{name}} is away until {{time}}, with nobody covering.",
          { name: "Lee Park", time: awayTime() },
        ),
        wordedIn(language, words, "Team {{name}} has no members.", {
          name: "Night shift",
        }),
        wordedIn(
          language,
          words,
          "Nobody is on call in schedule {{name}} now.",
          {
            name: "Weekend",
          },
        ),
      ]);

      // Each reads the page's way: no direction of its own.
      for (const line of notPaged) {
        expect(line).not.toHaveAttribute("dir");
      }

      // None of the server's English is left on the card.
      const card: string = withoutIsolateMarks(
        screen.getByTestId("monitor-who-is-told-card").textContent || "",
      );

      for (const english of [
        ...NOT_PAGED_ENGLISH,
        "Schedule Primary (next in rotation)",
        "next in rotation",
        "is away until",
        "with nobody covering",
        "has no members",
        "Nobody is on call",
      ]) {
        expect(card).not.toContain(english);
      }
    },
  );

  test.each(["de", "fa"])(
    "%s: a person's facts, the way they are paged in the reader's words between them",
    async (language: string): Promise<void> => {
      const words: Record<string, unknown> = readWords(language);
      readIn(language, words);

      await drawCard(answerWith(CODED_POLICY));

      const mark: string = `${NO_BREAK_SPACE}${
        language === "fa"
          ? String.fromCharCode(0x2022)
          : String.fromCharCode(0xb7)
      } `;
      const facts: Array<Array<string>> = screen
        .getAllByTestId("who-is-told-person")
        .map((line: HTMLElement): Array<string> => {
          return (line.querySelector("p")!.textContent || "").split(mark);
        });

      expect(
        facts.slice(0, 2).map((fact: Array<string>): Array<string> => {
          // The name, how they are paged, and by what.
          expect(fact).toHaveLength(3);
          return fact.slice(0, 2);
        }),
      ).toEqual([
        [
          "Ana Lopez",
          wordedIn(language, words, "Team {{name}}", { name: "Platform" }),
        ],
        [
          "Ben Ito",
          wordedIn(language, words, "Schedule {{name}} (next in rotation)", {
            name: "Primary",
          }),
        ],
      ]);

      // Named by the level: its channels come straight after the name.
      expect(facts[2]).toHaveLength(2);
      expect(facts[2]![0]).toBe("Cho Park");
    },
  );

  test.each(["de", "fa"])(
    "%s: a server that sends no codes has its English shown, as before, each line read left to right",
    async (language: string): Promise<void> => {
      readIn(language, readWords(language));

      await drawCard(answerWith(withoutCodes(CODED_POLICY)));

      expect(textsOf("who-is-told-reached-through")).toEqual([
        "Team Platform",
        "Schedule Primary (next in rotation)",
      ]);

      const notPaged: Array<HTMLElement> = screen.getAllByTestId(
        "who-is-told-not-paged",
      );

      expect(
        notPaged.map((line: HTMLElement): string => {
          return line.textContent || "";
        }),
      ).toEqual(NOT_PAGED_ENGLISH);

      for (const line of notPaged) {
        if (RIGHT_TO_LEFT_LANGUAGES.includes(language)) {
          expect(line).toHaveAttribute("dir", "ltr");
          /*
           * A sentence that may wrap: as wide as its words, at the page's
           * start beside its warning, each of its lines from its own start
           * - never each line lined up by its end, ragged where it starts.
           */
          expect(line).toHaveClass(
            ...CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" "),
          );
          expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
        } else {
          expect(line).not.toHaveAttribute("dir");
        }
      }
    },
  );

  test("a code this Dashboard does not know reads the server's English; the ones it knows are worded", async () => {
    const words: Record<string, unknown> = readWords("de");
    readIn("de", words);

    await drawCard(
      answerWith(
        policy({
          people: [
            person({
              reachedThrough: "Rota Platform",
              reachedThroughCode: {
                code: "Rota" as OnCallTestPageReachedThroughCode,
                name: "Platform",
              },
            }),
            PAGED_AS_NEXT_IN_ROTATION,
          ],
          notPaged: ["Platform is on strike.", NOT_PAGED_ENGLISH[1]!],
          notPagedCodes: [
            {
              code: "OnStrike" as OnCallTestPageNotPagedCode,
              teamName: "Platform",
              message: "Platform is on strike.",
            },
            NOT_PAGED_CODES[1]!,
          ],
        }),
      ),
    );

    expect(textsOf("who-is-told-reached-through")).toEqual([
      "Rota Platform",
      wordedIn("de", words, "Schedule {{name}} (next in rotation)", {
        name: "Primary",
      }),
    ]);
    expect(textsOf("who-is-told-not-paged")).toEqual([
      "Platform is on strike.",
      wordedIn("de", words, "Team {{name}} has no members.", {
        name: "Night shift",
      }),
    ]);
  });

  test("a policy the reader may not see says nothing of who it reaches or who it doesn't", async () => {
    readIn("de", readWords("de"));

    await drawCard(
      answerWith({
        ...HIDDEN_POLICY,
        notPaged: [],
        notPagedCodes: [],
      }),
    );

    expect(textsOf("who-is-told-reached-through")).toEqual([]);
    expect(textsOf("who-is-told-not-paged")).toEqual([]);
  });
});
