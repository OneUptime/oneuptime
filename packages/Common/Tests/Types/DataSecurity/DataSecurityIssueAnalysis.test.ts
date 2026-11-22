import {
  DATA_SECURITY_ANALYSIS_LIMITS,
  DataSecurityAiVerdict,
  DataSecurityAnalysisFact,
  DataSecurityAnalysisFactKind,
  DataSecurityAnalysisFactSource,
  DataSecurityAnalysisPart,
  DataSecurityGrantsRemovedByFix,
  DataSecurityIssueAnalysisRecord,
  DataSecurityIssueAnalysisView,
  DataSecurityRecency,
  findAnalysisFact,
  getAnalysisFactMentions,
  getAnalysisInputHash,
  getAnalysisView,
  getDataSecurityRecency,
  getGrantsTheFixRemoves,
  getLineFacts,
  holdAnalysisToFacts,
  isGrantRemovedByFix,
  isRecentDataSecurityRecency,
  readDataSecurityIssueAnalysis,
  readDataSecurityIssueAnalysisView,
  roundDataSecurityCount,
  toDataSecurityIssueAnalysisJson,
} from "../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import { describe, expect, test } from "@jest/globals";

/*
 * ONEUPTIME AI'S ANALYSIS OF AN ISSUE, HELD TO ITS FACTS (#10369).
 *
 * The analysis's pure rules, the server's and the Dashboard's alike: a
 * line that names no fact it was given is dropped, a line that names a
 * fact's store, identity, service or repository rests on that fact too, a
 * verdict needs a reason that rests on one, a store of Restricted data is
 * never "Likely by design" on OneUptime AI's word, and a reader sees only
 * the lines whose facts they may read. Kept for what it was written from:
 * recency in buckets, counts rounded, so time passing changes no hash.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;

function facts(): Array<DataSecurityAnalysisFact> {
  return [
    {
      id: "I1",
      kind: DataSecurityAnalysisFactKind.Issue,
      recordIds: ["issue-1"],
      checkId: "public-read",
      severity: "Critical",
    },
    {
      id: "S1",
      kind: DataSecurityAnalysisFactKind.StoreHolds,
      recordIds: ["store-1"],
      dataTypeIds: ["credit-card-number"],
      dataTypeNames: ["Card number"],
      sensitivity: "Restricted",
      records: 12000,
    },
    {
      id: "S2",
      kind: DataSecurityAnalysisFactKind.StoreExposure,
      recordIds: ["store-1"],
      exposure: "Public",
      isPublicByDesign: false,
    },
    {
      id: "R0",
      kind: DataSecurityAnalysisFactKind.Reach,
      recordIds: [],
      identities: 2,
      publicGrants: 1,
      externalGrants: 0,
      writeGrants: 0,
      usedLately: 1,
    },
    {
      id: "R1",
      kind: DataSecurityAnalysisFactKind.Grant,
      recordIds: ["access-1"],
      principal: "Everyone",
      principalType: "Public",
      accessLevel: "Read",
      grantedVia: "Bucket policy",
      isPublic: true,
      isExternal: true,
      lastUsed: DataSecurityRecency.Unknown,
      isRemovedByFix: true,
    },
    {
      id: "R2",
      kind: DataSecurityAnalysisFactKind.Grant,
      recordIds: ["access-2"],
      principal: "cloudfront.amazonaws.com",
      principalType: "Service",
      accessLevel: "Read",
      grantedVia: "Bucket policy: AllowCloudFrontServicePrincipal",
      isPublic: false,
      isExternal: false,
      lastUsed: DataSecurityRecency.Day,
      isRemovedByFix: false,
    },
    {
      id: "A1",
      kind: DataSecurityAnalysisFactKind.Response,
      recordIds: ["store-1"],
      action: "Block public access",
      isAvailable: true,
    },
    {
      id: "D1",
      kind: DataSecurityAnalysisFactKind.DeclaredCode,
      recordIds: ["repo-1"],
      repositoryId: "repo-1",
      repositoryName: "acme/infrastructure",
      paths: ["storage/site-images.tf"],
      codeKind: "Terraform",
      reason: "has-named-file",
    },
    {
      id: "O0",
      kind: DataSecurityAnalysisFactKind.NoOwner,
      recordIds: [],
    },
  ];
}

function hold(
  verdict: string,
  lines: Partial<
    Record<DataSecurityAnalysisPart, { text: string; facts: Array<string> }>
  >,
  given: Array<DataSecurityAnalysisFact> = facts(),
): DataSecurityIssueAnalysisRecord | null {
  return holdAnalysisToFacts({
    answer: { verdict, lines },
    facts: given,
    language: "en",
  });
}

describe("an answer is held to its facts", () => {
  test("a line keeps only the ids of facts it was given, in upper case", () => {
    const record: DataSecurityIssueAnalysisRecord | null = hold("Real", {
      reason: {
        text: "Anyone on the internet can read the card numbers.",
        facts: ["s2", "S1", "Z9", "S1"],
      },
    });

    expect(record?.verdict).toBe(DataSecurityAiVerdict.Real);
    expect(record?.lines.reason?.facts).toEqual(["S2", "S1"]);
  });

  test("a line that names no fact it was given is dropped", () => {
    const record: DataSecurityIssueAnalysisRecord | null = hold("Real", {
      reason: { text: "The bucket holds card numbers.", facts: ["S1"] },
      risk: { text: "Every card number could leak tonight.", facts: [] },
      breaks: { text: "Nothing at all would break here.", facts: ["Q7"] },
    });

    expect(record?.lines.risk).toBeUndefined();
    expect(record?.lines.breaks).toBeUndefined();
    expect(record?.lines.reason).toBeDefined();
  });

  test("a line that says too little is dropped", () => {
    expect(
      hold("Real", {
        reason: { text: "The bucket is public.", facts: ["S2"] },
        risk: { text: "Bad.", facts: ["S1"] },
      })?.lines.risk,
    ).toBeUndefined();
  });

  test("a line that names a grant's identity, a repository or a file rests on that fact too", () => {
    const record: DataSecurityIssueAnalysisRecord | null = hold("Real", {
      reason: { text: "The bucket is public.", facts: ["S2"] },
      breaks: {
        text: "Blocking public access leaves cloudfront.amazonaws.com reading it.",
        facts: ["R1"],
      },
      path: {
        text: "Block public access, then fix storage/site-images.tf.",
        facts: ["A1"],
      },
    });

    expect(record?.lines.breaks?.facts).toEqual(["R1", "R2"]);
    expect(record?.lines.path?.facts).toEqual(["A1", "D1"]);
  });

  test("fact ids written into the text are taken out; a product name that looks like one stays", () => {
    const record: DataSecurityIssueAnalysisRecord | null = hold("Real", {
      reason: {
        text: "The S3 bucket is public (S2) and holds card numbers [S1, I1].",
        facts: ["S2", "S1"],
      },
    });

    expect(record?.lines.reason?.text).toBe(
      "The S3 bucket is public and holds card numbers.",
    );
  });

  test("a long line is cut to its length", () => {
    const record: DataSecurityIssueAnalysisRecord | null = hold("Real", {
      reason: { text: "x".repeat(2000), facts: ["S1"] },
    });

    expect(Array.from(record!.lines.reason!.text).length).toBe(
      DATA_SECURITY_ANALYSIS_LIMITS.maxLineLength,
    );
    expect(record!.lines.reason!.text.endsWith("…")).toBe(true);
  });

  test("a verdict that is not one of the four is no answer", () => {
    expect(
      hold("Probably fine", {
        reason: { text: "It is fine, trust me.", facts: ["S1"] },
      }),
    ).toBeNull();
  });

  test("a verdict with no reason resting on a fact is Cannot tell", () => {
    expect(
      hold("Real", {
        reason: { text: "It is real because I say so.", facts: [] },
      })?.verdict,
    ).toBe(DataSecurityAiVerdict.CannotTell);
  });

  test("a store of Restricted data is never likely by design on OneUptime AI's word", () => {
    const record: DataSecurityIssueAnalysisRecord | null = hold(
      "LikelyByDesign",
      {
        reason: { text: "It serves a public website's files.", facts: ["S2"] },
        draft: { text: "The bucket serves the website.", facts: ["S2"] },
      },
    );

    expect(record?.verdict).toBe(DataSecurityAiVerdict.CannotTell);
    expect(record?.lines.reason).toBeUndefined();
    expect(record?.lines.draft).toBeUndefined();
  });

  test("a store of public data can be likely by design, with the reason a person could give", () => {
    const publicStore: Array<DataSecurityAnalysisFact> = facts().map(
      (fact: DataSecurityAnalysisFact): DataSecurityAnalysisFact => {
        return fact.kind === DataSecurityAnalysisFactKind.StoreHolds
          ? { ...fact, sensitivity: "Public", dataTypeIds: [] }
          : fact;
      },
    );
    const record: DataSecurityIssueAnalysisRecord | null = hold(
      "LikelyByDesign",
      {
        reason: { text: "It holds the website's images.", facts: ["S1"] },
        draft: { text: "The bucket serves public images.", facts: ["S1"] },
      },
      publicStore,
    );

    expect(record?.verdict).toBe(DataSecurityAiVerdict.LikelyByDesign);
    expect(record?.lines.draft?.text).toBe("The bucket serves public images.");
  });

  test("a reason a person could give is kept only for by design and a wrong finding", () => {
    expect(
      hold("Real", {
        reason: { text: "Anyone can read the card numbers.", facts: ["S2"] },
        draft: { text: "Accept it, it is fine.", facts: ["S2"] },
      })?.lines.draft,
    ).toBeUndefined();
  });

  test("the record keeps every fact, whatever the lines cite", () => {
    const record: DataSecurityIssueAnalysisRecord | null = hold(
      "CannotTell",
      {},
    );

    expect(record?.verdict).toBe(DataSecurityAiVerdict.CannotTell);
    expect(record?.facts.length).toBe(facts().length);
  });
});

describe("what a reader may read", () => {
  function analysis(): DataSecurityIssueAnalysisRecord {
    return hold("Real", {
      reason: { text: "Anyone can read the card numbers.", facts: ["S2"] },
      risk: {
        text: "About 12,000 card numbers, for anyone.",
        facts: ["S1", "R0"],
      },
      breaks: {
        text: "Blocking public access leaves cloudfront.amazonaws.com reading it.",
        facts: ["R1"],
      },
      path: { text: "Block public access now.", facts: ["A1"] },
    })!;
  }

  test("a reader of everything reads every line and fact", () => {
    const record: DataSecurityIssueAnalysisRecord = analysis();
    const view: DataSecurityIssueAnalysisView = getAnalysisView({
      record,
      readableFactIds: new Set(
        record.facts.map((fact: DataSecurityAnalysisFact) => {
          return fact.id;
        }),
      ),
      analyzedAt: NOW,
    });

    expect(Object.keys(view.lines).sort()).toEqual(
      ["breaks", "path", "reason", "risk"].sort(),
    );
    expect(view.hiddenLines).toEqual({});
    expect(view.analyzedAt).toBe(NOW.toISOString());
  });

  test("a reader who may not read who can reach the store reads no line resting on it, and no access fact", () => {
    const record: DataSecurityIssueAnalysisRecord = analysis();
    const view: DataSecurityIssueAnalysisView = getAnalysisView({
      record,
      readableFactIds: new Set(["I1", "S1", "S2", "A1", "D1", "O0"]),
    });

    expect(view.lines.risk).toBeUndefined();
    expect(view.lines.breaks).toBeUndefined();
    expect(view.hiddenLines.risk).toEqual([
      DataSecurityAnalysisFactSource.Access,
    ]);
    expect(view.hiddenLines.breaks).toEqual([
      DataSecurityAnalysisFactSource.Access,
    ]);
    expect(view.lines.reason?.text).toBe("Anyone can read the card numbers.");
    expect(
      view.facts.some((fact: DataSecurityAnalysisFact): boolean => {
        return fact.kind === DataSecurityAnalysisFactKind.Grant;
      }),
    ).toBe(false);
    expect(JSON.stringify(view)).not.toContain("cloudfront");
  });

  test("a line's facts are the readable ones it names, in its order", () => {
    const record: DataSecurityIssueAnalysisRecord = analysis();
    const view: DataSecurityIssueAnalysisView = getAnalysisView({
      record,
      readableFactIds: new Set(["S1", "R0", "S2"]),
    });

    expect(
      getLineFacts(view, view.lines.risk!).map(
        (fact: DataSecurityAnalysisFact) => {
          return fact.id;
        },
      ),
    ).toEqual(["S1", "R0"]);
    expect(
      findAnalysisFact(view, DataSecurityAnalysisFactKind.Reach)?.identities,
    ).toBe(2);
  });

  test("the view the server sends reads back as it was sent, and a hidden line stays hidden", () => {
    const record: DataSecurityIssueAnalysisRecord = analysis();
    const view: DataSecurityIssueAnalysisView = getAnalysisView({
      record,
      readableFactIds: new Set(["I1", "S1", "S2", "A1"]),
      analyzedAt: NOW,
    });
    const read: DataSecurityIssueAnalysisView | null =
      readDataSecurityIssueAnalysisView(JSON.parse(JSON.stringify(view)));

    expect(read).toEqual(view);
  });
});

describe("what the issue keeps, read defensively", () => {
  test("a kept analysis reads back as it was kept", () => {
    const record: DataSecurityIssueAnalysisRecord = hold("Real", {
      reason: { text: "Anyone can read the card numbers.", facts: ["S2"] },
    })!;

    expect(
      readDataSecurityIssueAnalysis(toDataSecurityIssueAnalysisJson(record)),
    ).toEqual(record);
  });

  test("no analysis, or one of a verdict this build does not know, reads as none", () => {
    expect(readDataSecurityIssueAnalysis(null)).toBeNull();
    expect(readDataSecurityIssueAnalysis("Real")).toBeNull();
    expect(
      readDataSecurityIssueAnalysis({ verdict: "Maybe", lines: {}, facts: [] }),
    ).toBeNull();
  });

  test("a fact of a kind this build does not know is left out, and a line resting only on it with it", () => {
    const read: DataSecurityIssueAnalysisRecord | null =
      readDataSecurityIssueAnalysis({
        version: 1,
        verdict: "Real",
        language: "de",
        facts: [
          {
            id: "S1",
            kind: "StoreHolds",
            recordIds: ["s"],
            sensitivity: "Public",
          },
          { id: "Z1", kind: "SomethingNew", recordIds: [] },
        ],
        lines: {
          reason: { text: "Rests on what we know.", facts: ["S1"] },
          risk: { text: "Rests on what we do not know.", facts: ["Z1"] },
        },
      });

    expect(read?.language).toBe("de");
    expect(
      read?.facts.map((fact: DataSecurityAnalysisFact) => {
        return fact.id;
      }),
    ).toEqual(["S1"]);
    expect(read?.lines.reason).toBeDefined();
    expect(read?.lines.risk).toBeUndefined();
  });
});

describe("the names a line can say", () => {
  test("a grant's identity, a repository and its files, an owner; never a short word", () => {
    const all: Array<DataSecurityAnalysisFact> = facts();

    expect(
      getAnalysisFactMentions(
        all.find((fact: DataSecurityAnalysisFact) => {
          return fact.id === "R2";
        })!,
      ),
    ).toEqual(["cloudfront.amazonaws.com"]);
    expect(
      getAnalysisFactMentions(
        all.find((fact: DataSecurityAnalysisFact) => {
          return fact.id === "D1";
        })!,
      ),
    ).toEqual(["acme/infrastructure", "storage/site-images.tf"]);
    expect(
      getAnalysisFactMentions({
        id: "U1",
        kind: DataSecurityAnalysisFactKind.ServiceUse,
        recordIds: [],
        serviceName: "api",
        lastSeen: DataSecurityRecency.Day,
      }),
    ).toEqual([]);
  });
});

describe("recency, in buckets", () => {
  test("each bucket, and the 90 days access reviews look back over", () => {
    const at: (days: number) => Date = (days: number): Date => {
      return new Date(NOW.getTime() - days * DAY);
    };

    expect(getDataSecurityRecency({ at: at(0.5), now: NOW })).toBe(
      DataSecurityRecency.Day,
    );
    expect(getDataSecurityRecency({ at: at(5), now: NOW })).toBe(
      DataSecurityRecency.Week,
    );
    expect(getDataSecurityRecency({ at: at(20), now: NOW })).toBe(
      DataSecurityRecency.Month,
    );
    expect(getDataSecurityRecency({ at: at(80), now: NOW })).toBe(
      DataSecurityRecency.Quarter,
    );
    expect(getDataSecurityRecency({ at: at(200), now: NOW })).toBe(
      DataSecurityRecency.Older,
    );
    expect(getDataSecurityRecency({ at: null, now: NOW })).toBe(
      DataSecurityRecency.Unknown,
    );
    expect(
      getDataSecurityRecency({ at: null, now: NOW, hasNoRecordedUse: true }),
    ).toBe(DataSecurityRecency.Never);
    expect(isRecentDataSecurityRecency(DataSecurityRecency.Quarter)).toBe(true);
    expect(isRecentDataSecurityRecency(DataSecurityRecency.Older)).toBe(false);
    expect(isRecentDataSecurityRecency(DataSecurityRecency.Unknown)).toBe(
      false,
    );
  });
});

describe("about how many", () => {
  test("exact below a hundred, else two significant digits", () => {
    expect(roundDataSecurityCount(7)).toBe(7);
    expect(roundDataSecurityCount(99)).toBe(99);
    expect(roundDataSecurityCount(12_345)).toBe(12_000);
    expect(roundDataSecurityCount(12_401)).toBe(12_000);
    expect(roundDataSecurityCount(987_654)).toBe(990_000);
    expect(roundDataSecurityCount(undefined)).toBeUndefined();
    expect(roundDataSecurityCount(-1)).toBeUndefined();
  });
});

describe("the grants a check's fix removes", () => {
  test("blocking public access removes the public grants, never a service's own", () => {
    expect(getGrantsTheFixRemoves("public-read")).toBe(
      DataSecurityGrantsRemovedByFix.Public,
    );
    expect(isGrantRemovedByFix("public-read", { isPublic: true })).toBe(true);
    expect(
      isGrantRemovedByFix("public-read", { isPublic: false, isExternal: true }),
    ).toBe(false);
  });

  test("revoking sharing removes public and outside grants; object ACLs the ACL grants; unused access the unused", () => {
    expect(
      isGrantRemovedByFix("snapshot-shared-externally", { isExternal: true }),
    ).toBe(true);
    expect(
      isGrantRemovedByFix("object-acls-enabled", { grantedVia: "Object ACL" }),
    ).toBe(true);
    expect(
      isGrantRemovedByFix("object-acls-enabled", {
        grantedVia: "Bucket policy",
      }),
    ).toBe(false);
    expect(isGrantRemovedByFix("unused-access", { isUnused: true })).toBe(true);
    expect(
      isGrantRemovedByFix("not-encrypted-at-rest", { isPublic: true }),
    ).toBe(false);
    expect(getGrantsTheFixRemoves(undefined)).toBeNull();
  });
});

describe("the input's hash", () => {
  test("the same data hashes the same, whatever order its keys come in", () => {
    expect(
      getAnalysisInputHash({ data: { a: 1, b: [2, 3] }, language: "en" }),
    ).toBe(getAnalysisInputHash({ data: { b: [2, 3], a: 1 }, language: "en" }));
  });

  test("a change of data, of language or of what is asked hashes differently", () => {
    const base: string = getAnalysisInputHash({
      data: { evidence: "Public" },
      language: "en",
    });

    expect(
      getAnalysisInputHash({ data: { evidence: "Private" }, language: "en" }),
    ).not.toBe(base);
    expect(
      getAnalysisInputHash({ data: { evidence: "Public" }, language: "de" }),
    ).not.toBe(base);
    expect(
      getAnalysisInputHash({
        data: { evidence: "Public" },
        language: "en",
        version: 99,
      }),
    ).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});
