import {
  EXCEPTION_ERROR_CLASS_COLUMN,
  EXCEPTION_FIELD_ALIASES,
  ExceptionFieldFilters,
  ResolvedExceptionErrorClasses,
  canonicalizeExceptionErrorClass,
  parseExceptionSearch,
  resolveExceptionErrorClasses,
  splitExceptionFieldPredicates,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionsSearchQuery";
import ErrorClass, {
  NON_ACTIONABLE_ERROR_CLASSES,
} from "Common/Types/Telemetry/ErrorClass";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

function resolveClasses(query: string): ResolvedExceptionErrorClasses {
  return resolveExceptionErrorClasses(
    parseExceptionSearch(query).fieldPredicates[EXCEPTION_ERROR_CLASS_COLUMN] ||
      [],
  );
}

describe("class: tokens never reach the ClickHouse instance scope", () => {
  /*
   * THE HIGHEST-VALUE ASSERTION IN THIS FILE, and the least obvious failure.
   *
   * `errorClass` lives on the Postgres TelemetryException group. It does NOT
   * exist on the ClickHouse ExceptionInstance table. Any predicate the viewer
   * cannot express against Postgres is resolved by a groupBy-fingerprint
   * pre-query against ClickHouse — so if an operator-bearing `class:` token
   * were routed there, that query would fail against a column that does not
   * exist, the catch path would keep the empty-fingerprint sentinel, and the
   * ENTIRE Issues list would go blank.
   *
   * The user-visible symptom of that regression is "typing a perfectly
   * ordinary negation empties the page", with no error anywhere.
   */
  test.each([
    ["a negation", "-class:user-error"],
    ["a glob", "class:user*"],
    ["a contains", "class:~denial"],
    ["a presence check", "class:*"],
    ["an any-of list", "class:(user-error OR code-fault)"],
    ["a plain equality", "class:user-error"],
  ])(
    "%s produces no errorClass entry in either bucket",
    (_name: string, query: string) => {
      const split: ExceptionFieldFilters = splitExceptionFieldPredicates(
        parseExceptionSearch(query).fieldPredicates,
      );

      expect(split.operators[EXCEPTION_ERROR_CLASS_COLUMN]).toBeUndefined();
      expect(split.literals[EXCEPTION_ERROR_CLASS_COLUMN]).toBeUndefined();

      /*
       * ...but the token WAS parsed, so the skip is a routing decision, not a
       * silently dropped filter.
       */
      expect(
        parseExceptionSearch(query).fieldPredicates[
          EXCEPTION_ERROR_CLASS_COLUMN
        ],
      ).toBeDefined();
    },
  );

  test("other columns still route normally, so the skip is not over-broad", () => {
    const split: ExceptionFieldFilters = splitExceptionFieldPredicates(
      parseExceptionSearch("type:ServerException -env:staging").fieldPredicates,
    );

    expect(split.literals["exceptionType"]).toEqual(["ServerException"]);
    expect(split.operators["environment"]).toBeDefined();
  });
});

describe("class: aliases", () => {
  test.each([
    ["class", "class:user-error"],
    ["errorclass", "errorclass:user-error"],
  ])("%s: maps to the errorClass column", (_alias: string, query: string) => {
    expect(
      parseExceptionSearch(query).fieldPredicates[EXCEPTION_ERROR_CLASS_COLUMN],
    ).toHaveLength(1);
  });

  test("both aliases are registered", () => {
    expect(EXCEPTION_FIELD_ALIASES["class"]).toBe(EXCEPTION_ERROR_CLASS_COLUMN);
    expect(EXCEPTION_FIELD_ALIASES["errorclass"]).toBe(
      EXCEPTION_ERROR_CLASS_COLUMN,
    );
  });
});

describe("resolveExceptionErrorClasses", () => {
  test("a plain equality includes exactly that class", () => {
    const resolved: ResolvedExceptionErrorClasses =
      resolveClasses("class:user-error");

    expect(resolved.includedClasses).toEqual([ErrorClass.UserError]);
    expect(resolved.excludedClasses).toEqual([]);
    expect(resolved.matchedNothing).toBe(false);
  });

  test("the typed value is canonicalised for case", () => {
    expect(resolveClasses("class:User-Error").includedClasses).toEqual([
      ErrorClass.UserError,
    ]);
    expect(canonicalizeExceptionErrorClass("CODE-FAULT")).toBe(
      ErrorClass.CodeFault,
    );
  });

  /*
   * THE FAIL-SAFE. A negation must compile to an EXCLUSION, never to an
   * allow-list of the other four known classes — otherwise a row carrying a
   * class this build has not heard of (written by a newer release, or echoed
   * by the triage runner) silently disappears from exactly the view whose job
   * is to surface unclassified failures.
   */
  test("a negation excludes rather than allow-listing the rest", () => {
    const resolved: ResolvedExceptionErrorClasses =
      resolveClasses("-class:user-error");

    expect(resolved.includedClasses).toBeNull();
    expect(resolved.excludedClasses).toEqual([ErrorClass.UserError]);
    expect(resolved.matchedNothing).toBe(false);
  });

  test("a class from a future release survives a negation of a different class", () => {
    const resolved: ResolvedExceptionErrorClasses =
      resolveClasses("-class:user-error");

    expect(resolved.excludedClasses).not.toContain("some-future-class");
    expect(resolved.includedClasses).toBeNull();
  });

  test("an unknown class typed as an equality is kept verbatim", () => {
    expect(resolveClasses("class:brand-new-class").includedClasses).toEqual([
      "brand-new-class",
    ]);
  });

  test("a glob matches against the known vocabulary", () => {
    expect(resolveClasses("class:*denial*").includedClasses).toEqual([
      ErrorClass.ExpectedDenial,
    ]);
  });

  test("a glob that matches nothing reports matchedNothing, not 'no constraint'", () => {
    const resolved: ResolvedExceptionErrorClasses =
      resolveClasses("class:nope*");

    expect(resolved.matchedNothing).toBe(true);
    expect(resolved.includedClasses).toBeNull();
  });

  /*
   * Repeated positives AND, like every other repeated filter in this viewer.
   * Two mutually exclusive classes must narrow to nothing rather than quietly
   * widening to either — a filter that shows MORE rows than asked for is the
   * one failure users never notice.
   */
  test("two contradicting positive tokens narrow to nothing", () => {
    const resolved: ResolvedExceptionErrorClasses = resolveClasses(
      "class:user-error class:code-fault",
    );

    expect(resolved.matchedNothing).toBe(true);
    expect(resolved.includedClasses).toEqual([]);
  });

  test("no class token at all leaves the column unconstrained", () => {
    const resolved: ResolvedExceptionErrorClasses = resolveClasses(
      "type:ServerException",
    );

    expect(resolved.includedClasses).toBeNull();
    expect(resolved.excludedClasses).toEqual([]);
    expect(resolved.matchedNothing).toBe(false);
  });
});

/*
 * Source-level assertions, in the same style as the existing
 * ExceptionsSearchQuery wiring tests. These guard decisions that are invisible
 * to a type check and that a refactor could plausibly "simplify" into a bug.
 */
describe("Issues list default scope wiring", () => {
  const DASHBOARD_SRC: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
  );

  function read(relativePath: string): string {
    return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
  }

  /*
   * IncludesNone compiles to SQL `NOT IN (...)`, and `NULL NOT IN (...)` is
   * NULL — falsy. The errorClass column is NOT NULL DEFAULT 'unknown' exactly
   * so that an unclassified row still passes this predicate and stays an
   * Issue. Swapping to `Includes` of the actionable classes would look
   * equivalent and would instead HIDE every class the list does not enumerate,
   * including 'unknown'.
   */
  test("the default lens uses IncludesNone, never Includes", () => {
    const source: string = read("Components/Exceptions/ExceptionsViewer.tsx");

    expect(source).toContain("IncludesNone");
    expect(source).toContain("NON_ACTIONABLE_ERROR_CLASSES");
    expect(source).not.toMatch(
      /new Includes\(\s*\[?\s*\.\.\.NON_ACTIONABLE_ERROR_CLASSES/,
    );
  });

  /*
   * The badge and the list it labels must not drift apart: a tab reading
   * "12 unresolved" over a list showing 3 is worse than no badge at all.
   */
  test("the unresolved badge count carries the same class scope as the list", () => {
    const source: string = read("Components/Exceptions/ExceptionsNavTabs.tsx");

    expect(source).toContain("IncludesNone");
    expect(source).toContain("NON_ACTIONABLE_ERROR_CLASSES");
  });

  /*
   * A stale `class=user-errors` left in the address bar would re-apply on
   * refresh and travel in every shared link. `class` is not registered in
   * TelemetryViewerUrlParamNames, so the writer cannot delete it implicitly —
   * it has to pass an explicit null on the default scope.
   */
  test("the URL writer explicitly clears class on the default scope", () => {
    const source: string = read("Components/Exceptions/ExceptionsViewer.tsx");

    expect(source).toMatch(
      /class:\s*classScope === DEFAULT_EXCEPTION_CLASS_SCOPE \? null : classScope/,
    );
  });

  test("the class control is rendered as a visible toolbar action, not a hidden predicate", () => {
    const source: string = read("Components/Exceptions/ExceptionsViewer.tsx");

    expect(source).toContain("toolbarLeadingActions");
    expect(source).toContain("classPills");
  });
});

describe("the suppressed set", () => {
  /*
   * Pinned here as well as in Common's unit tests because this is the list the
   * DASHBOARD hides by default. Adding 'infrastructure' or 'unknown' to it
   * would silently drop real failures out of the Issues list.
   */
  test("is exactly user-error and expected-denial", () => {
    expect([...NON_ACTIONABLE_ERROR_CLASSES].sort()).toEqual([
      ErrorClass.ExpectedDenial,
      ErrorClass.UserError,
    ]);
  });
});
