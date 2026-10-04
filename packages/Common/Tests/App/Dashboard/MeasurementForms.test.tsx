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
import React, { FunctionComponent, ReactElement } from "react";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The three Measurements pages' forms, drawn for real: each page's own
 * fields in the ModelFormModal, ModelForm and BasicForm its table opens,
 * with only the network, the permissions and the table around them stubbed.
 *
 * "Please make incident and alert measurements easier to understand. I have
 * no idea what these are. ... There are also some advanced options. Can you
 * please hide them in the advanced section? ... Start State Occurrence can
 * be in advanced and you can have sane defaults. Unit field in the end could
 * be a dropdown." - the maintainer, on the Create New Incident Measurement
 * form.
 *
 *   - Create opens on "What do you want to measure?" - the common
 *     measurements as cards, each saying what it measures - and a pick
 *     fills in the name, the description and both ends.
 *   - Two steps instead of four: the measurement, then where it starts and
 *     ends, each one list of moments in plain words.
 *   - Which time a repeated state counts, the unit (a dropdown) and the
 *     chart summary are folded under Advanced, set to the server's defaults.
 *   - Edit shows a saved measurement as its moments, and leaves alone what
 *     it does not change.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const RECORD_ID: string = "33333333-3333-4333-8333-333333333333";
const FIRST_STATE_ID: string = "44444444-4444-4444-8444-444444444444";
const SECOND_STATE_ID: string = "55555555-5555-4555-8555-555555555555";

interface MockTable {
  mode: "create" | "edit";
}

const mockTable: MockTable = { mode: "create" };

const createOrUpdateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<BaseModel>): ReactElement => {
      const fields: Array<ModelField<BaseModel>> = props.formFields || [];
      const isCreate: boolean = mockTable.mode === "create";

      return (
        <ModelFormModal<BaseModel>
          title={isCreate ? "Create" : "Edit"}
          modelType={props.modelType}
          submitButtonText={isCreate ? "Create" : "Save Changes"}
          onClose={() => {}}
          {...(isCreate ? {} : { modelIdToEdit: new ObjectID(RECORD_ID) })}
          formProps={{
            id: "measurement-form",
            name: "measurement-form",
            modelType: props.modelType,
            // What the real table hands each form.
            fields: fields.filter((field: ModelField<BaseModel>): boolean => {
              return isCreate
                ? !field.doNotShowWhenCreating
                : !field.doNotShowWhenEditing;
            }),
            steps: props.formSteps || [],
            formType: isCreate ? FormType.Create : FormType.Update,
          }}
        />
      );
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
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
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
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
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

import IncidentMeasurementsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentMeasurements";
import AlertMeasurementsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertMeasurements";
import ScheduledMaintenanceMeasurementsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceMeasurements";
import IncidentMeasurement from "../../../Models/DatabaseModels/IncidentMeasurement";
import AlertMeasurement from "../../../Models/DatabaseModels/AlertMeasurement";
import ScheduledMaintenanceMeasurement from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  hasSetChip,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

type Page = FunctionComponent<PageComponentProps>;

interface PresetCase {
  id: string;
  name: string;
  description: string;
  key: string;
  startLabel: string;
  endLabel: string;
  startAnchorType: string;
  endAnchorType: string;
  // The role the end is saved with, when it has one.
  endStateRole?: string | undefined;
}

interface PageCase {
  label: string;
  page: Page;
  existing: () => BaseModel;
  stateModel: { new (): BaseModel };
  noun: string;
  presetDescription: string;
  presetNames: Array<string>;
  preset: PresetCase;
  // Where a measurement set up by hand starts.
  origin: { label: string; anchorType: string };
  // An end that is a timestamp, which can only happen once.
  timestampEnd: { label: string; anchorType: string };
  pickedStateEnd: string;
  startStateRole: string;
  endStateRole: string;
  startState: string;
  endState: string;
  // The switch that lists it on each event's page.
  showOnView: { column: string; title: string };
  // A saved measurement: starts at Timeline Start, ends at a role.
  saved: {
    // What Timeline Start is: the same instant as another moment.
    startLabel: string;
    roleEndLabel: string;
    role: string;
  };
}

const PAGES: Array<PageCase> = [
  {
    label: "Incident measurements",
    page: IncidentMeasurementsPage,
    existing: (): BaseModel => {
      return new IncidentMeasurement();
    },
    stateModel: IncidentState,
    noun: "incident",
    presetDescription:
      "A measurement is the time between two moments in an incident. Pick a common one, or choose Something else to set up your own.",
    presetNames: [
      "Time to acknowledge",
      "Time to resolve",
      "Time to postmortem",
      "Something else",
    ],
    preset: {
      id: "time-to-acknowledge",
      name: "Time to acknowledge",
      description:
        "From when an incident is declared until someone acknowledges it.",
      key: "time-to-acknowledge",
      startLabel: "The incident is declared",
      endLabel: "The incident is acknowledged",
      startAnchorType: "Declared At",
      endAnchorType: "State Role Entered",
      endStateRole: "Acknowledged",
    },
    origin: { label: "The incident is declared", anchorType: "Declared At" },
    timestampEnd: {
      label: "The postmortem is published",
      anchorType: "Postmortem Posted At",
    },
    pickedStateEnd: "The incident enters a state you pick",
    startStateRole: "startIncidentStateRole",
    endStateRole: "endIncidentStateRole",
    startState: "startIncidentState",
    endState: "endIncidentState",
    showOnView: {
      column: "showOnIncidentView",
      title: "Show on incident pages",
    },
    saved: {
      startLabel: "The incident is declared",
      roleEndLabel: "The incident is resolved",
      role: "Resolved",
    },
  },
  {
    label: "Alert measurements",
    page: AlertMeasurementsPage,
    existing: (): BaseModel => {
      return new AlertMeasurement();
    },
    stateModel: AlertState,
    noun: "alert",
    presetDescription:
      "A measurement is the time between two moments in an alert. Pick a common one, or choose Something else to set up your own.",
    presetNames: ["Time to acknowledge", "Time to resolve", "Something else"],
    preset: {
      id: "time-to-acknowledge",
      name: "Time to acknowledge",
      description:
        "From when an alert is created until someone acknowledges it.",
      key: "time-to-acknowledge",
      startLabel: "The alert is created",
      endLabel: "The alert is acknowledged",
      startAnchorType: "Created At",
      endAnchorType: "State Role Entered",
      endStateRole: "Acknowledged",
    },
    origin: { label: "The alert is created", anchorType: "Created At" },
    timestampEnd: { label: "Impact starts", anchorType: "Impact Started At" },
    pickedStateEnd: "The alert enters a state you pick",
    startStateRole: "startAlertStateRole",
    endStateRole: "endAlertStateRole",
    startState: "startAlertState",
    endState: "endAlertState",
    showOnView: { column: "showOnAlertView", title: "Show on alert pages" },
    saved: {
      startLabel: "The alert is created",
      roleEndLabel: "The alert is resolved",
      role: "Resolved",
    },
  },
  {
    label: "Scheduled maintenance measurements",
    page: ScheduledMaintenanceMeasurementsPage,
    existing: (): BaseModel => {
      return new ScheduledMaintenanceMeasurement();
    },
    stateModel: ScheduledMaintenanceState,
    noun: "maintenance event",
    presetDescription:
      "A measurement is the time between two moments in a maintenance event. Pick a common one, or choose Something else to set up your own.",
    presetNames: [
      "Start delay",
      "Overrun",
      "Maintenance duration",
      "Something else",
    ],
    preset: {
      id: "start-delay",
      name: "Start delay",
      description:
        "How late maintenance starts: from its scheduled start until it starts.",
      key: "start-delay",
      startLabel: "The maintenance is scheduled to start",
      endLabel: "The maintenance starts",
      startAnchorType: "Scheduled Starts At",
      endAnchorType: "State Role Entered",
      endStateRole: "Ongoing",
    },
    origin: {
      label: "The maintenance is scheduled to start",
      anchorType: "Scheduled Starts At",
    },
    timestampEnd: {
      label: "The maintenance is scheduled to end",
      anchorType: "Scheduled Ends At",
    },
    pickedStateEnd: "The event enters a state you pick",
    startStateRole: "startScheduledMaintenanceStateRole",
    endStateRole: "endScheduledMaintenanceStateRole",
    startState: "startScheduledMaintenanceState",
    endState: "endScheduledMaintenanceState",
    showOnView: {
      column: "showOnScheduledMaintenanceView",
      title: "Show on maintenance event pages",
    },
    saved: {
      // Maintenance is created, then scheduled: Timeline Start is creation.
      startLabel: "The event is created in OneUptime",
      roleEndLabel: "The maintenance ends",
      role: "Ended",
    },
  },
];

async function renderPage(
  page: Page,
  mode: MockTable["mode"],
): Promise<UserEvent> {
  mockTable.mode = mode;
  const PageComponent: Page = page;

  await act(async (): Promise<void> => {
    render(
      <PageComponent
        pageRoute={new Route("/dashboard/project/settings")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });

  return userEvent.setup({ delay: null });
}

function form(): HTMLElement {
  return screen.getByRole("dialog");
}

function savedModel(): Record<string, unknown> {
  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: BaseModel })
    .model as unknown as Record<string, unknown>;
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

async function clickNext(user: UserEvent): Promise<void> {
  await user.click(within(form()).getByRole("button", { name: "Next" }));
}

// The last step's button reads Create once the step is on screen.
async function clickCreate(user: UserEvent): Promise<void> {
  await user.click(
    await within(form()).findByRole("button", { name: "Create" }),
  );
}

// The control a react-select combobox sits in, which shows the value picked.
function dropdownOf(combobox: HTMLElement): HTMLElement {
  const control: HTMLElement | null = combobox.closest(
    '[class*="ou-select__control"]',
  );

  expect(control).not.toBeNull();

  return control!;
}

// A dropdown by its label, folded away under Advanced or not.
function dropdownNamed(name: string): HTMLElement {
  return within(form()).getByRole("combobox", { name, hidden: true });
}

function queryDropdownNamed(name: string): HTMLElement | null {
  return within(form()).queryByRole("combobox", { name, hidden: true });
}

function advancedHeader(): HTMLElement {
  return within(form()).getByRole("button", { name: "More fields" });
}

// The "Show on ... pages" switch, folded away under More fields or not.
function showOnViewSwitch(title: string): HTMLElement {
  return within(form()).getByRole("switch", { name: title, hidden: true });
}

function stateRow(
  model: { new (): BaseModel },
  id: string,
  name: string,
  order: number,
): BaseModel {
  const row: BaseModel = new model();
  row._id = id;
  Object.assign(row, { name, order, color: "#ff0000" });
  return row;
}

beforeEach(() => {
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    return Promise.resolve({ data: data.model });
  }) as never);
  getItemMock.mockReset();
  getListMock.mockReset().mockImplementation((() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  }) as never);
});

afterEach(() => {
  cleanup();
});

describe.each(PAGES)("$label - Create", (entry: PageCase) => {
  test("opens on the common measurements, which say what a measurement is, in two steps", async () => {
    await renderPage(entry.page, "create");

    expect(
      await within(form()).findByText("What do you want to measure?"),
    ).toBeVisible();
    expect(within(form()).getByText(entry.presetDescription)).toBeVisible();

    const picker: HTMLElement = within(form()).getByTestId(
      "measurement-preset-picker",
    );
    const cards: Array<HTMLElement> = within(picker).getAllByRole("radio");

    expect(
      cards.map((card: HTMLElement): string => {
        return card.textContent || "";
      }),
    ).toEqual(
      entry.presetNames.map((name: string): string => {
        return expect.stringContaining(name) as unknown as string;
      }),
    );

    // Each card says what it measures.
    expect(within(picker).getByText(entry.preset.description)).toBeVisible();

    const progress: HTMLElement = await within(form()).findByRole(
      "navigation",
      { name: "Progress" },
    );
    expect(within(progress).getByText("Measurement")).toBeVisible();
    expect(within(progress).getByText("Start and End")).toBeVisible();
    expect(within(progress).queryByText("Start Anchor")).toBeNull();
    expect(within(progress).queryByText("Reporting")).toBeNull();

    // A new measurement is on; there is nothing to switch.
    expect(within(form()).queryByRole("switch")).toBeNull();
  });

  test("picking one fills in its name, its description and both ends, and creates it", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.click(
      await within(form()).findByTestId(
        `card-select-option-${entry.preset.id}`,
      ),
    );

    expect(
      within(form()).getByTestId(`card-select-option-${entry.preset.id}`),
    ).toHaveAttribute("aria-checked", "true");

    await waitFor(() => {
      expect(
        within(form()).getByRole("textbox", { name: /^Name/ }),
      ).toHaveValue(entry.preset.name);
    });
    expect(
      within(form()).getByRole("textbox", { name: /^Description/ }),
    ).toHaveValue(entry.preset.description);
    expect(
      within(form()).getByTestId("generated-key-field-value"),
    ).toHaveTextContent(entry.preset.key);

    await clickNext(user);

    const starts: HTMLElement = await within(form()).findByRole("combobox", {
      name: "Starts when",
    });
    const ends: HTMLElement = within(form()).getByRole("combobox", {
      name: "Ends when",
    });

    expect(dropdownOf(starts)).toHaveTextContent(entry.preset.startLabel);
    expect(dropdownOf(ends)).toHaveTextContent(entry.preset.endLabel);

    await clickCreate(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: Record<string, unknown> = savedModel();

    expect(model["name"]).toBe(entry.preset.name);
    expect(model["description"]).toBe(entry.preset.description);
    expect(model["startAnchorType"]).toBe(entry.preset.startAnchorType);
    expect(model["endAnchorType"]).toBe(entry.preset.endAnchorType);
    expect(model[entry.endStateRole]).toBe(entry.preset.endStateRole);
    // Made by the server from the name.
    expect(model["key"] || undefined).toBeUndefined();
    // What the server would have used anyway.
    expect(model["startStateOccurrence"]).toBe("First");
    expect(model["endStateOccurrence"]).toBe("First");
    expect(model["unit"]).toBe("seconds");
    expect(model["aggregationType"]).toBe("Avg");
    // The form's own values are not columns.
    expect(model["measurementPreset"]).toBeUndefined();
    expect(model["startMoment"]).toBeUndefined();
    expect(model["endMoment"]).toBeUndefined();
  });

  test("a name typed first is kept when a common measurement is picked", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.type(
      await within(form()).findByRole("textbox", { name: /^Name/ }),
      "Our own name",
    );
    await user.click(
      within(form()).getByTestId(`card-select-option-${entry.preset.id}`),
    );

    expect(within(form()).getByRole("textbox", { name: /^Name/ })).toHaveValue(
      "Our own name",
    );
  });

  test("Something else leaves the name and the ends for the user to set", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.click(
      await within(form()).findByTestId("card-select-option-custom"),
    );

    expect(
      within(form()).getByTestId("card-select-option-custom"),
    ).toHaveAttribute("aria-checked", "true");
    expect(within(form()).getByRole("textbox", { name: /^Name/ })).toHaveValue(
      "",
    );

    await user.type(
      within(form()).getByRole("textbox", { name: /^Name/ }),
      "Time to look",
    );
    await clickNext(user);

    const ends: HTMLElement = await within(form()).findByRole("combobox", {
      name: "Ends when",
    });
    expect(dropdownOf(ends)).not.toHaveTextContent(entry.preset.endLabel);
  });

  test("set up by hand, the clock starts where most do and only the end is asked for", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.type(
      await within(form()).findByRole("textbox", { name: /^Name/ }),
      "Time to look",
    );
    await clickNext(user);

    const starts: HTMLElement = await within(form()).findByRole("combobox", {
      name: "Starts when",
    });
    expect(dropdownOf(starts)).toHaveTextContent(entry.origin.label);

    // No end yet: nothing is saved.
    await clickCreate(user);
    expect(
      await within(form()).findByText(/Ends when is required/),
    ).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();

    await pickOption(
      user,
      within(form()).getByRole("combobox", { name: "Ends when" }),
      entry.timestampEnd.label,
    );
    await clickCreate(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(savedModel()["startAnchorType"]).toBe(entry.origin.anchorType);
    expect(savedModel()["endAnchorType"]).toBe(entry.timestampEnd.anchorType);
  });

  test("an end at a state you pick asks which state, lists the states in order, and saves the one picked", async () => {
    getListMock.mockImplementation(((args: {
      modelType: { new (): BaseModel };
    }) => {
      if (args.modelType === entry.stateModel) {
        return Promise.resolve({
          data: [
            stateRow(entry.stateModel, FIRST_STATE_ID, "Triage", 1),
            stateRow(entry.stateModel, SECOND_STATE_ID, "Mitigated", 2),
          ],
          count: 2,
          skip: 0,
          limit: 2,
        });
      }

      return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
    }) as never);

    const user: UserEvent = await renderPage(entry.page, "create");

    await user.type(
      await within(form()).findByRole("textbox", { name: /^Name/ }),
      "Time to mitigate",
    );
    await clickNext(user);

    // Not asked until a state is the end.
    await within(form()).findByRole("combobox", { name: "Ends when" });
    expect(
      within(form()).queryByRole("combobox", { name: "End state" }),
    ).toBeNull();

    await pickOption(
      user,
      within(form()).getByRole("combobox", { name: "Ends when" }),
      entry.pickedStateEnd,
    );

    const endState: HTMLElement = await within(form()).findByRole("combobox", {
      name: "End state",
    });

    // In the order the project's states run.
    const stateListCall: { sort?: Record<string, string> } | undefined = (
      getListMock.mock.calls as Array<
        Array<{ modelType: unknown; sort?: Record<string, string> }>
      >
    )
      .map(
        (
          call: Array<{ modelType: unknown; sort?: Record<string, string> }>,
        ) => {
          return call[0]!;
        },
      )
      .find((args: { modelType: unknown }) => {
        return args.modelType === entry.stateModel;
      });
    expect(stateListCall?.sort).toEqual({ order: SortOrder.Ascending });

    // A state is needed to create it.
    await clickCreate(user);
    expect(
      await within(form()).findByText(/End state is required/),
    ).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();

    await pickOption(user, endState, "Mitigated");
    await clickCreate(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: Record<string, unknown> = savedModel();
    expect(model["endAnchorType"]).toBe("State Entered");
    expect((model[entry.endState] as BaseModel)._id?.toString()).toBe(
      SECOND_STATE_ID,
    );
  });

  test("Advanced is folded, and holds which time counts, the unit and the chart summary, set to the server's defaults", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.click(
      await within(form()).findByTestId(
        `card-select-option-${entry.preset.id}`,
      ),
    );
    await clickNext(user);
    await within(form()).findByRole("combobox", { name: "Ends when" });

    // Folded: present, but out of sight until opened.
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(dropdownNamed("Show durations in")).not.toBeVisible();
    expect(setChips(advancedHeader())).toEqual([]);

    await user.click(advancedHeader());

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    expect(dropdownNamed("Show durations in")).toBeVisible();
    expect(dropdownOf(dropdownNamed("Show durations in"))).toHaveTextContent(
      "Automatic",
    );
    expect(dropdownOf(dropdownNamed("Chart summary"))).toHaveTextContent(
      "Average",
    );

    // The end is reaching a state, which can happen twice; the start cannot.
    expect(
      dropdownOf(dropdownNamed("If the end happens more than once")),
    ).toHaveTextContent("Use the first time");
    expect(
      queryDropdownNamed("If the start happens more than once"),
    ).toBeNull();
  });

  test("the unit is picked from a list, and saved", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.click(
      await within(form()).findByTestId(
        `card-select-option-${entry.preset.id}`,
      ),
    );
    await clickNext(user);
    await within(form()).findByRole("combobox", { name: "Ends when" });
    await user.click(advancedHeader());

    await pickOption(
      user,
      within(form()).getByRole("combobox", { name: "Show durations in" }),
      "Hours",
    );

    // Folded again, it still says something in it is set.
    await user.click(advancedHeader());
    expect(hasSetChip(advancedHeader())).toBe(true);

    await clickCreate(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(savedModel()["unit"]).toBe("hours");
  });

  /*
   * The value of each measurement is on each event's own page, in its
   * Measurements card, unless this is turned off: on, as the server has
   * it, folded with the other options most measurements never change.
   */
  test("shows the measurement on each event's page by default, from a switch under More fields", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.click(
      await within(form()).findByTestId(
        `card-select-option-${entry.preset.id}`,
      ),
    );
    await clickNext(user);
    await within(form()).findByRole("combobox", { name: "Ends when" });

    // Named while folded, and not set: on is what it is anyway.
    expect(listedNames(advancedHeader())).toContain(entry.showOnView.title);
    expect(setChips(advancedHeader())).toEqual([]);
    expect(showOnViewSwitch(entry.showOnView.title)).not.toBeVisible();

    await user.click(advancedHeader());

    const toggle: HTMLElement = showOnViewSwitch(entry.showOnView.title);

    expect(toggle).toBeVisible();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    // It says where the measurement shows.
    expect(
      within(form()).getByText(/^Shown in the Measurements card on each /),
    ).toBeVisible();

    await clickCreate(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(savedModel()[entry.showOnView.column]).toBe(true);
  });

  test("turned off, the folded section says so, and it is saved off", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.click(
      await within(form()).findByTestId(
        `card-select-option-${entry.preset.id}`,
      ),
    );
    await clickNext(user);
    await within(form()).findByRole("combobox", { name: "Ends when" });
    await user.click(advancedHeader());

    await user.click(showOnViewSwitch(entry.showOnView.title));

    expect(showOnViewSwitch(entry.showOnView.title)).toHaveAttribute(
      "aria-checked",
      "false",
    );

    // Folded again, it still says what is set, and to what.
    await user.click(advancedHeader());
    expect(setChips(advancedHeader())).toEqual([
      `${entry.showOnView.title}: Off`,
    ]);

    await clickCreate(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(savedModel()[entry.showOnView.column]).toBe(false);
  });

  test("an end moved off a state drops the role it no longer has", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.click(
      await within(form()).findByTestId(
        `card-select-option-${entry.preset.id}`,
      ),
    );
    await clickNext(user);

    await pickOption(
      user,
      await within(form()).findByRole("combobox", { name: "Ends when" }),
      entry.timestampEnd.label,
    );

    // A timestamp happens once: nothing to ask about it under Advanced.
    expect(queryDropdownNamed("If the end happens more than once")).toBeNull();

    await clickCreate(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(savedModel()["endAnchorType"]).toBe(entry.timestampEnd.anchorType);
    expect(savedModel()[entry.endStateRole]).toBeNull();
  });
});

describe.each(PAGES)("$label - Edit", (entry: PageCase) => {
  beforeEach(() => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(entry.existing(), {
          _id: RECORD_ID,
          name: "Time to resolve, our way",
          description: "",
          // Saved through the API before there were moments.
          startAnchorType: "Timeline Start",
          endAnchorType: "State Role Entered",
          [entry.endStateRole]: entry.saved.role,
          startStateOccurrence: "First",
          endStateOccurrence: "Last",
          // Typed by hand, before the unit was a dropdown.
          unit: "secs",
          aggregationType: "Avg",
          isEnabled: true,
        }),
      );
    }) as never);
  });

  test("shows a saved measurement as its moments, with an Enabled switch and no common measurements to pick", async () => {
    const user: UserEvent = await renderPage(entry.page, "edit");

    expect(
      await within(form()).findByRole("textbox", { name: /^Name/ }),
    ).toHaveValue("Time to resolve, our way");
    expect(
      within(form()).queryByTestId("measurement-preset-picker"),
    ).toBeNull();
    expect(
      within(form()).getByRole("switch", { name: /Enabled/ }),
    ).toBeVisible();

    await user.click(
      await within(form()).findByTestId("modal-footer-next-button"),
    );

    const starts: HTMLElement = await within(form()).findByRole("combobox", {
      name: "Starts when",
    });

    // Timeline Start is the same instant as another moment, and says so.
    expect(dropdownOf(starts)).toHaveTextContent(entry.saved.startLabel);
    expect(
      dropdownOf(within(form()).getByRole("combobox", { name: "Ends when" })),
    ).toHaveTextContent(entry.saved.roleEndLabel);

    // The last time counts: Advanced says something in it is set.
    expect(hasSetChip(advancedHeader())).toBe(true);

    await user.click(advancedHeader());

    // A unit typed by hand shows as the option it spells.
    expect(dropdownOf(dropdownNamed("Show durations in"))).toHaveTextContent(
      "Automatic",
    );
    expect(
      dropdownOf(dropdownNamed("If the end happens more than once")),
    ).toHaveTextContent("Use the last time");
  });

  test("a measurement kept off event pages says so, folded, and stays off when saved", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(entry.existing(), {
          _id: RECORD_ID,
          name: "Time to resolve, our way",
          startAnchorType: "Timeline Start",
          endAnchorType: "State Role Entered",
          [entry.endStateRole]: entry.saved.role,
          startStateOccurrence: "First",
          endStateOccurrence: "First",
          unit: "seconds",
          aggregationType: "Avg",
          isEnabled: true,
          [entry.showOnView.column]: false,
        }),
      );
    }) as never);

    const user: UserEvent = await renderPage(entry.page, "edit");

    await within(form()).findByRole("textbox", { name: /^Name/ });
    await user.click(
      await within(form()).findByTestId("modal-footer-next-button"),
    );
    await within(form()).findByRole("combobox", { name: "Ends when" });

    expect(setChips(advancedHeader())).toEqual([
      `${entry.showOnView.title}: Off`,
    ]);

    await user.click(
      await within(form()).findByRole("button", { name: "Save Changes" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(savedModel()[entry.showOnView.column]).toBe(false);
  });

  test("one shown on event pages, as most are, is not called out", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(entry.existing(), {
          _id: RECORD_ID,
          name: "Time to resolve",
          startAnchorType: "Timeline Start",
          endAnchorType: "State Role Entered",
          [entry.endStateRole]: entry.saved.role,
          startStateOccurrence: "First",
          endStateOccurrence: "First",
          unit: "seconds",
          aggregationType: "Avg",
          isEnabled: true,
          [entry.showOnView.column]: true,
        }),
      );
    }) as never);

    const user: UserEvent = await renderPage(entry.page, "edit");

    await within(form()).findByRole("textbox", { name: /^Name/ });
    await user.click(
      await within(form()).findByTestId("modal-footer-next-button"),
    );
    await within(form()).findByRole("combobox", { name: "Ends when" });

    expect(setChips(advancedHeader())).toEqual([]);
    expect(showOnViewSwitch(entry.showOnView.title)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("saving a rename leaves what it measures exactly as it was saved", async () => {
    const user: UserEvent = await renderPage(entry.page, "edit");

    const name: HTMLElement = await within(form()).findByRole("textbox", {
      name: /^Name/,
    });
    await user.clear(name);
    await user.type(name, "Time to resolve");

    /*
     * Save Changes is on the last step only. Every step of an edit form is
     * filled in already, so the step list opens the last one.
     */
    expect(
      within(form()).queryByRole("button", { name: "Save Changes" }),
    ).toBeNull();

    const steps: Array<HTMLElement> = within(
      within(form()).getByRole("navigation", { name: "Progress" }),
    ).getAllByRole("listitem");

    await user.click(steps[steps.length - 1] as HTMLElement);

    await user.click(
      await within(form()).findByRole("button", { name: "Save Changes" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: Record<string, unknown> = savedModel();

    expect(model["name"]).toBe("Time to resolve");
    // Not rewritten as the moment it shows as.
    expect(model["startAnchorType"]).toBe("Timeline Start");
    expect(model["endAnchorType"]).toBe("State Role Entered");
    expect(model[entry.endStateRole]).toBe(entry.saved.role);
    expect(model["unit"]).toBe("secs");
    expect(model["endStateOccurrence"]).toBe("Last");
  });
});
