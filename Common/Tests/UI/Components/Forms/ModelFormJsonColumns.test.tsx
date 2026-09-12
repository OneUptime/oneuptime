import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import { ComponentProps as CodeEditorProps } from "../../../../UI/Components/CodeEditor/CodeEditor";

/*
 * A JSON field is EDITED as text and may be STORED either way, and ModelForm
 * is the only place that knows which.
 *
 *  - TelemetryIngestionKey.allowedOrigins is a JSON column. The editor holds
 *    '["https://a.example.com"]' and the column holds a list, so the string
 *    has to become a list before it is sent - it did not on update, and the
 *    server refused every edit to a browser key's allowlist.
 *  - GoogleSecOpsConnection.serviceAccountJson is VeryLongText. It is edited
 *    as JSON because that is what a customer pastes out of Google Cloud, and
 *    stored as the text they pasted: the server decrypts it and parses it
 *    itself. Parsing it here would hand it an object instead.
 *
 * Both are real models with real column metadata, so the rule is exercised
 * against the same declarations production reads.
 */

let capturedModel: JSONObject | null = null;

jest.mock("../../../../UI/Utils/Permission", () => {
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

jest.mock("../../../../UI/Utils/User", () => {
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

jest.mock("../../../../UI/Utils/Translation", () => {
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

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
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
      createOrUpdate: async (data: { model: JSONObject }): Promise<null> => {
        capturedModel = data.model;
        return null;
      },
    },
  };
});

// Monaco does not run under jsdom; the field only has to hold text.
jest.mock("../../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: CodeEditorProps): ReactElement => {
      const raw: unknown = props.value ?? props.initialValue ?? "";

      return (
        <textarea
          aria-labelledby={props.ariaLabelledby}
          value={typeof raw === "string" ? raw : JSON.stringify(raw)}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
            props.onChange?.(event.target.value);
          }}
          onBlur={props.onBlur}
        />
      );
    },
  };
});

import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import TelemetryIngestionKey from "../../../../Models/DatabaseModels/TelemetryIngestionKey";
import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";

const ORIGINS: string = '["https://app.example.com", "https://*.example.org"]';
const SERVICE_ACCOUNT: string =
  '{"type":"service_account","project_id":"acme","private_key":"key"}';

async function renderIngestionKeyForm(): Promise<void> {
  const fields: Fields<TelemetryIngestionKey> = [
    {
      field: { name: true },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Key name",
    },
    {
      field: { allowedOrigins: true },
      title: "Allowed Origins",
      fieldType: FormFieldSchemaType.JSON,
      required: false,
    },
  ];

  await act(async (): Promise<void> => {
    render(
      <ModelForm<TelemetryIngestionKey>
        modelType={TelemetryIngestionKey}
        id="ingestion-key-form"
        name="Ingestion Key"
        fields={fields}
        formType={FormType.Create}
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText="Save"
      />,
    );
  });
}

async function renderConnectionForm(): Promise<void> {
  const fields: Fields<GoogleSecOpsConnection> = [
    {
      field: { name: true },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Connection name",
    },
    {
      field: { serviceAccountJson: true },
      title: "Service Account JSON",
      fieldType: FormFieldSchemaType.JSON,
      required: false,
    },
  ];

  await act(async (): Promise<void> => {
    render(
      <ModelForm<GoogleSecOpsConnection>
        modelType={GoogleSecOpsConnection}
        id="connection-form"
        name="Connection"
        fields={fields}
        formType={FormType.Create}
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText="Save"
      />,
    );
  });
}

function editor(): HTMLElement {
  return screen.getByRole("textbox", { name: /Origins|Service Account/ });
}

async function submit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
}

afterEach(() => {
  cleanup();
  capturedModel = null;
});

describe("ModelForm: a JSON editor over a JSON column", () => {
  test("sends the edited text as parsed JSON", async () => {
    await renderIngestionKeyForm();

    fireEvent.change(screen.getByPlaceholderText("Key name"), {
      target: { value: "Storefront key" },
    });
    fireEvent.change(editor(), { target: { value: ORIGINS } });

    await submit();

    expect(capturedModel?.["allowedOrigins"]).toEqual([
      "https://app.example.com",
      "https://*.example.org",
    ]);
  });

  test("sends an empty list as a list, not as the characters []", async () => {
    await renderIngestionKeyForm();

    fireEvent.change(screen.getByPlaceholderText("Key name"), {
      target: { value: "Collector key" },
    });
    fireEvent.change(editor(), { target: { value: "[]" } });

    await submit();

    expect(capturedModel?.["allowedOrigins"]).toEqual([]);
  });

  test("leaves an untouched field alone", async () => {
    await renderIngestionKeyForm();

    fireEvent.change(screen.getByPlaceholderText("Key name"), {
      target: { value: "Collector key" },
    });

    await submit();

    expect(capturedModel?.["allowedOrigins"]).toBeUndefined();
  });
});

describe("ModelForm: a JSON editor over a text column", () => {
  /*
   * The regression this guards. A service account key is edited as JSON
   * because that is the shape the customer pastes, but the column is
   * VeryLongText and the server decrypts and parses the text itself -
   * so what goes over the wire has to still be the text they pasted.
   */
  test("sends the pasted text unchanged", async () => {
    await renderConnectionForm();

    fireEvent.change(screen.getByPlaceholderText("Connection name"), {
      target: { value: "Chronicle" },
    });
    fireEvent.change(editor(), { target: { value: SERVICE_ACCOUNT } });

    await submit();

    expect(typeof capturedModel?.["serviceAccountJson"]).toBe("string");
    expect(capturedModel?.["serviceAccountJson"]).toBe(SERVICE_ACCOUNT);
  });
});
