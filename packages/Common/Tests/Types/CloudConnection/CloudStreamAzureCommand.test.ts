import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  AZURE_CLOUD_STREAM_COMMAND_DONE,
  AZURE_CLOUD_STREAM_COMMAND_STOPPED,
  AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS,
  AZURE_CLOUD_STREAM_RESOURCE_TYPES,
  AZURE_DIAGNOSTIC_LOGS,
  AZURE_DIAGNOSTIC_METRICS,
  AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE,
  STREAM_NOT_A_SUBSCRIPTION,
  STREAM_NO_APP,
  STREAM_NO_SUBSCRIPTION,
  STREAM_TOO_MANY_SUBSCRIPTIONS,
  getAzureCloudStreamCommand,
  getAzureCloudStreamDeleteCommand,
  getAzureCloudStreamNames,
  getAzureCloudStreamNamespace,
  getAzureCloudStreamProblem,
  getAzureEventHubsHost,
  isAzureEventHubsNamespace,
  isAzureRegion,
  readAzureCloudStreamNamespaceRegion,
  readAzureCloudStreamSubscriptions,
} from "../../../Types/CloudConnection/CloudStreamAzure";
import { afterAll, describe, expect, test } from "@jest/globals";

/*
 * The command that streams an Azure connection's metrics and logs, run for
 * real in bash against a fake az: a function that records each call
 * (arguments apart by \037, calls by \036, each call written at once, since
 * the command sets resources up a few at a time) and answers from the
 * scenario - each subscription's resources, which diagnostic categories
 * each resource has, what already exists - and from what the run itself
 * made. Pinned:
 *
 *   - an event hub in each region the subscriptions have a resource of a
 *     type OneUptime reads in, and a diagnostic setting on each such
 *     resource to its own region's event hub; a global resource to the
 *     first region's; the group's own event hubs never;
 *   - least privilege: one role, Azure Event Hubs Data Receiver, for the
 *     connection's app, on the command's resource group alone;
 *   - a resource Azure takes only metrics or only logs of is set up with
 *     what it has; one it takes nothing of is listed with Azure's reason;
 *   - a second run updates what the first made; a region whose event hub
 *     cannot be made is said and left out; a refused group stops it all -
 *     and the shell is never closed.
 */

const CONNECTION: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const APP: string = "0b9f6c1e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const SUB_A: string = "11111111-aaaa-4aaa-8aaa-111111111111";
const SUB_B: string = "22222222-bbbb-4bbb-8bbb-222222222222";
const NAMES: ReturnType<typeof getAzureCloudStreamNames> =
  getAzureCloudStreamNames(CONNECTION);
const GROUP_SCOPE: string = `/subscriptions/${SUB_A}/resourceGroups/${NAMES.resourceGroup}`;

function armId(subscription: string, group: string, type: string, name: string): string {
  return `/subscriptions/${subscription}/resourceGroups/${group}/providers/${type}/${name}`;
}

const VM: string = armId(SUB_A, "rg-prod", "Microsoft.Compute/virtualMachines", "web-01");
const SITE: string = armId(SUB_A, "rg-prod", "Microsoft.Web/sites", "checkout");
const VAULT: string = armId(SUB_B, "rg-sec", "Microsoft.KeyVault/vaults", "secrets");
const FRONT_DOOR: string = armId(SUB_A, "rg-edge", "Microsoft.Network/frontdoors", "edge");
const DISK: string = armId(SUB_B, "rg-data", "Microsoft.Compute/disks", "data-disk");
const NSG: string = armId(SUB_A, "rg-prod", "Microsoft.Network/networkSecurityGroups", "nsg");
const OUR_NAMESPACE: string = armId(
  SUB_A,
  NAMES.resourceGroup,
  "Microsoft.EventHub/namespaces",
  `${NAMES.namespacePrefix}eastus`,
);

// "<subscription>\t<id>\t<location>\t<type>", as az resource list's rows.
const RESOURCES: Array<string> = [
  `${SUB_A}\t${VM}\tEastUS\tMicrosoft.Compute/virtualMachines`,
  `${SUB_A}\t${SITE}\teastus\tMicrosoft.Web/sites`,
  `${SUB_A}\t${FRONT_DOOR}\tglobal\tMicrosoft.Network/frontdoors`,
  `${SUB_A}\t${NSG}\teastus\tMicrosoft.Network/networkSecurityGroups`,
  `${SUB_A}\t${OUR_NAMESPACE}\teastus\tMicrosoft.EventHub/namespaces`,
  `${SUB_B}\t${VAULT}\twesteurope\tMicrosoft.KeyVault/vaults`,
  `${SUB_B}\t${DISK}\twesteurope\tMicrosoft.Compute/disks`,
];

const FAKE_AZ: string = String.raw`
record() {
  line=""
  for arg in "$@"; do line="$line$arg"$'\037'; done
  printf '%s\036' "$line" >> "$CALLS"
}
flag_value() {
  wanted="$1"; shift
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$wanted" ]; then printf '%s' "$2"; return 0; fi
    shift
  done
}
has_flag() {
  wanted="$1"; shift
  for arg in "$@"; do if [ "$arg" = "$wanted" ]; then return 0; fi; done
  return 1
}
listed() {
  printf '%s\n' "$1" | grep -qxF -- "$2"
}
az() {
  record az "$@"
  sub=$(flag_value --subscription "$@")
  name=$(flag_value --name "$@")
  location=$(flag_value --location "$@")
  case "$1 $2 $3" in
    "resource list "*)
      if listed "$FAKE_FAIL" "resource list $sub"; then echo "(AuthorizationFailed) cannot list" >&2; return 1; fi
      while IFS=$'\t' read -r owner id loc type; do
        if [ "$owner" = "$sub" ]; then
          if has_flag "[].id" "$@"; then printf '%s\n' "$id"; else printf '%s\t%s\t%s\n' "$id" "$loc" "$type"; fi
        fi
      done <<< "$FAKE_RESOURCES"
      return 0 ;;
    "group create "*)
      if listed "$FAKE_FAIL" "group create"; then echo "(AuthorizationFailed) The client may not create resource groups." >&2; return 1; fi
      return 0 ;;
    "role assignment create")
      if [ "$FAKE_ROLE_EXISTS" = 1 ]; then echo "The role assignment already exists." >&2; return 1; fi
      return 0 ;;
    "role assignment list")
      if [ "$FAKE_ROLE_EXISTS" = 1 ]; then echo "/subscriptions/x/providers/Microsoft.Authorization/roleAssignments/1"; fi
      return 0 ;;
    "group exists "*)
      if listed "$FAKE_GROUPS" "$sub"; then echo true; else echo false; fi
      return 0 ;;
    "eventhubs namespace show")
      if listed "$FAKE_NAMESPACES" "$name" || listed "$(cat "$STATE")" "ns $name"; then return 0; fi
      echo "(ResourceNotFound)" >&2
      return 1 ;;
    "eventhubs namespace create")
      if listed "$FAKE_FAIL" "namespace create $location"; then echo "(LocationNotAvailableForResourceType) Event Hubs is not available in $location." >&2; return 1; fi
      echo "ns $name" >> "$STATE"
      return 0 ;;
    "eventhubs eventhub show")
      ns=$(flag_value --namespace-name "$@")
      if listed "$FAKE_NAMESPACES" "$ns" || listed "$(cat "$STATE")" "hub $ns"; then return 0; fi
      return 1 ;;
    "eventhubs eventhub create")
      ns=$(flag_value --namespace-name "$@")
      echo "hub $ns" >> "$STATE"
      return 0 ;;
    "monitor diagnostic-settings create")
      resource=$(flag_value --resource "$@")
      rule=$(flag_value --event-hub-rule "$@")
      ns=$(printf '%s' "$rule" | sed -n 's|.*/namespaces/\([^/]*\)/authorizationRules/.*|\1|p')
      if ! listed "$FAKE_NAMESPACES" "$ns" && ! listed "$(cat "$STATE")" "hub $ns"; then
        echo "(ResourceNotFound) The event hub namespace $ns was not found." >&2; return 1
      fi
      support="none"
      while IFS=$'\t' read -r id kinds; do
        if [ "$id" = "$resource" ]; then support="$kinds"; fi
      done <<< "$FAKE_SUPPORT"
      if [ "$support" = full ]; then echo "(Conflict) Diagnostic settings count exceeds the limit of 5." >&2; return 1; fi
      if [ "$support" = none ]; then echo "(BadRequest) The resource type does not support diagnostic settings." >&2; return 1; fi
      if has_flag --logs "$@" && [ "$support" = metrics ]; then echo "(BadRequest) Category group 'allLogs' is not supported." >&2; return 1; fi
      if has_flag --metrics "$@" && [ "$support" = logs ]; then echo "(BadRequest) Category 'AllMetrics' is not supported." >&2; return 1; fi
      return 0 ;;
  esac
  return 0
}
`;

interface Scenario {
  // Resources and the categories Azure takes of each: both, metrics, logs, none, full.
  support?: Record<string, string>;
  namespaces?: Array<string>;
  roleExists?: boolean;
  fail?: Array<string>;
  // The subscriptions the command's resource group is in.
  groups?: Array<string>;
}

interface ShellRun {
  output: Array<string>;
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

const ALL_SUPPORTED: Record<string, string> = {
  [VM]: "metrics",
  [SITE]: "both",
  [FRONT_DOOR]: "both",
  [VAULT]: "both",
  [DISK]: "none",
  [NSG]: "both",
};

function run(command: string, scenario: Scenario = {}, after: string = ""): ShellRun {
  const directory: string = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-stream-azure-"));
  const work: string = path.join(directory, "home");
  const calls: string = path.join(directory, "calls");
  const state: string = path.join(directory, "state");

  DIRECTORIES.push(directory);
  fs.mkdirSync(work);
  fs.writeFileSync(calls, "");
  fs.writeFileSync(state, "");

  const support: Record<string, string> = scenario.support || ALL_SUPPORTED;

  const shell: SpawnSyncReturns<string> = spawnSync(
    "bash",
    ["-c", `${FAKE_AZ}\n${command}\n${after}`],
    {
      cwd: work,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] || "/usr/bin:/bin",
        TMPDIR: work,
        CALLS: calls,
        STATE: state,
        FAKE_RESOURCES: RESOURCES.join("\n"),
        FAKE_SUPPORT: Object.keys(support)
          .map((id: string): string => {
            return `${id}\t${support[id]}`;
          })
          .join("\n"),
        FAKE_NAMESPACES: (scenario.namespaces || []).join("\n"),
        FAKE_ROLE_EXISTS: scenario.roleExists ? "1" : "0",
        FAKE_FAIL: (scenario.fail || []).join("\n"),
        FAKE_GROUPS: (scenario.groups || []).join("\n"),
      },
    },
  );

  expect(shell.error).toBeUndefined();

  return {
    output: shell.stdout.split("\n").filter((line: string): boolean => {
      return line.length > 0;
    }),
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
    // What the command leaves in the directory it ran in: its temporary files must go.
    files: fs.readdirSync(work),
  };
}

function command(
  data: { metrics?: boolean; logs?: boolean; subscriptions?: Array<string> } = {},
): string {
  return getAzureCloudStreamCommand({
    connectionId: CONNECTION,
    appId: APP,
    subscriptionIds: data.subscriptions || [SUB_A, SUB_B],
    metrics: data.metrics ?? true,
    logs: data.logs ?? true,
  });
}

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

function ruleOf(region: string): string {
  return `${GROUP_SCOPE}/providers/Microsoft.EventHub/namespaces/${NAMES.namespacePrefix}${region}/authorizationRules/RootManageSharedAccessKey`;
}

// Each resource's diagnostic setting calls: its rule and categories, in the order tried.
function settingsByResource(shellRun: ShellRun): Record<string, Array<string>> {
  const settings: Record<string, Array<string>> = {};

  for (const call of callsOf(shellRun, "monitor diagnostic-settings create")) {
    const resource: string = flag(call, "--resource") || "";
    const kinds: string = [
      call.includes("--logs") ? "logs" : "",
      call.includes("--metrics") ? "metrics" : "",
    ]
      .filter(Boolean)
      .join("+");

    expect(flag(call, "--name")).toBe(NAMES.diagnosticSetting);
    expect(flag(call, "--event-hub")).toBe(NAMES.eventHub);
    (settings[resource] = settings[resource] || []).push(
      `${kinds} ${flag(call, "--event-hub-rule")}`,
    );

    if (call.includes("--logs")) {
      expect(flag(call, "--logs")).toBe(AZURE_DIAGNOSTIC_LOGS);
    }

    if (call.includes("--metrics")) {
      expect(flag(call, "--metrics")).toBe(AZURE_DIAGNOSTIC_METRICS);
    }
  }

  return settings;
}

const NO_EXIT: RegExp = /\bexit\b/;

describe("The Azure streaming command, run in bash", () => {
  test("it makes an event hub in each region of a resource OneUptime reads, and sends each resource to its own region's", () => {
    const shellRun: ShellRun = run(command());

    expect(shellRun.status).toBe(0);
    expect(shellRun.files).toEqual([]);

    // One group, in the first subscription and the first region, tagged with the connection.
    const group: Array<Array<string>> = callsOf(shellRun, "group create");
    expect(group).toHaveLength(1);
    expect(flag(group[0]!, "--subscription")).toBe(SUB_A);
    expect(flag(group[0]!, "--name")).toBe(NAMES.resourceGroup);
    expect(flag(group[0]!, "--location")).toBe("eastus");
    expect(flag(group[0]!, "--tags")).toBe(`oneuptime-connection=${CONNECTION}`);

    // A namespace in each region with a resource of a known type - not for global, nor for a disk-only one twice.
    const namespaces: Array<Array<string>> = callsOf(shellRun, "eventhubs namespace create");
    expect(
      namespaces.map((call: Array<string>): Array<string | undefined> => {
        return [flag(call, "--name"), flag(call, "--location"), flag(call, "--sku"), flag(call, "--capacity")];
      }),
    ).toEqual([
      [`${NAMES.namespacePrefix}eastus`, "eastus", "Standard", "1"],
      [`${NAMES.namespacePrefix}westeurope`, "westeurope", "Standard", "1"],
    ]);

    for (const call of namespaces) {
      expect(flag(call, "--subscription")).toBe(SUB_A);
      expect(flag(call, "--resource-group")).toBe(NAMES.resourceGroup);
    }

    expect(
      callsOf(shellRun, "eventhubs eventhub create").map(
        (call: Array<string>): Array<string | undefined> => {
          return [flag(call, "--namespace-name"), flag(call, "--name"), flag(call, "--partition-count")];
        },
      ),
    ).toEqual([
      [`${NAMES.namespacePrefix}eastus`, "oneuptime", "2"],
      [`${NAMES.namespacePrefix}westeurope`, "oneuptime", "2"],
    ]);

    // Each resource to its region's event hub; the global one to the first region's.
    const settings: Record<string, Array<string>> = settingsByResource(shellRun);
    expect(settings[SITE]).toEqual([`logs+metrics ${ruleOf("eastus")}`]);
    expect(settings[FRONT_DOOR]).toEqual([`logs+metrics ${ruleOf("eastus")}`]);
    expect(settings[VAULT]).toEqual([`logs+metrics ${ruleOf("westeurope")}`]);
    // A VM has no resource logs: its metrics alone.
    expect(settings[VM]).toEqual([
      `logs+metrics ${ruleOf("eastus")}`,
      `metrics ${ruleOf("eastus")}`,
    ]);
    // A type OneUptime does not read, and the group's own namespace, are never set up.
    expect(settings[NSG]).toBeUndefined();
    expect(settings[OUR_NAMESPACE]).toBeUndefined();

    expect(shellRun.output).toEqual([
      "eastus: event hub ready.",
      "westeurope: event hub ready.",
      "Diagnostic settings: 4 resources send to OneUptime's event hubs.",
      "1 resources were left out: they have no diagnostic settings, or Azure refused:",
      `${DISK}\t(BadRequest) The resource type does not support diagnostic settings.`,
      AZURE_CLOUD_STREAM_COMMAND_DONE,
    ]);
  });

  test("it gives the connection's app one role, Azure Event Hubs Data Receiver, on the command's resource group alone", () => {
    const shellRun: ShellRun = run(command());
    const roles: Array<Array<string>> = shellRun.calls.filter(
      (call: Array<string>): boolean => {
        return call.includes("--role");
      },
    );

    expect(callsOf(shellRun, "role assignment create")).toEqual([
      [
        "az",
        "role",
        "assignment",
        "create",
        "--assignee",
        APP,
        "--role",
        AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE,
        "--scope",
        GROUP_SCOPE,
        "--output",
        "none",
      ],
    ]);
    expect(
      roles.every((call: Array<string>): boolean => {
        return (
          flag(call, "--role") === AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE &&
          flag(call, "--scope") === GROUP_SCOPE
        );
      }),
    ).toBe(true);
    // No app, secret or key is made: the connection's own app reads.
    expect(
      shellRun.calls.some((call: Array<string>): boolean => {
        return call[1] === "ad" || call.join(" ").includes("keys list");
      }),
    ).toBe(false);
  });

  test("a resource Azure takes only logs of is set up with its logs; one with five settings already is said", () => {
    const shellRun: ShellRun = run(command(), {
      support: { ...ALL_SUPPORTED, [SITE]: "logs", [VAULT]: "full" },
    });
    const settings: Record<string, Array<string>> = settingsByResource(shellRun);

    expect(settings[SITE]).toEqual([
      `logs+metrics ${ruleOf("eastus")}`,
      `metrics ${ruleOf("eastus")}`,
      `logs ${ruleOf("eastus")}`,
    ]);
    expect(shellRun.output).toContain(
      "Diagnostic settings: 3 resources send to OneUptime's event hubs.",
    );
    expect(shellRun.output).toContain(
      "2 resources were left out: they have no diagnostic settings, or Azure refused:",
    );
    expect(shellRun.output).toContain(
      `${VAULT}\t(Conflict) Diagnostic settings count exceeds the limit of 5.`,
    );
  });

  test("metrics alone send AllMetrics only, and logs alone allLogs only", () => {
    const metricsOnly: Record<string, Array<string>> = settingsByResource(
      run(command({ logs: false })),
    );
    const logsOnly: Record<string, Array<string>> = settingsByResource(
      run(command({ metrics: false })),
    );

    expect(metricsOnly[SITE]).toEqual([`metrics ${ruleOf("eastus")}`]);
    expect(metricsOnly[VM]).toEqual([`metrics ${ruleOf("eastus")}`]);
    expect(logsOnly[SITE]).toEqual([`logs ${ruleOf("eastus")}`]);
    // A VM has no resource logs: left out of a logs-only stream.
    expect(logsOnly[VM]).toEqual([`logs ${ruleOf("eastus")}`]);
  });

  test("run again, it makes nothing twice: the event hubs and the role are there", () => {
    const shellRun: ShellRun = run(command(), {
      namespaces: [`${NAMES.namespacePrefix}eastus`, `${NAMES.namespacePrefix}westeurope`],
      roleExists: true,
    });

    expect(callsOf(shellRun, "eventhubs namespace create")).toEqual([]);
    expect(callsOf(shellRun, "eventhubs eventhub create")).toEqual([]);
    expect(callsOf(shellRun, "role assignment list")).toHaveLength(1);
    expect(shellRun.output[shellRun.output.length - 1]).toBe(
      AZURE_CLOUD_STREAM_COMMAND_DONE,
    );
  });

  test("a region whose event hub cannot be made is said, and only its resources are left out", () => {
    const shellRun: ShellRun = run(command(), {
      fail: ["namespace create westeurope"],
    });

    expect(shellRun.output).toContain(
      "westeurope: the Event Hubs namespace could not be made, so its resources are left out.",
    );
    expect(shellRun.output).toContain(
      "Diagnostic settings: 3 resources send to OneUptime's event hubs.",
    );
    expect(
      shellRun.output.some((line: string): boolean => {
        return line.startsWith(`${VAULT}\t(ResourceNotFound)`);
      }),
    ).toBe(true);
    expect(shellRun.output[shellRun.output.length - 1]).toBe(
      AZURE_CLOUD_STREAM_COMMAND_DONE,
    );
  });

  test("a refused resource group stops it all, says why, and leaves no file behind", () => {
    const shellRun: ShellRun = run(command(), { fail: ["group create"] });

    expect(shellRun.output).toEqual([
      "The resource group could not be made.",
      AZURE_CLOUD_STREAM_COMMAND_STOPPED,
    ]);
    expect(callsOf(shellRun, "role assignment create")).toEqual([]);
    expect(callsOf(shellRun, "monitor diagnostic-settings create")).toEqual([]);
    expect(shellRun.files).toEqual([]);
  });

  test("a subscription whose resources cannot be listed stops it before anything is made", () => {
    const shellRun: ShellRun = run(command(), { fail: [`resource list ${SUB_B}`] });

    expect(shellRun.output).toEqual([
      `${SUB_B}: its resources could not be listed.`,
      AZURE_CLOUD_STREAM_COMMAND_STOPPED,
    ]);
    expect(callsOf(shellRun, "group create")).toEqual([]);
  });

  test("it never closes the shell", () => {
    for (const scenario of [{}, { fail: ["group create"] }]) {
      const shellRun: ShellRun = run(command(), scenario, "echo STILL-HERE");

      expect(shellRun.output[shellRun.output.length - 1]).toBe("STILL-HERE");
    }

    expect(command()).not.toMatch(NO_EXIT);
  });

  test("subscriptions that are not subscription IDs never reach the command", () => {
    const text: string = command({ subscriptions: [SUB_A, "$(touch pwned)", SUB_B] });

    expect(text).not.toContain("pwned");
    expect(
      callsOf(run(text), "resource list").map((call: Array<string>): string | undefined => {
        return flag(call, "--subscription");
      }),
    ).toEqual([SUB_A, SUB_B]);
  });
});

describe("Stop streaming's command for Azure", () => {
  test("it deletes every resource's diagnostic setting, then the resource group", () => {
    const text: string = getAzureCloudStreamDeleteCommand({
      connectionId: CONNECTION,
      subscriptionIds: [SUB_A, SUB_B.toUpperCase(), SUB_B],
    });
    const shellRun: ShellRun = run(text, { groups: [SUB_A] });
    const deleted: Array<string> = callsOf(shellRun, "monitor diagnostic-settings delete")
      .map((call: Array<string>): string => {
        expect(flag(call, "--name")).toBe(NAMES.diagnosticSetting);
        return flag(call, "--resource") || "";
      })
      .sort();

    expect(deleted).toEqual([VM, SITE, FRONT_DOOR, NSG, OUR_NAMESPACE, VAULT, DISK].sort());
    expect(callsOf(shellRun, "group delete")).toEqual([
      ["az", "group", "delete", "--subscription", SUB_A, "--name", NAMES.resourceGroup, "--yes", "--no-wait"],
    ]);
    expect(shellRun.output).toEqual([`Deleting ${NAMES.resourceGroup} in ${SUB_A}.`]);
    expect(text).not.toMatch(NO_EXIT);
  });

  test("the resource group is deleted in whichever subscription holds it, the first listed or not", () => {
    const shellRun: ShellRun = run(
      getAzureCloudStreamDeleteCommand({
        connectionId: CONNECTION,
        subscriptionIds: [SUB_A, SUB_B],
      }),
      { groups: [SUB_B] },
    );

    expect(callsOf(shellRun, "group exists").map((call: Array<string>) => {
      return flag(call, "--subscription");
    })).toEqual([SUB_A, SUB_B]);
    expect(callsOf(shellRun, "group delete")).toEqual([
      ["az", "group", "delete", "--subscription", SUB_B, "--name", NAMES.resourceGroup, "--yes", "--no-wait"],
    ]);
  });

  test("with the resource group gone already, it deletes nothing more and says nothing", () => {
    const shellRun: ShellRun = run(
      getAzureCloudStreamDeleteCommand({
        connectionId: CONNECTION,
        subscriptionIds: [SUB_A, SUB_B],
      }),
    );

    expect(callsOf(shellRun, "group delete")).toEqual([]);
    expect(shellRun.output).toEqual([]);
    expect(shellRun.status).toBe(0);
  });
});

describe("The Azure stream's names and problems", () => {
  test("names end in the connection's 8 hex characters; each region's namespace fits Azure's 50", () => {
    expect(NAMES).toEqual({
      resourceGroup: "oneuptime-stream-6f1c3a2e",
      namespacePrefix: "oneuptime-6f1c3a2e-",
      eventHub: "oneuptime",
      diagnosticSetting: "OneUptime-6f1c3a2e",
    });
    expect(getAzureCloudStreamNamespace(CONNECTION, "AustraliaSoutheast")).toBe(
      "oneuptime-6f1c3a2e-australiasoutheast",
    );
    expect(getAzureCloudStreamNamespace(CONNECTION, "not a region")).toBeNull();

    for (const region of ["germanywestcentral", "australiacentral2", "usgovarizona"]) {
      const namespace: string = getAzureCloudStreamNamespace(CONNECTION, region)!;

      expect(isAzureEventHubsNamespace(namespace)).toBe(true);
      expect(readAzureCloudStreamNamespaceRegion(CONNECTION, namespace)).toBe(region);
    }

    expect(
      readAzureCloudStreamNamespaceRegion(CONNECTION, "oneuptime-11111111-eastus"),
    ).toBeNull();
  });

  test("regions and namespaces are read as Azure writes them", () => {
    expect(isAzureRegion("eastus")).toBe(true);
    expect(isAzureRegion("australiacentral2")).toBe(true);
    expect(isAzureRegion("East US")).toBe(false);
    expect(isAzureRegion("2eastus")).toBe(false);
    expect(isAzureRegion("us")).toBe(false);
    expect(isAzureEventHubsNamespace("ns")).toBe(false);
    expect(isAzureEventHubsNamespace("oneuptime-")).toBe(false);
    expect(isAzureEventHubsNamespace("1oneuptime")).toBe(false);
    expect(isAzureEventHubsNamespace(`a${"b".repeat(50)}`)).toBe(false);
  });

  test("a namespace's Kafka host is in the connection's own Azure cloud", () => {
    expect(
      getAzureEventHubsHost({ namespace: "oneuptime-6f1c3a2e-eastus", cloud: "public" }),
    ).toBe("oneuptime-6f1c3a2e-eastus.servicebus.windows.net");
    expect(
      getAzureEventHubsHost({ namespace: "oneuptime-6f1c3a2e-usgovvirginia", cloud: "usgov" }),
    ).toBe("oneuptime-6f1c3a2e-usgovvirginia.servicebus.usgovcloudapi.net");
    expect(getAzureEventHubsHost({ namespace: "evil.example.com/x", cloud: "public" })).toBeNull();
  });

  test("the types it sets up are the ones a connection reads, lower case", () => {
    expect(AZURE_CLOUD_STREAM_RESOURCE_TYPES).toContain("microsoft.web/sites");
    expect(AZURE_CLOUD_STREAM_RESOURCE_TYPES).toContain("microsoft.sql/servers/databases");
    expect(AZURE_CLOUD_STREAM_RESOURCE_TYPES).not.toContain(
      "microsoft.network/networksecuritygroups",
    );

    for (const type of AZURE_CLOUD_STREAM_RESOURCE_TYPES) {
      expect(type).toBe(type.toLowerCase());
      expect(type).not.toContain(" ");
    }
  });

  test("subscriptions typed one a line or by commas are read lower case, each once", () => {
    expect(
      readAzureCloudStreamSubscriptions(`${SUB_A.toUpperCase()}, ${SUB_A}\n${SUB_B},,`),
    ).toEqual([SUB_A, SUB_B]);
  });

  test("what stops a command being written, each said", () => {
    expect(getAzureCloudStreamProblem({ appId: APP, subscriptionIds: [SUB_A] })).toBeNull();
    expect(getAzureCloudStreamProblem({ appId: "", subscriptionIds: [SUB_A] })?.text).toBe(
      STREAM_NO_APP,
    );
    expect(getAzureCloudStreamProblem({ appId: APP, subscriptionIds: [] })?.text).toBe(
      STREAM_NO_SUBSCRIPTION,
    );
    expect(
      getAzureCloudStreamProblem({ appId: APP, subscriptionIds: ["prod"] })?.text,
    ).toBe(STREAM_NOT_A_SUBSCRIPTION);
    expect(
      getAzureCloudStreamProblem({
        appId: APP,
        subscriptionIds: Array.from(
          { length: AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS + 1 },
          (): string => {
            return SUB_A;
          },
        ),
      }),
    ).toEqual({
      text: STREAM_TOO_MANY_SUBSCRIPTIONS,
      values: { count: String(AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS) },
    });
  });
});
