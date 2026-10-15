import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ADD_PROBE_DIALOG_DESCRIPTION,
  ADD_PROBE_NAME_DESCRIPTION,
  ADD_PROBE_NAME_PLACEHOLDER,
  DEFAULT_PROBE_NAME,
  PROBE_DOCS_PATH,
  RUN_PROBE_CONNECTED,
  RUN_PROBE_INSTRUCTIONS,
  RUN_PROBE_INSTRUCTIONS_WITHOUT_KEY,
  RUN_PROBE_KEY_HIDDEN,
  RUN_PROBE_OTHER_WAYS,
  RUN_PROBE_WAITING,
  RUN_PROBE_WAITING_WITHOUT_KEY,
  getDefaultProbeName,
} from "../../FeatureSet/Dashboard/src/Components/Network/AddProbeCopy";
import {
  PROBE_DOCKER_IMAGE,
  getProbeDockerRunCommand,
} from "../../FeatureSet/Dashboard/src/Components/Probe/ProbeRunCommand";

/*
 * The Network area's "Add a probe" dialog (Components/Network/AddProbeModal):
 * the name it suggests, the command its second step prints, and the words
 * it says them with. The dialog itself is rendered in
 * Common/Tests/App/Dashboard/NetworkAddProbeDialog.test.tsx.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DOCS_EN: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);

function readDashboard(...parts: Array<string>): string {
  return fs.readFileSync(
    path.join(APP_ROOT, "FeatureSet", "Dashboard", "src", ...parts),
    "utf8",
  );
}

const EN: Record<string, unknown> = JSON.parse(
  readDashboard("Locales", "en.json"),
) as Record<string, unknown>;

describe("the name a first probe starts with", () => {
  test("is a name that says what it is, while the project has none", () => {
    expect(getDefaultProbeName([])).toBe("Network probe");
  });

  test("is numbered past the names the project already has", () => {
    expect(getDefaultProbeName(["Network probe"])).toBe("Network probe 2");
    expect(getDefaultProbeName(["Network probe", "Network probe 2"])).toBe(
      "Network probe 3",
    );
  });

  test("compares names the way the server does: without case or spaces around them", () => {
    expect(getDefaultProbeName(["  network PROBE "])).toBe("Network probe 2");
  });

  test("other probes' names change nothing", () => {
    expect(getDefaultProbeName(["London office probe", ""])).toBe(
      "Network probe",
    );
  });

  test("is a translation key, so it is suggested in the reader's language", () => {
    expect(EN[DEFAULT_PROBE_NAME]).toBe(DEFAULT_PROBE_NAME);
    const modal: string = readDashboard(
      "Components",
      "Network",
      "AddProbeCopy.ts",
    );
    expect(modal).toContain(
      "name: translateText(DEFAULT_PROBE_NAME) || DEFAULT_PROBE_NAME,",
    );
  });
});

describe("the command the run step prints", () => {
  const command: string = getProbeDockerRunCommand({
    probeId: "c5d2e7d0-7f7b-4b6e-9a1e-2d1e8d6d9b10",
    probeKey: "c0ffee00-1111-4222-8333-444455556666",
    oneUptimeUrl: "https://oneuptime.example.com",
  });

  test("names the probe, its key and the server, one option per line", () => {
    expect(command.split("\n")).toEqual([
      "docker run --name oneuptime-probe --network host \\",
      "  -e PROBE_KEY=c0ffee00-1111-4222-8333-444455556666 \\",
      "  -e PROBE_ID=c5d2e7d0-7f7b-4b6e-9a1e-2d1e8d6d9b10 \\",
      "  -e ONEUPTIME_URL=https://oneuptime.example.com \\",
      "  -d oneuptime/probe:release",
    ]);
  });

  /*
   * The probe pings and walks devices on the machine's own network and takes
   * the traps, syslog and flows those devices send to the machine's address:
   * on Docker's bridge network it would receive none of them.
   */
  test("runs on the host's network", () => {
    expect(command).toContain("--network host");
  });

  test("every line but the last continues onto the next", () => {
    const lines: Array<string> = command.split("\n");

    for (const line of lines.slice(0, -1)) {
      expect(line.endsWith(" \\")).toBe(true);
    }

    expect(lines[lines.length - 1]!.endsWith("\\")).toBe(false);
  });

  /*
   * The docs page the dialog links to for every other way of running a
   * probe shows this command first: the two must not drift.
   */
  test("is the docs' Docker command, with the placeholders filled in", () => {
    const docs: string = fs.readFileSync(
      path.join(DOCS_EN, "probe", "custom-probe.md"),
      "utf8",
    );
    const documented: string = getProbeDockerRunCommand({
      probeId: "<probe-id>",
      probeKey: "<probe-key>",
      oneUptimeUrl: "https://oneuptime.com",
    });

    expect(docs).toContain("```bash\n" + documented + "\n```");
    expect(docs).toContain(`image: ${PROBE_DOCKER_IMAGE}`);
  });
});

describe("where the dialog sends people for every other way to run a probe", () => {
  const docsPage: string = path.join(DOCS_EN, `${PROBE_DOCS_PATH}.md`);

  test("is a docs page that exists", () => {
    expect(PROBE_DOCS_PATH).toBe("/probe/custom-probe");
    expect(fs.existsSync(docsPage)).toBe(true);
  });

  test("covers what the link promises: Docker Compose, Kubernetes and a proxy", () => {
    const docs: string = fs.readFileSync(docsPage, "utf8");

    expect(RUN_PROBE_OTHER_WAYS).toContain("Docker Compose");
    expect(RUN_PROBE_OTHER_WAYS).toContain("Kubernetes");
    expect(RUN_PROBE_OTHER_WAYS).toContain("proxy");
    expect(docs).toContain("@tab Docker Compose");
    expect(docs).toMatch(/Kubernetes/);
    expect(docs).toContain("HTTP_PROXY_URL");
  });
});

describe("the dialog's words", () => {
  test.each([
    ADD_PROBE_DIALOG_DESCRIPTION,
    ADD_PROBE_NAME_DESCRIPTION,
    ADD_PROBE_NAME_PLACEHOLDER,
    RUN_PROBE_INSTRUCTIONS,
    RUN_PROBE_INSTRUCTIONS_WITHOUT_KEY,
    RUN_PROBE_KEY_HIDDEN,
    RUN_PROBE_OTHER_WAYS,
    RUN_PROBE_WAITING,
    RUN_PROBE_WAITING_WITHOUT_KEY,
    RUN_PROBE_CONNECTED,
  ])("%s is a Dashboard translation key", (text: string) => {
    expect(EN[text]).toBe(text);
  });

  test("the run step and its status name the probe", () => {
    expect(RUN_PROBE_INSTRUCTIONS).toContain("{{name}}");
    expect(RUN_PROBE_INSTRUCTIONS_WITHOUT_KEY).toContain("{{name}}");
    expect(RUN_PROBE_WAITING).toContain("{{name}}");
    expect(RUN_PROBE_WAITING_WITHOUT_KEY).toContain("{{name}}");
    expect(RUN_PROBE_CONNECTED).toContain("{{name}}");
    expect(RUN_PROBE_KEY_HIDDEN).toContain("{{name}}");
  });

  /*
   * Someone with no command in front of them - a role that may not read the
   * key, or a key that could not be read - is told where the probe has to
   * run, for whoever runs it, and is never asked to run "this" or "the
   * command": the step used to say both over a note that there is none.
   */
  test("with no command to show, the step asks nobody to run one", () => {
    for (const text of [
      RUN_PROBE_INSTRUCTIONS_WITHOUT_KEY,
      RUN_PROBE_WAITING_WITHOUT_KEY,
    ]) {
      expect(text).not.toMatch(/\bcommand\b/i);
      expect(text).not.toMatch(/^Run this\b/);
    }

    expect(RUN_PROBE_INSTRUCTIONS_WITHOUT_KEY).toContain("inside your network");
    expect(RUN_PROBE_WAITING_WITHOUT_KEY).toContain("turns green");
  });

  test("the dialog chooses its words by whether there is a command to run", () => {
    const modal: string = readDashboard(
      "Components",
      "Network",
      "AddProbeModal.tsx",
    ).replace(/\s+/g, " ");

    expect(modal).toContain(
      "hasCommand ? RUN_PROBE_INSTRUCTIONS : RUN_PROBE_INSTRUCTIONS_WITHOUT_KEY",
    );
    expect(modal).toContain(
      "hasCommand ? RUN_PROBE_WAITING : RUN_PROBE_WAITING_WITHOUT_KEY",
    );
  });

  /*
   * Someone who may add a probe but not read its key is told who can, and
   * where the probe is: the path has to be the one the Dashboard draws.
   */
  test("a viewer who cannot read the key is sent where the probe is", () => {
    const breadcrumbs: string = readDashboard(
      "Utils",
      "Breadcrumbs",
      "MonitorBreadcrumbs.ts",
    ).replace(/\s+/g, " ");

    expect(RUN_PROBE_KEY_HIDDEN).toContain("Monitors → Settings → Probes");
    expect(breadcrumbs).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.MONITORS_SETTINGS_PROBES, [ "Project", "Monitors", "Settings", "Probes", ])',
    );
  });

  test("the run step says where to run it, and that it keeps running", () => {
    expect(RUN_PROBE_INSTRUCTIONS).toContain("inside your network");
    expect(RUN_PROBE_INSTRUCTIONS).toContain("Leave it running");
  });

  test("the waiting line says the dialog can stay open while the command runs", () => {
    expect(RUN_PROBE_WAITING).toContain("leave it open");
  });
});
