import { beforeAll, describe, expect, test } from "@jest/globals";
import path from "path";
import {
  buildFirstLoad,
  FirstLoadBuild,
  inputsUnder,
} from "../Helpers/FirstLoadBuild";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

/*
 * What a visitor downloads before the sign-in and sign-up pages can draw,
 * as far as Common decides it (issue #5619).
 *
 * The pages draw with these shared modules, and each used to bring along a
 * library they never use to draw: PostHog through the analytics, the
 * drag-and-drop library through Table and StaticModelList, a form's summary
 * step, the QR code library, a database model through the edition label, the
 * browser OpenTelemetry SDK with zone.js through the entry's Telemetry, and
 * through FormField the code editor with its syntax checks and grammars, the
 * Markdown editor with DOMPurify, the file picker with react-dropzone, the
 * people picker with the kinds of record it searches and their models, and
 * a field title's word with its definition (DefinedTerm, with the Glossary
 * it reads and "Was this clear?" under it); the i18n set-up's
 * post-processor brought the rules that set code apart in an Arabic or
 * Persian sentence. Each is now loaded where it is used - posthog-js once
 * analytics starts, the SDK where browser telemetry is configured, the rules
 * with an Arabic or Persian locale file, the rest by the first list, form
 * field, summary, code or marked word that needs it. zone.js is gone
 * altogether (BrowserTelemetrySdk.ts says why), and so are crypto-js's
 * ciphers, which HashedString brought with the SHA-256 it hashes with.
 *
 * Every form (ModelForm) asked whether it was a rule's through the rule
 * criteria form, and brought the condition builder a rule's form draws, the
 * checks of a rule's conditions and the pattern matcher they read: it asks
 * through RuleCriteriaLegacyFields, and a rule's form loads the rest
 * (LazyRuleCriteriaModelForm).
 *
 * An error's words, which API and every form load, joined their sentences
 * through DeleteConsequences and brought its table of sentences about
 * deleting records: they join them with SentenceSeparator, and the table is
 * not built from these modules at all.
 *
 * The product's logo brought the mark the Dashboard's header draws on a
 * phone, as a data: URL: that header hands the logo getProductMarkSource,
 * which the logo does not call on its own, and the mark is not built from
 * these modules either.
 *
 * Reading JSON loads every type it can read back
 * (SerializableObjectDictionary), and those were once a monitor's steps and
 * criteria with every monitor type: each step's settings, the default
 * criteria and their sentences, some 147 KB before gzip (#8821). They join
 * JSON reading from their own module now, which only a program that reads
 * a monitor loads (Types/JoinedSerializableObjects), and none of them is
 * built from these modules at all - nor, so, the probe's failure causes a
 * new NTP monitor's default criteria brought (ProbeFailureCauses), or the
 * Database Health metric catalog a Database Health step named its
 * collection groups from, which each had been kept out on its own before.
 *
 * Every model's lists are read with the product levels (#10289), which read
 * every product's tables (Types/Product/ProductRecordTables), and that file
 * built, as it loaded, the tables of no product with why each is - which
 * only the tests that hold every table to a product read. They are a file
 * of their own (Types/Product/TablesOfNoProduct), not built from these
 * modules at all.
 *
 * Built here as the frontends build (the shared esbuild config, for
 * production), with these modules as the entry, and read from esbuild's
 * metafile (Helpers/FirstLoadBuild): the first load is the entry's file and
 * every file it imports statically - the same reading
 * packages/Common/Scripts/first-load-budgets.js holds the real pages to in
 * CI.
 */
const SHARED_MODULES: ReadonlyArray<string> = [
  "UI/Components/Forms/BasicForm",
  "UI/Components/Forms/ModelForm",
  "UI/Components/Table/Table",
  "UI/Components/ModelList/StaticModelList",
  "UI/Components/Forms/Fields/FormField",
  "UI/Components/QR/QR",
  // The QR code and the setup key, on the required two-factor setup (#6638).
  "UI/Components/AuthenticatorAppSetupCode/AuthenticatorAppSetupCode",
  "UI/Components/EditionLabel/EditionLabel",
  "UI/Utils/Analytics",
  "UI/Utils/Telemetry/Telemetry",
  // The logo at the top of every sign-in page.
  "UI/Components/ProductLogo/ProductLogo",
];

interface NamedExports {
  module: string;
  // What the pages import from it.
  names: ReadonlyArray<string>;
}

// Shared modules the pages import by name: the sign-in pages' i18n set-up.
const SHARED_NAMED_EXPORTS: ReadonlyArray<NamedExports> = [
  {
    module: "UI/Utils/CodeReadsAsWritten",
    names: [
      "codeReadsAsWrittenPostProcessor",
      "getTranslationPostProcess",
      "leaveIsolatesOutOfCopiedText",
      "whenCodeCanBeSetApart",
    ],
  },
];

// A module's own source, as the metafile names it.
const SOURCE_FILE: RegExp = /\.tsx?$/;

interface LeftOut {
  // What it is, for a failure's message.
  name: string;
  // Part of the path of every module of it, as the metafile names inputs.
  path: string;
  // Still part of the build, in a file loaded when it is needed.
  isLoadedWhenNeeded: boolean;
}

const LEFT_OUT: ReadonlyArray<LeftOut> = [
  {
    name: "posthog-js, which loads once analytics starts",
    path: "node_modules/posthog-js/",
    isLoadedWhenNeeded: true,
  },
  {
    name: "react-beautiful-dnd, for a list that reorders its rows",
    path: "node_modules/react-beautiful-dnd/",
    isLoadedWhenNeeded: true,
  },
  {
    name: "react-redux, which react-beautiful-dnd runs on",
    path: "node_modules/react-redux/",
    isLoadedWhenNeeded: true,
  },
  {
    name: "highlight.js, for an editor or a code view",
    path: "node_modules/highlight.js/",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the code editor's grammars",
    path: "UI/Components/CodeEditor/CodeEditorGrammars.ts",
    isLoadedWhenNeeded: true,
  },
  {
    name: "a form's summary step",
    path: "UI/Components/Forms/FormSummary.tsx",
    isLoadedWhenNeeded: true,
  },
  {
    name: "Detail, which the summary step draws with",
    path: "UI/Components/Detail/Detail.tsx",
    isLoadedWhenNeeded: true,
  },
  {
    name: "qrcode, for a QR code being drawn",
    path: "node_modules/qrcode/",
    isLoadedWhenNeeded: true,
  },
  {
    name: "QRCodeImage, the module of ours a QR code loads qrcode through (#6638)",
    path: "UI/Components/QR/QRCodeImage.ts",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the code editor, for a form with a code field",
    path: "UI/Components/CodeEditor/CodeEditor.tsx",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the YAML editor, for a form with a YAML field",
    path: "UI/Components/CodeEditor/YamlEditor.tsx",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the code editor's YAML syntax check",
    path: "Types/Code/YamlSyntax.ts",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the code editor's JSON syntax check",
    path: "Types/Code/JsonSyntax.ts",
    isLoadedWhenNeeded: true,
  },
  {
    name: "js-yaml, which the YAML syntax check parses with",
    path: "node_modules/js-yaml/",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the Markdown editor, for a form with a Markdown field",
    path: "UI/Components/Markdown.tsx/MarkdownEditor.tsx",
    isLoadedWhenNeeded: true,
  },
  {
    name: "dompurify, which the Markdown editor pastes through",
    path: "node_modules/dompurify/",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the file picker, for a form that takes a file",
    path: "UI/Components/FilePicker/FilePicker.tsx",
    isLoadedWhenNeeded: true,
  },
  {
    name: "react-dropzone, which the file picker reads drops with",
    path: "node_modules/react-dropzone/",
    isLoadedWhenNeeded: true,
  },
  {
    name: "file-selector, which react-dropzone reads files with",
    path: "node_modules/file-selector/",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the people picker, for a form that picks people",
    path: "UI/Components/PeoplePicker/PeoplePicker.tsx",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the kinds of record the people picker searches, with their models",
    path: "UI/Components/PeoplePicker/PeoplePickerKinds.ts",
    isLoadedWhenNeeded: true,
  },
  {
    name: "DefinedTerm, for a title that marks a word with its definition",
    path: "UI/Components/Glossary/DefinedTerm.tsx",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the Glossary a definition is read from",
    path: "UI/Utils/Glossary.ts",
    isLoadedWhenNeeded: true,
  },
  {
    name: '"Was this clear?", which DefinedTerm draws under a definition',
    path: "UI/Components/Feedback/WasThisClear.tsx",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the product events an answer to it sends",
    path: "Types/Analytics/ProductEvent.ts",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the browser OpenTelemetry SDK, which loads where telemetry is configured",
    path: "node_modules/@opentelemetry/",
    isLoadedWhenNeeded: true,
  },
  {
    name: "Telemetry's own file for the SDK",
    path: "UI/Utils/Telemetry/BrowserTelemetrySdk.ts",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the rules that set code apart in a sentence read from the right, which load with Arabic or Persian words",
    path: "Types/CodeInSentence.ts",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the rule criteria form, which only a rule's form loads (ModelForm, LazyRuleCriteriaModelForm)",
    path: "UI/Components/RuleCriteria/RuleCriteriaModelForm.tsx",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the condition builder a rule's form draws its match fields with",
    path: "UI/Components/RuleCriteria/RuleCriteriaBuilder.tsx",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the checks of a rule's conditions, with their sentences",
    path: "UI/Components/RuleCriteria/RuleCriteriaFields.ts",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the check of a pattern a condition is written with",
    path: "Utils/Rules/RulePatternMatchUtil.ts",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the regular expressions such a pattern is read as",
    path: "Utils/LinearRegExp/LinearRegExp.ts",
    isLoadedWhenNeeded: true,
  },
  {
    name: "the GlobalConfig database model, which the edition label no longer builds",
    path: "Models/DatabaseModels/GlobalConfig.ts",
    isLoadedWhenNeeded: false,
  },
  {
    name: "the table of sentences about deleting records, which an error's words no longer join their sentences through",
    path: "UI/Components/DeleteConfirmation/DeleteConsequences.ts",
    isLoadedWhenNeeded: false,
  },
  {
    name: "OneUptime's mark, which only the Dashboard's header draws",
    path: "UI/Images/logos/OneUptimeSVG/mark-transparent.svg",
    isLoadedWhenNeeded: false,
  },
  {
    name: "the probe's failure causes, which a monitor's default criteria no longer load to read an NTP monitor's clock offset",
    path: "Utils/Monitor/ProbeFailureCauses.ts",
    isLoadedWhenNeeded: false,
  },
  {
    name: "the Database Health metric catalog, which a Database Health step no longer loads to name its collection groups",
    path: "Types/Monitor/DatabaseMetricCatalog.ts",
    isLoadedWhenNeeded: false,
  },
  {
    name: "the tables of no product, which only the tests that hold every table to a product read",
    path: "Types/Product/TablesOfNoProduct.ts",
    isLoadedWhenNeeded: false,
  },
  {
    name: "a monitor's steps, which reading JSON no longer imports (#8821)",
    path: "Types/Monitor/MonitorSteps.ts",
    isLoadedWhenNeeded: false,
  },
  {
    name: "a monitor's step, with the settings of every kind of step",
    path: "Types/Monitor/MonitorStep.ts",
    isLoadedWhenNeeded: false,
  },
  {
    name: "a step's criteria",
    path: "Types/Monitor/MonitorCriteria.ts",
    isLoadedWhenNeeded: false,
  },
  {
    name: "a criterion, with every monitor type's default criteria and their sentences",
    path: "Types/Monitor/MonitorCriteriaInstance.ts",
    isLoadedWhenNeeded: false,
  },
  {
    name: "the monitor types, which only a monitor's step reads",
    path: "Types/Monitor/MonitorType.ts",
    isLoadedWhenNeeded: false,
  },
  {
    name: "zone.js, which the SDK does not use",
    path: "node_modules/zone.js/",
    isLoadedWhenNeeded: false,
  },
  {
    name: "crypto-js's index, every cipher and hash it has, where HashedString hashes with SHA-256 alone",
    path: "node_modules/crypto-js/index.js",
    isLoadedWhenNeeded: false,
  },
  {
    name: "the ciphers crypto-js's index brought (AES, Triple DES, Blowfish, RC4, Rabbit)",
    path: "node_modules/crypto-js/cipher-core.js",
    isLoadedWhenNeeded: false,
  },
];

let built: FirstLoadBuild | null = null;

beforeAll(() => {
  built = buildFirstLoad({
    entryLines: [
      ...SHARED_MODULES.map((module: string, index: number): string => {
        return `export { default as Module${index} } from ${JSON.stringify(
          path.join(COMMON_ROOT, module),
        )};`;
      }),
      ...SHARED_NAMED_EXPORTS.map((shared: NamedExports): string => {
        return `export { ${shared.names.join(", ")} } from ${JSON.stringify(
          path.join(COMMON_ROOT, shared.module),
        )};`;
      }),
    ],
    serviceName: "Accounts",
    publicPath: "/accounts/dist/",
  });
}, 300000);

describe("what the sign-in pages' shared modules put in the first load", () => {
  test("is built from those modules, every one of them in it", () => {
    for (const module of [
      ...SHARED_MODULES,
      ...SHARED_NAMED_EXPORTS.map((shared: NamedExports): string => {
        return shared.module;
      }),
    ]) {
      expect({
        module,
        isInFirstLoad: built!.firstLoad.some((input: string): boolean => {
          return SOURCE_FILE.test(input) && input.includes(`${module}.`);
        }),
      }).toEqual({ module, isInFirstLoad: true });
    }

    // Split: there are files loaded later, besides the first load's.
    expect(built!.laterFiles).toBeGreaterThan(0);
  });

  test.each(
    LEFT_OUT.map((leftOut: LeftOut): [string, LeftOut] => {
      return [leftOut.name, leftOut];
    }),
  )("leaves out %s", (_name: string, leftOut: LeftOut) => {
    expect(inputsUnder(built!.firstLoad, leftOut.path)).toEqual([]);
  });

  test.each(
    LEFT_OUT.filter((leftOut: LeftOut): boolean => {
      return leftOut.isLoadedWhenNeeded;
    }).map((leftOut: LeftOut): [string, LeftOut] => {
      return [leftOut.name, leftOut];
    }),
  )(
    "still has %s, in a file loaded when it is needed",
    (_name: string, leftOut: LeftOut) => {
      expect(
        inputsUnder(built!.loadedLater, leftOut.path).length,
      ).toBeGreaterThan(0);
    },
  );

  test.each(
    LEFT_OUT.filter((leftOut: LeftOut): boolean => {
      return !leftOut.isLoadedWhenNeeded;
    }).map((leftOut: LeftOut): [string, LeftOut] => {
      return [leftOut.name, leftOut];
    }),
  )("does not build %s at all", (_name: string, leftOut: LeftOut) => {
    expect(
      inputsUnder([...built!.firstLoad, ...built!.loadedLater], leftOut.path),
    ).toEqual([]);
  });
});
