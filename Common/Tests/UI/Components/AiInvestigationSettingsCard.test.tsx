import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import FieldType from "../../../UI/Components/Types/FieldType";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The incident and alert "AI" settings pages render the investigation severity
 * floor from a relation column. Detail.tsx had no branch for FieldType.Entity,
 * so the whole IncidentSeverity model reached React as a child - which throws
 * "Objects are not valid as a React child" (minified #31), trips the error
 * boundary, and blanks the page for every project that had a floor set.
 *
 * This drives the real CardModelDetail -> ModelDetail -> Detail stack with the
 * field configuration those two pages use, so the crash cannot come back, and
 * pins the two things around it: the relation is actually asked for in the
 * select, and the edit form is grouped into steps.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/Toast/ToastInit", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
    ShowToastNotification: () => {
      return null;
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: () => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../Models/DatabaseModels/Project";

// These render real components that fetch, so give the waits room on a loaded box.
const WAIT_TIMEOUT: number = 20000;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const SEVERITY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

type RenderCardFunction = () => void;

const renderCard: RenderCardFunction = (): void => {
  render(
    <CardModelDetail<Project>
      name="Automatic Incident Investigation"
      cardProps={{
        title: "Automatic Incident Investigation",
        description: "Investigate every new incident.",
      }}
      isEditable={true}
      editButtonText={"Update"}
      formSteps={[
        { title: "Investigation", id: "investigation" },
        { title: "Limits", id: "limits" },
        { title: "Fix Tasks", id: "fix-tasks" },
      ]}
      formFields={[
        {
          field: { enableAutomaticIncidentInvestigation: true },
          stepId: "investigation",
          title: "Automatically Investigate Incidents",
          required: false,
          fieldType: FormFieldSchemaType.Toggle,
        },
        {
          field: { incidentInvestigationMinimumSeverity: true },
          stepId: "investigation",
          title: "Minimum Severity To Investigate",
          required: false,
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownModal: {
            type: IncidentSeverity,
            labelField: "name",
            valueField: "_id",
          },
          placeholder: "Every severity",
        },
        {
          field: { incidentAiMaxConcurrentInvestigations: true },
          stepId: "limits",
          title: "Max Concurrent Incident Investigations",
          required: false,
          fieldType: FormFieldSchemaType.Number,
          placeholder: "3",
        },
        {
          field: { incidentAiDailyFixTaskLimit: true },
          stepId: "fix-tasks",
          title: "Daily Incident AI Fix Task Limit",
          required: false,
          fieldType: FormFieldSchemaType.Number,
          placeholder: "25",
        },
      ]}
      modelDetailProps={{
        modelType: Project,
        id: "model-detail-project-incident-ai-settings",
        modelId: PROJECT_ID,
        fields: [
          {
            field: { enableAutomaticIncidentInvestigation: true },
            title: "Automatically Investigate Incidents",
            placeholder: "Disabled",
            fieldType: FieldType.Boolean,
          },
          {
            field: {
              incidentInvestigationMinimumSeverity: {
                name: true,
                color: true,
              },
            },
            title: "Minimum Severity To Investigate",
            placeholder: "Every severity",
            fieldType: FieldType.Entity,
          },
        ],
      }}
    />,
  );
};

type LoadedProjectFunction = () => Project;

const loadedProject: LoadedProjectFunction = (): Project => {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.id = SEVERITY_ID;
  severity.name = "Critical";
  severity.color = new Color("#ef4444");

  const project: Project = new Project();
  project.id = PROJECT_ID;
  project.enableAutomaticIncidentInvestigation = true;
  project.incidentInvestigationMinimumSeverity = severity;

  return project;
};

describe("AI investigation settings card", () => {
  beforeEach(() => {
    getItemMock.mockReset();
    getListMock.mockReset();
    createOrUpdateMock.mockReset();
    getItemMock.mockResolvedValue(loadedProject());
    getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 10 });
    createOrUpdateMock.mockResolvedValue({ data: {} });
  });

  it("shows the severity floor instead of blanking the page on a relation", async () => {
    renderCard();

    const badge: HTMLElement = await screen.findByText(
      "Critical",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(badge).toBeDefined();
    // The error boundary text that used to replace the whole page.
    expect(screen.queryByText(/unexpected error/i)).toBeNull();
  });

  it("asks the API for the relation columns the card renders", async () => {
    renderCard();

    await waitFor(
      () => {
        expect(getItemMock).toHaveBeenCalled();
      },
      { timeout: WAIT_TIMEOUT },
    );

    const detailCall: any = (getItemMock.mock.calls as Array<Array<any>>).find(
      (call: Array<any>) => {
        return call[0]?.select?.["incidentInvestigationMinimumSeverity"];
      },
    );

    expect(detailCall).toBeDefined();
    expect(detailCall[0].select.incidentInvestigationMinimumSeverity).toEqual({
      name: true,
      color: true,
    });
  });

  it("groups the edit form into steps", async () => {
    renderCard();

    await userEvent.click(
      await screen.findByText("Update", {}, { timeout: WAIT_TIMEOUT }),
    );

    await waitFor(
      () => {
        expect(screen.getByText("Investigation")).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(screen.getByText("Limits")).toBeDefined();
    expect(screen.getByText("Fix Tasks")).toBeDefined();

    /*
     * Only the first step's fields are on screen - which is the point of
     * steps, and proves stepId actually took rather than being ignored.
     */
    expect(screen.queryByText("Daily Incident AI Fix Task Limit")).toBeNull();
  });
});
