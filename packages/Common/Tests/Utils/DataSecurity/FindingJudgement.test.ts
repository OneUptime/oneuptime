import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { LOCATION_SEPARATOR } from "../../../Server/Utils/DataSecurity/Content/ObjectStoreSampler";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import { FindingWrongMatchSign } from "../../../Types/DataSecurity/DataStoreFindingVerdict";
import { DATA_TYPE_CATALOG } from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  areFindingsSimilar,
  FindingJudgementFacts,
  getFindingFieldName,
  getFindingNameKey,
  getFindingNameWords,
  getWrongMatchSigns,
  isFindingAwaitingJudgement,
  LUHN_DATA_TYPE_IDS,
  OBJECT_FIELD_SEPARATOR,
} from "../../../Utils/DataSecurity/FindingJudgement";

/*
 * WHICH FINDINGS WAIT FOR A PERSON, AND WHICH ARE ALIKE (#10372).
 *
 * A finding waits when the scan was not sure of it, or when it shows a sign
 * of a wrong match; two findings are alike when they are of one data type
 * and their fields have the same name, read as the scanner reads a field's
 * own name - and a finding in free text, or named only in generic words,
 * is alike no other.
 */

const CARD: string = "credit-card-number";

function finding(
  more: Partial<FindingJudgementFacts> = {},
): FindingJudgementFacts {
  return {
    dataTypeId: CARD,
    location: "public.orders.order_number",
    locationKind: "Column",
    isFreeText: false,
    confidence: DataConfidence.High,
    matchCount: 40,
    testValueCount: 0,
    isNameHinted: false,
    isAiSuggested: false,
    isSuppressed: false,
    isConfirmed: false,
    ...more,
  };
}

describe("a field's name, as two findings are alike by it", () => {
  test.each([
    ["order_number", "order number"],
    ["orderNumber", "order number"],
    ["OrderNumber", "order number"],
    ["order-number", "order number"],
    ["public.orders.order_number", "order number"],
    ["sales.Orders.OrderNumber", "order number"],
    // A generic last word keeps the one before it, as the scanner reads it.
    ["payment.card.number", "card number"],
    ["attributes.user.email", "email"],
    ["attributes.http.request.header.x_order_ref", "x order ref"],
    ["items[3].orderNumber", "order number"],
  ])("%s is %s", (location: string, key: string) => {
    expect(getFindingNameKey({ location, locationKind: "Column" })).toBe(key);
  });

  test("an object's field is read after its pattern", () => {
    const location: string = `exports/*/orders-*.csv${OBJECT_FIELD_SEPARATOR}order_number`;

    expect(getFindingFieldName({ location, locationKind: "Field" })).toBe(
      "order_number",
    );
    expect(getFindingNameKey({ location, locationKind: "Field" })).toBe(
      "order number",
    );
  });

  test("the separator is the object store scanner's own", () => {
    expect(OBJECT_FIELD_SEPARATOR).toBe(LOCATION_SEPARATOR);
  });

  test.each([
    ["a log body", { location: "body", locationKind: "Body" }],
    ["free text", { location: "notes", locationKind: "Text" }],
    [
      "a free-text column",
      { location: "public.tickets.summary", isFreeText: true },
    ],
    [
      "an object read whole",
      { location: "exports/*/notes-*.txt", locationKind: "Object" },
    ],
    ["generic words only", { location: "attributes.debug.payload" }],
    ["a bare value", { location: "value" }],
    ["data.json", { location: "data.json" }],
    ["nothing", { location: "" }],
  ])("%s has no name to be alike by", (_title: string, place: object) => {
    expect(getFindingNameKey(place)).toBeNull();
    expect(getFindingNameWords(place)).toEqual([]);
  });

  test("a generic word beside a telling one still names the field", () => {
    expect(getFindingNameKey({ location: "orders.id" })).toBe("orders id");
    expect(getFindingNameKey({ location: "customer_value" })).toBe(
      "customer value",
    );
  });
});

describe("findings alike", () => {
  test("the same type in fields named alike, on any store", () => {
    expect(
      areFindingsSimilar(
        finding({ location: "public.orders.order_number" }),
        finding({ location: "OrderNumber", locationKind: "Attribute" }),
      ),
    ).toBe(true);
  });

  test("never of another data type", () => {
    expect(
      areFindingsSimilar(
        finding(),
        finding({ dataTypeId: "phone-number", location: "order_number" }),
      ),
    ).toBe(false);
  });

  test("never by another name, however close", () => {
    expect(
      areFindingsSimilar(finding(), finding({ location: "order_no" })),
    ).toBe(false);
    expect(
      areFindingsSimilar(
        finding(),
        finding({ location: "purchase_order_number" }),
      ),
    ).toBe(false);
  });

  test("never in free text, even at the same place", () => {
    const body: FindingJudgementFacts = finding({
      location: "body",
      locationKind: "Body",
    });

    expect(areFindingsSimilar(body, { ...body })).toBe(false);
  });

  test("a finding of no data type is alike none", () => {
    expect(
      areFindingsSimilar(
        finding({ dataTypeId: "" }),
        finding({ dataTypeId: "" }),
      ),
    ).toBe(false);
  });
});

describe("the signs of a wrong match", () => {
  test("more test values than real matches", () => {
    expect(
      getWrongMatchSigns(finding({ matchCount: 3, testValueCount: 9 })),
    ).toContain(FindingWrongMatchSign.MostlyTestValues);
    expect(
      getWrongMatchSigns(finding({ matchCount: 9, testValueCount: 9 })),
    ).not.toContain(FindingWrongMatchSign.MostlyTestValues);
    expect(
      getWrongMatchSigns(finding({ matchCount: 0, testValueCount: 0 })),
    ).not.toContain(FindingWrongMatchSign.MostlyTestValues);
  });

  test("a field named for another data type", () => {
    expect(
      getWrongMatchSigns(
        finding({ dataTypeId: "us-ssn", location: "customers.phone" }),
      ),
    ).toEqual([FindingWrongMatchSign.NamePointsElsewhere]);
  });

  test("no sign when the name points at the type itself", () => {
    expect(
      getWrongMatchSigns(
        finding({ location: "payments.card_number", isNameHinted: true }),
      ),
    ).toEqual([]);
    // Even if the scan did not say so, the name's own hints are read.
    expect(
      getWrongMatchSigns(finding({ location: "payments.card_number" })),
    ).toEqual([]);
  });

  test("an id-like field holding a Luhn-checked type", () => {
    for (const location of [
      "order_number",
      "invoiceNo",
      "shipment.ref",
      "order_id",
      "tracking.code",
    ]) {
      expect({
        location,
        signs: getWrongMatchSigns(finding({ location })),
      }).toEqual({
        location,
        signs: [FindingWrongMatchSign.IdFieldWithLuhnNumbers],
      });
    }
  });

  test("an id-like field of a type that is not Luhn-checked is no sign", () => {
    expect(
      getWrongMatchSigns(
        finding({ dataTypeId: "iban", location: "order_number" }),
      ),
    ).toEqual([]);
  });

  test("a field not named as an id is no sign", () => {
    expect(
      getWrongMatchSigns(finding({ location: "orders.amount_paid" })),
    ).toEqual([]);
  });

  test("free text has no name to point anywhere", () => {
    expect(
      getWrongMatchSigns(
        finding({ location: "body", locationKind: "Body", isFreeText: true }),
      ),
    ).toEqual([]);
  });

  test("signs come in one order", () => {
    expect(
      getWrongMatchSigns(
        finding({
          location: "order_number",
          matchCount: 1,
          testValueCount: 5,
        }),
      ),
    ).toEqual([
      FindingWrongMatchSign.MostlyTestValues,
      FindingWrongMatchSign.IdFieldWithLuhnNumbers,
    ]);
  });
});

describe("which findings wait for a person", () => {
  test("a Low finding, and OneUptime AI's suggestions", () => {
    expect(
      isFindingAwaitingJudgement(
        finding({
          confidence: DataConfidence.Low,
          location: "payments.card_number",
        }),
      ),
    ).toBe(true);
    expect(
      isFindingAwaitingJudgement(
        finding({
          isAiSuggested: true,
          confidence: DataConfidence.Low,
          location: "kundennr",
        }),
      ),
    ).toBe(true);
  });

  test("a Medium or High finding only with a sign of a wrong match", () => {
    expect(
      isFindingAwaitingJudgement(
        finding({
          confidence: DataConfidence.High,
          location: "payments.card_number",
        }),
      ),
    ).toBe(false);
    expect(
      isFindingAwaitingJudgement(
        finding({
          confidence: DataConfidence.Medium,
          location: "payments.card_number",
        }),
      ),
    ).toBe(false);
    expect(
      isFindingAwaitingJudgement(
        finding({ confidence: DataConfidence.High, location: "order_number" }),
      ),
    ).toBe(true);
  });

  test("never one a person, or OneUptime AI under a rule, decided", () => {
    expect(
      isFindingAwaitingJudgement(
        finding({ confidence: DataConfidence.Low, isSuppressed: true }),
      ),
    ).toBe(false);
    expect(
      isFindingAwaitingJudgement(
        finding({ confidence: DataConfidence.Low, isConfirmed: true }),
      ),
    ).toBe(false);
  });
});

describe("the Luhn-checked types", () => {
  test("each is a type of the catalog", () => {
    const ids: Set<string> = new Set(
      DATA_TYPE_CATALOG.map((type: { id: string }): string => {
        return type.id;
      }),
    );

    for (const id of LUHN_DATA_TYPE_IDS) {
      expect({ id, inCatalog: ids.has(id) }).toEqual({ id, inCatalog: true });
    }
  });

  test("are the ones whose detectors run Luhn's check", () => {
    const detectors: string = path.resolve(
      __dirname,
      "../../../Utils/DataSecurity/Detectors",
    );
    const source: string = fs
      .readdirSync(detectors)
      .filter((file: string): boolean => {
        return file.endsWith(".ts");
      })
      .map((file: string): string => {
        return fs.readFileSync(path.join(detectors, file), "utf8");
      })
      .join("\n");
    const luhnCalls: number = (source.match(/\bluhn\(/g) || []).length;

    /*
     * One call of Luhn's check per type listed (the check itself is
     * Validators'): a new detector that runs it fails here until its type
     * is listed.
     */
    expect(luhnCalls).toBe(LUHN_DATA_TYPE_IDS.size);

    for (const id of LUHN_DATA_TYPE_IDS) {
      expect({ id, named: source.includes(`"${id}"`) }).toEqual({
        id,
        named: true,
      });
    }
  });
});
