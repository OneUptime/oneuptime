const fs = require("fs");
const path = require("path");

/*
 * The rig run that records a test period and what's been left to waste (#5748). It takes a DevStack
 * and an hour to find out it doesn't do what it says, so what can be held here is held here: what it
 * records is what the importer copies, and every waste rule's command is one the run really runs.
 */

const ROOT = path.join(__dirname, "../..");
const SCRIPT = fs.readFileSync(
  path.join(__dirname, "openstack-e2e/usage-record.sh"),
  "utf8",
);
const IMPORTER = fs.readFileSync(
  path.join(__dirname, "openstack-e2e/import-usage-recording.py"),
  "utf8",
);
const WORKFLOW = fs.readFileSync(
  path.join(ROOT, ".github/workflows/test.openstack-e2e.yaml"),
  "utf8",
);
const RULES = fs.readFileSync(
  path.join(ROOT, "packages/Common/Types/OpenStack/OpenStackWaste.ts"),
  "utf8",
);

function scenesInScript() {
  return Array.from(SCRIPT.matchAll(/^reading (usage-[a-z-]+)$/gm)).map(
    (match) => {
      return match[1];
    },
  );
}

function scenesInImporter() {
  const block = IMPORTER.substring(
    IMPORTER.indexOf("SCENES = ("),
    IMPORTER.indexOf("EXPORTER_SERVICES"),
  );
  return Array.from(block.matchAll(/"(usage-[a-z-]+)"/g)).map((match) => {
    return match[1];
  });
}

describe("the rig's usage run", () => {
  test("records what the importer copies, in the order the test reads them", () => {
    expect(scenesInScript().length).toBe(6);
    expect(scenesInScript()).toEqual(scenesInImporter());
  });

  test("writes down when each reading was taken, which is the whole point of it", () => {
    expect(SCRIPT).toContain('>"$OUTPUT_DIR/$scene/recorded-at.txt"');
    expect(IMPORTER).toContain('"recorded-at.txt"');
  });

  test("runs every waste rule's own command, word for word", () => {
    const commands = Array.from(
      RULES.matchAll(/command:\s*"(openstack [^"]+)"/g),
    ).map((match) => {
      return match[1];
    });

    expect(commands.length).toBe(6);

    for (const command of commands) {
      expect(SCRIPT).toContain(command);
    }
  });

  test("leaves something in use beside what it leaves to waste", () => {
    for (const name of [
      "ou-image-unused",
      "ou-image-used",
      "ou-image-behind-volume",
      "ou-image-protected",
      "ou-vol-from-image",
      "ou-usage-on-image",
      "ou-use-quiet",
    ]) {
      expect(SCRIPT).toContain(name);
    }
  });

  test("really resizes and really deletes, between readings", () => {
    const resize = SCRIPT.indexOf("openstack server resize --flavor");
    const remove = SCRIPT.indexOf("openstack server delete ou-usage-deleted");

    expect(resize).toBeGreaterThan(
      SCRIPT.indexOf("reading usage-before-resize"),
    );
    expect(resize).toBeLessThan(SCRIPT.indexOf("reading usage-after-resize"));
    expect(remove).toBeGreaterThan(
      SCRIPT.indexOf("reading usage-before-delete"),
    );
    expect(remove).toBeLessThan(SCRIPT.indexOf("reading usage-after-delete"));
    expect(SCRIPT).toContain(
      "openstack server resize confirm ou-usage-resized",
    );
  });

  test("is asked for by name, runs on its own, and keeps its recording", () => {
    expect(WORKFLOW).toContain("usage_only:");
    expect(WORKFLOW).toContain("if: ${{ inputs.usage_only }}");
    expect(WORKFLOW).toContain("bash Tests/Ops/openstack-e2e/usage-record.sh");
    expect(WORKFLOW).toContain("name: openstack-usage-recording-hibiscus-ovn");

    // The two jobs that run unless told otherwise are told otherwise.
    const unless = WORKFLOW.split("\n").filter((line) => {
      return line.includes("if: ${{ !inputs.");
    });

    expect(unless.length).toBeGreaterThanOrEqual(2);

    for (const line of unless) {
      if (line.includes("!inputs.capacity_only")) {
        expect(line).toContain("!inputs.usage_only");
      }
    }
  });

  test("the importer takes every rule's listing, and copies what a probe would read", () => {
    for (const command of [
      "unattached-volume",
      "spare-floating-ip",
      "shut-off-instance",
      "unused-image",
      "old-snapshot",
      "movable-host",
      "movable-host-instances",
    ]) {
      expect(IMPORTER).toContain(`"${command}"`);
      expect(SCRIPT).toContain(`run_command ${command} `);
    }
    for (const call of ["nova-servers", "cinder-volumes", "glance-images"]) {
      expect(IMPORTER).toContain(`"${call}"`);
    }
  });
});
