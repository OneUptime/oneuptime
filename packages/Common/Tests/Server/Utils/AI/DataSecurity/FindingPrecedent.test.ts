import { describe, expect, test } from "@jest/globals";
import {
  getPersonDecision,
  PrecedentCandidate,
  PrecedentSubject,
  selectFindingPrecedent,
} from "../../../../../Server/Utils/AI/DataSecurity/FindingPrecedent";
import {
  DATA_STORE_FINDING_VERDICT_LIMITS,
  DataStoreFindingDecision,
  DataStoreFindingPrecedent,
} from "../../../../../Types/DataSecurity/DataStoreFindingVerdict";

/*
 * THE TEAM'S OWN DECISIONS A VERDICT RESTS ON (#10372): the findings alike
 * it first, found by the field's name, the same location first and the
 * newest decision first; then the rest of the type's decisions, ranked by
 * MeaningSearch - at most ten, only people's decisions, never the finding
 * itself.
 */

const CARD: string = "credit-card-number";

const SUBJECT: PrecedentSubject = {
  id: "subject",
  dataStoreId: "store-new",
  dataTypeId: CARD,
  location: "public.orders.order_number",
  locationKind: "Column",
  isFreeText: false,
};

let counter: number = 0;

function decided(more: Partial<PrecedentCandidate> = {}): PrecedentCandidate {
  counter++;

  return {
    id: `finding-${String(counter).padStart(3, "0")}`,
    dataStoreId: `store-${counter}`,
    dataTypeId: CARD,
    location: "public.orders.order_number",
    locationKind: "Column",
    isFreeText: false,
    isSuppressed: true,
    isConfirmed: false,
    isConfirmedByAi: false,
    suppressedReason: "Order numbers that pass the Luhn check.",
    decidedAt: new Date(Date.UTC(2026, 10, 1, 10, counter)),
    ...more,
  };
}

function ids(precedent: Array<DataStoreFindingPrecedent>): Array<string> {
  return precedent.map((entry: DataStoreFindingPrecedent): string => {
    return entry.findingId;
  });
}

describe("whose decision is precedent", () => {
  test("a person's mark of not sensitive, or their confirmation", () => {
    expect(getPersonDecision({ isSuppressed: true })).toBe(
      DataStoreFindingDecision.NotSensitive,
    );
    expect(getPersonDecision({ isConfirmed: true })).toBe(
      DataStoreFindingDecision.Confirmed,
    );
  });

  test("never OneUptime AI's own confirmation, nor an undecided finding", () => {
    expect(
      getPersonDecision({ isConfirmed: true, isConfirmedByAi: true }),
    ).toBeNull();
    expect(getPersonDecision({})).toBeNull();
  });

  test("a finding confirmed and then marked not sensitive no longer counts", () => {
    expect(getPersonDecision({ isConfirmed: true, isSuppressed: true })).toBe(
      DataStoreFindingDecision.NotSensitive,
    );
  });
});

describe("the findings alike it, first", () => {
  test("a Low finding dismissed on four stores has those four decisions", () => {
    const four: Array<PrecedentCandidate> = [
      decided({ location: "public.orders.order_number" }),
      decided({ location: "orders.orderNumber" }),
      decided({ location: "OrderNumber", locationKind: "Attribute" }),
      decided({ location: "sales.order_number" }),
    ];

    const precedent: Array<DataStoreFindingPrecedent> = selectFindingPrecedent(
      { finding: SUBJECT, candidates: four },
    );

    expect(precedent).toHaveLength(4);
    expect(
      precedent.every((entry: DataStoreFindingPrecedent): boolean => {
        return (
          entry.isSameName &&
          entry.decision === DataStoreFindingDecision.NotSensitive &&
          entry.reason === "Order numbers that pass the Luhn check."
        );
      }),
    ).toBe(true);
    expect(
      new Set(
        precedent.map((entry: DataStoreFindingPrecedent): string => {
          return entry.dataStoreId;
        }),
      ).size,
    ).toBe(4);
  });

  test("the same location first, then the newest decision first", () => {
    const older: PrecedentCandidate = decided({
      location: "orders.orderNumber",
      decidedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer: PrecedentCandidate = decided({
      location: "orders.orderNumber",
      decidedAt: new Date("2026-06-01T00:00:00Z"),
    });
    const sameLocation: PrecedentCandidate = decided({
      location: "PUBLIC.ORDERS.ORDER_NUMBER",
      decidedAt: new Date("2025-01-01T00:00:00Z"),
    });

    expect(
      ids(
        selectFindingPrecedent({
          finding: SUBJECT,
          candidates: [older, newer, sameLocation],
        }),
      ),
    ).toEqual([sameLocation.id, newer.id, older.id]);
  });

  test("at most ten, however many are alike", () => {
    const many: Array<PrecedentCandidate> = Array.from(
      { length: 15 },
      (): PrecedentCandidate => {
        return decided();
      },
    );

    const precedent: Array<DataStoreFindingPrecedent> = selectFindingPrecedent(
      { finding: SUBJECT, candidates: many },
    );

    expect(precedent).toHaveLength(DATA_STORE_FINDING_VERDICT_LIMITS.maxPrecedent);
    // The newest ten.
    expect(ids(precedent)).toEqual(
      [...many]
        .reverse()
        .slice(0, 10)
        .map((candidate: PrecedentCandidate): string => {
          return candidate.id;
        }),
    );
  });

  test("never another data type, an undecided finding, AI's own, or the finding itself", () => {
    const precedent: Array<DataStoreFindingPrecedent> = selectFindingPrecedent(
      {
        finding: SUBJECT,
        candidates: [
          decided({ dataTypeId: "phone-number" }),
          decided({ isSuppressed: false, isConfirmed: false }),
          decided({
            isSuppressed: false,
            isConfirmed: true,
            isConfirmedByAi: true,
          }),
          decided({ id: SUBJECT.id }),
        ],
      },
    );

    expect(precedent).toEqual([]);
  });

  test("a person's confirmation is precedent too, with no reason", () => {
    const confirmed: PrecedentCandidate = decided({
      isSuppressed: false,
      isConfirmed: true,
      suppressedReason: "left over",
    });

    expect(
      selectFindingPrecedent({ finding: SUBJECT, candidates: [confirmed] }),
    ).toEqual([
      {
        findingId: confirmed.id,
        dataStoreId: confirmed.dataStoreId,
        location: confirmed.location,
        decision: DataStoreFindingDecision.Confirmed,
        reason: "",
        isSameName: true,
        decidedAt: (confirmed.decidedAt as Date).toISOString(),
      },
    ]);
  });

  test("a long reason is held to its length, on one line", () => {
    const long: PrecedentCandidate = decided({
      suppressedReason: `Order numbers.\n\n${"x".repeat(900)}`,
    });
    const precedent: Array<DataStoreFindingPrecedent> = selectFindingPrecedent(
      { finding: SUBJECT, candidates: [long] },
    );

    expect(precedent[0]!.reason).toHaveLength(
      DATA_STORE_FINDING_VERDICT_LIMITS.maxPrecedentReasonLength,
    );
    expect(precedent[0]!.reason.startsWith("Order numbers. x")).toBe(true);
  });
});

describe("then the rest of the type's decisions, ranked by meaning", () => {
  test("a field named like it by meaning comes after the alike ones", () => {
    const alike: PrecedentCandidate = decided();
    const likeIt: PrecedentCandidate = decided({
      location: "billing.purchase_order_number",
      suppressedReason: "Purchase order numbers, not cards.",
    });
    const unlike: PrecedentCandidate = decided({
      location: "payments.pan",
      suppressedReason: "Test cards from the sandbox.",
    });

    const precedent: Array<DataStoreFindingPrecedent> = selectFindingPrecedent(
      { finding: SUBJECT, candidates: [unlike, likeIt, alike] },
    );

    expect(ids(precedent)).toEqual([alike.id, likeIt.id]);
    expect(precedent[0]!.isSameName).toBe(true);
    expect(precedent[1]!.isSameName).toBe(false);
  });

  test("only to fill what the alike ones leave", () => {
    const tenAlike: Array<PrecedentCandidate> = Array.from(
      { length: 10 },
      (): PrecedentCandidate => {
        return decided();
      },
    );
    const likeIt: PrecedentCandidate = decided({
      location: "billing.purchase_order_number",
    });

    const precedent: Array<DataStoreFindingPrecedent> = selectFindingPrecedent(
      { finding: SUBJECT, candidates: [...tenAlike, likeIt] },
    );

    expect(ids(precedent)).not.toContain(likeIt.id);
  });

  test("a reason that says what the field holds ranks a field of another name", () => {
    const byReason: PrecedentCandidate = decided({
      location: "shop.ref",
      suppressedReason: "These are Shopify order numbers.",
    });

    expect(
      ids(selectFindingPrecedent({ finding: SUBJECT, candidates: [byReason] })),
    ).toEqual([byReason.id]);
  });
});

describe("a finding in free text", () => {
  const body: PrecedentSubject = {
    id: "body-subject",
    dataStoreId: "service-a-logs",
    dataTypeId: "email-address",
    location: "body",
    locationKind: "Body",
    isFreeText: true,
  };

  test("rests on the same place of the same kind on other stores", () => {
    const otherService: PrecedentCandidate = decided({
      dataTypeId: "email-address",
      dataStoreId: "service-b-logs",
      location: "body",
      locationKind: "Body",
      isFreeText: true,
    });
    const attribute: PrecedentCandidate = decided({
      dataTypeId: "email-address",
      dataStoreId: "service-c-logs",
      location: "attributes.body",
      locationKind: "Attribute",
    });
    const sameStore: PrecedentCandidate = decided({
      dataTypeId: "email-address",
      dataStoreId: body.dataStoreId,
      location: "body",
      locationKind: "Body",
      isFreeText: true,
    });

    const precedent: Array<DataStoreFindingPrecedent> = selectFindingPrecedent(
      { finding: body, candidates: [otherService, attribute, sameStore] },
    );

    expect(ids(precedent)).toEqual([otherService.id]);
  });

  test("is never ranked by meaning", () => {
    const named: PrecedentCandidate = decided({
      dataTypeId: "email-address",
      location: "customer_email",
      suppressedReason: "body body body",
    });

    expect(
      selectFindingPrecedent({ finding: body, candidates: [named] }),
    ).toEqual([]);
  });
});
