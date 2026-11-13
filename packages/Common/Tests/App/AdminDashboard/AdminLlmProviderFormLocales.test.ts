import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import LlmType from "../../../Types/LLM/LlmType";
import {
  LLM_PROVIDER_CARD_OPTIONS,
  getGlobalLlmProviderFormFields,
  getLlmProviderFormSteps,
} from "../../../UI/Components/AI/LlmProviderFormFields";
import {
  LLM_PROVIDER_DEFAULT_VALUE_TEMPLATE,
  LLM_PROVIDER_TYPES,
  LLM_PROVIDER_TYPE_COPY,
  LlmProviderFormCopy,
} from "../../../UI/Components/AI/LlmProviderFormCopy";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import Field from "../../../UI/Components/Forms/Types/Field";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import { MORE_FIELDS_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * The Admin Dashboard's Global LLM Providers draws the same form as a
 * project's LLM Providers (LlmProviderFormFields). The Admin Dashboard looks
 * a Common component's words up in ITS OWN locale files, so a form
 * translated only in the Dashboard's shows English in the Admin Dashboard
 * in every language. Every string this form draws is held here to the
 * Admin Dashboard's locales, worded as the Dashboard words it.
 *
 * So is every string of the Test LLM Provider dialog a provider's row
 * opens - the dialog a project's providers open (TestLlmProviderModal) -
 * of the request and response it folds under its verdict
 * (LlmProviderExchanges, #7355), which was English in the Admin Dashboard
 * in every language (#7545), and of the verdict the dialog gives itself
 * when the server says none (TestLLMProvider). Those strings are read from
 * the dialog's files the way the Dashboard's extraction reads them, so a
 * string the dialog gains fails here until the Admin locales have it.
 */

const FEATURE_SETS: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
);

const LANGUAGES: Array<string> = [...ADMIN_DASHBOARD_LANGUAGES];

function locale(app: string, code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SETS, app, "src", "Locales", `${code}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

// Every text the Global LLM Providers form draws, in English.
function drawnTexts(): Array<string> {
  const texts: Set<string> = new Set<string>();
  const add: (text: unknown) => void = (text: unknown): void => {
    if (typeof text === "string" && text.trim()) {
      texts.add(text);
    }
  };

  for (const step of getLlmProviderFormSteps() as Array<
    FormStep<LlmProvider>
  >) {
    add(step.title);
  }

  for (const field of getGlobalLlmProviderFormFields({
    includeCost: true,
  }) as Array<Field<LlmProvider>>) {
    add(field.title);
    add(field.description);
    add(field.placeholder);
  }

  for (const option of LLM_PROVIDER_CARD_OPTIONS as Array<CardSelectOption>) {
    add(option.title);
    add(option.description);
  }

  for (const type of LLM_PROVIDER_TYPES) {
    add(LLM_PROVIDER_TYPE_COPY[type].apiKeyHint);
    add(LLM_PROVIDER_TYPE_COPY[type].baseUrlHint);
    add(LLM_PROVIDER_TYPE_COPY[type].modelNameHint);
    // The list's Model column, for a blank Model no one model stands for.
    add(LLM_PROVIDER_TYPE_COPY[type].defaultModelLabel);
  }

  add(LlmProviderFormCopy.optionalBaseUrlHint);
  add(LlmProviderFormCopy.baseUrlNoKeys);
  add(MORE_FIELDS_SECTION_TITLE);
  // The list's Model column names a blank Model by the server's default.
  add(LLM_PROVIDER_DEFAULT_VALUE_TEMPLATE);

  return Array.from(texts);
}

describe("the Global LLM Providers form, in the Admin Dashboard's languages", () => {
  const texts: Array<string> = drawnTexts();

  test("draws the provider form's words, cards and help", () => {
    expect(texts).toEqual(
      expect.arrayContaining([
        "Provider",
        "Connection",
        "LLM Provider",
        "Open models you run yourself. No API key.",
        "Never put keys here.",
        "Leave empty for {{model}}.",
        "Leave empty for the first model your server lists. To use another, type its name exactly as your server lists it.",
        "More fields",
        "{{name}} (default)",
        "First model the server lists",
      ]),
    );
  });

  test.each(LANGUAGES)(
    "%s: every one the Dashboard translates, worded as the Dashboard words it",
    (code: string) => {
      const dashboard: Record<string, unknown> = locale("Dashboard", code);
      const admin: Record<string, unknown> = locale("AdminDashboard", code);
      const differing: Array<string> = [];

      for (const text of texts) {
        const wording: unknown = dashboard[text];

        // A brand the Dashboard keeps as written, or a word it leaves be.
        if (typeof wording !== "string" || wording === text) {
          continue;
        }

        if (admin[text] !== wording) {
          differing.push(
            `${text} -> admin ${JSON.stringify(admin[text])}, dashboard ${JSON.stringify(wording)}`,
          );
        }
      }

      expect(differing).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s: the help and the cards are translated, not English",
    (code: string) => {
      const admin: Record<string, unknown> = locale("AdminDashboard", code);

      for (const text of [
        "Connection",
        LLM_PROVIDER_TYPE_COPY[LLM_PROVIDER_TYPES[0]!].description,
        LlmProviderFormCopy.baseUrlNoKeys,
        LlmProviderFormCopy.nameDescription,
        // A blank Model Name on an OpenAI-compatible server, and its list.
        LLM_PROVIDER_TYPE_COPY[LlmType.OpenAICompatible].modelNameHint,
        LLM_PROVIDER_TYPE_COPY[LlmType.OpenAICompatible].defaultModelLabel!,
      ]) {
        expect({ text, translated: admin[text] !== text }).toEqual({
          text,
          translated: true,
        });
        expect(typeof admin[text]).toBe("string");
      }
    },
  );

  test("the Admin Dashboard's locales still have the same keys in every language", () => {
    const english: Array<string> = Object.keys(
      locale("AdminDashboard", "en"),
    ).sort();

    for (const code of LANGUAGES) {
      expect({
        code,
        keys: Object.keys(locale("AdminDashboard", code)).sort(),
      }).toEqual({ code, keys: english });
    }
  });
});

const COMMON: string = path.join(__dirname, "..", "..", "..");

/*
 * The Test LLM Provider dialog's files: the dialog, the request and
 * response under its verdict, the words kept beside them - the running
 * test's two lines and the locked Test button's refusal - and the test it
 * runs, whose verdict for a pass the server says nothing about is the
 * dialog's own.
 */
const TEST_DIALOG_FILES: Array<string> = [
  "UI/Components/AI/TestLlmProviderModal.tsx",
  "UI/Components/AI/LlmProviderExchanges.tsx",
  "UI/Utils/LlmProviderTestCopy.ts",
  "UI/Utils/TestLLMProvider.ts",
];

// The Dashboard's string extraction (npm run i18n:extract).
const EXTRACTION: string = path.join(
  FEATURE_SETS,
  "Dashboard",
  "scripts",
  "i18n",
  "ExtractStrings.ts",
);

const LETTER: RegExp = /\p{L}/u;
const LATIN_LETTER: RegExp = /[A-Za-z]/;
const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;

// The dialog's words that no language leaves in English.
const TEST_DIALOG_TRANSLATED: Array<string> = [
  "Show request and response",
  "Hide request and response",
  "Copy all",
  "What was sent to your provider and what came back. API keys and cookies are masked.",
  "Request {{number}} of {{total}}",
  "No response",
  "Request headers",
  "Request body",
  "Response headers",
  "Response body",
  "You do not have permission to test this LLM provider.",
  // The verdict for a pass the server says nothing about.
  "Connection successful. The LLM provider responded to a test prompt.",
];

// How long a request took, drawn on its own beside its status.
const REQUEST_DURATION_KEYS: Array<string> = [
  "{{count}} ms",
  "{{count}} ms_one",
];

interface CopyRules {
  // The calls whose text is a key: t(), translateText(), translationKey()...
  translationCall: RegExp;
  // The setters whose message is shown: setError(), setWarningMessage()...
  messageSetter: RegExp;
  // The props and attributes whose text is shown: title, label...
  copyProps: Set<string>;
  // The components that translate their template: TranslatedSentence...
  templateComponents: Set<string>;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/*
 * Where a file's copy is, as the extraction says: its TRANSLATION_FUNCTION,
 * MESSAGE_SETTER, USER_FACING_PROPS and TEMPLATE_COMPONENTS, read from its
 * source. It is not imported: it loads typescript from App's dependencies,
 * which the Common Test job does not install.
 */
function extractionRules(): CopyRules {
  const patterns: Map<string, RegExp> = new Map<string, RegExp>();
  const lists: Map<string, Set<string>> = new Map<string, Set<string>>();

  const collect: (node: ts.Node, into: Set<string>) => void = (
    node: ts.Node,
    into: Set<string>,
  ): void => {
    if (ts.isStringLiteral(node)) {
      into.add(node.text);
    }

    ts.forEachChild(node, (child: ts.Node) => {
      collect(child, into);
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const name: string = node.name.text;

      if (
        (name === "TRANSLATION_FUNCTION" || name === "MESSAGE_SETTER") &&
        ts.isRegularExpressionLiteral(node.initializer)
      ) {
        const literal: string = node.initializer.text;
        const end: number = literal.lastIndexOf("/");

        patterns.set(
          name,
          new RegExp(literal.slice(1, end), literal.slice(end + 1)),
        );
      }

      if (name === "USER_FACING_PROPS" || name === "TEMPLATE_COMPONENTS") {
        const strings: Set<string> = new Set<string>();

        collect(node.initializer, strings);
        lists.set(name, strings);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(parse(EXTRACTION));

  const pattern: (name: string) => RegExp = (name: string): RegExp => {
    const found: RegExp | undefined = patterns.get(name);

    if (!found) {
      throw new Error(
        `${name} is no longer a regular expression in ${EXTRACTION}`,
      );
    }

    return found;
  };

  return {
    translationCall: pattern("TRANSLATION_FUNCTION"),
    messageSetter: pattern("MESSAGE_SETTER"),
    copyProps: lists.get("USER_FACING_PROPS") || new Set<string>(),
    templateComponents: lists.get("TEMPLATE_COMPONENTS") || new Set<string>(),
  };
}

// `x`, `(x)`, `x!`, `x as T` and `x satisfies T` are all `x`.
function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

// The strings an expression is written as: "a", c ? "a" : "b", x || "a", c && "a".
function literalsOf(expression: ts.Expression): Array<string> {
  const node: ts.Expression = unwrap(expression);

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }

  if (ts.isConditionalExpression(node)) {
    return [...literalsOf(node.whenTrue), ...literalsOf(node.whenFalse)];
  }

  if (ts.isBinaryExpression(node)) {
    const operator: ts.SyntaxKind = node.operatorToken.kind;

    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [...literalsOf(node.left), ...literalsOf(node.right)];
    }

    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      return literalsOf(node.right);
    }
  }

  return [];
}

// translateText in translator.translateText(...), tx in tx(...).
function calleeName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return "";
}

function propertyName(name: ts.PropertyName): string {
  return ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
    ? name.text
    : "";
}

/*
 * A count-dependent sentence, { one: "...", other: "..." }: its two forms,
 * written out or marked as keys (translationKey("...")).
 */
function pluralForms(
  node: ts.ObjectLiteralExpression,
): { one: string; other: string } | undefined {
  const forms: Map<string, string> = new Map<string, string>();

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    let value: ts.Expression = unwrap(property.initializer);

    if (
      ts.isCallExpression(value) &&
      calleeName(value.expression) === "translationKey" &&
      value.arguments.length === 1
    ) {
      value = unwrap(value.arguments[0]!);
    }

    if (
      ts.isStringLiteral(value) ||
      ts.isNoSubstitutionTemplateLiteral(value)
    ) {
      forms.set(propertyName(property.name), value.text);
    }
  }

  const one: string | undefined = forms.get("one");
  const other: string | undefined = forms.get("other");

  return node.properties.length === 2 &&
    one !== undefined &&
    other !== undefined
    ? { one, other }
    : undefined;
}

/*
 * Every string the Test LLM Provider dialog looks up, in English, read from
 * its files as the extraction reads a file the Dashboard draws: the key of
 * each translation call, the message given to each setter, both forms of
 * each count-dependent sentence (its one form under its key plus "_one"),
 * and each string given to a prop that holds copy.
 */
function testDialogTexts(rules: CopyRules): Array<string> {
  const texts: Set<string> = new Set<string>();

  const add: (candidates: Array<string>) => void = (
    candidates: Array<string>,
  ): void => {
    for (const text of candidates) {
      // A word to read, not a lone {{placeholder}}.
      if (LETTER.test(text.replace(PLACEHOLDER, ""))) {
        texts.add(text);
      }
    }
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee: string = calleeName(node.expression);
      const key: ts.Expression | undefined = node.arguments[0];

      if (rules.translationCall.test(callee)) {
        if (key) {
          add(literalsOf(key));
        }

        // translateNamedAction(translator, { template: "Edit {{itemName}}" })
        for (const argument of node.arguments) {
          const values: ts.Expression = unwrap(argument);

          if (!ts.isObjectLiteralExpression(values)) {
            continue;
          }

          for (const property of values.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              propertyName(property.name) === "template"
            ) {
              add(literalsOf(property.initializer));
            }
          }
        }
      } else if (rules.messageSetter.test(callee) && key) {
        add(literalsOf(key));
      }
    }

    if (ts.isObjectLiteralExpression(node)) {
      const forms: { one: string; other: string } | undefined =
        pluralForms(node);

      if (forms) {
        add([forms.other, `${forms.other}_one`]);
      }
    }

    // { description: "..." }
    if (
      ts.isPropertyAssignment(node) &&
      rules.copyProps.has(propertyName(node.name))
    ) {
      add(literalsOf(node.initializer));
    }

    // <Modal title="..." />, <TranslatedSentence template="..." />
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name: string = node.name.getText();
      const tag: string = node.parent.parent.tagName.getText();

      if (
        rules.copyProps.has(name) ||
        (name === "template" && rules.templateComponents.has(tag))
      ) {
        if (ts.isStringLiteral(node.initializer)) {
          add([node.initializer.text]);
        } else if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression
        ) {
          add(literalsOf(node.initializer.expression));
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  for (const file of TEST_DIALOG_FILES) {
    visit(parse(path.join(COMMON, file)));
  }

  return Array.from(texts);
}

describe("the Test LLM Provider dialog, in the Admin Dashboard's languages", () => {
  const rules: CopyRules = extractionRules();
  const texts: Array<string> = testDialogTexts(rules);

  test("reads copy where the Dashboard's extraction does", () => {
    for (const call of [
      "translateText",
      "translateTemplate",
      "translatePlural",
      "translationKey",
    ]) {
      expect({ call, isCopy: rules.translationCall.test(call) }).toEqual({
        call,
        isCopy: true,
      });
    }

    expect(rules.translationCall.test("formatNumber")).toBe(false);
    expect(rules.messageSetter.test("setErrorMessage")).toBe(true);
    expect(Array.from(rules.copyProps)).toEqual(
      expect.arrayContaining(["title", "label", "closeButtonText", "tooltip"]),
    );
    expect(rules.copyProps.has("className")).toBe(false);
    expect(Array.from(rules.templateComponents)).toContain(
      "TranslatedSentence",
    );
  });

  test("draws its title and verdicts, its own verdict for a pass, its request and response, and the locked Test button's refusal", () => {
    expect(texts).toEqual(
      expect.arrayContaining([
        "Test LLM Provider",
        "Close",
        "Test again",
        "Test passed",
        "Test passed, with a warning",
        "Test failed",
        "Sending a test prompt to your LLM provider…",
        "HTTP {{status}}",
        // How long a request took: the one form is a key of its own.
        ...REQUEST_DURATION_KEYS,
        ...TEST_DIALOG_TRANSLATED,
      ]),
    );
  });

  test("each of its strings is a key of the Dashboard's locales: what the extraction reads in these files", () => {
    const dashboard: Record<string, unknown> = locale("Dashboard", "en");

    expect(
      texts.filter((text: string): boolean => {
        return typeof dashboard[text] !== "string";
      }),
    ).toEqual([]);
  });

  test.each(["en", ...LANGUAGES])(
    "%s: each of its strings is an entry of the Admin Dashboard's locale",
    (code: string) => {
      const admin: Record<string, unknown> = locale("AdminDashboard", code);

      expect({
        code,
        missing: texts.filter((text: string): boolean => {
          return typeof admin[text] !== "string";
        }),
      }).toEqual({ code, missing: [] });
    },
  );

  test.each(["en", ...LANGUAGES])(
    "%s: every one the Dashboard translates, worded as the Dashboard words it",
    (code: string) => {
      const dashboard: Record<string, unknown> = locale("Dashboard", code);
      const admin: Record<string, unknown> = locale("AdminDashboard", code);
      const differing: Array<string> = [];

      for (const text of texts) {
        const wording: unknown = dashboard[text];

        // A word the Dashboard keeps as written ("HTTP {{status}}").
        if (typeof wording !== "string" || wording === text) {
          continue;
        }

        if (admin[text] !== wording) {
          differing.push(
            `${text} -> admin ${JSON.stringify(admin[text])}, dashboard ${JSON.stringify(wording)}`,
          );
        }
      }

      expect(differing).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s: the request and response, the refusal and the dialog's own verdict are translated in both apps, not English",
    (code: string) => {
      for (const app of ["AdminDashboard", "Dashboard"]) {
        const words: Record<string, unknown> = locale(app, code);

        for (const text of TEST_DIALOG_TRANSLATED) {
          expect({ app, text, translated: words[text] !== text }).toEqual({
            app,
            text,
            translated: true,
          });
          expect(typeof words[text]).toBe("string");
        }
      }
    },
  );

  /*
   * A duration drawn on its own is written with the language's own unit
   * where the page is read from the right, so its figure is read first and
   * the page never reads "ms 87" (Locales/ARABIC.md).
   */
  test.each(["ar", "fa"])(
    "%s: a request's duration is written with the language's own unit, after the count, in both apps",
    (code: string) => {
      for (const app of ["AdminDashboard", "Dashboard"]) {
        const words: Record<string, unknown> = locale(app, code);

        for (const key of REQUEST_DURATION_KEYS) {
          const written: string = String(words[key]);

          expect({
            app,
            key,
            afterTheCount: written.startsWith("{{count}} "),
            latin: LATIN_LETTER.test(written.replace("{{count}}", "")),
          }).toEqual({ app, key, afterTheCount: true, latin: false });
        }
      }
    },
  );

  test("Arabic writes it as Intl's short unit, as ARABIC.md writes a duration", () => {
    for (const app of ["AdminDashboard", "Dashboard"]) {
      for (const key of REQUEST_DURATION_KEYS) {
        expect({ app, key, written: locale(app, "ar")[key] }).toEqual({
          app,
          key,
          written: "{{count}} ملي ث",
        });
      }
    }
  });
});
