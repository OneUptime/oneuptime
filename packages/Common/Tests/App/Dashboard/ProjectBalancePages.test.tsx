import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import NotificationSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/NotificationSettings";
import AICredits from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AICredits";
import { PROJECT_BALANCE_CARD_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/ProjectBalanceCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { ProjectBalanceType } from "../../../Utils/Project/ProjectBalance";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * The two pages that hold a project's prepaid balances: Project Settings >
 * Notification Settings (SMS, calls, WhatsApp and Telegram) and Project
 * Settings > AI Credits.
 *
 * Only a project owner or someone with Manage Billing may recharge either,
 * or change its Auto Recharge. The pages used to offer Recharge Balance and
 * Edit Auto Recharge to everyone - a project admin, a member - whose save
 * the server then refused, and told every reader to "Recharge it". Now:
 *
 * - someone who may: asked to recharge it, with the working button and an
 *   Edit Auto Recharge that saves;
 * - everyone else: told who can, both buttons locked with the reason;
 * - before the permission snapshot arrives: told who can, and offered
 *   nothing - nobody is told they lack a permission they may hold.
 *
 * The pages are rendered for real, with the model API and the permission
 * snapshot stubbed. Billing is on: Notification Settings shows its balance
 * cards only where OneUptime bills, and AI Credits is listed only there.
 */

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return { ...actual, BILLING_ENABLED: true };
});

const WAIT_TIMEOUT: number = 20000;

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

interface BalancePage {
  balance: ProjectBalanceType;
  name: string;
  open: () => void;
  // The recharge dialog's title, once the button is pressed.
  rechargeDialogTitle: string;
}

function renderPage(element: React.ReactElement, path: string): void {
  goTo(path);
  render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
}

const PAGES: Array<BalancePage> = [
  {
    balance: ProjectBalanceType.SmsOrCall,
    name: "Notification Settings",
    open: (): void => {
      renderPage(
        <NotificationSettings
          pageRoute={RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route}
          currentProject={null}
          hasPaymentMethod={true}
        />,
        `/dashboard/${PROJECT_ID}/settings/notification-settings`,
      );
    },
    rechargeDialogTitle: "Recharge Balance",
  },
  {
    balance: ProjectBalanceType.AI,
    name: "AI Credits",
    open: (): void => {
      renderPage(
        <AICredits
          pageRoute={RouteMap[PageMap.SETTINGS_AI_CREDITS] as Route}
          currentProject={null}
          hasPaymentMethod={true}
        />,
        `/dashboard/${PROJECT_ID}/settings/ai-credits`,
      );
    },
    rechargeDialogTitle: "Recharge AI Balance",
  },
];

function grant(permissions: Array<Permission>, isMasterAdmin?: boolean): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(Boolean(isMasterAdmin));
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

// The card a heading belongs to.
async function cardOf(title: string): Promise<HTMLElement> {
  const heading: HTMLElement = (
    await screen.findAllByText(title, {}, { timeout: WAIT_TIMEOUT })
  )[0]!;

  return heading.closest('[data-testid="card"]') as HTMLElement;
}

function buttonIn(card: HTMLElement, name: string): HTMLElement | null {
  return within(card).queryByRole("button", { name: name });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();

  const project: Project = Object.assign(new Project(), {
    _id: PROJECT_ID,
    smsOrCallCurrentBalanceInUSDCents: 0,
    aiCurrentBalanceInUSDCents: 0,
    enableAutoRechargeSmsOrCallBalance: false,
    autoRechargeSmsOrCallByBalanceInUSD: 20,
    autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
    enableAutoRechargeAiBalance: false,
    autoAiRechargeByBalanceInUSD: 20,
    autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
    enableSmsNotifications: true,
    enableCallNotifications: true,
    enableWhatsAppNotifications: false,
    enableTelegramNotifications: false,
  });

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<Project> => {
      return project;
    });
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<Project>> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    });
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(async (): Promise<number> => {
      return 0;
    });
  jest.spyOn(API, "post").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(PAGES)("$name", (page: BalancePage) => {
  test.each([
    ["a project owner", Permission.ProjectOwner],
    ["someone with Manage Billing", Permission.ManageProjectBilling],
  ])(
    "%s is asked to recharge it, and may: the button opens the recharge dialog",
    async (_who: string, permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      page.open();

      const balanceCard: HTMLElement = await cardOf("Current Balance");

      expect(balanceCard).toHaveTextContent(
        PROJECT_BALANCE_CARD_DESCRIPTIONS[page.balance].forPeopleWhoMayAdd,
      );

      const recharge: HTMLElement = buttonIn(balanceCard, "Recharge Balance")!;

      expect(recharge).not.toBeNull();
      expect(recharge).not.toBeDisabled();

      fireEvent.click(recharge);
      await flush();

      expect(
        await screen.findByText(
          page.rechargeDialogTitle,
          { selector: "h3, h2, h1, [data-testid='modal-title']" },
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
    },
  );

  test.each([
    ["a project owner", Permission.ProjectOwner],
    ["someone with Manage Billing", Permission.ManageProjectBilling],
  ])(
    "%s may edit Auto Recharge",
    async (_who: string, permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      page.open();

      const autoRecharge: HTMLElement = await cardOf("Auto Recharge");
      const edit: HTMLElement | null = buttonIn(
        autoRecharge,
        "Edit Auto Recharge",
      );

      expect(edit).not.toBeNull();
      expect(edit).not.toBeDisabled();
    },
  );

  test.each([
    ["a project admin", Permission.ProjectAdmin],
    ["a member", Permission.ProjectMember],
    ["the Billing Admin role", Permission.BillingAdmin],
  ])(
    "%s is told who can recharge it, and both buttons are locked",
    async (_who: string, permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      page.open();

      const balanceCard: HTMLElement = await cardOf("Current Balance");

      expect(balanceCard).toHaveTextContent(
        PROJECT_BALANCE_CARD_DESCRIPTIONS[page.balance].forEveryoneElse,
      );
      expect(balanceCard).toHaveTextContent(
        "A project owner or someone with Manage Billing can recharge it",
      );
      expect(balanceCard).not.toHaveTextContent("Recharge it, or");

      const recharge: HTMLElement | null = buttonIn(
        balanceCard,
        "Recharge Balance",
      );

      expect(recharge).not.toBeNull();
      expect(recharge).toBeDisabled();

      fireEvent.click(recharge!);
      await flush();

      expect(
        screen.queryByText(page.rechargeDialogTitle, {
          selector: "h3, h2, h1, [data-testid='modal-title']",
        }),
      ).not.toBeInTheDocument();

      const autoRecharge: HTMLElement = await cardOf("Auto Recharge");
      const edit: HTMLElement | null = buttonIn(
        autoRecharge,
        "Edit Auto Recharge",
      );

      expect(edit).not.toBeNull();
      expect(edit).toBeDisabled();
    },
  );

  test("before the permissions arrive: told who can, and offered nothing", async () => {
    grant([]);
    page.open();

    const balanceCard: HTMLElement = await cardOf("Current Balance");

    expect(balanceCard).toHaveTextContent(
      PROJECT_BALANCE_CARD_DESCRIPTIONS[page.balance].forEveryoneElse,
    );
    expect(buttonIn(balanceCard, "Recharge Balance")).toBeNull();

    const autoRecharge: HTMLElement = await cardOf("Auto Recharge");

    expect(buttonIn(autoRecharge, "Edit Auto Recharge")).toBeNull();
  });

  test("a master admin may recharge it", async () => {
    grant([], true);
    page.open();

    const balanceCard: HTMLElement = await cardOf("Current Balance");

    expect(buttonIn(balanceCard, "Recharge Balance")).not.toBeDisabled();
    expect(balanceCard).toHaveTextContent(
      PROJECT_BALANCE_CARD_DESCRIPTIONS[page.balance].forPeopleWhoMayAdd,
    );
  });
});
