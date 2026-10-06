import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";

/*
 * Duplicate on the Settings page of a dashboard, a monitor, an on-call
 * schedule and a workflow: each asks for the copy's name with the model's
 * name column - the one DuplicateModel fills in with "<name> 2"
 * (DuplicateName) - and opens the copy once it is made: the route it is
 * handed, with the copy's id added, is the copy's own page.
 *
 * DuplicateModel is replaced here by a stand-in that records what each page
 * hands it; DuplicateModel.test drives the real one.
 */

let mockDuplicateProps: Record<string, unknown> | null = null;

jest.mock("../../../UI/Components/DuplicateModel/DuplicateModel", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): React.ReactElement => {
      mockDuplicateProps = props;
      return <div data-testid="duplicate-card">Duplicate</div>;
    },
  };
});

jest.mock("../../../UI/Components/ImportExport/ExportModelCard", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="export-card">Export</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="archive-card">Archive</div>;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <></>;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitoringCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="monitoring-card">Monitoring</div>;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingEmailMonitor/IncomingEmailAddressSettings",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <></>;
      },
    };
  },
);

const mockGetItem: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
    },
  };
});

import DashboardSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Settings";
import MonitorSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Settings";
import OnCallDutyScheduleSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutySchedule/Settings";
import WorkflowSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Settings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getDuplicateNameColumn } from "../../../UI/Components/DuplicateModel/DuplicateName";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-38419416aaaa",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161002",
);
const COPY_ID: ObjectID = new ObjectID("0198c8ec-2a1d-7f0c-9e75-38419416ffff");

// packages/Common/Tests/App/Dashboard -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/settings"),
  currentProject: null,
  hasPaymentMethod: false,
};

interface DuplicatePage {
  label: string;
  // Repository-relative.
  file: string;
  Page: React.FunctionComponent<PageComponentProps>;
  modelType: { new (): BaseModel };
  // The copy's own page.
  viewPage: PageMap;
  // What the copy is never given, beyond the server-decided columns.
  neverCopied: Array<string>;
}

const PAGES: Array<DuplicatePage> = [
  {
    label: "dashboard",
    file: `${DASHBOARD}/Pages/Dashboards/View/Settings.tsx`,
    Page: DashboardSettings,
    modelType: Dashboard,
    viewPage: PageMap.DASHBOARD_VIEW,
    // Public sharing starts off on a copy: the docs say so.
    neverCopied: [
      "isPublicDashboard",
      "enableMasterPassword",
      "masterPassword",
      "ipWhitelist",
    ],
  },
  {
    label: "monitor",
    file: `${DASHBOARD}/Pages/Monitor/View/Settings.tsx`,
    Page: MonitorSettings,
    modelType: Monitor,
    viewPage: PageMap.MONITOR_VIEW,
    neverCopied: ["incomingRequestSecretKey", "serverMonitorSecretKey"],
  },
  {
    label: "on-call schedule",
    file: `${DASHBOARD}/Pages/OnCallDuty/OnCallDutySchedule/Settings.tsx`,
    Page: OnCallDutyScheduleSettings,
    modelType: OnCallDutyPolicySchedule,
    viewPage: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW,
    neverCopied: [],
  },
  {
    label: "workflow",
    file: `${DASHBOARD}/Pages/Workflow/View/Settings.tsx`,
    Page: WorkflowSettings,
    modelType: Workflow,
    viewPage: PageMap.WORKFLOW_VIEW,
    // A copy lands disabled, so its trigger does not fire beside the original's.
    neverCopied: ["isEnabled"],
  },
];

// Columns the server decides on every record; a copy never sends them.
const SERVER_DECIDED_COLUMN: RegExp =
  /^(_id|id|createdAt|updatedAt|deletedAt|archivedAt|isArchived|version|slug)$|ByUser(Id)?$/;

async function renderPage(
  page: DuplicatePage,
): Promise<Record<string, unknown>> {
  render(<page.Page {...PAGE_PROPS} />);

  // The monitor's page waits for the monitor's type before drawing its cards.
  await screen.findByTestId("duplicate-card");

  expect(mockDuplicateProps).not.toBeNull();

  return mockDuplicateProps as Record<string, unknown>;
}

beforeEach(() => {
  mockDuplicateProps = null;
  mockGetItem.mockReset();
  mockGetItem.mockImplementation(async (): Promise<Monitor> => {
    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.Manual;
    return monitor;
  });
  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(RECORD_ID);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(PAGES)(
  "Duplicate on a $label's Settings page",
  (page: DuplicatePage) => {
    test("copies this record", async () => {
      const props: Record<string, unknown> = await renderPage(page);

      expect(props["modelType"]).toBe(page.modelType);
      expect(props["modelId"]).toBe(RECORD_ID);
    });

    test("asks for the copy's name with the model's name column, so it starts filled in", async () => {
      const props: Record<string, unknown> = await renderPage(page);
      const fieldsToChange: Array<ModelField<BaseModel>> = props[
        "fieldsToChange"
      ] as Array<ModelField<BaseModel>>;

      expect(
        getDuplicateNameColumn({
          model: new page.modelType(),
          fieldsToChange,
        }),
      ).toBe("name");

      // The name comes first: the field the dialog opens on.
      expect(Object.keys(fieldsToChange[0]?.field || {})).toEqual(["name"]);
      expect(fieldsToChange[0]?.required).toBe(true);
    });

    test("opens the copy: the route it is handed, with the copy's id, is the copy's own page", async () => {
      const props: Record<string, unknown> = await renderPage(page);
      const listRoute: Route | undefined = props["navigateToOnSuccess"] as
        | Route
        | undefined;

      expect(listRoute).toBeDefined();

      // What DuplicateModel navigates to.
      const opened: Route = new Route(listRoute!.toString()).addRoute(
        `/${COPY_ID.toString()}`,
      );

      expect(opened.toString()).toBe(
        RouteUtil.populateRouteParams(RouteMap[page.viewPage] as Route, {
          modelId: COPY_ID,
        }).toString(),
      );
      expect(opened.toString()).toContain(PROJECT_ID.toString());
    });

    test("never copies the name, the record's id or what the server decides", async () => {
      const props: Record<string, unknown> = await renderPage(page);
      const copied: Array<string> = Object.keys(
        (props["fieldsToDuplicate"] as Record<string, unknown>) || {},
      );

      expect(copied.length).toBeGreaterThan(0);
      expect(copied).not.toContain("name");

      for (const column of copied) {
        expect(column).not.toMatch(SERVER_DECIDED_COLUMN);
      }

      for (const column of page.neverCopied) {
        expect(copied).not.toContain(column);
      }
    });
  },
);

describe("the monitor's Duplicate", () => {
  test("still asks whether the copy starts with monitoring off, and it does unless told otherwise", async () => {
    const props: Record<string, unknown> = await renderPage(PAGES[1]!);
    const fieldsToChange: Array<ModelField<Monitor>> = props[
      "fieldsToChange"
    ] as Array<ModelField<Monitor>>;

    const disable: ModelField<Monitor> | undefined = fieldsToChange.find(
      (field: ModelField<Monitor>): boolean => {
        return Object.keys(field.field || {})[0] === "disableActiveMonitoring";
      },
    );

    expect(disable).toBeDefined();
    expect(disable?.defaultValue).toBe(true);
  });
});

/*
 * A Duplicate card anywhere else would be one these checks never see: one
 * that asks for no name (so nothing is filled in), or opens nothing once
 * the copy is made. Every page that draws DuplicateModel is listed above.
 */
describe("every Duplicate in the product", () => {
  // A JSX use of the component, generic or not: `<DuplicateModel` + space, `<` or end of line.
  const DUPLICATE_MODEL_JSX: RegExp = /<DuplicateModel[\s<]/;

  const scanRoots: Array<string> = listScanRoots(REPOSITORY_ROOT);

  const filesDrawingDuplicate: Array<string> = scanRoots
    .flatMap((root: string): Array<string> => {
      return listSourceFiles(root);
    })
    .filter((file: string): boolean => {
      return (
        file.endsWith(".tsx") &&
        DUPLICATE_MODEL_JSX.test(fs.readFileSync(file, "utf8"))
      );
    })
    .map((file: string): string => {
      return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
    })
    .sort();

  test("is read: the walk finds the Duplicate cards", () => {
    expect(scanRoots.length).toBeGreaterThan(3);
    expect(filesDrawingDuplicate).toContain(PAGES[0]!.file);
  });

  test("is on one of the pages checked above", () => {
    expect(filesDrawingDuplicate).toEqual(
      PAGES.map((page: DuplicatePage): string => {
        return page.file;
      }).sort(),
    );
  });
});
