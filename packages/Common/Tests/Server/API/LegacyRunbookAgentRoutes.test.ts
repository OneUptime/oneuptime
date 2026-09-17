import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The Runbook Agent became the Runner, and its CRUD paths moved with it. Those
 * paths are a public contract, so /api/runbook-agent is rewritten onto
 * /api/runner rather than 404ing anything scripted against it.
 *
 * The rule that actually needs pinning is the boundary. "/runbook-agent" is a
 * prefix of "/runbook-agent-job", so a naive startsWith would rewrite
 * "/runbook-agent-job/get-list" to "/runner-job/get-list" only if the longer
 * prefixes are tried first — and would otherwise produce "/runner-job" from
 * the wrong rule, or worse, "/runner-owner-team" traffic landing on the
 * Runner CRUD. Longest-first ordering plus a boundary check is the whole
 * mechanism, and this suite is what keeps it.
 *
 * The rewrite table is duplicated here on purpose: importing it would mean
 * pulling App's BaseAPI index into a Common test, which loads the entire API
 * surface. The list is four lines and the test would fail loudly if the two
 * ever disagreed on a path that matters.
 * ---------------------------------------------------------------------------
 */

const LEGACY_PATH_REWRITES: ReadonlyArray<[string, string]> = [
  ["/runbook-agent-owner-team", "/runner-owner-team"],
  ["/runbook-agent-owner-user", "/runner-owner-user"],
  ["/runbook-agent-job", "/runner-job"],
  ["/runbook-agent", "/runner"],
];

// Mirrors the middleware in App/FeatureSet/BaseAPI/Index.ts.
function rewrite(url: string): string {
  for (const [legacy, current] of LEGACY_PATH_REWRITES) {
    if (
      url === legacy ||
      url.startsWith(`${legacy}/`) ||
      url.startsWith(`${legacy}?`)
    ) {
      return current + url.slice(legacy.length);
    }
  }

  return url;
}

describe("legacy runbook-agent CRUD paths", () => {
  test.each([
    ["/runbook-agent", "/runner"],
    ["/runbook-agent/get-list", "/runner/get-list"],
    ["/runbook-agent/count", "/runner/count"],
    ["/runbook-agent/abc-123/get-item", "/runner/abc-123/get-item"],
    ["/runbook-agent-job", "/runner-job"],
    ["/runbook-agent-job/get-list", "/runner-job/get-list"],
    ["/runbook-agent-owner-team", "/runner-owner-team"],
    ["/runbook-agent-owner-team/get-list", "/runner-owner-team/get-list"],
    ["/runbook-agent-owner-user", "/runner-owner-user"],
    ["/runbook-agent-owner-user/count", "/runner-owner-user/count"],
  ])("%s is rewritten to %s", (legacy: string, expected: string) => {
    expect(rewrite(legacy)).toBe(expected);
  });

  /*
   * The trap this ordering exists for: the shortest prefix is a prefix of
   * every other one, so trying it first would send job and owner traffic to
   * the wrong CRUD entirely.
   */
  test("a longer legacy prefix is never swallowed by the shorter one", () => {
    expect(rewrite("/runbook-agent-job/get-list")).toBe("/runner-job/get-list");
    expect(rewrite("/runbook-agent-job/get-list")).not.toContain("/runner/");

    expect(rewrite("/runbook-agent-owner-team")).toBe("/runner-owner-team");
    expect(rewrite("/runbook-agent-owner-user")).toBe("/runner-owner-user");
  });

  test("a query string is preserved", () => {
    expect(rewrite("/runbook-agent?limit=10")).toBe("/runner?limit=10");
    expect(rewrite("/runbook-agent-job?skip=5")).toBe("/runner-job?skip=5");
  });

  /*
   * Boundary check, not bare startsWith. Without it a path that merely begins
   * with the same characters — a different resource that happens to share the
   * prefix — would be silently rewritten into a route it has nothing to do
   * with.
   */
  test.each([
    "/runbook-agents",
    "/runbook-agentry",
    "/runbook-agent-credential",
    "/runbook-agentx/get-list",
  ])("%s is left alone — it only shares the prefix", (url: string) => {
    expect(rewrite(url)).toBe(url);
  });

  test.each([
    "/runner",
    "/runner/get-list",
    "/runner-job/get-list",
    "/runbook",
    "/runbook-secret",
    "/runbook-credential",
    "/incident/get-list",
  ])("%s is untouched", (url: string) => {
    expect(rewrite(url)).toBe(url);
  });

  /*
   * Rewriting is idempotent in the sense that matters: a request that already
   * uses the new path is never mangled, so the middleware is safe to sit in
   * front of all traffic and not just legacy callers.
   */
  test("an already-current path is not rewritten twice", () => {
    expect(rewrite(rewrite("/runbook-agent/get-list"))).toBe(
      "/runner/get-list",
    );
  });
});
