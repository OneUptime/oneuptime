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
import IngestionKeySelector from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestionKeySelector";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import { ComponentProps as CodeEditorProps } from "../../../UI/Components/CodeEditor/CodeEditor";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The other door onto a new key: "Choose an ingestion key", step one of
 * every setup guide (IngestionKeySelector). It creates keys with the same
 * form as Settings (Components/Telemetry/IngestionKeyForm), shaped by what
 * the guide knows: the key is named after what the guide is for, and is of
 * the one type the guide's snippet works with, without asking. Rendered for
 * real - modal, ModelForm, BasicForm, validation - with only transport,
 * permissions and the code editor stubbed.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

let isFreePlan: boolean = false;
let listedKeys: Array<TelemetryIngestionKey> = [];
const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
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

const ORIGINS: string = '["https://shop.example.com"]';

function makeKey(data: {
  id: string;
  name: string;
  keyType: TelemetryIngestionKeyType;
}): TelemetryIngestionKey {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID(data.id);
  key.name = data.name;
  key.keyType = data.keyType;
  key.secretKey = new ObjectID(`secret-${data.id}`);
  if (data.keyType === TelemetryIngestionKeyType.Browser) {
    key.allowedOrigins = JSON.parse(ORIGINS) as Array<string>;
  }
  return key;
}

interface RenderedGuide {
  user: UserEvent;
  onSelectedKeyChange: MockFunction;
}

async function renderSelector(data: {
  keyType: TelemetryIngestionKeyType;
  newKeyName: string;
}): Promise<RenderedGuide> {
  const onSelectedKeyChange: MockFunction = getJestMockFunction();

  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <IngestionKeySelector
          endpointLabel="OneUptime URL"
          endpointValue="https://oneuptime.example.com"
          keyTypeFilter={data.keyType}
          newKeyName={data.newKeyName}
          onSelectedKeyChange={(key: TelemetryIngestionKey | null): void => {
            onSelectedKeyChange(key);
          }}
        />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(getListMock).toHaveBeenCalled();
  });

  return { user: userEvent.setup({ delay: null }), onSelectedKeyChange };
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function nameInput(): HTMLElement {
  return within(dialog()).getByPlaceholderText("Ingestion Key Name");
}

function mainButton(): HTMLElement {
  return within(dialog()).getByTestId("modal-footer-submit-button");
}

function progress(): HTMLElement | null {
  return within(dialog()).queryByRole("navigation", { name: "Progress" });
}

/*
 * Lets BasicForm take its fields' defaults into its values. An input shows
 * its field's default before then, so a test that typed at once would edit
 * a form whose name is not filled in yet - and BasicForm never fills in a
 * form someone has typed into.
 */
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
}

// Opens the create dialog from whichever button the list offers.
async function openCreateDialog(
  user: UserEvent,
  expectedName: string,
): Promise<void> {
  const button: HTMLElement = await screen.findByRole("button", {
    name: listedKeys.length > 0 ? "New Key" : "Create Ingestion Key",
  });
  await user.click(button);
  await within(dialog()).findByPlaceholderText("Ingestion Key Name");
  await waitFor(() => {
    expect(nameInput()).toHaveValue(expectedName);
  });
  await settle();
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
  });
  return createOrUpdateMock.mock.calls[0]?.[0] as CreateRequest;
}

describe("Creating an ingestion key from a setup guide", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    isFreePlan = false;
    listedKeys = [];
    getListMock.mockReset().mockImplementation(async () => {
      return {
        data: listedKeys,
        count: listedKeys.length,
        skip: 0,
        limit: 50,
      };
    });
    createOrUpdateMock.mockReset();
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
  });

  afterEach(() => {
    cleanup();
  });

  describe("an agent's guide (Server keys)", () => {
    test("is one page: the guide's name for the key, no type to pick, the description folded", async () => {
      const { user } = await renderSelector({
        keyType: TelemetryIngestionKeyType.Server,
        newKeyName: "Kubernetes key",
      });
      await openCreateDialog(user, "Kubernetes key");

      expect(
        screen.getByRole("dialog", { name: "Create Ingestion Key" }),
      ).toBeVisible();
      expect(
        within(dialog()).queryByRole("radiogroup", { name: "Key Type" }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog()).queryByTestId("card-select-option-Browser"),
      ).not.toBeInTheDocument();
      expect(
        within(dialog()).getByRole("button", { name: "More fields" }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(
        within(dialog()).getByPlaceholderText("Ingestion Key Description"),
      ).not.toBeVisible();
      expect(
        within(dialog()).queryByRole("textbox", { name: "Allowed Origins" }),
      ).not.toBeInTheDocument();
      expect(progress()).not.toBeInTheDocument();
      expect(mainButton()).toHaveTextContent("Create Ingestion Key");
    });

    test("creates a Server key with one click, then picks it for the snippets", async () => {
      const { user, onSelectedKeyChange } = await renderSelector({
        keyType: TelemetryIngestionKeyType.Server,
        newKeyName: "Kubernetes key",
      });
      await openCreateDialog(user, "Kubernetes key");

      const created: TelemetryIngestionKey = makeKey({
        id: "33333333-3333-4333-8333-333333333333",
        name: "Kubernetes key",
        keyType: TelemetryIngestionKeyType.Server,
      });
      createOrUpdateMock.mockImplementation(async () => {
        listedKeys = [created];
        return { data: { _id: created.id!.toString(), name: created.name } };
      });

      const request: CreateRequest = await create(user);
      expect(request.model.name).toBe("Kubernetes key");
      expect(request.model.keyType).toBe(TelemetryIngestionKeyType.Server);
      expect(request.model.projectId?.toString()).toBe(PROJECT_ID);
      expect(request.model.allowedOrigins).toBeFalsy();
      expect(request.model.pinnedServiceName).toBeFalsy();

      // The dialog closes and the snippets get the new key.
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      await waitFor(() => {
        const lastKey: TelemetryIngestionKey | null = onSelectedKeyChange.mock
          .calls[
          onSelectedKeyChange.mock.calls.length - 1
        ]?.[0] as TelemetryIngestionKey | null;
        expect(lastKey?.name).toBe("Kubernetes key");
      });
    });

    test("a name of one's own is sent instead", async () => {
      const { user } = await renderSelector({
        keyType: TelemetryIngestionKeyType.Server,
        newKeyName: "Kubernetes key",
      });
      await openCreateDialog(user, "Kubernetes key");
      createOrUpdateMock.mockResolvedValue({ data: {} });

      fireEvent.change(nameInput(), { target: { value: "prod-east agent" } });

      expect((await create(user)).model.name).toBe("prod-east agent");
    });

    test.each([
      [["Kubernetes key"], "Kubernetes key 2"],
      [["Kubernetes key", "Kubernetes key 2"], "Kubernetes key 3"],
      [["Docker key"], "Kubernetes key"],
    ])(
      "with %j listed, a new key is named %j",
      async (names: Array<string>, expected: string) => {
        listedKeys = names.map((name: string, index: number) => {
          return makeKey({
            id: `4444444${index}-4444-4444-8444-444444444444`,
            name,
            keyType: TelemetryIngestionKeyType.Server,
          });
        });
        const { user } = await renderSelector({
          keyType: TelemetryIngestionKeyType.Server,
          newKeyName: "Kubernetes key",
        });

        await openCreateDialog(user, expected);
      },
    );

    test("a name the guide does not give falls back to the key's type", async () => {
      const { user } = await renderSelector({
        keyType: TelemetryIngestionKeyType.Server,
        newKeyName: "",
      });

      await openCreateDialog(user, "Server key");
    });
  });

  describe("a page's guide (Browser keys)", () => {
    test("asks for the origins on the same page, with the rest folded", async () => {
      const { user } = await renderSelector({
        keyType: TelemetryIngestionKeyType.Browser,
        newKeyName: "RUM key",
      });
      await openCreateDialog(user, "RUM key");

      expect(
        screen.getByRole("dialog", { name: "Create Browser Ingestion Key" }),
      ).toBeVisible();
      expect(
        within(dialog()).getByRole("textbox", { name: "Allowed Origins" }),
      ).toBeVisible();
      expect(
        within(dialog()).getByPlaceholderText("storefront-web"),
      ).not.toBeVisible();
      expect(
        within(dialog()).queryByRole("radiogroup", { name: "Key Type" }),
      ).not.toBeInTheDocument();
      expect(progress()).not.toBeInTheDocument();
      expect(mainButton()).toHaveTextContent("Create Ingestion Key");
    });

    test("refuses missing and bad origins before anything is sent", async () => {
      const { user } = await renderSelector({
        keyType: TelemetryIngestionKeyType.Browser,
        newKeyName: "RUM key",
      });
      await openCreateDialog(user, "RUM key");

      await user.click(mainButton());
      expect(
        await within(dialog()).findByText("Allowed Origins is required."),
      ).toBeVisible();

      for (const [value, error] of [
        ['["https://shop.example.com"', /Allowed Origins is not valid JSON/],
        ['["https://shop.example.com/checkout"]', /must not contain a path/],
        ["[]", /at least one allowed origin/],
      ] as Array<[string, RegExp]>) {
        fireEvent.change(
          within(dialog()).getByRole("textbox", { name: "Allowed Origins" }),
          { target: { value } },
        );
        await user.click(mainButton());
        expect(await within(dialog()).findByText(error)).toBeVisible();
      }

      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    test("creates a Browser key with its origins and pinned service name", async () => {
      const { user } = await renderSelector({
        keyType: TelemetryIngestionKeyType.Browser,
        newKeyName: "RUM key",
      });
      await openCreateDialog(user, "RUM key");
      createOrUpdateMock.mockResolvedValue({ data: {} });

      fireEvent.change(
        within(dialog()).getByRole("textbox", { name: "Allowed Origins" }),
        { target: { value: ORIGINS } },
      );

      await user.click(
        within(dialog()).getByRole("button", { name: "More fields" }),
      );
      fireEvent.change(
        within(dialog()).getByPlaceholderText("storefront-web"),
        {
          target: { value: "shop-web" },
        },
      );

      const request: CreateRequest = await create(user);
      expect(request.model.name).toBe("RUM key");
      expect(request.model.keyType).toBe(TelemetryIngestionKeyType.Browser);
      expect(request.model.allowedOrigins).toEqual(JSON.parse(ORIGINS));
      expect(request.model.pinnedServiceName).toBe("shop-web");
    });
  });

  describe("on the Free plan", () => {
    test.each([
      [TelemetryIngestionKeyType.Server, "Kubernetes key"],
      [TelemetryIngestionKeyType.Browser, "RUM key"],
    ])(
      "a %s key is created only once the pricing has been shown, on a step of its own",
      async (keyType: TelemetryIngestionKeyType, newKeyName: string) => {
        isFreePlan = true;
        const { user } = await renderSelector({ keyType, newKeyName });
        await openCreateDialog(user, newKeyName);
        createOrUpdateMock.mockResolvedValue({ data: {} });

        if (keyType === TelemetryIngestionKeyType.Browser) {
          fireEvent.change(
            within(dialog()).getByRole("textbox", { name: "Allowed Origins" }),
            { target: { value: ORIGINS } },
          );
        }

        await waitFor(() => {
          expect(
            within(progress() as HTMLElement)
              .getAllByRole("listitem")
              .map((item: HTMLElement): string => {
                return item.textContent || "";
              }),
          ).toEqual(["Key", "Billing"]);
        });
        // Create is on Billing, the last step, only: a plain Next here.
        expect(
          within(dialog()).queryByTestId("modal-footer-submit-button"),
        ).not.toBeInTheDocument();
        const next: HTMLElement = within(dialog()).getByTestId(
          "modal-footer-next-button",
        );
        expect(next).toHaveTextContent("Next");
        await user.click(next);

        const notice: HTMLElement = await within(dialog()).findByRole(
          "region",
          { name: "Telemetry pricing" },
        );
        expect(notice).toHaveTextContent("payment method");
        expect(createOrUpdateMock).not.toHaveBeenCalled();

        const request: CreateRequest = await create(user);
        expect(request.model.keyType).toBe(keyType);
        expect(request.model.name).toBe(newKeyName);
        expect(request.miscDataProps).not.toHaveProperty(
          "telemetryPayAsYouGoNotice",
        );
      },
    );
  });
});
