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
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import MonitorSecrets from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorSecrets";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import MonitorSecretAccess from "../../../Types/Monitor/MonitorSecretAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Monitors > Settings > Secrets, Access step (#1467): three options, and the
 * picker for the chosen one appears under them - monitors for "Specific
 * monitors", labels for "Monitors with labels", nothing for "All monitors".
 *
 * The production page's fields and steps go through the real modal,
 * ModelForm, BasicForm, CardSelect, EntityDropdown and validation. The table
 * is replaced by its open create (or edit) dialog; transport, permissions and
 * translation are stubbed. What reaches ModelAPI.createOrUpdate is what the
 * server gets.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const MONITOR_ID: string = "a1a1a1a1-0000-4000-8000-0000000000a1";
const MONITOR_NAME: string = "Checkout API";
const LABEL_ID: string = "1abe1000-0000-4000-8000-0000000000a1";
const LABEL_NAME: string = "production";
const SECRET_ID: string = "5ec2e700-0000-4000-8000-000000000001";

const SECRET_NAME: string = "ApiKey";
const SECRET_VALUE: string = "sk_live_123";

const ACCESS_QUESTION: string = "Which monitors can use this secret?";

let editingSecret: MonitorSecret | null = null;
let capturedTableProps: ModelTableProps<MonitorSecret> | null = null;
const createOrUpdateMock: MockFunction = getJestMockFunction();
const closeMock: MockFunction = getJestMockFunction();
const successMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<MonitorSecret>): ReactElement => {
      capturedTableProps = props;

      const isEdit: boolean = Boolean(editingSecret);

      return (
        <ModelFormModal<MonitorSecret>
          title={isEdit ? "Edit Monitor Secret" : "Create Monitor Secret"}
          name={isEdit ? "Edit Monitor Secret" : "Create Monitor Secret"}
          modelType={props.modelType}
          submitButtonText={isEdit ? "Save Changes" : "Create Monitor Secret"}
          onClose={closeMock}
          onSuccess={successMock}
          onBeforeCreate={props.onBeforeCreate}
          modelIdToEdit={isEdit ? new ObjectID(SECRET_ID) : undefined}
          formProps={{
            id: "monitor-secret-form",
            modelType: props.modelType,
            // What ModelTable does with these two flags.
            fields: (props.formFields || []).filter(
              (field: { doNotShowWhenEditing?: boolean | undefined }) => {
                return isEdit ? !field.doNotShowWhenEditing : true;
              },
            ),
            steps: props.formSteps || [],
            formType: isEdit ? FormType.Update : FormType.Create,
            modelIdToEdit: isEdit ? new ObjectID(SECRET_ID) : undefined,
          }}
        />
      );
    },
  };
});

function monitorOption(): Monitor {
  const monitor: Monitor = new Monitor(new ObjectID(MONITOR_ID));
  monitor.name = MONITOR_NAME;
  return monitor;
}

function labelOption(): Label {
  const label: Label = new Label(new ObjectID(LABEL_ID));
  label.name = LABEL_NAME;
  label.color = new Color("#16a34a");
  return label;
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<MonitorSecret | null> => {
        return editingSecret;
      },
      getList: async (args: {
        modelType: unknown;
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        const data: Array<unknown> =
          args.modelType === Monitor
            ? [monitorOption()]
            : args.modelType === Label
              ? [labelOption()]
              : [];

        return { data: data, count: data.length, skip: 0, limit: 10 };
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
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
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

function dialog(): HTMLElement {
  return screen.getByRole("dialog", {
    name: editingSecret ? "Edit Monitor Secret" : "Create Monitor Secret",
  });
}

function progress(): HTMLElement {
  return within(dialog()).getByRole("navigation", { name: "Progress" });
}

function card(access: MonitorSecretAccess): HTMLElement {
  return screen.getByTestId(`card-select-option-${access}`);
}

function monitorsPicker(): HTMLElement | null {
  return within(dialog()).queryByRole("combobox", { name: /^Monitors/ });
}

function labelsPicker(): HTMLElement | null {
  return within(dialog()).queryByRole("combobox", { name: /^Labels/ });
}

async function renderDialog(): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <MonitorSecrets
          pageRoute={new Route("/monitors/settings/secrets")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(dialog()).toBeVisible();
  });

  return userEvent.setup({ delay: null });
}

async function fillSecretStep(user: UserEvent): Promise<void> {
  fireEvent.change(await screen.findByPlaceholderText("Secret Name"), {
    target: { value: SECRET_NAME },
  });
  fireEvent.change(
    screen.getByPlaceholderText("Secret Value (eg: API Key, Password, etc.)"),
    {
      target: { value: SECRET_VALUE },
    },
  );

  await user.click(
    await within(dialog()).findByRole("button", { name: "Next" }),
  );

  await screen.findByRole("radiogroup", { name: ACCESS_QUESTION });
}

async function choose(
  user: UserEvent,
  access: MonitorSecretAccess,
): Promise<void> {
  await user.click(card(access));

  await waitFor(() => {
    expect(card(access)).toHaveAttribute("aria-checked", "true");
  });
}

async function pick(combobox: HTMLElement, optionName: string): Promise<void> {
  fireEvent.focus(combobox);
  fireEvent.click(await screen.findByRole("option", { name: optionName }));

  await waitFor(() => {
    expect(
      within(dialog()).getByRole("button", { name: `Remove ${optionName}` }),
    ).toBeInTheDocument();
  });
}

async function submit(
  user: UserEvent,
  buttonName: string = "Create Monitor Secret",
): Promise<MonitorSecret> {
  await user.click(
    await within(dialog()).findByRole("button", { name: buttonName }),
  );

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: MonitorSecret })
    .model;
}

function ids(items: Array<Monitor | Label> | undefined): Array<string> {
  return (items || []).map((item: Monitor | Label): string => {
    return item._id!.toString();
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  editingSecret = null;
  capturedTableProps = null;
  createOrUpdateMock.mockReset().mockResolvedValue({ data: {} });
  closeMock.mockReset();
  successMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/monitors/settings/secrets"));
});

afterEach(() => {
  cleanup();
});

describe("Create Monitor Secret: the Access step", () => {
  test("is its own step, offering the three options with Specific monitors chosen", async () => {
    const user: UserEvent = await renderDialog();

    expect(
      within(progress()).getByText("Secret").closest("li") ||
        within(progress()).getByText("Secret"),
    ).toBeTruthy();
    expect(within(progress()).getByText("Access")).toBeInTheDocument();

    // Not on the first step.
    expect(
      screen.queryByRole("radiogroup", { name: ACCESS_QUESTION }),
    ).not.toBeInTheDocument();

    await fillSecretStep(user);

    const options: Array<HTMLElement> = within(
      screen.getByRole("radiogroup", { name: ACCESS_QUESTION }),
    ).getAllByRole("radio");

    expect(
      options.map((option: HTMLElement): string | null => {
        return option.getAttribute("data-testid");
      }),
    ).toEqual([
      `card-select-option-${MonitorSecretAccess.AllMonitors}`,
      `card-select-option-${MonitorSecretAccess.SpecificMonitors}`,
      `card-select-option-${MonitorSecretAccess.MonitorsWithLabels}`,
    ]);

    expect(card(MonitorSecretAccess.AllMonitors)).toHaveTextContent(
      "All monitors",
    );
    expect(card(MonitorSecretAccess.SpecificMonitors)).toHaveTextContent(
      "Specific monitors",
    );
    expect(card(MonitorSecretAccess.MonitorsWithLabels)).toHaveTextContent(
      "Monitors with labels",
    );

    expect(card(MonitorSecretAccess.SpecificMonitors)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(monitorsPicker()).toBeInTheDocument();
    expect(labelsPicker()).not.toBeInTheDocument();

    // The question has its own help, not the column's text for API clients.
    expect(
      within(dialog()).getByText("You can change this at any time."),
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByText(/Setting this empties/),
    ).not.toBeInTheDocument();
  });

  test("shows only the picker of the chosen option, and none for All monitors", async () => {
    const user: UserEvent = await renderDialog();
    await fillSecretStep(user);

    await choose(user, MonitorSecretAccess.AllMonitors);
    await waitFor(() => {
      expect(monitorsPicker()).not.toBeInTheDocument();
    });
    expect(labelsPicker()).not.toBeInTheDocument();

    await choose(user, MonitorSecretAccess.MonitorsWithLabels);
    await waitFor(() => {
      expect(labelsPicker()).toBeInTheDocument();
    });
    expect(monitorsPicker()).not.toBeInTheDocument();

    await choose(user, MonitorSecretAccess.SpecificMonitors);
    await waitFor(() => {
      expect(monitorsPicker()).toBeInTheDocument();
    });
    expect(labelsPicker()).not.toBeInTheDocument();
  });

  test("creates an All monitors secret without asking for monitors or labels", async () => {
    const user: UserEvent = await renderDialog();
    await fillSecretStep(user);
    await choose(user, MonitorSecretAccess.AllMonitors);

    const model: MonitorSecret = await submit(user);

    expect(model.monitorAccess).toBe(MonitorSecretAccess.AllMonitors);
    expect(model.name).toBe(SECRET_NAME);
    expect(model.secretValue).toBe(SECRET_VALUE);
    expect(ids(model.monitors)).toEqual([]);
    expect(ids(model.labels)).toEqual([]);
  });

  test("Specific monitors needs at least one monitor, and sends the ones picked", async () => {
    const user: UserEvent = await renderDialog();
    await fillSecretStep(user);

    await user.click(
      await within(dialog()).findByRole("button", {
        name: "Create Monitor Secret",
      }),
    );

    expect(await screen.findByText("Monitors is required.")).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();

    await pick(monitorsPicker()!, MONITOR_NAME);

    const model: MonitorSecret = await submit(user);

    expect(model.monitorAccess).toBe(MonitorSecretAccess.SpecificMonitors);
    expect(ids(model.monitors)).toEqual([MONITOR_ID]);
    expect(ids(model.labels)).toEqual([]);
  });

  test("Monitors with labels needs at least one label, and sends the ones picked", async () => {
    const user: UserEvent = await renderDialog();
    await fillSecretStep(user);
    await choose(user, MonitorSecretAccess.MonitorsWithLabels);

    await user.click(
      await within(dialog()).findByRole("button", {
        name: "Create Monitor Secret",
      }),
    );

    expect(await screen.findByText("Labels is required.")).toBeVisible();
    expect(screen.queryByText("Monitors is required.")).not.toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();

    await pick(labelsPicker()!, LABEL_NAME);

    const model: MonitorSecret = await submit(user);

    expect(model.monitorAccess).toBe(MonitorSecretAccess.MonitorsWithLabels);
    expect(ids(model.labels)).toEqual([LABEL_ID]);
  });

  test("a hidden picker's requirement does not block the option that is chosen", async () => {
    const user: UserEvent = await renderDialog();
    await fillSecretStep(user);

    // Specific monitors with no monitor picked, then a change of mind.
    await choose(user, MonitorSecretAccess.MonitorsWithLabels);
    await choose(user, MonitorSecretAccess.AllMonitors);

    const model: MonitorSecret = await submit(user);

    expect(model.monitorAccess).toBe(MonitorSecretAccess.AllMonitors);
    expect(screen.queryByText("Monitors is required.")).not.toBeInTheDocument();
    expect(screen.queryByText("Labels is required.")).not.toBeInTheDocument();
  });

  test("a change of mind after picking monitors sends the new option (the server drops the old list)", async () => {
    const user: UserEvent = await renderDialog();
    await fillSecretStep(user);
    await pick(monitorsPicker()!, MONITOR_NAME);

    await choose(user, MonitorSecretAccess.AllMonitors);

    const model: MonitorSecret = await submit(user);

    expect(model.monitorAccess).toBe(MonitorSecretAccess.AllMonitors);
  });
});

describe("Edit Monitor Secret: the Access step", () => {
  function storedSecret(data: {
    monitorAccess: MonitorSecretAccess;
    monitors?: Array<Monitor> | undefined;
    labels?: Array<Label> | undefined;
  }): MonitorSecret {
    const secret: MonitorSecret = new MonitorSecret(new ObjectID(SECRET_ID));
    secret.name = SECRET_NAME;
    secret.description = "Used by the checkout monitors";
    secret.monitorAccess = data.monitorAccess;
    secret.monitors = data.monitors || [];
    secret.labels = data.labels || [];
    return secret;
  }

  async function openAccessStep(user: UserEvent): Promise<void> {
    await screen.findByDisplayValue(SECRET_NAME);
    await user.click(
      await within(progress()).findByText("Access", {}, { timeout: 5000 }),
    );
    await screen.findByRole("radiogroup", { name: ACCESS_QUESTION });
  }

  test("opens a label-scoped secret with Monitors with labels chosen and its labels in the picker", async () => {
    editingSecret = storedSecret({
      monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
      labels: [labelOption()],
    });

    const user: UserEvent = await renderDialog();
    await openAccessStep(user);

    expect(card(MonitorSecretAccess.MonitorsWithLabels)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(labelsPicker()).toBeInTheDocument();
    expect(monitorsPicker()).not.toBeInTheDocument();
    expect(
      await within(dialog()).findByRole("button", {
        name: `Remove ${LABEL_NAME}`,
      }),
    ).toBeInTheDocument();
  });

  test("opens an All monitors secret with no picker at all", async () => {
    editingSecret = storedSecret({
      monitorAccess: MonitorSecretAccess.AllMonitors,
    });

    const user: UserEvent = await renderDialog();
    await openAccessStep(user);

    expect(card(MonitorSecretAccess.AllMonitors)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(monitorsPicker()).not.toBeInTheDocument();
    expect(labelsPicker()).not.toBeInTheDocument();
  });

  test("switching a listed secret to All monitors saves the new option", async () => {
    editingSecret = storedSecret({
      monitorAccess: MonitorSecretAccess.SpecificMonitors,
      monitors: [monitorOption()],
    });

    const user: UserEvent = await renderDialog();
    await openAccessStep(user);

    expect(card(MonitorSecretAccess.SpecificMonitors)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      await within(dialog()).findByRole("button", {
        name: `Remove ${MONITOR_NAME}`,
      }),
    ).toBeInTheDocument();

    await choose(user, MonitorSecretAccess.AllMonitors);

    const model: MonitorSecret = await submit(user, "Save Changes");

    expect(model.monitorAccess).toBe(MonitorSecretAccess.AllMonitors);
    expect(model._id?.toString()).toBe(SECRET_ID);
  });
});

describe("Monitor secrets table", () => {
  test("the Access column reads the mode and both lists, and the filters offer all three", async () => {
    await renderDialog();

    const accessColumn: ModelTableProps<MonitorSecret>["columns"][number] =
      capturedTableProps!.columns.find(
        (
          column: ModelTableProps<MonitorSecret>["columns"][number],
        ): boolean => {
          return column.title === "Access";
        },
      )!;

    expect(accessColumn).toBeDefined();
    expect(Object.keys(accessColumn.field || {})).toEqual([
      "monitorAccess",
      "monitors",
      "labels",
    ]);

    const filterTitles: Array<string> = (capturedTableProps!.filters || []).map(
      (filter: { title: string }): string => {
        return filter.title;
      },
    );

    expect(filterTitles).toEqual(["Name", "Access", "Monitors", "Labels"]);

    const accessFilter: { filterDropdownOptions?: Array<unknown> } = (
      capturedTableProps!.filters || []
    ).find((filter: { title: string }): boolean => {
      return filter.title === "Access";
    }) as { filterDropdownOptions?: Array<unknown> };

    expect(accessFilter.filterDropdownOptions).toEqual([
      { label: "All monitors", value: MonitorSecretAccess.AllMonitors },
      {
        label: "Specific monitors",
        value: MonitorSecretAccess.SpecificMonitors,
      },
      {
        label: "Monitors with labels",
        value: MonitorSecretAccess.MonitorsWithLabels,
      },
    ]);
  });

  test("an Access cell names the mode and shows only that mode's list", async () => {
    await renderDialog();

    const accessColumn: ModelTableProps<MonitorSecret>["columns"][number] =
      capturedTableProps!.columns.find(
        (
          column: ModelTableProps<MonitorSecret>["columns"][number],
        ): boolean => {
          return column.title === "Access";
        },
      )!;

    function renderCell(secret: MonitorSecret): HTMLElement {
      const { container } = render(
        <MemoryRouter>{accessColumn.getElement!(secret)}</MemoryRouter>,
      );

      return container.querySelector(
        '[data-testid="monitor-secret-access"]',
      ) as HTMLElement;
    }

    // Each row also holds the other list, as an API client could leave it.
    const all: MonitorSecret = new MonitorSecret();
    all.monitorAccess = MonitorSecretAccess.AllMonitors;
    all.monitors = [monitorOption()];
    all.labels = [labelOption()];

    const specific: MonitorSecret = new MonitorSecret();
    specific.monitorAccess = MonitorSecretAccess.SpecificMonitors;
    specific.monitors = [monitorOption()];
    specific.labels = [labelOption()];

    const labelled: MonitorSecret = new MonitorSecret();
    labelled.monitorAccess = MonitorSecretAccess.MonitorsWithLabels;
    labelled.monitors = [monitorOption()];
    labelled.labels = [labelOption()];

    const allCell: HTMLElement = renderCell(all);
    expect(allCell).toHaveTextContent(/^All monitors$/);
    expect(allCell).not.toHaveTextContent(MONITOR_NAME);
    expect(allCell).not.toHaveTextContent(LABEL_NAME);

    const specificCell: HTMLElement = renderCell(specific);
    expect(specificCell).toHaveTextContent("Specific monitors");
    expect(specificCell).toHaveTextContent(MONITOR_NAME);
    expect(specificCell).not.toHaveTextContent(LABEL_NAME);

    const labelledCell: HTMLElement = renderCell(labelled);
    expect(labelledCell).toHaveTextContent("Monitors with labels");
    expect(labelledCell).toHaveTextContent(LABEL_NAME);
    expect(labelledCell).not.toHaveTextContent(MONITOR_NAME);
  });

  test("a row with nothing picked says so, and a row without a mode reads as Specific monitors", async () => {
    await renderDialog();

    const accessColumn: ModelTableProps<MonitorSecret>["columns"][number] =
      capturedTableProps!.columns.find(
        (
          column: ModelTableProps<MonitorSecret>["columns"][number],
        ): boolean => {
          return column.title === "Access";
        },
      )!;

    const noMonitors: MonitorSecret = new MonitorSecret();
    noMonitors.monitorAccess = MonitorSecretAccess.SpecificMonitors;
    noMonitors.monitors = [];

    const noLabels: MonitorSecret = new MonitorSecret();
    noLabels.monitorAccess = MonitorSecretAccess.MonitorsWithLabels;
    noLabels.labels = [];

    const noMode: MonitorSecret = new MonitorSecret();
    noMode.monitors = [monitorOption()];

    const { container: first } = render(
      <MemoryRouter>{accessColumn.getElement!(noMonitors)}</MemoryRouter>,
    );
    expect(first).toHaveTextContent("No monitors.");

    const { container: second } = render(
      <MemoryRouter>{accessColumn.getElement!(noLabels)}</MemoryRouter>,
    );
    expect(second).toHaveTextContent("No labels attached.");

    const { container: third } = render(
      <MemoryRouter>{accessColumn.getElement!(noMode)}</MemoryRouter>,
    );
    expect(third).toHaveTextContent("Specific monitors");
    expect(third).toHaveTextContent(MONITOR_NAME);
  });
});
