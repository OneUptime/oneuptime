#!/usr/bin/env node
/*
 * The OpenStack AI agent's real policy and executor making real changes on a real cloud, as
 * they do once a person has approved a fix. There is no OneUptime and no model here: "proposed"
 * is the same dry run the server asks for and the same ladder it asks, and "approved" is the job
 * an approval sends. What the cloud did about it is what ai-agent-record.sh checks afterwards,
 * through the admin's own client and not through this.
 *
 * Usage: node ai-agent-fix.js <agent folder> <output folder> <scene> [words...]
 *   writes-off <host>                 Nothing runs, however it is asked
 *   propose-enable <host>             What approving the re-enable of a service would touch
 *   approve-enable <host>             Re-enable it
 *   propose-evacuate <host> <names> <projects>
 *                                     What evacuating every instance of a dead host would touch
 *   approve-evacuate <host>           Evacuate them
 *   change <words...>                 Any other change, as an approved job
 *   refused <words...>                A command the policy must refuse, with writes on
 *   least-privilege <server id>       What the write credential itself may do, asked directly
 */

const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

const [agentRoot, outputRoot, scene, ...words] = process.argv.slice(2);

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
const ResourceCommandPolicy = require(
  path.join(resourcePolicy, "ResourceCommandPolicy.js"),
).default;
const { getOpenStackDryRunCommand } = require(
  path.join(resourcePolicy, "OpenStackCommandPolicy.js"),
);
const { readOpenStackChangeReach } = require(
  path.join(resourcePolicy, "OpenStackChangeReach.js"),
);

const OPENSTACK_CLOUD = "OpenStackCloud";
const RESOURCE_ID = "99999999-9999-4999-8999-999999999999";

const folder = path.join(outputRoot, "fixes");
fs.mkdirSync(folder, { recursive: true });

const problems = [];

function note(name, value) {
  fs.writeFileSync(
    path.join(folder, `${name}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

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

function executorFor(env) {
  const { config, warnings } = parseConfig(env);

  for (const warning of warnings) {
    console.error(`settings warned: ${warning}`);
  }

  return {
    config,
    executor: createExecutor({ config, env, tmpDir: os.tmpdir(), logger }),
  };
}

function tokenize(command) {
  return command.split(" ");
}

function evaluate(argv) {
  return ResourceCommandPolicy.evaluateArgv({
    resourceType: OPENSTACK_CLOUD,
    argv,
  });
}

function jobFor(config, argv, origin, tier) {
  return {
    payload: {
      resourceType: OPENSTACK_CLOUD,
      resourceId: RESOURCE_ID,
      resourceIdentifier: config.resourceIdentifier,
      program: argv[0],
      args: argv.slice(1),
      tier,
    },
    origin,
    timeoutInMs: 120_000,
    agentResourceId: RESOURCE_ID,
  };
}

async function read(context, argv) {
  const policy = evaluate(argv);

  if (policy.tier !== "Read") {
    throw new Error(`${argv.join(" ")} should read, and is ${policy.tier}`);
  }

  const prepared = context.executor.prepare(
    jobFor(context.config, argv, "AiInvestigation", policy.tier),
  );

  if (prepared.refusal !== null) {
    throw new Error(`${argv.join(" ")} was refused: ${prepared.refusal}`);
  }

  return prepared.run();
}

// The rows of a list read with -f json, as a job's result hands them back: after its stream's name.
function rowsOf(output) {
  const marker = "[stdout]\n";
  const start = output.indexOf(marker);
  const text = start >= 0 ? output.slice(start + marker.length) : output;

  return JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
}

// What the fix's card says, from the same dry run the server asks the agent for.
async function propose(context, argv, name) {
  const dryRun = getOpenStackDryRunCommand(argv.join(" "));

  if (!dryRun) {
    throw new Error(`${argv.join(" ")} has no dry run: is it not a change?`);
  }

  const result = await read(context, tokenize(dryRun));
  const reach = readOpenStackChangeReach(result.output);

  note(`${name}-proposal`, {
    command: argv.join(" "),
    tier: evaluate(argv).tier,
    requiresHuman: evaluate(argv).requiresHuman === true,
    reach,
    output: result.output,
  });

  if (!reach) {
    throw new Error(`the dry run of ${argv.join(" ")} said nothing: ${result.errorMessage}`);
  }

  console.log(`proposed: ${argv.join(" ")}`);
  console.log(result.output);

  return reach;
}

// An approved job: what RunnerJobService.enqueueAiResourceCommand would have sent.
async function approve(context, argv, name) {
  const policy = evaluate(argv);

  if (policy.tier === "Denied") {
    throw new Error(`${argv.join(" ")} is denied: ${policy.reason}`);
  }

  const prepared = context.executor.prepare(
    jobFor(context.config, argv, "AiRemediation", policy.tier),
  );

  if (prepared.refusal !== null) {
    throw new Error(`${argv.join(" ")} was refused: ${prepared.refusal}`);
  }

  const result = await prepared.run();

  note(`${name}-result`, { command: argv.join(" "), result });
  console.log(`${result.success ? "ran" : "FAILED"}: ${argv.join(" ")}`);
  console.log(result.output || result.errorMessage);

  if (!result.success) {
    throw new Error(`${argv.join(" ")} failed: ${result.errorMessage}`);
  }

  return result;
}

const MODES = [
  { name: "Automatic", allowlisted: false, bypassApproval: false },
  { name: "Automatic, allowlisted", allowlisted: true, bypassApproval: false },
  { name: "Bypass approval", allowlisted: false, bypassApproval: true },
  { name: "Bypass approval, allowlisted", allowlisted: true, bypassApproval: true },
];

function verdicts(command) {
  return MODES.map((mode) => {
    const verdict = ResourceCommandPolicy.evaluateForAutoExecution({
      resourceType: OPENSTACK_CLOUD,
      command,
      allowlistPatterns: mode.allowlisted ? [command] : [],
      bypassApproval: mode.bypassApproval,
    });

    return { mode: mode.name, verdict: verdict.verdict, requiresHuman: verdict.requiresHuman === true };
  });
}

function request(url, options, body) {
  const parsed = new URL(url);
  const client = parsed.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const sent = client.request(
      parsed,
      {
        ...options,
        rejectUnauthorized: false,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    sent.on("error", reject);
    sent.end(body ? JSON.stringify(body) : undefined);
  });
}

/*
 * What the credential itself can do, past the agent: what it would do in the hands of whoever
 * read the agent's .env. Nothing here reads a secret into a file.
 */
async function leastPrivilege(server) {
  const authUrl = process.env.OPENSTACK_AUTH_URL.replace(/\/+$/, "");
  const login = await request(
    `${authUrl.endsWith("/v3") ? authUrl : `${authUrl}/v3`}/auth/tokens`,
    { method: "POST" },
    {
      auth: {
        identity: {
          methods: ["application_credential"],
          application_credential: {
            id: process.env.ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID,
            secret:
              process.env.ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET,
          },
        },
      },
    },
  );
  const token = login.headers["x-subject-token"];

  if (!token) {
    throw new Error(`the write credential did not log in: HTTP ${login.status}`);
  }

  const catalog = JSON.parse(login.body).token.catalog;
  const endpoint = (...types) => {
    return catalog
      .find((service) => {
        return types.includes(service.type);
      })
      .endpoints.find((row) => {
        return row.interface === "public";
      })
      .url.replace(/\/+$/, "");
  };
  const compute = endpoint("compute");
  const identity = endpoint("identity");
  const network = endpoint("network");
  const volume = endpoint("block-storage", "volumev3");
  const headers = {
    "X-Auth-Token": token,
    "OpenStack-API-Version": "compute 2.90",
    "X-OpenStack-Nova-API-Version": "2.90",
  };
  const action = (name, value) => {
    return {
      what: `POST /servers/{id}/action ${name}`,
      url: `${compute}/servers/${server}/action`,
      method: "POST",
      body: { [name]: value },
      wanted: [401, 403],
    };
  };
  const probes = [
    { what: "DELETE /servers/{id}", url: `${compute}/servers/${server}`, method: "DELETE", wanted: [401, 403] },
    { what: "GET /servers/{id}", url: `${compute}/servers/${server}`, method: "GET", wanted: [401, 403] },
    { what: "PUT /os-services/force-down", url: `${compute}/os-services/force-down`, method: "PUT", body: { host: "x", binary: "nova-compute", forced_down: true }, wanted: [401, 403] },
    { what: "GET Keystone users", url: `${identity}/v3/users`, method: "GET", wanted: [401, 403] },
    { what: "GET Neutron's networks", url: `${network}/v2.0/networks`, method: "GET", wanted: [401, 403] },
    { what: "DELETE a Neutron agent", url: `${network}/v2.0/agents/00000000-0000-4000-8000-000000000000`, method: "DELETE", wanted: [401, 403] },
    { what: "GET Cinder's volumes", url: `${volume}/volumes`, method: "GET", wanted: [401, 403] },
    action("forceDelete", null),
    action("os-resetState", { state: "error" }),
    action("createImage", { name: "ou-rig-must-not-exist" }),
    action("changePassword", { adminPass: "ou-rig-must-not-set" }),
    action("os-stop", null),
    action("rebuild", { imageRef: "00000000-0000-4000-8000-000000000000" }),
    action("lock", null),
    action("shelve", null),
  ];
  const answers = [];

  for (const probe of probes) {
    const answer = await request(
      probe.url,
      { method: probe.method, headers },
      probe.body,
    );

    answers.push({ what: probe.what, status: answer.status });
    console.log(`${answer.status} ${probe.what}`);

    if (!probe.wanted.includes(answer.status)) {
      problems.push(`${probe.what} answered ${answer.status}, and the write credential should not reach it`);
    }
  }

  note("least-privilege", answers);
}

async function main() {
  const writesOn = () => {
    return executorFor(process.env);
  };

  switch (scene) {
    case "writes-off": {
      const env = { ...process.env };

      delete env.ONEUPTIME_AI_ALLOW_WRITES;

      const { config, executor } = executorFor(env);
      const argv = ["openstack", "compute", "service", "set", "--enable", words[0], "nova-compute"];
      const answers = ["AiRemediation", "AiInvestigation"].map((origin) => {
        return executor.prepare(jobFor(config, argv, origin, "SafeWrite")).refusal;
      });

      note("writes-off", { allowWrites: config.allowWrites, answers });
      console.log(answers.join("\n"));

      if (config.allowWrites !== false || answers.some((answer) => { return !answer; })) {
        problems.push("with writes off, the agent did not refuse");
      }
      break;
    }
    case "propose-enable": {
      const context = writesOn();
      const argv = ["openstack", "compute", "service", "set", "--enable", words[0], "nova-compute"];
      const reach = await propose(context, argv, "enable");
      const host = reach.hosts[0] || {};

      if (host.status !== "disabled") {
        problems.push(`the proposal does not read the service as disabled: ${JSON.stringify(host)}`);
      }
      if (reach.wouldBeRefused) {
        problems.push(`the agent says it would refuse this: ${reach.wouldBeRefused}`);
      }
      note("enable-ladder", verdicts(argv.join(" ")));
      break;
    }
    case "approve-enable": {
      await approve(
        writesOn(),
        ["openstack", "compute", "service", "set", "--enable", words[0], "nova-compute"],
        "enable",
      );
      break;
    }
    case "propose-evacuate": {
      const context = writesOn();
      const [host, names, projects] = words;
      const listed = await read(context, [
        "openstack", "server", "list", "--all-projects", "--host", host, "--limit", "200", "-f", "json",
      ]);
      const ids = rowsOf(listed.output).map((row) => { return row.id; });

      fs.writeFileSync(path.join(folder, "evacuate-ids.txt"), `${ids.join(" ")}\n`);

      const argv = ["openstack", "server", "evacuate", ...ids];
      const reach = await propose(context, argv, "evacuate");
      const namesRead = reach.instances.map((row) => { return row.name; });
      const projectsRead = reach.projects.map((row) => { return row.name; });

      for (const name of names.split(",")) {
        if (!namesRead.includes(name)) {
          problems.push(`the proposal does not list instance ${name}: ${namesRead.join(", ")}`);
        }
      }
      for (const name of projects.split(",")) {
        if (!projectsRead.includes(name)) {
          problems.push(`the proposal does not list project ${name}: ${projectsRead.join(", ")}`);
        }
      }
      if ((reach.hosts[0] || {}).state !== "down") {
        problems.push(`the proposal does not read ${host} as down: ${JSON.stringify(reach.hosts)}`);
      }
      if (reach.wouldBeRefused) {
        problems.push(`the agent says it would refuse this: ${reach.wouldBeRefused}`);
      }

      const ladder = verdicts(argv.join(" "));

      note("evacuate-ladder", ladder);

      for (const row of ladder) {
        if (row.verdict !== "RequiresApproval" || !row.requiresHuman) {
          problems.push(`in ${row.mode} an evacuation did not ask: ${JSON.stringify(row)}`);
        }
      }
      break;
    }
    case "approve-evacuate": {
      const ids = fs
        .readFileSync(path.join(folder, "evacuate-ids.txt"), "utf8")
        .trim()
        .split(" ");

      await approve(writesOn(), ["openstack", "server", "evacuate", ...ids], "evacuate");
      break;
    }
    case "change": {
      await approve(writesOn(), ["openstack", ...words], words.slice(0, 3).join("-"));
      break;
    }
    case "refused": {
      const context = writesOn();
      const argv = ["openstack", ...words];
      const policy = evaluate(argv);
      const prepared = context.executor.prepare(
        jobFor(context.config, argv, "AiRemediation", "RiskyWrite"),
      );

      if (policy.tier !== "Denied" || prepared.refusal === null) {
        problems.push(`${argv.join(" ")} was not refused`);
      }
      break;
    }
    case "least-privilege": {
      await leastPrivilege(words[0]);
      break;
    }
    default:
      throw new Error(`No scene called ${scene}.`);
  }

  if (problems.length > 0) {
    console.error(`${problems.length} problems on ${scene}:`);
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    process.exit(1);
  }

  console.log(`${scene}: as it should be.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
