/**
 * A form on its owner's own domain, at the ingress (FormDomain).
 *
 * A custom domain - a status page's, a dashboard's or a form's - lands in
 * the two default servers (7849 and 7850), which forward every path to the
 * App and leave nginx's 1M body limit on everything but their own raised
 * locations. A form's page on its domain sends its answers to
 * /api/form/custom-domain/submit, and since forms take files (#5436) a
 * submission carries them: up to 10 files and 20 MB together, about 27 MB of
 * JSON once they are base64. On the 1M default, every submission with a file
 * of more than about 700 KB got a bare nginx 413 on the form's domain, while
 * the same form took it at its link, where the primary ingress's /api allows
 * 50M.
 *
 * So both default servers raise that one path to the primary's /api limit,
 * and keep 1M everywhere else. The plain-HTTP server also answers the form
 * domain sweeps' CNAME check, /api/form/custom-domain/cname-verification/,
 * without the redirect to HTTPS that `location /` makes with billing on: a
 * domain is checked over plain HTTP before it has a certificate.
 *
 * Read twice: in the template, and in the server blocks the container really
 * generates from it - the real envsubst-on-templates.sh, run over the real
 * template, with billing on and with billing off (skipped without sh and
 * envsubst on PATH). The paths and the limits are read from the source of
 * Common and the App, so the test breaks when either side drifts.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const {
  NGINX_DIRECTORY,
  getDirectives,
  getLocationBlocks,
  getServerBlocks,
  readTemplate,
  resolveLocation,
  stripComments,
} = require("./NginxConfigParser");

const { describe } = test;

const MIB = 1024 * 1024;

const REPOSITORY_ROOT = path.resolve(NGINX_DIRECTORY, "..", "..");
const SCRIPT_PATH = path.join(NGINX_DIRECTORY, "envsubst-on-templates.sh");

const FORM_CUSTOM_DOMAIN_SOURCE = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Common",
  "Types",
  "Form",
  "FormCustomDomain.ts",
);

const FORM_FILE_ANSWER_SOURCE = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Common",
  "Types",
  "Form",
  "FormFileAnswer.ts",
);

const START_SERVER_SOURCE = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Common",
  "Server",
  "Utils",
  "StartServer.ts",
);

// What a location that sets nothing gets: nginx's compiled-in default.
const NGINX_DEFAULT_BODY_LIMIT_BYTES = 1 * MIB;

/*
 * Base64 writes 3 bytes as 4 characters, and a submission's JSON carries its
 * answers and the file names beside the files: a little room on top.
 */
const BASE64_GROWTH = 4 / 3;
const ROOM_FOR_ANSWERS_BYTES = 1 * MIB;

const FORWARDING_HEADERS = [
  "proxy_set_header Host $host;",
  "proxy_set_header X-Real-IP $remote_addr;",
  "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
  "proxy_set_header X-Forwarded-Proto $visitor_scheme;",
];

const BILLING_REDIRECT = "return 301 https://$host$request_uri;";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/*
 * A string constant of a TypeScript file, read from its source: the quoted
 * value after its declaration, on the same line or the next (prettier wraps
 * a long one).
 */
function readStringConstant(source, name) {
  const marker = `export const ${name}: string =`;
  const start = source.indexOf(marker);

  assert.ok(start !== -1, `${name} is no longer declared`);

  const valueStart = source.indexOf('"', start + marker.length);
  const between = source.slice(start + marker.length, valueStart);

  assert.equal(between.trim(), "", `${name} is no longer a string constant`);

  const valueEnd = source.indexOf('"', valueStart + 1);

  return source.slice(valueStart + 1, valueEnd);
}

/** "4M" -> bytes. nginx sizes are bytes, or k/m/g suffixed in either case. */
function parseNginxSize(size) {
  const match = /^(\d+)([kKmMgG]?)$/.exec(size);
  assert.ok(match, `unparseable nginx size ${size}`);
  const multiplier = { "": 1, k: 1024, m: MIB, g: 1024 * MIB }[
    match[2].toLowerCase()
  ];
  return Number(match[1]) * multiplier;
}

/** The body limit a location sets itself, or nginx's default without one. */
function bodyLimitOf(location) {
  const directives = getDirectives(location.body, "client_max_body_size");

  if (directives.length === 0) {
    return NGINX_DEFAULT_BODY_LIMIT_BYTES;
  }

  assert.equal(directives.length, 1, directives.join(" "));

  const match = /^client_max_body_size (\S+);$/.exec(directives[0]);
  assert.ok(match, directives[0]);

  return parseNginxSize(match[1]);
}

/** The block's directives, one per line, comments and indentation gone. */
function directivesOf(body) {
  return stripComments(body)
    .split("\n")
    .map((line) => {
      return line.trim().replace(/\s+/g, " ");
    })
    .filter(Boolean);
}

/** A label for assertion messages: the block's first listen directive. */
function serverLabel(serverBlock) {
  return getDirectives(serverBlock.body, "listen")[0] || "(no listen)";
}

/*
 * The servers of a config: the primary ingress, named "localhost ingress"
 * and HOST, and the two default servers every custom domain lands in - the
 * plain-HTTP one and the TLS one.
 */
function readServers(source) {
  const serverBlocks = getServerBlocks(source);

  const primary = serverBlocks.find((block) => {
    return getDirectives(block.body, "server_name").some((directive) => {
      return directive.startsWith("server_name localhost ingress");
    });
  });

  assert.ok(primary, "the primary ingress server block is gone");

  const defaults = serverBlocks.filter((block) => {
    return block !== primary;
  });

  assert.equal(defaults.length, 2, "expected two custom domain servers");

  const tls = defaults.find((block) => {
    return getDirectives(block.body, "listen").some((directive) => {
      return /7850 ssl/.test(directive);
    });
  });
  const plain = defaults.find((block) => {
    return block !== tls;
  });

  assert.ok(tls, "the TLS custom domain server is gone");
  assert.ok(plain, "the plain-HTTP custom domain server is gone");

  return { primary, plain, tls };
}

function isOnPath(binary, args = ["--version"]) {
  const probe = spawnSync(binary, args, { encoding: "utf8" });

  return !probe.error && probe.status === 0;
}

const scriptSkipReason =
  isOnPath("sh", ["-c", "exit 0"]) && isOnPath("envsubst")
    ? false
    : "sh or envsubst not on PATH";

/**
 * Run the real envsubst-on-templates.sh over the real template, the way the
 * container runs it, and return the config it generates.
 */
function generateConfig(environment) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-form-domain-"),
  );

  try {
    const templateDirectory = path.join(directory, "templates");
    const outputDirectory = path.join(directory, "out");

    fs.mkdirSync(templateDirectory);
    fs.mkdirSync(outputDirectory);
    fs.writeFileSync(
      path.join(templateDirectory, "default.conf.template"),
      readTemplate(),
    );

    const result = spawnSync("sh", [SCRIPT_PATH], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NGINX_ENVSUBST_TEMPLATE_DIR: templateDirectory,
        NGINX_ENVSUBST_OUTPUT_DIR: outputDirectory,
        APP_PORT: "3002",
        HOME_PORT: "1444",
        HOST: "oneuptime.example.com",
        NGINX_RESOLVER: "127.0.0.11",
        SERVER_APP_HOSTNAME: "app",
        SERVER_HOME_HOSTNAME: "home",
        NGINX_LISTEN_ADDRESS: "",
        NGINX_LISTEN_OPTIONS: "",
        NGINX_IPV6_SUPPORT_FILE: path.join(
          directory,
          "no-ipv6-support-file-absent",
        ),
        ...environment,
      },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    return fs.readFileSync(path.join(outputDirectory, "default.conf"), "utf8");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// What the source says
// ---------------------------------------------------------------------------

const formCustomDomainSource = fs.readFileSync(
  FORM_CUSTOM_DOMAIN_SOURCE,
  "utf8",
);

/*
 * The form API is mounted under /api, at /form (FormAPI, CrudApiEndpoint):
 * the paths the page calls on its domain are /api/form + the routes.
 */
const FORM_API_PATH = "/api/form";

const SUBMIT_PATH =
  FORM_API_PATH +
  readStringConstant(formCustomDomainSource, "FORM_CUSTOM_DOMAIN_SUBMIT_ROUTE");
const READ_PATH =
  FORM_API_PATH +
  readStringConstant(formCustomDomainSource, "FORM_CUSTOM_DOMAIN_ROUTE");
const CNAME_VERIFICATION_PATH =
  FORM_API_PATH +
  readStringConstant(
    formCustomDomainSource,
    "FORM_CUSTOM_DOMAIN_CNAME_VERIFICATION_ROUTE",
  );

// The largest a submission's files come to, together (FormFileAnswer.ts).
function readSubmissionFilesLimitBytes() {
  const source = fs.readFileSync(FORM_FILE_ANSWER_SOURCE, "utf8");
  const marker =
    "export const FORM_SUBMISSION_FILES_MAX_TOTAL_SIZE_IN_BYTES: number =";
  const start = source.indexOf(marker);

  assert.ok(
    start !== -1,
    "FORM_SUBMISSION_FILES_MAX_TOTAL_SIZE_IN_BYTES moved",
  );

  const end = source.indexOf(";", start);
  const expression = source.slice(start + marker.length, end).trim();

  assert.ok(
    /^\d+(\s*\*\s*\d+)*$/.test(expression),
    `unexpected expression ${expression}`,
  );

  return expression
    .split("*")
    .map((part) => {
      return Number(part.trim());
    })
    .reduce((product, factor) => {
      return product * factor;
    }, 1);
}

// The App's own JSON body limit (StartServer's jsonBodyParserOptions).
function readAppJsonBodyLimitBytes() {
  const source = fs.readFileSync(START_SERVER_SOURCE, "utf8");
  const start = source.indexOf("export const jsonBodyParserOptions");

  assert.ok(start !== -1, "jsonBodyParserOptions moved");

  const match = /limit:\s*"(\d+)mb"/.exec(source.slice(start, start + 400));

  assert.ok(match, "the App's JSON body limit is no longer N mb");

  return Number(match[1]) * MIB;
}

// ---------------------------------------------------------------------------
// The checks, run over the template and over generated configs
// ---------------------------------------------------------------------------

function checkConfig(source, label, { billingEnabled }) {
  const { primary, plain, tls } = readServers(source);

  const primaryApi = resolveLocation(
    getLocationBlocks(primary.body),
    SUBMIT_PATH,
  );

  assert.ok(primaryApi, `${label}: the primary ingress has no /api location`);

  const primaryApiLimit = bodyLimitOf(primaryApi);

  for (const server of [plain, tls]) {
    const locations = getLocationBlocks(server.body);
    const where = `${label}, ${serverLabel(server)}`;
    const rootLocation = locations.find((location) => {
      return location.spec === "/";
    });

    assert.ok(rootLocation, `${where}: location / is gone`);

    // The submission lands in its own location, raised like the primary's /api.
    const submit = resolveLocation(locations, SUBMIT_PATH);

    assert.ok(submit, `${where}: nothing answers ${SUBMIT_PATH}`);
    assert.equal(submit.spec, SUBMIT_PATH, where);
    assert.equal(bodyLimitOf(submit), primaryApiLimit, where);
    assert.equal(bodyLimitOf(submit), 50 * MIB, where);

    // It reaches the App with the request's own Host: the App finds the form by it.
    for (const header of FORWARDING_HEADERS) {
      assert.ok(
        getDirectives(submit.body, "proxy_set_header").includes(header),
        `${where}: ${SUBMIT_PATH} must send "${header}" like location /`,
      );
      assert.ok(
        getDirectives(rootLocation.body, "proxy_set_header").includes(header),
        `${where}: premise - location / sends "${header}"`,
      );
    }

    assert.ok(
      directivesOf(submit.body).some((directive) => {
        return directive.startsWith("proxy_pass ");
      }),
      `${where}: ${SUBMIT_PATH} must forward to the App`,
    );
    assert.deepEqual(getDirectives(submit.body, "rewrite"), [], where);

    // Reading the form is a GET with no body: it stays on location /.
    assert.equal(resolveLocation(locations, READ_PATH).spec, "/", where);

    // Every other path of a custom domain keeps nginx's 1M.
    for (const otherPath of [
      "/",
      READ_PATH,
      "/api/form/public/00000000-0000-4000-8000-000000000000/submit",
      "/api/form/custom-domain/cname-verification/token",
      "/status-page-api/subscribe/email",
      "/accounts/form/00000000-0000-4000-8000-000000000000",
    ]) {
      const location = resolveLocation(locations, otherPath);

      assert.notEqual(location.spec, SUBMIT_PATH, `${where}: ${otherPath}`);
      assert.equal(
        bodyLimitOf(location),
        NGINX_DEFAULT_BODY_LIMIT_BYTES,
        `${where}: ${otherPath} (location ${location.spec})`,
      );
    }
  }

  /*
   * Over plain HTTP the submission follows `location /`: on to HTTPS with
   * billing on (the form's page is served over HTTPS there), to the App
   * without.
   */
  const plainSubmit = resolveLocation(
    getLocationBlocks(plain.body),
    SUBMIT_PATH,
  );
  const plainRoot = getLocationBlocks(plain.body).find((location) => {
    return location.spec === "/";
  });

  assert.equal(
    getDirectives(plainSubmit.body, "return").includes(BILLING_REDIRECT),
    getDirectives(plainRoot.body, "return").includes(BILLING_REDIRECT),
    `${label}: the plain-HTTP submit location redirects exactly when location / does`,
  );

  /*
   * The CNAME check is answered over plain HTTP whatever billing says: no
   * redirect, no rewrite, straight to the App with the request's Host.
   */
  const verification = resolveLocation(
    getLocationBlocks(plain.body),
    `${CNAME_VERIFICATION_PATH}/00000000-0000-4000-8000-000000000000`,
  );

  assert.equal(verification.spec, `${CNAME_VERIFICATION_PATH}/`, label);
  assert.deepEqual(getDirectives(verification.body, "return"), [], label);
  assert.deepEqual(getDirectives(verification.body, "rewrite"), [], label);
  assert.ok(!/\bif\s*\(/.test(stripComments(verification.body)), label);

  for (const header of FORWARDING_HEADERS) {
    assert.ok(
      getDirectives(verification.body, "proxy_set_header").includes(header),
      `${label}: the CNAME check must send "${header}"`,
    );
  }

  if (billingEnabled !== undefined) {
    // In a generated config the billing switch is a literal true or false.
    const billingLine = directivesOf(plain.body).find((directive) => {
      return directive.startsWith("set $billing_enabled ");
    });

    assert.equal(
      billingLine,
      `set $billing_enabled ${billingEnabled ? "true" : "false"};`,
      label,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("a form on its own domain at the ingress", () => {
  test("the paths are the ones the form's page calls (Common's FormCustomDomain)", () => {
    assert.equal(SUBMIT_PATH, "/api/form/custom-domain/submit");
    assert.equal(READ_PATH, "/api/form/custom-domain");
    assert.equal(
      CNAME_VERIFICATION_PATH,
      "/api/form/custom-domain/cname-verification",
    );

    // Common's own API path constants are built the same way.
    for (const [constant, route] of [
      ["FORM_CUSTOM_DOMAIN_API_PATH", "FORM_CUSTOM_DOMAIN_ROUTE"],
      ["FORM_CUSTOM_DOMAIN_SUBMIT_API_PATH", "FORM_CUSTOM_DOMAIN_SUBMIT_ROUTE"],
      [
        "FORM_CUSTOM_DOMAIN_CNAME_VERIFICATION_API_PATH",
        "FORM_CUSTOM_DOMAIN_CNAME_VERIFICATION_ROUTE",
      ],
    ]) {
      const declaration = `export const ${constant}: string = \`${FORM_API_PATH}\${${route}}\`;`;

      assert.ok(
        formCustomDomainSource.includes(declaration),
        `${constant} is no longer ${FORM_API_PATH} + ${route}`,
      );
    }
  });

  test("the raised limit holds the largest submission a form takes, and the App's own limit holds it too", () => {
    const filesLimit = readSubmissionFilesLimitBytes();
    const largestSubmission =
      Math.ceil(filesLimit * BASE64_GROWTH) + ROOM_FOR_ANSWERS_BYTES;

    // 20 MB of files is about 27 MB of JSON.
    assert.equal(filesLimit, 20 * MIB);
    assert.ok(largestSubmission > 26 * MIB, String(largestSubmission));
    assert.ok(largestSubmission < 50 * MIB, String(largestSubmission));

    // What nginx lets through, the App reads: the limits agree.
    assert.equal(readAppJsonBodyLimitBytes(), 50 * MIB);
    assert.ok(largestSubmission <= readAppJsonBodyLimitBytes());

    // And it was a real gap: 1M holds no file of a megabyte.
    assert.ok(largestSubmission > NGINX_DEFAULT_BODY_LIMIT_BYTES);
  });

  test("the template raises the submission on both custom domain servers, and nothing else", () => {
    checkConfig(readTemplate(), "template", { billingEnabled: undefined });
  });

  for (const billing of [true, false]) {
    test(
      `the generated server blocks raise it the same way with billing ${billing ? "on" : "off"}`,
      { skip: scriptSkipReason },
      () => {
        const generated = generateConfig({
          BILLING_ENABLED: billing ? "true" : "false",
        });

        // The placeholders are gone: this is the config nginx loads.
        assert.ok(!generated.includes("${BACKEND_APP_TARGET}"));
        assert.ok(!generated.includes("${NGINX_RESOLVER}"));

        checkConfig(generated, `billing ${billing ? "on" : "off"}`, {
          billingEnabled: billing,
        });
      },
    );
  }

  test("the primary ingress keeps sending the form's link to /api, with its 50M", () => {
    const { primary } = readServers(readTemplate());
    const linkSubmit = resolveLocation(
      getLocationBlocks(primary.body),
      "/api/form/public/00000000-0000-4000-8000-000000000000/submit",
    );

    assert.equal(linkSubmit.spec, "/api");
    assert.equal(bodyLimitOf(linkSubmit), 50 * MIB);
  });
});
