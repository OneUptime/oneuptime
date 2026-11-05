const fs = require("fs");
const path = require("path");

/*
 * The rig's proof of the lifecycle check, held to what it says it proves: it runs the probe's own
 * code, it makes its project with the commands the guide tells a person to run, and it breaks what
 * issue #5749's "done when" says to break.
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const read = (...parts) => {
  return fs.readFileSync(path.join(REPO_ROOT, ...parts), "utf8");
};

const SCRIPT = read("Tests/Ops/openstack-e2e/checks-record.sh");
const ENTRY = read("Tests/Ops/openstack-e2e/checks-run.ts");
const READ = read("Tests/Ops/openstack-e2e/checks-read.py");
const WORKFLOW = read(".github/workflows/test.openstack-e2e.yaml");
const GUIDE = read("packages/App/FeatureSet/Docs/Content/en/telemetry/openstack.md");

function guideSection() {
  const start = GUIDE.indexOf("## Check the cloud from outside");
  const end = GUIDE.indexOf("\n## ", start + 1);

  return GUIDE.slice(start, end);
}

// Each `openstack ...` line of the guide's code blocks, joined across its continuations.
function guideCommands() {
  const commands = [];
  const blocks = guideSection().split("```bash\n").slice(1);

  for (const block of blocks) {
    const text = block.slice(0, block.indexOf("```")).replace(/\\\n\s*/g, "");

    for (const line of text.split("\n")) {
      if (line.startsWith("openstack ")) {
        commands.push(line);
      }
    }
  }

  return commands;
}

describe("the rig's proof of the lifecycle check", () => {
  test("runs the probe's own code, not a copy of it", () => {
    expect(ENTRY).toContain(
      'from "../../../packages/Probe/Utils/OpenStack/Checks/OpenStackLifecycleCheck"',
    );
    expect(ENTRY).toContain(
      'from "../../../packages/Probe/Utils/OpenStack/Checks/OpenStackApiCheck"',
    );
    expect(ENTRY).toContain("OpenStackLifecycleCheck.run(");
  });

  test("makes the check's project with the commands the guide gives a person", () => {
    const commands = guideCommands();

    expect(commands.length).toBeGreaterThanOrEqual(9);

    // What a person chooses or is prompted for differs, and what is run is otherwise the guide's.
    const flat = SCRIPT.replace(/\\\n\s*/g, "");

    for (const command of commands) {
      if (command.includes("--name")) {
        continue;
      }

      const asWritten = command
        .replace("oneuptime-checks", "$PROJECT")
        .replace(/--password-prompt oneuptime-check/, '--password "$PASSWORD" "$USER_NAME"')
        .replace("--user oneuptime-check", '--user "$USER_NAME"')
        .replace("oneuptime-checks", '"$PROJECT"');

      const normalized = (text) => {
        return text.replace(/"/g, "");
      };

      expect(normalized(flat)).toContain(normalized(asWritten));
    }
  });

  test.each([
    ["stops nova-scheduler", "systemctl stop devstack@n-sch"],
    ["starts it again", "systemctl start devstack@n-sch"],
    ["expects the right step", "Failed server_active"],
    ["kills a run for real", "kill -9"],
    ["holds what looks similar to being there", "lookalikes_are_all_there"],
    ["holds another project's to being there", "victims_are_all_there"],
    ["tries a credential scoped elsewhere", "refused-scoped-elsewhere"],
    ["tries an admin credential", "refused-admin"],
    ["tries an unrestricted credential", "refused-unrestricted"],
    ["reads what the credential can write", "matrix"],
    ["stops cinder-volume", "systemctl stop devstack@c-vol"],
  ])("%s", (_name, words) => {
    expect(SCRIPT).toContain(words);
  });

  test("no scene's failure stops the scenes after it, and any failure fails the job", () => {
    expect(SCRIPT).toContain("set -uo pipefail");
    expect(SCRIPT).not.toContain("set -euo pipefail");
    expect(SCRIPT).toContain("grep -q '^MISSED'");
  });

  test("the credential is scrubbed from what it records, and the job stays on the runner", () => {
    expect(ENTRY).toContain("<removed>");
    expect(SCRIPT).toContain('rm -rf "$SECRETS_DIR"');
    expect(SCRIPT).toContain('JOB="$SECRETS_DIR/job.json"');
  });

  test("every write it tries against another project has to be refused", () => {
    expect(READ).toContain('"wrote": 200 <= status < 300');
    expect(READ).toContain("if wrote or unasked:");

    for (const write of [
      "delete a server of another project",
      "delete a volume of another project",
      "delete a floating IP of another project",
      "create a project",
      "give itself a role on another project",
    ]) {
      expect(READ).toContain(write);
    }
  });

  test("runs on its own, with the real transport on one entry", () => {
    expect(WORKFLOW).toContain("checks_only:");
    expect(WORKFLOW).toContain("record-checks:");
    expect(WORKFLOW).toContain("bash Tests/Ops/openstack-e2e/checks-record.sh");
    expect(WORKFLOW).toContain('enabled_services: "tls-proxy"');
  });
});
