import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY REFUSAL OF TRY AGAIN AND INVESTIGATE NOW CARRIES ITS CODE (#7359).
 *
 * When the server will not start an AI run someone asked for - Try again
 * on an investigation or a triage that did not finish, Investigate now
 * while an investigation rule waits - the AI card shows why, under the
 * button. The Dashboard says it in the reader's language by the refusal's
 * code (Types/AI/AiRunRefusal), which the server sends beside its English
 * sentence (AiRunRefusalException). A refusal thrown as plain bad data, or
 * a sentence written in place, reaches a German or an Arabic page in
 * English again.
 *
 * So the places that refuse - InvestigationTryAgain, InvestigationRuleWait
 * (startNow), InsightTriage.tryAgain and the two routes of
 * AIInvestigationAPI - throw nothing but AiRunRefusalException, apart from
 * the few answers listed below with their reasons, and Investigate now's
 * refusal is written from its code.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(COMMON_ROOT, relativePath), "utf-8");
}

// `throw new SomethingException(`: what each place throws, by class name.
const THROWN_EXCEPTION: RegExp = /throw\s+new\s+([A-Za-z]+Exception)\s*\(/g;

function getThrownExceptions(source: string): Array<string> {
  return Array.from(source.matchAll(THROWN_EXCEPTION)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// The body of a route, from its path to the next route or the file's end.
function getRouteBody(source: string, routePath: string): string {
  const start: number = source.indexOf(`"${routePath}"`);

  if (start < 0) {
    return "";
  }

  const next: number = source.indexOf("router.post(", start);

  return source.slice(start, next < 0 ? source.length : next);
}

// A function's body, from its declaration to the next top-level function.
function getFunctionBody(source: string, declaration: string): string {
  const start: number = source.indexOf(declaration);

  if (start < 0) {
    return "";
  }

  const nextFunction: number = source.indexOf("\nasync function ", start + 1);
  const nextExport: number = source.indexOf("\nexport ", start + 1);
  const nextRoute: number = source.indexOf("\nrouter.", start + 1);
  const ends: Array<number> = [nextFunction, nextExport, nextRoute].filter(
    (index: number): boolean => {
      return index > start;
    },
  );

  return source.slice(start, ends.length ? Math.min(...ends) : source.length);
}

const REFUSING_FILES: ReadonlyArray<string> = [
  "Server/Utils/AI/SRE/InvestigationTryAgain.ts",
  "Server/Utils/AI/SRE/InvestigationRuleWait.ts",
  "Server/Utils/AI/SRE/Insights/Triage.ts",
];

const API_FILE: string = "Server/API/AIInvestigationAPI.ts";

// Investigate now's own English sentences, before #7359.
const START_NOW_SENTENCES: RegExp = /START_NOW_(?:FALLBACK_)?MESSAGES?\b/;

describe("what the refusing places throw", () => {
  test.each(REFUSING_FILES)(
    "%s throws nothing but AiRunRefusalException",
    (file: string) => {
      const thrown: Array<string> = getThrownExceptions(readSource(file));

      expect(
        thrown.filter((name: string): boolean => {
          return name !== "AiRunRefusalException";
        }),
      ).toEqual([]);
    },
  );

  test("InvestigationTryAgain and InsightTriage refuse with codes", () => {
    expect(
      getThrownExceptions(
        readSource("Server/Utils/AI/SRE/InvestigationTryAgain.ts"),
      ).length,
    ).toBeGreaterThanOrEqual(6);
    expect(
      getThrownExceptions(readSource("Server/Utils/AI/SRE/Insights/Triage.ts"))
        .length,
    ).toBeGreaterThanOrEqual(4);
  });

  test("Investigate now's refusal is written from its code, never a sentence in place", () => {
    const source: string = readSource(
      "Server/Utils/AI/SRE/InvestigationRuleWait.ts",
    );
    const startNowProblem: string = getFunctionBody(
      source,
      "function startNowProblem(",
    );

    expect(startNowProblem).toContain("refusalCode,");
    expect(startNowProblem).toContain(
      "message: getAiRunRefusalMessage(refusalCode)",
    );
    // No English sentence of its own: only the codes' table words it.
    expect(source).not.toMatch(START_NOW_SENTENCES);
  });

  test.each(["/ai-investigation/try-again", "/ai-investigation/investigate-now"])(
    "the %s route throws only coded refusals",
    (routePath: string) => {
      const body: string = getRouteBody(readSource(API_FILE), routePath);

      expect(body.length).toBeGreaterThan(0);
      expect(
        getThrownExceptions(body).filter((name: string): boolean => {
          return name !== "AiRunRefusalException";
        }),
      ).toEqual([]);
    },
  );

  test("the record check both routes make refuses with codes, apart from a malformed request", () => {
    const source: string = readSource(API_FILE);
    const readSubject: string = getFunctionBody(
      source,
      "async function readSubjectViewerMayInvestigate(",
    );
    const readable: string = getFunctionBody(
      source,
      "export async function assertSubjectReadableInTenant(",
    );

    /*
     * BadDataException: a request without a subjectType or subjectId,
     * which the Dashboard never sends. NotAuthorizedException: a 403 has no
     * code, and its sentence is the refusal's own (getNotAllowedRefusal),
     * which the Dashboard words by its text.
     */
    expect(getThrownExceptions(readSubject)).toEqual([
      "BadDataException",
      "BadDataException",
      "NotAuthorizedException",
    ]);
    expect(readSubject).toContain(
      "getAiRunRefusalMessage(getNotAllowedRefusal(subjectType, action))",
    );
    expect(getThrownExceptions(readable)).toEqual(["AiRunRefusalException"]);
  });
});

describe("the reading itself (negative controls)", () => {
  test("finds a plain refusal, as it was before #7359", () => {
    expect(
      getThrownExceptions(
        'if (!run) {\n  throw new BadDataException(\n    "This incident has no investigation to try again.",\n  );\n}\nthrow new AiRunRefusalException(code);',
      ),
    ).toEqual(["BadDataException", "AiRunRefusalException"]);
  });

  test("reads a route's body up to the next route", () => {
    const source: string =
      'router.post(\n  "/a",\n  () => { throw new BadDataException("a"); },\n);\nrouter.post(\n  "/b",\n  () => { throw new AiRunRefusalException(code); },\n);\n';

    expect(getThrownExceptions(getRouteBody(source, "/a"))).toEqual([
      "BadDataException",
    ]);
    expect(getThrownExceptions(getRouteBody(source, "/b"))).toEqual([
      "AiRunRefusalException",
    ]);
    expect(getRouteBody(source, "/c")).toBe("");
  });
});
