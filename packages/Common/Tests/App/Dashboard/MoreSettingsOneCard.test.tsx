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
import {
  MemoryRouter,
  Route as RouterRoute,
  Routes as RouterRoutes,
} from "react-router-dom";
import AIFeatures from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures";
import APIKeyView from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/APIKeyView";
import AlertAISettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertAISettings";
import DashboardSharing from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Sharing";
import FormShare, {
  FORM_SHARE_MORE_SETTINGS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/Share";
import IncidentAISettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPageAccess from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/AuthenticationSettings";
import StatusPageBranding from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Branding";
import TeamViewPermissions, {
  TEAM_PERMISSIONS_ADVANCED_SECTION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Permissions";
import HostSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Settings";
import RumSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Settings";
import ProjectTelemetrySettings, {
  PROJECT_TELEMETRY_MORE_SETTINGS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/TelemetrySettings";
import NotificationSettings, {
  NOTIFICATION_SETTINGS_MORE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/NotificationSettings";
import StatusPageSettings, {
  STATUS_PAGE_SETTINGS_MORE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/StatusPageSettings";
import { TELEMETRY_RESOURCE_MORE_SETTINGS_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/TelemetryResourceMoreSettings";
import ProfilesAiSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Profiles/AI/Settings";
import EmbeddedStatus, {
  EMBEDDED_STATUS_BADGE_MORE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/EmbeddedStatus";
import {
  TELEMETRY_AI_RULES_CARD_TITLE,
  TELEMETRY_AI_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import {
  AI_LANE_ADVANCED_CARD_TITLES,
  AI_LANE_ADVANCED_SECTION_TEST_ID,
  AiLane,
  AiLaneAdvancedCard,
  AiLaneAdvancedCardTitles,
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
import {
  FoldedSectionItem,
  FoldedSectionItemsShown,
  foldedSectionItem,
  getFoldedSectionItemsShown,
} from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import { listedNames } from "../../UI/Components/FoldedSection/FoldedSectionQueries";
import {
  getPageAnchorNameForTitle,
  isPageAnchorName,
} from "../../../UI/Utils/PageAnchor";

/*
 * A self-hosted Community Edition install: billing off and not the
 * Enterprise Edition, whatever the environment says. CI's config.env turns
 * billing on for every suite, and with billing on a page asks the project's
 * plan instead of the edition - a plan this suite does not have, so the
 * custom roles leftovers its pages fold would never be drawn.
 */
jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    BILLING_ENABLED: false,
    IS_ENTERPRISE_EDITION: false,
  };
});

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

// Each table answers with one row, or none.
function answerWithRows(withRows: boolean): void {
  rowsPerTable = withRows ? 1 : 0;
}

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
    .mockImplementation(
      async (data: unknown): Promise<ListResult<BaseModel>> => {
        const modelType: { new (): BaseModel } = (
          data as { modelType: { new (): BaseModel } }
        ).modelType;
        const rows: Array<BaseModel> = [];

        for (let i: number = 0; i < rowsPerTable; i++) {
          rows.push(rowOf(modelType));
        }

        return { data: rows, count: rows.length, skip: 0, limit: 10 };
      },
    );
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(async (): Promise<number> => {
      return rowsPerTable;
    });
  jest.spyOn(API, "post").mockImplementation(async (): Promise<never> => {
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
  /*
   * Sections the folded header leaves out on purpose: the header names the
   * settings the fold holds, and these hold none (a preview of the settings
   * above it, say).
   */
  sectionsTheHeaderDoesNotName?: Array<string>;
  // Whether the folded header names the cards by those same titles.
  namesSectionsByTitle: boolean;
  // How many of its sections are tables.
  tableCount: number;
  /*
   * With a row in every table, where the fold then holds more: a card drawn
   * only for a record that has something to show (the custom roles a team
   * or key still has).
   */
  withRows?: {
    sectionTitles: Array<string>;
    tableCount: number;
  };
}

type NamedSectionTitlesFunction = (page: MoreSettingsPage) => Array<string>;

// The sections the folded header names, in order.
const namedSectionTitles: NamedSectionTitlesFunction = (
  page: MoreSettingsPage,
): Array<string> => {
  const unnamed: Array<string> = page.sectionsTheHeaderDoesNotName || [];

  return page.sectionTitles.filter((title: string): boolean => {
    return !unnamed.includes(title);
  });
};

const INCIDENT_TITLES: AiLaneAdvancedCardTitles[AiLane.Incident] =
  AI_LANE_ADVANCED_CARD_TITLES[AiLane.Incident];
// Alerts have no postmortem, so no postmortem rules.
const ALERT_TITLES: AiLaneAdvancedCardTitles[AiLane.Alert] =
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
      INCIDENT_TITLES[AiLaneAdvancedCard.AiRules],
      INCIDENT_TITLES[AiLaneAdvancedCard.WhichAreInvestigated],
      INCIDENT_TITLES[AiLaneAdvancedCard.InvestigationLimits],
      INCIDENT_TITLES[AiLaneAdvancedCard.PostmortemRules],
      INCIDENT_TITLES[AiLaneAdvancedCard.DailyLimits],
    ],
    namesSectionsByTitle: true,
    // The AI rules and the postmortem rules.
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
      ALERT_TITLES[AiLaneAdvancedCard.AiRules],
      ALERT_TITLES[AiLaneAdvancedCard.WhichAreInvestigated],
      ALERT_TITLES[AiLaneAdvancedCard.InvestigationLimits],
      ALERT_TITLES[AiLaneAdvancedCard.DailyLimits],
    ],
    namesSectionsByTitle: true,
    // The AI rules.
    tableCount: 1,
  },
  {
    name: "Project Settings -> AI -> AI Features",
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
    name: "Project Settings -> Advanced -> API Keys -> a key",
    path: `/dashboard/${PROJECT_ID}/settings/api-keys/${RECORD_ID}`,
    element: (): ReactElement => {
      return <APIKeyView {...PAGE_PROPS} />;
    },
    sectionTestId: "api-key-advanced-section",
    sectionTitles: ["Block Permissions"],
    namesSectionsByTitle: true,
    tableCount: 1,
    // A key with a custom role: Custom Roles, an advanced feature, first.
    withRows: {
      sectionTitles: ["Custom Roles", "Block Permissions"],
      tableCount: 2,
    },
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
    // A team with a custom role: Custom Roles, an advanced feature, first.
    withRows: {
      sectionTitles: ["Custom Roles", "Block Permissions"],
      tableCount: 2,
    },
  },
  {
    name: "Status Pages -> a page -> Branding",
    path: `/dashboard/${PROJECT_ID}/status-pages/${RECORD_ID}/branding`,
    element: (): ReactElement => {
      return <StatusPageBranding {...PAGE_PROPS} />;
    },
    sectionTestId: BRANDING_ADVANCED_SECTION_TEST_ID,
    sectionTitles: [
      "Default Bar Color",
      "Bar Color Rules",
      "Bar Color Preview",
      "Languages",
      "Search Engine Indexing",
    ],
    // It draws the colors the default and the rules above it give a day.
    sectionsTheHeaderDoesNotName: ["Bar Color Preview"],
    namesSectionsByTitle: true,
    tableCount: 1,
  },
  {
    name: "Status Pages -> a page -> Security -> Access",
    path: `/dashboard/${PROJECT_ID}/status-pages/${RECORD_ID}/authentication-settings`,
    element: (): ReactElement => {
      return <StatusPageAccess {...PAGE_PROPS} />;
    },
    sectionTestId: STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID,
    // How long readers stay signed in, and the IP allowlist: both Enterprise.
    sectionTitles: ["Reader Sessions", "IP Allowlist"],
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
  {
    name: "Forms -> a form -> Share",
    path: `/dashboard/${PROJECT_ID}/forms/${RECORD_ID}/share`,
    element: (): ReactElement => {
      // The page reads the form's id from the route, as its route gives it.
      return (
        <RouterRoutes>
          <RouterRoute
            path="/dashboard/:projectId/forms/:id/share"
            element={<FormShare {...PAGE_PROPS} />}
          />
        </RouterRoutes>
      );
    },
    sectionTestId: FORM_SHARE_MORE_SETTINGS_TEST_ID,
    sectionTitles: ["IP Allowlist"],
    namesSectionsByTitle: true,
    tableCount: 0,
  },
  /*
   * A service's or telemetry resource's Settings: its retention overrides -
   * here the card that sells them, as the Community Edition draws it. Every
   * such page folds them through one component (TelemetryRetentionShells
   * holds all fifteen).
   */
  {
    name: "Infrastructure -> a host -> Settings",
    path: `/dashboard/${PROJECT_ID}/hosts/${RECORD_ID}/settings`,
    element: (): ReactElement => {
      return <HostSettings {...PAGE_PROPS} />;
    },
    sectionTestId: TELEMETRY_RESOURCE_MORE_SETTINGS_TEST_ID,
    sectionTitles: ["Retention Overrides"],
    namesSectionsByTitle: true,
    tableCount: 0,
  },
  // And a RUM application's, with how long its session replays are kept.
  {
    name: "RUM -> an application -> Settings",
    path: `/dashboard/${PROJECT_ID}/rum/${RECORD_ID}/settings`,
    element: (): ReactElement => {
      // The page reads the application's id from the route.
      return (
        <RouterRoutes>
          <RouterRoute
            path="/dashboard/:projectId/rum/:id/settings"
            element={<RumSettings {...PAGE_PROPS} />}
          />
        </RouterRoutes>
      );
    },
    sectionTestId: TELEMETRY_RESOURCE_MORE_SETTINGS_TEST_ID,
    sectionTitles: ["Retention Overrides", "Session Replay Retention"],
    namesSectionsByTitle: true,
    tableCount: 0,
  },
  {
    name: "Project Settings -> Telemetry & APM -> Data Retention",
    path: `/dashboard/${PROJECT_ID}/settings/telemetry-settings`,
    element: (): ReactElement => {
      return <ProjectTelemetrySettings {...PAGE_PROPS} />;
    },
    sectionTestId: PROJECT_TELEMETRY_MORE_SETTINGS_TEST_ID,
    sectionTitles: ["Retention Overrides"],
    namesSectionsByTitle: true,
    tableCount: 0,
  },
  {
    name: "Status Pages -> a page -> Advanced Settings",
    path: `/dashboard/${PROJECT_ID}/status-pages/${RECORD_ID}/settings`,
    element: (): ReactElement => {
      return <StatusPageSettings {...PAGE_PROPS} />;
    },
    sectionTestId: STATUS_PAGE_SETTINGS_MORE_TEST_ID,
    sectionTitles: ["Powered by OneUptime"],
    namesSectionsByTitle: true,
    tableCount: 0,
  },
  {
    name: "Project Settings -> Notifications -> Notification Settings",
    path: `/dashboard/${PROJECT_ID}/settings/notification-settings`,
    element: (): ReactElement => {
      return <NotificationSettings {...PAGE_PROPS} />;
    },
    sectionTestId: NOTIFICATION_SETTINGS_MORE_TEST_ID,
    sectionTitles: ["Custom SMTP Configs", "Twilio Config"],
    namesSectionsByTitle: true,
    // Both are tables.
    tableCount: 2,
  },
  /*
   * A telemetry product's AI -> Settings - the Profiler's here; every lane
   * draws the same page (TelemetryAiSettingsPage) - folds its AI rules.
   */
  {
    name: "Profiles -> AI -> Settings",
    path: `/dashboard/${PROJECT_ID}/profiles/ai/settings`,
    element: (): ReactElement => {
      return <ProfilesAiSettings {...PAGE_PROPS} />;
    },
    sectionTestId: TELEMETRY_AI_TEST_IDS.advancedSection,
    sectionTitles: [TELEMETRY_AI_RULES_CARD_TITLE],
    namesSectionsByTitle: true,
    tableCount: 1,
  },
  // A status page's embedded badge folds its security token.
  {
    name: "Status Pages -> a page -> Embedded Status",
    path: `/dashboard/${PROJECT_ID}/status-pages/${RECORD_ID}/embedded-status`,
    element: (): ReactElement => {
      return <EmbeddedStatus {...PAGE_PROPS} />;
    },
    sectionTestId: EMBEDDED_STATUS_BADGE_MORE_TEST_ID,
    sectionTitles: ["Security Token"],
    namesSectionsByTitle: true,
    tableCount: 0,
  },
];

// A margin or padding on the left or right: what would pull a divider in from the card's sides.
const SIDE_MARGIN: RegExp = /^-?m[xlr]?-/;
const SIDE_PADDING: RegExp = /^-?p[xlr]-/;

const FRAME_TOKENS: Array<string> = CARD_FRAME_CLASS_NAME.split(" ").filter(
  (token: string): boolean => {
    return token !== "overflow-visible";
  },
);

function openPage(page: MoreSettingsPage): void {
  goTo(page.path);

  render(
    <MemoryRouter initialEntries={[page.path]}>{page.element()}</MemoryRouter>,
  );
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

// The sections the fold holds as the test has set the tables up.
function expectedSectionTitles(page: MoreSettingsPage): Array<string> {
  return rowsPerTable > 0 && page.withRows
    ? page.withRows.sectionTitles
    : page.sectionTitles;
}

async function openPageAndLoad(page: MoreSettingsPage): Promise<void> {
  openPage(page);

  await waitFor(
    () => {
      expect(sectionsIn(page).length).toBe(expectedSectionTitles(page).length);
    },
    { timeout: 20000 },
  );

  await flush();
}

// The keys of the names a folded header lists, in order.
function listedKeys(page: MoreSettingsPage): Array<string> {
  return Array.from(
    moreSettings(page).querySelectorAll<HTMLElement>(
      "[data-testid='folded-section-item']",
    ),
  ).map((item: HTMLElement): string => {
    return item.getAttribute("data-item-key") || "";
  });
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

    /*
     * A folded header names a few of what it holds and counts the rest
     * ("2 more"), as every folded section does (FOLDED_SECTION_MAX_ITEMS).
     */
    const expected: FoldedSectionItemsShown = getFoldedSectionItemsShown(
      namedSectionTitles(page).map((title: string): FoldedSectionItem => {
        return foldedSectionItem(title);
      }),
    );

    expect(names.length).toBe(expected.shown.length);
    expect(
      moreSettings(page)?.querySelector("[data-testid='folded-section-more']")
        ?.textContent || "",
    ).toBe(expected.hiddenCount > 0 ? `${expected.hiddenCount} more` : "");

    if (page.namesSectionsByTitle) {
      expect(names).toEqual(
        expected.shown.map((item: FoldedSectionItem): string => {
          return item.title;
        }),
      );
    }
  });

  /*
   * Every card in a page's More settings has a place a link can land on:
   * the id its page gives it, or one after its title (Utils/PageAnchor) -
   * each its own on the page. A link that names one opens More settings
   * there (AdvancedPageSection), whichever page it is.
   */
  test("every card in it has a place of its own a link can land on", async () => {
    await openPageAndLoad(page);

    const ids: Array<string> = sectionsIn(page).map(
      (section: HTMLElement): string => {
        return section.id;
      },
    );

    for (const [index, id] of ids.entries()) {
      expect({
        title: page.sectionTitles[index],
        hasPlace: isPageAnchorName(id),
      }).toEqual({ title: page.sectionTitles[index], hasPlace: true });
      // Its own on the page.
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }

    /*
     * A card the page names by nothing else is landed on by its title: the
     * name its item in the fold goes by too.
     */
    if (page.namesSectionsByTitle) {
      for (const [index, title] of page.sectionTitles.entries()) {
        const fromTitle: string = getPageAnchorNameForTitle(title);

        if (fromTitle && ids[index] === fromTitle) {
          expect(foldedSectionItem(title).key).toBe(ids[index]);
        }
      }
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
      expect([
        titleOf(section),
        section.getAttribute("data-card-surface"),
      ]).toEqual([titleOf(section), "section"]);
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
    expect(
      (body.firstElementChild as HTMLElement).getAttribute("class") || "",
    ).toBe("");
    expect(body).toHaveClass("rounded-b-xl", "overflow-hidden");

    for (const section of sections) {
      expect(body).toContainElement(section);
      expect(
        Array.from(section.classList).some((token: string): boolean => {
          return SIDE_MARGIN.test(token) || SIDE_PADDING.test(token);
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

    expect(footers).toHaveLength(
      page.withRows ? page.withRows.tableCount : page.tableCount,
    );

    for (const footer of footers) {
      expect(footer).not.toHaveClass("rounded-b-xl");
      expect(footer.closest("[data-card-surface='section']")).not.toBeNull();
    }
  });
});

/*
 * Folding never loses anything: every name a page's folded More settings
 * lists is the place of a card in it - so a link to that name (a search
 * result, another page's "Pick a Runner") lands on the card - and opening
 * the page at that name opens the fold there, with or without rows.
 */
describe.each(PAGES)(
  "$name: what its folded header names can be reached",
  (page: MoreSettingsPage) => {
    for (const withRows of [false, true]) {
      test(`${withRows ? "with" : "without"} rows, each name it lists is a card in it`, async () => {
        answerWithRows(withRows);

        await openPageAndLoad(page);

        const keys: Array<string> = listedKeys(page);

        expect(keys.length).toBeGreaterThan(0);

        for (const key of keys) {
          const place: HTMLElement | null = document.getElementById(key);

          expect({ key, isCardInFold: Boolean(place) }).toEqual({
            key,
            isCardInFold: true,
          });
          expect(moreSettings(page)).toContainElement(place);
          expect(place).toHaveAttribute("data-testid", "card");
        }
      });

      test(`${withRows ? "with" : "without"} rows, opened at each name it lists, it opens there`, async () => {
        answerWithRows(withRows);

        await openPageAndLoad(page);

        const keys: Array<string> = listedKeys(page);

        cleanup();

        for (const key of keys) {
          goTo(`${page.path}#${key}`);
          render(
            <MemoryRouter initialEntries={[`${page.path}#${key}`]}>
              {page.element()}
            </MemoryRouter>,
          );

          await waitFor(
            () => {
              expect({
                key,
                expanded: header(page).getAttribute("aria-expanded"),
              }).toEqual({ key, expanded: "true" });
            },
            { timeout: 20000 },
          );

          cleanup();
        }
      });
    }
  },
);

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
