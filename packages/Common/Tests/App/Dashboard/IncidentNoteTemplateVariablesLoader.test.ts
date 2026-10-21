/** @timezone UTC */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The values an incident's note templates are filled with when one is picked
 * (Components/Incident/IncidentNoteTemplateVariables): the incident, its
 * custom fields and the status pages it reaches, each read on its own. What
 * is pinned: what is read, and that whatever cannot be read leaves its
 * placeholders as written rather than failing the rest.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "11111111-1111-4111-8111-111111111111" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
      getFriendlyMessage: (): string => {
        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

import { fetchIncidentNoteTemplateVariables } from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentNoteTemplateVariables";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { isCustomFieldTemplateVariableName } from "../../../Types/CustomField/CustomFieldVariableKey";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import IncidentSubscriberAudience from "../../../Types/StatusPage/IncidentSubscriberAudience";
import { NoteTemplateVariables } from "../../../Utils/Incident/IncidentNoteTemplateVariables";

const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function label(name: string): Label {
  const result: Label = new Label();
  result.name = name;
  return result;
}

function buildIncident(): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.title = "Payments are failing";
  incident.incidentNumber = 42;
  incident.incidentNumberWithPrefix = "INC-42";
  incident.declaredAt = new Date("2026-09-27T09:30:00.000Z");
  incident.customFields = {
    Impact: "High",
    "Estimated Duration": 0,
  };

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  incident.incidentSeverity = severity;

  const state: IncidentState = new IncidentState();
  state.name = "Investigating";
  incident.currentIncidentState = state;

  incident.labels = [label("Region East"), label("Payments")];

  return incident;
}

function definition(
  name: string,
  variableKey: string,
  customFieldType: CustomFieldType,
): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field.name = name;
  field.variableKey = variableKey;
  field.customFieldType = customFieldType;
  return field;
}

function audienceResponse(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    IncidentSubscriberAudience.toJSON({
      hasMonitors: true,
      isScoped: true,
      isHiddenFromStatusPages: false,
      statusPages: [
        {
          statusPageId: "b0000000-0000-4000-8000-000000000003",
          name: "Site 03",
          subscriberCounts: IncidentSubscriberAudience.getEmptyCounts(),
        },
        {
          statusPageId: "b0000000-0000-4000-8000-000000000007",
          name: "Site 07",
          subscriberCounts: IncidentSubscriberAudience.getEmptyCounts(),
        },
      ],
      hiddenStatusPageCount: 1,
      excludedStatusPages: [],
      selectedStatusPagesNotListingMonitors: [],
    }),
    {},
  );
}

beforeEach(() => {
  getItemMock.mockReset();
  getItemMock.mockResolvedValue(buildIncident() as never);
  getListMock.mockReset();
  getListMock.mockResolvedValue({
    data: [
      definition("Impact", "impact", CustomFieldType.Dropdown),
      definition(
        "Estimated Duration",
        "estimated_duration",
        CustomFieldType.Number,
      ),
    ],
    count: 2,
    skip: 0,
    limit: 2,
  } as never);
  postMock.mockReset();
  postMock.mockResolvedValue(audienceResponse() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("fetchIncidentNoteTemplateVariables", () => {
  test("fills every placeholder from the incident", async () => {
    const variables: NoteTemplateVariables =
      await fetchIncidentNoteTemplateVariables(INCIDENT_ID);

    expect(variables["incident.title"]).toBe("Payments are failing");
    expect(variables["incident.number"]).toBe("INC-42");
    expect(variables["incident.severity"]).toBe("Critical");
    expect(variables["incident.state"]).toBe("Investigating");
    expect(variables["incident.startedAt"]).toMatch(/^Sep 27 2026, /);
    expect(variables["incident.labels"]).toBe("Region East, Payments");
    // Only the pages the author can see are named.
    expect(variables["incident.affectedStatusPages"]).toBe("Site 03, Site 07");
    expect(variables["incident.customFields.impact"]).toBe("High");
    expect(variables["incident.customFields.estimated_duration"]).toBe("0");
    // And under the older name, for templates saved before the rename.
    expect(variables["customFields.impact"]).toBe("High");
    expect(variables["customFields.estimated_duration"]).toBe("0");
  });

  test("reads this incident, with the related names the placeholders need", async () => {
    await fetchIncidentNoteTemplateVariables(INCIDENT_ID);

    const request: {
      modelType: unknown;
      id: ObjectID;
      select: JSONObject;
    } = getItemMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      select: JSONObject;
    };

    expect(request.modelType).toBe(Incident);
    expect(request.id.toString()).toBe(INCIDENT_ID.toString());
    expect(request.select).toEqual({
      title: true,
      incidentNumber: true,
      incidentNumberWithPrefix: true,
      declaredAt: true,
      customFields: true,
      incidentSeverity: { name: true },
      currentIncidentState: { name: true },
      labels: { name: true },
    });
  });

  test("reads the custom fields' template keys", async () => {
    await fetchIncidentNoteTemplateVariables(INCIDENT_ID);

    const request: { modelType: unknown; select: JSONObject } = getListMock.mock
      .calls[0]![0] as { modelType: unknown; select: JSONObject };

    expect(request.modelType).toBe(IncidentCustomField);
    expect(request.select["variableKey"]).toBe(true);
  });

  test("asks who the incident reaches the same way the audience summary does", async () => {
    await fetchIncidentNoteTemplateVariables(INCIDENT_ID);

    const request: {
      url: { toString: () => string };
      data: JSONObject;
      headers: JSONObject;
    } = postMock.mock.calls[0]![0] as {
      url: { toString: () => string };
      data: JSONObject;
      headers: JSONObject;
    };

    expect(request.url.toString()).toContain("/incident/subscriber-audience");
    expect(request.data).toEqual({ incidentId: INCIDENT_ID.toString() });
    expect(request.headers["tenantid"]).toBeDefined();
  });

  test("an incident that cannot be read fills nothing", async () => {
    getItemMock.mockResolvedValue(null as never);

    expect(await fetchIncidentNoteTemplateVariables(INCIDENT_ID)).toEqual({});

    getItemMock.mockRejectedValue(new Error("Not allowed.") as never);

    expect(await fetchIncidentNoteTemplateVariables(INCIDENT_ID)).toEqual({});
  });

  test("custom fields that cannot be read leave their placeholders, and nothing else", async () => {
    getListMock.mockRejectedValue(
      new Error("Custom fields are not on your plan.") as never,
    );

    const variables: NoteTemplateVariables =
      await fetchIncidentNoteTemplateVariables(INCIDENT_ID);

    expect(variables["incident.title"]).toBe("Payments are failing");
    // Under neither name.
    expect(
      Object.keys(variables).some((name: string) => {
        return isCustomFieldTemplateVariableName(name);
      }),
    ).toBe(false);
  });

  test("status pages that cannot be read leave their placeholder, and nothing else", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "No access." }, {}) as never,
    );

    const variables: NoteTemplateVariables =
      await fetchIncidentNoteTemplateVariables(INCIDENT_ID);

    expect(variables).not.toHaveProperty(["incident.affectedStatusPages"]);
    expect(variables["incident.customFields.impact"]).toBe("High");
  });

  test("an incident with no labels fills the placeholder with nothing", async () => {
    const incident: Incident = buildIncident();
    incident.labels = [];
    getItemMock.mockResolvedValue(incident as never);

    const variables: NoteTemplateVariables =
      await fetchIncidentNoteTemplateVariables(INCIDENT_ID);

    expect(variables["incident.labels"]).toBe("");
  });
});
