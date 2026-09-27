import Model from "../../../Models/DatabaseModels/Domain";
import { Service as DomainServiceType } from "../../../Server/Services/DomainService";
import Domain from "../../../Server/Types/Domain";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * A verified Domain is what lets a project serve a status page on its own
 * hostname. Verification is therefore an ownership proof, and the only thing
 * proving it is a TXT record the project had to be able to publish. Two rules
 * carry that, and neither can live in Postgres:
 *
 *   1. A CALLER CANNOT MARK ITS OWN DOMAIN VERIFIED. Not at create (where
 *      there is nothing to check against) and not at update without the DNS
 *      lookup actually passing. A caller that could set isVerified itself
 *      could claim a hostname it does not own.
 *
 *   2. THE VERIFICATION TEXT IS SERVER-GENERATED. If the caller chose it, it
 *      could pick a string already present in some TXT record it does not
 *      control, and the lookup would pass while proving nothing.
 *
 * Both have a deliberate exception each, and the exceptions are the part worth
 * pinning because they are what an over-eager tightening would break:
 *
 *   - ROOT bypasses verification. Internal callers create already-verified
 *     domains, so the guards are gated on `!props.isRoot` rather than applied
 *     to everyone.
 *   - TEST DOMAINS skip the DNS lookup. .test / .example.com and friends are
 *     IANA-reserved and cannot be given real DNS records, so the e2e suite
 *     could not verify a domain at all if they were not exempt.
 *
 * Also pinned: the domain is normalized before it is stored (a hostname
 * matched case-sensitively would not match the request that arrives
 * lowercased), the pre-read is tenant-scoped, and an update that does not
 * touch isVerified pays for no read at all.
 *
 * Nothing here touches DNS or Postgres: the hooks are invoked directly on a
 * fresh service instance whose reads are stubbed and whose TXT lookup is
 * mocked.
 */

const DOMAIN_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const VERIFICATION_TEXT: string = "oneuptime-verification-abcdefghij0123456789";

type ServiceInternals = {
  onBeforeCreate: (createBy: CreateBy<Model>) => Promise<OnCreate<Model>>;
  onBeforeUpdate: (updateBy: UpdateBy<Model>) => Promise<OnUpdate<Model>>;
};

/*
 * Typed loosely on purpose: jest.spyOn's SpiedFunction and this repo's
 * @types/jest disagree about the optionality of mock.lastCall, and nothing
 * below needs more than mockResolvedValue and the recorded calls.
 */
type Spy = {
  mockResolvedValue: (value: never) => unknown;
  mock: { calls: Array<Array<unknown>> };
};

interface Harness {
  internals: ServiceInternals;
  findBy: Spy;
}

let verifyTxtRecord: Spy;

beforeEach(() => {
  jest.restoreAllMocks();

  /*
   * Mocked rather than pointed at a real hostname: a test that resolves DNS
   * fails in a sandboxed runner and, worse, passes or fails on someone else's
   * zone file.
   */
  verifyTxtRecord = jest.spyOn(Domain, "verifyTxtRecord") as unknown as Spy;
  verifyTxtRecord.mockResolvedValue(true as never);
});

function buildService(rows: Array<Model> = []): Harness {
  const service: DomainServiceType = new DomainServiceType();

  const findBy: Spy = jest.spyOn(service, "findBy") as unknown as Spy;
  findBy.mockResolvedValue(rows as never);

  return {
    internals: service as unknown as ServiceInternals,
    findBy: findBy,
  };
}

function createBy(
  payload: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = {
    isRoot: false,
    tenantId: PROJECT_ID,
  },
): CreateBy<Model> {
  return {
    data: Object.assign(new Model(), payload) as Model,
    props: props,
  };
}

function updateBy(
  data: Record<string, unknown>,
  query: Record<string, unknown> = { _id: DOMAIN_ID.toString() },
  props: DatabaseCommonInteractionProps = {
    isRoot: false,
    tenantId: PROJECT_ID,
  },
): UpdateBy<Model> {
  return {
    query: query,
    data: data,
    props: props,
    limit: 10,
    skip: 0,
  } as unknown as UpdateBy<Model>;
}

/* A row as the pre-read sees it, with only the two columns it selects. */
function existingRow(
  domain: string | undefined,
  verificationText: string | undefined,
): Model {
  const row: Model = new Model(DOMAIN_ID);
  const values: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;

  values["domain"] = domain === undefined ? undefined : new Domain(domain);
  values["domainVerificationText"] = verificationText;

  return row;
}

function written(create: CreateBy<Model>): Record<string, unknown> {
  return create.data as unknown as Record<string, unknown>;
}

describe("a domain is normalized before it is stored", () => {
  test("case and surrounding whitespace are removed", async () => {
    /*
     * The hostname arrives from a Host header lowercased, so a row stored as
     * "Status.Example.Com" would never match the request it was created for.
     */
    const harness: Harness = buildService();
    const create: CreateBy<Model> = createBy({
      domain: "  Status.ACME.Com  ",
    });

    await harness.internals.onBeforeCreate(create);

    expect(String(written(create)["domain"])).toBe("status.acme.com");
  });

  test("an already-constructed Domain is accepted", async () => {
    // The API layer hands over a Domain; an internal caller hands a string.
    const harness: Harness = buildService();
    const create: CreateBy<Model> = createBy({
      domain: new Domain("status.acme.com"),
    });

    await harness.internals.onBeforeCreate(create);

    expect(String(written(create)["domain"])).toBe("status.acme.com");
  });

  test("anything that is neither a string nor a Domain is refused", async () => {
    /*
     * Refused rather than coerced: String({}) would store "[object Object]"
     * as a hostname, and Domain's own format check is the next thing that
     * would have to catch it.
     */
    const harness: Harness = buildService();
    const create: CreateBy<Model> = createBy({
      domain: { host: "status.acme.com" },
    });

    await expect(harness.internals.onBeforeCreate(create)).rejects.toThrow(
      BadDataException,
    );
  });
});

describe("the verification text is chosen by the server", () => {
  test("a create always gets one", async () => {
    const harness: Harness = buildService();
    const create: CreateBy<Model> = createBy({ domain: "status.acme.com" });

    await harness.internals.onBeforeCreate(create);

    expect(String(written(create)["domainVerificationText"])).toMatch(
      /^oneuptime-verification-.{20}$/,
    );
  });

  test("a client-supplied text is overwritten, not honoured", async () => {
    /*
     * The rule the ownership proof rests on. A caller that chose this string
     * could name something already published in a TXT record on a domain it
     * does not own, and the lookup would then pass while proving nothing.
     */
    const harness: Harness = buildService();
    const create: CreateBy<Model> = createBy({
      domain: "status.acme.com",
      domainVerificationText: "oneuptime-verification-attacker-chose-this",
    });

    await harness.internals.onBeforeCreate(create);

    expect(String(written(create)["domainVerificationText"])).not.toBe(
      "oneuptime-verification-attacker-chose-this",
    );
  });

  test("two domains never get the same text", async () => {
    const harness: Harness = buildService();
    const texts: Array<string> = [];

    for (const domain of ["one.acme.com", "two.acme.com"]) {
      const create: CreateBy<Model> = createBy({ domain: domain });
      await harness.internals.onBeforeCreate(create);
      texts.push(String(written(create)["domainVerificationText"]));
    }

    expect(new Set(texts).size).toBe(2);
  });
});

describe("a caller cannot create a domain already marked verified", () => {
  test("a real domain created with isVerified is refused", async () => {
    const harness: Harness = buildService();

    await expect(
      harness.internals.onBeforeCreate(
        createBy({ domain: "status.acme.com", isVerified: true }),
      ),
    ).rejects.toThrow(
      "Domain cannot be verified during creation. Please verify the domain after creation. Please set isVerified to false.",
    );
  });

  test.each([
    ["a .test domain", "status.acme.test"],
    ["an .example.com domain", "status.example.com"],
    ["an .example.org domain", "status.example.org"],
    ["an .example.net domain", "status.example.net"],
  ])("%s may be auto-verified", async (_label, domain) => {
    /*
     * These TLDs are IANA-reserved and cannot be given real DNS records, so
     * there is no TXT record to find. Without the exemption the e2e suite
     * could not verify a domain at all.
     */
    const harness: Harness = buildService();

    const result: OnCreate<Model> = await harness.internals.onBeforeCreate(
      createBy({ domain: domain, isVerified: true }),
    );

    expect(result.createBy).toBeDefined();
  });

  test("the test-domain exemption is decided AFTER normalization", async () => {
    /*
     * isTestDomain reads createBy.data.domain, which the hook has already
     * rewritten - so a mixed-case reserved domain has to be recognised. A
     * case-sensitive suffix check here would refuse a legitimate create.
     */
    const harness: Harness = buildService();

    const result: OnCreate<Model> = await harness.internals.onBeforeCreate(
      createBy({ domain: "Status.EXAMPLE.com", isVerified: true }),
    );

    expect(result.createBy).toBeDefined();
  });

  test("root may create an already-verified real domain", async () => {
    // Internal callers register domains that are verified by construction.
    const harness: Harness = buildService();

    const result: OnCreate<Model> = await harness.internals.onBeforeCreate(
      createBy(
        { domain: "status.acme.com", isVerified: true },
        {
          isRoot: true,
        },
      ),
    );

    expect(result.createBy).toBeDefined();
  });

  test("an ordinary create is untouched by the guard", async () => {
    const harness: Harness = buildService();

    const result: OnCreate<Model> = await harness.internals.onBeforeCreate(
      createBy({ domain: "status.acme.com" }),
    );

    expect(result.createBy).toBeDefined();
  });
});

describe("marking a domain verified requires the TXT record to be there", () => {
  test("a present record verifies the domain", async () => {
    const harness: Harness = buildService([
      existingRow("status.acme.com", VERIFICATION_TEXT),
    ]);

    const result: OnUpdate<Model> = await harness.internals.onBeforeUpdate(
      updateBy({ isVerified: true }),
    );

    expect(result.updateBy).toBeDefined();
  });

  test("the lookup is given the domain AND the text stored for it", async () => {
    /*
     * Both arguments matter: looking up the right domain for the wrong text,
     * or the reverse, would verify a domain against a record that proves
     * nothing about it.
     */
    const harness: Harness = buildService([
      existingRow("status.acme.com", VERIFICATION_TEXT),
    ]);

    await harness.internals.onBeforeUpdate(updateBy({ isVerified: true }));

    const call: Array<unknown> = verifyTxtRecord.mock.calls[0]!;

    expect(String(call[0])).toBe("status.acme.com");
    expect(call[1]).toBe(VERIFICATION_TEXT);
  });

  test("a missing record refuses the update and says which record to add", async () => {
    /*
     * The message carries the record and the domain because it is the only
     * instruction the user gets - a bare "not verified" leaves them nothing
     * to act on.
     */
    const harness: Harness = buildService([
      existingRow("status.acme.com", VERIFICATION_TEXT),
    ]);
    verifyTxtRecord.mockResolvedValue(false as never);

    await expect(
      harness.internals.onBeforeUpdate(updateBy({ isVerified: true })),
    ).rejects.toThrow(
      `Verification TXT record ${VERIFICATION_TEXT} not found in domain status.acme.com.`,
    );
  });

  test("ONE unverified domain fails an update that matches several", async () => {
    /*
     * The query can match more than one row. Verifying only the first would
     * let a caller mark an unowned domain verified by batching it behind one
     * it does own.
     */
    const harness: Harness = buildService([
      existingRow("owned.acme.com", VERIFICATION_TEXT),
      existingRow("not-owned.acme.com", VERIFICATION_TEXT),
    ]);
    verifyTxtRecord.mockResolvedValue(true as never);
    (
      verifyTxtRecord as unknown as {
        mockResolvedValueOnce: (v: unknown) => unknown;
      }
    ).mockResolvedValueOnce(true);
    (
      verifyTxtRecord as unknown as {
        mockResolvedValueOnce: (v: unknown) => unknown;
      }
    ).mockResolvedValueOnce(false);

    await expect(
      harness.internals.onBeforeUpdate(updateBy({ isVerified: true })),
    ).rejects.toThrow(BadDataException);
  });

  test("a test domain is verified without any DNS lookup", async () => {
    const harness: Harness = buildService([
      existingRow("status.acme.test", VERIFICATION_TEXT),
    ]);

    await harness.internals.onBeforeUpdate(updateBy({ isVerified: true }));

    expect(verifyTxtRecord.mock.calls).toHaveLength(0);
  });

  test("a row with no stored domain is refused", async () => {
    const harness: Harness = buildService([
      existingRow(undefined, VERIFICATION_TEXT),
    ]);

    await expect(
      harness.internals.onBeforeUpdate(updateBy({ isVerified: true })),
    ).rejects.toThrow("Domain not found.");
  });

  test("a row with no verification text is refused rather than passed empty", async () => {
    /*
     * An empty text handed to the lookup would ask DNS whether "" is present,
     * which is not a question that can prove ownership.
     */
    const harness: Harness = buildService([
      existingRow("status.acme.com", undefined),
    ]);

    await expect(
      harness.internals.onBeforeUpdate(updateBy({ isVerified: true })),
    ).rejects.toThrow(BadDataException);
    expect(verifyTxtRecord.mock.calls).toHaveLength(0);
  });

  test("root may verify without the lookup", async () => {
    const harness: Harness = buildService();

    await harness.internals.onBeforeUpdate(
      updateBy(
        { isVerified: true },
        { _id: DOMAIN_ID.toString() },
        {
          isRoot: true,
        },
      ),
    );

    expect(harness.findBy.mock.calls).toHaveLength(0);
    expect(verifyTxtRecord.mock.calls).toHaveLength(0);
  });
});

describe("the verification read is scoped and only paid for when needed", () => {
  test("it is scoped to the caller's project", async () => {
    /*
     * Tenant isolation on the read that feeds the check: without projectId the
     * query could match another project's row and verify it.
     */
    const harness: Harness = buildService([
      existingRow("status.acme.com", VERIFICATION_TEXT),
    ]);

    await harness.internals.onBeforeUpdate(updateBy({ isVerified: true }));

    const call: Record<string, unknown> = harness.findBy.mock
      .calls[0]![0] as Record<string, unknown>;
    const query: Record<string, unknown> = call["query"] as Record<
      string,
      unknown
    >;

    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("the project comes from the query when it carries one", async () => {
    const harness: Harness = buildService([
      existingRow("status.acme.com", VERIFICATION_TEXT),
    ]);

    await harness.internals.onBeforeUpdate(
      updateBy(
        { isVerified: true },
        {
          _id: DOMAIN_ID.toString(),
          projectId: PROJECT_ID.toString(),
        },
      ),
    );

    const query: Record<string, unknown> = (
      harness.findBy.mock.calls[0]![0] as Record<string, unknown>
    )["query"] as Record<string, unknown>;

    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
  });

  test("with no project anywhere the update is refused, not run unscoped", async () => {
    /*
     * The failure mode this prevents: an unscoped query matching every
     * project's domains.
     */
    const harness: Harness = buildService();

    await expect(
      harness.internals.onBeforeUpdate(
        updateBy(
          { isVerified: true },
          { _id: DOMAIN_ID.toString() },
          {
            isRoot: false,
          },
        ),
      ),
    ).rejects.toThrow("Project ID is required to verify the domain.");
    expect(harness.findBy.mock.calls).toHaveLength(0);
  });

  test("an update that does not touch isVerified reads nothing", async () => {
    /*
     * Renaming a domain, or any other patch, must not start paying for a read
     * and a DNS lookup it cannot be affected by.
     */
    const harness: Harness = buildService();

    await harness.internals.onBeforeUpdate(updateBy({ isVerified: false }));
    await harness.internals.onBeforeUpdate(updateBy({ description: "prod" }));

    expect(harness.findBy.mock.calls).toHaveLength(0);
    expect(verifyTxtRecord.mock.calls).toHaveLength(0);
  });
});
