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
  cleanup,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";

/*
 * Monitor > Settings for an Incoming Email monitor. The card shows the live
 * inbound address and offers two ways to replace it:
 *
 *   - Reset: a new random address. Asks first -- naming the address that is
 *     about to stop working -- then shows the new one with a copy button.
 *   - Customize: a name of the user's own, validated as they type and
 *     previewed, then saved and shown the same way.
 *
 * ModelAPI is mocked (the write is an assertion target); the permission
 * snapshot and the inbound domain are pinned.
 */

let mockInboundEmailDomain: string | undefined = "inbound.example.com";
const mockUser: { isMasterAdmin: boolean } = { isMasterAdmin: false };
const mockPermissions: { all: Array<unknown> } = { all: [] };

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const config: Record<string, unknown> = {
    ...actual,
    __esModule: true,
  };

  // A getter, so a test can switch the domain off.
  Object.defineProperty(config, "INBOUND_EMAIL_DOMAIN", {
    enumerable: true,
    get: (): string | undefined => {
      return mockInboundEmailDomain;
    },
  });

  return config;
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return mockUser.isMasterAdmin;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return mockPermissions.all;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: jest.fn(),
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: jest.fn(),
    },
  };
});

import IncomingEmailAddressSettings from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingEmailMonitor/IncomingEmailAddressSettings";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SECRET: string = "5ec2e7a1-9b3c-4d2e-8f10-7a6b5c4d3e2f";
const DOMAIN: string = "inbound.example.com";
const GENERATED_ADDRESS: string = `monitor-${SECRET}@${DOMAIN}`;
const UUID_PATTERN: string =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

type MockedFn = jest.Mock;

const updateById: MockedFn = ModelAPI.updateById as unknown as MockedFn;

type RenderSettingsFunction = (props?: {
  secretKey?: ObjectID | undefined;
  customLocalPart?: string | undefined;
  onAddressChanged?: (() => void) | undefined;
}) => RenderResult;

const renderSettings: RenderSettingsFunction = (props?: {
  secretKey?: ObjectID | undefined;
  customLocalPart?: string | undefined;
  onAddressChanged?: (() => void) | undefined;
}): RenderResult => {
  return render(
    <IncomingEmailAddressSettings
      monitorId={MONITOR_ID}
      secretKey={
        props && "secretKey" in props ? props.secretKey : new ObjectID(SECRET)
      }
      customLocalPart={props?.customLocalPart}
      onAddressChanged={props?.onAddressChanged}
    />,
  );
};

function setupUser(): UserEvent {
  return userEvent.setup({ delay: null });
}

type UpdateCallFunction = () => {
  modelType: unknown;
  id: ObjectID;
  data: JSONObject;
};

const lastUpdate: UpdateCallFunction = (): {
  modelType: unknown;
  id: ObjectID;
  data: JSONObject;
} => {
  expect(updateById).toHaveBeenCalledTimes(1);

  return (
    updateById.mock.calls as unknown as Array<
      Array<{ modelType: unknown; id: ObjectID; data: JSONObject }>
    >
  )[0]![0]!;
};

const cardButton: (name: string) => HTMLElement = (
  name: string,
): HTMLElement => {
  return screen.getAllByRole("button", { name: new RegExp(name) })[0]!;
};

beforeEach(() => {
  mockInboundEmailDomain = DOMAIN;
  mockUser.isMasterAdmin = false;
  mockPermissions.all = [Permission.ProjectMember];
  updateById.mockReset();
  updateById.mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("showing the current address", () => {
  test("shows the generated address with a copy button", () => {
    renderSettings();

    expect(
      screen.getByTestId("incoming-email-current-address"),
    ).toHaveTextContent(GENERATED_ADDRESS);
    expect(screen.getByText("Generated address")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("incoming-email-address-settings")).getByRole(
        "button",
        { name: /Copy/ },
      ),
    ).toBeInTheDocument();
  });

  test("shows the custom address instead when one is set", () => {
    const view: RenderResult = renderSettings({
      customLocalPart: "nightly-backups",
    });

    expect(
      screen.getByTestId("incoming-email-current-address"),
    ).toHaveTextContent(`nightly-backups@${DOMAIN}`);
    expect(screen.getByText("Custom address")).toBeInTheDocument();
    // The generated address no longer works, so it must not be offered.
    expect(view.container.innerHTML).not.toContain(GENERATED_ADDRESS);
  });

  test("offers both actions to someone who can edit the monitor", () => {
    renderSettings();

    expect(cardButton("Customize Address")).toBeEnabled();
    expect(cardButton("Reset Address")).toBeEnabled();
  });

  test("hides the address, and disables the actions, when the credentials were withheld", () => {
    const view: RenderResult = renderSettings({ secretKey: undefined });

    expect(
      screen.getByText(/Only people who can edit monitors can see this/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("incoming-email-current-address")).toBeNull();
    expect(view.container.innerHTML).not.toContain("@inbound.example.com");
    expect(cardButton("Customize Address")).toBeDisabled();
    expect(cardButton("Reset Address")).toBeDisabled();
  });

  test("disables the actions for someone who cannot edit monitors", () => {
    mockPermissions.all = [Permission.Viewer];

    renderSettings();

    expect(cardButton("Customize Address")).toBeDisabled();
    expect(cardButton("Reset Address")).toBeDisabled();
  });

  test("says so when the server has no inbound email domain", () => {
    mockInboundEmailDomain = undefined;

    renderSettings();

    expect(
      screen.getByText(/Inbound email is not configured on this server/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset Address/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Customize Address/ }),
    ).toBeNull();
  });
});

describe("resetting the address", () => {
  test("asks for confirmation, naming the address that will stop working", async () => {
    const user: UserEvent = setupUser();
    renderSettings();

    await user.click(cardButton("Reset Address"));

    const confirmation: HTMLElement = screen.getByTestId(
      "incoming-email-reset-confirmation",
    );

    expect(confirmation).toHaveTextContent(GENERATED_ADDRESS);
    expect(confirmation).toHaveTextContent("will stop working immediately");
    expect(confirmation).toHaveTextContent(
      "Update every system that sends email to this monitor.",
    );
    // Nothing is written until the person confirms.
    expect(updateById).not.toHaveBeenCalled();
  });

  test("cancelling writes nothing", async () => {
    const user: UserEvent = setupUser();
    renderSettings();

    await user.click(cardButton("Reset Address"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(updateById).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("incoming-email-reset-confirmation"),
    ).toBeNull();
  });

  test("confirming writes a fresh key and clears any custom name in one update", async () => {
    const user: UserEvent = setupUser();
    renderSettings({ customLocalPart: "nightly-backups" });

    await user.click(cardButton("Reset Address"));
    await user.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(updateById).toHaveBeenCalled();
    });

    const update: { modelType: unknown; id: ObjectID; data: JSONObject } =
      lastUpdate();

    expect(update.modelType).toBe(Monitor);
    expect(update.id.toString()).toBe(MONITOR_ID.toString());
    expect(update.data["incomingEmailCustomLocalPart"]).toBeNull();
    expect(update.data["incomingEmailSecretKey"]).toMatch(
      new RegExp(`^${UUID_PATTERN}$`),
    );
    expect(update.data["incomingEmailSecretKey"]).not.toBe(SECRET);
  });

  test("mentions that a custom address will be removed", async () => {
    const user: UserEvent = setupUser();
    renderSettings({ customLocalPart: "nightly-backups" });

    await user.click(cardButton("Reset Address"));

    const confirmation: HTMLElement = screen.getByTestId(
      "incoming-email-reset-confirmation",
    );

    expect(confirmation).toHaveTextContent(`nightly-backups@${DOMAIN}`);
    expect(confirmation).toHaveTextContent(
      "Your custom address will be removed.",
    );
  });

  test("then shows the new address, which is the one derived from the new key", async () => {
    const user: UserEvent = setupUser();
    renderSettings();

    await user.click(cardButton("Reset Address"));
    await user.click(screen.getByTestId("modal-footer-submit-button"));

    const newAddress: HTMLElement = await screen.findByTestId(
      "incoming-email-new-address",
    );
    const newKey: string = lastUpdate().data[
      "incomingEmailSecretKey"
    ] as string;

    expect(newAddress).toHaveTextContent(`monitor-${newKey}@${DOMAIN}`);
    expect(
      screen.getByText(
        `This monitor now receives email at the address below. The previous address (${GENERATED_ADDRESS}) no longer works.`,
      ),
    ).toBeInTheDocument();
  });

  test("closing the result lets the page refetch", async () => {
    const user: UserEvent = setupUser();
    const onAddressChanged: MockedFn = jest.fn() as unknown as MockedFn;
    renderSettings({
      onAddressChanged: onAddressChanged as unknown as () => void,
    });

    await user.click(cardButton("Reset Address"));
    await user.click(screen.getByTestId("modal-footer-submit-button"));
    await screen.findByTestId("incoming-email-new-address");

    expect(onAddressChanged).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(onAddressChanged).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("incoming-email-new-address")).toBeNull();
  });

  test("a failed write shows the error and no new address", async () => {
    updateById.mockRejectedValue(
      new BadDataException("You do not have permission") as never,
    );
    const user: UserEvent = setupUser();
    renderSettings();

    await user.click(cardButton("Reset Address"));
    await user.click(screen.getByTestId("modal-footer-submit-button"));

    expect(
      await screen.findByText("You do not have permission"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("incoming-email-new-address")).toBeNull();
  });
});

describe("customizing the address", () => {
  type OpenCustomizeFunction = (user: UserEvent) => Promise<HTMLElement>;

  const openCustomize: OpenCustomizeFunction = async (
    user: UserEvent,
  ): Promise<HTMLElement> => {
    await user.click(cardButton("Customize Address"));

    return await screen.findByTestId("incoming-email-custom-local-part");
  };

  test("warns that the current address stops working and that names can be guessed", async () => {
    const user: UserEvent = setupUser();
    renderSettings();

    await openCustomize(user);

    const description: HTMLElement = screen.getByTestId("modal-description");

    expect(description).toHaveTextContent(
      "When you save, the current address stops working immediately.",
    );
    expect(description).toHaveTextContent("avoid names that are easy to guess");
    expect(description).toHaveTextContent(
      "It must be unique across all monitors.",
    );
    expect(
      screen.getByText(/The domain is always @inbound\.example\.com/),
    ).toBeInTheDocument();
  });

  test("starts from the current custom name", async () => {
    const user: UserEvent = setupUser();
    renderSettings({ customLocalPart: "nightly-backups" });

    const input: HTMLElement = await openCustomize(user);

    // The form applies initial values in an effect after the input mounts.
    await waitFor(() => {
      expect(input).toHaveValue("nightly-backups");
    });
  });

  test("previews the new address as the name is typed", async () => {
    const user: UserEvent = setupUser();
    renderSettings();

    const input: HTMLElement = await openCustomize(user);
    await user.type(input, "Nightly-Backups");

    expect(
      await screen.findByTestId("incoming-email-custom-address-preview"),
    ).toHaveTextContent(`New address: nightly-backups@${DOMAIN}`);
  });

  test("saves the normalized name and shows the new address", async () => {
    const user: UserEvent = setupUser();
    renderSettings();

    const input: HTMLElement = await openCustomize(user);
    await user.type(input, "Nightly-Backups");
    await user.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(updateById).toHaveBeenCalled();
    });

    const update: { modelType: unknown; id: ObjectID; data: JSONObject } =
      lastUpdate();

    expect(update.data).toEqual({
      incomingEmailCustomLocalPart: "nightly-backups",
    });
    expect(
      await screen.findByTestId("incoming-email-new-address"),
    ).toHaveTextContent(`nightly-backups@${DOMAIN}`);
    expect(
      screen.getByText(
        `This monitor now receives email at the address below. The previous address (${GENERATED_ADDRESS}) no longer works.`,
      ),
    ).toBeInTheDocument();
  });

  test("accepts the whole address pasted in, keeping only the name", async () => {
    const user: UserEvent = setupUser();
    renderSettings();

    const input: HTMLElement = await openCustomize(user);
    await user.type(input, `nightly-backups@${DOMAIN}`);
    await user.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(updateById).toHaveBeenCalled();
    });

    expect(lastUpdate().data["incomingEmailCustomLocalPart"]).toBe(
      "nightly-backups",
    );
  });

  test.each([
    ["ab", "at least 3 characters"],
    ["night backups", "can only contain lowercase letters"],
    ["postmaster", "is reserved"],
    [`monitor-${SECRET}`, "reserved for generated addresses"],
    ["backups@acme.com", "must use the inbound email domain"],
  ])(
    "refuses %p in the form, without writing anything",
    async (value: string, message: string) => {
      const user: UserEvent = setupUser();
      renderSettings();

      const input: HTMLElement = await openCustomize(user);
      await user.type(input, value);
      await user.click(screen.getByTestId("modal-footer-submit-button"));

      expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
      expect(updateById).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId("incoming-email-custom-address-preview"),
      ).toBeNull();
    },
  );

  test("shows the server's refusal when the name is already taken", async () => {
    updateById.mockRejectedValue(
      new BadDataException(
        `The email address nightly-backups@${DOMAIN} is already used by another monitor. Please choose a different name.`,
      ) as never,
    );
    const user: UserEvent = setupUser();
    renderSettings();

    const input: HTMLElement = await openCustomize(user);
    await user.type(input, "nightly-backups");
    await user.click(screen.getByTestId("modal-footer-submit-button"));

    // Shown once, as the form's alert -- and the dialog stays open to retry.
    expect(
      await screen.findByText(/is already used by another monitor/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("incoming-email-new-address")).toBeNull();

    // The refused name is still there to edit, not wiped by the save.
    const retryInput: HTMLElement = await screen.findByTestId(
      "incoming-email-custom-local-part",
    );

    await waitFor(() => {
      expect(retryInput).toHaveValue("nightly-backups");
    });
  });

  test("saving the name the monitor already has just closes the dialog", async () => {
    const user: UserEvent = setupUser();
    renderSettings({ customLocalPart: "nightly-backups" });

    await openCustomize(user);
    await user.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("incoming-email-custom-local-part"),
      ).toBeNull();
    });
    expect(updateById).not.toHaveBeenCalled();
    expect(screen.queryByTestId("incoming-email-new-address")).toBeNull();
  });
});
