import { Service as BillingInvoiceService } from "../../../Server/Services/BillingInvoiceService";
import { Service as BillingPaymentMethodService } from "../../../Server/Services/BillingPaymentMethodService";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A READ OF THE PROJECT'S INVOICES OR PAYMENT METHODS ASKS THE PAYMENT
 * PROVIDER ONLY FOR SOMEONE THE READ WOULD LET THROUGH (#10289).
 *
 * The services' read hooks ask the payment provider for the project's
 * invoices or payment methods and write them all again, as OneUptime,
 * before the read is weighed (DatabaseService weighs a read's table after
 * its hooks). So a member who may not read the project's invoices - a
 * Viewer, a Project Member, a product's level - listing them made OneUptime
 * refresh the subscription, delete and rewrite every invoice and call the
 * provider, only to be refused afterwards. They are refused first now,
 * before anything is read or written; a reader of billing, OneUptime
 * itself and a master admin read on as before.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

type OnBeforeFind = (findBy: unknown) => Promise<unknown>;

interface BillingHook {
  service: unknown;
  // Who is refused: none of the table's read permissions is theirs.
  refused: Array<[string, Array<Permission>]>;
}

/*
 * Every member reads which cards the project has, masked (Project User):
 * only a caller with no read of them at all - an API key given a product's
 * levels alone - is refused. Invoices are billing's readers' alone.
 */
const HOOKS: Array<[string, BillingHook]> = [
  [
    "invoices",
    {
      service: new BillingInvoiceService(),
      refused: [
        ["a Viewer", [Permission.Viewer]],
        ["a Project Member", [Permission.ProjectMember]],
        [
          "every product's Admin",
          [Permission.CloudAdmin, Permission.NetworkAdmin],
        ],
        [
          "a member with no permission but the project's",
          [Permission.ProjectUser],
        ],
      ],
    },
  ],
  [
    "payment methods",
    {
      service: new BillingPaymentMethodService(),
      refused: [
        [
          "a key given every product's Admin alone",
          [Permission.CloudAdmin, Permission.NetworkAdmin],
        ],
      ],
    },
  ],
];

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function find(
  service: unknown,
  props: DatabaseCommonInteractionProps,
): Promise<unknown> {
  return (service as { onBeforeFind: OnBeforeFind }).onBeforeFind({
    query: {},
    props: props,
  });
}

let findProject: jest.Mock;

beforeEach(() => {
  /*
   * The project has no customer at the payment provider, so a read let
   * through stops at that, having asked for the project - and nothing is
   * ever sent to a provider.
   */
  findProject = getJestSpyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    paymentProviderCustomerId: undefined,
  } as never) as unknown as jest.Mock;

  getJestSpyOn(BillingService, "getInvoices").mockImplementation(() => {
    throw new Error("The payment provider was asked.");
  });
  getJestSpyOn(BillingService, "getPaymentMethods").mockImplementation(() => {
    throw new Error("The payment provider was asked.");
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(HOOKS)(
  "listing the project's %s",
  (_name: string, hook: BillingHook) => {
    const service: unknown = hook.service;

    test.each(hook.refused)(
      "%s is refused before anything is read or written",
      async (_caller: string, permissions: Array<Permission>) => {
        await expect(
          find(service, callerWith(permissions)),
        ).rejects.toBeInstanceOf(NotAuthorizedException);
        expect(findProject).not.toHaveBeenCalled();
      },
    );

    test("a team's block on reading billing refuses a Project Owner too", async () => {
      await expect(
        find(service, {
          ...customDomainCaller({
            permissions: [Permission.ProjectOwner],
            blocks: [Permission.ProjectOwner],
            projectId: PROJECT_ID,
          }),
          ...ON_HIGHEST_PLAN,
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
      expect(findProject).not.toHaveBeenCalled();
    });

    test.each([
      ["a Project Owner", callerWith([Permission.ProjectOwner])],
      ["a Billing Viewer", callerWith([Permission.BillingViewer])],
      ["OneUptime itself", { tenantId: PROJECT_ID, isRoot: true }],
      ["a master admin", { tenantId: PROJECT_ID, isMasterAdmin: true }],
    ])(
      "%s reads on: the project is asked for",
      async (_caller: string, props: DatabaseCommonInteractionProps) => {
        await expect(find(service, props)).rejects.toThrow(
          "Payment provider customer id not found.",
        );
        expect(findProject).toHaveBeenCalled();
      },
    );
  },
);
