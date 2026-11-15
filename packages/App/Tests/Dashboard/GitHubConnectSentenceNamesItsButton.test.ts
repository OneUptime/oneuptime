import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  dashboardTranslator,
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import {
  ConnectCallbackError,
  ConnectProvider,
} from "Common/Types/Workspace/ConnectCallback";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  CONNECT_GITHUB_BUTTON,
  ConnectCallbackNoticeText,
  getConnectCallbackMessageKey,
  getConnectCallbackMessageValues,
  getConnectCallbackNotice,
} from "../../FeatureSet/Dashboard/src/Utils/Workspace/ConnectCallbackMessage";

/*
 * THE GITHUB CONNECT ERROR NAMES THE BUTTON CODE DRAWS (#8336).
 *
 * When GitHub sends the browser back to Code because the account signed in
 * manages no installation of the app, Code says so and sends the reader to
 * the button that installs it. The sentence said "Please install it with
 * Connect with GitHub App", a button Code no longer draws: its card says
 * Connect GitHub (Components/Code/GitHubConnect.tsx). Sixteen languages
 * named the old label too, and Persian alone quoted the one on the page.
 *
 * The sentence now takes the button's own words ({{connectGitHub}}), looked
 * up in the reader's language as the card draws them, so the two cannot
 * name different buttons again. Its first sentence, which the GitHub guide
 * quotes in every language, is as it was.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

const GITHUB_CONNECT_CARD: string = path.join(
  DASHBOARD_SOURCE,
  "Components/Code/GitHubConnect.tsx",
);

const OLD_LABEL: string = "Connect with GitHub App";

const OLD_KEY: string =
  "Your GitHub account does not manage an installation of the app yet. Please install it with Connect with GitHub App.";

const KEY: string = getConnectCallbackMessageKey(
  ConnectProvider.GitHub,
  ConnectCallbackError.GitHubNoInstallationToConnect,
);

const EVERY_LANGUAGE: ReadonlyArray<string> = ["en", ...DASHBOARD_LANGUAGES];

// A TypeScript source file of the Dashboard.
const SOURCE_FILE: RegExp = /\.tsx?$/;

function noticeIn(language: string): ConnectCallbackNoticeText {
  return getConnectCallbackNotice({
    provider: ConnectProvider.GitHub,
    error: ConnectCallbackError.GitHubNoInstallationToConnect,
    translator: dashboardTranslator(language),
  })!;
}

// Every file under a folder, its path from the folder.
function sourceFiles(
  directory: string,
  into: Array<string> = [],
): Array<string> {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "Locales") {
        sourceFiles(full, into);
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      into.push(full);
    }
  }

  return into;
}

describe("the button the sentence names", () => {
  test("is the one Code's GitHub card draws", () => {
    const card: string = fs.readFileSync(GITHUB_CONNECT_CARD, "utf8");

    expect(CONNECT_GITHUB_BUTTON).toBe("Connect GitHub");
    expect(card).toContain('id="connect-github-app"');
    expect(card).toContain(
      `translator.translateText("${CONNECT_GITHUB_BUTTON}")`,
    );
  });

  test("is no longer called Connect with GitHub App anywhere in the Dashboard", () => {
    const naming: Array<string> = sourceFiles(DASHBOARD_SOURCE).filter(
      (file: string): boolean => {
        return fs.readFileSync(file, "utf8").includes(`"${OLD_LABEL}"`);
      },
    );

    expect(naming).toEqual([]);
  });

  test("fills the sentence's slot in the reader's language", () => {
    expect(getConnectCallbackMessageValues(dashboardTranslator("en"))).toEqual({
      connectGitHub: "Connect GitHub",
    });
    expect(getConnectCallbackMessageValues(dashboardTranslator("de"))).toEqual({
      connectGitHub: readDashboardLocale("de")[CONNECT_GITHUB_BUTTON],
    });
  });

  test("reads as the English label where a language has no word for it", () => {
    const blank: Translator = {
      ...dashboardTranslator("en"),
      translateText: (): string | undefined => {
        return undefined;
      },
    };

    expect(getConnectCallbackMessageValues(blank)).toEqual({
      connectGitHub: CONNECT_GITHUB_BUTTON,
    });
  });
});

describe("the sentence for an account that manages no installation", () => {
  test("takes the button's words in a slot, and keeps the first sentence the guide quotes", () => {
    expect(KEY).toBe(
      "Your GitHub account does not manage an installation of the app yet. Please install it with {{connectGitHub}}.",
    );
    expect(placeholdersOf(KEY)).toEqual(["{{connectGitHub}}"]);
    expect(KEY.split(". ")[0]).toBe(OLD_KEY.split(". ")[0]);
  });

  test("reads in English as the button is labelled", () => {
    expect(noticeIn("en")).toEqual({
      code: ConnectCallbackError.GitHubNoInstallationToConnect,
      title: "GitHub was not connected",
      message:
        "Your GitHub account does not manage an installation of the app yet. Please install it with Connect GitHub.",
    });
  });

  test.each(DASHBOARD_LANGUAGES)(
    "is worded in %s, with the slot once and the old label gone",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(isWordedInDashboardLocale(KEY, language)).toBe(true);
      expect(placeholdersOf(words[KEY]!)).toEqual(["{{connectGitHub}}"]);
      expect(words[KEY]!.split("{{connectGitHub}}")).toHaveLength(2);
      expect(words[OLD_KEY]).toBeUndefined();
    },
  );

  test.each(EVERY_LANGUAGE)(
    "names in %s the button the card draws there, and no other",
    (language: string) => {
      const button: string = dashboardTranslator(language).translateText(
        CONNECT_GITHUB_BUTTON,
      )!;
      const message: string = noticeIn(language).message;
      const oldLabel: string | undefined =
        readDashboardLocale(language)[OLD_LABEL];

      expect(message).toContain(button);
      expect(message).not.toContain("{{");
      expect(message).not.toContain(OLD_LABEL);

      if (oldLabel && oldLabel !== button) {
        expect(message).not.toContain(oldLabel);
      }
    },
  );

  /*
   * The guide quotes the first sentence of each answer as the language's
   * Dashboard words it (InstallIntegrationsDocsTranslations): it stays as
   * it was, and only the button's name changed.
   */
  test.each(DASHBOARD_LANGUAGES)(
    "keeps %s's first sentence, which the GitHub guide quotes",
    (language: string) => {
      const docs: string = path.resolve(
        __dirname,
        `../../FeatureSet/Docs/Content/${language}/self-hosted/github-integration.md`,
      );
      const message: string = noticeIn(language).message;
      const firstSentence: string = message.slice(
        0,
        message.search(/[.。।]\s*/) + 1,
      );

      expect(firstSentence.length).toBeGreaterThan(10);

      if (fs.existsSync(docs)) {
        expect(fs.readFileSync(docs, "utf8")).toContain(firstSentence);
      }
    },
  );

  test.each([
    [
      "de",
      "Ihr GitHub-Konto verwaltet noch keine Installation der App. Installieren Sie sie bitte über „GitHub verbinden“.",
    ],
    [
      "fa",
      "حساب GitHub شما هنوز هیچ نصبی از برنامه را مدیریت نمی‌کند. لطفاً آن را با «اتصال GitHub» نصب کنید.",
    ],
    [
      "ar",
      "لا يدير حساب GitHub الخاص بك تثبيتًا للتطبيق بعد. يُرجى تثبيته عبر «ربط GitHub».",
    ],
    [
      "ja",
      "お使いの GitHub アカウントは、まだアプリのインストールを管理していません。「GitHub を接続」からインストールしてください。",
    ],
    [
      "zh-CN",
      "您的 GitHub 账号尚未管理该应用的任何安装。请通过“连接 GitHub”安装。",
    ],
    [
      "ko",
      "회원님의 GitHub 계정은 아직 앱 설치를 관리하지 않습니다. 'GitHub 연결' 버튼으로 설치하세요.",
    ],
  ])("reads in %s as %p", (language: string, sentence: string) => {
    expect(noticeIn(language).message).toBe(sentence);
  });

  test("leaves every other answer's sentence without a slot to fill", () => {
    for (const provider of Object.values(ConnectProvider)) {
      for (const code of Object.values(ConnectCallbackError)) {
        const message: string = getConnectCallbackNotice({
          provider: provider,
          error: code,
          translator: dashboardTranslator("en"),
        })!.message;

        expect([provider, code, message.includes("{{")]).toEqual([
          provider,
          code,
          false,
        ]);
      }
    }
  });
});
