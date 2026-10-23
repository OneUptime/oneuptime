import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An incident declared from a template takes the template's owners.
 *
 * They once went missing: the page put them into the form's initial values,
 * and the form had no owner input to send them (the Owners step was removed
 * in 483578ba4d). Then the page kept them beside the form and its
 * onBeforeCreate added them to the misc data - out of sight, and out of the
 * declarer's hands.
 *
 * Now Declare Incident asks for owners again, under More fields at the end
 * of Incident Details (Components/OwnersOnCreate): the owners people picker,
 * kept in ownerUsers and ownerTeams. The template's owners START that field
 * - shown, and changeable, like the template's labels - and ModelForm sends
 * the field's picks as the misc data IncidentService reads
 * (ModelFormPeoplePicker.test.tsx: "starts with the owners a page hands it,
 * and sends them on untouched"). The page's onBeforeCreate leaves them as
 * the form sends them. ModelForm is stubbed to capture what it is handed.
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

type CapturedFormProps = {
  initialValues: Record<string, unknown>;
  fields: Array<Record<string, unknown>>;
  onBeforeCreate: (
    item: unknown,
    miscDataProps: Record<string, unknown>,
    formValues: Record<string, unknown>,
  ) => Promise<unknown>;
};

let capturedForms: Array<CapturedFormProps> = [];

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Forms/ModelForm",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: (props: CapturedFormProps): React.ReactElement => {
      capturedForms.push(props);
      return <div data-testid="model-form" />;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

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
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
      create: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: async (): Promise<never> => {
        return new Promise<never>(() => {
          // The audience summary is not what these tests are about.
        });
      },
      getFriendlyMessage: (): string => {
        return "Something went wrong";
      },
    },
  };
});

import IncidentCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "../../../Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "../../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import Route from "../../../Types/API/Route";
import {
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
  INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM,
} from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

const TEMPLATE_ID: string = "66666666-6666-4666-8666-000000000001";
const USER_A: string = "0000000e-0000-4000-8000-000000000001";
const USER_B: string = "0000000e-0000-4000-8000-000000000002";
const TEAM_A: string = "0000000b-0000-4000-8000-000000000001";
const ALERT_ID: string = "22222222-2222-4222-8222-000000000001";

let ownerUserIds: Array<string | undefined> = [];
let ownerTeamIds: Array<string | undefined> = [];
let queryString: Record<string, string> = {};
let templateFound: boolean = true;

function ownerUser(userId: string | undefined): IncidentTemplateOwnerUser {
  const row: IncidentTemplateOwnerUser = new IncidentTemplateOwnerUser();
  row._id = ObjectID.generate().toString();

  if (userId) {
    row.userId = new ObjectID(userId);
  }

  return row;
}

function ownerTeam(teamId: string | undefined): IncidentTemplateOwnerTeam {
  const row: IncidentTemplateOwnerTeam = new IncidentTemplateOwnerTeam();
  row._id = ObjectID.generate().toString();

  if (teamId) {
    row.teamId = new ObjectID(teamId);
  }

  return row;
}

function listResult(data: Array<unknown>): JSONObject {
  return { data: data, count: data.length, skip: 0, limit: 0 } as JSONObject;
}

async function renderCreate(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <IncidentCreate
          pageRoute={new Route("/incidents/create")}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(capturedForms.length).toBeGreaterThan(0);
  });
}

function lastForm(): CapturedFormProps {
  return capturedForms[capturedForms.length - 1]!;
}

// What the form would send as misc data, after the page's onBeforeCreate.
async function miscDataSent(
  miscDataProps: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const item: Incident = new Incident();
  item.title = "Checkout is failing";

  await lastForm().onBeforeCreate(item, miscDataProps, { title: item.title });

  return miscDataProps;
}

function ownerRequests(modelType: unknown): Array<JSONObject> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return request["modelType"] === modelType;
    });
}

beforeEach(() => {
  capturedForms = [];
  ownerUserIds = [USER_A, USER_B];
  ownerTeamIds = [TEAM_A];
  queryString = { incidentTemplateId: TEMPLATE_ID };
  templateFound = true;

  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string | null => {
      return queryString[name] || null;
    });

  getListMock.mockReset();
  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === IncidentTemplateOwnerUser) {
      return listResult(ownerUserIds.map(ownerUser));
    }

    if (request.modelType === IncidentTemplateOwnerTeam) {
      return listResult(ownerTeamIds.map(ownerTeam));
    }

    return listResult([]);
  });

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (!templateFound) {
      return null;
    }

    const template: IncidentTemplate = new IncidentTemplate();
    template._id = TEMPLATE_ID;
    template.title = "Checkout outage";
    return template;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// The form's Owners field, as the page hands it to ModelForm.
function ownersField(): Record<string, unknown> | undefined {
  return lastForm().fields.find((field: Record<string, unknown>): boolean => {
    return field["fieldType"] === FormFieldSchemaType.PeoplePicker;
  });
}

describe("declaring an incident from a template with owners", () => {
  test("starts the Owners field with the template's owner users and teams", async () => {
    await renderCreate();

    expect(lastForm().initialValues["ownerUsers"]).toEqual([USER_A, USER_B]);
    expect(lastForm().initialValues["ownerTeams"]).toEqual([TEAM_A]);
    // Still declared from the template.
    expect(lastForm().initialValues["title"]).toBe("Checkout outage");
  });

  test("starts it with plain ids, which the server takes as they are", async () => {
    await renderCreate();

    for (const id of [
      ...(lastForm().initialValues["ownerUsers"] as Array<unknown>),
      ...(lastForm().initialValues["ownerTeams"] as Array<unknown>),
    ]) {
      expect(typeof id).toBe("string");
      expect(ObjectID.isValidUUID(id as string)).toBe(true);
    }
  });

  test("reads the owners of the template being declared from", async () => {
    await renderCreate();

    for (const modelType of [
      IncidentTemplateOwnerUser,
      IncidentTemplateOwnerTeam,
    ]) {
      const requests: Array<JSONObject> = ownerRequests(modelType);

      expect(requests).toHaveLength(1);
      expect(
        String((requests[0]!["query"] as JSONObject)["incidentTemplate"]),
      ).toBe(TEMPLATE_ID);
    }
  });

  test("the field they start keeps its picks in ownerUsers and ownerTeams, under More fields", async () => {
    await renderCreate();

    const field: Record<string, unknown> | undefined = ownersField();

    expect(field).toBeDefined();
    expect(field!["stepId"]).toBe("incident-details");
    expect(field!["collapsibleSection"]).toBeDefined();
    expect(
      (
        (field!["peoplePicker"] as { kinds: Array<{ valueKey: string }> })
          .kinds || []
      ).map((kind: { valueKey: string }): string => {
        return kind.valueKey;
      }),
    ).toEqual(["ownerUsers", "ownerTeams"]);
  });

  test("the page sends the owners as the form picked them, beside the rest of the misc data", async () => {
    await renderCreate();

    // The declarer took a user away and kept the team.
    expect(
      await miscDataSent({
        incidentRoles: ["role-1"],
        "customFields:Impact": "High",
        ownerUsers: [USER_B],
        ownerTeams: [TEAM_A],
      }),
    ).toEqual({
      incidentRoles: ["role-1"],
      ownerUsers: [USER_B],
      ownerTeams: [TEAM_A],
    });
  });

  test("owners all taken away are not put back", async () => {
    await renderCreate();

    expect(await miscDataSent({ ownerUsers: [], ownerTeams: [] })).toEqual({
      ownerUsers: [],
      ownerTeams: [],
    });
  });

  test("only users: the field starts with no team", async () => {
    ownerTeamIds = [];

    await renderCreate();

    expect(lastForm().initialValues["ownerUsers"]).toEqual([USER_A, USER_B]);
    expect(lastForm().initialValues["ownerTeams"]).toEqual([]);
  });

  test("only teams: the field starts with no user", async () => {
    ownerUserIds = [];

    await renderCreate();

    expect(lastForm().initialValues["ownerUsers"]).toEqual([]);
    expect(lastForm().initialValues["ownerTeams"]).toEqual([TEAM_A]);
  });

  test("an owner row without an id is skipped", async () => {
    ownerUserIds = [USER_A, undefined];
    ownerTeamIds = [undefined];

    await renderCreate();

    expect(lastForm().initialValues["ownerUsers"]).toEqual([USER_A]);
    expect(lastForm().initialValues["ownerTeams"]).toEqual([]);
  });

  test("a template with no owners starts the field empty, and sends no owner keys of its own", async () => {
    ownerUserIds = [];
    ownerTeamIds = [];

    await renderCreate();

    expect(lastForm().initialValues["ownerUsers"]).toEqual([]);
    expect(lastForm().initialValues["ownerTeams"]).toEqual([]);
    expect(await miscDataSent()).toEqual({});
  });

  test("a template that cannot be found brings no owners", async () => {
    templateFound = false;

    await renderCreate();

    expect(lastForm().initialValues).not.toHaveProperty(["ownerUsers"]);
    expect(lastForm().initialValues).not.toHaveProperty(["ownerTeams"]);
    expect(await miscDataSent()).toEqual({});
  });
});

describe("declaring an incident without a template", () => {
  test("reads no owners, starts none, and still offers the Owners field", async () => {
    queryString = {};

    await renderCreate();

    expect(ownerRequests(IncidentTemplateOwnerUser)).toHaveLength(0);
    expect(ownerRequests(IncidentTemplateOwnerTeam)).toHaveLength(0);
    expect(lastForm().initialValues).not.toHaveProperty(["ownerUsers"]);
    expect(ownersField()).toBeDefined();
    expect(await miscDataSent()).toEqual({});
  });
});

describe("declaring from alerts with a template", () => {
  test("starts the template's owners, and sends the alerts to link beside them", async () => {
    queryString = {
      incidentTemplateId: TEMPLATE_ID,
      [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: ALERT_ID,
    };

    getListMock.mockImplementation(async (...args: Array<unknown>) => {
      const request: { modelType: unknown } = args[0] as {
        modelType: unknown;
      };

      if (request.modelType === IncidentTemplateOwnerUser) {
        return listResult(ownerUserIds.map(ownerUser));
      }

      if (request.modelType === IncidentTemplateOwnerTeam) {
        return listResult(ownerTeamIds.map(ownerTeam));
      }

      if (request.modelType === Alert) {
        const alert: Alert = new Alert();
        alert._id = ALERT_ID;
        alert.title = "Checkout latency";
        return listResult([alert]);
      }

      return listResult([]);
    });

    await renderCreate();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(lastForm().initialValues["ownerUsers"]).toEqual([USER_A, USER_B]);
    expect(lastForm().initialValues["ownerTeams"]).toEqual([TEAM_A]);
    expect(
      await miscDataSent({
        ownerUsers: [USER_A, USER_B],
        ownerTeams: [TEAM_A],
      }),
    ).toEqual({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
      ownerUsers: [USER_A, USER_B],
      ownerTeams: [TEAM_A],
    });
  });
});
