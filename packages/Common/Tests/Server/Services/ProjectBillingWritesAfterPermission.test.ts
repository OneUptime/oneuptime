import AIBillingService from "../../../Server/Services/AIBillingService";
import BillingService from "../../../Server/Services/BillingService";
import NotificationService from "../../../Server/Services/NotificationService";
import ProjectService from "../../../Server/Services/ProjectService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
    NotificationSlackWebhookOnCreateProject: "",
    NotificationSlackWebhookOnSubscriptionUpdate: "",
  };
});

/*
 * A PROJECT UPDATE CHARGES OR TALKS TO THE PAYMENT PROVIDER ONLY ONCE IT IS
 * ALLOWED.
 *
 * Turning auto recharge on tops the SMS and call balance up at once when it is
 * below the threshold, and changing the invoice details sends them to the
 * payment provider. Both used to happen in ProjectService.onBeforeUpdate,
 * before DatabaseService's permission check - so a project admin, who may
 * edit the project but not its billing, could trigger a charge (with amounts
 * of their choosing) or rewrite the invoice details at the provider, and only
 * then be refused.
 *
 * Now the charge is made once every permission check has passed, still
 * before the write (a charge that fails refuses the change, as before), and
 * the invoice details are sent once the update is made. These drive the real
 * updateOneById over an in-memory Project table, with the payment provider
 * stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1d000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "1d000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("1d000000-0000-4000-8000-000000000003");

const AUTO_RECHARGE_ON: Record<string, unknown> = {
  enableAutoRechargeSmsOrCallBalance: true,
  autoRechargeSmsOrCallByBalanceInUSD: 500,
  autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 1000,
};

const AI_AUTO_RECHARGE_ON: Record<string, unknown> = {
  enableAutoRechargeAiBalance: true,
  autoAiRechargeByBalanceInUSD: 50,
  autoRechargeAiWhenCurrentBalanceFallsInUSD: 25,
};

function memberProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      ...permissions,
    ].map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
      };
    }),
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

// May edit the project, but not its billing.
const adminProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectAdmin]);
  };

const ownerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectOwner]);
  };

let table: InMemoryTable;
let recharge: jest.SpyInstance;
let aiRecharge: jest.SpyInstance;
let syncInvoiceDetails: jest.SpyInstance;

beforeEach(() => {
  table = useInMemoryTable(ProjectService, [
    {
      _id: PROJECT_ID.toString(),
      name: "Acme",
      paymentProviderCustomerId: "cus_acme",
      businessDetails: "Acme Ltd\n1 Main Street",
      businessDetailsCountry: "GB",
      financeAccountingEmail: "finance@acme.test",
      sendInvoicesByEmail: true,
      enableAutoRechargeSmsOrCallBalance: false,
      enableAutoRechargeAiBalance: false,
    },
    {
      _id: OTHER_PROJECT_ID.toString(),
      name: "Other",
      paymentProviderCustomerId: "cus_other",
      businessDetails: "Other Inc",
      enableAutoRechargeSmsOrCallBalance: false,
      enableAutoRechargeAiBalance: false,
    },
  ]);

  recharge = getJestSpyOn(
    NotificationService,
    "rechargeIfBalanceIsLow",
  ).mockResolvedValue(0);
  aiRecharge = getJestSpyOn(
    AIBillingService,
    "rechargeIfBalanceIsLow",
  ).mockResolvedValue(0);
  syncInvoiceDetails = getJestSpyOn(
    BillingService,
    "updateCustomerBusinessDetails",
  ).mockResolvedValue(undefined);

  const auditLogService: { recordUpdate: () => Promise<void> } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("../../../Server/Services/AuditLogService").default;
  getJestSpyOn(auditLogService, "recordUpdate").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

describe("turning auto recharge on", () => {
  test("a project admin, who may not change billing, is refused, and nothing is charged", async () => {
    const error: unknown = await rejectionOf(
      ProjectService.updateOneById({
        id: PROJECT_ID,
        data: AUTO_RECHARGE_ON as never,
        props: adminProps(),
      }),
    );

    // Refused by the column check: the auto recharge columns need billing.
    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "User is not allowed to update on enableAutoRechargeSmsOrCallBalance column of Project",
    );
    expect(recharge).not.toHaveBeenCalled();
    expect(table.updates).toEqual([]);
    expect(table.get(PROJECT_ID)!["enableAutoRechargeSmsOrCallBalance"]).toBe(
      false,
    );
  });

  test("an owner is charged for their own project, with the amounts they set, before the change is written", async () => {
    await ProjectService.updateOneById({
      id: PROJECT_ID,
      data: AUTO_RECHARGE_ON as never,
      props: ownerProps(),
    });

    expect(recharge).toHaveBeenCalledTimes(1);
    expect((recharge.mock.calls[0]![0] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    /*
     * Saving Auto Recharge is somebody trying the card on purpose: it is
     * tried at once, whatever failed before, as for AI credits.
     */
    expect(recharge.mock.calls[0]![1]).toEqual({
      enableAutoRechargeSmsOrCallBalance: true,
      autoRechargeSmsOrCallByBalanceInUSD: 500,
      autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 1000,
      ignoreRecentFailure: true,
    });
    expect(recharge.mock.invocationCallOrder[0]!).toBeLessThan(
      table.repository.update.mock.invocationCallOrder[0]!,
    );
    expect(table.get(PROJECT_ID)!["enableAutoRechargeSmsOrCallBalance"]).toBe(
      true,
    );
  });

  test("a charge that fails refuses the change, as it always has", async () => {
    recharge.mockRejectedValue(
      new BadDataException("Please add a payment method."),
    );

    await expect(
      ProjectService.updateOneById({
        id: PROJECT_ID,
        data: AUTO_RECHARGE_ON as never,
        props: ownerProps(),
      }),
    ).rejects.toThrow("Please add a payment method.");

    expect(table.updates).toEqual([]);
  });

  test("an owner naming another project's id never charges that project", async () => {
    await ProjectService.updateOneById({
      id: OTHER_PROJECT_ID,
      data: AUTO_RECHARGE_ON as never,
      props: ownerProps(),
    }).catch(() => {
      return 0;
    });

    for (const call of recharge.mock.calls) {
      expect((call[0] as ObjectID).toString()).not.toBe(
        OTHER_PROJECT_ID.toString(),
      );
    }
    expect(
      table.get(OTHER_PROJECT_ID)!["enableAutoRechargeSmsOrCallBalance"],
    ).toBe(false);
  });

  test("turning it off charges nothing", async () => {
    await ProjectService.updateOneById({
      id: PROJECT_ID,
      data: { enableAutoRechargeSmsOrCallBalance: false } as never,
      props: ownerProps(),
    });

    expect(recharge).not.toHaveBeenCalled();
  });

  test("turning on the SMS and call balance's charges nothing for AI credits", async () => {
    await ProjectService.updateOneById({
      id: PROJECT_ID,
      data: AUTO_RECHARGE_ON as never,
      props: ownerProps(),
    });

    expect(aiRecharge).not.toHaveBeenCalled();
  });
});

/*
 * AI credits do the same now. They used to wait for an AI call to run out
 * first - and a call cannot run on used-up credits - so turning Auto
 * Recharge on at zero left the project at zero. Saving it is somebody trying
 * the card on purpose, so it is tried at once, whatever failed before
 * (ignoreRecentFailure), and a charge that fails refuses the change.
 */
describe("turning AI credits' auto recharge on", () => {
  test("a project admin, who may not change billing, is refused, and nothing is charged", async () => {
    const error: unknown = await rejectionOf(
      ProjectService.updateOneById({
        id: PROJECT_ID,
        data: AI_AUTO_RECHARGE_ON as never,
        props: adminProps(),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "User is not allowed to update on enableAutoRechargeAiBalance column of Project",
    );
    expect(aiRecharge).not.toHaveBeenCalled();
    expect(table.updates).toEqual([]);
  });

  test("an owner's project is topped up with the amounts being saved, at once, before the change is written", async () => {
    await ProjectService.updateOneById({
      id: PROJECT_ID,
      data: AI_AUTO_RECHARGE_ON as never,
      props: ownerProps(),
    });

    expect(aiRecharge).toHaveBeenCalledTimes(1);
    expect((aiRecharge.mock.calls[0]![0] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(aiRecharge.mock.calls[0]![1]).toEqual({
      enableAutoRechargeAiBalance: true,
      autoAiRechargeByBalanceInUSD: 50,
      autoRechargeAiWhenCurrentBalanceFallsInUSD: 25,
      ignoreRecentFailure: true,
    });
    expect(aiRecharge.mock.invocationCallOrder[0]!).toBeLessThan(
      table.repository.update.mock.invocationCallOrder[0]!,
    );
    expect(table.get(PROJECT_ID)!["enableAutoRechargeAiBalance"]).toBe(true);
    // The SMS and call balance is not touched by it.
    expect(recharge).not.toHaveBeenCalled();
  });

  test("a charge that fails refuses the change, as it does for SMS and calls", async () => {
    aiRecharge.mockRejectedValue(
      new BadDataException(
        "No payment methods found for the project. Please add a payment method in Project Settings to continue.",
      ),
    );

    await expect(
      ProjectService.updateOneById({
        id: PROJECT_ID,
        data: AI_AUTO_RECHARGE_ON as never,
        props: ownerProps(),
      }),
    ).rejects.toThrow("No payment methods found for the project.");

    expect(table.updates).toEqual([]);
    expect(table.get(PROJECT_ID)!["enableAutoRechargeAiBalance"]).toBe(false);
  });

  test("an owner naming another project's id never charges that project", async () => {
    await ProjectService.updateOneById({
      id: OTHER_PROJECT_ID,
      data: AI_AUTO_RECHARGE_ON as never,
      props: ownerProps(),
    }).catch(() => {
      return 0;
    });

    for (const call of aiRecharge.mock.calls) {
      expect((call[0] as ObjectID).toString()).not.toBe(
        OTHER_PROJECT_ID.toString(),
      );
    }
    expect(table.get(OTHER_PROJECT_ID)!["enableAutoRechargeAiBalance"]).toBe(
      false,
    );
  });

  test("turning it off charges nothing", async () => {
    await ProjectService.updateOneById({
      id: PROJECT_ID,
      data: { enableAutoRechargeAiBalance: false } as never,
      props: ownerProps(),
    });

    expect(aiRecharge).not.toHaveBeenCalled();
  });

  test("turning both on tops up both, each with its own amounts", async () => {
    await ProjectService.updateOneById({
      id: PROJECT_ID,
      data: { ...AUTO_RECHARGE_ON, ...AI_AUTO_RECHARGE_ON } as never,
      props: ownerProps(),
    });

    expect(recharge).toHaveBeenCalledTimes(1);
    expect(aiRecharge).toHaveBeenCalledTimes(1);
    expect(
      (aiRecharge.mock.calls[0]![1] as Record<string, unknown>)[
        "autoAiRechargeByBalanceInUSD"
      ],
    ).toBe(50);
  });
});

describe("changing the invoice details", () => {
  test("a project admin, who may not change billing, is refused, and the payment provider hears nothing", async () => {
    const error: unknown = await rejectionOf(
      ProjectService.updateOneById({
        id: PROJECT_ID,
        data: { businessDetails: "Someone Else Ltd" } as never,
        props: adminProps(),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "User is not allowed to update on businessDetails column of Project",
    );
    expect(syncInvoiceDetails).not.toHaveBeenCalled();
    expect(table.get(PROJECT_ID)!["businessDetails"]).toBe(
      "Acme Ltd\n1 Main Street",
    );
  });

  test("an owner's change reaches the payment provider after it is saved, with what the project now holds", async () => {
    await ProjectService.updateOneById({
      id: PROJECT_ID,
      data: { financeAccountingEmail: "billing@acme.test" } as never,
      props: ownerProps(),
    });

    expect(syncInvoiceDetails).toHaveBeenCalledTimes(1);
    expect(syncInvoiceDetails.mock.calls[0]).toEqual([
      "cus_acme",
      // Kept: the update named only the email, so the address stays as stored.
      "Acme Ltd\n1 Main Street",
      "GB",
      "billing@acme.test",
      true,
    ]);
    expect(syncInvoiceDetails.mock.invocationCallOrder[0]!).toBeGreaterThan(
      table.repository.update.mock.invocationCallOrder[0]!,
    );
  });

  test("a payment provider that fails does not undo the saved change", async () => {
    syncInvoiceDetails.mockRejectedValue(new Error("provider down"));

    await ProjectService.updateOneById({
      id: PROJECT_ID,
      data: { businessDetails: "Acme Group Ltd" } as never,
      props: ownerProps(),
    });

    expect(table.get(PROJECT_ID)!["businessDetails"]).toBe("Acme Group Ltd");
  });

  test("a change of anything else sends nothing to the payment provider", async () => {
    await ProjectService.updateOneById({
      id: PROJECT_ID,
      data: { name: "Acme Monitoring" } as never,
      props: ownerProps(),
    });

    expect(syncInvoiceDetails).not.toHaveBeenCalled();
    expect(table.get(PROJECT_ID)!["name"]).toBe("Acme Monitoring");
  });
});
