import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source-pinning tests for the KeyValueParser half of the log pipeline
 * processor form, in the style of LogPipelineGrokProcessorForm. The App
 * suite runs in a plain Node environment, so the form cannot be rendered
 * here; these pin the INTENT with tolerant patterns instead.
 *
 * What they guard against is a half wiring (OneUptime/oneuptime#2515): a
 * processor type the enum and the engine know about but the form cannot
 * create, or a form that saves configuration keys the engine never reads.
 * The tester is pinned to the SHARED parser, so it cannot disagree with
 * what ingest does.
 */

const DASHBOARD_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

const FORM_SOURCE: string = stripComments(
  fs.readFileSync(
    path.join(DASHBOARD_ROOT, "Components", "LogPipeline", "ProcessorForm.tsx"),
    "utf8",
  ),
);

const PIPELINE_VIEW_SOURCE: string = fs.readFileSync(
  path.join(DASHBOARD_ROOT, "Pages", "Logs", "Settings", "PipelineView.tsx"),
  "utf8",
);

const ENGINE_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Telemetry",
    "Services",
    "LogPipelineService.ts",
  ),
  "utf8",
);

describe("the processor form offers KeyValueParser", () => {
  test("KeyValueParser is one of the processor types a user can pick", () => {
    expect(FORM_SOURCE).toMatch(/value:\s*["']KeyValueParser["']/);
    expect(FORM_SOURCE).toMatch(/\|\s*["']KeyValueParser["']/);
  });

  test("it sits alongside every other processor type", () => {
    for (const processorType of [
      "GrokParser",
      "KeyValueParser",
      "SeverityRemapper",
      "AttributeRemapper",
      "CategoryProcessor",
    ]) {
      expect(FORM_SOURCE).toMatch(
        new RegExp(`value:\\s*["']${processorType}["']`),
      );
    }
  });

  test("picking it reveals a configuration panel", () => {
    expect(FORM_SOURCE).toMatch(
      /processorType === ["']KeyValueParser["'][\s\S]{0,260}Key=Value Parser Configuration/,
    );
  });

  test("the panel has the delimiter fields, the override toggle and a tester", () => {
    const panel: RegExpMatchArray | null = FORM_SOURCE.match(
      /processorType === ["']KeyValueParser["'] && \([\s\S]*?Severity Remapper Configuration/,
    );

    expect(panel).not.toBeNull();

    const panelSource: string = (panel as RegExpMatchArray)[0];

    expect(panelSource).toMatch(/title="Source Field"/);
    expect(panelSource).toMatch(/title="Target Prefix \(optional\)"/);
    expect(panelSource).toMatch(/title="Pair Delimiter \(optional\)"/);
    expect(panelSource).toMatch(/title="Key-Value Delimiter"/);
    expect(panelSource).toMatch(/title="Override on Conflict"/);
    expect(panelSource).toMatch(/value=\{keyValueSample\}/);
  });
});

describe("the form saves the configuration the engine reads", () => {
  /*
   * KeyValueParserConfig is { source, targetPrefix, pairDelimiter,
   * keyValueDelimiter, overrideOnConflict } and
   * LogPipelineService.applyKeyValueParser reads exactly those keys.
   */
  test("the KeyValueParser branch writes every key the engine reads", () => {
    const branch: RegExpMatchArray | null = FORM_SOURCE.match(
      /case ["']KeyValueParser["']:\s*return \{[\s\S]*?\};/,
    );

    expect(branch).not.toBeNull();

    const branchSource: string = (branch as RegExpMatchArray)[0];

    for (const key of [
      "source",
      "targetPrefix",
      "pairDelimiter",
      "keyValueDelimiter",
      "overrideOnConflict",
    ]) {
      expect(branchSource).toMatch(new RegExp(`\\b${key}:`));
      expect(ENGINE_SOURCE).toMatch(new RegExp(`config\\.${key}\\b`));
    }
  });

  test("a blank pair delimiter is left out, so ingest splits on whitespace", () => {
    expect(FORM_SOURCE).toMatch(
      /\.\.\.\(keyValuePairDelimiter\s*\?\s*\{\s*pairDelimiter: keyValuePairDelimiter\s*\}\s*:\s*\{\}\)/,
    );
  });

  test("override on conflict starts off", () => {
    expect(FORM_SOURCE).toMatch(
      /\[keyValueOverrideOnConflict, setKeyValueOverrideOnConflict\]\s*=\s*useState<boolean>\(false\)/,
    );
  });

  test("the key-value delimiter starts at the shared default", () => {
    expect(FORM_SOURCE).toMatch(
      /useState<string>\(\s*DEFAULT_KEY_VALUE_DELIMITER,?\s*\)/,
    );
  });
});

describe("the form validates and tests with the shared parser", () => {
  test("it validates the delimiters with the same check the API makes", () => {
    expect(FORM_SOURCE).toMatch(
      /import \{[\s\S]*?resolveKeyValueParserOptions[\s\S]*?\} from ["']Common\/Utils\/Log\/KeyValueParser["']/,
    );

    const validateBranch: RegExpMatchArray | null = FORM_SOURCE.match(
      /case ["']KeyValueParser["']: \{[\s\S]*?break;/,
    );

    expect(validateBranch).not.toBeNull();
    expect((validateBranch as RegExpMatchArray)[0]).toMatch(
      /resolveKeyValueParserOptions\(/,
    );
  });

  test("the tester runs the same parser ingest runs", () => {
    expect(FORM_SOURCE).toMatch(
      /import \{[\s\S]*?parseKeyValuePairs[\s\S]*?\} from ["']Common\/Utils\/Log\/KeyValueParser["']/,
    );
    expect(FORM_SOURCE).toMatch(/parseKeyValuePairs\(keyValueSample/);
    expect(ENGINE_SOURCE).toMatch(
      /from ["']Common\/Utils\/Log\/KeyValueParser["']/,
    );
  });

  test("a rejected save shows what the API said", () => {
    expect(FORM_SOURCE).toMatch(/setError\(API\.getFriendlyMessage\(err\)\)/);
  });
});

describe("the pipeline page explains the processor", () => {
  test("the help panel documents the Key=Value Parser", () => {
    expect(PIPELINE_VIEW_SOURCE).toMatch(/#### Key=Value Parser/);
    expect(PIPELINE_VIEW_SOURCE).toMatch(
      /Understanding Grok Parser, Key=Value Parser,/,
    );
  });
});
