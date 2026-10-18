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
 * An SSH credential's SSH Authentication step (Runbooks > Runners >
 * Credentials): which way it signs in first - a private key, preselected,
 * or a password - then only that one's fields, the chosen secret required.
 * An existing credential's Edit form asks no choice and offers every
 * secret, each kept when left blank (stored secrets are never read back).
 * The choice is never sent: only the key, passphrase or password.
 */

jest.setTimeout(60000);

const mockCreateOrUpdate: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return mockCreateOrUpdate(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getItem: async (): Promise<unknown> => {
        return null;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

const mockTables: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockTables.push(props);
      return null;
    },
  };
});

import RunnerCredentialsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerCredentials";
import {
  RUNNER_CREDENTIAL_TYPE_ANSWERS,
  RUNNER_CREDENTIAL_TYPE_COPY,
  SshSignIn,
  getSshSignIn,
  showsSshSecret,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerCredentialSignIn";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import ObjectID from "../../../Types/ObjectID";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

type Field = ModelField<RunbookCredential>;

const SSH: FormValues<RunbookCredential> = {
  credentialType: RunbookCredentialType.SSH,
} as FormValues<RunbookCredential>;

function capturedFields(): Array<Field> {
  render(
    <MemoryRouter>
      <RunnerCredentialsPage {...({} as unknown as PageComponentProps)} />
    </MemoryRouter>,
  );

  return mockTables[mockTables.length - 1]!["formFields"] as Array<Field>;
}

function byColumn(fields: Array<Field>, column: string): Field {
  const found: Field | undefined = fields.find((field: Field) => {
    return Object.keys(field.field || {})[0] === column;
  });

  expect(found).toBeDefined();

  return found!;
}

function isRequired(
  field: Field,
  values: FormValues<RunbookCredential>,
): boolean {
  return typeof field.required === "function"
    ? field.required(values)
    : Boolean(field.required);
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  mockTables.length = 0;
  mockCreateOrUpdate.mockReset();
  mockCreateOrUpdate.mockImplementation(
    async (request: unknown): Promise<unknown> => {
      return { data: (request as { model: unknown }).model };
    },
  );
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("11111111-1111-4111-8111-111111111111"));
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("how an SSH credential signs in", () => {
  test("the answer a form picked, or none on an Edit form", () => {
    expect(getSshSignIn({ sshSignIn: "password" })).toBe(SshSignIn.Password);
    expect(getSshSignIn({})).toBeNull();
    expect(getSshSignIn({ sshSignIn: "certificate" })).toBeNull();
    // An Edit form, which asks no choice, offers every secret.
    expect(showsSshSecret({}, SshSignIn.PrivateKey)).toBe(true);
    expect(showsSshSecret({}, SshSignIn.Password)).toBe(true);
    expect(
      showsSshSecret({ sshSignIn: "password" }, SshSignIn.PrivateKey),
    ).toBe(false);
  });

  test("the choice is a new credential's, preselected on the key", () => {
    const fields: Array<Field> = capturedFields();
    const choice: Field | undefined = fields.find((field: Field) => {
      return field.overrideFieldKey === "sshSignIn";
    });

    expect(choice).toBeDefined();
    expect(choice!.formOnly).toBe(true);
    expect(choice!.doNotShowWhenEditing).toBe(true);
    expect(choice!.defaultValue).toBe(SshSignIn.PrivateKey);
    expect(choice!.stepId).toBe("ssh-authentication");
    expect(
      (choice!.radioButtonOptions || []).map((option: { title: string }) => {
        return option.title;
      }),
    ).toEqual(["Private key", "Password"]);
    // Only for SSH: a Kubernetes credential never sees it.
    expect(choice!.showIf!(SSH)).toBe(true);
    expect(
      choice!.showIf!({
        credentialType: RunbookCredentialType.Kubernetes,
      } as FormValues<RunbookCredential>),
    ).toBe(false);
  });

  test.each([
    [
      SshSignIn.PrivateKey,
      ["sshPrivateKey", "sshPassphrase"],
      ["sshPrivateKey"],
    ],
    [SshSignIn.Password, ["sshPassword"], ["sshPassword"]],
  ])(
    "%s shows %j and requires %j",
    (signIn: SshSignIn, shown: Array<string>, required: Array<string>) => {
      const fields: Array<Field> = capturedFields();
      const values: FormValues<RunbookCredential> = {
        ...SSH,
        sshSignIn: signIn,
      } as unknown as FormValues<RunbookCredential>;
      const secrets: Array<string> = [
        "sshPrivateKey",
        "sshPassphrase",
        "sshPassword",
      ];

      expect(
        secrets.filter((column: string) => {
          return byColumn(fields, column).showIf!(values);
        }),
      ).toEqual(shown);
      expect(
        secrets.filter((column: string) => {
          return isRequired(byColumn(fields, column), values);
        }),
      ).toEqual(required);
    },
  );

  test("creating one with a password sends the password, not the choice", async () => {
    const table: Record<string, unknown> = (() => {
      capturedFields();
      return mockTables[mockTables.length - 1]!;
    })();

    cleanup();

    render(
      <MemoryRouter>
        <ModelFormModal<RunbookCredential>
          modelType={RunbookCredential}
          title="Create"
          submitButtonText="Create"
          initialValues={
            {
              credentialType: RunbookCredentialType.SSH,
            } as never
          }
          formProps={{
            name: "credential",
            id: "credential",
            modelType: RunbookCredential,
            fields: (table["formFields"] as Array<Field>).filter(
              (field: Field) => {
                return !field.doNotShowWhenCreating;
              },
            ),
            steps: table["formSteps"] as Array<FormStep<RunbookCredential>>,
            formType: FormType.Create,
          }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });
    await settle();

    const dialog: HTMLElement = screen.getByTestId("modal");

    fireEvent.change(within(dialog).getByPlaceholderText("prod-cluster"), {
      target: { value: "web-1" },
    });
    await settle();
    fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
    await settle();

    // SSH Host.
    const host: HTMLElement = within(dialog).getByRole("textbox", {
      name: /^Hostname/,
    });

    fireEvent.change(host, { target: { value: "web-1.internal" } });
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: /^Username/ }),
      {
        target: { value: "deploy" },
      },
    );
    await settle();
    fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
    await settle();

    // SSH Authentication: the key is preselected, the password hidden.
    await waitFor(() => {
      expect(
        within(dialog).getByRole("radio", { name: /^Private key/ }),
      ).toBeChecked();
    });
    expect(within(dialog).getByText("Private Key (PEM)")).toBeVisible();
    expect(within(dialog).getByText("Private Key Passphrase")).toBeVisible();
    // "Password" is the second answer only, not a field yet.
    expect(within(dialog).getAllByText("Password")).toHaveLength(1);

    fireEvent.click(within(dialog).getByRole("radio", { name: /^Password/ }));
    await settle();

    expect(within(dialog).queryByText("Private Key (PEM)")).toBeNull();
    expect(within(dialog).queryByText("Private Key Passphrase")).toBeNull();
    // The answer, and now its field.
    expect(within(dialog).getAllByText("Password")).toHaveLength(2);

    const password: HTMLElement = dialog.querySelector(
      'input[type="password"]',
    ) as HTMLElement;

    fireEvent.change(password, { target: { value: "s3cret" } });
    await settle();
    fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
    await settle();
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    });

    const saved: Record<string, unknown> = (
      mockCreateOrUpdate.mock.calls[0]![0] as { model: unknown }
    ).model as Record<string, unknown>;

    expect(saved["sshHostname"]).toBe("web-1.internal");
    expect(JSON.stringify(saved["sshPassword"])).toContain("s3cret");
    expect(saved["sshPrivateKey"]).toBeUndefined();
    expect(saved["sshSignIn"]).toBeUndefined();
  });
});

/*
 * What a credential reaches: a Type the later steps follow (SSH Host and
 * SSH Authentication, or Kubernetes). It was a dropdown of two with nothing
 * picked; it is two plain answers now, each with its line, SSH picked for a
 * new credential. The column and its values are unchanged.
 */
describe("what a credential reaches", () => {
  function table(): Record<string, unknown> {
    capturedFields();

    return mockTables[mockTables.length - 1]!;
  }

  test("is two plain answers, SSH first, each saying what it reaches", () => {
    const type: Field = byColumn(capturedFields(), "credentialType");

    expect(type.fieldType).toBe("RadioButton");
    expect(type.dropdownOptions).toBeUndefined();
    expect(
      (type.radioButtonOptions || []).map(
        (option: {
          value: unknown;
          title: string;
          description?: string | undefined;
        }) => {
          return [option.value, option.title, option.description];
        },
      ),
    ).toEqual([
      [
        RunbookCredentialType.SSH,
        "SSH",
        "A server the Runner signs in to with a key or a password.",
      ],
      [
        RunbookCredentialType.Kubernetes,
        "Kubernetes",
        "A cluster's API server, reached with a service account token.",
      ],
    ]);
    expect(RUNNER_CREDENTIAL_TYPE_ANSWERS).toEqual([
      RunbookCredentialType.SSH,
      RunbookCredentialType.Kubernetes,
    ]);
    // Every type the column has is an answer.
    expect(Object.keys(RUNNER_CREDENTIAL_TYPE_COPY).sort()).toEqual(
      Object.values(RunbookCredentialType).sort(),
    );
    // Asked once: the type cannot be changed later.
    expect(type.doNotShowWhenEditing).toBe(true);
    expect(type.required).toBe(true);
  });

  test("a new credential starts as SSH", () => {
    expect(table()["createInitialValues"]).toEqual({
      credentialType: RunbookCredentialType.SSH,
    });
  });

  test("the first step asks the name and the type; the description waits under More fields", () => {
    const fields: Array<Field> = capturedFields();
    const credentialStep: Array<string> = fields
      .filter((field: Field) => {
        return field.stepId === "credential" && !field.collapsibleSection;
      })
      .map((field: Field): string => {
        return Object.keys(field.field || {})[0] || "";
      });

    expect(credentialStep).toEqual(["name", "credentialType"]);

    const description: Field = byColumn(fields, "description");

    expect(description.collapsibleSection).toBeDefined();
    expect(description.required).toBe(false);
    // "Any friendly name of this object" and its like say nothing.
    expect(byColumn(fields, "name").hideColumnDescription).toBe(true);
    expect(description.hideColumnDescription).toBe(true);
  });

  test("in the real form, SSH is picked and its steps follow; picking Kubernetes swaps them", async () => {
    const created: Record<string, unknown> = table();

    cleanup();

    render(
      <MemoryRouter>
        <ModelFormModal<RunbookCredential>
          modelType={RunbookCredential}
          title="Create"
          submitButtonText="Create"
          initialValues={created["createInitialValues"] as never}
          formProps={{
            name: "credential",
            id: "credential",
            modelType: RunbookCredential,
            fields: (created["formFields"] as Array<Field>).filter(
              (field: Field) => {
                return !field.doNotShowWhenCreating;
              },
            ),
            steps: created["formSteps"] as Array<FormStep<RunbookCredential>>,
            formType: FormType.Create,
          }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });
    await settle();

    const dialog: HTMLElement = screen.getByTestId("modal");
    const steps: () => string = (): string => {
      return (
        within(dialog).getByRole("navigation", { name: "Progress" })
          .textContent || ""
      );
    };

    await waitFor(() => {
      expect(within(dialog).getByRole("radio", { name: /^SSH/ })).toBeChecked();
    });
    expect(steps()).toContain("SSH Host");
    expect(steps()).toContain("SSH Authentication");
    expect(steps()).not.toContain("Kubernetes");

    fireEvent.click(within(dialog).getByRole("radio", { name: /^Kubernetes/ }));
    await settle();

    expect(
      within(dialog).getByRole("radio", { name: /^Kubernetes/ }),
    ).toBeChecked();
    expect(steps()).toContain("Kubernetes");
    expect(steps()).not.toContain("SSH Host");
    expect(steps()).not.toContain("SSH Authentication");
  });
});
