/*
 * Contract tests for the generated internal/provider/client.go.
 *
 * client.go lives in a template literal, so nothing type-checks it and — until
 * StaticFiles/client_test.go was added — nothing ran it either. These tests
 * cover the half that a Go test cannot: that the generator still EMITS the
 * client the Go tests are written against, and that the copy of client_test.go
 * into the generated tree is still wired up. Drop that one line in
 * ResourceGenerator and the Go suite silently stops existing while CI stays
 * green, so it is asserted here rather than assumed.
 *
 * The select-rejection patterns get more than a spelling check. Each emitted Go
 * pattern is compiled as a JS RegExp and run against the server's real message
 * text, in both the decoded and the on-the-wire JSON-encoded form. That last
 * part is the whole point: issue #3414 proposed `Cannot select on "([A-Za-z0-9_]+)"`,
 * which reads fine and never fires, because the API JSON-encodes its errors and
 * the quotes arrive backslash-escaped. Go's RE2 and JS agree on the syntax used
 * by these patterns, so running them here is a real behavioral check.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { DataSourceGenerator } from "../Core/DataSourceGenerator";
import { ProviderGenerator } from "../Core/ProviderGenerator";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { buildFixtureSpec } from "./Fixtures";

let outputDir: string;
let clientGo: string;
let monitorDataSourceGo: string;

const GENERATED_DIR: string = "internal/provider";

/*
 * Verbatim from the server. A reword there without a matching change here is
 * the failure this whole file exists to make loud:
 *   Common/Server/Types/Database/Permissions/SelectPermission.ts
 *   Common/Server/Types/AnalyticsDatabase/ModelPermission.ts
 *   Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts
 */
const PERMISSION_MESSAGE: string =
  "You do not have permissions to select on - serviceLanguage.\n" +
  "                    You need any one of these permissions: Project Owner, Project Admin";

const UNKNOWN_COLUMN_MESSAGE: string =
  'Invalid select clause. Cannot select on "enableSearchEngineIndexing". ' +
  "This column does not exist on Status Page. " +
  "Here are the columns you can select on instead: _id, createdAt, updatedAt";

const ANALYTICS_UNKNOWN_COLUMN_MESSAGE: string = "Unknown column: spanId";

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-provider-"));

  const config: {
    outputDir: string;
    providerName: string;
    providerVersion: string;
    goModuleName: string;
  } = {
    outputDir,
    providerName: "oneuptime",
    providerVersion: "11.0.0",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  const spec: ReturnType<typeof buildFixtureSpec> = buildFixtureSpec();

  await new ProviderGenerator(config, spec).generateProvider();
  await new ResourceGenerator(config, spec).generateResources();
  await new DataSourceGenerator(config, spec).generateDataSources();

  clientGo = fs.readFileSync(
    path.join(outputDir, GENERATED_DIR, "client.go"),
    "utf-8",
  );
  monitorDataSourceGo = fs.readFileSync(
    path.join(outputDir, GENERATED_DIR, "data_source_monitor.go"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

/*
 * Hoisted: eslint's wrap-regex and prettier disagree about parenthesising a
 * regex literal in a member expression. PATTERN_BLOCK is not global so `.exec`
 * carries no lastIndex state; MUST_COMPILE is, and is therefore only ever used
 * as a source to build a fresh scanner from, never `.exec`d directly.
 */
const PATTERN_BLOCK: RegExp =
  /var droppableSelectColumnPatterns = \[\]\*regexp\.Regexp\{([\s\S]*?)\n\}/;
const MUST_COMPILE: RegExp = /regexp\.MustCompile\(`([^`]*)`\)/g;

/*
 * The Go source of every pattern in droppableSelectColumnPatterns, in order.
 * Fails loudly (empty list) rather than silently if the block is restructured.
 */
function emittedSelectPatterns(): Array<string> {
  const block: RegExpExecArray | null = PATTERN_BLOCK.exec(clientGo);
  if (!block) {
    return [];
  }

  const patterns: Array<string> = [];
  const scanner: RegExp = new RegExp(MUST_COMPILE.source, "g");
  let match: RegExpExecArray | null = scanner.exec(block[1] as string);
  while (match !== null) {
    patterns.push(match[1] as string);
    match = scanner.exec(block[1] as string);
  }
  return patterns;
}

// The column an emitted pattern pulls out of `text`, or null if none matches.
function columnMatchedBySomePattern(text: string): string | null {
  for (const pattern of emittedSelectPatterns()) {
    const match: RegExpMatchArray | null = text.match(new RegExp(pattern));
    if (match) {
      return match[1] as string;
    }
  }
  return null;
}

// The body the API actually puts on the wire for an error message.
function wireBody(envelope: string, message: string): string {
  return JSON.stringify({ [envelope]: message });
}

describe("select-rejection patterns", () => {
  test("the generator emits a pattern list that can be read back", () => {
    expect(emittedSelectPatterns().length).toBeGreaterThanOrEqual(3);
  });

  test("every emitted pattern is a valid regex with one capture group", () => {
    for (const pattern of emittedSelectPatterns()) {
      /*
       * Throws if the emitted Go pattern is not syntax JS can compile too,
       * which is the premise the behavioural tests below rest on.
       */
      expect(() => {
        return new RegExp(pattern);
      }).not.toThrow();
      expect(new RegExp(`|${pattern}`).exec("")).toHaveLength(2);
    }
  });

  test.each([
    ["permission denied", PERMISSION_MESSAGE, "serviceLanguage"],
    ["unknown column", UNKNOWN_COLUMN_MESSAGE, "enableSearchEngineIndexing"],
    ["analytics unknown column", ANALYTICS_UNKNOWN_COLUMN_MESSAGE, "spanId"],
  ])(
    "extracts the column from the decoded %s message",
    (_name: string, message: string, column: string) => {
      expect(columnMatchedBySomePattern(message)).toBe(column);
    },
  );

  /*
   * The defect the issue's own suggested patch would have shipped. The client
   * decodes before matching, so this is belt and braces — but a pattern that
   * cannot survive an escaped body is one refactor away from being matched
   * against raw bytes again, which is exactly how this started.
   */
  test.each([
    ["permission denied", PERMISSION_MESSAGE, "serviceLanguage"],
    ["unknown column", UNKNOWN_COLUMN_MESSAGE, "enableSearchEngineIndexing"],
    ["analytics unknown column", ANALYTICS_UNKNOWN_COLUMN_MESSAGE, "spanId"],
  ])(
    "extracts the column from the JSON-encoded %s body, quotes escaped and all",
    (_name: string, message: string, column: string) => {
      for (const envelope of ["error", "message"]) {
        expect(columnMatchedBySomePattern(wireBody(envelope, message))).toBe(
          column,
        );
      }
    },
  );

  test("the JSON-encoded unknown-column body really does escape its quotes", () => {
    /*
     * Guards the test above from quietly becoming a duplicate of the decoded
     * one if the server ever stops quoting the column name.
     */
    expect(wireBody("error", UNKNOWN_COLUMN_MESSAGE)).toContain(
      '\\"enableSearchEngineIndexing\\"',
    );
  });

  test("a query-clause rejection is not treated as a select rejection", () => {
    /*
     * "permissions to query on - name" is one word away from the select
     * phrasing. Dropping a query column would change which rows come back,
     * which is worse than the error it would be papering over.
     */
    expect(
      columnMatchedBySomePattern(
        "You do not have permissions to query on - name. You need any one of these permissions: Project Owner",
      ),
    ).toBeNull();
  });

  test("an unrelated bad request names no column", () => {
    expect(
      columnMatchedBySomePattern(
        wireBody("error", "Project ID not found in the request."),
      ),
    ).toBeNull();
  });

  test("the remediation tail is never mistaken for the rejected column", () => {
    /*
     * The unknown-column message ends "...you can select on instead: _id,
     * createdAt". A pattern reaching into that tail would drop a column the
     * server was recommending, and the retry would make things worse.
     */
    expect(columnMatchedBySomePattern(UNKNOWN_COLUMN_MESSAGE)).not.toBe("_id");
  });
});

describe("PostWithSelect", () => {
  test("matches against the decoded message, never the raw body", () => {
    /*
     * The single most important line in the fix. Matching FindSubmatch(body)
     * puts the patterns back in front of JSON-escaped bytes.
     */
    expect(clientGo).toContain("message := apiErrorMessage(body)");
    expect(clientGo).not.toContain("FindSubmatch(body)");
  });

  test("both entry points exist and PostWithSelect delegates", () => {
    expect(clientGo).toContain(
      "func (c *Client) PostWithSelect(ctx context.Context, path string, selectParam interface{}) (*http.Response, error) {",
    );
    expect(clientGo).toContain(
      "func (c *Client) PostBodyWithSelect(ctx context.Context, path string, requestBody map[string]interface{}) (*http.Response, error) {",
    );

    const postWithSelect: string = clientGo.slice(
      clientGo.indexOf("func (c *Client) PostWithSelect("),
      clientGo.indexOf("func (c *Client) PostBodyWithSelect("),
    );
    expect(postWithSelect).toContain("return c.PostBodyWithSelect(ctx, path,");
  });

  test("retries reuse the caller's body instead of rebuilding a select-only one", () => {
    /*
     * The by-name data source lookup sends query and limit next to the select.
     * A retry that rebuilt the body from the select alone would drop the query
     * and match an arbitrary row.
     */
    const postBodyWithSelect: string = clientGo.slice(
      clientGo.indexOf("func (c *Client) PostBodyWithSelect("),
    );
    const loopBody: string = postBodyWithSelect.slice(
      0,
      postBodyWithSelect.indexOf("\n}"),
    );
    expect(loopBody).toContain(
      'resp, err := c.DoRequest(ctx, "POST", path, requestBody)',
    );
    expect(loopBody).toContain(
      'requestBody["select"].(map[string]interface{})',
    );
  });

  test("a dropped column is reported rather than swallowed", () => {
    /*
     * A silently dropped column leaves its attribute null in state, which
     * surfaces much later as an inconsistent-result-after-apply or a phantom
     * diff. The warning is what makes that traceable.
     */
    expect(clientGo).toContain("tflog.Warn(ctx,");
    expect(clientGo).toContain(
      '"github.com/hashicorp/terraform-plugin-log/tflog"',
    );
  });

  test("the retry stays bounded", () => {
    expect(clientGo).toContain("maxAttempts := 8");
    expect(clientGo).toContain(
      "for attempt := 0; attempt < maxAttempts; attempt++ {",
    );
  });

  test("a consumed error body is put back before the response is returned", () => {
    expect(clientGo).toContain(
      "resp.Body = io.NopCloser(bytes.NewReader(body))",
    );
  });
});

describe("data source lookups", () => {
  test("the by-id lookup drops rejected select columns", () => {
    expect(monitorDataSourceGo).toContain(
      "d.client.PostWithSelect(ctx, readPath, selectParam)",
    );
  });

  test("the by-name lookup drops them too", () => {
    /*
     * This path used to post through the plain client, so a permission-gated
     * or version-skewed column failed the whole lookup with no retry at all —
     * not even for the phrasing the retry already understood.
     */
    expect(monitorDataSourceGo).toContain("d.client.PostBodyWithSelect(ctx,");
    expect(monitorDataSourceGo).not.toContain("d.client.Post(ctx,");
  });

  test("the by-name lookup still sends its query and limit", () => {
    expect(monitorDataSourceGo).toContain('"query": map[string]interface{}{');
    expect(monitorDataSourceGo).toContain('"limit": 2,');
  });
});

describe("static Go test wiring", () => {
  test("client_test.go is copied into the generated provider", () => {
    /*
     * Nothing else guards this. Without the copy, the Go suite that actually
     * exercises the retry never reaches the tree CI runs `go test` on, and the
     * loss looks exactly like success.
     */
    const copied: string = path.join(
      outputDir,
      GENERATED_DIR,
      "client_test.go",
    );
    expect(fs.existsSync(copied)).toBe(true);

    const contents: string = fs.readFileSync(copied, "utf-8");
    expect(contents).toContain("package provider");
    expect(contents).toContain("func TestPostWithSelect_DropsUnknownColumn(");
    expect(contents).toContain(
      "func TestPostBodyWithSelect_PreservesTheRestOfTheBody(",
    );
  });

  test("the copied test targets symbols the generator actually emits", () => {
    const contents: string = fs.readFileSync(
      path.join(outputDir, GENERATED_DIR, "client_test.go"),
      "utf-8",
    );
    for (const symbol of [
      "droppableSelectColumn(",
      "PostWithSelect(",
      "PostBodyWithSelect(",
      "ParseResponse(",
      "NewClient(",
    ]) {
      expect(contents).toContain(symbol);
      expect(clientGo).toContain(symbol);
    }
  });
});
