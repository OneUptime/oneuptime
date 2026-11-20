"use strict";

/**
 * npm start's status check against the real ingress, published every way
 * config.env can publish it (#10024).
 *
 * The ingress serves OneUptime only under localhost, ingress and HOST: by
 * any other name, an IP address included, it serves a status page's custom
 * domain, where the App has no dashboard, accounts or admin pages. With
 * ONEUPTIME_HTTP_PORT=127.0.0.1:8080, the Docker Compose guide's setting
 * behind a reverse proxy of one's own, the check asked for
 * http://127.0.0.1:8080, and `npm start` and `npm run update` ended with
 * "Maximum retries reached" while OneUptime was up. The check now connects
 * where the ingress is published and asks it for localhost.
 *
 * This renders packages/Nginx/default.conf.template with the ingress's own
 * envsubst-on-templates.sh, in the nginx image the ingress image is built
 * FROM (packages/Nginx/Dockerfile.tpl's base stage), with its nginx.conf and
 * the environment docker-compose.yml gives it, on a Docker network of its
 * own, in front of a stand-in App (Fixtures/StatusCheckIngress) that
 * answers by the App's own rule for the name a request names. The ingress is
 * published as Compose publishes ONEUPTIME_HTTP_PORT: on 127.0.0.1, on
 * [::1], on an address of this machine's own, and on a port alone. Then:
 *
 *   - the real Tests/Scripts/status-check.sh runs with the real curl (and a
 *     sleep that returns at once) for each, and must pass, every request
 *     reaching the App under localhost;
 *   - the check as it was before (Fixtures/StatusCheckBefore10024) must fail
 *     wherever the ingress is published on one address, as it did for the
 *     issue's reporter, and pass on a port alone, as it always did;
 *   - the doctor's after-start run must ask the same ingress, under the same
 *     name.
 *
 * With PROVISION_SSL=true the check also asks for HOST over HTTPS, where
 * STATUS_PAGE_HTTPS_PORT publishes the ingress's 7850 (#10169). A second
 * ingress renders the template as the ingress image does with
 * PROVISION_SSL=true and HOST's certificate (made here with openssl, where
 * envsubst-on-templates.sh would write its placeholder), published on
 * 127.0.0.1, an address of this machine's own, a port alone, [::1] and
 * [::]. The check must pass on each, the App seeing the request come over
 * HTTPS through the primary server; and fail, saying why, where nothing
 * listens, where STATUS_PAGE_HTTPS_PORT names the plain-HTTP port, and at
 * the first ingress's 7850, which serves no HTTPS for HOST, as an ingress
 * whose TLS block failed does not.
 *
 * Needs Docker and openssl, and pulls the nginx image and
 * node:26-alpine3.24. Ops Config Test runs it with
 * RUN_STATUS_CHECK_INGRESS_TESTS=1; without it the suite is skipped. It
 * removes the containers and the network it creates, and nothing else.
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const tls = require("tls");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");
const { configExampleSettings } = require("./Utils/ComposePorts");
const { ingressUrlOf } = require("../../Scripts/Install/FollowIngressPort");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUN = process.env.RUN_STATUS_CHECK_INGRESS_TESTS === "1";
const describeRuntime = RUN ? describe : describe.skip;

const STATUS_CHECK = path.join(
  REPO_ROOT,
  "Tests",
  "Scripts",
  "status-check.sh",
);
const STATUS_CHECK_BEFORE = path.join(
  __dirname,
  "Fixtures",
  "StatusCheckBefore10024",
  "status-check.sh",
);
const STAND_IN_APP = path.join(
  __dirname,
  "Fixtures",
  "StatusCheckIngress",
  "stand-in-app.js",
);
const DOCTOR = path.join(REPO_ROOT, "Scripts", "Install", "Doctor.js");
const NGINX_DIRECTORY = path.join(REPO_ROOT, "packages", "Nginx");
const NODE_IMAGE = "public.ecr.aws/docker/library/node:26-alpine3.24";

// The ingress listens on 7849 for HTTP; Compose publishes ONEUPTIME_HTTP_PORT there.
const INGRESS_HTTP_PORT = 7849;
// And on 7850 for HTTPS, which STATUS_PAGE_HTTPS_PORT publishes.
const INGRESS_HTTPS_PORT = 7850;

// What a request of the check is for, after the address.
const CHECKED_PATHS = [
  "/",
  "/status",
  "/status/ready",
  "/dashboard",
  "/admin/env.js",
  "/public-dashboard",
  "/accounts",
  "/status-page/",
];

const HOST = "oneuptime.example.com";
const SECRET = crypto.randomBytes(32).toString("hex");

jest.setTimeout(10 * 60 * 1000);

describe("Ops Config Test runs these checks", () => {
  const workflow = yaml.load(
    fs.readFileSync(
      path.join(REPO_ROOT, ".github", "workflows", "test.ops.yaml"),
      "utf8",
    ),
  );

  test("its jest step sets RUN_STATUS_CHECK_INGRESS_TESTS=1, so they never skip in CI", () => {
    const { stepCommand } = require("./Utils/WorkflowStep");
    const jest = workflow.jobs.test.steps.filter((step) => {
      return stepCommand(step) === "cd Tests/Ops && npm run test";
    });

    expect(jest).toHaveLength(1);
    expect(jest[0].env).toEqual(
      expect.objectContaining({ RUN_STATUS_CHECK_INGRESS_TESTS: "1" }),
    );
  });

  test("the job pulls Docker Hub's images through the mirror, and warms the stand-in App's image, before the jest step", () => {
    const { stepCommand } = require("./Utils/WorkflowStep");
    const steps = workflow.jobs.test.steps;
    const jestIndex = steps.findIndex((step) => {
      return stepCommand(step) === "cd Tests/Ops && npm run test";
    });
    const mirrorIndex = steps.findIndex((step) => {
      return step.uses === "./.github/actions/docker-hub-mirror";
    });
    const warmIndex = steps.findIndex((step) => {
      return String(stepCommand(step) || "").includes(
        `warm_base_images.sh --image ${NODE_IMAGE}`,
      );
    });

    expect(mirrorIndex).toBeGreaterThan(-1);
    expect(warmIndex).toBeGreaterThan(-1);
    expect(mirrorIndex).toBeLessThan(jestIndex);
    expect(warmIndex).toBeLessThan(jestIndex);
  });

  test("the stand-in App takes for its own the names the App does, and serves the frontends the App serves under them alone", () => {
    const frontend = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages",
        "App",
        "FeatureSet",
        "Frontend",
        "Index.ts",
      ),
      "utf8",
    );
    const standIn = fs.readFileSync(STAND_IN_APP, "utf8");

    expect(frontend).toContain(
      'process.env["HOST"] || "",\n    "localhost",\n    "ingress",',
    );
    expect(standIn).toContain(
      '[process.env.HOST || "", "localhost", "ingress"]',
    );

    for (const prefix of ["/accounts", "/dashboard", "/admin"]) {
      expect(frontend).toMatch(
        new RegExp(
          `routePrefix: "${prefix}",[\\s\\S]{0,200}?primaryHostOnly: true`,
        ),
      );
    }
    expect(standIn).toContain(
      'const PRIMARY_HOST_ONLY = ["/accounts", "/dashboard", "/admin"];',
    );
  });
});

// The nginx image the ingress image is built FROM (its base stage).
function nginxImage() {
  const dockerfile = fs.readFileSync(
    path.join(NGINX_DIRECTORY, "Dockerfile.tpl"),
    "utf8",
  );
  const match = /^FROM\s+(nginx:\S+)\s+AS\s+base\s*$/m.exec(dockerfile);

  if (!match) {
    throw new Error(
      "packages/Nginx/Dockerfile.tpl has no FROM nginx:... AS base",
    );
  }

  return match[1];
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
    output: `${result.stdout || ""}${result.stderr || ""}${result.error ? String(result.error) : ""}`,
  };
}

// A pull that a registry's passing hiccup does not fail.
function pull(image) {
  let last = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    last = docker(["pull", "--quiet", image]);

    if (last.status === 0) {
      return;
    }
  }

  throw new Error(`docker pull ${image} failed: ${last.output}`);
}

// A port nothing on this machine listens on at `address`.
function freePort(address) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.on("error", reject);
    server.listen(0, address, () => {
      const { port } = server.address();

      server.close(() => {
        resolve(port);
      });
    });
  });
}

/*
 * An IPv4 address of this machine's own, as an install publishes the
 * ingress on one (10.0.0.5:8080): a network interface's, Docker's bridges
 * last, or else another loopback address than 127.0.0.1.
 */
function specificAddress() {
  const addresses = Object.entries(os.networkInterfaces()).flatMap(
    ([name, list]) => {
      return (list || [])
        .filter((address) => {
          return address.family === "IPv4" && !address.internal;
        })
        .map((address) => {
          return { name, address: address.address };
        });
    },
  );
  const isBridge = (entry) => {
    return /^(docker|br-|veth)/.test(entry.name);
  };
  const ordered = [
    ...addresses.filter((entry) => {
      return !isBridge(entry);
    }),
    ...addresses.filter(isBridge),
  ];

  return ordered.length > 0 ? ordered[0].address : "127.0.0.2";
}

// Whether this machine has IPv6's loopback address, which Docker publishes [::1] on.
function hasIpv6Loopback() {
  return Object.values(os.networkInterfaces())
    .flat()
    .some((address) => {
      return address && address.family === "IPv6" && address.address === "::1";
    });
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/*
 * The status of a POST of `bytes` bytes to `pathname` of `origin`, under the
 * Host the origin names, as a probe sends its reports to the ONEUPTIME_URL
 * it is given.
 */
function postTo(origin, pathname, bytes) {
  return new Promise((resolve) => {
    const body = Buffer.alloc(bytes, "a");
    const request = http.request(
      new URL(pathname, origin),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
        },
        agent: false,
        timeout: 15000,
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          resolve(response.statusCode);
        });
      },
    );

    request.on("timeout", () => {
      request.destroy();
      resolve(0);
    });
    request.on("error", () => {
      resolve(0);
    });
    request.end(body);
  });
}

/*
 * A self-signed certificate for `name` in `directory`, named as the ingress
 * names HOST's (Nginx/envsubst-on-templates.sh: ServerCerts/<host>.crt and
 * .key), where the ingress image would write its temporary one.
 */
function makeCertificate(directory, name) {
  const certificate = path.join(directory, `${name}.crt`);
  const key = path.join(directory, `${name}.key`);
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      `/CN=${name}`,
      "-addext",
      `subjectAltName=DNS:${name}`,
      "-keyout",
      key,
      "-out",
      certificate,
      "-days",
      "1",
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(
      `openssl could not make a certificate for ${name}: ${result.stderr || result.error}`,
    );
  }

  // The container's nginx reads them as another user than the one who made them.
  fs.chmodSync(certificate, 0o644);
  fs.chmodSync(key, 0o644);
}

/*
 * A TLS handshake with host:port asking for `servername` (SNI): the name on
 * the certificate it was answered with, or the error.
 */
function handshake(host, port, servername) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host,
      port,
      servername,
      rejectUnauthorized: false,
      timeout: 5000,
    });

    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate() || {};

      resolve({ name: (certificate.subject || {}).CN || "" });
      socket.end();
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve({ error: "ETIMEDOUT" });
    });
    socket.once("error", (error) => {
      resolve({ error: (error && error.code) || String(error) });
    });
  });
}

// The status of a GET of `pathname` at host:port, under the Host `name`.
function statusAt(host, port, pathname, name) {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host,
        port,
        path: pathname,
        method: "GET",
        headers: { Host: name },
        agent: false,
        timeout: 5000,
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          resolve(response.statusCode);
        });
      },
    );

    request.on("timeout", () => {
      request.destroy();
      resolve(0);
    });
    request.on("error", () => {
      resolve(0);
    });
    request.end();
  });
}

describeRuntime("npm start's status check, against the real ingress", () => {
  const suffix = `${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  const network = `oneuptime-ops-status-check-${suffix}`;
  const app = `oneuptime-ops-status-check-app-${suffix}`;
  const ingress = `oneuptime-ops-status-check-ingress-${suffix}`;
  // The ingress with PROVISION_SSL=true, which serves HOST over HTTPS (#10169).
  const tlsIngress = `oneuptime-ops-status-check-tls-ingress-${suffix}`;
  const settings = configExampleSettings();
  // Turned off below, and said, where Docker cannot publish on [::1].
  let ipv6 = hasIpv6Loopback();
  const specific = specificAddress();
  let directory;
  let requestsFile;
  let ports;
  let started = false;

  // Every request the stand-in App has taken, in order.
  function requestsSeen() {
    if (!fs.existsSync(requestsFile)) {
      return [];
    }

    return fs
      .readFileSync(requestsFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        return JSON.parse(line);
      });
  }

  /*
   * Runs `script` (the status check, or the one before) where config.env
   * publishes the ingress at `setting`, with the real curl and a sleep that
   * returns at once: its exit status, what it printed, and the requests the
   * App took meanwhile. `lines` go last in config.env, where the last of a
   * setting's lines wins (PROVISION_SSL=true, STATUS_PAGE_HTTPS_PORT).
   */
  function runCheck(script, setting, lines) {
    const workspace = fs.mkdtempSync(path.join(directory, "check-"));
    const bin = path.join(workspace, "bin");

    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    fs.writeFileSync(
      path.join(workspace, "config.env"),
      [
        `HOST=${HOST}`,
        "HTTP_PROTOCOL=https",
        "PROVISION_SSL=false",
        `ONEUPTIME_HTTP_PORT=${setting}`,
      ]
        .concat(lines || [])
        .concat([""])
        .join("\n"),
    );

    const before = requestsSeen().length;
    const result = spawnSync("bash", [script], {
      cwd: workspace,
      env: {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        HOME: workspace,
      },
      encoding: "utf8",
      timeout: 5 * 60 * 1000,
    });

    return {
      status: result.status,
      output: `${result.stdout || ""}${result.stderr || ""}`,
      seen: requestsSeen().slice(before),
    };
  }

  /*
   * Where Compose publishes the ingress for each form, and the
   * ONEUPTIME_HTTP_PORT that publishes it there: on one address (the
   * loopback addresses, with IPv6's with and without brackets, as Compose
   * takes it, and an address of this machine), and on a port alone.
   */
  function oneAddressForms() {
    const forms = [
      [`127.0.0.1:${ports.loopback}`, "127.0.0.1", "127.0.0.1"],
      [`${specific}:${ports.specific}`, specific, specific],
    ];

    if (ipv6) {
      forms.push([`[::1]:${ports.ipv6}`, "[::1]", "::1"]);
      forms.push([`::1:${ports.ipv6}`, "[::1]", "::1"]);
      // Every IPv6 address, which Docker publishes on IPv6 alone: reached at [::1].
      forms.push([`[::]:${ports.ipv6Any}`, "[::1]", "::1"]);
    }

    return forms;
  }

  beforeAll(async () => {
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-status-check-ingress-"),
    );
    fs.chmodSync(directory, 0o777);
    const requestsDirectory = path.join(directory, "requests");
    fs.mkdirSync(requestsDirectory);
    fs.chmodSync(requestsDirectory, 0o777);
    requestsFile = path.join(requestsDirectory, "requests.jsonl");

    // Free ports, none of them handed out twice.
    const taken = new Set();
    const port = async (address) => {
      for (;;) {
        const found = await freePort(address);

        if (!taken.has(found)) {
          taken.add(found);
          return found;
        }
      }
    };

    ports = {
      loopback: await port("127.0.0.1"),
      specific: await port(specific),
      ipv6: ipv6 ? await port("::1") : null,
      ipv6Any: ipv6 ? await port("::") : null,
      every: await port("0.0.0.0"),
      // The first ingress's 7850, which serves no HTTPS for HOST.
      plainHttps: await port("127.0.0.1"),
      // The TLS ingress's 7849, and its 7850 every way it can be published.
      tlsHttp: await port("127.0.0.1"),
      httpsLoopback: await port("127.0.0.1"),
      httpsSpecific: await port(specific),
      httpsEvery: await port("0.0.0.0"),
      httpsIpv6: ipv6 ? await port("::1") : null,
      httpsIpv6Any: ipv6 ? await port("::") : null,
      // Where nothing listens.
      nothing: await port("127.0.0.1"),
    };

    // HOST's certificate, where the ingress image would write its temporary one.
    const certificates = path.join(directory, "ServerCerts");

    fs.mkdirSync(certificates);
    makeCertificate(certificates, HOST);

    const version = docker(["version", "--format", "{{.Server.Version}}"]);

    if (version.status !== 0) {
      throw new Error(
        `RUN_STATUS_CHECK_INGRESS_TESTS=1, but docker does not answer: ${version.output}`,
      );
    }

    pull(nginxImage());
    pull(NODE_IMAGE);

    const created = docker(["network", "create", network]);

    if (created.status !== 0) {
      throw new Error(`docker network create failed: ${created.output}`);
    }

    started = true;

    const appStarted = docker([
      "run",
      "-d",
      "--name",
      app,
      "--network",
      network,
      "--network-alias",
      settings.get("SERVER_APP_HOSTNAME") || "app",
      "-e",
      `HOST=${HOST}`,
      "-e",
      `APP_PORT=${settings.get("APP_PORT")}`,
      "-v",
      `${STAND_IN_APP}:/stand-in-app.js:ro`,
      "-v",
      `${requestsDirectory}:/requests`,
      NODE_IMAGE,
      "node",
      "/stand-in-app.js",
    ]);

    if (appStarted.status !== 0) {
      throw new Error(`the stand-in App did not start: ${appStarted.output}`);
    }

    const publishedOn = (withIpv6) => {
      const published = [
        "-p",
        `127.0.0.1:${ports.loopback}:${INGRESS_HTTP_PORT}`,
        "-p",
        `${specific}:${ports.specific}:${INGRESS_HTTP_PORT}`,
        "-p",
        `${ports.every}:${INGRESS_HTTP_PORT}`,
        "-p",
        `127.0.0.1:${ports.plainHttps}:${INGRESS_HTTPS_PORT}`,
      ];

      if (withIpv6) {
        published.push("-p", `[::1]:${ports.ipv6}:${INGRESS_HTTP_PORT}`);
        published.push("-p", `[::]:${ports.ipv6Any}:${INGRESS_HTTP_PORT}`);
      }

      return published;
    };

    // The TLS ingress: its plain HTTP on 127.0.0.1, and HTTPS every way.
    const tlsPublishedOn = (withIpv6) => {
      const published = [
        "-p",
        `127.0.0.1:${ports.tlsHttp}:${INGRESS_HTTP_PORT}`,
        "-p",
        `127.0.0.1:${ports.httpsLoopback}:${INGRESS_HTTPS_PORT}`,
        "-p",
        `${specific}:${ports.httpsSpecific}:${INGRESS_HTTPS_PORT}`,
        "-p",
        `${ports.httpsEvery}:${INGRESS_HTTPS_PORT}`,
      ];

      if (withIpv6) {
        published.push("-p", `[::1]:${ports.httpsIpv6}:${INGRESS_HTTPS_PORT}`);
        published.push(
          "-p",
          `[::]:${ports.httpsIpv6Any}:${INGRESS_HTTPS_PORT}`,
        );
      }

      return published;
    };

    /*
     * As the ingress image's run.sh starts nginx: the template rendered by
     * envsubst-on-templates.sh into conf.d, with the resolver Docker's
     * network answers on (run.sh reads it from /etc/resolv.conf), then
     * nginx with OneUptime's nginx.conf. `extra` adds to docker run's
     * arguments.
     */
    const runIngress = (name, published, extra) => {
      return docker([
        "run",
        "-d",
        "--name",
        name,
        "--network",
        network,
        ...extra,
        "-e",
        `HOST=${HOST}`,
        "-e",
        `APP_PORT=${settings.get("APP_PORT")}`,
        "-e",
        `HOME_PORT=${settings.get("HOME_PORT")}`,
        "-e",
        `SERVER_APP_HOSTNAME=${settings.get("SERVER_APP_HOSTNAME") || "app"}`,
        "-e",
        "SERVER_HOME_HOSTNAME=home",
        "-e",
        `BILLING_ENABLED=${settings.get("BILLING_ENABLED")}`,
        "-e",
        "NGINX_RESOLVER=127.0.0.11",
        "-e",
        "NGINX_LISTEN_ADDRESS=",
        "-e",
        "NGINX_LISTEN_OPTIONS=",
        "-v",
        `${path.join(NGINX_DIRECTORY, "default.conf.template")}:/etc/nginx/templates/default.conf.template:ro`,
        "-v",
        `${path.join(NGINX_DIRECTORY, "envsubst-on-templates.sh")}:/etc/nginx/envsubst-on-templates.sh:ro`,
        "-v",
        `${path.join(NGINX_DIRECTORY, "nginx.conf")}:/etc/nginx/nginx.conf:ro`,
        ...published,
        nginxImage(),
        "sh",
        "-c",
        "sh /etc/nginx/envsubst-on-templates.sh && exec nginx -g 'daemon off;'",
      ]);
    };

    const startIngress = (withIpv6) => {
      return runIngress(ingress, publishedOn(withIpv6), []);
    };

    /*
     * With PROVISION_SSL=true, as run.sh hands it to the script with HOST's
     * PRIMARY_DOMAIN: the primary server listens on 7850 too, with HOST's
     * certificate, found where the script looks for it.
     */
    const startTlsIngress = (withIpv6) => {
      return runIngress(tlsIngress, tlsPublishedOn(withIpv6), [
        "-e",
        "PROVISION_SSL=true",
        "-e",
        `PRIMARY_DOMAIN=${HOST}`,
        "-v",
        `${certificates}:/etc/nginx/certs/ServerCerts:ro`,
      ]);
    };

    let ingressStarted = startIngress(ipv6);

    /*
     * A Docker that cannot publish on IPv6's loopback address (its daemon
     * set up without IPv6, or without its userland proxy) refuses the whole
     * container: start it without [::1], and say the [::1] forms are not run.
     */
    if (ingressStarted.status !== 0 && ipv6) {
      docker(["rm", "-f", ingress]);

      const withoutIpv6 = startIngress(false);

      if (withoutIpv6.status === 0) {
        console.log(
          `Docker here cannot publish on [::1] (${ingressStarted.output.trim()}): the [::1] forms are not run.`,
        );
        ipv6 = false;
      }

      ingressStarted = withoutIpv6;
    }

    if (ingressStarted.status !== 0) {
      throw new Error(`the ingress did not start: ${ingressStarted.output}`);
    }

    const tlsStarted = startTlsIngress(ipv6);

    if (tlsStarted.status !== 0) {
      throw new Error(`the TLS ingress did not start: ${tlsStarted.output}`);
    }

    // Up once each hands a request to the App, which it finds by its name on the network.
    for (const [name, httpPort] of [
      [ingress, ports.loopback],
      [tlsIngress, ports.tlsHttp],
    ]) {
      const deadline = Date.now() + 90 * 1000;

      while (
        (await statusAt("127.0.0.1", httpPort, "/status", "localhost")) !== 200
      ) {
        if (Date.now() > deadline) {
          throw new Error(
            `${name} never answered: ${docker(["logs", name]).output}\n${docker(["logs", app]).output}`,
          );
        }

        await wait(500);
      }
    }
  });

  afterAll(() => {
    if (started) {
      docker(["rm", "-f", "--volumes", app, ingress, tlsIngress]);
      docker(["network", "rm", network]);
    }

    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("the ingress serves the App's pages under localhost, and a status page's domain under an address", async () => {
    // What the issue measured: the same socket, by two names.
    for (const pathname of ["/", "/dashboard", "/admin/env.js", "/accounts"]) {
      expect(
        await statusAt(
          "127.0.0.1",
          ports.loopback,
          pathname,
          `localhost:${ports.loopback}`,
        ),
      ).toBe(200);
      expect(
        await statusAt(
          "127.0.0.1",
          ports.loopback,
          pathname,
          `127.0.0.1:${ports.loopback}`,
        ),
      ).toBe(404);
    }

    for (const pathname of [
      "/status",
      "/status/ready",
      "/public-dashboard",
      "/status-page/",
    ]) {
      expect(
        await statusAt(
          "127.0.0.1",
          ports.loopback,
          pathname,
          `127.0.0.1:${ports.loopback}`,
        ),
      ).toBe(200);
    }
  });

  test("the ingress is published as each form says, and nowhere else", async () => {
    // On 127.0.0.1 alone, not on the machine's other address.
    expect(
      await statusAt("127.0.0.1", ports.loopback, "/status", "localhost"),
    ).toBe(200);
    expect(
      await statusAt(specific, ports.loopback, "/status", "localhost"),
    ).toBe(0);
    // On the machine's own address alone, not on 127.0.0.1.
    expect(
      await statusAt(specific, ports.specific, "/status", "localhost"),
    ).toBe(200);
    expect(
      await statusAt("127.0.0.1", ports.specific, "/status", "localhost"),
    ).toBe(0);

    if (ipv6) {
      expect(await statusAt("::1", ports.ipv6, "/status", "localhost")).toBe(
        200,
      );
      expect(
        await statusAt("127.0.0.1", ports.ipv6, "/status", "localhost"),
      ).toBe(0);
      /*
       * [::] is every IPv6 address and no IPv4 one: Docker publishes it on
       * IPv6 alone, so the check reaches it at [::1], not at whatever
       * localhost names.
       */
      expect(await statusAt("::1", ports.ipv6Any, "/status", "localhost")).toBe(
        200,
      );
      expect(
        await statusAt("127.0.0.1", ports.ipv6Any, "/status", "localhost"),
      ).toBe(0);
    }
  });

  describe("on one address of the server", () => {
    test.each([
      [
        "127.0.0.1",
        () => {
          return oneAddressForms()[0];
        },
      ],
      [
        "an address of this machine's own",
        () => {
          return oneAddressForms()[1];
        },
      ],
      [
        "[::1]",
        () => {
          return ipv6 ? oneAddressForms()[2] : null;
        },
      ],
      [
        "::1, without brackets, as Compose takes it too",
        () => {
          return ipv6 ? oneAddressForms()[3] : null;
        },
      ],
      [
        "[::], every IPv6 address",
        () => {
          return ipv6 ? oneAddressForms()[4] : null;
        },
      ],
    ])(
      "on %s: the check passes, every request reaching the App under localhost",
      (_label, formOf) => {
        const form = formOf();

        if (!form) {
          // This machine has no IPv6 loopback address for Docker to publish on.
          console.log("No ::1 on this machine: the [::1] forms are not run.");
          return;
        }

        const [setting, address] = form;
        const port = setting.slice(setting.lastIndexOf(":") + 1);
        const result = runCheck(STATUS_CHECK, setting);

        expect({ status: result.status, output: result.output }).toEqual({
          status: 0,
          output: expect.stringContaining("🚀 OneUptime is up! 🚀"),
        });
        expect(result.output).toContain(
          `Waiting for OneUptime to answer at ${address}:${port}, where ONEUPTIME_HTTP_PORT publishes the ingress.`,
        );
        expect(result.output).toContain(
          `✅ Dashboard endpoint is up (localhost:${port}/dashboard at ${address}:${port})`,
        );
        // Each page once, then the readiness loop's five, all by the App's own name.
        expect(
          result.seen.slice(0, CHECKED_PATHS.length).map((entry) => {
            return entry.path;
          }),
        ).toEqual(CHECKED_PATHS);
        expect(result.seen.length).toBe(CHECKED_PATHS.length + 5);
        for (const entry of result.seen) {
          expect({
            path: entry.path,
            host: entry.host,
            status: entry.status,
          }).toEqual({
            path: entry.path,
            host: "localhost",
            status: 200,
          });
        }
      },
    );

    test.each([
      ["127.0.0.1", 0],
      ["an address of this machine's own", 1],
      ["[::1]", 2],
    ])(
      "on %s, the check as it was before fails: it asked by the address, which the ingress serves as a status page's domain",
      (_label, index) => {
        const form = oneAddressForms()[index];

        if (!form) {
          console.log("No ::1 on this machine: the [::1] forms are not run.");
          return;
        }

        const [setting, address, hostname] = form;
        const port = setting.slice(setting.lastIndexOf(":") + 1);
        const result = runCheck(STATUS_CHECK_BEFORE, setting);

        expect(result.status).toBe(1);
        expect(result.output).toContain(
          `App ${address}:${port} returned HTTP 404, retrying in 15 seconds.`,
        );
        expect(result.output).toContain(
          "❌ Error: Maximum retries reached, App still not returning HTTP 200.",
        );
        expect(result.output).not.toContain("OneUptime is up!");
        // Twenty tries of its first page, each by the address.
        expect(result.seen).toHaveLength(20);
        for (const entry of result.seen) {
          expect(entry).toEqual(
            expect.objectContaining({
              path: "/",
              host: hostname.includes(":") ? `[${hostname}]` : hostname,
              status: 404,
            }),
          );
        }
      },
    );
  });

  test("on a port alone, the check passes, as the check before did", () => {
    const now = runCheck(STATUS_CHECK, String(ports.every));
    const before = runCheck(STATUS_CHECK_BEFORE, String(ports.every));

    for (const result of [now, before]) {
      expect(result.status).toBe(0);
      expect(result.output).toContain("🚀 OneUptime is up! 🚀");
      for (const entry of result.seen) {
        expect(entry.host).toBe("localhost");
      }
    }
    expect(now.output).toContain(
      `Waiting for OneUptime to answer at localhost:${ports.every}.`,
    );
  });

  test.each([
    ["127.0.0.1", 0],
    ["an address of this machine's own", 1],
    ["[::1]", 2],
    ["[::], every IPv6 address", 4],
  ])(
    "on %s, the doctor's after-start run asks the same ingress, under localhost",
    (_label, index) => {
      const form = oneAddressForms()[index];

      if (!form) {
        console.log("No ::1 on this machine: the [::1] forms are not run.");
        return;
      }

      const [setting] = form;
      const workspace = fs.mkdtempSync(path.join(directory, "doctor-"));

      fs.writeFileSync(
        path.join(workspace, "config.env"),
        [
          `HOST=${HOST}`,
          "HTTP_PROTOCOL=https",
          "PROVISION_SSL=false",
          `ONEUPTIME_HTTP_PORT=${setting}`,
          `ONEUPTIME_SECRET=${SECRET}`,
          "",
        ].join("\n"),
      );

      const before = requestsSeen().length;
      const result = spawnSync(process.execPath, [DOCTOR, "--after-start"], {
        cwd: workspace,
        env: { PATH: process.env.PATH, HOME: workspace },
        encoding: "utf8",
        timeout: 2 * 60 * 1000,
      });
      const seen = requestsSeen().slice(before);

      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("does not answer at");
      expect(
        seen.map((entry) => {
          return [entry.method, entry.path, entry.host, entry.status];
        }),
      ).toEqual([
        ["GET", "/status/ready", "localhost", 200],
        ["POST", "/api/admin/health/doctor", "localhost", 200],
      ]);
    },
  );

  /*
   * The bundled probes send no Host header of their own: they call the
   * ONEUPTIME_URL FollowIngressPort gives them, which names the ingress by
   * the address it is published on, but for 127.0.0.1 (localhost). Under
   * such a name the status-page server forwarded their reports on nginx's
   * 1M default; a synthetic monitor's screenshots came back 413. It takes
   * the primary's 50M for a probe's paths now, and keeps 1M for the rest.
   */
  test.each([
    ["127.0.0.1", 0],
    ["an address of this machine's own", 1],
    ["[::1]", 2],
    ["[::], every IPv6 address", 4],
  ])(
    "on %s, a bundled probe's 2 MB report reaches the App, and the status pages there keep their 1M",
    async (_label, index) => {
      const form = oneAddressForms()[index];

      if (!form) {
        console.log("No ::1 on this machine: the [::1] forms are not run.");
        return;
      }

      const [setting] = form;
      const origin = ingressUrlOf(setting).url;
      const bytes = 2 * 1024 * 1024;

      for (const pathname of [
        "/probe-ingest/probe/response/ingest",
        "/ingestor/probe/response/ingest",
        "/incoming-request-ingest/incoming-request/0123456789abcdef",
      ]) {
        const before = requestsSeen().length;

        expect({
          pathname,
          status: await postTo(origin, pathname, bytes),
        }).toEqual({
          pathname,
          status: 200,
        });
        expect(
          requestsSeen()
            .slice(before)
            .map((entry) => {
              return [entry.path, entry.bytes];
            }),
        ).toEqual([[pathname, bytes]]);
      }

      // Elsewhere nginx's 1M stays, in the primary and the status-page server alike.
      const before = requestsSeen().length;

      expect(await postTo(origin, "/", bytes)).toBe(413);
      expect(requestsSeen().slice(before)).toEqual([]);
    },
  );

  /*
   * #10169: with PROVISION_SSL=true the check also asks for HOST over HTTPS
   * where STATUS_PAGE_HTTPS_PORT publishes the ingress's 7850, naming HOST,
   * which is how nginx picks the primary server and its certificate.
   */
  describe("HOST over HTTPS, with PROVISION_SSL (#10169)", () => {
    // The config.env lines of an install that has the ingress serve HOST over HTTPS.
    const provisioned = (httpsSetting) => {
      return ["PROVISION_SSL=true", `STATUS_PAGE_HTTPS_PORT=${httpsSetting}`];
    };

    // The requests the App took over HTTPS: through the ingress's TLS.
    const overHttps = (seen) => {
      return seen.filter((entry) => {
        return entry.proto === "https";
      });
    };

    /*
     * Where Compose publishes the TLS ingress's 7850 for each form, and the
     * STATUS_PAGE_HTTPS_PORT that publishes it there, with where the check
     * connects: a port alone, which Docker publishes on every address, at
     * 127.0.0.1; [::], IPv6 alone, at [::1].
     */
    function httpsForms() {
      const forms = [
        [
          `127.0.0.1:${ports.httpsLoopback}`,
          `127.0.0.1:${ports.httpsLoopback}`,
        ],
        [
          `${specific}:${ports.httpsSpecific}`,
          `${specific}:${ports.httpsSpecific}`,
        ],
        [String(ports.httpsEvery), `127.0.0.1:${ports.httpsEvery}`],
      ];

      if (ipv6) {
        forms.push([`[::1]:${ports.httpsIpv6}`, `[::1]:${ports.httpsIpv6}`]);
        forms.push([`::1:${ports.httpsIpv6}`, `[::1]:${ports.httpsIpv6}`]);
        forms.push([
          `[::]:${ports.httpsIpv6Any}`,
          `[::1]:${ports.httpsIpv6Any}`,
        ]);
      }

      return forms;
    }

    test("the TLS ingress answers HOST with HOST's certificate, and a name it holds none for with no handshake at all", async () => {
      expect(await handshake("127.0.0.1", ports.httpsLoopback, HOST)).toEqual({
        name: HOST,
      });
      expect(
        await handshake("127.0.0.1", ports.httpsLoopback, "status.example.org"),
      ).toEqual({ error: expect.any(String) });
      // The first ingress serves no HTTPS for HOST: its 7850 is the status pages' alone.
      expect(await handshake("127.0.0.1", ports.plainHttps, HOST)).toEqual({
        error: expect.any(String),
      });
    });

    test.each([
      ["127.0.0.1", 0],
      ["an address of this machine's own", 1],
      ["a port alone, every address", 2],
      ["[::1]", 3],
      ["::1, without brackets, as Compose takes it too", 4],
      ["[::], every IPv6 address", 5],
    ])(
      "on %s: the check asks for HOST over HTTPS there, through the primary server, and passes",
      (_label, index) => {
        const form = httpsForms()[index];

        if (!form) {
          console.log("No ::1 on this machine: the [::1] forms are not run.");
          return;
        }

        const [httpsSetting, checkedAt] = form;
        const port = checkedAt.slice(checkedAt.lastIndexOf(":") + 1);
        const result = runCheck(
          STATUS_CHECK,
          `127.0.0.1:${ports.tlsHttp}`,
          provisioned(httpsSetting),
        );

        expect({ status: result.status, output: result.output }).toEqual({
          status: 0,
          output: expect.stringContaining("🚀 OneUptime is up! 🚀"),
        });
        expect(result.output).toContain(
          `✅ App (HTTPS) endpoint is up (https://${HOST}:${port}/status/ready at ${checkedAt})`,
        );
        // One request over HTTPS, handed on by the primary server under its own name.
        expect(overHttps(result.seen)).toEqual([
          {
            method: "GET",
            path: "/status/ready",
            host: "localhost",
            proto: "https",
            bytes: 0,
            status: 200,
          },
        ]);
        // The pages over plain HTTP, then HTTPS, then the readiness loop's five.
        expect(result.seen.length).toBe(CHECKED_PATHS.length + 1 + 5);
        expect(result.seen[CHECKED_PATHS.length].proto).toBe("https");
      },
    );

    test("nothing listening where STATUS_PAGE_HTTPS_PORT publishes it: the check fails, saying where it connected", () => {
      const result = runCheck(
        STATUS_CHECK,
        `127.0.0.1:${ports.tlsHttp}`,
        provisioned(`127.0.0.1:${ports.nothing}`),
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain(
        "❌ Error: Maximum retries reached, App (HTTPS) still not returning HTTP 200.",
      );
      expect(result.output).toContain(
        `Nothing answered at 127.0.0.1:${ports.nothing}, where STATUS_PAGE_HTTPS_PORT in config.env publishes OneUptime's ingress.`,
      );
      expect(result.output).not.toContain("OneUptime is up!");
      expect(overHttps(result.seen)).toEqual([]);
    });

    test("STATUS_PAGE_HTTPS_PORT naming the plain-HTTP port: something answers, but completes no TLS handshake", () => {
      const result = runCheck(
        STATUS_CHECK,
        `127.0.0.1:${ports.tlsHttp}`,
        provisioned(`127.0.0.1:${ports.tlsHttp}`),
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain(
        `Something answers at 127.0.0.1:${ports.tlsHttp}, where STATUS_PAGE_HTTPS_PORT in config.env publishes OneUptime's ingress, but it completed no TLS handshake for ${HOST}.`,
      );
      expect(result.output).not.toContain("OneUptime is up!");
    });

    /*
     * The first ingress renders the template without PROVISION_SSL's TLS
     * block, exactly as envsubst-on-templates.sh renders it with
     * PROVISION_SSL=true when it cannot write HOST's placeholder
     * certificate ("HTTPS directives disabled to keep nginx healthy"): its
     * 7850 is the status pages' server alone, with no certificate for HOST.
     */
    test("an ingress that serves no HTTPS for HOST, as one whose TLS block failed: the check fails, and says the handshake did", () => {
      const result = runCheck(
        STATUS_CHECK,
        `127.0.0.1:${ports.loopback}`,
        provisioned(`127.0.0.1:${ports.plainHttps}`),
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain("✅ Status Page endpoint is up");
      expect(result.output).toContain(
        `Something answers at 127.0.0.1:${ports.plainHttps}, where STATUS_PAGE_HTTPS_PORT in config.env publishes OneUptime's ingress, but it completed no TLS handshake for ${HOST}.`,
      );
      expect(result.output).not.toContain("OneUptime is up!");
      expect(overHttps(result.seen)).toEqual([]);
    });

    test("with PROVISION_SSL=false, nothing is asked over HTTPS, as before", () => {
      const result = runCheck(STATUS_CHECK, `127.0.0.1:${ports.tlsHttp}`, [
        `STATUS_PAGE_HTTPS_PORT=127.0.0.1:${ports.httpsLoopback}`,
      ]);

      expect(result.status).toBe(0);
      expect(result.output).not.toContain("App (HTTPS)");
      expect(overHttps(result.seen)).toEqual([]);
      expect(result.seen.length).toBe(CHECKED_PATHS.length + 5);
    });
  });
});
