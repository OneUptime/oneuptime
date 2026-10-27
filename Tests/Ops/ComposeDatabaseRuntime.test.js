"use strict";

/**
 * PostgreSQL as docker-compose.yml runs it, for real.
 *
 *   - It answers on the server's loopback address, where npm run backup and
 *     restore.sh connect the way those scripts run their client, and on no
 *     other address of the server.
 *   - On a new install, npm start's first step
 *     (Scripts/Install/GenerateDatabasePassword.js) asks this Docker whether
 *     the bundled PostgreSQL has created its database, gives a placeholder
 *     DATABASE_PASSWORD a random value while it has not, and PostgreSQL is
 *     created with that value. Once the database exists, config.env is left
 *     alone.
 *   - The Docker Compose guide's "Change the database password" commands,
 *     run as written, change the password of a database created with the
 *     placeholder, and the guide's override publishes PostgreSQL on a
 *     private address next to the loopback one.
 *
 * Needs Docker, and pulls postgres:15. Ops Config Test runs it with
 * RUN_COMPOSE_DATABASE_RUNTIME_TESTS=1; without it the suite is skipped.
 * Every project it starts has a name of its own and is removed with its
 * volume, and it publishes PostgreSQL on a free port rather than 5400, so it
 * runs next to a stack that holds 5400.
 */

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");
const {
  REPO_ROOT,
  LOOPBACK_ADDRESS,
  configExampleSettings,
  renderCompose,
} = require("./Utils/ComposePorts");
const GenerateDatabasePassword = require("../../Scripts/Install/GenerateDatabasePassword");

const RUN = process.env.RUN_COMPOSE_DATABASE_RUNTIME_TESTS === "1";
const describeRuntime = RUN ? describe : describe.skip;

const POSTGRES_IMAGE = "postgres:15";
const PLACEHOLDER = "please-change-this-to-random-value";
const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);
const DOCS_PAGE = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content/en/installation/docker-compose.md",
);
const CHANGE_PASSWORD_HEADING = "### Change the database password";
const OVERRIDE_DETAILS =
  ":::details Publish PostgreSQL on a private network address";
const RESTORE_ADD_HOST = /--add-host=host\.docker\.internal:(\S+)/;
const FENCE_START = /^```(\w+)/;
// The example's "ADDRESS:HOST_PORT:5432" entry.
const PRIVATE_ADDRESS_IN_EXAMPLE = /"(\d+\.\d+\.\d+\.\d+):(\d+):5432"/;
const RANDOM_PASSWORD = /^[0-9a-f]{64}$/;
const GENERATED_PASSWORD_LINE = /^DATABASE_PASSWORD=[0-9a-f]{64}$/m;
// 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16.
const PRIVATE_IPV4 = /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/;

jest.setTimeout(10 * 60 * 1000);

describe("Ops Config Test runs these checks", () => {
  test("its jest step sets RUN_COMPOSE_DATABASE_RUNTIME_TESTS=1, so they never skip in CI", () => {
    const { stepCommand } = require("./Utils/WorkflowStep");
    const steps = yaml.load(
      fs.readFileSync(
        path.join(REPO_ROOT, ".github", "workflows", "test.ops.yaml"),
        "utf8",
      ),
    ).jobs.test.steps;
    const jest = steps.filter((step) => {
      return stepCommand(step) === "cd Tests/Ops && npm run test";
    });

    expect(jest).toHaveLength(1);
    expect(jest[0].env).toEqual(
      expect.objectContaining({ RUN_COMPOSE_DATABASE_RUNTIME_TESTS: "1" }),
    );
  });
});

function projectName(purpose) {
  return `oneuptime-ops-${purpose}-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
}

function randomPassword() {
  return crypto.randomBytes(24).toString("hex");
}

function docker(args, options) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
    ...(options || {}),
  });

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

function mustDocker(args, options) {
  const result = docker(args, options);

  if (result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed: ${result.output}`);
  }

  return result;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, LOOPBACK_ADDRESS, () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
}

// Every IPv4 address of this machine other than loopback, private ones first.
function otherAddresses() {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => {
      return address && address.family === "IPv4" && !address.internal;
    })
    .map((address) => {
      return address.address;
    });

  return [
    ...addresses.filter((address) => {
      return PRIVATE_IPV4.test(address);
    }),
    ...addresses.filter((address) => {
      return !PRIVATE_IPV4.test(address);
    }),
  ];
}

/*
 * Every IPv6 address of this machine, loopback (::1) included: a port
 * published on 127.0.0.1 answers on none of them. A link-local address
 * carries its interface, as connecting to one needs.
 */
function ipv6Addresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, list]) => {
    return (list || [])
      .filter((address) => {
        return address.family === "IPv6";
      })
      .map((address) => {
        return address.scopeid ? `${address.address}%${name}` : address.address;
      });
  });
}

function answers(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(3000, () => {
      done(false);
    });
    socket.once("connect", () => {
      done(true);
    });
    socket.once("error", () => {
      done(false);
    });
  });
}

// psql from the server's own network, the way backup.sh and restore.sh run theirs.
function psqlOnServer(url, extraArgs) {
  return docker([
    "run",
    "--rm",
    "--net=host",
    ...(extraArgs || []),
    POSTGRES_IMAGE,
    "psql",
    url,
    "-Atc",
    "select current_user",
  ]);
}

/*
 * docker-compose.yml's postgres service exactly as Compose renders it with
 * config.env's settings, written to a file of its own with the published
 * port moved to `port`: the address it is published on is Compose's own
 * answer, untouched.
 */
function writeRenderedPostgres(directory, project, port, extraEnv) {
  const rendered = renderCompose(["docker-compose.yml"], {
    COMPOSE_PROJECT_NAME: project,
    ...(extraEnv || {}),
  });
  const postgres = rendered.services.postgres;

  expect(postgres.ports).toHaveLength(1);
  postgres.ports[0].published = String(port);

  const file = path.join(directory, "postgres.compose.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      name: project,
      services: { postgres },
      volumes: { postgres: rendered.volumes.postgres },
      networks: rendered.networks,
    }),
  );

  return { file, hostIp: postgres.ports[0].host_ip };
}

function configEnvWith(directory, extraLines) {
  const file = path.join(directory, "config.env");
  fs.writeFileSync(file, `${TEMPLATE}\n${extraLines.join("\n")}\n`);
  return file;
}

// config.env as `npm start` exports it, over this process's environment.
function envOf(configFile) {
  return {
    ...process.env,
    ...Object.fromEntries(
      GenerateDatabasePassword.readSettings(
        fs.readFileSync(configFile, "utf8"),
      ),
    ),
  };
}

function composeIn(directory, configFile, args) {
  return docker(["compose", ...args], {
    cwd: directory,
    env: envOf(configFile),
  });
}

function removeProject(directory, configFile, project) {
  composeIn(directory, configFile, ["down", "-v", "--remove-orphans"]);
  docker(["volume", "rm", "-f", `${project}_postgres`]);
  docker(["network", "rm", `${project}_oneuptime`]);
  fs.rmSync(directory, { recursive: true, force: true });
}

/** The first fenced block of `language` after `heading` on the English page. */
function codeBlockAfter(heading, language) {
  const lines = fs.readFileSync(DOCS_PAGE, "utf8").split("\n");
  const start = lines.indexOf(heading);

  expect(start).toBeGreaterThan(-1);

  for (let index = start + 1; index < lines.length; index++) {
    const fence = FENCE_START.exec(lines[index]);

    if (!fence) {
      continue;
    }

    expect(fence[1]).toBe(language);
    const end = lines.indexOf("```", index + 1);
    return lines.slice(index + 1, end);
  }

  throw new Error(`No ${language} block after ${heading}`);
}

describeRuntime("PostgreSQL as docker-compose.yml publishes it", () => {
  const project = projectName("loopback");
  const password = randomPassword();
  let directory;
  let configFile;
  let port;
  let hostIp;

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-ops-pg-"));
    port = await freePort();
    const rendered = writeRenderedPostgres(directory, project, port, {
      DATABASE_PASSWORD: password,
    });
    hostIp = rendered.hostIp;
    configFile = configEnvWith(directory, [
      `COMPOSE_PROJECT_NAME=${project}`,
      `COMPOSE_FILE=${rendered.file}`,
      `DATABASE_PASSWORD=${password}`,
    ]);
    const up = composeIn(directory, configFile, [
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "180",
      "postgres",
    ]);

    if (up.status !== 0) {
      throw new Error(`compose up failed: ${up.output}`);
    }
  });

  afterAll(() => {
    removeProject(directory, configFile, project);
  });

  test("Compose publishes it on 127.0.0.1", () => {
    expect(hostIp).toBe(LOOPBACK_ADDRESS);
  });

  test("Docker itself publishes it on 127.0.0.1 and nowhere else, IPv6 included", () => {
    const container = composeIn(directory, configFile, [
      "ps",
      "-q",
      "postgres",
    ]).stdout.trim();

    expect(container).not.toBe("");

    const published = mustDocker(["port", container, "5432/tcp"])
      .stdout.trim()
      .split("\n");

    expect(published).toEqual([`${LOOPBACK_ADDRESS}:${port}`]);
  });

  test("it answers on the server's loopback address, and signs in with the configured password", async () => {
    expect(await answers(LOOPBACK_ADDRESS, port)).toBe(true);

    const login = psqlOnServer(
      `postgresql://postgres:${password}@${LOOPBACK_ADDRESS}:${port}/oneuptimedb`,
    );
    expect(login.output.trim()).toBe("postgres");
  });

  test("it does not answer on any other address of the server", async () => {
    const addresses = otherAddresses();
    const answering = [];

    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) {
      if (await answers(address, port)) {
        answering.push(`${address}:${port}`);
      }
    }

    expect(answering).toEqual([]);
  });

  test("it does not answer on any IPv6 address of the server, ::1 included", async () => {
    const answering = [];

    for (const address of ipv6Addresses()) {
      if (await answers(address, port)) {
        answering.push(`[${address}]:${port}`);
      }
    }

    expect(answering).toEqual([]);
  });

  test("backup.sh's connection reaches it: DATABASE_BACKUP_HOST over the server's network", () => {
    const host = configExampleSettings().get("DATABASE_BACKUP_HOST");
    const login = psqlOnServer(
      `postgresql://postgres:${password}@${host}:${port}/oneuptimedb`,
    );

    expect(login.output.trim()).toBe("postgres");
  });

  test("restore.sh's connection reaches it: DATABASE_RESTORE_HOST through the address restore.sh gives it", () => {
    const restore = fs.readFileSync(path.join(REPO_ROOT, "restore.sh"), "utf8");
    const mapping = RESTORE_ADD_HOST.exec(restore);
    const host = configExampleSettings().get("DATABASE_RESTORE_HOST");

    expect(mapping).not.toBeNull();
    const login = psqlOnServer(
      `postgresql://postgres:${password}@${host}:${port}/oneuptimedb`,
      [`--add-host=host.docker.internal:${mapping[1]}`],
    );

    expect(login.output.trim()).toBe("postgres");
  });
});

describeRuntime(
  "npm start's first step against real Docker and docker-compose.yml",
  () => {
    const project = projectName("first-start");
    const databaseContainer = `${project}-db`;
    let directory;
    let configFile;

    beforeAll(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-ops-pg-"));
      configFile = configEnvWith(directory, [
        `COMPOSE_PROJECT_NAME=${project}`,
        `COMPOSE_FILE=${path.join(REPO_ROOT, "docker-compose.yml")}`,
      ]);
    });

    afterAll(() => {
      docker(["rm", "-f", "-v", databaseContainer]);
      removeProject(directory, configFile, project);
    });

    function firstStep() {
      const logged = [];
      const warned = [];
      const decision = GenerateDatabasePassword.run({
        cwd: directory,
        env: process.env,
        log: (message) => {
          logged.push(message);
        },
        warn: (message) => {
          warned.push(message);
        },
      });

      return { decision, logged, warned };
    }

    function currentPassword() {
      return GenerateDatabasePassword.readSettings(
        fs.readFileSync(configFile, "utf8"),
      ).get("DATABASE_PASSWORD");
    }

    test("a new install: no database yet, so the placeholder gets a random value", () => {
      expect(currentPassword()).toBe(PLACEHOLDER);

      const first = firstStep();

      expect(first.decision).toBe("generate");
      expect(currentPassword()).toMatch(RANDOM_PASSWORD);
    });

    test("PostgreSQL creates its database with that value, and not with the placeholder", () => {
      const password = currentPassword();

      // The bundled service, started the way Compose starts it, without
      // publishing a port: only the project's own network reaches it.
      mustDocker(
        [
          "compose",
          "run",
          "-d",
          "--no-deps",
          "--name",
          databaseContainer,
          "postgres",
        ],
        {
          cwd: directory,
          env: envOf(configFile),
        },
      );

      let ready = false;
      for (let attempt = 0; attempt < 90 && !ready; attempt++) {
        ready =
          docker([
            "exec",
            databaseContainer,
            "pg_isready",
            "-q",
            "-h",
            "127.0.0.1",
          ]).status === 0;
        if (!ready) {
          spawnSync("sleep", ["1"]);
        }
      }
      expect(ready).toBe(true);

      const fromTheNetwork = (candidate) => {
        return docker([
          "run",
          "--rm",
          "--network",
          `${project}_oneuptime`,
          POSTGRES_IMAGE,
          "psql",
          `postgresql://postgres:${candidate}@${databaseContainer}:5432/oneuptimedb`,
          "-Atc",
          "select current_user",
        ]);
      };

      expect(fromTheNetwork(password).output.trim()).toBe("postgres");
      expect(fromTheNetwork(PLACEHOLDER).output).toContain(
        "password authentication failed",
      );
    });

    test("the next start leaves the generated password as it is", () => {
      const password = currentPassword();
      const next = firstStep();

      expect(next.decision).toBe("nothing");
      expect(currentPassword()).toBe(password);
    });

    test("a database that exists is seen as created: a placeholder then stays in config.env, with a warning", () => {
      docker(["stop", databaseContainer]);
      const withPlaceholder = fs
        .readFileSync(configFile, "utf8")
        .replace(GENERATED_PASSWORD_LINE, `DATABASE_PASSWORD=${PLACEHOLDER}`);
      fs.writeFileSync(configFile, withPlaceholder);

      const later = firstStep();

      expect(later.decision).toBe("warn-created");
      expect(fs.readFileSync(configFile, "utf8")).toBe(withPlaceholder);
      expect(later.warned).toEqual([
        GenerateDatabasePassword.MESSAGES["warn-created"],
      ]);
    });
  },
);

describeRuntime("the Docker Compose guide's commands, run as written", () => {
  const project = projectName("guide");
  let directory;
  let configFile;
  let port;
  let rendered;

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-ops-pg-"));
    port = await freePort();
    rendered = writeRenderedPostgres(directory, project, port, {
      DATABASE_PASSWORD: PLACEHOLDER,
    });
    configFile = configEnvWith(directory, [
      `COMPOSE_PROJECT_NAME=${project}`,
      `COMPOSE_FILE=${rendered.file}`,
    ]);
    // The guide's commands give Compose config.env's settings through the
    // checkout's own loader, so this copy of a checkout has it where it is.
    fs.mkdirSync(path.join(directory, "Scripts", "Install"), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(REPO_ROOT, "Scripts", "Install", "WithConfig.sh"),
      path.join(directory, "Scripts", "Install", "WithConfig.sh"),
    );
  });

  afterAll(() => {
    removeProject(directory, configFile, project);
  });

  function up() {
    const result = composeIn(directory, configFile, [
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "180",
      "postgres",
    ]);

    if (result.status !== 0) {
      throw new Error(`compose up failed: ${result.output}`);
    }
  }

  function loginOnLoopback(candidate) {
    return psqlOnServer(
      `postgresql://postgres:${candidate}@${LOOPBACK_ADDRESS}:${port}/oneuptimedb`,
    ).output.trim();
  }

  /*
   * The guide's block, pasted into bash as a whole the way an operator runs
   * it (no -e). Its last line starts OneUptime again; an `npm` on PATH here
   * only records that it ran, and the test then starts PostgreSQL alone.
   */
  function runChangePasswordBlock() {
    const commands = codeBlockAfter(CHANGE_PASSWORD_HEADING, "bash");
    const bin = path.join(directory, "bin");
    const npmCalls = path.join(directory, "npm-calls.log");

    expect(commands[commands.length - 1]).toBe("npm start");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(
      path.join(bin, "npm"),
      `#!/bin/sh\necho "npm $*" >> "${npmCalls}"\n`,
      { mode: 0o755 },
    );
    fs.rmSync(npmCalls, { force: true });

    const run = spawnSync("bash", ["-c", commands.join("\n")], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      },
      encoding: "utf8",
    });

    return {
      status: run.status,
      output: `${run.stdout}${run.stderr}`,
      npm: fs.existsSync(npmCalls)
        ? fs.readFileSync(npmCalls, "utf8").trim()
        : "",
    };
  }

  test("Change the database password, run while PostgreSQL is not running, changes neither PostgreSQL nor config.env", () => {
    // An installation that kept the placeholder, created before this release.
    up();
    expect(loginOnLoopback(PLACEHOLDER)).toBe("postgres");
    composeIn(directory, configFile, ["stop", "postgres"]);
    const before = fs.readFileSync(configFile, "utf8");

    const run = runChangePasswordBlock();

    expect(run.output).not.toContain("ALTER ROLE");
    expect(fs.readFileSync(configFile, "utf8")).toBe(before);
    // npm start still runs, and starts OneUptime with the password it has.
    expect(run.npm).toBe("npm start");
    up();
    expect(loginOnLoopback(PLACEHOLDER)).toBe("postgres");
  });

  test("Change the database password changes it in PostgreSQL and in config.env together", () => {
    // The same installation, now running.
    up();
    expect(loginOnLoopback(PLACEHOLDER)).toBe("postgres");

    const run = runChangePasswordBlock();

    expect(run.output).toContain("ALTER ROLE");
    expect(run.status).toBe(0);
    expect(run.npm).toBe("npm start");
    up();

    const password = GenerateDatabasePassword.readSettings(
      fs.readFileSync(configFile, "utf8"),
    ).get("DATABASE_PASSWORD");

    expect(password).toMatch(RANDOM_PASSWORD);
    expect(loginOnLoopback(password)).toBe("postgres");
    expect(loginOnLoopback(PLACEHOLDER)).toContain(
      "password authentication failed",
    );
    expect(
      GenerateDatabasePassword.run({
        cwd: directory,
        log: () => {},
        warn: () => {},
      }),
    ).toBe("nothing");
  });

  test("the override that publishes PostgreSQL on a private address, on a port of its own, keeps the loopback port too", async () => {
    const addresses = otherAddresses();
    expect(addresses.length).toBeGreaterThan(0);
    // As the guide says: a password of its own first. This test never
    // publishes a database that takes the placeholder beyond loopback.
    expect(loginOnLoopback(PLACEHOLDER)).toContain(
      "password authentication failed",
    );

    const example = codeBlockAfter(OVERRIDE_DETAILS, "yaml").join("\n");
    const exampleAddress = PRIVATE_ADDRESS_IN_EXAMPLE.exec(example);
    expect(exampleAddress).not.toBeNull();
    // A host port other than docker-compose.yml's 5400.
    expect(exampleAddress[2]).not.toBe("5400");

    // The guide's file, with this machine's address and a port of this test's.
    const privatePort = await freePort();
    const override = yaml.load(
      example.replace(
        exampleAddress[0],
        `"${addresses[0]}:${privatePort}:5432"`,
      ),
    );
    const overrideFile = path.join(directory, "docker-compose.override.yml");
    fs.writeFileSync(overrideFile, yaml.dump(override));
    fs.appendFileSync(
      configFile,
      `COMPOSE_FILE=${rendered.file}${path.delimiter}${overrideFile}\n`,
    );
    up();

    expect(await answers(LOOPBACK_ADDRESS, port)).toBe(true);
    expect(await answers(addresses[0], privatePort)).toBe(true);
    // Only the address the override names: not its port on loopback.
    expect(await answers(LOOPBACK_ADDRESS, privatePort)).toBe(false);
  });
});
