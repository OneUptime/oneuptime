const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");
const root = cp
  .execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })
  .trim();
const out = __dirname;
const head = cp
  .execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
  .trim();
const source = (name) =>
  cp.execFileSync("git", ["show", `${head}:${name}`], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
const write = (name, body) => fs.writeFileSync(path.join(out, name), body);
let app = source("packages/App/Dockerfile.tpl");
const marker = '{{ if eq .Env.ENVIRONMENT "development" }}';
const start = app.indexOf(marker),
  mid = app.indexOf("{{ else }}", start),
  end = app.indexOf("{{ end }}", mid);
if (start < 0 || mid < 0 || end < 0) throw Error("Unexpected App template");
app = app.slice(0, start) + app.slice(mid + 10, end) + app.slice(end + 9);
app = app.replace(
  "node:26-alpine3.24 AS base",
  "node:26-bookworm-slim AS base",
);
app = app.replace(
  /RUN apk upgrade --no-cache \\\n\s*&& apk add --no-cache bash curl \\\n\s*&& apk add --no-cache --virtual \.gyp python3 make g\+\+/,
  "RUN apt-get update && apt-get install -y --no-install-recommends bash curl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*",
);
app = app.replace(
  "RUN apk del .gyp",
  "RUN apt-get purge -y --auto-remove python3 make g++ && rm -rf /var/lib/apt/lists/*",
);
for (const [name, input] of [
  ["App", app],
  ["E2E", source("packages/E2E/Dockerfile.tpl")],
]) {
  const body = input
    .replaceAll("/tmp/", "/var/cache/oneuptime/")
    .replaceAll("RUN mkdir ", "RUN mkdir -p ");
  if (
    body.includes("{{") ||
    /^RUN apk/m.test(body) ||
    /^FROM .*alpine/m.test(body)
  )
    throw Error(`Unconverted ${name}`);
  write(`${name}.Dockerfile`, body);
}
let base = source("docker-compose.base.yml");
for (const name of [
  "Clickhouse/config.d/cluster.xml",
  "Clickhouse/users.d/distributed-insert-tuning.xml",
  "Clickhouse/config.d/system-log-ttl.xml",
]) {
  fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
  write(name, source(name));
  base = base.replaceAll(`./${name}`, path.join(out, name));
}
write("base.yml", base);
const secretsFile = path.join(out, "config.env");
if (!fs.existsSync(secretsFile)) {
  let env = source("config.example.env");
  const values = {
    HOST: "oneuptime.test:7849",
    APP_PORT: "3002",
    HTTP_PROTOCOL: "http",
    BILLING_ENABLED: "false",
    IS_ENTERPRISE_EDITION: "false",
    ENVIRONMENT: "production",
    COMPOSE_PROJECT_NAME: "oneuptime-discord-e2e",
    DATABASE_HOST: "postgres",
    DATABASE_PORT: "5432",
    DATABASE_NAME: "discord_e2e",
    VALKEY_HOST: "valkey",
    VALKEY_PORT: "6379",
    CLICKHOUSE_HOST: "clickhouse",
    CLICKHOUSE_DATABASE: "discord_e2e",
    DISABLE_TELEMETRY_FOR_APP: "true",
    ENABLE_PROFILING_FOR_APP: "false",
    OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT: "",
    OPENTELEMETRY_EXPORTER_OTLP_HEADERS: "",
  };
  for (const key of [
    "ONEUPTIME_SECRET",
    "REGISTER_PROBE_KEY",
    "DATABASE_PASSWORD",
    "CLICKHOUSE_PASSWORD",
    "VALKEY_PASSWORD",
    "ENCRYPTION_SECRET",
  ])
    values[key] = crypto.randomBytes(32).toString("hex");
  for (const [key, value] of Object.entries(values)) {
    const re = new RegExp("^" + key + "=.*$", "m");
    env = re.test(env)
      ? env.replace(re, key + "=" + value)
      : env + "\n" + key + "=" + value + "\n";
  }
  fs.writeFileSync(secretsFile, env, { mode: 0o600, flag: "wx" });
}
let environment = fs.readFileSync(secretsFile, "utf8");
for (const match of base.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) {
  if (!new RegExp("^" + match[1] + "=", "m").test(environment))
    environment += "\n" + match[1] + "=\n";
}
fs.writeFileSync(secretsFile, environment, { mode: 0o600 });
const archiveHash = cp
  .execFileSync(
    "bash",
    [
      "-o",
      "pipefail",
      "-c",
      'git archive "$1" | sha256sum',
      "archive-hash",
      head,
    ],
    { encoding: "utf8" },
  )
  .trim()
  .split(" ")[0];
write(
  "source.json",
  JSON.stringify(
    {
      head,
      archiveSha256: archiveHash,
      root,
      appVersion: JSON.parse(source("packages/App/package.json")).version,
      preparedAt: new Date().toISOString(),
      scope: "baseline infrastructure; no Discord behavior",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared immutable source ${head}; generated credentials are not printed.`,
);

fs.mkdirSync(path.join(out, "ingress"), { recursive: true });
for (const name of [
  "nginx.conf",
  "default.conf.template",
  "envsubst-on-templates.sh",
]) {
  let text = source("packages/Nginx/" + name);
  if (name === "nginx.conf")
    text = text
      .replace(/^load_module modules\/ngx_http_js_module.so;\n/m, "")
      .replace(/worker_processes\s+auto;/, "worker_processes 2;");
  write("ingress/" + name, text);
}
