import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { findNestedControls } from "../../Helpers/NestedControls";

/*
 * 'Preview' - the small link that opens the email status page subscribers
 * will get, on the line of the value that sends it: beside the Yes of Notify
 * Status Page Subscribers on Declare Incident's last step, and beside the
 * public note composer's notify box
 * (Components/Incident/SubscriberNotificationPreviewButton).
 *
 * "This preview notification button is quite big. Can we please improve the
 * UI?" It was a bordered, shadowed button with a 20px envelope on a line of
 * its own. These pin what replaced it: one word and an eye, the size of the
 * text, in the link colour; a name that says what it previews and holds the
 * word it shows; the keyboard reaching it, opening it and getting the focus
 * back; and, with nothing to preview yet, a grey link that still says why.
 *
 * The dialog it opens is the real one (its own suite is
 * SubscriberNotificationPreviewModal.test.tsx); only the raw request is
 * stubbed. i18next is set up from the shipped locale files, so the German
 * tests read what a German reader reads.
 */

/*
 * validateDOMNesting warnings, from the file's first render on: React reports
 * each kind of bad nesting once per module life, so a spy set up in one test
 * would miss what an earlier test set off. The last test reads them.
 */
const nestingWarnings: Array<string> = [];
// eslint-disable-next-line no-console
const consoleError: typeof console.error = console.error;

// eslint-disable-next-line no-console
console.error = (...args: Array<unknown>): void => {
  const message: string = args
    .map((arg: unknown): string => {
      return String(arg);
    })
    .join(" ");

  if (message.includes("validateDOMNesting")) {
    nestingWarnings.push(message);
  }

  consoleError(...(args as Parameters<typeof console.error>));
};

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (): string => {
        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
    },
  };
});

import SubscriberNotificationPreviewButton from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/SubscriberNotificationPreviewButton";
import SubscriberAudienceSummary from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/SubscriberAudienceSummary";
import NoteComposer from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteComposer";
import { getNotesCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil";
import SubscriberNotificationPreviewCopy from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationPreviewCopy";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import IncidentSubscriberAudience from "../../../Types/StatusPage/IncidentSubscriberAudience";
import SubscriberNotificationPreview, {
  SubscriberEmailTemplateChoiceReason,
  SubscriberNotificationPreviewEvent,
  SubscriberNotificationPreviewNothingSentReason,
  SubscriberNotificationPreviewRequest,
  SubscriberNotificationPreviewResult,
} from "../../../Types/StatusPage/SubscriberNotificationPreview";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const TEST_ID: string = "subscriber-notification-preview-button";
const NAME: string = "Preview notification";
const NO_NOTE_REASON: string =
  SubscriberNotificationPreviewCopy.previewButtonDisabledNoNote;

const INCIDENT_ID: string = "a0000000-0000-4000-8000-00000000000a";
const SITE_03: string = "b0000000-0000-4000-8000-000000000003";

const REQUEST: SubscriberNotificationPreviewRequest = {
  event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
  incidentId: INCIDENT_ID,
  note: "Rolling back.",
  postedAt: null,
};

const PREVIEW: SubscriberNotificationPreviewResult = {
  event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
  nothingSentReason: null,
  statusPages: [
    {
      statusPageId: SITE_03,
      name: "Site 03",
      subscriberCounts: {
        ...IncidentSubscriberAudience.getEmptyCounts(),
        email: 41,
      },
      subject: "[Update Incident] Checkout failing",
      html: "<html><body><h1>Site 03 update</h1></body></html>",
      templateChoice: {
        usesCustomTemplate: false,
        reason: SubscriberEmailTemplateChoiceReason.NoCustomTemplate,
      },
    },
  ],
  audience: {
    hasMonitors: true,
    isScoped: false,
    isHiddenFromStatusPages: false,
    statusPages: [],
    hiddenStatusPageCount: 0,
    excludedStatusPages: [],
    selectedStatusPagesNotListingMonitors: [],
  },
};

// The classes the old button drew with: a bordered, shadowed box of its own.
const BIG_BUTTON_CLASSES: Array<string> = [
  "border",
  "border-gray-300",
  "bg-white",
  "shadow-sm",
  "w-full",
  "md:ml-3",
  "md:w-auto",
  "px-2",
  "py-1",
  "text-base",
];

function link(): HTMLElement {
  return screen.getByTestId(TEST_ID);
}

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "")
    .split(/\s+/)
    .filter((token: string): boolean => {
      return token.length > 0;
    });
}

function renderLink(
  props: Partial<
    React.ComponentProps<typeof SubscriberNotificationPreviewButton>
  > = {},
): RenderResult {
  return render(
    <SubscriberNotificationPreviewButton
      getRequest={() => {
        return REQUEST;
      }}
      {...props}
    />,
  );
}

function setUpUser(): UserEvent {
  return userEvent.setup({ delay: null });
}

/*
 * user-event dispatches through its own copy of @testing-library/dom, which
 * React Testing Library's act wrapper is not configured on: wrap its keys.
 */
async function tab(user: UserEvent): Promise<void> {
  await act(async (): Promise<void> => {
    await user.tab();
  });
}

async function press(user: UserEvent, keys: string): Promise<void> {
  await act(async (): Promise<void> => {
    await user.keyboard(keys);
  });
}

/*
 * The dialog, once its email has loaded. Waiting for the email first keeps
 * the answer landing inside the wait (and so inside act).
 */
async function openedDialog(): Promise<HTMLElement> {
  const body: HTMLElement = await screen.findByTestId(
    "subscriber-notification-preview-body",
  );
  const dialog: HTMLElement = screen.getByRole("dialog", {
    name: "Preview notification",
  });

  expect(dialog).toContainElement(body);
  return dialog;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
      ja: { translation: readLocale("ja") },
    },
    interpolation: { escapeValue: false },
  });
});

function answerPreviewWith(preview: SubscriberNotificationPreviewResult): void {
  postMock.mockImplementation((async (request: { url: unknown }) => {
    if (String(request.url).endsWith("/incident/subscriber-audience")) {
      return new HTTPResponse<JSONObject>(
        200,
        IncidentSubscriberAudience.toJSON({
          ...PREVIEW.audience,
          statusPages: [
            {
              statusPageId: SITE_03,
              name: "Site 03",
              subscriberCounts: {
                ...IncidentSubscriberAudience.getEmptyCounts(),
                email: 41,
              },
            },
          ],
        }),
        {},
      );
    }

    return new HTTPResponse<JSONObject>(
      200,
      SubscriberNotificationPreview.toJSON(preview),
      {},
    );
  }) as never);
}

beforeEach(() => {
  postMock.mockReset();
  answerPreviewWith(PREVIEW);
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
  // eslint-disable-next-line no-console
  console.error = consoleError;
});

describe("a small link, not a big button", () => {
  test("one word and an eye, the size of the text around it, in the link colour", () => {
    renderLink();

    const element: HTMLElement = link();

    expect(element.tagName).toBe("BUTTON");
    expect(element).toHaveTextContent(/^Preview$/);

    const classes: Array<string> = classesOf(element);

    expect(classes).toEqual(
      expect.arrayContaining([
        "inline-flex",
        "items-center",
        "text-sm",
        "font-medium",
        "text-indigo-600",
        "hover:text-indigo-700",
        "hover:underline",
      ]),
    );

    for (const big of BIG_BUTTON_CLASSES) {
      expect({ class: big, drawn: classes.includes(big) }).toEqual({
        class: big,
        drawn: false,
      });
    }

    // The eye, at the size of a 14px line: 16px, not the old 20px envelope.
    const icon: Element | null = element.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(classesOf(icon!)).toEqual(expect.arrayContaining(["h-4", "w-4"]));
    expect(classesOf(icon!)).not.toContain("w-5");
    expect(icon!.querySelector("path")!.getAttribute("d")).toMatch(
      /^M2\.036 12\.322/,
    );
    // Decorative: the word names the link.
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
  });

  test("it is the whole of what it draws: no box or line of its own around it", () => {
    const { container }: RenderResult = renderLink();

    // Drawn inline wherever it is put, so it can sit on the value's line.
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(link());
  });

  test("a 24px hit area that takes the 20px of a line of text", () => {
    renderLink();

    const classes: Array<string> = classesOf(link());

    // 2px of padding above and below a 20px line, taken back out of the layout.
    expect(classes).toEqual(
      expect.arrayContaining(["py-0.5", "-my-0.5", "px-1", "-mx-1"]),
    );
    // One word that never breaks: the whole link moves to the next line.
    expect(classes).toEqual(
      expect.arrayContaining(["whitespace-nowrap", "shrink-0"]),
    );
  });

  test("never submits the form it sits in", async () => {
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <form
        onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <SubscriberNotificationPreviewButton
          getRequest={() => {
            return REQUEST;
          }}
        />
      </form>,
    );

    expect(link()).toHaveAttribute("type", "button");

    fireEvent.click(link());
    await openedDialog();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("nothing is a control inside another control", () => {
    renderLink({ isDisabled: true, disabledReason: NO_NOTE_REASON });
    expect(findNestedControls(document.body)).toEqual([]);

    cleanup();

    renderLink();
    expect(findNestedControls(document.body)).toEqual([]);
  });
});

describe("what a screen reader hears", () => {
  test("its name says what it previews, and holds the word on screen", () => {
    renderLink();

    const element: HTMLElement = screen.getByRole("button", { name: NAME });

    expect(element).toBe(link());
    expect(element).toHaveAccessibleName(NAME);
    expect(NAME.startsWith(element.textContent || "-")).toBe(true);
    expect(element.getAttribute("aria-label")).toBe(
      SubscriberNotificationPreviewCopy.previewButtonAccessibleName,
    );
  });

  test("it says it opens a dialog", () => {
    renderLink();

    expect(link()).toHaveAttribute("aria-haspopup", "dialog");
  });

  test("with something to preview, it is plainly available: not disabled, nothing to describe", () => {
    renderLink();

    expect(link()).not.toHaveAttribute("aria-disabled");
    expect(link()).not.toHaveAttribute("disabled");
    expect(link()).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByTestId(`${TEST_ID}-reason`)).toBeNull();
  });
});

describe("opening the preview", () => {
  test("a click opens the dialog, with the draft as it is when pressed", async () => {
    let note: string = "First draft";
    const getRequest: jest.Mock<() => SubscriberNotificationPreviewRequest> =
      jest.fn((): SubscriberNotificationPreviewRequest => {
        return { ...REQUEST, note: note };
      });

    renderLink({ getRequest: getRequest });

    // Read when pressed, not when drawn.
    expect(getRequest).not.toHaveBeenCalled();

    note = "Second draft";
    fireEvent.click(link());

    await openedDialog();

    expect(getRequest).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledTimes(1);
    const posted: { url: unknown; data: JSONObject } = postMock.mock
      .calls[0]![0] as { url: unknown; data: JSONObject };
    expect(String(posted.url)).toMatch(
      /\/notification\/subscriber-notification-preview\/preview$/,
    );
    expect(posted.data["note"]).toBe("Second draft");
  });

  test("Tab reaches it, and Enter opens it", async () => {
    const user: UserEvent = setUpUser();
    renderLink();

    await tab(user);
    expect(link()).toHaveFocus();

    await press(user, "{Enter}");

    expect(await openedDialog()).toBeInTheDocument();
  });

  test("Space opens it too", async () => {
    const user: UserEvent = setUpUser();
    renderLink();

    await tab(user);
    await press(user, " ");

    expect(await openedDialog()).toBeInTheDocument();
  });

  test("closing the dialog gives the focus back to the link", async () => {
    const user: UserEvent = setUpUser();
    renderLink();

    await tab(user);
    await press(user, "{Enter}");

    const dialog: HTMLElement = await openedDialog();

    fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(link()).toHaveFocus();
  });

  test("Escape closes the dialog and leaves the link where it was", async () => {
    const user: UserEvent = setUpUser();
    renderLink();

    await tab(user);
    await press(user, "{Enter}");
    await openedDialog();

    await press(user, "{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(link()).toBeInTheDocument();
    expect(link()).toHaveFocus();
  });

  test("a draft with nothing to preview opens nothing", () => {
    renderLink({
      getRequest: () => {
        return null;
      },
    });

    fireEvent.click(link());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe("nothing to preview yet", () => {
  function renderWaiting(getRequest?: () => null): void {
    renderLink({
      getRequest:
        getRequest ||
        (() => {
          return null;
        }),
      isDisabled: true,
      disabledReason: NO_NOTE_REASON,
    });
  }

  test("grey, not the link colour, and no underline on hover", () => {
    renderWaiting();

    const classes: Array<string> = classesOf(link());

    expect(classes).toEqual(
      expect.arrayContaining(["text-gray-400", "cursor-not-allowed"]),
    );
    expect(classes).not.toContain("text-indigo-600");
    expect(classes).not.toContain("hover:underline");
    expect(classes).not.toContain("hover:text-indigo-700");
  });

  test("aria-disabled, not disabled: it is still a stop for the keyboard", async () => {
    const user: UserEvent = setUpUser();
    renderWaiting();

    expect(link()).toHaveAttribute("aria-disabled", "true");
    expect(link()).not.toHaveAttribute("disabled");
    expect(link()).toBeEnabled();

    await tab(user);
    expect(link()).toHaveFocus();
  });

  test("pressing it, by mouse or keyboard, does nothing", async () => {
    const getRequest: jest.Mock<() => null> = jest.fn((): null => {
      return null;
    });
    const user: UserEvent = setUpUser();
    renderWaiting(getRequest);

    fireEvent.click(link());
    await tab(user);
    await press(user, "{Enter}");
    await press(user, " ");

    expect(getRequest).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the reason is read with it, as its description - its name stays the same", () => {
    renderWaiting();

    expect(link()).toHaveAccessibleName(NAME);
    expect(link()).toHaveAccessibleDescription(NO_NOTE_REASON);

    const reason: HTMLElement = screen.getByTestId(`${TEST_ID}-reason`);
    expect(link().getAttribute("aria-describedby")).toBe(reason.id);
    expect(reason).toHaveClass("sr-only");
    expect(reason).toHaveTextContent(NO_NOTE_REASON);
    // Beside the link, not inside it.
    expect(link().contains(reason)).toBe(false);
  });

  test("hovering shows the reason", async () => {
    jest.useFakeTimers();
    renderWaiting();

    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(link());
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent(NO_NOTE_REASON);
  });

  test("keyboard focus shows it too", async () => {
    jest.useFakeTimers();
    renderWaiting();

    act(() => {
      link().focus();
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent(NO_NOTE_REASON);
  });

  test("the tooltip does not describe it a second time", async () => {
    jest.useFakeTimers();
    renderWaiting();

    act(() => {
      link().focus();
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    // Only the sr-only reason: Tippy adds no describedby of its own.
    expect(link().getAttribute("aria-describedby")).toBe(
      screen.getByTestId(`${TEST_ID}-reason`).id,
    );
  });

  test("greyed out with no reason given: no tooltip, nothing to describe", async () => {
    jest.useFakeTimers();
    renderLink({ isDisabled: true });

    expect(link()).toHaveAttribute("aria-disabled", "true");
    expect(link()).not.toHaveAttribute("aria-describedby");

    fireEvent.mouseEnter(link());
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("once there is something to preview, the same link opens it", async () => {
    const { rerender }: RenderResult = render(
      <SubscriberNotificationPreviewButton
        getRequest={() => {
          return null;
        }}
        isDisabled={true}
        disabledReason={NO_NOTE_REASON}
      />,
    );

    expect(link()).toHaveAttribute("aria-disabled", "true");

    rerender(
      <SubscriberNotificationPreviewButton
        getRequest={() => {
          return REQUEST;
        }}
        isDisabled={false}
        disabledReason={NO_NOTE_REASON}
      />,
    );

    expect(link()).not.toHaveAttribute("aria-disabled");
    expect(link()).not.toHaveAttribute("aria-describedby");
    expect(classesOf(link())).toContain("text-indigo-600");

    fireEvent.click(link());

    expect(await openedDialog()).toBeInTheDocument();
  });
});

describe("in another language", () => {
  test("German: the word and the name are German, and the name holds the word", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    renderLink();

    const german: Record<string, string> = readLocale("de");

    // The one word on screen, not the whole name.
    expect(link().textContent).toBe(german["Preview"]);
    expect(link()).toHaveAccessibleName(german["Preview notification"]!);
    expect(german["Preview notification"]).toContain(german["Preview"]);
    expect(link().textContent).toBe("Vorschau");
    expect(link()).toHaveAccessibleName("Vorschau der Benachrichtigung");
  });

  test("German: the reason it waits is German too", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    renderLink({ isDisabled: true, disabledReason: NO_NOTE_REASON });

    const german: Record<string, string> = readLocale("de");

    expect(german[NO_NOTE_REASON]).toBeTruthy();
    expect(german[NO_NOTE_REASON]).not.toBe(NO_NOTE_REASON);
    expect(link()).toHaveAccessibleDescription(german[NO_NOTE_REASON]!);
  });

  test("Japanese: the name holds the word even where it comes last", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("ja");
    });

    renderLink();

    const japanese: Record<string, string> = readLocale("ja");

    expect(link().textContent).toBe(japanese["Preview"]);
    expect(link()).toHaveAccessibleName(japanese["Preview notification"]!);
    expect(japanese["Preview notification"]).toContain(japanese["Preview"]);
  });
});

/*
 * The public note composer draws the link beside its notify box, on the
 * label's line - the same treatment as the Yes on Declare Incident's last
 * step (IncidentCreateStatusPageScope.test.tsx).
 */
describe("beside the note composer's notify box", () => {
  function renderComposer(values: {
    note: string;
    shouldNotify: boolean;
  }): void {
    render(
      <NoteComposer
        mode="create"
        visibility="public"
        copy={getNotesCopy("public", "incident")}
        values={{
          note: values.note,
          attachments: [],
          shouldNotify: values.shouldNotify,
          postedAt: null,
        }}
        onChange={() => {}}
        editorKey="editor"
        isAttachmentsEnabled={false}
        notifyOption={{
          title: "Notify status page subscribers",
          checkedDescription: "Subscribers will be notified.",
          uncheckedDescription: "Nobody will be notified.",
        }}
        notifyAudience={
          <div data-testid="stub-audience">Will notify: Site 03</div>
        }
        notifyPreview={(draft: { note: string }): ReactElement => {
          const isBlank: boolean = draft.note.trim().length === 0;

          return (
            <SubscriberNotificationPreviewButton
              dataTestId="composer-preview"
              getRequest={() => {
                return isBlank ? null : { ...REQUEST, note: draft.note };
              }}
              isDisabled={isBlank}
              disabledReason={NO_NOTE_REASON}
            />
          );
        }}
        isPostedAtEditable={false}
        isSubmitting={false}
        onSubmit={() => {}}
        dataTestId="note-composer"
      />,
    );
  }

  test("on the label's line, before the description and the audience", () => {
    renderComposer({ note: "Rolling back.", shouldNotify: true });

    const line: HTMLElement = screen.getByTestId("note-notify-line");
    const preview: HTMLElement = screen.getByTestId("composer-preview");
    const label: HTMLElement = screen.getByText(
      "Notify status page subscribers",
    );

    expect(line).toContainElement(label);
    expect(line).toContainElement(preview);
    expect(classesOf(line)).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "items-center"]),
    );

    // The label first, then the link.
    expect(
      label.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The description and the audience come after the line, outside it.
    const description: HTMLElement = screen.getByTestId(
      "note-notify-description",
    );
    const audience: HTMLElement = screen.getByTestId("stub-audience");

    expect(line).not.toContainElement(description);
    expect(line).not.toContainElement(audience);
    expect(
      line.compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      description.compareDocumentPosition(audience) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("not inside the checkbox's label: pressing it never ticks the box", () => {
    renderComposer({ note: "Rolling back.", shouldNotify: true });

    const label: HTMLElement = screen.getByText(
      "Notify status page subscribers",
    );

    expect(label.tagName).toBe("LABEL");
    expect(label).not.toContainElement(screen.getByTestId("composer-preview"));
    expect(screen.getByTestId("note-notify-checkbox")).toBeChecked();
  });

  test("the checkbox's name is still only its label", () => {
    renderComposer({ note: "Rolling back.", shouldNotify: true });

    expect(screen.getByTestId("note-notify-checkbox")).toHaveAccessibleName(
      "Notify status page subscribers",
    );
  });

  test("grey with an empty note, and says why", () => {
    renderComposer({ note: "", shouldNotify: true });

    const preview: HTMLElement = screen.getByTestId("composer-preview");

    expect(preview).toHaveAttribute("aria-disabled", "true");
    expect(preview).toHaveAccessibleDescription(NO_NOTE_REASON);
  });

  test("opens the email of the note being written", async () => {
    renderComposer({
      note: "Rolling back the edge config.",
      shouldNotify: true,
    });

    fireEvent.click(screen.getByTestId("composer-preview"));

    await screen.findByTestId("subscriber-notification-preview-body");

    const posted: { data: JSONObject } = postMock.mock.calls[0]![0] as {
      data: JSONObject;
    };
    expect(posted.data["note"]).toBe("Rolling back the edge config.");
  });

  test("unticked, there is nothing to preview and no link", () => {
    renderComposer({ note: "Rolling back.", shouldNotify: false });

    expect(screen.queryByTestId("composer-preview")).toBeNull();
    expect(screen.queryByTestId("note-notify-preview")).toBeNull();
    expect(screen.getByTestId("note-notify-line")).toHaveTextContent(
      /^Notify status page subscribers$/,
    );
  });

  test("nothing is a control inside another control", () => {
    renderComposer({ note: "Rolling back.", shouldNotify: true });

    expect(findNestedControls(screen.getByTestId("note-notify-line"))).toEqual(
      [],
    );
  });
});

/*
 * Icon draws <div><svg/></div>, which may not sit inside a <p>: React warns,
 * and a browser parsing the same markup would close the paragraph early. The
 * lines of the dialog and of the audience summary that put an icon beside
 * their words are <div>s. Last in the file, so it reads every render above.
 */
describe("valid HTML", () => {
  test("the dialog with nothing to send, and the audience summary, nest nothing", async () => {
    answerPreviewWith({
      ...PREVIEW,
      statusPages: [],
      nothingSentReason:
        SubscriberNotificationPreviewNothingSentReason.NoMonitors,
    });

    renderLink();
    fireEvent.click(link());

    const nothingSent: HTMLElement = await screen.findByTestId(
      "subscriber-notification-preview-nothing-sent",
    );
    expect(nothingSent).toHaveTextContent(
      SubscriberNotificationPreviewCopy.nothingWillBeSent,
    );
    expect(nothingSent.querySelector("p div")).toBeNull();

    cleanup();

    render(
      <SubscriberAudienceSummary
        request={{ incidentId: INCIDENT_ID }}
        saysWhenNobodyIsNotified={true}
        dataTestId="audience"
      />,
    );

    // Working it out, with a spinner beside the words.
    expect(screen.getByTestId("audience")).toHaveAttribute(
      "data-state",
      "loading",
    );
    expect(screen.getByTestId("audience").querySelector("p div")).toBeNull();

    // Then who it reaches, with the envelope beside the headline.
    expect(
      await screen.findByText(
        "Site 03 (up to 41 email)",
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("audience").querySelector("p div")).toBeNull();
  });

  test("nothing drawn in this file put a block inside a paragraph", () => {
    expect(nestingWarnings).toEqual([]);
  });
});
