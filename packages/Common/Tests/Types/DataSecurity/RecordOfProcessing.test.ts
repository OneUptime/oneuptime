import {
  ComplianceFact,
  ComplianceFactKind,
  getFactsHash,
} from "../../../Types/DataSecurity/ComplianceFacts";
import {
  RECORD_DRAFT_GONE_MESSAGE,
  RECORD_NO_PROPOSAL_MESSAGE,
  RECORD_PURPOSE_MAX_LENGTH,
  RECORD_VALUE_NOT_ALLOWED_MESSAGE,
  RECORD_VALUE_TOO_LONG_MESSAGE,
  RecordField,
  RecordFieldAction,
  RecordFieldActionResult,
  RecordFieldDraft,
  RecordFieldDraftAction,
  RecordFieldStatus,
  RecordFieldValue,
  RecordLegalBasis,
  RecordPeople,
  RecordRecipient,
  RecordRecipientKind,
  RecordTransferRoute,
  RecordTransfers,
  RecordTransfersUnknownReason,
  StoreRecordDrafts,
  applyRecordFieldAction,
  describeRecordRecipient,
  describeRecordTransfer,
  emptyStoreRecordDrafts,
  getChangedFactKeys,
  getRecordFieldDraftAction,
  getRecordFieldStatus,
  getRecordRecipients,
  getRecordTransfers,
  getRecordValueHash,
  isRecordFieldToReview,
  readStoreRecordDrafts,
  readWrittenRecordValue,
  toStoreRecordDraftsJson,
} from "../../../Types/DataSecurity/RecordOfProcessing";
import { describe, expect, test } from "@jest/globals";

/*
 * A STORE'S RECORD OF PROCESSING, AND WHAT NOBODY'S WORDS MAY BE (#10375):
 * where each field stands, what OneUptime AI may draft of it - never a
 * person's words, a confirmed draft only as a proposal once a fact it rests
 * on changed - what a person's press does, and the recipients and
 * transfers plain code works out from the store's flows and regions.
 */

const NOW: Date = new Date("2026-11-23T10:00:00.000Z");
const DRAFTED_AT: string = "2026-11-22T08:00:00.000Z";
const STORE_ID: string = "10375000-0000-4000-8000-00000000a001";
const COPY_ID: string = "10375000-0000-4000-8000-00000000a002";
const SERVICE_ID: string = "10375000-0000-4000-8000-00000000b001";
const OTHER_SERVICE_ID: string = "10375000-0000-4000-8000-00000000b002";

const HOLDS: ComplianceFact = {
  id: "F1",
  key: "store:holds",
  kind: ComplianceFactKind.StoreHolds,
  dataTypes: ["Email address", "Postal address"],
  categories: ["Contact and identity"],
  sensitivity: "Confidential",
  records: 12000,
};

const CHECKOUT: ComplianceFact = {
  id: "F2",
  key: `service:${SERVICE_ID}`,
  kind: ComplianceFactKind.ServiceUse,
  service: "checkout",
  description: "Takes customers' orders",
};

const FACTS: Array<ComplianceFact> = [HOLDS, CHECKOUT];

function draftOf(
  value: RecordFieldValue,
  keys: Array<string>,
  facts: ReadonlyArray<ComplianceFact> = FACTS,
  draftedAt: string = DRAFTED_AT,
): RecordFieldDraft {
  return {
    value,
    reason: "",
    factKeys: keys,
    factsHash: getFactsHash({ facts, keys }),
    draftedAt,
    language: "en",
  };
}

function draftsWith(
  field: RecordField,
  state: StoreRecordDrafts["fields"][RecordField],
  facts: Array<ComplianceFact> = FACTS,
): StoreRecordDrafts {
  return { ...emptyStoreRecordDrafts(), facts, fields: { [field]: state } };
}

function done(result: RecordFieldActionResult): {
  value?: RecordFieldValue | null | undefined;
  drafts: StoreRecordDrafts;
} {
  if (!result.isDone) {
    throw new Error(`Refused: ${result.refusal}`);
  }

  return result;
}

const PURPOSE: string = "Customer orders, for fulfilment and support";

describe("where a field of the record stands", () => {
  test("an empty field is Empty, or Drafted while OneUptime AI's draft waits", () => {
    expect(getRecordFieldStatus({ value: "" })).toBe(RecordFieldStatus.Empty);
    expect(
      getRecordFieldStatus({
        value: "",
        state: { draft: draftOf(PURPOSE, [HOLDS.key]) },
      }),
    ).toBe(RecordFieldStatus.Drafted);
  });

  test("what plain code fills in stands before any draft", () => {
    expect(
      getRecordFieldStatus({
        value: "",
        state: { draft: draftOf("30 days", [HOLDS.key]) },
        isFilledIn: true,
      }),
    ).toBe(RecordFieldStatus.FilledIn);
  });

  test("a value is Confirmed while it is the draft a person confirmed, and a change proposed beside it says so", () => {
    const confirmed: StoreRecordDrafts = done(
      applyRecordFieldAction({
        field: RecordField.Purpose,
        action: RecordFieldAction.Confirm,
        value: "",
        drafts: draftsWith(RecordField.Purpose, {
          draft: draftOf(PURPOSE, [HOLDS.key]),
        }),
        facts: FACTS,
        now: NOW,
      }),
    ).drafts;

    expect(
      getRecordFieldStatus({
        value: PURPOSE,
        state: confirmed.fields[RecordField.Purpose],
      }),
    ).toBe(RecordFieldStatus.Confirmed);
    expect(
      getRecordFieldStatus({
        value: PURPOSE,
        state: {
          ...confirmed.fields[RecordField.Purpose],
          proposed: draftOf("Orders and returns", [HOLDS.key]),
        },
      }),
    ).toBe(RecordFieldStatus.ChangeProposed);
  });

  test("a value nobody confirmed, or one a person changed after confirming, is the person's own", () => {
    expect(getRecordFieldStatus({ value: "Payroll" })).toBe(
      RecordFieldStatus.Written,
    );
    expect(
      getRecordFieldStatus({
        value: "Payroll, and tax filings",
        state: {
          confirmed: {
            valueHash: getRecordValueHash("Payroll"),
            factKeys: [HOLDS.key],
            factsHash: getFactsHash({ facts: FACTS, keys: [HOLDS.key] }),
            facts: [HOLDS],
            confirmedAt: DRAFTED_AT,
          },
        },
      }),
    ).toBe(RecordFieldStatus.Written);
  });

  test("a draft and a proposed change wait for a person; nothing else does", () => {
    expect(isRecordFieldToReview(RecordFieldStatus.Drafted)).toBe(true);
    expect(isRecordFieldToReview(RecordFieldStatus.ChangeProposed)).toBe(true);

    for (const status of [
      RecordFieldStatus.Empty,
      RecordFieldStatus.Confirmed,
      RecordFieldStatus.Written,
      RecordFieldStatus.FilledIn,
    ]) {
      expect(isRecordFieldToReview(status)).toBe(false);
    }
  });
});

describe("what OneUptime AI may draft of a field", () => {
  const inputHash: string = "input-now";

  test("never a person's words, nor what plain code fills in - not even when a person presses Draft Again", () => {
    for (const status of [
      RecordFieldStatus.Written,
      RecordFieldStatus.FilledIn,
    ]) {
      expect(
        getRecordFieldDraftAction({
          status,
          facts: FACTS,
          previousInputHash: "input-before",
          inputHash,
          force: true,
        }),
      ).toBe(RecordFieldDraftAction.Leave);
    }
  });

  test("an empty field is drafted; a waiting draft again only when what it was drafted from changed, or a person asks", () => {
    expect(
      getRecordFieldDraftAction({
        status: RecordFieldStatus.Empty,
        facts: FACTS,
        inputHash,
      }),
    ).toBe(RecordFieldDraftAction.Draft);
    expect(
      getRecordFieldDraftAction({
        status: RecordFieldStatus.Drafted,
        facts: FACTS,
        previousInputHash: inputHash,
        inputHash,
      }),
    ).toBe(RecordFieldDraftAction.Leave);
    expect(
      getRecordFieldDraftAction({
        status: RecordFieldStatus.Drafted,
        facts: FACTS,
        previousInputHash: "input-before",
        inputHash,
      }),
    ).toBe(RecordFieldDraftAction.Draft);
    expect(
      getRecordFieldDraftAction({
        status: RecordFieldStatus.Drafted,
        facts: FACTS,
        previousInputHash: inputHash,
        inputHash,
        force: true,
      }),
    ).toBe(RecordFieldDraftAction.Draft);
  });

  test("a confirmed field is proposed again only when a fact it rests on changed - never applied", () => {
    const state: StoreRecordDrafts["fields"][RecordField] = done(
      applyRecordFieldAction({
        field: RecordField.Purpose,
        action: RecordFieldAction.Confirm,
        value: "",
        drafts: draftsWith(RecordField.Purpose, {
          draft: draftOf(PURPOSE, [CHECKOUT.key]),
        }),
        facts: FACTS,
        now: NOW,
      }),
    ).drafts.fields[RecordField.Purpose];

    // Nothing it rests on changed: the confirmed value stands.
    expect(
      getRecordFieldDraftAction({
        status: RecordFieldStatus.Confirmed,
        state,
        facts: [{ ...HOLDS, records: 90000 }, CHECKOUT],
        inputHash,
        force: true,
      }),
    ).toBe(RecordFieldDraftAction.Leave);

    // The service it rests on now says something else: a change is proposed beside it.
    expect(
      getRecordFieldDraftAction({
        status: RecordFieldStatus.Confirmed,
        state,
        facts: [HOLDS, { ...CHECKOUT, description: "Bills customers" }],
        inputHash,
      }),
    ).toBe(RecordFieldDraftAction.Propose);

    // The service is gone: that is a change too.
    expect(
      getRecordFieldDraftAction({
        status: RecordFieldStatus.Confirmed,
        state,
        facts: [HOLDS],
        inputHash,
      }),
    ).toBe(RecordFieldDraftAction.Propose);
  });

  test("a proposal is drafted again only when its facts changed since it was proposed", () => {
    const changed: Array<ComplianceFact> = [
      HOLDS,
      { ...CHECKOUT, description: "Bills customers" },
    ];
    const state: StoreRecordDrafts["fields"][RecordField] = {
      confirmed: {
        valueHash: getRecordValueHash(PURPOSE),
        factKeys: [CHECKOUT.key],
        factsHash: getFactsHash({ facts: FACTS, keys: [CHECKOUT.key] }),
        facts: [CHECKOUT],
        confirmedAt: DRAFTED_AT,
      },
      proposed: draftOf("Customer billing", [CHECKOUT.key], changed),
    };

    expect(
      getRecordFieldDraftAction({
        status: RecordFieldStatus.ChangeProposed,
        state,
        facts: changed,
        inputHash,
      }),
    ).toBe(RecordFieldDraftAction.Leave);
    expect(
      getRecordFieldDraftAction({
        status: RecordFieldStatus.ChangeProposed,
        state,
        facts: [HOLDS],
        inputHash,
      }),
    ).toBe(RecordFieldDraftAction.Propose);
  });

  test("says which facts changed under a confirmed value, a vanished one among them", () => {
    expect(
      getChangedFactKeys({
        previous: FACTS,
        current: [{ ...HOLDS }, { ...CHECKOUT, id: "F9" }],
        keys: [HOLDS.key, CHECKOUT.key],
      }),
    ).toEqual([]);
    expect(
      getChangedFactKeys({
        previous: FACTS,
        current: [{ ...HOLDS, records: 40000 }],
        keys: [HOLDS.key, CHECKOUT.key],
      }),
    ).toEqual([HOLDS.key, CHECKOUT.key]);
  });
});

describe("a person's press on a field", () => {
  test("Confirm puts the draft the person was shown into the record, and keeps what it rested on", () => {
    const result: {
      value?: RecordFieldValue | null | undefined;
      drafts: StoreRecordDrafts;
    } = done(
      applyRecordFieldAction({
        field: RecordField.LegalBasis,
        action: RecordFieldAction.Confirm,
        value: "",
        drafts: draftsWith(RecordField.LegalBasis, {
          draft: draftOf(RecordLegalBasis.Contract, [CHECKOUT.key]),
        }),
        facts: FACTS,
        shownDraftedAt: DRAFTED_AT,
        userId: "user-1",
        now: NOW,
      }),
    );

    expect(result.value).toBe(RecordLegalBasis.Contract);
    expect(result.drafts.fields[RecordField.LegalBasis]).toEqual({
      confirmed: {
        valueHash: getRecordValueHash(RecordLegalBasis.Contract),
        factKeys: [CHECKOUT.key],
        factsHash: getFactsHash({ facts: FACTS, keys: [CHECKOUT.key] }),
        facts: [CHECKOUT],
        confirmedAt: NOW.toISOString(),
        confirmedByUserId: "user-1",
      },
    });
  });

  test("Confirm refuses a draft drafted again since the person saw it, and a field that holds a person's words", () => {
    expect(
      applyRecordFieldAction({
        field: RecordField.Purpose,
        action: RecordFieldAction.Confirm,
        value: "",
        drafts: draftsWith(RecordField.Purpose, {
          draft: draftOf(PURPOSE, [HOLDS.key], FACTS, NOW.toISOString()),
        }),
        facts: FACTS,
        shownDraftedAt: DRAFTED_AT,
        now: NOW,
      }),
    ).toEqual({ isDone: false, refusal: RECORD_DRAFT_GONE_MESSAGE });
    expect(
      applyRecordFieldAction({
        field: RecordField.Purpose,
        action: RecordFieldAction.Confirm,
        value: "Their own words",
        drafts: draftsWith(RecordField.Purpose, {
          draft: draftOf(PURPOSE, [HOLDS.key]),
        }),
        facts: FACTS,
        now: NOW,
      }),
    ).toEqual({ isDone: false, refusal: RECORD_DRAFT_GONE_MESSAGE });
  });

  test("Write puts the person's words in and leaves nothing of OneUptime AI's beside them", () => {
    const result: {
      value?: RecordFieldValue | null | undefined;
      drafts: StoreRecordDrafts;
    } = done(
      applyRecordFieldAction({
        field: RecordField.People,
        action: RecordFieldAction.Write,
        value: "",
        drafts: draftsWith(RecordField.People, {
          draft: draftOf([RecordPeople.Customers], [HOLDS.key]),
        }),
        facts: FACTS,
        written: [RecordPeople.Employees, RecordPeople.Employees],
        now: NOW,
      }),
    );

    expect(result.value).toEqual([RecordPeople.Employees]);
    expect(result.drafts.fields[RecordField.People]).toBeUndefined();
    // From now on, it is never drafted.
    expect(
      getRecordFieldDraftAction({
        status: getRecordFieldStatus({
          value: [RecordPeople.Employees],
          state: result.drafts.fields[RecordField.People],
        }),
        facts: FACTS,
        inputHash: "any",
        force: true,
      }),
    ).toBe(RecordFieldDraftAction.Leave);
  });

  test("Write refuses what the record does not hold, and empties a field with nothing", () => {
    expect(readWrittenRecordValue(RecordField.LegalBasis, "Because")).toEqual({
      isRead: false,
      refusal: RECORD_VALUE_NOT_ALLOWED_MESSAGE,
    });
    expect(readWrittenRecordValue(RecordField.People, ["Robots"])).toEqual({
      isRead: false,
      refusal: RECORD_VALUE_NOT_ALLOWED_MESSAGE,
    });
    expect(
      readWrittenRecordValue(
        RecordField.Purpose,
        "x".repeat(RECORD_PURPOSE_MAX_LENGTH + 1),
      ),
    ).toEqual({ isRead: false, refusal: RECORD_VALUE_TOO_LONG_MESSAGE });
    expect(readWrittenRecordValue(RecordField.Retention, "   ")).toEqual({
      isRead: true,
      value: null,
    });
    expect(readWrittenRecordValue(RecordField.People, [])).toEqual({
      isRead: true,
      value: null,
    });
  });

  test("Use New Draft takes the proposal; Keep Current keeps the value, now resting on the facts as they are", () => {
    const changed: Array<ComplianceFact> = [
      HOLDS,
      { ...CHECKOUT, description: "Bills customers" },
    ];
    const drafts: StoreRecordDrafts = draftsWith(
      RecordField.Purpose,
      {
        confirmed: {
          valueHash: getRecordValueHash(PURPOSE),
          factKeys: [CHECKOUT.key],
          factsHash: getFactsHash({ facts: FACTS, keys: [CHECKOUT.key] }),
          facts: [CHECKOUT],
          confirmedAt: DRAFTED_AT,
        },
        proposed: draftOf("Customer billing", [CHECKOUT.key], changed),
      },
      changed,
    );

    const used: {
      value?: RecordFieldValue | null | undefined;
      drafts: StoreRecordDrafts;
    } = done(
      applyRecordFieldAction({
        field: RecordField.Purpose,
        action: RecordFieldAction.UseProposal,
        value: PURPOSE,
        drafts,
        facts: changed,
        shownDraftedAt: DRAFTED_AT,
        now: NOW,
      }),
    );

    expect(used.value).toBe("Customer billing");
    expect(
      getRecordFieldStatus({
        value: "Customer billing",
        state: used.drafts.fields[RecordField.Purpose],
      }),
    ).toBe(RecordFieldStatus.Confirmed);

    const kept: {
      value?: RecordFieldValue | null | undefined;
      drafts: StoreRecordDrafts;
    } = done(
      applyRecordFieldAction({
        field: RecordField.Purpose,
        action: RecordFieldAction.KeepConfirmed,
        value: PURPOSE,
        drafts,
        facts: changed,
        now: NOW,
      }),
    );

    // The column does not change, and nothing is proposed until the facts change again.
    expect(kept.value).toBeUndefined();
    expect(
      getRecordFieldStatus({
        value: PURPOSE,
        state: kept.drafts.fields[RecordField.Purpose],
      }),
    ).toBe(RecordFieldStatus.Confirmed);
    expect(
      getRecordFieldDraftAction({
        status: RecordFieldStatus.Confirmed,
        state: kept.drafts.fields[RecordField.Purpose],
        facts: changed,
        inputHash: "any",
      }),
    ).toBe(RecordFieldDraftAction.Leave);
  });

  test("Use New Draft and Keep Current refuse a field with no change waiting", () => {
    for (const action of [
      RecordFieldAction.UseProposal,
      RecordFieldAction.KeepConfirmed,
    ]) {
      expect(
        applyRecordFieldAction({
          field: RecordField.Purpose,
          action,
          value: PURPOSE,
          drafts: emptyStoreRecordDrafts(),
          facts: FACTS,
          now: NOW,
        }),
      ).toEqual({ isDone: false, refusal: RECORD_NO_PROPOSAL_MESSAGE });
    }
  });
});

describe("the drafts a store keeps, read back", () => {
  test("round-trip through the column, and anything else reads as none", () => {
    const drafts: StoreRecordDrafts = draftsWith(RecordField.Retention, {
      draft: draftOf("Two years after an account is closed", [HOLDS.key]),
    });

    expect(readStoreRecordDrafts(toStoreRecordDraftsJson(drafts))).toEqual(
      drafts,
    );
    expect(readStoreRecordDrafts({ fields: "nope" })).toEqual(
      emptyStoreRecordDrafts(),
    );
    expect(readStoreRecordDrafts(null)).toEqual(emptyStoreRecordDrafts());
  });
});

describe("who receives a store's data", () => {
  const serviceNames: Map<string, string> = new Map([
    [SERVICE_ID, "checkout"],
    [OTHER_SERVICE_ID, "search"],
  ]);
  const storeNames: Map<string, string> = new Map([
    [STORE_ID, "orders-db"],
    [COPY_ID, "orders-analytics"],
  ]);

  test("the hosts and AI providers the services using it call, its own data's AI provider and its copies - not what other services call", () => {
    const recipients: Array<RecordRecipient> = getRecordRecipients({
      store: { id: STORE_ID, name: "orders-db" },
      flows: [
        { kind: "Uses", sourceDataStoreId: STORE_ID, serviceId: SERVICE_ID },
        {
          kind: "External Host",
          serviceId: SERVICE_ID,
          destination: "api.stripe.com",
        },
        {
          kind: "External Host",
          serviceId: SERVICE_ID,
          destination: "api.stripe.com",
        },
        {
          kind: "External Host",
          serviceId: OTHER_SERVICE_ID,
          destination: "api.algolia.com",
        },
        {
          kind: "AI Provider",
          serviceId: SERVICE_ID,
          destination: "OpenAI",
        },
        {
          kind: "Copy",
          sourceDataStoreId: STORE_ID,
          destinationDataStoreId: COPY_ID,
        },
      ],
      storeNames,
      serviceNames,
    });

    expect(recipients).toEqual([
      {
        kind: RecordRecipientKind.ExternalHost,
        name: "api.stripe.com",
        via: ["checkout"],
      },
      {
        kind: RecordRecipientKind.AiProvider,
        name: "OpenAI",
        via: ["checkout"],
      },
      {
        kind: RecordRecipientKind.Copy,
        name: "orders-analytics",
        via: [],
        dataStoreId: COPY_ID,
      },
    ]);
    expect(recipients.map(describeRecordRecipient)).toEqual([
      "api.stripe.com (outside host, via checkout)",
      "OpenAI (AI provider, via checkout)",
      "orders-analytics (copy)",
    ]);
  });

  test("a store no service uses and nothing copies has none", () => {
    expect(
      getRecordRecipients({
        store: { id: STORE_ID, name: "orders-db" },
        flows: [
          {
            kind: "External Host",
            serviceId: SERVICE_ID,
            destination: "api.stripe.com",
          },
        ],
        storeNames,
        serviceNames,
      }),
    ).toEqual([]);
  });
});

describe("where a store's data goes outside its people's countries", () => {
  test("data about people in the EEA kept in the EEA goes nowhere", () => {
    expect(
      getRecordTransfers({
        store: {
          id: STORE_ID,
          name: "orders-db",
          region: "eu-west-1",
          replicationRegions: ["europe-west3"],
          subjectCountries: ["DE", "FR"],
        },
        copies: [{ name: "orders-eu", region: "eu" }],
      }),
    ).toEqual({ transfers: [], unknownBecause: null });
  });

  test("the store's own region, where its cloud copies it, and its copies elsewhere are each a transfer", () => {
    const transfers: RecordTransfers = getRecordTransfers({
      store: {
        id: STORE_ID,
        name: "orders-db",
        region: "us-east-1",
        replicationRegions: ["us-west-2", "eu-west-1"],
        subjectCountries: ["de", "BR"],
      },
      copies: [{ name: "orders-analytics", region: "ap-south-1" }],
    });

    expect(transfers.unknownBecause).toBeNull();
    expect(transfers.transfers).toEqual([
      {
        route: RecordTransferRoute.Store,
        fromCountries: ["BR", "DE"],
        toCountry: "US",
        toRegion: "us-east-1",
        leavesEea: true,
      },
      {
        route: RecordTransferRoute.Replication,
        fromCountries: ["BR", "DE"],
        toCountry: "US",
        toRegion: "us-west-2",
        leavesEea: true,
      },
      // Brazilian people's data in Ireland leaves Brazil; Germans' stays in the EEA.
      {
        route: RecordTransferRoute.Replication,
        fromCountries: ["BR"],
        toCountry: "IE",
        toRegion: "eu-west-1",
        leavesEea: false,
      },
      {
        route: RecordTransferRoute.Copy,
        fromCountries: ["BR", "DE"],
        toCountry: "IN",
        toRegion: "ap-south-1",
        leavesEea: true,
        copyStoreName: "orders-analytics",
      },
    ]);
    expect(describeRecordTransfer(transfers.transfers[3]!)).toBe(
      "Brazil, Germany to India (ap-south-1, in orders-analytics)",
    );
  });

  test("says why, rather than guessing, when the people's countries or the store's region are not known", () => {
    expect(
      getRecordTransfers({
        store: { id: STORE_ID, name: "orders-db", region: "us-east-1" },
        copies: [],
      }),
    ).toEqual({
      transfers: [],
      unknownBecause: RecordTransfersUnknownReason.NoSubjectCountries,
    });
    expect(
      getRecordTransfers({
        store: {
          id: STORE_ID,
          name: "orders-db",
          region: "on-prem-rack-4",
          subjectCountries: ["DE"],
        },
        copies: [],
      }),
    ).toEqual({
      transfers: [],
      unknownBecause: RecordTransfersUnknownReason.UnknownRegion,
    });
  });
});
