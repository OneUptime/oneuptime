import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import DashboardKeyboardShortcuts from "../../../../App/FeatureSet/Dashboard/src/Components/KeyboardShortcuts/DashboardKeyboardShortcuts";
import MonitorManualGuideCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorManualGuideCard";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import japaneseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import ObjectID from "../../../Types/ObjectID";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import {
  createTranslator,
  translatableTerm,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * The Dashboard in Japanese, read from the real locale files.
 *
 * Every string asserted below was English in ja.json, chained word for
 * word with spaces between the words ("アラート エピソード 内部 ノート"), or
 * ended in a half-width question mark, until the Japanese translation pass
 * filled the file in. Four kinds of lookup are covered:
 *
 *  - nested keys read with t("a.b") (the products menu and the keyboard
 *    shortcuts dialog),
 *  - flat keys a Common component looks up for the Dashboard (the products
 *    button and the Card's title and description),
 *  - the default-separator configuration the Dashboard's own i18next
 *    instance uses (Utils/i18n.ts), so a flat key that looked like a path
 *    would show up here as English,
 *  - and the Translator the shared components use, for sentences with a
 *    model name and for counts. Japanese has no "one" form, so a count of 1
 *    reads the general sentence.
 *
 * The instance reaches the components through I18nextProvider only, so no
 * other suite in this worker sees Japanese.
 */

const japanese: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;
const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-7777-4aaa-8bbb-000000000010",
);

/*
 * English source key → the Japanese ja.json ships for it. A test at the end
 * keeps these copies honest against the file. "AI / LLM" and the "AI"
 * section read the same in Japanese, so they are not listed: the last test
 * checks that every listed value differs from the English.
 */
const PRODUCTS_MENU_JAPANESE: Array<[string, string]> = [
  ["navbar.items.securityEventsTitle", "セキュリティイベント"],
  [
    "navbar.items.securityEventsDescription",
    "オブザーバビリティデータと相関付けた SIEM シグナル。",
  ],
  ["navbar.items.networkTitle", "ネットワーク"],
  [
    "navbar.items.networkDescription",
    "SNMP でネットワークデバイスを監視し、サイトごとにグループ化します。",
  ],
  ["navbar.items.logsTitle", "ログ"],
  ["navbar.items.logsDescription", "ログを検索・分析。"],
];

// The products button and the folded sections the test below opens.
const MENU_JAPANESE: Array<[string, string]> = [
  ["Products", "製品"],
  ["navbar.categories.observability", "オブザーバビリティ"],
  ["navbar.categories.infrastructure", "インフラストラクチャ"],
];

const SHORTCUTS_JAPANESE: Array<[string, string]> = [
  ["keyboardShortcuts.title", "キーボードショートカット"],
  [
    "keyboardShortcuts.description",
    "キーボードから手を離さずに素早く操作できます。",
  ],
  ["keyboardShortcuts.groups.general", "一般"],
  ["keyboardShortcuts.groups.goTo", "移動"],
  ["keyboardShortcuts.commandPalette", "コマンドパレットを開く"],
  ["keyboardShortcuts.searchList", "このページのリストを検索"],
  ["keyboardShortcuts.dismiss", "ダイアログやパネルを閉じる"],
];

const CARD_JAPANESE: Array<[string, string]> = [
  ["Manual monitor", "手動モニター"],
  [
    "Status is set by people, not by checks.",
    "ステータスはチェックではなく人が設定します。",
  ],
];

/*
 * Model names go into tables, forms and sentences as one term. The older
 * Japanese translated each English word on its own, kept the English order
 * and put a space between the words; these now read as Japanese compounds.
 */
const MODEL_NAMES_JAPANESE: Array<[string, string]> = [
  ["Alert Episode Internal Note", "アラートエピソードの内部メモ"],
  [
    "Incident Episode State Timelines",
    "インシデントエピソードの状態タイムライン",
  ],
  [
    "Scheduled Maintenance Template Team Owner",
    "定期メンテナンステンプレートの所有者チーム",
  ],
  ["On-Call Schedule Layer User", "オンコールスケジュールのレイヤーのユーザー"],
  [
    "Status Page History Chart Bar Color",
    "ステータスページの履歴チャートのバーの色",
  ],
  ["Log Drop Filter", "ログ破棄フィルター"],
  ["Telemetry Ingestion Key", "テレメトリ取り込みキー"],
  ["Workspace User Auth Token", "ワークスペースのユーザー認証トークン"],
];

// Questions end in a full-width question mark, as Japanese text does.
const QUESTIONS_JAPANESE: Array<[string, string]> = [
  [
    "Are you sure you want to delete this item?",
    "この項目を削除してもよろしいですか？",
  ],
  [
    "You have unsaved changes. Are you sure you want to cancel?",
    "保存されていない変更があります。本当にキャンセルしますか？",
  ],
];

/*
 * What the older file said for some of those strings. None of them may
 * come back.
 */
const RETIRED_JAPANESE: Array<string> = [
  "アラート エピソード 内部 ノート",
  "インシデント エピソード 状態 タイムライン",
  "予定された メンテナンス テンプレート チーム オーナー",
  "オンコール スケジュール レイヤー ユーザー",
  "ステータスページ 履歴 チャート バー 色",
  "ログ ドロップ フィルター",
  "テレメトリ 取り込み Key",
  "ワークスペース ユーザー Auth トークン",
  "この項目を削除してもよろしいですか?",
];

// A half-width ? or ! right after hiragana, katakana or a kanji.
const HALF_WIDTH_PUNCTUATION_AFTER_JAPANESE: RegExp = /[ぁ-ゖァ-ヺー一-鿿][?!]/;

type LocaleFile = Record<string, unknown>;

/*
 * A key as the locale files hold it: flat when the file has it flat, and
 * otherwise as a path through the nested objects.
 */
const readKey: (locale: LocaleFile, key: string) => unknown = (
  locale: LocaleFile,
  key: string,
): unknown => {
  if (key in locale) {
    return locale[key];
  }

  let node: unknown = locale;

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[part];
  }

  return node;
};

// Every string value in a locale file, nested ones included.
const allValues: (node: unknown) => Array<string> = (
  node: unknown,
): Array<string> => {
  if (typeof node === "string") {
    return [node];
  }

  if (typeof node !== "object" || node === null) {
    return [];
  }

  return Object.values(node as Record<string, unknown>).flatMap(allValues);
};

const withJapanese: (children: ReactElement) => ReactElement = (
  children: ReactElement,
): ReactElement => {
  return <I18nextProvider i18n={japanese}>{children}</I18nextProvider>;
};

// The lookup useTranslateValue() gives the shared components.
const japaneseTranslator: () => Translator = (): Translator => {
  return createTranslator((text: string): string | undefined => {
    const translated: unknown = japanese.t(text, {
      defaultValue: text,
      keySeparator: false,
      nsSeparator: false,
    });

    return typeof translated === "string" ? translated : text;
  }, "ja");
};

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};

  // The Dashboard's own configuration (Utils/i18n.ts): default separators.
  await japanese.init({
    lng: "ja",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      ja: { translation: japaneseLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/home`);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

afterAll(() => {
  setViewportWidth(ORIGINAL_WIDTH);
});

describe("the products menu in Japanese", () => {
  test("names and describes the products in Japanese", () => {
    render(withJapanese(<DashboardNavbar show={true} />));

    expect(screen.queryByRole("button", { name: "Products" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "製品" }));

    const menu: HTMLElement = screen.getByRole("dialog");

    /*
     * The menu opens on Essentials and folds the other sections to one line
     * each. These products sit in two of them, named in Japanese as well:
     * open those the way a user would.
     */
    for (const section of ["オブザーバビリティ", "インフラストラクチャ"]) {
      const toggle: HTMLElement = within(menu).getByRole("button", {
        name: section,
      });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(toggle);
    }
    expect(
      within(menu).queryByRole("button", { name: "Observability" }),
    ).toBeNull();
    expect(
      within(menu).queryByRole("button", { name: "Infrastructure" }),
    ).toBeNull();

    for (const [, value] of PRODUCTS_MENU_JAPANESE) {
      expect(within(menu).getAllByText(value).length).toBeGreaterThan(0);
    }

    expect(within(menu).queryByText("Security Events")).toBeNull();
    expect(
      within(menu).queryByText(
        "SIEM signals correlated with your observability data.",
      ),
    ).toBeNull();
    expect(
      within(menu).queryByText(
        "Monitor network devices via SNMP and group them into sites.",
      ),
    ).toBeNull();
    expect(within(menu).queryByText("Search and analyze logs.")).toBeNull();
  });
});

describe("the keyboard shortcuts dialog in Japanese", () => {
  test("titles, groups and shortcuts read in Japanese", () => {
    render(withJapanese(<DashboardKeyboardShortcuts />));

    act(() => {
      GlobalEvents.dispatchEvent(EventName.KEYBOARD_SHORTCUTS_TOGGLE);
    });

    const dialog: HTMLElement = screen.getByRole("dialog");

    for (const [, value] of SHORTCUTS_JAPANESE) {
      expect(within(dialog).getByText(value)).toBeInTheDocument();
    }

    expect(within(dialog).queryByText("Keyboard shortcuts")).toBeNull();
    expect(within(dialog).queryByText("Open the command palette")).toBeNull();
    expect(within(dialog).queryByText("Go to")).toBeNull();
  });
});

describe("a Dashboard card in Japanese", () => {
  test("the manual monitor card's title and description are Japanese", () => {
    goTo(`/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID.toString()}`);

    render(withJapanese(<MonitorManualGuideCard monitorId={MONITOR_ID} />));

    for (const [, value] of CARD_JAPANESE) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }

    expect(screen.queryByText("Manual monitor")).toBeNull();
    expect(
      screen.queryByText("Status is set by people, not by checks."),
    ).toBeNull();
  });
});

describe("model names read as Japanese compounds", () => {
  test.each(MODEL_NAMES_JAPANESE)("%s", (english: string, value: string) => {
    expect(japanese.t(english)).toBe(value);
  });

  test("no retired word-for-word chain is left in ja.json", () => {
    const values: Set<string> = new Set<string>(allValues(japaneseLocale));

    expect(
      RETIRED_JAPANESE.filter((retired: string): boolean => {
        return values.has(retired);
      }),
    ).toEqual([]);
  });

  test("a model name goes into a sentence where Japanese puts it", () => {
    const translator: Translator = japaneseTranslator();

    expect(
      translator.translateTemplate("Delete {{itemName}}", {
        itemName: translatableTerm("Monitor", { inSentence: true }),
      }),
    ).toBe("モニターを削除");
  });
});

describe("counts in Japanese", () => {
  test("a count of 1 reads the general sentence, not the English one", () => {
    const translator: Translator = japaneseTranslator();

    expect(
      translator.translatePlural(
        { one: "{{count}} minute", other: "{{count}} minutes" },
        1,
      ),
    ).toBe("1 分");
    expect(
      translator.translatePlural(
        { one: "{{count}} minute", other: "{{count}} minutes" },
        1500,
      ),
    ).toBe("1,500 分");
  });
});

describe("Japanese punctuation", () => {
  test.each(QUESTIONS_JAPANESE)("%s", (english: string, value: string) => {
    expect(japanese.t(english)).toBe(value);
  });

  test("interpolated confirmations end in a full-width question mark", () => {
    expect(
      japanese.t("Are you sure you want to delete this {{itemName}}?", {
        itemName: "モニター",
      }),
    ).toBe("このモニターを削除してもよろしいですか？");
  });

  test("no value in ja.json puts a half-width ? or ! after Japanese text", () => {
    expect(
      allValues(japaneseLocale).filter((value: string): boolean => {
        return HALF_WIDTH_PUNCTUATION_AFTER_JAPANESE.test(value);
      }),
    ).toEqual([]);
  });
});

describe("the Japanese above is the Japanese ja.json ships", () => {
  const all: Array<[string, string]> = [
    ...PRODUCTS_MENU_JAPANESE,
    ...MENU_JAPANESE,
    ...SHORTCUTS_JAPANESE,
    ...CARD_JAPANESE,
    ...MODEL_NAMES_JAPANESE,
    ...QUESTIONS_JAPANESE,
  ];

  test.each(all)("%s", (key: string, value: string) => {
    const shipped: unknown = readKey(japaneseLocale as LocaleFile, key);
    const english: unknown = readKey(englishLocale as LocaleFile, key);

    expect(typeof english).toBe("string");
    expect(shipped).toBe(value);
    expect(shipped).not.toBe(english);
  });
});
