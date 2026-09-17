import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source-pinning tests for the GrokParser half of the log pipeline
 * processor form. The App suite runs in a plain Node environment, so the
 * form cannot be rendered here; these pin the INTENT with tolerant
 * patterns instead, in the style of AppShellWiring.
 *
 * What they exist to stop is the shape of OneUptime/oneuptime#2515:
 * GrokParser was a first-class processor type in the enum, the model
 * description and the API, but nothing in the product could create one
 * and nothing in ingest ran one. Half a wiring is what made it invisible
 * for so long, so the dropdown entry, the configuration panel and the
 * saved configuration keys are pinned together.
 *
 * The pattern tester is pinned to the SHARED engine on purpose: a
 * tester with its own regex implementation would be free to disagree
 * with what ingest actually does, which is worse than no tester.
 */

const PROCESSOR_FORM_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "LogPipeline",
  "ProcessorForm.tsx",
);

function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

const FORM_SOURCE: string = stripComments(
  fs.readFileSync(PROCESSOR_FORM_PATH, "utf8"),
);

describe("the processor form offers GrokParser", () => {
  test("GrokParser is one of the processor types a user can pick", () => {
    expect(FORM_SOURCE).toMatch(/value:\s*["']GrokParser["']/);
  });

  test("it sits alongside the three processor types that already worked", () => {
    for (const processorType of [
      "GrokParser",
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
      /processorType === ["']GrokParser["'][\s\S]{0,200}Grok Parser Configuration/,
    );
  });
});

describe("the form saves the configuration the engine reads", () => {
  /*
   * GrokParserConfig is { source, pattern, targetPrefix } and
   * LogPipelineService.applyGrokParser reads exactly those keys. A form
   * that saved "grokPattern" instead would be another silent no-op.
   */
  test("the GrokParser branch writes source, pattern and targetPrefix", () => {
    const branch: RegExpMatchArray | null = FORM_SOURCE.match(
      /case ["']GrokParser["']:\s*return \{[\s\S]*?\};/,
    );

    expect(branch).not.toBeNull();

    const branchSource: string = (branch as RegExpMatchArray)[0];

    expect(branchSource).toMatch(/\bsource:/);
    expect(branchSource).toMatch(/\bpattern:/);
    expect(branchSource).toMatch(/\btargetPrefix:/);
  });
});

describe("the form validates the pattern before it is saved", () => {
  test("it compiles the pattern with the shared engine", () => {
    expect(FORM_SOURCE).toMatch(
      /import \{[\s\S]*?compileGrokPattern[\s\S]*?\} from ["']Common\/Utils\/Grok\/Grok["']/,
    );
    expect(FORM_SOURCE).toMatch(/compileGrokPattern\(/);
  });

  test("the pattern tester runs the same matcher ingest runs", () => {
    expect(FORM_SOURCE).toMatch(
      /import \{[\s\S]*?matchGrokPattern[\s\S]*?\} from ["']Common\/Utils\/Grok\/Grok["']/,
    );
    expect(FORM_SOURCE).toMatch(/matchGrokPattern\(/);
  });

  test("it lists the available patterns from the shared library", () => {
    expect(FORM_SOURCE).toMatch(
      /getGrokPatternNames[\s\S]*?from ["']Common\/Utils\/Grok\/GrokPatterns["']/,
    );
  });

  test("a rejected save shows what the API said, not a generic retry message", () => {
    /*
     * ModelAPI throws an HTTPErrorResponse, which is not an Error - the
     * shared helper is what reads a message out of both.
     */
    expect(FORM_SOURCE).toMatch(/setError\(API\.getFriendlyMessage\(err\)\)/);
  });
});
