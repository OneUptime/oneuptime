import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import LlmObservabilityConnection from "../../../Models/DatabaseModels/LlmObservabilityConnection";
import { LlmConnectionKind } from "../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import { LLM_CONNECTION_ACTIVE_MEMBERS } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionHealth";
import LlmConnectionLastRead from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionLastRead";
import LlmConnectionTiles from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionTiles";
import LlmOtherAiTools from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmOtherAiTools";
import {
  LANGUAGES,
  createLanguageInstances,
  inLanguage,
  textOf,
  translatorFor,
} from "./TracesLanguageHarness";

/*
 * ---------------------------------------------------------------------------
 * Cursor's connection, in every Dashboard language (#5547)
 * ---------------------------------------------------------------------------
 *
 * Two things the English pages could not show:
 *
 *   - Cursor is a product's name. Eleven locales had the key "Cursor" as a
 *     text cursor's word ("カーソル", "Markør", "مکان‌نما"), so the tile,
 *     the form's title and the company AI tools' entry named another thing.
 *   - A big team's line, "1,031 of 1,248 members active": the count is
 *     written the reader's way by translatePlural, and the active members
 *     beside it were a bare number - "1031 of 1,248", "1031 von 1.248".
 *
 * Each is drawn in the real components, under each language's own i18next
 * instance, as the Dashboard draws them.
 */

beforeAll(async () => {
  await createLanguageInstances();
});

afterEach(() => {
  cleanup();
});

describe("Cursor's name", () => {
  test.each(LANGUAGES)("%s calls Cursor by its name", (language: string) => {
    const translator: Translator = translatorFor(language);

    expect(translator.translateText("Cursor")).toBe("Cursor");
    // The form's title, as LlmConnectionFormModal fills it.
    expect(
      translator.translateTemplate("Connect {{provider}}", {
        provider: translator.translateText("Cursor") || "Cursor",
      }),
    ).toContain("Cursor");

    render(
      inLanguage(
        language,
        <LlmConnectionTiles
          kind={LlmConnectionKind.ProviderAccount}
          connectionCounts={{}}
          canConnect={true}
          onConnect={(): void => {}}
        />,
      ),
    );

    const tile: HTMLElement = screen.getByTestId(
      `llm-connection-tile-${LlmConnectionProvider.Cursor}`,
    );

    expect(within(tile).getByText("Cursor", { exact: true })).toBeVisible();

    cleanup();

    render(
      inLanguage(
        language,
        <LlmOtherAiTools onConnect={(): void => {}} canConnect={true} />,
      ),
    );

    const entry: HTMLElement = screen.getByTestId("llm-other-ai-tool-cursor");

    expect(textOf(entry.firstElementChild)).toBe("Cursor");
    expect(
      textOf(within(entry).getByTestId("llm-other-ai-tool-connect-cursor")),
    ).toContain("Cursor");
  });
});

describe("a big team's members", () => {
  const team: LlmObservabilityConnection = new LlmObservabilityConnection();
  team.provider = LlmConnectionProvider.Cursor;
  team.isEnabled = true;
  team.lastPulledAt = new Date("2026-11-09T06:00:00.000Z");
  team.lastSuccessfulPullAt = new Date("2026-11-09T06:00:00.000Z");
  team.lastPullResult = {
    status: "success",
    kind: "usage",
    days: 7,
    costUsd: 18204.5,
    members: 1248,
    activeMembers: 1031,
  };

  test.each(LANGUAGES)(
    "%s writes both numbers of the line its own way",
    (language: string) => {
      const translator: Translator = translatorFor(language);

      render(inLanguage(language, <LlmConnectionLastRead connection={team} />));

      // As drawn: French groups digits with a narrow no-break space.
      const line: string =
        screen.getByTestId("llm-connection-people-summary").textContent || "";

      expect(line).toBe(
        translator.translatePlural(LLM_CONNECTION_ACTIVE_MEMBERS, 1248, {
          active: translator.formatNumber(1031),
        }),
      );
      expect(line).toContain(translator.formatNumber(1031));
      expect(line).toContain(translator.formatNumber(1248));
    },
  );

  test("in English, German and Persian, as a reader reads them", () => {
    const lines: Record<string, string> = {};

    for (const language of ["en", "de", "fa"]) {
      render(inLanguage(language, <LlmConnectionLastRead connection={team} />));
      lines[language] =
        screen.getByTestId("llm-connection-people-summary").textContent || "";
      cleanup();
    }

    expect(lines["en"]).toBe(
      "1,031 of 1,248 members active in the last 7 days",
    );
    expect(lines["de"]).toBe(
      "1.031 von 1.248 Mitgliedern in den letzten 7 Tagen aktiv",
    );
    // Persian digits for both, never "1031" beside "۱٬۲۴۸".
    expect(lines["fa"]).toContain("۱٬۰۳۱");
    expect(lines["fa"]).toContain("۱٬۲۴۸");
    expect(lines["fa"]).not.toMatch(/[0-9]/);
  });
});
