import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import DataStoreFindingService from "../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import FindingApplyToSimilar, {
  DECIDE_FIRST_MESSAGE,
  readTickedFindingIds,
  SIMILAR_FINDING_NOT_FOUND_MESSAGE,
} from "../../../../Server/Utils/DataSecurity/FindingApplyToSimilar";
import logger from "../../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityApplyToSimilarResult,
  DataSecuritySimilarFinding,
  DataSecuritySimilarFindings,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ONE DECISION SETTLES EVERY FINDING LIKE IT (#10372): Apply to similar
 * lists the undecided findings of the same type in a field of the same
 * name, on every store the person may read, and makes their decision -
 * with their reason - on the ones they keep ticked, each as their own
 * update. What the page sends is only which stay ticked: the server lists
 * them again and decides only those still alike, undecided and readable.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PERSON: DatabaseCommonInteractionProps = {
  userId: new ObjectID("55555555-5555-4555-8555-555555555555"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;
const REASON: string = "Shopify order numbers, not card numbers.";

let findings: Map<string, DataStoreFinding>;
let stores: Map<string, DataStore>;
let unreadableStores: Set<string>;
let refusedFindings: Set<string>;
let updates: Array<{ id: string; data: JSONObject; props: unknown }>;
let readProps: Array<unknown>;

function storeId(index: number): string {
  return `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;
}

function store(index: number): DataStore {
  const row: DataStore = new DataStore(new ObjectID(storeId(index)));
  row.name = `orders-${String(index).padStart(2, "0")}`;
  row.kind = DataStoreKind.PostgreSql;
  row.isArchived = false;
  stores.set(storeId(index), row);
  return row;
}

let counter: number = 0;

function finding(
  storeIndex: number,
  location: string,
  more: Partial<DataStoreFinding> = {},
): DataStoreFinding {
  counter++;
  const row: DataStoreFinding = new DataStoreFinding(
    new ObjectID(`33333333-3333-4333-8333-${String(counter).padStart(12, "0")}`),
  );
  row.projectId = PROJECT_ID;
  row.dataStoreId = new ObjectID(storeId(storeIndex));
  row.dataTypeId = "credit-card-number";
  row.dataTypeName = "Card number";
  row.location = location;
  row.locationKind = "Column";
  row.isFreeText = false;
  row.isSuppressed = false;
  row.isConfirmed = false;
  Object.assign(row, more);
  findings.set(row.id!.toString(), row);
  return row;
}

function idOf(row: DataStoreFinding): string {
  return row.id!.toString().toLowerCase();
}

beforeEach(() => {
  findings = new Map();
  stores = new Map();
  unreadableStores = new Set();
  refusedFindings = new Set();
  updates = [];
  readProps = [];

  jest
    .spyOn(DataStoreFindingService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: JSONObject;
      props: unknown;
    }) => {
      readProps.push(findOneBy.props);
      return findings.get(String(findOneBy.query["_id"])) || null;
    }) as never);
  jest
    .spyOn(DataStoreFindingService, "findBy")
    .mockImplementation((async (findBy: { query: JSONObject; props: unknown }) => {
      readProps.push(findBy.props);
      return [...findings.values()].filter((row: DataStoreFinding): boolean => {
        return (
          row.dataTypeId === findBy.query["dataTypeId"] &&
          row.isSuppressed === false &&
          row.isConfirmed === false
        );
      });
    }) as never);
  jest
    .spyOn(DataStoreService, "findBy")
    .mockImplementation((async (findBy: { props: unknown }) => {
      readProps.push(findBy.props);
      return [...stores.values()].filter((row: DataStore): boolean => {
        return !unreadableStores.has(row.id!.toString());
      });
    }) as never);
  jest
    .spyOn(DataStoreFindingService, "updateOneById")
    .mockImplementation((async (updateOneBy: {
      id: ObjectID;
      data: JSONObject;
      props: unknown;
    }) => {
      const id: string = updateOneBy.id.toString();

      if (refusedFindings.has(id)) {
        throw new NotAuthorizedException("You may not change this finding.");
      }

      updates.push({ id, data: updateOneBy.data, props: updateOneBy.props });
      Object.assign(findings.get(id)!, updateOneBy.data);
    }) as never);
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function decidedOnStoreZero(): DataStoreFinding {
  store(0);

  return finding(0, "public.orders.order_number", {
    isSuppressed: true,
    suppressedReason: REASON,
  });
}

describe("one Not Sensitive with Apply to similar", () => {
  test("settles the same finding on nine other stores, each keeping the reason", async () => {
    const decided: DataStoreFinding = decidedOnStoreZero();
    const nine: Array<DataStoreFinding> = [];

    for (let index: number = 1; index <= 9; index++) {
      store(index);
      nine.push(
        finding(
          index,
          index % 2 === 0 ? "sales.orders.orderNumber" : "public.orders.order_number",
        ),
      );
    }

    const listed: DataSecuritySimilarFindings =
      await FindingApplyToSimilar.listSimilar({
        props: PERSON,
        projectId: PROJECT_ID,
        findingId: decided.id!.toString(),
      });

    expect(listed).toMatchObject({
      decision: "NotSensitive",
      reason: REASON,
      hasName: true,
    });
    expect(listed.findings).toHaveLength(9);

    const result: DataSecurityApplyToSimilarResult =
      await FindingApplyToSimilar.applyToSimilar({
        props: PERSON,
        projectId: PROJECT_ID,
        findingId: decided.id!.toString(),
        findingIds: listed.findings.map(
          (entry: DataSecuritySimilarFinding): string => {
            return entry.findingId;
          },
        ),
      });

    expect(result).toEqual({ decision: "NotSensitive", applied: 9, skipped: 0 });
    expect(updates).toHaveLength(9);

    for (const row of nine) {
      expect(row.isSuppressed).toBe(true);
      expect(row.suppressedReason).toBe(REASON);
    }

    // Each is the person's own update, read with their own permissions.
    for (const update of updates) {
      expect(update.props).toBe(PERSON);
      expect(update.data).toEqual({ isSuppressed: true, suppressedReason: REASON });
    }

    for (const props of readProps) {
      expect(props).toBe(PERSON);
    }
  });

  test("leaves the ones the person unticked as they were", async () => {
    const decided: DataStoreFinding = decidedOnStoreZero();
    store(1);
    store(2);
    const kept: DataStoreFinding = finding(1, "public.orders.order_number");
    const unticked: DataStoreFinding = finding(2, "public.orders.order_number");

    const result: DataSecurityApplyToSimilarResult =
      await FindingApplyToSimilar.applyToSimilar({
        props: PERSON,
        projectId: PROJECT_ID,
        findingId: decided.id!.toString(),
        findingIds: [idOf(kept)],
      });

    expect(result.applied).toBe(1);
    expect(unticked.isSuppressed).toBe(false);
  });
});

describe("what is listed as similar", () => {
  test("only the same type in a field of the same name, undecided, on a readable store", async () => {
    const decided: DataStoreFinding = decidedOnStoreZero();

    store(1);
    store(2);
    store(3);
    const alike: DataStoreFinding = finding(1, "eu.orders.OrderNumber");

    // Another name, however close; another type; a decided one; an unreadable store.
    finding(1, "public.orders.order_no");
    finding(1, "public.orders.order_number", { dataTypeId: "phone-number" });
    finding(2, "public.orders.order_number", { isConfirmed: true });
    finding(3, "public.orders.order_number");
    unreadableStores.add(storeId(3));

    const listed: DataSecuritySimilarFindings =
      await FindingApplyToSimilar.listSimilar({
        props: PERSON,
        projectId: PROJECT_ID,
        findingId: decided.id!.toString(),
      });

    expect(
      listed.findings.map((entry: DataSecuritySimilarFinding): string => {
        return entry.findingId;
      }),
    ).toEqual([idOf(alike)]);
    expect(listed.findings[0]).toMatchObject({
      storeName: "orders-01",
      location: "eu.orders.OrderNumber",
      isSameStore: false,
    });
  });

  test("this store's other places first, then by store and place", async () => {
    const decided: DataStoreFinding = decidedOnStoreZero();

    store(1);
    finding(1, "public.orders.order_number");
    const sameStore: DataStoreFinding = finding(0, "archive.orders.order_number");

    const listed: DataSecuritySimilarFindings =
      await FindingApplyToSimilar.listSimilar({
        props: PERSON,
        projectId: PROJECT_ID,
        findingId: decided.id!.toString(),
      });

    expect(listed.findings[0]!.findingId).toBe(idOf(sameStore));
    expect(listed.findings[0]!.isSameStore).toBe(true);
  });

  test("a finding in free text has no name to be alike by: nothing is listed", async () => {
    store(0);
    store(1);
    const body: DataStoreFinding = finding(0, "body", {
      locationKind: "Body",
      isFreeText: true,
      isSuppressed: true,
      suppressedReason: "Test emails.",
      dataTypeId: "email-address",
    });

    finding(1, "body", {
      locationKind: "Body",
      isFreeText: true,
      dataTypeId: "email-address",
    });

    const listed: DataSecuritySimilarFindings =
      await FindingApplyToSimilar.listSimilar({
        props: PERSON,
        projectId: PROJECT_ID,
        findingId: body.id!.toString(),
      });

    expect(listed.hasName).toBe(false);
    expect(listed.findings).toEqual([]);
  });

  test("a finding the person may not read is not found", async () => {
    await expect(
      FindingApplyToSimilar.listSimilar({
        props: PERSON,
        projectId: PROJECT_ID,
        findingId: ObjectID.generate().toString(),
      }),
    ).rejects.toThrow(SIMILAR_FINDING_NOT_FOUND_MESSAGE);
    await expect(
      FindingApplyToSimilar.listSimilar({
        props: PERSON,
        projectId: PROJECT_ID,
        findingId: "not-an-id",
      }),
    ).rejects.toThrow(SIMILAR_FINDING_NOT_FOUND_MESSAGE);
  });
});

describe("what is applied, and to what", () => {
  test("a confirmation is applied as a confirmation", async () => {
    store(0);
    store(1);
    const decided: DataStoreFinding = finding(0, "crm.contacts.contact_email", {
      dataTypeId: "email-address",
      isConfirmed: true,
    });
    const alike: DataStoreFinding = finding(1, "marketing.contactEmail", {
      dataTypeId: "email-address",
    });

    const result: DataSecurityApplyToSimilarResult =
      await FindingApplyToSimilar.applyToSimilar({
        props: PERSON,
        projectId: PROJECT_ID,
        findingId: decided.id!.toString(),
        findingIds: [idOf(alike)],
      });

    expect(result).toEqual({ decision: "Confirmed", applied: 1, skipped: 0 });
    expect(updates[0]!.data).toEqual({ isConfirmed: true });
  });

  test("nothing is applied from a finding nobody decided", async () => {
    store(0);
    store(1);
    const undecided: DataStoreFinding = finding(0, "public.orders.order_number");
    const alike: DataStoreFinding = finding(1, "public.orders.order_number");

    await expect(
      FindingApplyToSimilar.applyToSimilar({
        props: PERSON,
        projectId: PROJECT_ID,
        findingId: undecided.id!.toString(),
        findingIds: [idOf(alike)],
      }),
    ).rejects.toThrow(DECIDE_FIRST_MESSAGE);
    expect(updates).toEqual([]);
  });

  test("a ticked finding no longer alike, decided in between, or on an unreadable store is skipped", async () => {
    const decided: DataStoreFinding = decidedOnStoreZero();

    store(1);
    store(2);
    store(3);
    const decidedSince: DataStoreFinding = finding(1, "public.orders.order_number", {
      isConfirmed: true,
    });
    const otherName: DataStoreFinding = finding(2, "public.orders.order_no");
    const hidden: DataStoreFinding = finding(3, "public.orders.order_number");

    unreadableStores.add(storeId(3));

    const result: DataSecurityApplyToSimilarResult =
      await FindingApplyToSimilar.applyToSimilar({
        props: PERSON,
        projectId: PROJECT_ID,
        findingId: decided.id!.toString(),
        findingIds: [idOf(decidedSince), idOf(otherName), idOf(hidden)],
      });

    expect(result).toEqual({ decision: "NotSensitive", applied: 0, skipped: 3 });
    expect(updates).toEqual([]);
  });

  test("one the person may not change is skipped, and the rest go on", async () => {
    const decided: DataStoreFinding = decidedOnStoreZero();

    store(1);
    store(2);
    const refused: DataStoreFinding = finding(1, "public.orders.order_number");
    const allowed: DataStoreFinding = finding(2, "public.orders.order_number");

    refusedFindings.add(refused.id!.toString());

    const result: DataSecurityApplyToSimilarResult =
      await FindingApplyToSimilar.applyToSimilar({
        props: PERSON,
        projectId: PROJECT_ID,
        findingId: decided.id!.toString(),
        findingIds: [idOf(refused), idOf(allowed)],
      });

    expect(result).toEqual({ decision: "NotSensitive", applied: 1, skipped: 1 });
    expect(allowed.isSuppressed).toBe(true);
    expect(refused.isSuppressed).toBe(false);
  });

  test("the ticked ids are read strictly: a list of ids, each once, at most two hundred", () => {
    expect(() => {
      return readTickedFindingIds("all");
    }).toThrow("as a list of their ids");

    const id: string = ObjectID.generate().toString();

    expect(readTickedFindingIds([id, id.toUpperCase(), "x", 4])).toEqual([
      id.toLowerCase(),
    ]);
    expect(
      readTickedFindingIds(
        Array.from({ length: 300 }, (): string => {
          return ObjectID.generate().toString();
        }),
      ),
    ).toHaveLength(200);
  });
});
