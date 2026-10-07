import "@testing-library/jest-dom";
import { act, render, waitFor } from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import Billing from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Billing";
import Invoices from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Invoices";
import {
  BillingActionCopy,
  getAddPaymentMethodGate,
  getBillingActionLockedReason,
  getPayInvoiceGate,
  getSetDefaultPaymentMethodGate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/BillingActionGates";
import BillingInvoice, {
  InvoiceStatus,
} from "../../../Models/DatabaseModels/BillingInvoice";
import BillingPaymentMethod from "../../../Models/DatabaseModels/BillingPaymentMethod";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import {
  PAYMENT_METHOD_ADD_PERMISSIONS,
  PAYMENT_METHOD_SET_DEFAULT_PERMISSIONS,
  PROJECT_INVOICE_PAY_PERMISSIONS,
} from "../../../Utils/Project/ProjectBilling";
import { getJestSpyOn } from "../../Spy";

/*
 * THE BILLING PAGES FOR THE BILLING ROLES.
 *
 * Billing Viewer, Member and Admin read Settings > Billing and Settings >
 * Invoices. What charges the card or decides which card is charged - adding
 * a payment method, making one the default, paying an invoice - stays with
 * a project owner and Manage Billing, and the server refuses it to anyone
 * else (Utils/Project/ProjectBilling). The pages used to offer those buttons
 * to everyone, and the server's refusal came after the click. Now they are
 * on screen, locked, saying why and who may - and only once the permission
 * snapshot has landed: before then nobody is told anything and the server
 * decides, as it always did.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
];

let lastTableProps: Record<string, unknown> | null = null;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        return { data: [], count: 1 };
      },
      count: async () => {
        return 1;
      },
      getItem: async () => {
        return { paymentProviderPlanId: "free-plan" };
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: async () => {
        return { data: { balance: 0 } };
      },
      post: async () => {
        return { data: {} };
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: { capture: () => {}, captureRevenueEvent: () => {} },
  };
});

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    BILLING_ENABLED: true,
  };
});

jest.mock(
  "@stripe/stripe-js/pure",
  () => {
    return {
      loadStripe: async () => {
        return {};
      },
    };
  },
  { virtual: true },
);

jest.mock(
  "@stripe/react-stripe-js",
  () => {
    return {
      Elements: (props: { children: ReactNode }) => {
        return <>{props.children}</>;
      },
      PaymentElement: () => {
        return <div>Payment details</div>;
      },
      useStripe: () => {
        return {};
      },
      useElements: () => {
        return {};
      },
    };
  },
  { virtual: true },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <></>;
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

// The tables are a test boundary: what the page hands them is asserted.
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      lastTableProps = props;
      return <div data-testid="table" />;
    },
  };
});

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(permissions.length ? [...BASE_PERMISSIONS, ...permissions] : []);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(
    (permissions.length
      ? {
          projectId: PROJECT_ID,
          userId: ObjectID.generate(),
          permissions: [...BASE_PERMISSIONS, ...permissions].map(
            (permission: Permission) => {
              return {
                permission: permission,
                labelIds: [],
                _type: "UserPermission",
              };
            },
          ),
          _type: "UserTenantAccessPermission",
        }
      : null) as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>,
  );
}

function lockedReason(
  sentence: string,
  permissions: ReadonlyArray<Permission>,
): string {
  return `${sentence} You need one of these permissions: ${PermissionHelper.getPermissionTitles(
    [...permissions],
  ).join(", ")}.`;
}

interface CardButton {
  title: string;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
}

function tableCardButton(title: string): CardButton {
  const buttons: Array<CardButton> = (
    (lastTableProps!["cardProps"] as { buttons: Array<CardButton> }).buttons ||
    []
  ).filter((button: CardButton): boolean => {
    return button.title === title;
  });

  expect(buttons).toHaveLength(1);

  return buttons[0]!;
}

function tableAction<T extends BillingInvoice | BillingPaymentMethod>(
  title: string,
): ActionButtonSchema<T> {
  const actions: Array<ActionButtonSchema<T>> = (
    (lastTableProps!["actionButtons"] as Array<ActionButtonSchema<T>>) || []
  ).filter((action: ActionButtonSchema<T>): boolean => {
    return action.title === title;
  });

  expect(actions).toHaveLength(1);

  return actions[0]!;
}

async function openBilling(): Promise<void> {
  render(
    <Billing
      pageRoute={new Route("/settings/billing")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  await waitFor(() => {
    expect(lastTableProps).not.toBeNull();
    expect(lastTableProps!["id"]).toBe("payment-methods-table");
  });
}

async function openInvoices(): Promise<void> {
  await act(async () => {
    render(
      <Invoices
        pageRoute={new Route("/settings/invoices")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });

  await waitFor(() => {
    expect(lastTableProps).not.toBeNull();
    expect(lastTableProps!["id"]).toBe("invoices-table");
  });
}

const BILLING_ROLES: Array<Permission> = [
  Permission.BillingViewer,
  Permission.BillingMember,
  Permission.BillingAdmin,
];

beforeEach(() => {
  jest.restoreAllMocks();
  lastTableProps = null;
  PermissionGate.clearPermissionPropsCache();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(SubscriptionPlan, "getSubscriptionPlans").mockReturnValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the gates read the server's lists", () => {
  it.each(BILLING_ROLES)("%s: add, set default and pay are all locked, each saying who may", (role: Permission) => {
    const options: { permissions: Array<Permission> } = {
      permissions: [...BASE_PERMISSIONS, role],
    };

    expect(
      getBillingActionLockedReason(getAddPaymentMethodGate(options)),
    ).toBe(
      lockedReason(
        BillingActionCopy.addPaymentMethodRefused,
        PAYMENT_METHOD_ADD_PERMISSIONS,
      ),
    );
    expect(
      getBillingActionLockedReason(getSetDefaultPaymentMethodGate(options)),
    ).toBe(
      lockedReason(
        BillingActionCopy.setDefaultPaymentMethodRefused,
        PAYMENT_METHOD_SET_DEFAULT_PERMISSIONS,
      ),
    );
    expect(getBillingActionLockedReason(getPayInvoiceGate(options))).toBe(
      lockedReason(
        BillingActionCopy.payInvoiceRefused,
        PROJECT_INVOICE_PAY_PERMISSIONS,
      ),
    );
  });

  it.each([Permission.ProjectOwner, Permission.ManageProjectBilling])(
    "%s: none is locked",
    (permission: Permission) => {
      const options: { permissions: Array<Permission> } = {
        permissions: [...BASE_PERMISSIONS, permission],
      };

      for (const gate of [
        getAddPaymentMethodGate(options),
        getSetDefaultPaymentMethodGate(options),
        getPayInvoiceGate(options),
      ]) {
        expect(gate).toEqual({ isAllowed: true });
        expect(getBillingActionLockedReason(gate)).toBeUndefined();
      }
    },
  );

  it("the granular permissions each open their own action", () => {
    expect(
      getAddPaymentMethodGate({
        permissions: [Permission.CreateBillingPaymentMethod],
      }).isAllowed,
    ).toBe(true);
    expect(
      getSetDefaultPaymentMethodGate({
        permissions: [Permission.EditBillingPaymentMethod],
      }).isAllowed,
    ).toBe(true);
    expect(
      getAddPaymentMethodGate({
        permissions: [Permission.EditBillingPaymentMethod],
      }).isAllowed,
    ).toBe(false);
    expect(
      getPayInvoiceGate({ permissions: [Permission.EditInvoices] }).isAllowed,
    ).toBe(true);
  });

  it("before the permission snapshot lands nothing is locked: the server decides", () => {
    grant([]);

    for (const gate of [
      getAddPaymentMethodGate(),
      getSetDefaultPaymentMethodGate(),
      getPayInvoiceGate(),
    ]) {
      const result: PermissionGateResult = gate;

      expect(result.isAllowed).toBe(false);
      expect(getBillingActionLockedReason(result)).toBeUndefined();
    }
  });

  it("a team's block on Manage Billing locks them, naming the block", () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);

    const reason: string | undefined = getBillingActionLockedReason(
      getPayInvoiceGate({
        held: {
          allowed: [Permission.ManageProjectBilling],
          allowedProjectWide: [Permission.ManageProjectBilling],
          blocked: [Permission.ManageProjectBilling],
          blockedForSomeLabels: [],
        },
      }),
    );

    expect(reason).toContain(BillingActionCopy.payInvoiceRefused);
    expect(reason).toContain("Manage Billing");
  });
});

describe("Settings > Billing", () => {
  it.each(BILLING_ROLES)(
    "%s sees Add Payment Method, Set as Default and Re-sync Autopay locked, saying why",
    async (role: Permission) => {
      grant([role]);

      await openBilling();

      const add: CardButton = tableCardButton("Add Payment Method");

      expect(add.disabled).toBe(true);
      expect(add.tooltip).toBe(
        lockedReason(
          BillingActionCopy.addPaymentMethodRefused,
          PAYMENT_METHOD_ADD_PERMISSIONS,
        ),
      );

      for (const title of ["Set as Default", "Re-sync Autopay"]) {
        const action: ActionButtonSchema<BillingPaymentMethod> =
          tableAction<BillingPaymentMethod>(title);

        expect([title, action.disabled]).toEqual([title, true]);
        expect(action.tooltip).toBe(
          lockedReason(
            BillingActionCopy.setDefaultPaymentMethodRefused,
            PAYMENT_METHOD_SET_DEFAULT_PERMISSIONS,
          ),
        );
      }
    },
  );

  it.each([Permission.ProjectOwner, Permission.ManageProjectBilling])(
    "%s gets them working",
    async (permission: Permission) => {
      grant([permission]);

      await openBilling();

      const add: CardButton = tableCardButton("Add Payment Method");

      expect(add.disabled).toBeFalsy();
      expect(add.tooltip).toBeUndefined();

      for (const title of ["Set as Default", "Re-sync Autopay"]) {
        expect(
          tableAction<BillingPaymentMethod>(title).disabled,
        ).toBeFalsy();
      }
    },
  );

  it("before the permission snapshot lands they work, and the server decides", async () => {
    grant([]);

    await openBilling();

    expect(tableCardButton("Add Payment Method").disabled).toBeFalsy();
    expect(
      tableAction<BillingPaymentMethod>("Set as Default").disabled,
    ).toBeFalsy();
  });
});

describe("Settings > Invoices", () => {
  it.each(BILLING_ROLES)(
    "%s sees Pay Invoice locked, saying who may pay",
    async (role: Permission) => {
      grant([role]);

      await openInvoices();

      const pay: ActionButtonSchema<BillingInvoice> =
        tableAction<BillingInvoice>("Pay Invoice");

      expect(pay.disabled).toBe(true);
      expect(pay.tooltip).toBe(
        lockedReason(
          BillingActionCopy.payInvoiceRefused,
          PROJECT_INVOICE_PAY_PERMISSIONS,
        ),
      );
    },
  );

  it.each([
    Permission.ProjectOwner,
    Permission.ManageProjectBilling,
    Permission.EditInvoices,
  ])("%s may pay", async (permission: Permission) => {
    grant([permission]);

    await openInvoices();

    expect(tableAction<BillingInvoice>("Pay Invoice").disabled).toBeFalsy();
  });

  it("Download shows only on a row that carries its link - the table asks for the link only from who may read it", async () => {
    grant([Permission.BillingViewer]);

    await openInvoices();

    const download: ActionButtonSchema<BillingInvoice> =
      tableAction<BillingInvoice>("Download");
    const withoutLink: BillingInvoice = new BillingInvoice();
    withoutLink.status = InvoiceStatus.Paid;

    expect(download.isVisible!(withoutLink)).toBe(false);
    expect(
      (lastTableProps!["selectMoreFields"] as Record<string, boolean>)[
        "downloadableLink"
      ],
    ).toBe(true);
  });
});
