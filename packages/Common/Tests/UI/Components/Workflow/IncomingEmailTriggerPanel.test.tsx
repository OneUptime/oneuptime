/*
 * The Incoming Email trigger's address panel: where a workflow's own email
 * address - and the secret key in it - is shown, copied, created and reset.
 *
 * The maintainer asked for an Incoming Email component "just like we have the
 * webhook component", so the panel mirrors the Webhook trigger's URL panel:
 * the key stays off the screen until asked, Copy address copies the real
 * address either way, and Reset address asks first and says what breaks. It
 * also has two states the webhook does not: a server that receives no email
 * at all, and a step added a moment ago whose address does not exist yet.
 *
 * Rendered for real: the actual Button, ConfirmModal, CopyTextButton and
 * Tooltip. Nothing is stubbed but the clipboard.
 */

import IncomingEmailTriggerPanel, {
  ComponentProps,
  IncomingEmailTriggerPanelCopy,
} from "../../../../UI/Components/Workflow/IncomingEmailTriggerPanel";
import { WebhookTriggerPanelCopy } from "../../../../UI/Components/Workflow/WebhookTriggerPanel";
import { INCOMING_EMAIL_TRIGGER_SECRET_MASK } from "../../../../Types/Workflow/IncomingEmailTrigger";
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

const SECRET: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NEW_SECRET: string = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const DOMAIN: string = "inbound.oneuptime.example";
const ADDRESS: string = `workflow-${SECRET}@${DOMAIN}`;
const NEW_ADDRESS: string = `workflow-${NEW_SECRET}@${DOMAIN}`;
const GUIDE: string =
  "https://oneuptime.example/docs/self-hosted/sendgrid-inbound-email";

const NO_PERMISSION: string =
  "You do not have permission to reset this email address. You need one of these permissions: Project Owner, Project Admin, Edit Workflow.";

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
    inboundDomain: DOMAIN,
    address: ADDRESS,
    canSeeAddress: true,
    setupGuideUrl: GUIDE,
    ...(overrides || {}),
  };

  return {
    view: render(<IncomingEmailTriggerPanel {...props} />),
    props: props,
  };
};

type ElementFunction = () => HTMLElement;

const addressBox: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("incoming-email-trigger-address");
};

const visibilityToggle: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("incoming-email-trigger-address-visibility");
};

const resetButton: ElementFunction = (): HTMLElement => {
  return screen.getByRole("button", { name: "Reset address" });
};

const confirmDialog: ElementFunction = (): HTMLElement => {
  return screen.getByRole("dialog");
};

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const makeDeferred: () => Deferred = (): Deferred => {
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

describe("the address is what the step is opened for", () => {
  test("it is shown in a section of its own, saying what it is for", () => {
    renderPanel();

    const section: HTMLElement = screen.getByTestId(
      "workflow-component-section-email-address",
    );

    expect(section).toHaveTextContent("Email address");
    expect(section).toHaveTextContent(
      "Send an email to this address to start the workflow.",
    );
    expect(within(section).getByTestId("incoming-email-trigger-address")).toBe(
      addressBox(),
    );
  });

  test("Copy address is the first control, so the dialog's keyboard focus lands on it", () => {
    renderPanel({ onResetAddress: getJestMockFunction() });

    expect(screen.getAllByRole("button")[0]!).toHaveAccessibleName(
      "Copy the email address",
    );
  });
});

describe("the key in the address is masked until the reader asks to see it", () => {
  test("opens masked: the prefix and the domain show, the key does not", () => {
    const { view } = renderPanel();

    expect(addressBox()).toHaveAttribute("data-address-shown", "false");
    expect(addressBox().textContent).toBe(
      `workflow-${INCOMING_EMAIL_TRIGGER_SECRET_MASK} secret key hidden @${DOMAIN}`,
    );
    // Nowhere on the page: not in the box, a title or an attribute.
    expect(view.container.innerHTML).not.toContain(SECRET);
  });

  test("screen readers hear that the key is hidden, not a row of bullets", () => {
    renderPanel();

    expect(
      within(addressBox()).getByText(INCOMING_EMAIL_TRIGGER_SECRET_MASK),
    ).toHaveAttribute("aria-hidden", "true");
    expect(within(addressBox()).getByText(/secret key hidden/)).toHaveClass(
      "sr-only",
    );
  });

  test("the mask is the same whatever the key, so it says nothing about it", () => {
    renderPanel({ address: `workflow-${NEW_SECRET}@${DOMAIN}` });
    const first: string = addressBox().textContent || "";

    renderPanel();
    const boxes: Array<HTMLElement> = screen.getAllByTestId(
      "incoming-email-trigger-address",
    );

    expect(boxes[1]!.textContent).toBe(first);
  });

  test("Show reveals the whole address", () => {
    renderPanel();

    fireEvent.click(visibilityToggle());

    expect(addressBox()).toHaveAttribute("data-address-shown", "true");
    expect(addressBox().textContent).toBe(ADDRESS);
  });

  test("a long address may wrap only after the @, never inside the key", () => {
    renderPanel();

    fireEvent.click(visibilityToggle());

    const parts: Array<string> = Array.from(
      addressBox().querySelectorAll("span.whitespace-nowrap"),
    ).map((part: Element) => {
      return part.textContent || "";
    });

    expect(parts).toEqual([`workflow-${SECRET}@`, DOMAIN]);
    expect(addressBox().querySelectorAll("wbr")).toHaveLength(1);
  });

  test("Hide masks it again", () => {
    const { view } = renderPanel();

    fireEvent.click(visibilityToggle());
    fireEvent.click(visibilityToggle());

    expect(addressBox()).toHaveAttribute("data-address-shown", "false");
    expect(view.container.innerHTML).not.toContain(SECRET);
  });

  test("the toggle says what it will do, to sight and to screen readers", () => {
    renderPanel();

    expect(visibilityToggle()).toHaveTextContent("Show");
    expect(visibilityToggle()).toHaveAccessibleName("Show the full address");
    expect(visibilityToggle()).toHaveAttribute("type", "button");

    fireEvent.click(visibilityToggle());

    expect(visibilityToggle()).toHaveTextContent("Hide");
    expect(visibilityToggle()).toHaveAccessibleName("Hide the secret key");
  });
});

describe("copying never needs the address on screen", () => {
  test("Copy address copies the whole address while the key is masked", async () => {
    const copied: Array<string> = captureClipboard();

    renderPanel();

    const copyButton: HTMLElement = screen.getByRole("button", {
      name: "Copy the email address",
    });

    expect(copyButton).toHaveTextContent("Copy address");

    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(copied).toEqual([ADDRESS]);
    expect(copyButton).toHaveTextContent("Copied!");
    expect(addressBox()).toHaveAttribute("data-address-shown", "false");
  });
});

describe("keeping the address private", () => {
  test("says the address is a secret, and to reset it if it leaks", () => {
    renderPanel({ onResetAddress: getJestMockFunction() });

    expect(
      screen.getByTestId("incoming-email-trigger-address-private"),
    ).toHaveTextContent(
      "Anyone with this address can start the workflow, so keep it private. If the address leaks, reset it.",
    );
  });

  test("does not tell someone who cannot reset it to reset it", () => {
    renderPanel({
      onResetAddress: getJestMockFunction(),
      resetDisabledReason: NO_PERMISSION,
    });

    const note: HTMLElement = screen.getByTestId(
      "incoming-email-trigger-address-private",
    );

    expect(note).toHaveTextContent(
      "Anyone with this address can start the workflow, so keep it private.",
    );
    expect(note).not.toHaveTextContent("reset it");
  });

  test("without a reset, there is no reset button and no talk of one", () => {
    renderPanel();

    expect(
      screen.queryByRole("button", { name: "Reset address" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("incoming-email-trigger-address-private"),
    ).not.toHaveTextContent("reset");
  });
});

describe("Reset address", () => {
  test("asks first, and says the current address stops working at once", () => {
    const onResetAddress: MockFunction = getJestMockFunction();

    renderPanel({ onResetAddress: onResetAddress });

    fireEvent.click(resetButton());

    const dialog: HTMLElement = confirmDialog();

    expect(dialog).toHaveTextContent("Reset the email address?");
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      "The workflow gets a new address, and the current one stops working at once. Email sent to the current address will be ignored, so give the new one to everything that emails the workflow.",
    );
    expect(onResetAddress).not.toHaveBeenCalled();
  });

  test("Cancel leaves the address alone", () => {
    const onResetAddress: MockFunction = getJestMockFunction();

    renderPanel({ onResetAddress: onResetAddress });

    fireEvent.click(resetButton());
    fireEvent.click(
      within(confirmDialog()).getByRole("button", { name: "Cancel" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onResetAddress).not.toHaveBeenCalled();
  });

  test("confirming resets it, closes the confirmation and says what to do next", async () => {
    const deferred: Deferred = makeDeferred();
    const onResetAddress: MockFunction = getJestMockFunction().mockReturnValue(
      deferred.promise,
    );

    renderPanel({ onResetAddress: onResetAddress });

    fireEvent.click(resetButton());
    fireEvent.click(
      within(confirmDialog()).getByRole("button", { name: "Reset address" }),
    );

    expect(onResetAddress).toHaveBeenCalledTimes(1);
    // Still open while the new key is being saved.
    expect(confirmDialog()).toBeInTheDocument();

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const done: HTMLElement = screen.getByTestId(
      "incoming-email-trigger-address-reset-done",
    );

    expect(done).toHaveAttribute("role", "status");
    expect(done).toHaveTextContent(
      "Address reset. The old one no longer works, so give this one to anything that should email the workflow.",
    );
  });

  test("a second click while the reset is saving does not reset twice", async () => {
    const deferred: Deferred = makeDeferred();
    const onResetAddress: MockFunction = getJestMockFunction().mockReturnValue(
      deferred.promise,
    );

    renderPanel({ onResetAddress: onResetAddress });

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

    expect(onResetAddress).toHaveBeenCalledTimes(1);
  });

  test("the new address replaces the old one, still masked, and Copy address copies the new one", async () => {
    const copied: Array<string> = captureClipboard();
    const onResetAddress: MockFunction =
      getJestMockFunction().mockResolvedValue(undefined);
    const { view, props } = renderPanel({ onResetAddress: onResetAddress });

    fireEvent.click(resetButton());

    await act(async () => {
      fireEvent.click(
        within(confirmDialog()).getByRole("button", { name: "Reset address" }),
      );
    });

    // The builder saves the key and hands the new address back down.
    view.rerender(
      <IncomingEmailTriggerPanel {...props} address={NEW_ADDRESS} />,
    );

    expect(addressBox()).toHaveAttribute("data-address-shown", "false");
    expect(view.container.innerHTML).not.toContain(NEW_SECRET);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy the email address" }),
      );
    });

    expect(copied).toEqual([NEW_ADDRESS]);

    fireEvent.click(visibilityToggle());

    expect(addressBox().textContent).toBe(NEW_ADDRESS);
    expect(view.container.innerHTML).not.toContain(SECRET);
  });

  test("a failed reset keeps the confirmation open with the reason, and can be retried", async () => {
    const onResetAddress: MockFunction = getJestMockFunction()
      .mockRejectedValueOnce(
        new Error("You do not have permission to update this Workflow."),
      )
      .mockResolvedValueOnce(undefined);

    renderPanel({ onResetAddress: onResetAddress });

    fireEvent.click(resetButton());

    await act(async () => {
      fireEvent.click(
        within(confirmDialog()).getByRole("button", { name: "Reset address" }),
      );
    });

    expect(confirmDialog()).toHaveTextContent(
      "You do not have permission to update this Workflow.",
    );
    expect(
      screen.queryByTestId("incoming-email-trigger-address-reset-done"),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(confirmDialog()).getByRole("button", { name: "Reset address" }),
      );
    });

    expect(onResetAddress).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      screen.getByTestId("incoming-email-trigger-address-reset-done"),
    ).toBeInTheDocument();
  });

  test("someone who may not reset it sees the button disabled, with the permission they need", () => {
    const onResetAddress: MockFunction = getJestMockFunction();

    renderPanel({
      onResetAddress: onResetAddress,
      resetDisabledReason: NO_PERMISSION,
    });

    const button: HTMLElement = screen.getByTestId(
      "incoming-email-trigger-reset-address",
    );

    expect(button).toBeDisabled();
    expect(button).toHaveClass("opacity-50");

    fireEvent.click(button);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.mouseEnter(
      screen.getByTestId(
        "incoming-email-trigger-reset-address-disabled-wrapper",
      ),
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent(NO_PERMISSION);
    expect(onResetAddress).not.toHaveBeenCalled();
  });
});

describe("a workflow whose address does not exist yet", () => {
  /*
   * The step was only just added: its address is created when the graph is
   * saved, and the dialog can open before that. There is nothing to break,
   * and the address is what the step is for, so the panel creates it.
   */
  test("creates the address as soon as it opens, without asking", async () => {
    const deferred: Deferred = makeDeferred();
    const onResetAddress: MockFunction = getJestMockFunction().mockReturnValue(
      deferred.promise,
    );

    renderPanel({ address: null, onResetAddress: onResetAddress });

    expect(onResetAddress).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const creating: HTMLElement = screen.getByTestId(
      "incoming-email-trigger-address-creating",
    );

    expect(creating).toHaveAttribute("role", "status");
    expect(creating).toHaveTextContent(
      "Creating this workflow's email address...",
    );
    expect(
      screen.queryByRole("button", { name: "Create address" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });
  });

  test("the address it creates is shown once the builder hands it down", async () => {
    const onResetAddress: MockFunction =
      getJestMockFunction().mockResolvedValue(undefined);

    const { view, props } = renderPanel({
      address: null,
      onResetAddress: onResetAddress,
    });

    await act(async () => {
      await Promise.resolve();
    });

    view.rerender(<IncomingEmailTriggerPanel {...props} address={ADDRESS} />);

    expect(addressBox()).toBeInTheDocument();
    // Creating is not resetting: nothing old stopped working.
    expect(
      screen.queryByTestId("incoming-email-trigger-address-reset-done"),
    ).not.toBeInTheDocument();
  });

  test("it is created once, however often the panel draws", async () => {
    const onResetAddress: MockFunction =
      getJestMockFunction().mockResolvedValue(undefined);

    const { view, props } = renderPanel({
      address: null,
      onResetAddress: onResetAddress,
    });

    await act(async () => {
      await Promise.resolve();
    });

    view.rerender(<IncomingEmailTriggerPanel {...props} />);
    view.rerender(<IncomingEmailTriggerPanel {...props} />);

    expect(onResetAddress).toHaveBeenCalledTimes(1);
  });

  test("a failed create says why, and Create address tries again", async () => {
    const onResetAddress: MockFunction = getJestMockFunction()
      .mockRejectedValueOnce(new Error("Workflow not found"))
      .mockResolvedValueOnce(undefined);

    renderPanel({ address: null, onResetAddress: onResetAddress });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Workflow not found");
    });
    expect(
      screen.getByTestId("incoming-email-trigger-address-missing"),
    ).toHaveTextContent("This workflow does not have an email address yet.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create address" }));
    });

    expect(onResetAddress).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("without a way to create one, it only says there is none", () => {
    renderPanel({ address: null });

    expect(
      screen.getByTestId("incoming-email-trigger-address-missing"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create address" }),
    ).not.toBeInTheDocument();
  });

  test("someone who may not create one sees Create address disabled, and nothing is created", () => {
    const onResetAddress: MockFunction = getJestMockFunction();

    renderPanel({
      address: null,
      onResetAddress: onResetAddress,
      resetDisabledReason: NO_PERMISSION,
    });

    const button: HTMLElement = screen.getByTestId(
      "incoming-email-trigger-create-address",
    );

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onResetAddress).not.toHaveBeenCalled();
  });

  test("there is nothing to copy or show yet", () => {
    renderPanel({ address: null });

    expect(
      screen.queryByTestId("incoming-email-trigger-address"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("incoming-email-trigger-address-visibility"),
    ).not.toBeInTheDocument();
  });
});

describe("someone who may not see the key", () => {
  test("is told why the address is hidden and who to ask, and given nothing else", () => {
    const onResetAddress: MockFunction = getJestMockFunction();

    renderPanel({
      canSeeAddress: false,
      address: null,
      onResetAddress: onResetAddress,
    });

    expect(
      screen.getByTestId("incoming-email-trigger-address-hidden"),
    ).toHaveTextContent(
      "The email address contains this workflow's secret key, so only people who can edit this workflow can see it. Ask one of them for it.",
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // An empty key here means hidden, not missing: nothing is created.
    expect(onResetAddress).not.toHaveBeenCalled();
  });

  test("never renders an address it is handed anyway", () => {
    const { view } = renderPanel({ canSeeAddress: false });

    expect(view.container.innerHTML).not.toContain(SECRET);
  });

  test("the section keeps its name, so the dialog still opens on it", () => {
    renderPanel({ canSeeAddress: false, address: null });

    expect(
      screen.getByTestId("workflow-component-section-email-address"),
    ).toHaveTextContent("Email address");
  });
});

describe("a server that receives no email", () => {
  test("says the server is not set up for it, and links to how to set it up", () => {
    renderPanel({ inboundDomain: null, address: null });

    expect(
      screen.getByTestId("incoming-email-trigger-not-configured"),
    ).toHaveTextContent(
      "This OneUptime server is not set up to receive email, so this workflow has no address yet. Ask your OneUptime administrator to set up inbound email.",
    );

    const guide: HTMLElement = screen.getByRole("link", {
      name: "How to set up inbound email",
    });

    expect(guide).toHaveAttribute("href", GUIDE);
    expect(guide).toHaveAttribute("target", "_blank");
    expect(guide).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("comes before everything else, whoever is looking", () => {
    renderPanel({ inboundDomain: "", canSeeAddress: false, address: null });

    expect(
      screen.getByTestId("incoming-email-trigger-not-configured"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("incoming-email-trigger-address-hidden"),
    ).not.toBeInTheDocument();
  });

  test("creates nothing: there is nowhere to send mail yet", () => {
    const onResetAddress: MockFunction = getJestMockFunction();

    renderPanel({
      inboundDomain: "   ",
      address: null,
      onResetAddress: onResetAddress,
    });

    expect(onResetAddress).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("reads like the Webhook trigger", () => {
  test("shares the Webhook trigger's words where they mean the same thing", () => {
    expect(IncomingEmailTriggerPanelCopy.copied).toBe(
      WebhookTriggerPanelCopy.copied,
    );
    expect(IncomingEmailTriggerPanelCopy.show).toBe(
      WebhookTriggerPanelCopy.show,
    );
    expect(IncomingEmailTriggerPanelCopy.hide).toBe(
      WebhookTriggerPanelCopy.hide,
    );
    expect(IncomingEmailTriggerPanelCopy.hideTitle).toBe(
      WebhookTriggerPanelCopy.hideTitle,
    );
    expect(IncomingEmailTriggerPanelCopy.maskedForScreenReaders).toBe(
      WebhookTriggerPanelCopy.maskedForScreenReaders,
    );
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

  test("every sentence is translated whole", () => {
    render(
      <IncomingEmailTriggerPanel
        inboundDomain={DOMAIN}
        address={ADDRESS}
        canSeeAddress={true}
        onResetAddress={getJestMockFunction()}
        setupGuideUrl={GUIDE}
      />,
      { wrapper: GermanWrapper },
    );

    const section: HTMLElement = screen.getByTestId(
      "workflow-component-section-email-address",
    );

    expect(section).toHaveTextContent("E-Mail-Adresse");
    expect(section).toHaveTextContent(
      "Senden Sie eine E-Mail an diese Adresse, um den Arbeitsablauf zu starten.",
    );
    expect(
      screen.getByRole("button", { name: "E-Mail-Adresse kopieren" }),
    ).toHaveTextContent("Adresse kopieren");
    expect(visibilityToggle()).toHaveTextContent("Anzeigen");
    expect(
      screen.getByTestId("incoming-email-trigger-address-private"),
    ).toHaveTextContent(
      "Falls die Adresse nach außen gelangt, setzen Sie sie zurück.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Adresse zurücksetzen" }),
    );

    expect(confirmDialog()).toHaveTextContent("E-Mail-Adresse zurücksetzen?");
  });

  test("the hidden and not-set-up states are translated too", () => {
    render(
      <>
        <IncomingEmailTriggerPanel
          inboundDomain={DOMAIN}
          address={null}
          canSeeAddress={false}
          setupGuideUrl={GUIDE}
        />
        <IncomingEmailTriggerPanel
          inboundDomain={null}
          address={null}
          canSeeAddress={true}
          setupGuideUrl={GUIDE}
        />
      </>,
      { wrapper: GermanWrapper },
    );

    expect(
      screen.getByTestId("incoming-email-trigger-address-hidden"),
    ).toHaveTextContent(
      "Die E-Mail-Adresse enthält den geheimen Schlüssel dieses Arbeitsablaufs.",
    );
    expect(
      screen.getByTestId("incoming-email-trigger-not-configured"),
    ).toHaveTextContent(
      "Dieser OneUptime-Server ist nicht für den Empfang von E-Mails eingerichtet",
    );
    expect(
      screen.getByRole("link", {
        name: "So richten Sie eingehende E-Mails ein",
      }),
    ).toHaveAttribute("href", GUIDE);
  });
});
