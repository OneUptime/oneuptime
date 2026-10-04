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
 * "In multi-step form. Please dont have the primary save button on any step
 * except the last. ... Next button should never be primary color as well.
 * Can you please do this for all multistep forms in the project?" - the
 * maintainer, 2026-10-04.
 *
 * So a stepped dialog, create or edit (ModelFormModal - every CardModelDetail
 * edit, every ModelTable Create and Edit), walks with a plain Next and offers
 * its action - Create Probe, Save Changes - on the last step only, as its one
 * primary button (Forms/Utils/SteppedFormFooter.ts). The action checks every
 * step first and, if a field on another step fails, opens that step with the
 * error showing.
 *
 * An edit form's step list opens any step, not only the ones already passed:
 * every step of an edit form is filled in already, so a change on the first
 * step is saved by opening the last step from the list and pressing Save
 * Changes there. (Before 2026-10-04 an edit dialog saved from any step, and a
 * create dialog offered its action as soon as the steps left were optional.)
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

const PRIMARY_CLASS: string = "bg-indigo-600";
const PLAIN_CLASS: string = "bg-white";

function nextButtonIn(container: HTMLElement): HTMLElement | null {
  return within(container).queryByTestId("modal-footer-next-button");
}

function submitButtonIn(container: HTMLElement): HTMLElement | null {
  return within(container).queryByTestId("modal-footer-submit-button");
}

function primaryFooterButtonsIn(container: HTMLElement): Array<HTMLElement> {
  return within(within(container).getByTestId("modal-footer"))
    .queryAllByRole("button")
    .filter((button: HTMLElement) => {
      return button.className.split(/\s+/).includes(PRIMARY_CLASS);
    });
}

describe("A stepped edit form", () => {
  beforeEach(() => {
    cleanup();
    getItemMock.mockReset();
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });
    getItemMock.mockResolvedValue(loadedProbe());
  });

  test("offers a plain Next on its first step, and no Save Changes: nothing primary", async () => {
    await openEditDialog();

    expect(activeStep()).toBe("About");
    expect(submitButtonIn(dialog())).not.toBeInTheDocument();
    expect(nextButtonIn(dialog())).toHaveTextContent("Next");
    expect(nextButtonIn(dialog())!.className).toContain(PLAIN_CLASS);
    expect(primaryFooterButtonsIn(dialog())).toEqual([]);
    // No Back button: that stays removed from stepped forms (b61a6b656d).
    expect(
      within(dialog()).queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });

  test("walks on with Next, and offers Save Changes on the last step only", async () => {
    const user: UserEvent = await openEditDialog();

    await user.click(nextButtonIn(dialog())!);
    await waitFor(() => {
      expect(activeStep()).toBe("Identity");
    });
    expect(within(dialog()).getByPlaceholderText("Probe name")).toHaveValue(
      "WBHQ",
    );
    expect(submitButtonIn(dialog())).not.toBeInTheDocument();
    expect(nextButtonIn(dialog())).toBeInTheDocument();

    await user.click(nextButtonIn(dialog())!);
    await waitFor(() => {
      expect(activeStep()).toBe("Monitoring");
    });

    await waitFor(() => {
      expect(nextButtonIn(dialog())).not.toBeInTheDocument();
    });
    expect(saveButton()).toHaveTextContent("Save Changes");
    expect(saveButton().className).toContain(PRIMARY_CLASS);
    expect(primaryFooterButtonsIn(dialog())).toEqual([saveButton()]);
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("a change on the first step is saved from the last step, one click away in the step list", async () => {
    const user: UserEvent = await openEditDialog();

    fireEvent.change(
      within(dialog()).getByPlaceholderText("What this probe is for"),
      { target: { value: "The probe in the new rack" } },
    );

    await user.click(within(progress()).getByText("Monitoring"));
    await waitFor(() => {
      expect(activeStep()).toBe("Monitoring");
    });
    await waitFor(() => {
      expect(submitButtonIn(dialog())).toBeInTheDocument();
    });
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

  test("opens a step not reached yet from the step list, and back again", async () => {
    const user: UserEvent = await openEditDialog();

    await user.click(within(progress()).getByText("Monitoring"));

    await waitFor(() => {
      expect(activeStep()).toBe("Monitoring");
    });
    expect(within(dialog()).getByTestId("auto-enable-toggle")).toBeVisible();

    await user.click(within(progress()).getByText("About"));
    await waitFor(() => {
      expect(activeStep()).toBe("About");
    });
    // Back on the first step: Next again, not Save.
    expect(submitButtonIn(dialog())).not.toBeInTheDocument();
    expect(nextButtonIn(dialog())).toBeInTheDocument();
  });

  test("saves a change made on the last step", async () => {
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

  test("Save checks the steps that were skipped, and opens one that fails, with its error", async () => {
    // A record whose required name is missing - it is on the second step.
    getItemMock.mockResolvedValue(loadedProbe({ name: "" }));

    const user: UserEvent = await openEditDialog();

    await user.click(within(progress()).getByText("Monitoring"));
    await waitFor(() => {
      expect(submitButtonIn(dialog())).toBeInTheDocument();
    });
    await user.click(saveButton());

    await waitFor(() => {
      expect(activeStep()).toBe("Identity");
    });
    expect(
      await within(dialog()).findByText("Name is required."),
    ).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
    // The step it opened is not the last: Next, not Save.
    expect(submitButtonIn(dialog())).not.toBeInTheDocument();

    // Fixed where it was shown, Next walks on and Save saves.
    fireEvent.change(within(dialog()).getByPlaceholderText("Probe name"), {
      target: { value: "Server room" },
    });
    await user.click(nextButtonIn(dialog())!);
    await waitFor(() => {
      expect(activeStep()).toBe("Monitoring");
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

  test("Next stays on the step on screen when a field on it fails", async () => {
    const user: UserEvent = await openEditDialog();

    await user.click(within(progress()).getByText("Identity"));
    await waitFor(() => {
      expect(activeStep()).toBe("Identity");
    });

    fireEvent.change(within(dialog()).getByPlaceholderText("Probe name"), {
      target: { value: "" },
    });
    await user.click(nextButtonIn(dialog())!);

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

  function createProgress(): HTMLElement {
    return within(createDialog()).getByRole("navigation", {
      name: "Progress",
    });
  }

  function createActiveStep(): string {
    return (
      createProgress().querySelector('[aria-current="step"]')?.textContent || ""
    );
  }

  test("walks with a plain Next, and offers no action, on every step but the last", async () => {
    const user: UserEvent = await openCreateDialog();

    await waitFor(() => {
      expect(nextButtonIn(createDialog())).toBeInTheDocument();
    });
    expect(submitButtonIn(createDialog())).not.toBeInTheDocument();
    expect(primaryFooterButtonsIn(createDialog())).toEqual([]);

    await user.click(nextButtonIn(createDialog())!);
    fireEvent.change(
      await within(createDialog()).findByPlaceholderText("Probe name"),
      { target: { value: "Server room" } },
    );

    /*
     * Only the Monitoring step is left, and its switch has a default - the
     * action still waits for the last step.
     */
    expect(submitButtonIn(createDialog())).not.toBeInTheDocument();
    expect(
      within(createDialog()).queryByRole("button", { name: "Create Probe" }),
    ).not.toBeInTheDocument();
    expect(nextButtonIn(createDialog())).toHaveTextContent("Next");
    expect(primaryFooterButtonsIn(createDialog())).toEqual([]);

    await user.click(nextButtonIn(createDialog())!);
    await within(createDialog()).findByTestId("auto-enable-toggle");

    await waitFor(() => {
      expect(nextButtonIn(createDialog())).not.toBeInTheDocument();
    });
    expect(submitButtonIn(createDialog())).toHaveTextContent("Create Probe");
    expect(primaryFooterButtonsIn(createDialog())).toEqual([
      submitButtonIn(createDialog()),
    ]);
    expect(
      within(createDialog()).queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("creates from the last step with what every step holds", async () => {
    const user: UserEvent = await openCreateDialog();

    fireEvent.change(
      within(createDialog()).getByPlaceholderText("What this probe is for"),
      { target: { value: "The probe in the server room" } },
    );
    await user.click(nextButtonIn(createDialog())!);
    fireEvent.change(
      await within(createDialog()).findByPlaceholderText("Probe name"),
      { target: { value: "Server room" } },
    );
    await user.click(nextButtonIn(createDialog())!);
    await within(createDialog()).findByTestId("auto-enable-toggle");
    await waitFor(() => {
      expect(submitButtonIn(createDialog())).toBeInTheDocument();
    });

    await user.click(submitButtonIn(createDialog())!);

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(submitted()["name"]).toBe("Server room");
    expect(submitted()["description"]).toBe("The probe in the server room");
    // The Monitoring step's switch, at the model's default.
    expect(submitted()["shouldAutoEnableProbeOnNewMonitors"]).toBe(
      new Probe().getTableColumnMetadata("shouldAutoEnableProbeOnNewMonitors")
        .defaultValue ?? false,
    );
  });

  test("Next asks for the empty name on its step, and does not walk on", async () => {
    const user: UserEvent = await openCreateDialog();

    await user.click(nextButtonIn(createDialog())!);
    await within(createDialog()).findByPlaceholderText("Probe name");

    await user.click(nextButtonIn(createDialog())!);

    expect(
      await within(createDialog()).findByText("Name is required."),
    ).toBeVisible();
    expect(createActiveStep()).toBe("Identity");
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("still cannot skip to a step not reached yet", async () => {
    const user: UserEvent = await openCreateDialog();

    await user.click(within(createProgress()).getByText("Monitoring"));

    expect(
      within(createDialog()).getByPlaceholderText("What this probe is for"),
    ).toBeVisible();
    expect(
      within(createDialog()).queryByTestId("auto-enable-toggle"),
    ).not.toBeInTheDocument();
    expect(submitButtonIn(createDialog())).not.toBeInTheDocument();
  });
});
