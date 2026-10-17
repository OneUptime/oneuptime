/*
 * The Huntress trigger's panel in the Builder: what someone opening the
 * trigger has come for.
 *
 * Until Huntress reaches the workflow, it walks the three things to do in
 * Huntress - add an endpoint with this URL, save the endpoint's signing
 * secret here, send a test - with a check beside each one done, and reads
 * the workflow again while it waits so a test shows up as it arrives. Once
 * Huntress reaches it, it shrinks to where it stands. Why the last request
 * was refused is shown whenever it is newer than the last one let in. The
 * signing secret is write-only: pasted into a dialog, saved, never read
 * back.
 *
 * Rendered for real: the actual Button, CopyTextButton, Pill and form
 * dialog. Only the workflow's reads and writes (ModelAPI) and the
 * permission check are stood in for.
 */

import Workflow from "../../../../Models/DatabaseModels/Workflow";
import HuntressTriggerPanel, {
  ComponentProps,
} from "../../../../UI/Components/Workflow/HuntressTriggerPanel";
import {
  HUNTRESS_SIGNING_SECRET_PROBLEM,
  HUNTRESS_TRIGGER_POLL_INTERVAL_MS,
  HuntressTriggerPanelCopy,
} from "../../../../UI/Components/Workflow/HuntressTriggerState";
import { WebhookTriggerPanelCopy } from "../../../../UI/Components/Workflow/WebhookTriggerPanel";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import type { SpyInstance } from "jest-mock";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
);
const URL: string =
  "https://oneuptime.com/workflow/huntress/6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b";
const SECRET: string =
  "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw8GKYqrTwjUPD8ILPZIo2LaLaSw";
const NO_PERMISSION: string =
  "You do not have permission to edit this workflow. You need one of these permissions: Project Owner, Project Admin, Edit Workflow.";

interface Facts {
  isWebhookSigningSecretSet?: boolean;
  lastWebhookRequestAt?: Date;
  lastWebhookError?: string;
  lastWebhookErrorAt?: Date;
}

let facts: Facts | Error;
let reads: number;
let writes: Array<{ id: ObjectID; data: Record<string, unknown> }>;
let writeFailure: Error | null;

function workflowOf(current: Facts): Workflow {
  const workflow: Workflow = new Workflow();
  workflow._id = WORKFLOW_ID.toString();
  Object.assign(workflow, current);
  return workflow;
}

function renderPanel(overrides: Partial<ComponentProps> = {}): void {
  render(
    <HuntressTriggerPanel
      workflowId={WORKFLOW_ID}
      url={URL}
      canSeeUrl={true}
      {...overrides}
    />,
  );
}

// The workflow was read: the state pill is drawn from what came back.
async function loaded(): Promise<void> {
  await waitFor(() => {
    expect(reads).toBeGreaterThan(0);
    expect(screen.getByTestId("huntress-trigger-state")).toBeInTheDocument();
  });
}

function state(): string | null {
  return screen
    .getByTestId("huntress-trigger-state")
    .getAttribute("data-state");
}

beforeEach(() => {
  facts = { isWebhookSigningSecretSet: false };
  reads = 0;
  writes = [];
  writeFailure = null;

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async (data: {
    id: ObjectID;
    select: Record<string, boolean>;
  }): Promise<Workflow | null> => {
    reads++;

    // Only whether a secret is saved: the secret itself is never read.
    expect(data.select).toEqual({
      isWebhookSigningSecretSet: true,
      lastWebhookRequestAt: true,
      lastWebhookError: true,
      lastWebhookErrorAt: true,
    });
    expect(data.id.toString()).toBe(WORKFLOW_ID.toString());

    if (facts instanceof Error) {
      throw facts;
    }

    return workflowOf(facts);
  }) as never);

  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (data: {
    id: ObjectID;
    data: Record<string, unknown>;
  }): Promise<void> => {
    if (writeFailure) {
      throw writeFailure;
    }

    writes.push({ id: data.id, data: data.data });
    facts = { isWebhookSigningSecretSet: true };
  }) as never);

  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("before Huntress reaches it", () => {
  test("walks the three steps in Huntress's order, none done, and asks for the signing secret", async () => {
    renderPanel();
    await loaded();

    expect(screen.getByTestId("huntress-trigger-setup")).toBeInTheDocument();
    expect(state()).toBe("needs-signing-secret");

    for (const step of ["endpoint", "secret", "test"]) {
      expect(
        screen.getByTestId(`huntress-trigger-step-${step}-todo`),
      ).toBeInTheDocument();
    }

    expect(
      screen.getByTestId("huntress-trigger-step-endpoint"),
    ).toHaveTextContent(HuntressTriggerPanelCopy.stepEndpointTitle);
    expect(
      screen.getByTestId("huntress-trigger-step-secret"),
    ).toHaveTextContent(HuntressTriggerPanelCopy.stepSecretTitle);
    expect(screen.getByTestId("huntress-trigger-step-test")).toHaveTextContent(
      HuntressTriggerPanelCopy.stepTestTitle,
    );
    expect(
      screen.getByTestId("huntress-trigger-signing-secret-button"),
    ).toHaveTextContent("Save Signing Secret");
  });

  test("shows the URL to paste into Huntress, with Copy URL beside it", async () => {
    renderPanel();
    await loaded();

    expect(screen.getByTestId("huntress-trigger-url")).toHaveTextContent(URL);
    expect(
      screen.getByRole("button", { name: /Copy webhook URL|Copy URL/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("huntress-trigger-url-note")).toHaveTextContent(
      "Only requests signed with the endpoint's signing secret start this workflow.",
    );
  });

  test("the last step says the test shows up here, within seconds", async () => {
    renderPanel();
    await loaded();

    expect(screen.getByTestId("huntress-trigger-step-test")).toHaveTextContent(
      "In Huntress, choose Send Test on the endpoint. It shows up here within a few seconds.",
    );
  });

  /*
   * The list numbers the steps for a screen reader, so the drawn number or
   * check is hidden from it, and a done step says so after its title.
   */
  test("a screen reader hears which steps are done, and no drawn number twice", async () => {
    facts = { isWebhookSigningSecretSet: true };

    renderPanel();
    await loaded();

    for (const step of ["endpoint", "secret", "test"]) {
      const circle: HTMLElement = screen.getByTestId(
        `huntress-trigger-step-${step}-${step === "test" ? "todo" : "done"}`,
      );

      expect(circle).toHaveAttribute("aria-hidden", "true");
    }

    for (const step of ["endpoint", "secret"]) {
      const label: HTMLElement = screen.getByTestId(
        `huntress-trigger-step-${step}-done-label`,
      );

      expect(label).toHaveTextContent(HuntressTriggerPanelCopy.stepDone);
      expect(label).toHaveClass("sr-only");
    }

    expect(
      screen.queryByTestId("huntress-trigger-step-test-done-label"),
    ).not.toBeInTheDocument();
  });

  test("the state is read out when it changes", async () => {
    renderPanel();
    await loaded();

    expect(screen.getByTestId("huntress-trigger-state")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  test("with a secret saved, waits for Huntress, the endpoint's and the secret's steps checked", async () => {
    facts = { isWebhookSigningSecretSet: true };

    renderPanel();
    await loaded();

    expect(state()).toBe("waiting");
    // Huntress issues a secret only for an endpoint it has.
    expect(
      screen.getByTestId("huntress-trigger-step-endpoint-done"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("huntress-trigger-step-secret-done"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("huntress-trigger-step-test-todo"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("huntress-trigger-step-test")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(
      screen.getByTestId("huntress-trigger-signing-secret-button"),
    ).toHaveTextContent("Replace Signing Secret");
  });

  /*
   * One obvious place to start: the first step not done is the list's
   * current step, drawn filled in, and every other step is not.
   */
  test("the step to do next is the current one, and only it", async () => {
    renderPanel();
    await loaded();

    expect(
      screen.getByTestId("huntress-trigger-step-endpoint"),
    ).toHaveAttribute("aria-current", "step");
    expect(
      screen.getByTestId("huntress-trigger-step-endpoint-todo"),
    ).toHaveClass("bg-indigo-600");

    for (const step of ["secret", "test"]) {
      expect(
        screen.getByTestId(`huntress-trigger-step-${step}`),
      ).not.toHaveAttribute("aria-current");
      expect(
        screen.getByTestId(`huntress-trigger-step-${step}-todo`),
      ).not.toHaveClass("bg-indigo-600");
    }
  });

  /*
   * A done step keeps what is still of use - the URL to copy, the button
   * that replaces the secret - and drops its instructions: "Requests are
   * refused until it is saved here" reads wrong once it is.
   */
  test("a done step drops its instructions and keeps what is still of use", async () => {
    facts = { isWebhookSigningSecretSet: true };

    renderPanel();
    await loaded();

    const endpoint: HTMLElement = screen.getByTestId(
      "huntress-trigger-step-endpoint",
    );
    const secret: HTMLElement = screen.getByTestId(
      "huntress-trigger-step-secret",
    );

    expect(endpoint).not.toHaveTextContent(
      HuntressTriggerPanelCopy.stepEndpointBody,
    );
    expect(
      within(endpoint).getByTestId("huntress-trigger-url"),
    ).toHaveTextContent(URL);

    expect(secret).not.toHaveTextContent(
      HuntressTriggerPanelCopy.stepSecretBody,
    );
    expect(
      within(secret).getByTestId("huntress-trigger-signing-secret-saved"),
    ).toHaveTextContent(HuntressTriggerPanelCopy.secretSaved);
    expect(
      within(secret).getByTestId("huntress-trigger-signing-secret-button"),
    ).toHaveTextContent("Replace Signing Secret");

    // The step still to do keeps its instructions.
    expect(
      screen.getByTestId("huntress-trigger-step-test-body"),
    ).toHaveTextContent(HuntressTriggerPanelCopy.stepTestBody);
  });

  /*
   * Saving the secret clears the refusal it fixed, which was the only sign
   * Huntress had reached the URL: the endpoint's step used to go back to
   * undone the moment its secret was saved.
   */
  test("saving the secret after a refused request keeps the endpoint's step done", async () => {
    facts = {
      isWebhookSigningSecretSet: false,
      lastWebhookError:
        "A request arrived but was refused, because no signing secret is saved for this workflow yet.",
      lastWebhookErrorAt: new Date(),
    };

    renderPanel();
    await loaded();

    expect(
      screen.getByTestId("huntress-trigger-step-endpoint-done"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("huntress-trigger-step-secret")).toHaveAttribute(
      "aria-current",
      "step",
    );

    fireEvent.click(
      screen.getByTestId("huntress-trigger-signing-secret-button"),
    );

    const dialog: HTMLElement = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByPlaceholderText("whsec_…"), {
      target: { value: SECRET },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save Signing Secret" }),
    );

    // As the server does: the new secret clears the refusal it fixed.
    await waitFor(() => {
      expect(state()).toBe("waiting");
    });

    expect(
      screen.getByTestId("huntress-trigger-step-endpoint-done"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("huntress-trigger-step-secret-done"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("huntress-trigger-step-test")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(
      screen.queryByTestId("huntress-trigger-last-error"),
    ).not.toBeInTheDocument();
  });

  test("a refused request checks the endpoint's step, and says why it was refused", async () => {
    facts = {
      isWebhookSigningSecretSet: false,
      lastWebhookError:
        "A request arrived but was refused, because no signing secret is saved for this workflow yet.",
      lastWebhookErrorAt: new Date(),
    };

    renderPanel();
    await loaded();

    expect(state()).toBe("failing");
    expect(
      screen.getByTestId("huntress-trigger-step-endpoint-done"),
    ).toBeInTheDocument();

    const error: HTMLElement = screen.getByTestId(
      "huntress-trigger-last-error",
    );

    expect(error).toHaveTextContent(HuntressTriggerPanelCopy.lastRefused);
    expect(error).toHaveTextContent("no signing secret is saved");
  });

  test("reads the workflow again while it waits, and shows Huntress arriving", async () => {
    jest.useFakeTimers();
    facts = { isWebhookSigningSecretSet: true };

    renderPanel();

    await act(async () => {
      await Promise.resolve();
    });

    expect(reads).toBe(1);

    facts = {
      isWebhookSigningSecretSet: true,
      lastWebhookRequestAt: new Date(),
    };

    await act(async () => {
      jest.advanceTimersByTime(HUNTRESS_TRIGGER_POLL_INTERVAL_MS);
      await Promise.resolve();
    });

    expect(reads).toBe(2);
    expect(screen.getByTestId("huntress-trigger-status")).toBeInTheDocument();
    expect(state()).toBe("receiving");

    // Arrived: no more reading.
    await act(async () => {
      jest.advanceTimersByTime(HUNTRESS_TRIGGER_POLL_INTERVAL_MS * 3);
      await Promise.resolve();
    });

    expect(reads).toBe(2);
  });
});

describe("while it reads the workflow", () => {
  /*
   * A workflow Huntress already reaches opens on its status: the steps are
   * never drawn first, only to give way a moment later.
   */
  test("shows neither the steps nor the status until the first read answers", async () => {
    let answer: (workflow: Workflow) => void = (): void => {};

    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation((async (): Promise<Workflow | null> => {
        reads++;

        return await new Promise<Workflow>(
          (resolve: (workflow: Workflow) => void): void => {
            answer = resolve;
          },
        );
      }) as never);

    renderPanel();

    expect(
      await screen.findByTestId("huntress-trigger-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("huntress-trigger-setup"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("huntress-trigger-status"),
    ).not.toBeInTheDocument();

    await act(async () => {
      answer(
        workflowOf({
          isWebhookSigningSecretSet: true,
          lastWebhookRequestAt: new Date(),
        }),
      );
      await Promise.resolve();
    });

    expect(
      await screen.findByTestId("huntress-trigger-status"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("huntress-trigger-loading"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("huntress-trigger-setup"),
    ).not.toBeInTheDocument();
  });

  // Each state's markup is valid: React warns of an element no parent may hold.
  test("draws no element inside one that may not hold it, in any state", async () => {
    const errors: Array<string> = [];
    const consoleError: SpyInstance<typeof console.error> = jest
      .spyOn(console, "error")
      .mockImplementation((...args: Array<unknown>): void => {
        errors.push(args.map(String).join(" "));
      });

    const states: Array<Facts> = [
      { isWebhookSigningSecretSet: false },
      { isWebhookSigningSecretSet: true },
      {
        isWebhookSigningSecretSet: true,
        lastWebhookRequestAt: new Date(Date.now() - 60 * 1000),
      },
      {
        isWebhookSigningSecretSet: true,
        lastWebhookRequestAt: new Date(Date.now() - 60 * 60 * 1000),
        lastWebhookError: "The request body is not valid JSON.",
        lastWebhookErrorAt: new Date(),
      },
    ];

    for (const current of states) {
      facts = current;

      const view: { unmount: () => void } = render(
        <HuntressTriggerPanel
          workflowId={WORKFLOW_ID}
          url={URL}
          canSeeUrl={true}
        />,
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("huntress-trigger-state"),
        ).toBeInTheDocument();
      });

      view.unmount();
    }

    consoleError.mockRestore();

    expect(
      errors.filter((message: string): boolean => {
        return message.includes("validateDOMNesting");
      }),
    ).toEqual([]);
  });
});

describe("once Huntress reaches it", () => {
  test("shrinks to where it stands, with the URL and the secret at hand", async () => {
    facts = {
      isWebhookSigningSecretSet: true,
      lastWebhookRequestAt: new Date(Date.now() - 5 * 60 * 1000),
    };

    renderPanel();
    await loaded();

    const status: HTMLElement = screen.getByTestId("huntress-trigger-status");

    expect(state()).toBe("receiving");
    expect(status).toHaveTextContent("Receiving reports");
    expect(status).toHaveTextContent(HuntressTriggerPanelCopy.lastEvent);
    expect(status).toHaveTextContent(HuntressTriggerPanelCopy.secretSaved);
    expect(screen.getByTestId("huntress-trigger-url")).toHaveTextContent(URL);
    expect(
      screen.queryByTestId("huntress-trigger-setup"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("huntress-trigger-last-error"),
    ).not.toBeInTheDocument();
  });

  test("a refusal newer than the last request shows, and the state says Huntress is refused", async () => {
    facts = {
      isWebhookSigningSecretSet: true,
      lastWebhookRequestAt: new Date(Date.now() - 60 * 60 * 1000),
      lastWebhookError:
        "The request's signature does not match the signing secret.",
      lastWebhookErrorAt: new Date(),
    };

    renderPanel();
    await loaded();

    expect(state()).toBe("failing");
    expect(screen.getByTestId("huntress-trigger-last-error")).toHaveTextContent(
      "does not match the signing secret",
    );
  });

  test("a refusal older than the last request was put right since: not shown", async () => {
    facts = {
      isWebhookSigningSecretSet: true,
      lastWebhookRequestAt: new Date(),
      lastWebhookError: "The request body is not valid JSON.",
      lastWebhookErrorAt: new Date(Date.now() - 60 * 60 * 1000),
    };

    renderPanel();
    await loaded();

    expect(state()).toBe("receiving");
    expect(
      screen.queryByTestId("huntress-trigger-last-error"),
    ).not.toBeInTheDocument();
  });
});

describe("the signing secret", () => {
  async function openDialog(): Promise<HTMLElement> {
    renderPanel();
    await loaded();

    fireEvent.click(
      screen.getByTestId("huntress-trigger-signing-secret-button"),
    );

    return await screen.findByRole("dialog");
  }

  test("is pasted into a dialog that says where Huntress shows it, and saved write-only", async () => {
    const dialog: HTMLElement = await openDialog();

    expect(dialog).toHaveTextContent("View Signing Secret");

    const input: HTMLElement = within(dialog).getByPlaceholderText("whsec_…");

    fireEvent.change(input, { target: { value: `  ${SECRET}  ` } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save Signing Secret" }),
    );

    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });

    expect(writes[0]!.id.toString()).toBe(WORKFLOW_ID.toString());
    expect(writes[0]!.data).toEqual({ webhookSigningSecret: SECRET });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Read again: the panel learns that one is saved, never what it is.
    await waitFor(() => {
      expect(
        screen.getByTestId("huntress-trigger-step-secret-done"),
      ).toBeInTheDocument();
    });
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  test("something that is not one is caught before it is sent", async () => {
    const dialog: HTMLElement = await openDialog();

    fireEvent.change(within(dialog).getByPlaceholderText("whsec_…"), {
      target: { value: URL },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save Signing Secret" }),
    );

    await waitFor(() => {
      expect(dialog).toHaveTextContent(HUNTRESS_SIGNING_SECRET_PROBLEM);
    });
    expect(writes).toHaveLength(0);
  });

  test("the server's refusal stays in the dialog", async () => {
    writeFailure = new Error("The signing secret is not one Huntress issues.");

    const dialog: HTMLElement = await openDialog();

    fireEvent.change(within(dialog).getByPlaceholderText("whsec_…"), {
      target: { value: SECRET },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save Signing Secret" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "The signing secret is not one Huntress issues.",
      );
    });
  });

  test("someone who may not edit the workflow sees the button disabled, with why", async () => {
    jest
      .spyOn(PermissionGate, "check")
      .mockReturnValue({ isAllowed: false, disabledReason: NO_PERMISSION });

    renderPanel();
    await loaded();

    const button: HTMLElement = screen.getByTestId(
      "huntress-trigger-signing-secret-button",
    );

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("someone the model offers no edit at all sees no button", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: false });

    renderPanel();
    await loaded();

    expect(
      screen.queryByTestId("huntress-trigger-signing-secret-button"),
    ).not.toBeInTheDocument();
  });
});

describe("what it cannot show", () => {
  test("a URL this person may not see says so, as the Webhook trigger does", async () => {
    renderPanel({ url: null, canSeeUrl: false });
    await loaded();

    expect(screen.getByTestId("huntress-trigger-url-hidden")).toHaveTextContent(
      WebhookTriggerPanelCopy.hidden,
    );
  });

  test("a workflow with no key yet says so", async () => {
    renderPanel({ url: null });
    await loaded();

    expect(
      screen.getByTestId("huntress-trigger-url-missing"),
    ).toHaveTextContent(WebhookTriggerPanelCopy.missing);
  });

  /*
   * The template creates the workflow off, and Huntress's test is refused
   * until it is on: so the last step says to turn it on first, naming the
   * switch as the Builder draws it, in bold.
   */
  test("a workflow that is off: the last step says to turn it on, then send the test", async () => {
    facts = { isWebhookSigningSecretSet: true };

    renderPanel({ isWorkflowOff: true });
    await loaded();

    const step: HTMLElement = screen.getByTestId("huntress-trigger-step-test");

    expect(step).toHaveTextContent(HuntressTriggerPanelCopy.stepTurnOnTitle);
    expect(step).not.toHaveTextContent(HuntressTriggerPanelCopy.stepTestTitle);
    expect(
      screen.getByTestId("huntress-trigger-step-test-body"),
    ).toHaveTextContent(
      "Switch Enabled on at the top of the Builder. Then, in Huntress, choose Send Test on the endpoint. It shows up here within a few seconds.",
    );
    expect(
      screen.getByTestId("huntress-trigger-enabled-switch-name").tagName,
    ).toBe("STRONG");
    expect(
      screen.getByTestId("huntress-trigger-enabled-switch-name"),
    ).toHaveTextContent("Enabled");

    // Said at the step it belongs to, so not again above the steps.
    expect(
      screen.queryByTestId("huntress-trigger-workflow-off"),
    ).not.toBeInTheDocument();
  });

  test("a workflow that is on: the last step only asks for the test", async () => {
    renderPanel({ isWorkflowOff: false });
    await loaded();

    const step: HTMLElement = screen.getByTestId("huntress-trigger-step-test");

    expect(step).toHaveTextContent(HuntressTriggerPanelCopy.stepTestTitle);
    expect(step).not.toHaveTextContent(
      HuntressTriggerPanelCopy.stepTurnOnTitle,
    );
    expect(
      screen.queryByTestId("huntress-trigger-enabled-switch-name"),
    ).not.toBeInTheDocument();
  });

  // No steps once Huntress reaches it: the note says the URL refuses requests.
  test("a workflow Huntress reaches, turned off, says it refuses requests until it is on", async () => {
    facts = {
      isWebhookSigningSecretSet: true,
      lastWebhookRequestAt: new Date(Date.now() - 5 * 60 * 1000),
    };

    renderPanel({ isWorkflowOff: true });
    await loaded();

    expect(screen.getByTestId("huntress-trigger-status")).toBeInTheDocument();
    expect(
      screen.getByTestId("huntress-trigger-workflow-off"),
    ).toBeInTheDocument();
  });

  test("a workflow it cannot read says so, and Try again reads it again", async () => {
    facts = new Error("Network error");

    renderPanel();

    expect(
      await screen.findByTestId("huntress-trigger-load-error"),
    ).toHaveTextContent(HuntressTriggerPanelCopy.loadError);
    expect(screen.getByRole("alert")).toHaveTextContent(
      HuntressTriggerPanelCopy.loadError,
    );
    expect(
      screen.queryByTestId("huntress-trigger-setup"),
    ).not.toBeInTheDocument();
    expect(reads).toBe(1);

    facts = { isWebhookSigningSecretSet: true };

    fireEvent.click(screen.getByTestId("huntress-trigger-load-retry"));

    expect(
      await screen.findByTestId("huntress-trigger-setup"),
    ).toBeInTheDocument();
    expect(reads).toBe(2);
    expect(state()).toBe("waiting");
    expect(
      screen.queryByTestId("huntress-trigger-load-error"),
    ).not.toBeInTheDocument();
  });

  test("a step not saved yet has no workflow to read: the steps show, unchecked", async () => {
    render(<HuntressTriggerPanel url={null} canSeeUrl={true} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(reads).toBe(0);
    expect(screen.getByTestId("huntress-trigger-setup")).toBeInTheDocument();
    expect(
      screen.getByTestId("huntress-trigger-signing-secret-button"),
    ).toBeDisabled();
  });
});
