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
import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import MonitorSecretAccess from "../../../Types/Monitor/MonitorSecretAccess";
import MonitorSecretType from "../../../Types/Monitor/MonitorSecretType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import Column from "../../../UI/Components/ModelTable/Column";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  TotpAlgorithm,
  TotpParameters,
} from "../../../Utils/Totp/TotpParameters";
import { generateTotpCode } from "../../../Utils/Totp/TotpSecret";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Monitors > Settings > Secrets, a one-time code secret (issue #9703): the
 * Secret step asks what the secret holds, Text first and chosen; choosing
 * One-time code (TOTP) asks for the site's setup key or otpauth:// link
 * instead of a value, says what is wrong with it as it is typed, and shows
 * the code it makes right now - from what was typed, never from a stored
 * secret - to check against the authenticator app. Edit asks neither the
 * type nor the value; Update Secret Value asks both, the type the secret
 * has chosen, and changes the type only with a new value of that type
 * (issue #9760): each type's value has a field of its own, so what was
 * typed for one type is never sent, or previewed, as the other.
 *
 * The production page's fields go through the real modal, ModelForm,
 * BasicForm, CardSelect and validation. The table is replaced by its open
 * create (or edit) dialog; transport, permissions and translation are
 * stubbed.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SECRET_ID: string = "5ec2e700-0000-4000-8000-000000000001";

const SEED: string = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const LINK: string = `otpauth://totp/ACME:ops@example.com?secret=${SEED}&issuer=ACME&algorithm=SHA256&digits=8&period=60`;
const LINK_PARAMETERS: TotpParameters = {
  secret: SEED,
  algorithm: TotpAlgorithm.SHA256,
  digits: 8,
  periodInSeconds: 60,
};

// 15 seconds into a 60-second period, on this computer's clock.
const NOW: number = 1_700_000_040_000 + 15_000;

const SETUP_KEY_PLACEHOLDER: string =
  "otpauth://totp/... or JBSW Y3DP EHPK 3PXP";
const TEXT_VALUE_PLACEHOLDER: string =
  "Secret Value (eg: API Key, Password, etc.)";

let editingSecret: MonitorSecret | null = null;
let capturedTableProps: ModelTableProps<MonitorSecret> | null = null;
const createOrUpdateMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

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
          onClose={() => {}}
          onSuccess={() => {}}
          modelIdToEdit={isEdit ? new ObjectID(SECRET_ID) : undefined}
          formProps={{
            id: "monitor-secret-form",
            modelType: props.modelType,
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<MonitorSecret | null> => {
        return editingSecret;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
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

function dialog(name?: string): HTMLElement {
  return screen.getByRole("dialog", {
    name:
      name || (editingSecret ? "Edit Monitor Secret" : "Create Monitor Secret"),
  });
}

function typeCard(secretType: MonitorSecretType): HTMLElement {
  return screen.getByTestId(`card-select-option-${secretType}`);
}

async function renderPage(): Promise<UserEvent> {
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

  return userEvent.setup({ delay: null });
}

async function renderCreateDialog(): Promise<UserEvent> {
  const user: UserEvent = await renderPage();

  await waitFor(() => {
    expect(dialog()).toBeVisible();
  });

  return user;
}

async function chooseTotp(user: UserEvent): Promise<HTMLElement> {
  await user.click(typeCard(MonitorSecretType.TOTP));

  await waitFor(() => {
    expect(typeCard(MonitorSecretType.TOTP)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  return await screen.findByPlaceholderText(SETUP_KEY_PLACEHOLDER);
}

function grouped(code: string): string {
  return `${code.slice(0, code.length / 2)} ${code.slice(code.length / 2)}`;
}

beforeEach(() => {
  jest.restoreAllMocks();
  editingSecret = null;
  capturedTableProps = null;
  createOrUpdateMock.mockReset().mockResolvedValue({ data: {} });
  updateByIdMock.mockReset().mockResolvedValue({ data: {} });
  jest.spyOn(Date, "now").mockReturnValue(NOW);
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

describe("Create Monitor Secret: what the secret holds", () => {
  test("asks on the Secret step, with Text chosen and the value asked as before", async () => {
    await renderCreateDialog();

    expect(typeCard(MonitorSecretType.Text)).toHaveTextContent("Text");
    expect(typeCard(MonitorSecretType.TOTP)).toHaveTextContent(
      "One-time code (TOTP)",
    );
    expect(typeCard(MonitorSecretType.Text)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByPlaceholderText(TEXT_VALUE_PLACEHOLDER),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(SETUP_KEY_PLACEHOLDER),
    ).not.toBeInTheDocument();
  });

  test("asks a one-time code secret for its setup key instead of a value", async () => {
    const user: UserEvent = await renderCreateDialog();

    await chooseTotp(user);

    expect(within(dialog()).getByText("Setup Key")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(TEXT_VALUE_PLACEHOLDER),
    ).not.toBeInTheDocument();
  });

  test("shows the code the pasted link makes now, to check against the app", async () => {
    const user: UserEvent = await renderCreateDialog();
    const setupKey: HTMLElement = await chooseTotp(user);

    expect(screen.queryByTestId("totp-code-preview")).not.toBeInTheDocument();

    fireEvent.change(setupKey, { target: { value: LINK } });

    const code: string = generateTotpCode(LINK_PARAMETERS, NOW);

    expect(code).toHaveLength(8);
    expect(
      await screen.findByTestId("totp-code-preview-code"),
    ).toHaveTextContent(grouped(code));
    // 45 of the period's 60 seconds are left.
    expect(screen.getByTestId("totp-code-preview-countdown")).toHaveTextContent(
      "New code in 45 seconds",
    );
    expect(
      screen.getByText(
        "Check that it matches the code your authenticator app shows now.",
      ),
    ).toBeInTheDocument();
  });

  test("says what is wrong with a setup key, and shows no code for it", async () => {
    const user: UserEvent = await renderCreateDialog();
    const setupKey: HTMLElement = await chooseTotp(user);

    fireEvent.change(setupKey, { target: { value: "JBSW Y3DP EHPK 3PX0" } });
    fireEvent.blur(setupKey);

    expect(
      await screen.findByText(
        "A setup key has only the letters A to Z and the digits 2 to 7, and this one has 0. Check for a 0 that should be an O, or a 1 or 8 that should be an I or a B.",
      ),
    ).toBeVisible();
    expect(screen.queryByTestId("totp-code-preview")).not.toBeInTheDocument();

    // It does not go on to the Access step.
    await user.click(within(dialog()).getByRole("button", { name: "Next" }));

    expect(
      screen.queryByRole("radiogroup", {
        name: "Which monitors can use this secret?",
      }),
    ).not.toBeInTheDocument();
  });

  test("creates a one-time code secret with its type and the link as pasted", async () => {
    const user: UserEvent = await renderCreateDialog();

    fireEvent.change(await screen.findByPlaceholderText("Secret Name"), {
      target: { value: "LoginCode" },
    });

    const setupKey: HTMLElement = await chooseTotp(user);

    fireEvent.change(setupKey, { target: { value: LINK } });

    await user.click(within(dialog()).getByRole("button", { name: "Next" }));
    await user.click(
      await screen.findByTestId(
        `card-select-option-${MonitorSecretAccess.AllMonitors}`,
      ),
    );
    await user.click(
      await within(dialog()).findByRole("button", {
        name: "Create Monitor Secret",
      }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: MonitorSecret = (
      createOrUpdateMock.mock.calls[0]?.[0] as { model: MonitorSecret }
    ).model;

    expect(model.name).toBe("LoginCode");
    expect(model.secretType).toBe(MonitorSecretType.TOTP);
    // The server stores it in its canonical form (MonitorSecretService).
    expect(model.secretValue).toBe(LINK);
  });

  test("creates a Text secret as before, with its type", async () => {
    const user: UserEvent = await renderCreateDialog();

    fireEvent.change(await screen.findByPlaceholderText("Secret Name"), {
      target: { value: "ApiKey" },
    });
    fireEvent.change(screen.getByPlaceholderText(TEXT_VALUE_PLACEHOLDER), {
      target: { value: "sk_live_123" },
    });

    await user.click(within(dialog()).getByRole("button", { name: "Next" }));
    await user.click(
      await screen.findByTestId(
        `card-select-option-${MonitorSecretAccess.AllMonitors}`,
      ),
    );
    await user.click(
      await within(dialog()).findByRole("button", {
        name: "Create Monitor Secret",
      }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: MonitorSecret = (
      createOrUpdateMock.mock.calls[0]?.[0] as { model: MonitorSecret }
    ).model;

    expect(model.secretType).toBe(MonitorSecretType.Text);
    expect(model.secretValue).toBe("sk_live_123");
  });
});

describe("a secret that exists", () => {
  function storedSecret(secretType: MonitorSecretType): MonitorSecret {
    const secret: MonitorSecret = new MonitorSecret(new ObjectID(SECRET_ID));
    secret.name = "LoginCode";
    secret.secretType = secretType;
    secret.monitorAccess = MonitorSecretAccess.AllMonitors;
    return secret;
  }

  test("is edited without asking its type or its value", async () => {
    editingSecret = storedSecret(MonitorSecretType.TOTP);

    await renderPage();
    await screen.findByDisplayValue("LoginCode");

    expect(
      screen.queryByTestId(`card-select-option-${MonitorSecretType.TOTP}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(SETUP_KEY_PLACEHOLDER),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(TEXT_VALUE_PLACEHOLDER),
    ).not.toBeInTheDocument();
  });

  test("shows its type in the table", async () => {
    await renderPage();

    const typeColumn: Column<MonitorSecret> | undefined =
      capturedTableProps!.columns.find((column: Column<MonitorSecret>) => {
        return column.title === "Type";
      });

    render(
      <div>
        {typeColumn!.getElement!(storedSecret(MonitorSecretType.TOTP))}
      </div>,
    );
    render(
      <div>
        {typeColumn!.getElement!(storedSecret(MonitorSecretType.Text))}
      </div>,
    );
    // A secret read before types existed is Text.
    render(<div>{typeColumn!.getElement!(new MonitorSecret())}</div>);

    expect(
      screen.getAllByTestId("monitor-secret-type").map((cell: HTMLElement) => {
        return cell.textContent;
      }),
    ).toEqual(["One-time code (TOTP)", "Text", "Text"]);
  });

  test("of the one-time code type is given a new setup key, with its code shown", async () => {
    const user: UserEvent = await renderPage();

    await act(async (): Promise<void> => {
      capturedTableProps!.actionButtons![0]!.onClick!(
        storedSecret(MonitorSecretType.TOTP),
        () => {},
        () => {},
      );
    });

    const update: HTMLElement = await screen.findByRole("dialog", {
      name: "Update Secret Value",
    });
    const setupKey: HTMLElement = within(update).getByPlaceholderText(
      SETUP_KEY_PLACEHOLDER,
    );

    fireEvent.change(setupKey, { target: { value: SEED.toLowerCase() } });

    expect(
      await within(update).findByTestId("totp-code-preview-code"),
    ).toHaveTextContent(
      grouped(
        generateTotpCode(
          {
            secret: SEED,
            algorithm: TotpAlgorithm.SHA1,
            digits: 6,
            periodInSeconds: 30,
          },
          NOW,
        ),
      ),
    );

    await user.click(
      within(update).getByRole("button", { name: /Save|Submit|Update/ }),
    );

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    // The type it keeps goes with the value: the server reads one for the other.
    expect(
      (updateByIdMock.mock.calls[0]?.[0] as { data: JSONObject }).data,
    ).toEqual({
      secretType: MonitorSecretType.TOTP,
      secretValue: SEED.toLowerCase(),
    });
  });

  test("of the Text type is given a new value as before", async () => {
    await renderPage();

    await act(async (): Promise<void> => {
      capturedTableProps!.actionButtons![0]!.onClick!(
        storedSecret(MonitorSecretType.Text),
        () => {},
        () => {},
      );
    });

    const update: HTMLElement = await screen.findByRole("dialog", {
      name: "Update Secret Value",
    });

    expect(
      within(update).getByPlaceholderText(TEXT_VALUE_PLACEHOLDER),
    ).toBeInTheDocument();
    expect(
      within(update).queryByPlaceholderText(SETUP_KEY_PLACEHOLDER),
    ).not.toBeInTheDocument();
  });
});

describe("Update Secret Value changes a secret's type together with a new value (#9760)", () => {
  function storedSecret(secretType: MonitorSecretType): MonitorSecret {
    const secret: MonitorSecret = new MonitorSecret(new ObjectID(SECRET_ID));
    secret.name = "LoginCode";
    secret.secretType = secretType;
    secret.monitorAccess = MonitorSecretAccess.AllMonitors;
    return secret;
  }

  async function openUpdate(
    secretType: MonitorSecretType | undefined,
  ): Promise<{ user: UserEvent; update: HTMLElement }> {
    const user: UserEvent = await renderPage();
    const secret: MonitorSecret = storedSecret(MonitorSecretType.Text);

    if (secretType) {
      secret.secretType = secretType;
    } else {
      // Read before types existed: Text.
      delete (secret as unknown as { secretType?: unknown }).secretType;
    }

    await act(async (): Promise<void> => {
      capturedTableProps!.actionButtons![0]!.onClick!(
        secret,
        () => {},
        () => {},
      );
    });

    const update: HTMLElement = await screen.findByRole("dialog", {
      name: "Update Secret Value",
    });

    return { user, update };
  }

  function updateTypeCard(
    update: HTMLElement,
    secretType: MonitorSecretType,
  ): HTMLElement {
    return within(update).getByTestId(`card-select-option-${secretType}`);
  }

  async function choose(
    user: UserEvent,
    update: HTMLElement,
    secretType: MonitorSecretType,
  ): Promise<void> {
    await user.click(updateTypeCard(update, secretType));

    await waitFor(() => {
      expect(updateTypeCard(update, secretType)).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });
  }

  async function save(user: UserEvent, update: HTMLElement): Promise<void> {
    await user.click(
      within(update).getByRole("button", { name: /Save|Submit|Update/ }),
    );
  }

  function sentData(): JSONObject {
    return (updateByIdMock.mock.calls[0]?.[0] as { data: JSONObject }).data;
  }

  test("offers the type, Text first, with the secret's own type chosen", async () => {
    for (const secretType of [
      MonitorSecretType.Text,
      MonitorSecretType.TOTP,
      undefined,
    ]) {
      const { update } = await openUpdate(secretType);
      const cards: Array<string> = within(update)
        .getAllByTestId(/^card-select-option-/)
        .map((card: HTMLElement): string => {
          return card.getAttribute("data-testid") || "";
        });

      expect(cards).toEqual([
        `card-select-option-${MonitorSecretType.Text}`,
        `card-select-option-${MonitorSecretType.TOTP}`,
      ]);
      expect(
        updateTypeCard(update, secretType || MonitorSecretType.Text),
      ).toHaveAttribute("aria-checked", "true");
      expect(
        within(update).getByText(
          "Change it together with a new value below; monitors that use the secret take it at their next check.",
        ),
      ).toBeInTheDocument();

      cleanup();
    }
  });

  test("Text to One-time code: asks a setup key, shows the code it makes, and sends both", async () => {
    const { user, update } = await openUpdate(MonitorSecretType.Text);

    await choose(user, update, MonitorSecretType.TOTP);

    expect(
      within(update).queryByPlaceholderText(TEXT_VALUE_PLACEHOLDER),
    ).not.toBeInTheDocument();

    const setupKey: HTMLElement = within(update).getByPlaceholderText(
      SETUP_KEY_PLACEHOLDER,
    );

    fireEvent.change(setupKey, { target: { value: LINK } });

    expect(
      await within(update).findByTestId("totp-code-preview-code"),
    ).toHaveTextContent(grouped(generateTotpCode(LINK_PARAMETERS, NOW)));

    await save(user, update);

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(sentData()).toEqual({
      secretType: MonitorSecretType.TOTP,
      secretValue: LINK,
    });
  });

  test("One-time code to Text: asks a text value, shows no code, and sends both", async () => {
    const { user, update } = await openUpdate(MonitorSecretType.TOTP);

    await choose(user, update, MonitorSecretType.Text);

    expect(
      within(update).queryByPlaceholderText(SETUP_KEY_PLACEHOLDER),
    ).not.toBeInTheDocument();

    fireEvent.change(
      within(update).getByPlaceholderText(TEXT_VALUE_PLACEHOLDER),
      { target: { value: "a new password" } },
    );

    expect(
      within(update).queryByTestId("totp-code-preview"),
    ).not.toBeInTheDocument();

    await save(user, update);

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(sentData()).toEqual({
      secretType: MonitorSecretType.Text,
      secretValue: "a new password",
    });
  });

  test("a type changed without a new value is not sent: the value is required", async () => {
    const { user, update } = await openUpdate(MonitorSecretType.Text);

    await choose(user, update, MonitorSecretType.TOTP);
    await save(user, update);

    expect(
      await within(update).findByText(/Setup Key is required/i),
    ).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a setup key no code can be made from is refused, saying why, and not sent", async () => {
    const { user, update } = await openUpdate(MonitorSecretType.Text);

    await choose(user, update, MonitorSecretType.TOTP);

    const setupKey: HTMLElement = within(update).getByPlaceholderText(
      SETUP_KEY_PLACEHOLDER,
    );

    fireEvent.change(setupKey, {
      target: { value: `otpauth://hotp/a?secret=${SEED}&counter=0` },
    });
    fireEvent.blur(setupKey);

    expect(
      await within(update).findByText(
        "This link is for counter-based codes (HOTP). A monitor needs a time-based link, which starts with otpauth://totp/.",
      ),
    ).toBeVisible();
    expect(
      within(update).queryByTestId("totp-code-preview"),
    ).not.toBeInTheDocument();

    await save(user, update);

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a setup key typed and then switched to Text is never sent as text", async () => {
    const { user, update } = await openUpdate(MonitorSecretType.Text);

    await choose(user, update, MonitorSecretType.TOTP);
    fireEvent.change(
      within(update).getByPlaceholderText(SETUP_KEY_PLACEHOLDER),
      { target: { value: SEED } },
    );
    await choose(user, update, MonitorSecretType.Text);

    // The Text field starts empty: the key stays in the field it was typed in.
    expect(
      within(update).getByPlaceholderText(TEXT_VALUE_PLACEHOLDER),
    ).toHaveValue("");

    fireEvent.change(
      within(update).getByPlaceholderText(TEXT_VALUE_PLACEHOLDER),
      { target: { value: "hunter2" } },
    );
    await save(user, update);

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(sentData()).toEqual({
      secretType: MonitorSecretType.Text,
      secretValue: "hunter2",
    });
    expect(JSON.stringify(sentData())).not.toContain(SEED);
  });

  test("a text typed and then switched to One-time code is never shown as a code", async () => {
    const { user, update } = await openUpdate(MonitorSecretType.Text);

    // A value that would make a code, were it read as a setup key.
    fireEvent.change(
      within(update).getByPlaceholderText(TEXT_VALUE_PLACEHOLDER),
      { target: { value: SEED } },
    );

    expect(
      within(update).queryByTestId("totp-code-preview"),
    ).not.toBeInTheDocument();

    await choose(user, update, MonitorSecretType.TOTP);

    expect(
      within(update).getByPlaceholderText(SETUP_KEY_PLACEHOLDER),
    ).toHaveValue("");
    expect(
      within(update).queryByTestId("totp-code-preview"),
    ).not.toBeInTheDocument();
  });

  test("a refusal from the server is said in the dialog, which stays open", async () => {
    updateByIdMock
      .mockReset()
      .mockRejectedValue(
        new Error(
          "This is the setup key the secret holds now. A Text secret is sent as written, so the key itself would be sent where the one-time code went. Enter the new text value, or keep the type One-time code (TOTP).",
        ),
      );

    const { user, update } = await openUpdate(MonitorSecretType.TOTP);

    await choose(user, update, MonitorSecretType.Text);
    fireEvent.change(
      within(update).getByPlaceholderText(TEXT_VALUE_PLACEHOLDER),
      { target: { value: SEED } },
    );
    await save(user, update);

    expect(
      await screen.findByText(/This is the setup key the secret holds now\./),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Update Secret Value" }),
    ).toBeInTheDocument();
  });
});

describe("Create Monitor Secret: the type's help says it can change later (#9760)", () => {
  test("says Update Secret Value changes it, with a new value", async () => {
    await renderCreateDialog();

    expect(
      within(dialog()).getByText(
        "What the secret holds. Update Secret Value can change it later, together with a new value.",
      ),
    ).toBeInTheDocument();
  });
});
