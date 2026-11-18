import ErrorExplanation from "../../../../UI/Components/ErrorMessage/ErrorExplanation";
import ErrorSentence from "../../../../UI/Components/ErrorMessage/ErrorSentence";
import User from "../../../../UI/Utils/User";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
  splitAtWhereToLookCommand,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorWords,
  WHERE_TO_LOOK_COMMANDS,
} from "../../../../Types/Exception/UnexplainedError";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  within,
} from "@testing-library/react";
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

/*
 * WHERE TO LOOK NAMES A COMMAND: DRAWN AS ONE (#7539).
 *
 * A self-hosted master admin is told where to look when the server fails:
 * "To see what failed, run npm run doctor -- --logs in the server's
 * oneuptime folder". Drawn as words of the sentence, the command broke
 * across lines in a narrow card ("npm run doctor -- --" / "logs"), its
 * halves sat at opposite ends of two lines on an Arabic or Persian page, and
 * it had no copy button while the reference beside it did.
 *
 * Now the command is a CODE element, left to right, in a box that never
 * breaks, with an icon-only copy button that copies exactly the command, in
 * ErrorExplanation's block and on ErrorSentence's line after a card's
 * sentence. Each sentence stays one translation key: every locale writes the
 * command as English does, and the drawn sentence is split at it, its words
 * around it unchanged.
 */

jest.mock("../../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mockedConfig;
});

type App = "Accounts" | "AdminDashboard" | "Dashboard";
type Words = Record<string, unknown>;

// The apps whose locales carry where-to-look's words.
const APPS: Array<App> = ["Dashboard", "AdminDashboard", "Accounts"];

const LANGUAGES: Array<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
  "ar",
];

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet",
);

const wordsOf: (app: App, language: string) => Words = (
  app: App,
  language: string,
): Words => {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SETS, app, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Words;
};

// Each where-to-look sentence, and the command it names.
const WHERE_TO_LOOK: Array<{ key: string; command: string }> = [
  {
    key: UnexplainedErrorWords.adminWhereToLookWithReference,
    command: "npm run doctor -- --logs",
  },
  {
    key: UnexplainedErrorWords.adminWhereToLook,
    command: "npm run doctor -- --logs",
  },
  {
    key: UnexplainedErrorWords.serverDownWhereToLook,
    command: "npm run doctor",
  },
];

const REFERENCE: string = "a1b2c3d4";
const WITH_REFERENCE: string = getUnexplainedServerErrorMessage(REFERENCE);
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);
const WHO_IS_TOLD: string = "Couldn't work out who is told. {{error}}";

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

const readIn: (app: App, language: string) => Promise<void> = async (
  app: App,
  language: string,
): Promise<void> => {
  await act(async () => {
    for (const code of [language, "en"]) {
      i18next.removeResourceBundle(code, "translation");
      i18next.addResourceBundle(
        code,
        "translation",
        wordsOf(app, code),
        true,
        true,
      );
    }

    await i18next.changeLanguage(language);
  });
};

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

beforeEach(() => {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

// The command's box in a where-to-look line, and what is in it.
const commandIn: (line: HTMLElement) => {
  box: HTMLElement;
  code: HTMLElement;
  button: HTMLElement;
} = (
  line: HTMLElement,
): { box: HTMLElement; code: HTMLElement; button: HTMLElement } => {
  const box: HTMLElement = within(line).getByTestId(
    "error-where-to-look-command",
  );

  return {
    box: box,
    code: box.querySelector("code") as HTMLElement,
    button: within(box).getByRole("button"),
  };
};

describe("the command in a where-to-look sentence", () => {
  test("each sentence names its command, the longest first, and a proxy's limit names none", () => {
    for (const entry of WHERE_TO_LOOK) {
      const parts: ReturnType<typeof splitAtWhereToLookCommand> =
        splitAtWhereToLookCommand(entry.key);

      expect({ key: entry.key, command: parts?.command }).toEqual({
        key: entry.key,
        command: entry.command,
      });
      expect(`${parts!.before}${parts!.command}${parts!.after}`).toBe(
        entry.key,
      );
    }

    expect(WHERE_TO_LOOK_COMMANDS).toEqual([
      "npm run doctor -- --logs",
      "npm run doctor",
    ]);
    expect(
      splitAtWhereToLookCommand(UnexplainedErrorWords.tooLargeWhereToLook),
    ).toBe(null);
    expect(splitAtWhereToLookCommand("")).toBe(null);
    expect(splitAtWhereToLookCommand(null)).toBe(null);
  });

  /*
   * What lets one translation key be split: every locale of every app that
   * carries the sentence writes its command exactly as English does, once
   * (Locales/ARABIC.md). A translator who translated it would leave the
   * reader nothing to run, and this fails.
   */
  test.each(APPS)(
    "every %s locale writes each command as English does, once",
    (app: App) => {
      for (const language of LANGUAGES) {
        const words: Words = wordsOf(app, language);

        for (const entry of WHERE_TO_LOOK) {
          const translated: unknown = words[entry.key];

          expect({
            app,
            language,
            key: entry.key,
            times:
              typeof translated === "string"
                ? translated.split(entry.command).length - 1
                : "missing",
            names: splitAtWhereToLookCommand(translated as string)?.command,
          }).toEqual({
            app,
            language,
            key: entry.key,
            times: 1,
            names: entry.command,
          });
        }
      }
    },
  );
});

describe.each(["en", "de", "fa", "ar"])("in %s", (language: string) => {
  beforeEach(async () => {
    await readIn("Dashboard", language);
  });

  const translated: (key: string) => string = (key: string): string => {
    return wordsOf("Dashboard", language)[key] as string;
  };

  test("ErrorExplanation draws the command as code, left to right, in a box that never breaks, the sentence around it unchanged", () => {
    const result: RenderResult = render(
      <ErrorExplanation message={WITH_REFERENCE} />,
    );
    const line: HTMLElement = result.getByTestId("error-where-to-look");
    const { box, code, button } = commandIn(line);

    expect(code.tagName).toBe("CODE");
    expect(code).toHaveAttribute("dir", "ltr");
    expect(code.textContent).toBe("npm run doctor -- --logs");
    expect(box).toHaveClass("whitespace-nowrap");
    expect(box).toHaveClass("inline-flex");
    // An icon: its name is heard, not read in the line.
    expect(button.textContent).toBe("");
    expect(withoutIsolateMarks(line.textContent || "")).toBe(
      `${translated(UnexplainedErrorWords.adminWhereToLookWithReference)} ${translated(UnexplainedErrorWords.openHealth)}`,
    );
  });

  test("ErrorSentence's line after a card's sentence draws it the same way", () => {
    const result: RenderResult = render(
      <p data-testid="sentence">
        <ErrorSentence template={WHO_IS_TOLD} error={WITH_REFERENCE} />
      </p>,
    );
    const line: HTMLElement = result.getByTestId("error-where-to-look");
    const { box, code } = commandIn(line);

    expect(code).toHaveAttribute("dir", "ltr");
    expect(code.textContent).toBe("npm run doctor -- --logs");
    expect(box).toHaveClass("whitespace-nowrap");
    expect(result.getByTestId("sentence").lastElementChild).toBe(line);
    expect(withoutIsolateMarks(line.textContent || "")).toContain(
      translated(UnexplainedErrorWords.adminWhereToLookWithReference),
    );
  });

  test("a server failure with no reference names the same command", () => {
    const result: RenderResult = render(
      <ErrorExplanation message={UNEXPLAINED_ERROR_MESSAGES.server} />,
    );
    const line: HTMLElement = result.getByTestId("error-where-to-look");

    expect(commandIn(line).code.textContent).toBe("npm run doctor -- --logs");
    expect(withoutIsolateMarks(line.textContent || "")).toContain(
      translated(UnexplainedErrorWords.adminWhereToLook),
    );
  });

  test("a gateway's error names npm run doctor, for whoever runs the server", () => {
    const result: RenderResult = render(
      <ErrorExplanation message={SERVER_DOWN_MESSAGE} />,
    );
    const line: HTMLElement = result.getByTestId("error-where-to-look");

    expect(commandIn(line).code.textContent).toBe("npm run doctor");
    expect(withoutIsolateMarks(line.textContent || "")).toBe(
      translated(UnexplainedErrorWords.serverDownWhereToLook),
    );
  });

  test("a proxy's limit names no command: its words are drawn as they are", () => {
    const result: RenderResult = render(
      <ErrorExplanation message={UNEXPLAINED_ERROR_MESSAGES.tooLarge} />,
    );
    const line: HTMLElement = result.getByTestId("error-where-to-look");

    expect(within(line).queryByTestId("error-where-to-look-command")).toBe(
      null,
    );
    expect(within(line).queryByRole("button")).toBe(null);
    // Its figure is held to its unit as the page draws it (a no-break space).
    const spaced: (text: string) => string = (text: string): string => {
      return text.split(NO_BREAK_SPACE).join(" ");
    };

    expect(spaced(withoutIsolateMarks(line.textContent || ""))).toBe(
      spaced(translated(UnexplainedErrorWords.tooLargeWhereToLook)),
    );
  });
});

describe("its copy button", () => {
  let writeText: WriteTextMock;

  beforeEach(async () => {
    await readIn("Dashboard", "en");
    writeText = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  });

  test.each([
    [WITH_REFERENCE, "npm run doctor -- --logs"],
    [SERVER_DOWN_MESSAGE, "npm run doctor"],
  ])(
    "copies exactly the command (%s)",
    async (message: string, command: string) => {
      const result: RenderResult = render(
        <ErrorExplanation message={message} />,
      );
      const { button } = commandIn(result.getByTestId("error-where-to-look"));

      expect(button).toHaveAccessibleName("Copy");

      await act(async () => {
        fireEvent.click(button);
      });

      expect(writeText).toHaveBeenCalledWith(command);
      expect(button).toHaveAttribute("data-copy-state", "copied");
    },
  );

  test("on the line after a card's sentence, it copies the command, and the reference's copies the reference", async () => {
    const result: RenderResult = render(
      <p>
        <ErrorSentence template={WHO_IS_TOLD} error={WITH_REFERENCE} />
      </p>,
    );

    await act(async () => {
      fireEvent.click(
        commandIn(result.getByTestId("error-where-to-look")).button,
      );
    });

    await act(async () => {
      fireEvent.click(
        within(result.getByTestId("error-reference")).getByRole("button"),
      );
    });

    expect(writeText.mock.calls).toEqual([
      ["npm run doctor -- --logs"],
      [REFERENCE],
    ]);
  });
});
