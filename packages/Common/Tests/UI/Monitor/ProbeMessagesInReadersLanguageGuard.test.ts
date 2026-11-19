// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  NTP_NO_REPLY_IGNORED_PACKETS,
  PROBE_FAILURE_CAUSES,
  ProbeFailureCause,
} from "../../../Utils/Monitor/ProbeFailureCauses";
import { REQUEST_FAILURE_DESCRIPTIONS } from "../../../Utils/Monitor/RequestFailureDescriptions";
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
 *   - a probe check that times out and does not write it from there;
 *   - the monitor overview (its hero's Latest result and its Probes card)
 *     drawing a check's failure cause other than through
 *     getProbeFailureCauseText, which words the timeout sentence and
 *     leaves the rest as written (#8003);
 *   - what a failed request means (Error Details, the root cause's Error
 *     Description: "DNS resolution failed. ...") written by hand anywhere
 *     but its table (Common/Utils/Monitor/RequestFailureDescriptions),
 *     which the probe writes and every view reads back, and a check that
 *     sets a request's errorDescription other than from there (#8001);
 *   - a failure cause with values - the NTP check's, the probe-side
 *     sentences ProbeNetworkFailureUtil describes, the AggregateError one -
 *     written by hand anywhere but its table
 *     (Common/Utils/Monitor/ProbeFailureCauses), and a check that writes
 *     one and does not write it from there (#8267).
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

/*
 * What draws the monitor overview's words: its cards, and the hero and
 * facts MonitorOverviewPresentationUtil writes. MonitorOverviewProbeUtil
 * only reads the stored cause into the overview's data, as written.
 */
const OVERVIEW_DRAWERS: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview",
  "packages/Common/Utils/Monitor/MonitorOverviewPresentationUtil.ts",
];

// The one call that turns a stored failure cause into the reader's text.
const FAILURE_CAUSE_READER: string = "getProbeFailureCauseText";

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

interface FailureCauseReads {
  // Reads that draw the stored cause as it is.
  drawnAsStored: Array<Finding>;
  // Reads handed to getProbeFailureCauseText.
  worded: number;
}

type FailureCauseReading = "worded" | "tested" | "drawn";

/*
 * Whether a read of `failureCause` only tests it - the condition of a
 * ?: or an if, the left of an &&, under a ! or a typeof - or is handed to
 * getProbeFailureCauseText; anything else draws the stored text.
 */
const readsFailureCauseAs: (
  sourceFile: ts.SourceFile,
  read: ts.Node,
) => FailureCauseReading = (
  sourceFile: ts.SourceFile,
  read: ts.Node,
): FailureCauseReading => {
  let child: ts.Node = read;
  let parent: ts.Node | undefined = read.parent;

  while (parent) {
    if (
      ts.isCallExpression(parent) &&
      parent.expression.getText(sourceFile) === FAILURE_CAUSE_READER &&
      child !== parent.expression
    ) {
      return "worded";
    }

    if (
      (ts.isConditionalExpression(parent) && parent.condition === child) ||
      (ts.isIfStatement(parent) && parent.expression === child) ||
      (ts.isBinaryExpression(parent) &&
        parent.left === child &&
        parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) ||
      (ts.isPrefixUnaryExpression(parent) &&
        parent.operator === ts.SyntaxKind.ExclamationToken) ||
      ts.isTypeOfExpression(parent)
    ) {
      return "tested";
    }

    if (
      ts.isStatement(parent) ||
      ts.isFunctionLike(parent) ||
      ts.isJsxAttribute(parent) ||
      ts.isJsxElement(parent) ||
      ts.isJsxExpression(parent)
    ) {
      return "drawn";
    }

    child = parent;
    parent = parent.parent;
  }

  return "drawn";
};

// Every read of a stored failure cause (x.failureCause) in a source.
const readFailureCauses: (
  fileName: string,
  source: string,
) => FailureCauseReads = (
  fileName: string,
  source: string,
): FailureCauseReads => {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  const result: FailureCauseReads = { drawnAsStored: [], worded: 0 };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.getText(sourceFile) === "failureCause"
    ) {
      const reading: FailureCauseReading = readsFailureCauseAs(
        sourceFile,
        node,
      );

      if (reading === "worded") {
        result.worded += 1;
      } else if (reading === "drawn") {
        result.drawnAsStored.push(findingAt(sourceFile, node));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return result;
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

describe("a check's failure cause on the monitor overview", () => {
  const overviewFiles: Array<string> = OVERVIEW_DRAWERS.flatMap(
    (drawer: string): Array<string> => {
      const absolute: string = path.join(REPOSITORY_ROOT, drawer);

      return fs.statSync(absolute).isDirectory()
        ? listSourceFiles(absolute)
        : [absolute];
    },
  );

  test("is drawn through getProbeFailureCauseText wherever it is drawn", () => {
    const drawnAsStored: Array<string> = [];
    let worded: number = 0;

    for (const file of overviewFiles) {
      const reads: FailureCauseReads = readFailureCauses(
        file,
        fs.readFileSync(file, "utf-8"),
      );

      worded += reads.worded;

      for (const finding of reads.drawnAsStored) {
        drawnAsStored.push(
          `${toRelativePath(REPOSITORY_ROOT, file)}:${finding.line} ${finding.text}`,
        );
      }
    }

    expect(drawnAsStored).toEqual([]);
    // The hero's Latest result and the Probes card's failure line.
    expect(worded).toBeGreaterThanOrEqual(2);
  });

  test("negative control: the overview as it drew the cause is found", () => {
    const source: string = `
      const failureCause = row.health === Down ? row.latestResult?.failureCause : undefined;
      const fact = {
        secondary: result.isOnline === false && result.failureCause
          ? result.failureCause
          : t.translateTemplate("from {{probe}}", { probe: result.probeName }),
      };
      const line = <p title={row.latestResult.failureCause}>{row.latestResult.failureCause}</p>;
      const message = getProbeFailureCauseText(result.failureCause.trim() ? x : y) || result.failureCause;
    `;

    expect(
      readFailureCauses("Old.tsx", source).drawnAsStored.map(
        (finding: Finding): string => {
          return finding.text;
        },
      ),
    ).toEqual([
      "row.latestResult?.failureCause",
      "result.failureCause",
      "row.latestResult.failureCause",
      "row.latestResult.failureCause",
      "result.failureCause",
    ]);
  });

  test("and the overview as it draws it now is not", () => {
    const source: string = `
      const failureCause =
        row.health === Down && row.latestResult?.failureCause
          ? getProbeFailureCauseText({ translator, failureCause: row.latestResult.failureCause }) || undefined
          : undefined;
      const worded = result.isOnline === false
        ? getProbeFailureCauseText({ translator: t, failureCause: result.failureCause })
        : "";
      if (!result.failureCause) {
        return;
      }
      const isText = typeof chosen.failureCause === "string";
    `;
    const reads: FailureCauseReads = readFailureCauses("New.tsx", source);

    expect(reads.drawnAsStored).toEqual([]);
    expect(reads.worded).toBe(2);
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

/*
 * WHAT A FAILED REQUEST MEANS (#8001): the Error Details a Website, API or
 * Port summary shows and the root cause's Error Description, OneUptime's
 * own fixed English. Written by hand, a sentence is one no view reads back,
 * and it reads English on every page.
 */

const DESCRIPTIONS_FILE: string =
  "packages/Common/Utils/Monitor/RequestFailureDescriptions.ts";

/*
 * The checks that say what a failed request means: the Website and API
 * checks' requests (RequestFailedDetailsUtil, which only a probe loads),
 * the Port check and the NTP check.
 */
const DESCRIPTION_WRITERS: ReadonlyArray<string> = [
  "packages/Common/Utils/RequestFailedDetailsUtil.ts",
  "packages/Probe/Utils/Monitors/MonitorTypes/PortMonitor.ts",
  "packages/Probe/Utils/Monitors/MonitorTypes/NtpMonitor.ts",
];

const DESCRIPTION_WRITER: string = "writeRequestFailureDescription";

const PLACEHOLDER_IN_TEMPLATE: RegExp = /\{\{\w+\}\}/;

const PUNCTUATION_AT_ENDS: RegExp = /^[\s.]+|\s+$/g;

/*
 * What each explanation is found by in a source: the whole of one with no
 * value, the longer side of the value of one with a value ("Server
 * responded with HTTP status ", ". This indicates a server-side error."),
 * without the stops and spaces a hand-written piece may leave to its
 * neighbour (" This indicates a server-side error." was one).
 */
const DESCRIPTION_PARTS: ReadonlyArray<string> = Object.values(
  REQUEST_FAILURE_DESCRIPTIONS,
).map((english: string): string => {
  return english
    .split(PLACEHOLDER_IN_TEMPLATE)
    .reduce((longest: string, piece: string): string => {
      return piece.length > longest.length ? piece : longest;
    }, "")
    .replace(PUNCTUATION_AT_ENDS, "");
});

// Every errorDescription a source sets that is not written from the table.
const findHandWrittenDescriptions: (
  fileName: string,
  source: string,
) => Array<Finding> = (fileName: string, source: string): Array<Finding> => {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  const found: Array<Finding> = [];

  const isWrittenFromTheTable: (value: ts.Expression) => boolean = (
    value: ts.Expression,
  ): boolean => {
    if (ts.isParenthesizedExpression(value)) {
      return isWrittenFromTheTable(value.expression);
    }

    if (ts.isConditionalExpression(value)) {
      return (
        isWrittenFromTheTable(value.whenTrue) &&
        isWrittenFromTheTable(value.whenFalse)
      );
    }

    return (
      ts.isCallExpression(value) &&
      value.expression.getText(sourceFile) === DESCRIPTION_WRITER
    );
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sourceFile) === "errorDescription" &&
      !isWrittenFromTheTable(node.initializer)
    ) {
      found.push(findingAt(sourceFile, node));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
};

describe("what a failed request means", () => {
  test("every explanation is found by a part long enough to be its own", () => {
    expect(DESCRIPTION_PARTS).toHaveLength(
      Object.keys(REQUEST_FAILURE_DESCRIPTIONS).length,
    );

    for (const part of DESCRIPTION_PARTS) {
      expect({ part, long: part.length >= 15 }).toEqual({ part, long: true });
    }
  });

  test("is written only by its table", () => {
    const written: Array<string> = [];

    for (const root of SENTENCE_SCAN_ROOTS) {
      for (const file of listSourceFiles(path.join(REPOSITORY_ROOT, root))) {
        const relativeFile: string = toRelativePath(REPOSITORY_ROOT, file);

        if (relativeFile === DESCRIPTIONS_FILE || isTestFile(relativeFile)) {
          continue;
        }

        const source: string = fs.readFileSync(file, "utf-8");

        for (const part of DESCRIPTION_PARTS) {
          if (!source.includes(part)) {
            continue;
          }

          for (const finding of findWrittenSentence(file, source, part)) {
            written.push(`${relativeFile}:${finding.line} ${finding.text}`);
          }
        }
      }
    }

    expect(written).toEqual([]);
  });

  test("the table is where the scan says", () => {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, DESCRIPTIONS_FILE),
      "utf-8",
    );

    for (const part of DESCRIPTION_PARTS) {
      expect({
        part,
        found: findWrittenSentence(DESCRIPTIONS_FILE, source, part).length > 0,
      }).toEqual({ part, found: true });
    }
  });

  test("negative control: the explanations as the checks wrote them by hand are found", () => {
    const source: string = `
      // DNS resolution failed. The hostname could not be resolved to an IP address.
      const a = { errorDescription: "DNS resolution failed. The hostname could not be resolved to an IP address. Please verify the hostname is correct and that DNS is working properly." };
      let description = \`Server responded with HTTP status \${status}.\`;
      description += " This indicates a server-side error.";
      const b = \`Request failed: \${API.getFriendlyErrorMessage(error)}\`;
      const c = "The port check failed because of a network error.";
    `;
    const found: Array<number> = [];

    for (const part of DESCRIPTION_PARTS) {
      for (const finding of findWrittenSentence("Old.ts", source, part)) {
        found.push(finding.line);
      }
    }

    expect(Array.from(new Set(found)).sort()).toEqual([3, 4, 5, 6, 7]);
  });

  test.each(DESCRIPTION_WRITERS)(
    "%s sets every errorDescription from the table",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf-8",
      );

      expect(source).toMatch(
        /import \{\s*RequestFailureDescription,\s*writeRequestFailureDescription,\s*\} from "(?:Common\/Utils\/Monitor|\.\/Monitor)\/RequestFailureDescriptions";/,
      );
      expect(findHandWrittenDescriptions(file, source)).toEqual([]);
      expect(source.split(`${DESCRIPTION_WRITER}(`).length - 1).toBeGreaterThan(
        0,
      );
    },
  );

  test("negative control: an errorDescription set by hand is found, one from the table is not", () => {
    const source: string = `
      const a = {
        errorDescription: "The port check failed because of a network error.",
      };
      const b = {
        errorDescription: isInvalid
          ? \`The monitor's target is not a valid HTTP or HTTPS destination. \${raw}\`
          : writeRequestFailureDescription(RequestFailureDescription.TargetUnreachable),
      };
      const c = { errorDescription: description };
      const d = {
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.PortNetworkError,
        ),
      };
      const e = {
        errorDescription: isInvalid
          ? writeRequestFailureDescription(RequestFailureDescription.InvalidTarget, { message: raw })
          : writeRequestFailureDescription(RequestFailureDescription.TargetUnreachable),
      };
    `;

    expect(
      findHandWrittenDescriptions("Old.ts", source).map(
        (finding: Finding): number => {
          return finding.line;
        },
      ),
    ).toEqual([3, 6, 10]);
  });
});

/*
 * WHY A CHECK FAILED, WITH THE VALUES IT FOUND (#8267): the NTP check's
 * causes, the probe-side failures ProbeNetworkFailureUtil describes and the
 * AggregateError sentence. Written by hand, a sentence is one no view reads
 * back, and it reads English on every page.
 */

const CAUSES_FILE: string =
  "packages/Common/Utils/Monitor/ProbeFailureCauses.ts";

/*
 * The checks, and the utilities, that write a cause with values - and what
 * a data source's failed answer says (DataSource/HttpFailure), which says
 * how many times it asked as a check does, for Dataverse's client and every
 * other collector.
 */
const CAUSE_WRITERS: ReadonlyArray<string> = [
  "packages/Common/Utils/ProbeNetworkFailureUtil.ts",
  "packages/Common/Types/Monitor/NtpMonitor/NtpMonitorUtil.ts",
  "packages/Common/Server/Utils/DataSource/HttpFailure.ts",
  "packages/Probe/Utils/Monitors/MonitorTypes/NetworkPathMonitor.ts",
  "packages/Probe/Utils/Monitors/MonitorTypes/NtpMonitor.ts",
  "packages/Probe/Utils/Monitors/MonitorTypes/WebsiteMonitor.ts",
  "packages/Probe/Utils/Monitors/MonitorTypes/ApiMonitor.ts",
  "packages/Probe/Utils/Monitors/MonitorTypes/PortMonitor.ts",
  "packages/Probe/Utils/Monitors/MonitorTypes/PingMonitor.ts",
];

const CAUSE_WRITER: string = "writeProbeFailureCause";

/*
 * A literal this long that a fixed piece holds is that piece, cut short: a
 * hand-written sentence may leave its stop or its space to a neighbour.
 */
const PIECE_OF_A_PIECE_LENGTH: number = 12;

// A piece of words, not of punctuation: "Could not resolve ", " Tried ".
const WORDS_PIECE_LENGTH: number = 5;

/*
 * A cause of one piece is found by that piece whole, so it is its own:
 * "Server returned ", " Monitor ID: ".
 */
const OWN_PIECE_LENGTH: number = 12;

/*
 * Causes the scan does not look for, as their one piece is anybody's words:
 * the runtime writes a thrown error's name before its message ("Error: "),
 * and " Monitor ID: " is in the server's own log lines. The Ping check is
 * held to writing its message from the table below instead.
 */
const NOT_SCANNED: ReadonlySet<string> = new Set<string>([
  PROBE_FAILURE_CAUSES[ProbeFailureCause.ThrownError],
  PROBE_FAILURE_CAUSES[ProbeFailureCause.PingProbeSide],
]);

// Each cause's fixed pieces, in order: what its sentence is besides its values.
const CAUSE_PIECES: ReadonlyArray<{ english: string; pieces: Array<string> }> =
  [
    ...Object.values(PROBE_FAILURE_CAUSES).filter(
      (english: string): boolean => {
        return !NOT_SCANNED.has(english);
      },
    ),
    NTP_NO_REPLY_IGNORED_PACKETS.one,
  ].map((english: string): { english: string; pieces: Array<string> } => {
    return {
      english,
      pieces: english
        .split(PLACEHOLDER_IN_TEMPLATE)
        .filter((piece: string): boolean => {
          return piece.trim().length > 0;
        }),
    };
  });

/*
 * Whether the texts of one literal - a string, or a template's head, middles
 * and tail - write `pieces` by hand: every fixed piece of the cause, in
 * order (one text may hold several). Fewer is anybody's words: " within ",
 * " failed: " and "." are in hundreds of sentences, and describe()'s " was
 * never contacted. The failure is on the probe, not on " is in what a
 * failed request means too (RequestFailureDescriptions).
 */
const writesPieces: (
  texts: ReadonlyArray<string>,
  pieces: ReadonlyArray<string>,
) => boolean = (
  texts: ReadonlyArray<string>,
  pieces: ReadonlyArray<string>,
): boolean => {
  let next: number = 0;

  for (const text of texts) {
    let from: number = 0;

    while (next < pieces.length) {
      const piece: string = pieces[next] as string;
      const at: number = text.indexOf(piece, from);

      if (at !== -1) {
        // The rest of this text may hold the next piece too.
        next += 1;
        from = at + piece.length;
        continue;
      }

      // A piece cut short is most of it: "AggregateError" alone is a name.
      if (
        from === 0 &&
        text.trim().length > 0 &&
        text.length >= Math.max(PIECE_OF_A_PIECE_LENGTH, piece.length / 2) &&
        piece.includes(text)
      ) {
        next += 1;
      }

      break;
    }
  }

  return next === pieces.length;
};

// Every literal of a source that writes a cause by hand.
const findHandWrittenCauses: (
  fileName: string,
  source: string,
) => Array<Finding> = (fileName: string, source: string): Array<Finding> => {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  const found: Array<Finding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    let texts: Array<string> | null = null;

    if (ts.isTemplateExpression(node)) {
      texts = [
        node.head.text,
        ...node.templateSpans.map((span: ts.TemplateSpan): string => {
          return span.literal.text;
        }),
      ];
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      texts = [node.text];
    }

    if (
      texts &&
      CAUSE_PIECES.some(
        (cause: { english: string; pieces: Array<string> }): boolean => {
          return writesPieces(texts as Array<string>, cause.pieces);
        },
      )
    ) {
      found.push(findingAt(sourceFile, node));
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
};

describe("why a check failed, with the values it found", () => {
  test("every cause has pieces the scan can find it by", () => {
    for (const cause of CAUSE_PIECES) {
      expect({
        english: cause.english,
        // Two pieces to find it by, one of them words, or one long enough to be its own.
        findable:
          (cause.pieces.length >= 2 &&
            cause.pieces.some((piece: string): boolean => {
              return piece.trim().length >= WORDS_PIECE_LENGTH;
            })) ||
          (cause.pieces.length === 1 &&
            (cause.pieces[0] as string).length >= OWN_PIECE_LENGTH),
      }).toEqual({ english: cause.english, findable: true });
    }
  });

  test("is written only by its table", () => {
    const written: Array<string> = [];

    for (const root of SENTENCE_SCAN_ROOTS) {
      for (const file of listSourceFiles(path.join(REPOSITORY_ROOT, root))) {
        const relativeFile: string = toRelativePath(REPOSITORY_ROOT, file);

        if (relativeFile === CAUSES_FILE || isTestFile(relativeFile)) {
          continue;
        }

        const source: string = fs.readFileSync(file, "utf-8");

        for (const finding of findHandWrittenCauses(file, source)) {
          written.push(`${relativeFile}:${finding.line} ${finding.text}`);
        }
      }
    }

    expect(written).toEqual([]);
  });

  test("the table is where the scan says", () => {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, CAUSES_FILE),
      "utf-8",
    );

    expect(
      findHandWrittenCauses(CAUSES_FILE, source).length,
    ).toBeGreaterThanOrEqual(CAUSE_PIECES.length);
  });

  test("negative control: the causes as the checks wrote them by hand are found, a comment and a lone piece are not", () => {
    const source: string = `
      // No NTP reply from \${target} within \${seconds}.
      const a = \`Looking up \${data.host} did not finish within \${formatSeconds(data.timeoutInMs)}.\`;
      let b = \`No NTP reply from \${target} within \${formatSeconds(data.timeoutInMs)}.\`;
      b += \` The probe ignored \${n === 1 ? "a packet" : \`\${n} packets\`} that did not answer its request: \${r}.\`;
      const c = \`Could not resolve \${data.host} (\${code}).\`;
      const d = \`\${target} refused the request: nothing is listening for NTP on UDP port \${port} there (ICMP port unreachable).\`;
      const e = \`The NTP request to \${target} failed: \${raw}.\`;
      const f = \`\${failureCause} Tried \${attemptCount} times.\`;
      const g = \`This probe has no route to \${host}: \${detail}.\`;
      const h = \`This probe cannot send IPv6 traffic (\${detail}), so \${host} was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether \${host} is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.\`;
      const i = "Request failed with AggregateError (all connection attempts failed). " + cause;
      const j = \`The check did not finish within \${seconds}.\`;
      const k = "Could not resolve the name.";
    `;

    expect(
      findHandWrittenCauses("Old.ts", source).map(
        (finding: Finding): number => {
          return finding.line;
        },
      ),
    ).toEqual(
      /*
       * Line 5 is the second half of line 4's sentence, added on its own: the
       * sentence is found by its first half.
       */
      [3, 4, 6, 7, 8, 9, 10, 11, 12],
    );
  });

  // #8656: the NTP, Ping, Traceroute and attempt causes as written by hand.
  test("negative control: the other causes as the checks wrote them by hand are found, the runtime's prefix is not", () => {
    const source: string = `
      const a = \`The server answered with a kiss-o'-death (\${code}): \${meaning}.\`;
      const b = "The server answered, but its reply carried no usable time.";
      const c = \`The server reports stratum \${stratum}: it is not synchronized to a time source.\`;
      const d = \`Server returned \${result.responseStatusCode}\`;
      const e = \`ICMP ping is not usable on this probe: \${output.substring(0, 200)}\`;
      const f = \`No ICMP echo reply from \${hostAddress} (\${packetCount} sent)\`;
      const h = \`Traceroute could not run: \${clause}.\`;
      const i = \`this probe may have no route to \${host} (\${detail}); \${host} itself may also be down\`;
      const j = \`Error: \${message}\`;
      const k = "The server answered.";
    `;

    expect(
      findHandWrittenCauses("Old.ts", source).map(
        (finding: Finding): number => {
          return finding.line;
        },
      ),
    ).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  // The causes the scan leaves out, held to the table where they are written.
  test("the Ping check writes the message it throws from the table", () => {
    const source: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/Probe/Utils/Monitors/MonitorTypes/PingMonitor.ts",
      ),
      "utf-8",
    );

    expect(source).toContain("ProbeFailureCause.PingProbeSide");
    expect(source).toContain("ProbeFailureCause.PingUnableToReachHost");
    expect(source).not.toMatch(/Monitor ID: \$\{/);
  });

  test.each(CAUSE_WRITERS)(
    "%s writes its causes from the table",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf-8",
      );

      expect(source).toMatch(
        /import \{[^}]*\bProbeFailureCause\b[^}]*\bwriteProbeFailureCause\b[^}]*\} from "(?:Common\/Utils\/Monitor|\.\/Monitor|(?:\.\.\/){3}Utils\/Monitor)\/ProbeFailureCauses";/,
      );
      expect(source.split(`${CAUSE_WRITER}(`).length - 1).toBeGreaterThan(0);
      expect(findHandWrittenCauses(file, source)).toEqual([]);
    },
  );
});
