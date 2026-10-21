import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The AI tools read telemetry for the person asking, so every read they
 * build by hand (the aggregation services and the attribute lookups, which
 * take no props) must carry that person's read scope - the services they
 * may read and the services a block takes away - as the /telemetry/*
 * routes do (TelemetryRoutesReadScope.test.ts). The scope comes from
 * TelemetryReadAccess; ToolArgs.scopeServiceIds turns it into the request's
 * serviceIds / excludedServiceIds.
 *
 * Reads through a model service (findBy, aggregateBy, ... with ctx.props)
 * are scoped by the analytics permission layer itself and are not checked
 * here.
 */

const TOOLBOX_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Utils/AI/Toolbox",
);

const HAND_BUILT_READS: RegExp =
  /\b(LogAggregationService|TraceAggregationService|ExceptionAggregationService|MetricAggregationService|ProfileAggregationService|TelemetryAttributeService)\.([A-Za-z]+)\(/g;

// A read handed a service filter worked out from the asker's scope.
const SERVICE_FILTER: RegExp = /\bserviceFilter\b/;

// The argument text of the call whose "(" is at `openIndex`.
function argumentText(source: string, openIndex: number): string {
  let depth: number = 0;

  for (let index: number = openIndex; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth--;
      if (depth === 0) {
        return source.slice(openIndex + 1, index);
      }
    }
  }

  return source.slice(openIndex + 1);
}

interface HandBuiltRead {
  file: string;
  call: string;
  argument: string;
}

function handBuiltReads(): Array<HandBuiltRead> {
  const reads: Array<HandBuiltRead> = [];

  for (const file of fs.readdirSync(TOOLBOX_DIRECTORY)) {
    if (!file.endsWith(".ts")) {
      continue;
    }

    const source: string = fs.readFileSync(
      path.join(TOOLBOX_DIRECTORY, file),
      "utf8",
    );

    let match: RegExpExecArray | null;
    HAND_BUILT_READS.lastIndex = 0;

    while ((match = HAND_BUILT_READS.exec(source))) {
      const openIndex: number = match.index + match[0].length - 1;
      reads.push({
        file: file,
        call: `${match[1]}.${match[2]}`,
        argument: argumentText(source, openIndex),
      });
    }
  }

  return reads;
}

describe("AI tools read telemetry within the asker's scope", () => {
  test("the toolbox has hand-built telemetry reads to check", () => {
    // A rename that hides every read from this check must fail it, not pass it.
    expect(handBuiltReads().length).toBeGreaterThanOrEqual(4);
  });

  test("every hand-built read carries the asker's service filter", () => {
    const unscoped: Array<string> = handBuiltReads()
      .filter((read: HandBuiltRead): boolean => {
        return !(
          read.argument.includes("ToolArgs.scopeServiceIds(") ||
          SERVICE_FILTER.test(read.argument)
        );
      })
      .map((read: HandBuiltRead): string => {
        return `${read.file}: ${read.call}`;
      });

    expect(unscoped).toEqual([]);
  });

  test("every file with a hand-built read works its scope out through TelemetryReadAccess", () => {
    const files: Set<string> = new Set(
      handBuiltReads().map((read: HandBuiltRead): string => {
        return read.file;
      }),
    );

    const withoutScope: Array<string> = Array.from(files).filter(
      (file: string): boolean => {
        return !fs
          .readFileSync(path.join(TOOLBOX_DIRECTORY, file), "utf8")
          .includes("TelemetryReadAccess.");
      },
    );

    expect(withoutScope).toEqual([]);
  });
});
