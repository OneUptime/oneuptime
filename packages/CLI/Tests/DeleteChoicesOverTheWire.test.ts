import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";
import {
  getCustomRoleDeleteWorkflowEditRefusedMessage,
  getCustomRoleDeleteWorkflowsMessage,
} from "Common/Types/Workflow/WorkflowRunAs";
import { JSONObject } from "Common/Types/JSON";
import { CliRun, printedJson, runCli } from "./Helpers/RunCli";

/*
 * DELETING A CUSTOM ROLE THAT WORKFLOWS RUN AS, OVER THE WIRE (#9949)
 *
 * The CLI's real program and its real requests, to a stand-in for
 * OneUptime's API that answers a delete of a custom role as the server
 * does: refused in the server's own words, naming the workflows, when the
 * DELETE's body does not say what they run as instead, and deleted when it
 * does. What the stand-in received is what the CLI sent: the method, the
 * path, the key and the body. (Common's DeleteChoicesFromClients holds what
 * the CLI sends to the server's own reader, WorkflowsOfDeletedRoles.)
 */

const ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000aa";
const OTHER_ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000bb";
const API_KEY: string = "sk-test-key-0123456789";

const REFUSAL: string = getCustomRoleDeleteWorkflowsMessage({
  roleNames: ["Incident Responder"],
  workflowNames: ["Close stale incidents"],
  workflowCount: 1,
});

interface Received {
  method: string;
  url: string;
  apiKey: string;
  body: string;
}

let server: Server;
let origin: string;
const received: Array<Received> = [];

/*
 * A refusal the stand-in answers every delete of a custom role with, as
 * the server does when the deleter may not edit one of the workflows,
 * whatever the delete said; null to answer as readInstead reads the body.
 */
let refuseWith: { status: number; message: string } | null = null;

// What the stand-in answers a DELETE of a custom role: as the server reads its body.
function answer(req: IncomingMessage, body: string, res: ServerResponse): void {
  const json: (status: number, value: JSONObject) => void = (
    status: number,
    value: JSONObject,
  ): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };

  if (req.method !== "DELETE") {
    json(405, { message: "Only deletes are stood in for here." });
    return;
  }

  if (!(req.url || "").startsWith("/api/custom-role/")) {
    json(200, {});
    return;
  }

  if (refuseWith) {
    json(refuseWith.status, { message: refuseWith.message });
    return;
  }

  let parsed: JSONObject = {};

  try {
    parsed = body ? (JSON.parse(body) as JSONObject) : {};
  } catch {
    json(400, { message: "The body is not JSON." });
    return;
  }

  const misc: JSONObject = (parsed["miscDataProps"] as JSONObject) || {};

  // Says nothing of what the workflows run as instead: refused, naming them.
  if (!misc["workflowsRunAs"]) {
    json(400, { message: REFUSAL });
    return;
  }

  json(200, {});
}

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body: string = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      received.push({
        method: req.method || "",
        url: req.url || "",
        apiKey: String(req.headers["apikey"] || ""),
        body,
      });
      answer(req, body, res);
    });
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  received.length = 0;
  refuseWith = null;
  process.env["ONEUPTIME_API_KEY"] = API_KEY;
  process.env["ONEUPTIME_URL"] = origin;
});

afterEach(() => {
  delete process.env["ONEUPTIME_API_KEY"];
  delete process.env["ONEUPTIME_URL"];
});

describe("oneuptime custom-role delete, against a stand-in for the API", () => {
  test("with nothing said, sends no body, and shows the API's refusal naming the workflows, then the flags", async () => {
    const run: CliRun = await runCli(["custom-role", "delete", ROLE_ID]);

    expect(received).toEqual([
      {
        method: "DELETE",
        url: `/api/custom-role/${ROLE_ID}/`,
        apiKey: API_KEY,
        body: "",
      },
    ]);
    expect(run.exitCode).toBe(1);
    expect(run.errors).toEqual([
      `API error (400): ${REFUSAL}`,
      "Run it again with --workflows-run-as Default, or with --workflows-run-as CustomRole --workflows-run-as-custom-role-id <custom-role-id>. Find <custom-role-id> with `oneuptime custom-role list`.",
    ]);
    expect(REFUSAL).toContain(
      'The workflow "Close stale incidents" runs as the custom role "Incident Responder".',
    );
  });

  test("--workflows-run-as Default is sent in the body, and the role is deleted", async () => {
    const run: CliRun = await runCli([
      "custom-role",
      "delete",
      ROLE_ID,
      "--workflows-run-as",
      "default",
    ]);

    expect(received).toHaveLength(1);
    expect(received[0]!.method).toBe("DELETE");
    expect(received[0]!.url).toBe(`/api/custom-role/${ROLE_ID}/`);
    expect(JSON.parse(received[0]!.body)).toEqual({
      miscDataProps: { workflowsRunAs: "Default" },
    });
    expect(run.exitCode).toBeUndefined();
    expect(run.printed).toEqual([
      `Custom Role ${ROLE_ID} deleted successfully.`,
    ]);
  });

  test("another custom role is sent with its ID, and the answer is JSON when asked", async () => {
    const run: CliRun = await runCli([
      "custom-role",
      "delete",
      ROLE_ID,
      "--workflows-run-as",
      "CustomRole",
      "--workflows-run-as-custom-role-id",
      OTHER_ROLE_ID,
      "--json",
    ]);

    expect(JSON.parse(received[0]!.body)).toEqual({
      miscDataProps: {
        workflowsRunAs: "CustomRole",
        workflowsRunAsCustomRoleId: OTHER_ROLE_ID,
      },
    });
    expect(run.exitCode).toBeUndefined();
    expect(printedJson(run)).toEqual({ _id: ROLE_ID, deleted: true });
  });

  test("Project Owner never reaches the API", async () => {
    const run: CliRun = await runCli([
      "custom-role",
      "delete",
      ROLE_ID,
      "--workflows-run-as",
      "ProjectOwner",
    ]);

    expect(received).toEqual([]);
    expect(run.exitCode).toBe(1);
    expect(run.errors[0]).toContain(
      "deleting a role never raises what a workflow can do",
    );
  });

  test("a refusal of a delete that said what they run as is the API's own words, with no hint about the flags", async () => {
    const refusal: string = getCustomRoleDeleteWorkflowEditRefusedMessage({
      workflowName: "Close stale incidents",
    });

    refuseWith = { status: 403, message: refusal };

    const run: CliRun = await runCli([
      "custom-role",
      "delete",
      ROLE_ID,
      "--workflows-run-as",
      "Default",
    ]);

    expect(JSON.parse(received[0]!.body)).toEqual({
      miscDataProps: { workflowsRunAs: "Default" },
    });
    expect(run.exitCode).toBe(1);
    expect(run.errors).toEqual([`API error (403): ${refusal}`]);
  });

  test("another resource's delete sends no body, as it always did", async () => {
    const run: CliRun = await runCli(["team", "delete", OTHER_ROLE_ID]);

    expect(received).toEqual([
      {
        method: "DELETE",
        url: `/api/team/${OTHER_ROLE_ID}/`,
        apiKey: API_KEY,
        body: "",
      },
    ]);
    expect(run.exitCode).toBeUndefined();
  });
});
