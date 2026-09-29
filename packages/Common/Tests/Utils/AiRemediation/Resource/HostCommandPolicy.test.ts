import HostCommandPolicy, {
  HOST_COMMAND_PROGRAMS,
  HOST_READABLE_FILES,
  MAX_JOURNALCTL_LINES,
  MAX_SYSTEMCTL_STATUS_LINES,
  PROTECTED_HOST_UNIT_PATTERNS,
  SYSTEMCTL_SHOW_PROPERTIES,
  canonicalSystemdUnitName,
} from "../../../../Utils/AiRemediation/Resource/HostCommandPolicy";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
  renderResourceDisplayCommand,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import {
  RESOURCE_OUTPUT_REDACTION_HOOKS,
  ResourceOutputRedaction,
  ResourceOutputRedactionHook,
  getResourceOutputRedactionHooks,
  redactResourceCommandOutput,
  redactResourceCommandOutputWithCount,
} from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — HostCommandPolicy, the tool policy for Host
 * resources (the host's own CLIs, run through nsenter by the Host AI agent).
 *
 * - Read: systemctl's read commands (show only with allowlisted -p
 *   properties), journalctl bounded by -n or --since, df, free, uptime, ps
 *   (never BSD `e`), top once in batch mode, ss, ip show/route get, dmesg,
 *   lsblk, cat of the allowlisted files, uname, hostnamectl, timedatectl.
 * - SafeWrite: one service/socket/timer/path unit restarted, started,
 *   reloaded, try-restarted, reload-or-restarted or reset-failed.
 * - RiskyWrite: stop, several units, reset-failed of every unit, journal
 *   vacuum. RiskyWrite + requiresHuman: protected units, target/mount/
 *   automount/swap units, kill.
 * - Denied: everything else, with a reason naming what IS allowed.
 * - Flags are read the way each program reads them, so combined flags,
 *   `=` forms, flags after positionals, duplicates, value-swallowing,
 *   quotes, look-alike characters, empty words and long input never hide
 *   a denied flag or target.
 * - Targets are canonical (nginx -> nginx.service, pid:N, journal), and the
 *   dispatcher's ladder, allowlist and write scope work over them.
 * - The ps/top output hook masks credentials on process command lines.
 */

function evaluate(command: string): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({
    resourceType: AiResourceType.Host,
    command,
  });
}

function argvOf(command: string): Array<string> {
  const argv: Array<string> | undefined = tokenizeResourceCommand(command).argv;

  if (!argv) {
    throw new Error(`test command does not tokenize: ${command}`);
  }

  return argv;
}

function autoExecution(
  command: string,
  allowlistPatterns: Array<string> = [],
  bypassApproval: boolean = false,
): ResourceAutoExecutionVerdict {
  return ResourceCommandPolicy.evaluateForAutoExecution({
    resourceType: AiResourceType.Host,
    command,
    allowlistPatterns,
    bypassApproval,
  });
}

function writeScope(
  command: string,
  scope: {
    allowWrites?: boolean;
    writeTargets?: Array<string>;
    protectedTargets?: Array<string>;
  } = {},
): string | null {
  return ResourceCommandPolicy.getWriteScopeRefusal({
    result: evaluate(command),
    allowWrites: scope.allowWrites ?? true,
    writeTargets: scope.writeTargets ?? [],
    protectedTargets: scope.protectedTargets ?? [],
    resourceType: AiResourceType.Host,
  });
}

// Every backticked example in a guide that starts with a host program.
function guideExamples(guide: string): Array<string> {
  const examples: Array<string> = [];
  const regex: RegExp = /`([^`]+)`/g;
  let match: RegExpExecArray | null = regex.exec(guide);

  while (match) {
    const snippet: string = match[1] || "";
    const program: string = snippet.split(" ")[0] || "";

    if (HOST_COMMAND_PROGRAMS.includes(program)) {
      examples.push(snippet);
    }

    match = regex.exec(guide);
  }

  return examples;
}

describe("the module", () => {
  test("is the host policy the dispatcher routes Host resources to", () => {
    expect(HostCommandPolicy.name).toBe("host");
    expect(ResourceCommandPolicy.getToolPolicy(AiResourceType.Host)).toBe(
      HostCommandPolicy,
    );
  });

  test("covers exactly the Host type's programs, timedatectl included", () => {
    expect([...HostCommandPolicy.programs]).toEqual([
      ...AI_RESOURCE_TYPE_INFO[AiResourceType.Host].programs,
    ]);
    expect([...HOST_COMMAND_PROGRAMS]).toEqual([...HostCommandPolicy.programs]);
    expect(HostCommandPolicy.programs).toContain("timedatectl");
    expect(HostCommandPolicy.programs).toHaveLength(16);
  });

  test("every Test connection command is Read", () => {
    for (const command of AI_RESOURCE_TYPE_INFO[AiResourceType.Host]
      .testCommands) {
      expect(evaluate(command).tier).toBe(ResourceCommandTier.Read);
      expect(
        ResourceCommandPolicy.isReadOnly({
          resourceType: AiResourceType.Host,
          command,
        }),
      ).toBe(true);
    }
  });

  test("pins the limits and the allowlists the guides describe", () => {
    expect(MAX_JOURNALCTL_LINES).toBe(2000);
    expect(MAX_SYSTEMCTL_STATUS_LINES).toBe(200);
    expect(SYSTEMCTL_SHOW_PROPERTIES).not.toContain("Environment");
    expect(SYSTEMCTL_SHOW_PROPERTIES).not.toContain("EnvironmentFiles");
    expect(SYSTEMCTL_SHOW_PROPERTIES).toContain("NRestarts");
    expect(HOST_READABLE_FILES).toContain("/proc/loadavg");
    expect(HOST_READABLE_FILES).toContain("/etc/os-release");
    expect(HOST_READABLE_FILES).not.toContain("/etc/shadow");
    expect(PROTECTED_HOST_UNIT_PATTERNS).toEqual(
      expect.arrayContaining(["sshd", "systemd-*", "docker", "ufw"]),
    );
  });

  test("the guides are compact markdown bullets naming the rules", () => {
    const read: string = HostCommandPolicy.readCommandGuide;
    const write: string = HostCommandPolicy.writeCommandGuide;

    for (const line of [...read.split("\n"), ...write.split("\n")]) {
      expect(line.startsWith("- ")).toBe(true);
    }

    for (const program of HOST_COMMAND_PROGRAMS.filter((name: string) => {
      return name !== "kill";
    })) {
      expect(read).toContain(program);
    }

    expect(read).toContain("never -f");
    expect(read).toContain(String(MAX_JOURNALCTL_LINES));
    expect(read).toContain("never Environment");
    expect(write).toContain("SafeWrite");
    expect(write).toContain("RiskyWrite");
    expect(write).toContain("Always a human");
    expect(write).toContain("Never");
    expect(write).toContain("kill");
    expect(write).toContain("nginx.service");
    expect(ResourceCommandPolicy.getReadCommandGuide(AiResourceType.Host)).toBe(
      read,
    );
    expect(
      ResourceCommandPolicy.getWriteCommandGuide(AiResourceType.Host),
    ).toBe(write);
  });

  test("every concrete example in the read guide is Read", () => {
    const examples: Array<string> = guideExamples(
      HostCommandPolicy.readCommandGuide,
    )
      .filter((snippet: string): boolean => {
        return !snippet.includes("|");
      })
      .map((snippet: string): string => {
        return snippet.replace(/\bUNIT\b/g, "nginx.service");
      });

    expect(examples.length).toBeGreaterThan(20);

    for (const example of examples) {
      expect([example, evaluate(example).tier]).toEqual([
        example,
        ResourceCommandTier.Read,
      ]);
    }
  });

  test("every concrete example in the write guide is a write", () => {
    const examples: Array<string> = guideExamples(
      HostCommandPolicy.writeCommandGuide,
    )
      .filter((snippet: string): boolean => {
        return !snippet.includes("|") && !snippet.includes("[");
      })
      .map((snippet: string): string => {
        return snippet.replace(/\bUNIT\b/g, "nginx.service");
      });

    expect(examples.length).toBeGreaterThanOrEqual(3);

    for (const example of examples) {
      expect([
        ResourceCommandTier.SafeWrite,
        ResourceCommandTier.RiskyWrite,
      ]).toContain(evaluate(example).tier);
    }
  });
});

describe("Read commands", () => {
  test.each([
    // systemctl
    ["systemctl status nginx", "status"],
    ["systemctl status nginx.service --no-pager", "status"],
    ["systemctl status", "status"],
    ["systemctl status nginx -n 50 --no-pager -l", "status"],
    ["systemctl status nginx -n50", "status"],
    ["systemctl status nginx --lines=200", "status"],
    ["systemctl status nginx -n 0", "status"],
    ["systemctl status nginx -o cat", "status"],
    ["systemctl status nginx --output=json", "status"],
    ["systemctl status getty@tty1.service postgresql", "status"],
    [
      "systemctl status 'systemd-fsck@dev-disk-by\\x2duuid-1234.service'",
      "status",
    ],
    ["systemctl --no-pager status nginx", "status"],
    ["systemctl --no-pager --no-pager status nginx", "status"],
    ["systemctl status -- nginx", "status"],
    ["systemctl is-active nginx", "is-active"],
    ["systemctl is-active --quiet nginx", "is-active"],
    ["systemctl is-failed nginx postgresql", "is-failed"],
    ["systemctl is-enabled nginx", "is-enabled"],
    ["systemctl is-system-running", "is-system-running"],
    ["systemctl list-units --failed --no-pager", "list-units"],
    [
      "systemctl list-units --type=service --state=failed,running --all",
      "list-units",
    ],
    ["systemctl list-units --type service --plain --no-legend", "list-units"],
    ["systemctl list-units 'nginx*' 'php?-fpm*'", "list-units"],
    ["systemctl list-units --state=failed --state=activating", "list-units"],
    ["systemctl list-units -o json", "list-units"],
    ["systemctl", "list-units"],
    ["systemctl --failed", "list-units"],
    ["systemctl -t service", "list-units"],
    ["systemctl list-unit-files --state=enabled", "list-unit-files"],
    ["systemctl list-timers --all", "list-timers"],
    ["systemctl list-sockets", "list-sockets"],
    ["systemctl list-jobs", "list-jobs"],
    ["systemctl list-dependencies nginx", "list-dependencies"],
    ["systemctl list-dependencies --reverse nginx", "list-dependencies"],
    ["systemctl list-dependencies", "list-dependencies"],
    ["systemctl show nginx -p ActiveState", "show"],
    ["systemctl show nginx -p ActiveState,SubState,Result,NRestarts", "show"],
    [
      "systemctl show nginx --property=MainPID --property=MemoryCurrent",
      "show",
    ],
    ["systemctl show nginx -pActiveState --value", "show"],
    ["systemctl show nginx -P ActiveState", "show"],
    ["systemctl --no-pager show nginx redis -p Id", "show"],
    [`systemctl show nginx -p ${SYSTEMCTL_SHOW_PROPERTIES.join(",")}`, "show"],
    // journalctl
    ["journalctl -u nginx -n 200 --no-pager", "logs"],
    ["journalctl -u nginx.service -n 50", "logs"],
    ["journalctl -n", "logs"],
    ["journalctl -n -u nginx", "logs"],
    ["journalctl -n50 -u nginx", "logs"],
    ["journalctl --lines=2000", "logs"],
    ["journalctl --lines 100 -u nginx", "logs"],
    ["journalctl -n +20", "logs"],
    ["journalctl -u nginx --since '1 hour ago'", "logs"],
    ["journalctl --since=-1h -p err", "logs"],
    ["journalctl --since -1h", "logs"],
    ["journalctl -S yesterday -U today", "logs"],
    [
      "journalctl --since '2024-05-01 10:00:00' --until '2024-05-01 11:00'",
      "logs",
    ],
    ["journalctl --since @1714550400", "logs"],
    ["journalctl -k -n 100", "logs"],
    ["journalctl -kn 20", "logs"],
    ["journalctl -rn20", "logs"],
    ["journalctl -b -1 -n 100", "logs"],
    ["journalctl -b -n 100", "logs"],
    ["journalctl -b-1 -n 100", "logs"],
    ["journalctl --boot=0 -n 10", "logs"],
    ["journalctl -b all -n 10", "logs"],
    ["journalctl -b 0123456789abcdef0123456789abcdef -n 10", "logs"],
    ["journalctl -b 0123456789abcdef0123456789abcdef-1 -n 10", "logs"],
    ["journalctl -p err..warning -n 100", "logs"],
    ["journalctl -p 3 -n 10", "logs"],
    ["journalctl -g 'timeout|refused' -n 100", "logs"],
    ["journalctl -o short-iso -n 10 --utc", "logs"],
    ["journalctl -o json -n 10", "logs"],
    ["journalctl -o with-unit -n 10", "logs"],
    ["journalctl -r -n 20 -x -q --no-hostname", "logs"],
    ["journalctl -t sshd -n 20", "logs"],
    ["journalctl -u nginx -u php-fpm -n 20", "logs"],
    ["journalctl -u 'nginx*' -n 20", "logs"],
    ["journalctl --list-boots", "list-boots"],
    ["journalctl --disk-usage", "disk-usage"],
    // df, free, uptime, uname
    ["df", "df"],
    ["df -h", "df"],
    ["df -hT", "df"],
    ["df -i /var", "df"],
    ["df -x tmpfs -x devtmpfs -h", "df"],
    ["df --exclude-type=overlay --total -h", "df"],
    ["df -t ext4 -P /", "df"],
    ["df -k /var/lib/docker", "df"],
    ["free", "free"],
    ["free -m", "free"],
    ["free -h -w", "free"],
    ["free --si -t", "free"],
    ["uptime", "uptime"],
    ["uptime -p", "uptime"],
    ["uptime --since", "uptime"],
    ["uname", "uname"],
    ["uname -a", "uname"],
    ["uname -rsm", "uname"],
    ["uname --kernel-release", "uname"],
    // ps, top
    ["ps", "ps"],
    ["ps aux", "ps"],
    ["ps auxww", "ps"],
    ["ps auxf", "ps"],
    ["ps axo pid,ppid,comm", "ps"],
    ["ps axopid,comm", "ps"],
    ["ps aux --sort=-%cpu", "ps"],
    ["ps aux --sort -%mem", "ps"],
    ["ps -ef", "ps"],
    ["ps -eo pid,ppid,user,%cpu,%mem,etime,stat,args --sort=-%mem", "ps"],
    ["ps -p 1234 -o pid,args", "ps"],
    ["ps -p1234,5678", "ps"],
    ["ps -u root", "ps"],
    ["ps -C nginx -L", "ps"],
    ["ps -eLf", "ps"],
    ["ps -e --no-headers -o pid", "ps"],
    ["ps -e --forest", "ps"],
    ["ps -eo pid,args:50", "ps"],
    ["ps -o 'pid comm'", "ps"],
    ["ps -e -o pid=,comm=", "ps"],
    ["ps -eww -o args", "ps"],
    ["ps -A -F -H", "ps"],
    ["top -b -n 1", "top"],
    ["top -bn1", "top"],
    ["top -b -n1 -o %MEM", "top"],
    ["top -b -n 1 -o -PID", "top"],
    ["top -b -n 1 -c -w 200", "top"],
    ["top -b -n 1 -w200", "top"],
    ["top -b -n 1 -w", "top"],
    ["top --batch-mode --iterations=1", "top"],
    ["top -H -b -n 1", "top"],
    // ss, ip
    ["ss -tulpn", "ss"],
    ["ss -s", "ss"],
    ["ss -tn state established", "ss"],
    ["ss -tlnp sport = :443", "ss"],
    ["ss -tan '( dport = :443 or sport = :443 )'", "ss"],
    ["ss -x -a", "ss"],
    ["ss -4 -t -i -m -o -e", "ss"],
    ["ss -H -t --numeric", "ss"],
    ["ip -br addr", "address show"],
    ["ip addr", "address show"],
    ["ip a", "address show"],
    ["ip addr show", "address show"],
    ["ip addr show dev eth0", "address show"],
    ["ip -4 addr show eth0", "address show"],
    ["ip address list", "address show"],
    ["ip link", "link show"],
    ["ip l", "link show"],
    ["ip -s link", "link show"],
    ["ip -s -s link show eth0", "link show"],
    ["ip -d link show", "link show"],
    ["ip --brief link", "link show"],
    ["ip route", "route show"],
    ["ip r", "route show"],
    ["ip route show table all", "route show"],
    ["ip route list", "route show"],
    ["ip -6 route ls", "route show"],
    ["ip -json route", "route show"],
    ["ip route get 1.1.1.1", "route get"],
    ["ip route get 2001:db8::1", "route get"],
    ["ip -j route get 10.0.0.5", "route get"],
    ["ip neigh", "neigh show"],
    ["ip neighbour show", "neigh show"],
    ["ip n", "neigh show"],
    ["ip rule", "rule show"],
    ["ip ru list", "rule show"],
    ["ip -j -p addr", "address show"],
    // dmesg, lsblk
    ["dmesg", "dmesg"],
    ["dmesg -T", "dmesg"],
    ["dmesg --ctime --level=err,warn", "dmesg"],
    ["dmesg -l err", "dmesg"],
    ["dmesg -Tx", "dmesg"],
    ["dmesg -k -t", "dmesg"],
    ["dmesg --level err+", "dmesg"],
    ["lsblk", "lsblk"],
    ["lsblk -f", "lsblk"],
    ["lsblk -o NAME,SIZE,TYPE,MOUNTPOINTS,FSUSE%", "lsblk"],
    ["lsblk -J -b -p", "lsblk"],
    ["lsblk -dn", "lsblk"],
    ["lsblk /dev/sda", "lsblk"],
    ["lsblk -l -a /dev/nvme0n1 /dev/mapper/vg-root", "lsblk"],
    // cat, hostnamectl, timedatectl
    ["cat /proc/loadavg", "cat"],
    ["cat /proc/meminfo /proc/loadavg", "cat"],
    [`cat ${HOST_READABLE_FILES.join(" ")}`, "cat"],
    ["hostnamectl", "status"],
    ["hostnamectl status", "status"],
    ["timedatectl", "status"],
    ["timedatectl status", "status"],
    ["timedatectl show", "show"],
    ["timedatectl timesync-status", "timesync-status"],
  ])("%s is Read (%s)", (command: string, verb: string) => {
    const argv: Array<string> = argvOf(command);
    const result: ResourceCommandPolicyResult = evaluate(command);

    expect([command, result.tier, result.reason]).toEqual([
      command,
      ResourceCommandTier.Read,
      expect.any(String),
    ]);
    expect(result.verb).toBe(verb);
    expect(result.program).toBe(argv[0]);
    expect(result.args).toEqual(argv.slice(1));
    expect(result.targets).toEqual([]);
    expect(result.requiresHuman).toBeUndefined();
    expect(result.displayCommand).toBe(renderResourceDisplayCommand(argv));
    expect(tokenizeResourceCommand(result.displayCommand).argv).toEqual(argv);
  });

  test.each(
    HOST_READABLE_FILES.map((file: string) => {
      return [file];
    }),
  )("cat %s is Read", (file: string) => {
    expect(evaluate(`cat ${file}`).tier).toBe(ResourceCommandTier.Read);
  });

  test("a read never names a target, even one that looks like a unit", () => {
    expect(evaluate("systemctl status sshd").targets).toEqual([]);
    expect(evaluate("journalctl -u docker -n 10").targets).toEqual([]);
  });
});

describe("SafeWrite: a reversible change to exactly one unit", () => {
  test.each([
    ["systemctl restart nginx", "restart", ["nginx.service"]],
    ["systemctl restart nginx.service", "restart", ["nginx.service"]],
    ["systemctl start nginx", "start", ["nginx.service"]],
    ["systemctl reload nginx", "reload", ["nginx.service"]],
    ["systemctl try-restart nginx", "try-restart", ["nginx.service"]],
    [
      "systemctl reload-or-restart nginx",
      "reload-or-restart",
      ["nginx.service"],
    ],
    ["systemctl reset-failed nginx", "reset-failed", ["nginx.service"]],
    ["systemctl restart --no-pager nginx", "restart", ["nginx.service"]],
    ["systemctl -q restart nginx", "restart", ["nginx.service"]],
    ["systemctl restart nginx --quiet", "restart", ["nginx.service"]],
    ["systemctl restart nginx nginx.service", "restart", ["nginx.service"]],
    ["systemctl restart backup.timer", "restart", ["backup.timer"]],
    ["systemctl restart cups.socket", "restart", ["cups.socket"]],
    ["systemctl start app.path", "start", ["app.path"]],
    ["systemctl restart worker@2", "restart", ["worker@2.service"]],
    ["systemctl restart php8.2-fpm", "restart", ["php8.2-fpm.service"]],
    ["systemctl restart -- nginx", "restart", ["nginx.service"]],
    ["systemctl reset-failed home.mount", "reset-failed", ["home.mount"]],
    [`systemctl "restart" "nginx"`, "restart", ["nginx.service"]],
    ["systemctl 're''start' nginx", "restart", ["nginx.service"]],
  ])(
    "%s is SafeWrite (%s %j)",
    (command: string, verb: string, targets: Array<string>) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect([command, result.tier]).toEqual([
        command,
        ResourceCommandTier.SafeWrite,
      ]);
      expect(result.verb).toBe(verb);
      expect(result.targets).toEqual(targets);
      expect(result.requiresHuman).toBeUndefined();
      expect(result.reason).toContain("one unit");
      expect(result.args).toEqual(argvOf(command).slice(1));
    },
  );
});

describe("RiskyWrite without a mandatory human", () => {
  test.each([
    ["systemctl stop nginx", ["nginx.service"]],
    ["systemctl stop backup.timer", ["backup.timer"]],
    ["systemctl restart nginx php-fpm", ["nginx.service", "php-fpm.service"]],
    ["systemctl start a b c.socket", ["a.service", "b.service", "c.socket"]],
    ["systemctl stop nginx php-fpm", ["nginx.service", "php-fpm.service"]],
    ["systemctl reset-failed", []],
    ["systemctl reset-failed nginx redis", ["nginx.service", "redis.service"]],
    ["journalctl --vacuum-time=7d", ["journal"]],
    ["journalctl --vacuum-size=500M", ["journal"]],
    ["journalctl --vacuum-files 5", ["journal"]],
    ["journalctl --vacuum-time 12h -q", ["journal"]],
    [
      "journalctl --vacuum-time=2weeks --vacuum-size=1G --no-pager",
      ["journal"],
    ],
  ])("%s is RiskyWrite %j", (command: string, targets: Array<string>) => {
    const result: ResourceCommandPolicyResult = evaluate(command);

    expect([command, result.tier]).toEqual([
      command,
      ResourceCommandTier.RiskyWrite,
    ]);
    expect(result.targets).toEqual(targets);
    expect(result.requiresHuman).toBeUndefined();
  });

  test("a vacuum is labelled and explained", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      "journalctl --vacuum-time=7d",
    );

    expect(result.verb).toBe("vacuum");
    expect(result.reason).toContain("permanently deletes archived journal");
  });

  test("stop explains that the unit stays down", () => {
    expect(evaluate("systemctl stop nginx").reason).toContain("stays down");
  });

  test("several units explain why they need approval", () => {
    expect(evaluate("systemctl restart a b").reason).toContain(
      "more than one unit",
    );
  });
});

describe("RiskyWrite that always needs a human", () => {
  test.each([
    ["systemctl restart sshd", ["sshd.service"], "protected"],
    ["systemctl restart ssh.socket", ["ssh.socket"], "protected"],
    ["systemctl stop ssh", ["ssh.service"], "protected"],
    [
      "systemctl restart sshd@1-10.0.0.1:22",
      ["sshd@1-10.0.0.1:22.service"],
      "protected",
    ],
    [
      "systemctl restart systemd-resolved",
      ["systemd-resolved.service"],
      "protected",
    ],
    [
      "systemctl restart systemd-networkd",
      ["systemd-networkd.service"],
      "protected",
    ],
    [
      "systemctl restart systemd-journald",
      ["systemd-journald.service"],
      "protected",
    ],
    ["systemctl restart dbus", ["dbus.service"], "protected"],
    ["systemctl restart dbus-broker", ["dbus-broker.service"], "protected"],
    ["systemctl reload polkit", ["polkit.service"], "protected"],
    [
      "systemctl restart NetworkManager",
      ["NetworkManager.service"],
      "protected",
    ],
    [
      "systemctl restart networkmanager",
      ["networkmanager.service"],
      "protected",
    ],
    ["systemctl restart networking", ["networking.service"], "protected"],
    ["systemctl restart getty@tty1", ["getty@tty1.service"], "protected"],
    [
      "systemctl restart serial-getty@ttyS0",
      ["serial-getty@ttyS0.service"],
      "protected",
    ],
    ["systemctl restart docker", ["docker.service"], "protected"],
    ["systemctl stop docker.socket", ["docker.socket"], "protected"],
    ["systemctl restart containerd", ["containerd.service"], "protected"],
    ["systemctl restart podman", ["podman.service"], "protected"],
    ["systemctl restart kubelet", ["kubelet.service"], "protected"],
    ["systemctl restart firewalld", ["firewalld.service"], "protected"],
    ["systemctl stop nftables", ["nftables.service"], "protected"],
    ["systemctl stop iptables", ["iptables.service"], "protected"],
    ["systemctl stop ufw", ["ufw.service"], "protected"],
    ["systemctl restart user@1000", ["user@1000.service"], "protected"],
    ["systemctl reset-failed sshd", ["sshd.service"], "protected"],
    [
      "systemctl restart nginx sshd",
      ["nginx.service", "sshd.service"],
      "protected",
    ],
    [
      "systemctl restart network-online.target",
      ["network-online.target"],
      "target",
    ],
    ["systemctl start multi-user.target", ["multi-user.target"], "target"],
    ["systemctl stop home.mount", ["home.mount"], "mount"],
    ["systemctl restart data.automount", ["data.automount"], "automount"],
    ["systemctl stop swapfile.swap", ["swapfile.swap"], "swap"],
    ["kill 1234", ["pid:1234"], "SIGTERM"],
    ["kill -TERM 1234", ["pid:1234"], "SIGTERM"],
    ["kill -SIGTERM 1234", ["pid:1234"], "SIGTERM"],
    ["kill -15 1234", ["pid:1234"], "SIGTERM"],
    ["kill -s TERM 1234", ["pid:1234"], "SIGTERM"],
    ["kill -HUP 1234", ["pid:1234"], "SIGHUP"],
    ["kill -INT 1234", ["pid:1234"], "SIGINT"],
    ["kill -KILL 1234", ["pid:1234"], "SIGKILL"],
    ["kill -9 1234", ["pid:1234"], "SIGKILL"],
    ["kill -SIGKILL 1234", ["pid:1234"], "SIGKILL"],
    ["kill -s KILL 1234", ["pid:1234"], "SIGKILL"],
    ["kill -s 9 1234", ["pid:1234"], "SIGKILL"],
    ["kill 1234 5678", ["pid:1234", "pid:5678"], "2 processes"],
    ["kill 1234 1234", ["pid:1234"], "SIGTERM"],
    ["kill 2", ["pid:2"], "SIGTERM"],
    ["kill 4194304", ["pid:4194304"], "SIGTERM"],
    [`kill "-9" 1234`, ["pid:1234"], "SIGKILL"],
  ])(
    "%s needs a human %j",
    (command: string, targets: Array<string>, mentions: string) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect([command, result.tier]).toEqual([
        command,
        ResourceCommandTier.RiskyWrite,
      ]);
      expect(result.requiresHuman).toBe(true);
      expect(result.targets).toEqual(targets);
      expect(result.reason).toContain(mentions);
    },
  );

  test("kill is labelled and never unattended", () => {
    const result: ResourceCommandPolicyResult = evaluate("kill -9 1234");

    expect(result.verb).toBe("kill");
    expect(result.reason).toContain("always needs a human");
  });
});

describe("Denied, with a reason that names what is allowed", () => {
  test.each([
    // systemctl commands
    ["systemctl enable nginx", "persistent configuration"],
    ["systemctl disable nginx", "persistent configuration"],
    ["systemctl reenable nginx", "persistent configuration"],
    ["systemctl mask nginx", "persistent configuration"],
    ["systemctl unmask nginx", "persistent configuration"],
    ["systemctl link /etc/foo.service", "persistent configuration"],
    ["systemctl revert nginx", "persistent configuration"],
    ["systemctl preset nginx", "persistent configuration"],
    ["systemctl preset-all", "persistent configuration"],
    ["systemctl set-default graphical.target", "persistent configuration"],
    ["systemctl edit nginx", "editor"],
    ["systemctl cat nginx", "secrets"],
    ["systemctl show-environment", "secrets"],
    ["systemctl set-environment FOO=bar", "secrets"],
    ["systemctl unset-environment FOO", "secrets"],
    ["systemctl import-environment", "secrets"],
    ["systemctl daemon-reload", "service manager itself"],
    ["systemctl daemon-reexec", "service manager itself"],
    ["systemctl isolate rescue.target", "stops every unit"],
    ["systemctl kill nginx", "signals every process"],
    ["systemctl set-property nginx MemoryMax=1G", "resource controls"],
    ["systemctl clean nginx", "deletes"],
    ["systemctl freeze nginx", "freezes"],
    ["systemctl poweroff", "whole host"],
    ["systemctl reboot", "whole host"],
    ["systemctl halt", "whole host"],
    ["systemctl kexec", "whole host"],
    ["systemctl soft-reboot", "whole host"],
    ["systemctl suspend", "whole host"],
    ["systemctl hibernate", "whole host"],
    ["systemctl hybrid-sleep", "whole host"],
    ["systemctl suspend-then-hibernate", "whole host"],
    ["systemctl switch-root /new", "whole host"],
    ["systemctl default", "whole host"],
    ["systemctl rescue", "whole host"],
    ["systemctl emergency", "whole host"],
    ["systemctl exit", "whole host"],
    ["systemctl help nginx", "not a systemctl command"],
    ["systemctl Restart nginx", "lowercase"],
    ["systemctl condrestart nginx", "not a systemctl command"],
    ["systemctl restar nginx", "not a systemctl command"],
    // systemctl units a write may never touch
    ["systemctl start reboot.target", "power or run-state"],
    ["systemctl start poweroff.target", "power or run-state"],
    ["systemctl restart systemd-reboot.service", "power or run-state"],
    ["systemctl start systemd-poweroff", "power or run-state"],
    ["systemctl start rescue.target", "power or run-state"],
    ["systemctl start emergency.service", "power or run-state"],
    ["systemctl start ctrl-alt-del.target", "power or run-state"],
    ["systemctl start suspend.target", "power or run-state"],
    ["systemctl start halt", "power or run-state"],
    ["systemctl start Reboot.target", "power or run-state"],
    ["systemctl restart default.target", "power or run-state"],
    ["systemctl reset-failed reboot.target", "power or run-state"],
    ["systemctl stop system.slice", "slice unit"],
    ["systemctl stop user.slice", "slice unit"],
    ["systemctl stop init.scope", "scope unit"],
    ["systemctl restart session-3.scope", "scope unit"],
    ["systemctl stop dev-sda.device", "device unit"],
    ["systemctl restart foo@", "instance"],
    ["systemctl restart foo@.service", "instance"],
    ["systemctl restart 'nginx*'", "globs"],
    ["systemctl restart 'ngin?'", "globs"],
    ["systemctl restart /etc/nginx", "unit name"],
    ["systemctl restart -- -.mount", "unit name"],
    ["systemctl restart -- --force", "unit name"],
    ["systemctl status -- --host=db1", "unit name"],
    ["systemctl restart 'nginx sshd'", "unit name"],
    ["systemctl restart", "needs the unit"],
    ["systemctl stop", "needs the unit"],
    ["systemctl status 'nginx*'", "unit name"],
    // systemctl flags
    ["systemctl -H db1 status nginx", "another machine"],
    ["systemctl --host=db1 status nginx", "another machine"],
    ["systemctl -M container status nginx", "container"],
    ["systemctl --machine=c status", "container"],
    ["systemctl --root=/mnt status", "another root"],
    ["systemctl --image=/x.img status", "disk image"],
    ["systemctl --user restart app", "user service managers"],
    ["systemctl --global enable x", "user service managers"],
    ["systemctl restart --runtime nginx", "current boot"],
    ["systemctl restart --force nginx", "safety checks"],
    ["systemctl restart -f nginx", "safety checks"],
    ["systemctl restart nginx --force", "safety checks"],
    ["systemctl -lf restart nginx", "safety checks"],
    ["systemctl stop -i nginx", "inhibitors"],
    ["systemctl restart --job-mode=isolate nginx", "queued jobs"],
    ["systemctl restart --wait nginx", "hang"],
    ["systemctl restart -s KILL nginx", "signal"],
    ["systemctl --signal=KILL restart nginx", "signal"],
    ["systemctl --now restart nginx", "enable/disable"],
    ["systemctl restart --no-block nginx", "not a systemctl flag"],
    ["systemctl status --no-pag nginx", "written in full"],
    ["systemctl status --no nginx", "written in full"],
    ["systemctl status nginx -n 500", "0 to 200"],
    ["systemctl status nginx -n all", "0 to 200"],
    ["systemctl status nginx -n=5", "0 to 200"],
    ["systemctl status nginx -n -5", 'starts with "-"'],
    ["systemctl status nginx -o verbose", "must be one of"],
    ["systemctl status nginx -o export", "must be one of"],
    ["systemctl status nginx --no-pager=1", "takes no value"],
    ["systemctl status --output", "needs a value"],
    ["systemctl list-units --state", "needs a value"],
    ["systemctl restart nginx -l", "does not apply"],
    ["systemctl restart nginx -n 5", "does not apply"],
    ["systemctl --failed restart nginx", "does not apply"],
    ["systemctl status nginx -p ActiveState", "does not apply"],
    ["systemctl status nginx -n 5 --lines=6", "only once"],
    ["systemctl show nginx", "must name the properties"],
    ["systemctl show nginx --all", "must name the properties"],
    ["systemctl show nginx -p Environment", "may only name"],
    ["systemctl show nginx -p EnvironmentFiles", "may only name"],
    ["systemctl show nginx -p ActiveState,Environment", "may only name"],
    ["systemctl show nginx --property=ExecStart", "may only name"],
    ["systemctl show nginx -P Environment", "may only name"],
    ["systemctl show nginx -p=ActiveState", "property names"],
    ["systemctl show -p ActiveState", "at least one unit"],
    ["systemctl is-active", "at least one unit"],
    ["systemctl list-dependencies a b", "at most one"],
    ["systemctl list-jobs nginx", "takes no unit names"],
    ["systemctl is-system-running nginx", "takes no unit names"],
    ["systemctl list-units --type 'service;x'", "unit types"],
    // journalctl
    ["journalctl", "must be bounded"],
    ["journalctl -u nginx", "must be bounded"],
    ["journalctl -u nginx --until today", "must be bounded"],
    ["journalctl -f", "follows the journal forever"],
    ["journalctl -u nginx -f -n 10", "follows the journal forever"],
    ["journalctl --follow -n 10", "follows the journal forever"],
    ["journalctl -fn 10", "follows the journal forever"],
    ["journalctl -rf -n 5", "follows the journal forever"],
    ["journalctl -n 10 -u nginx --follow", "follows the journal forever"],
    ["journalctl -nf", "whole number"],
    ["journalctl -n 5000", "0 to 2000"],
    ["journalctl -n 2001", "0 to 2000"],
    ["journalctl -n all", "unbounded"],
    ["journalctl --lines=all", "unbounded"],
    ["journalctl --lines=", "0 to 2000"],
    ["journalctl -n 10 -n 20", "only once"],
    ["journalctl -p err -p warning -n 5", "only once"],
    ["journalctl -D /var/log/journal -n 10", "another place"],
    ["journalctl --directory=/x -n 10", "another place"],
    ["journalctl --file /x -n 10", "another place"],
    ["journalctl -i /x -n 10", "another place"],
    ["journalctl --root=/mnt -n 10", "another place"],
    ["journalctl --image=/x.img -n 10", "another place"],
    ["journalctl -M c -n 10", "another machine"],
    ["journalctl --namespace=x -n 10", "namespace"],
    ["journalctl --rotate", "stores the journal"],
    ["journalctl --flush", "stores the journal"],
    ["journalctl --sync", "stores the journal"],
    ["journalctl --relinquish-var", "stores the journal"],
    ["journalctl --smart-relinquish-var", "stores the journal"],
    ["journalctl --setup-keys", "Sealing"],
    ["journalctl --verify", "Sealing"],
    ["journalctl --update-catalog", "catalog"],
    ["journalctl --cursor-file=/tmp/c -n 5", "cursor file"],
    ["journalctl -n 10 _PID=1", "match words"],
    ["journalctl -n 10 /usr/bin/sshd", "match words"],
    ["journalctl -n 10 -- -f", "match words"],
    ["journalctl -n 10 +", "match words"],
    ["journalctl --vacuum-time=7d -n 10", "on its own"],
    ["journalctl --vacuum-time=7d -u nginx", "on its own"],
    ["journalctl --vacuum-size=lots", "size"],
    ["journalctl --vacuum-time=forever", "time span"],
    ["journalctl --vacuum-files=0", "whole number"],
    ["journalctl -o verbose -n 10", "must be one of"],
    ["journalctl -o export -n 10", "must be one of"],
    ["journalctl -p bogus -n 10", "priority"],
    ["journalctl -u -f -n 10", 'starts with "-"'],
    ["journalctl -u --follow -n 10", 'starts with "-"'],
    ["journalctl -u=nginx -n 10", "unit name"],
    ["journalctl -u 'nginx;reboot' -n 10", "unit name"],
    ["journalctl --since=-f -n 1", "must be a time"],
    ["journalctl --since '$(reboot)' -n 1", "must be a time"],
    ["journalctl -S --follow", "must be a time"],
    ["journalctl -g '' -n 1", "1 to 256"],
    ["journalctl -b nope -n 1", "match words"],
    ["journalctl --boot=nope -n 1", "boot offset"],
    ["journalctl --no-pag -n 10", "written in full"],
    ["journalctl --user -n 10", "not a journalctl flag"],
    ["journalctl -e", "not a journalctl flag"],
    ["journalctl -a -n 10", "not a journalctl flag"],
    ["journalctl -F _CMDLINE", "not a journalctl flag"],
    ["journalctl -m -n 10", "not a journalctl flag"],
    // df, free, uptime, uname
    ["df --sync", "not a df flag"],
    ["df -B 1K", "not a df flag"],
    ["df relative/path", "absolute path"],
    ["df /var/../etc", "absolute path"],
    ["df -t 'ext4;x'", "filesystem type"],
    ["free -s 1", "repeats"],
    ["free -c 3", "repeats"],
    ["free --seconds=1", "repeats"],
    ["free -hs1", "repeats"],
    ["free extra", "takes no words"],
    ["uptime --help", "not a uptime flag"],
    ["uptime now", "takes no words"],
    ["uname -p", "not a uname flag"],
    ["uname -a extra", "takes no words"],
    // ps
    ["ps e", "environment"],
    ["ps auxe", "environment"],
    ["ps eww", "environment"],
    ["ps aux --sort=-%cpu e", "environment"],
    ["ps -aux", '(in "-aux")'],
    ["ps -o environ", "not one"],
    ["ps -o pid,environ", "not one"],
    ["ps --sort=foo", "sort keys"],
    ["ps --sort", "needs a key"],
    ["ps -p", "needs a value"],
    ["ps -p abc", "pids"],
    ["ps -p -e", "pids"],
    ["ps --cols 100", "not a ps option"],
    ["ps --format pid", "not a ps option"],
    ["ps --no-headers=1", "takes no value"],
    ["ps 1234", "not a ps option"],
    ["ps --", "not a ps option"],
    ["ps -", "not a ps option"],
    ["ps -y", "not a ps option"],
    ["ps -N", "not a ps option"],
    ["ps axk -%cpu", "not a ps option"],
    // top
    ["top", "batch mode"],
    ["top -b", "batch mode"],
    ["top -n 1", "batch mode"],
    ["top -b -n 2", "must be 1"],
    ["top -b -n 1 -d 1", "not a top flag"],
    ["top -b -n 1 -p 1", "not a top flag"],
    ["top -bn1 -d0.1", "not a top flag"],
    ["top -b -n 1 extra", "takes no words"],
    ["top -b -n 1 -w 5000", "1 to 512"],
    ["top -b -n1 -n1", "only once"],
    ["top -b -n 1 -o 'bad field'", "field name"],
    // ss
    ["ss -K", "forcibly closes"],
    ["ss --kill", "forcibly closes"],
    ["ss -tK", "forcibly closes"],
    ["ss -tunlpK", "forcibly closes"],
    ["ss -D /tmp/x", "to a file"],
    ["ss -F /tmp/f", "from a file"],
    ["ss -N ns1", "network namespace"],
    ["ss -E", "streams"],
    ["ss -tnp -A all", "not a ss flag"],
    ["ss -tn '$(reboot)'", "filter expression"],
    // ip
    ["ip addr add 10.0.0.1/24 dev eth0", "changes the host's network"],
    ["ip link set eth0 down", "changes the host's network"],
    ["ip route del default", "changes the host's network"],
    ["ip route flush table main", "changes the host's network"],
    ["ip neigh flush all", "changes the host's network"],
    ["ip rule add from all lookup 100", "changes the host's network"],
    ["ip route save", "changes the host's network"],
    ["ip route replace default via 10.0.0.1", "changes the host's network"],
    ["ip -b cmds.txt", "-batch"],
    ["ip -batch cmds.txt", "-batch"],
    ["ip --batch cmds.txt", "-batch"],
    ["ip -ba cmds.txt", "-batch"],
    ["ip -force -b x", "-force"],
    ["ip -n ns1 addr", "-netns"],
    ["ip -netns ns1 addr", "-netns"],
    ["ip -net ns1 addr", "-netns"],
    ["ip netns exec ns1 sh", "network namespaces"],
    ["ip netns list", "network namespaces"],
    ["ip xfrm state", "IPsec keys"],
    ["ip monitor", "streams"],
    ["ip tunnel", "not an object"],
    ["ip maddr", "not an object"],
    ["ip addr sh", "not an ip address read"],
    ["ip link lst", "not an ip link read"],
    ["ip route get", "exactly one IP address"],
    ["ip route get 1.1.1.1 from 10.0.0.1", "exactly one IP address"],
    ["ip route get example.com", "exactly one IP address"],
    ["ip", "needs an object"],
    ["ip -br", "needs an object"],
    ["ip -- addr", 'no "--"'],
    ["ip -r addr", "not an ip option"],
    ["ip -family inet addr", "not an ip option"],
    ["ip -o addr", "not an ip option"],
    ["ip -bri addr", "not an ip option"],
    ["ip addr show -4", "filter word"],
    ["ip addr show dev 'eth0;reboot'", "filter word"],
    // dmesg, lsblk
    ["dmesg -w", "forever"],
    ["dmesg --follow", "forever"],
    ["dmesg -W", "forever"],
    ["dmesg -Tw", "forever"],
    ["dmesg -c", "clears"],
    ["dmesg -C", "clears"],
    ["dmesg --clear", "clears"],
    ["dmesg -Tc", "clears"],
    ["dmesg -n 1", "console"],
    ["dmesg -D", "console"],
    ["dmesg -E", "console"],
    ["dmesg -F /var/log/x", "reads a file"],
    ["dmesg -H", "pager"],
    ["dmesg -l bogus", "levels"],
    ["dmesg extra", "takes no words"],
    ["lsblk --sysroot /mnt", "another root"],
    ["lsblk -o 'NAME;X'", "column names"],
    ["lsblk sda", "/dev device path"],
    ["lsblk /dev/../etc/shadow", "/dev device path"],
    ["lsblk -S", "not a lsblk flag"],
    // cat
    ["cat /etc/shadow", "may not read"],
    ["cat /proc/self/environ", "may not read"],
    ["cat /proc/1/environ", "may not read"],
    ["cat /proc/../etc/shadow", "may not read"],
    ["cat /proc//loadavg", "may not read"],
    ["cat /PROC/loadavg", "may not read"],
    ["cat /proc/loadavg /etc/shadow", "may not read"],
    ["cat '/proc/loadavg /etc/shadow'", "may not read"],
    ["cat -A /proc/loadavg", "takes no flags"],
    ["cat -- /proc/loadavg", "takes no flags"],
    ["cat - /proc/loadavg", "takes no flags"],
    ["cat", "needs a file"],
    // hostnamectl, timedatectl
    ["hostnamectl set-hostname evil", "never changed"],
    ["hostnamectl hostname new", "never changed"],
    ["hostnamectl status extra", "never changed"],
    ["hostnamectl --json=short", "takes no flags"],
    ["hostnamectl -H db1", "takes no flags"],
    ["timedatectl set-time '2024-01-01 10:00'", "never changed"],
    ["timedatectl set-timezone UTC", "never changed"],
    ["timedatectl set-ntp false", "never changed"],
    ["timedatectl list-timezones", "never changed"],
    ["timedatectl -H db1 status", "takes no flags"],
    // kill
    ["kill 1", "init system"],
    ["kill -9 1", "init system"],
    ["kill 1234 1", "init system"],
    ["kill 0", "not a pid"],
    ["kill -9 -1", "process group"],
    ["kill -- -1234", "process group"],
    ["kill -TERM -- 1234", "process group"],
    ["kill -9 1234 -15", "process group"],
    ["kill -STOP 1234", "not a signal"],
    ["kill -19 1234", "not a signal"],
    ["kill -1 1234", "not a signal"],
    ["kill -term 1234", "not a signal"],
    ["kill -s STOP 1234", "allowed signals"],
    ["kill -s", "allowed signals"],
    ["kill -l", "not a signal"],
    ["kill -L", "not a signal"],
    ["kill --signal KILL 1234", "not a signal"],
    ["kill", "needs the pid"],
    ["kill -9", "needs the pid"],
    ["kill abc", "not a pid"],
    ["kill 0123", "not a pid"],
    ["kill 4194305", "not a pid"],
    ["kill 99999999", "not a pid"],
    ["kill %1", "not a pid"],
    ["kill 12.5", "not a pid"],
  ])("%s is Denied (%s)", (command: string, fragment: string) => {
    const result: ResourceCommandPolicyResult = evaluate(command);

    expect([command, result.tier]).toEqual([
      command,
      ResourceCommandTier.Denied,
    ]);
    expect(result.reason).toContain(fragment);
    expect(result.targets).toEqual([]);
    expect(result.requiresHuman).toBeUndefined();
  });

  test.each([
    ["systemctl enable nginx", "systemctl reads with status"],
    ["journalctl -f", "journalctl reads with -u UNIT"],
    ["df --sync", "df takes -h"],
    ["free -s 1", "free takes -b"],
    ["uptime -x", "uptime takes -p"],
    ["ps e", "ps takes BSD options"],
    ["top", "top runs once in batch mode"],
    ["ss -K", "ss takes -t"],
    ["ip link set eth0 down", "ip takes -br"],
    ["dmesg -c", "dmesg takes -T"],
    ["lsblk --sysroot /", "lsblk takes -f"],
    ["cat /etc/shadow", "/proc/loadavg"],
    ["uname -p", "uname takes -a"],
    ["hostnamectl set-hostname x", "hostnamectl runs as"],
    ["timedatectl set-ntp no", "timedatectl runs as"],
    ["kill 1", "kill takes at most one signal"],
  ])(
    "the refusal of %s names what is allowed",
    (command: string, allowed: string) => {
      expect(evaluate(command).reason).toContain(allowed);
    },
  );

  test.each([
    ["bash -c id", "not a program the Host AI agent runs"],
    ["sh", "not a program the Host AI agent runs"],
    ["rm -rf /", "not a program the Host AI agent runs"],
    ["nsenter -t 1 -m sh", "not a program the Host AI agent runs"],
    ["docker ps", "not a program the Host AI agent runs"],
    ["tail -f /var/log/syslog", "not a program the Host AI agent runs"],
    ["SYSTEMCTL status nginx", "not a program the Host AI agent runs"],
    ["/usr/bin/systemctl status nginx", "without a path"],
    ["sudo systemctl restart nginx", "own permissions"],
    ["systemctl status nginx | grep x", "pipes and redirects"],
    ["journalctl -n 10 > /tmp/x", "pipes and redirects"],
    ["systemctl status nginx; reboot", "pipes and redirects"],
    ["systemctl status $(reboot)", "pipes and redirects"],
    ["systemctl status `reboot`", "pipes and redirects"],
    ["kill 1234 &", "pipes and redirects"],
  ])(
    "%s is Denied before the host policy reads it",
    (command: string, fragment: string) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.Denied);
      expect(result.reason).toContain(fragment);
    },
  );

  test("the host policy itself refuses a program it does not know", () => {
    const result: ResourceCommandPolicyResult = HostCommandPolicy.evaluateArgv([
      "bash",
      "-c",
      "id",
    ]);

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.reason).toContain("never a path");
    expect(result.reason).toContain("systemctl");
  });
});

describe("flags cannot be smuggled past the policy", () => {
  test.each([
    // A denied flag inside a cluster of allowed ones.
    ["journalctl -rxf -n 5"],
    ["journalctl -kqf -n 5"],
    ["systemctl -qf restart nginx"],
    ["dmesg -xTw"],
    ["ss -tulnpK"],
    ["free -mhs2"],
    // After positionals (GNU getopt permutes).
    ["systemctl restart nginx --force"],
    ["systemctl status nginx -H db1"],
    ["journalctl -n 10 -u nginx -f"],
    ["df -h / --sync"],
    // Written with = or attached.
    ["systemctl --host=db1 status nginx"],
    ["systemctl -Hdb1 status nginx"],
    ["journalctl --directory=/tmp -n 1"],
    ["journalctl -D/tmp -n 1"],
    ["dmesg --console-level=1"],
    // As the value of a flag that takes one.
    ["journalctl -u -f -n 10"],
    ["journalctl -t --follow -n 10"],
    ["systemctl list-units --type -H"],
    ["systemctl status nginx -o -f"],
    ["ps -o -e"],
    ["ps -C -e"],
    // Behind "--".
    ["systemctl restart -- --force"],
    ["journalctl -n 1 -- --follow"],
    ["kill -- -1"],
    // Abbreviated long flags getopt_long would resolve.
    ["journalctl --foll -n 1"],
    ["journalctl --direc=/tmp -n 1"],
    ["systemctl --ho=db1 status"],
    ["systemctl restart --forc nginx"],
    ["dmesg --cl"],
    // Abbreviations ip resolves by prefix.
    ["ip -b x"],
    ["ip -n ns addr"],
    ["ip -fo addr"],
    // Duplicated so an earlier harmless value hides a later bad one.
    ["journalctl -n 10 -n all"],
    ["top -b -n 1 -n 5"],
    ["systemctl status nginx -n 5 -n 900"],
    ["journalctl -o short -o export -n 1"],
    // Quotes are shell syntax, never a way around a flag check.
    [`journalctl "-f" -n 5`],
    [`journalctl '--follow' -n 5`],
    [`systemctl restart "--force" nginx`],
    [`systemctl "--host=db1" status`],
    [`kill "-9" "-1"`],
  ])("%s is Denied", (command: string) => {
    expect(evaluate(command).tier).toBe(ResourceCommandTier.Denied);
  });

  test("a switch may repeat harmlessly, a value flag may not", () => {
    expect(evaluate("systemctl status -l -l nginx").tier).toBe(
      ResourceCommandTier.Read,
    );
    expect(evaluate("ps -ww -e").tier).toBe(ResourceCommandTier.Read);
    expect(evaluate("journalctl -u a -u b -n 5").tier).toBe(
      ResourceCommandTier.Read,
    );
    expect(evaluate("journalctl -n 5 --lines 6").reason).toContain("only once");
  });

  test("an Optional value is taken from the next word only when the program would", () => {
    // journalctl -n takes "50" (a line count) but not "-u" (another flag).
    expect(evaluate("journalctl -n 50 -u nginx").tier).toBe(
      ResourceCommandTier.Read,
    );
    expect(evaluate("journalctl -n -u nginx").tier).toBe(
      ResourceCommandTier.Read,
    );
    // -b takes "-1" (a boot offset) but not "-n".
    expect(evaluate("journalctl -b -1 -n 5").tier).toBe(
      ResourceCommandTier.Read,
    );
    expect(evaluate("journalctl -b -n 5").tier).toBe(ResourceCommandTier.Read);
    // Not a boot: stays a word, and journalctl takes no words.
    expect(evaluate("journalctl -b nginx -n 5").reason).toContain(
      "match words",
    );
    // top -w takes a width only when the next word is a number.
    expect(evaluate("top -b -n 1 -w 120").tier).toBe(ResourceCommandTier.Read);
    expect(evaluate("top -b -n 1 -w -c").tier).toBe(ResourceCommandTier.Read);
  });

  test('getopt reads -n=5 as the value "=5", and so does the policy', () => {
    expect(evaluate("journalctl -n=5").reason).toContain('"=5"');
    expect(evaluate("systemctl status x -n=5").reason).toContain('"=5"');
  });
});

describe("look-alike characters, empty words, quotes and long input", () => {
  test.each([
    ["journalctl -u nginx \u2014follow -n 10"],
    ["journalctl -u nginx \u2212f -n 10"],
    ["journalctl -u nginx \u2013f -n 10"],
    ["systemctl restart ngin\u0445"],
    ["systemctl restart nginx\u200b"],
    ["kill \uff11\uff12\uff13\uff14"],
    ["cat /proc/loadavg\u00a0/etc/shadow"],
    ["systemctl \uff52estart nginx"],
    ["ps aux\u0435"],
  ])("%p is Denied as non-ASCII", (command: string) => {
    const result: ResourceCommandPolicyResult = evaluate(command);

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.reason).toMatch(/printable ASCII|not a program/);
  });

  test("a look-alike program name never reaches the policy", () => {
    expect(evaluate("systemct\u04cf status nginx").reason).toContain(
      "not a program",
    );
  });

  test("a control character inside a word is refused", () => {
    expect(
      HostCommandPolicy.evaluateArgv(["systemctl", "status", "ng\tinx"]).reason,
    ).toContain("printable ASCII");
    expect(HostCommandPolicy.evaluateArgv(["kill", "12\u00073"]).tier).toBe(
      ResourceCommandTier.Denied,
    );
  });

  test.each([
    [["systemctl", "restart", ""]],
    [["systemctl", "status", ""]],
    [["systemctl", ""]],
    [["journalctl", "-n", "10", ""]],
    [["journalctl", "-u", "", "-n", "1"]],
    [["kill", ""]],
    [["kill", "-9", ""]],
    [["cat", ""]],
    [["ps", ""]],
    [["ip", ""]],
    [["df", ""]],
    [["uptime", ""]],
    [["lsblk", ""]],
    [["top", "-b", "-n", ""]],
    [["hostnamectl", ""]],
  ])("an empty word is Denied: %j", (argv: Array<string>) => {
    expect(
      ResourceCommandPolicy.evaluateArgv({
        resourceType: AiResourceType.Host,
        argv,
      }).tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(HostCommandPolicy.evaluateArgv(argv).tier).toBe(
      ResourceCommandTier.Denied,
    );
  });

  test.each([[""], ["   "], ["''"]])("%p is Denied", (command: string) => {
    expect(evaluate(command).tier).toBe(ResourceCommandTier.Denied);
  });

  test("quoted values are one word, rendered back with quotes", () => {
    const since: ResourceCommandPolicyResult = evaluate(
      'journalctl -u nginx --since "2024-05-01 10:00:00" -n 100',
    );

    expect(since.tier).toBe(ResourceCommandTier.Read);
    expect(since.args).toContain("2024-05-01 10:00:00");
    expect(since.displayCommand).toBe(
      "journalctl -u nginx --since '2024-05-01 10:00:00' -n 100",
    );

    const grep: ResourceCommandPolicyResult = evaluate(
      'journalctl -g "a|b" -n 5',
    );

    expect(grep.tier).toBe(ResourceCommandTier.Read);
    expect(grep.displayCommand).toBe("journalctl -g 'a|b' -n 5");
    expect(tokenizeResourceCommand(grep.displayCommand).argv).toEqual([
      "journalctl",
      "-g",
      "a|b",
      "-n",
      "5",
    ]);
  });

  test("very long input is refused, never slow and never thrown", () => {
    expect(evaluate(`journalctl -n 1 -g ${"a".repeat(3000)}`).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(
      HostCommandPolicy.evaluateArgv([
        "journalctl",
        "-n",
        "10",
        "-g",
        "a".repeat(10000),
      ]).reason,
    ).toContain("1 to 256");
    expect(
      HostCommandPolicy.evaluateArgv(["systemctl", "status", "a".repeat(300)])
        .tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(
      HostCommandPolicy.evaluateArgv(["ps", "-o", `${"pid,".repeat(200)}pid`])
        .tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(
      HostCommandPolicy.evaluateArgv([
        "systemctl",
        "list-units",
        `${"*a".repeat(5000)}b`,
      ]).tier,
    ).toBe(ResourceCommandTier.Denied);

    const started: number = Date.now();
    const many: Array<string> = ["kill", ...new Array(5000).fill("1234")];

    expect(HostCommandPolicy.evaluateArgv(many).targets).toEqual(["pid:1234"]);
    expect(
      ResourceCommandPolicy.evaluateArgv({
        resourceType: AiResourceType.Host,
        argv: many,
      }).tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test.each([
    [["df", `/${"a".repeat(50000)}!`]],
    [["df", `/${"a/".repeat(20000)}!`]],
    [["lsblk", `/dev/${"a".repeat(50000)}!`]],
    [["journalctl", "-n", "1", "--since", `${"1".repeat(50000)}!`]],
    [["ps", "-p", `${"1,".repeat(20000)}x`]],
    [["ps", "-u", `${"a,".repeat(20000)}!`]],
    [["ss", `${"a".repeat(50000)}$`]],
    [["ip", "route", "get", `${"1".repeat(50000)}`]],
    [["systemctl", "list-units", `${"a".repeat(50000)}!`]],
  ])(
    "a long pathological word is refused quickly: %#",
    (argv: Array<string>) => {
      const started: number = Date.now();

      expect(HostCommandPolicy.evaluateArgv(argv).tier).toBe(
        ResourceCommandTier.Denied,
      );
      expect(Date.now() - started).toBeLessThan(1000);
    },
  );
});

describe("totality", () => {
  test.each([
    [null],
    [undefined],
    [[]],
    [[1, {}, null]],
    [["systemctl", 7]],
    [["kill", null]],
    ["systemctl status"],
    [{ length: 3 }],
  ])("%p is Denied without throwing", (argv: unknown) => {
    const result: ResourceCommandPolicyResult = HostCommandPolicy.evaluateArgv(
      argv as Array<string>,
    );

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.targets).toEqual([]);
  });

  test("never throws for any program with odd words", () => {
    const oddWords: Array<string> = [
      "",
      "-",
      "--",
      "---",
      "-=",
      "--=",
      "=",
      "-\\",
      "'",
      "*",
      "-*",
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ];

    for (const program of [...HOST_COMMAND_PROGRAMS, "__proto__", "toString"]) {
      for (const word of oddWords) {
        for (const argv of [
          [program, word],
          [program, word, word],
          [program, "-n", word],
          [program, word, "-n"],
        ]) {
          const result: ResourceCommandPolicyResult =
            HostCommandPolicy.evaluateArgv(argv);

          expect(typeof result.reason).toBe("string");
          expect(result.reason.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("prototype names are never programs or verbs", () => {
    for (const command of [
      ["__proto__"],
      ["constructor"],
      ["systemctl", "__proto__"],
      ["systemctl", "constructor", "x"],
      ["systemctl", "toString"],
      ["ip", "__proto__"],
      ["ip", "constructor"],
      ["kill", "-constructor", "1234"],
      ["kill", "-s", "__proto__", "1234"],
      ["ps", "-__proto__"],
    ]) {
      expect(HostCommandPolicy.evaluateArgv(command).tier).toBe(
        ResourceCommandTier.Denied,
      );
    }
  });

  test("the caller's argv is never changed", () => {
    const argv: Array<string> = ["systemctl", "restart", "nginx"];

    HostCommandPolicy.evaluateArgv(argv);

    expect(argv).toEqual(["systemctl", "restart", "nginx"]);
  });
});

describe("canonical unit names", () => {
  test.each([
    ["nginx", "nginx.service"],
    ["nginx.service", "nginx.service"],
    ["backup.timer", "backup.timer"],
    ["cups.socket", "cups.socket"],
    ["app.path", "app.path"],
    ["home.mount", "home.mount"],
    ["data.automount", "data.automount"],
    ["swapfile.swap", "swapfile.swap"],
    ["multi-user.target", "multi-user.target"],
    ["system.slice", "system.slice"],
    ["init.scope", "init.scope"],
    ["dev-sda.device", "dev-sda.device"],
    ["php8.2-fpm", "php8.2-fpm.service"],
    ["getty@tty1", "getty@tty1.service"],
    ["nginx.foo", "nginx.foo.service"],
    ["worker@2.service", "worker@2.service"],
  ])("%s -> %s", (name: string, canonical: string) => {
    expect(canonicalSystemdUnitName(name)).toBe(canonical);
  });
});

describe("through the dispatcher's ladder, allowlist and write scope", () => {
  test("reads are auto-approved and change nothing", () => {
    const verdict: ResourceAutoExecutionVerdict = autoExecution(
      "systemctl status nginx",
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.tier).toBe(ResourceCommandTier.Read);
  });

  test("one unit restarted runs unattended", () => {
    const verdict: ResourceAutoExecutionVerdict = autoExecution(
      "systemctl restart nginx",
    );

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdict.tier).toBe(ResourceCommandTier.SafeWrite);
  });

  test("a stop needs approval unless allowlisted or bypassed", () => {
    expect(autoExecution("systemctl stop nginx").verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(
      autoExecution("systemctl stop nginx", ["systemctl stop nginx"]).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    expect(
      autoExecution("systemctl stop nginx", ["systemctl stop *"]).reason,
    ).toBe("Matched the resource's command allowlist.");
    expect(autoExecution("systemctl stop nginx", [], true).verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(
      autoExecution("systemctl stop nginx.service", ["systemctl stop nginx"])
        .verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
    expect(
      autoExecution("systemctl stop nginx php-fpm", ["systemctl stop *"])
        .verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
  });

  test.each([
    [
      "systemctl restart sshd",
      ["systemctl restart sshd", "systemctl restart *"],
    ],
    ["systemctl start multi-user.target", ["systemctl start *"]],
    ["kill -9 1234", ["kill -9 *", "kill -9 1234"]],
    ["kill 1234", ["kill 1234 *"]],
  ])(
    "%s needs a human whatever the mode or allowlist",
    (command: string, allowlist: Array<string>) => {
      const verdict: ResourceAutoExecutionVerdict = autoExecution(
        command,
        allowlist,
        true,
      );

      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
      expect(verdict.requiresHuman).toBe(true);
    },
  );

  test("Denied commands stay Denied whoever approves them", () => {
    for (const command of [
      "systemctl reboot",
      "systemctl start reboot.target",
      "journalctl -f",
      "kill 1",
      "cat /etc/shadow",
    ]) {
      const verdict: ResourceAutoExecutionVerdict = autoExecution(
        command,
        [command],
        true,
      );

      expect(verdict.verdict).toBe(AiRemediationCommandPolicyVerdict.Denied);
      expect(verdict.reason).toContain("cannot run even with human approval");
    }
  });

  test("a journal vacuum can be allowlisted when its value is its own word", () => {
    expect(
      ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType: AiResourceType.Host,
        pattern: "journalctl --vacuum-time 7d",
      }),
    ).toBeNull();
    expect(
      autoExecution("journalctl --vacuum-time 7d", [
        "journalctl --vacuum-time 7d",
      ]).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    expect(
      ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType: AiResourceType.Host,
        pattern: "journalctl --vacuum-time=7d",
      }),
    ).toContain("fewer than two words");
  });

  test.each([
    ["systemctl stop *", null],
    ["systemctl restart *", null],
    ["systemctl stop * *", null],
    ["journalctl --vacuum-time *", null],
    ["systemctl status *", "read-only command"],
    ["journalctl -n *", "read-only command"],
    ["systemctl * nginx", "where the command goes"],
    ["systemctl isolate rescue.target", "can never match a command that runs"],
    ["journalctl -u *", "can never match a command that runs"],
    ["docker restart web", "does not start with a program"],
    ["systemctl reboot", "fewer than two words"],
  ])("allowlist entry %p: %p", (pattern: string, problem: string | null) => {
    const described: string | null =
      ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType: AiResourceType.Host,
        pattern,
      });

    if (problem === null) {
      expect(described).toBeNull();
    } else {
      expect(described).toContain(problem);
    }
  });

  test.each([
    ["systemctl stop *", true],
    ["systemctl restart * nginx", true],
    ["kill -9 *", true],
    ["systemctl stop nginx", false],
    ["journalctl --vacuum-time *", false],
    ["systemctl status *", false],
  ])("allowlist entry %p is broad: %p", (pattern: string, broad: boolean) => {
    expect(
      ResourceCommandPolicy.isBroadAllowlistPattern({
        resourceType: AiResourceType.Host,
        pattern,
      }),
    ).toBe(broad);
  });

  test("matchesAllowlist compares word by word", () => {
    const matches: (command: string, patterns: Array<string>) => boolean = (
      command: string,
      patterns: Array<string>,
    ): boolean => {
      return ResourceCommandPolicy.matchesAllowlist({
        resourceType: AiResourceType.Host,
        command,
        patterns,
      });
    };

    expect(matches("systemctl stop nginx", ["systemctl stop nginx"])).toBe(
      true,
    );
    expect(matches("systemctl stop nginx", ["systemctl stop *"])).toBe(true);
    expect(matches("systemctl stop nginx", ["systemctl * nginx"])).toBe(false);
    expect(matches("systemctl stop nginx", ["systemctl status nginx"])).toBe(
      false,
    );
    expect(matches("systemctl stop nginx", ["systemctl stop redis"])).toBe(
      false,
    );
    expect(matches("systemctl stop a b", ["systemctl stop *"])).toBe(false);
  });

  test("writes are refused on a read-only agent, naming the switch", () => {
    const refusal: string | null = writeScope("systemctl restart nginx", {
      allowWrites: false,
    });

    expect(refusal).toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
    expect(refusal).toContain("Host AI agent");
    expect(writeScope("systemctl status nginx", { allowWrites: false })).toBe(
      null,
    );
  });

  test("write targets are compared as canonical names", () => {
    expect(writeScope("systemctl restart nginx")).toBeNull();
    expect(
      writeScope("systemctl restart nginx", {
        writeTargets: ["nginx.service"],
      }),
    ).toBeNull();
    expect(
      writeScope("systemctl restart nginx", { writeTargets: ["nginx*"] }),
    ).toBeNull();
    expect(
      writeScope("systemctl restart nginx", { writeTargets: ["nginx"] }),
    ).toContain("outside the targets");
    expect(
      writeScope("systemctl restart nginx redis", {
        writeTargets: ["nginx.service"],
      }),
    ).toContain("redis.service");
  });

  test("the agent's own unit and pid are protected", () => {
    expect(
      writeScope("systemctl restart oneuptime-host-ai-agent", {
        protectedTargets: ["oneuptime-host-ai-agent.service"],
      }),
    ).toContain("protects");
    expect(
      writeScope("kill -9 4242", { protectedTargets: ["pid:4242"] }),
    ).toContain("protects");
    expect(writeScope("kill -9 4242", { writeTargets: ["pid:*"] })).toBeNull();
  });

  test("a vacuum and a reset of every unit are scoped too", () => {
    expect(
      writeScope("journalctl --vacuum-time=7d", { writeTargets: ["journal"] }),
    ).toBeNull();
    expect(
      writeScope("journalctl --vacuum-time=7d", {
        writeTargets: ["nginx.service"],
      }),
    ).toContain("journal");
    expect(
      writeScope("systemctl reset-failed", {
        writeTargets: ["nginx.service"],
      }),
    ).toContain("does not name the objects");
  });

  test("a Denied command is refused by the write scope as well", () => {
    expect(writeScope("systemctl reboot")).toContain(
      "denied by the command policy",
    );
  });
});

describe("process listings are redacted (ps, top)", () => {
  function redactPs(text: string, program: string = "ps"): string {
    return redactResourceCommandOutput({
      resourceType: AiResourceType.Host,
      program,
      text,
    });
  }

  function hook(program: string): ResourceOutputRedactionHook {
    const hooks: ReadonlyArray<ResourceOutputRedactionHook> =
      getResourceOutputRedactionHooks(program);

    expect(hooks.length).toBeGreaterThan(0);

    return hooks[0] as ResourceOutputRedactionHook;
  }

  test("ps and top have the hook, other host programs rely on the generic rules", () => {
    expect(RESOURCE_OUTPUT_REDACTION_HOOKS["ps"]).toBeDefined();
    expect(RESOURCE_OUTPUT_REDACTION_HOOKS["top"]).toBeDefined();
    expect(hook("ps")).toBe(hook("top"));
    expect(getResourceOutputRedactionHooks("journalctl")).toEqual([]);
    expect(getResourceOutputRedactionHooks("systemctl")).toEqual([]);
  });

  test.each([
    [
      "root 1234 0.0 0.1 1 1 ? Ssl 10:00 0:00 /usr/bin/app --password=hunter2 --verbose",
      "--password=[redacted] --verbose",
    ],
    [
      "root 1234 0.0 0.1 1 1 ? Ssl 10:00 0:00 /usr/bin/app --token abcdef123456 --port 80",
      "--token [redacted] --port 80",
    ],
    [
      "root 1235 0.0 0.1 1 1 ? S 10:00 0:00 env PASSWORD=hunter2 node server.js",
      "PASSWORD=[redacted] node server.js",
    ],
    [
      "app 7 0 0 1 1 ? S 1 0 app DB_PASSWORD=hunter2 API_TOKEN=tok123",
      "DB_PASSWORD=[redacted] API_TOKEN=[redacted]",
    ],
    [
      "app 8 0 0 1 1 ? S 1 0 java -Dspring.datasource.password=hunter2 -jar app.jar",
      "-Dspring.datasource.password=[redacted] -jar app.jar",
    ],
    [
      "app 9 0 0 1 1 ? S 1 0 curl -u admin:hunter2 https://example.com/x",
      "-u admin:[redacted] https://example.com/x",
    ],
    [
      "app 10 0 0 1 1 ? S 1 0 curl --proxy-user bob:hunter2 https://x",
      "--proxy-user bob:[redacted] https://x",
    ],
    [
      "redis 999 0.1 0.2 1 1 ? Ssl 10:00 0:01 redis-server *:6379 --requirepass hunter2",
      "--requirepass [redacted]",
    ],
    [
      "app 11 0 0 1 1 ? S 1 0 /opt/app --api-key=K123 --client-secret S456 --auth-token A789",
      "--api-key=[redacted] --client-secret [redacted] --auth-token [redacted]",
    ],
    [
      "app 12 0 0 1 1 ? S 1 0 app --db-pass hunter2 --secret=abc",
      "--db-pass [redacted] --secret=[redacted]",
    ],
  ])("the hook alone masks %p", (line: string, expected: string) => {
    const redaction: ResourceOutputRedaction = hook("ps")({
      resourceType: AiResourceType.Host,
      program: "ps",
      text: line,
    });

    expect(redaction.text).toContain(expected);
    expect(redaction.text).not.toContain("hunter2");
    expect(redaction.redactionCount).toBeGreaterThan(0);
    expect(redactPs(line)).not.toContain("hunter2");
  });

  test("top batch output is masked the same way", () => {
    const text: string = [
      "top - 10:00:00 up 3 days,  1 user,  load average: 0.10, 0.20, 0.30",
      "    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND",
      "   1234 app       20   0  123456   6789   1234 S   0.0   0.1   0:00.01 app --token=s3cr3t-token --port 80",
    ].join("\n");
    const redacted: string = redactPs(text, "top");

    expect(redacted).not.toContain("s3cr3t-token");
    expect(redacted).toContain("--token=[redacted] --port 80");
    expect(redacted).toContain("load average: 0.10, 0.20, 0.30");
  });

  test("ordinary process listings pass through unchanged", () => {
    const text: string = [
      "USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND",
      "root           1  0.0  0.1 167720 11852 ?        Ss   Sep01   0:12 /sbin/init splash",
      "www-data    4242  1.5  2.0 223344 45678 ?        S    10:00   1:02 nginx: worker process",
      "postgres     777  0.3  1.1 400000 22222 ?        Ss   Sep01   3:00 postgres: checkpointer",
      "app         8080  0.0  0.5 100000  9999 ?        Sl   10:00   0:00 docker run -u 1000:1000 --name web nginx:1.27",
    ].join("\n");

    expect(redactPs(text)).toBe(text);
    expect(
      redactResourceCommandOutputWithCount({
        resourceType: AiResourceType.Host,
        program: "ps",
        text,
      }).redactionCount,
    ).toBe(0);
  });

  test("edge cases: a flag with no value, a flag followed by a flag, empty values", () => {
    const run: (text: string) => ResourceOutputRedaction = (
      text: string,
    ): ResourceOutputRedaction => {
      return hook("ps")({
        resourceType: AiResourceType.Host,
        program: "ps",
        text,
      });
    };

    expect(run("app --password").text).toBe("app --password");
    expect(run("app --password --verbose").text).toBe(
      "app --password --verbose",
    );
    expect(run("app --password= --x").text).toBe("app --password= --x");
    expect(run("app --password=[redacted]").redactionCount).toBe(0);
    expect(run("").text).toBe("");
    expect(run("a\n--token t1\n--token t2").text).toBe(
      "a\n--token [redacted]\n--token [redacted]",
    );
    expect(run("a\n--token t1\n--token t2").redactionCount).toBe(2);
  });

  test("counts every masked value, hook and generic rules together", () => {
    const counted: ResourceOutputRedaction =
      redactResourceCommandOutputWithCount({
        resourceType: AiResourceType.Host,
        program: "ps",
        text: "app --password=a1 --token b2 SECRET=c3",
      });

    expect(counted.text).toBe(
      "app --password=[redacted] --token [redacted] SECRET=[redacted]",
    );
    expect(counted.redactionCount).toBe(3);
  });

  test("journalctl and other host output still gets the generic rules", () => {
    expect(
      redactResourceCommandOutput({
        resourceType: AiResourceType.Host,
        program: "journalctl",
        text: "May 01 app[1]: connecting with DB_PASSWORD=hunter2",
      }),
    ).not.toContain("hunter2");
  });
});
