import {
  INSTALL_SCRIPTS,
  INSTALL_SCRIPTS_ROUTE,
  INSTALL_SCRIPT_FILE,
  InstallScriptEntry,
  InstallScriptName,
  TROUBLESHOOT_SCRIPT_FILE,
  getInstallFileUrl,
  getInstallScriptEntry,
  getInstallScriptFile,
  getInstallScriptUrl,
  trimOneUptimeUrl,
} from "../../../Types/InstallScripts/InstallScripts";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The install scripts every OneUptime serves itself, at /install/<name>,
 * and the files they download, at /install/<name>/<file>. The App serves
 * exactly this list from its image (FeatureSet/Install), the Dashboard's
 * install commands and the docs name these addresses on the reader's own
 * host, and the scripts download their files from the same place.
 */

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..", "..");

function entry(name: InstallScriptName): InstallScriptEntry {
  const found: InstallScriptEntry | null = getInstallScriptEntry(name);

  if (!found) {
    throw new Error(`no entry ${name}`);
  }

  return found;
}

describe("the list", () => {
  test("every name of the enum has exactly one entry, in the enum's order", () => {
    expect(
      INSTALL_SCRIPTS.map((item: InstallScriptEntry): string => {
        return item.name;
      }),
    ).toEqual(Object.values(InstallScriptName));
  });

  test("names are what an address carries: lower case words joined by hyphens", () => {
    for (const item of INSTALL_SCRIPTS) {
      expect(item.name).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    }
  });

  test("they are served under /install", () => {
    expect(INSTALL_SCRIPTS_ROUTE).toBe("/install");
  });

  test("each agent with an installer installs with install.sh, one of its own files", () => {
    for (const item of INSTALL_SCRIPTS) {
      if (item.script === null) {
        continue;
      }

      expect({ name: item.name, script: item.script }).toEqual({
        name: item.name,
        script: INSTALL_SCRIPT_FILE,
      });
      expect(item.files).toContain(item.script);
    }
  });

  test("the Kubernetes agent installs with Helm: it serves its diagnostic script alone", () => {
    const kubernetes: InstallScriptEntry = entry(
      InstallScriptName.KubernetesAgent,
    );

    expect(kubernetes.script).toBeNull();
    expect(kubernetes.files).toEqual([TROUBLESHOOT_SCRIPT_FILE]);
    expect(kubernetes.sourceDirectory).toBe(
      "HelmChart/Public/kubernetes-agent",
    );
  });

  test("an entry lists each file once", () => {
    for (const item of INSTALL_SCRIPTS) {
      expect(new Set(item.files).size).toBe(item.files.length);
    }
  });

  test.each(
    INSTALL_SCRIPTS.flatMap((item: InstallScriptEntry): Array<[string]> => {
      return item.files.map((file: string): [string] => {
        return [`${item.sourceDirectory}/${file}`];
      });
    }),
  )("%s is a file in the repository", (relativePath: string) => {
    const absolute: string = path.join(REPO_ROOT, relativePath);

    expect(fs.existsSync(absolute)).toBe(true);
    expect(fs.statSync(absolute).isFile()).toBe(true);
  });

  test("every file is a plain path inside its folder: no dot segments, no absolute or Windows paths, nothing hidden", () => {
    for (const item of INSTALL_SCRIPTS) {
      for (const file of [item.sourceDirectory, ...item.files]) {
        expect(file.startsWith("/")).toBe(false);
        expect(file.includes("\\")).toBe(false);
        expect(file.includes("//")).toBe(false);

        for (const segment of file.split("/")) {
          expect(segment).not.toBe("");
          expect(segment).not.toBe(".");
          expect(segment).not.toBe("..");
          expect(segment.startsWith(".")).toBe(false);
        }
      }
    }
  });

  test("the agents' folders are under agents/, each one entry's", () => {
    const folders: Array<string> = INSTALL_SCRIPTS.map(
      (item: InstallScriptEntry): string => {
        return item.sourceDirectory;
      },
    );

    expect(new Set(folders).size).toBe(folders.length);

    for (const item of INSTALL_SCRIPTS) {
      if (item.name === InstallScriptName.KubernetesAgent) {
        continue;
      }

      expect(item.sourceDirectory).toMatch(/^agents\/[A-Za-z]+Agent$/);
    }
  });

  test("every agent with a diagnostic script in its folder serves it", () => {
    for (const item of INSTALL_SCRIPTS) {
      const onDisk: boolean = fs.existsSync(
        path.join(REPO_ROOT, item.sourceDirectory, TROUBLESHOOT_SCRIPT_FILE),
      );

      expect({
        name: item.name,
        serves: item.files.includes(TROUBLESHOOT_SCRIPT_FILE),
      }).toEqual({ name: item.name, serves: onDisk });
    }
  });

  test("every systemd unit in an agent's folder is served", () => {
    for (const item of INSTALL_SCRIPTS) {
      const systemd: string = path.join(
        REPO_ROOT,
        item.sourceDirectory,
        "systemd",
      );

      if (!fs.existsSync(systemd)) {
        continue;
      }

      for (const unit of fs.readdirSync(systemd)) {
        expect({ name: item.name, unit, served: true }).toEqual({
          name: item.name,
          unit,
          served: item.files.includes(`systemd/${unit}`),
        });
      }
    }
  });

  test("the Database agent serves the collector config of every engine it ships", () => {
    const configs: Array<string> = fs
      .readdirSync(path.join(REPO_ROOT, "agents", "DatabaseAgent", "configs"))
      .filter((file: string): boolean => {
        return file.endsWith(".yaml");
      })
      .map((file: string): string => {
        return `configs/${file}`;
      })
      .sort();

    expect(configs.length).toBeGreaterThan(0);
    expect(
      entry(InstallScriptName.DatabaseAgent)
        .files.filter((file: string): boolean => {
          return file.startsWith("configs/");
        })
        .slice()
        .sort(),
    ).toEqual(configs);
  });
});

describe("an address names an entry and a file exactly", () => {
  test("by its name", () => {
    expect(getInstallScriptEntry("proxmox-agent")?.sourceDirectory).toBe(
      "agents/ProxmoxAgent",
    );
    expect(getInstallScriptEntry("vmware-agent")?.sourceDirectory).toBe(
      "agents/VMwareAgent",
    );
  });

  test.each([
    [""],
    ["proxmox"],
    ["Proxmox-Agent"],
    ["proxmox-agent "],
    [" proxmox-agent"],
    ["proxmox-agent/"],
    ["ProxmoxAgent"],
    ["agents/ProxmoxAgent"],
    [".."],
    ["cli"],
    ["constructor"],
    ["__proto__"],
    ["toString"],
  ])("%p names no entry", (name: string) => {
    expect(getInstallScriptEntry(name)).toBeNull();
  });

  test("nothing at all names no entry", () => {
    expect(getInstallScriptEntry(null)).toBeNull();
    expect(getInstallScriptEntry(undefined)).toBeNull();
  });

  test("a file is one the entry lists, as it lists it", () => {
    const database: InstallScriptEntry = entry(InstallScriptName.DatabaseAgent);

    expect(getInstallScriptFile(database, "configs/postgresql.yaml")).toBe(
      "configs/postgresql.yaml",
    );
    expect(getInstallScriptFile(database, "install.sh")).toBe("install.sh");
  });

  test.each([
    ["../ProxmoxAgent/install.sh"],
    ["../../../../etc/passwd"],
    ["/etc/passwd"],
    ["configs/../docker-compose.yml"],
    ["./docker-compose.yml"],
    ["configs//postgresql.yaml"],
    ["configs\\postgresql.yaml"],
    ["CONFIGS/POSTGRESQL.YAML"],
    ["docker-compose.yml "],
    ["docker-compose.yml/"],
    ["README.md"],
    [".env"],
    ["configs"],
    ["systemd"],
    [""],
  ])("%p is no file of the Database agent", (file: string) => {
    expect(
      getInstallScriptFile(entry(InstallScriptName.DatabaseAgent), file),
    ).toBeNull();
  });

  test("an entry's file is never another entry's", () => {
    expect(
      getInstallScriptFile(
        entry(InstallScriptName.HostAiAgent),
        "otel-collector-config.yaml",
      ),
    ).toBeNull();
    expect(
      getInstallScriptFile(
        entry(InstallScriptName.KubernetesAgent),
        "install.sh",
      ),
    ).toBeNull();
  });
});

describe("the addresses, on the reader's own OneUptime", () => {
  test("OneUptime Cloud", () => {
    expect(
      getInstallScriptUrl(
        "https://oneuptime.com",
        InstallScriptName.ProxmoxAgent,
      ),
    ).toBe("https://oneuptime.com/install/proxmox-agent");
    expect(
      getInstallFileUrl(
        "https://oneuptime.com",
        InstallScriptName.ProxmoxAgent,
        "docker-compose.yml",
      ),
    ).toBe("https://oneuptime.com/install/proxmox-agent/docker-compose.yml");
  });

  test("a self-hosted OneUptime on its own domain, with a port", () => {
    expect(
      getInstallScriptUrl(
        "https://oneuptime.acme.internal:8443",
        InstallScriptName.VMwareAgent,
      ),
    ).toBe("https://oneuptime.acme.internal:8443/install/vmware-agent");
  });

  test("over plain HTTP, as an install without TLS is reached", () => {
    expect(
      getInstallFileUrl(
        "http://10.0.0.5",
        InstallScriptName.DatabaseAgent,
        "configs/mysql.yaml",
      ),
    ).toBe("http://10.0.0.5/install/database-agent/configs/mysql.yaml");
  });

  test("under a path prefix, the scripts are found under it", () => {
    expect(
      getInstallScriptUrl(
        "https://tools.acme.com/oneuptime",
        InstallScriptName.CephAgent,
      ),
    ).toBe("https://tools.acme.com/oneuptime/install/ceph-agent");
  });

  test.each([
    ["https://oneuptime.com/"],
    ["https://oneuptime.com///"],
    ["  https://oneuptime.com/  "],
    ["https://oneuptime.com"],
  ])("%p loses the slashes and blanks it ends with", (url: string) => {
    expect(trimOneUptimeUrl(url)).toBe("https://oneuptime.com");
    expect(getInstallScriptUrl(url, InstallScriptName.HostAiAgent)).toBe(
      "https://oneuptime.com/install/host-ai-agent",
    );
  });

  test("the placeholder of a guide that knows no host stays readable", () => {
    expect(
      getInstallScriptUrl(
        "<YOUR_ONEUPTIME_URL>",
        InstallScriptName.StorageArrayAgent,
      ),
    ).toBe("<YOUR_ONEUPTIME_URL>/install/storage-array-agent");
  });

  test("the Kubernetes agent's diagnostic script", () => {
    expect(
      getInstallFileUrl(
        "https://oneuptime.com",
        InstallScriptName.KubernetesAgent,
        TROUBLESHOOT_SCRIPT_FILE,
      ),
    ).toBe("https://oneuptime.com/install/kubernetes-agent/troubleshoot.sh");
  });

  test("no address names GitHub", () => {
    for (const item of INSTALL_SCRIPTS) {
      for (const file of item.files) {
        const url: string = getInstallFileUrl(
          "https://oneuptime.com",
          item.name,
          file,
        );

        expect(new URL(url).host).toBe("oneuptime.com");
      }
    }
  });
});
