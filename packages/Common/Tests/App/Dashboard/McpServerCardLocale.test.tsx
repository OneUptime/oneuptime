import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import McpServerCard from "../../../../App/FeatureSet/Dashboard/src/Components/Mcp/McpServerCard";
import Route from "../../../Types/API/Route";

/*
 * Project Settings > AI > MCP Server's card in the reader's language, from
 * the Dashboard's own locale files: the choice, its notes and each setup's
 * sentence read in that language with their files and commands in place,
 * while the clients' tabs keep their products' names - Japanese has
 * "Cursor" as the word for a text cursor (a column title elsewhere).
 */

const MCP_URL: string = "https://oneuptime.example.com/mcp";

const LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

function locale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

async function instanceFor(code: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: code,
    fallbackLng: code,
    resources: { [code]: { translation: locale(code) } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  return instance;
}

async function renderIn(code: string): Promise<void> {
  render(
    <I18nextProvider i18n={await instanceFor(code)}>
      <McpServerCard
        mcpUrl={MCP_URL}
        apiKeysRoute={Route.fromString("/dashboard/project/settings/api-keys")}
      />
    </I18nextProvider>,
  );
}

function tabNames(): Array<string> {
  return within(screen.getByTestId("mcp-server-connect"))
    .getAllByRole("tab")
    .map((tab: HTMLElement): string => {
      return tab.textContent || "";
    });
}

afterEach(() => {
  cleanup();
});

describe("the MCP Server card in the reader's language", () => {
  test.each(["ja", "de", "zh-CN", "fa"])(
    "%s: the clients' tabs keep their products' names",
    async (code: string) => {
      await renderIn(code);

      expect(tabNames()).toEqual([
        "Claude Code",
        "Claude Desktop",
        "VS Code",
        "Cursor",
      ]);
    },
  );

  test("Japanese: the choice and its answers read in Japanese", async () => {
    const ja: Record<string, string> = locale("ja");

    await renderIn("ja");

    expect(screen.getByTestId("mcp-sign-in")).toHaveAccessibleName(
      ja["Sign in with"] as string,
    );
    expect(
      within(screen.getByTestId("mcp-sign-in")).getByLabelText(
        ja["API key"] as string,
      ),
    ).toHaveAccessibleDescription(
      ja[
        "For an agent that runs unattended, such as a scheduled job. It acts with the key's permissions, in the key's project."
      ] as string,
    );
    expect(screen.getByTestId("mcp-sign-in-note")).toHaveTextContent(
      "接続済みの MCP クライアント",
    );
  });

  test("German: a setup's sentence is German, with its file in place as code", async () => {
    await renderIn("de");

    fireEvent.click(screen.getByRole("tab", { name: "VS Code" }));

    const sentence: HTMLElement = screen
      .getByRole("tabpanel")
      .querySelector("p") as HTMLElement;

    expect(sentence).toHaveTextContent(
      "Fügen Sie dies zu .vscode/mcp.json hinzu. Wenn Sie den Server starten, öffnet VS Code OneUptime, damit Sie sich anmelden:",
    );
    expect(within(sentence).getByText(".vscode/mcp.json").tagName).toBe("CODE");
  });

  test("German: the API key's note links to the API keys inside the German sentence", async () => {
    await renderIn("de");

    fireEvent.click(
      within(screen.getByTestId("mcp-sign-in")).getByLabelText("API-Schlüssel"),
    );

    const note: HTMLElement = screen.getByTestId("mcp-sign-in-note");

    expect(note).toHaveTextContent(
      "Erstellen Sie unter Projekteinstellungen → Erweitert → API-Schlüssel einen Schlüssel",
    );
    expect(within(note).getByRole("link")).toHaveTextContent(
      "Projekteinstellungen → Erweitert → API-Schlüssel",
    );
  });
});
