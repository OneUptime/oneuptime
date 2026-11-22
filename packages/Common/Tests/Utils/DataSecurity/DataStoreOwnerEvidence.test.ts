import {
  DataStoreOwnerCandidate,
  DataStoreOwnerEvidence,
  DataStoreOwnerEvidenceSource,
  DataStoreOwnerKind,
  DataStoreOwnerUnmatched,
} from "../../../Types/DataSecurity/DataStoreOwnerProposal";
import {
  assembleDataStoreOwnerEvidence,
  DataStoreOwnerDirectory,
  DataStoreOwnerEvidenceSet,
  DataStoreOwnerFacts,
  DataStoreReadGrant,
  MAX_OWNER_CHANGE_ACTORS,
} from "../../../Utils/DataSecurity/DataStoreOwnerEvidence";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO THE EVIDENCE OF A STORE'S OWNERS NAMES (#10374): each source - its
 * cloud tags, the services that use it, the code owners of the file that
 * declares it, who changed it, who added it - mapped to the project's own
 * people and teams by plain code, and whether each can open the store.
 */

const PAYMENTS_ID: string = "10374000-0000-4000-8000-00000000a001";
const CHECKOUT_ID: string = "10374000-0000-4000-8000-00000000a002";
const PLATFORM_ID: string = "10374000-0000-4000-8000-00000000a003";
const PAYMENTS_EU_ID: string = "10374000-0000-4000-8000-00000000a004";
const PAYMENTS_TOO_ID: string = "10374000-0000-4000-8000-00000000a005";
const ALICE_ID: string = "10374000-0000-4000-8000-00000000b001";
const BOB_ID: string = "10374000-0000-4000-8000-00000000b002";
const PCI_LABEL: string = "10374000-0000-4000-8000-00000000d001";

function directory(
  grantsByTeam: Map<string, Array<DataStoreReadGrant>> = new Map([
    [PAYMENTS_ID, [{ labelIds: [], isBlock: false }]],
  ]),
): DataStoreOwnerDirectory {
  return new DataStoreOwnerDirectory({
    people: [
      {
        id: ALICE_ID,
        name: "Alice Example",
        email: "alice@acme.com",
        teamIds: [PAYMENTS_ID],
      },
      {
        id: BOB_ID,
        name: "",
        email: "bob@acme.com",
        teamIds: [CHECKOUT_ID],
      },
    ],
    teams: [
      { id: PAYMENTS_ID, name: "Payments" },
      { id: CHECKOUT_ID, name: "Checkout Team" },
      { id: PLATFORM_ID, name: "Platform" },
      { id: PAYMENTS_EU_ID, name: "Payments EU" },
    ],
    grantsByTeam,
  });
}

function facts(overrides: Partial<DataStoreOwnerFacts>): DataStoreOwnerFacts {
  return {
    cloudTags: {},
    services: [],
    servicesUsingIt: 0,
    codeOwners: [],
    changes: [],
    addedByUserId: null,
    ...overrides,
  };
}

function assemble(
  overrides: Partial<DataStoreOwnerFacts>,
  storeLabelIds: Array<string> = [],
  grants?: Map<string, Array<DataStoreReadGrant>>,
): DataStoreOwnerEvidenceSet {
  return assembleDataStoreOwnerEvidence({
    facts: facts(overrides),
    directory: directory(grants),
    storeLabelIds,
  });
}

function refsOf(set: DataStoreOwnerEvidenceSet): Array<string> {
  return set.candidates.map((candidate: DataStoreOwnerCandidate): string => {
    return `${candidate.ref}=${candidate.name}`;
  });
}

describe("the project's people and teams", () => {
  test("a person by their email, in any case", () => {
    expect(directory().getPersonByEmail("Alice@ACME.com")?.id).toBe(ALICE_ID);
    expect(directory().getPersonByEmail("nobody@acme.com")).toBeNull();
  });

  test("a team by its name, a handle or the name without its last word", () => {
    expect(directory().getTeamByName("payments")?.id).toBe(PAYMENTS_ID);
    expect(directory().getTeamByName("@acme/checkout")?.id).toBe(CHECKOUT_ID);
    expect(directory().getTeamByName("checkout-team")?.id).toBe(CHECKOUT_ID);
    expect(directory().getTeamByName("payments-eu")?.id).toBe(PAYMENTS_EU_ID);
    expect(directory().getTeamByName("finance")).toBeNull();
  });

  test("a team's whole name wins over another's name without its last word", () => {
    const twoTeams: DataStoreOwnerDirectory = new DataStoreOwnerDirectory({
      people: [],
      teams: [
        { id: PAYMENTS_ID, name: "Payments" },
        { id: PAYMENTS_TOO_ID, name: "Payments Team" },
      ],
      grantsByTeam: new Map(),
    });

    expect(twoTeams.getTeamByName("payments")?.id).toBe(PAYMENTS_ID);
    expect(twoTeams.getTeamByName("@acme/payments-team")?.id).toBe(
      PAYMENTS_TOO_ID,
    );
  });

  test("a name two teams answer to alike names neither", () => {
    const twoTeams: DataStoreOwnerDirectory = new DataStoreOwnerDirectory({
      people: [],
      teams: [
        { id: PAYMENTS_ID, name: "Payments Squad" },
        { id: PAYMENTS_TOO_ID, name: "Payments Team" },
      ],
      grantsByTeam: new Map(),
    });

    expect(twoTeams.getTeamByName("payments")).toBeNull();
    expect(twoTeams.getTeamByName("payments squad")?.id).toBe(PAYMENTS_ID);
  });

  test("a person with no name goes by their email", () => {
    expect(
      directory().getName({ kind: DataStoreOwnerKind.User, id: BOB_ID }),
    ).toBe("bob@acme.com");
  });
});

describe("who can open the store", () => {
  test("a team whose permissions read data stores, for every store", () => {
    expect(directory().canTeamOpenStore(PAYMENTS_ID, [])).toBe(true);
    expect(directory().canTeamOpenStore(CHECKOUT_ID, [])).toBe(false);
  });

  test("a permission held for some labels reaches only the stores with one", () => {
    const grants: Map<string, Array<DataStoreReadGrant>> = new Map([
      [CHECKOUT_ID, [{ labelIds: [PCI_LABEL], isBlock: false }]],
    ]);

    expect(directory(grants).canTeamOpenStore(CHECKOUT_ID, [PCI_LABEL])).toBe(
      true,
    );
    expect(directory(grants).canTeamOpenStore(CHECKOUT_ID, [])).toBe(false);
  });

  test("a block on the store's labels takes it away", () => {
    const grants: Map<string, Array<DataStoreReadGrant>> = new Map([
      [
        PAYMENTS_ID,
        [
          { labelIds: [], isBlock: false },
          { labelIds: [PCI_LABEL], isBlock: true },
        ],
      ],
    ]);

    expect(directory(grants).canTeamOpenStore(PAYMENTS_ID, [PCI_LABEL])).toBe(
      false,
    );
    expect(directory(grants).canTeamOpenStore(PAYMENTS_ID, [])).toBe(true);
  });

  test("a person, through any of their teams", () => {
    expect(
      directory().canOpenStore(
        { kind: DataStoreOwnerKind.User, id: ALICE_ID },
        [],
      ),
    ).toBe(true);
    expect(
      directory().canOpenStore(
        { kind: DataStoreOwnerKind.User, id: BOB_ID },
        [],
      ),
    ).toBe(false);
  });
});

describe("a store's cloud tags", () => {
  test("a team tag names the team", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      cloudTags: { team: "payments", env: "prod" },
    });

    expect(set.evidence).toEqual([
      {
        id: "E1",
        source: DataStoreOwnerEvidenceSource.CloudTag,
        tagKey: "team",
        tagValue: "payments",
        owners: [{ kind: DataStoreOwnerKind.Team, id: PAYMENTS_ID }],
        unmatched: undefined,
      },
    ]);
    expect(refsOf(set)).toEqual(["T1=Payments"]);
  });

  test("an owner tag that holds an email names the member with it", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      cloudTags: { owner: "Alice@acme.com" },
    });

    expect(set.evidence[0]!.owners).toEqual([
      { kind: DataStoreOwnerKind.User, id: ALICE_ID },
    ]);
    expect(refsOf(set)).toEqual(["P1=Alice Example"]);
  });

  test("a tag that lists two teams names both", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      cloudTags: { owners: "payments, platform" },
    });

    expect(refsOf(set)).toEqual(["T1=Payments", "T2=Platform"]);
  });

  test("a tag that names nobody the project knows says so", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      cloudTags: { team: "finance", contact: "carol@acme.com" },
    });

    expect(
      set.evidence.map((item: DataStoreOwnerEvidence) => {
        return [item.tagKey, item.unmatched];
      }),
    ).toEqual([
      ["contact", DataStoreOwnerUnmatched.NoMemberWithEmail],
      ["team", DataStoreOwnerUnmatched.NoTeamNamed],
    ]);
    expect(set.candidates).toEqual([]);
  });
});

describe("the services that use it", () => {
  test("a service's owners are the store's candidates, the service named", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      services: [
        {
          serviceId: "10374000-0000-4000-8000-00000000c001",
          serviceName: "checkout",
          isTelemetry: false,
          ownerUserIds: [BOB_ID],
          ownerTeamIds: [CHECKOUT_ID],
        },
      ],
      servicesUsingIt: 1,
    });

    expect(set.evidence[0]).toMatchObject({
      source: DataStoreOwnerEvidenceSource.ServiceOwners,
      serviceName: "checkout",
      owners: [
        { kind: DataStoreOwnerKind.Team, id: CHECKOUT_ID },
        { kind: DataStoreOwnerKind.User, id: BOB_ID },
      ],
    });
    expect(refsOf(set)).toEqual(["T1=Checkout Team", "P1=bob@acme.com"]);
    expect(set.servicesUsingIt).toBe(1);
  });

  test("the service whose telemetry the store is comes first", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      services: [
        {
          serviceId: "10374000-0000-4000-8000-00000000c001",
          serviceName: "checkout",
          isTelemetry: false,
          ownerUserIds: [],
          ownerTeamIds: [CHECKOUT_ID],
        },
        {
          serviceId: "10374000-0000-4000-8000-00000000c002",
          serviceName: "payments-api",
          isTelemetry: true,
          ownerUserIds: [],
          ownerTeamIds: [PAYMENTS_ID],
        },
      ],
    });

    expect(set.evidence[0]).toMatchObject({
      serviceName: "payments-api",
      isServiceTelemetry: true,
    });
  });

  test("a service with no owners, or owners who left, says so", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      services: [
        {
          serviceId: "10374000-0000-4000-8000-00000000c003",
          serviceName: "legacy-batch",
          isTelemetry: false,
          ownerUserIds: ["10374000-0000-4000-8000-00000000b099"],
          ownerTeamIds: [],
        },
      ],
    });

    expect(set.evidence[0]).toMatchObject({
      owners: [],
      unmatched: DataStoreOwnerUnmatched.ServiceHasNoOwners,
    });
    expect(set.candidates).toEqual([]);
  });
});

describe("the code owners of the file that declares it", () => {
  test("each owner a piece of evidence: a team by its handle, a member by email", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      codeOwners: [
        {
          repositoryName: "acme/infra",
          filePath: "s3/ledger.tf",
          codeOwnersPath: ".github/CODEOWNERS",
          owners: [
            "@acme/payments",
            "alice@acme.com",
            "@acme/finance",
            "@carol",
          ],
        },
      ],
    });

    expect(
      set.evidence.map((item: DataStoreOwnerEvidence) => {
        return [item.codeOwner, item.owners.length, item.unmatched];
      }),
    ).toEqual([
      ["@acme/payments", 1, undefined],
      ["alice@acme.com", 1, undefined],
      ["@acme/finance", 0, DataStoreOwnerUnmatched.NoTeamNamed],
      ["@carol", 0, DataStoreOwnerUnmatched.UnknownHandle],
    ]);
    expect(set.evidence[0]).toMatchObject({
      repositoryName: "acme/infra",
      filePath: "s3/ledger.tf",
      codeOwnersPath: ".github/CODEOWNERS",
    });
    expect(refsOf(set)).toEqual(["T1=Payments", "P1=Alice Example"]);
  });
});

describe("who changed it", () => {
  test("a member the change log names by email, with what they did", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      changes: [
        {
          actor:
            "arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_Admin/alice@acme.com",
          operation: "s3:PutBucketPolicy",
          changeCount: 3,
          lastChangedAt: "2026-11-01T10:00:00.000Z",
        },
      ],
    });

    expect(set.evidence).toEqual([
      {
        id: "E1",
        source: DataStoreOwnerEvidenceSource.ChangedBy,
        operation: "s3:PutBucketPolicy",
        changeCount: 3,
        lastChangedAt: "2026-11-01T10:00:00.000Z",
        owners: [{ kind: DataStoreOwnerKind.User, id: ALICE_ID }],
      },
    ]);
  });

  test("a role, an automation or an outsider says nothing of who owns it", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      changes: [
        {
          actor: "arn:aws:iam::123456789012:role/terraform-apply",
          operation: "s3:CreateBucket",
          changeCount: 1,
          lastChangedAt: "",
        },
        {
          actor: "contractor@elsewhere.com",
          operation: "s3:PutBucketTagging",
          changeCount: 1,
          lastChangedAt: "",
        },
      ],
    });

    expect(set.evidence).toEqual([]);
  });

  test("each member once, and no more than a few", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      changes: [
        {
          actor: "alice@acme.com",
          operation: "a",
          changeCount: 5,
          lastChangedAt: "",
        },
        {
          actor: "ALICE@acme.com",
          operation: "b",
          changeCount: 1,
          lastChangedAt: "",
        },
        {
          actor: "bob@acme.com",
          operation: "c",
          changeCount: 1,
          lastChangedAt: "",
        },
      ],
    });

    expect(set.evidence).toHaveLength(2);
    expect(set.evidence.length).toBeLessThanOrEqual(MAX_OWNER_CHANGE_ACTORS);
  });
});

describe("who added it to OneUptime", () => {
  test("a member who added it", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      addedByUserId: ALICE_ID,
    });

    expect(set.evidence).toEqual([
      {
        id: "E1",
        source: DataStoreOwnerEvidenceSource.AddedBy,
        owners: [{ kind: DataStoreOwnerKind.User, id: ALICE_ID }],
      },
    ]);
  });

  test("someone who has left the project is no evidence", () => {
    expect(
      assemble({ addedByUserId: "10374000-0000-4000-8000-00000000b099" })
        .evidence,
    ).toEqual([]);
  });
});

describe("the candidates", () => {
  test("teams first, then people, each in the order the evidence names them, with all that names them", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      cloudTags: { owner: "alice@acme.com", team: "payments" },
      services: [
        {
          serviceId: "10374000-0000-4000-8000-00000000c001",
          serviceName: "checkout",
          isTelemetry: false,
          ownerUserIds: [],
          ownerTeamIds: [CHECKOUT_ID, PAYMENTS_ID],
        },
      ],
      addedByUserId: ALICE_ID,
    });

    expect(
      set.candidates.map((candidate: DataStoreOwnerCandidate) => {
        return [candidate.ref, candidate.name, candidate.evidenceIds];
      }),
    ).toEqual([
      ["T1", "Payments", ["E2", "E3"]],
      ["T2", "Checkout Team", ["E3"]],
      ["P1", "Alice Example", ["E1", "E4"]],
    ]);
  });

  test("each says whether it can open the store", () => {
    const set: DataStoreOwnerEvidenceSet = assemble({
      cloudTags: { owners: "payments, checkout-team" },
    });

    expect(
      set.candidates.map((candidate: DataStoreOwnerCandidate) => {
        return [candidate.name, candidate.canOpenStore];
      }),
    ).toEqual([
      ["Payments", true],
      ["Checkout Team", false],
    ]);
  });

  test("a store nothing points to has no candidates", () => {
    expect(assemble({}).candidates).toEqual([]);
  });
});
