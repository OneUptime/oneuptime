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
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Settings > Telemetry Ingestion Keys > Create, through the real modal,
 * ModelForm, BasicForm and validation, with the page's own form
 * (Components/Telemetry/IngestionKeyForm). The table is replaced by its
 * open-create-modal state - which also reports a create the way the table
 * does (onCreateSuccess) - and only transport, permissions and the code
 * editor are stubbed.
 *
 * What the user gets: a Server key on a paid plan is one page and one
 * click - the name already filled in, Server picked, the description folded
 * under Advanced - and the new key opens on its own page, where its secret
 * is. A Browser key walks on to its allowed origins; the Free plan to the
 * pricing, which has to be shown before the key can be created.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const KEY_ID: string = "22222222-2222-4222-8222-222222222222";

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
          onSuccess={(item: TelemetryIngestionKey): void => {
            successMock(item);
            props.onCreateSuccess?.(item, ModalType.Create);
          }}
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

const ORIGINS: string = '["https://app.example.com", "https://*.example.org"]';
const SERVICE: string = "storefront-web";

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Create New Ingestion Key" });
}

function nameInput(): HTMLElement {
  return within(dialog()).getByPlaceholderText("Ingestion Key Name");
}

function descriptionInput(): HTMLElement {
  return within(dialog()).getByPlaceholderText("Ingestion Key Description");
}

// The dialog's action, Create Ingestion Key: on the last step only.
function mainButton(): HTMLElement {
  return within(dialog()).getByTestId("modal-footer-submit-button");
}

function queryMainButton(): HTMLElement | null {
  return within(dialog()).queryByTestId("modal-footer-submit-button");
}

// The plain Next every step but the last shows instead.
function queryNextButton(): HTMLElement | null {
  return within(dialog()).queryByTestId("modal-footer-next-button");
}

function progress(): HTMLElement | null {
  return within(dialog()).queryByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress()?.querySelector('[aria-current="step"]')?.textContent || "";
}

function stepTitles(): Array<string> {
  const list: HTMLElement | null = progress();

  if (!list) {
    return [];
  }

  return within(list)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

// The Advanced header on the step on screen.
function advancedHeader(): HTMLElement {
  return within(dialog()).getByRole("button", { name: /^Advanced/ });
}

function card(keyType: TelemetryIngestionKeyType): HTMLElement {
  return within(dialog()).getByTestId(`card-select-option-${keyType}`);
}

async function renderPage(): Promise<UserEvent> {
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
    expect(nameInput()).toHaveValue("Server key");
  });
  /*
   * An input shows its field's default before BasicForm has taken it into
   * its values, and BasicForm never fills in a form someone has typed into:
   * let it settle before typing.
   */
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
  return userEvent.setup({ delay: null });
}

async function pickType(
  user: UserEvent,
  keyType: TelemetryIngestionKeyType,
): Promise<void> {
  await user.click(card(keyType));
  await waitFor(() => {
    expect(card(keyType)).toHaveAttribute("aria-checked", "true");
  });
}

async function goToBrowserSettings(user: UserEvent): Promise<void> {
  await pickType(user, TelemetryIngestionKeyType.Browser);
  await waitFor(() => {
    expect(queryNextButton()).toHaveTextContent("Next");
  });
  expect(queryMainButton()).not.toBeInTheDocument();
  await user.click(queryNextButton()!);
  await within(dialog()).findByRole("textbox", { name: "Allowed Origins" });
  await waitFor(() => {
    expect(activeStep()).toBe("Browser Settings");
  });
}

function originsInput(): HTMLElement {
  return within(dialog()).getByRole("textbox", { name: "Allowed Origins" });
}

interface CreateRequest {
  model: TelemetryIngestionKey;
  miscDataProps: JSONObject;
}

async function create(user: UserEvent): Promise<CreateRequest> {
  await waitFor(() => {
    expect(mainButton()).toHaveTextContent("Create Ingestion Key");
  });
  await user.click(mainButton());
  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    expect(successMock).toHaveBeenCalledTimes(1);
  });
  return createOrUpdateMock.mock.calls[0]?.[0] as CreateRequest;
}

describe("Settings > Telemetry Ingestion Keys > Create", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    isFreePlan = false;
    capturedTableProps = null;
    createOrUpdateMock.mockReset().mockResolvedValue({
      data: { _id: KEY_ID, name: "Server key" },
    });
    closeMock.mockReset();
    successMock.mockReset();
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    jest
      .spyOn(Navigation, "getCurrentRoute")
      .mockReturnValue(new Route("/settings/telemetry-ingestion-keys"));
    jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  });

  afterEach(() => {
    cleanup();
  });

  describe("a Server key on a paid plan", () => {
    test("is one page: the name filled in, Server picked, the description folded, nothing to walk", async () => {
      await renderPage();

      expect(nameInput()).toBeVisible();
      expect(nameInput()).toHaveValue("Server key");
      expect(
        within(dialog()).getByRole("radiogroup", { name: "Key Type" }),
      ).toBeVisible();
      expect(card(TelemetryIngestionKeyType.Server)).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(card(TelemetryIngestionKeyType.Browser)).toHaveAttribute(
        "aria-checked",
        "false",
      );

      // Description is under a folded Advanced header.
      expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
      expect(descriptionInput()).not.toBeVisible();

      // One page: no step list, no "Step 1 of 1", no Summary, no Back.
      expect(progress()).not.toBeInTheDocument();
      expect(
        within(dialog()).queryByText(/Step \d+ of \d+/),
      ).not.toBeInTheDocument();
      expect(within(dialog()).queryByText("Summary")).not.toBeInTheDocument();
      expect(
        within(dialog()).queryByRole("button", { name: "Back" }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog()).queryByTestId("modal-footer-next-button"),
      ).not.toBeInTheDocument();
      expect(mainButton()).toHaveTextContent("Create Ingestion Key");

      // Nothing of a Browser key is asked of a Server key.
      expect(
        within(dialog()).queryByRole("textbox", { name: "Allowed Origins" }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog()).queryByPlaceholderText(SERVICE),
      ).not.toBeInTheDocument();
      expect(capturedTableProps?.formSummary).toBeUndefined();
    });

    test("is created with one click, as it was filled in", async () => {
      const user: UserEvent = await renderPage();
      const request: CreateRequest = await create(user);

      expect(request.model.name).toBe("Server key");
      expect(request.model.keyType).toBe(TelemetryIngestionKeyType.Server);
      expect(request.model.description || "").toBe("");
      expect(request.model.allowedOrigins).toBeFalsy();
      expect(request.model.pinnedServiceName).toBeFalsy();
      expect(request.miscDataProps).not.toHaveProperty(
        "telemetryPayAsYouGoNotice",
      );
    });

    test("then opens on its own page, where its secret is", async () => {
      const user: UserEvent = await renderPage();
      await create(user);

      await waitFor(() => {
        expect(Navigation.navigate).toHaveBeenCalledTimes(1);
      });
      const route: Route = jest.mocked(Navigation.navigate).mock
        .calls[0]?.[0] as Route;
      expect(route.toString()).toBe(
        `/dashboard/${PROJECT_ID}/settings/telemetry-ingestion-keys/${KEY_ID}`,
      );
    });

    test("a name of one's own and a description are sent", async () => {
      const user: UserEvent = await renderPage();

      fireEvent.change(nameInput(), {
        target: { value: "Production collectors" },
      });
      await user.click(advancedHeader());
      expect(descriptionInput()).toBeVisible();
      fireEvent.change(descriptionInput(), {
        target: { value: "The collectors in eu-west-1." },
      });

      const request: CreateRequest = await create(user);
      expect(request.model.name).toBe("Production collectors");
      expect(request.model.description).toBe("The collectors in eu-west-1.");
      expect(request.model.keyType).toBe(TelemetryIngestionKeyType.Server);
    });

    test.each(["", "A", "   "])(
      "the name %j is refused under the field, and nothing is created",
      async (name: string) => {
        const user: UserEvent = await renderPage();

        fireEvent.change(nameInput(), { target: { value: name } });
        await user.click(mainButton());

        expect(
          await within(dialog()).findByText(
            name ? /Name cannot be less than 2/ : "Name is required.",
          ),
        ).toBeVisible();
        expect(createOrUpdateMock).not.toHaveBeenCalled();
        expect(Navigation.navigate).not.toHaveBeenCalled();
      },
    );

    test("Cancel closes without creating a key", async () => {
      const user: UserEvent = await renderPage();

      await user.click(
        within(dialog()).getByRole("button", { name: "Cancel" }),
      );

      expect(closeMock).toHaveBeenCalledTimes(1);
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("the name follows the type", () => {
    test("until a name of one's own is typed", async () => {
      const user: UserEvent = await renderPage();

      await pickType(user, TelemetryIngestionKeyType.Browser);
      await waitFor(() => {
        expect(nameInput()).toHaveValue("Browser key");
      });

      await pickType(user, TelemetryIngestionKeyType.Server);
      await waitFor(() => {
        expect(nameInput()).toHaveValue("Server key");
      });

      fireEvent.change(nameInput(), { target: { value: "Storefront" } });
      await pickType(user, TelemetryIngestionKeyType.Browser);
      expect(nameInput()).toHaveValue("Storefront");

      await pickType(user, TelemetryIngestionKeyType.Server);
      expect(nameInput()).toHaveValue("Storefront");
    });

    test("and picks it up again once the name is cleared", async () => {
      const user: UserEvent = await renderPage();

      fireEvent.change(nameInput(), { target: { value: "" } });
      await pickType(user, TelemetryIngestionKeyType.Browser);

      await waitFor(() => {
        expect(nameInput()).toHaveValue("Browser key");
      });
    });

    test("choosing the type with the keyboard neither submits nor walks on", async () => {
      const user: UserEvent = await renderPage();
      const browser: HTMLElement = card(TelemetryIngestionKeyType.Browser);

      browser.focus();
      await user.keyboard("{Enter}");

      expect(browser).toHaveAttribute("aria-checked", "true");
      expect(createOrUpdateMock).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(nameInput()).toHaveValue("Browser key");
      });
      expect(nameInput()).toBeVisible();
    });
  });

  describe("a Browser key", () => {
    test("brings its Browser Settings step: the step list appears, and Key offers a plain Next instead of Create", async () => {
      const user: UserEvent = await renderPage();

      await pickType(user, TelemetryIngestionKeyType.Browser);

      await waitFor(() => {
        expect(stepTitles()).toEqual(["Key", "Browser Settings"]);
      });
      expect(activeStep()).toBe("Key");
      // Key is not the last step now: Next, and no Create.
      await waitFor(() => {
        expect(queryNextButton()).toHaveTextContent("Next");
      });
      expect(queryMainButton()).not.toBeInTheDocument();
      expect(
        within(dialog()).queryByRole("textbox", { name: "Allowed Origins" }),
      ).not.toBeInTheDocument();
    });

    test("asks for the origins, with the pinned service name folded under Advanced", async () => {
      const user: UserEvent = await renderPage();
      await goToBrowserSettings(user);

      expect(originsInput()).toBeVisible();
      expect(within(dialog()).getByPlaceholderText(SERVICE)).not.toBeVisible();
      expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
      expect(
        within(dialog()).queryByPlaceholderText("Ingestion Key Name"),
      ).not.toBeInTheDocument();
      expect(
        within(dialog()).queryByRole("radiogroup", { name: "Key Type" }),
      ).not.toBeInTheDocument();
    });

    test("refuses missing, malformed and unusable origins under the field", async () => {
      const user: UserEvent = await renderPage();
      await goToBrowserSettings(user);

      await user.click(mainButton());
      expect(
        await within(dialog()).findByText("Allowed Origins is required."),
      ).toBeVisible();

      for (const [value, error] of [
        ['["https://app.example.com"', /Allowed Origins is not valid JSON/],
        ["[]", /at least one allowed origin/],
        ['{"origin":"https://app.example.com"}', /at least one allowed origin/],
        ['["https://app.example.com", 17]', /must be text/],
        ['["https://app.example.com/path"]', /must not contain a path/],
      ] as Array<[string, RegExp]>) {
        fireEvent.change(originsInput(), { target: { value } });
        await user.click(mainButton());

        expect(await within(dialog()).findByText(error)).toBeVisible();
        expect(activeStep()).toBe("Browser Settings");
        expect(createOrUpdateMock).not.toHaveBeenCalled();
      }
    });

    test.each([true, false])(
      "is created with its origins, the pinned service name filled in: %s",
      async (withService: boolean) => {
        const user: UserEvent = await renderPage();
        await goToBrowserSettings(user);

        fireEvent.change(originsInput(), { target: { value: ORIGINS } });
        if (withService) {
          await user.click(advancedHeader());
          fireEvent.change(within(dialog()).getByPlaceholderText(SERVICE), {
            target: { value: SERVICE },
          });
        }

        const request: CreateRequest = await create(user);
        expect(request.model.name).toBe("Browser key");
        expect(request.model.keyType).toBe(TelemetryIngestionKeyType.Browser);
        expect(request.model.allowedOrigins).toEqual(JSON.parse(ORIGINS));
        expect(request.model.pinnedServiceName || "").toBe(
          withService ? SERVICE : "",
        );
      },
    );

    test("switching back to Server drops the step and the drafts, and the key is a Server key", async () => {
      const user: UserEvent = await renderPage();
      await goToBrowserSettings(user);

      fireEvent.change(originsInput(), {
        target: { value: '["https://app.example.com"' },
      });
      await user.click(advancedHeader());
      fireEvent.change(within(dialog()).getByPlaceholderText(SERVICE), {
        target: { value: SERVICE },
      });

      await user.click(within(progress() as HTMLElement).getByText("Key"));
      await waitFor(() => {
        expect(activeStep()).toBe("Key");
      });
      await pickType(user, TelemetryIngestionKeyType.Server);

      // One step again: the page it started as.
      await waitFor(() => {
        expect(progress()).not.toBeInTheDocument();
      });
      expect(nameInput()).toHaveValue("Server key");

      const request: CreateRequest = await create(user);
      expect(request.model.keyType).toBe(TelemetryIngestionKeyType.Server);
      expect(request.model.allowedOrigins).toBeFalsy();
      expect(request.model.pinnedServiceName).toBeFalsy();
    });

    test("switching to Server and back asks for fresh origins", async () => {
      const user: UserEvent = await renderPage();
      await goToBrowserSettings(user);
      fireEvent.change(originsInput(), { target: { value: ORIGINS } });

      await user.click(within(progress() as HTMLElement).getByText("Key"));
      await pickType(user, TelemetryIngestionKeyType.Server);
      await pickType(user, TelemetryIngestionKeyType.Browser);
      await waitFor(() => {
        expect(queryNextButton()).toHaveTextContent("Next");
      });
      await user.click(queryNextButton()!);

      expect(
        await within(dialog()).findByRole("textbox", {
          name: "Allowed Origins",
        }),
      ).toHaveValue("");
      await user.click(mainButton());
      expect(
        await within(dialog()).findByText("Allowed Origins is required."),
      ).toBeVisible();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("on the Free plan", () => {
    test.each([
      TelemetryIngestionKeyType.Server,
      TelemetryIngestionKeyType.Browser,
    ])(
      "a %s key is created only once the pricing on the Billing step has been shown",
      async (keyType: TelemetryIngestionKeyType) => {
        isFreePlan = true;
        const user: UserEvent = await renderPage();

        expect(
          within(dialog()).queryByRole("region", {
            name: "Telemetry pricing",
          }),
        ).not.toBeInTheDocument();

        if (keyType === TelemetryIngestionKeyType.Browser) {
          await goToBrowserSettings(user);
          fireEvent.change(originsInput(), { target: { value: ORIGINS } });
        }

        /*
         * Every other step is valid, but Billing - the last step - has not
         * been shown, and Create is on the last step only.
         */
        expect(queryMainButton()).not.toBeInTheDocument();
        expect(queryNextButton()).toHaveTextContent("Next");
        await user.click(queryNextButton()!);

        const notice: HTMLElement = await within(dialog()).findByRole(
          "region",
          { name: "Telemetry pricing" },
        );
        expect(notice).toHaveTextContent("Session replay");
        expect(notice).toHaveTextContent("payment method");
        expect(activeStep()).toBe("Billing");
        expect(
          within(dialog()).queryByRole("checkbox"),
        ).not.toBeInTheDocument();
        expect(createOrUpdateMock).not.toHaveBeenCalled();

        const request: CreateRequest = await create(user);
        expect(request.model.keyType).toBe(keyType);
        expect(request.miscDataProps).not.toHaveProperty(
          "telemetryPayAsYouGoNotice",
        );
        expect(JSON.stringify(request.model)).not.toContain(
          "telemetryPayAsYouGoNotice",
        );
      },
    );

    test("the step list shows Key and Billing, and Browser Settings between them for a Browser key", async () => {
      isFreePlan = true;
      const user: UserEvent = await renderPage();

      await waitFor(() => {
        expect(stepTitles()).toEqual(["Key", "Billing"]);
      });
      await pickType(user, TelemetryIngestionKeyType.Browser);
      await waitFor(() => {
        expect(stepTitles()).toEqual(["Key", "Browser Settings", "Billing"]);
      });
    });
  });
});
