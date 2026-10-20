import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import {
  CODE_TASK_LIMITS,
  CodeTaskContextInput,
  CodeTaskContextInputUtil,
  CodeTaskContextType,
} from "../../../Types/AI/CodeTask";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The box where a person asks OneUptime AI for something, or replies in a
 * task (Components/Code/CodeComposer), and the small dialog that adds one
 * piece of context to it (CodeContextModal), rendered for real.
 *
 * What a person relies on: Enter sends and Shift + Enter does not; nothing
 * empty, nothing while sending and nothing while AI cannot work is sent; a
 * refused send keeps every word and chip and says why; context is added
 * through a dialog that asks only what its kind needs and refuses what the
 * server would (a path out of the repository, an address that is not one,
 * a trace ID that is not one) before it is ever sent; the same thing is not
 * added twice; and there is a limit to how much can be added.
 */

/*
 * The record pickers read the project's incidents, alerts and the like
 * through the API; here they are a plain select of two records, so the
 * dialog's own behaviour is what is tested.
 */
jest.mock("../../../UI/Components/EntityDropdown/EntityDropdown", () => {
  return {
    __esModule: true,
    default: (props: {
      dataTestId?: string;
      ariaLabel?: string;
      value: string | null;
      onChange: (
        value: string | null,
        change: { selectedOptions: Array<{ label: string; value: string }> },
      ) => void;
    }): ReactElement => {
      const options: Array<{ label: string; value: string }> = [
        {
          label: "Checkout fails for some customers",
          value: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
        },
        {
          label: "Search is slow",
          value: "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e",
        },
      ];
      return React.createElement(
        "select",
        {
          "data-testid": props.dataTestId,
          "aria-label": props.ariaLabel,
          value: props.value || "",
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
            const picked: { label: string; value: string } | undefined =
              options.find((option: { value: string }) => {
                return option.value === event.target.value;
              });
            props.onChange(picked ? picked.value : null, {
              selectedOptions: picked ? [picked] : [],
            });
          },
        },
        React.createElement("option", { value: "" }, "Pick one"),
        ...options.map((option: { label: string; value: string }) => {
          return React.createElement(
            "option",
            { key: option.value, value: option.value },
            option.label,
          );
        }),
      );
    },
  };
});

import CodeComposer from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeComposer";
import {
  getNoteChipLabel,
  NOTE_CHIP_LENGTH,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeContextModal";
import { CODE_CONTEXT_REFUSALS } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskCopy";

const INCIDENT_ID: string = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const translation: i18n = createInstance();
const germanTranslation: i18n = createInstance();

let onSend: MockFunction;

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
  await germanTranslation.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  onSend = getJestMockFunction();
  onSend.mockResolvedValue(undefined as never);
});

afterEach(() => {
  cleanup();
});

function renderComposer(
  props: Partial<React.ComponentProps<typeof CodeComposer>> = {},
  language: i18n = translation,
): void {
  render(
    <I18nextProvider i18n={language}>
      <CodeComposer
        label="What should AI do?"
        placeholder="Describe the change"
        sendLabel="Start task"
        onSend={
          onSend as unknown as (data: {
            message: string;
            context: Array<CodeTaskContextInput>;
          }) => Promise<void>
        }
        {...props}
      />
    </I18nextProvider>,
  );
}

function input(): HTMLTextAreaElement {
  return screen.getByTestId("code-composer-input") as HTMLTextAreaElement;
}

function sendButton(): HTMLButtonElement {
  return screen.getByTestId("code-composer-send") as HTMLButtonElement;
}

function chips(): Array<HTMLElement> {
  return screen.queryAllByTestId("code-composer-context-chip");
}

async function openContextDialog(
  kind: CodeTaskContextType,
): Promise<HTMLElement> {
  await userEvent.click(screen.getByTestId("code-add-context"));
  await userEvent.click(await screen.findByTestId(`code-add-context-${kind}`));
  return await screen.findByTestId("code-context-modal");
}

async function submitDialog(): Promise<void> {
  await userEvent.click(screen.getByTestId("modal-footer-submit-button"));
}

describe("sending", () => {
  test("nothing to send until something is typed; Enter sends the words, trimmed", async () => {
    renderComposer();

    expect(input()).toHaveAccessibleName("What should AI do?");
    expect(sendButton()).toBeDisabled();
    expect(sendButton()).toHaveTextContent("Start task");

    await userEvent.type(input(), "  Add retries to the payment client  ");
    expect(sendButton()).toBeEnabled();

    await userEvent.type(input(), "{Enter}");

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith({
      message: "Add retries to the payment client",
      context: [],
    });
    // Sent: the box is ready for the next one.
    expect(input()).toHaveValue("");
  });

  test("Shift + Enter starts a new line and sends nothing", async () => {
    renderComposer();

    await userEvent.type(input(), "First{Shift>}{Enter}{/Shift}Second");

    expect(input()).toHaveValue("First\nSecond");
    expect(onSend).not.toHaveBeenCalled();

    await userEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith({
      message: "First\nSecond",
      context: [],
    });
  });

  test("Enter while an input method is composing a character does not send", () => {
    renderComposer();

    fireEvent.change(input(), { target: { value: "日本" } });
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  test("only spaces is nothing to send", async () => {
    renderComposer();

    await userEvent.type(input(), "    {Enter}");

    expect(onSend).not.toHaveBeenCalled();
    expect(sendButton()).toBeDisabled();
  });

  test("while AI cannot work, the words stay readable and nothing is sent", async () => {
    renderComposer({ isDisabled: true });

    expect(input()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    // The menu's trigger is an ARIA button.
    expect(screen.getByTestId("code-add-context")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  test("a refused send keeps every word and chip, and says why", async () => {
    onSend.mockRejectedValue(
      new HTTPErrorResponse(
        400,
        { message: "This project used its daily AI token limit." },
        {},
      ) as never,
    );
    renderComposer();

    await openContextDialog(CodeTaskContextType.File);
    await userEvent.type(screen.getByTestId("code-context-path"), "src/app.ts");
    await submitDialog();
    await userEvent.type(input(), "Make it faster{Enter}");

    const error: HTMLElement = await screen.findByTestId("code-composer-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(
      "This project used its daily AI token limit.",
    );
    expect(input()).toHaveValue("Make it faster");
    expect(chips()).toHaveLength(1);

    // Sending again clears the old reason.
    onSend.mockResolvedValue(undefined as never);
    await userEvent.click(sendButton());
    expect(screen.queryByTestId("code-composer-error")).toBeNull();
  });

  test("a second Enter while the first send is on its way sends nothing more", async () => {
    let finish: () => void = (): void => {};
    onSend.mockImplementation((() => {
      return new Promise<void>((resolve: () => void) => {
        finish = resolve;
      });
    }) as never);
    renderComposer();

    await userEvent.type(input(), "Once{Enter}");
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.click(sendButton());

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(sendButton()).toBeDisabled();

    await act(async () => {
      finish();
    });
  });

  test("an example the page hands over fills the box and takes the focus", async () => {
    const { rerender } = render(
      <I18nextProvider i18n={translation}>
        <CodeComposer
          label="What should AI do?"
          placeholder="Describe the change"
          sendLabel="Start task"
          onSend={onSend as never}
        />
      </I18nextProvider>,
    );

    rerender(
      <I18nextProvider i18n={translation}>
        <CodeComposer
          label="What should AI do?"
          placeholder="Describe the change"
          sendLabel="Start task"
          onSend={onSend as never}
          prefill={{ text: "Add tests for the code that has none", token: 1 }}
        />
      </I18nextProvider>,
    );

    expect(input()).toHaveValue("Add tests for the code that has none");
    expect(input()).toHaveFocus();
  });

  test("the box says how to send: Enter, and Shift + Enter for a new line", () => {
    renderComposer();
    expect(document.body).toHaveTextContent(
      "Enter to send · Shift + Enter for a new line",
    );
  });

  test("a box that cannot send says nothing about how to send", () => {
    renderComposer({ isDisabled: true });
    expect(screen.queryByTestId("code-composer-keys")).toBeNull();
    expect(document.body).not.toHaveTextContent("Enter to send");
  });
});

describe("what a chip shows", () => {
  test("a path reads as code, as it does in the conversation", async () => {
    renderComposer();
    await openContextDialog(CodeTaskContextType.File);
    await userEvent.type(
      screen.getByTestId("code-context-path"),
      "src/payments/client.ts",
    );
    await submitDialog();

    expect(chips()[0]!.querySelector(".font-mono")).toHaveTextContent(
      "src/payments/client.ts",
    );
  });

  test("a long note shows its first words, ending at a word with …; the whole note is on hover", async () => {
    const note: string =
      "It fails about one run in ten on CI, never locally. The error is a timeout after 5000 ms in the payment mock.";
    renderComposer();
    await openContextDialog(CodeTaskContextType.Note);
    fireEvent.change(screen.getByTestId("code-context-note"), {
      target: { value: note },
    });
    await submitDialog();

    const label: HTMLElement = chips()[0]!.querySelector(
      "span[title]",
    ) as HTMLElement;
    expect(label.textContent).toBe(
      "It fails about one run in ten on CI, never locally. The…",
    );
    expect(label).toHaveAttribute("title", note);
  });

  test("a link shows its name, and its address on hover", async () => {
    renderComposer();
    await openContextDialog(CodeTaskContextType.Link);
    await userEvent.type(
      screen.getByTestId("code-context-url"),
      "https://github.com/acme/api/actions/runs/1",
    );
    await userEvent.type(
      screen.getByTestId("code-context-link-title"),
      "The failing run",
    );
    await submitDialog();

    const label: HTMLElement = chips()[0]!.querySelector(
      "span[title]",
    ) as HTMLElement;
    expect(label.textContent).toBe("The failing run");
    expect(label).toHaveAttribute(
      "title",
      "https://github.com/acme/api/actions/runs/1",
    );
  });

  test.each([
    ["Fix it", "Fix it"],
    ["  spaces\n\nand   lines  ", "spaces and lines"],
    ["word ".repeat(30).trim(), `${"word ".repeat(12).trim()}…`],
    ["x".repeat(NOTE_CHIP_LENGTH + 10), `${"x".repeat(NOTE_CHIP_LENGTH)}…`],
  ])("a note chip of %j reads %j", (text: string, label: string) => {
    expect(getNoteChipLabel(text)).toBe(label);
    expect(getNoteChipLabel(text).length).toBeLessThanOrEqual(
      NOTE_CHIP_LENGTH + 1,
    );
  });
});

describe("the dialog speaks the reader's language", () => {
  /*
   * The rules the dialog checks with are the server's, in English; the
   * refusals a person can reach are keys the locales translate. Each must be
   * the rules' own words, or the reader sees English after all.
   */
  test("each refusal it keeps is the rules' own sentence, and the rules refuse nothing else a person can type", () => {
    const refusals: Array<string> = [];
    const reachable: Array<Record<string, unknown>> = [
      { type: CodeTaskContextType.File, path: "../secrets.env" },
      { type: CodeTaskContextType.File, path: "src/a\u0007b.ts" },
      { type: CodeTaskContextType.Link, url: "not a link" },
      { type: CodeTaskContextType.Link, url: "ftp://example.com/file" },
      { type: CodeTaskContextType.Trace, traceId: "nope" },
    ];

    for (const raw of reachable) {
      try {
        CodeTaskContextInputUtil.readItem(raw);
        refusals.push("(accepted)");
      } catch (error) {
        refusals.push((error as Error).message);
      }
    }

    for (const refusal of refusals) {
      expect(CODE_CONTEXT_REFUSALS).toContain(refusal);
    }
    // Every key is one of them: none is kept for a refusal that no longer exists.
    for (const key of CODE_CONTEXT_REFUSALS) {
      expect(refusals).toContain(key);
    }
  });

  test("in German, a path out of the repository is refused in German", async () => {
    renderComposer({}, germanTranslation);
    await userEvent.click(screen.getByTestId("code-add-context"));
    await userEvent.click(
      await screen.findByTestId(`code-add-context-${CodeTaskContextType.File}`),
    );
    await userEvent.type(
      screen.getByTestId("code-context-path"),
      "../secrets.env",
    );
    await submitDialog();

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Ein Pfad muss innerhalb des Repositorys bleiben (kein '..').",
    );
  });

  test("an optional field says so the way every form does", async () => {
    renderComposer();
    await openContextDialog(CodeTaskContextType.Link);
    const dialog: HTMLElement = screen.getByRole("dialog");

    const address: HTMLElement = within(dialog).getByText("Web address");
    expect(address.closest("label")).toHaveAttribute("for", "code-context-url");
    expect(address.closest("label")).not.toHaveTextContent("(Optional)");

    const name: HTMLElement = within(dialog).getByText("Name");
    expect(name.closest("label")).toHaveAttribute(
      "for",
      "code-context-link-title",
    );
    expect(name.closest("label")).toHaveTextContent("Name (Optional)");
    expect(dialog).not.toHaveTextContent("(optional)");
  });
});

describe("adding context", () => {
  test("the menu offers the person's own first, then what OneUptime reads", async () => {
    renderComposer();

    await userEvent.click(screen.getByTestId("code-add-context"));
    const items: Array<string> = (await screen.findAllByRole("menuitem")).map(
      (item: HTMLElement): string => {
        return item.textContent || "";
      },
    );

    expect(items).toEqual([
      "File or folder",
      "Note",
      "Link",
      "Incident",
      "Alert",
      "Exception",
      "Monitor",
      "Trace",
      "Logs",
      "Performance profile",
    ]);
  });

  /*
   * A function of a service's profile: the function and the service are
   * needed; the kind of profile (CPU time unless picked) and the window
   * (the last hour unless picked) go with it, and the chip names the
   * function.
   */
  test("a profile needs a function and a service, and carries its kind and window", async () => {
    renderComposer();
    const dialog: HTMLElement = await openContextDialog(
      CodeTaskContextType.Profile,
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "AI reads where the function's time goes in the service's profiles: who calls it, what it calls and its hottest lines.",
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();

    await userEvent.type(
      within(dialog).getByTestId("code-context-profile-function"),
      "parseOrder",
    );
    // A function with no service: still nothing to add.
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();

    fireEvent.change(
      within(dialog).getByTestId("code-context-profile-service"),
      { target: { value: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d" } },
    );
    expect(
      within(dialog).getByTestId("code-context-profile-kind-cpu"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(dialog).getByTestId("code-context-profile-window-1"),
    ).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(
      within(dialog).getByTestId("code-context-profile-kind-memory"),
    );
    await userEvent.click(
      within(dialog).getByTestId("code-context-profile-window-24"),
    );
    await submitDialog();

    expect(chips()[0]).toHaveTextContent("Profile of parseOrder");

    await userEvent.type(input(), "Make it lighter{Enter}");
    expect(onSend).toHaveBeenCalledWith({
      message: "Make it lighter",
      context: [
        {
          type: "Profile",
          serviceId: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
          functionName: "parseOrder",
          profileType: "memory",
          hours: 24,
        },
      ],
    });
  });

  test("a file: a path that leaves the repository is refused in the dialog; a good one is added as git writes it", async () => {
    renderComposer();
    const dialog: HTMLElement = await openContextDialog(
      CodeTaskContextType.File,
    );

    // Nothing typed: nothing to add.
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();

    await userEvent.type(
      within(dialog).getByTestId("code-context-path"),
      "../secrets.env",
    );
    await submitDialog();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "A path must stay inside the repository",
    );
    expect(chips()).toHaveLength(0);

    const path: HTMLElement = within(dialog).getByTestId("code-context-path");
    await userEvent.clear(path);
    await userEvent.type(path, "./src/payments/");
    await submitDialog();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chips()).toHaveLength(1);
    expect(chips()[0]).toHaveTextContent("src/payments");

    await userEvent.type(input(), "Explain this folder{Enter}");
    expect(onSend).toHaveBeenCalledWith({
      message: "Explain this folder",
      context: [{ type: "File", path: "src/payments" }],
    });
  });

  test("a note, a link with its name, and a link that is not a web address", async () => {
    renderComposer();

    await openContextDialog(CodeTaskContextType.Note);
    await userEvent.type(
      screen.getByTestId("code-context-note"),
      "The gateway's p95 is 1.2 seconds.",
    );
    await submitDialog();

    await openContextDialog(CodeTaskContextType.Link);
    await userEvent.type(screen.getByTestId("code-context-url"), "not a link");
    await submitDialog();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "A link must be a full web address",
    );
    await userEvent.clear(screen.getByTestId("code-context-url"));
    await userEvent.type(
      screen.getByTestId("code-context-url"),
      "https://expressjs.com/en/guide/migrating-5.html",
    );
    await userEvent.type(
      screen.getByTestId("code-context-link-title"),
      "Moving to Express 5",
    );
    await submitDialog();

    expect(
      chips().map((chip: HTMLElement) => {
        return chip.textContent;
      }),
    ).toEqual(["The gateway's p95 is 1.2 seconds.", "Moving to Express 5"]);

    await userEvent.type(input(), "Upgrade express{Enter}");
    expect(onSend).toHaveBeenCalledWith({
      message: "Upgrade express",
      context: [
        { type: "Note", text: "The gateway's p95 is 1.2 seconds." },
        {
          type: "Link",
          url: "https://expressjs.com/en/guide/migrating-5.html",
          title: "Moving to Express 5",
        },
      ],
    });
  });

  test("a OneUptime record is picked by name and sent by its id", async () => {
    renderComposer();
    const dialog: HTMLElement = await openContextDialog(
      CodeTaskContextType.Incident,
    );

    // The dialog says what AI reads of the record.
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "AI reads the incident as it is now: its state, description and root cause.",
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();

    fireEvent.change(within(dialog).getByTestId("code-context-record"), {
      target: { value: INCIDENT_ID },
    });
    await submitDialog();

    expect(chips()[0]).toHaveTextContent("Checkout fails for some customers");
    await userEvent.type(input(), "Find the cause{Enter}");
    expect(onSend).toHaveBeenCalledWith({
      message: "Find the cause",
      context: [{ type: "Incident", id: INCIDENT_ID }],
    });
  });

  test("a trace ID is checked as one, and logs carry their search, window and service", async () => {
    renderComposer();

    await openContextDialog(CodeTaskContextType.Trace);
    await userEvent.type(screen.getByTestId("code-context-trace"), "nope");
    await submitDialog();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "A trace ID is 32 (or 16) hexadecimal characters",
    );
    await userEvent.clear(screen.getByTestId("code-context-trace"));
    await userEvent.type(
      screen.getByTestId("code-context-trace"),
      "4BF92F3577B34DA6A3CE929D0E0E4736",
    );
    await submitDialog();

    await openContextDialog(CodeTaskContextType.Logs);
    expect(screen.getByTestId("code-context-logs-window-24")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.type(screen.getByTestId("code-context-logs"), "timeout");
    await userEvent.click(screen.getByTestId("code-context-logs-window-1"));
    await submitDialog();

    expect(
      chips().map((chip: HTMLElement) => {
        return chip.textContent;
      }),
    ).toEqual(["Trace 4bf92f35…", 'Logs matching "timeout"']);

    await userEvent.type(input(), "Why so slow?{Enter}");
    expect(onSend).toHaveBeenCalledWith({
      message: "Why so slow?",
      context: [
        { type: "Trace", traceId: "4bf92f3577b34da6a3ce929d0e0e4736" },
        { type: "Logs", search: "timeout", hours: 1 },
      ],
    });
  });

  test("the same thing is added once, and a chip can be taken out", async () => {
    renderComposer();

    for (let time: number = 0; time < 2; time++) {
      await openContextDialog(CodeTaskContextType.File);
      await userEvent.type(
        screen.getByTestId("code-context-path"),
        "src/app.ts",
      );
      await submitDialog();
    }
    expect(chips()).toHaveLength(1);

    await userEvent.click(
      within(chips()[0]!).getByRole("button", { name: "Remove src/app.ts" }),
    );
    expect(chips()).toHaveLength(0);
  });

  test("Cancel adds nothing", async () => {
    renderComposer();

    await openContextDialog(CodeTaskContextType.Note);
    await userEvent.type(screen.getByTestId("code-context-note"), "Draft");
    await userEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chips()).toHaveLength(0);
  });

  test(`at ${CODE_TASK_LIMITS.maxContextItems} pieces of context, the menu closes for more`, async () => {
    renderComposer();

    for (
      let index: number = 0;
      index < CODE_TASK_LIMITS.maxContextItems;
      index++
    ) {
      await openContextDialog(CodeTaskContextType.File);
      await userEvent.type(
        screen.getByTestId("code-context-path"),
        `src/file-${index}.ts`,
      );
      await submitDialog();
    }

    expect(chips()).toHaveLength(CODE_TASK_LIMITS.maxContextItems);
    expect(screen.getByTestId("code-add-context")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
