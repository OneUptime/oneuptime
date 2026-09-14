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
import GoogleSecOpsConnectionsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/GoogleSecOpsConnections";
import GoogleSecOpsConnection from "../../../Models/DatabaseModels/GoogleSecOpsConnection";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ComponentProps as CodeEditorProps } from "../../../UI/Components/CodeEditor/CodeEditor";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Exercise the page's production field and step configuration through the real
 * ModelFormModal, ModelForm and BasicForm. ModelTable is reduced to its open
 * create-modal state, while only transport, permissions and Monaco's
 * browser-only editor are replaced. This makes a field assigned to the wrong
 * step, validation leaking between steps, or a value omitted at save fail here.
 */

let capturedTableProps: ModelTableProps<GoogleSecOpsConnection> | null = null;
const createOrUpdateMock: MockFunction = getJestMockFunction();
const closeMock: MockFunction = getJestMockFunction();
const successMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<GoogleSecOpsConnection>): ReactElement => {
      capturedTableProps = props;
      return (
        <ModelFormModal<GoogleSecOpsConnection>
          title="Create New Google SecOps Connection"
          name="Create New Google SecOps Connection"
          modelType={props.modelType}
          modalWidth={props.createEditModalWidth}
          initialValues={props.createInitialValues}
          submitButtonText="Create Google SecOps Connection"
          onClose={closeMock}
          onSuccess={successMock}
          onBeforeCreate={props.onBeforeCreate}
          formProps={{
            id: "create-google-secops-connection-form",
            modelType: props.modelType,
            fields: props.formFields || [],
            steps: props.formSteps || [],
            summary: props.formSummary,
            formType: FormType.Create,
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
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
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

jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: CodeEditorProps): ReactElement => {
      return (
        <>
          <textarea
            aria-labelledby={props.ariaLabelledby}
            value={props.value ?? props.initialValue ?? ""}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
              props.onChange?.(event.target.value);
            }}
            onBlur={props.onBlur}
          />
          {props.error && <span role="alert">{props.error}</span>}
        </>
      );
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NAME: string = "Production SecOps tenant";
const REGION: string = "europe";
const INSTANCE: string = "projects/acme/locations/europe/instances/chronicle";
const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  type: "service_account",
  client_email: "secops-reader@acme.example",
  private_key: "private-key-material",
});

function dialog(): HTMLElement {
  return screen.getByRole("dialog", {
    name: "Create New Google SecOps Connection",
  });
}

function progress(): HTMLElement {
  return within(dialog()).getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
}

function enabledToggle(): HTMLElement {
  return screen.getByRole("switch", { name: /^Enabled/ });
}

function detectionsToggle(): HTMLElement {
  return screen.getByRole("switch", {
    name: /^Alerts and detections/,
  });
}

function serviceAccountEditor(): HTMLElement {
  return screen.getByRole("textbox", { name: /^Service Account JSON/ });
}

function pollIntervalInput(): HTMLElement {
  return screen.getByRole("spinbutton", {
    name: /^Poll Interval \(Minutes\)/,
  });
}

async function renderWizard(): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <GoogleSecOpsConnectionsPage
          pageRoute={
            new Route("/dashboard/security-events/google-secops-connections")
          }
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
  await screen.findByPlaceholderText("e.g. Production SecOps tenant");
  await waitFor(() => {
    expect(dialog()).toBeVisible();
  });
  return userEvent.setup({ delay: null });
}

async function next(user: UserEvent): Promise<void> {
  await user.click(
    await within(dialog()).findByRole("button", { name: "Next" }),
  );
}

async function enterBasicInfo(user: UserEvent): Promise<void> {
  fireEvent.change(
    screen.getByPlaceholderText("e.g. Production SecOps tenant"),
    { target: { value: NAME } },
  );
  await next(user);
  await screen.findByPlaceholderText("us");
}

function fillGoogleSecOps(values?: {
  region?: string;
  instance?: string;
  serviceAccountJson?: string;
}): void {
  fireEvent.change(screen.getByPlaceholderText("us"), {
    target: { value: values?.region ?? REGION },
  });
  fireEvent.change(
    screen.getByPlaceholderText(
      "projects/{project}/locations/{location}/instances/{instance}",
    ),
    { target: { value: values?.instance ?? INSTANCE } },
  );
  fireEvent.change(serviceAccountEditor(), {
    target: {
      value: values?.serviceAccountJson ?? SERVICE_ACCOUNT_JSON,
    },
  });
}

async function enterPolling(user: UserEvent): Promise<void> {
  fillGoogleSecOps();
  await next(user);
  await screen.findByRole("spinbutton", {
    name: /^Poll Interval \(Minutes\)/,
  });
  await waitFor(() => {
    expect(pollIntervalInput()).toHaveValue(5);
  });
}

async function goBackTo(user: UserEvent, title: string): Promise<void> {
  await user.click(within(progress()).getByText(title));
  await waitFor(() => {
    expect(activeStep()).toBe(title);
  });
}

async function submit(user: UserEvent): Promise<GoogleSecOpsConnection> {
  await user.click(
    await within(dialog()).findByRole("button", {
      name: "Create Google SecOps Connection",
    }),
  );
  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    expect(successMock).toHaveBeenCalledTimes(1);
  });
  return (
    createOrUpdateMock.mock.calls[0]?.[0] as {
      model: GoogleSecOpsConnection;
    }
  ).model;
}

function fieldName(field: ModelField<GoogleSecOpsConnection>): string {
  return Object.keys(field.field || {})[0] || "";
}

describe("Google SecOps connection creation wizard", () => {
  beforeEach((): void => {
    jest.restoreAllMocks();
    capturedTableProps = null;
    createOrUpdateMock.mockReset().mockResolvedValue({ data: {} });
    closeMock.mockReset();
    successMock.mockReset();
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach((): void => {
    cleanup();
  });

  test("declares the exact edit-safe step and field contract", async (): Promise<void> => {
    await renderWizard();
    const steps: Array<FormStep<GoogleSecOpsConnection>> =
      capturedTableProps?.formSteps || [];
    const fields: Array<ModelField<GoogleSecOpsConnection>> =
      capturedTableProps?.formFields || [];

    expect(
      steps.map((step: FormStep<GoogleSecOpsConnection>) => {
        return { id: step.id, title: step.title };
      }),
    ).toEqual([
      { id: "basic-info", title: "Basic Info" },
      { id: "google-secops", title: "Google SecOps" },
      { id: "polling", title: "Polling" },
    ]);
    expect(capturedTableProps?.formSummary).toBeUndefined();
    expect(
      Object.fromEntries(
        steps.map((step: FormStep<GoogleSecOpsConnection>) => {
          return [
            step.id,
            fields
              .filter((field: ModelField<GoogleSecOpsConnection>) => {
                return field.stepId === step.id;
              })
              .map(fieldName),
          ];
        }),
      ),
    ).toEqual({
      "basic-info": ["name", "isEnabled"],
      "google-secops": ["region", "instanceResourceName", "serviceAccountJson"],
      polling: ["includeNonAlertingDetections", "pollIntervalInMinutes"],
    });

    for (const step of steps) {
      expect(
        fields.some((field: ModelField<GoogleSecOpsConnection>): boolean => {
          return field.stepId === step.id && !field.doNotShowWhenEditing;
        }),
      ).toBe(true);
    }

    const credential: ModelField<GoogleSecOpsConnection> | undefined =
      fields.find((field: ModelField<GoogleSecOpsConnection>): boolean => {
        return fieldName(field) === "serviceAccountJson";
      });
    expect(credential?.doNotShowWhenEditing).toBe(true);
    expect(credential?.stepId).toBe("google-secops");
    expect(
      fields
        .filter((field: ModelField<GoogleSecOpsConnection>): boolean => {
          return (
            field.stepId === credential?.stepId && !field.doNotShowWhenEditing
          );
        })
        .map(fieldName),
    ).toEqual(["region", "instanceResourceName"]);
  });

  test("isolates all three steps, reports progress, and cannot skip ahead", async (): Promise<void> => {
    const user: UserEvent = await renderWizard();

    expect(
      within(progress())
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Basic Info", "Google SecOps", "Polling"]);
    expect(activeStep()).toBe("Basic Info");
    expect(within(dialog()).getByRole("status")).toHaveTextContent(
      "Step 1 of 3",
    );
    expect(
      screen.getByPlaceholderText("e.g. Production SecOps tenant"),
    ).toBeVisible();
    expect(enabledToggle()).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByPlaceholderText("us")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /^Service Account JSON/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("spinbutton", {
        name: /^Poll Interval \(Minutes\)/,
      }),
    ).not.toBeInTheDocument();

    await user.click(within(progress()).getByText("Google SecOps"));
    await user.click(within(progress()).getByText("Polling"));
    expect(activeStep()).toBe("Basic Info");
    expect(
      screen.getByPlaceholderText("e.g. Production SecOps tenant"),
    ).toBeVisible();

    await enterBasicInfo(user);
    expect(activeStep()).toBe("Google SecOps");
    expect(within(dialog()).getByRole("status")).toHaveTextContent(
      "Step 2 of 3",
    );
    expect(screen.getByPlaceholderText("us")).toBeVisible();
    expect(
      screen.getByPlaceholderText(
        "projects/{project}/locations/{location}/instances/{instance}",
      ),
    ).toBeVisible();
    expect(serviceAccountEditor()).toBeVisible();
    expect(
      screen.queryByPlaceholderText("e.g. Production SecOps tenant"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /^Enabled/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("spinbutton", {
        name: /^Poll Interval \(Minutes\)/,
      }),
    ).not.toBeInTheDocument();

    fillGoogleSecOps();
    await next(user);
    expect(activeStep()).toBe("Polling");
    expect(within(dialog()).getByRole("status")).toHaveTextContent(
      "Step 3 of 3",
    );
    expect(detectionsToggle()).toHaveAttribute("aria-checked", "false");
    await waitFor(() => {
      expect(pollIntervalInput()).toHaveValue(5);
    });
    expect(screen.queryByPlaceholderText("us")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("e.g. Production SecOps tenant"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog()).queryByRole("button", { name: "Next" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog()).getByRole("button", {
        name: "Create Google SecOps Connection",
      }),
    ).toBeEnabled();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test.each([
    { value: "", error: "Name is required." },
    { value: "A", error: "Name cannot be less than 2 characters." },
    { value: "   ", error: "Name cannot be less than 2 characters." },
  ])(
    "keeps invalid name $value on Basic Info",
    async ({
      value,
      error,
    }: {
      value: string;
      error: string;
    }): Promise<void> => {
      const user: UserEvent = await renderWizard();
      if (value) {
        fireEvent.change(
          screen.getByPlaceholderText("e.g. Production SecOps tenant"),
          { target: { value } },
        );
      }
      await next(user);

      expect(await screen.findByText(error)).toBeVisible();
      expect(activeStep()).toBe("Basic Info");
      expect(screen.queryByPlaceholderText("us")).not.toBeInTheDocument();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    },
  );

  test("validates only the required connection fields on Google SecOps", async (): Promise<void> => {
    const user: UserEvent = await renderWizard();
    await enterBasicInfo(user);
    await next(user);

    expect(await screen.findByText("Region is required.")).toBeVisible();
    expect(
      screen.getByText("Instance Resource Name is required."),
    ).toBeVisible();
    expect(screen.getByText("Service Account JSON is required.")).toBeVisible();
    expect(activeStep()).toBe("Google SecOps");
    expect(
      screen.queryByPlaceholderText("e.g. Production SecOps tenant"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("spinbutton", {
        name: /^Poll Interval \(Minutes\)/,
      }),
    ).not.toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test.each(["{", '{"client_email":"reader@example.com",}', "credentials"])(
    "rejects malformed service-account JSON %j before Polling",
    async (serviceAccountJson: string): Promise<void> => {
      const user: UserEvent = await renderWizard();
      await enterBasicInfo(user);
      fillGoogleSecOps({ serviceAccountJson });
      await next(user);

      expect(
        await screen.findByText(/Service Account JSON is not valid JSON\./),
      ).toBeVisible();
      expect(activeStep()).toBe("Google SecOps");
      expect(
        screen.queryByRole("spinbutton", {
          name: /^Poll Interval \(Minutes\)/,
        }),
      ).not.toBeInTheDocument();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    },
  );

  test("enforces the polling interval bounds on the final step", async (): Promise<void> => {
    const user: UserEvent = await renderWizard();
    await enterBasicInfo(user);
    await enterPolling(user);

    expect(detectionsToggle()).toHaveAttribute("aria-checked", "false");
    expect(pollIntervalInput()).toHaveValue(5);

    for (const invalid of [
      { value: "", error: "Poll Interval (Minutes) is required." },
      {
        value: "0",
        error: "Poll Interval (Minutes) should not be less than 1.",
      },
      {
        value: "1441",
        error: "Poll Interval (Minutes) should not be more than 1440.",
      },
    ]) {
      fireEvent.change(pollIntervalInput(), {
        target: { value: invalid.value },
      });
      await user.click(
        within(dialog()).getByRole("button", {
          name: "Create Google SecOps Connection",
        }),
      );
      expect(await screen.findByText(invalid.error)).toBeVisible();
      expect(activeStep()).toBe("Polling");
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    }
  });

  test("submits the untouched polling and enabled defaults", async (): Promise<void> => {
    const user: UserEvent = await renderWizard();
    await enterBasicInfo(user);
    await enterPolling(user);

    const model: GoogleSecOpsConnection = await submit(user);
    expect(model.name).toBe(NAME);
    expect(model.region).toBe(REGION);
    expect(model.instanceResourceName).toBe(INSTANCE);
    expect(model.serviceAccountJson).toBe(SERVICE_ACCOUNT_JSON);
    expect(model.isEnabled).toBe(true);
    expect(model.includeNonAlertingDetections).toBe(false);
    expect(model.pollIntervalInMinutes).toBe(5);
  });

  test("preserves completed steps and submits all edited toggle and polling values", async (): Promise<void> => {
    const user: UserEvent = await renderWizard();
    await user.click(enabledToggle());
    expect(enabledToggle()).toHaveAttribute("aria-checked", "false");
    await enterBasicInfo(user);
    await enterPolling(user);

    await user.click(detectionsToggle());
    expect(detectionsToggle()).toHaveAttribute("aria-checked", "true");
    fireEvent.change(pollIntervalInput(), { target: { value: "30" } });

    await goBackTo(user, "Google SecOps");
    await waitFor(() => {
      expect(screen.getByPlaceholderText("us")).toHaveValue(REGION);
      expect(
        screen.getByPlaceholderText(
          "projects/{project}/locations/{location}/instances/{instance}",
        ),
      ).toHaveValue(INSTANCE);
      expect(serviceAccountEditor()).toHaveValue(SERVICE_ACCOUNT_JSON);
    });

    await goBackTo(user, "Basic Info");
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("e.g. Production SecOps tenant"),
      ).toHaveValue(NAME);
      expect(enabledToggle()).toHaveAttribute("aria-checked", "false");
    });

    await next(user);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("us")).toHaveValue(REGION);
      expect(serviceAccountEditor()).toHaveValue(SERVICE_ACCOUNT_JSON);
    });
    await next(user);
    await waitFor(() => {
      expect(detectionsToggle()).toHaveAttribute("aria-checked", "true");
      expect(pollIntervalInput()).toHaveValue(30);
    });

    const model: GoogleSecOpsConnection = await submit(user);
    expect(model.name).toBe(NAME);
    expect(model.isEnabled).toBe(false);
    expect(model.region).toBe(REGION);
    expect(model.instanceResourceName).toBe(INSTANCE);
    expect(model.serviceAccountJson).toBe(SERVICE_ACCOUNT_JSON);
    expect(model.includeNonAlertingDetections).toBe(true);
    expect(model.pollIntervalInMinutes).toBe(30);
    expect(
      createOrUpdateMock.mock.calls[0]?.[0] as {
        miscDataProps: JSONObject;
      },
    ).toEqual(expect.objectContaining({ miscDataProps: {} }));
  });
});
