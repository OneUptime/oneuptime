import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
import {
  ALERT_OWNERS_ADDED_SEVERAL_ALERTS,
  ALERT_OWNERS_IN_FIELD_ONE_ALERT,
  ALERT_OWNERS_IN_FIELD_SEVERAL_ALERTS,
  AlertOwnersOnDeclareMode,
  PRIVATE_INCIDENT_FROM_ALERTS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/AlertOwnersOnDeclare";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertOwnerTeam from "../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../Models/DatabaseModels/AlertOwnerUser";
import IncidentTemplateOwnerTeam from "../../../Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "../../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Permission from "../../../Types/Permission";
import { PeoplePickerKind } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import UserUtil from "../../../UI/Utils/User";
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
  INCIDENT_CARRY_OVER_ALERT_OWNERS_KEY,
  INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM,
  MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
} from "../../../Types/Incident/IncidentAlertLink";
import { INCIDENT_DECLARED_BY_HAND_KEY } from "../../../Types/Incident/IncidentDeclaredByHandStart";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
/*
 * What the API would answer if the page asked for the incident states. It
 * no longer does: an incident left without a state starts in the project's
 * starting state, which the server picks.
 */
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
  // The alerts' owner rows, and who of their people is still a member.
  ownerUsers?: Array<{ alertId: string; userId: string }>;
  ownerTeams?: Array<{ alertId: string; teamId: string }>;
  memberUserIds?: Array<string>;
  failOwners?: boolean;
  failMembers?: boolean;
  // A template's owners.
  templateOwnerUserIds?: Array<string>;
  templateOwnerTeamIds?: Array<string>;
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

  // The alerts' owners (#10867), as the declarer reads them.
  if (request.modelType === AlertOwnerUser) {
    if (fixture.failOwners) {
      throw new Error("Forbidden");
    }

    const ids: Array<string> = (request.query.alertId as Includes).values.map(
      String,
    );

    return listResult(
      (fixture.ownerUsers || [])
        .filter((row: { alertId: string }): boolean => {
          return ids.includes(row.alertId);
        })
        .map((row: { alertId: string; userId: string }): AlertOwnerUser => {
          const owner: AlertOwnerUser = new AlertOwnerUser();
          owner.alertId = new ObjectID(row.alertId);
          owner.userId = new ObjectID(row.userId);
          return owner;
        }),
    );
  }

  if (request.modelType === AlertOwnerTeam) {
    if (fixture.failOwners) {
      throw new Error("Forbidden");
    }

    const ids: Array<string> = (request.query.alertId as Includes).values.map(
      String,
    );

    return listResult(
      (fixture.ownerTeams || [])
        .filter((row: { alertId: string }): boolean => {
          return ids.includes(row.alertId);
        })
        .map((row: { alertId: string; teamId: string }): AlertOwnerTeam => {
          const owner: AlertOwnerTeam = new AlertOwnerTeam();
          owner.alertId = new ObjectID(row.alertId);
          owner.teamId = new ObjectID(row.teamId);
          return owner;
        }),
    );
  }

  // Who of the alerts' people is a member: accepted members only.
  if (request.modelType === TeamMember && request.query.hasAcceptedInvitation) {
    if (fixture.failMembers) {
      throw new Error("Forbidden");
    }

    const ids: Array<string> = (request.query.userId as Includes).values.map(
      String,
    );

    return listResult(
      (fixture.memberUserIds || [])
        .filter((userId: string): boolean => {
          return ids.includes(userId);
        })
        .map((userId: string): TeamMember => {
          const member: TeamMember = new TeamMember();
          member.userId = new ObjectID(userId);
          return member;
        }),
    );
  }

  if (request.modelType === IncidentTemplateOwnerUser) {
    return listResult(
      (fixture.templateOwnerUserIds || []).map(
        (userId: string): IncidentTemplateOwnerUser => {
          const owner: IncidentTemplateOwnerUser =
            new IncidentTemplateOwnerUser();
          owner.userId = new ObjectID(userId);
          return owner;
        },
      ),
    );
  }

  if (request.modelType === IncidentTemplateOwnerTeam) {
    return listResult(
      (fixture.templateOwnerTeamIds || []).map(
        (teamId: string): IncidentTemplateOwnerTeam => {
          const owner: IncidentTemplateOwnerTeam =
            new IncidentTemplateOwnerTeam();
          owner.teamId = new ObjectID(teamId);
          return owner;
        },
      ),
    );
  }

  // Anything else the page or a people chip looks up.
  return listResult([]);
};

type RequestsForFunction = (modelType: unknown) => Array<any>;

// Every list read of one model, in the order the page made them.
const requestsFor: RequestsForFunction = (modelType: unknown): Array<any> => {
  return getListMock.mock.calls
    .map((call: Array<any>): any => {
      return call[0];
    })
    .filter((request: any): boolean => {
      return request.modelType === modelType;
    });
};

type IncidentStateRequestsFunction = () => Array<any>;

const incidentStateRequests: IncidentStateRequestsFunction = (): Array<any> => {
  return getListMock.mock.calls
    .map((call: Array<any>): any => {
      return call[0];
    })
    .filter((request: any): boolean => {
      return request.modelType === IncidentState;
    });
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

  /*
   * Every declaration is sent as declared by hand (#11137): pinned here, and
   * left out of what each test compares.
   */
  expect(miscDataProps[INCIDENT_DECLARED_BY_HAND_KEY]).toBe(true);
  delete miscDataProps[INCIDENT_DECLARED_BY_HAND_KEY];

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

  /*
   * #7606: Notify Status Page Subscribers starts as the project says -
   * declared from alerts too, with or without a template. The alerts and
   * the template fill in the incident; they never decide whether its
   * status page subscribers are told.
   */
  describe("the Notify Status Page Subscribers box", () => {
    type NotifyFieldFunction = (
      form: CapturedFormProps,
    ) => Record<string, unknown>;

    const notifyField: NotifyFieldFunction = (
      form: CapturedFormProps,
    ): Record<string, unknown> => {
      const field: Record<string, unknown> | undefined = form.fields.find(
        (candidate: Record<string, unknown>): boolean => {
          return (
            Object.keys(
              (candidate["field"] as Record<string, unknown>) || {},
            )[0] === "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"
          );
        },
      );

      expect(field).toBeDefined();
      return field!;
    };

    const answerWithProject: (
      setting: boolean | undefined,
      template: IncidentTemplate | null,
    ) => void = (
      setting: boolean | undefined,
      template: IncidentTemplate | null,
    ): void => {
      getItemMock.mockImplementation((async (request: {
        modelType: unknown;
      }): Promise<unknown> => {
        if (request.modelType === Project) {
          const project: Project = new Project();
          project._id = PROJECT_ID;

          if (setting !== undefined) {
            project.notifyStatusPageSubscribersOfNewIncidentsByDefault =
              setting;
          }

          return project;
        }

        if (request.modelType === IncidentTemplate) {
          return template;
        }

        return null;
      }) as never);
    };

    test.each([
      [false, false],
      [true, true],
      [undefined, true],
    ])(
      "declared from alerts in a project whose setting is %s, it starts ticked: %s",
      async (setting: boolean | undefined, isTicked: boolean) => {
        answerWithProject(setting, null);
        queryParams = {
          [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: `${ALERT_ONE_ID},${ALERT_TWO_ID}`,
        };

        const form: CapturedFormProps = await openPage();

        expect(notifyField(form)["defaultValue"]).toBe(isTicked);
        // The alerts fill in nothing about it.
        expect(
          form.initialValues[
            "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"
          ],
        ).toBeUndefined();
      },
    );

    test("declared from alerts and a template, it still starts as the project says", async () => {
      const template: IncidentTemplate = new IncidentTemplate();
      template._id = TEMPLATE_ID;
      template.title = "Template title";
      answerWithProject(false, template);
      queryParams = {
        incidentTemplateId: TEMPLATE_ID,
        [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: `${ALERT_ONE_ID}`,
      };

      const form: CapturedFormProps = await openPage();

      expect(form.initialValues["title"]).toBe("Template title");
      expect(notifyField(form)["defaultValue"]).toBe(false);
    });

    test("a project that cannot be read starts it ticked, and the alerts are still linked", async () => {
      getItemMock.mockImplementation((async (request: {
        modelType: unknown;
      }): Promise<unknown> => {
        if (request.modelType === Project) {
          throw new Error("Network error");
        }

        return null;
      }) as never);
      queryParams = {
        [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: `${ALERT_ONE_ID}`,
      };

      const form: CapturedFormProps = await openPage();

      expect(notifyField(form)["defaultValue"]).toBe(true);
      expect(form.initialValues["title"]).toBeDefined();
    });
  });

  test("reads the shared query parameter name", () => {
    expect(INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM).toBe("alertIds");
    expect(INCIDENT_ALERT_IDS_TO_LINK_KEY).toBe("alertIdsToLink");
  });

  describe("without alert ids", () => {
    test("renders the form straight away, reads no alerts and shows no banner", async () => {
      const form: CapturedFormProps = await openPage();

      /*
       * Nothing from alerts, and no state either: an incident declared
       * without one starts in the project's starting state, which the
       * server picks. Initial State waits, empty, under Advanced.
       */
      expect(capturedForms[0]!.initialValues).toEqual({});
      expect(alertRequests()).toHaveLength(0);
      expect(
        screen.queryByTestId("incident-create-alerts-to-link"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("incident-create-alerts-not-found"),
      ).not.toBeInTheDocument();

      // Nothing arrives later either: the page never asks for a state.
      await act(async () => {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      });
      expect(capturedForms[capturedForms.length - 1]!.initialValues).toEqual(
        {},
      );
      expect(incidentStateRequests()).toEqual([]);

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
          // With the archive switch: an archived label is not carried over.
          labels: { _id: true, isArchived: true },
        }),
      );
    });

    /*
     * Nobody can pick an archived label for a new incident
     * (Common/Utils/ArchivableValues), and the server would refuse the
     * incident for one: an alert's archived label stays on the alert.
     */
    test("leaves an alert's archived label on the alert: the incident takes the others", async () => {
      const archived: Label = makeLabel("label-retired");
      archived.isArchived = true;

      const live: Label = makeLabel("label-api");
      live.isArchived = false;

      fixture.alerts[0]!.labels = [makeLabel("label-shared"), archived, live];
      fixture.alerts[1]!.labels = [archived];

      await openPage();

      for (const form of capturedForms) {
        expect(form.initialValues["labels"]).toEqual([
          "label-shared",
          "label-api",
        ]);
      }
    });

    test("prefills the form from the alerts before it first renders", async () => {
      await openPage();

      const expected: Record<string, unknown> = {
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

    /*
     * Alert two is private, so the incident is prefilled private - visible
     * only to its owners and admins. The banner says so before the user
     * declares it, and that it only holds while the switch stays on; who
     * owns it is the owners' line (#10867), below.
     */
    test("says the incident starts private, and who will own it, when an alert is private", async () => {
      await openPage();

      const banner: HTMLElement = screen.getByTestId(
        "incident-create-alerts-to-link",
      );
      const note: HTMLElement = screen.getByTestId(
        "incident-create-private-from-alerts",
      );

      expect(banner).toContainElement(note);
      expect(note).toHaveTextContent(PRIVATE_INCIDENT_FROM_ALERTS);
      expect(note).toHaveTextContent(
        "At least one of these alerts is private, so Private Incident starts switched on. While it stays on, only the incident's owners, Project Owners and Project Admins can see it.",
      );
    });

    test("says nothing about privacy when no alert is private", async () => {
      queryParams = { [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: ALERT_ONE_ID };

      await openPage();

      expect(
        screen.getByTestId("incident-create-alerts-to-link"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("incident-create-private-from-alerts"),
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
      // Nothing to prefill, and no state: the server picks the starting one.
      expect(form.initialValues).toEqual({});
      expect(incidentStateRequests()).toEqual([]);
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

      /*
       * The template is read once. (The project is read too, for how its
       * Notify Status Page Subscribers box starts: #7606.)
       */
      expect(
        getItemMock.mock.calls.filter((call: Array<unknown>): boolean => {
          return (
            (call[0] as { modelType: unknown }).modelType === IncidentTemplate
          );
        }),
      ).toHaveLength(1);
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

/*
 * #10867: declaring an incident from alerts starts with the alerts' owners.
 * The Owners field (under More fields) holds them when the declarer may add
 * owners, the banner names them, and the declaration tells the server not
 * to add them again (carryOverAlertOwners false) - so an owner taken out
 * stays out. A declarer who may not add owners gets them added by the
 * server instead, and the banner says so; so does one who could not read
 * them. An owner who left the project is never carried over.
 */
describe("the alerts' owners", () => {
  const ALICE: string = "a1111111-1111-4111-8111-000000000001";
  const BOB: string = "a1111111-1111-4111-8111-000000000002";
  const CAROL_WHO_LEFT: string = "a1111111-1111-4111-8111-000000000003";
  const PLATFORM: string = "b1111111-1111-4111-8111-000000000001";
  const DATABASE: string = "b1111111-1111-4111-8111-000000000002";
  const UNREAD_ALERT_ID: string = "22222222-2222-4222-8222-0000000000ff";

  let permissionsForTest: Array<Permission> = [];

  beforeEach(() => {
    capturedForms = [];
    fixture = {
      alerts: makeAlerts(),
      ownerUsers: [
        { alertId: ALERT_ONE_ID, userId: ALICE },
        { alertId: ALERT_TWO_ID, userId: BOB },
        { alertId: ALERT_TWO_ID, userId: ALICE },
        { alertId: ALERT_TWO_ID, userId: CAROL_WHO_LEFT },
      ],
      ownerTeams: [{ alertId: ALERT_TWO_ID, teamId: PLATFORM }],
      memberUserIds: [ALICE, BOB],
    };
    queryParams = {
      [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: `${ALERT_ONE_ID},${ALERT_TWO_ID}`,
    };
    getListMock.mockReset();
    getItemMock.mockReset();
    getListMock.mockImplementation(answerList);

    permissionsForTest = [Permission.ProjectMember];
    PermissionGate.clearPermissionPropsCache();

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    jest
      .spyOn(Navigation, "getQueryStringByName")
      .mockImplementation((name: string): string | null => {
        return queryParams[name] ?? null;
      });
    jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
      return permissionsForTest;
    });
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  type OwnersBannerFunction = () => HTMLElement;

  const ownersBanner: OwnersBannerFunction = (): HTMLElement => {
    return screen.getByTestId("incident-create-alert-owners");
  };

  test("reads the owners of exactly the alerts asked for, as the declarer", async () => {
    await openPage();

    for (const modelType of [AlertOwnerUser, AlertOwnerTeam]) {
      const requests: Array<any> = requestsFor(modelType);

      expect(requests).toHaveLength(1);
      expect((requests[0].query.alertId as Includes).values).toEqual([
        ALERT_ONE_ID,
        ALERT_TWO_ID,
      ]);
    }

    /*
     * Who is still a member, of the people who own the alerts (the chips
     * look the people up by name apart from this).
     */
    const members: Array<any> = requestsFor(TeamMember).filter(
      (request: any): boolean => {
        return request.query.hasAcceptedInvitation === true;
      },
    );

    expect(members).toHaveLength(1);
    expect(members[0].query.hasAcceptedInvitation).toBe(true);
    expect(
      (members[0].query.userId as Includes).values.map(String).sort(),
    ).toEqual([ALICE, BOB, CAROL_WHO_LEFT].sort());
  });

  test("the Owners field starts with every owner of the alerts, each once, from the first render", async () => {
    const form: CapturedFormProps = await openPage();

    // Every render: the form latches its initial values on the first one.
    for (const captured of capturedForms) {
      expect(captured.initialValues["ownerUsers"]).toEqual([ALICE, BOB]);
      expect(captured.initialValues["ownerTeams"]).toEqual([PLATFORM]);
    }

    expect(form.initialValues["ownerUsers"]).not.toContain(CAROL_WHO_LEFT);
  });

  test("the banner names them plainly and says where to change them", async () => {
    await openPage();

    const banner: HTMLElement = ownersBanner();

    expect(
      screen.getByTestId("incident-create-alerts-to-link"),
    ).toContainElement(banner);
    expect(banner).toHaveAttribute(
      "data-mode",
      AlertOwnersOnDeclareMode.InOwnersField,
    );
    expect(banner).toHaveTextContent(ALERT_OWNERS_IN_FIELD_SEVERAL_ALERTS);

    const chips: Array<HTMLElement> = Array.from(
      screen
        .getByTestId("incident-create-alert-owners-list")
        .querySelectorAll('[data-testid="people-chip"]'),
    );

    expect(
      chips.map((chip: HTMLElement): string => {
        return `${chip.getAttribute("data-kind")}:${chip.getAttribute("data-id")}`;
      }),
    ).toEqual([
      `${PeoplePickerKind.User}:${ALICE}`,
      `${PeoplePickerKind.User}:${BOB}`,
      `${PeoplePickerKind.Team}:${PLATFORM}`,
    ]);
  });

  test("one alert's banner speaks of that alert", async () => {
    queryParams = { [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: ALERT_ONE_ID };

    await openPage();

    expect(ownersBanner()).toHaveTextContent(ALERT_OWNERS_IN_FIELD_ONE_ALERT);
  });

  test("the declaration tells the server the Owners field holds them, so one taken out stays out", async () => {
    const form: CapturedFormProps = await openPage();

    expect(await miscDataSentBy(form)).toEqual({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
      [INCIDENT_CARRY_OVER_ALERT_OWNERS_KEY]: false,
    });
  });

  test("a team owner alone is carried over", async () => {
    fixture.ownerUsers = [];
    fixture.ownerTeams = [
      { alertId: ALERT_ONE_ID, teamId: DATABASE },
      { alertId: ALERT_TWO_ID, teamId: PLATFORM },
    ];

    const form: CapturedFormProps = await openPage();

    expect(form.initialValues["ownerTeams"]).toEqual([DATABASE, PLATFORM]);
    expect(form.initialValues).not.toHaveProperty("ownerUsers");
    // Nobody to check membership of.
    expect(
      requestsFor(TeamMember).filter((request: any): boolean => {
        return request.query.hasAcceptedInvitation === true;
      }),
    ).toHaveLength(0);
  });

  test("an owner who left the project is not carried over, nor named", async () => {
    fixture.ownerUsers = [{ alertId: ALERT_ONE_ID, userId: CAROL_WHO_LEFT }];
    fixture.ownerTeams = [];

    const form: CapturedFormProps = await openPage();

    // Nobody left to carry over: nothing is said, nothing is sent.
    expect(form.initialValues).not.toHaveProperty("ownerUsers");
    expect(
      screen.queryByTestId("incident-create-alert-owners"),
    ).not.toBeInTheDocument();
    expect(await miscDataSentBy(form)).toEqual({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
    });
  });

  test("alerts with no owners: the Owners field starts empty and nothing is said", async () => {
    fixture.ownerUsers = [];
    fixture.ownerTeams = [];

    const form: CapturedFormProps = await openPage();

    expect(form.initialValues).not.toHaveProperty("ownerUsers");
    expect(form.initialValues).not.toHaveProperty("ownerTeams");
    expect(
      screen.queryByTestId("incident-create-alert-owners"),
    ).not.toBeInTheDocument();
    expect(await miscDataSentBy(form)).toEqual({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
    });
  });

  test("an alert that could not be read lends the incident none of its owners", async () => {
    queryParams = {
      [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: `${ALERT_ONE_ID},${UNREAD_ALERT_ID}`,
    };
    fixture.ownerUsers = [
      { alertId: ALERT_ONE_ID, userId: ALICE },
      { alertId: UNREAD_ALERT_ID, userId: BOB },
    ];
    fixture.ownerTeams = [{ alertId: UNREAD_ALERT_ID, teamId: PLATFORM }];

    const form: CapturedFormProps = await openPage();

    expect(form.initialValues["ownerUsers"]).toEqual([ALICE]);
    expect(form.initialValues).not.toHaveProperty("ownerTeams");
  });

  test("composes with a template: its owners keep their place, the alerts' are added after", async () => {
    const template: IncidentTemplate = new IncidentTemplate();
    template._id = TEMPLATE_ID;
    template.title = "Template title";
    getItemMock.mockResolvedValue(template);
    fixture.templateOwnerUserIds = [BOB];
    fixture.templateOwnerTeamIds = [DATABASE];
    queryParams = {
      incidentTemplateId: TEMPLATE_ID,
      [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: `${ALERT_ONE_ID},${ALERT_TWO_ID}`,
    };

    const form: CapturedFormProps = await openPage();

    expect(form.initialValues["ownerUsers"]).toEqual([BOB, ALICE]);
    expect(form.initialValues["ownerTeams"]).toEqual([DATABASE, PLATFORM]);
  });

  test("a declarer who may not add owners gets them added by the server, said on the banner, not put in the field", async () => {
    // Declares incidents and links alerts, but adds no incident owners.
    permissionsForTest = [
      Permission.CreateProjectIncident,
      Permission.CreateIncidentAlert,
      Permission.ReadAlert,
    ];

    const form: CapturedFormProps = await openPage();

    expect(form.initialValues).not.toHaveProperty("ownerUsers");
    expect(form.initialValues).not.toHaveProperty("ownerTeams");

    const banner: HTMLElement = ownersBanner();

    expect(banner).toHaveAttribute(
      "data-mode",
      AlertOwnersOnDeclareMode.AddedOnDeclare,
    );
    expect(banner).toHaveTextContent(ALERT_OWNERS_ADDED_SEVERAL_ALERTS);
    // Still named: the declarer reads who will own it.
    expect(
      screen.getByTestId("incident-create-alert-owners-list"),
    ).toBeInTheDocument();

    // The server's default carries them over: nothing is sent to stop it.
    expect(await miscDataSentBy(form)).toEqual({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
    });
  });

  test("a declarer who may add people but not teams gets the server to add them all", async () => {
    permissionsForTest = [
      Permission.CreateProjectIncident,
      Permission.CreateIncidentAlert,
      Permission.CreateIncidentOwnerUser,
    ];

    const form: CapturedFormProps = await openPage();

    expect(form.initialValues).not.toHaveProperty("ownerUsers");
    expect(ownersBanner()).toHaveAttribute(
      "data-mode",
      AlertOwnersOnDeclareMode.AddedOnDeclare,
    );
    expect(await miscDataSentBy(form)).not.toHaveProperty(
      INCIDENT_CARRY_OVER_ALERT_OWNERS_KEY,
    );
  });

  test("who owns the alerts could not be read: the server adds them all the same, and the banner says so without names", async () => {
    fixture.failOwners = true;

    const form: CapturedFormProps = await openPage();

    expect(form.initialValues).not.toHaveProperty("ownerUsers");

    const banner: HTMLElement = ownersBanner();

    expect(banner).toHaveAttribute(
      "data-mode",
      AlertOwnersOnDeclareMode.AddedOnDeclare,
    );
    expect(banner).toHaveTextContent(ALERT_OWNERS_ADDED_SEVERAL_ALERTS);
    expect(
      screen.queryByTestId("incident-create-alert-owners-list"),
    ).not.toBeInTheDocument();
    expect(await miscDataSentBy(form)).toEqual({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
    });
  });

  test("who is a member could not be read: the owners are carried over as read, for the server to judge", async () => {
    fixture.failMembers = true;

    const form: CapturedFormProps = await openPage();

    expect(form.initialValues["ownerUsers"]).toEqual([
      ALICE,
      BOB,
      CAROL_WHO_LEFT,
    ]);
  });

  test("a private alert's banner no longer says the owners are added once declared: the owners line says who", async () => {
    await openPage();

    expect(
      screen.getByTestId("incident-create-private-from-alerts"),
    ).toHaveTextContent(PRIVATE_INCIDENT_FROM_ALERTS);
    expect(
      screen.getByTestId("incident-create-private-from-alerts"),
    ).not.toHaveTextContent("added as its owners");
  });

  test("declaring from no alerts reads no alert owners", async () => {
    queryParams = {};

    await openPage();

    expect(requestsFor(AlertOwnerUser)).toHaveLength(0);
    expect(requestsFor(AlertOwnerTeam)).toHaveLength(0);
    expect(
      screen.queryByTestId("incident-create-alert-owners"),
    ).not.toBeInTheDocument();
  });
});
