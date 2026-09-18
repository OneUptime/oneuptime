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
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import TelemetryIngestionKeyView from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/TelemetryIngestionKeyView";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import { ComponentProps as CodeEditorProps } from "../../../UI/Components/CodeEditor/CodeEditor";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The ingestion key DETAIL page, through the real CardModelDetail, ModelForm
 * and validation - only transport, permissions and Monaco are stubbed.
 *
 * The creation wizard has its own suite; nothing covered the edit form, and
 * the two do not share their handling of Allowed Origins. The wizard converts
 * the JSON editor's text into an array in onBeforeCreate, a hook ModelForm
 * only runs on Create. So what the edit form sends for the same field, and
 * whether the server would accept it, is exactly the gap these tests fill:
 * TelemetryIngestionKeyService.validateAllowedOrigins throws
 * "Allowed origins must be a list of origins" on anything that is not an
 * array, and a browser key whose origins cannot be edited is a browser key
 * whose allowlist cannot be corrected after a domain changes.
 */

const KEY_ID: ObjectID = new ObjectID("2f2ad8a8-2d9e-4a3f-b6f3-1f9e2b3c4d5e");

let storedKey: TelemetryIngestionKey;
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<TelemetryIngestionKey> => {
        return storedKey;
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

/*
 * Monaco does not run under jsdom. The stub mirrors the one piece of the
 * real editor that matters to these tests: CodeEditor.toEditorText, which
 * pretty-prints anything it is handed that is not already a string - which
 * is exactly how a stored array of origins reaches the editor - and the
 * field error the real component renders beneath it.
 */
jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: CodeEditorProps): ReactElement => {
      const raw: unknown = props.value ?? props.initialValue ?? "";
      const text: string =
        typeof raw === "string" ? raw : JSON.stringify(raw, null, 4);

      return (
        <>
          <textarea
            aria-labelledby={props.ariaLabelledby}
            value={text}
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

function makeKey(data: {
  keyType: TelemetryIngestionKeyType;
  allowedOrigins: Array<string>;
  pinnedServiceName?: string | undefined;
}): TelemetryIngestionKey {
  const key: TelemetryIngestionKey = BaseModel.fromJSON(
    {
      _id: KEY_ID.toString(),
      name: "Storefront key",
      description: "Public telemetry for the storefront.",
      keyType: data.keyType,
      isEnabled: true,
      allowedOrigins: data.allowedOrigins,
      pinnedServiceName: data.pinnedServiceName,
    } as JSONObject,
    TelemetryIngestionKey,
  ) as TelemetryIngestionKey;

  return key;
}

async function renderDetail(): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter
        initialEntries={[
          `/settings/telemetry-ingestion-keys/${KEY_ID.toString()}`,
        ]}
      >
        <TelemetryIngestionKeyView
          pageRoute={new Route("/settings/telemetry-ingestion-keys")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  return userEvent.setup({ delay: null });
}

function editDialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Edit Telemetry Ingestion Key" });
}

async function openEditForm(user: UserEvent): Promise<void> {
  await user.click(
    await screen.findByRole("button", { name: "Edit Telemetry Ingestion Key" }),
  );
  await waitFor(() => {
    expect(editDialog()).toBeVisible();
  });
  await within(editDialog()).findByRole("textbox", {
    name: /^Allowed Origins/,
  });
}

async function save(user: UserEvent): Promise<TelemetryIngestionKey> {
  await user.click(
    within(editDialog()).getByRole("button", { name: "Save Changes" }),
  );
  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  return (
    createOrUpdateMock.mock.calls[0]?.[0] as { model: TelemetryIngestionKey }
  ).model;
}

describe("Telemetry ingestion key detail page", () => {
  beforeEach(() => {
    cleanup();
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockImplementation(async () => {
      return { data: storedKey };
    });
    storedKey = makeKey({
      keyType: TelemetryIngestionKeyType.Browser,
      allowedOrigins: ["https://app.example.com"],
      pinnedServiceName: "storefront-web",
    });
  });

  test("loads the stored origins into the editor as JSON text", async () => {
    const user: UserEvent = await renderDetail();
    await openEditForm(user);

    expect(
      within(editDialog()).getByRole("textbox", { name: /^Allowed Origins/ }),
    ).toHaveValue(JSON.stringify(["https://app.example.com"], null, 4));
  });

  /*
   * The key type is what every ingest guard keys off. The page says so and
   * the model refuses the write; the edit form must not offer it either,
   * or a customer is invited to make a change that cannot succeed.
   */
  test("does not offer the key type for editing", async () => {
    const user: UserEvent = await renderDetail();
    await openEditForm(user);

    expect(
      within(editDialog()).queryByRole("radiogroup", { name: "Key Type" }),
    ).not.toBeInTheDocument();
    expect(
      within(editDialog()).queryByText("Key Type", { exact: true }),
    ).not.toBeInTheDocument();
  });

  /*
   * The whole point of the field. An edited allowlist has to reach the API
   * as an array of origins - a JSON STRING is refused outright by
   * TelemetryIngestionKeyService.validateAllowedOrigins, which means the
   * allowlist could never be corrected from the page that shows it.
   */
  test("sends edited origins as an array, not as JSON text", async () => {
    const user: UserEvent = await renderDetail();
    await openEditForm(user);

    fireEvent.change(
      within(editDialog()).getByRole("textbox", { name: /^Allowed Origins/ }),
      {
        target: {
          value: '["https://app.example.com", "https://*.example.org"]',
        },
      },
    );

    const model: TelemetryIngestionKey = await save(user);

    expect(model.allowedOrigins).toEqual([
      "https://app.example.com",
      "https://*.example.org",
    ]);
  });

  test("keeps the untouched origins an array when another field is edited", async () => {
    const user: UserEvent = await renderDetail();
    await openEditForm(user);

    fireEvent.change(
      within(editDialog()).getByPlaceholderText("storefront-web"),
      { target: { value: "storefront-checkout" } },
    );

    const model: TelemetryIngestionKey = await save(user);

    expect(model.allowedOrigins).toEqual(["https://app.example.com"]);
    expect(model.pinnedServiceName).toBe("storefront-checkout");
  });

  /*
   * Clearing the list is how a server key's leftover allowlist is removed.
   * An empty JSON array has to survive as an array: the column is JSON and
   * not null, and the string "[]" is not an empty list to anything that
   * reads it. (Emptying a BROWSER key's list is refused by the service,
   * which - unlike this form - knows the key's type.)
   */
  test("sends an explicitly emptied list as an empty array", async () => {
    storedKey = makeKey({
      keyType: TelemetryIngestionKeyType.Server,
      allowedOrigins: ["https://app.example.com"],
    });

    const user: UserEvent = await renderDetail();
    await openEditForm(user);

    fireEvent.change(
      within(editDialog()).getByRole("textbox", { name: /^Allowed Origins/ }),
      { target: { value: "[]" } },
    );

    const model: TelemetryIngestionKey = await save(user);

    expect(model.allowedOrigins).toEqual([]);
  });

  test("refuses to save origins that are not valid JSON", async () => {
    const user: UserEvent = await renderDetail();
    await openEditForm(user);

    fireEvent.change(
      within(editDialog()).getByRole("textbox", { name: /^Allowed Origins/ }),
      { target: { value: '["https://app.example.com"' } },
    );

    await user.click(
      within(editDialog()).getByRole("button", { name: "Save Changes" }),
    );

    await waitFor(() => {
      expect(
        within(editDialog()).getByText(/Allowed Origins is not valid JSON/),
      ).toBeVisible();
    });
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("refuses to save an origin list that is not a list", async () => {
    const user: UserEvent = await renderDetail();
    await openEditForm(user);

    fireEvent.change(
      within(editDialog()).getByRole("textbox", { name: /^Allowed Origins/ }),
      { target: { value: '{"origin":"https://app.example.com"}' } },
    );

    await user.click(
      within(editDialog()).getByRole("button", { name: "Save Changes" }),
    );

    await waitFor(() => {
      expect(
        within(editDialog()).getByText(
          /must be a JSON array|Enter at least one allowed origin/,
        ),
      ).toBeVisible();
    });
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});
