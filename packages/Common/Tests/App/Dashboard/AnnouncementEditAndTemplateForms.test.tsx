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
 * The announcement's details card Edit and the announcement template forms
 * walk the steps of Create Announcement (AnnouncementCreateForm.test.tsx).
 * Each page is drawn with its cards recording what they are handed, and
 * the form a card would open is drawn from those props through the real
 * ModelForm and BasicForm, with only the network and the signed-in user
 * stubbed:
 *
 *   - the details card Edit: Announcement, then Status Pages; no notify
 *     switch (the column takes no updates, so it never showed), and
 *     "Notify subscribers about this update" folded with the schedule,
 *     whose line says whether this edit is sent - and the save sends it;
 *   - a template: Template Info, Announcement, Status Pages, its one notify
 *     switch drawn open and on, as the column starts; the templates table's
 *     Create and the template's Edit hand over the same steps and fields.
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
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const cardModelDetailRenderMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
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

// The pages' cards: they record what they are handed.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: unknown): React.ReactElement => {
      cardModelDetailRenderMock(props);
      return <div data-testid="card-model-detail" />;
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="model-delete" />;
    },
  };
});

import AnnouncementView from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/AnnouncementView";
import StatusPageAnnouncementTemplateView from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Settings/StatusPageAnnouncementTemplateView";
import {
  ANNOUNCEMENT_TEMPLATE_FORM_STEPS,
  getAnnouncementTemplateFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementFormFields";
import {
  ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR,
  ANNOUNCEMENT_SCHEDULE_SUMMARIES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementForm";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../UI/Components/Forms/ModelForm";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageAnnouncementTemplate from "../../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import Timezone from "../../../Types/Timezone";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const NOW: Date = new Date("2026-10-03T09:20:00.000Z");
const ANNOUNCEMENT_ID: string = "66666666-6666-4666-8666-666666666666";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const FORM_ID: string = "announcement-card-form";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/project/status-pages/announcements/:id"),
  currentProject: null,
  hasPaymentMethod: true,
};

interface CardProps<T extends BaseModel> {
  name: string;
  formSteps?: Array<FormStep<T>>;
  formFields?: Array<ModelField<T>>;
  isEditable?: boolean;
}

// The announcement as the server holds it: showing since yesterday.
let storedAnnouncement: JSONObject = {};

function cardHandedTo<T extends BaseModel>(name: string): CardProps<T> {
  const found: unknown = cardModelDetailRenderMock.mock.calls
    .map((call: Array<unknown>): unknown => {
      return call[0];
    })
    .find((props: unknown): boolean => {
      return (props as { name: string }).name === name;
    });

  expect(`${name}: ${Boolean(found)}`).toBe(`${name}: true`);

  return found as CardProps<T>;
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

function findLabel(labelStart: string): HTMLLabelElement | undefined {
  return Array.from(form().querySelectorAll("label")).find(
    (candidate: HTMLLabelElement): boolean => {
      return (candidate.textContent || "").trim().startsWith(labelStart);
    },
  );
}

function labelText(labelStart: string): string {
  return (findLabel(labelStart)?.textContent || "").trim();
}

function labelledInput(labelStart: string): HTMLInputElement {
  const label: HTMLLabelElement | undefined = findLabel(labelStart);

  expect(`${labelStart}: ${Boolean(label)}`).toBe(`${labelStart}: true`);

  return form().querySelector(
    `[id="${label!.getAttribute("for")}"]`,
  ) as HTMLInputElement;
}

async function goToNextStep(expectedTitle: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));

  await waitFor(() => {
    expect(currentStepTitle()).toBe(expectedTitle);
  });
}

function sectionHeader(title: string): HTMLElement {
  return screen.getByRole("button", { name: title });
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

// What the first save sent beside the record (the misc data props).
function call0MiscData(): Record<string, unknown> {
  return (
    (
      createOrUpdateMock.mock.calls[0]![0] as {
        miscDataProps?: Record<string, unknown>;
      }
    ).miscDataProps || {}
  );
}

function sectionLine(): string {
  return (
    screen.getByTestId("collapsible-section-summary").textContent || ""
  ).trim();
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

beforeEach(() => {
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  cardModelDetailRenderMock.mockReset();
  PermissionGate.clearPermissionPropsCache();

  storedAnnouncement = {
    _id: ANNOUNCEMENT_ID,
    title: "Planned database upgrade",
    description: "The database is upgraded on Sunday.",
    statusPages: [{ _id: STATUS_PAGE_ID }],
    monitors: [],
    showAnnouncementAt: "2026-10-02T09:00:00.000Z",
    endAnnouncementAt: null,
  };

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(ANNOUNCEMENT_ID));
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 100 };
  });

  getItemMock.mockImplementation(async (): Promise<BaseModel> => {
    return BaseModel.fromJSON(
      storedAnnouncement,
      StatusPageAnnouncement,
    ) as BaseModel;
  });

  createOrUpdateMock.mockImplementation(async () => {
    return { data: new StatusPageAnnouncement(), miscData: undefined };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("the announcement's details card Edit", () => {
  async function renderEditForm(): Promise<void> {
    render(
      <MemoryRouter>
        <AnnouncementView {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    const card: CardProps<StatusPageAnnouncement> =
      cardHandedTo<StatusPageAnnouncement>("Status Page Announcement Details");

    expect(card.isEditable).toBe(true);
    cleanup();

    render(
      <MemoryRouter>
        <ModelForm<StatusPageAnnouncement>
          modelType={StatusPageAnnouncement}
          id={FORM_ID}
          name="Edit Status Page Announcement"
          formType={FormType.Update}
          modelIdToEdit={new ObjectID(ANNOUNCEMENT_ID)}
          steps={card.formSteps!}
          fields={card.formFields!}
          submitButtonText="Save Changes"
          onSuccess={(): void => {}}
        />
      </MemoryRouter>,
    );

    await screen.findByRole("navigation", { name: "Progress" });
    await waitFor(() => {
      expect((labelledInput("Title") as HTMLInputElement).value).toBe(
        "Planned database upgrade",
      );
    });
    await settle();
  }

  test("walks the steps of Create Announcement", async () => {
    await renderEditForm();

    expect(stepTitles()).toEqual(["Announcement", "Status Pages"]);
    expect(currentStepTitle()).toBe("Announcement");
    expect(labelText("Title")).not.toContain("(Optional)");
    // Required, as the server requires it.
    expect(labelText("Description")).not.toContain("(Optional)");

    const advanced: HTMLElement = sectionHeader("Advanced");
    const folded: Array<string> = fieldLabelsIn(sectionBody(advanced));

    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(folded).toContain("Attachments");
    expect(folded).not.toContain("Title");
  });

  test("asks under the description whether this edit is sent, unticked: a typo fix tells nobody", async () => {
    await renderEditForm();

    const updateBox: HTMLElement = screen.getByRole("checkbox", {
      name: SubscriberUpdateNotification.formFieldTitle,
    });

    // On the Announcement step, drawn open, with the text it is about.
    expect(updateBox).toBeVisible();
    expect(updateBox).not.toBeChecked();
    expect(
      fieldLabelsIn(form()).indexOf(
        SubscriberUpdateNotification.formFieldTitle,
      ),
    ).toBeGreaterThan(fieldLabelsIn(form()).indexOf("Description"));
  });

  test("has no notify switch: Schedule holds only the start and the end, and says when it shows", async () => {
    await renderEditForm();
    await goToNextStep("Status Pages");

    const schedule: HTMLElement = sectionHeader("Schedule");

    expect(schedule).toHaveAttribute("aria-expanded", "false");
    expect(sectionLine()).toBe(ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntilEnded);
    expect(fieldLabelsIn(sectionBody(schedule))).toEqual([
      "Start Showing Announcement At",
      "End Showing Announcement At",
    ]);
    expect(
      screen.queryByRole("checkbox", {
        name: "Notify Status Page Subscribers",
        hidden: true,
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Schedule & Notifications" }),
    ).toBeNull();
  });

  test("ticking the update box asks for the update notification with the save", async () => {
    await renderEditForm();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: SubscriberUpdateNotification.formFieldTitle,
      }),
    );
    await act(async () => {});

    await goToNextStep("Status Pages");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const call: {
      model: StatusPageAnnouncement;
      formType: FormType;
      miscDataProps: Record<string, unknown>;
    } = createOrUpdateMock.mock.calls[0]![0] as {
      model: StatusPageAnnouncement;
      formType: FormType;
      miscDataProps: Record<string, unknown>;
    };

    expect(call.formType).toBe(FormType.Update);
    expect(call.miscDataProps).toEqual(
      SubscriberUpdateNotification.getMiscDataProps(),
    );
    // The switch is never sent: its column takes no updates.
    expect(
      (call.model as unknown as Record<string, unknown>)[
        "shouldStatusPageSubscribersBeNotified"
      ],
    ).toBeUndefined();
  });

  test("an announcement that has ended says when", async () => {
    storedAnnouncement = {
      ...storedAnnouncement,
      endAnnouncementAt: "2026-10-03T08:00:00.000Z",
    };

    await renderEditForm();
    await goToNextStep("Status Pages");

    const endedAt: string =
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        new Date("2026-10-03T08:00:00.000Z"),
      );

    expect(sectionLine()).toBe(`Stopped showing at ${endedAt}.`);
  });

  test("an end that has passed is how an announcement is taken down: the Edit saves it", async () => {
    await renderEditForm();
    await goToNextStep("Status Pages");

    const schedule: HTMLElement = sectionHeader("Schedule");

    fireEvent.click(schedule);
    fireEvent.change(labelledInput("End Showing Announcement At"), {
      target: { value: "2026-10-03T09:00" },
    });
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: StatusPageAnnouncement = (
      createOrUpdateMock.mock.calls[0]![0] as { model: StatusPageAnnouncement }
    ).model;

    expect(
      OneUptimeDate.fromString(
        model.endAnnouncementAt as unknown as string,
      ).toISOString(),
    ).toBe("2026-10-03T09:00:00.000Z");
    // Nobody is told about it unless the box under the description is ticked.
    expect(call0MiscData()).toEqual({});
  });

  test("an end before the start is refused, and the section opens to say so", async () => {
    await renderEditForm();
    await goToNextStep("Status Pages");

    const schedule: HTMLElement = sectionHeader("Schedule");

    fireEvent.click(schedule);
    fireEvent.change(labelledInput("End Showing Announcement At"), {
      target: { value: "2026-10-01T09:00" },
    });
    await act(async () => {});
    fireEvent.click(schedule);

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByText(ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(schedule).toHaveAttribute("aria-expanded", "true");
    });
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});

describe("an announcement template", () => {
  function renderTemplateForm(): void {
    render(
      <MemoryRouter>
        <ModelForm<StatusPageAnnouncementTemplate>
          modelType={StatusPageAnnouncementTemplate}
          id={FORM_ID}
          name="Create Status Page Announcement Template"
          formType={FormType.Create}
          steps={ANNOUNCEMENT_TEMPLATE_FORM_STEPS}
          fields={getAnnouncementTemplateFormFields()}
          submitButtonText="Create Template"
          onSuccess={(): void => {}}
        />
      </MemoryRouter>,
    );
  }

  async function fillTemplateInfo(): Promise<void> {
    await screen.findByRole("navigation", { name: "Progress" });
    await waitFor(() => {
      expect(labelText("Template Name")).not.toBe("");
    });
    await settle();

    fireEvent.change(labelledInput("Template Name"), {
      target: { value: "Database upgrade" },
    });
    await act(async () => {});
  }

  async function writeAnnouncement(): Promise<void> {
    fireEvent.change(labelledInput("Title"), {
      target: { value: "Planned database upgrade" },
    });

    const toolbar: HTMLElement = within(form()).getByTestId(
      "markdown-editor-toolbar",
    );

    fireEvent.click(within(toolbar).getByRole("button", { name: "Markdown" }));

    const sources: Array<HTMLTextAreaElement> = Array.from(
      form().querySelectorAll<HTMLTextAreaElement>("textarea"),
    ).filter((textarea: HTMLTextAreaElement): boolean => {
      return textarea.getAttribute("placeholder") !== "Template Description";
    });

    fireEvent.change(sources[sources.length - 1]!, {
      target: { value: "The database is upgraded on Sunday." },
    });
    await act(async () => {});
  }

  test("walks Template Info, then the announcement's steps", async () => {
    renderTemplateForm();
    await screen.findByRole("navigation", { name: "Progress" });

    expect(stepTitles()).toEqual([
      "Template Info",
      "Announcement",
      "Status Pages",
    ]);
  });

  test("asks for the announcement's title and description, as the announcement does", async () => {
    renderTemplateForm();
    await fillTemplateInfo();
    await goToNextStep("Announcement");

    expect(labelText("Title")).not.toContain("(Optional)");
    expect(labelText("Description")).not.toContain("(Optional)");
    // A template holds no attachments, so it has no Advanced section.
    expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByText("Description is required.")).toBeInTheDocument();
  });

  test("shows its one notify switch on Status Pages, on as the column starts, and saves it", async () => {
    renderTemplateForm();
    await fillTemplateInfo();
    await goToNextStep("Announcement");
    await writeAnnouncement();
    await goToNextStep("Status Pages");

    // Drawn open: no schedule to fold it with.
    expect(
      screen.queryByRole("button", { name: "Schedule & Notifications" }),
    ).toBeNull();

    const notify: HTMLElement = screen.getByRole("checkbox", {
      name: "Notify Status Page Subscribers",
    });

    expect(notify).toBeVisible();
    expect(notify).toBeChecked();
    expect(labelText("Monitors Affected")).toBe("Monitors Affected (Optional)");

    fireEvent.click(screen.getByRole("button", { name: "Create Template" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const template: StatusPageAnnouncementTemplate = (
      createOrUpdateMock.mock.calls[0]![0] as {
        model: StatusPageAnnouncementTemplate;
      }
    ).model;

    expect(template.templateName).toBe("Database upgrade");
    expect(template.title).toBe("Planned database upgrade");
    expect(template.description).toBe("The database is upgraded on Sunday.");
    expect(template.shouldStatusPageSubscribersBeNotified).toBe(true);
  });

  test("its page's Edit walks the same steps with the same fields as the table's Create", () => {
    render(
      <MemoryRouter>
        <StatusPageAnnouncementTemplateView {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    const card: CardProps<StatusPageAnnouncementTemplate> =
      cardHandedTo<StatusPageAnnouncementTemplate>(
        "Status Page Announcement Template Details",
      );

    expect(card.isEditable).toBe(true);
    expect(card.formSteps).toEqual(ANNOUNCEMENT_TEMPLATE_FORM_STEPS);

    const keysOf: (
      fields: Array<ModelField<StatusPageAnnouncementTemplate>>,
    ) => Array<string> = (
      fields: Array<ModelField<StatusPageAnnouncementTemplate>>,
    ): Array<string> => {
      return fields.map(
        (field: ModelField<StatusPageAnnouncementTemplate>): string => {
          return `${field.stepId}: ${Object.keys(field.field || {})[0]}`;
        },
      );
    };

    expect(keysOf(card.formFields!)).toEqual(
      keysOf(getAnnouncementTemplateFormFields()),
    );
  });
});
