import GovcCommandPolicy, {
  GOVC_MAX_RECORD_COUNT,
  isCollectableGovcProperty,
} from "../../../../Utils/AiRemediation/Resource/GovcCommandPolicy";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  MAX_RESOURCE_COMMAND_TOKENS,
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import {
  RESOURCE_REDACTED_MARKER,
  getResourceOutputRedactionHooks,
  redactResourceCommandOutput,
  redactResourceCommandOutputWithCount,
} from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  AiRemediationCommandPolicyVerdict,
  MAX_COMMAND_LENGTH_CHARS,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — GovcCommandPolicy, the tier of every govc command
 * OneUptime AI composes for a VMware vCenter.
 *
 * - govc 0.53's grammar as Go's flag package reads it: the command first,
 *   flags only before the first argument, `-flag`/`--flag`/`-flag=value`,
 *   no short-flag clusters, a value flag taking the next word whatever it
 *   is (so a flag-looking value is refused), switches only as -x / -x=true
 *   / -x=false, "--" ending the flags.
 * - Read: the modelled read commands with their own flag tables; secrets
 *   stay out of reach (vm.info -e/-json, host.info -json, object.collect
 *   without an allowlisted property, find filters outside the allowlist).
 * - SafeWrite: one named VM powered on or guest-rebooted. RiskyWrite: every
 *   other power operation, several VMs, host.maintenance.exit.
 *   requiresHuman: vm.migrate, host.maintenance.enter.
 * - Denied: every other command, the endpoint/credential/debug/dump flags,
 *   patterns as write targets, look-alike and invisible characters.
 * - Totality, the dispatcher's ladder / allowlist / write scope for
 *   VMwareVCenter, the guides, and the govc output redaction hook.
 */

const VCENTER: AiResourceType = AiResourceType.VMwareVCenter;

function govc(command: string): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({
    resourceType: VCENTER,
    command,
  });
}

function direct(argv: unknown): ResourceCommandPolicyResult {
  return GovcCommandPolicy.evaluateArgv(argv as Array<string>);
}

function autoExecution(
  command: string,
  options: { allowlistPatterns?: Array<string>; bypassApproval?: boolean } = {},
): ResourceAutoExecutionVerdict {
  return ResourceCommandPolicy.evaluateForAutoExecution({
    resourceType: VCENTER,
    command,
    allowlistPatterns: options.allowlistPatterns || [],
    bypassApproval: options.bypassApproval === true,
  });
}

function expectDenied(
  command: string,
  mentions?: string,
): ResourceCommandPolicyResult {
  const result: ResourceCommandPolicyResult = govc(command);

  expect(result.tier).toBe(ResourceCommandTier.Denied);
  expect(result.targets).toEqual([]);
  expect(result.reason.length).toBeGreaterThan(0);

  if (mentions !== undefined) {
    expect(result.reason).toContain(mentions);
  }

  return result;
}

const ALL_TIERS: Array<string> = Object.values(ResourceCommandTier);

// The characters govc expands in a name; a write target never holds one.
const PATTERN_CHARACTERS: RegExp = /[*?[\]\\]/;

describe("identity and routing", () => {
  test("names the tool and its one program", () => {
    expect(GovcCommandPolicy.name).toBe("govc");
    expect([...GovcCommandPolicy.programs]).toEqual(["govc"]);
  });

  test("the dispatcher routes VMware vCenters to it", () => {
    expect(ResourceCommandPolicy.getToolPolicy(VCENTER)).toBe(
      GovcCommandPolicy,
    );
    expect([...GovcCommandPolicy.programs]).toEqual([
      ...AI_RESOURCE_TYPE_INFO[VCENTER].programs,
    ]);
  });

  test("every Test connection command is a Read", () => {
    for (const command of AI_RESOURCE_TYPE_INFO[VCENTER].testCommands) {
      expect(govc(command).tier).toBe(ResourceCommandTier.Read);
      expect(
        ResourceCommandPolicy.isReadOnly({ resourceType: VCENTER, command }),
      ).toBe(true);
    }
  });

  test("another resource's program is refused before the tool reads it", () => {
    for (const command of [
      "docker ps",
      "pvesh get /version",
      "kubectl get pods",
      "ceph health",
    ]) {
      const result: ResourceCommandPolicyResult = expectDenied(
        command,
        "is not a program the VMware AI agent runs",
      );

      expect(result.reason).toContain('"govc"');
    }
  });

  test("the tool itself refuses a program other than govc", () => {
    const result: ResourceCommandPolicyResult = direct(["kubectl", "get"]);

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.reason).toContain('start with "govc"');
    expect(direct(["/usr/bin/govc", "about"]).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(direct(["GOVC", "about"]).tier).toBe(ResourceCommandTier.Denied);
  });
});

describe("Read commands", () => {
  test.each([
    ["govc about", "about"],
    ["govc about -json", "about"],
    ["govc about --json", "about"],
    ["govc about -json=true", "about"],
    ["govc about -json=false", "about"],
    ["govc about -l", "about"],
    ["govc about -l -json", "about"],
    ["govc about --", "about"],
    ["govc version", "version"],
    ["govc version -l", "version"],
    ["govc datacenter.info", "datacenter.info"],
    ["govc datacenter.info -json DC1", "datacenter.info"],
    ["govc datacenter.info -dc DC1", "datacenter.info"],
    ["govc datacenter.info DC1 DC2", "datacenter.info"],
    ["govc ls", "ls"],
    ["govc ls /", "ls"],
    ["govc ls -l /DC1/vm", "ls"],
    ["govc ls -L VirtualMachine:vm-42", "ls"],
    ["govc ls -i -l /DC1/host", "ls"],
    ["govc ls -t VirtualMachine /DC1/vm", "ls"],
    ["govc ls -t=HostSystem '/DC1/host/*'", "ls"],
    ["govc ls -json -dc DC1 vm", "ls"],
    ["govc ls -dc=DC1 host", "ls"],
    ["govc ls '/DC1/vm/My Folder'", "ls"],
    ["govc ls -- /DC1/vm", "ls"],
    ["govc ls /DC1/vm /DC1/host /DC1/datastore", "ls"],
    ["govc find", "find"],
    ["govc find .", "find"],
    ["govc find / -type m", "find"],
    ["govc find -type m -name 'web-*' /DC1/vm", "find"],
    ["govc find . -type m -runtime.powerState poweredOff", "find"],
    ["govc find . -type h -runtime.connectionState disconnected", "find"],
    ["govc find . -type m -summary.runtime.powerState poweredOn", "find"],
    ["govc find . -type h -runtime.inMaintenanceMode true", "find"],
    [
      "govc find . -type m -guest.toolsRunningStatus guestToolsNotRunning",
      "find",
    ],
    ["govc find . -type m -overallStatus red", "find"],
    ["govc find /DC1 -type m -type h", "find"],
    ["govc find -type m -type h /", "find"],
    ["govc find -type m / -type h", "find"],
    ["govc find -l -i -maxdepth 2 /DC1", "find"],
    ["govc find -maxdepth 0 /DC1", "find"],
    ["govc find . -name web-01", "find"],
    ["govc find -json .", "find"],
    ["govc find -dc DC1 . -type s", "find"],
    ["govc vm.info web-01", "vm.info"],
    ["govc vm.info -r web-01", "vm.info"],
    ["govc vm.info -r -t /DC1/vm/web-01", "vm.info"],
    ["govc vm.info -g=false -r web-01", "vm.info"],
    ["govc vm.info -dc DC1 'web-*'", "vm.info"],
    ["govc vm.info web-01 web-02", "vm.info"],
    ["govc vm.info 'Windows Server 2019'", "vm.info"],
    ["govc host.info", "host.info"],
    ["govc host.info esx-01.example.com", "host.info"],
    ["govc host.info -host esx-01", "host.info"],
    ["govc host.info /DC1/host/Cluster1/esx-01", "host.info"],
    ["govc host.service.ls -host esx-01", "host.service.ls"],
    ["govc host.service.ls -json -host esx-01", "host.service.ls"],
    ["govc host.service.ls", "host.service.ls"],
    ["govc host.date.info -host esx-01", "host.date.info"],
    ["govc datastore.info", "datastore.info"],
    ["govc datastore.info -json datastore1", "datastore.info"],
    ["govc pool.info /DC1/host/Cluster1/Resources", "pool.info"],
    ["govc pool.info -json Resources/Prod", "pool.info"],
    ["govc events", "events"],
    ["govc events -n 50 /DC1/vm/web-01", "events"],
    [`govc events -n ${GOVC_MAX_RECORD_COUNT}`, "events"],
    ["govc events -n 1", "events"],
    ["govc events -l -type VmPoweredOffEvent -type VmPoweredOnEvent", "events"],
    ["govc events -type com.vmware.vc.HA.DasHostFailedEvent", "events"],
    ["govc events -json -n=10 vm/web-01 vm/web-02", "events"],
    ["govc tasks", "tasks"],
    ["govc tasks -n 20 -l /DC1/vm/web-01", "tasks"],
    ["govc metric.ls /DC1/vm/web-01", "metric.ls"],
    ["govc metric.ls -l -L -i 300 /DC1/host/Cluster1/esx-01", "metric.ls"],
    ["govc metric.sample /DC1/vm/web-01 cpu.usage.average", "metric.sample"],
    [
      "govc metric.sample -n 12 -i real -t /DC1/vm/web-01 cpu.usage.average mem.usage.average",
      "metric.sample",
    ],
    [
      "govc metric.sample -instance - vm/web-01 net.bytesTx.average",
      "metric.sample",
    ],
    [
      "govc metric.sample -instance vmnic0 -i day host/esx-01 net.bytesRx.average",
      "metric.sample",
    ],
    [
      "govc metric.sample -json -n 5 'host/Cluster1/*' cpu.usage.average",
      "metric.sample",
    ],
    [
      "govc object.collect -s /DC1/vm/web-01 runtime.powerState",
      "object.collect",
    ],
    ["govc object.collect /DC1/vm/web-01 runtime", "object.collect"],
    [
      "govc object.collect -s VirtualMachine:vm-42 summary.runtime.powerState summary.quickStats.overallCpuUsage",
      "object.collect",
    ],
    ["govc object.collect -type m / name runtime.powerState", "object.collect"],
    [
      "govc object.collect -json /DC1/host/Cluster1/esx-01 overallStatus triggeredAlarmState",
      "object.collect",
    ],
    [
      "govc object.collect -s vm/web-01 guest.toolsRunningStatus guest.guestState",
      "object.collect",
    ],
    [
      "govc object.collect -s vm/web-01 summary.overallStatus",
      "object.collect",
    ],
    ["govc object.collect -s vm/web-01 summary.quickStats", "object.collect"],
    ["govc tags.ls", "tags.ls"],
    ["govc tags.ls -c env -json", "tags.ls"],
  ])("%s is a Read", (command: string, verb: string) => {
    const result: ResourceCommandPolicyResult = govc(command);

    expect(result.tier).toBe(ResourceCommandTier.Read);
    expect(result.verb).toBe(verb);
    expect(result.program).toBe("govc");
    expect(result.targets).toEqual([]);
    expect(result.requiresHuman).toBeUndefined();
    expect(result.args).toEqual(
      tokenizeResourceCommand(command).argv!.slice(1),
    );
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.reason.endsWith(".")).toBe(false);
    expect(
      ResourceCommandPolicy.isReadOnly({ resourceType: VCENTER, command }),
    ).toBe(true);
  });

  test("a read's reason says what it shows", () => {
    expect(govc("govc vm.info web-01").reason).toContain("virtual machine");
    expect(govc("govc events").reason).toContain("events");
    expect(govc("govc about").reason).toContain("version");
  });
});

describe("SafeWrite: one named VM, a reversible power operation", () => {
  test.each([
    ["govc vm.power -on web-01", "web-01"],
    ["govc vm.power -r web-01", "web-01"],
    ["govc vm.power --on web-01", "web-01"],
    ["govc vm.power -on=true web-01", "web-01"],
    ["govc vm.power --r=true web-01", "web-01"],
    ["govc vm.power -on /DC1/vm/Prod/web-01", "/DC1/vm/Prod/web-01"],
    ["govc vm.power -dc DC1 -on web-01", "web-01"],
    ["govc vm.power -on -- web-01", "web-01"],
    ["govc vm.power -on 'Windows Server 2019'", "Windows Server 2019"],
    ["govc vm.power -r -force=false web-01", "web-01"],
    ["govc vm.power -on -off=false web-01", "web-01"],
    ["govc vm.power -on VirtualMachine:vm-42", "VirtualMachine:vm-42"],
    ["govc vm.power -on 'web;01'", "web;01"],
  ])("%s", (command: string, target: string) => {
    const result: ResourceCommandPolicyResult = govc(command);

    expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
    expect(result.verb).toBe("vm.power");
    expect(result.targets).toEqual([target]);
    expect(result.requiresHuman).toBeUndefined();
    expect(result.reason).toContain(`one virtual machine (${target})`);
  });

  test("the reasons say what happens", () => {
    expect(govc("govc vm.power -on web-01").reason).toBe(
      "powers on one virtual machine (web-01)",
    );
    expect(govc("govc vm.power -r web-01").reason).toContain(
      "gracefully through VMware Tools",
    );
  });
});

describe("RiskyWrite", () => {
  test.each([
    ["govc vm.power -s web-01", ["web-01"], "shuts down the guest OS"],
    ["govc vm.power -off web-01", ["web-01"], "powers off"],
    ["govc vm.power -off -force web-01", ["web-01"], "-force"],
    ["govc vm.power -force -off web-01", ["web-01"], "-force"],
    ["govc vm.power -reset web-01", ["web-01"], "hard-resets"],
    ["govc vm.power -reset -force web-01", ["web-01"], "-force"],
    ["govc vm.power -suspend web-01", ["web-01"], "suspends"],
    [
      "govc vm.power -on web-01 web-02",
      ["web-01", "web-02"],
      "more than one VM needs approval",
    ],
    [
      "govc vm.power -r web-01 web-02",
      ["web-01", "web-02"],
      "more than one VM needs approval",
    ],
    [
      "govc vm.power -off web-01 web-02 web-03",
      ["web-01", "web-02", "web-03"],
      "3 virtual machines (web-01, web-02, web-03)",
    ],
    // Go reads a separate "true" as an argument: two VMs, as govc sees it.
    ["govc vm.power -on true web-01", ["true", "web-01"], "2 virtual machines"],
    [
      "govc host.maintenance.exit esx-01",
      ["esx-01"],
      "out of maintenance mode",
    ],
    [
      "govc host.maintenance.exit /DC1/host/Cluster1/esx-01",
      ["/DC1/host/Cluster1/esx-01"],
      "out of maintenance mode",
    ],
    [
      "govc host.maintenance.exit -dc DC1 esx-01",
      ["esx-01"],
      "out of maintenance mode",
    ],
  ])("%s", (command: string, targets: Array<string>, mentions: string) => {
    const result: ResourceCommandPolicyResult = govc(command);

    expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(result.targets).toEqual(targets);
    expect(result.requiresHuman).toBeUndefined();
    expect(result.reason).toContain(mentions);
    expect(
      ResourceCommandPolicy.isReadOnly({ resourceType: VCENTER, command }),
    ).toBe(false);
  });
});

describe("RiskyWrite that always needs a human", () => {
  test.each([
    ["govc vm.migrate -host esx-02 web-01", ["web-01"], "host esx-02"],
    [
      "govc vm.migrate -pool /DC1/host/Cluster1/Resources/Prod web-01",
      ["web-01"],
      "resource pool /DC1/host/Cluster1/Resources/Prod",
    ],
    [
      "govc vm.migrate -ds datastore2 web-01",
      ["web-01"],
      "datastore datastore2",
    ],
    [
      "govc vm.migrate -host esx-02 -ds datastore2 web-01 web-02",
      ["web-01", "web-02"],
      "host esx-02, datastore datastore2",
    ],
    ["govc vm.migrate -dc DC1 -host=esx-02 web-01", ["web-01"], "host esx-02"],
    ["govc host.maintenance.enter esx-01", ["esx-01"], "maintenance mode"],
    [
      "govc host.maintenance.enter /DC1/host/Cluster1/esx-01",
      ["/DC1/host/Cluster1/esx-01"],
      "maintenance mode",
    ],
  ])("%s", (command: string, targets: Array<string>, mentions: string) => {
    const result: ResourceCommandPolicyResult = govc(command);

    expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(result.requiresHuman).toBe(true);
    expect(result.targets).toEqual(targets);
    expect(result.reason).toContain(mentions);
    expect(result.reason).toContain("always needs a human");
  });
});

describe("Denied commands", () => {
  test.each([
    ["govc vm.destroy web-01", "reconfigures a virtual machine"],
    ["govc vm.create -m 1024 new-vm", "reconfigures a virtual machine"],
    ["govc vm.clone -vm web-01 web-02", "reconfigures a virtual machine"],
    ["govc vm.change -vm web-01 -c 4", "reconfigures a virtual machine"],
    ["govc vm.upgrade -vm web-01", "reconfigures a virtual machine"],
    ["govc vm.register /ds/web.vmx", "reconfigures a virtual machine"],
    ["govc vm.unregister web-01", "reconfigures a virtual machine"],
    ["govc vm.markastemplate web-01", "reconfigures a virtual machine"],
    ["govc vm.customize -vm web-01", "reconfigures a virtual machine"],
    ["govc vm.question -vm web-01", "reconfigures a virtual machine"],
    ["govc vm.disk.create -vm web-01", "reconfigures a virtual machine"],
    ["govc vm.network.add -vm web-01", "reconfigures a virtual machine"],
    ["govc vm.console web-01", "console"],
    ["govc vm.vnc.enable web-01", "console"],
    ["govc vm.keystrokes -vm web-01 -s x", "console"],
    ["govc vm.guest.tools -vm web-01", "inside a VM's guest OS"],
    ["govc guest.run -vm web-01 /bin/sh", "inside a VM's guest OS"],
    ["govc guest.ls -vm web-01 /etc", "inside a VM's guest OS"],
    ["govc guest.download -vm web-01 /etc/shadow -", "inside a VM's guest OS"],
    ["govc guest.upload -vm web-01 x /tmp/x", "inside a VM's guest OS"],
    ["govc guest.start -vm web-01 /bin/rm", "inside a VM's guest OS"],
    ["govc snapshot.create -vm web-01 s1", "snapshot"],
    ["govc snapshot.revert -vm web-01 s1", "snapshot"],
    ["govc snapshot.remove -vm web-01 '*'", "snapshot"],
    ["govc snapshot.tree -vm web-01", "snapshot"],
    ["govc device.remove -vm web-01 disk-1000-0", "virtual hardware"],
    ["govc device.ls -vm web-01", "virtual hardware"],
    ["govc disk.create -size 10G d1", "virtual hardware"],
    ["govc datastore.rm web-01/web-01.vmx", "datastore files"],
    ["govc datastore.upload x.iso iso/x.iso", "datastore files"],
    ["govc datastore.download web-01/web-01.vmx -", "datastore files"],
    ["govc datastore.cp a b", "datastore files"],
    ["govc datastore.mv a b", "datastore files"],
    ["govc datastore.mkdir x", "datastore files"],
    ["govc datastore.ls", "only datastore.info is allowed"],
    ["govc datastore.tail -n 100 web-01/vmware.log", "datastore files"],
    ["govc host.remove esx-01", "ESXi host"],
    ["govc host.add -hostname esx-09", "ESXi host"],
    ["govc host.shutdown esx-01", "ESXi host"],
    ["govc host.reboot esx-01", "ESXi host"],
    ["govc host.disconnect esx-01", "ESXi host"],
    ["govc host.reconnect esx-01", "ESXi host"],
    ["govc host.esxcli system version get", "esxcli"],
    ["govc host.esxcli.model", "esxcli"],
    ["govc host.service -host esx-01 restart TSM-SSH", "ESXi host"],
    ["govc host.account.create -id x", "ESXi host"],
    ["govc host.cert.info -host esx-01", "ESXi host"],
    ["govc host.date.change -host esx-01", "ESXi host"],
    ["govc host.vswitch.add vs1", "ESXi host"],
    ["govc host.portgroup.remove pg1", "ESXi host"],
    ["govc host.autostart.add web-01", "ESXi host"],
    ["govc host.option.set Config.X 1", "ESXi host"],
    ["govc host.storage.info", "ESXi host"],
    ["govc permissions.set -principal x -role Admin", "who may do what"],
    ["govc permissions.ls", "who may do what"],
    ["govc role.create r1", "who may do what"],
    ["govc role.ls", "who may do what"],
    ["govc sso.user.create bob", "who may do what"],
    ["govc sso.service.ls", "who may do what"],
    ["govc session.ls", "who may do what"],
    ["govc session.rm key", "who may do what"],
    ["govc session.login", "who may do what"],
    ["govc license.add key", "licensing"],
    ["govc license.ls", "licensing"],
    ["govc import.ova x.ova", "in or out of vCenter"],
    ["govc import.ovf x.ovf", "in or out of vCenter"],
    ["govc export.ovf -vm web-01 .", "in or out of vCenter"],
    ["govc library.deploy lib/item vm", "in or out of vCenter"],
    ["govc library.ls", "in or out of vCenter"],
    ["govc env", "password"],
    ["govc option.set config.x 1", "advanced settings"],
    ["govc option.ls", "advanced settings"],
    ["govc object.destroy /DC1/vm/web-01", "inventory objects"],
    ["govc object.rename /DC1/vm/web-01 x", "inventory objects"],
    ["govc object.mv /DC1/vm/web-01 /DC1/vm/x", "inventory objects"],
    ["govc object.method -name Destroy_Task vm/x", "inventory objects"],
    ["govc object.reload vm/x", "inventory objects"],
  ])("%s", (command: string, mentions: string) => {
    const result: ResourceCommandPolicyResult = expectDenied(command, mentions);

    // Every refusal tells the model what it may run instead.
    expect(result.reason).toContain("vm.info");
    expect(result.reason).toContain("vm.power");
  });

  test.each([
    ["govc cluster.usage Cluster1"],
    ["govc cluster.change -drs-enabled Cluster1"],
    ["govc logs -host esx-01"],
    ["govc task.cancel task-1"],
    ["govc tags.attach env prod vm/web-01"],
    ["govc tags.create -c env prod"],
    ["govc fields.set owner x vm/web-01"],
    ["govc vapp.power -off app"],
    ["govc pool.create /DC1/host/C1/Resources/p"],
    ["govc folder.create /DC1/vm/x"],
    ["govc metric.reset vm/x"],
    ["govc extension.register x"],
    ["govc vm.power2 -on x"],
    ["govc vm.infox web-01"],
    ["govc vm web-01"],
    ["govc help"],
    ["govc vm.p\u043ewer -on web-01"], // Cyrillic "\u043e"
    ["govc constructor"],
    ["govc __proto__"],
    ["govc toString"],
    ["govc hasOwnProperty"],
  ])("%s is not a command this policy allows", (command: string) => {
    const result: ResourceCommandPolicyResult = expectDenied(
      command,
      "is not a govc command this policy allows",
    );

    expect(result.reason).toContain("read commands: about");
    expect(result.reason).toContain("changes: vm.power");
  });

  test.each([
    ["govc VM.INFO web-01", "vm.info"],
    ["govc About", "about"],
    ["govc Vm.Power -on web-01", "vm.power"],
    ["govc LS /", "ls"],
    ["govc Host.Maintenance.Enter esx-01", "host.maintenance.enter"],
  ])(
    "%s: command names are case-sensitive",
    (command: string, fixed: string) => {
      expectDenied(command, `write "${fixed}"`);
    },
  );

  test("no command at all", () => {
    expectDenied("govc", "name a govc command");
    expect(direct(["govc", ""]).reason).toContain("name a govc command");
  });
});

describe("Denied flags", () => {
  const deniedEverywhere: Array<[string, string]> = [
    ["-u https://root:pw@evil.example.com/sdk", "endpoint"],
    ["-u=https://evil/sdk", "endpoint"],
    ["--u=https://evil/sdk", "endpoint"],
    ["-k", "TLS"],
    ["-k=true", "TLS"],
    ["-cert /tmp/client.pem", "credentials"],
    ["-key /tmp/client.key", "credentials"],
    ["-tls-ca-certs /tmp/ca.pem", "TLS"],
    ["-tls-known-hosts /tmp/hosts", "TLS"],
    ["-tls-handshake-timeout 1s", "TLS"],
    ["-persist-session=false", "session"],
    ["-vim-namespace urn:vim25", "protocol"],
    ["-vim-version 8.0", "protocol"],
    ["-debug", "session cookies"],
    ["-debug.path /tmp/x", "session cookies"],
    ["-trace", "session cookies"],
    ["-verbose", "session cookies"],
    ["-dump", "every property"],
    ["-xml", "every property"],
    ["-h", "usage"],
    ["-help", "usage"],
    ["--help", "usage"],
  ];

  test.each(deniedEverywhere)(
    "govc ls %s / is refused",
    (flag: string, mentions: string) => {
      const result: ResourceCommandPolicyResult = expectDenied(
        `govc ls ${flag} /`,
        mentions,
      );

      expect(result.reason).toContain("refused on every govc command");
    },
  );

  test.each(deniedEverywhere)(
    "govc vm.power %s -on web-01 is refused",
    (flag: string, mentions: string) => {
      expectDenied(`govc vm.power ${flag} -on web-01`, mentions);
    },
  );

  test.each(deniedEverywhere)(
    "govc find -l %s . is refused",
    (flag: string, mentions: string) => {
      expectDenied(`govc find -l ${flag} .`, mentions);
    },
  );

  test.each([
    ["govc -json about", "comes before the command"],
    ["govc --json ls /", "comes before the command"],
    ["govc -dc DC1 ls", "comes before the command"],
    ["govc -- about", "comes before the command"],
    ["govc -u https://evil/sdk about", "refused on every govc command"],
    ["govc -k about", "refused on every govc command"],
    ["govc --debug=true about", "refused on every govc command"],
  ])("%s: flags before the command", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test.each([
    ["govc vm.info -e web-01", "extraConfig"],
    ["govc vm.info -e=true web-01", "extraConfig"],
    ["govc vm.info -json web-01", "EVERY property"],
    ["govc vm.info -r -json web-01", "EVERY property"],
    ["govc vm.info -waitip web-01", "IP address"],
    ["govc vm.info -vm.ipath /DC1/vm/web-01", "as an argument"],
    ["govc vm.info -vm.uuid 4210-aa", "as an argument"],
    ["govc host.info -json esx-01", "EVERY property"],
    ["govc events -f", "follows the event stream"],
    ["govc tasks -f", "follows task updates"],
    ["govc metric.sample -plot png vm/x cpu.usage.average", "gnuplot"],
    ["govc metric.sample -plot=- vm/x cpu.usage.average", "gnuplot"],
    ["govc object.collect -n 1 vm/x runtime.powerState", "waits"],
    ["govc object.collect -wait 1m vm/x runtime.powerState", "waits"],
    ["govc object.collect -R request.xml", "file"],
    ["govc object.collect -O vm/x runtime", "request"],
    ["govc object.collect -o vm/x", "structure"],
    ["govc vm.power -standby web-01", "standby"],
    ["govc vm.power -M -on web-01", "batch"],
    ["govc vm.power -wait=false -on web-01", "wait"],
    ["govc vm.power -vm.ipath /DC1/vm/web-01 -on", "as an argument"],
    ["govc vm.power -vm web-01 -on", "as an argument"],
    ["govc vm.migrate -vm.uuid x -host h", "as an argument"],
    ["govc host.maintenance.enter -evacuate esx-01", "evacuating"],
    ["govc host.maintenance.enter -host esx-01", "as the argument"],
    [
      "govc host.maintenance.exit -host.ipath /DC1/host/esx-01",
      "as the argument",
    ],
  ])(
    "%s: a flag this command has, refused",
    (command: string, mentions: string) => {
      expectDenied(command, mentions);
    },
  );

  test.each([
    ["govc ls -x /", "-x is not a flag this policy allows for govc ls"],
    ["govc ls -lL /", "-lL is not a flag"],
    ["govc ls -Li /", "-Li is not a flag"],
    ["govc ls -li /", "-li is not a flag"],
    ["govc ls -JSON /", "-JSON is not a flag"],
    ["govc ls -T VirtualMachine", "-T is not a flag"],
    ["govc about -c", "-c is not a flag this policy allows for govc about"],
    ["govc about -dc DC1", "-dc is not a flag"],
    ["govc version -json", "-json is not a flag"],
    ["govc tags.ls -dc DC1", "-dc is not a flag"],
    ["govc vm.info -a web-01", "-a is not a flag"],
    ["govc vm.power -on -json web-01", "-json is not a flag"],
    ["govc vm.power -onn web-01", "-onn is not a flag"],
    ["govc vm.power -offforce web-01", "-offforce is not a flag"],
    ["govc host.maintenance.exit -timeout 60 esx-01", "-timeout is not a flag"],
    [
      "govc vm.migrate -priority highPriority -host h web",
      "-priority is not a flag",
    ],
    ["govc events -force", "-force is not a flag"],
    ["govc tasks -r /DC1", "-r is not a flag"],
    ["govc datastore.info -H", "-H is not a flag"],
  ])("%s: unknown flags", (command: string, mentions: string) => {
    const result: ResourceCommandPolicyResult = expectDenied(command, mentions);

    // The refusal lists the flags that ARE allowed.
    expect(result.reason).toContain("which takes");
  });

  test("the unknown-flag refusal lists what the command takes", () => {
    expect(govc("govc ls -x").reason).toContain(
      "-json, -dc DATACENTER, -l, -L, -i and -t TYPE",
    );
    expect(govc("govc vm.power -x web").reason).toContain("-on");
  });

  test("a property filter before ROOT gets a hint", () => {
    expectDenied(
      "govc find -type m -runtime.powerState poweredOn",
      "property filters go after the ROOT path",
    );
  });
});

describe("flag syntax as Go's flag package reads it", () => {
  test.each([
    ["govc ls ---l /", "not valid flag syntax"],
    ["govc ls -=x /", "not valid flag syntax"],
    ["govc ls --=x /", "not valid flag syntax"],
    ["govc ls '-=' /", "not valid flag syntax"],
  ])("%s: bad syntax", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test.each([
    ["govc ls -l=yes /"],
    ["govc ls -l=1 /"],
    ["govc ls -l=TRUE /"],
    ["govc ls -l=True /"],
    ["govc ls -l=t /"],
    ["govc ls -l= /"],
    ["govc vm.power -on=1 web-01"],
    ["govc vm.power -on=on web-01"],
  ])("%s: a switch takes only =true or =false", (command: string) => {
    expectDenied(command, "is a switch");
  });

  test.each([
    ["govc ls -t", "-t needs a value"],
    ["govc events -n", "-n needs a value"],
    ["govc vm.migrate web-01 -host", "comes after the argument"],
    ["govc vm.migrate -host", "-host needs a value"],
    ["govc ls -t= /", "needs a non-empty value"],
    ["govc ls -dc '' /", "needs a non-empty value"],
    ["govc vm.migrate -ds '' web-01", "needs a non-empty value"],
  ])(
    "%s: a value flag needs its value",
    (command: string, mentions: string) => {
      expectDenied(command, mentions);
    },
  );

  test.each([
    ["govc ls -t -u /", '"-u"'],
    ["govc ls -t=-k /", '"-k"'],
    ["govc ls -dc -debug /", '"-debug"'],
    ["govc events -n -debug", '"-debug"'],
    ["govc events -n -5", '"-5"'],
    ["govc vm.migrate -host -u web-01", '"-u"'],
    ["govc vm.migrate -host=-k web-01", '"-k"'],
    ["govc vm.power -dc -k -on web-01", '"-k"'],
    ["govc metric.sample -instance -plot vm/x cpu.usage.average", '"-plot"'],
    ["govc find -name -u .", '"-u"'],
  ])(
    "%s: a denied token never hides as a flag's value",
    (command: string, shown: string) => {
      const result: ResourceCommandPolicyResult = expectDenied(
        command,
        "looks like a flag",
      );

      expect(result.reason).toContain(shown);
    },
  );

  test.each([
    ["govc events -n 0"],
    [`govc events -n ${GOVC_MAX_RECORD_COUNT + 1}`],
    ["govc events -n 010"],
    ["govc events -n 0x10"],
    ["govc events -n 1e3"],
    ["govc events -n +5"],
    ["govc events -n ' 5'"],
    ["govc tasks -n 99999999999999999999999"],
    ["govc metric.sample -n 5.5 vm/x cpu.usage.average"],
  ])("%s: counts are plain decimal from 1 to the cap", (command: string) => {
    expectDenied(command, `from 1 to ${GOVC_MAX_RECORD_COUNT}`);
  });

  test.each([
    ["govc ls -t 'Virtual Machine' /", "not a type name"],
    ["govc ls -t 9Type /", "not a type name"],
    ["govc find -type 'm;h' .", "not a type name"],
    ["govc find . -type 'Virtual Machine'", "not a type name"],
    ["govc events -type 'Vm Event'", "not an event type"],
    ["govc metric.sample -i hourly vm/x cpu.usage.average", "not an interval"],
    ["govc metric.ls -i 1d vm/x", "not an interval"],
    ["govc find -maxdepth 100 .", "not a depth"],
    ["govc find -maxdepth 01 .", "not a depth"],
  ])("%s: values are checked", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test.each([
    ["govc ls -l -l /"],
    ["govc ls -json -json=false /"],
    ["govc ls -l --l /"],
    ["govc vm.power -on -on web-01"],
    ["govc vm.power -on --on=true web-01"],
    ["govc vm.power -dc a -dc b -on web-01"],
    ["govc vm.migrate -host a -host b web-01"],
    ["govc events -n 5 -n 10"],
    ["govc find -name a . -name b"],
    [
      "govc find . -runtime.powerState poweredOn -runtime.powerState poweredOff",
    ],
    ["govc find . -name a -name b"],
  ])("%s: each flag once", (command: string) => {
    expectDenied(command, "more than once");
  });

  test("list flags govc appends to may repeat", () => {
    expect(govc("govc events -type A -type B -type C").tier).toBe(
      ResourceCommandTier.Read,
    );
    expect(govc("govc find -type m . -type h -type s").tier).toBe(
      ResourceCommandTier.Read,
    );
    expect(govc("govc object.collect -type m -type h / name").tier).toBe(
      ResourceCommandTier.Read,
    );
  });

  test.each([
    ["govc ls /DC1 -l", '"-l" comes after the argument "/DC1"'],
    ["govc vm.info web-01 -e", '"-e" comes after the argument "web-01"'],
    ["govc vm.info web-01 -json", '"-json" comes after the argument'],
    ["govc vm.power web-01 -off", '"-off" comes after the argument "web-01"'],
    ["govc vm.power -on web-01 -off", '"-off" comes after the argument'],
    ["govc vm.power -on web-01 -force", '"-force" comes after the argument'],
    ["govc vm.power -on web-01 -u https://evil/sdk", '"-u" comes after'],
    ["govc events /DC1/vm/x -n 5", '"-n" comes after'],
    ["govc host.maintenance.exit esx-01 -u x", '"-u" comes after'],
    [
      "govc metric.sample vm/x cpu.usage.average -plot png",
      '"-plot" comes after',
    ],
    ["govc datastore.info ds1 -json", '"-json" comes after'],
    ["govc vm.migrate web-01 -host esx-02", '"-host" comes after'],
    [
      "govc host.maintenance.enter esx-01 --evacuate",
      '"--evacuate" comes after',
    ],
  ])(
    "%s: govc reads flags only before the first argument",
    (command: string, mentions: string) => {
      const result: ResourceCommandPolicyResult = expectDenied(
        command,
        mentions,
      );

      expect(result.reason).toContain(
        "reads flags only before the first argument",
      );
    },
  );

  test.each([
    ["govc ls -"],
    ["govc ls -- -l"],
    ["govc vm.info -- -e"],
    ["govc vm.power -on -- -web"],
    ["govc vm.power -on -"],
    ["govc host.maintenance.exit -- -esx"],
  ])("%s: an argument that starts with - is refused", (command: string) => {
    expectDenied(command);
  });

  test("after -- a name is a name", () => {
    expect(govc("govc vm.power -on -- web-01").tier).toBe(
      ResourceCommandTier.SafeWrite,
    );
    expect(govc("govc vm.info -r -- web-01").tier).toBe(
      ResourceCommandTier.Read,
    );
  });

  test.each([
    ["govc ls ''"],
    ["govc ls / ''"],
    ["govc vm.info ''"],
    ["govc vm.power -on ''"],
    ["govc host.maintenance.exit ''"],
  ])("%s: an empty argument is refused", (command: string) => {
    expectDenied(command);
  });
});

describe("argument counts", () => {
  test.each([
    ["govc about extra", "takes no arguments"],
    ["govc version x", "takes no arguments"],
    ["govc tags.ls x", "takes no arguments"],
    ["govc host.service.ls esx-01", "takes no arguments"],
    ["govc host.date.info esx-01", "takes no arguments"],
    ["govc tasks a b", "takes at most 1 argument"],
    ["govc vm.info", "needs the VM to show"],
    ["govc vm.info -r", "needs the VM to show"],
    ["govc pool.info", "needs the pool to show"],
    ["govc metric.ls", "needs the object whose metrics"],
    ["govc metric.sample vm/x", "needs an object and at least one metric"],
    ["govc host.maintenance.enter", "exactly one host"],
    ["govc host.maintenance.enter esx-01 esx-02", "exactly one host"],
    ["govc host.maintenance.exit a b", "exactly one host"],
    ["govc vm.power -on", "needs the VM to act on"],
    ["govc vm.migrate -host h", "needs the VM to move"],
  ])("%s", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });
});

describe("vm.power semantics", () => {
  test.each([
    ["govc vm.power web-01", "needs exactly one operation"],
    ["govc vm.power -on=false web-01", "needs exactly one operation"],
    ["govc vm.power -force web-01", "needs exactly one operation"],
    ["govc vm.power -dc DC1 web-01", "needs exactly one operation"],
    ["govc vm.power -on -off web-01", "not -on and -off"],
    ["govc vm.power -r -s web-01", "not -r and -s"],
    [
      "govc vm.power -off -reset -suspend web-01",
      "not -off and -reset and -suspend",
    ],
    ["govc vm.power -on -force web-01", "-force goes only with -off or -reset"],
    ["govc vm.power -r -force web-01", "falls back to a hard reset"],
    [
      "govc vm.power -s -force web-01",
      "falls back to a hard reset or power-off",
    ],
    [
      "govc vm.power -suspend -force web-01",
      "-force goes only with -off or -reset",
    ],
    [
      "govc vm.power -force=true -r web-01",
      "-force goes only with -off or -reset",
    ],
  ])("%s", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test("an operation turned off with =false does not count", () => {
    const result: ResourceCommandPolicyResult = govc(
      "govc vm.power -off=false -reset=false -on web-01",
    );

    expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
    expect(result.reason).toContain("powers on");
  });

  test("-force=false is no force", () => {
    expect(govc("govc vm.power -on -force=false web-01").tier).toBe(
      ResourceCommandTier.SafeWrite,
    );
  });

  test("vm.migrate needs a destination", () => {
    expectDenied("govc vm.migrate web-01", "needs a destination");
    expectDenied("govc vm.migrate -dc DC1 web-01", "needs a destination");
  });
});

describe("write targets name exactly one object each", () => {
  test.each([
    ["govc vm.power -on 'web-*'", "is a pattern"],
    ["govc vm.power -on 'web-0?'", "is a pattern"],
    ["govc vm.power -on 'web-[12]'", "is a pattern"],
    ["govc vm.power -on '*'", "is a pattern"],
    ["govc vm.power -on '/DC1/vm/*/web'", "is a pattern"],
    ["govc vm.power -on 'web\\01'", "is a pattern"],
    ["govc vm.power -off 'web-*'", "is a pattern"],
    ["govc vm.power -on /DC1/vm/../web", 'a ".." path segment'],
    ["govc vm.power -on ./web", 'a "." path segment'],
    ["govc vm.power -on /DC1/vm/...", 'a "..." path segment'],
    ["govc vm.power -on /DC1//vm/web", "an empty path segment"],
    ["govc vm.power -on web/", "an empty path segment"],
    ["govc vm.power -on /", "an empty path segment"],
    ["govc vm.power -on ' web'", "leading or trailing spaces"],
    ["govc vm.power -on 'web '", "leading or trailing spaces"],
    ["govc vm.power -on web-01 web-01", "named twice"],
    ["govc vm.migrate -host 'esx-*' web-01", "is a pattern"],
    ["govc vm.migrate -ds 'ds[0-9]' web-01", "is a pattern"],
    ["govc vm.migrate -pool ../p web-01", 'a ".." path segment'],
    ["govc vm.migrate -host esx-02 'web-*'", "is a pattern"],
    ["govc host.maintenance.enter 'esx-*'", "is a pattern"],
    ["govc host.maintenance.exit 'esx-0?'", "is a pattern"],
    ["govc vm.power -dc 'DC*' -on web-01", "is a pattern"],
  ])("%s", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test("names with spaces, colons and punctuation are one object", () => {
    expect(govc("govc vm.power -on 'My VM (prod) #1'").targets).toEqual([
      "My VM (prod) #1",
    ]);
    expect(govc("govc vm.power -on 'web.example.com'").targets).toEqual([
      "web.example.com",
    ]);
    expect(
      govc("govc host.maintenance.exit esx-01.example.com").targets,
    ).toEqual(["esx-01.example.com"]);
  });

  test("reads may still use patterns", () => {
    expect(govc("govc vm.info 'web-*'").tier).toBe(ResourceCommandTier.Read);
    expect(govc("govc ls '/DC1/vm/*'").tier).toBe(ResourceCommandTier.Read);
    expect(govc("govc events '/DC1/vm/web-[12]'").tier).toBe(
      ResourceCommandTier.Read,
    );
  });
});

describe("find reads its own -KEY VALUE pairs after ROOT", () => {
  test.each([
    ["govc find . -config.extraConfig x", "not a filter this policy allows"],
    [
      "govc find . -type m -config.extraConfig.guestinfo.password '*a*'",
      "not a filter this policy allows",
    ],
    ["govc find . -summary.config.annotation '*pw*'", "not a filter"],
    ["govc find . -config.guestFullName '*'", "not a filter"],
    ["govc find . -guest.ipAddress '10.*'", "not a filter"],
    ["govc find . -Runtime.powerState poweredOn", "not a filter"],
    ["govc find . -dc DC1", "not a filter"],
    ["govc find . -l true", "not a filter"],
    ["govc find . -maxdepth 1", "not a filter"],
    ["govc find . --type m", "not a filter"],
    ["govc find . -type=m x", "not a filter"],
    ["govc find . -u https://evil/sdk", "applies it even after the ROOT path"],
    ["govc find . -k true", "applies it even after the ROOT path"],
    ["govc find . -debug true", "applies it even after the ROOT path"],
    ["govc find . -type", "has no value"],
    ["govc find . -type m -name", "has no value"],
    ["govc find . runtime.powerState poweredOn", "is not a -KEY"],
    ["govc find . /DC2", "has no value"],
    ["govc find . /DC2 /DC3", "is not a -KEY"],
    ["govc find -- -type m", "write the ROOT path"],
    ["govc find '' -type m", "needs a ROOT path"],
    ["govc find . -runtime.powerState -u", "needs a value"],
    ["govc find . -name ''", "needs a value"],
  ])("%s", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test("the filter refusal lists the allowed properties", () => {
    expect(govc("govc find . -config.extraConfig x").reason).toContain(
      "runtime[.X]",
    );
  });
});

describe("object.collect reads only allowlisted properties", () => {
  test.each([
    ["govc object.collect vm/web-01", "at least one property"],
    ["govc object.collect -s vm/web-01", "at least one property"],
    ["govc object.collect", "at least one property"],
    [
      "govc object.collect vm/web-01 config.extraConfig",
      "config.extraConfig can hold secrets",
    ],
    ["govc object.collect vm/web-01 config", "not a property"],
    ["govc object.collect vm/web-01 summary", "not a property"],
    [
      "govc object.collect vm/web-01 summary.config.annotation",
      "not a property",
    ],
    ["govc object.collect vm/web-01 guest", "not a property"],
    ["govc object.collect vm/web-01 guest.ipAddress", "not a property"],
    ["govc object.collect vm/web-01 Runtime.powerState", "not a property"],
    ["govc object.collect vm/web-01 runtime..powerState", "not a property"],
    ["govc object.collect vm/web-01 'runtime.device[0]'", "not a property"],
    [
      "govc object.collect vm/web-01 runtime.powerState config",
      "not a property",
    ],
    [
      "govc object.collect SessionManager:SessionManager sessionList",
      "not a property",
    ],
    ["govc object.collect - content", "managed object reference"],
    ["govc object.collect -- - runtime", "managed object reference"],
    ["govc object.collect '' runtime", "managed object reference"],
    [
      "govc object.collect -s vm/web-01 runtime.powerState -guest.guestOperationsReady true",
      "property filter",
    ],
  ])("%s", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test.each([
    ["name", true],
    ["overallStatus", true],
    ["summary.overallStatus", true],
    ["triggeredAlarmState", true],
    ["guest.toolsRunningStatus", true],
    ["guest.guestState", true],
    ["runtime", true],
    ["runtime.powerState", true],
    ["runtime.host", true],
    ["summary.runtime", true],
    ["summary.runtime.connectionState", true],
    ["summary.quickStats", true],
    ["summary.quickStats.guestMemoryUsage", true],
    ["config", false],
    ["config.extraConfig", false],
    ["summary", false],
    ["summary.config", false],
    ["guest", false],
    ["guest.net", false],
    ["runtimeX", false],
    ["runtime.", false],
    [".runtime", false],
    ["summary.quickStatsX", false],
    ["", false],
    ["runtime powerState", false],
  ])("isCollectableGovcProperty(%p) is %p", (property: string, ok: boolean) => {
    expect(isCollectableGovcProperty(property)).toBe(ok);
  });

  test("a non-string property is not collectable", () => {
    expect(isCollectableGovcProperty(null as unknown as string)).toBe(false);
    expect(isCollectableGovcProperty(42 as unknown as string)).toBe(false);
  });
});

describe("characters that could fool a reader", () => {
  test.each([
    ["govc vm.power \u2013on web-01", "U+2013"],
    ["govc vm.power \u2014off web-01", "U+2014"],
    ["govc vm.power \u2212off web-01", "U+2212"],
    ["govc vm.power \u2010on web-01", "U+2010"],
    ["govc vm.power \uff0don web-01", "U+FF0D"],
    ["govc vm.power \ufe63on web-01", "U+FE63"],
    ["govc ls \u2013l /", "U+2013"],
    ["govc vm.power -on \u2013force web-01", "U+2013"],
    ["govc \u2013json about", "U+2013"],
  ])("%s: a dash look-alike", (command: string, codePoint: string) => {
    const result: ResourceCommandPolicyResult = expectDenied(
      command,
      codePoint,
    );

    expect(result.reason).toContain("type a plain hyphen");
  });

  test.each([
    ["govc vm.power -on 'web\u200b01'", "U+200B"],
    ["govc vm.power -on 'web\u202e10-bew'", "U+202E"],
    ["govc vm.power -on 'web\u2066x'", "U+2066"],
    ["govc vm.power -on\ufeff web-01", "U+FEFF"],
    ["govc ls \u00ad-l /", "U+00AD"],
    ["govc vm.power -on 'web\t01'", "U+0009"],
    ["govc vm.power -on 'web\u007f'", "U+007F"],
    ["govc vm.power -on 'web\u0085'", "U+0085"],
    ["govc vm.info 'web\u200d01'", "U+200D"],
    ["govc vm.power -on 'web\u{e0041}'", "U+E0041"],
    ["govc vm.power -on 'web\u2028x'", "U+2028"],
    ["govc vm.power -on 'web\u3164'", "U+3164"],
    ["govc vm.power -on 'web\ufe0f'", "U+FE0F"],
  ])(
    "%s: an invisible or control character",
    (command: string, codePoint: string) => {
      expectDenied(command, codePoint);
    },
  );

  test("the reason never echoes the invisible character", () => {
    const result: ResourceCommandPolicyResult = govc(
      "govc vm.power -on 'web\u202e10-bew'",
    );

    expect(result.reason).not.toContain("\u202e");
    expect(result.reason).toContain("a word of the command");
  });

  test("a newline or NUL in an argv word is refused by the tool too", () => {
    expect(direct(["govc", "vm.power", "-on", "web\n01"]).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(direct(["govc", "vm.power", "-on", "web\u000001"]).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(direct(["govc", "vm.power", "-on", "web\r"]).tier).toBe(
      ResourceCommandTier.Denied,
    );
  });

  test("ordinary non-ASCII names are fine", () => {
    expect(govc("govc vm.power -on 'B\u00fcro-Server'").tier).toBe(
      ResourceCommandTier.SafeWrite,
    );
    expect(govc("govc vm.info '\u30b5\u30fc\u30d0\u30fc'").tier).toBe(
      ResourceCommandTier.Read,
    );
  });
});

describe("shell syntax, quoting and size", () => {
  test.each([
    ["govc ls | grep web", "pipe"],
    ["govc ls; govc env", "command separator"],
    [
      "govc vm.power -on web-01 && govc vm.power -off db",
      "background or chaining",
    ],
    ["govc ls > /tmp/out", "output redirect"],
    ["govc ls < /tmp/in", "input redirect"],
    ["govc ls $(whoami)", "command substitution"],
    ["govc ls `id`", "command substitution"],
    ['govc ls "$(id)"', "command substitution"],
    ["govc vm.power -on 'web", "Unbalanced quotes"],
    ["sudo govc about", "sudo"],
    ["", "Empty command"],
    ["   ", "Empty command"],
  ])("%s", (command: string, mentions: string) => {
    expectDenied(command, mentions);
  });

  test("a quoted metacharacter is part of the name", () => {
    const result: ResourceCommandPolicyResult = govc(
      "govc vm.power -on 'web|01'",
    );

    expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
    expect(result.targets).toEqual(["web|01"]);
    expect(result.displayCommand).toBe("govc vm.power -on 'web|01'");
  });

  test("double and single quotes read the same", () => {
    expect(govc('govc vm.power -on "web 01"').targets).toEqual(["web 01"]);
    expect(govc("govc vm.power -on 'web 01'").targets).toEqual(["web 01"]);
    expect(govc("govc vm.power -on web\\ 01").targets).toEqual(["web 01"]);
  });

  test("very long commands are refused", () => {
    expectDenied(`govc ls ${"a".repeat(MAX_COMMAND_LENGTH_CHARS)}`);

    const longArgv: Array<string> = [
      "govc",
      "ls",
      "b".repeat(MAX_COMMAND_LENGTH_CHARS),
    ];
    expect(direct(longArgv).tier).toBe(ResourceCommandTier.Denied);
    expect(direct(longArgv).reason).toContain("character limit");
  });

  test("too many words are refused, the maximum is fine", () => {
    const names: Array<string> = Array.from(
      { length: MAX_RESOURCE_COMMAND_TOKENS - 2 },
      (_value: unknown, index: number): string => {
        return `vm-${index}`;
      },
    );

    expect(direct(["govc", "vm.info", ...names]).tier).toBe(
      ResourceCommandTier.Read,
    );
    expect(direct(["govc", "vm.info", ...names, "one-more"]).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(direct(["govc", "vm.info", ...names, "one-more"]).reason).toContain(
      `at most ${MAX_RESOURCE_COMMAND_TOKENS} words`,
    );
  });
});

describe("targets and rendering", () => {
  test("args are the argv exactly as evaluated, never rewritten", () => {
    const result: ResourceCommandPolicyResult = govc(
      "govc vm.power --on=true web-01",
    );

    expect(result.args).toEqual(["vm.power", "--on=true", "web-01"]);
    expect(result.displayCommand).toBe("govc vm.power --on=true web-01");
  });

  test.each([
    [
      ["govc", "vm.power", "-on", "Windows Server 2019"],
      "govc vm.power -on 'Windows Server 2019'",
    ],
    [["govc", "ls", "It's"], "govc ls 'It'\\''s'"],
    [["govc", "find", ".", "-name", "web-*"], "govc find . -name 'web-*'"],
    [["govc", "vm.info", "/DC1/vm/web-01"], "govc vm.info /DC1/vm/web-01"],
    [
      [
        "govc",
        "object.collect",
        "-s",
        "VirtualMachine:vm-42",
        "runtime.powerState",
      ],
      "govc object.collect -s VirtualMachine:vm-42 runtime.powerState",
    ],
    [["govc", "vm.power", "-on", "web;01"], "govc vm.power -on 'web;01'"],
  ])(
    "%p renders as %p and round-trips",
    (argv: Array<string>, shown: string) => {
      const result: ResourceCommandPolicyResult = direct(argv);

      expect(result.tier).not.toBe(ResourceCommandTier.Denied);
      expect(result.displayCommand).toBe(shown);
      expect(tokenizeResourceCommand(shown).argv).toEqual(argv);
    },
  );

  test("a Denied command still renders", () => {
    const result: ResourceCommandPolicyResult = direct([
      "govc",
      "vm.destroy",
      "My VM",
    ]);

    expect(result.displayCommand).toBe("govc vm.destroy 'My VM'");
    expect(result.program).toBe("govc");
    expect(result.args).toEqual(["vm.destroy", "My VM"]);
    expect(result.verb).toBe("");
  });

  test("writes target their VMs and hosts, never their destinations", () => {
    expect(govc("govc vm.migrate -host esx-02 -ds ds2 web-01").targets).toEqual(
      ["web-01"],
    );
    expect(govc("govc vm.power -dc DC1 -off web-01 db-01").targets).toEqual([
      "web-01",
      "db-01",
    ]);
  });

  test("the agent's argv and the server's string agree", () => {
    const command: string =
      "govc vm.power -off -force '/DC1/vm/Prod VMs/web-01'";
    const fromString: ResourceCommandPolicyResult = govc(command);
    const fromArgv: ResourceCommandPolicyResult =
      ResourceCommandPolicy.evaluateArgv({
        resourceType: VCENTER,
        argv: tokenizeResourceCommand(command).argv!,
      });

    expect(fromArgv).toEqual(fromString);
    expect(fromString.targets).toEqual(["/DC1/vm/Prod VMs/web-01"]);
  });
});

describe("totality", () => {
  test.each([
    [[]],
    [["govc"]],
    [null],
    [undefined],
    [[1, {}, null]],
    [["govc", 42]],
    ["govc about"],
    [{ 0: "govc", 1: "about", length: 2 }],
    [["govc", "vm.power", undefined, "web"]],
  ])("the tool denies %p without throwing", (argv: unknown) => {
    const result: ResourceCommandPolicyResult = direct(argv);

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.targets).toEqual([]);
  });

  test("an argv that throws when read is Denied, not thrown", () => {
    const hostile: Array<string> = ["govc", "about"];

    Object.defineProperty(hostile, 1, {
      get(): string {
        throw new Error("boom");
      },
    });

    let result: ResourceCommandPolicyResult | undefined = undefined;

    expect(() => {
      result = direct(hostile);
    }).not.toThrow();
    expect(result!.tier).toBe(ResourceCommandTier.Denied);
  });

  test("the tool never changes the caller's argv", () => {
    const argv: Array<string> = ["govc", "vm.power", "-on", "web-01"];
    const copy: Array<string> = argv.slice();

    direct(argv);
    expect(argv).toEqual(copy);
  });

  /*
   * A deterministic fuzz over the words a model (or an attacker) would mix:
   * whatever comes out, the invariants hold and nothing throws.
   */
  test("random commands keep every invariant", () => {
    const commands: Array<string> = [
      "vm.power",
      "vm.power",
      "vm.power",
      "vm.info",
      "vm.migrate",
      "host.maintenance.enter",
      "host.maintenance.exit",
      "find",
      "object.collect",
      "ls",
      "events",
      "about",
      "env",
      "-json",
    ];
    const vocabulary: Array<string> = [
      "-on",
      "-off",
      "-r",
      "-s",
      "-reset",
      "-suspend",
      "-force",
      "-json",
      "-dc",
      "-host",
      "-ds",
      "-pool",
      "-type",
      "-name",
      "-n",
      "-l",
      "-e",
      "-u",
      "--u=x",
      "-k",
      "-debug",
      "-dump",
      "--",
      "-",
      "",
      "web-01",
      "web-02",
      "web-*",
      "/DC1/vm/web-01",
      ".",
      "runtime.powerState",
      "config.extraConfig",
      "-runtime.powerState",
      "poweredOn",
      "m",
      "5",
      "true",
      "-on=false",
      "-off=true",
      "\u2013on",
    ];
    const deniedFlag: RegExp =
      /^--?(?:u|k|cert|key|debug|trace|verbose|dump|xml|h|help|persist-session|vim-namespace|vim-version|tls-[a-z-]+)(?:=|$)/;
    let seed: number = 20260929;
    const next: () => number = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      // The high bits: an LCG's low bits repeat with a short period.
      return Math.floor(seed / 65536);
    };
    const counts: Record<string, number> = {};
    const violations: Array<string> = [];

    for (let round: number = 0; round < 10000; round++) {
      const argv: Array<string> = ["govc", commands[next() % commands.length]!];
      const length: number = next() % 5;

      for (let i: number = 0; i < length; i++) {
        argv.push(vocabulary[next() % vocabulary.length]!);
      }

      const shown: string = JSON.stringify(argv);
      let result: ResourceCommandPolicyResult;

      try {
        result = ResourceCommandPolicy.evaluateArgv({
          resourceType: VCENTER,
          argv,
        });
      } catch {
        violations.push(`${shown} threw`);
        continue;
      }

      counts[result.tier] = (counts[result.tier] || 0) + 1;

      const fail: (what: string) => void = (what: string): void => {
        violations.push(`${shown} -> ${result.tier}: ${what}`);
      };

      if (!ALL_TIERS.includes(result.tier)) {
        fail("unknown tier");
      }

      if (result.program !== "govc") {
        fail("program is not govc");
      }

      if (result.tier === ResourceCommandTier.Denied) {
        if (result.targets.length !== 0) {
          fail("a Denied result has targets");
        }

        continue;
      }

      if (JSON.stringify(result.args) !== JSON.stringify(argv.slice(1))) {
        fail("args were rewritten");
      }

      if (
        result.args.some((word: string): boolean => {
          return deniedFlag.test(word);
        })
      ) {
        fail("a denied flag got through");
      }

      if (
        result.tier === ResourceCommandTier.Read &&
        (result.targets.length !== 0 || result.requiresHuman !== undefined)
      ) {
        fail("a read has targets or requiresHuman");
      }

      if (
        result.tier === ResourceCommandTier.SafeWrite &&
        (result.verb !== "vm.power" ||
          result.targets.length !== 1 ||
          result.requiresHuman !== undefined ||
          !result.args.some((word: string): boolean => {
            return word === "-on" || word === "-r";
          }))
      ) {
        fail("a SafeWrite that is not one VM powered on or rebooted");
      }

      if (
        result.tier === ResourceCommandTier.SafeWrite ||
        result.tier === ResourceCommandTier.RiskyWrite
      ) {
        if (result.targets.length === 0) {
          fail("a write without targets");
        }

        for (const target of result.targets) {
          if (PATTERN_CHARACTERS.test(target) || target.startsWith("-")) {
            fail(`target ${target} is not one object`);
          }
        }
      }

      if (
        result.requiresHuman === true &&
        result.tier !== ResourceCommandTier.RiskyWrite
      ) {
        fail("requiresHuman on a tier other than RiskyWrite");
      }
    }

    expect(violations).toEqual([]);

    // The vocabulary reaches every tier.
    expect(counts[ResourceCommandTier.Read]).toBeGreaterThan(0);
    expect(counts[ResourceCommandTier.SafeWrite]).toBeGreaterThan(0);
    expect(counts[ResourceCommandTier.RiskyWrite]).toBeGreaterThan(0);
    expect(counts[ResourceCommandTier.Denied]).toBeGreaterThan(0);
  });
});

describe("the dispatcher's ladder for a VMware vCenter", () => {
  test("a read is AutoApproved (callers route it to the read tool)", () => {
    const verdict: ResourceAutoExecutionVerdict = autoExecution(
      "govc vm.info web-01",
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.tier).toBe(ResourceCommandTier.Read);
  });

  test("a SafeWrite runs unattended", () => {
    for (const command of [
      "govc vm.power -on web-01",
      "govc vm.power -r /DC1/vm/web-01",
    ]) {
      const verdict: ResourceAutoExecutionVerdict = autoExecution(command);

      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.AutoApproved,
      );
      expect(verdict.tier).toBe(ResourceCommandTier.SafeWrite);
    }
  });

  test("a RiskyWrite asks, unless bypassed or allowlisted", () => {
    expect(autoExecution("govc vm.power -off web-01").verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(
      autoExecution("govc vm.power -off web-01", { bypassApproval: true })
        .verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);

    const allowlisted: ResourceAutoExecutionVerdict = autoExecution(
      "govc vm.power -off web-01",
      { allowlistPatterns: ["govc vm.power -off *"] },
    );

    expect(allowlisted.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(allowlisted.reason).toBe(
      "Matched the resource's command allowlist.",
    );
    expect(
      autoExecution("govc vm.power -off web-01", {
        allowlistPatterns: ["govc vm.power -off web-02"],
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
    expect(
      autoExecution("govc host.maintenance.exit esx-01", {
        allowlistPatterns: ["govc host.maintenance.exit *"],
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    expect(autoExecution("govc vm.power -on web-01 web-02").verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
  });

  test.each([
    ["govc vm.migrate -host esx-02 web-01", "govc vm.migrate -host * *"],
    ["govc host.maintenance.enter esx-01", "govc host.maintenance.enter *"],
  ])(
    "%s always asks a human, bypass and allowlist notwithstanding",
    (command: string, pattern: string) => {
      const verdict: ResourceAutoExecutionVerdict = autoExecution(command, {
        allowlistPatterns: [pattern],
        bypassApproval: true,
      });

      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
      expect(verdict.requiresHuman).toBe(true);
      expect(verdict.reason).toContain("always needs a human");
    },
  );

  test.each([
    ["govc vm.destroy web-01"],
    ["govc -u https://evil/sdk about"],
    ["govc vm.power -on 'web-*'"],
    ["govc guest.run -vm web-01 /bin/sh"],
  ])("%s is Denied whatever the settings", (command: string) => {
    const verdict: ResourceAutoExecutionVerdict = autoExecution(command, {
      allowlistPatterns: ["govc vm.power -on *"],
      bypassApproval: true,
    });

    expect(verdict.verdict).toBe(AiRemediationCommandPolicyVerdict.Denied);
    expect(verdict.reason).toContain("cannot run even with human approval");
  });
});

describe("the allowlist for a VMware vCenter", () => {
  test("matches word for word", () => {
    const patterns: Array<string> = ["govc vm.power -off *"];

    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: VCENTER,
        command: "govc vm.power -off web-01",
        patterns,
      }),
    ).toBe(true);
    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: VCENTER,
        command: "govc vm.power -off web-01 web-02",
        patterns,
      }),
    ).toBe(false);
    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: VCENTER,
        command: "govc vm.power -off=true web-01",
        patterns,
      }),
    ).toBe(false);
    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: VCENTER,
        command: "govc vm.power -reset web-01",
        patterns,
      }),
    ).toBe(false);
  });

  test("an entry that could never pre-approve anything is skipped", () => {
    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: VCENTER,
        command: "govc ls /",
        patterns: ["govc ls *"],
      }),
    ).toBe(false);
    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: VCENTER,
        command: "govc vm.destroy web-01",
        patterns: ["govc vm.destroy *"],
      }),
    ).toBe(false);
  });

  test.each([
    ["govc vm.power -off *"],
    ["govc vm.power -on *"],
    ["govc vm.power -r *"],
    ["govc vm.power -reset -force *"],
    ["govc vm.power -s web-01"],
    ["govc vm.power -off * *"],
    ["govc host.maintenance.exit *"],
    ["govc vm.migrate -host * *"],
  ])("%s is a valid entry", (pattern: string) => {
    expect(
      ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType: VCENTER,
        pattern,
      }),
    ).toBeNull();
  });

  test.each([
    ["govc about -json", "read-only command"],
    ["govc ls *", "read-only command"],
    ["govc vm.info *", "read-only command"],
    ["govc vm.destroy *", "can never match a command that runs"],
    ["govc vm.power -off 'web-*'", "can never match a command that runs"],
    ["govc vm.power -off * -u", "can never match a command that runs"],
    ["govc vm.power -u * -off web-01", "can never match a command that runs"],
    ["govc vm.power -r -force *", "can never match a command that runs"],
    ["govc * -off web-01", "where the command goes"],
    ["govc vm.power", "fewer than two words"],
    ["ceph osd out 1", "does not start with a program"],
    ["", "cannot be blank"],
  ])("%s is refused as an entry", (pattern: string, mentions: string) => {
    expect(
      ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType: VCENTER,
        pattern,
      }),
    ).toContain(mentions);
  });

  test.each([
    ["govc vm.power -off *", true],
    ["govc vm.power -on *", true],
    ["govc host.maintenance.exit *", true],
    ["govc vm.power -off web-01", false],
    // The * is the destination, not a VM the entry lets the AI change.
    ["govc vm.migrate -host * web", false],
    ["govc ls *", false],
  ])("isBroadAllowlistPattern(%p) is %p", (pattern: string, broad: boolean) => {
    expect(
      ResourceCommandPolicy.isBroadAllowlistPattern({
        resourceType: VCENTER,
        pattern,
      }),
    ).toBe(broad);
  });
});

describe("the agent's write scope for a VMware vCenter", () => {
  function refusal(
    command: string,
    posture: {
      allowWrites?: boolean;
      writeTargets?: Array<string>;
      protectedTargets?: Array<string>;
    } = {},
  ): string | null {
    return ResourceCommandPolicy.getWriteScopeRefusal({
      result: govc(command),
      allowWrites: posture.allowWrites !== false,
      writeTargets: posture.writeTargets || [],
      protectedTargets: posture.protectedTargets || [],
      resourceType: VCENTER,
    });
  }

  test("a read is never refused", () => {
    expect(refusal("govc vm.info web-01", { allowWrites: false })).toBeNull();
  });

  test("a read-only agent refuses every change", () => {
    const message: string | null = refusal("govc vm.power -on web-01", {
      allowWrites: false,
    });

    expect(message).toContain("VMware AI agent");
    expect(message).toContain(`${RESOURCE_AI_ALLOW_WRITES_ENV}=true`);
  });

  test("any target when no write targets are set", () => {
    expect(refusal("govc vm.power -off web-01")).toBeNull();
    expect(refusal("govc host.maintenance.exit esx-01")).toBeNull();
  });

  test("write targets are globs over the names as written", () => {
    expect(
      refusal("govc vm.power -on web-01", { writeTargets: ["web-*"] }),
    ).toBeNull();
    expect(
      refusal("govc vm.power -on /DC1/vm/web-01", {
        writeTargets: ["/DC1/vm/*"],
      }),
    ).toBeNull();

    const outside: string | null = refusal("govc vm.power -on db-01", {
      writeTargets: ["web-*"],
    });

    expect(outside).toContain("db-01");
    expect(outside).toContain(RESOURCE_AI_WRITE_TARGETS_ENV);

    expect(
      refusal("govc vm.power -on web-01 db-01", { writeTargets: ["web-*"] }),
    ).toContain("db-01");
  });

  test("the agent's own VM is protected", () => {
    const message: string | null = refusal(
      "govc vm.power -off oneuptime-ai-agent",
      { protectedTargets: ["oneuptime-ai-agent"] },
    );

    expect(message).toContain("protects");
  });

  test("a Denied command is refused here too", () => {
    expect(refusal("govc vm.destroy web-01")).toContain("denied");
  });
});

describe("the guides", () => {
  test("the read guide names every read command", () => {
    for (const command of [
      "govc about",
      "govc version",
      "govc datacenter.info",
      "govc ls",
      "govc find",
      "govc vm.info",
      "govc host.info",
      "govc host.service.ls",
      "govc host.date.info",
      "govc datastore.info",
      "govc pool.info",
      "govc events",
      "govc tasks",
      "govc metric.ls",
      "govc metric.sample",
      "govc object.collect",
      "govc tags.ls",
    ]) {
      expect(GovcCommandPolicy.readCommandGuide).toContain(command);
    }

    expect(GovcCommandPolicy.readCommandGuide).toContain(
      "-json and -e are refused",
    );
    expect(GovcCommandPolicy.readCommandGuide).not.toContain("Unavailable");
    expect(GovcCommandPolicy.readCommandGuide).not.toContain("not implemented");
    expect(ResourceCommandPolicy.getReadCommandGuide(VCENTER)).toBe(
      GovcCommandPolicy.readCommandGuide,
    );
  });

  test("the write guide names every tier", () => {
    const guide: string = GovcCommandPolicy.writeCommandGuide;

    expect(guide).toContain("govc vm.power -on VM");
    expect(guide).toContain("govc vm.power -r VM");
    expect(guide).toContain("SafeWrite");
    expect(guide).toContain("RiskyWrite");
    expect(guide).toContain("always needs a human");
    expect(guide).toContain("govc host.maintenance.exit HOST");
    expect(guide).toContain("govc vm.migrate");
    expect(guide).not.toContain("not implemented");
    expect(ResourceCommandPolicy.getWriteCommandGuide(VCENTER)).toBe(guide);
  });

  test("every guide line is a markdown bullet", () => {
    for (const guide of [
      GovcCommandPolicy.readCommandGuide,
      GovcCommandPolicy.writeCommandGuide,
    ]) {
      for (const line of guide.split("\n")) {
        expect(line.startsWith("- ")).toBe(true);
      }
    }
  });

  test.each([
    [
      "govc find . -type m -runtime.powerState poweredOff",
      ResourceCommandTier.Read,
    ],
    [
      "govc object.collect -s /DC/vm/web-01 runtime.powerState",
      ResourceCommandTier.Read,
    ],
    [
      "govc metric.sample -n 12 /DC/vm/web-01 cpu.usage.average mem.usage.average",
      ResourceCommandTier.Read,
    ],
  ])(
    "the guide's example %s does what it says",
    (command: string, tier: ResourceCommandTier) => {
      expect(GovcCommandPolicy.readCommandGuide).toContain(command);
      expect(govc(command).tier).toBe(tier);
    },
  );
});

describe("govc output redaction", () => {
  function redact(text: string): string {
    return redactResourceCommandOutput({
      resourceType: VCENTER,
      program: "govc",
      text,
    });
  }

  test("govc has a hook", () => {
    expect(getResourceOutputRedactionHooks("govc").length).toBeGreaterThan(0);
  });

  test.each([
    [
      '{"key":"guestinfo.userdata","value":"I2Nsb3VkLWNvbmZpZwpwYXNzd29yZDogaHVudGVyMg"}',
      "I2Nsb3VkLWNvbmZpZwpwYXNzd29yZDogaHVudGVyMg",
    ],
    [
      '{"key":"guestinfo.metadata","value":{"_typeName":"string","_value":"instance-id: x\\nsecret-thing: hunter2"}}',
      "hunter2",
    ],
    [
      '{\n  "key": "guestinfo.vendordata",\n  "value": {\n    "_typeName": "string",\n    "_value": "c3VwZXJzZWNyZXQ"\n  }\n}',
      "c3VwZXJzZWNyZXQ",
    ],
    ['{"value":"s3cr3t-value","key":"guestinfo.ovfEnv"}', "s3cr3t-value"],
    [
      '{"value":{"_typeName":"string","_value":"abc123xyz"},"key":"guestinfo.foo"}',
      "abc123xyz",
    ],
    ['{"Key":"guestinfo.x","Value":"abcd1234"}', "abcd1234"],
    ['{"KEY": "GuestInfo.Y", "VALUE": "zyxw9876"}', "zyxw9876"],
    ['{"key":"RemoteDisplay.vnc.password","value":"vncpass1"}', "vncpass1"],
    ['{"key":"guestinfo.pin","value":987654}', "987654"],
    [
      '{"key":"guestinfo.pin","value":{"_typeName":"int","_value":424242}}',
      "424242",
    ],
    ["    guestinfo.userdata:\tI2Nsb3Vk\n", "I2Nsb3Vk"],
    ["guestinfo.hostname = web-01-secretish\n", "web-01-secretish"],
    ['Key:   "guestinfo.password",\n  Value: "hunter2",', "hunter2"],
    ['types.OptionValue{Key:"guestinfo.token", Value:"tok-9999"}', "tok-9999"],
    [
      '{"type":"UserLoginSessionEvent","sessionId":"52a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5","userName":"VSPHERE.LOCAL\\\\admin"}',
      "52a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5",
    ],
    ['{"ticket":"cst-VCT-52ab-xyz","host":"esx-01"}', "cst-VCT-52ab-xyz"],
    ['{"cloneTicket":"cst-clone-1234"}', "cst-clone-1234"],
    [
      '{"guestinfo.userdata": "I2Nsb3VkZGF0YQ", "other": "x"}',
      "I2Nsb3VkZGF0YQ",
    ],
    ['{"extraConfig":{"guestinfo.metadata":"bWV0YWRhdGE"}}', "bWV0YWRhdGE"],
  ])("masks %p", (text: string, secret: string) => {
    const redacted: string = redact(text);

    expect(redacted).not.toContain(secret);
    expect(redacted).toContain(RESOURCE_REDACTED_MARKER);
  });

  test("keeps the keys and the names that are not secret", () => {
    const text: string =
      '[{"key":"guestinfo.userdata","value":"U0VDUkVU"},{"key":"ethernet0.present","value":"TRUE"},{"key":"svga.present","value":"TRUE"}]';
    const redacted: string = redact(text);

    expect(redacted).toContain('"key":"guestinfo.userdata"');
    expect(redacted).toContain('{"key":"ethernet0.present","value":"TRUE"}');
    expect(redacted).toContain('{"key":"svga.present","value":"TRUE"}');
    expect(redacted).not.toContain("U0VDUkVU");
    expect(JSON.parse(redacted)).toHaveLength(3);
  });

  test("keeps the rest of a login event", () => {
    const redacted: string = redact(
      '{"type":"UserLoginSessionEvent","sessionId":"52a1b2c3-d4e5","userName":"admin","ipAddress":"10.0.0.9"}',
    );

    expect(redacted).toContain('"userName":"admin"');
    expect(redacted).toContain('"ipAddress":"10.0.0.9"');
    expect(redacted).not.toContain("52a1b2c3-d4e5");
  });

  test("counts what it masks and is idempotent", () => {
    const first: { text: string; redactionCount: number } =
      redactResourceCommandOutputWithCount({
        resourceType: VCENTER,
        program: "govc",
        text: '{"key":"guestinfo.a","value":"one1"}\n{"key":"guestinfo.b","value":"two2"}',
      });

    expect(first.redactionCount).toBeGreaterThanOrEqual(2);

    const second: { text: string; redactionCount: number } =
      redactResourceCommandOutputWithCount({
        resourceType: VCENTER,
        program: "govc",
        text: first.text,
      });

    expect(second.text).toBe(first.text);
    expect(second.redactionCount).toBe(0);
  });

  test("empty option values stay as they are", () => {
    const text: string = '{"key":"guestinfo.userdata","value":""}';

    expect(redact(text)).toBe(text);
  });

  test("the generic rules still run on govc output", () => {
    expect(redact("password=hunter2")).toBe("password=[redacted]");
    expect(redact('{"password":"hunter2"}')).not.toContain("hunter2");
  });

  test.each([
    [
      [
        "Name:           web-01",
        "  Path:         /DC1/vm/web-01",
        "  Guest name:   Ubuntu Linux (64-bit)",
        "  Memory:       4096MB",
        "  CPU:          2 vCPU(s)",
        "  Power state:  poweredOn",
        "  IP address:   10.0.0.5",
        "  Host:         esx-01",
      ].join("\n"),
    ],
    [
      [
        "FullName:     VMware vCenter Server 8.0.2 build-22385739",
        "Name:         VMware VirtualCenter Server",
        "Vendor:       VMware, Inc.",
        "Version:      8.0.2",
        "API type:     VirtualCenter",
        "API version:  8.0.2.0",
      ].join("\n"),
    ],
    [
      '[{"createdTime":"2026-09-29T10:00:00Z","category":"warning","message":"web-01 on esx-01 in DC1 is powered off","type":"VmPoweredOffEvent","key":4242}]',
    ],
    ["/DC1/vm/web-01\n/DC1/vm/web-02\n/DC1/host/Cluster1/esx-01"],
  ])("ordinary govc output passes through unchanged", (text: string) => {
    expect(redact(text)).toBe(text);
  });
});
