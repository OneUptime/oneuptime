import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  getRecordPageRoute,
  RECORD_PAGES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UniqueNames/RecordPages";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import { getProjectNameRule } from "../../../Types/Database/ProjectNameRule";
import { getUniqueNameWhenRequiredColumn } from "../../../Types/Database/UniqueNameWhenRequired";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

/*
 * WHERE THE DASHBOARD OPENS A RECORD WHOSE NAME IS ANOTHER'S (#10761).
 *
 * A form's warning ("Another monitor is already called API Health
 * Check.") links the other record, and Project Settings links each record
 * of a name the project holds twice, for renaming. Both ask the Dashboard
 * where a record is opened (Components/UniqueNames/RecordPages). This holds
 * that answer to the models: every kind Require Unique Names holds is
 * linked - to its own page, or the list it is found in - or named here
 * with why it has no link; every page named is a real page; and a view
 * page opens the record itself.
 */

const PROJECT_ID: string = "ffffffff-0000-4000-8000-000000010761";
const RECORD_ID: string = "12121212-0000-4000-8000-000000010761";

/*
 * Kinds held by the setting that are named without a link, and why. A
 * record's name is still said; the reader finds it where they keep such
 * records.
 */
const NAMED_WITHOUT_A_LINK: Readonly<Record<string, string>> = {
  AIAgent:
    "an AI agent is set up where it runs, and no Dashboard page lists agents",
  OpenStackBudget:
    "a budget is opened under its OpenStack cloud, whose id the link does not have",
  WorkspaceNotificationSummary:
    "a summary is opened under its workspace's page - Slack, Microsoft Teams or Mattermost - which the link does not know",
};

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

  test("every kind Require Unique Names holds is linked, or named here with why it is not", () => {
    const unaccounted: Array<string> = HELD_BY_THE_SETTING.filter(
      (tableName: string): boolean => {
        return !RECORD_PAGES[tableName] && !NAMED_WITHOUT_A_LINK[tableName];
      },
    );

    expect(unaccounted).toEqual([]);
  });

  test("a kind named without a link is held by the setting, has no page here, and says why", () => {
    for (const tableName of Object.keys(NAMED_WITHOUT_A_LINK)) {
      expect({
        tableName,
        isHeld: HELD_BY_THE_SETTING.includes(tableName),
      }).toEqual({ tableName, isHeld: true });
      expect({ tableName, page: RECORD_PAGES[tableName] }).toEqual({
        tableName,
        page: undefined,
      });
      expect(NAMED_WITHOUT_A_LINK[tableName]!.length).toBeGreaterThan(20);
    }
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

  test("each kind names one page: its own, or the list it is found in", () => {
    for (const [tableName, page] of Object.entries(RECORD_PAGES)) {
      expect({
        tableName,
        pages: [page.view, page.list].filter(Boolean).length,
      }).toEqual({ tableName, pages: 1 });
    }
  });
});

describe("the pages", () => {
  test("every page named is one of the Dashboard's routes", () => {
    for (const [tableName, page] of Object.entries(RECORD_PAGES)) {
      const pageKey: string = (page.view || page.list)!;

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

      const route: Route | null = getRecordPageRoute({
        tableName,
        modelId: new ObjectID(RECORD_ID),
      });
      const address: string = route?.toString() || "";

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

      const address: string =
        getRecordPageRoute({
          tableName,
          modelId: new ObjectID(RECORD_ID),
        })?.toString() || "";

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
    expect(
      getRecordPageRoute({
        tableName: "Monitor",
        modelId: new ObjectID(RECORD_ID),
      })?.toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/monitors/${RECORD_ID}`);
  });

  test("a kind with no page, or no kind at all, is named without a link", () => {
    for (const tableName of [
      ...Object.keys(NAMED_WITHOUT_A_LINK),
      "Incident",
      "NoSuchTable",
      "constructor",
      "__proto__",
      "toString",
      "",
    ]) {
      expect({
        tableName,
        route: getRecordPageRoute({
          tableName,
          modelId: new ObjectID(RECORD_ID),
        }),
      }).toEqual({ tableName, route: null });
    }
  });
});
