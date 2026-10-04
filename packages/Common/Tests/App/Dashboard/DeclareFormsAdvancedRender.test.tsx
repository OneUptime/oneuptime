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
 * Declare Incident and Create Alert, drawn for real: the pages' own fields
 * in the real ModelForm and BasicForm, with only the network, the
 * permissions and the page's location stubbed.
 *
 * What the maintainer asked for, as it appears on screen: "show people as
 * few options as possible (and hide those other 'advanced' options), and
 * have sane defaults."
 *
 *   - Declare Incident opens on Title, Incident Severity and Description;
 *     Declared At, Initial State, Labels and Private Incident wait, folded,
 *     under Advanced - which says nothing until something in it is set, and
 *     "Configured" when a template or a private alert set something;
 *   - three steps and the review, not six;
 *   - Declare Incident is on the review, the last step, only: the steps
 *     before it offer a plain Next, and nothing primary;
 *   - declared without opening Advanced, the incident is sent no state (the
 *     server starts it in the project's starting state) and the moment the
 *     page opened as Declared At;
 *   - the review step leaves out the folded options nobody touched;
 *   - Create Alert opens on Title, Alert Severity and Description, with
 *     Initial State, Labels and Private Alert under Advanced, and asks for no
 *     root cause or remediation notes.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CRITICAL_ID: string = "22222222-2222-4222-8222-000000000001";
const MINOR_ID: string = "22222222-2222-4222-8222-000000000002";
const TEMPLATE_ID: string = "33333333-3333-4333-8333-000000000001";
const LABEL_ID: string = "44444444-4444-4444-8444-000000000001";
const CREATED_ID: string = "55555555-5555-4555-8555-000000000001";

// The moment the page opens, as OneUptimeDate tells it.
const OPENED_AT: Date = new Date("2026-10-03T09:30:00.000Z");

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

let queryParams: Record<string, string> = {};

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

// The "Will notify" audience: not what these tests are about.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: async (): Promise<never> => {
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
import AlertCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Create";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Label from "../../../Models/DatabaseModels/Label";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

interface ListRequest {
  modelType: { new (): BaseModel };
  query?: Record<string, unknown>;
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

// Severities to pick from, a label for a template to carry; nothing else.
async function answerList(request: ListRequest): Promise<unknown> {
  if (request.modelType === IncidentSeverity) {
    return listOf([
      named(IncidentSeverity, CRITICAL_ID, "Critical Incident", 1),
      named(IncidentSeverity, MINOR_ID, "Minor Incident", 2),
    ]);
  }

  if (request.modelType === AlertSeverity) {
    return listOf([
      named(AlertSeverity, CRITICAL_ID, "Critical Alert", 1),
      named(AlertSeverity, MINOR_ID, "Minor Alert", 2),
    ]);
  }

  if (request.modelType === Label) {
    return listOf([named(Label, LABEL_ID, "Payments", 1)]);
  }

  return listOf([]);
}

function requestsFor(modelType: unknown): Array<ListRequest> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): ListRequest => {
      return call[0] as ListRequest;
    })
    .filter((request: ListRequest): boolean => {
      return request.modelType === modelType;
    });
}

async function renderPage(
  Page: React.FunctionComponent<PageComponentProps>,
  route: string,
): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <Page
          pageRoute={new Route(route)}
          currentProject={new Project()}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  return userEvent.setup({ delay: null });
}

function advancedHeader(): HTMLElement {
  return screen.getByRole("button", { name: "Advanced" });
}

// The badge sits beside the title in the header's heading row.
function advancedBadge(): HTMLElement | null {
  const heading: HTMLElement | null = advancedHeader().querySelector(
    "[data-testid='collapsible-section-heading']",
  );

  return heading ? within(heading).queryByText("Configured") : null;
}

// The step list, as the form's progress navigation reads it.
async function stepTitles(): Promise<Array<string>> {
  const progress: HTMLElement = await screen.findByRole("navigation", {
    name: "Progress",
  });

  return within(progress)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
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

function sentModel(): Incident {
  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: Incident }).model;
}

beforeEach(() => {
  queryParams = {};
  getListMock.mockReset().mockImplementation(answerList as never);
  getItemMock.mockReset();
  createMock.mockReset().mockResolvedValue({ data: {} } as never);
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    data.model._id = CREATED_ID;
    return Promise.resolve({ data: data.model });
  }) as never);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(OPENED_AT);
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

describe("Declare Incident", () => {
  test("opens on Title, Incident Severity and Description, with the rest folded under Advanced", async () => {
    await renderPage(IncidentCreate, "/dashboard/incidents/create");

    expect(await screen.findByText("Title")).toBeVisible();
    expect(screen.getByText("Incident Severity")).toBeVisible();
    expect(screen.getByText("Description")).toBeVisible();

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(advancedBadge()).toBeNull();

    for (const folded of [
      "Declared At",
      "Initial State",
      "Labels",
      "Private Incident",
    ]) {
      expect(screen.getByText(folded)).not.toBeVisible();
    }
  });

  test("walks three steps and the review, not six", async () => {
    await renderPage(IncidentCreate, "/dashboard/incidents/create");

    expect(await stepTitles()).toEqual([
      "Incident Details",
      "Resources Affected",
      "On-Call & Roles",
      "Summary",
    ]);
  });

  test("Advanced opens on the four options, and Declared At starts at the moment the page opened", async () => {
    const user: UserEvent = await renderPage(
      IncidentCreate,
      "/dashboard/incidents/create",
    );

    await screen.findByText("Title");
    await user.click(advancedHeader());

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");

    for (const folded of [
      "Declared At",
      "Initial State",
      "Labels",
      "Private Incident",
    ]) {
      expect(screen.getByText(folded)).toBeVisible();
    }

    expect(
      screen.getByText(
        "Leave empty for the usual starting state. Pick a later state to record an incident that is already acknowledged or resolved.",
      ),
    ).toBeVisible();

    // The time it started with, and nothing set: folding it says nothing.
    await user.click(advancedHeader());
    expect(advancedBadge()).toBeNull();
  });

  test("the first step offers a plain Next, and Declare Incident is on the review, the last step, only", async () => {
    const user: UserEvent = await renderPage(
      IncidentCreate,
      "/dashboard/incidents/create",
    );

    await user.type(
      await screen.findByRole("textbox", { name: /^Title/ }),
      "Checkout is down",
    );
    await pickOption(
      user,
      screen.getByRole("combobox", { name: /^Incident Severity/ }),
      "Critical Incident",
    );

    // Every step after this one is optional, and still: Next, not Declare.
    for (let step: number = 0; step < 3; step++) {
      expect(
        screen.queryByRole("button", { name: "Declare Incident" }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "Next", exact: true }).className,
      ).not.toContain("bg-indigo-600");

      await user.click(
        screen.getByRole("button", { name: "Next", exact: true }),
      );
    }

    const declare: HTMLElement = await screen.findByRole("button", {
      name: "Declare Incident",
    });

    expect(declare.className).toContain("bg-indigo-600");
    expect(
      screen.queryByRole("button", { name: "Next", exact: true }),
    ).toBeNull();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("declared without opening Advanced, it is sent no state and the moment the page opened", async () => {
    const user: UserEvent = await renderPage(
      IncidentCreate,
      "/dashboard/incidents/create",
    );

    await user.type(
      await screen.findByRole("textbox", { name: /^Title/ }),
      "Checkout is down",
    );
    await pickOption(
      user,
      screen.getByRole("combobox", { name: /^Incident Severity/ }),
      "Critical Incident",
    );

    // Walk to the review, the last step, where Declare Incident is.
    for (let step: number = 0; step < 3; step++) {
      await user.click(
        screen.getByRole("button", { name: "Next", exact: true }),
      );
    }

    await user.click(
      await screen.findByRole("button", { name: "Declare Incident" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const incident: Incident = sentModel();

    expect(incident.title).toBe("Checkout is down");
    expect(incident.incidentSeverity?._id?.toString()).toBe(CRITICAL_ID);
    // No state: the server starts the incident in the project's starting state.
    expect(incident.currentIncidentState).toBeUndefined();
    expect(incident.currentIncidentStateId).toBeUndefined();
    // The moment the page opened, not a time read later.
    expect(new Date(incident.declaredAt as Date).getTime()).toBe(
      OPENED_AT.getTime(),
    );
    // Subscribers are told, as the box starts ticked.
    expect(
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBe(true);

    // And the page never asked which state comes first.
    expect(
      getListMock.mock.calls.some((call: Array<unknown>): boolean => {
        const request: ListRequest = call[0] as ListRequest;
        return (
          (request.modelType as unknown as { name?: string }).name ===
            "IncidentState" && (call[0] as { limit?: number }).limit === 1
        );
      }),
    ).toBe(false);
  });

  test("declaring from a template that sets labels: Advanced says Configured, folded", async () => {
    queryParams = { incidentTemplateId: TEMPLATE_ID };

    const template: IncidentTemplate = new IncidentTemplate();
    template._id = TEMPLATE_ID;
    template.title = "Payments are failing";
    template.incidentSeverityId = new ObjectID(CRITICAL_ID);
    template.labels = [named(Label, LABEL_ID, "Payments", 1)];
    getItemMock.mockResolvedValue(template as never);

    await renderPage(
      IncidentCreate,
      `/dashboard/incidents/create?incidentTemplateId=${TEMPLATE_ID}`,
    );

    await screen.findByDisplayValue("Payments are failing");

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(advancedBadge()).toBeInTheDocument();
  });

  test("the review step leaves out the folded options nobody touched", async () => {
    const user: UserEvent = await renderPage(
      IncidentCreate,
      "/dashboard/incidents/create",
    );

    await user.type(
      await screen.findByRole("textbox", { name: /^Title/ }),
      "Checkout is down",
    );
    await pickOption(
      user,
      screen.getByRole("combobox", { name: /^Incident Severity/ }),
      "Critical Incident",
    );

    // Walk to the review with the plain Next, which never declares.
    for (let step: number = 0; step < 3; step++) {
      await user.click(
        screen.getByRole("button", { name: "Next", exact: true }),
      );
    }

    const review: HTMLElement = (
      await screen.findByRole("heading", { name: "Incident Details" })
    ).parentElement as HTMLElement;

    expect(within(review).getByText("Checkout is down")).toBeInTheDocument();

    for (const untouched of [
      "Declared At",
      "Initial State",
      "Labels",
      "Private Incident",
    ]) {
      expect(screen.queryByText(untouched)).toBeNull();
    }

    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});

describe("Create Alert", () => {
  test("opens on Title, Alert Severity and Description, with the rest folded under Advanced", async () => {
    await renderPage(AlertCreate, "/dashboard/alerts/create");

    expect(await screen.findByText("Title")).toBeVisible();
    expect(screen.getByText("Alert Severity")).toBeVisible();
    expect(screen.getByText("Description")).toBeVisible();

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(advancedBadge()).toBeNull();

    for (const folded of ["Initial State", "Labels", "Private Alert"]) {
      expect(screen.getByText(folded)).not.toBeVisible();
    }

    // Written on the alert's own pages, once there is something to say.
    expect(screen.queryByText("Root Cause")).toBeNull();
    expect(screen.queryByText("Remediation Notes")).toBeNull();
  });

  test("walks two steps and the review, and looks no state up", async () => {
    await renderPage(AlertCreate, "/dashboard/alerts/create");

    expect(await stepTitles()).toEqual([
      "Alert Details",
      "Resources & On-Call",
      "Summary",
    ]);

    // Only the dropdowns' own lists: none of them asks for one state.
    for (const request of getListMock.mock.calls) {
      expect((request[0] as { limit?: number }).limit).not.toBe(1);
    }
    expect(requestsFor(AlertSeverity)).toHaveLength(1);
  });
});
