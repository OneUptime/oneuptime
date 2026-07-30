import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Monitor Template view drives sync / link / unlink through raw
 * `API.post` calls rather than ModelAPI, because those endpoints are custom
 * routes rather than model CRUD. `BaseAPI.getHeaders()` does NOT add a
 * `tenantid` header — `ModelAPI.getCommonHeaders()` is the only thing in the
 * codebase that does. So a raw post that omits it reaches the server with no
 * project scope at all.
 *
 * That is not a harmless omission. `getUserMiddleware` resolves the project
 * only from ProjectMiddleware.getProjectId (params / query / `tenantid` /
 * `projectid` / body.projectId), and these routes carry only
 * `:monitorTemplateId`. With no project it never populates
 * `userTenantAccessPermission`, so the permission-checked MonitorTemplate
 * read inside the sync service sees only the global permissions and fails
 * with "You do not have permissions to read Monitor Template. You need one
 * of these permissions: Project Owner, ..." — a message that sends project
 * owners hunting for a role they already hold.
 *
 * All six calls shipped without the header. This pins every one of them: the
 * component is a React page with no extractable logic, and the App suite runs
 * in a plain Node environment with no renderer, so this reads the source the
 * same way the sibling *Invariants tests do.
 */

const MONITOR_TEMPLATES_VIEW: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Monitor",
  "Settings",
  "MonitorTemplatesView.tsx",
);

/*
 * Comments are stripped so the prose above (which quotes both the endpoint
 * paths and `getCommonHeaders`) cannot satisfy an assertion about the code,
 * and whitespace is squashed so prettier re-wrapping a call cannot turn a
 * real regression check into a red herring.
 */
function readCode(): string {
  const raw: string = fs.readFileSync(MONITOR_TEMPLATES_VIEW, "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

/*
 * Every raw `API.post({ ... })` argument object in the file, as source text.
 * Brace-matched rather than regex-matched so nested objects (`data: {...}`)
 * do not truncate the capture. The lookbehind keeps `ModelAPI.post` out of the
 * results — that one attaches the tenant header itself, so requiring an
 * explicit `headers` on it would be wrong.
 */
function getApiPostArguments(code: string): Array<string> {
  const calls: Array<string> = [];
  const marker: RegExp = /(?<![A-Za-z])API\.post<[^>]*>\(\s*\{/g;

  let match: RegExpExecArray | null = marker.exec(code);

  while (match !== null) {
    const openIndex: number = code.indexOf("{", match.index);
    let depth: number = 0;
    let end: number = -1;

    for (let i: number = openIndex; i < code.length; i++) {
      if (code[i] === "{") {
        depth++;
      } else if (code[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) {
      throw new Error("Unbalanced braces in an API.post call argument.");
    }

    calls.push(code.slice(openIndex, end + 1));
    match = marker.exec(code);
  }

  return calls;
}

describe("Monitor Template sync/link endpoints send the tenant header", () => {
  test("the file still drives these endpoints through raw API.post", () => {
    const code: string = readCode();

    /*
     * Guard the guard: if the page is ever migrated off raw API.post, the
     * assertions below would vacuously pass over an empty list.
     */
    const calls: Array<string> = getApiPostArguments(code);

    expect(calls.length).toBe(6);
    expect(code).toContain("/sync-to-linked-monitors");
    expect(code).toContain("/sync-to-monitor/");
    expect(code).toContain("/link-monitor/");
    expect(code).toContain("/unlink-monitor/");
  });

  test("every API.post passes ModelAPI.getCommonHeaders() so tenantid is sent", () => {
    const calls: Array<string> = getApiPostArguments(readCode());

    const sendsTenantHeader: RegExp = new RegExp(
      "headers:\\s*(\\{\\s*\\.\\.\\.\\s*)?ModelAPI\\.getCommonHeaders\\(",
    );

    const missing: Array<string> = calls.filter((call: string) => {
      return !sendsTenantHeader.test(call);
    });

    expect(missing).toEqual([]);
  });

  test("each of the four monitor-template routes is covered", () => {
    const calls: Array<string> = getApiPostArguments(readCode());

    const routes: Array<string> = [
      "/sync-to-linked-monitors",
      "/sync-to-monitor/",
      "/link-monitor/",
      "/unlink-monitor/",
    ];

    for (const route of routes) {
      const callsForRoute: Array<string> = calls.filter((call: string) => {
        return call.includes(route);
      });

      expect(callsForRoute.length).toBeGreaterThan(0);

      for (const call of callsForRoute) {
        expect(call).toContain("ModelAPI.getCommonHeaders(");
      }
    }
  });
});
