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
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The card at the top of a Huntress connection's page. Until Huntress has
 * reached the connection it walks the three things to do in Huntress - add
 * an endpoint with this URL, save its signing secret here, send a test -
 * checking each one off; once events arrive it shrinks to the connection's
 * state. The signing secret is pasted in a dialog that sends it once and
 * never shows it again.
 *
 * The real card, Card, Pill, Button and the form modal run; only the
 * network and the permission gate are stubbed.
 */

const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import HuntressSetupCard from "../../../../App/FeatureSet/Dashboard/src/Components/Huntress/HuntressSetupCard";
import {
  HuntressConnectionState,
  getHuntressWebhookUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Huntress/HuntressConnectionDisplay";
import { HUNTRESS_SIGNING_SECRET_PROBLEM } from "../../../../App/FeatureSet/Dashboard/src/Components/Huntress/HuntressSigningSecret";
import HuntressConnection from "../../../Models/DatabaseModels/HuntressConnection";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { APP_API_URL } from "../../../UI/Config";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const CONNECTION_ID: string = "6d1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const SECRET: string = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

let gate: PermissionGateResult = { isAllowed: true };

beforeEach(() => {
  gate = { isAllowed: true };
  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function connectionWith(data: {
  isSigningSecretSet?: boolean;
  lastEventReceivedAt?: Date;
  lastEventType?: string;
  lastError?: string;
  lastErrorAt?: Date;
}): HuntressConnection {
  const connection: HuntressConnection = new HuntressConnection();
  connection.id = new ObjectID(CONNECTION_ID);
  connection.name = "Huntress";
  connection.isSigningSecretSet = data.isSigningSecretSet || false;

  if (data.lastEventReceivedAt) {
    connection.lastEventReceivedAt = data.lastEventReceivedAt;
  }

  if (data.lastEventType) {
    connection.lastEventType = data.lastEventType;
  }

  if (data.lastError) {
    connection.lastError = data.lastError;
  }

  if (data.lastErrorAt) {
    connection.lastErrorAt = data.lastErrorAt;
  }

  return connection;
}

function renderCard(
  connection: HuntressConnection,
  onSigningSecretSaved: () => void = (): void => {
    // not under test
  },
): void {
  render(
    <HuntressSetupCard
      connection={connection}
      onSigningSecretSaved={onSigningSecretSaved}
    />,
  );
}

function stateShown(): string | null {
  return screen
    .getByTestId("huntress-connection-state")
    .getAttribute("data-state");
}

function stepIsDone(step: string): boolean {
  return (
    within(screen.getByTestId(`huntress-setup-step-${step}`)).queryByTestId(
      `huntress-setup-step-${step}-done`,
    ) !== null
  );
}

describe("a connection Huntress has not reached yet", () => {
  test("walks the three steps in Huntress, none done, with the URL to paste", () => {
    renderCard(connectionWith({}));

    expect(screen.getByTestId("huntress-setup")).toBeInTheDocument();
    expect(screen.getByText("Connect Huntress")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Three steps in Huntress. You need the Account Admin role there.",
      ),
    ).toBeInTheDocument();

    expect(stateShown()).toBe(HuntressConnectionState.NeedsSigningSecret);
    expect(screen.getByText("Signing secret needed")).toBeInTheDocument();

    expect(stepIsDone("url")).toBe(false);
    expect(stepIsDone("secret")).toBe(false);
    expect(stepIsDone("test")).toBe(false);

    expect(screen.getByTestId("huntress-webhook-url")).toHaveTextContent(
      getHuntressWebhookUrl({
        apiUrl: APP_API_URL,
        connectionId: CONNECTION_ID,
      }),
    );
    expect(screen.getByTestId("huntress-webhook-url").textContent).toContain(
      `/huntress/webhook/${CONNECTION_ID}`,
    );
  });

  test("names the menus and buttons Huntress shows, in Huntress's words", () => {
    renderCard(connectionWith({}));

    expect(
      within(screen.getByTestId("huntress-setup-step-url")).getByText(
        "In Huntress, open Integrations, choose Add an Integration, then Webhooks, and Add Endpoint. Paste this URL, and turn on Incident Reports.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("huntress-setup-step-secret")).getByText(
        "In Huntress, open the endpoint's menu (⋯) and choose View Signing Secret. Requests are refused until it is saved here.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("huntress-setup-step-test")).getByText(
        "In Huntress, choose Send Test on the endpoint. This card changes as soon as the test arrives.",
      ),
    ).toBeInTheDocument();
  });

  test("asks for the signing secret with the primary button", () => {
    renderCard(connectionWith({}));

    const button: HTMLElement = screen.getByTestId(
      "huntress-signing-secret-button",
    );

    expect(button).toHaveTextContent("Save Signing Secret");
    expect(button).not.toBeDisabled();
  });

  test("checks off the secret once it is saved, and waits for Huntress", () => {
    renderCard(connectionWith({ isSigningSecretSet: true }));

    expect(stateShown()).toBe(HuntressConnectionState.Waiting);
    expect(screen.getByText("Waiting for Huntress")).toBeInTheDocument();
    expect(stepIsDone("url")).toBe(false);
    expect(stepIsDone("secret")).toBe(true);
    expect(stepIsDone("test")).toBe(false);
    expect(
      screen.getByTestId("huntress-signing-secret-saved"),
    ).toHaveTextContent("Signing secret saved");
    expect(
      screen.getByTestId("huntress-signing-secret-button"),
    ).toHaveTextContent("Replace Signing Secret");
  });

  test("says why a request was refused, while the setup is still open", () => {
    renderCard(
      connectionWith({
        isSigningSecretSet: true,
        lastError:
          "The request's signature does not match the signing secret. Copy the endpoint's signing secret from Huntress again.",
        lastErrorAt: minutesAgo(1),
      }),
    );

    expect(stateShown()).toBe(HuntressConnectionState.Failing);
    expect(screen.getByTestId("huntress-setup")).toBeInTheDocument();

    const error: HTMLElement = screen.getByTestId("huntress-last-error");

    expect(error).toHaveTextContent("The last request was refused");
    expect(error).toHaveTextContent(
      "The request's signature does not match the signing secret.",
    );
  });
});

describe("a connection Huntress reaches", () => {
  test("shrinks to its state, its last event, the URL and the secret", () => {
    renderCard(
      connectionWith({
        isSigningSecretSet: true,
        lastEventReceivedAt: minutesAgo(2),
        lastEventType: "incident_report.created",
      }),
    );

    expect(screen.queryByTestId("huntress-setup")).not.toBeInTheDocument();

    const status: HTMLElement = screen.getByTestId(
      "huntress-connection-status",
    );

    expect(screen.getByText("Connection")).toBeInTheDocument();
    expect(stateShown()).toBe(HuntressConnectionState.Receiving);
    expect(status).toHaveTextContent("Receiving reports");
    expect(status).toHaveTextContent("Last event");
    expect(status).toHaveTextContent("incident_report.created");
    expect(status).toHaveTextContent("Signing secret saved");
    expect(
      within(status).getByTestId("huntress-webhook-url"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("huntress-last-error")).not.toBeInTheDocument();
  });

  test("says when requests are refused again, and why", () => {
    renderCard(
      connectionWith({
        isSigningSecretSet: true,
        lastEventReceivedAt: minutesAgo(30),
        lastError: "The request body is not valid JSON.",
        lastErrorAt: minutesAgo(1),
      }),
    );

    expect(stateShown()).toBe(HuntressConnectionState.Failing);
    expect(screen.getByText("Refusing requests")).toBeInTheDocument();
    expect(screen.getByTestId("huntress-last-error")).toHaveTextContent(
      "The request body is not valid JSON.",
    );
  });

  test("forgets an error that an event got past since", () => {
    renderCard(
      connectionWith({
        isSigningSecretSet: true,
        lastEventReceivedAt: minutesAgo(1),
        lastError: "The request body is not valid JSON.",
        lastErrorAt: minutesAgo(30),
      }),
    );

    expect(stateShown()).toBe(HuntressConnectionState.Receiving);
    expect(screen.queryByTestId("huntress-last-error")).not.toBeInTheDocument();
  });
});

describe("who may save the signing secret", () => {
  test("someone who cannot edit the connection sees the button locked, with the reason", () => {
    gate = {
      isAllowed: false,
      disabledReason: "Only project owners and admins can change this.",
    };
    renderCard(connectionWith({}));

    const button: HTMLElement = screen.getByTestId(
      "huntress-signing-secret-button",
    );

    expect(button).toBeDisabled();
  });

  test("the button is gone when the gate gives no reason to show it", () => {
    gate = { isAllowed: false };
    renderCard(connectionWith({}));

    expect(
      screen.queryByTestId("huntress-signing-secret-button"),
    ).not.toBeInTheDocument();
  });
});

describe("the signing secret dialog", () => {
  function openDialog(): HTMLElement {
    fireEvent.click(screen.getByTestId("huntress-signing-secret-button"));

    return screen.getByTestId("modal");
  }

  function secretInput(dialog: HTMLElement): HTMLInputElement {
    return within(dialog).getByPlaceholderText("whsec_…") as HTMLInputElement;
  }

  test("asks for the secret in a password field that browsers do not fill", () => {
    renderCard(connectionWith({}));

    const dialog: HTMLElement = openDialog();

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Save Signing Secret",
    );
    expect(
      within(dialog).getByText(
        "In Huntress, open the endpoint's menu (⋯), choose View Signing Secret, and paste it here. It is encrypted, and never shown again.",
      ),
    ).toBeInTheDocument();
    expect(secretInput(dialog)).toHaveAttribute("type", "password");
    expect(secretInput(dialog)).toHaveAttribute("autocomplete", "new-password");
    expect(secretInput(dialog)).toHaveValue("");
  });

  test("is titled Replace once a secret is saved", () => {
    renderCard(connectionWith({ isSigningSecretSet: true }));

    expect(within(openDialog()).getByTestId("modal-title")).toHaveTextContent(
      "Replace Signing Secret",
    );
  });

  test("refuses something that is not a signing secret, without sending it", async () => {
    renderCard(connectionWith({}));

    const dialog: HTMLElement = openDialog();

    fireEvent.change(secretInput(dialog), {
      target: {
        value: `https://oneuptime.com/api/huntress/webhook/${CONNECTION_ID}`,
      },
    });
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    await flush();

    expect(
      within(screen.getByTestId("modal")).getByText(
        HUNTRESS_SIGNING_SECRET_PROBLEM,
      ),
    ).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("saves the secret on the connection, trimmed, and tells the page", async () => {
    const onSaved: MockFunction = getJestMockFunction();
    renderCard(connectionWith({}), onSaved as unknown as () => void);

    const dialog: HTMLElement = openDialog();

    fireEvent.change(secretInput(dialog), {
      target: { value: `  ${SECRET}  ` },
    });
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const call: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateByIdMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(call.modelType).toBe(HuntressConnection);
    expect(call.id.toString()).toBe(CONNECTION_ID);
    expect(call.data).toEqual({ signingSecret: SECRET });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test("keeps the dialog open with the server's reason when saving fails", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new BadDataException(
        "The signing secret is not one Huntress issues.",
      );
    });

    const onSaved: MockFunction = getJestMockFunction();
    renderCard(connectionWith({}), onSaved as unknown as () => void);

    const dialog: HTMLElement = openDialog();

    fireEvent.change(secretInput(dialog), { target: { value: SECRET } });
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    await flush();

    expect(screen.getByTestId("modal")).toHaveTextContent(
      "The signing secret is not one Huntress issues.",
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  test("closes without saving anything", async () => {
    renderCard(connectionWith({}));

    const dialog: HTMLElement = openDialog();

    fireEvent.change(secretInput(dialog), { target: { value: SECRET } });
    fireEvent.click(within(dialog).getByTestId("close-button"));
    await flush();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});
