import "@testing-library/jest-dom";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
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
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Long forms are split into steps - edit forms included. A stepped edit form
 * used to be a trap: its dialog's only primary button read "Next" until the
 * last step, so someone who changed a field on the first step saw no Save,
 * closed the dialog and lost the change. The Probe Details form had its steps
 * taken away for exactly that (dbb2f8920b).
 *
 * So a stepped EDIT dialog (ModelFormModal with formType Update - every
 * CardModelDetail edit, and every ModelTable Edit) keeps Save Changes as its
 * one primary button on every step. Save validates every step first and, if
 * a field on another step fails, opens that step with the error showing. A
 * plain Next walks on, and the step list opens any step, not only the ones
 * already passed - every step of an edit form is filled in already.
 *
 * A stepped CREATE dialog is unchanged: Next until the last step, then the
 * action, and no step can be skipped.
 *
 * These drive the real CardModelDetail, ModelFormModal, ModelForm and
 * BasicForm; only transport and permissions are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: (): { permissions: Array<UserPermission> } => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: OWNER_PERMISSIONS };
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
    },
  };
});

import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import Probe from "../../../Models/DatabaseModels/Probe";

const WAIT_TIMEOUT: number = 20000;

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

const STEPS: Array<FormStep<Probe>> = [
  { title: "About", id: "about" },
  { title: "Identity", id: "identity" },
  { title: "Monitoring", id: "monitoring" },
];

// One field per step keeps every assertion about which step is showing exact.
const FIELDS: Array<{
  field: Record<string, true>;
  title: string;
  stepId: string;
  fieldType: FormFieldSchemaType;
  required: boolean;
  placeholder?: string;
  dataTestId?: string;
}> = [
  {
    field: { description: true },
    title: "Description",
    stepId: "about",
    fieldType: FormFieldSchemaType.LongText,
    required: false,
    placeholder: "What this probe is for",
  },
  {
    field: { name: true },
    title: "Name",
    stepId: "identity",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "Probe name",
  },
  {
    field: { shouldAutoEnableProbeOnNewMonitors: true },
    title: "Enable monitoring automatically on new monitors",
    stepId: "monitoring",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    dataTestId: "auto-enable-toggle",
  },
];

function loadedProbe(data?: { name?: string }): Probe {
  const probe: Probe = new Probe();
  probe.id = PROBE_ID;
  probe.name = data?.name ?? "WBHQ";
  probe.description = "The probe in the server room";
  probe.shouldAutoEnableProbeOnNewMonitors = true;
  return probe;
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Edit Probe" });
}

function progress(): HTMLElement {
  return within(dialog()).getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
}

function saveButton(): HTMLElement {
  return within(dialog()).getByTestId("modal-footer-submit-button");
}

function submitted(): Record<string, unknown> {
  return (createOrUpdateMock.mock.calls[0] as Array<{ model: Probe }>)[0]!
    .model as unknown as Record<string, unknown>;
}

async function openEditDialog(): Promise<UserEvent> {
  const user: UserEvent = userEvent.setup({ delay: null });

  await act(async (): Promise<void> => {
    render(
      <CardModelDetail<Probe>
        name="Probe Details"
        cardProps={{
          title: "Probe Details",
          description: "Here are more details for this probe.",
        }}
        isEditable={true}
        formSteps={STEPS}
        formFields={FIELDS}
        modelDetailProps={{
          modelType: Probe,
          id: "probe-detail",
          modelId: PROBE_ID,
          fields: [{ field: { name: true }, title: "Name" }],
        }}
      />,
    );
  });

  await user.click(
    await screen.findByText("Edit Probe", {}, { timeout: WAIT_TIMEOUT }),
  );

  await waitFor(
    () => {
      expect(
        within(dialog()).getByPlaceholderText("What this probe is for"),
      ).toHaveValue("The probe in the server room");
    },
    { timeout: WAIT_TIMEOUT },
  );

  return user;
}

describe("A stepped edit form", () => {
  beforeEach(() => {
    cleanup();
    getItemMock.mockReset();
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });
    getItemMock.mockResolvedValue(loadedProbe());
  });

  test("offers Save Changes on its first step, as its one primary button, with a plain Next beside it", async () => {
    await openEditDialog();

    expect(activeStep()).toBe("About");
    expect(saveButton()).toHaveTextContent("Save Changes");
    expect(
      within(dialog()).getByTestId("modal-footer-next-button"),
    ).toHaveTextContent("Next");
    // No Back button: that stays removed from stepped forms (b61a6b656d).
    expect(
      within(dialog()).queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });

  test("saves a change made on the first step without walking the other steps", async () => {
    const user: UserEvent = await openEditDialog();

    fireEvent.change(
      within(dialog()).getByPlaceholderText("What this probe is for"),
      { target: { value: "The probe in the new rack" } },
    );
    await user.click(saveButton());

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    // What was changed, and what the other steps were prefilled with.
    expect(submitted()["description"]).toBe("The probe in the new rack");
    expect(submitted()["name"]).toBe("WBHQ");
    expect(submitted()["shouldAutoEnableProbeOnNewMonitors"]).toBe(true);
    expect(submitted()["_id"]).toBe(PROBE_ID.toString());
  });

  test("walks on with Next, and drops Next on the last step", async () => {
    const user: UserEvent = await openEditDialog();

    await user.click(within(dialog()).getByTestId("modal-footer-next-button"));
    await waitFor(() => {
      expect(activeStep()).toBe("Identity");
    });
    expect(within(dialog()).getByPlaceholderText("Probe name")).toHaveValue(
      "WBHQ",
    );

    await user.click(within(dialog()).getByTestId("modal-footer-next-button"));
    await waitFor(() => {
      expect(activeStep()).toBe("Monitoring");
    });

    await waitFor(() => {
      expect(
        within(dialog()).queryByTestId("modal-footer-next-button"),
      ).not.toBeInTheDocument();
    });
    expect(saveButton()).toHaveTextContent("Save Changes");
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("opens a step not reached yet from the step list", async () => {
    const user: UserEvent = await openEditDialog();

    await user.click(within(progress()).getByText("Monitoring"));

    await waitFor(() => {
      expect(activeStep()).toBe("Monitoring");
    });
    expect(within(dialog()).getByTestId("auto-enable-toggle")).toBeVisible();

    // And back again.
    await user.click(within(progress()).getByText("About"));
    await waitFor(() => {
      expect(activeStep()).toBe("About");
    });
  });

  test("saves a change made on a step opened from the step list", async () => {
    const user: UserEvent = await openEditDialog();

    await user.click(within(progress()).getByText("Monitoring"));
    await waitFor(() => {
      expect(activeStep()).toBe("Monitoring");
    });

    const toggle: HTMLElement =
      within(dialog()).getByTestId("auto-enable-toggle");
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });
    await user.click(toggle);
    await waitFor(() => {
      expect(
        within(dialog()).getByTestId("auto-enable-toggle"),
      ).toHaveAttribute("aria-checked", "false");
    });
    await user.click(saveButton());

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(submitted()["shouldAutoEnableProbeOnNewMonitors"]).toBe(false);
    expect(submitted()["name"]).toBe("WBHQ");
  });

  test("does not save while a field on another step fails, and opens that step with the error", async () => {
    // A record whose required name is missing - it is on the second step.
    getItemMock.mockResolvedValue(loadedProbe({ name: "" }));

    const user: UserEvent = await openEditDialog();

    expect(activeStep()).toBe("About");
    await user.click(saveButton());

    await waitFor(() => {
      expect(activeStep()).toBe("Identity");
    });
    expect(
      await within(dialog()).findByText("Name is required."),
    ).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();

    // Fixed where it was shown, it saves.
    fireEvent.change(within(dialog()).getByPlaceholderText("Probe name"), {
      target: { value: "Server room" },
    });
    await user.click(saveButton());

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(submitted()["name"]).toBe("Server room");
  });

  test("stays on the step on screen when the failing field is on it", async () => {
    const user: UserEvent = await openEditDialog();

    await user.click(within(progress()).getByText("Identity"));
    await waitFor(() => {
      expect(activeStep()).toBe("Identity");
    });

    fireEvent.change(within(dialog()).getByPlaceholderText("Probe name"), {
      target: { value: "" },
    });
    await user.click(saveButton());

    expect(
      await within(dialog()).findByText("Name is required."),
    ).toBeVisible();
    expect(activeStep()).toBe("Identity");
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});

describe("A stepped create form", () => {
  beforeEach(() => {
    cleanup();
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });
  });

  async function openCreateDialog(): Promise<UserEvent> {
    const user: UserEvent = userEvent.setup({ delay: null });

    await act(async (): Promise<void> => {
      render(
        <ModelFormModal<Probe>
          title="Create New Probe"
          modelType={Probe}
          submitButtonText="Create Probe"
          onClose={() => {}}
          formProps={{
            id: "create-probe",
            modelType: Probe,
            fields: FIELDS,
            steps: STEPS,
            formType: FormType.Create,
          }}
        />,
      );
    });

    await screen.findByPlaceholderText("What this probe is for");

    return user;
  }

  function createDialog(): HTMLElement {
    return screen.getByRole("dialog", { name: "Create New Probe" });
  }

  test("still walks with Next until the last step, with no second button", async () => {
    await openCreateDialog();

    await waitFor(() => {
      expect(
        within(createDialog()).getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent("Next");
    });
    expect(
      within(createDialog()).queryByTestId("modal-footer-next-button"),
    ).not.toBeInTheDocument();
    expect(
      within(createDialog()).queryByRole("button", { name: "Create Probe" }),
    ).not.toBeInTheDocument();
  });

  test("still cannot skip to a step not reached yet", async () => {
    const user: UserEvent = await openCreateDialog();

    await user.click(
      within(
        within(createDialog()).getByRole("navigation", { name: "Progress" }),
      ).getByText("Monitoring"),
    );

    expect(
      within(createDialog()).getByPlaceholderText("What this probe is for"),
    ).toBeVisible();
    expect(
      within(createDialog()).queryByTestId("auto-enable-toggle"),
    ).not.toBeInTheDocument();
  });

  test("shows the action on the last step", async () => {
    const user: UserEvent = await openCreateDialog();

    await user.click(
      within(createDialog()).getByTestId("modal-footer-submit-button"),
    );
    fireEvent.change(
      await within(createDialog()).findByPlaceholderText("Probe name"),
      { target: { value: "Server room" } },
    );
    await user.click(
      within(createDialog()).getByTestId("modal-footer-submit-button"),
    );
    await within(createDialog()).findByTestId("auto-enable-toggle");

    await waitFor(() => {
      expect(
        within(createDialog()).getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent("Create Probe");
    });
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});
