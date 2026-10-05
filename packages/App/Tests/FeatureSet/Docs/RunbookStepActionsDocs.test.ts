import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What a person can do to a step of a runbook run, as the execution page
 * offers it. Only the step the run is waiting on takes a decision: Mark
 * complete on a Manual step, Approve & continue on a step with Require
 * approval, and Skip. While the run is paused, a later automated step that
 * doesn't require approval can be skipped too. The running page said only
 * that Manual steps in WaitingForUser had Mark Complete and Skip buttons, in
 * all seventeen languages. Each language names the buttons in its own
 * Dashboard words, the ones the execution page shows its reader.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const EXECUTION_VIEW: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView.tsx",
);

const RUNNING_PAGE: string = "runbooks/running.md";

const AUTHORING_PAGE: string = "runbooks/authoring.md";

const NEW_SECTION: string = "## Completing, approving and skipping steps";

// The execution page's buttons, by their English labels.
const BUTTONS: Array<string> = ["Mark complete", "Approve & continue", "Skip"];

// The Persian pages name the Dashboard's labels in English.
const ENGLISH_UI_LABELS: Set<string> = new Set(["en", "fa"]);

// The bullet each language had: Mark Complete and Skip, on Manual steps in WaitingForUser.
const OLD_BULLETS: Record<string, string> = {
  en: "- For Manual steps in `WaitingForUser`: **Mark Complete** and **Skip** buttons.",
  de: "- Für manuelle Schritte in `WaitingForUser`: **Als erledigt markieren**- und **Überspringen**-Buttons.",
  fr: "- Pour les étapes manuelles en `WaitingForUser` : boutons **Marquer comme terminé** et **Ignorer**.",
  es: "- En pasos manuales en `WaitingForUser`: botones **Marcar como completado** y **Omitir**.",
  it: "- Per i passi manuali in `WaitingForUser`: pulsanti **Segna come completato** e **Salta**.",
  pt: "- Para passos manuais em `WaitingForUser`: botões **Marcar como concluído** e **Pular**.",
  nl: "- Voor handmatige stappen in `WaitingForUser`: **Markeer als voltooid**- en **Overslaan**-knoppen.",
  da: "- For manuelle trin i `WaitingForUser`: knapperne **Marker som færdig** og **Spring over**.",
  no: "- For manuelle trinn i `WaitingForUser`: knappene **Marker som ferdig** og **Hopp over**.",
  sv: "- För manuella steg i `WaitingForUser`: **Markera som klar**- och **Hoppa över**-knappar.",
  ru: "- Для ручных шагов в `WaitingForUser`: кнопки **Отметить готовым** и **Пропустить**.",
  ja: "- `WaitingForUser` の Manual ステップでは **完了マーク** と **スキップ** のボタン。",
  ko: "- `WaitingForUser` 상태의 Manual 단계에서는 **완료 표시**와 **건너뛰기** 버튼.",
  "zh-CN":
    "- 对于 `WaitingForUser` 状态的 Manual 步骤：**标记完成** 与 **跳过** 按钮。",
  "zh-TW":
    "- 對於處於 `WaitingForUser` 的手動步驟：**Mark Complete** 與 **略過** 按鈕。",
  hi: "- `WaitingForUser` में Manual चरणों के लिए: **Mark Complete** और **छोड़ें** बटन।",
  fa: "- برای گام‌های دستی در وضعیت `WaitingForUser`: دکمه‌های **Mark Complete** و **Skip**.",
};

// What each language calls a step's Require approval option, as its authoring page does.
const REQUIRE_APPROVAL: Record<string, string> = {
  en: "Require approval",
  de: "Freigabe erforderlich",
  fr: "Exiger une approbation",
  es: "Requiere aprobación",
  it: "Richiede approvazione",
  pt: "Requer aprovação",
  nl: "Goedkeuring vereist",
  da: "Kræv godkendelse",
  no: "Krev godkjenning",
  sv: "Kräver godkännande",
  ru: "Require approval",
  ja: "承認を必須にする",
  ko: "승인 필요",
  "zh-CN": "需要审批",
  "zh-TW": "Require approval",
  hi: "Require approval",
  fa: "Require approval",
};

function readPage(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

// A page's sections, each starting at its "## " heading.
function sections(page: string): Array<string> {
  return page.split(/^(?=## )/m);
}

// The buttons as the reader's Dashboard labels them: English where the locale has no translation.
function dashboardLabels(language: string): Record<string, string> {
  const strings: Record<string, unknown> = ENGLISH_UI_LABELS.has(language)
    ? {}
    : (JSON.parse(
        fs.readFileSync(
          path.join(DASHBOARD_LOCALES_DIR, `${language}.json`),
          "utf8",
        ),
      ) as Record<string, unknown>);
  const labels: Record<string, string> = {};

  for (const button of BUTTONS) {
    const label: unknown = strings[button];

    labels[button] = typeof label === "string" && label ? label : button;
  }

  return labels;
}

describe("completing, approving and skipping a runbook run's steps, in the docs", () => {
  test("the execution page's buttons are Mark complete, Approve & continue and Skip", () => {
    const source: string = fs.readFileSync(EXECUTION_VIEW, "utf8");

    expect(source).toContain('? "Approve & continue"');
    expect(source).toContain(': "Mark complete"');
    expect(source).toContain('title="Skip"');
  });

  test("every language is checked", () => {
    expect(Object.keys(OLD_BULLETS).sort()).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );
    expect(Object.keys(REQUIRE_APPROVAL).sort()).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );
  });

  test("the English page says only the step the run is waiting on takes a decision", () => {
    const page: string = readPage(DEFAULT_DOCS_LANGUAGE, RUNNING_PAGE);

    expect(page).toContain(
      "- On the step the run is waiting on: **Mark complete** (a Manual step) or **Approve & continue** (a step with **Require approval**), and **Skip**.",
    );
    expect(page).toContain(`${NEW_SECTION}\n`);
    expect(page).toContain(
      "Only the step the run is waiting on can be marked complete, approved, or skipped to continue the run.",
    );
  });

  test.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
    "%s has the new bullets and section, names the buttons as its Dashboard does, and drops the old bullet",
    (language: string) => {
      const page: string = readPage(language, RUNNING_PAGE);
      const pageSections: Array<string> = sections(page);
      const englishSections: Array<string> = sections(
        readPage(DEFAULT_DOCS_LANGUAGE, RUNNING_PAGE),
      );
      const index: number = englishSections.findIndex((section: string) => {
        return section.startsWith(`${NEW_SECTION}\n`);
      });

      expect(page).not.toContain(OLD_BULLETS[language]!);

      // The English sections, in the same order: the new one right after the execution view.
      expect(index).toBeGreaterThan(0);
      expect(pageSections).toHaveLength(englishSections.length);

      const executionView: string = pageSections[index - 1]!;
      const newSection: string = pageSections[index]!;
      const labels: Record<string, string> = dashboardLabels(language);

      for (const button of BUTTONS) {
        expect(executionView).toContain(`**${labels[button]!}**`);
      }

      // Skip is offered twice: on the step the run waits on, and on later automated steps.
      expect(executionView.split(`**${labels["Skip"]!}**`)).toHaveLength(3);

      const requireApproval: string = `**${REQUIRE_APPROVAL[language]!}**`;

      expect(newSection).toContain(requireApproval);
      expect(readPage(language, AUTHORING_PAGE)).toContain(requireApproval);
    },
  );
});
