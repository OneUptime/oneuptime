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

// A test that needs the project's records answers getList itself.
const mockGetList: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      getList: async (...args: Array<unknown>): Promise<unknown> => {
        return (
          (await mockGetList(...args)) || {
            data: [],
            count: 0,
            skip: 0,
            limit: 10,
          }
        );
      },
    },
  };
});

import DashboardSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Settings";
import MonitorSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Settings";
import OnCallDutyScheduleSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutySchedule/Settings";
import WorkflowSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Settings";
import FormDuplicate, {
  prepareFormCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/Duplicate";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getDuplicateNameColumn } from "../../../UI/Components/DuplicateModel/DuplicateName";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Form from "../../../Models/DatabaseModels/Form";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import { JSONArray } from "../../../Types/JSON";
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
  {
    label: "form",
    file: `${DASHBOARD}/Pages/Forms/View/Duplicate.tsx`,
    Page: FormDuplicate,
    modelType: Form,
    viewPage: PageMap.FORM_VIEW,
    /*
     * A copy gets a link of its own, which the server mints; it starts
     * turned off (prepareFormCopy) - and its submissions are the
     * original's.
     */
    neverCopied: ["shareKey", "isEnabled"],
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
  mockGetList.mockReset();
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

describe("the form's Duplicate", () => {
  const formPage: DuplicatePage = PAGES.find((page: DuplicatePage): boolean => {
    return page.modelType === Form;
  })!;

  test("copies everything a form is built from", async () => {
    const props: Record<string, unknown> = await renderPage(formPage);

    expect(
      Object.keys(props["fieldsToDuplicate"] as Record<string, unknown>).sort(),
    ).toEqual(
      [
        "description",
        "targetType",
        "fields",
        "templates",
        "targetSettings",
        "successMessage",
        "ipWhitelist",
        "logoFileId",
        "logoAltText",
        "faviconFileId",
      ].sort(),
    );
  });

  test("says what the copy has, and that it starts turned off", async () => {
    const props: Record<string, unknown> = await renderPage(formPage);

    expect(props["description"]).toBe(FormsCopy.duplicateFormNote);
    expect(FormsCopy.duplicateFormNote).toContain("starts turned off");
    expect(props["prepareCopy"]).toBe(prepareFormCopy);
  });

  test("the copy is saved turned off, whatever the original was", async () => {
    const copy: Form = new Form();
    copy.isEnabled = true;
    copy.ipWhitelist = "10.0.0.0/8";

    await prepareFormCopy(copy);

    expect(copy.isEnabled).toBe(false);
    // An allowlist the original has is kept: never dropped silently.
    expect(copy.ipWhitelist).toBe("10.0.0.0/8");
  });

  test.each([null, undefined, "", "  \n "])(
    "an allowlist the original does not have (%j) is not sent, so the copy needs no Scale plan",
    async (ipWhitelist: string | null | undefined) => {
      const copy: Form = new Form();
      copy.ipWhitelist = ipWhitelist as string;

      await prepareFormCopy(copy);

      expect(copy.ipWhitelist).toBeUndefined();
      expect(copy.isEnabled).toBe(false);
    },
  );

  /*
   * The server judges a new form's templates whole, so the copy must not
   * carry an answer to, or a setting for, a question removed since the
   * template was saved: the original never used it, and it would get the
   * copy refused.
   */
  test("the copy's templates keep their answers and settings for the form's questions, and only those", async () => {
    const copy: Form = new Form();
    copy.fields = [
      {
        id: "title",
        source: "TargetField",
        targetField: "title",
        label: "Title",
        isRequired: true,
      },
      {
        id: "office",
        source: "Question",
        type: "Text",
        label: "Office",
        isRequired: false,
      },
    ] as unknown as JSONArray;
    copy.templates = [
      {
        id: "outage",
        name: "Outage",
        isDefault: true,
        answers: { title: "Down", removed: "x" },
        fieldSettings: { office: "Required", removed: "Hidden" },
      },
      {
        id: "plain",
        name: "Plain",
        answers: { title: "Up" },
        fieldSettings: { removed: "Hidden" },
      },
    ] as unknown as JSONArray;

    await prepareFormCopy(copy);

    expect(copy.templates).toEqual([
      {
        id: "outage",
        name: "Outage",
        isDefault: true,
        answers: { title: "Down" },
        fieldSettings: { office: "Required" },
      },
      { id: "plain", name: "Plain", answers: { title: "Up" } },
    ]);
  });

  test("a form without templates is copied without any", async () => {
    const copy: Form = new Form();

    await prepareFormCopy(copy);

    expect(copy.templates).toBeUndefined();
  });

  const OFFICE_FORM_FIELDS: JSONArray = [
    {
      id: "title",
      source: "TargetField",
      targetField: "title",
      label: "Title",
      isRequired: true,
    },
    {
      id: "office",
      source: "Question",
      type: "Dropdown",
      dropdownOptions: "Berlin\nLondon",
      label: "Office",
      isRequired: false,
    },
  ] as unknown as JSONArray;

  test("an answer its question would now refuse - an option removed since - is left behind too", async () => {
    const copy: Form = new Form();
    copy.fields = OFFICE_FORM_FIELDS;
    copy.templates = [
      {
        id: "outage",
        name: "Outage",
        answers: { title: "Down", office: "Paris" },
        fieldSettings: { office: "Required" },
      },
      {
        id: "berlin",
        name: "Berlin",
        answers: { office: "Berlin" },
      },
    ] as unknown as JSONArray;

    await prepareFormCopy(copy);

    expect(copy.templates).toEqual([
      {
        id: "outage",
        name: "Outage",
        answers: { title: "Down" },
        fieldSettings: { office: "Required" },
      },
      { id: "berlin", name: "Berlin", answers: { office: "Berlin" } },
    ]);
  });

  test("a record a question no longer offers is left behind, read from the project's own records", async () => {
    const SEVERITY_KEPT: string = "c1c1c1c1-0000-4000-8000-000000000001";
    const SEVERITY_DELETED: string = "c1c1c1c1-0000-4000-8000-000000000002";

    mockGetList.mockImplementation(async (): Promise<unknown> => {
      return {
        data: [{ _id: SEVERITY_KEPT, name: "Critical" }],
        count: 1,
        skip: 0,
        limit: 10,
      };
    });

    const copy: Form = new Form();
    copy.fields = [
      {
        id: "severity",
        source: "TargetField",
        targetField: "incidentSeverityId",
        label: "Severity",
        isRequired: false,
      },
    ] as unknown as JSONArray;
    copy.templates = [
      { id: "kept", name: "Kept", answers: { severity: SEVERITY_KEPT } },
      { id: "gone", name: "Gone", answers: { severity: SEVERITY_DELETED } },
    ] as unknown as JSONArray;

    await prepareFormCopy(copy);

    // The current project's severities, read once.
    expect(mockGetList).toHaveBeenCalledTimes(1);
    expect(mockGetList.mock.calls[0]?.[0]).toMatchObject({
      modelType: IncidentSeverity,
      query: { projectId: PROJECT_ID },
    });
    expect(copy.templates).toEqual([
      { id: "kept", name: "Kept", answers: { severity: SEVERITY_KEPT } },
      { id: "gone", name: "Gone", answers: {} },
    ]);
  });

  test("when the project's records cannot be read, the copy keeps what the questions' ids allow", async () => {
    mockGetList.mockImplementation(async (): Promise<never> => {
      throw new Error("The network is down.");
    });

    const copy: Form = new Form();
    copy.fields = [
      ...OFFICE_FORM_FIELDS,
      {
        id: "severity",
        source: "TargetField",
        targetField: "incidentSeverityId",
        label: "Severity",
        isRequired: false,
      },
    ] as unknown as JSONArray;
    copy.templates = [
      {
        id: "outage",
        name: "Outage",
        answers: { office: "Paris", removed: "x" },
        fieldSettings: { removed: "Hidden" },
      },
    ] as unknown as JSONArray;

    await prepareFormCopy(copy);

    // Still turned off, and the removed question's answer and setting gone.
    expect(copy.isEnabled).toBe(false);
    expect(copy.templates).toEqual([
      { id: "outage", name: "Outage", answers: { office: "Paris" } },
    ]);
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
