import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The container policy the probe ships with has to let the synthetic
 * browsers start their own sandboxes.
 *
 * Firefox and Chromium sandbox their child processes the same way on Linux:
 * create a user namespace (clone/unshare with CLONE_NEWUSER, plus setns), then
 * chroot(2) inside it. Neither needs a capability for that -- the process owns
 * the namespace it just created -- but the seccomp filter sees the syscalls
 * first, and Docker's profile format can make a rule depend on the
 * container's capability set. Probe/seccomp_profile.json (Playwright's Docker
 * profile) allows clone/setns/unshare unconditionally but chroot only with
 * CAP_SYS_CHROOT, and the compose probes drop every capability. The result
 * was a policy that lets the browsers create the namespace and then kills
 * them for using it: every Firefox content process died ("Sandbox: chroot:
 * EPERM", SIGSEGV) and the Chromium zygote aborted ("Check failed:
 * sys_chroot"), so every synthetic check on a compose probe failed.
 *
 * Docker's own default profile does not have the problem, because it refuses
 * CLONE_NEWUSER without CAP_SYS_ADMIN: Firefox then never tries to chroot and
 * falls back to its seccomp-only sandbox. So the invariant is "wherever a
 * user namespace can be created, chroot must be allowed too", and where the
 * Chromium sandbox is required, both must be.
 *
 * This evaluates the policy the way Docker does when it creates the
 * container (includes/excludes resolved against the capability set, amd64),
 * so it runs in CI with no Docker.
 */

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..");
const COMPOSE_PATH: string = path.join(REPO_ROOT, "docker-compose.base.yml");
const HELM_VALUES_PATH: string = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "oneuptime",
  "values.yaml",
);

interface YamlModule {
  load: (source: string) => unknown;
}

/*
 * Probe declares no YAML parser of its own. The Probe CI job installs Common
 * first, so resolve Common's copy explicitly rather than whatever transitive
 * js-yaml happens to be hoisted into Probe/node_modules.
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const yaml: YamlModule = require(
  require.resolve("js-yaml", { paths: [path.join(REPO_ROOT, "Common")] }),
) as YamlModule;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

interface ComposeService {
  cap_drop?: Array<string>;
  cap_add?: Array<string>;
  security_opt?: Array<string>;
  environment?: Record<string, string>;
}

interface SeccompCondition {
  caps?: Array<string>;
  arches?: Array<string>;
}

interface SeccompRule {
  names: Array<string>;
  action: string;
  args?: Array<unknown> | null;
  includes?: SeccompCondition | null;
  excludes?: SeccompCondition | null;
}

interface SeccompProfile {
  defaultAction: string;
  syscalls: Array<SeccompRule>;
}

// What `docker run` grants when cap_drop does not say ALL.
const DOCKER_DEFAULT_CAPABILITIES: ReadonlyArray<string> = [
  "CAP_AUDIT_WRITE",
  "CAP_CHOWN",
  "CAP_DAC_OVERRIDE",
  "CAP_FOWNER",
  "CAP_FSETID",
  "CAP_KILL",
  "CAP_MKNOD",
  "CAP_NET_BIND_SERVICE",
  "CAP_NET_RAW",
  "CAP_SETFCAP",
  "CAP_SETGID",
  "CAP_SETPCAP",
  "CAP_SETUID",
  "CAP_SYS_CHROOT",
];

const ARCH: string = "amd64";

const normalizeCapability: (name: string) => string = (
  name: string,
): string => {
  const upper: string = name.trim().toUpperCase();
  return upper.startsWith("CAP_") ? upper : `CAP_${upper}`;
};

const composeCapabilities: (service: ComposeService) => Set<string> = (
  service: ComposeService,
): Set<string> => {
  const dropped: Array<string> = (service.cap_drop || []).map(
    normalizeCapability,
  );
  const capabilities: Set<string> = new Set<string>(
    dropped.includes("CAP_ALL")
      ? []
      : DOCKER_DEFAULT_CAPABILITIES.filter((capability: string) => {
          return !dropped.includes(capability);
        }),
  );
  for (const added of service.cap_add || []) {
    capabilities.add(normalizeCapability(added));
  }
  return capabilities;
};

/*
 * True when a rule that survives Docker's resolution allows the syscall with
 * no argument filter. The argument-filtered clone rules in these profiles only
 * allow clone WITHOUT namespace flags, so they do not count.
 */
const allowsUnconditionally: (data: {
  profile: SeccompProfile;
  syscall: string;
  capabilities: Set<string>;
}) => boolean = (data: {
  profile: SeccompProfile;
  syscall: string;
  capabilities: Set<string>;
}): boolean => {
  return data.profile.syscalls.some((rule: SeccompRule) => {
    if (
      rule.action !== "SCMP_ACT_ALLOW" ||
      !rule.names.includes(data.syscall)
    ) {
      return false;
    }
    if (rule.args && rule.args.length > 0) {
      return false;
    }
    const includes: SeccompCondition = rule.includes || {};
    const excludes: SeccompCondition = rule.excludes || {};
    if (
      includes.caps?.length &&
      !includes.caps.every((capability: string) => {
        return data.capabilities.has(capability);
      })
    ) {
      return false;
    }
    if (includes.arches?.length && !includes.arches.includes(ARCH)) {
      return false;
    }
    if (
      excludes.caps?.some((capability: string) => {
        return data.capabilities.has(capability);
      })
    ) {
      return false;
    }
    if (excludes.arches?.includes(ARCH)) {
      return false;
    }
    return true;
  });
};

const compose: { services: Record<string, ComposeService> } = yaml.load(
  fs.readFileSync(COMPOSE_PATH, "utf8"),
) as { services: Record<string, ComposeService> };

const PROBE_SERVICE_NAME: RegExp = /^probe-\d+$/;

const probeServiceNames: Array<string> = Object.keys(compose.services).filter(
  (name: string) => {
    return PROBE_SERVICE_NAME.test(name);
  },
);

const loadServiceProfile: (service: ComposeService) => SeccompProfile = (
  service: ComposeService,
): SeccompProfile => {
  const option: string | undefined = (service.security_opt || []).find(
    (entry: string) => {
      return entry.startsWith("seccomp=") || entry.startsWith("seccomp:");
    },
  );
  expect(option).toBeDefined();
  const profilePath: string = (option as string).slice("seccomp=".length);
  expect(profilePath).not.toBe("unconfined");
  return JSON.parse(
    fs.readFileSync(path.resolve(REPO_ROOT, profilePath), "utf8"),
  ) as SeccompProfile;
};

describe("probe container policy and the browser sandboxes", () => {
  test("docker-compose.base.yml defines the bundled probes", () => {
    expect(probeServiceNames).toEqual(["probe-1", "probe-2"]);
  });

  test.each(probeServiceNames)(
    "%s allows chroot wherever its seccomp profile allows a user namespace",
    (serviceName: string) => {
      const service: ComposeService = compose.services[serviceName]!;
      const profile: SeccompProfile = loadServiceProfile(service);
      const capabilities: Set<string> = composeCapabilities(service);
      const allows: (syscall: string) => boolean = (
        syscall: string,
      ): boolean => {
        return allowsUnconditionally({ profile, syscall, capabilities });
      };

      const canCreateUserNamespace: boolean =
        allows("clone") || allows("unshare");

      // Firefox: a namespace it can create but not chroot in crashes every content process.
      expect({
        serviceName,
        canCreateUserNamespace,
        chroot: allows("chroot"),
      }).toEqual({
        serviceName,
        canCreateUserNamespace,
        chroot: canCreateUserNamespace,
      });

      // Chromium: when its sandbox is required, all four must be allowed.
      if (
        service.environment?.[
          "PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED"
        ] === "true"
      ) {
        expect({
          clone: allows("clone"),
          unshare: allows("unshare"),
          setns: allows("setns"),
          chroot: allows("chroot"),
        }).toEqual({ clone: true, unshare: true, setns: true, chroot: true });
      }
    },
  );

  test("the bundled probes share one security policy", () => {
    const [first, ...rest] = probeServiceNames.map((name: string) => {
      const service: ComposeService = compose.services[name]!;
      return {
        capabilities: [...composeCapabilities(service)].sort(),
        securityOpt: service.security_opt,
        chromiumSandbox:
          service.environment?.[
            "PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED"
          ],
      };
    });
    for (const other of rest) {
      expect(other).toEqual(first);
    }
  });

  describe("Helm probe defaults", () => {
    interface HelmValues {
      probeContainerSecurityContext: {
        capabilities: { drop: Array<string>; add: Array<string> };
        seccompProfile: { type: string };
      };
      probes: Record<
        string,
        { syntheticMonitorChromiumSandboxEnabled?: boolean }
      >;
    }

    const values: HelmValues = yaml.load(
      fs.readFileSync(HELM_VALUES_PATH, "utf8"),
    ) as HelmValues;
    const helmCapabilities: Set<string> = new Set<string>(
      values.probeContainerSecurityContext.capabilities.add.map(
        normalizeCapability,
      ),
    );

    test("grant exactly the capabilities the compose probes keep", () => {
      expect(values.probeContainerSecurityContext.capabilities.drop).toEqual([
        "ALL",
      ]);
      expect([...helmCapabilities].sort()).toEqual(
        [...composeCapabilities(compose.services["probe-1"]!)].sort(),
      );
    });

    test("never let RuntimeDefault allow a user namespace that chroot cannot be used in", () => {
      /*
       * The runtimes' generated RuntimeDefault profiles (containerd, CRI-O,
       * Docker) allow namespace-creating clone/unshare only with CAP_SYS_ADMIN
       * and chroot only with CAP_SYS_CHROOT. Granting the first without the
       * second recreates the compose failure under RuntimeDefault.
       */
      expect(values.probeContainerSecurityContext.seccompProfile.type).toBe(
        "RuntimeDefault",
      );
      expect({
        sysAdmin: helmCapabilities.has("CAP_SYS_ADMIN"),
        sysChroot: helmCapabilities.has("CAP_SYS_CHROOT"),
      }).not.toEqual({ sysAdmin: true, sysChroot: false });
    });

    test("leave the Chromium sandbox off under RuntimeDefault, which refuses its user namespace", () => {
      for (const probe of Object.values(values.probes)) {
        expect(probe.syntheticMonitorChromiumSandboxEnabled ?? false).toBe(
          false,
        );
      }
    });
  });
});
