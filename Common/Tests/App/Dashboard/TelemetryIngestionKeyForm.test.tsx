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
import TelemetryIngestionKeys from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/TelemetryIngestionKeys";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import { ComponentProps as CodeEditorProps } from "../../../UI/Components/CodeEditor/CodeEditor";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Exercise the production page's field and step configuration through the real
 * modal, ModelForm, BasicForm, validation and summary. The table is replaced by
 * its open-create-modal state, and only transport, permissions and Monaco's
 * browser-only editor are stubbed. This catches fields that are assigned to the
 * wrong step as well as values lost between steps or omitted from submission.
 */

let isFreePlan: boolean = false;
let capturedTableProps: ModelTableProps<TelemetryIngestionKey> | null = null;
const createOrUpdateMock: MockFunction = getJestMockFunction();
const closeMock: MockFunction = getJestMockFunction();
const successMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<TelemetryIngestionKey>): ReactElement => {
      capturedTableProps = props;
      return (
        <ModelFormModal<TelemetryIngestionKey>
          title="Create New Ingestion Key"
          name="Create New Ingestion Key"
          modelType={props.modelType}
          modalWidth={props.createEditModalWidth}
          initialValues={props.createInitialValues}
          submitButtonText="Create Ingestion Key"
          onClose={closeMock}
          onSuccess={successMock}
          onBeforeCreate={props.onBeforeCreate}
          formProps={{
            id: "create-ingestion-key-form",
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

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/PayAsYouGo", () => {
  return {
    isProjectOnFreePlan: (): boolean => {
      return isFreePlan;
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

const NAME: string = "Storefront telemetry";
const DESCRIPTION: string = "Production website and collector telemetry";
const ORIGINS: string = '["https://app.example.com", "https://*.example.org"]';
const SERVICE: string = "storefront-web";

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Create New Ingestion Key" });
}

function progress(): HTMLElement {
  return within(dialog()).getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
}

async function renderWizard(): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <TelemetryIngestionKeys
          pageRoute={new Route("/settings/telemetry-ingestion-keys")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
  await screen.findByPlaceholderText("Ingestion Key Name");
  await waitFor(() => {
    expect(dialog()).toBeVisible();
  });
  return userEvent.setup({ delay: null });
}

async function next(user: UserEvent): Promise<void> {
  await user.click(within(dialog()).getByRole("button", { name: "Next" }));
}

async function enterDetails(
  user: UserEvent,
  description?: string,
): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText("Ingestion Key Name"), {
    target: { value: NAME },
  });
  if (description) {
    fireEvent.change(screen.getByPlaceholderText("Ingestion Key Description"), {
      target: { value: description },
    });
  }
  await next(user);
  await screen.findByRole("radiogroup", { name: "Key Type" });
}

async function selectType(
  user: UserEvent,
  keyType: TelemetryIngestionKeyType,
): Promise<void> {
  await user.click(screen.getByTestId(`card-select-option-${keyType}`));
  await waitFor(() => {
    expect(screen.getByTestId(`card-select-option-${keyType}`)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    if (keyType === TelemetryIngestionKeyType.Browser) {
      expect(within(progress()).getByText("Browser Settings")).toBeVisible();
    } else {
      expect(
        within(progress()).queryByText("Browser Settings"),
      ).not.toBeInTheDocument();
    }
  });
}

async function enterBrowserSettings(user: UserEvent): Promise<void> {
  await selectType(user, TelemetryIngestionKeyType.Browser);
  await next(user);
  await screen.findByRole("textbox", { name: "Allowed Origins" });
}

async function goBackTo(user: UserEvent, title: string): Promise<void> {
  await user.click(within(progress()).getByText(title));
  await waitFor(() => {
    expect(activeStep()).toBe(title);
  });
}

async function expectSummary(): Promise<void> {
  await waitFor(() => {
    expect(activeStep()).toBe("Summary");
  });
  expect(
    within(dialog()).getByRole("button", { name: "Create Ingestion Key" }),
  ).toBeEnabled();
  expect(createOrUpdateMock).not.toHaveBeenCalled();
}

async function submit(user: UserEvent): Promise<TelemetryIngestionKey> {
  await user.click(
    within(dialog()).getByRole("button", { name: "Create Ingestion Key" }),
  );
  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });
  return (
    createOrUpdateMock.mock.calls[0]?.[0] as {
      model: TelemetryIngestionKey;
    }
  ).model;
}

describe("Telemetry ingestion key creation wizard", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    isFreePlan = false;
    capturedTableProps = null;
    createOrUpdateMock.mockReset().mockResolvedValue({ data: {} });
    closeMock.mockReset();
    successMock.mockReset();
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID("11111111-1111-4111-8111-111111111111"));
    jest
      .spyOn(Navigation, "getCurrentRoute")
      .mockReturnValue(new Route("/settings/telemetry-ingestion-keys"));
  });

  afterEach(() => {
    cleanup();
  });

  test("opens with only name and description and cannot skip to an unfinished step", async () => {
    const user: UserEvent = await renderWizard();
    expect(screen.getByPlaceholderText("Ingestion Key Name")).toBeVisible();
    expect(
      screen.getByPlaceholderText("Ingestion Key Description"),
    ).toBeVisible();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Allowed Origins" }),
    ).not.toBeInTheDocument();
    expect(
      within(progress()).queryByText("Browser Settings"),
    ).not.toBeInTheDocument();
    expect(within(progress()).queryByText("Billing")).not.toBeInTheDocument();
    expect(
      within(dialog()).queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(capturedTableProps?.formSteps?.[0]?.id).toBe("details");

    await user.click(within(progress()).getByText("Key Type"));
    await user.click(within(progress()).getByText("Summary"));

    expect(screen.getByPlaceholderText("Ingestion Key Name")).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test.each(["", "A", "   "])(
    "keeps invalid name %j on the details step with an inline error",
    async (name: string) => {
      const user: UserEvent = await renderWizard();
      if (name) {
        await user.type(
          screen.getByPlaceholderText("Ingestion Key Name"),
          name,
        );
      }
      await next(user);

      expect(
        await screen.findByText(
          name ? /Name cannot be less than 2/ : "Name is required.",
        ),
      ).toBeVisible();
      expect(screen.getByPlaceholderText("Ingestion Key Name")).toBeVisible();
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    },
  );

  test("keeps key type on its own step and defaults to a server key", async () => {
    const user: UserEvent = await renderWizard();
    await enterDetails(user, DESCRIPTION);

    expect(
      screen.queryByPlaceholderText("Ingestion Key Name"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Ingestion Key Description"),
    ).not.toBeInTheDocument();
    expect(activeStep()).toBe("Key Type");
    expect(screen.getByTestId("card-select-option-Server")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("card-select-option-Browser")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      screen.queryByRole("textbox", { name: "Allowed Origins" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(SERVICE)).not.toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("reviews and submits a server key without requiring a description or browser settings", async () => {
    const user: UserEvent = await renderWizard();
    await enterDetails(user);
    await next(user);
    await expectSummary();

    expect(within(dialog()).getByText(NAME)).toBeVisible();
    expect(
      within(dialog()).queryByText("Allowed Origins"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog()).queryByText("Pinned Service Name"),
    ).not.toBeInTheDocument();
    const model: TelemetryIngestionKey = await submit(user);
    expect(model.name).toBe(NAME);
    expect(model.description || "").toBe("");
    expect(model.keyType).toBe(TelemetryIngestionKeyType.Server);
    expect(model.allowedOrigins).toBeFalsy();
    expect(model.pinnedServiceName).toBeFalsy();
    expect(successMock).toHaveBeenCalledTimes(1);
  });

  test("selects a key type with the keyboard without submitting or advancing the wizard", async () => {
    const user: UserEvent = await renderWizard();
    await enterDetails(user);
    const browser: HTMLElement = screen.getByTestId(
      "card-select-option-Browser",
    );
    browser.focus();
    await user.keyboard("{Enter}");

    expect(browser).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("card-select-option-Server")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(activeStep()).toBe("Key Type");
    expect(createOrUpdateMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(within(progress()).getByText("Browser Settings")).toBeVisible();
    });
    await next(user);
    expect(activeStep()).toBe("Browser Settings");
  });

  test("preserves details when revisiting a completed step and submits the edited values", async () => {
    const user: UserEvent = await renderWizard();
    await enterDetails(user, DESCRIPTION);
    await user.click(within(dialog()).getByRole("button", { name: "Back" }));
    expect(activeStep()).toBe("Details");

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Ingestion Key Name")).toHaveValue(
        NAME,
      );
      expect(
        screen.getByPlaceholderText("Ingestion Key Description"),
      ).toHaveValue(DESCRIPTION);
    });
    await user.type(screen.getByPlaceholderText("Ingestion Key Name"), " v2");
    await next(user);
    await next(user);
    await expectSummary();

    const model: TelemetryIngestionKey = await submit(user);
    expect(model.name).toBe(`${NAME} v2`);
    expect(model.description).toBe(DESCRIPTION);
  });

  test("reveals browser settings only after choosing a browser key and leaving the type step", async () => {
    const user: UserEvent = await renderWizard();
    await enterDetails(user);
    await selectType(user, TelemetryIngestionKeyType.Browser);

    expect(within(progress()).getByText("Browser Settings")).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Allowed Origins" }),
    ).not.toBeInTheDocument();
    await next(user);

    expect(
      await screen.findByRole("textbox", { name: "Allowed Origins" }),
    ).toBeVisible();
    expect(screen.getByPlaceholderText(SERVICE)).toBeVisible();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(activeStep()).toBe("Browser Settings");
  });

  test("requires allowed origins on the browser step and rejects malformed JSON before review", async () => {
    const user: UserEvent = await renderWizard();
    await enterDetails(user);
    await enterBrowserSettings(user);
    await next(user);
    expect(
      await screen.findByText("Allowed Origins is required."),
    ).toBeVisible();
    expect(activeStep()).toBe("Browser Settings");

    fireEvent.change(screen.getByRole("textbox", { name: "Allowed Origins" }), {
      target: { value: '["https://app.example.com"' },
    });
    await next(user);
    expect(
      await screen.findByText(/Allowed Origins is not valid JSON/),
    ).toBeVisible();
    expect(activeStep()).toBe("Browser Settings");
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test.each([true, false])(
    "reviews and submits a browser key with optional service pin populated=%s",
    async (withService: boolean) => {
      const user: UserEvent = await renderWizard();
      await enterDetails(user, DESCRIPTION);
      await enterBrowserSettings(user);
      fireEvent.change(
        screen.getByRole("textbox", { name: "Allowed Origins" }),
        {
          target: { value: ORIGINS },
        },
      );
      if (withService) {
        fireEvent.change(screen.getByPlaceholderText(SERVICE), {
          target: { value: SERVICE },
        });
      }
      await next(user);
      await expectSummary();

      expect(within(dialog()).getByText(NAME)).toBeVisible();
      expect(within(dialog()).getByText("Allowed Origins")).toBeVisible();
      const model: TelemetryIngestionKey = await submit(user);
      expect(model.name).toBe(NAME);
      expect(model.description).toBe(DESCRIPTION);
      expect(model.keyType).toBe(TelemetryIngestionKeyType.Browser);
      expect(model.allowedOrigins).toEqual(JSON.parse(ORIGINS));
      expect(model.pinnedServiceName || "").toBe(withService ? SERVICE : "");
    },
  );

  test("blocks empty lists, non-array JSON, non-text entries and origin URLs with paths", async () => {
    const user: UserEvent = await renderWizard();
    await enterDetails(user);
    await enterBrowserSettings(user);
    for (const origins of [
      "[]",
      "{}",
      '["https://app.example.com", 17]',
      '["https://app.example.com/path"]',
    ]) {
      fireEvent.change(
        screen.getByRole("textbox", { name: "Allowed Origins" }),
        { target: { value: origins } },
      );
      await next(user);

      expect(activeStep()).toBe("Browser Settings");
      expect(within(dialog()).getByRole("alert")).toBeVisible();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    }
  });

  test("retains browser settings on backward navigation and omits their step and summary after switching to server", async () => {
    const user: UserEvent = await renderWizard();
    await enterDetails(user);
    await enterBrowserSettings(user);
    fireEvent.change(screen.getByRole("textbox", { name: "Allowed Origins" }), {
      target: { value: ORIGINS },
    });
    fireEvent.change(screen.getByPlaceholderText(SERVICE), {
      target: { value: SERVICE },
    });
    await goBackTo(user, "Key Type");
    await next(user);

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "Allowed Origins" }),
      ).toHaveValue(ORIGINS);
      expect(screen.getByPlaceholderText(SERVICE)).toHaveValue(SERVICE);
    });
    await goBackTo(user, "Key Type");
    await selectType(user, TelemetryIngestionKeyType.Server);
    expect(
      within(progress()).queryByText("Browser Settings"),
    ).not.toBeInTheDocument();
    await next(user);
    await expectSummary();

    expect(
      within(dialog()).queryByText("Allowed Origins"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog()).queryByText("Pinned Service Name"),
    ).not.toBeInTheDocument();
    const model: TelemetryIngestionKey = await submit(user);
    expect(model.keyType).toBe(TelemetryIngestionKeyType.Server);
    expect(model.allowedOrigins).toBeFalsy();
    expect(model.pinnedServiceName).toBeFalsy();
  });

  test("discards malformed browser drafts before submitting a server key", async () => {
    const user: UserEvent = await renderWizard();
    await enterDetails(user);
    await enterBrowserSettings(user);
    fireEvent.change(screen.getByRole("textbox", { name: "Allowed Origins" }), {
      target: { value: '["https://app.example.com"' },
    });
    fireEvent.change(screen.getByPlaceholderText(SERVICE), {
      target: { value: SERVICE },
    });
    await next(user);
    expect(
      await screen.findByText(/Allowed Origins is not valid JSON/),
    ).toBeVisible();
    await goBackTo(user, "Key Type");
    await selectType(user, TelemetryIngestionKeyType.Server);
    await next(user);
    await expectSummary();

    const model: TelemetryIngestionKey = await submit(user);
    expect(model.keyType).toBe(TelemetryIngestionKeyType.Server);
    expect(model.allowedOrigins).toBeFalsy();
    expect(model.pinnedServiceName).toBeFalsy();
  });

  test("requires fresh browser settings when switching back from a server key", async () => {
    const user: UserEvent = await renderWizard();
    await enterDetails(user);
    await enterBrowserSettings(user);
    fireEvent.change(screen.getByRole("textbox", { name: "Allowed Origins" }), {
      target: { value: ORIGINS },
    });
    fireEvent.change(screen.getByPlaceholderText(SERVICE), {
      target: { value: SERVICE },
    });
    await goBackTo(user, "Key Type");
    await selectType(user, TelemetryIngestionKeyType.Server);
    await selectType(user, TelemetryIngestionKeyType.Browser);
    await next(user);

    expect(
      screen.getByRole("textbox", { name: "Allowed Origins" }),
    ).toHaveValue("");
    expect(screen.getByPlaceholderText(SERVICE)).toHaveValue("");
    await next(user);
    expect(
      await screen.findByText("Allowed Origins is required."),
    ).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test.each([
    TelemetryIngestionKeyType.Server,
    TelemetryIngestionKeyType.Browser,
  ])(
    "shows Free plan pricing on a dedicated billing step before submitting a %s key",
    async (keyType: TelemetryIngestionKeyType) => {
      isFreePlan = true;
      const user: UserEvent = await renderWizard();
      expect(
        within(dialog()).queryByRole("region", { name: "Telemetry pricing" }),
      ).not.toBeInTheDocument();
      await enterDetails(user);
      expect(
        within(dialog()).queryByRole("region", { name: "Telemetry pricing" }),
      ).not.toBeInTheDocument();
      if (keyType === TelemetryIngestionKeyType.Browser) {
        await enterBrowserSettings(user);
        fireEvent.change(
          screen.getByRole("textbox", { name: "Allowed Origins" }),
          {
            target: { value: ORIGINS },
          },
        );
      }
      await next(user);

      const notice: HTMLElement = await within(dialog()).findByRole("region", {
        name: "Telemetry pricing",
      });
      expect(notice).toHaveTextContent("Session replay");
      expect(notice).toHaveTextContent("payment method");
      expect(activeStep()).toBe("Billing");
      expect(within(dialog()).queryByRole("checkbox")).not.toBeInTheDocument();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
      await next(user);
      await expectSummary();
      expect(
        within(dialog()).getByRole("region", { name: "Telemetry pricing" }),
      ).toHaveTextContent("Session replay");
      expect((await submit(user)).keyType).toBe(keyType);

      const request: {
        model: TelemetryIngestionKey;
        miscDataProps: JSONObject;
      } = createOrUpdateMock.mock.calls[0]?.[0] as {
        model: TelemetryIngestionKey;
        miscDataProps: JSONObject;
      };
      expect(request.miscDataProps).not.toHaveProperty(
        "telemetryPayAsYouGoNotice",
      );
      expect(JSON.stringify(request.model)).not.toContain(
        "telemetryPayAsYouGoNotice",
      );
    },
  );

  test("cancels from a later step without creating a key", async () => {
    const user: UserEvent = await renderWizard();
    await enterDetails(user);
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});
