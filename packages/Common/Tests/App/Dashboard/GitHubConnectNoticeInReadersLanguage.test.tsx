import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import { readDashboardLocaleAsDrawn } from "../../Helpers/DashboardLocales";
import {
  ConnectCallbackError,
  ConnectProvider,
} from "../../../Types/Workspace/ConnectCallback";

/*
 * THE GITHUB CONNECT ERROR, DRAWN IN THE READER'S LANGUAGE (#8336).
 *
 * An account that manages no installation of the GitHub App comes back to
 * Code with ?error=github-no-installation-to-connect, and the page's notice
 * sends the reader to the button that installs the app. It named "Connect
 * with GitHub App", which Code no longer draws. The notice now names the
 * button by the words the card draws in the reader's language: drawn here
 * through the real i18next with the Dashboard's locale files, beside a
 * button drawn the way GitHubConnect draws its own.
 */

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getQueryStringByName: (name: string): string | null => {
        return name === "error" ? "github-no-installation-to-connect" : null;
      },
      setQueryString: (): void => {
        // The notice takes the code off the address: nothing to do here.
      },
    },
  };
});

import ConnectCallbackNotice, {
  ConnectCallbackNoticeState,
  useConnectCallbackNotice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/ConnectCallbackNotice";
import { CONNECT_GITHUB_BUTTON } from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectCallbackMessage";
import useTranslator from "../../../UI/Utils/UseTranslator";
import { Translator } from "../../../UI/Utils/TranslateTemplate";

const RENDERED: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

// What Code draws: the notice, and below it the card's Connect GitHub button.
const CodeHarness: () => ReactElement = (): ReactElement => {
  const translator: Translator = useTranslator();
  const state: ConnectCallbackNoticeState = useConnectCallbackNotice({
    provider: ConnectProvider.GitHub,
  });

  return (
    <div>
      <ConnectCallbackNotice state={state} />
      <button type="button" id="connect-github-app">
        {translator.translateText(CONNECT_GITHUB_BUTTON)}
      </button>
    </div>
  );
};

async function drawIn(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
  await act(async () => {
    render(<CodeHarness />);
  });
}

function noticeText(): string {
  return screen.getByTestId("connect-callback-notice").textContent || "";
}

function buttonText(): string {
  return document.getElementById("connect-github-app")?.textContent || "";
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of RENDERED) {
    resources[language] = {
      translation: readDashboardLocaleAsDrawn(language),
    };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("Code's notice for an account that manages no installation", () => {
  test("is the code the GitHub callback answers with", () => {
    expect(ConnectCallbackError.GitHubNoInstallationToConnect).toBe(
      "github-no-installation-to-connect",
    );
  });

  test("names in English the Connect GitHub button below it", async () => {
    await drawIn("en");

    expect(noticeText()).toContain("GitHub was not connected");
    expect(noticeText()).toContain(
      "Your GitHub account does not manage an installation of the app yet. Please install it with Connect GitHub.",
    );
    expect(buttonText()).toBe("Connect GitHub");
    expect(noticeText()).not.toContain("Connect with GitHub App");
  });

  test.each(
    RENDERED.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "names in %s the button as the page draws it there",
    async (language: string) => {
      const words: Record<string, string> =
        readDashboardLocaleAsDrawn(language);

      await drawIn(language);

      expect(buttonText()).toBe(words[CONNECT_GITHUB_BUTTON]);
      expect(buttonText()).not.toBe("Connect GitHub");
      expect(noticeText()).toContain(words["GitHub was not connected"]!);
      expect(noticeText()).toContain(buttonText());
      expect(noticeText()).not.toContain("{{");
      expect(noticeText()).not.toContain("Connect with GitHub App");
      expect(noticeText()).not.toContain(words["Connect with GitHub App"]!);
    },
  );

  test.each([
    ["de", "„GitHub verbinden“"],
    ["ar", "«ربط GitHub»"],
    ["fa", "«اتصال GitHub»"],
  ])(
    "quotes the button in %s in the language's own marks: %s",
    async (language: string, quoted: string) => {
      await drawIn(language);

      expect(noticeText()).toContain(quoted);
    },
  );
});
