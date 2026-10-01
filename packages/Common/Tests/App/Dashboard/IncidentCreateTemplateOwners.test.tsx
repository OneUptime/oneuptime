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
 * Regression: an incident declared from a template in the dashboard lost the
 * template's owners.
 *
 * The Create page read the template's owner teams and users and put them into
 * the form's initial values as ownerTeams / ownerUsers. But a ModelForm sends
 * only its model's columns and, as misc data, the values of its inputs that
 * have an overrideFieldKey - and the form has had no owner inputs since the
 * Owners step was removed (483578ba4d). So the ids were read and then
 * silently dropped, and IncidentService.onCreateSuccess, which adds the
 * owners it finds in miscDataProps.ownerUsers / ownerTeams, never saw them.
 *
 * The page now keeps the template's owners beside the form, and its
 * onBeforeCreate - whose misc data object is the one the request carries
 * (ModelFormOnBeforeCreateMiscData.test.tsx pins that) - puts them there.
 * ModelForm is stubbed to capture what it is handed.
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

describe("declaring an incident from a template with owners", () => {
  test("sends the template's owner users and teams to the server", async () => {
    await renderCreate();

    expect(await miscDataSent()).toEqual({
      ownerUsers: [USER_A, USER_B],
      ownerTeams: [TEAM_A],
    });
  });

  test("sends them as plain ids, which the server takes as they are", async () => {
    await renderCreate();

    const sent: Record<string, unknown> = await miscDataSent();

    for (const id of [
      ...(sent["ownerUsers"] as Array<unknown>),
      ...(sent["ownerTeams"] as Array<unknown>),
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

  test("keeps them beside the form, not in it", async () => {
    await renderCreate();

    expect(lastForm().initialValues).not.toHaveProperty(["ownerUsers"]);
    expect(lastForm().initialValues).not.toHaveProperty(["ownerTeams"]);
    // Still declared from the template.
    expect(lastForm().initialValues["title"]).toBe("Checkout outage");
  });

  test("keeps what the rest of the page put in the misc data", async () => {
    await renderCreate();

    expect(
      await miscDataSent({
        incidentRoles: ["role-1"],
        "customFields:Impact": "High",
      }),
    ).toEqual({
      incidentRoles: ["role-1"],
      ownerUsers: [USER_A, USER_B],
      ownerTeams: [TEAM_A],
    });
  });

  test("only users: no team key is sent", async () => {
    ownerTeamIds = [];

    await renderCreate();

    expect(await miscDataSent()).toEqual({ ownerUsers: [USER_A, USER_B] });
  });

  test("only teams: no user key is sent", async () => {
    ownerUserIds = [];

    await renderCreate();

    expect(await miscDataSent()).toEqual({ ownerTeams: [TEAM_A] });
  });

  test("an owner row without an id is skipped", async () => {
    ownerUserIds = [USER_A, undefined];
    ownerTeamIds = [undefined];

    await renderCreate();

    expect(await miscDataSent()).toEqual({ ownerUsers: [USER_A] });
  });

  test("a template with no owners sends no owner keys", async () => {
    ownerUserIds = [];
    ownerTeamIds = [];

    await renderCreate();

    expect(await miscDataSent()).toEqual({});
  });

  test("a template that cannot be found brings no owners", async () => {
    templateFound = false;

    await renderCreate();

    expect(await miscDataSent()).toEqual({});
  });
});

describe("declaring an incident without a template", () => {
  test("reads no owners and sends none", async () => {
    queryString = {};

    await renderCreate();

    expect(ownerRequests(IncidentTemplateOwnerUser)).toHaveLength(0);
    expect(ownerRequests(IncidentTemplateOwnerTeam)).toHaveLength(0);
    expect(await miscDataSent()).toEqual({});
  });
});

describe("declaring from alerts with a template", () => {
  test("sends the template's owners along with the alerts to link", async () => {
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
    expect(await miscDataSent()).toEqual({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
      ownerUsers: [USER_A, USER_B],
      ownerTeams: [TEAM_A],
    });
  });
});
