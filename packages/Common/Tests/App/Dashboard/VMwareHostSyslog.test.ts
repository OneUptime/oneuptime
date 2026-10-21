import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { slugifyMarkdownHeading } from "../../../Server/Types/MarkdownSlugify";
import {
  VMWARE_HOST_HOSTNAME_COMMAND,
  VMWARE_PROBE_OR_AGENT_DOCS_PATH,
  VMWARE_SYSLOG_DOCS_PATH,
  VMWARE_SYSLOG_HOSTNAME_ATTRIBUTE,
  VMWARE_SYSLOG_PORT,
  VMWARE_SYSLOG_TARGET,
  VMWARE_VCENTER_NAME_ATTRIBUTE,
  getVMwareClusterPowerCliSyslogCommand,
  getVMwareHostEsxcliSyslogCommands,
  getVMwareHostLogAttributes,
  getVMwareHostPowerCliSyslogCommand,
  quotePowerShellLiteral,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHostSyslog";

/*
 * How an ESXi host's Logs tab finds the host's lines and says how to send
 * them (Pages/VMware/Utils/VMwareHostSyslog): the filter, the commands it
 * fills in for this host and its cluster, and the docs it links to. The
 * commands are run as written on a customer's host, so a quote out of place
 * is a command that does something else; each is pinned here, and held to
 * the agent's own config and docs.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
}

// A markdown heading's text: linear, and trimmed below.
const HEADING: RegExp = /^#{1,6}[ \t]+(\S[^\n]*)$/gm;

function headingAnchors(markdown: string): Array<string> {
  const anchors: Array<string> = [];
  for (const match of markdown.matchAll(HEADING)) {
    anchors.push(slugifyMarkdownHeading(match[1]!.trim()));
  }
  return anchors;
}

describe("whose lines are the host's", () => {
  test("the vCenter's logs whose sender is this host", () => {
    expect(
      getVMwareHostLogAttributes({
        vcenterName: "vcenter-prod",
        hostName: "esx01.acme.example",
      }),
    ).toEqual({
      "resource.vmware.vcenter.name": "vcenter-prod",
      hostname: "esx01.acme.example",
    });
  });

  test("the vCenter key is the resource attribute the agent stamps; the host's, the syslog receiver's own", () => {
    expect(VMWARE_VCENTER_NAME_ATTRIBUTE).toBe("resource.vmware.vcenter.name");
    expect(VMWARE_SYSLOG_HOSTNAME_ATTRIBUTE).toBe("hostname");
  });
});

describe("the commands that send a host's syslog", () => {
  test("on the host: the docs' three esxcli lines, aimed at the agent's port", () => {
    expect(getVMwareHostEsxcliSyslogCommands()).toBe(
      [
        "esxcli system syslog config set --loghost='udp://<agent-host>:5514'",
        "esxcli system syslog reload",
        "esxcli network firewall ruleset set --ruleset-id=syslog --enabled=true",
      ].join("\n"),
    );
  });

  test("with PowerCLI: this host by the name vCenter knows it by", () => {
    expect(getVMwareHostPowerCliSyslogCommand("esx01.acme.example")).toBe(
      "Get-VMHost -Name 'esx01.acme.example' | Get-AdvancedSetting -Name Syslog.global.logHost | Set-AdvancedSetting -Value 'udp://<agent-host>:5514' -Confirm:$false",
    );
  });

  test("with PowerCLI: every host of the cluster at once", () => {
    expect(getVMwareClusterPowerCliSyslogCommand("prod-cluster")).toBe(
      "Get-Cluster -Name 'prod-cluster' | Get-VMHost | Get-AdvancedSetting -Name Syslog.global.logHost | Set-AdvancedSetting -Value 'udp://<agent-host>:5514' -Confirm:$false",
    );
  });

  test("a name with quotes, spaces or a $ goes in as written and runs nothing", () => {
    expect(quotePowerShellLiteral("Prod 'A'")).toBe("'Prod ''A'''");
    expect(quotePowerShellLiteral("$(Remove-Item C:\\)")).toBe(
      "'$(Remove-Item C:\\)'",
    );
    expect(quotePowerShellLiteral("")).toBe("''");
    expect(getVMwareClusterPowerCliSyslogCommand("Prod 'A'")).toContain(
      "Get-Cluster -Name 'Prod ''A''' |",
    );

    // Single-quoted literal: only '' may appear inside it.
    const quoted: string = quotePowerShellLiteral("a'b'c");
    const inside: string = quoted.slice(1, -1);
    expect(inside.split("''").join("")).not.toContain("'");
  });

  test("the target is the agent's syslog port, with the address the reader fills in", () => {
    expect(VMWARE_SYSLOG_PORT).toBe(5514);
    expect(VMWARE_SYSLOG_TARGET).toBe("udp://<agent-host>:5514");
    expect(VMWARE_HOST_HOSTNAME_COMMAND).toBe("esxcli system hostname get");
  });
});

describe("the commands and the agent agree", () => {
  const config: string = read("agents/VMwareAgent/otel-collector-config.yaml");

  test("the agent's syslog receivers listen on the port the commands send to", () => {
    expect(config).toContain(`listen_address: "0.0.0.0:${VMWARE_SYSLOG_PORT}"`);
    expect(config).toContain("# syslog/udp:");
    expect(config).toContain("protocol: rfc3164");
  });

  test("the docs give the same esxcli lines the Logs tab does", () => {
    const docs: string = read(
      "packages/App/FeatureSet/Docs/Content/en/telemetry/vmware.md",
    );
    for (const line of getVMwareHostEsxcliSyslogCommands().split("\n")) {
      expect(docs).toContain(line);
    }
  });
});

describe("the docs the Logs tab links to", () => {
  test("the agent page has the syslog section", () => {
    const [page, anchor] = VMWARE_SYSLOG_DOCS_PATH.split("#");
    expect(page).toBe("/docs/telemetry/vmware");
    expect(
      headingAnchors(
        read("packages/App/FeatureSet/Docs/Content/en/telemetry/vmware.md"),
      ),
    ).toContain(anchor);
  });

  test("the probe page has its Probe or agent? section", () => {
    const [page, anchor] = VMWARE_PROBE_OR_AGENT_DOCS_PATH.split("#");
    expect(page).toBe("/docs/telemetry/vmware-agentless");
    expect(
      headingAnchors(
        read(
          "packages/App/FeatureSet/Docs/Content/en/telemetry/vmware-agentless.md",
        ),
      ),
    ).toContain(anchor);
  });
});
