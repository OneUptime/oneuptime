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
 * Declare New Incident's "Notify Status Page Subscribers" box starts as the
 * project says (#7606): ticked unless Incidents -> Settings -> Subscriber
 * Notifications turned "Notify status page subscribers by default" off.
 *
 * The page is drawn for real - its own fields in the real ModelForm and
 * BasicForm - with only the network, the permissions and the page's location
 * stubbed, and every test declares the incident and reads what was sent:
 *
 *   - a project that kept the switch on (or holds no value, or cannot be
 *     read) starts the box ticked and declares a notifying incident, as
 *     every project always did;
 *   - a project that turned it off starts the box unticked, says so under
 *     it and on the review, and declares a quiet incident - unless the
 *     person declaring ticks it, which the folded More fields header then
 *     shows as set, or presses "Change to Yes" beside the review's "No";
 *   - "Change to Yes" is offered only there: not where the project starts
 *     the box ticked (whoever unticked it saw it), not once it is ticked,
 *     and not for a private incident, which no status page shows;
 *   - unticking it in a project that kept it on still declares a quiet
 *     incident, and declaring from a template follows the project too;
 *   - the form waits for the project before it draws, since it latches
 *     where its boxes start, and reads only the one column.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CRITICAL_ID: string = "22222222-2222-4222-8222-000000000001";
const TEMPLATE_ID: string = "33333333-3333-4333-8333-000000000001";
const CREATED_ID: string = "55555555-5555-4555-8555-000000000001";

const COLUMN: string = "notifyStatusPageSubscribersOfNewIncidentsByDefault";
const NOTIFY: string = "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated";

const QUESTION: string =
  "Should status page subscribers be notified when this incident is created?";
const UNTICKED_BY_DEFAULT: string = "Unticked by default in this project.";

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

let queryParams: Record<string, string> = {};
let selectedProjectId: string | null = PROJECT_ID;

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
      create: async (): Promise<unknown> => {
        return { data: {} };
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
        if (!selectedProjectId) {
          return null;
        }

        const ObjectIDClass: { new (id: string): unknown } = (
          jest.requireActual("../../../Types/ObjectID") as {
            default: { new (id: string): unknown };
          }
        ).default;
        return new ObjectIDClass(selectedProjectId);
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
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import { setChips } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

interface ListRequest {
  modelType: { new (): BaseModel };
}

interface ItemRequest {
  modelType: { new (): BaseModel };
  id: ObjectID;
  select?: Record<string, unknown>;
}

// What the project read answers: a value, a failure, or a read that waits.
let projectAnswer: () => Promise<Project | null> = async () => {
  return null;
};

let template: IncidentTemplate | null = null;

function projectHolding(value: boolean | undefined): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID;

  if (value !== undefined) {
    (project as unknown as Record<string, unknown>)[COLUMN] = value;
  }

  return project;
}

function startingWith(value: boolean | undefined): void {
  projectAnswer = async (): Promise<Project | null> => {
    return projectHolding(value);
  };
}

function listOf(data: Array<BaseModel>): unknown {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

async function answerList(request: ListRequest): Promise<unknown> {
  if (request.modelType === IncidentSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = CRITICAL_ID;
    severity.name = "Critical Incident";
    severity.order = 1;
    return listOf([severity]);
  }

  return listOf([]);
}

async function answerItem(request: ItemRequest): Promise<unknown> {
  if (request.modelType === Project) {
    return await projectAnswer();
  }

  if (request.modelType === IncidentTemplate) {
    return template;
  }

  return null;
}

function projectReads(): Array<ItemRequest> {
  return getItemMock.mock.calls
    .map((call: Array<unknown>): ItemRequest => {
      return call[0] as ItemRequest;
    })
    .filter((request: ItemRequest): boolean => {
      return request.modelType === Project;
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

/*
 * Fills in what the first step cannot be left without - what a template
 * did not fill in already (its severity is then picked, and drawn as the
 * pick rather than as a search box).
 */
async function fillDetails(user: UserEvent): Promise<void> {
  const title: HTMLElement = await screen.findByRole("textbox", {
    name: /^Title/,
  });

  if (!(title as HTMLInputElement).value) {
    await user.type(title, "Checkout is down");
  }

  const severityPicker: HTMLElement | null = screen.queryByRole("combobox", {
    name: /^Incident Severity/,
  });

  if (severityPicker) {
    await pickOption(user, severityPicker, "Critical Incident");
  }
}

async function next(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Next", exact: true }));
}

// From the first step to Resources Affected, where the box is.
async function toResourcesAffected(user: UserEvent): Promise<void> {
  await fillDetails(user);
  await next(user);
  await screen.findByRole("combobox", { name: /^Monitors/ });
}

// Opens the step's More fields and returns the box.
async function openNotifyBox(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: "More fields" }));

  return await screen.findByRole("checkbox", {
    name: /Notify Status Page Subscribers/,
  });
}

// From Resources Affected on to the review, the last step.
async function toReviewFromResources(user: UserEvent): Promise<void> {
  for (let step: number = 0; step < 2; step++) {
    await next(user);
  }

  await screen.findByRole("button", { name: "Declare Incident" });
}

async function toReview(user: UserEvent): Promise<void> {
  await fillDetails(user);

  for (let step: number = 0; step < 3; step++) {
    await next(user);
  }

  await screen.findByRole("button", { name: "Declare Incident" });
}

function changeToYes(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Change to Yes" });
}

// Ticks Private Incident, under the first step's More fields.
async function makePrivate(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: "More fields" }));
  await user.click(
    await screen.findByRole("checkbox", { name: /^Private Incident/ }),
  );
}

// The review's Notify Status Page Subscribers row.
function reviewRow(): HTMLElement {
  const value: HTMLElement = screen.getByTestId(
    "incident-create-notify-subscribers-value",
  );
  let row: HTMLElement | null = value.parentElement;

  while (row && !within(row).queryByText("Notify Status Page Subscribers")) {
    row = row.parentElement;
  }

  expect(row).not.toBeNull();
  return row!;
}

async function declare(user: UserEvent): Promise<Incident> {
  await user.click(screen.getByRole("button", { name: "Declare Incident" }));

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: Incident }).model;
}

beforeEach(() => {
  queryParams = {};
  selectedProjectId = PROJECT_ID;
  template = null;
  startingWith(true);
  getListMock.mockReset().mockImplementation(answerList as never);
  getItemMock.mockReset().mockImplementation(answerItem as never);
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

describe("a project that kept Notify status page subscribers by default on", () => {
  test("starts the box ticked, asks its question as always, and declares a notifying incident", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toResourcesAffected(user);

    const box: HTMLElement = await openNotifyBox(user);

    expect(box).toBeChecked();
    expect(screen.getByText(QUESTION, { exact: false })).toBeInTheDocument();
    expect(
      screen.queryByText(UNTICKED_BY_DEFAULT, { exact: false }),
    ).toBeNull();

    await toReviewFromResources(user);

    expect(
      screen.getByTestId("incident-create-notify-subscribers-value"),
    ).toHaveAttribute("data-boolean-value", "yes");
    expect(reviewRow()).not.toHaveTextContent(UNTICKED_BY_DEFAULT);

    const incident: Incident = await declare(user);

    expect((incident as unknown as Record<string, unknown>)[NOTIFY]).toBe(true);
  });

  test("whoever declares can still untick it: the incident is declared quiet", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toResourcesAffected(user);

    const box: HTMLElement = await openNotifyBox(user);
    await user.click(box);
    expect(box).not.toBeChecked();

    await toReviewFromResources(user);

    expect(
      screen.getByTestId("incident-create-notify-subscribers-value"),
    ).toHaveAttribute("data-boolean-value", "no");

    const incident: Incident = await declare(user);

    expect((incident as unknown as Record<string, unknown>)[NOTIFY]).toBe(
      false,
    );
  });

  test("unticked against the project's default, the folded header shows it as set", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toResourcesAffected(user);

    const box: HTMLElement = await openNotifyBox(user);
    await user.click(box);

    // Folded again: the header says what was moved away from its default.
    await user.click(screen.getByRole("button", { name: "More fields" }));

    const chips: Array<string> = setChips(
      screen.getByRole("button", { name: "More fields" }),
    );

    expect(
      chips.some((chip: string): boolean => {
        return chip.startsWith("Notify Status Page Subscribers");
      }),
    ).toBe(true);
  });
});

describe("a project that turned Notify status page subscribers by default off", () => {
  beforeEach(() => {
    startingWith(false);
  });

  test("starts the box unticked, and says so under it", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toResourcesAffected(user);

    const box: HTMLElement = await openNotifyBox(user);

    expect(box).not.toBeChecked();
    expect(
      screen.getByText(`${QUESTION} ${UNTICKED_BY_DEFAULT}`),
    ).toBeInTheDocument();
  });

  test("folded, its header does not list the box as set: unticked is where it starts", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toResourcesAffected(user);

    const chips: Array<string> = setChips(
      screen.getByRole("button", { name: "More fields" }),
    );

    expect(
      chips.some((chip: string): boolean => {
        return chip.startsWith("Notify Status Page Subscribers");
      }),
    ).toBe(false);
  });

  test("the review says No, with why, and offers no preview of a message nobody will get", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toReview(user);

    expect(
      screen.getByTestId("incident-create-notify-subscribers-value"),
    ).toHaveAttribute("data-boolean-value", "no");
    expect(reviewRow()).toHaveTextContent(UNTICKED_BY_DEFAULT);
    expect(
      screen.queryByTestId("incident-create-preview-notification"),
    ).toBeNull();
  });

  test("declared as it stands, the incident tells no subscriber", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toReview(user);

    const incident: Incident = await declare(user);

    expect((incident as unknown as Record<string, unknown>)[NOTIFY]).toBe(
      false,
    );
  });

  test("whoever declares can tick it: the folded header shows it, the review says Yes, and subscribers are told", async () => {
    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toResourcesAffected(user);

    const box: HTMLElement = await openNotifyBox(user);
    await user.click(box);
    expect(box).toBeChecked();

    await user.click(screen.getByRole("button", { name: "More fields" }));

    expect(
      setChips(screen.getByRole("button", { name: "More fields" })).some(
        (chip: string): boolean => {
          return chip.startsWith("Notify Status Page Subscribers");
        },
      ),
    ).toBe(true);

    await toReviewFromResources(user);

    expect(
      screen.getByTestId("incident-create-notify-subscribers-value"),
    ).toHaveAttribute("data-boolean-value", "yes");

    const incident: Incident = await declare(user);

    expect((incident as unknown as Record<string, unknown>)[NOTIFY]).toBe(true);
  });

  test("declaring from a template: the box still starts as the project says", async () => {
    queryParams = { incidentTemplateId: TEMPLATE_ID };

    template = new IncidentTemplate();
    template._id = TEMPLATE_ID;
    template.title = "Payments are failing";
    template.incidentSeverityId = new ObjectID(CRITICAL_ID);

    const user: UserEvent = await renderPage(
      `/dashboard/incidents/create?incidentTemplateId=${TEMPLATE_ID}`,
    );

    await screen.findByDisplayValue("Payments are failing");
    await toResourcesAffected(user);

    expect(await openNotifyBox(user)).not.toBeChecked();

    await toReviewFromResources(user);

    const incident: Incident = await declare(user);

    expect(incident.title).toBe("Payments are failing");
    expect((incident as unknown as Record<string, unknown>)[NOTIFY]).toBe(
      false,
    );
  });
});

describe("the review's Change to Yes", () => {
  test("where the project starts the box unticked, the review's No has Change to Yes beside it", async () => {
    startingWith(false);

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toReview(user);

    const line: HTMLElement = screen.getByTestId(
      "incident-create-notify-subscribers-line",
    );

    expect(
      within(line).getByTestId("incident-create-notify-subscribers-value"),
    ).toHaveAttribute("data-boolean-value", "no");
    expect(within(line).getByRole("button", { name: "Change to Yes" })).toBe(
      changeToYes(),
    );
    expect(changeToYes()).toHaveAttribute("type", "button");
    expect(changeToYes()).toHaveAttribute(
      "data-testid",
      "incident-create-notify-subscribers-change-to-yes",
    );
    // A link the size of the text, drawn as the Preview link on its line is.
    expect(changeToYes()).toHaveClass("text-indigo-600", "text-sm");
    // One per review: there is one box.
    expect(
      screen.getAllByRole("button", { name: "Change to Yes" }),
    ).toHaveLength(1);
  });

  test("pressing it ticks the box: the review says Yes, the link is gone, its line keeps the focus, and nothing is sent yet", async () => {
    startingWith(false);

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toReview(user);
    await user.click(changeToYes()!);

    await waitFor(() => {
      expect(
        screen.getByTestId("incident-create-notify-subscribers-value"),
      ).toHaveAttribute("data-boolean-value", "yes");
    });
    expect(changeToYes()).toBeNull();
    await waitFor(() => {
      expect(
        screen.getByTestId("incident-create-notify-subscribers-line"),
      ).toHaveFocus();
    });
    /*
     * Without the browser's outline round the whole width of the review, as
     * an event header's value takes the focus once its Assign is done.
     */
    expect(
      screen.getByTestId("incident-create-notify-subscribers-line"),
    ).toHaveClass("focus:outline-none");
    // Still on the review: only Declare Incident declares.
    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Declare Incident" }),
    ).toBeInTheDocument();
  });

  test("declared after Change to Yes, the incident notifies its subscribers", async () => {
    startingWith(false);

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toReview(user);
    await user.click(changeToYes()!);

    const incident: Incident = await declare(user);

    expect((incident as unknown as Record<string, unknown>)[NOTIFY]).toBe(true);
  });

  test("Change to Yes is the box: going back to Resources Affected shows it ticked", async () => {
    startingWith(false);

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toReview(user);
    await user.click(changeToYes()!);

    // Back through the form's step list.
    await user.click(
      within(screen.getByRole("navigation", { name: "Progress" })).getByText(
        "Resources Affected",
      ),
    );
    await screen.findByRole("combobox", { name: /^Monitors/ });

    expect(await openNotifyBox(user)).toBeChecked();
  });

  test("not for a private incident, which no status page shows", async () => {
    startingWith(false);

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await fillDetails(user);
    await makePrivate(user);

    for (let step: number = 0; step < 3; step++) {
      await next(user);
    }

    await screen.findByRole("button", { name: "Declare Incident" });

    expect(
      screen.getByTestId("incident-create-notify-subscribers-value"),
    ).toHaveAttribute("data-boolean-value", "no");
    expect(changeToYes()).toBeNull();
  });

  test("not once whoever declares ticked the box on Resources Affected", async () => {
    startingWith(false);

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toResourcesAffected(user);
    await user.click(await openNotifyBox(user));
    await toReviewFromResources(user);

    expect(
      screen.getByTestId("incident-create-notify-subscribers-value"),
    ).toHaveAttribute("data-boolean-value", "yes");
    expect(changeToYes()).toBeNull();
  });

  test("where the project starts the box ticked, the review looks as it always did: Yes, and no link", async () => {
    startingWith(true);

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toReview(user);

    expect(
      screen.getByTestId("incident-create-notify-subscribers-value"),
    ).toHaveAttribute("data-boolean-value", "yes");
    expect(changeToYes()).toBeNull();
    expect(reviewRow()).toHaveTextContent(QUESTION);
    expect(reviewRow()).not.toHaveTextContent(UNTICKED_BY_DEFAULT);
  });

  test("and whoever unticks it there gets No, with no link: they saw the box", async () => {
    startingWith(true);

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toResourcesAffected(user);
    await user.click(await openNotifyBox(user));
    await toReviewFromResources(user);

    expect(
      screen.getByTestId("incident-create-notify-subscribers-value"),
    ).toHaveAttribute("data-boolean-value", "no");
    expect(changeToYes()).toBeNull();
  });

  test("where the project cannot be read, the box starts ticked and the review offers no link", async () => {
    projectAnswer = async (): Promise<Project | null> => {
      throw new Error("Network error");
    };

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toResourcesAffected(user);
    await user.click(await openNotifyBox(user));
    await toReviewFromResources(user);

    expect(
      screen.getByTestId("incident-create-notify-subscribers-value"),
    ).toHaveAttribute("data-boolean-value", "no");
    expect(changeToYes()).toBeNull();
  });
});

describe("when the project's choice is not known", () => {
  test("a project that holds no value starts the box ticked", async () => {
    startingWith(undefined);

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toResourcesAffected(user);

    expect(await openNotifyBox(user)).toBeChecked();
    expect(
      screen.queryByText(UNTICKED_BY_DEFAULT, { exact: false }),
    ).toBeNull();
  });

  test("a project that cannot be read starts it ticked, and the form still opens", async () => {
    projectAnswer = async (): Promise<Project | null> => {
      throw new Error("Network error");
    };

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toReview(user);

    expect(
      screen.getByTestId("incident-create-notify-subscribers-value"),
    ).toHaveAttribute("data-boolean-value", "yes");
    // The failed read is not the form's error to show.
    expect(screen.queryByText("Network error")).toBeNull();
    expect(screen.queryByText("Something went wrong")).toBeNull();

    const incident: Incident = await declare(user);

    expect((incident as unknown as Record<string, unknown>)[NOTIFY]).toBe(true);
  });

  test("a read that finds no project starts it ticked", async () => {
    projectAnswer = async (): Promise<Project | null> => {
      return null;
    };

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toResourcesAffected(user);

    expect(await openNotifyBox(user)).toBeChecked();
  });

  test("with no project selected, nothing is read and the box starts ticked", async () => {
    selectedProjectId = null;

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    await toResourcesAffected(user);

    expect(await openNotifyBox(user)).toBeChecked();
    expect(projectReads()).toHaveLength(0);
  });
});

describe("reading the project", () => {
  test("reads the selected project once, for the one column", async () => {
    await renderPage("/dashboard/incidents/create");
    await screen.findByRole("textbox", { name: /^Title/ });

    const reads: Array<ItemRequest> = projectReads();

    expect(reads).toHaveLength(1);
    expect(reads[0]!.id.toString()).toBe(PROJECT_ID);
    expect(Object.keys(reads[0]!.select || {}).sort()).toEqual(
      ["_id", COLUMN].sort(),
    );
  });

  test("the form waits for the project before it draws, then starts the box as it says", async () => {
    let answer: (project: Project) => void = () => {};

    projectAnswer = (): Promise<Project | null> => {
      return new Promise<Project | null>(
        (resolve: (project: Project) => void) => {
          answer = resolve;
        },
      );
    };

    const user: UserEvent = await renderPage("/dashboard/incidents/create");

    // Still reading: no form yet, so nothing can latch the wrong start.
    expect(screen.queryByRole("textbox", { name: /^Title/ })).toBeNull();

    await act(async () => {
      answer(projectHolding(false));
    });

    await toResourcesAffected(user);

    expect(await openNotifyBox(user)).not.toBeChecked();
  });
});
