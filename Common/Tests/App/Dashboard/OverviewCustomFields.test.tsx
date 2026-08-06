import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The card that puts a project's custom fields on a resource's OVERVIEW page.
 *
 * Every resource already had a dedicated "Custom Fields" page behind a side
 * menu item, which is where the values went to be ignored. What this wrapper
 * owns is the two things that make the same card safe to mount on a page
 * nobody opened for custom fields: it disappears entirely for the projects
 * that never defined one, and it names itself the same way on every resource.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so naming the mocks directly would capture them before their
 * initializers have run.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import OverviewCustomFields from "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/OverviewCustomFields";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageCustomField from "../../../Models/DatabaseModels/StatusPageCustomField";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

type BuildSchemaFunction = (names: Array<string>) => Array<IncidentCustomField>;

const buildSchema: BuildSchemaFunction = (
  names: Array<string>,
): Array<IncidentCustomField> => {
  return names.map((name: string) => {
    const schemaItem: IncidentCustomField = new IncidentCustomField();
    schemaItem.name = name;
    schemaItem.customFieldType = CustomFieldType.Text;
    return schemaItem;
  });
};

type ResolveListFunction = (data: Array<BaseModel>) => void;

const resolveListWith: ResolveListFunction = (data: Array<BaseModel>): void => {
  getListMock.mockResolvedValue({
    data: data,
    count: data.length,
    skip: 0,
    limit: data.length,
  } as never);
};

type BuildIncidentFunction = (customFields: JSONObject) => Incident;

const buildIncident: BuildIncidentFunction = (
  customFields: JSONObject,
): Incident => {
  const incident: Incident = new Incident();
  incident.id = INCIDENT_ID;
  incident.customFields = customFields;
  return incident;
};

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  getCurrentProjectIdMock.mockReset();
});

describe("OverviewCustomFields", () => {
  test("shows the project's fields and this record's values", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    resolveListWith(buildSchema(["Customer", "Escalated To"]));
    getItemMock.mockResolvedValue(
      buildIncident({
        Customer: "Acme Corp",
        "Escalated To": "Tier 2",
      }) as never,
    );

    render(
      <OverviewCustomFields
        modelId={INCIDENT_ID}
        modelType={Incident}
        customFieldType={IncidentCustomField}
        resourceName="Incident"
      />,
    );

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Tier 2")).toBeInTheDocument();
    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("Escalated To")).toBeInTheDocument();
  });

  test("titles the card the same way regardless of resource", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    resolveListWith(buildSchema(["Customer"]));
    getItemMock.mockResolvedValue(
      buildIncident({ Customer: "Acme Corp" }) as never,
    );

    render(
      <OverviewCustomFields
        modelId={INCIDENT_ID}
        modelType={Incident}
        customFieldType={IncidentCustomField}
        resourceName="Incident"
      />,
    );

    await screen.findByText("Acme Corp");

    expect(screen.getByText("Custom Fields")).toBeInTheDocument();
    expect(
      screen.getByText("Custom fields for this incident."),
    ).toBeInTheDocument();
  });

  test("lowercases a multi-word resource name in the description", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    resolveListWith(buildSchema(["Owner"]));
    getItemMock.mockResolvedValue(
      buildIncident({ Owner: "Platform" }) as never,
    );

    render(
      <OverviewCustomFields
        modelId={INCIDENT_ID}
        modelType={StatusPage}
        customFieldType={StatusPageCustomField}
        resourceName="Status Page"
      />,
    );

    await screen.findByText("Platform");

    expect(
      screen.getByText("Custom fields for this status page."),
    ).toBeInTheDocument();
  });

  test("gives the Detail block an id derived from the resource", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    resolveListWith(buildSchema(["Customer"]));
    getItemMock.mockResolvedValue(
      buildIncident({ Customer: "Acme Corp" }) as never,
    );

    const { container } = render(
      <OverviewCustomFields
        modelId={INCIDENT_ID}
        modelType={Incident}
        customFieldType={IncidentCustomField}
        resourceName="Incident"
      />,
    );

    await screen.findByText("Acme Corp");

    expect(
      container.querySelector('[id="Incident Custom Fields"]'),
    ).not.toBeNull();
  });

  /*
   * The whole reason the overview can mount this unconditionally. Most
   * projects never define a custom field, and they must not be shown an empty
   * card explaining that.
   */
  test("renders nothing when the project defined no fields", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    resolveListWith([]);
    getItemMock.mockResolvedValue(buildIncident({}) as never);

    const { container } = render(
      <OverviewCustomFields
        modelId={INCIDENT_ID}
        modelType={Incident}
        customFieldType={IncidentCustomField}
        resourceName="Incident"
      />,
    );

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing when reading the fields fails", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    getListMock.mockRejectedValue(new Error("Upgrade your plan"));
    getItemMock.mockResolvedValue(buildIncident({}) as never);

    const { container } = render(
      <OverviewCustomFields
        modelId={INCIDENT_ID}
        modelType={Incident}
        customFieldType={IncidentCustomField}
        resourceName="Incident"
      />,
    );

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(screen.queryByText(/Upgrade your plan/i)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  test("scopes the field lookup to the current project and the given record", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    resolveListWith(buildSchema(["Customer"]));
    getItemMock.mockResolvedValue(
      buildIncident({ Customer: "Acme Corp" }) as never,
    );

    render(
      <OverviewCustomFields
        modelId={INCIDENT_ID}
        modelType={Incident}
        customFieldType={IncidentCustomField}
        resourceName="Incident"
      />,
    );

    await screen.findByText("Acme Corp");

    const listArgs: JSONObject = getListMock.mock.calls[0]![0] as JSONObject;
    expect(listArgs["modelType"]).toBe(IncidentCustomField);
    expect((listArgs["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);

    const itemArgs: JSONObject = getItemMock.mock.calls[0]![0] as JSONObject;
    expect(itemArgs["modelType"]).toBe(Incident);
    expect(itemArgs["id"]).toBe(INCIDENT_ID);
  });

  test("renders nothing, and asks for nothing, without a current project", () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    const { container } = render(
      <OverviewCustomFields
        modelId={INCIDENT_ID}
        modelType={Incident}
        customFieldType={IncidentCustomField}
        resourceName="Incident"
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(getListMock).not.toHaveBeenCalled();
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("is editable by default and read only when asked", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    resolveListWith(buildSchema(["Customer"]));
    getItemMock.mockResolvedValue(
      buildIncident({ Customer: "Acme Corp" }) as never,
    );

    const { unmount } = render(
      <OverviewCustomFields
        modelId={INCIDENT_ID}
        modelType={Incident}
        customFieldType={IncidentCustomField}
        resourceName="Incident"
      />,
    );

    expect(await screen.findByText("Edit Fields")).toBeInTheDocument();
    unmount();

    render(
      <OverviewCustomFields
        modelId={INCIDENT_ID}
        modelType={Incident}
        customFieldType={IncidentCustomField}
        resourceName="Incident"
        isEditable={false}
      />,
    );

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.queryByText("Edit Fields")).not.toBeInTheDocument();
  });
});
