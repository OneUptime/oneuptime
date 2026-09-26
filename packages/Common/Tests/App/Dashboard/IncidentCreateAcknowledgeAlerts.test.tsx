import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Declaring an incident from alerts, and acknowledging those alerts as it is
 * declared. The create-incident page reads the project's alert states and
 * the alerts' current states, offers a box - ticked by default - to
 * acknowledge the alerts that are not acknowledged yet, and sends
 * miscDataProps[acknowledgeAlertsToLink] = true only when that box is on
 * screen, allowed and ticked. When there are alerts that will keep escalating
 * (box unticked, locked, or hidden while permissions are unknown) the banner
 * says so. It also hints when an alert is already linked to an incident.
 *
 * The real page is rendered. ModelForm is stubbed to capture the props it is
 * handed (as IncidentCreateFromAlerts.test.tsx does) - onBeforeCreate and the
 * On-Call step's getSummaryElement are closures over the page's state, so
 * they are always read from the LATEST render. ModelAPI answers per model
 * type, and permissions are mocked as BulkIncidentLinkActions.test.tsx does.
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

type CapturedField = {
  field?: Record<string, unknown> | undefined;
  stepId?: string | undefined;
  getSummaryElement?:
    | ((item: Record<string, unknown>) => React.ReactElement)
    | undefined;
};

type CapturedFormProps = {
  initialValues: Record<string, unknown>;
  onBeforeCreate?:
    | ((
        item: unknown,
        miscDataProps: Record<string, unknown>,
      ) => Promise<unknown>)
    | undefined;
  fields: Array<CapturedField>;
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
import { ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE } from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/AcknowledgeAlertsOnDeclare";
import FetchOnCallDutyPolicies from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/FetchOnCallPolicies";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import {
  INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY,
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
  INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM,
} from "../../../Types/Incident/IncidentAlertLink";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const FIRST_INCIDENT_STATE_ID: string = "55555555-5555-4555-8555-000000000001";

const CREATED_STATE_ID: string = "33333333-3333-4333-8333-000000000001";
const ACKNOWLEDGED_STATE_ID: string = "33333333-3333-4333-8333-000000000002";
const RESOLVED_STATE_ID: string = "33333333-3333-4333-8333-000000000003";

const ALERT_ONE_ID: string = "22222222-2222-4222-8222-000000000001";
const ALERT_TWO_ID: string = "22222222-2222-4222-8222-000000000002";
const ALERT_THREE_ID: string = "22222222-2222-4222-8222-000000000003";
const ALERT_FOUR_ID: string = "22222222-2222-4222-8222-000000000004";

const INCIDENT_SEVEN_ID: string = "44444444-4444-4444-8444-000000000007";
const INCIDENT_EIGHT_ID: string = "44444444-4444-4444-8444-000000000008";
const INCIDENT_NINE_ID: string = "44444444-4444-4444-8444-000000000009";

const POLICY_ID: string = "99999999-9999-4999-8999-000000000001";

const CHECKBOX_TEST_ID: string = "incident-create-acknowledge-alerts-checkbox";
const CHECKBOX_WRAPPER_TEST_ID: string = "incident-create-acknowledge-alerts";
const KEEP_ESCALATING_TEST_ID: string =
  "incident-create-alerts-keep-escalating";
const BANNER_TEST_ID: string = "incident-create-alerts-to-link";
const ALREADY_LINKED_TEST_ID: string = "incident-create-alert-already-linked";
const ALREADY_LINKED_NOTE_TEST_ID: string =
  "incident-create-alerts-already-linked-note";

const SINGULAR_DESCRIPTION: string =
  "It is acknowledged as you when the incident is declared, and its own on-call escalation stops within a minute. Pages that already went out are not recalled.";
const PLURAL_DESCRIPTION: string =
  "They are acknowledged as you when the incident is declared, and their own on-call escalation stops within a minute. Pages that already went out are not recalled.";

const TIMELINE_CREATE_REASON: string =
  "You do not have permission to acknowledge this alert. You need one of these permissions: Project Owner, Project Admin, Project Member, Alert Admin, Alert Member, Create Alert State Timeline.";
const ALERT_UPDATE_REASON: string =
  "You do not have permission to acknowledge this alert. You need one of these permissions: Project Owner, Project Admin, Project Member, Alert Admin, Alert Member, Edit Alert.";

const NO_POLICIES_TEXT: string =
  "No on-call policies will be executed when this incident is created.";

/*
 * The note under the alerts when some of them already have an incident.
 * With every alert linked there is nothing left to link, so it points at
 * that incident; with only some, the others can still be linked to it.
 */
const SINGLE_ALERT_ALREADY_LINKED_NOTE: string =
  "This alert is already linked to an incident. If it is the same problem, update that incident instead of declaring another one.";
const EVERY_ALERT_ALREADY_LINKED_NOTE: string =
  "These alerts are already linked to incidents. If it is the same problem, update that incident instead of declaring another one.";
const SOME_ALERTS_ALREADY_LINKED_NOTE: string =
  "Some of these alerts are already linked to an incident. If it is the same problem, link the other alerts to that incident from the alerts list instead of declaring another one.";

const SINGLE_ALERT_KEEPS_ESCALATING: string =
  "Declaring the incident does not acknowledge the alert: it keeps escalating until it is acknowledged.";
const EVERY_ALERT_KEEPS_ESCALATING: string =
  "Declaring the incident does not acknowledge these alerts: they keep escalating until they are acknowledged.";

type MakeAlertFunction = (
  id: string,
  alertNumber: number,
  currentAlertStateId: string | null,
) => Alert;

const makeAlert: MakeAlertFunction = (
  id: string,
  alertNumber: number,
  currentAlertStateId: string | null,
): Alert => {
  const alert: Alert = new Alert();
  alert._id = id;
  alert.title = `Alert ${alertNumber} title`;
  alert.description = `Alert ${alertNumber} description`;
  alert.alertNumber = alertNumber;
  alert.isPrivate = false;
  alert.hosts = [];
  alert.labels = [];

  if (currentAlertStateId) {
    alert.currentAlertStateId = new ObjectID(currentAlertStateId);
  }

  return alert;
};

type MakeAlertStateFunction = (data: {
  id: string;
  name: string;
  order?: number | undefined;
  isAcknowledgedState?: boolean | undefined;
  isResolvedState?: boolean | undefined;
}) => AlertState;

const makeAlertState: MakeAlertStateFunction = (data: {
  id: string;
  name: string;
  order?: number | undefined;
  isAcknowledgedState?: boolean | undefined;
  isResolvedState?: boolean | undefined;
}): AlertState => {
  const state: AlertState = new AlertState();
  state._id = data.id;
  state.name = data.name;

  if (data.order !== undefined) {
    state.order = data.order;
  }

  state.isAcknowledgedState = Boolean(data.isAcknowledgedState);
  state.isResolvedState = Boolean(data.isResolvedState);

  return state;
};

type DefaultAlertStatesFunction = () => Array<AlertState>;

// The project defaults: Created, Acknowledged, Resolved.
const defaultAlertStates: DefaultAlertStatesFunction =
  (): Array<AlertState> => {
    return [
      makeAlertState({ id: CREATED_STATE_ID, name: "Created", order: 1 }),
      makeAlertState({
        id: ACKNOWLEDGED_STATE_ID,
        name: "Acknowledged",
        order: 2,
        isAcknowledgedState: true,
      }),
      makeAlertState({
        id: RESOLVED_STATE_ID,
        name: "Resolved",
        order: 3,
        isResolvedState: true,
      }),
    ];
  };

type MakeLinkFunction = (data: {
  alertId: string;
  incidentId?: string | undefined;
  incidentNumber?: number | undefined;
  incidentNumberWithPrefix?: string | undefined;
}) => IncidentAlert;

const makeLink: MakeLinkFunction = (data: {
  alertId: string;
  incidentId?: string | undefined;
  incidentNumber?: number | undefined;
  incidentNumberWithPrefix?: string | undefined;
}): IncidentAlert => {
  const incident: Incident = new Incident();

  if (data.incidentId) {
    incident._id = data.incidentId;
  }

  if (data.incidentNumber !== undefined) {
    incident.incidentNumber = data.incidentNumber;
  }

  if (data.incidentNumberWithPrefix !== undefined) {
    incident.incidentNumberWithPrefix = data.incidentNumberWithPrefix;
  }

  const link: IncidentAlert = new IncidentAlert();
  link.alertId = new ObjectID(data.alertId);
  link.incident = incident;

  return link;
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
  alertStates: Array<AlertState>;
  links: Array<IncidentAlert>;
  failAlertStates?: boolean;
  failLinks?: boolean;
}

let fixture: ApiFixture = { alerts: [], alertStates: [], links: [] };
let queryParams: Record<string, string> = {};
let permissionsForTest: Array<Permission> = [];

type IdsInFunction = (includes: unknown) => Array<string>;

const idsIn: IdsInFunction = (includes: unknown): Array<string> => {
  return (includes as Includes).values.map((value: unknown): string => {
    return String(value);
  });
};

type AnswerListFunction = (request: any) => Promise<unknown>;

const answerList: AnswerListFunction = async (
  request: any,
): Promise<unknown> => {
  if (request.modelType === IncidentState) {
    const state: IncidentState = new IncidentState();
    state._id = FIRST_INCIDENT_STATE_ID;
    return listResult([state]);
  }

  if (request.modelType === Alert) {
    const ids: Array<string> = idsIn(request.query._id);

    return listResult(
      fixture.alerts.filter((alert: Alert): boolean => {
        return ids.includes(alert._id || "");
      }),
    );
  }

  if (request.modelType === AlertState) {
    if (fixture.failAlertStates) {
      throw new Error("Could not read the alert states.");
    }

    return listResult(fixture.alertStates);
  }

  if (request.modelType === IncidentAlert) {
    if (fixture.failLinks) {
      throw new Error("You do not have permission to read incident alerts.");
    }

    const ids: Array<string> = idsIn(request.query.alertId);

    return listResult(
      fixture.links.filter((link: IncidentAlert): boolean => {
        return ids.includes(link.alertId?.toString() || "");
      }),
    );
  }

  if (request.modelType === OnCallDutyPolicy) {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = POLICY_ID;
    policy.name = "Primary on-call";
    return listResult([policy]);
  }

  if (
    request.modelType === AlertSeverity ||
    request.modelType === IncidentSeverity
  ) {
    return listResult([]);
  }

  // The template owner lists.
  return listResult([]);
};

type RequestsForFunction = (modelType: unknown) => Array<any>;

const requestsFor: RequestsForFunction = (modelType: unknown): Array<any> => {
  return getListMock.mock.calls
    .map((call: Array<any>): any => {
      return call[0];
    })
    .filter((request: any): boolean => {
      return request.modelType === modelType;
    });
};

type DeclareFromFunction = (alertIds: Array<string>) => void;

const declareFrom: DeclareFromFunction = (alertIds: Array<string>): void => {
  queryParams = { [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: alertIds.join(",") };
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

  return latestForm();
};

type LatestFormFunction = () => CapturedFormProps;

// onBeforeCreate and getSummaryElement close over the latest render's state.
const latestForm: LatestFormFunction = (): CapturedFormProps => {
  return capturedForms[capturedForms.length - 1]!;
};

type MiscDataFunction = () => Promise<Record<string, unknown>>;

// What the form would send as miscDataProps, after the page's onBeforeCreate.
const miscDataSent: MiscDataFunction = async (): Promise<
  Record<string, unknown>
> => {
  const form: CapturedFormProps = latestForm();
  const miscDataProps: Record<string, unknown> = {};
  const item: Incident = new Incident();

  expect(form.onBeforeCreate).toBeDefined();

  const returned: unknown = await form.onBeforeCreate!(item, miscDataProps);

  expect(returned).toBe(item);

  return miscDataProps;
};

type CheckboxFunction = () => HTMLInputElement;

const acknowledgeCheckbox: CheckboxFunction = (): HTMLInputElement => {
  return screen.getByTestId(CHECKBOX_TEST_ID) as HTMLInputElement;
};

type ToggleFunction = () => Promise<void>;

/*
 * The shared Checkbox keeps its own checked state and copies `value` into it
 * from an effect, so the box only shows ticked once that effect has run.
 * Wait for it before clicking - a click before then would tick it, not
 * untick it - and for the click to land.
 */
const untick: ToggleFunction = async (): Promise<void> => {
  await waitFor(() => {
    expect(acknowledgeCheckbox()).toBeChecked();
  });

  fireEvent.click(acknowledgeCheckbox());

  await waitFor(() => {
    expect(acknowledgeCheckbox()).not.toBeChecked();
  });
};

const tick: ToggleFunction = async (): Promise<void> => {
  expect(acknowledgeCheckbox()).not.toBeChecked();

  fireEvent.click(acknowledgeCheckbox());

  await waitFor(() => {
    expect(acknowledgeCheckbox()).toBeChecked();
  });
};

type TextFunction = (element: HTMLInputElement) => string;

// The visible label beside the box.
const labelOf: TextFunction = (element: HTMLInputElement): string => {
  const label: HTMLLabelElement | null = document.querySelector(
    `label[for="${element.id}"]`,
  );

  expect(label).not.toBeNull();

  return label!.textContent || "";
};

// The description under the label, which the box points at.
const descriptionOf: TextFunction = (element: HTMLInputElement): string => {
  const describedBy: string | null = element.getAttribute("aria-describedby");

  expect(describedBy).toBeTruthy();

  return document.getElementById(describedBy!)?.textContent || "";
};

type RenderedSummary = {
  element: React.ReactElement;
  container: HTMLDivElement;
  text: string;
};

type OnCallSummaryFunction = (item: Record<string, unknown>) => RenderedSummary;

// The On-Call step's summary, from the latest render, rendered on its own.
const onCallSummary: OnCallSummaryFunction = (
  item: Record<string, unknown>,
): RenderedSummary => {
  const field: CapturedField | undefined = latestForm().fields.find(
    (candidate: CapturedField): boolean => {
      return Boolean(
        candidate.field && "onCallDutyPolicies" in candidate.field,
      );
    },
  );

  expect(field).toBeDefined();
  expect(field!.stepId).toBe("on-call");
  expect(field!.getSummaryElement).toBeDefined();

  const element: React.ReactElement = field!.getSummaryElement!(item);
  const container: HTMLDivElement = document.createElement("div");
  document.body.appendChild(container);

  render(<MemoryRouter>{element}</MemoryRouter>, { container: container });

  return {
    element: element,
    container: container,
    text: container.textContent || "",
  };
};

describe("acknowledging the alerts an incident is declared from", () => {
  beforeEach(() => {
    capturedForms = [];
    fixture = {
      alerts: [
        makeAlert(ALERT_ONE_ID, 1, CREATED_STATE_ID),
        makeAlert(ALERT_TWO_ID, 2, CREATED_STATE_ID),
        makeAlert(ALERT_THREE_ID, 3, CREATED_STATE_ID),
        makeAlert(ALERT_FOUR_ID, 4, CREATED_STATE_ID),
      ],
      alertStates: defaultAlertStates(),
      links: [],
    };
    queryParams = {};
    permissionsForTest = [Permission.ProjectMember];
    getListMock.mockReset();
    getItemMock.mockReset();
    getListMock.mockImplementation(answerList);
    PermissionGate.clearPermissionPropsCache();

    jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
      return permissionsForTest;
    });
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
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

  test("uses the shared miscDataProps key", () => {
    expect(INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY).toBe(
      "acknowledgeAlertsToLink",
    );
  });

  test("reads the alerts' current states, the project's alert states and the alerts' existing links", async () => {
    declareFrom([ALERT_ONE_ID, ALERT_TWO_ID]);

    await openPage();

    const alertRequests: Array<any> = requestsFor(Alert);
    expect(alertRequests).toHaveLength(1);
    expect(alertRequests[0].select).toEqual(
      expect.objectContaining({ _id: true, currentAlertStateId: true }),
    );

    const stateRequests: Array<any> = requestsFor(AlertState);
    expect(stateRequests).toHaveLength(1);
    expect(stateRequests[0].query).toEqual({});
    expect(stateRequests[0].select).toEqual({
      _id: true,
      order: true,
      isAcknowledgedState: true,
    });
    expect(stateRequests[0].sort).toEqual({ order: SortOrder.Ascending });
    expect(stateRequests[0].limit).toBe(LIMIT_PER_PROJECT);
    expect(stateRequests[0].skip).toBe(0);

    const linkRequests: Array<any> = requestsFor(IncidentAlert);
    expect(linkRequests).toHaveLength(1);
    expect(idsIn(linkRequests[0].query.alertId)).toEqual([
      ALERT_ONE_ID,
      ALERT_TWO_ID,
    ]);
    expect(linkRequests[0].select).toEqual({
      alertId: true,
      incident: {
        _id: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
      },
    });
    expect(linkRequests[0].sort).toEqual({ createdAt: SortOrder.Ascending });
    expect(linkRequests[0].limit).toBe(LIMIT_PER_PROJECT);
  });

  describe("offering the box", () => {
    test("offers to acknowledge one Created alert, ticked by default", async () => {
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      const banner: HTMLElement = screen.getByTestId(BANNER_TEST_ID);
      const wrapper: HTMLElement = screen.getByTestId(CHECKBOX_WRAPPER_TEST_ID);
      const checkbox: HTMLInputElement = acknowledgeCheckbox();

      expect(banner).toContainElement(wrapper);
      expect(wrapper).toContainElement(checkbox);
      await waitFor(() => {
        expect(checkbox).toBeChecked();
      });
      expect(checkbox).toBeEnabled();
      expect(checkbox).not.toHaveAttribute("title");
      expect(labelOf(checkbox)).toBe(
        "Acknowledge this alert to stop its escalation",
      );
      expect(descriptionOf(checkbox)).toBe(SINGULAR_DESCRIPTION);
      expect(
        screen.getByLabelText("Acknowledge this alert to stop its escalation"),
      ).toBe(checkbox);
      expect(
        screen.queryByTestId(KEEP_ESCALATING_TEST_ID),
      ).not.toBeInTheDocument();
    });

    test("names every alert when none is acknowledged yet", async () => {
      fixture.alerts[1] = makeAlert(ALERT_TWO_ID, 2, null);
      fixture.alerts[2] = makeAlert(
        ALERT_THREE_ID,
        3,
        "33333333-3333-4333-8333-0000000000ff",
      );
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID, ALERT_THREE_ID]);

      await openPage();

      const checkbox: HTMLInputElement = acknowledgeCheckbox();

      await waitFor(() => {
        expect(checkbox).toBeChecked();
      });
      // No state, or a state that is not one of the project's, is offered.
      expect(labelOf(checkbox)).toBe(
        "Acknowledge these 3 alerts to stop their escalation",
      );
      expect(descriptionOf(checkbox)).toBe(PLURAL_DESCRIPTION);
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [
          ALERT_ONE_ID,
          ALERT_TWO_ID,
          ALERT_THREE_ID,
        ],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      });
    });

    test("names only the alerts not acknowledged yet, and says how many are left as they are", async () => {
      fixture.alerts[1] = makeAlert(ALERT_TWO_ID, 2, ACKNOWLEDGED_STATE_ID);
      fixture.alerts[2] = makeAlert(ALERT_THREE_ID, 3, RESOLVED_STATE_ID);
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID, ALERT_THREE_ID, ALERT_FOUR_ID]);

      await openPage();

      const checkbox: HTMLInputElement = acknowledgeCheckbox();

      await waitFor(() => {
        expect(checkbox).toBeChecked();
      });
      expect(labelOf(checkbox)).toBe(
        "Acknowledge the 2 alerts that are not acknowledged yet, to stop their escalation",
      );
      expect(descriptionOf(checkbox)).toBe(
        `${PLURAL_DESCRIPTION} 2 alerts are already acknowledged or resolved and are left as they are.`,
      );
      // Every alert is linked; the server acknowledges only the ones not yet.
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [
          ALERT_ONE_ID,
          ALERT_TWO_ID,
          ALERT_THREE_ID,
          ALERT_FOUR_ID,
        ],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      });

      await untick();

      expect(screen.getByTestId(KEEP_ESCALATING_TEST_ID).textContent).toBe(
        "Declaring the incident does not acknowledge the 2 alerts that are not acknowledged yet: they keep escalating until they are acknowledged.",
      );
    });

    test("names the one alert not acknowledged yet among several", async () => {
      fixture.alerts[1] = makeAlert(ALERT_TWO_ID, 2, ACKNOWLEDGED_STATE_ID);
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID]);

      await openPage();

      const checkbox: HTMLInputElement = acknowledgeCheckbox();

      expect(labelOf(checkbox)).toBe(
        "Acknowledge the 1 alert that is not acknowledged yet, to stop its escalation",
      );
      expect(descriptionOf(checkbox)).toBe(
        `${SINGULAR_DESCRIPTION} 1 alert is already acknowledged or resolved and is left as it is.`,
      );

      await untick();

      expect(screen.getByTestId(KEEP_ESCALATING_TEST_ID).textContent).toBe(
        "Declaring the incident does not acknowledge the alert that is not acknowledged yet: it keeps escalating until it is acknowledged.",
      );
    });

    test("offers nothing, and warns of nothing, when every alert is acknowledged or resolved already", async () => {
      fixture.alerts[0] = makeAlert(ALERT_ONE_ID, 1, ACKNOWLEDGED_STATE_ID);
      fixture.alerts[1] = makeAlert(ALERT_TWO_ID, 2, RESOLVED_STATE_ID);
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID]);

      await openPage();

      expect(screen.getByTestId(BANNER_TEST_ID)).toBeInTheDocument();
      expect(
        screen.queryByTestId(CHECKBOX_WRAPPER_TEST_ID),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId(CHECKBOX_TEST_ID)).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(KEEP_ESCALATING_TEST_ID),
      ).not.toBeInTheDocument();
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
      });
    });

    test("leaves the offer out, but still declares from the alerts, when the alert states cannot be read", async () => {
      fixture.failAlertStates = true;
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID]);

      const form: CapturedFormProps = await openPage();

      expect(screen.getByTestId(BANNER_TEST_ID)).toBeInTheDocument();
      expect(
        screen.queryByTestId(CHECKBOX_WRAPPER_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(KEEP_ESCALATING_TEST_ID),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Could not read the alert states.")).toBeNull();
      // The prefill is still applied, before the form first renders.
      expect(capturedForms[0]!.initialValues).toEqual(form.initialValues);
      expect(form.initialValues).toEqual(
        expect.objectContaining({
          currentIncidentState: FIRST_INCIDENT_STATE_ID,
          title: "Alert 1 title",
          description: [
            "- Alert #1: Alert 1 title",
            "- Alert #2: Alert 2 title",
          ].join("\n"),
        }),
      );
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
      });
    });

    test("leaves the offer out when the project has no Acknowledged alert state", async () => {
      fixture.alertStates = [
        makeAlertState({ id: CREATED_STATE_ID, name: "Created", order: 1 }),
        makeAlertState({
          id: RESOLVED_STATE_ID,
          name: "Resolved",
          order: 3,
          isResolvedState: true,
        }),
      ];
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      expect(screen.getByTestId(BANNER_TEST_ID)).toBeInTheDocument();
      expect(
        screen.queryByTestId(CHECKBOX_WRAPPER_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(KEEP_ESCALATING_TEST_ID),
      ).not.toBeInTheDocument();
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID],
      });
    });

    test("leaves the offer out when the Acknowledged state has no order", async () => {
      fixture.alertStates = [
        makeAlertState({ id: CREATED_STATE_ID, name: "Created", order: 1 }),
        makeAlertState({
          id: ACKNOWLEDGED_STATE_ID,
          name: "Acknowledged",
          isAcknowledgedState: true,
        }),
      ];
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      expect(
        screen.queryByTestId(CHECKBOX_WRAPPER_TEST_ID),
      ).not.toBeInTheDocument();
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID],
      });
    });

    test("does not read alert states or links, or send the key, when not declaring from alerts", async () => {
      await openPage();

      await waitFor(() => {
        expect(latestForm().initialValues).toEqual({
          currentIncidentState: FIRST_INCIDENT_STATE_ID,
        });
      });

      expect(requestsFor(AlertState)).toHaveLength(0);
      expect(requestsFor(IncidentAlert)).toHaveLength(0);
      expect(requestsFor(Alert)).toHaveLength(0);
      expect(screen.queryByTestId(BANNER_TEST_ID)).not.toBeInTheDocument();
      expect(screen.queryByTestId(CHECKBOX_TEST_ID)).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(KEEP_ESCALATING_TEST_ID),
      ).not.toBeInTheDocument();
      expect(await miscDataSent()).toEqual({});
    });

    test("does not read alert states or links for a parameter holding no valid ids", async () => {
      queryParams = { [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: "nope,,<b>" };

      await openPage();

      expect(requestsFor(AlertState)).toHaveLength(0);
      expect(requestsFor(IncidentAlert)).toHaveLength(0);
      expect(await miscDataSent()).toEqual({});
    });
  });

  describe("sending the choice", () => {
    test("sends acknowledgeAlertsToLink with the alert ids while the box is ticked", async () => {
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID]);

      await openPage();

      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      });
    });

    test("unticking drops the key and says the alert keeps escalating; ticking again brings it back", async () => {
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      await untick();

      const note: HTMLElement = screen.getByTestId(KEEP_ESCALATING_TEST_ID);

      expect(screen.getByTestId(BANNER_TEST_ID)).toContainElement(note);
      expect(note.textContent).toBe(SINGLE_ALERT_KEEPS_ESCALATING);
      // The box stays on screen, so it can be ticked again.
      expect(acknowledgeCheckbox()).toBeEnabled();

      const unticked: Record<string, unknown> = await miscDataSent();

      expect(unticked).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID],
      });
      expect(unticked).not.toHaveProperty(
        INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY,
      );

      await tick();

      expect(
        screen.queryByTestId(KEEP_ESCALATING_TEST_ID),
      ).not.toBeInTheDocument();
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      });
    });

    test("says every alert keeps escalating when several are unticked", async () => {
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID]);

      await openPage();

      await untick();

      expect(screen.getByTestId(KEEP_ESCALATING_TEST_ID).textContent).toBe(
        EVERY_ALERT_KEEPS_ESCALATING,
      );
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
      });
    });
  });

  describe("permissions", () => {
    test.each([
      ["a viewer", [Permission.Viewer], TIMELINE_CREATE_REASON],
      ["an alert viewer", [Permission.AlertViewer], TIMELINE_CREATE_REASON],
      [
        "somebody who may edit alerts but not add state timeline rows",
        [Permission.Viewer, Permission.EditAlert],
        TIMELINE_CREATE_REASON,
      ],
      [
        "somebody who may add state timeline rows but not edit alerts",
        [Permission.Viewer, Permission.CreateAlertStateTimeline],
        ALERT_UPDATE_REASON,
      ],
    ])(
      "locks the box, unticked, for %s and never sends the key",
      async (
        _who: string,
        permissions: Array<Permission>,
        reason: string,
      ): Promise<void> => {
        permissionsForTest = permissions;
        declareFrom([ALERT_ONE_ID]);

        await openPage();

        const checkbox: HTMLInputElement = acknowledgeCheckbox();

        expect(checkbox).toBeDisabled();
        expect(checkbox).not.toBeChecked();
        expect(checkbox).toHaveAttribute("title", reason);
        expect(labelOf(checkbox)).toBe(
          "Acknowledge this alert to stop its escalation",
        );
        expect(descriptionOf(checkbox)).toContain(
          "You do not have permission to acknowledge this alert",
        );
        expect(descriptionOf(checkbox)).toBe(
          `${SINGULAR_DESCRIPTION} ${reason}`,
        );
        expect(screen.getByTestId(KEEP_ESCALATING_TEST_ID).textContent).toBe(
          SINGLE_ALERT_KEEPS_ESCALATING,
        );

        const sent: Record<string, unknown> = await miscDataSent();

        expect(sent).toEqual({
          [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID],
        });

        /*
         * A browser does not deliver a click to a disabled box, but jsdom
         * does (and flips it). Even then the permission, not the box, decides
         * what is sent.
         */
        fireEvent.click(checkbox);

        expect(await miscDataSent()).toEqual({
          [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID],
        });
        expect(screen.getByTestId(KEEP_ESCALATING_TEST_ID).textContent).toBe(
          SINGLE_ALERT_KEEPS_ESCALATING,
        );
      },
    );

    test("hides the box while the permission snapshot is empty, but still warns the alerts keep escalating", async () => {
      permissionsForTest = [];
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID]);

      await openPage();

      expect(screen.getByTestId(BANNER_TEST_ID)).toBeInTheDocument();
      expect(
        screen.queryByTestId(CHECKBOX_WRAPPER_TEST_ID),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId(KEEP_ESCALATING_TEST_ID).textContent).toBe(
        EVERY_ALERT_KEEPS_ESCALATING,
      );
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
      });
    });

    test("offers a working, ticked box to a master admin without project permissions", async () => {
      permissionsForTest = [];
      jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      const checkbox: HTMLInputElement = acknowledgeCheckbox();

      await waitFor(() => {
        expect(checkbox).toBeChecked();
      });
      expect(checkbox).toBeEnabled();
      expect(descriptionOf(checkbox)).toBe(SINGULAR_DESCRIPTION);
      expect(
        screen.queryByTestId(KEEP_ESCALATING_TEST_ID),
      ).not.toBeInTheDocument();
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      });
    });

    test("offers a working box to somebody with just the two fine-grained permissions", async () => {
      permissionsForTest = [
        Permission.Viewer,
        Permission.CreateAlertStateTimeline,
        Permission.EditAlert,
      ];
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      const checkbox: HTMLInputElement = acknowledgeCheckbox();

      await waitFor(() => {
        expect(checkbox).toBeChecked();
      });
      expect(checkbox).toBeEnabled();
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      });
    });
  });

  describe("alerts already linked to an incident", () => {
    test("names the incident an alert is already linked to, with a link to it", async () => {
      fixture.links = [
        makeLink({
          alertId: ALERT_ONE_ID,
          incidentId: INCIDENT_SEVEN_ID,
          incidentNumber: 7,
          incidentNumberWithPrefix: "INC-7",
        }),
      ];
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      const hints: Array<HTMLElement> = screen.getAllByTestId(
        ALREADY_LINKED_TEST_ID,
      );

      expect(hints).toHaveLength(1);
      expect(hints[0]!.textContent).toBe("(already linked to Incident INC-7)");
      expect(hints[0]!.closest("li")?.textContent).toBe(
        "Alert #1:Alert 1 title(already linked to Incident INC-7)",
      );

      const anchors: Array<HTMLAnchorElement> = Array.from(
        hints[0]!.querySelectorAll("a"),
      );

      expect(anchors).toHaveLength(1);
      expect(anchors[0]!.getAttribute("href")).toBe(
        `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_SEVEN_ID}`,
      );
      expect(anchors[0]!.getAttribute("target")).toBe("_blank");
      expect(anchors[0]!.textContent).toBe("Incident INC-7");

      const note: HTMLElement = screen.getByTestId(ALREADY_LINKED_NOTE_TEST_ID);

      expect(screen.getByTestId(BANNER_TEST_ID)).toContainElement(note);
      expect(note.textContent).toBe(SINGLE_ALERT_ALREADY_LINKED_NOTE);

      // A hint, never a block: the box is still offered and the key sent.
      expect(acknowledgeCheckbox()).toBeEnabled();
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      });
    });

    test("hints only on the alert that is linked, with the note for some alerts linked", async () => {
      fixture.links = [
        makeLink({
          alertId: ALERT_TWO_ID,
          incidentId: INCIDENT_SEVEN_ID,
          incidentNumberWithPrefix: "INC-7",
        }),
      ];
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID]);

      await openPage();

      const items: Array<HTMLLIElement> = Array.from(
        screen.getByTestId(BANNER_TEST_ID).querySelectorAll("li"),
      );

      expect(items).toHaveLength(2);
      expect(
        items[0]!.querySelector(`[data-testid="${ALREADY_LINKED_TEST_ID}"]`),
      ).toBeNull();
      expect(
        items[1]!.querySelector(`[data-testid="${ALREADY_LINKED_TEST_ID}"]`)
          ?.textContent,
      ).toBe("(already linked to Incident INC-7)");
      expect(screen.getByTestId(ALREADY_LINKED_NOTE_TEST_ID).textContent).toBe(
        SOME_ALERTS_ALREADY_LINKED_NOTE,
      );
    });

    test("says every alert is linked when several are, each to its own incident", async () => {
      fixture.links = [
        makeLink({
          alertId: ALERT_ONE_ID,
          incidentId: INCIDENT_SEVEN_ID,
          incidentNumberWithPrefix: "INC-7",
        }),
        makeLink({
          alertId: ALERT_TWO_ID,
          incidentId: INCIDENT_EIGHT_ID,
          incidentNumberWithPrefix: "INC-8",
        }),
      ];
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID]);

      await openPage();

      const items: Array<HTMLLIElement> = Array.from(
        screen.getByTestId(BANNER_TEST_ID).querySelectorAll("li"),
      );

      expect(
        items.map((item: HTMLLIElement): string => {
          return item.textContent || "";
        }),
      ).toEqual([
        "Alert #1:Alert 1 title(already linked to Incident INC-7)",
        "Alert #2:Alert 2 title(already linked to Incident INC-8)",
      ]);

      const notes: Array<HTMLElement> = screen.getAllByTestId(
        ALREADY_LINKED_NOTE_TEST_ID,
      );

      expect(notes).toHaveLength(1);
      expect(notes[0]!.textContent).toBe(EVERY_ALERT_ALREADY_LINKED_NOTE);

      // Still a hint, never a block.
      expect(acknowledgeCheckbox()).toBeEnabled();
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID, ALERT_TWO_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      });
    });

    test("says every alert is linked when several are linked to the same incident", async () => {
      fixture.links = [
        makeLink({
          alertId: ALERT_ONE_ID,
          incidentId: INCIDENT_SEVEN_ID,
          incidentNumberWithPrefix: "INC-7",
        }),
        makeLink({
          alertId: ALERT_TWO_ID,
          incidentId: INCIDENT_SEVEN_ID,
          incidentNumberWithPrefix: "INC-7",
        }),
        makeLink({
          alertId: ALERT_THREE_ID,
          incidentId: INCIDENT_SEVEN_ID,
          incidentNumberWithPrefix: "INC-7",
        }),
      ];
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID, ALERT_THREE_ID]);

      await openPage();

      expect(screen.getAllByTestId(ALREADY_LINKED_TEST_ID)).toHaveLength(3);
      expect(screen.getByTestId(ALREADY_LINKED_NOTE_TEST_ID).textContent).toBe(
        EVERY_ALERT_ALREADY_LINKED_NOTE,
      );
    });

    test("says only some are linked when most, but not all, of several alerts are", async () => {
      fixture.links = [
        makeLink({
          alertId: ALERT_ONE_ID,
          incidentId: INCIDENT_SEVEN_ID,
          incidentNumberWithPrefix: "INC-7",
        }),
        makeLink({
          alertId: ALERT_THREE_ID,
          incidentId: INCIDENT_EIGHT_ID,
          incidentNumberWithPrefix: "INC-8",
        }),
      ];
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID, ALERT_THREE_ID]);

      await openPage();

      const items: Array<HTMLLIElement> = Array.from(
        screen.getByTestId(BANNER_TEST_ID).querySelectorAll("li"),
      );

      expect(
        items.map((item: HTMLLIElement): string | null => {
          return (
            item.querySelector(`[data-testid="${ALREADY_LINKED_TEST_ID}"]`)
              ?.textContent || null
          );
        }),
      ).toEqual([
        "(already linked to Incident INC-7)",
        null,
        "(already linked to Incident INC-8)",
      ]);
      expect(screen.getByTestId(ALREADY_LINKED_NOTE_TEST_ID).textContent).toBe(
        SOME_ALERTS_ALREADY_LINKED_NOTE,
      );
    });

    // Such a link shows no hint, so the alert is not counted as linked either.
    test("does not count an alert whose only link has no readable incident as linked", async () => {
      fixture.links = [
        makeLink({
          alertId: ALERT_ONE_ID,
          incidentId: INCIDENT_SEVEN_ID,
          incidentNumberWithPrefix: "INC-7",
        }),
        makeLink({ alertId: ALERT_TWO_ID }),
      ];
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID]);

      await openPage();

      expect(screen.getAllByTestId(ALREADY_LINKED_TEST_ID)).toHaveLength(1);
      expect(screen.getByTestId(ALREADY_LINKED_NOTE_TEST_ID).textContent).toBe(
        SOME_ALERTS_ALREADY_LINKED_NOTE,
      );
    });

    // The note is about the alerts the banner lists, not the ids asked for.
    test("words the note for the alerts listed when a declared alert could not be read", async () => {
      fixture.links = [
        makeLink({
          alertId: ALERT_ONE_ID,
          incidentId: INCIDENT_SEVEN_ID,
          incidentNumberWithPrefix: "INC-7",
        }),
      ];
      declareFrom([ALERT_ONE_ID, "22222222-2222-4222-8222-000000000099"]);

      await openPage();

      expect(
        screen.getByTestId(BANNER_TEST_ID).querySelectorAll("li"),
      ).toHaveLength(1);
      expect(screen.getByTestId(ALREADY_LINKED_NOTE_TEST_ID).textContent).toBe(
        SINGLE_ALERT_ALREADY_LINKED_NOTE,
      );
    });

    /*
     * Leaving the create page would lose the form, so the incidents open in
     * a new tab: the click is left to the browser (target="_blank"), never
     * routed in this tab.
     */
    test("opens every linked incident in a new tab, at the incident's page, without leaving the form", async () => {
      const navigateSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation((): void => {});

      fixture.links = [
        makeLink({
          alertId: ALERT_ONE_ID,
          incidentId: INCIDENT_SEVEN_ID,
          incidentNumberWithPrefix: "INC-7",
        }),
        makeLink({
          alertId: ALERT_ONE_ID,
          incidentId: INCIDENT_EIGHT_ID,
          incidentNumber: 8,
        }),
        makeLink({
          alertId: ALERT_TWO_ID,
          incidentId: INCIDENT_NINE_ID,
        }),
      ];
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID]);

      await openPage();

      const anchors: Array<HTMLAnchorElement> = screen
        .getAllByTestId(ALREADY_LINKED_TEST_ID)
        .flatMap((hint: HTMLElement): Array<HTMLAnchorElement> => {
          return Array.from(hint.querySelectorAll("a"));
        });

      expect(
        anchors.map(
          (
            anchor: HTMLAnchorElement,
          ): { href: string | null; target: string | null; text: string } => {
            return {
              href: anchor.getAttribute("href"),
              target: anchor.getAttribute("target"),
              text: anchor.textContent || "",
            };
          },
        ),
      ).toEqual([
        {
          href: `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_SEVEN_ID}`,
          target: "_blank",
          text: "Incident INC-7",
        },
        {
          href: `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_EIGHT_ID}`,
          target: "_blank",
          text: "Incident #8",
        },
        {
          href: `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_NINE_ID}`,
          target: "_blank",
          text: "Incident",
        },
      ]);

      /*
       * Record whether the page cancelled the click once React has handled
       * it, then cancel it so JSDOM does not try to navigate.
       */
      const defaultPreventedByPage: Array<boolean> = [];
      const recordAndCancel: (event: Event) => void = (event: Event): void => {
        defaultPreventedByPage.push(event.defaultPrevented);
        event.preventDefault();
      };

      document.addEventListener("click", recordAndCancel);

      try {
        fireEvent.click(anchors[0]!);
      } finally {
        document.removeEventListener("click", recordAndCancel);
      }

      expect(defaultPreventedByPage).toEqual([false]);
      expect(navigateSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId("model-form")).toBeInTheDocument();
      expect(screen.getByTestId(BANNER_TEST_ID)).toBeInTheDocument();
    });

    test("lists every incident an alert is linked to, oldest link first, however it is numbered", async () => {
      fixture.links = [
        makeLink({
          alertId: ALERT_ONE_ID,
          incidentId: INCIDENT_SEVEN_ID,
          incidentNumber: 7,
          incidentNumberWithPrefix: "INC-7",
        }),
        makeLink({
          alertId: ALERT_ONE_ID,
          incidentId: INCIDENT_EIGHT_ID,
          incidentNumber: 8,
        }),
        makeLink({
          alertId: ALERT_ONE_ID,
          incidentId: INCIDENT_NINE_ID,
        }),
      ];
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      const hint: HTMLElement = screen.getByTestId(ALREADY_LINKED_TEST_ID);

      expect(hint.textContent).toBe(
        "(already linked to Incident INC-7, Incident #8, Incident)",
      );
      expect(
        Array.from(hint.querySelectorAll("a")).map(
          (anchor: HTMLAnchorElement): string | null => {
            return anchor.getAttribute("href");
          },
        ),
      ).toEqual([
        `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_SEVEN_ID}`,
        `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_EIGHT_ID}`,
        `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_NINE_ID}`,
      ]);
    });

    test("ignores a link whose incident could not be read", async () => {
      fixture.links = [makeLink({ alertId: ALERT_ONE_ID })];
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      expect(screen.getByTestId(BANNER_TEST_ID)).toBeInTheDocument();
      expect(
        screen.queryByTestId(ALREADY_LINKED_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(ALREADY_LINKED_NOTE_TEST_ID),
      ).not.toBeInTheDocument();
    });

    test("shows no hint when there are no links", async () => {
      declareFrom([ALERT_ONE_ID, ALERT_TWO_ID]);

      await openPage();

      expect(
        screen.queryByTestId(ALREADY_LINKED_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(ALREADY_LINKED_NOTE_TEST_ID),
      ).not.toBeInTheDocument();
    });

    test("leaves the hint out, and the page working, when the links cannot be read", async () => {
      fixture.failLinks = true;
      fixture.links = [
        makeLink({
          alertId: ALERT_ONE_ID,
          incidentId: INCIDENT_SEVEN_ID,
          incidentNumberWithPrefix: "INC-7",
        }),
      ];
      declareFrom([ALERT_ONE_ID]);

      const form: CapturedFormProps = await openPage();

      expect(requestsFor(IncidentAlert)).toHaveLength(1);
      expect(screen.getByTestId(BANNER_TEST_ID)).toBeInTheDocument();
      expect(
        screen.queryByTestId(ALREADY_LINKED_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(ALREADY_LINKED_NOTE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          "You do not have permission to read incident alerts.",
        ),
      ).toBeNull();
      expect(form.initialValues["title"]).toBe("Alert 1 title");
      expect(acknowledgeCheckbox()).toBeEnabled();
      expect(await miscDataSent()).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ONE_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      });
    });
  });

  describe("the On-Call step's summary", () => {
    test("says the alerts' own escalation stops, and what may still page, when no policy runs and the box is ticked", async () => {
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      const text: string = onCallSummary({}).text;

      expect(text).toBe(
        `${NO_POLICIES_TEXT} ${ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE}`,
      );
      expect(text).toBe(
        `${NO_POLICIES_TEXT} The alerts it is declared from are acknowledged too, so their own escalation stops. An alert episode they belong to keeps escalating until the episode is acknowledged, and an incident on-call rule, if any, may still page.`,
      );
    });

    test("treats an empty policy list as no policies", async () => {
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      const summary: RenderedSummary = onCallSummary({
        onCallDutyPolicies: [],
      });

      expect(summary.element.type).toBe("p");
      expect(summary.text).toBe(
        `${NO_POLICIES_TEXT} ${ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE}`,
      );
    });

    test("says only that no policy runs once the box is unticked", async () => {
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      await untick();

      expect(onCallSummary({}).text).toBe(NO_POLICIES_TEXT);
      expect(onCallSummary({ onCallDutyPolicies: [] }).text).toBe(
        NO_POLICIES_TEXT,
      );
    });

    test("says only that no policy runs when the box is locked", async () => {
      permissionsForTest = [Permission.Viewer];
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      expect(onCallSummary({}).text).toBe(NO_POLICIES_TEXT);
    });

    test("says only that no policy runs when every alert is acknowledged already", async () => {
      fixture.alerts[0] = makeAlert(ALERT_ONE_ID, 1, ACKNOWLEDGED_STATE_ID);
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      expect(onCallSummary({}).text).toBe(NO_POLICIES_TEXT);
    });

    test("says only that no policy runs when not declaring from alerts", async () => {
      await openPage();

      expect(onCallSummary({ onCallDutyPolicies: [] }).text).toBe(
        NO_POLICIES_TEXT,
      );
    });

    test("lists the chosen policies, without the note, when policies run", async () => {
      declareFrom([ALERT_ONE_ID]);

      await openPage();

      const summary: RenderedSummary = onCallSummary({
        onCallDutyPolicies: [POLICY_ID],
      });

      const child: React.ReactElement = (
        summary.element.props as { children: React.ReactElement }
      ).children;

      expect(summary.element.type).toBe("div");
      expect(child.type).toBe(FetchOnCallDutyPolicies);
      expect(
        (
          child.props as { onCallDutyPolicyIds: Array<ObjectID> }
        ).onCallDutyPolicyIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([POLICY_ID]);

      await waitFor(() => {
        expect(summary.container).toHaveTextContent("Primary on-call");
      });

      const policyRequests: Array<any> = requestsFor(OnCallDutyPolicy);

      expect(
        idsIn(policyRequests[policyRequests.length - 1].query._id),
      ).toEqual([POLICY_ID]);
      expect(summary.container.textContent).not.toContain(
        ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE,
      );
      expect(summary.container.textContent).not.toContain(NO_POLICIES_TEXT);
    });
  });
});
