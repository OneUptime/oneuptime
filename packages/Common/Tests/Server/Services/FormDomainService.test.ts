import FormDomainService from "../../../Server/Services/FormDomainService";
import DomainService from "../../../Server/Services/DomainService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import CertificateOwners from "../../../Server/Utils/Greenlock/CertificateOwners";
import GreenlockUtil from "../../../Server/Utils/Greenlock/Greenlock";
import RelationIdUtil from "../../../Server/Utils/Database/RelationIdUtil";
import { getCustomDomainInUseMessage } from "../../../Server/Utils/CustomDomain/CustomDomainConflicts";
import FormDomain from "../../../Models/DatabaseModels/FormDomain";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A form's own domain (FormDomain), its service's own rules - the
 * certificate steps it shares with the status page and dashboard domains
 * are held by CustomDomainCertificateLifecycle and the route suites:
 *
 *   - adding one: a verified domain of the project, a plain subdomain (or
 *     the domain's root), the full name worked out, a token of its own, and
 *     nothing ordered, verified or provisioned yet whatever the request said;
 *     the form named under either of its names; a name no other custom
 *     domain on the installation has;
 *   - its subdomain fixed once it is added;
 *   - finding the form a visit opens: by the name the request came to, only
 *     while the parent domain is verified, never on anything a caller names;
 *   - the CNAME check's token, answered for its own domain only;
 *   - removing one takes its certificate with it, unless something else on
 *     the installation still claims the name.
 *
 * The hooks run for real; the tables they read are stand-ins.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-f0f0-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-f0f0-4aaa-8bbb-0000000000e1");
const DOMAIN_ID: string = "0193c0de-f0f0-4aaa-8bbb-0000000000d1";
const FORM_ID: string = "0193c0de-f0f0-4aaa-8bbb-0000000000f1";
const OTHER_FORM_ID: string = "0193c0de-f0f0-4aaa-8bbb-0000000000f2";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TOKEN: string = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";

type Hooks = {
  onBeforeCreate: (createBy: unknown) => Promise<{
    createBy: { data: Record<string, unknown> };
  }>;
  onBeforeUpdate: (updateBy: unknown) => Promise<{
    updateBy: { data: Record<string, unknown> };
  }>;
  onDeleteSuccess: (
    onDelete: { carryForward: Array<{ fullDomain?: string }> },
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<unknown>;
};

const hooks: Hooks = FormDomainService as unknown as Hooks;

// The name each kind of custom domain has, for the conflict lookups.
let statusPageNames: Array<string> = [];
let dashboardNames: Array<string> = [];
let formNames: Array<string> = [];

type ConflictLookup = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
};

const conflictLookups: Array<{ kind: string; call: ConflictLookup }> = [];

function answerByName(
  kind: string,
  names: () => Array<string>,
): (call: ConflictLookup) => Promise<unknown> {
  return async (call: ConflictLookup): Promise<unknown> => {
    conflictLookups.push({ kind, call });

    const name: unknown = call.query["fullDomain"];

    return typeof name === "string" && names().includes(name)
      ? { _id: ObjectID.generate().toString() }
      : null;
  };
}

// The parent domain the create names: verified unless a test says.
let parentDomain: { domain: string; isVerified: boolean } | null = {
  domain: "ACME.com",
  isVerified: true,
};

beforeEach(() => {
  stubProjectDirectory({});

  statusPageNames = [];
  dashboardNames = [];
  formNames = [];
  conflictLookups.length = 0;
  parentDomain = { domain: "ACME.com", isVerified: true };

  jest.spyOn(DomainService, "findOneBy").mockImplementation((async () => {
    return parentDomain;
  }) as never);

  jest.spyOn(StatusPageDomainService, "findOneBy").mockImplementation(
    answerByName("status page", () => {
      return statusPageNames;
    }) as never,
  );
  jest.spyOn(DashboardDomainService, "findOneBy").mockImplementation(
    answerByName("dashboard", () => {
      return dashboardNames;
    }) as never,
  );
  jest.spyOn(FormDomainService, "findOneBy").mockImplementation(
    answerByName("form", () => {
      return formNames;
    }) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function create(
  data: Record<string, unknown>,
): Promise<{ createBy: { data: Record<string, unknown> } }> {
  return hooks.onBeforeCreate({
    data: {
      projectId: PROJECT_ID,
      formId: new ObjectID(FORM_ID),
      domainId: new ObjectID(DOMAIN_ID),
      ...data,
    },
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  });
}

async function refusal(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (err) {
    return err as Error;
  }

  throw new Error("expected a refusal");
}

describe("adding a form domain", () => {
  test("works out its full name from a plain subdomain and the verified domain, lower case", async () => {
    const result: { createBy: { data: Record<string, unknown> } } =
      await create({ subdomain: "  REPORT " });

    expect(result.createBy.data["subdomain"]).toBe("report");
    expect(result.createBy.data["fullDomain"]).toBe("report.acme.com");
  });

  test.each([[""], ["@"], ["  @  "], [undefined]])(
    "a subdomain of %j is the domain's root",
    async (subdomain: string | undefined) => {
      const result: { createBy: { data: Record<string, unknown> } } =
        await create(subdomain === undefined ? {} : { subdomain: subdomain });

      expect(result.createBy.data["subdomain"]).toBe("");
      expect(result.createBy.data["fullDomain"]).toBe("acme.com");
    },
  );

  test.each([
    ["a path and a fragment", "169.254.169.254/latest/meta-data/#"],
    ["a scheme", "http://report"],
    ["a port", "report:8080"],
    ["a space inside", "re port"],
  ])(
    "refuses a subdomain carrying %s, before any name is looked up",
    async (_label: string, subdomain: string) => {
      const error: Error = await refusal(create({ subdomain: subdomain }));

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toContain("is not valid");
      expect(conflictLookups).toHaveLength(0);
    },
  );

  test("refuses a domain that is not verified, or not there, in the words every custom domain uses", async () => {
    parentDomain = { domain: "acme.com", isVerified: false };

    const unverified: Error = await refusal(create({ subdomain: "report" }));

    parentDomain = null;

    const missing: Error = await refusal(create({ subdomain: "report" }));

    for (const error of [unverified, missing]) {
      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "This domain is not verified. Please verify it in Project Settings > Advanced > Domains.",
      );
    }

    expect(conflictLookups).toHaveLength(0);
  });

  test("reads the domain as root, by the id the create named under either name", async () => {
    const findOneBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DomainService,
      "findOneBy",
    );

    await hooks.onBeforeCreate({
      data: {
        projectId: PROJECT_ID,
        formId: new ObjectID(FORM_ID),
        domain: { _id: DOMAIN_ID },
        subdomain: "report",
      },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    const call: { query: Record<string, unknown>; props: unknown } = findOneBy
      .mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: unknown;
    };

    expect(call.query["_id"]).toBe(DOMAIN_ID);
    expect(call.props).toEqual({ isRoot: true });
  });

  test("gives the domain a token of its own, and starts it unverified with nothing ordered, whatever the request said", async () => {
    const result: { createBy: { data: Record<string, unknown> } } =
      await create({
        subdomain: "report",
        cnameVerificationToken: "chosen-by-the-caller",
        isCnameVerified: true,
        isSslOrdered: true,
        isSslProvisioned: true,
        certificateReissueRequestedAt: new Date(),
      });

    const data: Record<string, unknown> = result.createBy.data;

    expect(ObjectID.isValidUUID(String(data["cnameVerificationToken"]))).toBe(
      true,
    );
    expect(data["cnameVerificationToken"]).not.toBe("chosen-by-the-caller");
    expect(data["isCnameVerified"]).toBe(false);
    expect(data["isSslOrdered"]).toBe(false);
    expect(data["isSslProvisioned"]).toBe(false);
    expect(Object.keys(data)).not.toContain("certificateReissueRequestedAt");
  });

  test("two domains get two tokens", async () => {
    const first: { createBy: { data: Record<string, unknown> } } = await create(
      { subdomain: "report" },
    );
    const second: { createBy: { data: Record<string, unknown> } } =
      await create({ subdomain: "feedback" });

    expect(first.createBy.data["cnameVerificationToken"]).not.toBe(
      second.createBy.data["cnameVerificationToken"],
    );
  });

  test("the form named by the relation is kept in its id column", async () => {
    const result: { createBy: { data: Record<string, unknown> } } =
      await hooks.onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          form: { _id: FORM_ID },
          domainId: new ObjectID(DOMAIN_ID),
          subdomain: "report",
        },
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      });

    expect(String(result.createBy.data["formId"])).toBe(FORM_ID);
  });

  test("a form named differently under its two names is refused", async () => {
    const error: Error = await refusal(
      create({ subdomain: "report", form: { _id: OTHER_FORM_ID } }),
    );

    expect(error.message).toBe(
      RelationIdUtil.getConflictMessage("Form", ["formId", "form"]),
    );
  });

  test.each([
    ["a status page", "status page"],
    ["a dashboard", "dashboard"],
    ["another form", "form"],
  ])(
    "refuses a name %s already has, in any project, saying only that it is in use",
    async (_label: string, kind: string) => {
      if (kind === "status page") {
        statusPageNames = ["report.acme.com"];
      } else if (kind === "dashboard") {
        dashboardNames = ["report.acme.com"];
      } else {
        formNames = ["report.acme.com"];
      }

      const error: Error = await refusal(create({ subdomain: "Report" }));

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        getCustomDomainInUseMessage("report.acme.com"),
      );
      // Nothing about who has it: no project, no status page, no form.
      expect(error.message).not.toContain(PROJECT_ID.toString());
    },
  );

  test("looks the name up in every kind of custom domain, as root, for its id alone", async () => {
    await create({ subdomain: "report" });

    expect(
      conflictLookups.map((lookup: { kind: string }) => {
        return lookup.kind;
      }),
    ).toEqual(["status page", "dashboard", "form"]);

    for (const lookup of conflictLookups) {
      expect(lookup.call.query).toEqual({ fullDomain: "report.acme.com" });
      expect(lookup.call.select).toEqual({ _id: true });
      expect(lookup.call.props).toEqual({ isRoot: true });
    }
  });

  test("a name nobody has goes through", async () => {
    statusPageNames = ["status.acme.com"];
    dashboardNames = ["dash.acme.com"];
    formNames = ["feedback.acme.com"];

    const result: { createBy: { data: Record<string, unknown> } } =
      await create({ subdomain: "report" });

    expect(result.createBy.data["fullDomain"]).toBe("report.acme.com");
  });

  test("an uploaded certificate needs both the certificate and its key", async () => {
    const withoutKey: Error = await refusal(
      create({
        subdomain: "report",
        isCustomCertificate: true,
        customCertificate: "-----BEGIN CERTIFICATE-----",
      }),
    );

    expect(withoutKey.message).toBe(
      "Custom certificate or private key is missing",
    );

    await expect(
      create({
        subdomain: "report",
        isCustomCertificate: true,
        customCertificate: "-----BEGIN CERTIFICATE-----",
        customCertificateKey: "-----BEGIN PRIVATE KEY-----",
      }),
    ).resolves.toBeDefined();
  });
});

describe("a form domain's subdomain is fixed once it is added", () => {
  test.each([["report"], ["  REPORT  "], [""], ["@"]])(
    "an update naming the subdomain %j is refused",
    async (subdomain: string) => {
      const error: Error = await refusal(
        hooks.onBeforeUpdate({
          query: { _id: ObjectID.generate().toString() },
          data: { subdomain: subdomain },
          props: { tenantId: PROJECT_ID, userId: USER_ID },
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "A form domain's subdomain cannot be changed. Add the domain you want, then delete this one.",
      );
    },
  );

  test("an update that leaves the subdomain alone goes on", async () => {
    const result: { updateBy: { data: Record<string, unknown> } } =
      await hooks.onBeforeUpdate({
        query: { _id: ObjectID.generate().toString() },
        data: { isCustomCertificate: false },
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      });

    expect(result.updateBy.data).toEqual({ isCustomCertificate: false });
  });

  test("no one may write it on an update: its column grants no one", () => {
    expect(
      new FormDomain().getColumnAccessControlForAllColumns()["subdomain"]
        ?.update,
    ).toEqual([]);
  });
});

describe("which form a visit to a name opens", () => {
  type Lookup = {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    props: Record<string, unknown>;
  };

  function answer(row: unknown): Array<Lookup> {
    const lookups: Array<Lookup> = [];

    jest.spyOn(FormDomainService, "findOneBy").mockImplementation((async (
      call: Lookup,
    ) => {
      lookups.push(call);
      return row;
    }) as never);

    return lookups;
  }

  test("the share key of the form whose domain has exactly this name, while its parent domain is verified", async () => {
    const lookups: Array<Lookup> = answer({
      _id: ObjectID.generate().toString(),
      form: { _id: FORM_ID, shareKey: SHARE_KEY.toUpperCase() },
    });

    await expect(
      FormDomainService.getShareKeyOfFormOnDomain(" Report.Acme.COM "),
    ).resolves.toBe(SHARE_KEY);

    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.query["fullDomain"]).toBe("report.acme.com");
    expect(lookups[0]!.query["domain"]).toEqual(
      expect.objectContaining({ isVerified: true }),
    );
    expect(lookups[0]!.props).toEqual({ isRoot: true });
    // Only the key: whether the form is on is asked of the form by it.
    expect(lookups[0]!.select).toEqual({
      _id: true,
      form: { _id: true, shareKey: true },
    });
  });

  test.each([
    ["no form domain has it", null],
    ["its form has no share key", { form: { _id: FORM_ID } }],
    ["its form's key is no key", { form: { shareKey: "not-a-uuid" } }],
  ])("nothing when %s", async (_label: string, row: unknown) => {
    answer(row);

    await expect(
      FormDomainService.getShareKeyOfFormOnDomain("report.acme.com"),
    ).resolves.toBeNull();
  });

  test.each([[""], [null], [undefined], ["not a host"], ["report..acme.com"]])(
    "a name that is no domain (%j) is not looked up",
    async (hostname: string | null | undefined) => {
      const lookups: Array<Lookup> = answer({
        form: { shareKey: SHARE_KEY },
      });

      await expect(
        FormDomainService.getShareKeyOfFormOnDomain(hostname),
      ).resolves.toBeNull();
      expect(lookups).toHaveLength(0);
    },
  );

  test("a lookup that fails opens nothing", async () => {
    jest.spyOn(FormDomainService, "findOneBy").mockImplementation((async () => {
      throw new Error("the database is down");
    }) as never);

    await expect(
      FormDomainService.getShareKeyOfFormOnDomain("report.acme.com"),
    ).resolves.toBeNull();
  });

  test("isFormDomain: any form domain of this name, whatever its parent domain says", async () => {
    const lookups: Array<Lookup> = answer({
      _id: ObjectID.generate().toString(),
    });

    await expect(
      FormDomainService.isFormDomain("Report.Acme.com"),
    ).resolves.toBe(true);
    expect(lookups[0]!.query).toEqual({ fullDomain: "report.acme.com" });
    expect(lookups[0]!.select).toEqual({ _id: true });
    expect(lookups[0]!.props).toEqual({ isRoot: true });

    answer(null);

    await expect(
      FormDomainService.isFormDomain("status.acme.com"),
    ).resolves.toBe(false);
  });

  test("isFormDomain: no name, or a lookup that fails, is not a form domain", async () => {
    const lookups: Array<Lookup> = answer({ _id: "row" });

    await expect(FormDomainService.isFormDomain("")).resolves.toBe(false);
    await expect(FormDomainService.isFormDomain(null)).resolves.toBe(false);
    expect(lookups).toHaveLength(0);

    jest.spyOn(FormDomainService, "findOneBy").mockImplementation((async () => {
      throw new Error("the database is down");
    }) as never);

    await expect(
      FormDomainService.isFormDomain("report.acme.com"),
    ).resolves.toBe(false);
  });
});

describe("the CNAME check's token", () => {
  test("is the domain's own, on its own name", async () => {
    const lookups: Array<{ query: Record<string, unknown> }> = [];

    jest
      .spyOn(FormDomainService, "findOneBy")
      .mockImplementation((async (call: { query: Record<string, unknown> }) => {
        lookups.push(call);
        return call.query["cnameVerificationToken"] === TOKEN &&
          call.query["fullDomain"] === "report.acme.com"
          ? { _id: "row" }
          : null;
      }) as never);

    await expect(
      FormDomainService.isVerificationTokenOfDomain({
        hostname: "Report.Acme.com",
        token: TOKEN.toUpperCase(),
      }),
    ).resolves.toBe(true);

    // Another domain's token, on this name, proves nothing.
    await expect(
      FormDomainService.isVerificationTokenOfDomain({
        hostname: "report.acme.com",
        token: "2c5f39cb-3fb2-42e3-994f-1127e4ddb538",
      }),
    ).resolves.toBe(false);

    // This domain's token on another name proves nothing either.
    await expect(
      FormDomainService.isVerificationTokenOfDomain({
        hostname: "status.acme.com",
        token: TOKEN,
      }),
    ).resolves.toBe(false);

    expect(lookups[0]!.query).toEqual({
      fullDomain: "report.acme.com",
      cnameVerificationToken: TOKEN,
    });
  });

  test.each([
    ["no token", undefined],
    ["a token that is no UUID", "../../etc/passwd"],
    ["a token that is not text", { $ne: "" }],
  ])("%s is not looked up", async (_label: string, token: unknown) => {
    const findOneBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      FormDomainService,
      "findOneBy",
    );

    await expect(
      FormDomainService.isVerificationTokenOfDomain({
        hostname: "report.acme.com",
        token: token,
      }),
    ).resolves.toBe(false);
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("no name is not looked up", async () => {
    const findOneBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      FormDomainService,
      "findOneBy",
    );

    await expect(
      FormDomainService.isVerificationTokenOfDomain({
        hostname: null,
        token: TOKEN,
      }),
    ).resolves.toBe(false);
    expect(findOneBy).not.toHaveBeenCalled();
  });
});

describe("removing a form domain", () => {
  let removed: Array<string>;

  beforeEach(() => {
    removed = [];

    jest.spyOn(GreenlockUtil, "removeDomain").mockImplementation((async (
      domain: string,
    ) => {
      removed.push(domain);
    }) as never);

    jest
      .spyOn(CertificateOwners, "getPrimaryHostname")
      .mockReturnValue("oneuptime.example.com");

    jest
      .spyOn(StatusPageDomainService, "getOwnedDomains")
      .mockImplementation((async (domains: Array<string>) => {
        return domains.filter((domain: string) => {
          return domain === "shared-with-a-status-page.acme.com";
        });
      }) as never);
    jest
      .spyOn(DashboardDomainService, "getOwnedDomains")
      .mockImplementation((async (domains: Array<string>) => {
        return domains.filter((domain: string) => {
          return domain === "shared-with-a-dashboard.acme.com";
        });
      }) as never);
  });

  test("takes its certificate with it", async () => {
    await hooks.onDeleteSuccess(
      { carryForward: [{ fullDomain: "report.acme.com" }] },
      [],
    );

    expect(removed).toEqual(["report.acme.com"]);
  });

  test.each([
    ["a status page domain", "shared-with-a-status-page.acme.com"],
    ["a dashboard domain", "shared-with-a-dashboard.acme.com"],
    ["the installation's own host", "oneuptime.example.com"],
  ])(
    "leaves the certificate of a name %s still claims",
    async (_label: string, name: string) => {
      await hooks.onDeleteSuccess({ carryForward: [{ fullDomain: name }] }, []);

      expect(removed).toEqual([]);
    },
  );

  test("leaves the certificate when it cannot tell whether anything else claims the name", async () => {
    jest
      .spyOn(StatusPageDomainService, "getOwnedDomains")
      .mockImplementation((async () => {
        throw new Error("the database is down");
      }) as never);

    await hooks.onDeleteSuccess(
      { carryForward: [{ fullDomain: "report.acme.com" }] },
      [],
    );

    expect(removed).toEqual([]);
  });

  test("never asks the form domains themselves, which are letting the name go", async () => {
    const formOwned: ReturnType<typeof jest.spyOn> = jest.spyOn(
      FormDomainService,
      "getOwnedDomains",
    );

    await hooks.onDeleteSuccess(
      { carryForward: [{ fullDomain: "report.acme.com" }] },
      [],
    );

    expect(formOwned).not.toHaveBeenCalled();
  });

  test("a row without a name removes nothing", async () => {
    await hooks.onDeleteSuccess({ carryForward: [{}] }, []);

    expect(removed).toEqual([]);
  });
});
