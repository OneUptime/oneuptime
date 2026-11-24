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
import { GoCodeGenerator } from "../Core/GoCodeGenerator";
import { providerGoFilePath } from "../Core/ProviderShards";
import {
  API_KEY_ATTRIBUTE_DESCRIPTION,
  PROVIDER_DESCRIPTION,
  URL_ATTRIBUTE_DESCRIPTION,
} from "../Core/ProviderWords";
import { buildFixtureSpec } from "./Fixtures";
import {
  NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
  NAME_TAKEN_REFUSAL_CODE,
  NAME_TAKEN_REFUSAL_CODES,
  REFUSAL_CODE_FIELD,
} from "Common/Types/Exception/NameTakenException";
import {
  VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
  VALUE_TAKEN_REFUSAL_CODE,
  VALUE_TAKEN_REFUSAL_CODES,
} from "Common/Types/Exception/ValueTakenException";

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
  "You do not have permissions to select on - serviceLanguage. You need one of these permissions: Project Owner, Project Admin.";

/*
 * Before the refusals said who may on the same line
 * (Common/Server/Types/Database/Permissions/ColumnRefusalMessage.ts), the
 * permissions came on a line of their own. A provider meets both servers.
 */
const OLDER_SERVER_PERMISSION_MESSAGE: string =
  "You do not have permissions to select on - serviceLanguage.\n" +
  "                    You need any one of these permissions: Project Owner, Project Admin";

// A column nobody may read through the API: its list is empty.
const NOBODY_READS_MESSAGE: string =
  "You do not have permissions to select on - fileId. No permission allows it: the column is not readable through the API.";

const UNKNOWN_COLUMN_MESSAGE: string =
  'Invalid select clause. Cannot select on "enableSearchEngineIndexing". ' +
  "This column does not exist on Status Page. " +
  "Here are the columns you can select on instead: _id, createdAt, updatedAt";

const ANALYTICS_UNKNOWN_COLUMN_MESSAGE: string = "Unknown column: spanId";

/*
 * A root or master-admin caller - the master API key of a self-hosted
 * OneUptime - skips the select permission check, so a column the server does
 * not have is refused further in, by the model's column metadata
 * (Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel.ts).
 * OneUptime/terraform-provider-oneuptime#9 is this message failing a refresh.
 */
const ROOT_UNKNOWN_COLUMN_MESSAGE: string =
  "TableColumnMetadata not found for alertEpisodeNumberPrefix column";

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
    path.join(outputDir, providerGoFilePath("data_source_monitor.go")),
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
    [
      "permission denied by an older server",
      OLDER_SERVER_PERMISSION_MESSAGE,
      "serviceLanguage",
    ],
    ["a column nobody may read", NOBODY_READS_MESSAGE, "fileId"],
    ["unknown column", UNKNOWN_COLUMN_MESSAGE, "enableSearchEngineIndexing"],
    ["analytics unknown column", ANALYTICS_UNKNOWN_COLUMN_MESSAGE, "spanId"],
    [
      "unknown column, for the master key",
      ROOT_UNKNOWN_COLUMN_MESSAGE,
      "alertEpisodeNumberPrefix",
    ],
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
    [
      "permission denied by an older server",
      OLDER_SERVER_PERMISSION_MESSAGE,
      "serviceLanguage",
    ],
    ["a column nobody may read", NOBODY_READS_MESSAGE, "fileId"],
    ["unknown column", UNKNOWN_COLUMN_MESSAGE, "enableSearchEngineIndexing"],
    ["analytics unknown column", ANALYTICS_UNKNOWN_COLUMN_MESSAGE, "spanId"],
    [
      "unknown column, for the master key",
      ROOT_UNKNOWN_COLUMN_MESSAGE,
      "alertEpisodeNumberPrefix",
    ],
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

/*
 * A create or an update refused because a record in service has the name it
 * asks for (#9855, and since #10065 for every kind with a name of its own):
 * asked again for a while, since in one apply the resource that gives the
 * name up - by a rename or a delete - may not have run yet. A name only an
 * archived record has is handed back at once: nothing in an apply gives it
 * up. client_name_taken_test.go runs both against a real HTTP server; these
 * pin what a Go test cannot see - that the client tells the refusals by the
 * very codes the server sends, not by copies that could drift, nor by the
 * server's English.
 */
describe("a name another record has", () => {
  // The Go function whose name is given, up to the next top-level func.
  function goFunction(name: string): string {
    const start: number = clientGo.indexOf(name);
    expect(start).toBeGreaterThanOrEqual(0);

    const end: number = clientGo.indexOf("\nfunc ", start + name.length);
    return clientGo.slice(start, end === -1 ? undefined : end);
  }

  test("is told by the server's own codes, emitted from Common's constants", () => {
    expect(REFUSAL_CODE_FIELD).toBe("refusalCode");
    expect(NAME_TAKEN_REFUSAL_CODE).toBe("name_taken");
    expect(NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE).toBe("name_taken_by_archived");
    // Every code a taken name is refused with has its constant in the client.
    expect(NAME_TAKEN_REFUSAL_CODES).toEqual([
      NAME_TAKEN_REFUSAL_CODE,
      NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
    ]);

    expect(clientGo).toContain(
      `refusalCodeField               = "${REFUSAL_CODE_FIELD}"`,
    );
    expect(clientGo).toContain(
      `nameTakenRefusalCode           = "${NAME_TAKEN_REFUSAL_CODE}"`,
    );
    expect(clientGo).toContain(
      `nameTakenByArchivedRefusalCode = "${NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE}"`,
    );
    expect(goFunction("func refusalCodeOf(")).toContain(
      "code, _ := parsed[refusalCodeField].(string)",
    );
    expect(goFunction("func isNameTakenRefusal(")).toContain(
      "return refusalCodeOf(body) == nameTakenRefusalCode",
    );
  });

  test("never by the server's English, which may be reworded", () => {
    expect(clientGo).not.toContain("There is already");
    expect(clientGo).not.toContain("Pick another name");
    expect(clientGo).not.toContain("with the same name already exists");
    expect(clientGo).not.toContain("is already called");
    expect(clientGo).not.toContain("Unarchive it");
  });

  test("is asked again for creates and updates only, never for reads or deletes", () => {
    expect(goFunction("func writesARecord(")).toContain(
      'return method == "POST" || method == "PUT" || method == "PATCH"',
    );

    const doRequest: string = goFunction("func (c *Client) DoRequest(");

    expect(doRequest).toContain(
      "resp, err := c.doRequestOnce(ctx, method, path, body)",
    );
    expect(doRequest).toContain("!writesARecord(method)");
    expect(doRequest).toContain(
      "return c.askAgainWhileTaken(ctx, method, path, body, resp)",
    );
  });

  test("only on a 400", () => {
    expect(goFunction("func readRefusalCode(")).toContain(
      "resp.StatusCode != http.StatusBadRequest",
    );
  });

  test("only while a record in service has the name: a name an archived record has is handed back at once", () => {
    const askAgain: string = goFunction("func (c *Client) askAgainWhileTaken(");

    expect(askAgain).toContain("code, err := readRefusalCode(resp)");

    // The archived codes end the asking before any wait.
    const archived: number = askAgain.indexOf(
      "if isTakenByArchivedRefusalCode(code) {",
    );
    expect(archived).toBeGreaterThanOrEqual(0);
    expect(
      askAgain.slice(
        archived,
        askAgain.indexOf("remaining := time.Until(deadline)", archived),
      ),
    ).toContain("return resp, nil");
    expect(archived).toBeLessThan(askAgain.indexOf("case <-time.After(wait):"));

    // Anything but the code of a name or a value a record in service has is handed back.
    expect(askAgain).toContain(
      "if !isTakenRefusalCode(code) || remaining <= 0 {",
    );
    expect(goFunction("func isTakenRefusalCode(")).toContain(
      "return code == nameTakenRefusalCode || code == valueTakenRefusalCode",
    );
    expect(goFunction("func isTakenByArchivedRefusalCode(")).toContain(
      "return code == nameTakenByArchivedRefusalCode || code == valueTakenByArchivedRefusalCode",
    );
  });

  test("for about 30 seconds, waiting half a second at first and at most 5", () => {
    expect(clientGo).toContain("window:    30 * time.Second,");
    expect(clientGo).toContain("firstWait: 500 * time.Millisecond,");
    expect(clientGo).toContain("maxWait:   5 * time.Second,");
    expect(clientGo).toContain("nameTakenRetry: defaultNameTakenRetry,");
  });

  test("ends with Terraform's cancellation, and asks again through the one-request path", () => {
    const askAgain: string = goFunction("func (c *Client) askAgainWhileTaken(");

    expect(askAgain).toContain("case <-ctx.Done():");
    expect(askAgain).toContain("return nil, ctx.Err()");
    expect(askAgain).toContain(
      "resp, err = c.doRequestOnce(ctx, method, path, body)",
    );
    // A refusal's body is read to tell, then put back for the caller.
    expect(goFunction("func readRefusalCode(")).toContain(
      "resp.Body = io.NopCloser(bytes.NewReader(body))",
    );
  });

  test("once given up, says what to do for a name held outside the configuration and for a swap", () => {
    const parseResponse: string = goFunction("func (c *Client) ParseResponse(");

    expect(parseResponse).toContain(
      "if resp.StatusCode == http.StatusBadRequest && isNameTakenRefusal(body) {",
    );
    expect(parseResponse).toContain('message += " " + c.nameTakenAdvice()');

    const advice: string = goFunction("func (c *Client) nameTakenAdvice(");

    expect(advice).toContain(
      'advice := "If a record outside this configuration has it, such as one OneUptime made with the project, give this resource another name, or import that record. If resources in this configuration swap names, or rename each other in a cycle, none of them can go first: give one of them a temporary name, apply, then apply the names you want."',
    );
    // The window as describeWait says it, before the advice; none without one.
    expect(advice).toContain(
      'return fmt.Sprintf("The name was still taken after asking again for %s. %s", describeWait(c.nameTakenRetry.window), advice)',
    );
    expect(advice).toContain("if c.nameTakenRetry.window <= 0 {");
  });

  test("adds nothing to a name an archived record has: the server's sentence says to unarchive it", () => {
    const parseResponse: string = goFunction("func (c *Client) ParseResponse(");

    expect(parseResponse).not.toContain("nameTakenByArchivedRefusalCode");
    expect(parseResponse).not.toContain("refusalCodeOf(");
    expect(goFunction("func isNameTakenRefusal(")).not.toContain(
      "nameTakenByArchivedRefusalCode",
    );
  });
});

/*
 * A create or an update refused because a record in service holds a value
 * that is not a name, but that a record holds alone - a status page's
 * domain, a host's identifier (#10319): asked again the same way, since a
 * domain moved from one resource to another in one apply is one deleted
 * and one created, side by side. client_value_taken_test.go runs it against
 * a real HTTP server; these pin that the client tells it by the server's
 * own codes, and says what to do in a value's words.
 */
describe("a value another record holds alone", () => {
  function goFunction(name: string): string {
    const start: number = clientGo.indexOf(name);
    expect(start).toBeGreaterThanOrEqual(0);

    const end: number = clientGo.indexOf("\nfunc ", start + name.length);
    return clientGo.slice(start, end === -1 ? undefined : end);
  }

  test("is told by the server's own codes, emitted from Common's constants", () => {
    expect(VALUE_TAKEN_REFUSAL_CODE).toBe("value_taken");
    expect(VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE).toBe(
      "value_taken_by_archived",
    );
    expect(VALUE_TAKEN_REFUSAL_CODES).toEqual([
      VALUE_TAKEN_REFUSAL_CODE,
      VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
    ]);

    expect(clientGo).toContain(
      `valueTakenRefusalCode           = "${VALUE_TAKEN_REFUSAL_CODE}"`,
    );
    expect(clientGo).toContain(
      `valueTakenByArchivedRefusalCode = "${VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE}"`,
    );
    expect(goFunction("func isValueTakenRefusal(")).toContain(
      "return refusalCodeOf(body) == valueTakenRefusalCode",
    );
  });

  test("never by the server's English, which may be reworded", () => {
    expect(clientGo).not.toContain("with the same fullDomain");
    expect(clientGo).not.toContain("already exists");
    expect(clientGo).not.toContain("is already in use");
    expect(clientGo).not.toContain("already has a name");
  });

  test("is asked again only while a record in service has it, and handed back at once when only an archived one does", () => {
    const askAgain: string = goFunction("func (c *Client) askAgainWhileTaken(");

    expect(askAgain).toContain("if isTakenByArchivedRefusalCode(code) {");
    expect(askAgain).toContain(
      "if !isTakenRefusalCode(code) || remaining <= 0 {",
    );
    expect(goFunction("func isTakenRefusalCode(")).toContain(
      "valueTakenRefusalCode",
    );
    expect(goFunction("func isTakenRefusalCode(")).not.toContain(
      "valueTakenByArchivedRefusalCode",
    );
    expect(goFunction("func isTakenByArchivedRefusalCode(")).toContain(
      "valueTakenByArchivedRefusalCode",
    );
  });

  test("once given up, says what to do in a value's words, never a name's", () => {
    const parseResponse: string = goFunction("func (c *Client) ParseResponse(");

    expect(parseResponse).toContain(
      "if resp.StatusCode == http.StatusBadRequest && isValueTakenRefusal(body) {",
    );
    expect(parseResponse).toContain('message += " " + c.valueTakenAdvice()');

    const advice: string = goFunction("func (c *Client) valueTakenAdvice(");

    expect(advice).toContain(
      'advice := "If a record outside this configuration has it, give this resource another value, or import that record. If resources in this configuration swap values, none of them can go first: give one of them a temporary value, apply, then apply the values you want."',
    );
    expect(advice).toContain(
      'return fmt.Sprintf("The value was still taken after asking again for %s. %s", describeWait(c.nameTakenRetry.window), advice)',
    );
    expect(advice).toContain("if c.nameTakenRetry.window <= 0 {");
    expect(advice).not.toContain("another name");
    expect(advice).not.toContain("temporary name");
  });

  test("adds nothing to a value an archived record has: the server's sentence says to unarchive it", () => {
    const parseResponse: string = goFunction("func (c *Client) ParseResponse(");

    expect(parseResponse).not.toContain("valueTakenByArchivedRefusalCode");
    expect(goFunction("func isValueTakenRefusal(")).not.toContain(
      "valueTakenByArchivedRefusalCode",
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

  test("the lookup by arguments still sends its query and limit", () => {
    expect(monitorDataSourceGo).toContain('"query":  filters,');
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

  /*
   * What `terraform providers schema` and an editor's hover show: the
   * provider's own words, not the API document's description of itself.
   */
  test("the provider's schema describes the provider and its two settings", () => {
    const providerGo: string = fs.readFileSync(
      path.join(outputDir, GENERATED_DIR, "provider.go"),
      "utf-8",
    );

    for (const words of [
      PROVIDER_DESCRIPTION,
      URL_ATTRIBUTE_DESCRIPTION,
      API_KEY_ATTRIBUTE_DESCRIPTION,
    ]) {
      expect(providerGo).toContain(
        `MarkdownDescription: "${GoCodeGenerator.escapeString(words)}"`,
      );
    }

    expect(providerGo).not.toContain(buildFixtureSpec().info.description!);
    expect(providerGo).not.toContain("without /api path");
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

  test("client_name_taken_test.go is copied too, and tests what the client emits", () => {
    const copied: string = path.join(
      outputDir,
      GENERATED_DIR,
      "client_name_taken_test.go",
    );
    expect(fs.existsSync(copied)).toBe(true);

    const contents: string = fs.readFileSync(copied, "utf-8");
    expect(contents).toContain("package provider");

    /*
     * The issues' cases: a chain converges, a create waits for a delete, a
     * swap and a name nothing gives up give up clearly, a name an archived
     * record has is handed back at once, no other 400 is asked again.
     */
    for (const test of [
      "func TestDoRequest_AsksAgainUntilTheNameIsGivenUp(",
      "func TestDoRequest_AChainOfRenamesConvergesInOneApply(",
      "func TestDoRequest_ACreateWaitsForADeleteToGiveTheNameUp(",
      "func TestDoRequest_ASwapGivesUpWithAClearMessage(",
      "func TestDoRequest_ANameNothingGivesUpEndsWithWhatToDo(",
      "func TestDoRequest_NeverAsksAgainForAnyOtherRefusal(",
      "func TestDoRequest_NeverAsksAgainForANameOnlyAnArchivedRecordHas(",
      "func TestDoRequest_ANameAnArchivedRecordHasFailsTheApplyAtOnce(",
    ]) {
      expect(contents).toContain(test);
    }

    for (const symbol of [
      "nameTakenRetry{",
      "isNameTakenRefusal(",
      "refusalCodeOf(",
      "nameTakenAdvice(",
      "describeWait(",
      "refusalCodeField",
      "nameTakenRefusalCode",
      "nameTakenByArchivedRefusalCode",
    ]) {
      expect(contents).toContain(symbol);
      expect(clientGo).toContain(symbol);
    }
  });

  test("client_value_taken_test.go is copied too, and tests what the client emits", () => {
    const copied: string = path.join(
      outputDir,
      GENERATED_DIR,
      "client_value_taken_test.go",
    );
    expect(fs.existsSync(copied)).toBe(true);

    const contents: string = fs.readFileSync(copied, "utf-8");
    expect(contents).toContain("package provider");

    /*
     * The issue's cases: a domain moved to another resource converges in
     * one apply, a swap and a value nothing gives up give up in a value's
     * words, a value an archived record has is handed back at once, and
     * nothing else is asked again.
     */
    for (const test of [
      "func TestDoRequest_ADomainMovedToAnotherResourceConvergesInOneApply(",
      "func TestDoRequest_AnIdentifierSwapGivesUpWithAClearMessage(",
      "func TestDoRequest_AValueNothingGivesUpEndsWithWhatToDo(",
      "func TestDoRequest_NeverAsksAgainForAValueOnlyAnArchivedRecordHas(",
      "func TestDoRequest_AValueAnArchivedRecordHasFailsTheApplyAtOnce(",
      "func TestDoRequest_NeverAsksAgainForAValueWithoutItsCodeOrOnAnotherStatus(",
      "func TestParseResponse_SaysWhatToDoInTheWordsOfWhatIsTaken(",
    ]) {
      expect(contents).toContain(test);
    }

    for (const symbol of [
      "nameTakenRetry{",
      "isValueTakenRefusal(",
      "isTakenRefusalCode(",
      "isTakenByArchivedRefusalCode(",
      "valueTakenRefusalCode",
      "valueTakenByArchivedRefusalCode",
      "refusalCodeField",
    ]) {
      expect(contents).toContain(symbol);
      expect(clientGo).toContain(symbol);
    }
  });
});
