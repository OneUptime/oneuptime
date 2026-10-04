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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A scheduled maintenance template walks the steps of Create Scheduled
 * Maintenance Event - Event, Resources Affected - with its own name in
 * front and its recurring schedule at the end (it walked eight steps). Drawn here through the real ModelForm and BasicForm, as the
 * templates table's Create dialog draws it, with only the network and the
 * signed-in user stubbed. And the template's page says what its subscriber
 * switches do in the same words as the form.
 */

jest.mock("../../../UI/Utils/Permission", () => {
  const actualPermission: Record<string, unknown> = jest.requireActual(
    "../../../Types/Permission",
  ) as Record<string, unknown>;
  const PermissionEnum: Record<string, string> = actualPermission[
    "default"
  ] as Record<string, string>;
  const granted: Array<string> = [
    PermissionEnum["ProjectOwner"]!,
    PermissionEnum["User"]!,
    PermissionEnum["Public"]!,
  ];

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return granted;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: granted };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const cardModelDetailRenderMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

// The template's page: its cards record what they are handed.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: unknown): React.ReactElement => {
      cardModelDetailRenderMock(props);
      return <div data-testid="card-model-detail" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Owners/OwnersCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="owners-card" />;
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="model-delete" />;
    },
  };
});

import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ScheduledMaintenanceTemplateView from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplateView";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  getFormSteps,
  getTemplateFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates";

const FORM_ID: string = "create-template-form";

function renderTemplateForm(): void {
  render(
    <MemoryRouter>
      <ModelForm<ScheduledMaintenanceTemplate>
        modelType={ScheduledMaintenanceTemplate}
        id={FORM_ID}
        name="Create Scheduled Maintenance Template"
        formType={FormType.Create}
        steps={getFormSteps({ isViewPage: false })}
        fields={getTemplateFormFields({ isViewPage: false })}
        submitButtonText="Create Template"
        onSuccess={(): void => {}}
      />
    </MemoryRouter>,
  );
}

function form(): HTMLElement {
  return document.getElementById(FORM_ID)!;
}

function stepTitles(): Array<string> {
  return within(screen.getByRole("navigation", { name: "Progress" }))
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

function currentStepTitle(): string {
  return (
    screen
      .getByRole("navigation", { name: "Progress" })
      .querySelector("[aria-current='step']")?.textContent || ""
  ).trim();
}

function labelledControl(labelText: string): HTMLInputElement {
  const label: HTMLLabelElement | undefined = Array.from(
    form().querySelectorAll("label"),
  ).find((candidate: HTMLLabelElement): boolean => {
    return (candidate.textContent || "").trim().startsWith(labelText);
  });

  expect(`${labelText}: ${Boolean(label)}`).toBe(`${labelText}: true`);

  return form().querySelector(
    `[id="${label!.getAttribute("for")}"]`,
  ) as HTMLInputElement;
}

function labelText(labelStart: string): string {
  const label: HTMLLabelElement | undefined = Array.from(
    form().querySelectorAll("label"),
  ).find((candidate: HTMLLabelElement): boolean => {
    return (candidate.textContent || "").trim().startsWith(labelStart);
  });

  return (label?.textContent || "").trim();
}

async function fillTemplateInfo(): Promise<void> {
  // The fields arrive once the form has worked out what it may show.
  await waitFor(() => {
    expect(labelText("Template Name")).not.toBe("");
  });
  /*
   * And the form starts from its defaults in an effect after they are
   * drawn, which React runs in a task of its own: typing before it has run
   * would keep it from running at all (a person cannot type that fast).
   */
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });

  fireEvent.change(labelledControl("Template Name"), {
    target: { value: "Weekly database patching" },
  });
  fireEvent.change(labelledControl("Template Description"), {
    target: { value: "Used for the Sunday patch window." },
  });
  await act(async () => {});
}

// What a folded section holds: the body its header controls.
function sectionBody(header: HTMLElement): HTMLElement {
  return document.getElementById(header.getAttribute("aria-controls")!)!;
}

// The fields in an element, by the labels they are drawn with.
function fieldLabelsIn(element: HTMLElement): Array<string> {
  return Array.from(element.querySelectorAll("label"))
    .map((label: HTMLLabelElement): string => {
      return (label.textContent || "").replace("(Optional)", "").trim();
    })
    .filter((text: string, index: number, all: Array<string>): boolean => {
      return Boolean(text) && all.indexOf(text) === index;
    });
}

async function goToNextStep(expectedTitle: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));

  await waitFor(() => {
    expect(currentStepTitle()).toBe(expectedTitle);
  });
}

function createdTemplate(): ScheduledMaintenanceTemplate {
  expect(createOrUpdateMock).toHaveBeenCalledTimes(1);

  return (
    createOrUpdateMock.mock.calls[0]![0] as {
      model: ScheduledMaintenanceTemplate;
    }
  ).model;
}

beforeEach(() => {
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  cardModelDetailRenderMock.mockReset();
  PermissionGate.clearPermissionPropsCache();

  getListMock.mockImplementation(
    async (): Promise<{
      data: Array<BaseModel>;
      count: number;
      skip: number;
      limit: number;
    }> => {
      return { data: [], count: 0, skip: 0, limit: 100 };
    },
  );

  createOrUpdateMock.mockImplementation(
    async (data: unknown): Promise<{ data: Record<string, unknown> }> => {
      return {
        data: BaseModel.toJSON(
          (data as { model: ScheduledMaintenanceTemplate }).model,
          ScheduledMaintenanceTemplate,
        ),
      };
    },
  );
});

afterEach(() => {
  cleanup();
});

describe("Create Scheduled Maintenance Template", () => {
  test("walks the event's steps, with the template in front and its schedule at the end", async () => {
    renderTemplateForm();

    await screen.findByRole("navigation", { name: "Progress" });

    expect(stepTitles()).toEqual([
      "Template Info",
      "Event",
      "Resources Affected",
      "Recurring",
    ]);
  });

  test("asks for the event's title but not its description, as the event itself does", async () => {
    renderTemplateForm();
    await screen.findByRole("navigation", { name: "Progress" });
    await fillTemplateInfo();
    await goToNextStep("Event");

    expect(labelText("Title")).not.toContain("(Optional)");
    expect(labelText("Description")).toContain("(Optional)");
  });

  test("every step after Event is optional: Next walks them without asking, and Create Template is on the last", async () => {
    renderTemplateForm();
    await screen.findByRole("navigation", { name: "Progress" });
    await fillTemplateInfo();
    await goToNextStep("Event");

    fireEvent.change(labelledControl("Title"), {
      target: { value: "Database maintenance" },
    });
    await act(async () => {});

    // The action is on the last step only.
    expect(
      screen.queryByRole("button", { name: "Create Template" }),
    ).not.toBeInTheDocument();

    await goToNextStep("Resources Affected");
    expect(
      screen.queryByRole("button", { name: "Create Template" }),
    ).not.toBeInTheDocument();

    await goToNextStep("Recurring");
    expect(
      screen.queryByRole("button", { name: "Next" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create Template" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const template: ScheduledMaintenanceTemplate = createdTemplate();

    expect(template.templateName).toBe("Weekly database patching");
    expect(template.title).toBe("Database maintenance");
    expect(template.shouldStatusPageSubscribersBeNotifiedOnEventCreated).toBe(
      true,
    );
    expect(
      template.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
    ).toBe(true);
    expect(
      template.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
    ).toBe(true);
    expect(Boolean(template.isRecurringEvent)).toBe(false);
  });

  test("Event folds owners and labels under Advanced; Resources Affected folds the subscriber switches to a line", async () => {
    renderTemplateForm();
    await screen.findByRole("navigation", { name: "Progress" });
    await fillTemplateInfo();
    await goToNextStep("Event");
    fireEvent.change(labelledControl("Title"), {
      target: { value: "Database maintenance" },
    });
    await act(async () => {});

    const eventAdvanced: HTMLElement = screen.getByRole("button", {
      name: "More fields",
    });

    expect(eventAdvanced).toHaveAttribute("aria-expanded", "false");
    expect(fieldLabelsIn(sectionBody(eventAdvanced))).toEqual([
      "Owners",
      "Labels",
    ]);

    await goToNextStep("Resources Affected");

    const notifications: HTMLElement = screen.getByRole("button", {
      name: "Subscriber Notifications",
    });

    expect(notifications).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      "Subscribers of the event's status pages are notified when it is scheduled, when it starts and when it ends.",
    );

    const resourcesAdvanced: HTMLElement = screen.getByRole("button", {
      name: "More fields",
    });

    expect(resourcesAdvanced).toHaveAttribute("aria-expanded", "false");
    expect(fieldLabelsIn(sectionBody(resourcesAdvanced))).toEqual([
      "Change Monitor Status to",
    ]);

    fireEvent.click(notifications);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "When the event is scheduled" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "When the event ends" }),
    );
    await act(async () => {});
    fireEvent.click(notifications);

    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      "Subscribers of the event's status pages are notified when it starts.",
    );
  });

  test("a recurring template asks for its whole schedule before it is saved", async () => {
    renderTemplateForm();
    await screen.findByRole("navigation", { name: "Progress" });
    await fillTemplateInfo();
    await goToNextStep("Event");
    fireEvent.change(labelledControl("Title"), {
      target: { value: "Database maintenance" },
    });
    await act(async () => {});
    await goToNextStep("Resources Affected");
    await goToNextStep("Recurring");

    // Off, the schedule is not asked for.
    expect(
      form().querySelectorAll("input[type='datetime-local']"),
    ).toHaveLength(0);

    fireEvent.click(screen.getByRole("switch", { name: "Recurring Event" }));
    await act(async () => {});

    for (const title of [
      "First Event Scheduled At",
      "First Event Starts At",
      "First Event Ends At",
      "How often should this event recur?",
    ]) {
      // Required now: no "(Optional)" beside it.
      expect(labelText(title)).toBe(title);
    }

    fireEvent.click(screen.getByRole("button", { name: "Create Template" }));

    expect(
      await screen.findByText("First Event Scheduled At is required."),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});

/*
 * The template's page says what its subscriber switches do in the line the
 * form's folded section shows, rather than three "Event Created: Do Not
 * Notify Subscribers" ticks; and its reminders under the form's own name.
 */
describe("the template's page", () => {
  interface DetailField {
    title?: string;
    field: Record<string, unknown>;
    getElement?: (item: ScheduledMaintenanceTemplate) => React.ReactElement;
  }

  interface CardProps {
    name: string;
    modelDetailProps: { fields: Array<DetailField> };
  }

  async function detailFields(): Promise<Array<DetailField>> {
    render(
      <MemoryRouter>
        <ScheduledMaintenanceTemplateView
          pageRoute={new Route("/dashboard/project/templates/view")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );

    await act(async () => {});

    const card: CardProps | undefined = (
      cardModelDetailRenderMock.mock.calls as Array<Array<CardProps>>
    )
      .map((call: Array<CardProps>): CardProps => {
        return call[0]!;
      })
      .find((props: CardProps): boolean => {
        return props.name === "Scheduled Maintenance Template Details";
      });

    expect(card).toBeDefined();

    return card!.modelDetailProps.fields;
  }

  function fieldTitled(fields: Array<DetailField>, title: string): DetailField {
    const found: DetailField | undefined = fields.find(
      (field: DetailField): boolean => {
        return field.title === title;
      },
    );

    expect(`${title}: ${Boolean(found)}`).toBe(`${title}: true`);

    return found!;
  }

  function templateWith(
    settings: Partial<ScheduledMaintenanceTemplate>,
  ): ScheduledMaintenanceTemplate {
    const template: ScheduledMaintenanceTemplate =
      new ScheduledMaintenanceTemplate();

    Object.assign(template, settings);

    return template;
  }

  beforeEach(() => {
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(new ObjectID("66666666-6666-4666-8666-666666666666"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("says what the subscriber switches do in the form's words", async () => {
    const fields: Array<DetailField> = await detailFields();
    const notifications: DetailField = fieldTitled(
      fields,
      "Subscriber Notifications",
    );

    render(
      notifications.getElement!(
        templateWith({
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
          sendSubscriberNotificationsOnBeforeTheEvent: [
            Recurring.fromJSON({
              _type: "Recurring",
              value: {
                intervalType: EventInterval.Day,
                intervalCount: { _type: "PositiveNumber", value: 1 },
              },
            }),
          ],
        }),
      ),
    );

    expect(
      screen.getByTestId("template-subscriber-notifications-summary"),
    ).toHaveTextContent(
      "Subscribers of the event's status pages are notified when it starts and when it ends. They get reminders before it starts.",
    );

    for (const retired of [
      "Notify Status Page Subscribers",
      "Send reminders to subscribers before the event",
    ]) {
      expect(
        fields.some((field: DetailField): boolean => {
          return field.title === retired;
        }),
      ).toBe(false);
    }
  });

  test("lists the reminders under the form's name for them", async () => {
    const fields: Array<DetailField> = await detailFields();
    const reminders: DetailField = fieldTitled(
      fields,
      "Reminders before the event",
    );

    const reminder: Recurring = new Recurring();
    reminder.intervalType = EventInterval.Day;
    reminder.intervalCount = new PositiveNumber(2);

    render(
      reminders.getElement!(
        templateWith({
          sendSubscriberNotificationsOnBeforeTheEvent: [reminder],
        }),
      ),
    );

    expect(
      screen.getByText("2 Days before the event begins", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByText("is begins", { exact: false })).toBeNull();
  });
});
