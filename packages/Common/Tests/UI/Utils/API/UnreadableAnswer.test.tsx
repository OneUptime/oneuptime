// UX rule: Docs/ux/README.md#errors
// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "./DashboardHost";
import FakeAxiosServer, { FakeReply, FakeTransport } from "./FakeAxiosServer";
import BaseAPI from "../../../../UI/Utils/API/API";
import AnalyticsModelAPI from "../../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../../UI/Utils/Navigation";
import User from "../../../../UI/Utils/User";
import ErrorMessage from "../../../../UI/Components/ErrorMessage/ErrorMessage";
import Label from "../../../../Models/DatabaseModels/Label";
import Log from "../../../../Models/AnalyticsModels/Log";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import Dictionary from "../../../../Types/Dictionary";
import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import UnreadableAnswerException from "../../../../Types/Exception/UnreadableAnswerException";
import {
  ERROR_REFERENCE_FIELD,
  getUnexplainedServerErrorMessage,
  readUnexplainedError,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
  UnexplainedErrorWords,
} from "../../../../Types/Exception/UnexplainedError";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import "@testing-library/jest-dom";
import { act, cleanup, render } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios from "axios";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * AN ANSWER THE PAGE COULD NOT READ IS SAID PLAINLY (#8413).
 *
 * Admin Dashboard > Telemetry Usage said "Array is not iterable" where its
 * projects should have been (#7794): something threw while the browser's
 * client read an answer, and API.fetch handed it on as a plain APIException
 * with a copy of its words, which API.getFriendlyMessage drew as they came.
 * The words a page's code throws are a developer's, and its failure is
 * OneUptime's, never the reader's.
 *
 * Every way an answer is read and turned into an error is run here, through
 * the real client down to where axios would open a socket (FakeAxiosServer):
 * an answer of a shape nobody expected, an answer that is not JSON at all,
 * an error answer that will not read, a count, a record and a list read by
 * ModelAPI and AnalyticsModelAPI, headers a client's own code fails on, and
 * no answer at all. Each says one of the sentences of a failure nobody
 * explained - the server's with its reference where the answer named one -
 * and never a word that was thrown.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const API_ORIGIN: string = `${DASHBOARD_ORIGIN}/api`;

const LABELS_URL: string = `${API_ORIGIN}/label/get-list?limit=10&skip=0`;
const LABEL_COUNT_URL: string = `${API_ORIGIN}/label/count`;
const LABEL_ID: string = "6f000000-0000-4000-8000-00000000000a";
const LABEL_URL: string = `${API_ORIGIN}/label/${LABEL_ID}/get-item`;
const LOGS_URL: string = `${API_ORIGIN}/logs/get-list?limit=10&skip=0`;
const RESOURCE_URL: string = `${API_ORIGIN}/telemetry-usage/projects`;

const REFERENCE: string = "a1b2c3d4";

/*
 * A value the client turns into an Email as it reads an answer, which will
 * not read: an empty address. Reading it throws OneUptime's own
 * BadDataException - "Email "" is not in valid format." - inside the
 * client, which a person was shown as if it were about what they typed.
 */
const UNREADABLE_EMAIL: JSONObject = { _type: "Email", value: "" };

// A proxy's page, answering 200 where the API should have.
const PROXY_PAGE: string =
  "<!DOCTYPE html><html><head><title>Sign in to the Wi-Fi</title></head><body>Accept the terms to continue.</body></html>";

// An answer cut short: JSON that ends half way, which axios passes on as text.
const CUT_SHORT: string = '{"data":[{"_id":"6f00000';

/*
 * What a list reads from the server: the Labels table's read, through
 * ModelAPI and BaseAPI.
 */
const listLabels: () => Promise<unknown> = async (): Promise<unknown> => {
  return await ModelAPI.getList<Label>({
    modelType: Label,
    query: {},
    limit: 10,
    skip: 0,
    select: { name: true },
    sort: {},
  });
};

const countLabels: () => Promise<number> = async (): Promise<number> => {
  return await ModelAPI.count<Label>({ modelType: Label, query: {} });
};

const getLabel: () => Promise<Label | null> = async (): Promise<
  Label | null
> => {
  return await ModelAPI.getItem<Label>({
    modelType: Label,
    id: new ObjectID(LABEL_ID),
    select: { name: true },
  });
};

const listLogs: () => Promise<unknown> = async (): Promise<unknown> => {
  return await AnalyticsModelAPI.getList<Log>({
    modelType: Log,
    query: {},
    limit: 10,
    skip: 0,
    select: { body: true },
    sort: {},
  });
};

// What a page's own request reads, through BaseAPI.
const readResource: () => Promise<
  HTTPResponse<JSONObject> | HTTPErrorResponse
> = async (): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
  return await BaseAPI.get<JSONObject>({ url: URL.fromString(RESOURCE_URL) });
};

// What a read threw - or the error answer it came back with - as the page holds it.
const failureOf: (read: () => Promise<unknown>) => Promise<unknown> = async (
  read: () => Promise<unknown>,
): Promise<unknown> => {
  try {
    const answer: unknown = await read();

    if (answer instanceof HTTPErrorResponse) {
      return answer;
    }
  } catch (err) {
    return err;
  }

  throw new Error("The read did not fail.");
};

// What the page says for a failure: what API.getFriendlyMessage writes.
const said: (failure: unknown) => string = (failure: unknown): string => {
  return BaseAPI.getFriendlyMessage(failure);
};

/*
 * A sentence of a failure nobody explained, as ErrorExplanation reads it
 * back: never words of the client's own.
 */
const expectPlainSentence: (
  message: string,
  kind: UnexplainedErrorKind,
  thrownWords?: Array<string>,
) => void = (
  message: string,
  kind: UnexplainedErrorKind,
  thrownWords: Array<string> = [],
): void => {
  expect(readUnexplainedError(message)?.kind).toBe(kind);

  for (const words of thrownWords) {
    expect(message).not.toContain(words);
  }

  for (const developerWords of [
    "iterable",
    "undefined",
    "null",
    "JSON",
    "Email",
    "<",
    "https://",
  ]) {
    expect(message).not.toContain(developerWords);
  }
};

let server: FakeAxiosServer;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();

  server = new FakeAxiosServer(mockedAxios);

  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(User, "logout").mockResolvedValue(null);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/dashboard"));
});

afterEach(() => {
  cleanup();
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("a malformed answer: one that is not JSON at all", () => {
  test.each([
    ["a proxy's page", PROXY_PAGE],
    ["an answer cut short", CUT_SHORT],
    ["an empty body", ""],
  ])(
    "to a list's read (%s) is a page that failed, never its text or 'is not iterable'",
    async (_: string, body: string) => {
      server.on(HTTPMethod.POST, LABELS_URL, [{ status: 200, rawData: body }]);

      const failure: unknown = await failureOf(listLabels);

      expect(failure).toBeInstanceOf(UnreadableAnswerException);
      expectPlainSentence(said(failure), UnexplainedErrorKind.Page, [
        "Wi-Fi",
        "6f00000",
      ]);
    },
  );

  test("to a record's read is a page that failed, never a record with no fields", async () => {
    server.on(HTTPMethod.POST, LABEL_URL, [
      { status: 200, rawData: PROXY_PAGE },
    ]);

    const failure: unknown = await failureOf(getLabel);

    expect(failure).toBeInstanceOf(UnreadableAnswerException);
    expectPlainSentence(said(failure), UnexplainedErrorKind.Page, ["Wi-Fi"]);
  });

  test("to a count's read is a page that failed, never a count of undefined", async () => {
    server.on(HTTPMethod.POST, LABEL_COUNT_URL, [
      { status: 200, rawData: PROXY_PAGE },
    ]);

    const failure: unknown = await failureOf(countLabels);

    expect(failure).toBeInstanceOf(UnreadableAnswerException);
    expectPlainSentence(said(failure), UnexplainedErrorKind.Page);
  });

  test("to an analytics list's read is a page that failed", async () => {
    server.on(HTTPMethod.POST, LOGS_URL, [{ status: 200, rawData: CUT_SHORT }]);

    const failure: unknown = await failureOf(listLogs);

    expect(failure).toBeInstanceOf(UnreadableAnswerException);
    expectPlainSentence(said(failure), UnexplainedErrorKind.Page);
  });

  test("a gateway's page for a failure keeps saying the server did not answer", async () => {
    server.on(HTTPMethod.GET, RESOURCE_URL, [
      {
        status: 502,
        rawData: "<html><body><h1>502 Bad Gateway</h1></body></html>",
      },
    ]);

    const failure: unknown = await failureOf(readResource);

    expect(failure).toBeInstanceOf(HTTPErrorResponse);
    expect(said(failure)).toBe(SERVER_DOWN_MESSAGE);
  });
});

describe("an unexpected shape: JSON nobody expected", () => {
  test("Telemetry Usage's page of projects (#7794) read as a list is a page that failed, never 'is not iterable'", async () => {
    server.on(HTTPMethod.POST, LABELS_URL, [
      {
        status: 200,
        data: { projects: [{ name: "Acme" }], count: 1, skip: 0, limit: 10 },
      },
    ]);

    const failure: unknown = await failureOf(listLabels);

    expect(failure).toBeInstanceOf(UnreadableAnswerException);
    expectPlainSentence(said(failure), UnexplainedErrorKind.Page, ["Acme"]);
  });

  test("a list whose rows are not a list is a page that failed", async () => {
    server.on(HTTPMethod.POST, LABELS_URL, [
      {
        status: 200,
        data: { data: { name: "Acme" }, count: 1, skip: 0, limit: 10 },
      },
    ]);

    expectPlainSentence(
      said(await failureOf(listLabels)),
      UnexplainedErrorKind.Page,
    );
  });

  test("a count that is no number is a page that failed", async () => {
    server.on(HTTPMethod.POST, LABEL_COUNT_URL, [
      { status: 200, data: { count: "many" } },
    ]);

    expectPlainSentence(
      said(await failureOf(countLabels)),
      UnexplainedErrorKind.Page,
      ["many"],
    );
  });

  test("a value that will not read, inside a list's answer, never says OneUptime's own words about it", async () => {
    server.on(HTTPMethod.POST, LABELS_URL, [
      {
        status: 200,
        data: {
          data: [{ _id: LABEL_ID, name: "Acme", email: UNREADABLE_EMAIL }],
          count: 1,
          skip: 0,
          limit: 10,
        },
      },
    ]);

    const failure: unknown = await failureOf(listLabels);

    // It read as OneUptime's own refusal, as if the person had typed it.
    expect(failure).toBeInstanceOf(UnreadableAnswerException);
    expect((failure as UnreadableAnswerException).readError).toBeInstanceOf(
      BadDataException,
    );
    expectPlainSentence(said(failure), UnexplainedErrorKind.Page, [
      "not in valid format",
    ]);
  });

  test("a value that will not read, in a page's own read, is a page that failed", async () => {
    server.on(HTTPMethod.GET, RESOURCE_URL, [
      { status: 200, data: { owner: UNREADABLE_EMAIL } },
    ]);

    const failure: unknown = await failureOf(readResource);

    expect(failure).toBeInstanceOf(UnreadableAnswerException);
    expect((failure as UnreadableAnswerException).statusCode).toBe(200);
    expectPlainSentence(said(failure), UnexplainedErrorKind.Page, [
      "not in valid format",
    ]);
  });

  test("an error answer that will not read keeps its reference: the server's failure, with it", async () => {
    server.on(HTTPMethod.GET, RESOURCE_URL, [
      {
        status: 500,
        data: {
          error: getUnexplainedServerErrorMessage(REFERENCE),
          [ERROR_REFERENCE_FIELD]: REFERENCE,
          owner: UNREADABLE_EMAIL,
        },
      },
    ]);

    const failure: unknown = await failureOf(readResource);

    expect(failure).toBeInstanceOf(HTTPErrorResponse);
    expect((failure as HTTPErrorResponse).statusCode).toBe(500);

    const message: string = said(failure);

    expect(message).toBe(getUnexplainedServerErrorMessage(REFERENCE));
    expect(readUnexplainedError(message)?.reference).toBe(REFERENCE);
    expect(message).not.toContain("not in valid format");
  });

  test("an error answer that will not read, with no reference, is a failure the server did not explain", async () => {
    server.on(HTTPMethod.GET, RESOURCE_URL, [
      { status: 500, data: { owner: UNREADABLE_EMAIL } },
    ]);

    const failure: unknown = await failureOf(readResource);

    expect(failure).toBeInstanceOf(HTTPErrorResponse);
    expectPlainSentence(said(failure), UnexplainedErrorKind.Server, [
      "not in valid format",
    ]);
  });

  test("an error answer that will not read still ends a session: its status is kept", async () => {
    const logout: jest.SpiedFunction<typeof User.logout> = jest
      .spyOn(User, "logout")
      .mockResolvedValue(null);

    server.on(HTTPMethod.GET, RESOURCE_URL, [
      { status: 405, data: { owner: UNREADABLE_EMAIL } },
    ]);

    const failure: unknown = await failureOf(readResource);

    expect((failure as HTTPErrorResponse).statusCode).toBe(405);
    expect(logout).toHaveBeenCalled();
  });

  test.each([
    [{ error: { code: 42 } }],
    [{ message: { detail: "x", status: 500 } }],
    [{ error: [1, 2, 3] }],
    [{ error: 42 }],
    [{ data: { rows: [] } }],
  ])(
    "an error answer that states nothing in words (%j) is a failure the server did not explain, never its JSON",
    async (body: JSONObject) => {
      server.on(HTTPMethod.GET, RESOURCE_URL, [{ status: 500, data: body }]);

      const failure: unknown = await failureOf(readResource);

      expectPlainSentence(said(failure), UnexplainedErrorKind.Server, [
        "{",
        "[",
        "42",
      ]);
    },
  );

  test("an error answer that states its words under another shape keeps them", async () => {
    server.on(HTTPMethod.GET, RESOURCE_URL, [
      {
        status: 400,
        data: {
          data: { rows: [] },
          error: { message: "That label is used by 3 monitors." },
        },
      },
    ]);

    expect(said(await failureOf(readResource))).toBe(
      "That label is used by 3 monitors.",
    );
  });
});

describe("headers a client's own code fails on", () => {
  /*
   * A client whose onResponseSuccessHeaders throws, as the Dashboard's
   * did before it kept its permission headers in a try (BaseAPI): what it
   * threw is never what the page says.
   */
  class ThrowingHeadersAPI extends BaseAPI {
    public static thrown: Error = new TypeError("headers is not iterable");

    protected static override async onResponseSuccessHeaders(
      _headers: Dictionary<string>,
    ): Promise<Dictionary<string>> {
      throw ThrowingHeadersAPI.thrown;
    }
  }

  test("are a page that failed, with what was thrown kept for the console", async () => {
    server.on(HTTPMethod.GET, RESOURCE_URL, [
      { status: 200, data: { projects: [] } },
    ]);

    const failure: unknown = await failureOf(async () => {
      return await ThrowingHeadersAPI.get<JSONObject>({
        url: URL.fromString(RESOURCE_URL),
      });
    });

    expect(failure).toBeInstanceOf(UnreadableAnswerException);
    // An APIException still, as every reader on the server takes it.
    expect(failure).toBeInstanceOf(APIException);
    expect((failure as UnreadableAnswerException).readError).toBe(
      ThrowingHeadersAPI.thrown,
    );
    // Its words stay its message, for a developer; its `error` stays null.
    expect((failure as UnreadableAnswerException).message).toBe(
      "headers is not iterable",
    );
    expect((failure as UnreadableAnswerException).error).toBeNull();
    expectPlainSentence(said(failure), UnexplainedErrorKind.Page, [
      "headers is not iterable",
    ]);
  });
});

describe("a network failure: no answer at all", () => {
  test.each(["ECONNREFUSED", "ETIMEDOUT", "ERR_NETWORK", "ECONNRESET"])(
    "%s is OneUptime that could not be reached, never the URL or the browser's words",
    async (code: string) => {
      server.on(HTTPMethod.POST, LABELS_URL, [{ networkErrorCode: code }]);

      const failure: unknown = await failureOf(listLabels);

      expect(failure).toBeInstanceOf(APIException);
      expect(failure).not.toBeInstanceOf(UnreadableAnswerException);
      expectPlainSentence(said(failure), UnexplainedErrorKind.Unreachable, [
        code,
        `connect ${code}`,
        "/label",
      ]);
    },
  );
});

describe("whatever a client's code throws while it reads an answer", () => {
  /*
   * Seeded: the same 300 throws on every run. Each is a kind of error a
   * reader's code throws, with words drawn from the letters, digits and
   * punctuation of a developer's message, at a status an answer comes
   * with; whatever it is, the page says one of the plain sentences, and
   * none of its words.
   */
  const ERROR_KINDS: Array<(words: string) => Error> = [
    (words: string): Error => {
      return new TypeError(words);
    },
    (words: string): Error => {
      return new SyntaxError(words);
    },
    (words: string): Error => {
      return new RangeError(words);
    },
    (words: string): Error => {
      return new Error(words);
    },
    (words: string): Error => {
      return new BadDataException(words);
    },
    (words: string): Error => {
      return new APIException(words);
    },
  ];

  const ALPHABET: Array<string> = [
    "x",
    "q",
    "z",
    "7",
    "9",
    "_",
    ".",
    "(",
    ")",
    "'",
    "[",
    "]",
    "#",
  ];

  const STATUSES: Array<number> = [200, 201, 204, 206];

  const random: SeededRandom = seededRandom(8413);
  const throws: Array<string> = generatedTexts(300, 8413, ALPHABET, 24).map(
    (words: string, index: number): string => {
      // Never empty, and never a word a plain sentence holds.
      return `zq${index}${words}`;
    },
  );

  test("is said as a page that failed, never in its words", () => {
    for (const words of throws) {
      const error: Error = ERROR_KINDS[random(ERROR_KINDS.length)]!(words);
      const statusCode: number = STATUSES[random(STATUSES.length)]!;

      const failure: UnreadableAnswerException =
        UnreadableAnswerException.fromReadError(error, {
          statusCode: statusCode,
          body: { projects: [] },
        });

      const message: string = said(failure);

      expect(message).toBe(UNEXPLAINED_ERROR_MESSAGES.page);
      expect(message).not.toContain(words);
      // Kept for a developer.
      expect(failure.message).toBe(words);
      expect(failure.readError).toBe(error);
    }
  });

  test("with the reference an answer named, is the server's failure with it", () => {
    for (const words of throws.slice(0, 50)) {
      const failure: UnreadableAnswerException =
        UnreadableAnswerException.fromReadError(new TypeError(words), {
          statusCode: 200,
          body: { [ERROR_REFERENCE_FIELD]: REFERENCE },
        });

      expect(said(failure)).toBe(getUnexplainedServerErrorMessage(REFERENCE));
    }
  });

  test.each([
    [500, UNEXPLAINED_ERROR_MESSAGES.server],
    [400, UNEXPLAINED_ERROR_MESSAGES.server],
    [502, SERVER_DOWN_MESSAGE],
    [504, SERVER_DOWN_MESSAGE],
    [503, SERVER_DOWN_MESSAGE],
    [413, UNEXPLAINED_ERROR_MESSAGES.tooLarge],
  ])(
    "at status %i, is what an answer of that status that says nothing is",
    (statusCode: number, sentence: string) => {
      expect(
        said(
          UnreadableAnswerException.fromReadError(new TypeError("x is null"), {
            statusCode: statusCode,
            body: {},
          }),
        ),
      ).toBe(sentence);
    },
  );

  test("a reference that is not one is never said as one", () => {
    const failure: UnreadableAnswerException =
      UnreadableAnswerException.fromReadError(new TypeError("x"), {
        statusCode: 200,
        body: { [ERROR_REFERENCE_FIELD]: "<b>hi</b>" },
      });

    expect(failure.reference).toBeNull();
    expect(said(failure)).toBe(UNEXPLAINED_ERROR_MESSAGES.page);
  });

  test("an error that said nothing is kept with words of its own", () => {
    const failure: UnreadableAnswerException =
      UnreadableAnswerException.fromReadError(new TypeError(""), {});

    expect(failure.message).toBe("The answer could not be read.");
    expect(said(failure)).toBe(UNEXPLAINED_ERROR_MESSAGES.page);
  });

  test("one already read as unreadable is handed on as it is", () => {
    const first: UnreadableAnswerException =
      UnreadableAnswerException.fromReadError(new TypeError("x"), {
        statusCode: 200,
      });

    expect(UnreadableAnswerException.fromReadError(first, {})).toBe(first);
  });
});

describe("what the page shows, in the reader's language", () => {
  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {},
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  const speak: (language: string) => Promise<void> = async (
    language: string,
  ): Promise<void> => {
    await act(async () => {
      for (const code of [language, "en"]) {
        i18next.removeResourceBundle(code, "translation");
        i18next.addResourceBundle(
          code,
          "translation",
          readDashboardLocale(code),
          true,
          true,
        );
      }

      await i18next.changeLanguage(language);
    });
  };

  test.each(["en", "de", "fa"])(
    "in %s, a list whose answer would not read says why and what to do next, and no word the code threw",
    async (language: string) => {
      server.on(HTTPMethod.POST, LABELS_URL, [
        { status: 200, rawData: PROXY_PAGE },
      ]);

      const failure: unknown = await failureOf(listLabels);

      await speak(language);

      const view: ReturnType<typeof render> = render(
        <ErrorMessage message={said(failure)} onRefreshClick={() => {}} />,
      );

      const text: string = withoutIsolateMarks(view.container.textContent || "");
      const words: Record<string, string> = readDashboardLocale(language);

      expect(text).toContain(
        words[UnexplainedErrorWords.pageWhy] || UnexplainedErrorWords.pageWhy,
      );
      expect(text).toContain(
        words[UnexplainedErrorWords.pageNext] ||
          UnexplainedErrorWords.pageNext,
      );

      for (const thrown of [
        "iterable",
        "Wi-Fi",
        "<html",
        (failure as UnreadableAnswerException).message,
      ]) {
        expect(text).not.toContain(thrown);
      }
    },
  );
});

describe("a reply of the fake server", () => {
  test("answers what it is scripted with, so these reads are the client's own", async () => {
    const reply: FakeReply = { status: 200, rawData: PROXY_PAGE };

    server.on(HTTPMethod.GET, RESOURCE_URL, [reply]);

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await readResource();

    // A page's own read hands the text on, kept under data, and says so.
    expect(answer).toBeInstanceOf(HTTPResponse);
    expect(answer.isText).toBe(true);
    expect((answer.data as JSONObject)["data"]).toBe(PROXY_PAGE);
  });
});

