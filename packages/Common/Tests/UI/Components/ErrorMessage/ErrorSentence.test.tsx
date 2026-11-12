import ErrorSentence, {
  ErrorInSentence,
} from "../../../../UI/Components/ErrorMessage/ErrorSentence";
import User from "../../../../UI/Utils/User";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
  UnexplainedErrorWords,
} from "../../../../Types/Exception/UnexplainedError";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A CARD'S OWN SENTENCE WITH AN ERROR IN IT (#7307), drawn.
 *
 * "Couldn't work out who is told. {{error}}": the card's words, then the
 * error where the sentence puts it. A message somebody wrote is drawn as it
 * is; an error nobody explained says why and what to do next instead of the
 * fixed English it came as - never SERVER_DOWN_MESSAGE - with the server's
 * reference in code and a copy button, and, to a self-hosted master admin
 * of a server failure, where to look and OneUptime Health. In English here;
 * ErrorSentenceInEveryLanguage reads it in each of the Dashboard's.
 */

let isCloud: boolean = false;
let isMasterAdmin: boolean = false;

jest.mock("../../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return isCloud;
    },
  });

  return mockedConfig;
});

const REFERENCE: string = "a1b2c3d4";
const WITH_REFERENCE: string = getUnexplainedServerErrorMessage(REFERENCE);
const WHO_IS_TOLD: string = "Couldn't work out who is told. {{error}}";
const SERVER_DOWN_WORDS: string = `${UnexplainedErrorWords.serverDownWhy} ${UnexplainedErrorWords.serverDownNext}`;

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

beforeEach(() => {
  isCloud = false;
  isMasterAdmin = false;
  jest.spyOn(User, "isMasterAdmin").mockImplementation((): boolean => {
    return isMasterAdmin;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const drawSentence: (
  error: string | null | undefined,
  template?: string,
) => HTMLElement = (
  error: string | null | undefined,
  template: string = WHO_IS_TOLD,
): HTMLElement => {
  render(
    <p data-testid="sentence">
      <ErrorSentence template={template} error={error} />
    </p>,
  );

  return screen.getByTestId("sentence");
};

describe("a message somebody wrote", () => {
  test("is drawn as it is, plainly, as the card drew it before", () => {
    const sentence: HTMLElement = drawSentence("Monitor not found.");

    expect(sentence).toHaveTextContent(
      "Couldn't work out who is told. Monitor not found.",
    );
    expect(sentence.textContent).toBe(
      "Couldn't work out who is told. Monitor not found.",
    );
    expect(screen.queryByTestId("error-in-sentence")).toBeNull();
    expect(screen.getByText(/Monitor not found\./)).toBe(sentence);
  });

  test("no message leaves the card's own words", () => {
    expect(drawSentence(undefined).textContent).toBe(
      "Couldn't work out who is told. ",
    );
  });
});

describe("a gateway's 502 or 504", () => {
  test("says the server did not answer and to try again in a few minutes - never the English it came as", () => {
    const sentence: HTMLElement = drawSentence(SERVER_DOWN_MESSAGE);

    expect(sentence.textContent).toBe(
      `Couldn't work out who is told. ${SERVER_DOWN_WORDS}`,
    );
    expect(sentence.textContent).not.toContain(SERVER_DOWN_MESSAGE);
    expect(screen.getByTestId("error-in-sentence")).toHaveAttribute(
      "data-error-kind",
      UnexplainedErrorKind.ServerDown,
    );
    expect(screen.queryByTestId("error-reference")).toBeNull();
  });

  test("leaves the doctor to the page that did not load, even for a self-hosted master admin", () => {
    isMasterAdmin = true;

    drawSentence(SERVER_DOWN_MESSAGE);

    expect(screen.queryByTestId("error-where-to-look")).toBeNull();
    expect(screen.queryByTestId("error-open-health")).toBeNull();
  });
});

describe("a server failure with its reference", () => {
  test("says why and what to do next, then the reference in code, its full stop, and a copy button", () => {
    const sentence: HTMLElement = drawSentence(WITH_REFERENCE);

    expect(sentence.textContent).toBe(
      `Couldn't work out who is told. ${UnexplainedErrorWords.serverWhy} ${UnexplainedErrorWords.serverNextWithReferenceSelfHosted} ${REFERENCE}.`,
    );
    expect(sentence.textContent).not.toContain(WITH_REFERENCE);

    const reference: HTMLElement = screen.getByTestId("error-reference");
    const code: HTMLElement = within(reference).getByText(REFERENCE);

    expect(code.tagName).toBe("CODE");
    expect(code).toHaveAttribute("dir", "ltr");
    expect(within(reference).getByRole("button", { name: "Copy" })).toBe(
      within(reference).getByRole("button"),
    );
    // An icon in the sentence: its name is heard, not read in the line.
    expect(within(reference).getByRole("button").textContent).toBe("");
  });

  test("the copy button puts the reference on the clipboard", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    drawSentence(WITH_REFERENCE);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });

    expect(writeText).toHaveBeenCalledWith(REFERENCE);
    expect(screen.getByRole("button", { name: "Copy" })).toHaveAttribute(
      "data-copy-state",
      "copied",
    );

    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  });

  test("on OneUptime Cloud, the reference goes to OneUptime support, and nobody is told where to look", () => {
    isCloud = true;
    isMasterAdmin = true;

    expect(drawSentence(WITH_REFERENCE)).toHaveTextContent(
      UnexplainedErrorWords.serverNextWithReferenceCloud,
    );
    expect(screen.queryByTestId("error-where-to-look")).toBeNull();
  });

  test("a self-hosted master admin is told where to look, and OneUptime Health opens", () => {
    isMasterAdmin = true;

    drawSentence(WITH_REFERENCE);

    expect(screen.getByTestId("error-where-to-look")).toHaveTextContent(
      `${UnexplainedErrorWords.adminWhereToLookWithReference} ${UnexplainedErrorWords.openHealth}`,
    );
    expect(screen.getByTestId("error-open-health")).toHaveAttribute(
      "href",
      expect.stringContaining("/admin/health"),
    );
  });

  test("a member is told nothing about the server's logs", () => {
    drawSentence(WITH_REFERENCE);

    expect(screen.queryByTestId("error-where-to-look")).toBeNull();
  });

  /*
   * Where to look is advice for one reader, not part of what the card
   * says: a line of its own after the card's whole sentence. Inside the
   * {{error}} slot, a sentence that goes on after the error ran on from
   * "Open OneUptime Health" into "Showing the last known status".
   */
  test("where to look is a line of its own after the card's whole sentence, never inside it", () => {
    isMasterAdmin = true;

    const sentence: HTMLElement = drawSentence(
      WITH_REFERENCE,
      "{{error}} Showing the last known status; this page retries on its own.",
    );
    const whereToLook: HTMLElement = screen.getByTestId("error-where-to-look");

    expect(
      within(screen.getByTestId("error-in-sentence")).queryByTestId(
        "error-where-to-look",
      ),
    ).toBeNull();
    expect(sentence.lastElementChild).toBe(whereToLook);
    expect(whereToLook).toHaveClass("block");
    expect(sentence.textContent).toBe(
      `${UnexplainedErrorWords.serverWhy} ${UnexplainedErrorWords.serverNextWithReferenceSelfHosted} ${REFERENCE}. Showing the last known status; this page retries on its own.${UnexplainedErrorWords.adminWhereToLookWithReference} ${UnexplainedErrorWords.openHealth}`,
    );
  });
});

describe("the other errors nobody explained", () => {
  test("a server failure without a reference: where to look for a self-hosted master admin, no reference", () => {
    isMasterAdmin = true;

    const sentence: HTMLElement = drawSentence(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );

    expect(sentence).toHaveTextContent(
      `Couldn't work out who is told. ${UnexplainedErrorWords.serverWhy} ${UnexplainedErrorWords.serverNext}`,
    );
    expect(screen.queryByTestId("error-reference")).toBeNull();
    expect(screen.getByTestId("error-where-to-look")).toHaveTextContent(
      UnexplainedErrorWords.adminWhereToLook,
    );
  });

  test("OneUptime unreachable, and the page failing", () => {
    isMasterAdmin = true;

    expect(
      drawSentence(UNEXPLAINED_ERROR_MESSAGES.unreachable).textContent,
    ).toBe(
      `Couldn't work out who is told. ${UnexplainedErrorWords.unreachableWhy} ${UnexplainedErrorWords.unreachableNext}`,
    );
    cleanup();
    expect(drawSentence(UNEXPLAINED_ERROR_MESSAGES.page).textContent).toBe(
      `Couldn't work out who is told. ${UnexplainedErrorWords.pageWhy} ${UnexplainedErrorWords.pageNext}`,
    );
    expect(screen.queryByTestId("error-where-to-look")).toBeNull();
  });
});

describe("the sentence around the error", () => {
  test("the error goes where the sentence puts it: first, in the middle, as {{message}} or {{reason}}", () => {
    render(
      <div>
        <p data-testid="first">
          <ErrorSentence
            template="{{error}} Showing the last known status; this page retries on its own."
            error={SERVER_DOWN_MESSAGE}
          />
        </p>
        <p data-testid="message">
          <ErrorSentence
            template="Server said: {{message}}"
            error={SERVER_DOWN_MESSAGE}
            errorPlaceholder="message"
          />
        </p>
        <p data-testid="reason">
          <ErrorSentence
            template="Lookup for {{host}} failed: {{reason}}"
            error="NXDOMAIN"
            errorPlaceholder="reason"
            values={{ host: "example.com" }}
          />
        </p>
      </div>,
    );

    expect(screen.getByTestId("first").textContent).toBe(
      `${SERVER_DOWN_WORDS} Showing the last known status; this page retries on its own.`,
    );
    expect(screen.getByTestId("message").textContent).toBe(
      `Server said: ${SERVER_DOWN_WORDS}`,
    );
    expect(screen.getByTestId("reason").textContent).toBe(
      "Lookup for example.com failed: NXDOMAIN",
    );
  });

  test("its other slots and its plural forms are drawn as TranslatedSentence draws them", () => {
    render(
      <div>
        <p data-testid="slots">
          <ErrorSentence
            template="Couldn't refresh. Showing what loaded at {{time}}. {{error}}"
            error={SERVER_DOWN_MESSAGE}
            slots={{ time: <time data-testid="time">10:42</time> }}
          />
        </p>
        <p data-testid="plural">
          <ErrorSentence
            template={{
              one: "{{count}} task could not be tried again: {{error}}",
              other: "{{count}} tasks could not be tried again: {{error}}",
            }}
            count={3}
            values={{ count: 3 }}
            error="Rate limited."
          />
        </p>
      </div>,
    );

    expect(screen.getByTestId("slots").textContent).toBe(
      `Couldn't refresh. Showing what loaded at 10:42. ${SERVER_DOWN_WORDS}`,
    );
    expect(screen.getByTestId("time")).toBeInTheDocument();
    expect(screen.getByTestId("plural").textContent).toBe(
      "3 tasks could not be tried again: Rate limited.",
    );
  });

  test("a reader given to it is the one it speaks to", () => {
    render(
      <p data-testid="sentence">
        <ErrorSentence
          template={WHO_IS_TOLD}
          error={WITH_REFERENCE}
          reader={{ isCloud: true, isMasterAdmin: false }}
        />
      </p>,
    );

    expect(screen.getByTestId("sentence")).toHaveTextContent(
      UnexplainedErrorWords.serverNextWithReferenceCloud,
    );
  });

  test("ErrorInSentence alone draws the error's words, for a sentence built by hand", () => {
    render(
      <p data-testid="alone">
        <ErrorInSentence message={SERVER_DOWN_MESSAGE} />
      </p>,
    );

    expect(screen.getByTestId("alone").textContent).toBe(SERVER_DOWN_WORDS);
  });

  test("ErrorInSentence says where to look only when asked, for an error drawn on its own", () => {
    isMasterAdmin = true;

    render(
      <div>
        <p data-testid="in-a-sentence">
          <ErrorInSentence message={WITH_REFERENCE} />
        </p>
        <p data-testid="on-its-own">
          <ErrorInSentence message={WITH_REFERENCE} showWhereToLook={true} />
        </p>
        <p data-testid="explained">
          <ErrorInSentence
            message="Monitor not found."
            showWhereToLook={true}
          />
        </p>
      </div>,
    );

    expect(
      within(screen.getByTestId("in-a-sentence")).queryByTestId(
        "error-where-to-look",
      ),
    ).toBeNull();

    const onItsOwn: HTMLElement = screen.getByTestId("on-its-own");

    expect(onItsOwn.lastElementChild).toBe(
      within(onItsOwn).getByTestId("error-where-to-look"),
    );
    expect(within(onItsOwn).getByTestId("error-open-health")).toHaveAttribute(
      "href",
      expect.stringContaining("/admin/health"),
    );
    expect(screen.getByTestId("explained").textContent).toBe(
      "Monitor not found.",
    );
  });
});
