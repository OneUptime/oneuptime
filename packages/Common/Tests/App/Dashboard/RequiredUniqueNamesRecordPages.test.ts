import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  AI_AGENTS_HAVE_NO_PAGE,
  DASHBOARD_RECORD_PAGES,
  getNoRecordPageNote,
  getOpenStackBudgetPage,
  getRecordPageRoute,
  getWorkspaceSummaryPage,
  RECORD_PAGES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UniqueNames/RecordPages";
import {
  WORKSPACE_PAGE_TAB_PARAM,
  WORKSPACE_SUMMARY_TAB,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryTab";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import { getProjectNameRule } from "../../../Types/Database/ProjectNameRule";
import {
  RECORD_PAGE_FIELDS,
  RecordPageFields,
} from "../../../Types/Database/RecordPageFields";
import { getUniqueNameWhenRequiredColumn } from "../../../Types/Database/UniqueNameWhenRequired";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import ProjectUtil from "../../../UI/Utils/Project";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import { getJestSpyOn } from "../../Spy";

/*
 * WHERE THE DASHBOARD OPENS A RECORD WHOSE NAME IS ANOTHER'S (#10761,
 * #11020).
 *
 * A form's warning ("Another monitor is already called API Health
 * Check.") links the other record, and Project Settings links each record
 * of a name the project holds twice, for renaming. Both ask the Dashboard
 * where a record is opened (Components/UniqueNames/RecordPages). This holds
 * that answer to the models: every kind Require Unique Names holds is
 * linked - to its own page, the list it is found in, or the page it opens
 * under - or says it is shown on no page at all; every page named is a
 * real page; and a view page opens the record itself.
 *
 * The three kinds #10761 left without a link (#11020):
 *
 *   - an OpenStack budget opens on its OpenStack cloud's Spend page, from
 *     the cloud's id the server sends beside it;
 *   - a workspace notification summary opens on the Summary tab of its
 *     workspace's Incidents or Alerts page - Slack, Microsoft Teams or
 *     Mattermost - from its workspace and type;
 *   - an AI agent has no page in the Dashboard, and says so, in every
 *     language, rather than linking nowhere.
 */

const PROJECT_ID: string = "ffffffff-0000-4000-8000-000000010761";
const RECORD_ID: string = "12121212-0000-4000-8000-000000010761";
const CLOUD_ID: string = "cccccccc-0000-4000-8000-000000011020";

function tableNameOf(modelType: { new (): BaseModel }): string {
  return new modelType().tableName || "";
}

const HELD_BY_THE_SETTING: Array<string> = AllModelTypes.filter(
  (modelType: { new (): BaseModel }): boolean => {
    return Boolean(getUniqueNameWhenRequiredColumn(modelType));
  },
)
  .map(tableNameOf)
  .sort();

const TABLE_NAMES: Set<string> = new Set<string>(
  AllModelTypes.map(tableNameOf),
);

const route: (data: {
  tableName: string;
  pageFields?: RecordPageFields | undefined;
}) => string | null = (data: {
  tableName: string;
  pageFields?: RecordPageFields | undefined;
}): string | null => {
  return (
    getRecordPageRoute({
      tableName: data.tableName,
      modelId: new ObjectID(RECORD_ID),
      pageFields: data.pageFields,
    })?.toString() || null
  );
};

beforeEach(() => {
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which kinds are linked", () => {
  test("the setting holds dozens of kinds: the list below is read from the models", () => {
    expect(HELD_BY_THE_SETTING.length).toBeGreaterThan(40);
    expect(HELD_BY_THE_SETTING).toContain("Monitor");
    expect(HELD_BY_THE_SETTING).toContain("MonitorGroup");
  });

  test("every kind Require Unique Names holds has its entry: a page, a list, a page it opens under, or none at all, said", () => {
    const unaccounted: Array<string> = HELD_BY_THE_SETTING.filter(
      (tableName: string): boolean => {
        return !RECORD_PAGES[tableName];
      },
    );

    expect(unaccounted).toEqual([]);
  });

  test("every kind linked is a kind whose name is its own in a project: held by the setting, or unique always", () => {
    for (const tableName of Object.keys(RECORD_PAGES)) {
      expect({ tableName, isModel: TABLE_NAMES.has(tableName) }).toEqual({
        tableName,
        isModel: true,
      });

      const modelType: { new (): BaseModel } | undefined = AllModelTypes.find(
        (type: { new (): BaseModel }): boolean => {
          return tableNameOf(type) === tableName;
        },
      );

      expect({
        tableName,
        hasRule: Boolean(getProjectNameRule(new modelType!())),
      }).toEqual({ tableName, hasRule: true });
    }
  });

  test("each kind says one thing: its own page, its list, the page it opens under, or that it has none", () => {
    for (const [tableName, page] of Object.entries(RECORD_PAGES)) {
      expect({
        tableName,
        answers: [page.view, page.list, page.under, page.noPage].filter(Boolean)
          .length,
      }).toEqual({ tableName, answers: 1 });
    }
  });

  test("a kind opened under another is one whose page fields the server sends, and no other", () => {
    const opensUnder: Array<string> = Object.keys(RECORD_PAGES)
      .filter((tableName: string): boolean => {
        return Boolean(RECORD_PAGES[tableName]!.under);
      })
      .sort();

    expect(opensUnder).toEqual(Object.keys(RECORD_PAGE_FIELDS).sort());
    expect(opensUnder).toEqual([
      "OpenStackBudget",
      "WorkspaceNotificationSummary",
    ]);
  });

  test("only AI agents are shown on no page at all", () => {
    expect(
      Object.keys(RECORD_PAGES).filter((tableName: string): boolean => {
        return Boolean(RECORD_PAGES[tableName]!.noPage);
      }),
    ).toEqual(["AIAgent"]);
  });
});

describe("the pages", () => {
  test("every page named is one of the Dashboard's routes", () => {
    for (const [tableName, page] of Object.entries(RECORD_PAGES)) {
      const pageKey: string | undefined = page.view || page.list;

      if (!pageKey) {
        continue;
      }

      expect({
        tableName,
        pageKey,
        isRoute: Boolean(RouteMap[pageKey]),
      }).toEqual({ tableName, pageKey, isRoute: true });
    }
  });

  test("a kind with a page of its own opens the record itself, in the current project", () => {
    for (const [tableName, page] of Object.entries(RECORD_PAGES)) {
      if (!page.view) {
        continue;
      }

      const address: string = route({ tableName }) || "";

      expect({
        tableName,
        opensTheRecord: address.includes(RECORD_ID),
      }).toEqual({ tableName, opensTheRecord: true });
      expect({ tableName, inProject: address.includes(PROJECT_ID) }).toEqual({
        tableName,
        inProject: true,
      });
      // No parameter is left to fill in.
      expect({ tableName, address: address.includes("/:") }).toEqual({
        tableName,
        address: false,
      });
    }
  });

  test("a kind found in a list opens that list, in the current project, with nothing left to fill in", () => {
    for (const [tableName, page] of Object.entries(RECORD_PAGES)) {
      if (!page.list) {
        continue;
      }

      const address: string = route({ tableName }) || "";

      expect({ tableName, inProject: address.includes(PROJECT_ID) }).toEqual({
        tableName,
        inProject: true,
      });
      expect({ tableName, address: address.includes("/:") }).toEqual({
        tableName,
        address: false,
      });
    }
  });

  test("a monitor opens on its own page", () => {
    expect(route({ tableName: "Monitor" })).toBe(
      `/dashboard/${PROJECT_ID}/monitors/${RECORD_ID}`,
    );
  });

  test("a kind with no page, or no kind at all, is named without a link", () => {
    for (const tableName of [
      "AIAgent",
      "Incident",
      "NoSuchTable",
      "constructor",
      "__proto__",
      "toString",
      "",
    ]) {
      expect({ tableName, route: route({ tableName }) }).toEqual({
        tableName,
        route: null,
      });
    }
  });

  test("a page fields' value is never read for a kind with a page of its own", () => {
    expect(
      route({
        tableName: "Monitor",
        pageFields: { openStackCloudId: CLOUD_ID },
      }),
    ).toBe(`/dashboard/${PROJECT_ID}/monitors/${RECORD_ID}`);
  });
});

describe("an OpenStack budget opens on its cloud's Spend page", () => {
  test("from its cloud's id", () => {
    expect(
      route({
        tableName: "OpenStackBudget",
        pageFields: { openStackCloudId: CLOUD_ID },
      }),
    ).toBe(`/dashboard/${PROJECT_ID}/openstack/${CLOUD_ID}/spend`);

    // The Spend page's own route, with the cloud as its record.
    expect(RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SPEND]?.toString()).toContain(
      "/openstack/",
    );
    expect(getOpenStackBudgetPage({ openStackCloudId: CLOUD_ID })?.page).toBe(
      PageMap.OPENSTACK_CLOUD_VIEW_SPEND,
    );
  });

  test("never the budget's own id in the cloud's place", () => {
    const address: string =
      route({
        tableName: "OpenStackBudget",
        pageFields: { openStackCloudId: CLOUD_ID },
      }) || "";

    expect(address).not.toContain(RECORD_ID);
  });

  test("without its cloud - the reader may not read it - it has no link", () => {
    for (const pageFields of [
      undefined,
      {},
      { openStackCloudId: "" },
      { openStackCloudId: "not-an-id" },
      { openStackCloudId: "../monitors" },
      { workspaceType: "Slack" },
    ]) {
      expect({
        pageFields,
        route: route({ tableName: "OpenStackBudget", pageFields }),
      }).toEqual({ pageFields, route: null });
    }
  });
});

describe("a workspace notification summary opens on its workspace's Summary tab", () => {
  const PAGES: Array<{
    workspaceType: WorkspaceType;
    summaryType: WorkspaceNotificationSummaryType;
    page: PageMap;
  }> = [
    {
      workspaceType: WorkspaceType.Slack,
      summaryType: WorkspaceNotificationSummaryType.Incident,
      page: PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK,
    },
    {
      workspaceType: WorkspaceType.Slack,
      summaryType: WorkspaceNotificationSummaryType.IncidentEpisode,
      page: PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK,
    },
    {
      workspaceType: WorkspaceType.Slack,
      summaryType: WorkspaceNotificationSummaryType.Alert,
      page: PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK,
    },
    {
      workspaceType: WorkspaceType.Slack,
      summaryType: WorkspaceNotificationSummaryType.AlertEpisode,
      page: PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK,
    },
    {
      workspaceType: WorkspaceType.MicrosoftTeams,
      summaryType: WorkspaceNotificationSummaryType.Incident,
      page: PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    },
    {
      workspaceType: WorkspaceType.MicrosoftTeams,
      summaryType: WorkspaceNotificationSummaryType.IncidentEpisode,
      page: PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    },
    {
      workspaceType: WorkspaceType.MicrosoftTeams,
      summaryType: WorkspaceNotificationSummaryType.Alert,
      page: PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    },
    {
      workspaceType: WorkspaceType.MicrosoftTeams,
      summaryType: WorkspaceNotificationSummaryType.AlertEpisode,
      page: PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    },
    {
      workspaceType: WorkspaceType.Mattermost,
      summaryType: WorkspaceNotificationSummaryType.Incident,
      page: PageMap.INCIDENTS_WORKSPACE_CONNECTION_MATTERMOST,
    },
    {
      workspaceType: WorkspaceType.Mattermost,
      summaryType: WorkspaceNotificationSummaryType.IncidentEpisode,
      page: PageMap.INCIDENTS_WORKSPACE_CONNECTION_MATTERMOST,
    },
    {
      workspaceType: WorkspaceType.Mattermost,
      summaryType: WorkspaceNotificationSummaryType.Alert,
      page: PageMap.ALERTS_WORKSPACE_CONNECTION_MATTERMOST,
    },
    {
      workspaceType: WorkspaceType.Mattermost,
      summaryType: WorkspaceNotificationSummaryType.AlertEpisode,
      page: PageMap.ALERTS_WORKSPACE_CONNECTION_MATTERMOST,
    },
  ];

  test("every workspace and every type of summary has its page", () => {
    // Every pair is above, each once.
    expect(PAGES).toHaveLength(
      Object.values(WorkspaceType).length *
        Object.values(WorkspaceNotificationSummaryType).length,
    );

    for (const each of PAGES) {
      const expected: string = `${new Route(
        (RouteMap[each.page] as Route).toString(),
      )
        .toString()
        .replace(
          ":projectId",
          PROJECT_ID,
        )}?${WORKSPACE_PAGE_TAB_PARAM}=${WORKSPACE_SUMMARY_TAB}`;

      expect({
        ...each,
        route: route({
          tableName: "WorkspaceNotificationSummary",
          pageFields: {
            workspaceType: each.workspaceType,
            summaryType: each.summaryType,
          },
        }),
      }).toEqual({ ...each, route: expected });
    }
  });

  test("a Slack incident summary's address, in full", () => {
    expect(
      route({
        tableName: "WorkspaceNotificationSummary",
        pageFields: {
          workspaceType: WorkspaceType.Slack,
          summaryType: WorkspaceNotificationSummaryType.Incident,
        },
      }),
    ).toBe(
      `/dashboard/${PROJECT_ID}/incidents/workspace-connection-slack?tab=summary`,
    );
  });

  test("without its workspace or its type, or with one OneUptime does not have, it has no link", () => {
    for (const pageFields of [
      undefined,
      {},
      { workspaceType: WorkspaceType.Slack },
      { summaryType: WorkspaceNotificationSummaryType.Alert },
      { workspaceType: "Discord", summaryType: "Incident" },
      { workspaceType: "Slack", summaryType: "Monitor" },
      { workspaceType: "constructor", summaryType: "toString" },
      { workspaceType: "__proto__", summaryType: "Incident" },
    ]) {
      expect({
        pageFields,
        route: route({ tableName: "WorkspaceNotificationSummary", pageFields }),
      }).toEqual({ pageFields, route: null });
    }

    expect(getWorkspaceSummaryPage({})).toBeNull();
  });
});

describe("an AI agent is shown on no page, and says so", () => {
  test("its note, and no other kind's", () => {
    expect(getNoRecordPageNote("AIAgent")).toBe(AI_AGENTS_HAVE_NO_PAGE);
    expect(AI_AGENTS_HAVE_NO_PAGE).toBe(
      "AI agents have no page in the dashboard: rename one with the API or Terraform.",
    );

    for (const tableName of [
      "Monitor",
      "OpenStackBudget",
      "WorkspaceNotificationSummary",
      "Label",
      "Incident",
      "",
      "constructor",
      "__proto__",
    ]) {
      expect({ tableName, note: getNoRecordPageNote(tableName) }).toEqual({
        tableName,
        note: null,
      });
    }
  });

  test("in every Dashboard language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        isTranslated:
          typeof words[AI_AGENTS_HAVE_NO_PAGE] === "string" &&
          words[AI_AGENTS_HAVE_NO_PAGE] !== AI_AGENTS_HAVE_NO_PAGE,
      }).toEqual({ language, isTranslated: true });
    }
  });
});

describe("the Dashboard's answer, handed to every form and list", () => {
  test("is the routes above, and the note", () => {
    expect(DASHBOARD_RECORD_PAGES.getRoute).toBe(getRecordPageRoute);
    expect(DASHBOARD_RECORD_PAGES.getNoPageNote).toBe(getNoRecordPageNote);
  });
});
