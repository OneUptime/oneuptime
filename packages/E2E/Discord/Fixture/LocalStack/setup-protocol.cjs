const fs = require("fs"),
  cp = require("child_process"),
  crypto = require("crypto");
const root = process.cwd(),
  scratch = root + "/.scratch/discord-e2e";
const run = (args, input) =>
  cp.execFileSync("docker", args, {
    input,
    stdio: input ? ["pipe", "pipe", "inherit"] : ["ignore", "pipe", "inherit"],
  });
for (const volume of ["fixture-private", "fixture-trust"])
  run(["volume", "create", "oneuptime-discord-e2e_" + volume]);
run([
  "run",
  "--rm",
  "--network",
  "none",
  "-v",
  "oneuptime-discord-e2e_fixture-private:/fixture-private",
  "-v",
  "oneuptime-discord-e2e_fixture-trust:/fixture-trust",
  "-v",
  root + "/packages/E2E/Discord/Fixture:/fixture:ro",
  "--entrypoint",
  "bash",
  "oneuptime-discord-e2e-tests:local",
  "/fixture/prepare-certificates.sh",
]);
const pub = run([
  "run",
  "--rm",
  "--network",
  "none",
  "-v",
  "oneuptime-discord-e2e_fixture-private:/fixture-private:ro",
  "--entrypoint",
  "cat",
  "oneuptime-discord-e2e-tests:local",
  "/fixture-private/interaction-public.der",
])
  .subarray(-32)
  .toString("hex");
const p = scratch + "/config.env";
let env = fs.readFileSync(p, "utf8");
const values = {
  DISCORD_APP_CLIENT_ID: "100000000000000001",
  DISCORD_APP_PUBLIC_KEY: pub,
  DISCORD_APP_CLIENT_SECRET: crypto.randomBytes(32).toString("hex"),
  DISCORD_BOT_TOKEN: crypto.randomBytes(32).toString("hex"),
  DISCORD_FIXTURE_CONTROL_TOKEN: crypto.randomBytes(32).toString("hex"),
};
for (const [key, value] of Object.entries(values)) {
  env = env.replace(new RegExp("^" + key + "=.*\\n?", "gm"), "");
  env += "\n" + key + "=" + value + "\n";
}
fs.writeFileSync(p, env, { mode: 0o600 });
