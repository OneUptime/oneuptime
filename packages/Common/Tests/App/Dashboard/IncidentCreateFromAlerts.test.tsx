import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Declaring an incident from alerts: the create-incident page reads
 * `?alertIds=`, prefills the form from those alerts, shows which alerts will
 * be linked, and hands their ids to the server as miscDataProps. Without the
 * parameter nothing about the page changes.
 *
 * ModelForm is stubbed to capture the props it is handed (as
 * AffectedResourcesSummaryStep.test.tsx does), and ModelAPI answers per model
 * type. BasicForm latches initial values on its first render, so the page
 * must not render the form until the prefill is in - every captured render is
 * checked, not just the last one.
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
  onBeforeCreate?:
    | ((
        item: unknown,
        miscDataProps: Record<string, unknown>,
      ) => Promise<unknown>)
    | undefined;
  fields: Array<Record<string, unknown>>;
};

let capturedForms: Array<CapturedFormProps> = [];

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  // Only the component is stubbed: the page imports FormType from here too.
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
      create: async (): Promise<null> => {
        return null;
      },
    },
  };
});

import IncidentCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import Service from "../../../Models/DatabaseModels/Service";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
  INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM,
  MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
} from "../../../Types/Incident/IncidentAlertLink";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const FIRST_STATE_ID: string = "55555555-5555-4555-8555-000000000001";
const TEMPLATE_ID: string = "66666666-6666-4666-8666-000000000001";

const ALERT_ONE_ID: string = "22222222-2222-4222-8222-000000000001";
const ALERT_TWO_ID: string = "22222222-2222-4222-8222-000000000002";
const ALERT_THREE_ID: string = "22222222-2222-4222-8222-000000000003";

const ALERT_HIGH_ID: string = "77777777-7777-4777-8777-000000000001";
const ALERT_LOW_ID: string = "77777777-7777-4777-8777-000000000002";
const INCIDENT_CRITICAL_ID: string = "88888888-8888-4888-8888-000000000001";
const INCIDENT_MAJOR_ID: string = "88888888-8888-4888-8888-000000000002";

type MakeNamedFunction = <T extends { _id?: string; name?: string }>(
  modelType: { new (): T },
  id: string,
  name: string,
) => T;

const makeNamed: MakeNamedFunction = <
  T extends { _id?: string; name?: string },
>(
  modelType: { new (): T },
  id: string,
  name: string,
): T => {
  const model: T = new modelType();
  model._id = id;
  model.name = name;
  return model;
};

type MakeLabelFunction = (id: string) => Label;

const makeLabel: MakeLabelFunction = (id: string): Label => {
  const label: Label = new Label();
  label._id = id;
  return label;
};

/*
 * Alert one is Low severity on monitor "API"; alert two is High severity,
 * private, on monitor "Database" plus a host and a service. Both share a
 * label, so the prefill has to dedupe.
 */
type MakeAlertsFunction = () => Array<Alert>;

const makeAlerts: MakeAlertsFunction = (): Array<Alert> => {
  const one: Alert = new Alert();
  one._id = ALERT_ONE_ID;
  one.title = "API latency is high";
  one.description = "p99 above 2s.";
  one.alertNumber = 11;
  one.alertSeverityId = new ObjectID(ALERT_LOW_ID);
  one.monitor = makeNamed(Monitor, "m-api", "API");
  one.hosts = [];
  one.labels = [makeLabel("label-shared"), makeLabel("label-api")];
  one.isPrivate = false;

  const two: Alert = new Alert();
  two._id = ALERT_TWO_ID;
  two.title = "Database is down";
  two.description = "Primary unreachable.";
  two.alertNumber = 12;
  two.alertNumberWithPrefix = "ALT-12";
  two.alertSeverityId = new ObjectID(ALERT_HIGH_ID);
  two.monitor = makeNamed(Monitor, "m-db", "Database");
  two.hosts = [makeNamed(Host, "h-db", "db-1")];
  two.services = [makeNamed(Service, "s-checkout", "Checkout")];
  two.labels = [makeLabel("label-shared")];
  two.isPrivate = true;

  return [one, two];
};

type ListResultFunction = (data: Array<unknown>) => {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};

const listResult: ListResultFunction = (data: Array<unknown>) => {
  return { data: data, count: data.length, skip: 0, limit: data.length };
};

interface ApiFixture {
  alerts: Array<Alert>;
  failAlerts?: boolean;
  failSeverities?: boolean;
}

let fixture: ApiFixture = { alerts: [] };
let queryParams: Record<string, string> = {};

type AnswerListFunction = (request: any) => Promise<unknown>;

const answerList: AnswerListFunction = async (
  request: any,
): Promise<unknown> => {
  if (request.modelType === IncidentState) {
    const state: IncidentState = new IncidentState();
    state._id = FIRST_STATE_ID;
    return listResult([state]);
  }

  if (request.modelType === Alert) {
    if (fixture.failAlerts) {
      throw new Error("Could not read the alerts.");
    }

    // Answer in reverse so the page has to restore the link's order.
    const ids: Array<string> = (request.query._id as Includes).values.map(
      (value: unknown): string => {
        return String(value);
      },
    );

    return listResult(
      fixture.alerts
        .filter((alert: Alert): boolean => {
          return ids.includes(alert._id || "");
        })
        .reverse(),
    );
  }

  if (request.modelType === AlertSeverity) {
    if (fixture.failSeverities) {
      throw new Error("Forbidden");
    }

    return listResult(
      [
        makeNamed(AlertSeverity, ALERT_LOW_ID, "Low"),
        makeNamed(AlertSeverity, ALERT_HIGH_ID, "High"),
      ].map((severity: AlertSeverity, index: number): AlertSeverity => {
        severity.order = index === 0 ? 2 : 1;
        return severity;
      }),
    );
  }

  if (request.modelType === IncidentSeverity) {
    if (fixture.failSeverities) {
      throw new Error("Forbidden");
    }

    const critical: IncidentSeverity = makeNamed(
      IncidentSeverity,
      INCIDENT_CRITICAL_ID,
      "Critical Incident",
    );
    critical.order = 1;
    const major: IncidentSeverity = makeNamed(
      IncidentSeverity,
      INCIDENT_MAJOR_ID,
      "Major Incident",
    );
    major.order = 2;

    return listResult([major, critical]);
  }

  // The template owner lists.
  return listResult([]);
};

type AlertRequestsFunction = () => Array<any>;

const alertRequests: AlertRequestsFunction = (): Array<any> => {
  return getListMock.mock.calls
    .map((call: Array<any>): any => {
      return call[0];
    })
    .filter((request: any): boolean => {
      return request.modelType === Alert;
    });
};

type OpenPageFunction = () => Promise<CapturedFormProps>;

const openPage: OpenPageFunction = async (): Promise<CapturedFormProps> => {
  render(
    <MemoryRouter>
      <IncidentCreate
        pageRoute={new Route("/dashboard/incidents/create")}
        currentProject={new Project()}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedForms.length).toBeGreaterThan(0);
  });

  return capturedForms[capturedForms.length - 1]!;
};

type MiscDataFunction = (
  form: CapturedFormProps,
) => Promise<Record<string, unknown>>;

// What the form would send as miscDataProps, after the page's onBeforeCreate.
const miscDataSentBy: MiscDataFunction = async (
  form: CapturedFormProps,
): Promise<Record<string, unknown>> => {
  const miscDataProps: Record<string, unknown> = {};
  const item: Incident = new Incident();

  expect(form.onBeforeCreate).toBeDefined();

  const returned: unknown = await form.onBeforeCreate!(item, miscDataProps);

  expect(returned).toBe(item);

  return miscDataProps;
};

type AlertIdsFunction = (count: number) => Array<string>;

const manyAlertIds: AlertIdsFunction = (count: number): Array<string> => {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `22222222-2222-4222-8222-${(index + 100).toString().padStart(12, "0")}`;
  });
};

describe("declaring an incident from alerts", () => {
  beforeEach(() => {
    capturedForms = [];
    fixture = { alerts: makeAlerts() };
    queryParams = {};
    getListMock.mockReset();
    getItemMock.mockReset();
    getListMock.mockImplementation(answerList);

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    jest
      .spyOn(Navigation, "getQueryStringByName")
      .mockImplementation((name: string): string | null => {
        return queryParams[name] ?? null;
      });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("reads the shared query parameter name", () => {
    expect(INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM).toBe("alertIds");
    expect(INCIDENT_ALERT_IDS_TO_LINK_KEY).toBe("alertIdsToLink");
  });

  describe("without alert ids", () => {
    test("renders the form straight away, reads no alerts and shows no banner", async () => {
      const form: CapturedFormProps = await openPage();

      expect(capturedForms[0]!.initialValues).toEqual({});
      expect(alertRequests()).toHaveLength(0);
      expect(
        screen.queryByTestId("incident-create-alerts-to-link"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("incident-create-alerts-not-found"),
      ).not.toBeInTheDocument();

      // The first state still arrives the way it always did.
      await waitFor(() => {
        expect(capturedForms[capturedForms.length - 1]!.initialValues).toEqual({
          currentIncidentState: FIRST_STATE_ID,
        });
      });

      expect(await miscDataSentBy(form)).toEqual({});
    });

    test("ignores a parameter holding no valid ids", async () => {
      queryParams = { [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: "nope,,<b>" };

      const form: CapturedFormProps = await openPage();

      expect(alertRequests()).toHaveLength(0);
      expect(
        screen.queryByTestId("incident-create-alerts-to-link"),
      ).not.toBeInTheDocument();
      expect(await miscDataSentBy(form)).toEqual({});
    });
  });

  describe("with alert ids", () => {
    beforeEach(() => {
      queryParams = {
        [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: `${ALERT_ONE_ID},${ALERT_TWO_ID}`,
      };
    });

    test("reads exactly those alerts, with what the prefill needs", async () => {
      await openPage();

      const requests: Array<any> = alertRequests();

      expect(requests).toHaveLength(1);
      expect((requests[0].query._id as Includes).values).toEqual([
        ALERT_ONE_ID,
        ALERT_TWO_ID,
      ]);
      expect(requests[0].limit).toBe(MAX_ALERTS_PER_INCIDENT_LINK_ACTION);
      expect(requests[0].select).toEqual(
        expect.objectContaining({
          title: true,
          description: true,
          alertSeverityId: true,
          isPrivate: true,
          monitor: { _id: true, name: true },
          hosts: { _id: true, name: true },
          services: { _id: true, name: true },
          labels: { _id: true },
        }),
      );
    });

    test("prefills the form from the alerts before it first renders", async () => {
      await openPage();

      const expected: Record<string, unknown> = {
        currentIncidentState: FIRST_STATE_ID,
        title: "Database is down",
        description: [
          "- Alert #11: API latency is high",
          "- Alert ALT-12: Database is down",
        ].join("\n"),
        incidentSeverity: INCIDENT_CRITICAL_ID,
        monitors: [
          { _id: "m-api", name: "API" },
          { _id: "m-db", name: "Database" },
        ],
        hosts: [{ _id: "h-db", name: "db-1" }],
        services: [{ _id: "s-checkout", name: "Checkout" }],
        labels: ["label-shared", "label-api"],
        isPrivate: true,
      };

      // Every render, including the first: the form latches initial values.
      for (const form of capturedForms) {
        expect(form.initialValues).toEqual(expected);
      }
      expect(capturedForms[0]!.initialValues).not.toHaveProperty(
        "onCallDutyPolicies",
      );
    });

    test("lists the alerts that will be linked, in the link's order", async () => {
      await openPage();

      const banner: HTMLElement = screen.getByTestId(
        "incident-create-alerts-to-link",
      );
      const items: Array<HTMLLIElement> = Array.from(
        banner.querySelectorAll("li"),
      );

      expect(banner).toHaveTextContent("Declaring this incident from alerts");
      expect(
        items.map((item: HTMLLIElement): string => {
          return item.textContent || "";
        }),
      ).toEqual([
        "Alert #11:API latency is high",
        "Alert ALT-12:Database is down",
      ]);
      expect(items[1]!.querySelector("a")?.getAttribute("href")).toBe(
        `/dashboard/${PROJECT_ID}/alerts/${ALERT_TWO_ID}`,
      );
      expect(
        screen.queryByTestId("incident-create-alerts-not-found"),
      ).not.toBeInTheDocument();
    });

    test("sends the alert ids to the server as miscDataProps", async () => {
      const form: CapturedFormProps = await openPage();

      expect(await miscDataSentBy(form)).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
      });
    });

    test("prefills a single alert's own title and description", async () => {
      queryParams = { [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: ALERT_ONE_ID };

      const form: CapturedFormProps = await openPage();

      expect(form.initialValues["title"]).toBe("API latency is high");
      expect(form.initialValues["description"]).toBe("p99 above 2s.");
      expect(form.initialValues["incidentSeverity"]).toBe(INCIDENT_MAJOR_ID);
      expect(form.initialValues["isPrivate"]).toBeUndefined();
      expect(await miscDataSentBy(form)).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID],
      });
    });

    test("leaves the severity to the user when severities cannot be read", async () => {
      fixture.failSeverities = true;

      const form: CapturedFormProps = await openPage();

      // No severity to rank by, so the first alert names the incident.
      expect(form.initialValues["title"]).toBe("API latency is high");
      expect(form.initialValues["incidentSeverity"]).toBeUndefined();
      expect(form.initialValues["monitors"]).toHaveLength(2);
    });

    test("links only the alerts it could read, and says some were missing", async () => {
      queryParams = {
        [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: `${ALERT_ONE_ID},${ALERT_THREE_ID}`,
      };

      const form: CapturedFormProps = await openPage();

      expect(
        screen.getByTestId("incident-create-alerts-to-link"),
      ).toHaveTextContent("Some alerts could not be found");
      expect(await miscDataSentBy(form)).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID],
      });
    });

    test("warns and links nothing when none of the alerts can be found", async () => {
      queryParams = { [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: ALERT_THREE_ID };

      const form: CapturedFormProps = await openPage();

      expect(
        screen.getByTestId("incident-create-alerts-not-found"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("incident-create-alerts-to-link"),
      ).not.toBeInTheDocument();
      expect(form.initialValues).toEqual({
        currentIncidentState: FIRST_STATE_ID,
      });
      expect(await miscDataSentBy(form)).toEqual({});
    });

    test("caps the alerts at the per-action maximum and says so", async () => {
      const ids: Array<string> = manyAlertIds(
        MAX_ALERTS_PER_INCIDENT_LINK_ACTION + 2,
      );
      fixture.alerts = ids.map((id: string, index: number): Alert => {
        const alert: Alert = new Alert();
        alert._id = id;
        alert.title = `Alert ${index}`;
        return alert;
      });
      queryParams = { [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: ids.join(",") };

      const form: CapturedFormProps = await openPage();

      expect((alertRequests()[0].query._id as Includes).values).toEqual(
        ids.slice(0, MAX_ALERTS_PER_INCIDENT_LINK_ACTION),
      );
      expect(
        screen.getByTestId("incident-create-alerts-to-link"),
      ).toHaveTextContent(
        `Only the first ${MAX_ALERTS_PER_INCIDENT_LINK_ACTION} alerts are linked`,
      );
      expect(
        (
          (await miscDataSentBy(form))[
            INCIDENT_ALERT_IDS_TO_LINK_KEY
          ] as Array<string>
        ).length,
      ).toBe(MAX_ALERTS_PER_INCIDENT_LINK_ACTION);
    });

    test("shows the error instead of a form when the alerts cannot be read", async () => {
      fixture.failAlerts = true;

      render(
        <MemoryRouter>
          <IncidentCreate
            pageRoute={new Route("/dashboard/incidents/create")}
            currentProject={new Project()}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );

      expect(
        await screen.findByText("Could not read the alerts."),
      ).toBeInTheDocument();
      expect(capturedForms).toHaveLength(0);
    });

    test("composes with a template: the template's choices stand, lists are unioned", async () => {
      const template: IncidentTemplate = new IncidentTemplate();
      template._id = TEMPLATE_ID;
      template.title = "Template title";
      template.description = "Template description";
      template.monitors = [
        makeNamed(Monitor, "m-template", "Template monitor"),
      ];
      template.labels = [makeLabel("label-template")];
      template.onCallDutyPolicies = [
        makeNamed(OnCallDutyPolicy, "policy-template", "Primary"),
      ];
      getItemMock.mockResolvedValue(template);
      queryParams = {
        incidentTemplateId: TEMPLATE_ID,
        [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: `${ALERT_ONE_ID},${ALERT_TWO_ID}`,
      };

      const form: CapturedFormProps = await openPage();

      expect(getItemMock).toHaveBeenCalledTimes(1);
      expect(form.initialValues["title"]).toBe("Template title");
      expect(form.initialValues["description"]).toBe("Template description");
      expect(form.initialValues["incidentSeverity"]).toBe(INCIDENT_CRITICAL_ID);
      expect(form.initialValues["monitors"]).toEqual([
        { _id: "m-template", name: "Template monitor" },
        { _id: "m-api", name: "API" },
        { _id: "m-db", name: "Database" },
      ]);
      expect(form.initialValues["labels"]).toEqual([
        "label-template",
        "label-shared",
        "label-api",
      ]);
      // The template's own policies only - none come from the alerts.
      expect(form.initialValues["onCallDutyPolicies"]).toEqual([
        "policy-template",
      ]);
      expect(await miscDataSentBy(form)).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
      });
    });
  });
});
