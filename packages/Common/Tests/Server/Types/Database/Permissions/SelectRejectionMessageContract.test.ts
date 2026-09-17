import fs from "fs";
import path from "path";
import AnalyticsModelPermission from "../../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import SelectPermission from "../../../../../Server/Types/Database/Permissions/SelectPermission";
import Log from "../../../../../Models/AnalyticsModels/Log";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../../../Types/Exception/Exception";
import ExceptionCode from "../../../../../Types/Exception/ExceptionCode";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * Every throw below is deliberate and asserted on, but @CaptureSpan hands each
 * one to Telemetry, which logs the whole stack. Mocking Logger keeps the run
 * readable; nothing under test is mocked.
 */
jest.mock("../../../../../Server/Utils/Logger");

/*
 * WHAT THIS FILE PINS
 *
 * When the API refuses a column in a select clause, the sentence it refuses
 * with is a wire contract, not prose. The generated Terraform provider parses
 * the column name back out of it and retries without that column, so that a
 * permission-gated column, or one belonging to a schema newer than the
 * deployment being talked to, costs one attribute instead of failing every
 * `terraform plan` against that resource.
 *
 * Issue #3414 was the half of that contract nobody had written down: the
 * provider understood the permission phrasing and not the unknown-column one,
 * so a provider released ahead of a server hard-failed. Nothing connected the
 * two sides, so nothing noticed.
 *
 * This connects them. It drives the real permission gates to produce the real
 * messages, encodes them the way Express encodes an error, and runs the
 * provider's own patterns - read out of the generator source, not copied -
 * against the result. Reword a message here, or narrow a pattern there, and
 * this fails instead of a customer's plan failing.
 *
 * The Go end of the contract (the retry loop that consumes these patterns) is
 * covered by Scripts/TerraformProvider/StaticFiles/client_test.go.
 */

const PROVIDER_GENERATOR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "Scripts",
  "TerraformProvider",
  "Core",
  "ProviderGenerator.ts",
);

/*
 * Hoisted: eslint's wrap-regex objects to a regex literal used as the object of
 * a member expression. PATTERN_BLOCK is not global so `.exec` keeps no state;
 * MUST_COMPILE is, and is therefore only ever used as a source to build a
 * fresh scanner from, never `.exec`d directly.
 */
const PATTERN_BLOCK: RegExp =
  /var droppableSelectColumnPatterns = \[\]\*regexp\.Regexp\{([\s\S]*?)\n\}/;
const MUST_COMPILE: RegExp = /regexp\.MustCompile\(\\`([^`]*)\\`\)/g;

/*
 * The patterns live in a Go raw-string literal nested inside a TS template
 * literal, so what is on disk is doubly escaped: a Go `\\?` is written `\\\\?`
 * in the source. Reading the source text and compiling it as-is would test a
 * regex the provider never runs - one that REQUIRES the backslash the shipped
 * one makes optional - which is exactly the class of mistake this file exists
 * to catch, so it is undone explicitly here.
 */
function unescapeTemplateLiteral(source: string): string {
  return source.replace(/\\\\/g, "\\");
}

/*
 * The select-rejection patterns the generator compiles into the provider's
 * client.go, as JS RegExps. Go's RE2 and JS agree on the syntax these use,
 * which is what makes running them here meaningful rather than decorative.
 */
function providerSelectPatterns(): Array<RegExp> {
  const source: string = fs.readFileSync(PROVIDER_GENERATOR, "utf-8");
  const block: RegExpExecArray | null = PATTERN_BLOCK.exec(source);

  if (!block) {
    throw new Error(
      `Could not find droppableSelectColumnPatterns in ${PROVIDER_GENERATOR}. ` +
        "If the provider's select-retry was restructured, this contract test " +
        "has to be pointed at wherever the patterns live now.",
    );
  }

  const patterns: Array<RegExp> = [];
  const scanner: RegExp = new RegExp(MUST_COMPILE.source, "g");
  let match: RegExpExecArray | null = scanner.exec(block[1] as string);
  while (match !== null) {
    patterns.push(new RegExp(unescapeTemplateLiteral(match[1] as string)));
    match = scanner.exec(block[1] as string);
  }
  return patterns;
}

/*
 * The first pattern to name a column in `text`, or null. This is the matching
 * step on its own, with no decoding in front of it.
 */
function columnMatchedInText(text: string): string | null {
  for (const pattern of providerSelectPatterns()) {
    const match: RegExpMatchArray | null = text.match(pattern);
    if (match) {
      return match[1] as string;
    }
  }
  return null;
}

/*
 * Mirrors the provider's apiErrorMessage: decode the body and take the first of
 * message / error / errorMessage, falling back to the bytes verbatim. Matching
 * the raw body instead was the original defect, so the test has to run the same
 * two steps in the same order rather than approximate them.
 */
function apiErrorMessage(body: string): string {
  try {
    const parsed: Record<string, unknown> = JSON.parse(body) as Record<
      string,
      unknown
    >;
    for (const key of ["message", "error", "errorMessage"]) {
      const value: unknown = parsed[key];
      if (typeof value === "string" && value !== "") {
        return value;
      }
    }
  } catch {
    // Not JSON. The provider falls back to the raw body; so do we.
  }
  return body.trim();
}

// What the provider would drop, given a response body. Null when it sees none.
function columnTheProviderWouldDrop(body: string): string | null {
  return columnMatchedInText(apiErrorMessage(body));
}

/*
 * Express serialises an Exception as a JSON object, so a quoted column name
 * reaches the provider with its quotes backslash-escaped. Every assertion below
 * goes through this rather than the bare message: the escaping is precisely
 * what the fix in #3414 had to survive, and the bare message hides it.
 *   Common/Server/Utils/StartServer.ts  -> { error: message }
 *   Common/Server/Utils/Response.ts     -> { message }
 */
function wireBody(envelope: "error" | "message", message: string): string {
  return JSON.stringify({ [envelope]: message });
}

function caught(runCheck: () => void): Exception {
  try {
    runCheck();
  } catch (err) {
    return err as Exception;
  }
  throw new Error("Expected the select gate to throw, but it returned.");
}

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

describe("select-rejection messages the Terraform provider parses", () => {
  describe("the patterns are readable from the generator", () => {
    it("finds the pattern list", () => {
      expect(providerSelectPatterns().length).toBeGreaterThanOrEqual(3);
    });

    it("every pattern captures exactly one group", () => {
      for (const pattern of providerSelectPatterns()) {
        expect(new RegExp(`|${pattern.source}`).exec("")).toHaveLength(2);
      }
    });

    /*
     * The patterns run against the DECODED message, so they must work on a
     * bare quote. Compiling the source text without undoing the TS template
     * escaping yields a regex that only matches an escaped quote - it passes
     * every wire-body assertion below and fails this one, which is precisely
     * the trap that shipped as issue #3414's suggested patch.
     */
    it("works on a bare quote, not only an escaped one", () => {
      const message: string =
        'Invalid select clause. Cannot select on "enableSearchEngineIndexing". This column does not exist on Status Page.';
      expect(columnMatchedInText(message)).toBe("enableSearchEngineIndexing");
    });

    // And still on an escaped one, for a body no decoder could unwrap.
    it("works on an escaped quote too", () => {
      const body: string = wireBody(
        "error",
        'Invalid select clause. Cannot select on "enableSearchEngineIndexing".',
      );
      expect(body).toContain('\\"enableSearchEngineIndexing\\"');
      expect(columnMatchedInText(body)).toBe("enableSearchEngineIndexing");
    });
  });

  describe("Postgres-backed models", () => {
    /*
     * A column the deployment has never heard of. This is the shape of the
     * skew in #3414: the provider is generated from a newer schema than the
     * server it is pointed at, so it selects a column that does not exist yet.
     */
    it("names the unknown column in a way the provider can recover", () => {
      const error: Exception = caught(() => {
        return SelectPermission.checkSelectPermission(
          StatusPage,
          { aColumnThisDeploymentHasNeverHeardOf: true } as never,
          makeProps([Permission.ProjectOwner]),
        );
      });

      expect(error.message).toContain("Cannot select on");
      for (const envelope of ["error", "message"] as const) {
        expect(
          columnTheProviderWouldDrop(wireBody(envelope, error.message)),
        ).toBe("aColumnThisDeploymentHasNeverHeardOf");
      }
    });

    it("returns that as a 400, which is a status the provider retries on", () => {
      const error: Exception = caught(() => {
        return SelectPermission.checkSelectPermission(
          StatusPage,
          { aColumnThisDeploymentHasNeverHeardOf: true } as never,
          makeProps([Permission.ProjectOwner]),
        );
      });

      expect(error.code).toBe(ExceptionCode.BadDataException);
      expect(error.code).toBe(400);
    });

    /*
     * A real column the caller's permissions do not reach. This phrasing has
     * always worked; it is here so a change made for the other one cannot
     * quietly break it.
     */
    it("names a permission-gated column in a way the provider can recover", () => {
      const error: Exception = caught(() => {
        return SelectPermission.checkSelectPermission(
          StatusPage,
          { enableSearchEngineIndexing: true } as never,
          makeProps([]),
        );
      });

      expect(error.message).toContain(
        "You do not have permissions to select on",
      );
      for (const envelope of ["error", "message"] as const) {
        expect(
          columnTheProviderWouldDrop(wireBody(envelope, error.message)),
        ).toBe("enableSearchEngineIndexing");
      }
    });

    it("returns that as a 422, which is also a status the provider retries on", () => {
      const error: Exception = caught(() => {
        return SelectPermission.checkSelectPermission(
          StatusPage,
          { enableSearchEngineIndexing: true } as never,
          makeProps([]),
        );
      });

      expect(error.code).toBe(ExceptionCode.NotAuthorizedException);
      expect(error.code).toBe(422);
    });

    it("keeps the column named in the message a real one", () => {
      /*
       * Guards the permission case above from silently becoming a second copy
       * of the unknown-column case if the column is ever removed.
       */
      expect(new StatusPage().getTableColumns().columns).toContain(
        "enableSearchEngineIndexing",
      );
    });
  });

  describe("ClickHouse-backed models", () => {
    /*
     * The analytics select gate is private, and its public entry point
     * (checkReadPermission) resolves tenant and owner scopes against real
     * services before it gets anywhere near the select. What is under test is
     * the sentence, so the gate is called directly rather than mocking a
     * database out from under it.
     */
    function checkAnalyticsSelect(
      select: Record<string, boolean>,
      permissions: Array<Permission> = [Permission.ProjectOwner],
    ): Exception {
      const gate: (
        modelType: typeof Log,
        select: Record<string, boolean>,
        props: DatabaseCommonInteractionProps,
      ) => void = (
        AnalyticsModelPermission as unknown as Record<string, unknown>
      )["checkSelectPermission"] as (
        modelType: typeof Log,
        select: Record<string, boolean>,
        props: DatabaseCommonInteractionProps,
      ) => void;

      return caught(() => {
        return gate.call(
          AnalyticsModelPermission,
          Log,
          select,
          makeProps(permissions),
        );
      });
    }

    it("names the unknown column in a way the provider can recover", () => {
      const error: Exception = checkAnalyticsSelect({
        aColumnThisDeploymentHasNeverHeardOf: true,
      });

      expect(error.message).toContain("Cannot select on");
      expect(error.code).toBe(ExceptionCode.BadDataException);
      for (const envelope of ["error", "message"] as const) {
        expect(
          columnTheProviderWouldDrop(wireBody(envelope, error.message)),
        ).toBe("aColumnThisDeploymentHasNeverHeardOf");
      }
    });

    it("lists the columns it would accept instead, by name", () => {
      /*
       * The remediation tail interpolated the column OBJECTS, so it rendered
       * as "[object Object], [object Object], ..." - the half of the sentence
       * that tells the caller what to do instead said nothing at all. It is
       * also the part of the message a sloppy pattern could reach into, so it
       * is worth keeping honest.
       */
      const error: Exception = checkAnalyticsSelect({
        aColumnThisDeploymentHasNeverHeardOf: true,
      });

      expect(error.message).not.toContain("[object Object]");
      expect(error.message).toContain(
        "Here are the columns you can select on instead:",
      );
      expect(error.message).toContain("body");
    });

    it("names a permission-gated column the same way the Postgres gate does", () => {
      const error: Exception = checkAnalyticsSelect({ body: true }, []);

      expect(error.message).toContain(
        "You do not have permissions to select on",
      );
      expect(error.code).toBe(ExceptionCode.NotAuthorizedException);
      expect(columnTheProviderWouldDrop(wireBody("error", error.message))).toBe(
        "body",
      );
    });
  });

  describe("clauses the provider must NOT treat as a droppable select column", () => {
    it("ignores a query-clause permission rejection", () => {
      /*
       * One word away from the select phrasing. Dropping a query column would
       * change which rows come back - a silently wrong read is worse than the
       * loud failure it would be papering over.
       */
      expect(
        columnTheProviderWouldDrop(
          wireBody(
            "message",
            "You do not have permissions to query on - name. You need any one of these permissions: Project Owner",
          ),
        ),
      ).toBeNull();
    });

    it("ignores an error that names no column at all", () => {
      expect(
        columnTheProviderWouldDrop(
          wireBody("error", "Project ID not found in the request."),
        ),
      ).toBeNull();
    });
  });
});
