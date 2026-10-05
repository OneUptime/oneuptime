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
 * Create Alert, Create Alert Episode and Create Incident Episode, drawn for
 * real: the pages' own fields in the real ModelForm, with only the network,
 * the permissions and the page's location stubbed.
 *
 * Each offers an Initial State under More fields - "Leave empty for the
 * usual starting state. Pick a later state to record an alert that is
 * already acknowledged or resolved." - and the server now starts the record
 * in the state picked (AlertService, AlertEpisodeService,
 * IncidentEpisodeService). What the page has to do for that, pinned here:
 *
 *   - the state picked is sent with the create, as the relation the server
 *     reads (`currentAlertState: { _id }`);
 *   - the review step names the state picked;
 *   - left empty, no state is sent at all, so the server starts the record
 *     in the project's created state - and the page never looks up which
 *     state comes first itself.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SEVERITY_ID: string = "22222222-2222-4222-8222-000000000001";
const IDENTIFIED_ID: string = "33333333-3333-4333-8333-000000000001";
const ACKNOWLEDGED_ID: string = "33333333-3333-4333-8333-000000000002";
const RESOLVED_ID: string = "33333333-3333-4333-8333-000000000003";
const CREATED_RECORD_ID: string = "55555555-5555-4555-8555-000000000001";

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

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

// Requests these tests are not about wait forever.
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

import AlertCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Create";
import AlertEpisodeCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeCreate";
import IncidentEpisodeCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeCreate";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Navigation from "../../../UI/Utils/Navigation";
import { listedNames } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

interface ListRequest {
  modelType: { new (): BaseModel };
  query?: Record<string, unknown>;
  limit?: number;
}

interface ItemRequest {
  modelType: { new (): BaseModel };
  id: { toString: () => string };
}

const STATE_NAMES: Record<string, string> = {
  [IDENTIFIED_ID]: "Identified",
  [ACKNOWLEDGED_ID]: "Acknowledged",
  [RESOLVED_ID]: "Resolved",
};

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
  (model as unknown as Record<string, unknown>)["color"] = undefined;
  return model;
}

function listOf(data: Array<BaseModel>): unknown {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

function statesOf(modelType: { new (): BaseModel }): Array<BaseModel> {
  return [IDENTIFIED_ID, ACKNOWLEDGED_ID, RESOLVED_ID].map(
    (id: string, index: number): BaseModel => {
      return named(modelType, id, STATE_NAMES[id]!, index + 1);
    },
  );
}

// Severities and states to pick from; nothing else.
async function answerList(request: ListRequest): Promise<unknown> {
  if (request.modelType === AlertSeverity) {
    return listOf([named(AlertSeverity, SEVERITY_ID, "Critical", 1)]);
  }

  if (request.modelType === IncidentSeverity) {
    return listOf([named(IncidentSeverity, SEVERITY_ID, "Critical", 1)]);
  }

  if (request.modelType === AlertState || request.modelType === IncidentState) {
    return listOf(statesOf(request.modelType));
  }

  return listOf([]);
}

// The review step's lookup of the state picked.
async function answerItem(request: ItemRequest): Promise<unknown> {
  const id: string = request.id.toString();

  if (
    (request.modelType === AlertState ||
      request.modelType === IncidentState) &&
    STATE_NAMES[id]
  ) {
    return named(request.modelType, id, STATE_NAMES[id]!, 1);
  }

  return null;
}

interface CreateForm {
  name: string;
  Page: React.FunctionComponent<PageComponentProps>;
  route: string;
  modelType: { new (): BaseModel };
  severityLabel: RegExp;
  stateRelation: string;
  stateIdColumn: string;
  // The fields More fields folds, as its header lists them.
  folded: Array<string>;
  // The steps, review included.
  steps: Array<string>;
  // The first step's heading on the review.
  reviewHeading: string;
  submit: string;
  // The explanation under the Initial State field.
  stateHelp: string;
}

const FORMS: Array<CreateForm> = [
  {
    name: "Create Alert",
    Page: AlertCreate,
    route: "/dashboard/alerts/create",
    modelType: Alert,
    severityLabel: /^Alert Severity/,
    stateRelation: "currentAlertState",
    stateIdColumn: "currentAlertStateId",
    folded: ["Initial State", "Labels", "Private Alert"],
    steps: ["Alert Details", "Resources & On-Call", "Summary"],
    reviewHeading: "Alert Details",
    submit: "Create Alert",
    stateHelp:
      "Leave empty for the usual starting state. Pick a later state to record an alert that is already acknowledged or resolved.",
  },
  {
    name: "Create Alert Episode",
    Page: AlertEpisodeCreate,
    route: "/dashboard/alerts/episodes/create",
    modelType: AlertEpisode,
    severityLabel: /^Alert Severity/,
    stateRelation: "currentAlertState",
    stateIdColumn: "currentAlertStateId",
    folded: ["Initial State", "Labels"],
    steps: ["Episode Details", "On-Call & Owners", "Summary"],
    reviewHeading: "Episode Details",
    submit: "Create Episode",
    stateHelp:
      "Leave empty for the usual starting state. Pick a later state to record an episode that is already acknowledged or resolved.",
  },
  {
    name: "Create Incident Episode",
    Page: IncidentEpisodeCreate,
    route: "/dashboard/incidents/episodes/create",
    modelType: IncidentEpisode,
    severityLabel: /^Incident Severity/,
    stateRelation: "currentIncidentState",
    stateIdColumn: "currentIncidentStateId",
    folded: ["Initial State", "Labels"],
    steps: ["Episode Details", "On-Call & Roles", "Summary"],
    reviewHeading: "Episode Details",
    submit: "Create Episode",
    stateHelp:
      "Leave empty for the usual starting state. Pick a later state to record an episode that is already acknowledged or resolved.",
  },
];

async function renderPage(form: CreateForm): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <form.Page
          pageRoute={new Route(form.route)}
          currentProject={new Project()}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  return userEvent.setup({ delay: null });
}

function moreFields(): HTMLElement {
  return screen.getByRole("button", { name: "More fields" });
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

async function fillTheRequiredFields(
  user: UserEvent,
  form: CreateForm,
): Promise<void> {
  await user.type(
    await screen.findByRole("textbox", { name: /^Title/ }),
    "Checkout is failing",
  );
  await pickOption(
    user,
    screen.getByRole("combobox", { name: form.severityLabel }),
    "Critical",
  );
}

async function pickInitialState(
  user: UserEvent,
  stateName: string,
): Promise<void> {
  await user.click(moreFields());
  await pickOption(
    user,
    await screen.findByRole("combobox", { name: /^Initial State/ }),
    stateName,
  );
}

// Walk the plain Next buttons to the review, where the form's action is.
async function walkToReview(user: UserEvent, form: CreateForm): Promise<void> {
  for (let step: number = 0; step < form.steps.length - 1; step++) {
    await user.click(screen.getByRole("button", { name: "Next", exact: true }));
  }

  await screen.findByRole("button", { name: form.submit });
}

async function submit(user: UserEvent, form: CreateForm): Promise<BaseModel> {
  await user.click(screen.getByRole("button", { name: form.submit }));

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  return (createOrUpdateMock.mock.calls[0]![0] as { model: BaseModel }).model;
}

function valueOf(model: BaseModel, column: string): unknown {
  return (model as unknown as Record<string, unknown>)[column];
}

function idOf(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  const relation: { _id?: unknown } = value as { _id?: unknown };
  return String(relation._id ?? value);
}

beforeEach(() => {
  getListMock.mockReset().mockImplementation(answerList as never);
  getItemMock.mockReset().mockImplementation(answerItem as never);
  createMock.mockReset().mockResolvedValue({ data: {} } as never);
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    data.model._id = CREATED_RECORD_ID;
    return Promise.resolve({ data: data.model });
  }) as never);

  jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue(null);
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(FORMS)("$name: the Initial State", (form: CreateForm) => {
  test("waits under More fields, with the help that says what it does", async () => {
    const user: UserEvent = await renderPage(form);

    await screen.findByRole("textbox", { name: /^Title/ });
    expect(listedNames(moreFields())).toEqual(form.folded);

    await user.click(moreFields());

    expect(
      await screen.findByRole("combobox", { name: /^Initial State/ }),
    ).toBeVisible();
    expect(screen.getByText(form.stateHelp)).toBeVisible();
  });

  test("offers the project's states, asked for in their order", async () => {
    const user: UserEvent = await renderPage(form);

    await screen.findByRole("textbox", { name: /^Title/ });
    await user.click(moreFields());
    await user.click(
      await screen.findByRole("combobox", { name: /^Initial State/ }),
    );

    const options: Array<string> = (await screen.findAllByRole("option")).map(
      (option: HTMLElement): string => {
        return (option.textContent || "").trim();
      },
    );

    expect(options).toEqual(["Identified", "Acknowledged", "Resolved"]);

    const stateRequests: Array<Record<string, unknown>> = getListMock.mock.calls
      .map((call: Array<unknown>): Record<string, unknown> => {
        return call[0] as Record<string, unknown>;
      })
      .filter((request: Record<string, unknown>): boolean => {
        return (
          request["modelType"] === AlertState ||
          request["modelType"] === IncidentState
        );
      });

    expect(stateRequests.length).toBeGreaterThan(0);
    for (const request of stateRequests) {
      expect(request["sort"]).toEqual({ order: SortOrder.Ascending });
    }
  });

  test("a state picked is sent with the create, as the relation the server starts the record in", async () => {
    const user: UserEvent = await renderPage(form);

    await fillTheRequiredFields(user, form);
    await pickInitialState(user, "Acknowledged");
    await walkToReview(user, form);

    const model: BaseModel = await submit(user, form);

    expect(idOf(valueOf(model, form.stateRelation))).toBe(ACKNOWLEDGED_ID);
    // One name only: nothing beside it for the two to disagree on.
    expect(valueOf(model, form.stateIdColumn)).toBeUndefined();
  });

  test("a resolved state picked is sent the same way", async () => {
    const user: UserEvent = await renderPage(form);

    await fillTheRequiredFields(user, form);
    await pickInitialState(user, "Resolved");
    await walkToReview(user, form);

    const model: BaseModel = await submit(user, form);

    expect(idOf(valueOf(model, form.stateRelation))).toBe(RESOLVED_ID);
  });

  test("the review step names the state picked", async () => {
    const user: UserEvent = await renderPage(form);

    await fillTheRequiredFields(user, form);
    await pickInitialState(user, "Resolved");
    await walkToReview(user, form);

    const review: HTMLElement = (
      await screen.findByRole("heading", { name: form.reviewHeading })
    ).parentElement as HTMLElement;

    expect(within(review).getByText("Initial State")).toBeInTheDocument();
    expect(await within(review).findByText("Resolved")).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("left empty, no state is sent - the server starts the record in the project's created state", async () => {
    const user: UserEvent = await renderPage(form);

    await fillTheRequiredFields(user, form);
    await walkToReview(user, form);

    // Untouched, More fields' options stay off the review.
    expect(screen.queryByText("Initial State")).toBeNull();

    const model: BaseModel = await submit(user, form);

    expect(valueOf(model, form.stateRelation)).toBeUndefined();
    expect(valueOf(model, form.stateIdColumn)).toBeUndefined();

    // And the page never asked which state comes first.
    expect(
      getListMock.mock.calls.some((call: Array<unknown>): boolean => {
        const request: ListRequest = call[0] as ListRequest;
        return (
          (request.modelType === AlertState ||
            request.modelType === IncidentState) &&
          request.limit === 1
        );
      }),
    ).toBe(false);
  });
});
