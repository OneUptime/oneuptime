import DataSecurityAiDecision from "../../../../../Models/DatabaseModels/DataSecurityAiDecision";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataSecurityAiDecisionService from "../../../../../Server/Services/DataSecurityAiDecisionService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import DataSecurityOwnerNotice, {
  getOwnerNoticeAnalysisLines,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityOwnerNotice";
import DataSecurityIntegrations, {
  OpenedIssueForIntegrations,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityIntegrations";
import * as DataSecurityJobs from "../../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import {
  DataSecurityAiVerdict,
  DataSecurityAnalysisFactSource,
  DataSecurityIssueAnalysisView,
} from "../../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import DataSecurityIssueStatus from "../../../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A STORE'S OWNERS' EMAIL, HELD FOR ONEUPTIME AI'S ANALYSIS (#10369): what
 * DataSecurityOwnerNotice.send does with a held notice, and the lines an
 * owner reads of an analysis. The whole way - the issue opening, the
 * analysis written, the email going with it - is
 * DataSecurityNewIssueAnalysis.test's; here are the edges: issues that are
 * no longer open, a store that is gone, a wait that cannot be queued.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10369100-0000-4000-8000-000000000001",
);
const STORE_ID: ObjectID = new ObjectID("10369100-0000-4000-8000-0000000000b1");
const FIRST: ObjectID = new ObjectID("10369100-0000-4000-8000-0000000000a1");
const SECOND: ObjectID = new ObjectID("10369100-0000-4000-8000-0000000000a2");
const OPENED_AT: Date = new Date("2026-11-20T10:00:00.000Z");
const LATER: Date = new Date("2026-11-20T10:01:00.000Z");

function notice(): DataSecurityJobs.HeldOwnerNotice {
  return {
    projectId: PROJECT_ID,
    dataStoreId: STORE_ID,
    issueIds: [FIRST, SECOND],
    openedAt: OPENED_AT,
    attempt: 1,
  };
}

function issueOf(id: ObjectID, title: string): DataSecurityIssue {
  return Object.assign(new DataSecurityIssue(), {
    id,
    title,
    checkId: "public-read",
    severity: SecuritySeverity.Critical,
    riskScore: 90,
    status: DataSecurityIssueStatus.Open,
    dataStoreId: STORE_ID,
  });
}

let openIssues: Array<DataSecurityIssue>;
let store: DataStore | null;
let isAiWorking: boolean;
let decided: Array<DataSecurityAiDecision>;
let isQueued: boolean;
let issueReads: SpyInstance<typeof DataSecurityIssueService.findBy>;
let queued: SpyInstance<typeof DataSecurityJobs.queueDataSecurityOwnerNotice>;
let notified: SpyInstance<typeof DataSecurityIntegrations.notifyOwners>;

beforeEach(() => {
  openIssues = [
    issueOf(FIRST, "Anyone on the internet can read it"),
    issueOf(SECOND, "Its data is not encrypted at rest"),
  ];
  store = Object.assign(new DataStore(), {
    id: STORE_ID,
    name: "customer-exports",
    storeKey: "cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports",
    sensitivity: DataSensitivity.Restricted,
  });
  isAiWorking = true;
  decided = [];
  isQueued = true;

  issueReads = jest
    .spyOn(DataSecurityIssueService, "findBy")
    .mockImplementation((async () => {
      return openIssues;
    }) as never);
  jest.spyOn(DataStoreService, "findOneBy").mockImplementation((async () => {
    return store;
  }) as never);
  jest
    .spyOn(DataSecurityIntegrations, "isAutomaticAiOn")
    .mockImplementation(async (): Promise<boolean> => {
      return isAiWorking;
    });
  jest
    .spyOn(DataSecurityAiDecisionService, "findBy")
    .mockImplementation((async () => {
      return decided;
    }) as never);
  queued = jest
    .spyOn(DataSecurityJobs, "queueDataSecurityOwnerNotice")
    .mockImplementation(async (): Promise<boolean> => {
      return isQueued;
    });
  notified = jest
    .spyOn(DataSecurityIntegrations, "notifyOwners")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The issues the email was sent about, by title.
function sentAbout(): Array<string> {
  return (notified.mock.calls[0]![1] as Array<OpenedIssueForIntegrations>).map(
    (issue: OpenedIssueForIntegrations): string => {
      return issue.title;
    },
  );
}

function decisionOn(issueId: ObjectID): DataSecurityAiDecision {
  return Object.assign(new DataSecurityAiDecision(), {
    id: ObjectID.generate(),
    dataSecurityIssueId: issueId,
  });
}

describe("a held owners' email", () => {
  test("is about the issues still open, read by their ids on its store", async () => {
    decided = [decisionOn(FIRST), decisionOn(SECOND)];

    expect(await DataSecurityOwnerNotice.send(notice(), LATER)).toBe("sent");

    const query: JSONObject = issueReads.mock.calls[0]![0].query as JSONObject;

    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(query["dataStoreId"]).toEqual(STORE_ID);
    expect(query["status"]).toBe(DataSecurityIssueStatus.Open);
    expect((query["_id"] as Includes).values).toEqual([FIRST, SECOND]);
    expect(sentAbout()).toEqual([
      "Anyone on the internet can read it",
      "Its data is not encrypted at rest",
    ]);
  });

  test("leaves out an issue no longer open: it is no longer news", async () => {
    openIssues = [issueOf(SECOND, "Its data is not encrypted at rest")];
    decided = [decisionOn(SECOND)];

    expect(await DataSecurityOwnerNotice.send(notice(), LATER)).toBe("sent");
    expect(sentAbout()).toEqual(["Its data is not encrypted at rest"]);
  });

  test("with none of its issues still open, is not sent at all", async () => {
    openIssues = [];

    expect(await DataSecurityOwnerNotice.send(notice(), LATER)).toBe("nothing");
    expect(notified).not.toHaveBeenCalled();
    expect(queued).not.toHaveBeenCalled();
  });

  test("for a store that is gone, is not sent", async () => {
    decided = [decisionOn(FIRST), decisionOn(SECOND)];
    store = null;

    expect(await DataSecurityOwnerNotice.send(notice(), LATER)).toBe("nothing");
    expect(notified).not.toHaveBeenCalled();
  });

  test("waits again while OneUptime AI's work on any of its issues is still to come", async () => {
    decided = [decisionOn(FIRST)];

    expect(await DataSecurityOwnerNotice.send(notice(), LATER)).toBe("waiting");
    expect(queued.mock.calls[0]![0]).toEqual({ ...notice(), attempt: 2 });
    expect(notified).not.toHaveBeenCalled();
  });

  test("goes now when the wait cannot be queued, rather than not at all", async () => {
    isQueued = false;

    expect(await DataSecurityOwnerNotice.send(notice(), LATER)).toBe("sent");
    expect(sentAbout()).toHaveLength(2);
  });

  test("carries each owner's analysis lines while OneUptime AI works on new issues, and none with it off", async () => {
    decided = [decisionOn(FIRST), decisionOn(SECOND)];

    expect(await DataSecurityOwnerNotice.send(notice(), LATER)).toBe("sent");
    expect(notified.mock.calls[0]![2]).toBe(true);
    expect(typeof notified.mock.calls[0]![3]).toBe("function");

    notified.mockClear();
    isAiWorking = false;

    expect(await DataSecurityOwnerNotice.send(notice(), LATER)).toBe("sent");
    expect(notified.mock.calls[0]![2]).toBe(false);
    expect(notified.mock.calls[0]![3]).toBeUndefined();
    // With AI off, nothing is waited for.
    expect(queued).not.toHaveBeenCalled();
  });
});

describe("what an owner reads of an issue's analysis", () => {
  function view(
    overrides: Partial<DataSecurityIssueAnalysisView> = {},
  ): DataSecurityIssueAnalysisView {
    return {
      verdict: DataSecurityAiVerdict.Real,
      language: "en",
      lines: {
        reason: {
          text: "Anyone on the internet can read its card numbers.",
          facts: ["S1"],
        },
        path: { text: "Block public access from its page.", facts: ["A1"] },
      },
      hiddenLines: {},
      facts: [],
      ...overrides,
    };
  }

  test("the verdict with why, and the shortest path", () => {
    expect(
      getOwnerNoticeAnalysisLines(view()).map((line: unknown): string => {
        return String(line);
      }),
    ).toEqual([
      "OneUptime AI: **Real**. Anyone on the internet can read its card numbers.",
      "Shortest path to fixed: Block public access from its page.",
    ]);
  });

  test("the verdict alone, when why rests on what the owner may not read, and no path they may not read", () => {
    expect(
      getOwnerNoticeAnalysisLines(
        view({
          lines: {},
          hiddenLines: {
            reason: [DataSecurityAnalysisFactSource.Access],
            path: [DataSecurityAnalysisFactSource.Access],
          },
        }),
      ).map((line: unknown): string => {
        return String(line);
      }),
    ).toEqual(["OneUptime AI: **Real**."]);
  });

  test("OneUptime AI's words go in as text, never as Markdown", () => {
    const lines: Array<string> = getOwnerNoticeAnalysisLines(
      view({
        verdict: DataSecurityAiVerdict.LikelyByDesign,
        lines: {
          reason: {
            text: "It serves the **website's** images [see](https://evil.example).",
            facts: ["S1"],
          },
        },
      }),
    ).map((line: unknown): string => {
      return String(line);
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("OneUptime AI: **Likely by design**.");
    expect(lines[0]).not.toContain("**website's**");
    expect(lines[0]).not.toContain("[see](https://evil.example)");
  });
});
