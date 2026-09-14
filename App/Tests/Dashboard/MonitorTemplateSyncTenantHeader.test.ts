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
 * All six calls the page had at the time shipped without the header, and a new
 * sync button is exactly the thing that reintroduces it. This pins every one
 * of them: the component is a React page with no extractable logic, and the
 * App suite runs in a plain Node environment with no renderer, so this reads
 * the source the same way the sibling *Invariants tests do.
 *
 * Nothing below is a tally of how many calls the page happens to have today.
 * An earlier version of this file asserted `toBe(7)` and had already been
 * hand-edited from 6 to 7 by the commit that added a sync card — a test that
 * every unrelated feature has to come and correct is a test that will be
 * corrected without being read. What is pinned instead is that every raw post
 * the file contains is one this suite could parse and did check.
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

const MONITOR_TEMPLATE_ROUTES: Array<string> = [
  "/sync-to-linked-monitors",
  "/sync-to-monitor/",
  "/link-monitor/",
  "/unlink-monitor/",
];

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
 * explicit `headers` on it would be wrong. The generic argument is optional
 * because dropping it is a legal way to write the same call, and a call this
 * function skips is a call nothing below checks.
 */
function getApiPostArguments(code: string): Array<string> {
  const calls: Array<string> = [];
  const marker: RegExp = /(?<![A-Za-z])API\.post\s*(?:<[^();{}]*>)?\s*\(\s*\{/g;

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

/*
 * One expression, from `start` up to the character that ends it at the top
 * level — `stop` itself, or a closing bracket belonging to something that
 * encloses it. Walked rather than regexed so a nested object, a call argument
 * or a template literal inside the value cannot truncate it.
 */
function readExpression(text: string, start: number, stop: string): string {
  let depth: number = 0;

  for (let index: number = start; index < text.length; index++) {
    const character: string = text[index]!;

    if (character === "(" || character === "[" || character === "{") {
      depth++;
    } else if (character === ")" || character === "]" || character === "}") {
      if (depth === 0) {
        return text.slice(start, index).trim();
      }

      depth--;
    } else if (character === stop && depth === 0) {
      return text.slice(start, index).trim();
    }
  }

  return text.slice(start).trim();
}

/*
 * The source text of one property of an object literal, or null when the
 * object does not set it. Only the object's own top level is considered, so a
 * `url:` nested inside `data:` could not be mistaken for the call's own.
 */
function readProperty(objectText: string, name: string): string | null {
  let depth: number = 0;

  for (let index: number = 0; index < objectText.length; index++) {
    const character: string = objectText[index]!;

    if (character === "(" || character === "[" || character === "{") {
      depth++;
    } else if (character === ")" || character === "]" || character === "}") {
      depth--;
    } else if (depth === 1 && objectText.startsWith(`${name}:`, index)) {
      const before: string = objectText.slice(0, index).trimEnd().slice(-1);

      if (before === "{" || before === ",") {
        return readExpression(objectText, index + name.length + 1, ",");
      }
    }
  }

  return null;
}

/*
 * What an identifier is bound to in this file, as source text — or null when
 * the file does not declare it (an import, a prop, a destructured hook result)
 * or declares it more than once. Ambiguity has to read as "cannot tell", since
 * resolving to whichever declaration happens to come first would attribute a
 * call to a route it never posts to.
 */
function readDeclaration(code: string, identifier: string): string | null {
  const pattern: string = `\\b(?:const|let|var|function)\\s+${identifier}\\b`;
  const declarations: RegExpMatchArray | null = code.match(
    new RegExp(pattern, "g"),
  );

  if (declarations === null || declarations.length !== 1) {
    return null;
  }

  const start: number = new RegExp(pattern).exec(code)!.index;

  if (code.startsWith("function", start)) {
    const bodyStart: number = code.indexOf("{", start);
    let depth: number = 0;

    for (let i: number = bodyStart; i < code.length; i++) {
      if (code[i] === "{") {
        depth++;
      } else if (code[i] === "}") {
        depth--;
        if (depth === 0) {
          return code.slice(start, i + 1);
        }
      }
    }

    return null;
  }

  return readExpression(code, start, ";");
}

/*
 * Whether one `API.post` argument object posts to `route`.
 *
 * The route is normally spelled inline in the `url:` template literal, which
 * is why a plain `call.includes(route)` used to be enough. It is not enough to
 * rely on: the four bulk-sync calls build byte-identical URLs, and hoisting
 * that into one shared const or builder is an obvious cleanup that must not
 * cost this page its header coverage. So when the route is not in the call
 * itself, each identifier the `url:` expression mentions is resolved once
 * against this file's declarations and the route is looked for there.
 */
function postsToRoute(call: string, code: string, route: string): boolean {
  const url: string | null = readProperty(call, "url");

  if (url === null) {
    return false;
  }

  if (url.includes(route)) {
    return true;
  }

  const identifiers: Array<string> = url.match(/[A-Za-z_$][\w$]*/g) || [];

  return identifiers.some((identifier: string) => {
    const declaration: string | null = readDeclaration(code, identifier);

    return declaration !== null && declaration.includes(route);
  });
}

describe("Monitor Template sync/link endpoints send the tenant header", () => {
  test("the file still drives these endpoints through raw API.post", () => {
    const code: string = readCode();

    /*
     * Guard the guard. Two ways this suite could go quiet: the page migrates
     * off raw API.post entirely, and the assertions below pass vacuously over
     * an empty list; or a post is written in a shape getApiPostArguments does
     * not match, and that one call slips past the header check while the rest
     * keep the suite green. The second is the one that actually happened to
     * the sibling route sweep, so both are pinned here — every mention of
     * `API.post` in the file has to be a call this suite parsed and will
     * check, and there have to be at least as many of them as there are
     * routes. Neither number needs editing when a sync card is added.
     */
    const calls: Array<string> = getApiPostArguments(code);
    const mentions: number = (code.match(/(?<![A-Za-z])API\.post\b/g) || [])
      .length;

    expect(mentions).toBeGreaterThanOrEqual(MONITOR_TEMPLATE_ROUTES.length);
    expect(calls.length).toBe(mentions);

    for (const route of MONITOR_TEMPLATE_ROUTES) {
      expect(code).toContain(route);
    }
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

  /*
   * The per-route pass says the same thing from the other side: it is not
   * enough that the calls this suite happened to find all carry the header —
   * each of the four endpoints has to still be reachable from a call that
   * does. A route left with no attributable call means either the feature was
   * removed or its URL is now built somewhere this file cannot follow, and
   * both deserve a look.
   */
  test("each of the four monitor-template routes is covered", () => {
    const code: string = readCode();
    const calls: Array<string> = getApiPostArguments(code);

    for (const route of MONITOR_TEMPLATE_ROUTES) {
      const callsForRoute: Array<string> = calls.filter((call: string) => {
        return postsToRoute(call, code, route);
      });

      expect(callsForRoute.length).toBeGreaterThan(0);

      for (const call of callsForRoute) {
        expect(call).toContain("ModelAPI.getCommonHeaders(");
      }
    }
  });
});
