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
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import AIFeatures from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures";
import AICredits from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AICredits";
import SettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu";
import IncidentAISettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings";
import {
  ENABLE_AI_COLUMN,
  ENABLE_AI_SWITCH_TEST_ID,
  EnableAiCopy,
  getProjectAiSwitchTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  ProjectColumnsEditGate,
  canUpdateProjectColumns,
  getProjectColumnsEditGate,
  getProjectColumnsPermissionMessage,
  getProjectColumnsUpdatePermissions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ProjectColumnEditGate";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  SettingsRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getSettingsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SettingsBreadcrumbs";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import {
  MenuLink,
  PROJECT_ID,
  goTo,
  linksIn,
  renderMenu,
  routeFor,
} from "./SideMenuHarness";

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
 * Whether this install has billing on, pinned by the suite instead of read
 * from the environment. The settings menu lists AI Credits only when
 * BILLING_ENABLED is true, and that constant comes from process.env: CI's
 * test-setup.sh writes BILLING_ENABLED=true into config.env and `npm test`
 * exports it, while a bare `npx jest` leaves it unset. A menu assertion that
 * inherited it would describe whichever machine ran it rather than the
 * install the test names. A getter, so each test can choose.
 */
let billingEnabledForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

/*
 * The project's AI switch and where it lives.
 *
 * Enable AI used to sit on AI Credits — a page the settings menu lists only
 * when billing is on, so on a self-hosted install the master switch was
 * reachable only by typing its URL. It now lives on "Project Settings → AI
 * Features", first in the AI section of the menu and outside the billing
 * branch. It is the project's only AI switch: "Enable Auto-Remediation" and
 * "Enable AI Command Execution (for Runners)" once sat next to it and were
 * folded into it. The page is that one switch, saving the moment it is
 * flipped (it used to sit behind "Edit AI Features" and a dialog), asking
 * first before it turns AI off. The same pages are rendered for real here,
 * with the model API and the permission snapshot stubbed.
 *
 * Also here: the incident AI settings page's "Draft a postmortem when an
 * incident resolves" switch, its own column, which no other switch or card
 * on the page can ride on or overwrite.
 */

const WAIT_TIMEOUT: number = 20000;

const AI_FEATURES_PATH: string = `/dashboard/${PROJECT_ID}/settings/ai-features`;

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

// The one switch on the AI Features card.
const ENABLE_AI_TITLE: string = "Enable AI";

/*
 * The switches folded into Enable AI, by the titles the card gave them. The
 * page must never show either again.
 */
const RETIRED_SWITCH_TITLES: Array<string> = [
  "Enable Auto-Remediation",
  "Enable AI Command Execution (for Runners)",
];

/*
 * The retired switches' own words, title-cased as their toggles were. Case
 * matters: Enable AI's description names "auto-remediation" and "AI commands
 * on Runners" in lower case, which is what it covers now.
 */
const RETIRED_SWITCH_WORDING: Array<RegExp> = [
  /Auto-Remediation/,
  /AI Command Execution/,
  /never proposes or applies a fix/,
  /do not need this/,
];

/*
 * Every Project column the page may read or write: Enable AI, and the
 * project's daily AI limits in the Daily limits card under More settings.
 * Anything else on a request is a field riding along.
 */
const AI_FEATURES_COLUMNS: Array<string> = [
  "_id",
  "enableAi",
  "aiDailyTokenLimit",
  "aiDailySpendLimitInUSD",
];

let project: Project;
let getItemSpy: ReturnType<typeof jest.spyOn>;
let updateByIdSpy: ReturnType<typeof jest.spyOn>;
let createOrUpdateSpy: ReturnType<typeof jest.spyOn>;

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

function renderPage(element: React.ReactElement, path: string): void {
  goTo(path);
  render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
}

function openAiFeatures(): void {
  renderPage(
    <AIFeatures
      pageRoute={RouteMap[PageMap.SETTINGS_AI_FEATURES] as Route}
      currentProject={null}
      hasPaymentMethod={true}
    />,
    AI_FEATURES_PATH,
  );
}

async function findText(text: string | RegExp): Promise<HTMLElement> {
  return await screen.findByText(text, {}, { timeout: WAIT_TIMEOUT });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function itemRequests(): Array<{ select?: Record<string, unknown> }> {
  return getItemSpy.mock.calls.map(
    (call: Array<unknown>): { select?: Record<string, unknown> } => {
      return (call[0] || {}) as { select?: Record<string, unknown> };
    },
  );
}

// Every update the page sent, as the columns and values it wrote.
function updates(): Array<Record<string, unknown>> {
  return updateByIdSpy.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { data: Record<string, unknown> }).data;
    },
  );
}

async function enableAiSwitch(): Promise<HTMLElement> {
  return await screen.findByTestId(
    ENABLE_AI_SWITCH_TEST_ID,
    {},
    { timeout: WAIT_TIMEOUT },
  );
}

async function aiFeaturesCard(): Promise<HTMLElement> {
  return (await findText(EnableAiCopy.cardTitle)).closest(
    '[data-testid="card"]',
  ) as HTMLElement;
}

function expectNoRetiredSwitch(container: HTMLElement): void {
  const text: string = container.textContent || "";

  for (const wording of RETIRED_SWITCH_WORDING) {
    expect({ wording: String(wording), shown: wording.test(text) }).toEqual({
      wording: String(wording),
      shown: false,
    });
  }
}

async function press(control: HTMLElement): Promise<void> {
  fireEvent.click(control);
  await flush();
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);

  project = Object.assign(new Project(), {
    _id: PROJECT_ID,
    enableAi: true,
    enableAutomaticIncidentInvestigation: true,
    enableAutomaticPostmortemDraft: false,
    aiCurrentBalanceInUSDCents: 1250,
    enableAutoRechargeAiBalance: false,
    autoAiRechargeByBalanceInUSD: 20,
    autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
  });

  getItemSpy = jest
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
  updateByIdSpy = jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (): Promise<never> => {
      return {} as never;
    });
  createOrUpdateSpy = jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<never> => {
      return { data: {} } as never;
    });
  // The provider the project would use (the notice asks): a global one.
  jest.spyOn(API, "post").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(
      200,
      {
        isAIEnabledForProject: true,
        defaultProviderId: "9d9d9d9d-0000-4000-8000-000000000001",
        providers: [],
      },
      {},
    ) as unknown as never;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  billingEnabledForTest = false;
});

describe("who may change Enable AI", () => {
  test("the page saves Enable AI and nothing else", () => {
    expect(ENABLE_AI_COLUMN).toBe("enableAi");
  });

  test("follows Enable AI's own update permissions", () => {
    expect(new Project().getColumnAccessControlFor("enableAi")?.update).toEqual(
      [Permission.ProjectOwner, Permission.ManageProjectBilling],
    );
  });

  /*
   * The folded switches are not Project columns any more: no switch could
   * be drawn for either.
   */
  test.each([["enableAutoRemediation"], ["enableAiCommandExecution"]])(
    "%s is no longer a column a switch could save",
    (retiredField: string) => {
      expect(new Project().hasColumn(retiredField)).toBe(false);
      expect(new Project().getColumnAccessControlFor(retiredField)).toBeNull();
      expect(
        getProjectColumnsUpdatePermissions([ENABLE_AI_COLUMN, retiredField]),
      ).toEqual([]);
    },
  );

  test("is narrower than the Project table's update list", () => {
    // Why the switch is gated on its column, not on the table.
    expect(new Project().getUpdatePermissions()).toEqual(
      expect.arrayContaining([Permission.ProjectAdmin, Permission.EditProject]),
    );

    const enableAiUpdate: Array<Permission> =
      new Project().getColumnAccessControlFor("enableAi")?.update || [];

    expect(enableAiUpdate).not.toContain(Permission.ProjectAdmin);
    expect(enableAiUpdate).not.toContain(Permission.EditProject);
  });

  test.each([
    [Permission.ProjectOwner, true],
    [Permission.ManageProjectBilling, true],
    [Permission.ProjectAdmin, false],
    [Permission.EditProject, false],
    [Permission.ProjectMember, false],
    [Permission.Viewer, false],
  ])("%s may change it: %s", (permission: Permission, allowed: boolean) => {
    grant([...BASE_PERMISSIONS, permission]);

    expect(
      PermissionGate.checkColumnUpdate(new Project(), ENABLE_AI_COLUMN)
        .isAllowed,
    ).toBe(allowed);
  });

  test("a master admin may change it", () => {
    grant([], true);

    expect(
      PermissionGate.checkColumnUpdate(new Project(), ENABLE_AI_COLUMN)
        .isAllowed,
    ).toBe(true);
  });

  test("the locked switch's reason names the permissions it needs", () => {
    grant([...BASE_PERMISSIONS, Permission.ProjectAdmin]);

    const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
      new Project(),
      ENABLE_AI_COLUMN,
    );

    expect(gate.disabledReason).toContain(
      "You need one of these permissions: Project Owner, Manage Billing.",
    );
  });
});

/*
 * The shared gate the cards of Project settings use in place of
 * CardModelDetail's table-level one: the AI limit cards under Advanced on
 * Incidents and Alerts → AI → Settings, Linked Alerts and the number
 * prefixes. (A switch gates itself the same way, on its own column:
 * PermissionGate.checkColumnUpdate.)
 */
describe("the Project column edit gate", () => {
  test("keeps the permissions every listed column allows, in the first column's order", () => {
    // enableAi and the AI auto-recharge switch share Owner + Manage Billing.
    expect(
      getProjectColumnsUpdatePermissions([
        "enableAi",
        "enableAutoRechargeAiBalance",
      ]),
    ).toEqual([Permission.ProjectOwner, Permission.ManageProjectBilling]);
    // The project name also takes Edit Project, which enableAi does not.
    expect(getProjectColumnsUpdatePermissions(["enableAi", "name"])).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]);
    expect(
      getProjectColumnsUpdatePermissions(["enableAutomaticPostmortemDraft"]),
    ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
  });

  test("columns with different update lists leave only what they share", () => {
    // enableAi: Owner + Manage Billing; the postmortem switch: Owner + Admin.
    expect(
      getProjectColumnsUpdatePermissions([
        "enableAi",
        "enableAutomaticPostmortemDraft",
      ]),
    ).toEqual([Permission.ProjectOwner]);
  });

  test("no columns, or a column that declares nothing, lets nobody but a master admin in", () => {
    expect(getProjectColumnsUpdatePermissions([])).toEqual([]);
    expect(
      getProjectColumnsUpdatePermissions(["notARealProjectColumn"]),
    ).toEqual([]);
    expect(canUpdateProjectColumns([])).toBe(false);

    grant([], true);
    expect(canUpdateProjectColumns([])).toBe(true);
  });

  test("names the permissions in the locked reason", () => {
    expect(
      getProjectColumnsPermissionMessage(["enableAutomaticPostmortemDraft"]),
    ).toBe(
      "Changing these needs one of these permissions: Project Owner, Project Admin.",
    );
  });

  test("an allowed user gets the card's own button, not a locked one", () => {
    const gate: ProjectColumnsEditGate = getProjectColumnsEditGate({
      fields: ["enableAi"],
      buttonTitle: "Edit",
    });

    expect(gate).toEqual({ isEditable: true, lockedButtons: [] });
  });

  test("anyone else gets one locked button that says why and does nothing", () => {
    grant([...BASE_PERMISSIONS, Permission.ProjectAdmin]);

    const gate: ProjectColumnsEditGate = getProjectColumnsEditGate({
      fields: ["enableAi"],
      buttonTitle: "Edit AI Features",
    });

    expect(gate.isEditable).toBe(false);
    expect(gate.lockedButtons.length).toBe(1);
    expect(gate.lockedButtons[0]).toMatchObject({
      title: "Edit AI Features",
      disabled: true,
      tooltip:
        "Changing these needs one of these permissions: Project Owner, Manage Billing.",
    });
    expect(() => {
      gate.lockedButtons[0]!.onClick();
    }).not.toThrow();
  });

  test("offers nothing before the permission snapshot has landed", () => {
    grant([]);

    expect(
      getProjectColumnsEditGate({ fields: ["enableAi"], buttonTitle: "Edit" }),
    ).toEqual({ isEditable: false, lockedButtons: [] });
  });

  test("a master admin may edit even with an empty snapshot", () => {
    grant([], true);

    expect(
      getProjectColumnsEditGate({ fields: ["enableAi"], buttonTitle: "Edit" }),
    ).toEqual({ isEditable: true, lockedButtons: [] });
  });
});

describe("AI Features page", () => {
  test("is Enable AI's switch, with the project's value", async () => {
    openAiFeatures();

    expect(await findText(EnableAiCopy.cardTitle)).toBeInTheDocument();
    expect(
      screen.getByText("Turn OneUptime AI on or off for this project."),
    ).toBeInTheDocument();

    const enableAi: HTMLElement = await enableAiSwitch();

    expect(enableAi).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: ENABLE_AI_TITLE })).toBe(
      enableAi,
    );
    // The switch is the setting: no Edit button, no dialog.
    expect(screen.queryByText("Edit AI Features")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the card holds exactly one switch", async () => {
    openAiFeatures();

    const card: HTMLElement = await aiFeaturesCard();
    await enableAiSwitch();

    expect(within(card).getAllByRole("switch")).toHaveLength(1);
  });

  test("a master admin sees the one switch too", async () => {
    grant([], true);
    openAiFeatures();

    const card: HTMLElement = await aiFeaturesCard();
    await enableAiSwitch();

    expect(within(card).getAllByRole("switch")).toHaveLength(1);
    expectNoRetiredSwitch(card);
  });

  test("shows AI switched off as off", async () => {
    project.enableAi = false;
    openAiFeatures();

    expect(await enableAiSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("says what it covers", async () => {
    openAiFeatures();
    await enableAiSwitch();

    const row: HTMLElement = screen.getByTestId(
      `${ENABLE_AI_SWITCH_TEST_ID}-row`,
    );

    expect(row).toHaveTextContent(
      /The master switch\. When off, every AI feature in this project stops: Ask AI, investigations, postmortem drafts, auto-remediation and AI commands on Runners\./,
    );
    // Nothing else in the project has to be switched on as well.
    expect(row).toHaveTextContent(
      /Auto-remediation and AI commands on Runners need no other project switch\./,
    );
    expectNoRetiredSwitch(row);
  });

  test("never shows the switches folded into Enable AI", async () => {
    openAiFeatures();
    await enableAiSwitch();

    for (const title of RETIRED_SWITCH_TITLES) {
      expect(screen.queryByText(title)).not.toBeInTheDocument();
    }
    expectNoRetiredSwitch(document.body);
  });

  test("reads the project it is on: Enable AI and the daily AI limits, nothing else", async () => {
    openAiFeatures();
    await enableAiSwitch();

    await waitFor(
      () => {
        expect(
          itemRequests().some(
            (request: { select?: Record<string, unknown> }): boolean => {
              return Boolean(request.select?.["aiDailyTokenLimit"]);
            },
          ),
        ).toBe(true);
      },
      { timeout: WAIT_TIMEOUT },
    );

    // Enable AI's switch reads its own column.
    expect(
      itemRequests().some(
        (request: { select?: Record<string, unknown> }): boolean => {
          return Boolean(request.select?.["enableAi"]);
        },
      ),
    ).toBe(true);

    for (const call of getItemSpy.mock.calls) {
      const request: { id?: unknown; select?: Record<string, unknown> } =
        call[0] as { id?: unknown; select?: Record<string, unknown> };

      expect(String(request.id)).toBe(PROJECT_ID);

      for (const column of Object.keys(request.select || {})) {
        expect(AI_FEATURES_COLUMNS).toContain(column);
      }
    }
  });

  test("a project owner turns AI off: it asks first, then saves exactly that switch", async () => {
    openAiFeatures();

    await press(await enableAiSwitch());

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(EnableAiCopy.turnOffConfirmTitle);
    expect(updateByIdSpy).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: EnableAiCopy.turnOffConfirmButton,
      }),
    );
    await flush();

    expect(updates()).toEqual([{ enableAi: false }]);
    expect(
      String((updateByIdSpy.mock.calls[0]![0] as { id: unknown }).id),
    ).toBe(PROJECT_ID);
    // Nothing goes through a form, so nothing rides along.
    expect(createOrUpdateSpy).not.toHaveBeenCalled();
  });

  test("a project owner turns AI back on at once", async () => {
    project.enableAi = false;
    openAiFeatures();

    await press(await enableAiSwitch());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updates()).toEqual([{ enableAi: true }]);
    expect(
      screen.getByTestId(`${ENABLE_AI_SWITCH_TEST_ID}-status`),
    ).toHaveTextContent("Saved");
  });

  test("someone with Manage Project Billing may flip it", async () => {
    grant([...BASE_PERMISSIONS, Permission.ManageProjectBilling]);
    openAiFeatures();

    expect(await enableAiSwitch()).not.toHaveAttribute("aria-disabled");
  });

  test("a master admin may flip it", async () => {
    grant([], true);
    openAiFeatures();

    expect(await enableAiSwitch()).not.toHaveAttribute("aria-disabled");
  });

  /*
   * A Project Admin may update the project, but not this column: the reason
   * names the column's own permissions. A member or a viewer may not update
   * the project at all, and is told so.
   */
  test.each([
    [Permission.ProjectAdmin, "Project Owner, Manage Billing"],
    [Permission.ProjectMember, "You do not have permission to update this"],
    [Permission.Viewer, "You do not have permission to update this"],
  ])(
    "is locked, with the reason, for %s",
    async (permission: Permission, reason: string) => {
      grant([...BASE_PERMISSIONS, permission]);
      openAiFeatures();

      const enableAi: HTMLElement = await enableAiSwitch();

      // Everyone who may read the project reads the switch.
      expect(enableAi).toHaveAttribute("aria-checked", "true");
      expect(enableAi).toHaveAttribute("aria-disabled", "true");
      expect(
        screen.getByTestId(`${ENABLE_AI_SWITCH_TEST_ID}-row`),
      ).toHaveTextContent(reason);

      await press(enableAi);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(updateByIdSpy).not.toHaveBeenCalled();
    },
  );

  test("before the permission snapshot has landed it is locked, accusing nobody", async () => {
    grant([]);
    openAiFeatures();

    const enableAi: HTMLElement = await enableAiSwitch();

    /*
     * Telling somebody they need a permission they may well hold is worse
     * than briefly not letting the switch move.
     */
    expect(enableAi).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByTestId(`${ENABLE_AI_SWITCH_TEST_ID}-row`),
    ).not.toHaveTextContent("You do not have permission");
  });
});

describe("AI Credits page", () => {
  function openAiCredits(): void {
    renderPage(
      <AICredits
        pageRoute={RouteMap[PageMap.SETTINGS_AI_CREDITS] as Route}
        currentProject={null}
        hasPaymentMethod={true}
      />,
      `/dashboard/${PROJECT_ID}/settings/ai-credits`,
    );
  }

  test("keeps the balance and recharge settings", async () => {
    openAiCredits();

    expect(await findText("Current Balance")).toBeInTheDocument();
    expect(screen.getByText("Auto Recharge")).toBeInTheDocument();
    expect(screen.getByText("Recharge Balance")).toBeInTheDocument();
  });

  test("no longer shows the switches that moved to AI Features", async () => {
    openAiCredits();
    await findText("Current Balance");

    expect(screen.queryByText("Enable AI")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Enable AI Command Execution"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Edit AI Settings")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Edit AI Command Execution Settings"),
    ).not.toBeInTheDocument();

    await waitFor(
      () => {
        expect(itemRequests().length).toBeGreaterThan(0);
      },
      { timeout: WAIT_TIMEOUT },
    );
    for (const request of itemRequests()) {
      expect(request.select).not.toHaveProperty("enableAi");
      expect(request.select).not.toHaveProperty("enableAiCommandExecution");
      expect(request.select).not.toHaveProperty("enableAutoRemediation");
    }
  });
});

describe("settings menu, route and breadcrumbs", () => {
  test("AI Features is the first item of the AI section, on an install without billing", async () => {
    billingEnabledForTest = false;
    goTo(AI_FEATURES_PATH);
    await renderMenu(<SettingsSideMenu />);

    const aiLinks: Array<MenuLink> = linksIn("AI");
    expect(aiLinks[0]).toEqual({
      title: "AI Features",
      href: routeFor(PageMap.SETTINGS_AI_FEATURES),
    });
    // Billing is off: AI Credits is hidden, AI Features is not.
    expect(
      aiLinks.map((link: MenuLink): string => {
        return link.title;
      }),
    ).not.toContain("AI Credits");
  });

  test("AI Features stays first on an install with billing, and AI Credits is listed after it", async () => {
    billingEnabledForTest = true;
    goTo(AI_FEATURES_PATH);
    await renderMenu(<SettingsSideMenu />);

    const aiLinks: Array<MenuLink> = linksIn("AI");
    expect(aiLinks[0]).toEqual({
      title: "AI Features",
      href: routeFor(PageMap.SETTINGS_AI_FEATURES),
    });
    // Billing is on: the balance and recharge page joins the section.
    expect(aiLinks.slice(1)).toContainEqual({
      title: "AI Credits",
      href: routeFor(PageMap.SETTINGS_AI_CREDITS),
    });
  });

  test("lives at settings/ai-features", () => {
    expect(SettingsRoutePath[PageMap.SETTINGS_AI_FEATURES]).toBe("ai-features");
    expect(RouteMap[PageMap.SETTINGS_AI_FEATURES]?.toString()).toBe(
      "/dashboard/:projectId/settings/ai-features",
    );
    expect(routeFor(PageMap.SETTINGS_AI_FEATURES)).toBe(AI_FEATURES_PATH);
  });

  test("has its own breadcrumbs", () => {
    const links: Array<Link> | undefined = getSettingsBreadcrumbs(
      RouteMap[PageMap.SETTINGS_AI_FEATURES]!.toString(),
    );
    expect(
      (links || []).map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Settings", "AI Features"]);
  });
});

describe("Incidents → AI → Settings", () => {
  const POSTMORTEM_SWITCH: string =
    "Draft a postmortem when an incident resolves";

  const POSTMORTEM_TEST_ID: string = getProjectAiSwitchTestId(
    "enableAutomaticPostmortemDraft",
  );

  function openIncidentAiSettings(): void {
    renderPage(
      <IncidentAISettings
        pageRoute={RouteMap[PageMap.INCIDENTS_SETTINGS_AI] as Route}
        currentProject={null}
        hasPaymentMethod={true}
      />,
      `/dashboard/${PROJECT_ID}/incidents/ai/settings`,
    );
  }

  async function postmortemSwitch(): Promise<HTMLElement> {
    return await screen.findByTestId(
      POSTMORTEM_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );
  }

  test("drafting a postmortem is its own switch, off in this project", async () => {
    openIncidentAiSettings();

    const postmortem: HTMLElement = await postmortemSwitch();

    expect(screen.getByRole("switch", { name: POSTMORTEM_SWITCH })).toBe(
      postmortem,
    );
    expect(postmortem).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId(`${POSTMORTEM_TEST_ID}-row`)).toHaveTextContent(
      "It never replaces a postmortem that already exists.",
    );
  });

  test("the investigation switch says nothing about postmortems", async () => {
    openIncidentAiSettings();
    await postmortemSwitch();

    expect(
      screen.getByTestId(
        `${getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation")}-row`,
      ).textContent || "",
    ).not.toMatch(/postmortem/i);
  });

  test("turning the draft on saves only that switch", async () => {
    openIncidentAiSettings();

    await press(await postmortemSwitch());

    expect(updates()).toEqual([{ enableAutomaticPostmortemDraft: true }]);
    expect(createOrUpdateSpy).not.toHaveBeenCalled();
  });

  test("the switch is gated on exactly the column it writes", () => {
    expect(
      new Project().getColumnAccessControlFor("enableAutomaticPostmortemDraft")
        ?.update,
    ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
  });

  test.each([[Permission.ProjectOwner], [Permission.ProjectAdmin]])(
    "%s may flip it",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openIncidentAiSettings();

      const postmortem: HTMLElement = await postmortemSwitch();
      expect(postmortem).not.toHaveAttribute("aria-disabled");

      await press(postmortem);
      expect(updates()).toEqual([{ enableAutomaticPostmortemDraft: true }]);
    },
  );

  /*
   * The Project table's update list lets these two in, but the column does
   * not: the switch is locked, and says which permissions it needs.
   */
  test.each([[Permission.ManageProjectBilling], [Permission.EditProject]])(
    "%s sees it locked, with the reason",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openIncidentAiSettings();

      const postmortem: HTMLElement = await postmortemSwitch();

      expect(postmortem).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByTestId(`${POSTMORTEM_TEST_ID}-row`)).toHaveTextContent(
        "Project Owner, Project Admin",
      );

      await press(postmortem);
      expect(updateByIdSpy).not.toHaveBeenCalled();
    },
  );

  test("a viewer still reads it, locked", async () => {
    grant([...BASE_PERMISSIONS, Permission.Viewer]);
    openIncidentAiSettings();

    const postmortem: HTMLElement = await postmortemSwitch();

    expect(postmortem).toHaveAttribute("aria-checked", "false");
    expect(postmortem).toHaveAttribute("aria-disabled", "true");
  });

  test("before the permission snapshot has landed it is locked, accusing nobody", async () => {
    grant([]);
    openIncidentAiSettings();

    const postmortem: HTMLElement = await postmortemSwitch();

    expect(postmortem).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByTestId(`${POSTMORTEM_TEST_ID}-row`),
    ).not.toHaveTextContent("You do not have permission");
  });
});
