import CustomDomainConflicts, {
  CustomDomainKind,
  getCustomDomainInUseMessage,
} from "../../../../Server/Utils/CustomDomain/CustomDomainConflicts";
import StatusPageDomainService from "../../../../Server/Services/StatusPageDomainService";
import DashboardDomainService from "../../../../Server/Services/DashboardDomainService";
import FormDomainService from "../../../../Server/Services/FormDomainService";
import DomainService from "../../../../Server/Services/DomainService";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { stubProjectDirectory } from "../../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * One name, one thing to show (Server/Utils/CustomDomain/CustomDomainConflicts).
 *
 * Every custom domain - a status page's, a dashboard's, a form's - is found
 * by the name a visit comes to, and the ingress sends them all to the same
 * App: a name two of them claimed showed only one of them, and the other went
 * live by surprise the day the first was removed. So a new custom domain is
 * refused when another kind already has its name, in any project - and a
 * form's also when another form has it, since a form's domain is found by
 * its name alone. Two status pages, or two dashboards, of different projects
 * with one name are left as they were: neither table ever refused them.
 *
 * The refusal says the name is taken, and nothing else: not whose it is, not
 * what it shows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-c0c0-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-c0c0-4aaa-8bbb-0000000000e1");

let names: Record<CustomDomainKind, Array<string>>;

type Lookup = {
  kind: CustomDomainKind;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
};

let lookups: Array<Lookup>;

function answerFor(
  kind: CustomDomainKind,
): (call: Omit<Lookup, "kind">) => Promise<unknown> {
  return async (call: Omit<Lookup, "kind">): Promise<unknown> => {
    lookups.push({ kind, ...call });

    return names[kind].includes(String(call.query["fullDomain"]))
      ? { _id: ObjectID.generate().toString() }
      : null;
  };
}

beforeEach(() => {
  names = {
    [CustomDomainKind.StatusPage]: [],
    [CustomDomainKind.Dashboard]: [],
    [CustomDomainKind.Form]: [],
  };
  lookups = [];

  jest
    .spyOn(StatusPageDomainService, "findOneBy")
    .mockImplementation(answerFor(CustomDomainKind.StatusPage) as never);
  jest
    .spyOn(DashboardDomainService, "findOneBy")
    .mockImplementation(answerFor(CustomDomainKind.Dashboard) as never);
  jest
    .spyOn(FormDomainService, "findOneBy")
    .mockImplementation(answerFor(CustomDomainKind.Form) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function refusalOf(run: Promise<unknown>): Promise<Error | null> {
  try {
    await run;
    return null;
  } catch (err) {
    return err as Error;
  }
}

describe("which kinds a new domain may not share its name with", () => {
  test.each([
    [
      CustomDomainKind.StatusPage,
      [CustomDomainKind.Dashboard, CustomDomainKind.Form],
    ],
    [
      CustomDomainKind.Dashboard,
      [CustomDomainKind.StatusPage, CustomDomainKind.Form],
    ],
    [
      CustomDomainKind.Form,
      [
        CustomDomainKind.StatusPage,
        CustomDomainKind.Dashboard,
        CustomDomainKind.Form,
      ],
    ],
  ])(
    "a new %s domain: %j",
    (kind: CustomDomainKind, others: Array<CustomDomainKind>) => {
      expect(CustomDomainConflicts.getKindsToCheck(kind)).toEqual(others);
    },
  );
});

describe("CustomDomainConflicts.assertNameIsFree", () => {
  test.each([
    [CustomDomainKind.StatusPage, CustomDomainKind.Dashboard],
    [CustomDomainKind.StatusPage, CustomDomainKind.Form],
    [CustomDomainKind.Dashboard, CustomDomainKind.StatusPage],
    [CustomDomainKind.Dashboard, CustomDomainKind.Form],
    [CustomDomainKind.Form, CustomDomainKind.StatusPage],
    [CustomDomainKind.Form, CustomDomainKind.Dashboard],
    [CustomDomainKind.Form, CustomDomainKind.Form],
  ])(
    "a new %s domain is refused a name a %s domain has",
    async (kind: CustomDomainKind, holder: CustomDomainKind) => {
      names[holder] = ["shared.acme.com"];

      const error: Error | null = await refusalOf(
        CustomDomainConflicts.assertNameIsFree({
          kind: kind,
          fullDomain: "shared.acme.com",
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error!.message).toBe(
        getCustomDomainInUseMessage("shared.acme.com"),
      );
    },
  );

  test.each([[CustomDomainKind.StatusPage], [CustomDomainKind.Dashboard]])(
    "two %s domains of one name are left as they were",
    async (kind: CustomDomainKind) => {
      names[kind] = ["shared.acme.com"];

      await expect(
        CustomDomainConflicts.assertNameIsFree({
          kind: kind,
          fullDomain: "shared.acme.com",
        }),
      ).resolves.toBeUndefined();
    },
  );

  test("reads every kind as root, by the name alone, for its id alone", async () => {
    await CustomDomainConflicts.assertNameIsFree({
      kind: CustomDomainKind.Form,
      fullDomain: "report.acme.com",
    });

    expect(lookups).toHaveLength(3);

    for (const lookup of lookups) {
      expect(lookup.query).toEqual({ fullDomain: "report.acme.com" });
      expect(lookup.select).toEqual({ _id: true });
      expect(lookup.props).toEqual({ isRoot: true });
    }
  });

  test("compares the name in one spelling: trimmed, lower case", async () => {
    names[CustomDomainKind.StatusPage] = ["status.acme.com"];

    const error: Error | null = await refusalOf(
      CustomDomainConflicts.assertNameIsFree({
        kind: CustomDomainKind.Form,
        fullDomain: "  Status.ACME.com ",
      }),
    );

    expect(error!.message).toBe(getCustomDomainInUseMessage("status.acme.com"));
  });

  test("no name is not looked up", async () => {
    await expect(
      CustomDomainConflicts.assertNameIsFree({
        kind: CustomDomainKind.Form,
        fullDomain: "   ",
      }),
    ).resolves.toBeUndefined();

    expect(lookups).toHaveLength(0);
  });

  test("the refusal names the domain and what to do, never whose it is", () => {
    const message: string = getCustomDomainInUseMessage("report.acme.com");

    expect(message).toBe(
      "report.acme.com is already in use: a domain can show only one status page, dashboard or form. Choose another subdomain, or remove report.acme.com where it is used first.",
    );
  });
});

/*
 * The rule is the services' own: each kind's create hook asks it, with its
 * own kind, for the full name it worked out.
 */
describe.each([
  ["a status page", StatusPageDomainService, CustomDomainKind.Form],
  ["a dashboard", DashboardDomainService, CustomDomainKind.Form],
  ["a form", FormDomainService, CustomDomainKind.StatusPage],
])(
  "adding %s's custom domain",
  (_name: string, service: unknown, holder: CustomDomainKind) => {
    beforeEach(() => {
      stubProjectDirectory({});

      jest.spyOn(DomainService, "findOneBy").mockResolvedValue({
        domain: "acme.com",
        isVerified: true,
      } as never);
    });

    function create(): Promise<unknown> {
      return (
        service as {
          onBeforeCreate: (createBy: unknown) => Promise<unknown>;
        }
      ).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          domainId: ObjectID.generate(),
          statusPageId: ObjectID.generate(),
          dashboardId: ObjectID.generate(),
          formId: ObjectID.generate(),
          subdomain: "Shared",
        },
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      });
    }

    test("is refused a name another kind already has", async () => {
      names[holder] = ["shared.acme.com"];

      const error: Error | null = await refusalOf(create());

      expect(error).toBeInstanceOf(BadDataException);
      expect(error!.message).toBe(
        getCustomDomainInUseMessage("shared.acme.com"),
      );
    });

    test("goes through with a name nobody has", async () => {
      await expect(create()).resolves.toBeDefined();
    });
  },
);
