import {
  DataStoreOwnerCandidate,
  DataStoreOwnerConfidence,
  DataStoreOwnerEvidence,
  DataStoreOwnerEvidenceSource,
  DataStoreOwnerKind,
  MAX_DATA_STORE_OWNER_REASON_LENGTH,
  MAX_PROPOSED_DATA_STORE_OWNERS,
} from "../../../Types/DataSecurity/DataStoreOwnerProposal";
import {
  DataStoreOwnerAnswer,
  HeldDataStoreOwnerAnswer,
  holdDataStoreOwnerAnswerToEvidence,
  writeOwnerSentence,
} from "../../../Utils/DataSecurity/DataStoreOwnerAnswer";
import { describe, expect, test } from "@jest/globals";

/*
 * ONEUPTIME AI'S ANSWER ABOUT WHO OWNS A STORE, HELD TO ITS EVIDENCE
 * (#10374): it may only name the candidates the evidence names, each owner
 * it names rests on evidence that names them, it is no surer than Low where
 * it says the evidence disagrees, and its sentences name people only by the
 * names written in here - it never knew them.
 */

const PAYMENTS: DataStoreOwnerCandidate = {
  kind: DataStoreOwnerKind.Team,
  id: "10374000-0000-4000-8000-00000000a001",
  ref: "T1",
  name: "Payments",
  evidenceIds: ["E1", "E3"],
  canOpenStore: true,
};

const CHECKOUT: DataStoreOwnerCandidate = {
  kind: DataStoreOwnerKind.Team,
  id: "10374000-0000-4000-8000-00000000a002",
  ref: "T2",
  name: "Checkout",
  evidenceIds: ["E2"],
  canOpenStore: true,
};

const ALICE: DataStoreOwnerCandidate = {
  kind: DataStoreOwnerKind.User,
  id: "10374000-0000-4000-8000-00000000b001",
  ref: "P1",
  name: "Alice Example",
  evidenceIds: ["E4"],
  canOpenStore: true,
};

const CANDIDATES: Array<DataStoreOwnerCandidate> = [PAYMENTS, CHECKOUT, ALICE];

const EVIDENCE: Array<DataStoreOwnerEvidence> = [
  {
    id: "E1",
    source: DataStoreOwnerEvidenceSource.CloudTag,
    tagKey: "team",
    tagValue: "payments",
    owners: [{ kind: PAYMENTS.kind, id: PAYMENTS.id }],
  },
  {
    id: "E2",
    source: DataStoreOwnerEvidenceSource.ServiceOwners,
    serviceName: "checkout",
    owners: [{ kind: CHECKOUT.kind, id: CHECKOUT.id }],
  },
  {
    id: "E3",
    source: DataStoreOwnerEvidenceSource.CodeOwners,
    filePath: "s3/ledger.tf",
    codeOwner: "@acme/payments",
    owners: [{ kind: PAYMENTS.kind, id: PAYMENTS.id }],
  },
  {
    id: "E4",
    source: DataStoreOwnerEvidenceSource.ChangedBy,
    operation: "s3:PutBucketPolicy",
    owners: [{ kind: ALICE.kind, id: ALICE.id }],
  },
];

function answer(
  overrides: Partial<DataStoreOwnerAnswer>,
): DataStoreOwnerAnswer {
  return {
    owners: [],
    restsOn: [],
    confidence: "high",
    reason: "",
    disagreement: "",
    ...overrides,
  };
}

function hold(
  overrides: Partial<DataStoreOwnerAnswer>,
): HeldDataStoreOwnerAnswer {
  return holdDataStoreOwnerAnswerToEvidence({
    answer: answer(overrides),
    candidates: CANDIDATES,
    evidence: EVIDENCE,
  });
}

describe("the owners it names", () => {
  test("a candidate it names is kept, with the evidence it cited", () => {
    const held: HeldDataStoreOwnerAnswer = hold({
      owners: ["T1"],
      restsOn: ["E1", "E3"],
    });

    expect(held.kind).toBe("owners");
    expect(held.kind === "owners" ? held.owners : []).toEqual([PAYMENTS]);
    expect(held.kind === "owners" ? held.restsOn : []).toEqual(["E1", "E3"]);
    expect(held.inventedOwners).toEqual([]);
  });

  test("an owner it made up is dropped, and said", () => {
    const held: HeldDataStoreOwnerAnswer = hold({
      owners: ["T1", "T9", "P7"],
      restsOn: ["E1"],
    });

    expect(held.kind === "owners" ? held.owners : []).toEqual([PAYMENTS]);
    expect(held.inventedOwners).toEqual(["T9", "P7"]);
  });

  test("an answer that names only made-up owners proposes nothing", () => {
    const held: HeldDataStoreOwnerAnswer = hold({
      owners: ["T9"],
      restsOn: ["E1"],
    });

    expect(held).toEqual({
      kind: "nothing",
      detail: "no-owner-named",
      disagreement: "",
      inventedOwners: ["T9"],
      inventedEvidence: [],
    });
  });

  test("refs are read in any case, braced or not, and each once", () => {
    const held: HeldDataStoreOwnerAnswer = hold({
      owners: ["t1", "{T1}", " T2 "],
      restsOn: ["e1", "E2"],
    });

    expect(held.kind === "owners" ? held.owners : []).toEqual([
      PAYMENTS,
      CHECKOUT,
    ]);
    expect(held.kind === "owners" ? held.restsOn : []).toEqual(["E1", "E2"]);
  });

  test("no more owners than a proposal names", () => {
    const many: Array<DataStoreOwnerCandidate> = [];

    for (let index: number = 1; index <= 8; index++) {
      many.push({
        ...PAYMENTS,
        id: `10374000-0000-4000-8000-00000000a0${String(index).padStart(2, "0")}`,
        ref: `T${index}`,
        evidenceIds: ["E1"],
      });
    }

    const held: HeldDataStoreOwnerAnswer = holdDataStoreOwnerAnswerToEvidence({
      answer: answer({
        owners: many.map((candidate: DataStoreOwnerCandidate): string => {
          return candidate.ref;
        }),
        restsOn: ["E1"],
      }),
      candidates: many,
      evidence: EVIDENCE,
    });

    expect(held.kind === "owners" ? held.owners : []).toHaveLength(
      MAX_PROPOSED_DATA_STORE_OWNERS,
    );
  });
});

describe("the evidence the owners rest on", () => {
  test("evidence it made up is dropped, and said", () => {
    const held: HeldDataStoreOwnerAnswer = hold({
      owners: ["T1"],
      restsOn: ["E1", "E77"],
    });

    expect(held.kind === "owners" ? held.restsOn : []).toEqual(["E1"]);
    expect(held.inventedEvidence).toEqual(["E77"]);
  });

  test("cited evidence that names none of the owners is left out", () => {
    const held: HeldDataStoreOwnerAnswer = hold({
      owners: ["T1"],
      restsOn: ["E1", "E4"],
    });

    expect(held.kind === "owners" ? held.restsOn : []).toEqual(["E1"]);
  });

  test("an owner none of the cited evidence names rests on all that does", () => {
    const held: HeldDataStoreOwnerAnswer = hold({
      owners: ["T1"],
      restsOn: ["E2"],
    });

    expect(held.kind === "owners" ? held.restsOn : []).toEqual(["E1", "E3"]);
  });

  test("an answer that cites nothing rests on what names its owners", () => {
    const held: HeldDataStoreOwnerAnswer = hold({
      owners: ["T2", "P1"],
      restsOn: [],
    });

    expect(held.kind === "owners" ? held.restsOn : []).toEqual(["E2", "E4"]);
  });
});

describe("how sure it is", () => {
  test.each([
    ["high", DataStoreOwnerConfidence.High],
    ["Medium", DataStoreOwnerConfidence.Medium],
    ["LOW", DataStoreOwnerConfidence.Low],
    ["certain", DataStoreOwnerConfidence.Low],
    ["", DataStoreOwnerConfidence.Low],
  ])("%s reads as %s", (said: string, read: DataStoreOwnerConfidence) => {
    const held: HeldDataStoreOwnerAnswer = hold({
      owners: ["T1"],
      restsOn: ["E1"],
      confidence: said,
    });

    expect(held.kind === "owners" ? held.confidence : null).toBe(read);
  });

  test("where it says the evidence disagrees, it is at most Low sure", () => {
    const held: HeldDataStoreOwnerAnswer = hold({
      owners: ["T1"],
      restsOn: ["E1"],
      confidence: "high",
      disagreement:
        "The tag names {T1}, but only the checkout service, {T2}'s, uses it.",
    });

    expect(held.kind === "owners" ? held.confidence : null).toBe(
      DataStoreOwnerConfidence.Low,
    );
    expect(held.kind === "owners" ? held.disagreement : "").toBe(
      "The tag names Payments, but only the checkout service, Checkout's, uses it.",
    );
  });

  test("evidence that disagrees too much to pick an owner proposes nothing, and says why", () => {
    const held: HeldDataStoreOwnerAnswer = hold({
      owners: [],
      disagreement:
        "{T1} and {T2} both point here, and neither more than the other.",
    });

    expect(held).toEqual({
      kind: "nothing",
      detail: "evidence-disagrees",
      disagreement:
        "Payments and Checkout both point here, and neither more than the other.",
      inventedOwners: [],
      inventedEvidence: [],
    });
  });
});

describe("its sentences", () => {
  test("each candidate's ref is written as its name: a person's only here", () => {
    expect(
      writeOwnerSentence(
        "{T1} is named by the team tag, and {P1} changed the bucket.",
        CANDIDATES,
      ),
    ).toBe(
      "Payments is named by the team tag, and Alice Example changed the bucket.",
    );
  });

  test("a bare ref of a candidate reads as its name too", () => {
    expect(writeOwnerSentence("T2 owns the only service.", CANDIDATES)).toBe(
      "Checkout owns the only service.",
    );
  });

  test("a braced ref that is no candidate is left out, never kept as a name", () => {
    expect(
      writeOwnerSentence("Make {P9} the owner, with {T1}.", CANDIDATES),
    ).toBe("Make the owner, with Payments.");
  });

  test("a name written in is never read as a ref again", () => {
    const named: Array<DataStoreOwnerCandidate> = [
      { ...PAYMENTS, name: "Team P1 Squad" },
      ALICE,
    ];

    expect(writeOwnerSentence("{T1} owns it.", named)).toBe(
      "Team P1 Squad owns it.",
    );
  });

  test("a sentence is one line, held to its length", () => {
    const long: string = writeOwnerSentence(
      `{T1}\n${"owns it ".repeat(200)}`,
      CANDIDATES,
    );

    expect(long.includes("\n")).toBe(false);
    expect(long.length).toBeLessThanOrEqual(MAX_DATA_STORE_OWNER_REASON_LENGTH);
    expect(long.startsWith("Payments owns it")).toBe(true);
  });

  test("the reason is written with names before anyone sees it", () => {
    const held: HeldDataStoreOwnerAnswer = hold({
      owners: ["T1"],
      restsOn: ["E1"],
      reason:
        "The team tag and the declaring file's code owners both name {T1}.",
    });

    expect(held.kind === "owners" ? held.reason : "").toBe(
      "The team tag and the declaring file's code owners both name Payments.",
    );
  });
});
