"use strict";

/**
 * HelmChart/Public/diagnose.sh checks the address people open and its
 * certificate (#7051), as `npm run doctor` does on Docker Compose: from
 * inside the cluster, with a node script in the app pod (whether `host`
 * resolves, the certificate it presents, whether a request to it reaches
 * this OneUptime and how that request arrived), and from the computer the
 * script runs on, with curl.
 *
 * The pod's script is run here three ways: in a sandbox with its network
 * modules stubbed, so every outcome is reached without a network; with
 * this machine's node against real local HTTP and HTTPS servers standing in
 * for the address; and the shell around it is sourced with a fake kubectl
 * exec and a fake curl. Nothing reaches a cluster or the internet.
 */

const EventEmitter = require("events");
const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const os = require("os");
const path = require("path");
const tls = require("tls");
const vm = require("vm");
const { spawn, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../..");
const DIAGNOSE = path.join(REPO_ROOT, "HelmChart/Public/diagnose.sh");
const SOURCE = fs.readFileSync(DIAGNOSE, "utf8");
const PROOF = `${"0123456789abcdef".repeat(2)}.${"fedcba9876543210".repeat(4)}`;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/*
 * The clock the certificates here are dated by, read once: the date expected
 * of a certificate is reckoned from the same moment as the certificate, never
 * from a later reading that may fall on the next day.
 */
const NOW = Date.now();

// The node script diagnose.sh hands the app pod for the address check.
const addressScript = () => {
  const match = /EXTERNAL_ADDRESS_SCRIPT='([\s\S]*?)'\n/.exec(SOURCE);

  if (!match) {
    throw new Error("EXTERNAL_ADDRESS_SCRIPT not found in diagnose.sh");
  }

  return match[1];
};

/*
 * When a certificate with `daysLeft` days left expires: an hour past that many
 * days, so the script, reading the clock a moment later, still counts
 * `daysLeft` whole days. In the last hour of a UTC day that hour carries it
 * into the next day.
 */
const expiry = (daysLeft) => {
  return new Date(NOW + daysLeft * DAY + HOUR);
};

/*
 * The date the script's certificate line names for a certificate with
 * `daysLeft` days left: the day, in UTC, it expires.
 */
const day = (daysLeft) => {
  return expiry(daysLeft).toISOString().slice(0, 10);
};

// A certificate as tls's getPeerCertificate() describes one.
const certificate = (data) => {
  const given = data || {};

  return {
    subject: { CN: given.cn || "oneuptime.example.com" },
    issuer: { O: given.issuer || "Let's Encrypt", CN: "R11" },
    subjectaltname:
      given.altNames === undefined
        ? "DNS:oneuptime.example.com"
        : given.altNames,
    valid_to: expiry(
      given.daysLeft === undefined ? 60 : given.daysLeft,
    ).toUTCString(),
  };
};

/*
 * The world the sandboxed script sees: what the name resolves to, what port
 * 443 presents, and what the proof request answers.
 */
const scene = (data) => {
  return Object.assign(
    {
      env: { HOST: "oneuptime.example.com", HTTP_PROTOCOL: "https" },
      proof: PROOF,
      dns: { addresses: ["203.0.113.10"] },
      tls: { authorized: true, certificate: certificate() },
      reach: {
        status: 200,
        json: {
          proof: PROOF,
          request: { host: "oneuptime.example.com", isHttps: true },
        },
      },
    },
    data || {},
  );
};

/*
 * Runs the pod script in a sandbox with dns, tls, http and https stubbed
 * from `world`: { lines, lookups, connections, requests }.
 */
const runSandboxed = (world) => {
  return new Promise((resolve, reject) => {
    const lines = [];
    const lookups = [];
    const connections = [];
    const requests = [];
    const timers = [];

    const later = (fn) => {
      setImmediate(fn);
    };

    const dns = {
      lookup: (name, options, callback) => {
        lookups.push({ name: name, options: options });
        later(() => {
          if (world.dns.error) {
            callback({ code: world.dns.error });
            return;
          }

          callback(
            null,
            world.dns.addresses.map((address) => {
              return { address: address, family: net.isIP(address) };
            }),
          );
        });
      },
    };

    const fakeTls = {
      checkServerIdentity: tls.checkServerIdentity,
      connect: (options, onConnect) => {
        const socket = new EventEmitter();

        connections.push(options);
        socket.getPeerCertificate = () => {
          return world.tls.certificate;
        };
        socket.end = () => {};
        socket.destroy = () => {};
        later(() => {
          if (world.tls.error) {
            if (world.tls.error === "ETIMEDOUT") {
              socket.emit("timeout");
            } else {
              socket.emit("error", { code: world.tls.error });
            }
            return;
          }

          socket.authorized = world.tls.authorized;
          socket.authorizationError = world.tls.reason
            ? { code: world.tls.reason }
            : null;
          onConnect();
        });

        return socket;
      },
    };

    const client = (scheme) => {
      return {
        get: (url, options, onResponse) => {
          const request = new EventEmitter();

          requests.push({ scheme: scheme, url: url, options: options });
          request.destroy = () => {};
          later(() => {
            if (world.reach.error) {
              if (world.reach.error === "ETIMEDOUT") {
                request.emit("timeout");
              } else {
                request.emit("error", { code: world.reach.error });
              }
              return;
            }

            const response = new EventEmitter();
            response.statusCode = world.reach.status;
            response.setEncoding = () => {};
            onResponse(response);
            response.emit(
              "data",
              world.reach.json === undefined
                ? ""
                : JSON.stringify(world.reach.json),
            );
            response.emit("end");
          });

          return request;
        },
      };
    };

    const modules = {
      dns: dns,
      tls: fakeTls,
      net: net,
      http: client("http"),
      https: client("https"),
    };

    const finish = () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }

      resolve({
        lines: lines,
        lookups: lookups,
        connections: connections,
        requests: requests,
      });
    };

    try {
      vm.runInNewContext(addressScript(), {
        require: (name) => {
          if (!modules[name]) {
            throw new Error(`the script asked for ${name}`);
          }

          return modules[name];
        },
        process: {
          env: world.env,
          argv: ["node", world.proof],
          exit: finish,
        },
        console: {
          log: (line) => {
            lines.push(String(line));
          },
        },
        setTimeout: (fn, ms) => {
          const timer = setTimeout(fn, ms);
          timers.push(timer);
          return timer;
        },
        clearTimeout: clearTimeout,
      });
    } catch (error) {
      reject(error);
    }
  });
};

// The script's findings, as { level, title, sentence, fix }.
const findingsOf = (lines) => {
  return lines
    .filter((line) => {
      return /^(fix|warn|ok|info)\|/.test(line);
    })
    .map((line) => {
      const [level, title, sentence, fix] = line.split("|");

      return { level: level, title: title, sentence: sentence, fix: fix };
    });
};

describe("the address check diagnose.sh runs in the app pod", () => {
  test("it holds no single quote, which would end the shell string it lives in", () => {
    expect(addressScript()).not.toContain("'");
  });

  test("a healthy address: it resolves, its certificate is valid and trusted, and it reaches this OneUptime, each said in one line", async () => {
    const result = await runSandboxed(scene());

    expect(result.lines[0]).toBe("HOST|oneuptime.example.com|https");
    expect(findingsOf(result.lines)).toEqual([
      {
        level: "ok",
        title: "Address",
        sentence:
          "oneuptime.example.com resolves to 203.0.113.10 inside the cluster.",
        fix: "",
      },
      {
        level: "ok",
        title: "HTTPS",
        sentence: `The certificate for oneuptime.example.com, from Let's Encrypt, covers oneuptime.example.com and is valid until ${day(60)}.`,
        fix: "",
      },
      {
        level: "ok",
        title: "Address",
        sentence:
          "From inside the cluster, https://oneuptime.example.com reaches this OneUptime.",
        fix: "",
      },
    ]);
  });

  test("it asks the name by its own name, presents it to the TLS connection, and asks for the proof with a GET that carries nothing else", async () => {
    const result = await runSandboxed(scene());

    expect(result.lookups).toEqual([
      { name: "oneuptime.example.com", options: { all: true } },
    ]);
    expect(result.connections).toEqual([
      {
        host: "oneuptime.example.com",
        port: 443,
        servername: "oneuptime.example.com",
        rejectUnauthorized: false,
        timeout: 5000,
      },
    ]);
    expect(result.requests).toEqual([
      {
        scheme: "https",
        url: `https://oneuptime.example.com/status-page-api/custom-domain-readiness/${PROOF}`,
        options: { rejectUnauthorized: false, timeout: 10000 },
      },
    ]);
  });

  test("a port in host is the port asked, and an IP address is not looked up nor named to TLS", async () => {
    const withPort = await runSandboxed(
      scene({
        env: { HOST: "oneuptime.example.com:8443", HTTP_PROTOCOL: "https" },
      }),
    );

    expect(withPort.connections[0].port).toBe(8443);
    expect(withPort.requests[0].url).toBe(
      `https://oneuptime.example.com:8443/status-page-api/custom-domain-readiness/${PROOF}`,
    );

    const address = await runSandboxed(
      scene({
        env: { HOST: "203.0.113.10", HTTP_PROTOCOL: "https" },
        tls: {
          authorized: true,
          certificate: certificate({ altNames: "IP Address:203.0.113.10" }),
        },
        reach: {
          status: 200,
          json: {
            proof: PROOF,
            request: { host: "203.0.113.10", isHttps: true },
          },
        },
      }),
    );

    expect(address.lookups).toEqual([]);
    expect(address.connections[0].servername).toBeUndefined();
    expect(
      findingsOf(address.lines).map((entry) => {
        return entry.level;
      }),
    ).toEqual(["ok", "ok"]);
  });

  test.each([
    ["empty", "", "empty"],
    ["a URL", "https://oneuptime.example.com", "https://oneuptime.example.com"],
    ["two names", "a.example.com b.example.com", "a.example.com b.example.com"],
  ])(
    "host %s is not a host name: one warning naming it, and nothing is asked",
    async (_label, host, named) => {
      const result = await runSandboxed(
        scene({ env: { HOST: host, HTTP_PROTOCOL: "https" } }),
      );

      expect(result.lines.some((line) => line.startsWith("HOST|"))).toBe(false);
      expect(result.lookups).toEqual([]);
      expect(result.requests).toEqual([]);
      expect(findingsOf(result.lines)).toEqual([
        {
          level: "warn",
          title: "Address",
          sentence: `host in your Helm values (${named}) is not a host name, so the address people open was not checked.`,
          fix: "Set host to the domain people open OneUptime at, such as oneuptime.example.com, then run helm upgrade.",
        },
      ]);
    },
  );

  test.each(["localhost", "127.0.0.1", "[::1]", "app.localhost"])(
    "host %s, the chart's default or the cluster's own, is worth a look, and nothing is asked",
    async (host) => {
      const result = await runSandboxed(
        scene({ env: { HOST: host, HTTP_PROTOCOL: "http" } }),
      );

      expect(result.requests).toEqual([]);
      expect(result.connections).toEqual([]);

      const found = findingsOf(result.lines);

      expect(found.length).toBe(1);
      expect(found[0].level).toBe("warn");
      expect(found[0].sentence).toContain("host in your Helm values is");
      expect(found[0].sentence).toContain(
        "the links OneUptime sends lead nowhere",
      );
    },
  );

  test("a name that does not resolve inside the cluster is worth a look, and nothing else is asked from here", async () => {
    const result = await runSandboxed(scene({ dns: { error: "ENOTFOUND" } }));

    expect(result.lines[0]).toBe("HOST|oneuptime.example.com|https");
    expect(result.connections).toEqual([]);
    expect(result.requests).toEqual([]);
    expect(findingsOf(result.lines)).toEqual([
      {
        level: "warn",
        title: "Address",
        sentence:
          "From inside the cluster, oneuptime.example.com does not resolve (the name does not resolve), so it was not opened from here.",
        fix: "If it resolves elsewhere, nothing is wrong. If not, create a DNS record for oneuptime.example.com that points at the external address of the load balancer or ingress people reach OneUptime through.",
      },
    ]);
  });

  describe("the certificate", () => {
    const certificateFinding = async (tlsScene) => {
      const result = await runSandboxed(scene({ tls: tlsScene }));

      return findingsOf(result.lines).find((entry) => {
        return entry.title === "HTTPS";
      });
    };

    test("expired is something to fix, with when", async () => {
      const found = await certificateFinding({
        authorized: true,
        certificate: certificate({ daysLeft: -3 }),
      });

      expect(found.level).toBe("fix");
      expect(found.sentence).toBe(
        `The certificate oneuptime.example.com presents expired on ${day(-3)}, so browsers refuse it.`,
      );
      expect(found.fix).toContain("kubectl describe certificate -A");
      expect(found.fix).toContain("CoreSSL");
    });

    test("ingress-nginx's fake certificate, for another name, is something to fix, naming what it is for and who issued it", async () => {
      const found = await certificateFinding({
        authorized: false,
        reason: "DEPTH_ZERO_SELF_SIGNED_CERT",
        certificate: {
          subject: {
            O: "Acme Co",
            CN: "Kubernetes Ingress Controller Fake Certificate",
          },
          issuer: {
            O: "Acme Co",
            CN: "Kubernetes Ingress Controller Fake Certificate",
          },
          subjectaltname: "DNS:ingress.local",
          valid_to: new Date(Date.now() + 300 * DAY).toUTCString(),
        },
      });

      expect(found.level).toBe("fix");
      expect(found.sentence).toBe(
        "The certificate oneuptime.example.com presents is not for it: it is for ingress.local, from Acme Co, so browsers refuse it.",
      );
      expect(found.fix).toContain(
        "Have a certificate issued for oneuptime.example.com",
      );
    });

    test.each([
      ["DEPTH_ZERO_SELF_SIGNED_CERT", "it is self-signed"],
      [
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        "its issuer is not one browsers know, or the chain is incomplete",
      ],
      ["SOMETHING_NEW", "SOMETHING_NEW"],
    ])(
      "not trusted (%s) is something to fix, in words, unless a certificate authority of the operator's own is trusted",
      async (reason, words) => {
        const found = await certificateFinding({
          authorized: false,
          reason: reason,
          certificate: certificate({ issuer: "Acme Internal CA" }),
        });

        expect(found.level).toBe("fix");
        expect(found.sentence).toBe(
          `Browsers do not trust the certificate oneuptime.example.com presents: ${words} (from Acme Internal CA).`,
        );
        expect(found.fix).toContain(
          "If it comes from a certificate authority of your own, nothing is wrong for computers that trust it.",
        );
      },
    );

    test("expiring within two weeks and not yet renewed is worth a look", async () => {
      const found = await certificateFinding({
        authorized: true,
        certificate: certificate({ daysLeft: 5 }),
      });

      expect(found.level).toBe("warn");
      expect(found.sentence).toBe(
        `The certificate for oneuptime.example.com expires on ${day(5)}, in 5 days, and has not been renewed yet.`,
      );
    });

    test("a certificate for many names names three, and how many more", async () => {
      const found = await certificateFinding({
        authorized: true,
        certificate: certificate({
          altNames:
            "DNS:oneuptime.example.com, DNS:a.example.com, DNS:b.example.com, DNS:c.example.com, DNS:d.example.com",
        }),
      });

      expect(found.sentence).toContain(
        "covers oneuptime.example.com, a.example.com, b.example.com and 2 more",
      );
    });

    test.each([
      ["ECONNREFUSED", "connection refused"],
      ["ETIMEDOUT", "no answer in time"],
    ])(
      "no HTTPS answer from inside the cluster (%s) is worth a look: a cluster may not reach its own load balancer",
      async (error, words) => {
        const found = await certificateFinding({ error: error });

        expect(found.level).toBe("warn");
        expect(found.sentence).toBe(
          `From inside the cluster, oneuptime.example.com does not answer over HTTPS on port 443 (${words}).`,
        );
        expect(found.fix).toContain(
          "some clusters cannot reach their own load balancer",
        );
      },
    );

    test("over plain HTTP no certificate is asked for: Server Setup already says HTTPS is not set up", async () => {
      const result = await runSandboxed(
        scene({
          env: { HOST: "oneuptime.example.com", HTTP_PROTOCOL: "http" },
          reach: {
            status: 200,
            json: {
              proof: PROOF,
              request: { host: "oneuptime.example.com", isHttps: false },
            },
          },
        }),
      );

      expect(result.connections).toEqual([]);
      expect(result.requests[0].url).toBe(
        `http://oneuptime.example.com/status-page-api/custom-domain-readiness/${PROOF}`,
      );
      expect(
        findingsOf(result.lines).map((entry) => {
          return `${entry.level} ${entry.title}`;
        }),
      ).toEqual(["ok Address", "ok Address"]);
    });
  });

  describe("whether it reaches this OneUptime", () => {
    const reachFindings = async (data) => {
      const result = await runSandboxed(scene(data));

      return findingsOf(result.lines).filter((entry) => {
        return (
          entry.title === "Address" && !entry.sentence.includes("resolves")
        );
      });
    };

    test("without a proof it is not asked, and says why", async () => {
      const result = await runSandboxed(scene({ proof: "" }));

      expect(result.requests).toEqual([]);
      expect(findingsOf(result.lines).pop()).toEqual({
        level: "info",
        title: "Address",
        sentence:
          "Whether https://oneuptime.example.com reaches this OneUptime was not checked: OneUptime did not answer its own checks above.",
        fix: "",
      });
    });

    test("an argument that is no proof is not sent anywhere", async () => {
      const result = await runSandboxed(scene({ proof: "../../etc/passwd" }));

      expect(result.requests).toEqual([]);
    });

    test("another answer is something to fix: another server or a default backend answers there", async () => {
      expect(
        await reachFindings({ reach: { status: 404, json: undefined } }),
      ).toEqual([
        {
          level: "fix",
          title: "Address",
          sentence:
            "https://oneuptime.example.com answers (HTTP 404), but not as this OneUptime, so people who open it do not reach this installation.",
          fix: "Point oneuptime.example.com at the external address of the load balancer or ingress people reach this OneUptime through, and check that it passes every request for oneuptime.example.com on to OneUptime.",
        },
      ]);
    });

    test.each([
      ["ECONNREFUSED", "connection refused"],
      ["ETIMEDOUT", "no answer in time"],
    ])("no answer (%s) is worth a look, in words", async (error, words) => {
      const found = await reachFindings({ reach: { error: error } });

      expect(found).toEqual([
        expect.objectContaining({
          level: "warn",
          sentence: `From inside the cluster, https://oneuptime.example.com could not be opened (${words}).`,
        }),
      ]);
    });

    test("an ingress that rewrites the host name is something to fix", async () => {
      const found = await reachFindings({
        reach: {
          status: 200,
          json: {
            proof: PROOF,
            request: { host: "oneuptime-nginx.oneuptime.svc", isHttps: true },
          },
        },
      });

      expect(found.map((entry) => entry.level)).toEqual(["ok", "fix"]);
      expect(found[1].sentence).toBe(
        "The ingress or load balancer in front of OneUptime changes the host name: a request to https://oneuptime.example.com reached OneUptime as oneuptime-nginx.oneuptime.svc, so people who open https://oneuptime.example.com are told OneUptime is not set up for that address, and signing in fails.",
      );
      expect(found[1].fix).toContain("upstream-vhost");
    });

    test("an ingress that sends localhost is worth a look: the dashboard opens, custom domains cannot", async () => {
      const found = await reachFindings({
        reach: {
          status: 200,
          json: {
            proof: PROOF,
            request: { host: "localhost", isHttps: true },
          },
        },
      });

      expect(found.map((entry) => entry.level)).toEqual(["ok", "warn"]);
      expect(found[1].sentence).toContain("The dashboard still opens");
    });

    test("an ingress that ends TLS and drops X-Forwarded-Proto is worth a look, with the ingress-nginx setting", async () => {
      const found = await reachFindings({
        reach: {
          status: 200,
          json: {
            proof: PROOF,
            request: { host: "oneuptime.example.com", isHttps: false },
          },
        },
      });

      expect(found.map((entry) => entry.level)).toEqual(["ok", "warn"]);
      expect(found[1].sentence).toContain("drops X-Forwarded-Proto");
      expect(found[1].fix).toContain("use-forwarded-headers");
    });

    test("an older server, which does not say how the request arrived, is only reached", async () => {
      const found = await reachFindings({
        reach: { status: 200, json: { proof: PROOF } },
      });

      expect(found.map((entry) => entry.level)).toEqual(["ok"]);
    });
  });
});

/*
 * The same script with this machine's node, against real servers standing
 * in for the address. A preloaded module answers the made-up name with
 * 127.0.0.1, as the cluster's DNS would answer the real one.
 */
describe("the address check, against real servers", () => {
  let directory;
  let preload;

  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "diagnose-address-"));
    preload = path.join(directory, "resolve-oneuptime-test.js");
    fs.writeFileSync(
      preload,
      [
        'const dns = require("dns");',
        "const lookup = dns.lookup;",
        "dns.lookup = (name, options, callback) => {",
        '  if (typeof options === "function") { callback = options; options = {}; }',
        '  if (name === "oneuptime.test") {',
        '    if (options && options.all) { return callback(null, [{ address: "127.0.0.1", family: 4 }]); }',
        '    return callback(null, "127.0.0.1", 4);',
        "  }",
        "  return lookup(name, options, callback);",
        "};",
      ].join("\n"),
    );
  });

  afterAll(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const runNode = (env, proof) => {
    return new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        ["-r", preload, "-e", addressScript(), proof],
        { env: Object.assign({ PATH: process.env.PATH }, env) },
      );
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.on("close", () => {
        resolve(stdout.trim().split("\n"));
      });
    });
  };

  // A server that answers the proof as the app does, with how the request arrived.
  const answerAsTheApp = (seen, isHttps) => {
    return (req, res) => {
      seen.push({
        method: req.method,
        url: req.url,
        host: req.headers.host,
        headerNames: Object.keys(req.headers).sort(),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          proof: req.url.split("/").pop(),
          request: {
            host: String(req.headers.host || "").split(":")[0],
            isHttps: isHttps,
          },
        }),
      );
    };
  };

  test("over HTTP: it resolves the name, reaches the server with one GET for the proof that carries no key, and reads how it arrived", async () => {
    const seen = [];
    const server = http.createServer(answerAsTheApp(seen, false));

    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const host = `oneuptime.test:${server.address().port}`;
      const lines = await runNode({ HOST: host, HTTP_PROTOCOL: "http" }, PROOF);

      expect(lines).toEqual([
        `HOST|${host}|http`,
        "ok|Address|oneuptime.test resolves to 127.0.0.1 inside the cluster.|",
        `ok|Address|From inside the cluster, http://${host} reaches this OneUptime.|`,
      ]);
      expect(seen).toEqual([
        {
          method: "GET",
          url: `/status-page-api/custom-domain-readiness/${PROOF}`,
          host: host,
          headerNames: ["connection", "host"],
        },
      ]);
    } finally {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
  });

  const openssl = spawnSync("openssl", ["version"]);
  const testWithOpenssl =
    openssl.status === 0 && !openssl.error ? test : test.skip;

  testWithOpenssl(
    "over HTTPS: it reads the certificate the server presents, says who issued it and until when when it is trusted, and that browsers do not trust it when it is self-signed",
    async () => {
      const key = path.join(directory, "key.pem");
      const cert = path.join(directory, "cert.pem");
      const made = spawnSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          key,
          "-out",
          cert,
          "-days",
          "90",
          "-subj",
          "/O=Acme Test CA/CN=oneuptime.test",
          "-addext",
          "subjectAltName=DNS:oneuptime.test",
        ],
        { encoding: "utf8" },
      );

      expect(made.status).toBe(0);

      const seen = [];
      const server = https.createServer(
        { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
        answerAsTheApp(seen, true),
      );

      await new Promise((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      try {
        const host = `oneuptime.test:${server.address().port}`;
        const untrusted = await runNode(
          { HOST: host, HTTP_PROTOCOL: "https" },
          PROOF,
        );

        expect(untrusted[0]).toBe(`HOST|${host}|https`);
        expect(untrusted).toContain(
          "fix|HTTPS|Browsers do not trust the certificate oneuptime.test presents: it is self-signed (from Acme Test CA).|If it comes from a certificate authority of your own, nothing is wrong for computers that trust it. Otherwise: With cert-manager, kubectl describe certificate -A shows why it was not issued or renewed. With ssl.provision, the worker and app pod logs say why: look for CoreSSL.",
        );
        // The certificate is no reason not to see whether it reaches this OneUptime.
        expect(untrusted).toContain(
          `ok|Address|From inside the cluster, https://${host} reaches this OneUptime.|`,
        );

        // Trusted, as a cluster that trusts its own certificate authority would.
        const trusted = await runNode(
          {
            HOST: host,
            HTTP_PROTOCOL: "https",
            NODE_EXTRA_CA_CERTS: cert,
          },
          PROOF,
        );
        const line = trusted.find((entry) => {
          return entry.startsWith("ok|HTTPS|");
        });

        expect(line).toMatch(
          /^ok\|HTTPS\|The certificate for oneuptime\.test, from Acme Test CA, covers oneuptime\.test and is valid until \d{4}-\d{2}-\d{2}\.\|$/,
        );
        expect(seen.length).toBe(2);
        expect(
          seen.every((request) => {
            return request.method === "GET";
          }),
        ).toBe(true);
      } finally {
        await new Promise((resolve) => {
          server.close(resolve);
        });
      }
    },
  );
});

/*
 * Sources diagnose.sh's functions (DIAGNOSE_SOURCE_ONLY=1), with a fake
 * first_ready_pod and kc_exec that prints the given pod script output, and
 * a fake curl that answers as told (or no curl at all), then runs
 * check_external_address and prints the findings it added.
 */
const hasBash = spawnSync("bash", ["--version"]).status === 0;
const describeWithBash = hasBash ? describe : describe.skip;

// The tools the sourced script runs, linked into a folder of their own.
const TOOLS = [
  "bash",
  "date",
  "tee",
  "sed",
  "grep",
  "head",
  "tail",
  "cut",
  "cat",
];

const runShell = (data) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "diagnose-shell-"));
  const bin = path.join(directory, "bin");
  fs.mkdirSync(bin);

  for (const tool of TOOLS) {
    const found = spawnSync("bash", ["-c", `command -v ${tool}`], {
      encoding: "utf8",
    }).stdout.trim();

    fs.symlinkSync(found, path.join(bin, tool));
  }

  if (data.curl) {
    fs.writeFileSync(
      path.join(bin, "curl"),
      [
        "#!/bin/bash",
        `printf '%s\\n' "$@" > "${directory}/curl-args.txt"`,
        data.curl.stderr
          ? `printf '%s\\n' ${JSON.stringify(data.curl.stderr)} >&2`
          : "",
        `printf 'HTTP_CODE=%s' ${JSON.stringify(data.curl.code || "000")}`,
        `exit ${data.curl.exit || 0}`,
      ].join("\n"),
      { mode: 0o755 },
    );
  }

  const outputFile = path.join(directory, "exec-output.txt");
  fs.writeFileSync(outputFile, data.podOutput);

  try {
    const script = [
      `DIAGNOSE_SOURCE_ONLY=1 source "${DIAGNOSE}" --no-color --output /dev/null`,
      "NAMESPACE=oneuptime",
      "RELEASE=oneuptime",
      `SERVER_ADDRESS_PROOF="${data.proof === undefined ? PROOF : data.proof}"`,
      `first_ready_pod() { printf '%s' "${data.pod === undefined ? "oneuptime-app-abc" : data.pod}"; }`,
      `kc_exec() { printf '%s\\n' "$@" > "${directory}/exec-args.txt"; cat "${outputFile}"; }`,
      "check_external_address",
      'for f in "${FINDINGS[@]}"; do echo "FINDING $f"; done',
    ].join("\n");
    const result = spawnSync(path.join(bin, "bash"), ["-c", script], {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: bin, HOME: directory },
    });
    const readIf = (name) => {
      const file = path.join(directory, name);
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    };

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      execArgs: readIf("exec-args.txt"),
      curlArgs: readIf("curl-args.txt"),
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const shellFindingsOf = (stdout) => {
  return stdout
    .split("\n")
    .filter((line) => {
      return line.startsWith("FINDING ");
    })
    .map((line) => {
      return line.slice("FINDING ".length);
    });
};

const HEALTHY_POD_OUTPUT = [
  "HOST|oneuptime.example.com|https",
  "ok|Address|oneuptime.example.com resolves to 203.0.113.10 inside the cluster.|",
  `ok|HTTPS|The certificate for oneuptime.example.com, from Let's Encrypt, covers oneuptime.example.com and is valid until ${day(60)}.|`,
  "ok|Address|From inside the cluster, https://oneuptime.example.com reaches this OneUptime.|",
].join("\n");

describeWithBash(
  "diagnose.sh reads the address check, and asks from this computer",
  () => {
    test("runs the script in the app pod with node and the proof, and prints each passing line", () => {
      const result = runShell({
        podOutput: HEALTHY_POD_OUTPUT,
        curl: { code: "200" },
      });

      expect(result.execArgs.split("\n").slice(0, 3)).toEqual([
        "oneuptime-app-abc",
        "node",
        "-e",
      ]);
      expect(result.execArgs.trim().split("\n").pop()).toBe(PROOF);
      expect(result.stdout).toContain(
        "OK    oneuptime.example.com resolves to 203.0.113.10 inside the cluster.",
      );
      expect(result.stdout).toContain(
        "OK    From this computer, https://oneuptime.example.com reaches this OneUptime.",
      );
      expect(shellFindingsOf(result.stdout)).toEqual([]);
    });

    test("asks from this computer with curl, with short timeouts, for the proof, and with no key", () => {
      const result = runShell({
        podOutput: HEALTHY_POD_OUTPUT,
        curl: { code: "200" },
      });

      expect(result.curlArgs.trim().split("\n")).toEqual([
        "-sS",
        "-o",
        "/dev/null",
        "--connect-timeout",
        "5",
        "--max-time",
        "10",
        "-w",
        "HTTP_CODE=%{http_code}",
        `https://oneuptime.example.com/status-page-api/custom-domain-readiness/${PROOF}`,
      ]);
    });

    test("the pod's findings are findings: fix is critical and warn a warning, each with its fix", () => {
      const result = runShell({
        podOutput: [
          "HOST|oneuptime.example.com|https",
          "fix|HTTPS|The certificate oneuptime.example.com presents expired on 2026-11-01, so browsers refuse it.|Renew it.",
          "warn|Address|The ingress drops X-Forwarded-Proto.|Have it send X-Forwarded-Proto: https.",
          "info|Address|Something worth knowing.|",
        ].join("\n"),
        curl: { code: "200" },
      });

      expect(shellFindingsOf(result.stdout)).toEqual([
        "CRIT|HTTPS|The certificate oneuptime.example.com presents expired on 2026-11-01, so browsers refuse it.|Renew it.",
        "WARN|Address|The ingress drops X-Forwarded-Proto.|Have it send X-Forwarded-Proto: https.",
      ]);
      expect(result.stdout).toContain(
        "CRIT  The certificate oneuptime.example.com presents expired",
      );
      expect(result.stdout).toContain("info  Something worth knowing.");
    });

    test("a certificate this computer refuses is critical, with curl's own words", () => {
      const result = runShell({
        podOutput: HEALTHY_POD_OUTPUT,
        curl: {
          exit: 60,
          stderr: "curl: (60) SSL certificate problem: certificate has expired",
        },
      });

      expect(shellFindingsOf(result.stdout)).toEqual([
        "CRIT|HTTPS|From this computer, the certificate of https://oneuptime.example.com is refused (SSL certificate problem: certificate has expired), so browsers here warn about it.|With cert-manager, kubectl describe certificate -A shows why it was not issued or renewed. With ssl.provision, the worker and app pod logs say why: look for CoreSSL.",
      ]);
    });

    test("another answer from this computer is critical: another server answers there", () => {
      const result = runShell({
        podOutput: HEALTHY_POD_OUTPUT,
        curl: { code: "404" },
      });

      expect(shellFindingsOf(result.stdout)).toEqual([
        expect.stringMatching(
          /^CRIT\|Address\|From this computer, https:\/\/oneuptime\.example\.com answers \(HTTP 404\), but not as this OneUptime/,
        ),
      ]);
    });

    test.each([
      [
        6,
        "curl: (6) Could not resolve host: oneuptime.example.com",
        "From this computer, oneuptime.example.com does not resolve.",
      ],
      [
        7,
        "curl: (7) Failed to connect to oneuptime.example.com port 443: Connection refused",
        "From this computer, nothing answers at https://oneuptime.example.com (Failed to connect to oneuptime.example.com port 443: Connection refused).",
      ],
      [
        28,
        "curl: (28) Connection timed out after 5001 milliseconds",
        "From this computer, https://oneuptime.example.com did not answer within 10 seconds.",
      ],
      [
        52,
        "curl: (52) Empty reply from server",
        "From this computer, https://oneuptime.example.com could not be opened (Empty reply from server).",
      ],
    ])(
      "curl exiting %i is a warning in plain words",
      (exit, stderr, sentence) => {
        const result = runShell({
          podOutput: HEALTHY_POD_OUTPUT,
          curl: { exit: exit, stderr: stderr },
        });

        const found = shellFindingsOf(result.stdout);

        expect(found.length).toBe(1);
        expect(found[0].startsWith(`WARN|Address|${sentence}|`)).toBe(true);
      },
    );

    test("without a proof, curl asks for the address itself and says only that it answers", () => {
      const result = runShell({
        podOutput: [
          "HOST|oneuptime.example.com|https",
          "info|Address|Whether https://oneuptime.example.com reaches this OneUptime was not checked: OneUptime did not answer its own checks above.|",
        ].join("\n"),
        proof: "",
        curl: { code: "200" },
      });

      expect(result.curlArgs.trim().split("\n").pop()).toBe(
        "https://oneuptime.example.com/",
      );
      expect(result.stdout).toContain(
        "OK    From this computer, https://oneuptime.example.com answers (HTTP 200), with a certificate this computer trusts.",
      );
      expect(shellFindingsOf(result.stdout)).toEqual([]);
    });

    test("without curl, it says so and asks nothing from here", () => {
      const result = runShell({ podOutput: HEALTHY_POD_OUTPUT });

      expect(result.curlArgs).toBeNull();
      expect(result.stdout).toContain(
        "info  curl is not installed on this computer, so https://oneuptime.example.com was not opened from here.",
      );
      expect(shellFindingsOf(result.stdout)).toEqual([]);
    });

    test.each([
      [
        "no address to check (host is localhost)",
        "warn|Address|host in your Helm values is localhost: the links OneUptime sends lead nowhere.|Set host.",
      ],
      [
        "a host that is no host name",
        "HOST|-o /tmp/x https://evil.example.com|https",
      ],
      [
        "a protocol that is neither http nor https",
        "HOST|oneuptime.example.com|file",
      ],
    ])("%s is never handed to curl", (_label, podOutput) => {
      const result = runShell({ podOutput: podOutput, curl: { code: "200" } });

      expect(result.curlArgs).toBeNull();
    });

    test("no app pod: nothing is asked, and it says why", () => {
      const result = runShell({
        podOutput: HEALTHY_POD_OUTPUT,
        pod: "",
        curl: { code: "200" },
      });

      expect(result.execArgs).toBeNull();
      expect(result.curlArgs).toBeNull();
      expect(result.stdout).toContain(
        "info  No running app pod, so the address people open was not checked.",
      );
    });

    test("the main run checks the address right after OneUptime's own checks, whose proof it uses", () => {
      const main = SOURCE.slice(SOURCE.lastIndexOf("\ndiscover\n"));

      expect(main.split("\n").slice(1, 5)).toEqual([
        "discover",
        "check_pod_health",
        "check_server_findings",
        "check_external_address",
      ]);
    });
  },
);
