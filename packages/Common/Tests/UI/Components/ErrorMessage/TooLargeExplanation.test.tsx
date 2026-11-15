// Must stay the first import: the client's URLs are built from HOST on load.
import "../../Utils/API/DashboardHost";
import Alert, { AlertType } from "../../../../UI/Components/Alerts/Alert";
import ErrorExplanation, {
  isUnexplainedErrorMessage,
} from "../../../../UI/Components/ErrorMessage/ErrorExplanation";
import ErrorLine from "../../../../UI/Components/ErrorMessage/ErrorLine";
import ErrorMessage from "../../../../UI/Components/ErrorMessage/ErrorMessage";
import ErrorSentence, {
  ErrorInSentence,
} from "../../../../UI/Components/ErrorMessage/ErrorSentence";
import TableEmptyState, {
  TableEmptyStateKind,
} from "../../../../UI/Components/Table/TableEmptyState";
import API from "../../../../UI/Utils/API/API";
import {
  errorInSentence,
  getErrorInSentenceText,
  getErrorInSentenceWords,
} from "../../../../UI/Utils/ErrorInSentence";
import NewVersion, {
  NewVersionAudience,
} from "../../../../UI/Utils/NewVersion/NewVersion";
import { createTranslator } from "../../../../UI/Utils/TranslateTemplate";
import User from "../../../../UI/Utils/User";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import {
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
  UnexplainedErrorWords,
} from "../../../../Types/Exception/UnexplainedError";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
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
 * WHAT WAS SENT WAS TOO LARGE, DRAWN (#8278).
 *
 * A proxy's 413 page (nginx's "413 Request Entity Too Large", answered
 * when a body passes its client_max_body_size) read in every error place
 * as "The server ran into a problem it could not explain, so this did not
 * finish. Try again in a moment." Trying again never helps. Every place
 * that draws API.getFriendlyMessage's answer now says what was sent was
 * too large and to send less, and tells a master admin of a self-hosted
 * server which limit to raise - with no OneUptime Health link, which shows
 * nothing about a proxy. In English here; ErrorExplanationInReadersLanguage
 * and ErrorSentenceInEveryLanguage read it in every language.
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

const NGINX_413_PAGE: string =
  "<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n<center><h1>413 Request Entity Too Large</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n";

const TOO_LARGE: string = UNEXPLAINED_ERROR_MESSAGES.tooLarge;
const WHY_AND_NEXT: string = `${UnexplainedErrorWords.tooLargeWhy} ${UnexplainedErrorWords.tooLargeNext}`;

// What the reader saw before: a failure the server could not explain.
const OLD_WORDS: Array<string> = [
  UNEXPLAINED_ERROR_MESSAGES.server,
  UnexplainedErrorWords.serverWhy,
  UnexplainedErrorWords.serverNext,
  "Request Entity Too Large",
  "<html",
];

const expectNoneOfTheOldWords: (text: string) => void = (
  text: string,
): void => {
  for (const words of OLD_WORDS) {
    expect({ words, left: text.includes(words) }).toEqual({
      words,
      left: false,
    });
  }
};

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

describe("nginx's 413 page, from the request to the page", () => {
  test("API.getFriendlyMessage gives the sentence every error place explains", () => {
    const message: string = API.getFriendlyMessage(
      new HTTPErrorResponse(413, NGINX_413_PAGE as never, {}),
    );

    expect(message).toBe(TOO_LARGE);
    expect(isUnexplainedErrorMessage(message)).toBe(true);
  });

  test("a list that did not load says what was too large and to send less, never its markup", () => {
    const message: string = API.getFriendlyMessage(
      new HTTPErrorResponse(413, NGINX_413_PAGE as never, {}),
    );

    render(<ErrorMessage message={message} />);

    expect(screen.getByTestId("error-why-and-next")).toHaveTextContent(
      WHY_AND_NEXT,
    );
    expectNoneOfTheOldWords(document.body.textContent || "");
  });
});

describe("ErrorExplanation", () => {
  test("says what failed, that it was too large, and to send less - with no reference", () => {
    render(
      <ErrorExplanation
        message={TOO_LARGE}
        whatFailed="The file was not uploaded."
      />,
    );

    expect(screen.getByTestId("error-what-failed")).toHaveTextContent(
      "The file was not uploaded.",
    );
    expect(screen.getByTestId("error-why-and-next").textContent).toBe(
      WHY_AND_NEXT,
    );
    expect(screen.queryByTestId("error-reference")).toBeNull();
    expectNoneOfTheOldWords(document.body.textContent || "");
  });

  test("says 'This did not finish.' when the page does not say what it was doing", () => {
    render(<ErrorExplanation message={TOO_LARGE} />);

    expect(screen.getByTestId("error-what-failed")).toHaveTextContent(
      UnexplainedErrorWords.didNotFinish,
    );
  });

  test("tells a master admin of a self-hosted server which limit to raise, and does not open OneUptime Health", () => {
    isMasterAdmin = true;

    render(<ErrorExplanation message={TOO_LARGE} />);

    expect(screen.getByTestId("error-where-to-look").textContent).toBe(
      UnexplainedErrorWords.tooLargeWhereToLook,
    );
    expect(screen.getByTestId("error-where-to-look")).toHaveTextContent(
      "client_max_body_size 50M",
    );
    expect(screen.queryByTestId("error-open-health")).toBeNull();
  });

  test.each([
    ["a member of a self-hosted server", false, false],
    ["a master admin on OneUptime Cloud", true, true],
    ["a member on OneUptime Cloud", true, false],
  ])(
    "tells %s nothing about a proxy",
    (_reader: string, cloud: boolean, masterAdmin: boolean) => {
      isCloud = cloud;
      isMasterAdmin = masterAdmin;

      render(<ErrorExplanation message={TOO_LARGE} />);

      expect(screen.getByTestId("error-why-and-next").textContent).toBe(
        WHY_AND_NEXT,
      );
      expect(screen.queryByTestId("error-where-to-look")).toBeNull();
      expect(screen.queryByTestId("error-open-health")).toBeNull();
    },
  );

  test("a status page's visitor is told to send less, and nothing about a proxy", () => {
    isMasterAdmin = true;
    jest
      .spyOn(NewVersion, "getAudience")
      .mockReturnValue(NewVersionAudience.Visitors);

    render(<ErrorExplanation message={TOO_LARGE} />);

    expect(screen.getByTestId("error-why-and-next").textContent).toBe(
      WHY_AND_NEXT,
    );
    expect(screen.queryByTestId("error-where-to-look")).toBeNull();
  });
});

describe("the shared places an error is drawn", () => {
  test("a form's alert", () => {
    render(
      <Alert title={TOO_LARGE} type={AlertType.DANGER} dataTestId="alert" />,
    );

    const alert: HTMLElement = screen.getByTestId("alert");

    expect(within(alert).getByTestId("error-in-sentence")).toHaveAttribute(
      "data-error-kind",
      UnexplainedErrorKind.TooLarge,
    );
    expect(alert).toHaveTextContent(WHY_AND_NEXT);
    expectNoneOfTheOldWords(alert.textContent || "");
  });

  test("a card's red line, with what failed", () => {
    render(
      <ErrorLine
        message={TOO_LARGE}
        whatFailed="The dashboard was not saved."
        dataTestId="line"
      />,
    );

    const line: HTMLElement = screen.getByTestId("line");

    expect(line).toHaveAttribute("data-error-kind", "unexplained");
    expect(within(line).getByTestId("error-what-failed")).toHaveTextContent(
      "The dashboard was not saved.",
    );
    expect(within(line).getByTestId("error-why-and-next").textContent).toBe(
      WHY_AND_NEXT,
    );
  });

  test("a table that did not load, under its own title", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Error}
        title="Could not load monitors"
        description={TOO_LARGE}
      />,
    );

    expect(screen.getByTestId("error-why-and-next").textContent).toBe(
      WHY_AND_NEXT,
    );
    // The title says what failed.
    expect(screen.queryByTestId("error-what-failed")).toBeNull();
  });
});

describe("in a card's own sentence", () => {
  const UPLOAD_FAILED: string = "Couldn't upload the file. {{error}}";

  test("the card's words, then that it was too large and to send less", () => {
    render(
      <p data-testid="sentence">
        <ErrorSentence template={UPLOAD_FAILED} error={TOO_LARGE} />
      </p>,
    );

    const sentence: HTMLElement = screen.getByTestId("sentence");

    expect(sentence.textContent).toBe(
      `Couldn't upload the file. ${WHY_AND_NEXT}`,
    );
    expect(screen.getByTestId("error-in-sentence")).toHaveAttribute(
      "data-error-kind",
      UnexplainedErrorKind.TooLarge,
    );
    expect(screen.queryByTestId("error-reference")).toBeNull();
    expect(screen.queryByTestId("error-where-to-look")).toBeNull();
  });

  test("a self-hosted master admin reads which limit to raise on a line of its own, with no Health link", () => {
    isMasterAdmin = true;

    render(
      <p data-testid="sentence">
        <ErrorSentence template={UPLOAD_FAILED} error={TOO_LARGE} />
      </p>,
    );

    const sentence: HTMLElement = screen.getByTestId("sentence");
    const line: HTMLElement = screen.getByTestId("error-where-to-look");

    expect(line.textContent).toBe(UnexplainedErrorWords.tooLargeWhereToLook);
    expect(sentence.lastElementChild).toBe(line);
    expect(screen.queryByTestId("error-open-health")).toBeNull();
  });

  test("drawn on its own, it says where to look only when asked", () => {
    isMasterAdmin = true;

    render(
      <div>
        <p data-testid="alone">
          <ErrorInSentence message={TOO_LARGE} showWhereToLook={true} />
        </p>
        <p data-testid="inline">
          <ErrorInSentence message={TOO_LARGE} />
        </p>
      </div>,
    );

    expect(
      within(screen.getByTestId("alone")).getByTestId("error-where-to-look")
        .textContent,
    ).toBe(UnexplainedErrorWords.tooLargeWhereToLook);
    expect(
      within(screen.getByTestId("inline")).queryByTestId("error-where-to-look"),
    ).toBeNull();
    expect(screen.queryByTestId("error-open-health")).toBeNull();
  });

  test("a server failure still opens OneUptime Health beside its logs", () => {
    isMasterAdmin = true;

    render(
      <p>
        <ErrorInSentence
          message={UNEXPLAINED_ERROR_MESSAGES.server}
          showWhereToLook={true}
        />
      </p>,
    );

    expect(screen.getByTestId("error-where-to-look")).toHaveTextContent(
      UnexplainedErrorWords.adminWhereToLook,
    );
    expect(screen.getByTestId("error-open-health")).toBeInTheDocument();
  });
});

describe("as text", () => {
  const ENGLISH: ReturnType<typeof createTranslator> = createTranslator(
    undefined,
    "en",
  );

  test("its words, for a title or a notice, say it was too large and to send less", () => {
    expect(
      getErrorInSentenceText({
        message: TOO_LARGE,
        translator: ENGLISH,
        reader: { isCloud: false, isMasterAdmin: false },
      }),
    ).toBe(WHY_AND_NEXT);
  });

  test("the words say where to look to a self-hosted master admin, and to nobody else", () => {
    expect(
      getErrorInSentenceWords({
        message: TOO_LARGE,
        translator: ENGLISH,
        reader: { isCloud: false, isMasterAdmin: true },
      }),
    ).toEqual({
      isUnexplained: true,
      kind: UnexplainedErrorKind.TooLarge,
      text: WHY_AND_NEXT,
      reference: null,
      whereToLook: UnexplainedErrorWords.tooLargeWhereToLook,
      fullStop: ".",
    });

    for (const reader of [
      { isCloud: true, isMasterAdmin: true },
      { isCloud: false, isMasterAdmin: false },
      { isCloud: false, isMasterAdmin: true, isVisitor: true },
    ]) {
      expect(
        getErrorInSentenceWords({
          message: TOO_LARGE,
          translator: ENGLISH,
          reader: reader,
        }),
      ).toMatchObject({ whereToLook: null });
    }
  });

  test("errorInSentence fills a card's sentence with them", () => {
    expect(
      ENGLISH.translateTemplate("Couldn't import the dashboard. {{error}}", {
        error: errorInSentence(TOO_LARGE, {
          isCloud: true,
          isMasterAdmin: false,
        }),
      }),
    ).toBe(`Couldn't import the dashboard. ${WHY_AND_NEXT}`);
  });
});
