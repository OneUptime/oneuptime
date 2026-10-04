import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * How a runbook's steps are put in order, as the Steps editor does it: each
 * step's header has a grip, its own control beside the step's open/close
 * button ("Drag to reorder step"), dragged with a pointer or moved from the
 * keyboard (focus it, Space, the arrow keys, Space). The authoring page said
 * to use "the up/down arrows on the Steps editor", which the editor has never
 * had, in all seventeen languages.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const STEPS_EDITOR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Pages/Runbook/View/Steps.tsx",
);

const AUTHORING_PAGE: string = "runbooks/authoring.md";

// The sentence each language had: reorder with up/down arrows.
const OLD_SENTENCES: Record<string, string> = {
  en: "Reorder them with the up/down arrows on the Steps editor.",
  de: "Sortieren Sie sie mit den Pfeilen Auf/Ab im Steps-Editor um.",
  fr: "Réorganisez-les avec les flèches haut/bas dans l'éditeur.",
  es: "Reordénalos con las flechas arriba/abajo del editor de Pasos.",
  it: "Riordinali con le frecce su/giù nell'editor dei Passi.",
  pt: "Reordene com as setas para cima/baixo no editor de Passos.",
  nl: "Herorden ze met de pijltjes omhoog/omlaag in de Steps-editor.",
  da: "Omarranger dem med op/ned-pilene i trin-editoren.",
  no: "Omorganiser med pilene opp/ned i trinn-editoren.",
  sv: "Omordna dem med upp/ned-pilarna i Steg-editorn.",
  ru: "Меняйте порядок стрелками вверх/вниз в редакторе шагов.",
  ja: "ステップエディタの上下矢印で並び替えできます。",
  ko: "단계 편집기의 위/아래 화살표로 순서를 바꿀 수 있습니다.",
  "zh-CN": "可在步骤编辑器上用上下箭头调整顺序。",
  "zh-TW": "使用 Steps 編輯器上的上/下箭頭來重新排序。",
  hi: "Steps एडिटर में ऊपर/नीचे तीरों से क्रम बदलें।",
  fa: "با پیکان‌های بالا/پایین در ویرایشگر Steps ترتیبشان را تغییر دهید.",
};

// The key each language names for picking a step up and putting it down.
const SPACE_KEY: Record<string, string> = {
  en: "Space",
  de: "Leertaste",
  fr: "Espace",
  es: "Espacio",
  it: "Spazio",
  pt: "Espaço",
  nl: "Spatie",
  da: "mellemrum",
  no: "mellomrom",
  sv: "blanksteg",
  ru: "пробел",
  ja: "Space",
  ko: "Space",
  "zh-CN": "空格键",
  "zh-TW": "空白鍵",
  hi: "Space",
  fa: "Space",
};

function readPage(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, AUTHORING_PAGE),
    "utf8",
  );
}

describe("reordering a runbook's steps, in the docs", () => {
  test("the Steps editor reorders by a grip on each step, not by arrow buttons", () => {
    const source: string = fs.readFileSync(STEPS_EDITOR, "utf8");

    expect(source).toContain("dragHandleProps");
    expect(source).toContain('"Drag to reorder step"');
    expect(source).not.toMatch(/Move (up|down)/i);
  });

  test("every language is checked", () => {
    expect(Object.keys(OLD_SENTENCES).sort()).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );
    expect(Object.keys(SPACE_KEY).sort()).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );
  });

  test("the English page says to drag a step by its grip, or move it from the keyboard", () => {
    expect(readPage("en")).toContain(
      "To change the order, drag a step by the grip at the left of its header; from the keyboard, focus the grip, press Space, move the step with the arrow keys and press Space again.",
    );
  });

  test.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
    "%s no longer sends the reader to up/down arrows, and names the key",
    (language: string) => {
      const page: string = readPage(language);

      expect(page).not.toContain(OLD_SENTENCES[language]!);
      expect(page).toContain(SPACE_KEY[language]!);
    },
  );
});
