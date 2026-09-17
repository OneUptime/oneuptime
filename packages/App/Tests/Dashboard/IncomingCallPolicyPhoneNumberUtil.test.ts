import { describe, expect, test } from "@jest/globals";
import IncomingCallPolicy from "../../../Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyPhoneNumber from "../../../Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import ObjectID from "../../../Common/Types/ObjectID";
import Phone from "../../../Common/Types/Phone";
import {
  getCompactPhoneNumberSummary,
  getIncomingCallPolicyPhoneNumberText,
  groupIncomingCallPolicyPhoneNumbers,
  includeLegacyIncomingCallPolicyPhoneNumber,
  type CompactPhoneNumberSummary,
  type IncomingCallPolicyPhoneNumbersByPolicyId,
} from "../../FeatureSet/Dashboard/src/Components/CallSMS/IncomingCallPolicyPhoneNumberUtil";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const POLICY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CONFIG_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function buildPhoneNumber(
  policyId: ObjectID | undefined,
  phoneNumberText: string | undefined,
): IncomingCallPolicyPhoneNumber {
  const phoneNumber: IncomingCallPolicyPhoneNumber =
    new IncomingCallPolicyPhoneNumber();

  phoneNumber.id = ObjectID.generate();
  if (policyId) {
    phoneNumber.incomingCallPolicyId = policyId;
  }
  if (phoneNumberText) {
    phoneNumber.phoneNumber = new Phone(phoneNumberText);
  }

  return phoneNumber;
}

function buildLegacyPolicy(data?: {
  phone?: string | undefined;
  sid?: string | undefined;
  countryCode?: string | undefined;
  areaCode?: string | undefined;
  purchasedAt?: Date | undefined;
}): IncomingCallPolicy {
  const policy: IncomingCallPolicy = new IncomingCallPolicy();
  policy.id = POLICY_ID;
  policy.projectId = PROJECT_ID;
  policy.projectCallSMSConfigId = CONFIG_ID;
  if (data?.phone) {
    policy.routingPhoneNumber = new Phone(data.phone);
  }
  if (data?.sid) {
    policy.callProviderPhoneNumberId = data.sid;
  }
  if (data?.countryCode !== undefined) {
    policy.phoneNumberCountryCode = data.countryCode;
  }
  if (data?.areaCode !== undefined) {
    policy.phoneNumberAreaCode = data.areaCode;
  }
  if (data?.purchasedAt !== undefined) {
    policy.phoneNumberPurchasedAt = data.purchasedAt;
  }
  return policy;
}

describe("incoming call policy phone-number text", () => {
  test("uses the canonical Phone string", () => {
    const phoneNumber: IncomingCallPolicyPhoneNumber = buildPhoneNumber(
      ObjectID.generate(),
      "+14155550101",
    );

    expect(getIncomingCallPolicyPhoneNumberText(phoneNumber)).toBe(
      "+14155550101",
    );
  });

  test("returns an empty string for a partially loaded row", () => {
    expect(
      getIncomingCallPolicyPhoneNumberText(
        buildPhoneNumber(ObjectID.generate(), undefined),
      ),
    ).toBe("");
  });
});

describe("groupIncomingCallPolicyPhoneNumbers", () => {
  test("groups multiple numbers under their policy", () => {
    const firstPolicyId: ObjectID = ObjectID.generate();
    const secondPolicyId: ObjectID = ObjectID.generate();
    const first: IncomingCallPolicyPhoneNumber = buildPhoneNumber(
      firstPolicyId,
      "+14155550101",
    );
    const second: IncomingCallPolicyPhoneNumber = buildPhoneNumber(
      firstPolicyId,
      "+14155550102",
    );
    const third: IncomingCallPolicyPhoneNumber = buildPhoneNumber(
      secondPolicyId,
      "+442071838750",
    );

    const grouped: IncomingCallPolicyPhoneNumbersByPolicyId =
      groupIncomingCallPolicyPhoneNumbers([first, second, third]);

    expect(grouped[firstPolicyId.toString()]).toEqual([first, second]);
    expect(grouped[secondPolicyId.toString()]).toEqual([third]);
  });

  test("preserves API order within each policy", () => {
    const policyId: ObjectID = ObjectID.generate();
    const phoneNumbers: Array<IncomingCallPolicyPhoneNumber> = [
      buildPhoneNumber(policyId, "+14155550103"),
      buildPhoneNumber(policyId, "+14155550101"),
      buildPhoneNumber(policyId, "+14155550102"),
    ];

    expect(
      groupIncomingCallPolicyPhoneNumbers(phoneNumbers)[policyId.toString()],
    ).toEqual(phoneNumbers);
  });

  test("omits rows whose policy relation was not selected", () => {
    const policyId: ObjectID = ObjectID.generate();
    const valid: IncomingCallPolicyPhoneNumber = buildPhoneNumber(
      policyId,
      "+14155550101",
    );

    expect(
      groupIncomingCallPolicyPhoneNumbers([
        buildPhoneNumber(undefined, "+14155550102"),
        valid,
      ]),
    ).toEqual({ [policyId.toString()]: [valid] });
  });

  test("returns an empty lookup for an empty result page", () => {
    expect(groupIncomingCallPolicyPhoneNumbers([])).toEqual({});
  });

  test("does not mutate the list returned by ModelAPI", () => {
    const policyId: ObjectID = ObjectID.generate();
    const phoneNumbers: Array<IncomingCallPolicyPhoneNumber> = [
      buildPhoneNumber(policyId, "+14155550101"),
      buildPhoneNumber(policyId, "+14155550102"),
    ];
    const before: Array<IncomingCallPolicyPhoneNumber> = [...phoneNumbers];

    groupIncomingCallPolicyPhoneNumbers(phoneNumbers);

    expect(phoneNumbers).toEqual(before);
  });
});

describe("includeLegacyIncomingCallPolicyPhoneNumber", () => {
  test("copies every scalar field into an id-less synthetic row before normalized rows", () => {
    const purchasedAt: Date = new Date("2025-04-03T02:01:00.000Z");
    const policy: IncomingCallPolicy = buildLegacyPolicy({
      phone: "+442079460000",
      sid: "PN-legacy",
      countryCode: "GB",
      areaCode: "20",
      purchasedAt,
    });
    const normalized: IncomingCallPolicyPhoneNumber = buildPhoneNumber(
      POLICY_ID,
      "+14155550102",
    );
    const input: Array<IncomingCallPolicyPhoneNumber> = [normalized];

    const result: Array<IncomingCallPolicyPhoneNumber> =
      includeLegacyIncomingCallPolicyPhoneNumber(input, policy);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      projectId: PROJECT_ID,
      incomingCallPolicyId: POLICY_ID,
      projectCallSMSConfigId: CONFIG_ID,
      callProviderPhoneNumberId: "PN-legacy",
      countryCode: "GB",
      areaCode: "20",
      phoneNumberPurchasedAt: purchasedAt,
    });
    expect(result[0]?.phoneNumber?.toString()).toBe("+442079460000");
    expect(result[0]?.id).toBeNull();
    expect(result[1]).toBe(normalized);
    expect(input).toEqual([normalized]);
  });

  test("deduplicates a scalar mirror already present anywhere in the child list", () => {
    const policy: IncomingCallPolicy = buildLegacyPolicy({
      phone: "+14155550101",
      sid: "PN-legacy",
    });
    const first: IncomingCallPolicyPhoneNumber = buildPhoneNumber(
      POLICY_ID,
      "+14155550102",
    );
    const mirrored: IncomingCallPolicyPhoneNumber = buildPhoneNumber(
      POLICY_ID,
      "+14155550101",
    );
    const last: IncomingCallPolicyPhoneNumber = buildPhoneNumber(
      POLICY_ID,
      "+14155550103",
    );
    const input: Array<IncomingCallPolicyPhoneNumber> = [first, mirrored, last];

    const result: Array<IncomingCallPolicyPhoneNumber> =
      includeLegacyIncomingCallPolicyPhoneNumber(input, policy);

    expect(result).toBe(input);
    expect(result).toEqual([first, mirrored, last]);
    expect(
      result.filter((row: IncomingCallPolicyPhoneNumber): boolean => {
        return row.phoneNumber?.toString() === "+14155550101";
      }),
    ).toHaveLength(1);
  });

  test("returns the original normalized order when the policy has no scalar number", () => {
    const input: Array<IncomingCallPolicyPhoneNumber> = [
      buildPhoneNumber(POLICY_ID, "+14155550103"),
      buildPhoneNumber(POLICY_ID, "+14155550101"),
    ];

    const result: Array<IncomingCallPolicyPhoneNumber> =
      includeLegacyIncomingCallPolicyPhoneNumber(input, buildLegacyPolicy());

    expect(result).toBe(input);
    expect(result).toEqual(input);
  });

  test("synthesizes a visible row even when old data has no provider config", () => {
    const policy: IncomingCallPolicy = buildLegacyPolicy({
      phone: "+14155550101",
      sid: "PN-legacy",
    });
    delete policy.projectCallSMSConfigId;

    const result: Array<IncomingCallPolicyPhoneNumber> =
      includeLegacyIncomingCallPolicyPhoneNumber([], policy);

    expect(result).toHaveLength(1);
    expect(result[0]?.phoneNumber?.toString()).toBe("+14155550101");
    expect(result[0]?.projectCallSMSConfigId).toBeUndefined();
  });
});

describe("getCompactPhoneNumberSummary", () => {
  test("represents the zero-number state", () => {
    expect(getCompactPhoneNumberSummary([])).toEqual({
      visiblePhoneNumbers: [],
      additionalPhoneNumbersCount: 0,
    });
  });

  test("shows the only number without an overflow badge", () => {
    const summary: CompactPhoneNumberSummary = getCompactPhoneNumberSummary([
      buildPhoneNumber(ObjectID.generate(), "+14155550101"),
    ]);

    expect(summary).toEqual({
      visiblePhoneNumbers: ["+14155550101"],
      additionalPhoneNumbersCount: 0,
    });
  });

  test("shows one number and counts every additional number by default", () => {
    const policyId: ObjectID = ObjectID.generate();
    const summary: CompactPhoneNumberSummary = getCompactPhoneNumberSummary([
      buildPhoneNumber(policyId, "+14155550101"),
      buildPhoneNumber(policyId, "+14155550102"),
      buildPhoneNumber(policyId, "+14155550103"),
    ]);

    expect(summary).toEqual({
      visiblePhoneNumbers: ["+14155550101"],
      additionalPhoneNumbersCount: 2,
    });
  });

  test("honors a larger visible-number limit", () => {
    const policyId: ObjectID = ObjectID.generate();
    const summary: CompactPhoneNumberSummary = getCompactPhoneNumberSummary(
      [
        buildPhoneNumber(policyId, "+14155550101"),
        buildPhoneNumber(policyId, "+14155550102"),
        buildPhoneNumber(policyId, "+14155550103"),
      ],
      2,
    );

    expect(summary).toEqual({
      visiblePhoneNumbers: ["+14155550101", "+14155550102"],
      additionalPhoneNumbersCount: 1,
    });
  });

  test("treats a negative visible-number limit as zero", () => {
    const summary: CompactPhoneNumberSummary = getCompactPhoneNumberSummary(
      [buildPhoneNumber(ObjectID.generate(), "+14155550101")],
      -2,
    );

    expect(summary).toEqual({
      visiblePhoneNumbers: [],
      additionalPhoneNumbersCount: 1,
    });
  });

  test("does not count a partially loaded row as an attached number", () => {
    const policyId: ObjectID = ObjectID.generate();
    const summary: CompactPhoneNumberSummary = getCompactPhoneNumberSummary([
      buildPhoneNumber(policyId, undefined),
      buildPhoneNumber(policyId, "+14155550101"),
    ]);

    expect(summary).toEqual({
      visiblePhoneNumbers: ["+14155550101"],
      additionalPhoneNumbersCount: 0,
    });
  });

  test("does not reorder or mutate its input", () => {
    const policyId: ObjectID = ObjectID.generate();
    const phoneNumbers: Array<IncomingCallPolicyPhoneNumber> = [
      buildPhoneNumber(policyId, "+14155550103"),
      buildPhoneNumber(policyId, "+14155550101"),
    ];
    const before: Array<IncomingCallPolicyPhoneNumber> = [...phoneNumbers];

    getCompactPhoneNumberSummary(phoneNumbers);

    expect(phoneNumbers).toEqual(before);
  });
});
