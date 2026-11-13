// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { listSourceFiles, toRelativePath } from "../../ForeignHiddenRuleGuard";

/*
 * A PROBE'S MESSAGE ON A MONITOR'S SUMMARY READS IN THE READER'S LANGUAGE
 * (#7422, #7424).
 *
 * The probe stores why a check failed in English: its own timeout sentence
 * ("Request was tried 3 times and it timed out."), or the network's, a
 * query's, a connection's message. The summaries drew each as a plain
 * string, so the timeout sentence stayed English on every page, and on an
 * Arabic or Persian page an English message lost its full stop and its
 * brackets to the line's other end.
 *
 * This fails on:
 *
 *   - a monitor summary's fact (SummaryFact) whose value reads a probe's
 *     message (failureCause, errorDescription, queryError,
 *     connectionError, a certificate's validation error, a script's
 *     error) and draws it as text, not through ProbeMessageLine
 *     (which words the timeout sentence and isolates the rest) or an
 *     IsolatedLine given text already worded;
 *   - the timeout sentence written by hand anywhere but its one template
 *     (Common/Utils/Monitor/ProbeFailureReading), which the probe writes
 *     and every view reads back;
 *   - a probe check that times out and does not write it from there.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SUMMARY_VIEW_DIRECTORY: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView",
);

const TEMPLATE_FILE: string =
  "packages/Common/Utils/Monitor/ProbeFailureReading.ts";

// Where the probe's sentence could be written: the probe, Common, the apps.
const SENTENCE_SCAN_ROOTS: ReadonlyArray<string> = [
  "packages/Probe",
  "packages/Common",
  "packages/App",
];

// The probe checks that write the timeout sentence.
const PROBE_TIMEOUT_WRITERS: ReadonlyArray<string> = [
  "ApiMonitor",
  "WebsiteMonitor",
  "SslMonitor",
  "SnmpMonitor",
  "ExternalStatusPageMonitor",
  "PingMonitor",
  "DnsMonitor",
  "DomainMonitor",
].map((name: string): string => {
  return `packages/Probe/Utils/Monitors/MonitorTypes/${name}.ts`;
});

const PROBE_MESSAGE: RegExp =
  /\b(failureCause|errorDescription|queryError|connectionError|certificateValidationError|scriptError|checkError)\b/;

const TIMEOUT_SENTENCE_PART: string = "times and it timed out";

// What draws a probe's message: worded and isolated, or isolated as worded.
const MESSAGE_DRAWERS: ReadonlySet<string> = new Set<string>([
  "ProbeMessageLine",
  "IsolatedLine",
]);

const WHITESPACE_RUN: RegExp = /\s+/g;

interface Finding {
  line: number;
  text: string;
}

const parse: (fileName: string, source: string) => ts.SourceFile = (
  fileName: string,
  source: string,
): ts.SourceFile => {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
};

const findingAt: (sourceFile: ts.SourceFile, node: ts.Node) => Finding = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): Finding => {
  return {
    line:
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1,
    text: node.getText(sourceFile).replace(WHITESPACE_RUN, " "),
  };
};

const tagNameOf: (node: ts.Node) => string | undefined = (
  node: ts.Node,
): string | undefined => {
  if (ts.isJsxSelfClosingElement(node)) {
    return node.tagName.getText();
  }

  if (ts.isJsxElement(node)) {
    return node.openingElement.tagName.getText();
  }

  return undefined;
};

/*
 * The parts of a fact's value that draw a probe's message as text: the
 * value itself, or a branch of it when it is a condition (the condition
 * may read the message to choose).
 */
const handDrawnParts: (
  sourceFile: ts.SourceFile,
  value: ts.Expression,
) => Array<Finding> = (
  sourceFile: ts.SourceFile,
  value: ts.Expression,
): Array<Finding> => {
  if (ts.isParenthesizedExpression(value)) {
    return handDrawnParts(sourceFile, value.expression);
  }

  if (ts.isConditionalExpression(value)) {
    return [
      ...handDrawnParts(sourceFile, value.whenTrue),
      ...handDrawnParts(sourceFile, value.whenFalse),
    ];
  }

  if (!PROBE_MESSAGE.test(value.getText(sourceFile))) {
    return [];
  }

  const tagName: string | undefined = tagNameOf(value);

  return tagName && MESSAGE_DRAWERS.has(tagName)
    ? []
    : [findingAt(sourceFile, value)];
};

interface FactValues {
  handDrawn: Array<Finding>;
  // Facts whose value is a ProbeMessageLine.
  probeMessageLines: number;
}

// Every SummaryFact's value in a source.
const readFactValues: (fileName: string, source: string) => FactValues = (
  fileName: string,
  source: string,
): FactValues => {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  const result: FactValues = { handDrawn: [], probeMessageLines: 0 };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(sourceFile) === "SummaryFact"
    ) {
      for (const attribute of node.attributes.properties) {
        if (
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile) === "value" &&
          attribute.initializer &&
          ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression
        ) {
          const value: ts.Expression = attribute.initializer.expression;

          result.handDrawn.push(...handDrawnParts(sourceFile, value));

          if (value.getText(sourceFile).includes("<ProbeMessageLine")) {
            result.probeMessageLines += 1;
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return result;
};

// The string literals and template parts in a source that hold `part`.
const findWrittenSentence: (
  fileName: string,
  source: string,
  part: string,
) => Array<Finding> = (
  fileName: string,
  source: string,
  part: string,
): Array<Finding> => {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  const found: Array<Finding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      node.text.includes(part)
    ) {
      found.push(findingAt(sourceFile, node));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
};

const isTestFile: (relativeFile: string) => boolean = (
  relativeFile: string,
): boolean => {
  return relativeFile.split("/").includes("Tests");
};

describe("a probe's message on a monitor's summary", () => {
  const files: Array<string> = listSourceFiles(SUMMARY_VIEW_DIRECTORY);

  test("every fact that shows one draws it through ProbeMessageLine", () => {
    const handDrawn: Array<string> = [];
    let probeMessageLines: number = 0;

    for (const file of files) {
      const values: FactValues = readFactValues(
        file,
        fs.readFileSync(file, "utf-8"),
      );

      probeMessageLines += values.probeMessageLines;

      for (const finding of values.handDrawn) {
        handDrawn.push(
          `${toRelativePath(REPOSITORY_ROOT, file)}:${finding.line} ${finding.text}`,
        );
      }
    }

    expect(handDrawn).toEqual([]);
    /*
     * The Error and Error Details of a request, the Error of a DNS,
     * DNSSEC, domain, NTP, SNMP, SQL, database, server and custom code
     * check, and an SSL check's Certificate Problem and Error: the scan
     * reads them all, so a summary that stops drawing one fails here.
     */
    expect(probeMessageLines).toBeGreaterThanOrEqual(13);
  });

  test("negative control: the facts as the summaries drew them are found", () => {
    const source: string = `
      const A = () => (
        <SummaryFacts>
          <SummaryFact title="Error" value={props.probeMonitorResponse.failureCause.toString()} />
          <SummaryFact title="Error" value={sqlResponse?.queryError || props.probeMonitorResponse.failureCause?.toString() || "-"} />
          <SummaryFact title="Error Details" value={details.errorDescription ? details.errorDescription : "-"} />
          <SummaryFact title="Error" value={<span>{dbResponse.connectionError}</span>} />
          <SummaryFact title="Certificate Problem" value={sslResponse.certificateValidationError} />
          <SummaryFact title="Error" value={customCodeMonitorResponse.scriptError} />
        </SummaryFacts>
      );
    `;

    expect(
      readFactValues("Old.tsx", source).handDrawn.map(
        (finding: Finding): string => {
          return finding.text;
        },
      ),
    ).toEqual([
      "props.probeMonitorResponse.failureCause.toString()",
      'sqlResponse?.queryError || props.probeMonitorResponse.failureCause?.toString() || "-"',
      "details.errorDescription",
      "<span>{dbResponse.connectionError}</span>",
      "sslResponse.certificateValidationError",
      "customCodeMonitorResponse.scriptError",
    ]);
  });

  test("and the facts as they draw them now are not", () => {
    const source: string = `
      const A = () => (
        <SummaryFacts>
          <SummaryFact title="Error" value={<ProbeMessageLine message={failureCause} />} />
          <SummaryFact title="Error Details" value={errorDescription ? (<ProbeMessageLine message={errorDescription} />) : "-"} />
          <SummaryFact title="Error" value={<IsolatedLine text={failureCause} />} />
          <SummaryFact title="Probe" value={props.probeName || "-"} />
        </SummaryFacts>
      );
    `;
    const values: FactValues = readFactValues("New.tsx", source);

    expect(values.handDrawn).toEqual([]);
    expect(values.probeMessageLines).toBe(2);
  });
});

describe("the probe's timeout sentence", () => {
  test("is written only by its template", () => {
    const written: Array<string> = [];

    for (const root of SENTENCE_SCAN_ROOTS) {
      for (const file of listSourceFiles(path.join(REPOSITORY_ROOT, root))) {
        const relativeFile: string = toRelativePath(REPOSITORY_ROOT, file);

        if (relativeFile === TEMPLATE_FILE || isTestFile(relativeFile)) {
          continue;
        }

        const source: string = fs.readFileSync(file, "utf-8");

        if (!source.includes(TIMEOUT_SENTENCE_PART)) {
          continue;
        }

        for (const finding of findWrittenSentence(
          file,
          source,
          TIMEOUT_SENTENCE_PART,
        )) {
          written.push(`${relativeFile}:${finding.line} ${finding.text}`);
        }
      }
    }

    expect(written).toEqual([]);
  });

  test("the template is where the scan says", () => {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, TEMPLATE_FILE),
      "utf-8",
    );

    expect(
      findWrittenSentence(TEMPLATE_FILE, source, TIMEOUT_SENTENCE_PART).length,
    ).toBeGreaterThan(0);
  });

  test("negative control: the sentence as the probe wrote it is found, a comment is not", () => {
    const source: string = `
      // Request was tried 3 times and it timed out.
      const a = "Request was tried " + count + " times and it timed out.";
      const b = \`Request was tried \${count} times and it timed out.\`;
    `;

    expect(
      findWrittenSentence("Old.ts", source, TIMEOUT_SENTENCE_PART).map(
        (finding: Finding): number => {
          return finding.line;
        },
      ),
    ).toEqual([3, 4]);
  });

  test.each(PROBE_TIMEOUT_WRITERS)(
    "%s writes it from the template",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf-8",
      );

      expect(source).toContain(
        'import { writeProbeTimeoutFailureCause } from "Common/Utils/Monitor/ProbeFailureReading";',
      );
      expect(source).toMatch(
        /writeProbeTimeoutFailureCause\(\s*\w+\.currentRetryCount,?\s*\)/,
      );
    },
  );
});
