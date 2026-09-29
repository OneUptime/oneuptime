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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import AIFeatures, {
  AI_FEATURES_CARD_TITLE,
  AI_FEATURE_FIELDS,
  canEditAiFeatures,
  getAiFeaturesPermissionMessage,
  getAiFeaturesUpdatePermissions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures";
import AICredits from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AICredits";
import SettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu";
import IncidentAISettings, {
  POSTMORTEM_DRAFT_CARD_TITLE,
  POSTMORTEM_DRAFT_FIELDS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings";
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
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
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
 * The project's AI switches and where they live.
 *
 * Enable AI, Enable auto-remediation and Enable AI command execution used to
 * sit on AI Credits (or, for auto-remediation, nowhere) — a page the settings
 * menu lists only when billing is on, so on a self-hosted install the master
 * switch was reachable only by typing its URL. They now live together on
 * "Project Settings → AI Features", first in the AI section of the menu and
 * outside the billing branch. The same pages are rendered for real here,
 * with the model API and the permission snapshot stubbed.
 *
 * Also here: the incident AI settings page's new "Draft a postmortem
 * automatically when an incident resolves" switch, which is its own card so
 * it can never ride on (or be overwritten by) the investigation settings.
 */

const WAIT_TIMEOUT: number = 20000;

const AI_FEATURES_PATH: string = `/dashboard/${PROJECT_ID}/settings/ai-features`;

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

const MOVED_SWITCH_TITLES: Array<string> = [
  "Enable AI",
  "Enable Auto-Remediation",
  "Enable AI Command Execution (for Runners)",
];

let project: Project;
let getItemSpy: ReturnType<typeof jest.spyOn>;
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

function itemRequests(): Array<{ select?: Record<string, unknown> }> {
  return getItemSpy.mock.calls.map(
    (call: Array<unknown>): { select?: Record<string, unknown> } => {
      return (call[0] || {}) as { select?: Record<string, unknown> };
    },
  );
}

function postedProject(): Project {
  return (createOrUpdateSpy.mock.calls[0]![0] as { model: Project }).model;
}

// A detail row's title, as ModelDetail renders it.
function detailTitle(title: string): HTMLElement {
  return screen.getByText(title, { selector: "label > span" });
}

// The value a detail row shows, by its title.
function detailValue(title: string): string {
  const row: HTMLElement | null =
    detailTitle(title).closest("div.space-y-1")?.parentElement || null;
  return row?.textContent || "";
}

async function openEditModal(buttonText: string): Promise<HTMLElement> {
  const button: HTMLElement = await findText(buttonText);
  fireEvent.click(button);
  return await screen.findByRole("dialog", {}, { timeout: WAIT_TIMEOUT });
}

/*
 * A form switch by its field title. The accessible name is the field label,
 * which also carries "(Optional)" for a field that is not required.
 */
function switchName(title: string): RegExp {
  return new RegExp(
    `^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\(Optional\\))?$`,
  );
}

async function waitForSwitch(
  dialog: HTMLElement,
  name: string,
  checked: boolean,
): Promise<HTMLElement> {
  const toggle: HTMLElement = await within(dialog).findByRole(
    "switch",
    { name: switchName(name) },
    { timeout: WAIT_TIMEOUT },
  );
  await waitFor(
    () => {
      expect(toggle).toHaveAttribute("aria-checked", String(checked));
    },
    { timeout: WAIT_TIMEOUT },
  );
  return toggle;
}

async function save(dialog: HTMLElement): Promise<void> {
  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
  await waitFor(
    () => {
      expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);

  project = Object.assign(new Project(), {
    _id: PROJECT_ID,
    enableAi: true,
    enableAutoRemediation: false,
    enableAiCommandExecution: false,
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
  createOrUpdateSpy = jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<never> => {
      return { data: {} } as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  billingEnabledForTest = false;
});

describe("who may change the AI features", () => {
  test("follows the three columns' own update permissions", () => {
    const project: Project = new Project();
    const expected: Array<Permission> = (
      project.getColumnAccessControlFor("enableAi")?.update || []
    ).filter((permission: Permission): boolean => {
      return AI_FEATURE_FIELDS.every((field: string): boolean => {
        return (
          project.getColumnAccessControlFor(field)?.update || []
        ).includes(permission);
      });
    });

    expect(AI_FEATURE_FIELDS).toEqual([
      "enableAi",
      "enableAutoRemediation",
      "enableAiCommandExecution",
    ]);
    expect(getAiFeaturesUpdatePermissions()).toEqual(expected);
    expect(getAiFeaturesUpdatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]);
  });

  test("is narrower than the Project table's update list", () => {
    // Why the card cannot rely on CardModelDetail's table-level gate.
    expect(new Project().getUpdatePermissions()).toEqual(
      expect.arrayContaining([Permission.ProjectAdmin, Permission.EditProject]),
    );
    expect(getAiFeaturesUpdatePermissions()).not.toContain(
      Permission.ProjectAdmin,
    );
    expect(getAiFeaturesUpdatePermissions()).not.toContain(
      Permission.EditProject,
    );
  });

  test.each([
    [Permission.ProjectOwner, true],
    [Permission.ManageProjectBilling, true],
    [Permission.ProjectAdmin, false],
    [Permission.EditProject, false],
    [Permission.ProjectMember, false],
    [Permission.Viewer, false],
  ])("%s may change them: %s", (permission: Permission, allowed: boolean) => {
    grant([...BASE_PERMISSIONS, permission]);
    expect(canEditAiFeatures()).toBe(allowed);
  });

  test("a master admin may change them", () => {
    grant([], true);
    expect(canEditAiFeatures()).toBe(true);
  });

  test("the locked button's reason names the permissions", () => {
    expect(getAiFeaturesPermissionMessage()).toBe(
      "Changing these needs one of these permissions: Project Owner, Manage Billing.",
    );
  });
});

/*
 * The shared gate the AI Features card and the postmortem draft card use in
 * place of CardModelDetail's table-level one.
 */
describe("the Project column edit gate", () => {
  test("keeps the permissions every listed column allows, in the first column's order", () => {
    expect(
      getProjectColumnsUpdatePermissions([
        "enableAi",
        "enableAiCommandExecution",
      ]),
    ).toEqual([Permission.ProjectOwner, Permission.ManageProjectBilling]);
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
  test("shows the three switches with the project's values", async () => {
    openAiFeatures();

    expect(await findText(AI_FEATURES_CARD_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText("Turn OneUptime AI on or off for this project."),
    ).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getAllByText("Yes").length).toBe(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(screen.getAllByText("No").length).toBe(2);

    for (const title of MOVED_SWITCH_TITLES) {
      expect(detailTitle(title)).toBeInTheDocument();
    }
    expect(detailValue("Enable AI")).toContain("Yes");
    expect(detailValue("Enable Auto-Remediation")).toContain("No");
    expect(detailValue("Enable AI Command Execution (for Runners)")).toContain(
      "No",
    );
  });

  test("reads the project it is on, and only the three switches", async () => {
    openAiFeatures();
    await findText("Edit AI Features");

    await waitFor(
      () => {
        expect(itemRequests().length).toBeGreaterThan(0);
      },
      { timeout: WAIT_TIMEOUT },
    );
    const call: { id?: unknown; select?: Record<string, unknown> } = getItemSpy
      .mock.calls[0]![0] as {
      id?: unknown;
      select?: Record<string, unknown>;
    };
    expect(String(call.id)).toBe(PROJECT_ID);
    expect(Object.keys(call.select || {})).toEqual(
      expect.arrayContaining([...AI_FEATURE_FIELDS]),
    );
    expect(call.select).not.toHaveProperty("aiCurrentBalanceInUSDCents");
  });

  test("a project owner edits all three in one form and saves exactly them", async () => {
    openAiFeatures();

    const dialog: HTMLElement = await openEditModal("Edit AI Features");
    await waitForSwitch(dialog, "Enable AI", true);
    const autoRemediation: HTMLElement = await waitForSwitch(
      dialog,
      "Enable Auto-Remediation",
      false,
    );
    await waitForSwitch(
      dialog,
      "Enable AI Command Execution (for Runners)",
      false,
    );

    expect(
      within(dialog).getByText(/never proposes or applies a fix/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /Kubernetes clusters connected through the Kubernetes AI agent do not need this/,
      ),
    ).toBeInTheDocument();
    /*
     * The switch also gates fixes on a cluster reached through an advanced
     * Runner with a Kubernetes credential, so an owner of such a cluster must
     * be told before switching it off.
     */
    expect(
      within(dialog).getByText(
        /Kubernetes clusters reached through a Runner with a Kubernetes credential/,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /auto-remediation rules on the Runners you opt in/,
      ),
    ).toBeInTheDocument();

    fireEvent.click(autoRemediation);
    await save(dialog);

    const posted: Project = postedProject();
    expect(posted.enableAi).toBe(true);
    expect(posted.enableAutoRemediation).toBe(true);
    expect(posted.enableAiCommandExecution).toBe(false);
    // Nothing else on the project rides along.
    expect(posted.aiCurrentBalanceInUSDCents).toBeUndefined();
    expect(posted.enableAutomaticIncidentInvestigation).toBeUndefined();
    expect(posted.enableAutomaticPostmortemDraft).toBeUndefined();
  });

  test("someone with Manage Project Billing may edit", async () => {
    grant([...BASE_PERMISSIONS, Permission.ManageProjectBilling]);
    openAiFeatures();

    const button: HTMLElement = await findText("Edit AI Features");
    expect(button.closest("button")).not.toBeDisabled();
  });

  test("a master admin may edit", async () => {
    grant([], true);
    openAiFeatures();

    const button: HTMLElement = await findText("Edit AI Features");
    expect(button.closest("button")).not.toBeDisabled();
  });

  test.each([
    [Permission.ProjectAdmin],
    [Permission.ProjectMember],
    [Permission.Viewer],
  ])("is locked, with the reason, for %s", async (permission: Permission) => {
    grant([...BASE_PERMISSIONS, permission]);
    openAiFeatures();

    await findText(AI_FEATURES_CARD_TITLE);
    await waitFor(
      () => {
        expect(screen.getAllByText("No").length).toBe(2);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const buttons: Array<HTMLElement> = screen
      .getAllByText("Edit AI Features")
      .map((text: HTMLElement): HTMLElement => {
        return text.closest("button") as HTMLElement;
      });
    expect(buttons.length).toBe(1);
    expect(buttons[0]).toBeDisabled();

    fireEvent.click(buttons[0]!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(createOrUpdateSpy).not.toHaveBeenCalled();
  });

  test("offers no button at all before the permission snapshot has landed", async () => {
    grant([]);
    openAiFeatures();

    /*
     * Telling somebody they need a permission they may well hold is worse
     * than briefly not offering the button: neither the card's own gate nor
     * the locked copy renders until the snapshot lands.
     */
    await findText(AI_FEATURES_CARD_TITLE);
    await findText("Turn OneUptime AI on or off for this project.");
    expect(screen.queryByText("Edit AI Features")).not.toBeInTheDocument();
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

describe("Incidents → Settings → AI", () => {
  const POSTMORTEM_SWITCH: string =
    "Draft a postmortem automatically when an incident resolves";

  function openIncidentAiSettings(): void {
    renderPage(
      <IncidentAISettings
        pageRoute={RouteMap[PageMap.INCIDENTS_SETTINGS_AI] as Route}
        currentProject={null}
        hasPaymentMethod={true}
      />,
      `/dashboard/${PROJECT_ID}/incidents/settings/ai`,
    );
  }

  test("has its own card for the postmortem draft, off by default here", async () => {
    openIncidentAiSettings();

    expect(await findText("Automatic Postmortem Draft")).toBeInTheDocument();
    expect(
      screen.getByText(/This is separate from automatic investigation\./),
    ).toBeInTheDocument();
    await waitFor(
      () => {
        expect(detailTitle(POSTMORTEM_SWITCH)).toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
    await waitFor(
      () => {
        expect(detailValue(POSTMORTEM_SWITCH)).toContain("No");
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("the investigation card no longer says anything about postmortems", async () => {
    openIncidentAiSettings();

    const investigationTitle: HTMLElement = await findText(
      "Automatic Incident Investigation",
    );
    const card: HTMLElement | null = investigationTitle.closest(
      '[data-testid="card"]',
    );
    expect(card).not.toBeNull();
    expect(card!.textContent || "").not.toMatch(/postmortem/i);
  });

  test("turning the draft on saves only that switch", async () => {
    openIncidentAiSettings();
    await findText("Automatic Postmortem Draft");

    const card: HTMLElement = (
      await findText("Automatic Postmortem Draft")
    ).closest('[data-testid="card"]') as HTMLElement;
    fireEvent.click(within(card).getByText("Update"));
    const dialog: HTMLElement = await screen.findByRole(
      "dialog",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    const toggle: HTMLElement = await waitForSwitch(
      dialog,
      POSTMORTEM_SWITCH,
      false,
    );
    expect(
      within(dialog).getByText(
        /never replaces a postmortem that already exists/,
      ),
    ).toBeInTheDocument();

    fireEvent.click(toggle);
    await save(dialog);

    const posted: Project = postedProject();
    expect(posted.enableAutomaticPostmortemDraft).toBe(true);
    expect(posted.enableAutomaticIncidentInvestigation).toBeUndefined();
    expect(posted.incidentAiDailyAutonomousTokenLimit).toBeUndefined();
  });

  async function postmortemCard(): Promise<HTMLElement> {
    return (await findText(POSTMORTEM_DRAFT_CARD_TITLE)).closest(
      '[data-testid="card"]',
    ) as HTMLElement;
  }

  test("the card is gated on exactly the column it writes", () => {
    expect(POSTMORTEM_DRAFT_FIELDS).toEqual(["enableAutomaticPostmortemDraft"]);
    expect(getProjectColumnsUpdatePermissions(POSTMORTEM_DRAFT_FIELDS)).toEqual(
      new Project().getColumnAccessControlFor("enableAutomaticPostmortemDraft")
        ?.update,
    );
  });

  test.each([[Permission.ProjectOwner], [Permission.ProjectAdmin]])(
    "%s gets a working Update button on the postmortem card",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openIncidentAiSettings();

      const card: HTMLElement = await postmortemCard();
      const buttons: Array<HTMLElement> = within(card)
        .getAllByText("Update")
        .map((text: HTMLElement): HTMLElement => {
          return text.closest("button") as HTMLElement;
        });
      expect(buttons.length).toBe(1);
      expect(buttons[0]).not.toBeDisabled();

      fireEvent.click(buttons[0]!);
      expect(
        await screen.findByRole("dialog", {}, { timeout: WAIT_TIMEOUT }),
      ).toBeInTheDocument();
    },
  );

  /*
   * The Project table's update list lets these two in, but the column does
   * not: the card's own gate would give them a save the server refuses.
   */
  test.each([[Permission.ManageProjectBilling], [Permission.EditProject]])(
    "%s sees the postmortem card's Update button locked, with the reason",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openIncidentAiSettings();

      /*
       * Neither role may read the column, so the card shows no value; the
       * locked button is all there is to wait for.
       */
      const card: HTMLElement = await postmortemCard();
      await within(card).findByText("Update", {}, { timeout: WAIT_TIMEOUT });

      const buttons: Array<HTMLElement> = within(card)
        .getAllByText("Update")
        .map((text: HTMLElement): HTMLElement => {
          return text.closest("button") as HTMLElement;
        });
      expect(buttons.length).toBe(1);
      expect(buttons[0]).toBeDisabled();

      fireEvent.click(buttons[0]!);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(createOrUpdateSpy).not.toHaveBeenCalled();
    },
  );

  test("a viewer still reads the postmortem switch, behind a locked button", async () => {
    grant([...BASE_PERMISSIONS, Permission.Viewer]);
    openIncidentAiSettings();

    const card: HTMLElement = await postmortemCard();
    await waitFor(
      () => {
        expect(detailValue(POSTMORTEM_SWITCH)).toContain("No");
      },
      { timeout: WAIT_TIMEOUT },
    );
    const button: HTMLElement | null = within(card)
      .getByText("Update")
      .closest("button");
    expect(button).toBeDisabled();
  });

  test("the postmortem card offers no button before the permission snapshot has landed", async () => {
    grant([]);
    openIncidentAiSettings();

    const card: HTMLElement = await postmortemCard();
    expect(within(card).queryByText("Update")).not.toBeInTheDocument();
  });
});
