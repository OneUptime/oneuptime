"use strict";

/**
 * The infrastructure agent's Windows installer
 * (agents/InfrastructureAgent/windows/oneuptime-infrastructure-agent.wxs),
 * built by build-msi.sh with wixl for each release.
 *
 * Intune, Configuration Manager and Group Policy upgrade an agent by
 * installing the newer MSI over the older one. That only works while the
 * installer keeps its UpgradeCode, gets a ProductCode of its own each build,
 * and carries a major upgrade: with a fixed ProductCode, which it had, Windows
 * refused every newer version with error 1638. And an upgrade replaces the
 * program while the agent's service runs it, so the installer stops the
 * service before its files go and starts it again after.
 *
 * What the installer does is only seen on Windows: the "Infrastructure Agent
 * MSI Test" workflow builds two versions and installs, upgrades, downgrades
 * and uninstalls them there (windows/test-msi-upgrade.ps1). This suite holds
 * the source to what that relies on, so a change that breaks upgrades fails
 * on every pull request, and says why:
 *
 *   - the UpgradeCode, the component's Guid and the install directory are the
 *     ones installed agents have, and never change;
 *   - a new ProductCode each build, a per-machine install, and a major upgrade
 *     that also replaces a build of the same version and refuses a downgrade;
 *   - the service: stopped by every install and uninstall, started after an
 *     install or upgrade, deleted by an uninstall that is not part of an
 *     upgrade, with failures ignored where there may be no service;
 *   - every custom action placed by sequence number, as wixl does not place
 *     one After or Before a standard action;
 *   - build-msi.sh builds both MSIs from this one file, the amd64 MSI as an
 *     x64 package and the arm64 one as x86 (wixl builds no ARM64 package);
 *   - the workflow runs on every change to the agent, on both architectures.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { parseXml, childrenNamed } = require("./Utils/Xml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT = "agents/InfrastructureAgent";
const WXS = `${AGENT}/windows/oneuptime-infrastructure-agent.wxs`;
const BUILD = `${AGENT}/build-msi.sh`;
const WORKFLOW = ".github/workflows/test.infrastructure-agent-msi.yaml";
const TEST_SCRIPT = `${AGENT}/windows/test-msi-upgrade.ps1`;

// What every installed agent was installed with. Windows finds the agent to
// upgrade by the UpgradeCode, and the component's Guid and directory say
// where its program is: changing any of them breaks upgrades.
const UPGRADE_CODE = "ABCDDCBA-7349-453F-94F6-BCB5110BA8FD";
const COMPONENT_GUID = "ABCDDCBA-83F1-4F22-985B-FDB3C8ABD474";

// The service `configure` registers (main.go's svcConfig).
const SERVICE = "oneuptime-infrastructure-agent";

// Standard actions the custom actions are placed between.
const STOP_SERVICES = 1900;
const DELETE_SERVICES = 2000;
const INSTALL_FILES = 4000;
const INSTALL_FINALIZE = 6600;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function only(node, name) {
  const matches = childrenNamed(node, name);
  if (matches.length !== 1) {
    throw new Error(
      `<${node.name}> has ${matches.length} <${name}> elements; expected one`,
    );
  }
  return matches[0];
}

function descendants(node, name) {
  return node.children.flatMap((child) => {
    return [
      ...(child.name === name ? [child] : []),
      ...descendants(child, name),
    ];
  });
}

const wix = parseXml(read(WXS), WXS);
const product = only(wix, "Product");
const customActions = Object.fromEntries(
  childrenNamed(product, "CustomAction").map((action) => {
    return [action.attributes.Id, action.attributes];
  }),
);
const sequence = Object.fromEntries(
  childrenNamed(only(product, "InstallExecuteSequence"), "Custom").map(
    (custom) => {
      return [custom.attributes.Action, custom];
    },
  ),
);

describe(`${WXS}: upgrades`, () => {
  test("keeps the UpgradeCode installed agents have, and takes a new ProductCode each build", () => {
    expect(product.attributes.UpgradeCode).toBe(UPGRADE_CODE);
    expect(product.attributes.Id).toBe("*");
    expect(only(product, "Package").attributes.Id).toBe("*");
    expect(product.attributes.Version).toBe("$(var.Version)");
  });

  test("installs per machine, as an agent that runs as a service must", () => {
    expect(only(product, "Package").attributes.InstallScope).toBe("perMachine");
  });

  /*
   * wixl schedules RemoveExistingProducts after InstallValidate and has no
   * Schedule attribute: the older version is removed entirely, its own
   * uninstall stopping the service, before this one installs.
   */
  test("removes the older version, also a build of the same version, and refuses a downgrade", () => {
    const upgrade = only(product, "MajorUpgrade").attributes;

    expect(upgrade.AllowSameVersionUpgrades).toBe("yes");
    expect(upgrade.DowngradeErrorMessage).toMatch(/newer version/);
    expect(upgrade.Schedule).toBeUndefined();
  });

  test("installs the program where installed agents have it, under the same component", () => {
    const programFiles = descendants(product, "Directory").find((directory) => {
      return directory.attributes.Id === "ProgramFiles64Folder";
    });
    const directory = only(programFiles, "Directory");
    const component = only(directory, "Component");
    const file = only(component, "File");

    expect(directory.attributes.Name).toBe("OneUptimeInfrastructureAgent");
    expect(component.attributes.Guid).toBe(COMPONENT_GUID);
    expect(file.attributes).toEqual(
      expect.objectContaining({
        Name: "oneuptime-infrastructure-agent.exe",
        Source: "$(var.Binary)",
        KeyPath: "yes",
      }),
    );
  });
});

describe(`${WXS}: the agent's service`, () => {
  test("is the service configure registers", () => {
    expect(read(`${AGENT}/main.go`)).toContain(`Name:        "${SERVICE}",`);
  });

  /*
   * Stopped by every install and uninstall, the uninstall a newer version's
   * upgrade runs included, so no file is in use when it is replaced. Never
   * started or removed here: before configure there is no service to start,
   * and an upgrade's uninstall must not remove it.
   */
  test("is stopped by every install and uninstall, and waited for", () => {
    const controls = descendants(product, "ServiceControl");

    expect(controls).toHaveLength(1);
    expect(controls[0].attributes).toEqual({
      Id: "AgentService",
      Name: SERVICE,
      Stop: "both",
      Wait: "yes",
    });
  });

  test("is started after an install or an upgrade, and deleted by an uninstall that is not an upgrade's", () => {
    expect(customActions.SetNetExe).toEqual(
      expect.objectContaining({
        Property: "NETEXE",
        Value: "[SystemFolder]net.exe",
      }),
    );
    expect(customActions.SetScExe).toEqual(
      expect.objectContaining({
        Property: "SCEXE",
        Value: "[SystemFolder]sc.exe",
      }),
    );
    expect(customActions.StartAgentService).toEqual(
      expect.objectContaining({
        Property: "NETEXE",
        ExeCommand: `start ${SERVICE}`,
      }),
    );
    expect(customActions.DeleteAgentService).toEqual(
      expect.objectContaining({
        Property: "SCEXE",
        ExeCommand: `delete ${SERVICE}`,
      }),
    );
    expect(sequence.StartAgentService.text).toBe('NOT REMOVE~="ALL"');
    expect(sequence.DeleteAgentService.text).toBe(
      'REMOVE~="ALL" AND NOT UPGRADINGPRODUCTCODE',
    );
  });

  // As the local system, inside the installation, and not failing it: there
  // is no service to start before configure, nor to delete after uninstall.
  test.each(["StartAgentService", "DeleteAgentService"])(
    "%s runs deferred, as the local system, and its failure is ignored",
    (action) => {
      expect(customActions[action]).toEqual(
        expect.objectContaining({
          Execute: "deferred",
          Impersonate: "no",
          Return: "ignore",
        }),
      );
    },
  );
});

describe(`${WXS}: sequence`, () => {
  test("places every custom action by its sequence number, none After or Before", () => {
    expect(Object.keys(sequence).sort()).toEqual(
      Object.keys(customActions).sort(),
    );
    for (const [action, custom] of Object.entries(sequence)) {
      expect({
        action,
        sequence: /^\d+$/.test(custom.attributes.Sequence || ""),
      }).toEqual({
        action,
        sequence: true,
      });
      expect(custom.attributes.After).toBeUndefined();
      expect(custom.attributes.Before).toBeUndefined();
    }
  });

  test("sets the programs' paths before the actions that run them", () => {
    const at = (action) => Number(sequence[action].attributes.Sequence);

    expect(at("SetNetExe")).toBeLessThan(STOP_SERVICES);
    expect(at("SetScExe")).toBeLessThan(STOP_SERVICES);
  });

  test("deletes the service once it is stopped and before the files go, and starts it once they are installed", () => {
    const at = (action) => Number(sequence[action].attributes.Sequence);

    expect(at("DeleteAgentService")).toBeGreaterThan(STOP_SERVICES);
    expect(at("DeleteAgentService")).toBeLessThan(DELETE_SERVICES);
    expect(at("StartAgentService")).toBeGreaterThan(INSTALL_FILES);
    expect(at("StartAgentService")).toBeLessThan(INSTALL_FINALIZE);
  });
});

describe(`${BUILD}`, () => {
  const build = read(BUILD);

  test("builds both MSIs from the one installer source, under the names the release has always had", () => {
    expect(build).toContain('WXS_FILE="./windows/$APP_NAME.wxs"');
    expect(build).toContain('MSI_FILE="$OUTPUT_DIR/$APP_NAME-$ARCH.msi"');
    expect(build).toContain('ARCHES=("amd64" "arm64")');
    expect(build).not.toContain("placeholder");
    expect(
      fs.readdirSync(path.join(REPO_ROOT, AGENT, "windows")).filter((file) => {
        return file.endsWith(".wxs");
      }),
    ).toEqual(["oneuptime-infrastructure-agent.wxs"]);
  });

  test("builds both MSIs as x64 packages, so both install into C:\\Program Files, with the arch, version and program", () => {
    /*
     * wixl cannot build an ARM64 package. As an x86 one, the arm64 MSI put
     * its native ARM64 program in the 32-bit Program Files (Windows
     * Installer maps a 32-bit package's ProgramFiles64Folder there), not
     * where the docs say; test-msi-upgrade.ps1 caught it on Windows on Arm.
     */
    expect(build).toContain('WIXL_ARCHES=("x64" "x64")');
    expect(build).toContain('wixl -a "${WIXL_ARCHES[$i]}"');
    expect(build).toContain('-D "Arch=$ARCH"');
    expect(build).toContain('-D "Version=$APP_VERSION"');
    expect(build).toContain('-D "Binary=$BINARY"');
  });
});

describe(`${WORKFLOW}`, () => {
  const workflow = yaml.load(read(WORKFLOW));

  test("runs on every change to the agent and to itself", () => {
    for (const event of ["pull_request", "push"]) {
      expect(workflow.on[event].paths).toEqual(
        expect.arrayContaining([`${AGENT}/**`, WORKFLOW]),
      );
    }
  });

  test("builds two versions with build-msi.sh, and installs and upgrades them on Windows x64 and on Windows on Arm", () => {
    const build = workflow.jobs.build.steps
      .map((step) => step.run || "")
      .join("\n");
    const test = workflow.jobs["install-and-upgrade"];

    expect(build).toContain("for version in 1.0.0 1.0.1; do");
    expect(build).toContain('bash build-msi.sh "$version"');
    expect(test.needs).toBe("build");
    expect(test.strategy.matrix.include).toEqual([
      { arch: "amd64", runner: "windows-latest" },
      { arch: "arm64", runner: "windows-11-arm" },
    ]);
    expect(test.steps.map((step) => step.run || "").join("\n")).toContain(
      "./agents/InfrastructureAgent/windows/test-msi-upgrade.ps1 -Arch $env:ARCH",
    );
    expect(fs.existsSync(path.join(REPO_ROOT, TEST_SCRIPT))).toBe(true);
  });
});
