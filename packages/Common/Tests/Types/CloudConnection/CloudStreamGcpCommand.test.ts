import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildCloudStreamKey,
  getCloudStreamPushServiceAccountEmail,
} from "../../../Types/CloudConnection/CloudStream";
import {
  GCP_CLOUD_STREAM_COMMAND_DONE,
  GCP_CLOUD_STREAM_COMMAND_STOPPED,
  GCP_CLOUD_STREAM_EVERY_LOG_FILTER,
  GCP_CLOUD_STREAM_MAX_FILTER_LENGTH,
  GCP_CLOUD_STREAM_MAX_PROJECTS,
  GCP_CLOUD_STREAM_WARNINGS_FILTER,
  GCP_PUSH_TOKEN_ROLE,
  GCP_SINK_WRITER_ROLE,
  GcpCloudStreamLogs,
  STREAM_FILTER_TOO_LONG,
  STREAM_NOT_A_PROJECT,
  STREAM_NOT_HTTPS_FOR_PUBSUB,
  STREAM_NO_FILTER,
  STREAM_NO_HOST_PROJECT,
  STREAM_NO_PROJECT,
  STREAM_TOO_MANY_PROJECTS,
  getGcpCloudStreamCommand,
  getGcpCloudStreamDeleteCommand,
  getGcpCloudStreamFilter,
  getGcpCloudStreamNames,
  getGcpCloudStreamProblem,
  readGcpCloudStreamProjects,
} from "../../../Types/CloudConnection/CloudStreamGcp";
import { afterAll, describe, expect, test } from "@jest/globals";

/*
 * The command that streams a Google Cloud connection's logs, run for real
 * in bash against a fake gcloud: a function that records each call
 * (arguments apart by \037, calls by \036) and answers as Google would -
 * from the scenario, and from what the run itself made, so a sink made is
 * one a describe finds. Pinned:
 *
 *   - what it makes, and in what order: the push service account, the
 *     topic and its push subscription (the stream key as the token's
 *     audience), a sink in each project and its writer's grant;
 *   - least privilege: two roles in all, each on one resource - Pub/Sub's
 *     service agent may sign ID tokens for the push service account, and
 *     each sink's writer may publish to the topic - and nothing on a
 *     project or an organization;
 *   - a second run updates what the first made;
 *   - the first step Google refuses stops the rest, with Google's words
 *     and the command's own, and never closes the shell;
 *   - what the person types is never run by the shell.
 */

const CONNECTION: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const HOST: string = "acme-prod-1";
const KEY: string = buildCloudStreamKey({
  connectionId: CONNECTION,
  secret: "0123456789abcdef".repeat(4),
});
const ENDPOINT: string = "https://oneuptime.com/telemetry/gcp-pubsub/v1/logs";
const PUSHER: string =
  "oneuptime-push-6f1c3a2e@acme-prod-1.iam.gserviceaccount.com";
const NAMES: ReturnType<typeof getGcpCloudStreamNames> =
  getGcpCloudStreamNames(CONNECTION);

const FAKE_GCLOUD: string = String.raw`
record() {
  for arg in "$@"; do printf '%s\037' "$arg"; done >> "$CALLS"
  printf '\036' >> "$CALLS"
}
flag_value() {
  wanted="$1"; shift
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$wanted" ]; then printf '%s' "$2"; return 0; fi
    shift
  done
}
listed() {
  printf '%s\n' "$1" | grep -qxF -- "$2"
}
gcloud() {
  record gcloud "$@"
  project=$(flag_value --project "$@")
  case "$1" in
    iam|pubsub|logging) step="$1 $2 $3" ;;
    *) step="$1 $2" ;;
  esac
  if [ "$step" = "projects describe" ]; then project="$3"; fi
  if [ -n "$FAKE_FAIL" ] && listed "$FAKE_FAIL" "$step $project"; then
    echo "ERROR: (gcloud.$step) PERMISSION_DENIED: The caller does not have permission." >&2
    return 1
  fi
  case "$step" in
    "iam service-accounts describe")
      if [ "$FAKE_PUSHER_EXISTS" = 1 ]; then return 0; fi
      echo "ERROR: (gcloud.iam.service-accounts.describe) NOT_FOUND" >&2
      return 1 ;;
    "projects describe")
      echo "$FAKE_PROJECT_NUMBER"
      return 0 ;;
    "pubsub topics describe")
      if [ "$FAKE_TOPIC_EXISTS" = 1 ]; then return 0; fi
      return 1 ;;
    "pubsub subscriptions describe")
      if [ "$FAKE_SUBSCRIPTION_EXISTS" = 1 ]; then return 0; fi
      return 1 ;;
    "logging sinks describe")
      if listed "$FAKE_SINKS" "$project" || listed "$(cat "$STATE")" "$project"; then
        if [ -n "$(flag_value --format "$@")" ]; then
          echo "serviceAccount:writer-$project@gcp-sa-logging.iam.gserviceaccount.com"
        fi
        return 0
      fi
      return 1 ;;
    "logging sinks create")
      echo "$project" >> "$STATE"
      echo "Created [https://logging.googleapis.com/v2/projects/$project/sinks/$3]." >&2
      echo "Please remember to grant the writer the Pub/Sub Publisher role on the topic." >&2
      return 0 ;;
  esac
  return 0
}
`;

interface Scenario {
  pusherExists?: boolean;
  topicExists?: boolean;
  subscriptionExists?: boolean;
  // Projects that already have the sink.
  sinks?: Array<string>;
  // "<step> <project>", one a line: what Google refuses.
  fail?: Array<string>;
}

interface ShellRun {
  output: Array<string>;
  errors: string;
  calls: Array<Array<string>>;
  status: number | null;
  files: Array<string>;
}

const DIRECTORIES: Array<string> = [];

afterAll(() => {
  for (const directory of DIRECTORIES) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function run(
  command: string,
  scenario: Scenario = {},
  after: string = "",
): ShellRun {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "cloud-stream-gcp-"),
  );
  const work: string = path.join(directory, "home");
  const calls: string = path.join(directory, "calls");
  const state: string = path.join(directory, "state");

  DIRECTORIES.push(directory);
  fs.mkdirSync(work);
  fs.writeFileSync(calls, "");
  fs.writeFileSync(state, "");

  const shell: SpawnSyncReturns<string> = spawnSync(
    "bash",
    ["-c", `${FAKE_GCLOUD}\n${command}\n${after}`],
    {
      cwd: work,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] || "/usr/bin:/bin",
        CALLS: calls,
        STATE: state,
        FAKE_PROJECT_NUMBER: "123456789012",
        FAKE_PUSHER_EXISTS: scenario.pusherExists ? "1" : "0",
        FAKE_TOPIC_EXISTS: scenario.topicExists ? "1" : "0",
        FAKE_SUBSCRIPTION_EXISTS: scenario.subscriptionExists ? "1" : "0",
        FAKE_SINKS: (scenario.sinks || []).join("\n"),
        FAKE_FAIL: (scenario.fail || []).join("\n"),
      },
    },
  );

  expect(shell.error).toBeUndefined();

  return {
    output: shell.stdout.split("\n").filter((line: string): boolean => {
      return line.length > 0;
    }),
    errors: shell.stderr,
    calls: fs
      .readFileSync(calls, "utf8")
      .split("\u001e")
      .filter((call: string): boolean => {
        return call.length > 0;
      })
      .map((call: string): Array<string> => {
        return call.split("\u001f").slice(0, -1);
      }),
    status: shell.status,
    files: fs.readdirSync(work),
  };
}

function command(
  data: {
    projects?: Array<string>;
    filter?: string;
    streamKey?: string | null;
  } = {},
): string {
  return getGcpCloudStreamCommand({
    connectionId: CONNECTION,
    hostProjectId: HOST,
    projectIds: data.projects || [HOST, "acme-data-2"],
    endpoint: ENDPOINT,
    filter: data.filter ?? GCP_CLOUD_STREAM_WARNINGS_FILTER,
    streamKey: data.streamKey === undefined ? KEY : data.streamKey,
  });
}

const NO_EXIT: RegExp = /\bexit\b/;

// The calls of one step ("pubsub subscriptions create"), in order.
function callsOf(shellRun: ShellRun, step: string): Array<Array<string>> {
  const words: Array<string> = step.split(" ");

  return shellRun.calls.filter((call: Array<string>): boolean => {
    return words.every((word: string, index: number): boolean => {
      return call[index + 1] === word;
    });
  });
}

function flag(call: Array<string>, name: string): string | undefined {
  const index: number = call.indexOf(name);
  return index >= 0 ? call[index + 1] : undefined;
}

describe("The Google Cloud streaming command, run in bash", () => {
  test("in a project with nothing yet, it makes the push service account, the topic, its push subscription and a sink in each project", () => {
    const shellRun: ShellRun = run(command());

    expect(shellRun.status).toBe(0);
    expect(shellRun.files).toEqual([]);
    expect(shellRun.output).toEqual([
      `${HOST}: streaming.`,
      "acme-data-2: streaming.",
      GCP_CLOUD_STREAM_COMMAND_DONE,
    ]);

    // The APIs first, in the topic's project.
    expect(shellRun.calls[0]).toEqual([
      "gcloud",
      "services",
      "enable",
      "pubsub.googleapis.com",
      "logging.googleapis.com",
      "--project",
      HOST,
    ]);

    // The push service account, made for the pushes alone.
    const created: Array<Array<string>> = callsOf(
      shellRun,
      "iam service-accounts create",
    );
    expect(created).toHaveLength(1);
    expect(created[0]![4]).toBe(NAMES.pushServiceAccountId);
    expect(flag(created[0]!, "--project")).toBe(HOST);

    // Pub/Sub's own service agent may sign ID tokens for it, and nothing else.
    const tokenGrant: Array<Array<string>> = callsOf(
      shellRun,
      "iam service-accounts add-iam-policy-binding",
    );
    expect(tokenGrant).toHaveLength(1);
    expect(tokenGrant[0]![4]).toBe(PUSHER);
    expect(flag(tokenGrant[0]!, "--member")).toBe(
      "serviceAccount:service-123456789012@gcp-sa-pubsub.iam.gserviceaccount.com",
    );
    expect(flag(tokenGrant[0]!, "--role")).toBe(GCP_PUSH_TOKEN_ROLE);

    expect(callsOf(shellRun, "pubsub topics create")).toEqual([
      ["gcloud", "pubsub", "topics", "create", NAMES.topic, "--project", HOST],
    ]);

    // The push subscription: OneUptime's endpoint, the key as the token's audience.
    const subscription: Array<Array<string>> = callsOf(
      shellRun,
      "pubsub subscriptions create",
    );
    expect(subscription).toHaveLength(1);
    expect(subscription[0]![4]).toBe(NAMES.subscription);
    expect(flag(subscription[0]!, "--topic")).toBe(NAMES.topic);
    expect(flag(subscription[0]!, "--push-endpoint")).toBe(ENDPOINT);
    expect(flag(subscription[0]!, "--push-auth-service-account")).toBe(PUSHER);
    expect(flag(subscription[0]!, "--push-auth-token-audience")).toBe(KEY);
    expect(flag(subscription[0]!, "--ack-deadline")).toBe("60");
    expect(flag(subscription[0]!, "--message-retention-duration")).toBe(
      "86400s",
    );
    expect(flag(subscription[0]!, "--expiration-period")).toBe("never");
    expect(flag(subscription[0]!, "--min-retry-delay")).toBe("10s");
    expect(flag(subscription[0]!, "--max-retry-delay")).toBe("600s");
    expect(callsOf(shellRun, "pubsub subscriptions update")).toEqual([]);

    // A sink in each project, to the topic, with the filter.
    const sinks: Array<Array<string>> = callsOf(
      shellRun,
      "logging sinks create",
    );
    expect(
      sinks.map((call: Array<string>): string | undefined => {
        return flag(call, "--project");
      }),
    ).toEqual([HOST, "acme-data-2"]);

    for (const sink of sinks) {
      expect(sink[4]).toBe(NAMES.sink);
      expect(sink[5]).toBe(
        `pubsub.googleapis.com/projects/${HOST}/topics/${NAMES.topic}`,
      );
      expect(flag(sink, "--log-filter")).toBe(GCP_CLOUD_STREAM_WARNINGS_FILTER);
    }

    // Each sink's writer may publish to the topic, on the topic alone.
    const publishers: Array<Array<string>> = callsOf(
      shellRun,
      "pubsub topics add-iam-policy-binding",
    );
    expect(
      publishers.map((call: Array<string>): Array<string | undefined> => {
        return [
          call[4],
          flag(call, "--project"),
          flag(call, "--member"),
          flag(call, "--role"),
        ];
      }),
    ).toEqual([
      [
        NAMES.topic,
        HOST,
        `serviceAccount:writer-${HOST}@gcp-sa-logging.iam.gserviceaccount.com`,
        GCP_SINK_WRITER_ROLE,
      ],
      [
        NAMES.topic,
        HOST,
        "serviceAccount:writer-acme-data-2@gcp-sa-logging.iam.gserviceaccount.com",
        GCP_SINK_WRITER_ROLE,
      ],
    ]);
  });

  test("it grants two roles in all, each on one resource, and nothing on a project or an organization", () => {
    const shellRun: ShellRun = run(command());
    const roles: Array<string> = [];

    for (const call of shellRun.calls) {
      const role: string | undefined = flag(call, "--role");

      if (role) {
        roles.push(`${call.slice(1, 4).join(" ")} ${call[4]} ${role}`);
      }

      expect(call.slice(1, 3)).not.toEqual([
        "projects",
        "add-iam-policy-binding",
      ]);
      expect(call[1]).not.toBe("organizations");
    }

    expect(Array.from(new Set(roles))).toEqual([
      `iam service-accounts add-iam-policy-binding ${PUSHER} ${GCP_PUSH_TOKEN_ROLE}`,
      `pubsub topics add-iam-policy-binding ${NAMES.topic} ${GCP_SINK_WRITER_ROLE}`,
    ]);
    // The push service account itself is given nothing.
    expect(
      shellRun.calls.some((call: Array<string>): boolean => {
        return flag(call, "--member") === `serviceAccount:${PUSHER}`;
      }),
    ).toBe(false);
  });

  test("run again, it updates what the first run made: the subscription takes the new key", () => {
    const newKey: string = buildCloudStreamKey({
      connectionId: CONNECTION,
      secret: "fedcba9876543210".repeat(4),
    });
    const shellRun: ShellRun = run(command({ streamKey: newKey }), {
      pusherExists: true,
      topicExists: true,
      subscriptionExists: true,
      sinks: [HOST, "acme-data-2"],
    });

    expect(shellRun.output).toEqual([
      `${HOST}: streaming.`,
      "acme-data-2: streaming.",
      GCP_CLOUD_STREAM_COMMAND_DONE,
    ]);
    expect(callsOf(shellRun, "iam service-accounts create")).toEqual([]);
    expect(callsOf(shellRun, "pubsub topics create")).toEqual([]);
    expect(callsOf(shellRun, "pubsub subscriptions create")).toEqual([]);
    expect(callsOf(shellRun, "logging sinks create")).toEqual([]);

    const updated: Array<Array<string>> = callsOf(
      shellRun,
      "pubsub subscriptions update",
    );
    expect(updated).toHaveLength(1);
    expect(flag(updated[0]!, "--push-auth-token-audience")).toBe(newKey);
    expect(flag(updated[0]!, "--push-auth-service-account")).toBe(PUSHER);
    expect(flag(updated[0]!, "--push-endpoint")).toBe(ENDPOINT);
    expect(callsOf(shellRun, "logging sinks update")).toHaveLength(2);
  });

  test("a step Google refuses stops the rest: Google's words, then the command's, and no later project", () => {
    const shellRun: ShellRun = run(
      command({ projects: [HOST, "acme-data-2", "acme-web-3"] }),
      { fail: ["logging sinks create acme-data-2"] },
    );

    expect(shellRun.status).toBe(0);
    expect(shellRun.output).toEqual([
      `${HOST}: streaming.`,
      "ERROR: (gcloud.logging sinks create) PERMISSION_DENIED: The caller does not have permission.",
      "acme-data-2: the log sink could not be made.",
      GCP_CLOUD_STREAM_COMMAND_STOPPED,
    ]);
    // Nothing for the project after it.
    expect(
      shellRun.calls.some((call: Array<string>): boolean => {
        return flag(call, "--project") === "acme-web-3";
      }),
    ).toBe(false);
    // A sink made is not reported as refused: its reminder is the command's to act on.
    expect(shellRun.output.join("\n")).not.toContain("Please remember");
  });

  test("a refusal at the very start sets nothing up at all", () => {
    const shellRun: ShellRun = run(command(), {
      fail: [`services enable ${HOST}`],
    });

    expect(shellRun.output).toEqual([
      "Pub/Sub and Cloud Logging could not be turned on in the project.",
      GCP_CLOUD_STREAM_COMMAND_STOPPED,
    ]);
    expect(shellRun.calls).toHaveLength(1);
  });

  test("a refused subscription stops before any sink", () => {
    const shellRun: ShellRun = run(command(), {
      fail: [`pubsub subscriptions create ${HOST}`],
    });

    expect(shellRun.output).toEqual([
      "The push subscription could not be made.",
      GCP_CLOUD_STREAM_COMMAND_STOPPED,
    ]);
    expect(callsOf(shellRun, "logging sinks create")).toEqual([]);
  });

  test("it never closes the shell: what follows it runs, whatever happened", () => {
    for (const scenario of [{}, { fail: [`services enable ${HOST}`] }]) {
      const shellRun: ShellRun = run(command(), scenario, "echo STILL-HERE");

      expect(shellRun.output[shellRun.output.length - 1]).toBe("STILL-HERE");
      expect(shellRun.status).toBe(0);
    }

    expect(command()).not.toMatch(NO_EXIT);
  });

  test("a filter of the person's own reaches Google as typed: the shell runs none of it", () => {
    const filter: string =
      'resource.type="cloud_run_revision" AND textPayload:"it\'s $(touch pwned) `touch pwned2`"';
    const shellRun: ShellRun = run(command({ filter }));

    for (const sink of callsOf(shellRun, "logging sinks create")) {
      expect(flag(sink, "--log-filter")).toBe(filter);
    }

    expect(shellRun.files).toEqual([]);
  });

  test("before a key is made, the command holds a placeholder in its place", () => {
    const text: string = command({ streamKey: null });
    const shellRun: ShellRun = run(text);

    expect(text).toContain("<YOUR_STREAM_KEY>");
    expect(
      flag(
        callsOf(shellRun, "pubsub subscriptions create")[0]!,
        "--push-auth-token-audience",
      ),
    ).toBe("<YOUR_STREAM_KEY>");
  });

  test("projects that are not project IDs never reach the command", () => {
    const text: string = command({
      projects: [HOST, "Not A Project; rm -rf /", "acme-data-2"],
    });

    expect(text).not.toContain("rm -rf");
    expect(
      callsOf(run(text), "logging sinks create").map(
        (call: Array<string>): string | undefined => {
          return flag(call, "--project");
        },
      ),
    ).toEqual([HOST, "acme-data-2"]);
  });
});

describe("Stop streaming's command for Google Cloud", () => {
  test("it deletes each project's sink, then the subscription, the topic and the push service account", () => {
    const text: string = getGcpCloudStreamDeleteCommand({
      connectionId: CONNECTION,
      hostProjectId: HOST,
      projectIds: [HOST, "ACME-DATA-2", "acme-data-2", "not a project"],
    });
    const shellRun: ShellRun = run(text);

    expect(shellRun.calls).toEqual([
      [
        "gcloud",
        "logging",
        "sinks",
        "delete",
        NAMES.sink,
        "--project",
        HOST,
        "--quiet",
      ],
      [
        "gcloud",
        "logging",
        "sinks",
        "delete",
        NAMES.sink,
        "--project",
        "acme-data-2",
        "--quiet",
      ],
      [
        "gcloud",
        "pubsub",
        "subscriptions",
        "delete",
        NAMES.subscription,
        "--project",
        HOST,
        "--quiet",
      ],
      [
        "gcloud",
        "pubsub",
        "topics",
        "delete",
        NAMES.topic,
        "--project",
        HOST,
        "--quiet",
      ],
      [
        "gcloud",
        "iam",
        "service-accounts",
        "delete",
        PUSHER,
        "--project",
        HOST,
        "--quiet",
      ],
    ]);
  });

  test("with no project known it still deletes what lives in the host project", () => {
    const text: string = getGcpCloudStreamDeleteCommand({
      connectionId: CONNECTION,
      hostProjectId: HOST,
      projectIds: [],
    });

    expect(text.split("\n")).toHaveLength(3);
    expect(text).not.toContain("for SOURCE");
  });
});

describe("The Google Cloud stream's names, filters and problems", () => {
  test("every name ends in the connection's 8 hex characters, so two connections stream one project side by side", () => {
    expect(NAMES).toEqual({
      topic: "oneuptime-stream-6f1c3a2e",
      subscription: "oneuptime-stream-6f1c3a2e-push",
      sink: "oneuptime-stream-6f1c3a2e",
      pushServiceAccountId: "oneuptime-push-6f1c3a2e",
    });
    expect(
      getGcpCloudStreamNames("11111111-2222-4333-8444-555555555555").topic,
    ).toBe("oneuptime-stream-11111111");
    // A service account id is 6 to 30 characters.
    expect(NAMES.pushServiceAccountId.length).toBeLessThanOrEqual(30);
  });

  test("the push service account lives in the host project, a domain-scoped one too", () => {
    expect(
      getCloudStreamPushServiceAccountEmail({
        connectionId: CONNECTION,
        projectId: HOST,
      }),
    ).toBe(PUSHER);
    expect(
      getCloudStreamPushServiceAccountEmail({
        connectionId: CONNECTION,
        projectId: "example.com:acme-prod-1",
      }),
    ).toBe(
      "oneuptime-push-6f1c3a2e@acme-prod-1.example.com.iam.gserviceaccount.com",
    );
    expect(
      getCloudStreamPushServiceAccountEmail({
        connectionId: CONNECTION,
        projectId: "Bad Project",
      }),
    ).toBeNull();
  });

  test("each choice has its filter: warnings by default, every log without the data-read audit logs", () => {
    expect(
      getGcpCloudStreamFilter({
        logs: GcpCloudStreamLogs.WarningsAndErrors,
        customFilter: "x",
      }),
    ).toBe("severity>=WARNING");
    expect(
      getGcpCloudStreamFilter({
        logs: GcpCloudStreamLogs.Every,
        customFilter: "x",
      }),
    ).toBe(GCP_CLOUD_STREAM_EVERY_LOG_FILTER);
    expect(GCP_CLOUD_STREAM_EVERY_LOG_FILTER).toContain(
      "cloudaudit.googleapis.com/data_access",
    );
    expect(
      getGcpCloudStreamFilter({
        logs: GcpCloudStreamLogs.Custom,
        customFilter: '  resource.type="gce_instance"  ',
      }),
    ).toBe('resource.type="gce_instance"');
  });

  test("projects typed one a line or by commas are read lower case, each once", () => {
    expect(
      readGcpCloudStreamProjects("acme-prod-1, ACME-PROD-1\nacme-data-2,,\n  "),
    ).toEqual(["acme-prod-1", "acme-data-2"]);
  });

  test("what stops a command being written, each said", () => {
    const base: Parameters<typeof getGcpCloudStreamProblem>[0] = {
      hostProjectId: HOST,
      projectIds: [HOST],
      logs: GcpCloudStreamLogs.WarningsAndErrors,
      customFilter: "",
      endpoint: ENDPOINT,
    };

    expect(getGcpCloudStreamProblem(base)).toBeNull();
    expect(
      getGcpCloudStreamProblem({
        ...base,
        endpoint: "http://oneuptime.local/telemetry/gcp-pubsub/v1/logs",
      })?.text,
    ).toBe(STREAM_NOT_HTTPS_FOR_PUBSUB);
    expect(getGcpCloudStreamProblem({ ...base, hostProjectId: "" })?.text).toBe(
      STREAM_NO_HOST_PROJECT,
    );
    expect(getGcpCloudStreamProblem({ ...base, projectIds: [] })?.text).toBe(
      STREAM_NO_PROJECT,
    );
    expect(
      getGcpCloudStreamProblem({
        ...base,
        projectIds: Array.from(
          { length: GCP_CLOUD_STREAM_MAX_PROJECTS + 1 },
          (_value: unknown, index: number): string => {
            return `project-${String(index).padStart(3, "0")}`;
          },
        ),
      }),
    ).toEqual({
      text: STREAM_TOO_MANY_PROJECTS,
      values: { count: String(GCP_CLOUD_STREAM_MAX_PROJECTS) },
    });
    expect(
      getGcpCloudStreamProblem({ ...base, projectIds: ["Prod"] })?.text,
    ).toBe(STREAM_NOT_A_PROJECT);
    expect(
      getGcpCloudStreamProblem({ ...base, logs: GcpCloudStreamLogs.Custom })
        ?.text,
    ).toBe(STREAM_NO_FILTER);
    expect(
      getGcpCloudStreamProblem({
        ...base,
        logs: GcpCloudStreamLogs.Custom,
        customFilter: "a".repeat(GCP_CLOUD_STREAM_MAX_FILTER_LENGTH + 1),
      }),
    ).toEqual({
      text: STREAM_FILTER_TOO_LONG,
      values: { count: String(GCP_CLOUD_STREAM_MAX_FILTER_LENGTH) },
    });
  });
});
