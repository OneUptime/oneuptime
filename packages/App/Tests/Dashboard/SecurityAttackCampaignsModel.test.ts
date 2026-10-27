import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  SecurityAttackCampaign,
  getCampaignGotThroughCount,
  getCampaignNotFollowedCount,
  outcomeFromRank,
  readSecurityAttackCampaign,
} from "Common/Types/SecurityEvent/SecurityAttackCampaign";
import SecurityEventRequestOutcome from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import type * as ModelModuleType from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityAttackCampaignsModel";

/*
 * The Campaigns page: every address that sent attack requests, as one row,
 * with how far its requests got. Pinned here: the windows, what a campaign
 * row says, the bar of its outcomes, the page's totals and the links to a
 * campaign's requests and to its address in Correlate.
 */

type ModelModule = typeof ModelModuleType;

let Model: ModelModule;

const ENGLISH: Translator = createTranslator(undefined, "en");
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");

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
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityAttackCampaignsModel"
  );
});

function campaign(
  overrides: Partial<SecurityAttackCampaign> = {},
): SecurityAttackCampaign {
  return {
    sourceIp: "198.51.100.23",
    requestCount: 96,
    rejectedCount: 96,
    reachedAppCount: 0,
    erroredCount: 0,
    reachedDatabaseCount: 0,
    worstOutcome: SecurityEventRequestOutcome.Rejected,
    maxSeverityId: 2,
    attackKinds: ["sql-injection", "path-traversal"],
    userAgents: ["Mozilla/5.0 (scanner)"],
    targetCount: 40,
    sampleTargets: ["/sitemap.xml?offset=1;SELECT", "/wp-admin/admin-ajax.php"],
    firstSeen: "2026-10-27T05:25:00.000Z",
    lastSeen: "2026-10-27T06:45:00.000Z",
    ...overrides,
  };
}

function queryOf(route: { toString(): string }): URLSearchParams {
  const value: string = route.toString();

  return new URLSearchParams(value.slice(value.indexOf("?") + 1));
}

describe("SecurityAttackCampaign", () => {
  test("reads a row of the grouped query", () => {
    const read: SecurityAttackCampaign = readSecurityAttackCampaign({
      sourceIp: "198.51.100.23",
      requestCount: "96",
      rejectedCount: "90",
      reachedAppCount: "4",
      erroredCount: "1",
      reachedDatabaseCount: "1",
      worstOutcomeRank: 4,
      maxSeverityId: 5,
      attackKinds: ["sql-injection", ""],
      userAgents: ["", "sqlmap"],
      targetCount: "12",
      sampleTargets: ["/a", "/b"],
      firstSeen: "2026-10-27T05:25:00.000Z",
      lastSeen: "2026-10-27T06:45:00.000Z",
    });

    expect(read.requestCount).toBe(96);
    expect(read.worstOutcome).toBe(SecurityEventRequestOutcome.ReachedDatabase);
    // Events that carried no kind or no user agent add no empty chips.
    expect(read.attackKinds).toEqual(["sql-injection"]);
    expect(read.userAgents).toEqual(["sqlmap"]);
    expect(getCampaignGotThroughCount(read)).toBe(6);
    expect(getCampaignNotFollowedCount(read)).toBe(0);
  });

  test("a campaign nobody followed has no worst outcome, and every request unfollowed", () => {
    const read: SecurityAttackCampaign = readSecurityAttackCampaign({
      sourceIp: "",
      requestCount: 5,
      worstOutcomeRank: 0,
    });

    expect(read.worstOutcome).toBe("");
    expect(getCampaignNotFollowedCount(read)).toBe(5);
  });

  test("ranks name the outcomes in order", () => {
    expect(outcomeFromRank(0)).toBe("");
    expect(outcomeFromRank(1)).toBe(SecurityEventRequestOutcome.Rejected);
    expect(outcomeFromRank(4)).toBe(
      SecurityEventRequestOutcome.ReachedDatabase,
    );
    expect(outcomeFromRank(9)).toBe("");
  });
});

describe("the windows", () => {
  test("default to the last seven days, ending now", () => {
    const range: { startTime: Date; endTime: Date } =
      Model.getCampaignWindowRange(Model.DEFAULT_CAMPAIGN_WINDOW, NOW);

    expect(range.endTime).toBe(NOW);
    expect(NOW.getTime() - range.startTime.getTime()).toBe(
      7 * 24 * 3600 * 1000,
    );
  });

  test("each window reads as far back as it says", () => {
    expect(
      NOW.getTime() -
        Model.getCampaignWindowRange(
          Model.CampaignWindow.Day,
          NOW,
        ).startTime.getTime(),
    ).toBe(24 * 3600 * 1000);
    expect(
      NOW.getTime() -
        Model.getCampaignWindowRange(
          Model.CampaignWindow.Month,
          NOW,
        ).startTime.getTime(),
    ).toBe(30 * 24 * 3600 * 1000);
  });
});

describe("what a campaign row says", () => {
  test("every request turned away", () => {
    expect(Model.describeCampaignResult(campaign(), ENGLISH)).toBe(
      "Every request was turned away",
    );
  });

  test("how many got through, when any did", () => {
    expect(
      Model.describeCampaignResult(
        campaign({ rejectedCount: 94, reachedAppCount: 1, erroredCount: 1 }),
        ENGLISH,
      ),
    ).toBe("2 requests got through");
    expect(
      Model.describeCampaignResult(
        campaign({ rejectedCount: 95, reachedDatabaseCount: 1 }),
        ENGLISH,
      ),
    ).toBe("1 request got through");
  });

  test("none of the followed ones got through, when some were not followed", () => {
    expect(
      Model.describeCampaignResult(campaign({ rejectedCount: 40 }), ENGLISH),
    ).toBe("None of the requests OneUptime followed got through");
  });

  test("not followed at all", () => {
    expect(
      Model.describeCampaignResult(
        campaign({ rejectedCount: 0, worstOutcome: "" }),
        ENGLISH,
      ),
    ).toBe("Not followed: these requests carry no trace");
  });

  test("names its attack kinds plainly, and an unknown kind as it is", () => {
    expect(Model.getCampaignAttackKindLabel("sql-injection")).toBe(
      "SQL injection",
    );
    expect(Model.getCampaignAttackKindLabel("path-traversal")).toBe(
      "Path traversal",
    );
    expect(Model.getCampaignAttackKindLabel("log4shell")).toBe("Log4Shell");
    expect(Model.getCampaignAttackKindLabel("xss")).toBe("xss");
  });
});

describe("the bar of how far its requests got", () => {
  test("worst first, and only what happened", () => {
    const segments: Array<{ key: string; count: number }> =
      Model.getCampaignOutcomeSegments(
        campaign({
          requestCount: 100,
          rejectedCount: 90,
          reachedAppCount: 5,
          reachedDatabaseCount: 1,
        }),
      );

    expect(
      segments.map((segment: { key: string; count: number }): string => {
        return `${segment.key}:${segment.count}`;
      }),
    ).toEqual([
      "Reached Database:1",
      "Reached App:5",
      "Rejected:90",
      "not-followed:4",
    ]);
  });
});

describe("the page's totals", () => {
  test("add up its campaigns", () => {
    expect(
      Model.summarizeCampaigns([
        campaign(),
        campaign({
          sourceIp: "203.0.113.9",
          requestCount: 4,
          rejectedCount: 2,
          erroredCount: 2,
        }),
      ]),
    ).toEqual({ attackers: 2, requests: 100, gotThrough: 2 });
    expect(Model.summarizeCampaigns([])).toEqual({
      attackers: 0,
      requests: 0,
      gotThrough: 0,
    });
  });
});

describe("the links", () => {
  const startTime: Date = new Date("2026-10-20T12:00:00.000Z");

  test("a campaign's requests are its address's web attacks over the window", () => {
    const query: URLSearchParams = queryOf(
      Model.buildCampaignEventsRoute({
        campaign: campaign(),
        startTime,
        endTime: NOW,
      }),
    );

    expect(JSON.parse(query.get("filters")!)).toEqual([
      ["className", "HTTP Activity"],
      ["principalIp", "198.51.100.23"],
    ]);
    expect(query.get("start")).toBe(startTime.toISOString());
    expect(query.get("end")).toBe(NOW.toISOString());
  });

  test("a campaign from an unknown address opens every web attack of the window", () => {
    expect(
      JSON.parse(
        queryOf(
          Model.buildCampaignEventsRoute({
            campaign: campaign({ sourceIp: "" }),
            startTime,
            endTime: NOW,
          }),
        ).get("filters")!,
      ),
    ).toEqual([["className", "HTTP Activity"]]);
  });

  test("Correlate opens on the address, and not for an unknown one", () => {
    const route: ReturnType<typeof Model.buildCampaignCorrelateRoute> =
      Model.buildCampaignCorrelateRoute(campaign());

    expect(route!.toString().split("?")[0]).toContain(
      "/security-events/correlate",
    );
    expect(queryOf(route!).get("observable")).toBe("198.51.100.23");
    expect(
      Model.buildCampaignCorrelateRoute(campaign({ sourceIp: "" })),
    ).toBeNull();
  });
});
