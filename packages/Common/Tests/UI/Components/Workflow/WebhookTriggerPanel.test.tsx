/*
 * The Webhook trigger's URL panel: where a workflow's webhook URL - and the
 * secret key that is its last segment - is shown, copied and reset.
 *
 * The maintainer's ask: the webhook secret key belongs inside the Webhook
 * component, not on the workflow's Settings page. So the panel now does what
 * the Settings card did - keep the key off the screen until asked, let it be
 * copied, reset it - next to the URL it is part of.
 *
 * Rendered for real: the actual Button, ConfirmModal, CopyTextButton and
 * Tooltip. Nothing is stubbed but the clipboard.
 */

import WebhookTriggerPanel, {
  ComponentProps,
  WebhookTriggerPanelCopy,
  getMethodsSentence,
} from "../../../../UI/Components/Workflow/WebhookTriggerPanel";
import {
  WEBHOOK_TRIGGER_SECRET_MASK,
  getWebhookTriggerCurlExample,
} from "../../../../Types/Workflow/WebhookTrigger";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  RenderResult,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

const SECRET: string = "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b";
const NEW_SECRET: string = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const PREFIX: string = "https://oneuptime.example.com/workflow/trigger/";
const WEBHOOK_URL: string = `${PREFIX}${SECRET}`;
const NEW_WEBHOOK_URL: string = `${PREFIX}${NEW_SECRET}`;
const MASKED_URL: string = `${PREFIX}${WEBHOOK_TRIGGER_SECRET_MASK}`;

const NO_PERMISSION: string =
  "You do not have permission to reset this webhook URL. You need one of these permissions: Project Owner, Project Admin, Edit Workflow.";

type SetClipboardFunction = (
  writeText: ((text: string) => Promise<void>) | null,
) => void;

const setClipboard: SetClipboardFunction = (
  writeText: ((text: string) => Promise<void>) | null,
): void => {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText: writeText } : undefined,
    configurable: true,
  });
};

type CaptureClipboardFunction = () => Array<string>;

const captureClipboard: CaptureClipboardFunction = (): Array<string> => {
  const copied: Array<string> = [];

  setClipboard(async (text: string): Promise<void> => {
    copied.push(text);
  });

  return copied;
};

afterEach(() => {
  setClipboard(null);
});

type RenderPanelFunction = (overrides?: Partial<ComponentProps>) => {
  view: RenderResult;
  props: ComponentProps;
};

const renderPanel: RenderPanelFunction = (
  overrides?: Partial<ComponentProps>,
): { view: RenderResult; props: ComponentProps } => {
  const props: ComponentProps = {
    webhookUrl: WEBHOOK_URL,
    webhookUrlPrefix: PREFIX,
    canSeeUrl: true,
    ...(overrides || {}),
  };

  return { view: render(<WebhookTriggerPanel {...props} />), props: props };
};

type ElementFunction = () => HTMLElement;

const urlBox: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("webhook-trigger-url");
};

const curl: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("webhook-trigger-curl");
};

const visibilityToggle: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("webhook-trigger-url-visibility");
};

const resetButton: ElementFunction = (): HTMLElement => {
  return screen.getByRole("button", { name: "Reset URL" });
};

type ConfirmDialogFunction = () => HTMLElement;

const confirmDialog: ConfirmDialogFunction = (): HTMLElement => {
  return screen.getByRole("dialog");
};

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type MakeDeferredFunction = () => Deferred;

const makeDeferred: MakeDeferredFunction = (): Deferred => {
  let resolve: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise: Promise<void> = new Promise<void>(
    (res: () => void, rej: (error: unknown) => void) => {
      resolve = res;
      reject = rej;
    },
  );

  return { promise, resolve, reject };
};

describe("the URL is masked until the reader asks to see it", () => {
  test("opens with the key masked: the host and path show, the key does not", () => {
    const { view } = renderPanel();

    expect(urlBox()).toHaveAttribute("data-url-shown", "false");
    expect(urlBox()).toHaveTextContent(PREFIX);
    expect(urlBox().textContent).toContain(WEBHOOK_TRIGGER_SECRET_MASK);
    // Nowhere on the page: not in the box, the example request or an attribute.
    expect(view.container.innerHTML).not.toContain(SECRET);
  });

  test("the mask is a fixed length and says nothing about the key", () => {
    renderPanel({ webhookUrl: `${PREFIX}abc` });

    expect(urlBox().textContent).toContain(WEBHOOK_TRIGGER_SECRET_MASK);

    renderPanel({ webhookUrl: `${PREFIX}${"x".repeat(80)}` });

    for (const box of screen.getAllByTestId("webhook-trigger-url")) {
      expect(box.textContent).toContain(
        `/trigger/${WEBHOOK_TRIGGER_SECRET_MASK}`,
      );
    }
  });

  test("screen readers hear that the key is hidden, not a row of bullets", () => {
    renderPanel();

    const bullets: HTMLElement = within(urlBox()).getByText(
      WEBHOOK_TRIGGER_SECRET_MASK,
    );

    expect(bullets).toHaveAttribute("aria-hidden", "true");
    expect(within(urlBox()).getByText("secret key hidden")).toHaveClass(
      "sr-only",
    );
  });

  test("the example request uses the masked URL too", () => {
    renderPanel();

    expect(curl().textContent).toBe(getWebhookTriggerCurlExample(MASKED_URL));
    expect(curl().textContent).not.toContain(SECRET);
  });

  test("Show reveals the whole URL, in the box and in the example request", () => {
    renderPanel();

    fireEvent.click(visibilityToggle());

    expect(urlBox()).toHaveAttribute("data-url-shown", "true");
    expect(urlBox().textContent).toBe(WEBHOOK_URL);
    expect(curl().textContent).toBe(getWebhookTriggerCurlExample(WEBHOOK_URL));
  });

  test("Hide masks it again", () => {
    const { view } = renderPanel();

    fireEvent.click(visibilityToggle());
    fireEvent.click(visibilityToggle());

    expect(urlBox()).toHaveAttribute("data-url-shown", "false");
    expect(view.container.innerHTML).not.toContain(SECRET);
  });

  test("the toggle says what it will do, to sight and to screen readers", () => {
    renderPanel();

    expect(visibilityToggle()).toHaveTextContent("Show");
    expect(visibilityToggle()).toHaveAccessibleName("Show the full URL");
    expect(visibilityToggle()).toHaveAttribute("type", "button");

    fireEvent.click(visibilityToggle());

    expect(visibilityToggle()).toHaveTextContent("Hide");
    expect(visibilityToggle()).toHaveAccessibleName("Hide the secret key");
  });
});

describe("copying never needs the URL on screen", () => {
  test("Copy URL copies the whole URL while the key is masked", async () => {
    const copied: Array<string> = captureClipboard();

    renderPanel();

    const copyButton: HTMLElement = screen.getByRole("button", {
      name: "Copy the webhook URL",
    });

    expect(copyButton).toHaveTextContent("Copy URL");

    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(copied).toEqual([WEBHOOK_URL]);
    expect(copyButton).toHaveTextContent("Copied!");
    expect(urlBox()).toHaveAttribute("data-url-shown", "false");
  });

  test("the example request's Copy copies the real request, not the masked one", async () => {
    const copied: Array<string> = captureClipboard();

    renderPanel();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy the example request" }),
      );
    });

    expect(copied).toEqual([getWebhookTriggerCurlExample(WEBHOOK_URL)]);
  });

  test("Copy URL is the first control, so the dialog's keyboard focus lands on it", () => {
    renderPanel({ onResetUrl: getJestMockFunction() });

    const firstButton: HTMLElement = screen.getAllByRole("button")[0]!;

    expect(firstButton).toHaveAccessibleName("Copy the webhook URL");
  });
});

describe("what the URL accepts", () => {
  test("says which methods the URL accepts, as one sentence with the methods as badges", () => {
    renderPanel();

    const methods: HTMLElement = screen.getByTestId("webhook-trigger-methods");

    expect(methods.textContent).toBe("Accepts GET or POST requests.");
    expect(within(methods).getByText("GET")).toHaveClass("font-mono");
    expect(within(methods).getByText("POST")).toHaveClass("font-mono");
  });

  test("the sentence is built from the methods the trigger accepts", () => {
    expect(getMethodsSentence()).toBe(WebhookTriggerPanelCopy.methods);
  });
});

describe("keeping the URL private", () => {
  test("says the URL is a secret, and to reset it if it leaks", () => {
    renderPanel({ onResetUrl: getJestMockFunction() });

    expect(screen.getByTestId("webhook-trigger-url-private")).toHaveTextContent(
      "Anyone with this URL can start the workflow, so keep it private. If it leaks, reset it.",
    );
  });

  test("does not tell someone who cannot reset it to reset it", () => {
    renderPanel({
      onResetUrl: getJestMockFunction(),
      resetDisabledReason: NO_PERMISSION,
    });

    const note: HTMLElement = screen.getByTestId("webhook-trigger-url-private");

    expect(note).toHaveTextContent(
      "Anyone with this URL can start the workflow, so keep it private.",
    );
    expect(note).not.toHaveTextContent("reset it");
  });

  test("without a reset, there is no reset button and no talk of one", () => {
    renderPanel();

    expect(
      screen.queryByRole("button", { name: "Reset URL" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-trigger-url-private"),
    ).not.toHaveTextContent("reset");
  });
});

describe("Reset URL", () => {
  test("asks first, and says the current URL stops working at once", () => {
    const onResetUrl: MockFunction = getJestMockFunction();

    renderPanel({ onResetUrl: onResetUrl });

    fireEvent.click(resetButton());

    const dialog: HTMLElement = confirmDialog();

    expect(dialog).toHaveTextContent("Reset the webhook URL?");
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      "The workflow gets a new URL, and the current one stops working at once. Anything that still calls it will fail until you give it the new URL.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Reset URL" }),
    ).toBeInTheDocument();
    expect(onResetUrl).not.toHaveBeenCalled();
  });

  test("Cancel leaves the URL alone", () => {
    const onResetUrl: MockFunction = getJestMockFunction();

    renderPanel({ onResetUrl: onResetUrl });

    fireEvent.click(resetButton());
    fireEvent.click(
      within(confirmDialog()).getByRole("button", { name: "Cancel" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onResetUrl).not.toHaveBeenCalled();
  });

  test("confirming resets it, closes the confirmation and says what to do next", async () => {
    const deferred: Deferred = makeDeferred();
    const onResetUrl: MockFunction = getJestMockFunction().mockReturnValue(
      deferred.promise,
    );

    renderPanel({ onResetUrl: onResetUrl });

    fireEvent.click(resetButton());
    fireEvent.click(
      within(confirmDialog()).getByRole("button", { name: "Reset URL" }),
    );

    expect(onResetUrl).toHaveBeenCalledTimes(1);
    // Still open while the new key is being saved.
    expect(confirmDialog()).toBeInTheDocument();
    expect(
      screen.queryByTestId("webhook-trigger-url-reset-done"),
    ).not.toBeInTheDocument();

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const done: HTMLElement = screen.getByTestId(
      "webhook-trigger-url-reset-done",
    );

    expect(done).toHaveAttribute("role", "status");
    expect(done).toHaveTextContent(
      "URL reset. The old one no longer works, so copy this one into anything that should start the workflow.",
    );
  });

  test("a second click while the reset is saving does not reset twice", async () => {
    const deferred: Deferred = makeDeferred();
    const onResetUrl: MockFunction = getJestMockFunction().mockReturnValue(
      deferred.promise,
    );

    renderPanel({ onResetUrl: onResetUrl });

    fireEvent.click(resetButton());

    const confirm: HTMLElement = within(confirmDialog()).getByTestId(
      "modal-footer-submit-button",
    );

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    expect(onResetUrl).toHaveBeenCalledTimes(1);
  });

  test("the new URL replaces the old one, still masked, and Copy URL copies the new one", async () => {
    const copied: Array<string> = captureClipboard();
    const onResetUrl: MockFunction =
      getJestMockFunction().mockResolvedValue(undefined);
    const { view, props } = renderPanel({ onResetUrl: onResetUrl });

    fireEvent.click(resetButton());

    await act(async () => {
      fireEvent.click(
        within(confirmDialog()).getByRole("button", { name: "Reset URL" }),
      );
    });

    // The builder saves the key and hands the new URL back down.
    view.rerender(
      <WebhookTriggerPanel {...props} webhookUrl={NEW_WEBHOOK_URL} />,
    );

    expect(urlBox()).toHaveAttribute("data-url-shown", "false");
    expect(view.container.innerHTML).not.toContain(NEW_SECRET);
    expect(screen.getByTestId("webhook-trigger-url-reset-done")).toBeVisible();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy the webhook URL" }),
      );
    });

    expect(copied).toEqual([NEW_WEBHOOK_URL]);

    fireEvent.click(visibilityToggle());

    expect(urlBox().textContent).toBe(NEW_WEBHOOK_URL);
    expect(view.container.innerHTML).not.toContain(SECRET);
  });

  test("a URL that was shown stays shown across the reset", async () => {
    const onResetUrl: MockFunction =
      getJestMockFunction().mockResolvedValue(undefined);
    const { view, props } = renderPanel({ onResetUrl: onResetUrl });

    fireEvent.click(visibilityToggle());
    fireEvent.click(resetButton());

    await act(async () => {
      fireEvent.click(
        within(confirmDialog()).getByRole("button", { name: "Reset URL" }),
      );
    });

    view.rerender(
      <WebhookTriggerPanel {...props} webhookUrl={NEW_WEBHOOK_URL} />,
    );

    expect(urlBox().textContent).toBe(NEW_WEBHOOK_URL);
  });

  test("a failed reset keeps the confirmation open with the reason, and can be retried", async () => {
    const onResetUrl: MockFunction = getJestMockFunction()
      .mockRejectedValueOnce(
        new Error("You do not have permission to update this Workflow."),
      )
      .mockResolvedValueOnce(undefined);

    renderPanel({ onResetUrl: onResetUrl });

    fireEvent.click(resetButton());

    await act(async () => {
      fireEvent.click(
        within(confirmDialog()).getByRole("button", { name: "Reset URL" }),
      );
    });

    expect(confirmDialog()).toHaveTextContent(
      "You do not have permission to update this Workflow.",
    );
    expect(
      screen.queryByTestId("webhook-trigger-url-reset-done"),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(confirmDialog()).getByRole("button", { name: "Reset URL" }),
      );
    });

    expect(onResetUrl).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      screen.getByTestId("webhook-trigger-url-reset-done"),
    ).toBeInTheDocument();
  });

  test("an error from an earlier attempt is gone when the confirmation is opened again", async () => {
    const onResetUrl: MockFunction = getJestMockFunction().mockRejectedValue(
      new Error("Network error"),
    );

    renderPanel({ onResetUrl: onResetUrl });

    fireEvent.click(resetButton());

    await act(async () => {
      fireEvent.click(
        within(confirmDialog()).getByRole("button", { name: "Reset URL" }),
      );
    });

    expect(confirmDialog()).toHaveTextContent("Network error");

    fireEvent.click(
      within(confirmDialog()).getByRole("button", { name: "Cancel" }),
    );
    fireEvent.click(resetButton());

    expect(confirmDialog()).not.toHaveTextContent("Network error");
  });

  test("someone who may not reset it sees the button disabled, with the permission they need", () => {
    const onResetUrl: MockFunction = getJestMockFunction();

    renderPanel({
      onResetUrl: onResetUrl,
      resetDisabledReason: NO_PERMISSION,
    });

    const button: HTMLElement = screen.getByTestId("webhook-trigger-reset-url");

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.mouseEnter(
      screen.getByTestId("webhook-trigger-reset-url-disabled-wrapper"),
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent(NO_PERMISSION);
    expect(onResetUrl).not.toHaveBeenCalled();
  });
});

describe("a URL built from the workflow's ID", () => {
  test("says the URL is not private, next to the reset that fixes it", () => {
    renderPanel({
      isUrlBuiltFromWorkflowId: true,
      onResetUrl: getJestMockFunction(),
    });

    const warning: HTMLElement = screen.getByTestId(
      "webhook-trigger-url-is-workflow-id",
    );

    expect(warning).toHaveTextContent(
      "This URL ends in the workflow's ID, which anyone who can open the workflow can see. Reset it to get a private URL.",
    );
    expect(warning).toHaveClass("bg-amber-50");
    expect(resetButton()).toBeEnabled();
    // It replaces the usual note rather than adding to it.
    expect(
      screen.queryByTestId("webhook-trigger-url-private"),
    ).not.toBeInTheDocument();
  });

  test("does not ask someone who cannot reset it to reset it", () => {
    renderPanel({
      isUrlBuiltFromWorkflowId: true,
      onResetUrl: getJestMockFunction(),
      resetDisabledReason: NO_PERMISSION,
    });

    const warning: HTMLElement = screen.getByTestId(
      "webhook-trigger-url-is-workflow-id",
    );

    expect(warning).toHaveTextContent(
      "This URL ends in the workflow's ID, which anyone who can open the workflow can see.",
    );
    expect(warning).not.toHaveTextContent("Reset it");
  });

  test("an ordinary key gets no such warning", () => {
    renderPanel({ onResetUrl: getJestMockFunction() });

    expect(
      screen.queryByTestId("webhook-trigger-url-is-workflow-id"),
    ).not.toBeInTheDocument();
  });
});

describe("a workflow with no URL yet", () => {
  test("says so and offers to create one, with nothing to copy or show", () => {
    renderPanel({ webhookUrl: null, onResetUrl: getJestMockFunction() });

    expect(screen.getByTestId("webhook-trigger-url-missing")).toHaveTextContent(
      "This workflow does not have a webhook URL yet.",
    );
    expect(
      screen.getByRole("button", { name: "Create URL" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("webhook-trigger-url")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("webhook-trigger-curl"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("webhook-trigger-url-visibility"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy the webhook URL" }),
    ).not.toBeInTheDocument();
  });

  test("Create URL creates it straight away: there is nothing to break, so nothing to confirm", async () => {
    const onResetUrl: MockFunction =
      getJestMockFunction().mockResolvedValue(undefined);

    renderPanel({ webhookUrl: null, onResetUrl: onResetUrl });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create URL" }));
    });

    expect(onResetUrl).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("a failed create says why", async () => {
    const onResetUrl: MockFunction = getJestMockFunction().mockRejectedValue(
      new Error("Workflow not found"),
    );

    renderPanel({ webhookUrl: null, onResetUrl: onResetUrl });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create URL" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Workflow not found");
  });

  test("without a way to create one, it only says there is none", () => {
    renderPanel({ webhookUrl: null });

    expect(
      screen.getByTestId("webhook-trigger-url-missing"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create URL" }),
    ).not.toBeInTheDocument();
  });

  test("someone who may not create one sees Create URL disabled", () => {
    const onResetUrl: MockFunction = getJestMockFunction();

    renderPanel({
      webhookUrl: null,
      onResetUrl: onResetUrl,
      resetDisabledReason: NO_PERMISSION,
    });

    const button: HTMLElement = screen.getByTestId(
      "webhook-trigger-create-url",
    );

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onResetUrl).not.toHaveBeenCalled();
  });
});

describe("someone who may not see the key", () => {
  test("is told why the URL is hidden and who to ask, and given nothing else", () => {
    renderPanel({
      canSeeUrl: false,
      webhookUrl: null,
      onResetUrl: getJestMockFunction(),
    });

    expect(screen.getByTestId("webhook-trigger-url-hidden")).toHaveTextContent(
      "The webhook URL contains this workflow's secret key, so only people who can edit this workflow can see it. Ask one of them for it.",
    );
    expect(screen.queryByTestId("webhook-trigger-url")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("webhook-trigger-curl"),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("never renders a URL it is handed anyway", () => {
    const { view } = renderPanel({ canSeeUrl: false });

    expect(view.container.innerHTML).not.toContain(SECRET);
    expect(
      screen.getByTestId("webhook-trigger-url-hidden"),
    ).toBeInTheDocument();
  });

  test("the section keeps its name, so the dialog still opens on it", () => {
    renderPanel({ canSeeUrl: false, webhookUrl: null });

    expect(
      screen.getByTestId("workflow-component-section-webhook-url"),
    ).toHaveTextContent("Webhook URL");
  });
});

describe("in another language", () => {
  // The dashboard's own German file, so this also proves the keys line up.
  const german: i18n = createInstance();

  beforeAll(async () => {
    const translations: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "..",
          "App",
          "FeatureSet",
          "Dashboard",
          "src",
          "Locales",
          "de.json",
        ),
        "utf8",
      ),
    );

    await german.init({
      lng: "de",
      fallbackLng: "de",
      resources: { de: { translation: translations } },
      interpolation: { escapeValue: false },
    });
  });

  type GermanWrapperFunction = (props: {
    children?: ReactNode;
  }) => ReactElement;

  const GermanWrapper: GermanWrapperFunction = ({
    children,
  }: {
    children?: ReactNode;
  }): ReactElement => {
    return <I18nextProvider i18n={german}>{children}</I18nextProvider>;
  };

  test("every sentence is translated whole, and the methods keep their badges", () => {
    render(
      <WebhookTriggerPanel
        webhookUrl={WEBHOOK_URL}
        webhookUrlPrefix={PREFIX}
        canSeeUrl={true}
        onResetUrl={getJestMockFunction()}
      />,
      { wrapper: GermanWrapper },
    );

    const section: HTMLElement = screen.getByTestId(
      "workflow-component-section-webhook-url",
    );

    expect(section).toHaveTextContent("Webhook-URL");
    expect(section).toHaveTextContent(
      "Senden Sie eine Anfrage an diese URL, um den Arbeitsablauf zu starten.",
    );
    expect(
      screen.getByRole("button", { name: "Webhook-URL kopieren" }),
    ).toHaveTextContent("URL kopieren");
    expect(visibilityToggle()).toHaveTextContent("Anzeigen");

    const methods: HTMLElement = screen.getByTestId("webhook-trigger-methods");

    expect(methods.textContent).toBe("Akzeptiert GET- oder POST-Anfragen.");
    expect(within(methods).getByText("GET")).toHaveClass("font-mono");
    expect(within(methods).getByText("POST")).toHaveClass("font-mono");

    fireEvent.click(screen.getByRole("button", { name: "URL zurücksetzen" }));

    expect(confirmDialog()).toHaveTextContent("Webhook-URL zurücksetzen?");
    expect(confirmDialog()).toHaveTextContent(
      "Der Arbeitsablauf erhält eine neue URL, und die aktuelle funktioniert ab sofort nicht mehr.",
    );
  });

  test("the hidden state is translated too", () => {
    render(
      <WebhookTriggerPanel
        webhookUrl={null}
        webhookUrlPrefix={PREFIX}
        canSeeUrl={false}
      />,
      { wrapper: GermanWrapper },
    );

    expect(screen.getByTestId("webhook-trigger-url-hidden")).toHaveTextContent(
      "Die Webhook-URL enthält den geheimen Schlüssel dieses Arbeitsablaufs.",
    );
  });
});
