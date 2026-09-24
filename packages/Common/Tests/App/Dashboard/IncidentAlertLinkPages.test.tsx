import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The "Linked Alerts" page of an incident and the "Linked Incidents" page of
 * an alert. Both are a ModelTable over IncidentAlert, stubbed here to capture
 * its props: what is pinned is that each lists only the viewed record's links,
 * links through the table's own create form with the record and project
 * stamped on, reads "Link" / "Unlink" rather than create / delete, resolves
 * the other side's current state from a separate state list (relations are
 * only joined one level deep), and - on the alert page - that "Declare
 * Incident" is gated on both permissions it needs.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

type CapturedTableProps = Record<string, any>;

let capturedTables: Array<CapturedTableProps> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): React.ReactElement => {
      capturedTables.push(props);
      return <div data-testid="model-table" />;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import IncidentViewAlerts from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Alerts";
import AlertViewIncidents from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Incidents";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ModalTableBulkDefaultActions } from "../../../UI/Components/ModelTable/BaseModelTable";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const MODEL_ID: string = "0193c0de-3333-4aaa-8bbb-000000000003";
const OTHER_ID: string = "0193c0de-3333-4aaa-8bbb-000000000004";
const STATE_ID: string = "0193c0de-3333-4aaa-8bbb-000000000005";

let permissionsForTest: Array<Permission> = [];

type ListResultFunction = (data: Array<unknown>) => {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};

const listResult: ListResultFunction = (data: Array<unknown>) => {
  return { data: data, count: data.length, skip: 0, limit: data.length };
};

type StateFunction = <T extends AlertState | IncidentState>(modelType: {
  new (): T;
}) => T;

const makeState: StateFunction = <
  T extends AlertState | IncidentState,
>(modelType: {
  new (): T;
}): T => {
  const state: T = new modelType();
  state._id = STATE_ID;
  state.name = "Acknowledged";
  state.color = new Color("#ff0000");
  return state;
};

type OpenPageFunction = (
  page: React.FunctionComponent<PageComponentProps>,
) => Promise<CapturedTableProps>;

const openPage: OpenPageFunction = async (
  page: React.FunctionComponent<PageComponentProps>,
): Promise<CapturedTableProps> => {
  const Page: React.FunctionComponent<PageComponentProps> = page;

  render(
    <MemoryRouter>
      <Page
        pageRoute={new Route("/dashboard/page")}
        currentProject={new Project()}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  // The state list lands after the first render.
  await waitFor(() => {
    expect(getListMock).toHaveBeenCalledTimes(1);
  });
  await waitFor(() => {
    expect(capturedTables.length).toBeGreaterThan(1);
  });

  return capturedTables[capturedTables.length - 1]!;
};

type RenderCellFunction = (
  table: CapturedTableProps,
  title: string,
  item: IncidentAlert,
) => string;

// The text a column renders for a row.
const renderCell: RenderCellFunction = (
  table: CapturedTableProps,
  title: string,
  item: IncidentAlert,
): string => {
  const column: Record<string, any> | undefined = table["columns"].find(
    (candidate: Record<string, any>): boolean => {
      return candidate["title"] === title;
    },
  );

  if (!column) {
    throw new Error(`No "${title}" column.`);
  }

  const { container } = render(
    <MemoryRouter>{column["getElement"](item)}</MemoryRouter>,
  );

  return container.textContent || "";
};

type ColumnTitlesFunction = (table: CapturedTableProps) => Array<string>;

const columnTitles: ColumnTitlesFunction = (
  table: CapturedTableProps,
): Array<string> => {
  return table["columns"].map((column: Record<string, any>): string => {
    return column["title"];
  });
};

type LinkedByUserFunction = () => User;

const linkedByUser: LinkedByUserFunction = (): User => {
  const user: User = new User();
  user.name = new Name("Riley Responder");
  user.email = new Email("riley@example.com");
  return user;
};

describe("the linked alerts and incidents pages", () => {
  let navigateSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    capturedTables = [];
    permissionsForTest = [Permission.ProjectMember];
    getListMock.mockReset();
    PermissionGate.clearPermissionPropsCache();

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(new ObjectID(MODEL_ID));
    jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
      return permissionsForTest;
    });
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
    navigateSpy = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("an incident's Linked Alerts", () => {
    beforeEach(() => {
      getListMock.mockResolvedValue(listResult([makeState(AlertState)]));
    });

    test("lists only this incident's links", async () => {
      const table: CapturedTableProps = await openPage(IncidentViewAlerts);

      expect(Navigation.getLastParamAsObjectID).toHaveBeenCalledWith(1);
      expect(table["modelType"]).toBe(IncidentAlert);
      expect(table["query"]["incidentId"].toString()).toBe(MODEL_ID);
      expect(table["query"]["projectId"].toString()).toBe(PROJECT_ID);
      expect(Object.keys(table["query"]).sort()).toEqual([
        "incidentId",
        "projectId",
      ]);
    });

    test("reads the alert states once, for this project", async () => {
      await openPage(IncidentViewAlerts);

      const request: any = getListMock.mock.calls[0]![0];

      expect(request.modelType).toBe(AlertState);
      expect(request.query.projectId.toString()).toBe(PROJECT_ID);
    });

    test("links an alert through the table's create form", async () => {
      const table: CapturedTableProps = await openPage(IncidentViewAlerts);

      expect(table["isCreateable"]).toBe(true);
      expect(table["isEditable"]).toBe(false);
      expect(table["createVerb"]).toBe("Link");
      expect(table["singularName"]).toBe("Alert");
      expect(table["formFields"]).toHaveLength(1);
      expect(table["formFields"][0]["field"]).toEqual({ alertId: true });
      expect(table["formFields"][0]["required"]).toBe(true);
      expect(table["formFields"][0]["dropdownModal"]).toEqual({
        type: Alert,
        labelField: "title",
        valueField: "_id",
      });

      const created: IncidentAlert = await table["onBeforeCreate"](
        new IncidentAlert(),
        {},
      );

      expect(created.incidentId?.toString()).toBe(MODEL_ID);
      expect(created.projectId?.toString()).toBe(PROJECT_ID);
    });

    test("unlinks rather than deletes", async () => {
      const table: CapturedTableProps = await openPage(IncidentViewAlerts);

      expect(table["isDeleteable"]).toBe(true);
      expect(table["deleteButtonText"]).toBe("Unlink");

      const confirmation: Record<string, string> = await table[
        "getDeleteConfirmation"
      ](new IncidentAlert());

      expect(confirmation["title"]).toBe("Unlink Alert");
      expect(confirmation["submitButtonText"]).toBe("Unlink");
      expect(confirmation["description"]).toContain("not deleted");
      expect(table["bulkActions"]["buttons"]).toEqual([
        ModalTableBulkDefaultActions.Delete,
      ]);
      expect(table["bulkActions"]["deleteConfirmationWarning"]).toContain(
        "Only the links are removed",
      );
    });

    test("shows the alert, its current state and who linked it", async () => {
      const table: CapturedTableProps = await openPage(IncidentViewAlerts);

      expect(columnTitles(table)).toEqual([
        "Alert #",
        "Title",
        "Current State",
        "Linked At",
        "Linked By",
      ]);

      const alert: Alert = new Alert();
      alert._id = OTHER_ID;
      alert.title = "Database is down";
      alert.alertNumber = 12;
      alert.alertNumberWithPrefix = "ALT-12";
      alert.currentAlertStateId = new ObjectID(STATE_ID);

      const link: IncidentAlert = new IncidentAlert();
      link.alert = alert;
      link.createdByUser = linkedByUser();

      expect(renderCell(table, "Alert #", link)).toBe("ALT-12");
      expect(renderCell(table, "Title", link)).toBe("Database is down");
      expect(renderCell(table, "Current State", link)).toContain(
        "Acknowledged",
      );
      expect(renderCell(table, "Linked By", link)).toContain("Riley Responder");

      const bare: IncidentAlert = new IncidentAlert();

      expect(renderCell(table, "Alert #", bare)).toBe("-");
      expect(renderCell(table, "Title", bare)).toBe("-");
      expect(renderCell(table, "Current State", bare)).toBe("-");
      expect(renderCell(table, "Linked By", bare)).toBe("-");
    });

    test("opens the alert from a row", async () => {
      const table: CapturedTableProps = await openPage(IncidentViewAlerts);
      const action: Record<string, any> = table["actionButtons"][0];
      const onComplete: MockFunction = getJestMockFunction();
      const link: IncidentAlert = new IncidentAlert();
      link.alert = new Alert();
      link.alert._id = OTHER_ID;

      expect(action["title"]).toBe("View Alert");

      action["onClick"](link, onComplete);

      expect(navigateSpy.mock.calls[0]![0]!.toString()).toBe(
        `/dashboard/${PROJECT_ID}/alerts/${OTHER_ID}`,
      );
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test("has no card button of its own", async () => {
      const table: CapturedTableProps = await openPage(IncidentViewAlerts);

      expect(table["cardProps"]["title"]).toBe("Linked Alerts");
      expect(table["cardProps"]["buttons"]).toBeUndefined();
    });
  });

  describe("an alert's Linked Incidents", () => {
    beforeEach(() => {
      getListMock.mockResolvedValue(listResult([makeState(IncidentState)]));
    });

    test("lists only this alert's links", async () => {
      const table: CapturedTableProps = await openPage(AlertViewIncidents);

      expect(table["modelType"]).toBe(IncidentAlert);
      expect(table["query"]["alertId"].toString()).toBe(MODEL_ID);
      expect(table["query"]["projectId"].toString()).toBe(PROJECT_ID);
      expect(Object.keys(table["query"]).sort()).toEqual([
        "alertId",
        "projectId",
      ]);
      expect(getListMock.mock.calls[0]![0].modelType).toBe(IncidentState);
    });

    test("links an incident through the table's create form", async () => {
      const table: CapturedTableProps = await openPage(AlertViewIncidents);

      expect(table["createVerb"]).toBe("Link");
      expect(table["singularName"]).toBe("Incident");
      expect(table["formFields"]).toHaveLength(1);
      expect(table["formFields"][0]["field"]).toEqual({ incidentId: true });
      expect(table["formFields"][0]["dropdownModal"]).toEqual({
        type: Incident,
        labelField: "title",
        valueField: "_id",
      });

      const created: IncidentAlert = await table["onBeforeCreate"](
        new IncidentAlert(),
        {},
      );

      expect(created.alertId?.toString()).toBe(MODEL_ID);
      expect(created.projectId?.toString()).toBe(PROJECT_ID);
    });

    test("unlinks rather than deletes", async () => {
      const table: CapturedTableProps = await openPage(AlertViewIncidents);

      expect(table["deleteButtonText"]).toBe("Unlink");

      const confirmation: Record<string, string> = await table[
        "getDeleteConfirmation"
      ](new IncidentAlert());

      expect(confirmation["title"]).toBe("Unlink Incident");
      expect(confirmation["submitButtonText"]).toBe("Unlink");
      expect(table["bulkActions"]["buttons"]).toEqual([
        ModalTableBulkDefaultActions.Delete,
      ]);
    });

    test("shows the incident and its current state", async () => {
      const table: CapturedTableProps = await openPage(AlertViewIncidents);

      expect(columnTitles(table)).toEqual([
        "Incident #",
        "Title",
        "Current State",
        "Linked At",
        "Linked By",
      ]);

      const incident: Incident = new Incident();
      incident._id = OTHER_ID;
      incident.title = "Checkout outage";
      incident.incidentNumber = 7;
      incident.currentIncidentStateId = new ObjectID(STATE_ID);

      const link: IncidentAlert = new IncidentAlert();
      link.incident = incident;

      expect(renderCell(table, "Incident #", link)).toBe("#7");
      expect(renderCell(table, "Title", link)).toBe("Checkout outage");
      expect(renderCell(table, "Current State", link)).toContain(
        "Acknowledged",
      );
    });

    test("opens the incident from a row", async () => {
      const table: CapturedTableProps = await openPage(AlertViewIncidents);
      const action: Record<string, any> = table["actionButtons"][0];
      const link: IncidentAlert = new IncidentAlert();
      link.incident = new Incident();
      link.incident._id = OTHER_ID;

      expect(action["title"]).toBe("View Incident");

      action["onClick"](link, (): void => {});

      expect(navigateSpy.mock.calls[0]![0]!.toString()).toBe(
        `/dashboard/${PROJECT_ID}/incidents/${OTHER_ID}`,
      );
    });

    describe("Declare Incident", () => {
      type DeclareButtonFunction = () => Promise<CardButtonSchema | undefined>;

      const declareButton: DeclareButtonFunction = async (): Promise<
        CardButtonSchema | undefined
      > => {
        const table: CapturedTableProps = await openPage(AlertViewIncidents);

        return (table["cardProps"]["buttons"] as Array<CardButtonSchema>).find(
          (button: CardButtonSchema): boolean => {
            return button.title === "Declare Incident";
          },
        );
      };

      test("declares an incident from this alert", async () => {
        const button: CardButtonSchema | undefined = await declareButton();

        expect(button).toBeDefined();
        expect(button!.disabled).toBeFalsy();

        button!.onClick();

        expect(navigateSpy).toHaveBeenCalledTimes(1);
        expect(navigateSpy.mock.calls[0]![0]!.toString()).toBe(
          `/dashboard/${PROJECT_ID}/incidents/create?alertIds=${MODEL_ID}`,
        );
      });

      test("is locked for a viewer, saying why, and goes nowhere", async () => {
        permissionsForTest = [Permission.Viewer];

        const button: CardButtonSchema | undefined = await declareButton();

        expect(button!.disabled).toBe(true);
        expect(button!.tooltip).toContain(
          "You do not have permission to create this Incident.",
        );

        button!.onClick();

        expect(navigateSpy).not.toHaveBeenCalled();
      });

      test("is locked for someone who may link but not create incidents", async () => {
        permissionsForTest = [Permission.AlertMember];

        const button: CardButtonSchema | undefined = await declareButton();

        expect(button!.disabled).toBe(true);
        expect(button!.tooltip).toContain(
          "You do not have permission to create this Incident.",
        );
      });

      test("is locked for someone who may create incidents but not link them", async () => {
        permissionsForTest = [Permission.CreateProjectIncident];

        const button: CardButtonSchema | undefined = await declareButton();

        expect(button!.disabled).toBe(true);
        expect(button!.tooltip).toContain(
          "You do not have permission to create this Incident Alert.",
        );
      });

      test("is hidden until the permission snapshot has loaded", async () => {
        permissionsForTest = [];

        expect(await declareButton()).toBeUndefined();
      });
    });
  });
});
