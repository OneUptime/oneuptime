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
import {
  AUTO_RECHARGE_FAILED_DESCRIPTIONS,
  AUTO_RECHARGE_FAILED_TITLE,
  PROJECT_BALANCE_CARD_DESCRIPTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/ProjectBalanceCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import AutoRechargeState from "../../../Types/Billing/AutoRechargeState";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import {
  PROJECT_BALANCE_AUTO_RECHARGE_STATE_ROUTE,
  ProjectBalanceType,
} from "../../../Utils/Project/ProjectBalance";
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
 *
 * Each page also asks the server what its balance's Auto Recharge would do
 * now (GET /notification/auto-recharge-state, GET /ai/auto-recharge-state).
 * While its last automatic charge has failed, the page says so first, in
 * red, with what to do for someone who may add balance and who can for
 * everyone else - it used to reach only the owners, by email.
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

// What the server answers about Auto Recharge, for the page being opened.
let autoRechargeState: string = AutoRechargeState.Ready;

const NOTICE_TEST_ID: string = "auto-recharge-failed-notice";

async function autoRechargeAsked(): Promise<void> {
  await flush();
  await flush();
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
  autoRechargeState = AutoRechargeState.Ready;
  jest.spyOn(API, "get").mockImplementation((async (): Promise<unknown> => {
    return new HTTPResponse<JSONObject>(
      200,
      { state: autoRechargeState },
      {},
    ) as unknown;
  }) as never);
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

  test.each([
    ["a project owner", Permission.ProjectOwner],
    ["someone with Manage Billing", Permission.ManageProjectBilling],
  ])(
    "Auto Recharge's last charge failed: %s is told first, in red, to check the payment method or recharge now",
    async (_who: string, permission: Permission) => {
      autoRechargeState = AutoRechargeState.Failed;
      grant([...BASE_PERMISSIONS, permission]);
      page.open();

      const notice: HTMLElement = await screen.findByTestId(
        NOTICE_TEST_ID,
        {},
        { timeout: WAIT_TIMEOUT },
      );

      expect(notice).toHaveTextContent(AUTO_RECHARGE_FAILED_TITLE);
      expect(notice).toHaveTextContent(
        AUTO_RECHARGE_FAILED_DESCRIPTIONS[page.balance].forPeopleWhoMayAdd,
      );
      expect(notice).toHaveTextContent("Check the payment method");
      expect(notice).toHaveAttribute("role", "alert");
      // Red: a charge that failed.
      expect(notice.className).toContain("bg-red-50");

      // First on the page: above the Current Balance card.
      const balanceCard: HTMLElement = await cardOf("Current Balance");
      expect(
        notice.compareDocumentPosition(balanceCard) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  test.each([
    ["a project admin", Permission.ProjectAdmin],
    ["a member", Permission.ProjectMember],
    ["the Billing Admin role", Permission.BillingAdmin],
  ])(
    "Auto Recharge's last charge failed: %s is told who can add balance, not to do it",
    async (_who: string, permission: Permission) => {
      autoRechargeState = AutoRechargeState.Failed;
      grant([...BASE_PERMISSIONS, permission]);
      page.open();

      const notice: HTMLElement = await screen.findByTestId(
        NOTICE_TEST_ID,
        {},
        { timeout: WAIT_TIMEOUT },
      );

      expect(notice).toHaveTextContent(
        AUTO_RECHARGE_FAILED_DESCRIPTIONS[page.balance].forEveryoneElse,
      );
      expect(notice).toHaveTextContent(
        "A project owner or someone with Manage Billing can",
      );
      expect(notice).not.toHaveTextContent("Check the payment method");
    },
  );

  test("Auto Recharge's last charge failed, before the permissions arrive: told who can", async () => {
    autoRechargeState = AutoRechargeState.Failed;
    grant([]);
    page.open();

    const notice: HTMLElement = await screen.findByTestId(
      NOTICE_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(notice).toHaveTextContent(
      AUTO_RECHARGE_FAILED_DESCRIPTIONS[page.balance].forEveryoneElse,
    );
  });

  test("the page asks its own balance's route, for the project it shows", async () => {
    grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);
    page.open();
    await cardOf("Current Balance");
    await autoRechargeAsked();

    const urls: Array<string> = (
      API.get as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>) => {
      return ((call[0] as { url: URL }).url as URL).toString();
    });

    expect(
      urls.some((url: string) => {
        return url.endsWith(
          PROJECT_BALANCE_AUTO_RECHARGE_STATE_ROUTE[page.balance],
        );
      }),
    ).toBe(true);

    const call: { headers: Record<string, unknown> } = (
      API.get as unknown as jest.Mock
    ).mock.calls[0]![0] as { headers: Record<string, unknown> };
    expect(String(call.headers["tenantid"])).toBe(PROJECT_ID);
  });

  test.each([
    ["Ready", AutoRechargeState.Ready],
    ["Off", AutoRechargeState.Off],
  ])(
    "Auto Recharge %s: nothing is said",
    async (_name: string, state: AutoRechargeState) => {
      autoRechargeState = state;
      grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);
      page.open();
      await cardOf("Current Balance");
      await autoRechargeAsked();

      expect(screen.queryByTestId(NOTICE_TEST_ID)).not.toBeInTheDocument();
    },
  );

  test("the state cannot be read: nothing is said, and the page works", async () => {
    (API.get as unknown as jest.Mock).mockImplementation((async () => {
      throw new Error("network error");
    }) as never);
    grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);
    page.open();

    const balanceCard: HTMLElement = await cardOf("Current Balance");
    await autoRechargeAsked();

    expect(screen.queryByTestId(NOTICE_TEST_ID)).not.toBeInTheDocument();
    expect(buttonIn(balanceCard, "Recharge Balance")).not.toBeDisabled();
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

/*
 * A project a cloud marketplace bills has no card: its balances are still
 * recharged - by hand or by Auto Recharge - and billed through the
 * marketplace. Each page says so on its Current Balance card, keeps the
 * Recharge button for the people who may, and when Auto Recharge's last
 * charge was refused names the marketplace to check, not the card.
 */
describe.each(PAGES)(
  "$name on a project a cloud marketplace bills",
  (page: BalancePage) => {
    const BILLED_THROUGH_AWS: string =
      "Recharges and Auto Recharge are billed through AWS Marketplace, not a card.";

    beforeEach(() => {
      jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(
        Object.assign(new Project(), {
          _id: PROJECT_ID,
          billingMarketplace: CloudMarketplace.AWS,
        }),
      );
    });

    test("someone who may is asked to recharge it, told where it is billed, and may", async () => {
      grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);
      page.open();

      const balanceCard: HTMLElement = await cardOf("Current Balance");

      expect(balanceCard).toHaveTextContent(
        PROJECT_BALANCE_CARD_DESCRIPTIONS[page.balance].forPeopleWhoMayAdd,
      );
      expect(balanceCard).toHaveTextContent(BILLED_THROUGH_AWS);

      const recharge: HTMLElement = buttonIn(balanceCard, "Recharge Balance")!;

      expect(recharge).not.toBeNull();
      expect(recharge).not.toBeDisabled();
    });

    test("everyone else is told who can, and where it is billed", async () => {
      grant([...BASE_PERMISSIONS, Permission.ProjectMember]);
      page.open();

      const balanceCard: HTMLElement = await cardOf("Current Balance");

      expect(balanceCard).toHaveTextContent(
        PROJECT_BALANCE_CARD_DESCRIPTIONS[page.balance].forEveryoneElse,
      );
      expect(balanceCard).toHaveTextContent(BILLED_THROUGH_AWS);
      expect(buttonIn(balanceCard, "Recharge Balance")).toBeDisabled();
    });

    test("a refused Auto Recharge names the marketplace to check, not the card", async () => {
      autoRechargeState = AutoRechargeState.Failed;
      grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);
      page.open();
      await autoRechargeAsked();

      const notice: HTMLElement = await screen.findByTestId(
        NOTICE_TEST_ID,
        {},
        { timeout: WAIT_TIMEOUT },
      );

      expect(notice).toHaveTextContent(
        "Auto Recharge could not bill AWS Marketplace.",
      );
      expect(notice).toHaveTextContent(
        "Check that this project's subscription on AWS Marketplace is active",
      );
      expect(notice).not.toHaveTextContent(AUTO_RECHARGE_FAILED_TITLE);
      expect(notice).not.toHaveTextContent(
        AUTO_RECHARGE_FAILED_DESCRIPTIONS[page.balance].forPeopleWhoMayAdd,
      );
    });

    test("a card-billed project's page says nothing about a marketplace", async () => {
      jest
        .spyOn(ProjectUtil, "getCurrentProject")
        .mockReturnValue(Object.assign(new Project(), { _id: PROJECT_ID }));
      grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);
      page.open();

      const balanceCard: HTMLElement = await cardOf("Current Balance");

      expect(balanceCard).not.toHaveTextContent("billed through");
    });
  },
);

/*
 * The Auto Recharge card, as each page draws it (Components/ProjectBalance/
 * AutoRechargeCard): one line that says what it does, and an Edit dialog
 * that asks for the two amounts only once it is on. Its helpers are pinned
 * in AutoRechargeCard.test.ts.
 */
describe.each(PAGES)("$name: the Auto Recharge card", (page: BalancePage) => {
  const enableColumn: string =
    page.balance === ProjectBalanceType.AI
      ? "enableAutoRechargeAiBalance"
      : "enableAutoRechargeSmsOrCallBalance";

  // The project the page reads, with this balance's Auto Recharge on or off.
  const projectWithAutoRecharge: (isOn: boolean) => void = (
    isOn: boolean,
  ): void => {
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
      [enableColumn]: isOn,
    });

    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<Project> => {
        return project;
      });
  };

  test("says Off while it is off, and shows no amounts", async () => {
    projectWithAutoRecharge(false);
    grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);
    page.open();

    const card: HTMLElement = await cardOf("Auto Recharge");

    expect(
      await within(card).findByTestId(
        "auto-recharge-summary",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveTextContent(/^Off$/);
    expect(card).not.toHaveTextContent("Amount to add");
    expect(card).not.toHaveTextContent("When the balance falls to");
    expect(card).toHaveTextContent(
      "Adds to the balance automatically when it runs low.",
    );
  });

  test("once it is on, says how much it adds and when, in one line", async () => {
    projectWithAutoRecharge(true);
    grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);
    page.open();

    const card: HTMLElement = await cardOf("Auto Recharge");

    expect(
      await within(card).findByTestId(
        "auto-recharge-summary",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveTextContent("Adds 20 USD whenever the balance falls to 10 USD.");
  });

  test("its Edit dialog is titled for it, and asks for the amounts only once it is turned on", async () => {
    projectWithAutoRecharge(false);
    grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);
    page.open();

    const card: HTMLElement = await cardOf("Auto Recharge");

    await within(card).findByTestId(
      "auto-recharge-summary",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    await act(async () => {
      fireEvent.click(buttonIn(card, "Edit Auto Recharge")!);
    });
    await flush();

    const dialog: HTMLElement = await screen.findByTestId(
      "modal",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Edit Auto Recharge",
    );

    const toggle: HTMLElement = await within(dialog).findByRole(
      "switch",
      { name: "Enable Auto Recharge" },
      { timeout: WAIT_TIMEOUT },
    );

    expect(within(dialog).queryByText("Amount to add")).toBeNull();
    expect(within(dialog).queryByText("When the balance falls to")).toBeNull();

    await act(async () => {
      fireEvent.click(toggle);
    });
    await flush();

    expect(within(dialog).getByText("Amount to add")).toBeInTheDocument();
    expect(
      within(dialog).getByText("When the balance falls to"),
    ).toBeInTheDocument();
  });
});
