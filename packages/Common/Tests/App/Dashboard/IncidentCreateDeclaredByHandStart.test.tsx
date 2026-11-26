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
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Declare Incident, drawn for real, in a project that starts incidents
 * declared by hand acknowledged and in one that does not (#11137,
 * IncidentDeclaredByHandStartCopy). Only the network, the permissions and
 * the page's location are stubbed.
 *
 *   - the project's switch is read as the page opens, for its one column;
 *   - every declaration is sent as declared by hand, and Initial State is
 *     never prefilled: the server decides where it starts;
 *   - with the switch off, nothing reads differently: Initial State's help
 *     is as it always was, and the review leaves the folded field out;
 *   - with it on, Initial State's help says leaving it empty starts the
 *     incident acknowledged unless a policy pages; a note under On-Call
 *     Policy says so while none is picked; and the review always lists
 *     Initial State, saying the incident starts acknowledged and pages no
 *     one - or, once a policy is picked, that it starts where incidents
 *     usually start, so the policy pages;
 *   - declared from a template that names a state - even an archived one,
 *     which the form does not prefill - the switch has no say, and the
 *     page says nothing about it.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CRITICAL_ID: string = "22222222-2222-4222-8222-000000000001";
const TEMPLATE_ID: string = "33333333-3333-4333-8333-000000000001";
const POLICY_ID: string = "44444444-4444-4444-8444-000000000001";
const ARCHIVED_STATE_ID: string = "55555555-5555-4555-8555-000000000009";
const CREATED_ID: string = "66666666-6666-4666-8666-000000000001";

const HELP_AS_ALWAYS: string =
  "Leave empty for the usual starting state. Pick a later state to record an incident that is already acknowledged or resolved. No one is paged for it.";
const HELP_STARTS_ACKNOWLEDGED: string =
  "Leave empty to start it acknowledged, as you are on it, unless you pick an on-call policy to page. Pick a state to start it there instead.";
const NOTE_UNDER_POLICIES: string =
  "With none picked, the incident starts acknowledged, as you are on it, and pages no one.";
const REVIEW_ACKNOWLEDGED: string =
  "Acknowledged, as you are on it: the incident pages no one.";
const REVIEW_POLICIES_PAGE: string =
  "The usual starting state, so the on-call policies you picked are paged.";

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

let queryParams: Record<string, string> = {};
let isSwitchOn: boolean | undefined = undefined;
let template: unknown = null;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

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
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
      },
    },
  };
});

// The "Will notify" audience and the owner rules: not what these tests are about.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: async (): Promise<never> => {
        return new Promise<never>(() => {});
      },
      get: async (): Promise<never> => {
        return new Promise<never>(() => {});
      },
      getFriendlyMessage: (): string => {
        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: { new (id: string): unknown } = (
          jest.requireActual("../../../Types/ObjectID") as {
            default: { new (id: string): unknown };
          }
        ).default;
        return new ObjectIDClass(PROJECT_ID);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import IncidentCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import { INCIDENT_DECLARED_BY_HAND_KEY } from "../../../Types/Incident/IncidentDeclaredByHandStart";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

interface ItemRequest {
  modelType: { new (): BaseModel };
  id: ObjectID;
  select?: Record<string, unknown>;
}

interface ListRequest {
  modelType: { new (): BaseModel };
}

function named<T extends BaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
  order: number,
): T {
  const model: T = new modelType();
  model._id = id;
  (model as unknown as Record<string, unknown>)["name"] = name;
  (model as unknown as Record<string, unknown>)["order"] = order;
  return model;
}

function listOf(data: Array<BaseModel>): unknown {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

async function answerList(request: ListRequest): Promise<unknown> {
  if (request.modelType === IncidentSeverity) {
    return listOf([named(IncidentSeverity, CRITICAL_ID, "Critical", 1)]);
  }

  if (request.modelType === OnCallDutyPolicy) {
    return listOf([named(OnCallDutyPolicy, POLICY_ID, "Primary on-call", 1)]);
  }

  return listOf([]);
}

async function answerItem(request: ItemRequest): Promise<unknown> {
  if (request.modelType === Project) {
    const project: Project = new Project();
    project._id = PROJECT_ID;

    if (isSwitchOn !== undefined) {
      project.startIncidentsDeclaredByHandAcknowledged = isSwitchOn;
    }

    return project;
  }

  if (request.modelType === IncidentTemplate) {
    return template;
  }

  return null;
}

// The reads of the project's switch, as the page asked for them.
function switchReads(): Array<ItemRequest> {
  return getItemMock.mock.calls
    .map((call: Array<unknown>): ItemRequest => {
      return call[0] as ItemRequest;
    })
    .filter((request: ItemRequest): boolean => {
      return (
        request.modelType === Project &&
        request.select?.["startIncidentsDeclaredByHandAcknowledged"] === true
      );
    });
}

async function renderPage(route: string): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <IncidentCreate
          pageRoute={new Route(route)}
          currentProject={new Project()}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  return userEvent.setup({ delay: null });
}

// react-select opens on a click; its options are portalled to the body.
async function pickOption(
  user: UserEvent,
  combobox: HTMLElement,
  optionText: string,
): Promise<void> {
  await user.click(combobox);
  const options: Array<HTMLElement> = await screen.findAllByText(optionText, {
    exact: true,
  });
  await user.click(options[options.length - 1]!);
}

async function fillDetails(user: UserEvent): Promise<void> {
  const title: HTMLElement = await screen.findByRole("textbox", {
    name: /^Title/,
  });

  if (!(title as HTMLInputElement).value) {
    await user.type(title, "Checkout is down");
  }

  await pickOption(
    user,
    screen.getByRole("combobox", { name: /^Incident Severity/ }),
    "Critical",
  );
}

async function next(user: UserEvent, times: number): Promise<void> {
  for (let step: number = 0; step < times; step++) {
    await user.click(screen.getByRole("button", { name: "Next", exact: true }));
  }
}

function moreFields(): HTMLElement {
  return screen.getByRole("button", { name: "More fields" });
}

// The review's row for a field, by its title: what it says is inside it.
function reviewRow(title: string): HTMLElement | null {
  return (
    screen
      .queryAllByTestId("detail-field")
      .find((field: HTMLElement): boolean => {
        return within(field).queryByText(title, { exact: true }) !== null;
      }) || null
  );
}

interface Sent {
  incident: Incident;
  miscDataProps: Record<string, unknown>;
}

function sent(): Sent {
  const call: { model: Incident; miscDataProps: Record<string, unknown> } =
    createOrUpdateMock.mock.calls[0]![0] as never;
  return { incident: call.model, miscDataProps: call.miscDataProps };
}

beforeEach(() => {
  queryParams = {};
  isSwitchOn = undefined;
  template = null;
  getListMock.mockReset().mockImplementation(answerList as never);
  getItemMock.mockReset().mockImplementation(answerItem as never);
  createMock.mockReset().mockResolvedValue({ data: {} } as never);
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    data.model._id = CREATED_ID;
    return Promise.resolve({ data: data.model });
  }) as never);

  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string | null => {
      return queryParams[name] || null;
    });
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the page reads the switch", () => {
  test("once, as it opens, with the selected project's other declare default - one read", async () => {
    await renderPage("/dashboard/incidents/create");
    await screen.findByRole("textbox", { name: /^Title/ });

    expect(switchReads()).toHaveLength(1);
    expect(switchReads()[0]!.id.toString()).toBe(PROJECT_ID);
    expect(switchReads()[0]!.select).toEqual({
      _id: true,
      notifyStatusPageSubscribersOfNewIncidentsByDefault: true,
      startIncidentsDeclaredByHandAcknowledged: true,
    });
    // And the project is read for nothing else.
    expect(
      getItemMock.mock.calls.filter((call: Array<unknown>): boolean => {
        return (call[0] as ItemRequest).modelType === Project;
      }),
    ).toHaveLength(1);
  });
});

describe("in a project that starts incidents where they always started", () => {
  beforeEach(() => {
    isSwitchOn = false;
  });

  test("Initial State says what it always said, and nothing is said under On-Call Policy", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");
    await fillDetails(user);

    await user.click(moreFields());
    expect(screen.getByText(HELP_AS_ALWAYS)).toBeInTheDocument();
    expect(screen.queryByText(HELP_STARTS_ACKNOWLEDGED)).toBeNull();

    await next(user, 2);
    await screen.findByRole("combobox", { name: /^On-Call Policy/ });
    expect(screen.queryByText(NOTE_UNDER_POLICIES)).toBeNull();
  });

  test("the review leaves the folded Initial State out, and the declaration is sent as declared by hand, with no state", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");
    await fillDetails(user);
    await next(user, 3);

    await screen.findByRole("button", { name: "Declare Incident" });
    expect(reviewRow("Initial State")).toBeNull();
    expect(screen.queryByText(REVIEW_ACKNOWLEDGED)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Declare Incident" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sent().miscDataProps[INCIDENT_DECLARED_BY_HAND_KEY]).toBe(true);
    expect(sent().incident.currentIncidentState).toBeUndefined();
    expect(sent().incident.currentIncidentStateId).toBeUndefined();
  });
});

describe("in a project that starts incidents declared by hand acknowledged", () => {
  beforeEach(() => {
    isSwitchOn = true;
  });

  test("Initial State says leaving it empty starts the incident acknowledged, and is not filled in", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");
    await screen.findByRole("textbox", { name: /^Title/ });

    // Nothing in the fold is set: Initial State is left for the server.
    await user.click(moreFields());
    expect(screen.getByText(HELP_STARTS_ACKNOWLEDGED)).toBeInTheDocument();
    expect(screen.queryByText(HELP_AS_ALWAYS)).toBeNull();
    expect(
      screen.getByRole("combobox", { name: /^Initial State/ }),
    ).toHaveValue("");
  });

  test("under On-Call Policy, while none is picked, a note says the incident starts acknowledged - and goes once one is", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");
    await fillDetails(user);
    await next(user, 2);

    const policies: HTMLElement = await screen.findByRole("combobox", {
      name: /^On-Call Policy/,
    });
    const note: HTMLElement = screen.getByText(NOTE_UNDER_POLICIES);
    expect(note).toHaveAttribute("role", "note");

    await pickOption(user, policies, "Primary on-call");

    await waitFor(() => {
      expect(screen.queryByText(NOTE_UNDER_POLICIES)).toBeNull();
    });
  });

  test("the review always lists Initial State: acknowledged, paging no one - and the declaration leaves the state to the server", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");
    await fillDetails(user);
    await next(user, 3);

    await screen.findByRole("button", { name: "Declare Incident" });
    const row: HTMLElement | null = reviewRow("Initial State");
    expect(row).not.toBeNull();
    expect(within(row!).getByText(REVIEW_ACKNOWLEDGED)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Declare Incident" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sent().miscDataProps[INCIDENT_DECLARED_BY_HAND_KEY]).toBe(true);
    // Never prefilled: the server places it, with the policies it pages.
    expect(sent().incident.currentIncidentState).toBeUndefined();
    expect(sent().incident.currentIncidentStateId).toBeUndefined();
  });

  test("with a policy picked, the review says the incident starts where incidents usually start, so the policy pages", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");
    await fillDetails(user);
    await next(user, 2);

    await pickOption(
      user,
      await screen.findByRole("combobox", { name: /^On-Call Policy/ }),
      "Primary on-call",
    );
    await next(user, 1);

    await screen.findByRole("button", { name: "Declare Incident" });
    const row: HTMLElement | null = reviewRow("Initial State");
    expect(row).not.toBeNull();
    expect(within(row!).getByText(REVIEW_POLICIES_PAGE)).toBeInTheDocument();
    expect(screen.queryByText(REVIEW_ACKNOWLEDGED)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Declare Incident" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (sent().incident.onCallDutyPolicies || []).map(
        (policy: OnCallDutyPolicy): string => {
          return policy._id?.toString() || "";
        },
      ),
    ).toEqual([POLICY_ID]);
    expect(sent().miscDataProps[INCIDENT_DECLARED_BY_HAND_KEY]).toBe(true);
  });

  test("declared from a template that names a state - an archived one, not prefilled - the switch has no say, and the page says nothing of it", async () => {
    queryParams = { incidentTemplateId: TEMPLATE_ID };

    const incidentTemplate: IncidentTemplate = new IncidentTemplate();
    incidentTemplate._id = TEMPLATE_ID;
    incidentTemplate.title = "Payments are failing";
    incidentTemplate.incidentSeverityId = new ObjectID(CRITICAL_ID);
    incidentTemplate.initialIncidentStateId = new ObjectID(ARCHIVED_STATE_ID);
    const archived: IncidentState = new IncidentState();
    archived._id = ARCHIVED_STATE_ID;
    archived.isArchived = true;
    incidentTemplate.initialIncidentState = archived;
    template = incidentTemplate;

    const user: UserEvent = await renderPage(
      `/dashboard/incidents/create?incidentTemplateId=${TEMPLATE_ID}`,
    );
    // The template fills in the title and the severity.
    await screen.findByDisplayValue("Payments are failing");
    await next(user, 2);

    await screen.findByRole("combobox", { name: /^On-Call Policy/ });
    expect(screen.queryByText(NOTE_UNDER_POLICIES)).toBeNull();

    await next(user, 1);
    await screen.findByRole("button", { name: "Declare Incident" });
    expect(screen.queryByText(REVIEW_ACKNOWLEDGED)).toBeNull();
    expect(screen.queryByText(REVIEW_POLICIES_PAGE)).toBeNull();
    const row: HTMLElement | null = reviewRow("Initial State");
    expect(row).not.toBeNull();
    expect(
      within(row!).getByText("The usual starting state."),
    ).toBeInTheDocument();
  });
});
