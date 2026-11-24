import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import { SecurityProtectedAddressSource } from "Common/Types/SecurityBlocklist/SecurityProtectedAddress";
import { SecurityAttackCampaign } from "Common/Types/SecurityEvent/SecurityAttackCampaign";
import {
  SecurityAttackNetwork,
  SecurityAttackNetworkKind,
} from "Common/Types/SecurityEvent/SecurityAttackNetwork";
import {
  SecurityCampaignAddressStanding,
  SecurityNetworkChallengeCheck,
  SecurityNetworkChallengeStanding,
  SecurityNetworkUncheckedReason,
} from "Common/Types/SecurityEvent/SecurityCampaignContainment";
import SecurityEventRequestOutcome from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import { WrittenMoment, writeReaderMoment } from "Common/Utils/MomentPhrases";
import type * as ModelModuleType from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/Campaigns/CampaignContainmentModel";

/*
 * CAMPAIGNS' ACTIONS, IN WORDS (#10354): which rows Block Addresses can
 * take, what its check says of each address left out, the pill of the
 * block that holds a row, a network row's lines, what Challenge This
 * Network's check says for each standing, and a case's repeat-offender
 * line - "Blocked twice before, last on Nov 12 (case CASE-812)."
 */

type ModelModule = typeof ModelModuleType;

let Model: ModelModule;

const ENGLISH: Translator = createTranslator(undefined, "en");

function campaign(
  overrides: Partial<SecurityAttackCampaign> = {},
): SecurityAttackCampaign {
  return {
    sourceIp: "35.205.11.131",
    requestCount: 12,
    rejectedCount: 12,
    reachedAppCount: 0,
    erroredCount: 0,
    reachedDatabaseCount: 0,
    worstOutcome: SecurityEventRequestOutcome.Rejected,
    maxSeverityId: 3,
    attackKinds: [],
    userAgents: [],
    targetCount: 1,
    sampleTargets: [],
    firstSeen: "",
    lastSeen: "",
    ...overrides,
  };
}

function network(
  overrides: Partial<SecurityAttackNetwork> = {},
): SecurityAttackNetwork {
  return {
    network: "AS14061",
    kind: SecurityAttackNetworkKind.Asn,
    addressCount: 13,
    addresses: ["203.0.113.7", "203.0.113.9", "203.0.113.12", "198.51.100.4"],
    ranges: [
      { range: "203.0.113.0/24", addressCount: 10, requestCount: 300 },
      { range: "198.51.100.0/24", addressCount: 3, requestCount: 20 },
    ],
    requestCount: 320,
    rejectedCount: 320,
    reachedAppCount: 0,
    erroredCount: 0,
    reachedDatabaseCount: 0,
    worstOutcome: SecurityEventRequestOutcome.Rejected,
    maxSeverityId: 3,
    attackKinds: [],
    userAgents: [],
    targetCount: 1,
    sampleTargets: [],
    firstSeen: "",
    lastSeen: "",
    ...overrides,
  };
}

function networkCheck(
  overrides: Partial<SecurityNetworkChallengeCheck>,
): SecurityNetworkChallengeCheck {
  return {
    value: "203.0.113.0/24",
    kind: SecurityAttackNetworkKind.Range,
    standing: SecurityNetworkChallengeStanding.Challengeable,
    holders: ["Cloudflare"],
    isAdmin: false,
    repeat: null,
    suggestedDuration: SecurityBlockDuration.OneDay,
    ...overrides,
  };
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Model = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/Campaigns/CampaignContainmentModel"
  );
});

describe("which rows Block Addresses can take", () => {
  test("a public address no block holds", () => {
    expect(Model.isCampaignSelectable(campaign())).toBe(true);
  });

  test("never a private or local address, the row of no address, or one a block holds", () => {
    expect(
      Model.isCampaignSelectable(campaign({ sourceIp: "10.0.4.12" })),
    ).toBe(false);
    expect(
      Model.isCampaignSelectable(campaign({ sourceIp: "127.0.0.1" })),
    ).toBe(false);
    expect(Model.isCampaignSelectable(campaign({ sourceIp: "" }))).toBe(false);
    expect(
      Model.isCampaignSelectable(
        campaign({
          block: {
            value: "35.205.11.0/24",
            action: SecurityBlockAction.Block,
            expiresAt: null,
          },
        }),
      ),
    ).toBe(false);
  });

  test("a reload keeps only the selected rows still on the page and selectable", () => {
    expect(
      Model.keepSelectable({
        selected: ["35.205.11.131", "35.205.11.140", "198.51.100.4"],
        campaigns: [
          campaign(),
          campaign({
            sourceIp: "35.205.11.140",
            block: {
              value: "35.205.11.140",
              action: SecurityBlockAction.Block,
              expiresAt: null,
            },
          }),
        ],
      }),
    ).toEqual(["35.205.11.131"]);
  });

  test("says how many are selected in the reader's plural forms", () => {
    expect(Model.writeSelectedCount(1, ENGLISH)).toBe("1 address selected");
    expect(Model.writeSelectedCount(3, ENGLISH)).toBe("3 addresses selected");
  });
});

describe("the pill of the block that holds a row", () => {
  test("a block until a time says so, and names the range that holds the address", () => {
    const pill: ReturnType<ModelModule["writeRowBlockPill"]> =
      Model.writeRowBlockPill({
        block: {
          value: "35.205.11.0/24",
          action: SecurityBlockAction.Block,
          expiresAt: "2026-11-24T10:42:00.000Z",
        },
        value: "35.205.11.131",
        translator: ENGLISH,
        now: new Date("2026-11-23T10:00:00.000Z"),
      });

    expect(pill.text.startsWith("Blocked until ")).toBe(true);
    expect(pill.tone).toBe(PillTone.Neutral);
    expect(pill.tooltip).toBe("By 35.205.11.0/24");
  });

  test("a challenge of the row's own network until lifted says Challenged, with nothing to name", () => {
    const pill: ReturnType<ModelModule["writeRowBlockPill"]> =
      Model.writeRowBlockPill({
        block: {
          value: "AS14061",
          action: SecurityBlockAction.Challenge,
          expiresAt: null,
        },
        value: "AS14061",
        translator: ENGLISH,
      });

    expect(pill).toEqual({ text: "Challenged", tone: PillTone.Info });
  });

  /*
   * The moment brings its own words (#10932): the time alone today, its day
   * and its time on another day, never the two written whole after a
   * sentence's own "until". The times are chosen to fall on the same local
   * day, and two days apart, in every time zone.
   */
  test("a block that ends today names its time alone, and one that ends another day its day and its time", () => {
    const now: Date = new Date("2026-11-23T12:00:00.000Z");
    const today: Date = new Date("2026-11-23T12:30:00.000Z");
    const later: Date = new Date("2026-11-25T12:00:00.000Z");
    const pillFor: (expiresAt: Date, action: SecurityBlockAction) => string = (
      expiresAt: Date,
      action: SecurityBlockAction,
    ): string => {
      return Model.writeRowBlockPill({
        block: {
          value: "35.205.11.131",
          action,
          expiresAt: expiresAt.toISOString(),
        },
        value: "35.205.11.131",
        translator: ENGLISH,
        now,
      }).text;
    };
    const todayMoment: WrittenMoment = writeReaderMoment(today, now);
    const laterMoment: WrittenMoment = writeReaderMoment(later, now);

    expect(todayMoment.date).toBeNull();
    expect(laterMoment.date).not.toBeNull();

    expect(pillFor(today, SecurityBlockAction.Block)).toBe(
      `Blocked until ${todayMoment.time}`,
    );
    expect(pillFor(today, SecurityBlockAction.Challenge)).toBe(
      `Challenged until ${todayMoment.time}`,
    );
    expect(pillFor(later, SecurityBlockAction.Block)).toBe(
      `Blocked until ${laterMoment.date} at ${laterMoment.time}`,
    );
    expect(pillFor(later, SecurityBlockAction.Challenge)).toBe(
      `Challenged until ${laterMoment.date} at ${laterMoment.time}`,
    );
    expect(pillFor(later, SecurityBlockAction.Block)).not.toContain(
      laterMoment.whole,
    );
  });

  test("an end that is no date reads as a block lifted by hand", () => {
    expect(
      Model.writeRowBlockPill({
        block: {
          value: "35.205.11.131",
          action: SecurityBlockAction.Block,
          expiresAt: "not a date",
        },
        value: "35.205.11.131",
        translator: ENGLISH,
      }).text,
    ).toBe("Blocked");
  });
});

describe("what Challenge This Network says once it is done (#10932)", () => {
  const now: Date = new Date("2026-11-23T12:00:00.000Z");

  test("a challenge that ends today names its network and its time", () => {
    const expiresAt: Date = new Date("2026-11-23T12:30:00.000Z");

    expect(
      Model.writeNetworkChallengedToast({
        challenged: { value: "203.0.113.0/24", expiresAt },
        translator: ENGLISH,
        now,
      }),
    ).toBe(
      `Challenged 203.0.113.0/24 until ${writeReaderMoment(expiresAt, now).time}.`,
    );
  });

  test("one that ends another day names its day and its time", () => {
    const expiresAt: Date = new Date("2026-11-25T12:00:00.000Z");
    const moment: WrittenMoment = writeReaderMoment(expiresAt, now);

    expect(
      Model.writeNetworkChallengedToast({
        challenged: { value: "AS14061", expiresAt },
        translator: ENGLISH,
        now,
      }),
    ).toBe(`Challenged AS14061 until ${moment.date} at ${moment.time}.`);
  });

  test("one lifted by hand names its network alone, never an until with nothing after it", () => {
    for (const expiresAt of [null, new Date("not a date")]) {
      expect(
        Model.writeNetworkChallengedToast({
          challenged: { value: "203.0.113.0/24", expiresAt },
          translator: ENGLISH,
          now,
        }),
      ).toBe("Challenged 203.0.113.0/24.");
    }
  });

  test("a language that words the sentence words its moment too", () => {
    const spanish: Translator = createTranslator(
      (key: string): string | undefined => {
        return (
          {
            "Challenged {{network}} {{until}}.":
              "Se sometió {{network}} a desafío {{until}}.",
            "until {{clock}}": "hasta las {{clock}}",
            "until {{clock}}_one": "hasta la {{clock}}",
          } as Record<string, string>
        )[key];
      },
      "es",
    );

    expect(
      Model.writeNetworkChallengedToast({
        challenged: {
          value: "203.0.113.0/24",
          expiresAt: new Date("2026-11-23T12:30:00.000Z"),
        },
        translator: spanish,
        now,
      }),
    ).toMatch(/^Se sometió 203\.0\.113\.0\/24 a desafío hasta las? \d.*\.$/);
  });
});

describe("what Block Addresses' check says of an address it leaves out", () => {
  test("one it will block says nothing", () => {
    expect(
      Model.describeCampaignAddressCheck({
        check: {
          typed: "35.205.11.131",
          value: "35.205.11.131",
          standing: SecurityCampaignAddressStanding.Blockable,
        },
        translator: ENGLISH,
      }),
    ).toBeNull();
  });

  test("one a range already blocks names the range", () => {
    expect(
      Model.describeCampaignAddressCheck({
        check: {
          typed: "35.205.11.131",
          value: "35.205.11.131",
          standing: SecurityCampaignAddressStanding.AlreadyBlocked,
          coveredBy: "35.205.11.0/24",
        },
        translator: ENGLISH,
      }),
    ).toBe("35.205.11.131 is already blocked: 35.205.11.0/24 covers it.");
  });

  test("one of your own says what it is", () => {
    expect(
      Model.describeCampaignAddressCheck({
        check: {
          typed: "203.0.113.10",
          value: "203.0.113.10",
          standing: SecurityCampaignAddressStanding.Protected,
          protection: {
            source: SecurityProtectedAddressSource.Host,
            protectedValue: "203.0.113.10",
            name: "web-3",
          },
        },
        translator: ENGLISH,
      }),
    ).toContain("web-3");
  });

  test("a signed-in user's names who", () => {
    expect(
      Model.describeCampaignAddressCheck({
        check: {
          typed: "192.0.2.5",
          value: "192.0.2.5",
          standing: SecurityCampaignAddressStanding.SignedIn,
          users: [
            {
              name: "alice@example.com",
              source: "IdentityProvider",
              lastSeenAt: null,
            },
            { name: "bob@example.com", source: "Requests", lastSeenAt: null },
          ],
        },
        translator: ENGLISH,
      }),
    ).toBe(
      "alice@example.com and bob@example.com signed in from it in the last 30 days.",
    );
  });

  test("one OneUptime could not check says so, and to try again", () => {
    expect(
      Model.describeCampaignAddressCheck({
        check: {
          typed: "198.51.100.7",
          value: "198.51.100.7",
          standing: SecurityCampaignAddressStanding.CannotTell,
        },
        translator: ENGLISH,
      }),
    ).toContain("Try again in a minute");
  });

  test("the check's addresses split into those it blocks and those it leaves out", () => {
    const split: ReturnType<ModelModule["splitCampaignChecks"]> =
      Model.splitCampaignChecks([
        {
          typed: "a",
          value: "a",
          standing: SecurityCampaignAddressStanding.Blockable,
        },
        {
          typed: "b",
          value: "b",
          standing: SecurityCampaignAddressStanding.Protected,
        },
        {
          typed: "c",
          value: "c",
          standing: SecurityCampaignAddressStanding.Blocked,
        },
      ]);

    expect(
      split.blocking.map((check: { typed: string }): string => {
        return check.typed;
      }),
    ).toEqual(["a", "c"]);
    expect(
      split.leftOut.map((check: { typed: string }): string => {
        return check.typed;
      }),
    ).toEqual(["b"]);
  });
});

describe("what Block Addresses says it does, and did", () => {
  test("blocks or challenges how many, for how long", () => {
    expect(
      Model.writeWillBlock({
        count: 3,
        action: SecurityBlockAction.Block,
        duration: SecurityBlockDuration.OneDay,
        translator: ENGLISH,
      }),
    ).toBe("Blocks 3 addresses for 24 hours.");
    expect(
      Model.writeWillBlock({
        count: 1,
        action: SecurityBlockAction.Challenge,
        duration: SecurityBlockDuration.SevenDays,
        translator: ENGLISH,
      }),
    ).toBe("Challenges 1 address for 7 days.");
  });

  test("the toast says how many were blocked, and how many left out", () => {
    expect(
      Model.writeBlockedToast({
        outcome: {
          addresses: [
            {
              typed: "a",
              value: "a",
              standing: SecurityCampaignAddressStanding.Blocked,
            },
            {
              typed: "b",
              value: "b",
              standing: SecurityCampaignAddressStanding.Blocked,
            },
            {
              typed: "c",
              value: "c",
              standing: SecurityCampaignAddressStanding.Protected,
            },
          ],
        },
        action: SecurityBlockAction.Block,
        translator: ENGLISH,
      }),
    ).toBe("Blocked 2 addresses. 1 was left out.");

    expect(
      Model.writeBlockedToast({
        outcome: {
          addresses: [
            {
              typed: "a",
              value: "a",
              standing: SecurityCampaignAddressStanding.Blocked,
            },
          ],
        },
        action: SecurityBlockAction.Challenge,
        translator: ENGLISH,
      }),
    ).toBe("Challenged 1 address.");
  });
});

describe("a network row", () => {
  test("names a few of its addresses and how many more it holds", () => {
    expect(
      Model.writeNetworkAddresses({ network: network(), translator: ENGLISH }),
    ).toBe("203.0.113.7, 203.0.113.9, 203.0.113.12 and 10 more");
    expect(
      Model.writeNetworkAddresses({
        network: network({
          addresses: ["203.0.113.7", "203.0.113.9"],
          addressCount: 2,
        }),
        translator: ENGLISH,
      }),
    ).toBe("203.0.113.7 and 203.0.113.9");
    expect(Model.writeNetworkAddressCount(network(), ENGLISH)).toBe(
      "13 addresses",
    );
  });

  test("an ASN's row names the ranges it sent from; a range's row does not", () => {
    expect(
      Model.writeNetworkRanges({ network: network(), translator: ENGLISH }),
    ).toBe("Sent from 2 ranges: 203.0.113.0/24 and 198.51.100.0/24");
    expect(
      Model.writeNetworkRanges({
        network: network({ kind: SecurityAttackNetworkKind.Range }),
        translator: ENGLISH,
      }),
    ).toBeNull();
  });

  test("offers Challenge This Network for an ASN or a range on the internet, never a private one or no network", () => {
    expect(Model.isNetworkChallengeable(network())).toBe(true);
    expect(
      Model.isNetworkChallengeable({
        network: "203.0.113.0/24",
        kind: SecurityAttackNetworkKind.Range,
      }),
    ).toBe(true);
    expect(
      Model.isNetworkChallengeable({
        network: "10.0.4.0/24",
        kind: SecurityAttackNetworkKind.Range,
      }),
    ).toBe(false);
    expect(Model.isNetworkChallengeable({ network: "", kind: "" })).toBe(false);
  });
});

describe("Challenge This Network", () => {
  test("an ASN's row may be challenged whole, or as one of its ranges", () => {
    expect(
      Model.getNetworkChallengeOptions({
        network: network(),
        translator: ENGLISH,
      }),
    ).toEqual([
      { value: "AS14061", label: "The whole network, AS14061" },
      {
        value: "203.0.113.0/24",
        label: "203.0.113.0/24 only, 10 of its addresses",
      },
      {
        value: "198.51.100.0/24",
        label: "198.51.100.0/24 only, 3 of its addresses",
      },
    ]);
  });

  test("a Security Admin starts on the whole ASN; anyone else on its largest range", () => {
    expect(
      Model.getDefaultNetworkChallengeValue({
        network: network(),
        isAdmin: true,
      }),
    ).toBe("AS14061");
    expect(
      Model.getDefaultNetworkChallengeValue({
        network: network(),
        isAdmin: false,
      }),
    ).toBe("203.0.113.0/24");
    expect(
      Model.getDefaultNetworkChallengeValue({
        network: network({
          network: "203.0.113.0/24",
          kind: SecurityAttackNetworkKind.Range,
        }),
        isAdmin: false,
      }),
    ).toBe("203.0.113.0/24");
  });

  test("says what it does, where and for how long", () => {
    expect(
      Model.writeNetworkChallengeDoes({
        check: networkCheck({}),
        duration: SecurityBlockDuration.OneDay,
        translator: ENGLISH,
      }),
    ).toBe(
      "Every request from 203.0.113.0/24 is asked to pass a challenge at Cloudflare for 24 hours. People pass it; scripts and API clients do not.",
    );
    expect(
      Model.writeNetworkChallengeDoes({
        check: networkCheck({ holders: [] }),
        duration: SecurityBlockDuration.OneDay,
        translator: ENGLISH,
      }),
    ).toBeNull();
  });

  test("a signed-in user's network is refused, naming who", () => {
    const words: ReturnType<ModelModule["describeNetworkCheck"]> =
      Model.describeNetworkCheck({
        check: networkCheck({
          standing: SecurityNetworkChallengeStanding.SignedIn,
          users: [
            { name: "bob@example.com", source: "Requests", lastSeenAt: null },
          ],
        }),
        translator: ENGLISH,
      });

    expect(words.tone).toBe(Model.NetworkCheckTone.Danger);
    expect(words.sentences).toEqual([
      "OneUptime will not challenge 203.0.113.0/24: bob@example.com signed in from it in the last 30 days.",
    ]);
  });

  test("a range wider than the largest takes a Security Admin, and an ASN does too", () => {
    expect(
      Model.describeNetworkCheck({
        check: networkCheck({
          value: "203.0.0.0/16",
          standing: SecurityNetworkChallengeStanding.NeedsSecurityAdmin,
        }),
        translator: ENGLISH,
      }).sentences[0],
    ).toContain("wider than a /24");
    expect(
      Model.describeNetworkCheck({
        check: networkCheck({
          value: "AS14061",
          kind: SecurityAttackNetworkKind.Asn,
          standing: SecurityNetworkChallengeStanding.NeedsSecurityAdmin,
        }),
        translator: ENGLISH,
      }).sentences[0],
    ).toContain("Only a Security Admin");
  });

  test("one OneUptime cannot check warns a Security Admin, and tells anyone else who can", () => {
    const admin: ReturnType<ModelModule["describeNetworkCheck"]> =
      Model.describeNetworkCheck({
        check: networkCheck({
          value: "AS14061",
          kind: SecurityAttackNetworkKind.Asn,
          standing: SecurityNetworkChallengeStanding.Unchecked,
          uncheckedReason: SecurityNetworkUncheckedReason.Asn,
          seenAddressCount: 13,
          isAdmin: true,
        }),
        translator: ENGLISH,
      });

    expect(admin.tone).toBe(Model.NetworkCheckTone.Warning);
    expect(admin.sentences).toEqual([
      "OneUptime cannot tell who uses AS14061: it knows only the 13 addresses it saw attack from it. Your own servers and your users may be in it too.",
    ]);

    const member: ReturnType<ModelModule["describeNetworkCheck"]> =
      Model.describeNetworkCheck({
        check: networkCheck({
          standing: SecurityNetworkChallengeStanding.Unchecked,
          uncheckedReason: SecurityNetworkUncheckedReason.SignedInCheck,
          uncheckedReasonText:
            "Your scrub rule Hide IPs hides client addresses in your traces.",
        }),
        translator: ENGLISH,
      });

    expect(member.tone).toBe(Model.NetworkCheckTone.Danger);
    expect(member.sentences).toEqual([
      "OneUptime cannot tell whether a signed-in user used 203.0.113.0/24.",
      "Only a Security Admin, a Project Admin or a Project Owner can challenge it anyway.",
    ]);
    expect(member.asWritten).toContain("Hide IPs");
  });

  test("nothing that challenges it says what to connect, for a range and for an ASN", () => {
    expect(
      Model.describeNetworkCheck({
        check: networkCheck({
          standing: SecurityNetworkChallengeStanding.NotHeld,
        }),
        translator: ENGLISH,
      }).sentences[0],
    ).toContain("connect AWS WAF");
    expect(
      Model.describeNetworkCheck({
        check: networkCheck({
          value: "AS14061",
          kind: SecurityAttackNetworkKind.Asn,
          standing: SecurityNetworkChallengeStanding.NotHeld,
        }),
        translator: ENGLISH,
      }).sentences[0],
    ).toContain("by its ASN");
  });

  test("one already challenged names what holds it; one free says nothing", () => {
    expect(
      Model.describeNetworkCheck({
        check: networkCheck({
          standing: SecurityNetworkChallengeStanding.AlreadyCovered,
          coveredBy: {
            value: "203.0.0.0/16",
            action: SecurityBlockAction.Challenge,
            expiresAt: null,
          },
        }),
        translator: ENGLISH,
      }).sentences,
    ).toEqual(["203.0.113.0/24 is already blocked: 203.0.0.0/16 covers it."]);
    expect(
      Model.describeNetworkCheck({
        check: networkCheck({}),
        translator: ENGLISH,
      }),
    ).toEqual({ tone: Model.NetworkCheckTone.None, sentences: [] });
  });
});

describe("a case's repeat-offender line", () => {
  const last: {
    createdAt: Date;
    action: SecurityBlockAction;
    value: string;
    securityCaseId: string | null;
    caseNumber: string | null;
  } = {
    createdAt: new Date("2026-11-12T12:00:00.000Z"),
    action: SecurityBlockAction.Block,
    value: "35.205.11.131",
    securityCaseId: "case-812",
    caseNumber: "CASE-812",
  };

  test("reads like the issue's example", () => {
    const line: string | null = Model.writeRepeatOffenderLine({
      summary: { value: "35.205.11.131", offenceCount: 2, last },
      translator: ENGLISH,
    });

    expect(line).toMatch(
      /^Blocked twice before, last on .+ \(case CASE-812\)\.$/,
    );
    expect(line).toContain("Nov");
  });

  test("once, three times, and a block made for no case", () => {
    expect(
      Model.writeRepeatOffenderLine({
        summary: { value: "35.205.11.131", offenceCount: 1, last },
        translator: ENGLISH,
      }),
    ).toMatch(/^Blocked once before, last on .+ \(case CASE-812\)\.$/);
    expect(
      Model.writeRepeatOffenderLine({
        summary: { value: "35.205.11.131", offenceCount: 3, last },
        translator: ENGLISH,
      }),
    ).toMatch(/^Blocked 3 times before, last on .+ \(case CASE-812\)\.$/);
    expect(
      Model.writeRepeatOffenderLine({
        summary: {
          value: "35.205.11.131",
          offenceCount: 2,
          last: { ...last, caseNumber: null, securityCaseId: null },
        },
        translator: ENGLISH,
      }),
    ).toMatch(/^Blocked twice before, last on [^(]+\.$/);
  });

  test("an address never blocked before has no line", () => {
    expect(
      Model.writeRepeatOffenderLine({
        summary: { value: "35.205.11.131", offenceCount: 0, last: null },
        translator: ENGLISH,
      }),
    ).toBeNull();
  });

  // ---------- Held as part of a network (#10895) ----------

  const challengedAsn: typeof last = {
    ...last,
    action: SecurityBlockAction.Challenge,
    value: "AS14061",
  };

  test("challenged once before as part of its whole network: reads like the issue's suggestion", () => {
    const line: string | null = Model.writeRepeatOffenderLine({
      summary: { value: "35.205.11.131", offenceCount: 1, last: challengedAsn },
      translator: ENGLISH,
    });

    expect(line).toMatch(
      /^Challenged once before as part of AS14061, on .+ \(case CASE-812\)\.$/,
    );
    expect(line).toContain("Nov");
  });

  test("challenged once as part of its network, by no case", () => {
    expect(
      Model.writeRepeatOffenderLine({
        summary: {
          value: "35.205.11.131",
          offenceCount: 1,
          last: { ...challengedAsn, caseNumber: null, securityCaseId: null },
        },
        translator: ENGLISH,
      }),
    ).toMatch(/^Challenged once before as part of AS14061, on [^(]+\.$/);
  });

  test("a network blocked rather than challenged says blocked", () => {
    expect(
      Model.writeRepeatOffenderLine({
        summary: {
          value: "35.205.11.131",
          offenceCount: 1,
          last: { ...challengedAsn, action: SecurityBlockAction.Block },
        },
        translator: ENGLISH,
      }),
    ).toMatch(
      /^Blocked once before as part of AS14061, on .+ \(case CASE-812\)\.$/,
    );
    expect(
      Model.writeRepeatOffenderLine({
        summary: {
          value: "35.205.11.131",
          offenceCount: 1,
          last: {
            ...challengedAsn,
            action: SecurityBlockAction.Block,
            caseNumber: null,
            securityCaseId: null,
          },
        },
        translator: ENGLISH,
      }),
    ).toMatch(/^Blocked once before as part of AS14061, on [^(]+\.$/);
  });

  test("more than once, the count stays the line's own, and the last is said as it was", () => {
    expect(
      Model.writeRepeatOffenderLine({
        summary: {
          value: "35.205.11.131",
          offenceCount: 2,
          last: challengedAsn,
        },
        translator: ENGLISH,
      }),
    ).toMatch(
      /^Blocked 2 times before, last challenged as part of AS14061 on .+ \(case CASE-812\)\.$/,
    );
    expect(
      Model.writeRepeatOffenderLine({
        summary: {
          value: "35.205.11.131",
          offenceCount: 4,
          last: { ...challengedAsn, caseNumber: null, securityCaseId: null },
        },
        translator: ENGLISH,
      }),
    ).toMatch(
      /^Blocked 4 times before, last challenged as part of AS14061 on [^(]+\.$/,
    );
    expect(
      Model.writeRepeatOffenderLine({
        summary: {
          value: "35.205.11.131",
          offenceCount: 3,
          last: { ...challengedAsn, action: SecurityBlockAction.Block },
        },
        translator: ENGLISH,
      }),
    ).toMatch(
      /^Blocked 3 times before, last as part of AS14061 on .+ \(case CASE-812\)\.$/,
    );
    expect(
      Model.writeRepeatOffenderLine({
        summary: {
          value: "35.205.11.131",
          offenceCount: 3,
          last: {
            ...challengedAsn,
            action: SecurityBlockAction.Block,
            caseNumber: null,
            securityCaseId: null,
          },
        },
        translator: ENGLISH,
      }),
    ).toMatch(/^Blocked 3 times before, last as part of AS14061 on [^(]+\.$/);
  });

  test("a range around the address that held it is named too", () => {
    expect(
      Model.writeRepeatOffenderLine({
        summary: {
          value: "35.205.11.131",
          offenceCount: 1,
          last: { ...challengedAsn, value: "35.205.11.0/24" },
        },
        translator: ENGLISH,
      }),
    ).toMatch(
      /^Challenged once before as part of 35\.205\.11\.0\/24, on .+ \(case CASE-812\)\.$/,
    );
  });

  test("a network's own record - Challenge This Network asking about AS14061 - names no network: it was the network itself", () => {
    expect(
      Model.writeRepeatOffenderLine({
        summary: { value: "AS14061", offenceCount: 1, last: challengedAsn },
        translator: ENGLISH,
      }),
    ).toMatch(/^Blocked once before, last on .+ \(case CASE-812\)\.$/);
  });

  test("Block the Whole Campaign's line says how many more addresses, and over how long", () => {
    expect(
      Model.writeCampaignOfAddressLine({
        count: 11,
        days: 7,
        translator: ENGLISH,
      }),
    ).toBe(
      "11 more addresses sent the same requests with the same tools over the last 7 days.",
    );
  });
});
