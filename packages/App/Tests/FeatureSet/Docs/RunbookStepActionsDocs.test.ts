import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import {
  APPROVE_AND_CONTINUE_BUTTON,
  APPROVE_AND_RUN_BUTTON,
  MARK_COMPLETE_BUTTON,
  getWaitingStepButtonTitle,
} from "../../../FeatureSet/Dashboard/src/Components/Runbook/RunbookExecutionWaitCopy";
import {
  REQUIRE_APPROVAL_FOLDED_TITLE,
  REQUIRE_APPROVAL_TITLE,
} from "../../../FeatureSet/Dashboard/src/Components/Runbook/Steps/RunbookStepEditorModel";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { RunbookStepWait } from "Common/Types/Runbook/RunbookStepApproval";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What a person can do to a step of a runbook run, as the execution page
 * offers it. Only the step the run is waiting on takes a decision: Mark
 * complete on a Manual step, Approve and run on a step with Require
 * approval (which waits before it runs), and Skip. A run started before
 * approvals moved to the step they guard waits after such a step instead,
 * and Approve & continue lets it go on. While the run is paused, a later
 * automated step that doesn't require approval can be skipped too. The
 * running page once said only that Manual steps in WaitingForUser had Mark
 * Complete and Skip buttons, in all seventeen languages. Each language
 * names the buttons in its own Dashboard words, the ones the execution page
 * shows its reader (RunbookExecutionWaitCopy), and the switch as the step
 * editor draws it (RunbookStepEditorModel).
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD_PAGES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Pages/Runbook/View",
);

const RUNNING_PAGE: string = "runbooks/running.md";

const AUTHORING_PAGE: string = "runbooks/authoring.md";

const NEW_SECTION: string = "## Completing, approving and skipping steps";

// The buttons of the step a run waits on, by their English labels.
const SKIP_BUTTON: string = "Skip";
const EXECUTION_VIEW_BUTTONS: Array<string> = [
  MARK_COMPLETE_BUTTON,
  APPROVE_AND_RUN_BUTTON,
  SKIP_BUTTON,
];

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

// The bullet English had while the switch held back the step after it.
const OLD_ENGLISH_BUTTONS_BULLET: string =
  "- On the step the run is waiting on: **Mark complete** (a Manual step) or **Approve & continue** (a step with **Require approval**), and **Skip**.";

function readPage(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

function readDashboardPage(file: string): string {
  return fs.readFileSync(path.join(DASHBOARD_PAGES_DIR, file), "utf8");
}

// A page's sections, each starting at its "## " heading.
function sections(page: string): Array<string> {
  return page.split(/^(?=## )/m);
}

describe("completing, approving and skipping a runbook run's steps, in the docs", () => {
  test("the execution page draws the waiting step's button from the copy module, and Skip beside it", () => {
    const executionView: string = readDashboardPage("ExecutionView.tsx");

    expect(executionView).toContain(
      "getWaitingStepButtonTitle(wait || RunbookStepWait.Manual)",
    );
    expect(executionView).toContain(`title="${SKIP_BUTTON}"`);

    expect(getWaitingStepButtonTitle(RunbookStepWait.Manual)).toBe(
      "Mark complete",
    );
    expect(getWaitingStepButtonTitle(RunbookStepWait.ApprovalToRun)).toBe(
      "Approve and run",
    );
    expect(getWaitingStepButtonTitle(RunbookStepWait.ApprovalToContinue)).toBe(
      "Approve & continue",
    );
  });

  test("every language is checked", () => {
    expect(Object.keys(OLD_BULLETS).sort()).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );
  });

  test("the steps editor's switch is the one the pages name", () => {
    expect(readDashboardPage("Steps.tsx")).toContain(
      "title={REQUIRE_APPROVAL_TITLE}",
    );
    expect(REQUIRE_APPROVAL_TITLE).toBe(
      "Require approval before running this step",
    );
    expect(REQUIRE_APPROVAL_FOLDED_TITLE).toBe("Require approval");
  });

  test.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
    "%s names Require approval as its Dashboard folds it, in words its switch label uses",
    (language: string) => {
      const folded: string = drawnDashboardLabel(
        language,
        REQUIRE_APPROVAL_FOLDED_TITLE,
      );
      const switchLabel: string = drawnDashboardLabel(
        language,
        REQUIRE_APPROVAL_TITLE,
      );

      expect({ language, inLabel: true }).toEqual({
        language,
        inLabel: switchLabel.includes(folded),
      });
      expect(readPage(language, AUTHORING_PAGE)).toContain(`**${folded}**`);
      expect(readPage(language, AUTHORING_PAGE)).toContain(
        `**${switchLabel}**`,
      );
    },
  );

  test("the English page says only the step the run is waiting on takes a decision, and that an approval comes before the step runs", () => {
    const page: string = readPage(DEFAULT_DOCS_LANGUAGE, RUNNING_PAGE);

    expect(page).toContain(
      "- On the step the run is waiting on: **Mark complete** (a Manual step) or **Approve and run** (a step with **Require approval**, which has not run yet), and **Skip**.",
    );
    expect(page).not.toContain(OLD_ENGLISH_BUTTONS_BULLET);
    expect(page).toContain(`${NEW_SECTION}\n`);
    expect(page).toContain(
      "Only the step the run is waiting on can be marked complete, approved, or skipped to continue the run.",
    );
    expect(page).toContain(
      "A step with **Require approval** waits before it runs, so read what the steps before it found first: **Approve and run** runs it, **Skip** keeps it from running, and either way the run goes on.",
    );
    expect(page).toContain(
      "A run started before approvals moved to the step they guard waits after such a step instead, once it has run: **Approve & continue** lets that run go on.",
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

      for (const button of EXECUTION_VIEW_BUTTONS) {
        expect({ button, named: true }).toEqual({
          button,
          named: executionView.includes(
            `**${drawnDashboardLabel(language, button)}**`,
          ),
        });
      }

      const skip: string = `**${drawnDashboardLabel(language, SKIP_BUTTON)}**`;

      // Skip is offered twice: on the step the run waits on, and on later automated steps.
      expect(executionView.split(skip)).toHaveLength(3);

      // The section says what approving runs, and what goes on in a run started before.
      for (const button of [
        APPROVE_AND_RUN_BUTTON,
        APPROVE_AND_CONTINUE_BUTTON,
        SKIP_BUTTON,
      ]) {
        expect({ button, named: true }).toEqual({
          button,
          named: newSection.includes(
            `**${drawnDashboardLabel(language, button)}**`,
          ),
        });
      }

      expect(newSection).toContain(
        `**${drawnDashboardLabel(language, REQUIRE_APPROVAL_FOLDED_TITLE)}**`,
      );
    },
  );
});
