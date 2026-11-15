import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE TELEGRAM AND WHATSAPP SETUP GUIDES, IN THE READER'S LANGUAGE (#8677).
 *
 * Admin Dashboard > Settings > Telegram and > WhatsApp each open with a
 * guide of a few dozen sentences, and both read English in every language:
 * the extractor finds a text by where it stands, and the guides were built
 * from string literals joined into Markdown. Each sentence is a key now,
 * translated into all 18 languages with its Markdown kept - its heading,
 * its step's number, its bold labels, its links and its code - and each
 * page lays its guide out the way the reader's language reads: an Arabic
 * or Persian guide names more Latin letters (Meta's labels, the commands,
 * the templates) than its own, and laid out by its letters it read left to
 * right.
 *
 * This draws both real pages, with the server's answers stood in and
 * i18next set up as the Admin's, in English, German, Arabic and Persian:
 * every sentence the guide looks up reads in the language, none of the
 * English is left, the guide reads the language's way, and what Telegram
 * and Meta must be given - commands, addresses, template names and bodies -
 * is as written. Then every Admin Dashboard language's guide is held to the
 * English one's Markdown, line by line.
 */

jest.setTimeout(60000);

const mockGetItem: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      createOrUpdate: async (): Promise<unknown> => {
        return { data: {} };
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

interface MockPageProps {
  children?: ReactNode | undefined;
}

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      return <main data-testid="admin-page">{props.children}</main>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

interface MockMarkdownProps {
  text: string;
  readingDirection?: string | undefined;
}

// The guide, as the Markdown it is given and the way it is told it reads.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MockMarkdownProps): ReactElement => {
      return (
        <pre data-testid="setup-guide" dir={props.readingDirection}>
          {props.text}
        </pre>
      );
    },
  };
});

import SettingsTelegram from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/Index";
import SettingsWhatsApp from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/WhatsApp/Index";
import { buildTelegramSetupMarkdown } from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/TelegramSetupGuide";
import { buildWhatsAppSetupMarkdown } from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/WhatsApp/WhatsAppSetupGuide";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import { APP_API_URL } from "../../../UI/Config";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

const WAIT_FOR_TIMEOUT: number = 20000;

type Locale = Record<string, unknown>;

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

const readLocale: (language: string) => Locale = (language: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Locale;
};

const ENGLISH: Locale = readLocale("en");

// The languages drawn: a long one, and both read from the right.
const LANGUAGES: Array<string> = ["en", "de", "ar", "fa"];

const RIGHT_TO_LEFT: Array<string> = ["ar", "fa"];

// The address the Telegram page shows, as the page builds it.
const TELEGRAM_WEBHOOK_URL: string = `${APP_API_URL.toString().replace(/\/$/, "")}/notification/telegram/webhook`;

interface Guide {
  name: string;
  page: () => ReactElement;
  build: (translator: Translator) => string;
}

const GUIDES: Array<Guide> = [
  {
    name: "Telegram",
    page: (): ReactElement => {
      return <SettingsTelegram />;
    },
    build: (translator: Translator): string => {
      return buildTelegramSetupMarkdown(TELEGRAM_WEBHOOK_URL, translator);
    },
  },
  {
    name: "WhatsApp",
    page: (): ReactElement => {
      return <SettingsWhatsApp />;
    },
    build: (translator: Translator): string => {
      return buildWhatsAppSetupMarkdown(translator);
    },
  },
];

// A translator that reads `language`'s locale file as the page's does.
const translatorFor: (language: string) => Translator = (
  language: string,
): Translator => {
  const locale: Locale = readLocale(language);

  return createTranslator((text: string): string | undefined => {
    const word: unknown = locale[text];

    return typeof word === "string" ? word : undefined;
  }, language);
};

// Every text the guide looks up, in the order it asks for them.
const textsLookedUpBy: (guide: Guide) => Array<string> = (
  guide: Guide,
): Array<string> => {
  const asked: Array<string> = [];

  guide.build(
    createTranslator((text: string): string => {
      if (!asked.includes(text)) {
        asked.push(text);
      }

      return text;
    }, "en"),
  );

  return asked;
};

// The text `language` gives `key`, read from its file.
const wordIn: (language: string, key: string) => string = (
  language: string,
  key: string,
): string => {
  const word: unknown = readLocale(language)[key];

  if (typeof word !== "string") {
    throw new Error(`${language} has no entry for ${key}`);
  }

  return word;
};

// The marks that set a value apart (U+2066-U+2069): none is read.
const ISOLATE_MARKS: RegExp = new RegExp(
  `[${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`,
  "g",
);

// A no-break space, and French's narrow one: each read as a space.
const NO_BREAK_SPACES: RegExp = new RegExp(
  `[${String.fromCharCode(0x00a0)}${String.fromCharCode(0x202f)}]`,
  "g",
);

// A word of three letters or more: what code and a name alone have not.
const WORD: RegExp = /[a-z]{3,}/;

// A text as read: no isolate's marks, and a no-break space read as a space.
const asRead: (text: string) => string = (text: string): string => {
  return text.replace(ISOLATE_MARKS, "").replace(NO_BREAK_SPACES, " ");
};

// The words around each {{placeholder}} of a sentence.
const piecesOf: (sentence: string) => Array<string> = (
  sentence: string,
): Array<string> => {
  return sentence
    .split(/\{\{[^{}]+\}\}/)
    .map((piece: string): string => {
      return asRead(piece).trim();
    })
    .filter((piece: string): boolean => {
      return piece.length > 0;
    });
};

const CODE_SPAN: RegExp = /`[^`\n]+`/g;

const LINK_TARGET: RegExp = /\]\(([^()\s]+)\)/g;

const FENCE: RegExp = /```[a-z]*\n[\s\S]*?\n```/g;

// Each piece of `pattern` in `text`, sorted: what a translation must keep.
const allOf: (text: string, pattern: RegExp) => Array<string> = (
  text: string,
  pattern: RegExp,
): Array<string> => {
  return (text.match(pattern) || []).slice().sort();
};

const instanceFor: (language: string) => Promise<i18n> = async (
  language: string,
): Promise<i18n> => {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
      [language]: { translation: readLocale(language) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
};

interface ItemCall {
  modelType: { new (): BaseModel };
  id: ObjectID;
}

// The settings, with nothing set up.
const answerGetItem: (options: unknown) => Promise<unknown> = async (
  options: unknown,
): Promise<unknown> => {
  const call: ItemCall = options as ItemCall;
  const item: BaseModel = new call.modelType();

  (item as unknown as Record<string, unknown>)["_id"] = call.id.toString();

  return item;
};

// The guide `guide`'s page draws in `language`.
const drawnGuide: (
  guide: Guide,
  language: string,
) => Promise<HTMLElement> = async (
  guide: Guide,
  language: string,
): Promise<HTMLElement> => {
  render(
    <I18nextProvider i18n={await instanceFor(language)}>
      {guide.page()}
    </I18nextProvider>,
  );

  await waitFor(
    () => {
      expect(screen.getByTestId("setup-guide")).toBeInTheDocument();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  // The cards' reads, answered.
  for (let index: number = 0; index < 10; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  return screen.getByTestId("setup-guide");
};

beforeEach(() => {
  mockGetItem.mockReset();
  mockGetItem.mockImplementation(answerGetItem);
});

afterEach(() => {
  cleanup();
});

describe.each(GUIDES)("Settings > $name's setup guide", (guide: Guide) => {
  const keys: Array<string> = textsLookedUpBy(guide);

  test("looks every sentence up: a few dozen, each one with an entry in every Admin Dashboard language", () => {
    expect(keys.length).toBeGreaterThan(20);

    for (const language of ["en", ...ADMIN_DASHBOARD_LANGUAGES]) {
      for (const key of keys) {
        expect({
          language,
          key,
          has: typeof readLocale(language)[key],
        }).toEqual({ language, key, has: "string" });
      }
    }
  });

  describe.each(LANGUAGES)("drawn in %s", (language: string) => {
    test("reads every sentence in the language, and none of the English", async () => {
      const shown: string = asRead(
        (await drawnGuide(guide, language)).textContent || "",
      );

      for (const key of keys) {
        for (const piece of piecesOf(wordIn(language, key))) {
          expect({ key, piece, drawn: shown.includes(piece) }).toEqual({
            key,
            piece,
            drawn: true,
          });
        }
      }

      if (language === "en") {
        return;
      }

      for (const key of keys) {
        if (wordIn(language, key) === wordIn("en", key)) {
          continue;
        }

        for (const piece of piecesOf(wordIn("en", key))) {
          // A piece that is all code or a name reads the same in any language.
          if (!WORD.test(piece.replace(CODE_SPAN, ""))) {
            continue;
          }

          expect({ key, piece, english: shown.includes(piece) }).toEqual({
            key,
            piece,
            english: false,
          });
        }
      }
    });

    test("is laid out the way the language reads", async () => {
      const drawn: HTMLElement = await drawnGuide(guide, language);

      expect(drawn).toHaveAttribute(
        "dir",
        RIGHT_TO_LEFT.includes(language) ? "rtl" : "ltr",
      );
    });

    test("gives Telegram and Meta what they must be given as written: the commands, addresses, names and bodies", async () => {
      const shown: string =
        (await drawnGuide(guide, language)).textContent || "";
      const english: string = guide.build(translatorFor("en"));

      expect(allOf(shown, CODE_SPAN)).toEqual(allOf(english, CODE_SPAN));
      expect(allOf(shown, LINK_TARGET)).toEqual(allOf(english, LINK_TARGET));
      expect(allOf(shown, FENCE)).toEqual(allOf(english, FENCE));
    });
  });
});

describe("the guides' counts and paths, read from the right", () => {
  test("Persian counts a template's variables in its own digits, and Arabic in Latin ones", async () => {
    const persian: string = await drawnGuide(GUIDES[1]!, "fa").then(
      (drawn: HTMLElement): string => {
        return drawn.textContent || "";
      },
    );

    expect(persian).toMatch(/\*\*متغیرها \([۰-۹]+\)\*\*/);
    expect(persian).not.toMatch(/\*\*متغیرها \([0-9]+\)\*\*/);

    cleanup();

    const arabic: string = await drawnGuide(GUIDES[1]!, "ar").then(
      (drawn: HTMLElement): string => {
        return drawn.textContent || "";
      },
    );

    expect(arabic).toMatch(/\*\*المتغيرات \([0-9]+\)\*\*/);
  });

  test("a path of the reader's own words points the way Arabic and Persian read; one of Meta's labels keeps English's", () => {
    for (const language of RIGHT_TO_LEFT) {
      const telegram: string = GUIDES[0]!.build(translatorFor(language));
      const whatsApp: string = GUIDES[1]!.build(translatorFor(language));

      // Project Settings, then Notifications, then Notification Channels.
      expect(telegram).toMatch(/\*\*[^*\n]+ ← [^*\n]+ ← [^*\n]+\*\*/);
      expect(telegram).not.toMatch(/[؀-ۿ] → /);
      expect(whatsApp).not.toMatch(/[؀-ۿ] → /);
      expect(whatsApp).toContain(
        "**Business Settings → Accounts → WhatsApp Accounts**",
      );
      expect(whatsApp).toContain("**WhatsApp → Configuration → Webhooks**");
    }
  });
});

// The Markdown a line starts with: a heading's marks, a step's number, a bullet.
const leadOf: (line: string) => string = (line: string): string => {
  const heading: RegExpMatchArray | null = line.match(/^(#{1,6}) /);

  if (heading) {
    return heading[1]!;
  }

  const marker: RegExpMatchArray | null = line.match(/^(\s*(?:\d+\.|-|>|\|)) /);

  return marker ? marker[1]! : "";
};

describe.each(GUIDES)(
  "Settings > $name's setup guide in every Admin Dashboard language",
  (guide: Guide) => {
    const english: Array<string> = guide.build(translatorFor("en")).split("\n");
    const keys: Array<string> = textsLookedUpBy(guide);

    test.each(ADMIN_DASHBOARD_LANGUAGES)(
      "%s keeps the English guide's Markdown, line by line",
      (language: string) => {
        const lines: Array<string> = guide
          .build(translatorFor(language))
          .split("\n");

        expect(lines.length).toBe(english.length);

        english.forEach((line: string, index: number) => {
          const translated: string = lines[index]!;

          expect({
            line: index,
            lead: leadOf(translated),
            code: allOf(translated, CODE_SPAN),
            links: allOf(translated, LINK_TARGET),
            columns: translated.split("|").length,
            boldClosed: translated.split("**").length % 2,
          }).toEqual({
            line: index,
            lead: leadOf(line),
            code: allOf(line, CODE_SPAN),
            links: allOf(line, LINK_TARGET),
            columns: line.split("|").length,
            boldClosed: 1,
          });
        });

        /*
         * And it is the language's: at most a heading French and Spanish
         * write as English does ("**Variables**") reads as English.
         */
        expect(
          keys.filter((key: string): boolean => {
            return wordIn(language, key) === wordIn("en", key);
          }).length,
        ).toBeLessThanOrEqual(2);
      },
    );
  },
);
