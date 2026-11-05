#!/usr/bin/env node
/*
 * The OpenStack AI agent's real policy and executor, run against a real cloud. It runs every
 * command the policy allows, as the agent would run it, and keeps what each one printed, so
 * what an investigation reads is on the record. Each ID comes from what a list printed.
 *
 * It fails when a command the policy allows does not answer, when the output holds a secret
 * this rig planted, and, on the compute-down scene, when the output does not name the host,
 * the instances on it and the cause.
 *
 * Usage: node ai-agent-read.js <agent folder> <scene> <host> <output folder>
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const [agentRoot, scene, host, outputRoot] = process.argv.slice(2);

const dist = path.join(agentRoot, "build", "dist");
const { parseConfig } = require(path.join(dist, "Config.js"));
const { createExecutor } = require(
  path.join(dist, "Executors", "ExecutorFactory.js"),
);
const resourcePolicy = path.join(
  dist,
  "Common",
  "Utils",
  "AiRemediation",
  "Resource",
);
const { OPENSTACK_COMMAND_ROUTES } = require(
  path.join(resourcePolicy, "OpenStackCommandPolicy.js"),
);
const ResourceCommandPolicy = require(
  path.join(resourcePolicy, "ResourceCommandPolicy.js"),
).default;

const OPENSTACK_CLOUD = "OpenStackCloud";
const RESOURCE_ID = "99999999-9999-4999-8999-999999999999";

const sceneFolder = path.join(outputRoot, scene);
fs.mkdirSync(sceneFolder, { recursive: true });

const logger = {
  info() {},
  warn(message) {
    console.error(`agent warned: ${message}`);
  },
  error(message) {
    console.error(`agent error: ${message}`);
  },
  debug() {},
};

const { config, warnings, problems: settingsProblems } = parseConfig(process.env);

for (const problem of settingsProblems) {
  console.error(`settings: ${problem}`);
}
for (const warning of warnings) {
  console.error(`settings warned: ${warning}`);
}

const executor = createExecutor({
  config,
  env: process.env,
  tmpDir: os.tmpdir(),
  logger,
});

const problems = [];
let number = 0;

async function run(words) {
  const argv = ["openstack", ...words];
  const display = argv.join(" ");
  const policy = ResourceCommandPolicy.evaluateArgv({
    resourceType: OPENSTACK_CLOUD,
    argv,
  });

  if (policy.tier !== "Read") {
    problems.push(`${display}: the policy said ${policy.tier}: ${policy.reason}`);
    return { success: false, output: "" };
  }

  const prepared = executor.prepare({
    payload: {
      resourceType: OPENSTACK_CLOUD,
      resourceId: RESOURCE_ID,
      resourceIdentifier: config.resourceIdentifier,
      program: argv[0],
      args: argv.slice(1),
      tier: policy.tier,
    },
    origin: "AiInvestigation",
    timeoutInMs: 60_000,
    agentResourceId: RESOURCE_ID,
  });

  if (prepared.refusal !== null) {
    problems.push(`${display}: refused: ${prepared.refusal}`);
    return { success: false, output: "" };
  }

  const result = await prepared.run();

  number++;
  fs.writeFileSync(
    path.join(
      sceneFolder,
      `${String(number).padStart(3, "0")}-${words
        .filter((word) => {
          return !/[^a-z-]/.test(word);
        })
        .join("-")
        .slice(0, 80)}.txt`,
    ),
    `$ ${display}\nsuccess: ${result.success}\nexit code: ${result.exitCode}\n${
      result.errorMessage ? `error: ${result.errorMessage}\n` : ""
    }\n${result.output || ""}\n`,
  );
  console.log(`${result.success ? "ok    " : "FAILED"} ${display}`);

  return result;
}

// What a command printed to stdout, as the job's result hands it back, without its notes.
function jsonOf(output) {
  const marker = "[stdout]\n";
  const start = output.indexOf(marker);
  const text = start >= 0 ? output.slice(start + marker.length) : output;
  const opening = text.search(/[[{]/);
  const closing = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));

  return JSON.parse(text.slice(opening, closing + 1));
}

function idsFrom(output, column = "id") {
  try {
    const rows = jsonOf(output);
    const list = Array.isArray(rows) ? rows : Object.values(rows)[0] || [];

    return list
      .map((row) => {
        return row[column];
      })
      .filter((id) => {
        return typeof id === "string" || typeof id === "number";
      })
      .map(String);
  } catch {
    return [];
  }
}

// What each command needs beyond its words, and which list gives its ID.
const SOURCE_OF_IDS = {
  "server show": "server list",
  "server event list": "server list",
  "hypervisor show": "hypervisor list",
  "resource provider show": "resource provider list",
  "resource provider usage show": "resource provider list",
  "resource provider inventory list": "resource provider list",
  "network agent show": "network agent list",
  "network show": "network list",
  "subnet show": "subnet list",
  "router show": "router list",
  "floating ip show": "floating ip list",
  "port show": "port list",
  "volume show": "volume list",
  "image show": "image list",
  "project show": "project list",
};

const EXTRA_WORDS = {
  "server list": ["--all-projects", "--limit", "50"],
  "volume list": ["--all-projects", "--limit", "50"],
  "volume snapshot list": ["--all-projects", "--limit", "50"],
  "volume backup list": ["--all-projects", "--limit", "50"],
};

async function main() {
  const commands = OPENSTACK_COMMAND_ROUTES.map((route) => {
    return route.command;
  });
  const lists = new Map();
  const outputs = {};

  // Lists first, so each show has an ID to read.
  for (const command of commands) {
    if (SOURCE_OF_IDS[command] || command === "server event show") {
      continue;
    }

    const words = command.split(" ");
    const extra = EXTRA_WORDS[command] || [];

    if (command === "port list") {
      continue;
    }

    const result = await run([...words, ...extra, "-f", "json"]);
    lists.set(command, result);
    outputs[command] = result.output || "";
    if (!result.success) {
      problems.push(`${command}: ${result.errorMessage || "failed"}`);
    }
  }

  const networkId = idsFrom(outputs["network list"] || "")[0];
  if (networkId) {
    const result = await run([
      "port",
      "list",
      "--network",
      networkId,
      "--limit",
      "50",
      "-f",
      "json",
    ]);
    lists.set("port list", result);
    outputs["port list"] = result.output || "";
    if (!result.success) {
      problems.push(`port list: ${result.errorMessage || "failed"}`);
    }
  }

  let serverRequestId = null;
  let serverWithEvents = null;

  for (const [command, source] of Object.entries(SOURCE_OF_IDS)) {
    const id = idsFrom(outputs[source] || "")[0];

    if (!id) {
      // A cloud with no such thing has nothing to show: said, and not a failure.
      console.log(`none  ${command}: ${source} printed nothing to read`);
      continue;
    }

    const words = [...command.split(" "), id, "-f", "json"];
    const result = await run(words);
    outputs[command] = result.output || "";
    if (!result.success) {
      problems.push(`${command} ${id}: ${result.errorMessage || "failed"}`);
    }
    if (command === "server event list" && result.success) {
      const requestIds = idsFrom(result.output, "request_id");
      if (requestIds[0]) {
        serverRequestId = requestIds[0];
        serverWithEvents = id;
      } else {
        problems.push(`server event list ${id} printed no request ID`);
      }
    }
  }

  if (serverRequestId) {
    const result = await run([
      "server",
      "event",
      "show",
      serverWithEvents,
      serverRequestId,
      "-f",
      "json",
    ]);
    if (!result.success) {
      problems.push(
        `server event show: ${result.errorMessage || "failed"}`,
      );
    }
  } else {
    problems.push("no server printed a request ID for server event show");
  }

  // The same reads a person would look at, as tables, to see what the model is given.
  const seen = {
    services: await run([
      "compute",
      "service",
      "list",
      "--service",
      "nova-compute",
    ]),
    hypervisors: await run(["hypervisor", "list"]),
    instances: await run([
      "server",
      "list",
      "--all-projects",
      "--host",
      host,
      "--limit",
      "100",
    ]),
    agents: await run(["network", "agent", "list", "--host", host]),
    volumes: await run([
      "volume",
      "service",
      "list",
      "--service",
      "cinder-volume",
    ]),
    capacity: await run(["resource", "provider", "list"]),
  };

  for (const [name, result] of Object.entries(seen)) {
    if (!result.success) {
      problems.push(`${name}: ${result.errorMessage || "failed"}`);
    }
  }

  /*
   * An instance booted with a password in its user data, as tenants do. Nova hands that back
   * to an admin, and the model must not see it: the field is there, and its value is not.
   */
  const plantedServer = process.env.AI_AGENT_PLANTED_SERVER;

  if (plantedServer) {
    const result = await run(["server", "show", plantedServer, "-f", "json"]);

    if (!result.success) {
      problems.push(`the planted server: ${result.errorMessage || "failed"}`);
    } else {
      const shown = jsonOf(result.output);
      const field = Object.keys(shown).find((name) => {
        return name.endsWith("user_data");
      });

      if (!field) {
        problems.push("Nova did not hand the planted server's user data back");
      } else if (shown[field] !== "[redacted]") {
        problems.push("the planted server's user data was not masked");
      }
    }
  }

  // A secret the estate planted, in the one place a tenant can put one.
  const allOutput = fs
    .readdirSync(sceneFolder)
    .map((file) => {
      return fs.readFileSync(path.join(sceneFolder, file), "utf8");
    })
    .join("\n");

  for (const secret of (process.env.AI_AGENT_PLANTED_SECRETS || "")
    .split(",")
    .filter(Boolean)) {
    if (allOutput.includes(secret)) {
      problems.push(`the output holds a planted secret, ${secret.length} characters long`);
    }
  }

  const rowOf = (output, word) => {
    return (
      (output || "").split("\n").find((line) => {
        return line.includes(word);
      }) || ""
    );
  };

  const service = rowOf(seen.services.output, "nova-compute");

  if (scene === "compute-down") {
    if (!service.includes(host) || !/\bdown\b/.test(service)) {
      problems.push(`the service row does not say ${host} is down: ${service}`);
    }
    if (!/\benabled\b/.test(service)) {
      problems.push(`the service row does not say it is enabled: ${service}`);
    }
    if (!/\bdown\b/.test(rowOf(seen.hypervisors.output, host))) {
      problems.push("the hypervisor row does not say down");
    }
    if (!/ou-running/.test(seen.instances.output || "")) {
      problems.push("the instances on the host are not named");
    }
    if (!/UNKNOWN/.test(rowOf(seen.instances.output, "ou-running"))) {
      problems.push("ou-running does not read host_status UNKNOWN");
    }
  } else if (!/\bup\b/.test(service)) {
    problems.push(`a healthy cloud's service row does not say up: ${service}`);
  }

  fs.writeFileSync(
    path.join(sceneFolder, "summary.json"),
    `${JSON.stringify({ scene, host, ran: number, problems }, null, 2)}\n`,
  );

  if (problems.length > 0) {
    console.error(`${problems.length} problems on ${scene}:`);
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    process.exit(1);
  }

  console.log(`${scene}: ${number} commands ran, every one answered.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
