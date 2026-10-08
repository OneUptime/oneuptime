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
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import AIFeatures from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures";
import APIKeyView from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/APIKeyView";
import AlertAISettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertAISettings";
import DashboardSharing from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Sharing";
import IncidentAISettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPageAccess from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/AuthenticationSettings";
import StatusPageBranding from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Branding";
import TeamViewPermissions, {
  TEAM_PERMISSIONS_ADVANCED_SECTION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Permissions";
import {
  AI_LANE_ADVANCED_CARD_TITLES,
  AI_LANE_ADVANCED_SECTION_TEST_ID,
  AiLane,
  AiLaneAdvancedCard,
  PROJECT_AI_ADVANCED_SECTION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import { DASHBOARD_SHARING_ADVANCED_SECTION_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Sharing/DashboardSharingCopy";
import { BRANDING_ADVANCED_SECTION_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageBrandingCopy";
import { STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { CARD_FRAME_CLASS_NAME } from "../../../UI/Components/Card/Card";
import { MORE_SETTINGS_SECTION_TITLE } from "../../../UI/Components/FoldedSection/FoldedSectionTitles";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import { listedNames } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

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
 * "If you look at More Settings, it looks like a card inside of a card. Can
 * you please fix that UI? More Settings should look like one card instead of
 * a card inside of a card, and it should have dividers. ... Please do this
 * everywhere in the project." - the maintainer.
 *
 * Every page that folds cards under More settings, rendered for real - the
 * page, AdvancedPageSection, Card, CardModelDetail, ModelTable and the switch
 * cards - with only the network and the permission snapshot stubbed. Open,
 * each page's More settings is ONE card:
 *
 *   - the only card frame in it is its own;
 *   - every card in it is a section of it - a divider across the whole card
 *     above it, no border, rounded corners, shadow or gap of its own - and
 *     keeps its title and its actions;
 *   - it holds as many sections as its folded header names, in that order;
 *   - folded, it is the one row it always was.
 */

const RECORD_ID: string = "3a3a3a3a-0000-4000-8000-000000000003";

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.ProjectOwner,
];

// Rows each table answers with.
let rowsPerTable: number = 0;

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
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

function rowOf(modelType: { new (): BaseModel }): BaseModel {
  const row: BaseModel = new modelType();
  const fields: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;

  row._id = "4b4b4b4b-0000-4000-8000-000000000004";
  fields["name"] = "Production";
  fields["title"] = "Docs";
  fields["link"] = "https://docs.example.com";
  fields["isEnabled"] = true;
  fields["permission"] = Permission.DeleteProjectMonitor;
  fields["labels"] = [];
  fields["uptimePercentGreaterThanOrEqualTo"] = 99.9;

  return row;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant(BASE_PERMISSIONS);
  rowsPerTable = 0;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(RECORD_ID));

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (data: unknown): Promise<BaseModel> => {
      const options: { modelType: { new (): BaseModel }; id: ObjectID } =
        data as { modelType: { new (): BaseModel }; id: ObjectID };
      const item: BaseModel = new options.modelType();

      item._id = options.id ? options.id.toString() : RECORD_ID;

      if (item instanceof Project) {
        item.enableAi = true;
      }

      return item;
    });
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (data: unknown): Promise<ListResult<BaseModel>> => {
      const modelType: { new (): BaseModel } = (
        data as { modelType: { new (): BaseModel } }
      ).modelType;
      const rows: Array<BaseModel> = [];

      for (let i: number = 0; i < rowsPerTable; i++) {
        rows.push(rowOf(modelType));
      }

      return { data: rows, count: rows.length, skip: 0, limit: 10 };
    });
  jest.spyOn(ModelAPI, "count").mockImplementation(async (): Promise<number> => {
    return rowsPerTable;
  });
  jest
    .spyOn(API, "post")
    .mockImplementation(async (): Promise<never> => {
      return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
    });
  jest.spyOn(API, "get").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: true,
};

interface MoreSettingsPage {
  name: string;
  path: string;
  element: () => ReactElement;
  sectionTestId: string;
  // The sections' titles, in order: the cards it folds.
  sectionTitles: Array<string>;
  // Whether the folded header names the cards by those same titles.
  namesSectionsByTitle: boolean;
  // How many of its sections are tables.
  tableCount: number;
}

const INCIDENT_TITLES: Record<AiLaneAdvancedCard, string> =
  AI_LANE_ADVANCED_CARD_TITLES[AiLane.Incident];
const ALERT_TITLES: Record<AiLaneAdvancedCard, string> =
  AI_LANE_ADVANCED_CARD_TITLES[AiLane.Alert];

const PAGES: Array<MoreSettingsPage> = [
  {
    name: "Incidents -> AI -> Settings",
    path: `/dashboard/${PROJECT_ID}/incidents/ai/settings`,
    element: (): ReactElement => {
      return <IncidentAISettings {...PAGE_PROPS} />;
    },
    sectionTestId: AI_LANE_ADVANCED_SECTION_TEST_ID[AiLane.Incident],
    sectionTitles: [
      INCIDENT_TITLES[AiLaneAdvancedCard.InvestigationRules],
      INCIDENT_TITLES[AiLaneAdvancedCard.WhichAreInvestigated],
      INCIDENT_TITLES[AiLaneAdvancedCard.InvestigationLimits],
      INCIDENT_TITLES[AiLaneAdvancedCard.RemediationRules],
      INCIDENT_TITLES[AiLaneAdvancedCard.DailyLimits],
    ],
    namesSectionsByTitle: true,
    tableCount: 2,
  },
  {
    name: "Alerts -> AI -> Settings",
    path: `/dashboard/${PROJECT_ID}/alerts/ai/settings`,
    element: (): ReactElement => {
      return <AlertAISettings {...PAGE_PROPS} />;
    },
    sectionTestId: AI_LANE_ADVANCED_SECTION_TEST_ID[AiLane.Alert],
    sectionTitles: [
      ALERT_TITLES[AiLaneAdvancedCard.InvestigationRules],
      ALERT_TITLES[AiLaneAdvancedCard.WhichAreInvestigated],
      ALERT_TITLES[AiLaneAdvancedCard.InvestigationLimits],
      ALERT_TITLES[AiLaneAdvancedCard.RemediationRules],
      ALERT_TITLES[AiLaneAdvancedCard.DailyLimits],
    ],
    namesSectionsByTitle: true,
    tableCount: 2,
  },
  {
    name: "Project Settings -> AI Features",
    path: `/dashboard/${PROJECT_ID}/settings/ai-features`,
    element: (): ReactElement => {
      return <AIFeatures {...PAGE_PROPS} />;
    },
    sectionTestId: PROJECT_AI_ADVANCED_SECTION_TEST_ID,
    sectionTitles: ["Daily limits"],
    namesSectionsByTitle: false,
    tableCount: 0,
  },
  {
    name: "Project Settings -> API Keys -> a key",
    path: `/dashboard/${PROJECT_ID}/settings/api-keys/${RECORD_ID}`,
    element: (): ReactElement => {
      return <APIKeyView {...PAGE_PROPS} />;
    },
    sectionTestId: "api-key-advanced-section",
    sectionTitles: ["Block Permissions"],
    namesSectionsByTitle: true,
    tableCount: 1,
  },
  {
    name: "Teams -> a team -> Permissions",
    path: `/dashboard/${PROJECT_ID}/settings/teams/${RECORD_ID}/permissions`,
    element: (): ReactElement => {
      return <TeamViewPermissions {...PAGE_PROPS} />;
    },
    sectionTestId: TEAM_PERMISSIONS_ADVANCED_SECTION_TEST_ID,
    sectionTitles: ["Block Permissions"],
    namesSectionsByTitle: true,
    tableCount: 1,
  },
  {
    name: "Status Pages -> a page -> Branding",
    path: `/dashboard/${PROJECT_ID}/status-pages/${RECORD_ID}/branding`,
    element: (): ReactElement => {
      return <StatusPageBranding {...PAGE_PROPS} />;
    },
    sectionTestId: BRANDING_ADVANCED_SECTION_TEST_ID,
    sectionTitles: [
      "Default Bar Color of the History Chart",
      "Rules for Bar Colors of History Chart",
      "Languages",
      "Search Engine Indexing",
    ],
    namesSectionsByTitle: false,
    tableCount: 1,
  },
  {
    name: "Status Pages -> a page -> Security -> Access",
    path: `/dashboard/${PROJECT_ID}/status-pages/${RECORD_ID}/authentication-settings`,
    element: (): ReactElement => {
      return <StatusPageAccess {...PAGE_PROPS} />;
    },
    sectionTestId: STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID,
    sectionTitles: ["IP Allowlist"],
    namesSectionsByTitle: true,
    tableCount: 0,
  },
  {
    name: "Dashboards -> a dashboard -> Sharing",
    path: `/dashboard/${PROJECT_ID}/dashboards/${RECORD_ID}/sharing`,
    element: (): ReactElement => {
      return <DashboardSharing {...PAGE_PROPS} />;
    },
    sectionTestId: DASHBOARD_SHARING_ADVANCED_SECTION_TEST_ID,
    sectionTitles: ["IP Allowlist"],
    namesSectionsByTitle: true,
    tableCount: 0,
  },
];

const FRAME_TOKENS: Array<string> = CARD_FRAME_CLASS_NAME.split(" ").filter(
  (token: string): boolean => {
    return token !== "overflow-visible";
  },
);

function openPage(page: MoreSettingsPage): void {
  goTo(page.path);

  render(<MemoryRouter initialEntries={[page.path]}>{page.element()}</MemoryRouter>);
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function moreSettings(page: MoreSettingsPage): HTMLElement {
  return screen.getByTestId(page.sectionTestId);
}

function header(page: MoreSettingsPage): HTMLElement {
  return within(moreSettings(page)).getByRole("button", {
    name: MORE_SETTINGS_SECTION_TITLE,
  });
}

// Every element carrying a card's frame: a white box, its border, its rounded corners, its shadow.
function cardFramesIn(root: HTMLElement): Array<HTMLElement> {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))].filter(
    (element: HTMLElement): boolean => {
      return FRAME_TOKENS.every((token: string): boolean => {
        return element.classList.contains(token);
      });
    },
  );
}

function sectionsIn(page: MoreSettingsPage): Array<HTMLElement> {
  return within(moreSettings(page)).getAllByTestId("card");
}

function titleOf(section: HTMLElement): string {
  return (
    within(section).getByTestId("card-details-heading").textContent || ""
  ).trim();
}

async function openPageAndLoad(page: MoreSettingsPage): Promise<void> {
  openPage(page);

  await waitFor(
    () => {
      expect(sectionsIn(page).length).toBe(page.sectionTitles.length);
    },
    { timeout: 20000 },
  );

  await flush();
}

describe.each(PAGES)("$name: More settings", (page: MoreSettingsPage) => {
  test("folded, it is one row: its own frame, its header, nothing else on screen", async () => {
    await openPageAndLoad(page);

    expect(header(page)).toHaveAttribute("aria-expanded", "false");

    const body: HTMLElement = document.getElementById(
      header(page).getAttribute("aria-controls") as string,
    ) as HTMLElement;

    expect(body).toHaveClass("max-h-0", "opacity-0", "invisible");
    // Mounted, so each card has loaded and can say what it holds.
    expect(within(body).getAllByTestId("card").length).toBe(
      page.sectionTitles.length,
    );
  });

  test("its folded header names one thing for each section it holds", async () => {
    await openPageAndLoad(page);

    const names: Array<string> = listedNames(moreSettings(page));

    expect(names.length).toBe(page.sectionTitles.length);

    if (page.namesSectionsByTitle) {
      expect(names).toEqual(page.sectionTitles);
    }
  });

  test("open, it is one card: the only card frame in it is its own", async () => {
    await openPageAndLoad(page);

    fireEvent.click(header(page));

    expect(header(page)).toHaveAttribute("aria-expanded", "true");

    const frames: Array<HTMLElement> = cardFramesIn(moreSettings(page));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveAttribute("data-testid", "folded-section");
    expect(frames[0]).toContainElement(header(page));
  });

  test("open, every card in it is a section with a divider across the whole card above it", async () => {
    await openPageAndLoad(page);

    fireEvent.click(header(page));

    const sections: Array<HTMLElement> = sectionsIn(page);

    expect(sections.map(titleOf)).toEqual(page.sectionTitles);

    for (const section of sections) {
      expect([titleOf(section), section.getAttribute("data-card-surface")]).toEqual([
        titleOf(section),
        "section",
      ]);
      expect(section).toHaveClass("border-t", "border-gray-200");
      expect(section).not.toHaveClass("mb-5");
      expect(section.firstElementChild).not.toHaveClass("rounded-xl");
      expect(section.firstElementChild).not.toHaveClass("shadow-sm");
    }
  });

  test("open, its sections sit straight in its body, edge to edge, one after another", async () => {
    await openPageAndLoad(page);

    fireEvent.click(header(page));

    const sections: Array<HTMLElement> = sectionsIn(page);
    const body: HTMLElement = document.getElementById(
      header(page).getAttribute("aria-controls") as string,
    ) as HTMLElement;

    // The body adds no padding and no rule; the first section's divider is the line under the header.
    expect((body.firstElementChild as HTMLElement).getAttribute("class") || "").toBe(
      "",
    );
    expect(body).toHaveClass("rounded-b-xl", "overflow-hidden");

    for (const section of sections) {
      expect(body).toContainElement(section);
      expect(
        Array.from(section.classList).some((token: string): boolean => {
          return /^-?m[xlr]?-/.test(token) || /^-?p[xlr]-/.test(token);
        }),
      ).toBe(false);
    }
  });

  test("with rows in its tables, every table footer in it is square, ending on a divider", async () => {
    rowsPerTable = 1;

    await openPageAndLoad(page);

    fireEvent.click(header(page));

    const footers: Array<HTMLElement> = within(
      moreSettings(page),
    ).queryAllByTestId("table-footer");

    expect(footers).toHaveLength(page.tableCount);

    for (const footer of footers) {
      expect(footer).not.toHaveClass("rounded-b-xl");
      expect(footer.closest("[data-card-surface='section']")).not.toBeNull();
    }
  });
});

describe("the cards around More settings are cards, as they were", () => {
  test("the cards above a page's More settings keep their frame", async () => {
    const page: MoreSettingsPage = PAGES.find(
      (candidate: MoreSettingsPage): boolean => {
        return candidate.sectionTestId === "api-key-advanced-section";
      },
    ) as MoreSettingsPage;

    await openPageAndLoad(page);

    const outside: Array<HTMLElement> = screen
      .getAllByTestId("card")
      .filter((card: HTMLElement): boolean => {
        return !moreSettings(page).contains(card);
      });

    // API Key Details, Permissions, Reset API Key, Delete API Key.
    expect(outside.length).toBeGreaterThanOrEqual(3);

    for (const card of outside) {
      expect(card).not.toHaveAttribute("data-card-surface");
      expect(card).toHaveClass("mb-5");
      expect(card.firstElementChild).toHaveClass("rounded-xl", "shadow-sm");
    }
  });
});
