import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the upgrade notes and the Helm chart say about a database statement
 * the app stops waiting for:
 *
 *   - the app cancels it on the database and closes its connection, so a
 *     write it reported as failed is never committed by the next request
 *     to borrow that connection (Common/Server/Infrastructure/Postgres/
 *     CancelOnTimeoutClient);
 *   - a caller waits a little longer, for the database to confirm the
 *     cancel (CANCEL_ANSWER_WAIT_IN_MS);
 *   - the chart's PgBouncer gives up on a statement still in its queue
 *     before the app does (pgbouncer.queryWaitTimeoutSeconds), and anyone
 *     running their own pooler is told to do the same;
 *   - the database role's statement_timeout still matters, for a cancel
 *     that cannot reach the database.
 *
 * Markdown and YAML comments are not compiled, so nothing else notices a
 * note that falls behind.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

function read(relativePath: string): string {
  // Markdown and YAML wrap their lines; read them as one line of text.
  return fs
    .readFileSync(path.join(REPO_ROOT, relativePath), "utf8")
    .replace(/\s*\n\s*#?\s*/g, " ");
}

describe("the upgrade notes for 14", () => {
  const page: string = read(
    "App/FeatureSet/Docs/Content/en/installation/upgrading.md",
  );

  it("say a statement the app stops waiting for is cancelled, and its connection closed", () => {
    expect(page).toContain(
      "**A database statement the app stops waiting for is cancelled.** When a statement runs past `DATABASE_QUERY_TIMEOUT_MS` (35 seconds by default), the app now cancels it on the database and closes the connection it ran on, instead of only giving up on it.",
    );
  });

  it("say what used to happen, and what a caller now waits", () => {
    expect(page).toContain(
      "a create it was part of could be committed by the next request to use that connection, after the first had been told it failed.",
    );
    expect(page).toContain(
      "A request whose statement runs that long now waits up to 5 seconds more, for the database to confirm the cancel, and then fails as before.",
    );
  });

  it("say what changes for PgBouncer, the chart's and one's own", () => {
    expect(page).toContain(
      "The chart's PgBouncer now refuses a statement that waited 30 seconds in its queue for a free server connection (`pgbouncer.queryWaitTimeoutSeconds`; PgBouncer's own default is 120 seconds)",
    );
    expect(page).toContain(
      "If you run your own PgBouncer or a managed pooled endpoint, set its `query_wait_timeout` below `DATABASE_QUERY_TIMEOUT_MS`, and keep `statement_timeout` set on the app's database role",
    );
  });

  it("say a cancelled change to who can sign in, or to what OneUptime AI may use, gives its lock back at once", () => {
    expect(page).toContain(
      "whose write was cancelled now gives its lock back at once instead of holding other such changes for up to a minute.",
    );
  });
});

describe("the Helm chart's PgBouncer values", () => {
  const values: string = read("../HelmChart/Public/oneuptime/values.yaml");

  it("keep a queued statement's wait below the app's, and say why", () => {
    expect(values).toContain("queryWaitTimeoutSeconds: 30");
    expect(values).toContain(
      "so pgbouncer gives up on a queued statement before the app does: pgbouncer does not cancel a statement still in its queue",
    );
  });

  it("say what the app's own timeout does, and what it cannot reach", () => {
    expect(values).toContain(
      "The app cancels a statement it stops waiting for, and closes its connection - pgbouncer passes the cancel on to the server connection the statement runs on - but a cancel cannot reach a backend whose connection is lost, nor a statement still in pgbouncer's queue (queryWaitTimeoutSeconds above).",
    );
  });
});
