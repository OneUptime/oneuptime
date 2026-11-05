import { describe, expect, test } from "@jest/globals";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import {
  OpenStackCheckCloudFacts,
  OpenStackCheckSavedRow,
  OpenStackCheckWriteDecision,
  getOpenStackCheckBinding,
  getOpenStackCheckBindingRefusal,
  getOpenStackCheckConnection,
  normalizeOpenStackLifecycleOptions,
  prepareOpenStackCheckWrite,
  readOpenStackCheckCredential,
} from "../../../Utils/OpenStack/OpenStackCheckSettings";

/*
 * The rules a cloud's checks are held to when someone saves them. What the lifecycle check may write
 * with is decided again before every run (OpenStackCheckGuard). These are what a person can be told
 * while they are still looking at the form, and they are what keeps a saved credential where it was
 * entered for.
 */

const NOW: Date = new Date("2026-11-05T10:00:00.000Z");
const PROBE: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROBE: string = "22222222-2222-4222-8222-222222222222";

const AGENT_CLOUD: OpenStackCheckCloudFacts = {
  collectionMethod: OpenStackCollectionMethod.Agent,
};

const PROBE_CLOUD: OpenStackCheckCloudFacts = {
  collectionMethod: OpenStackCollectionMethod.Probe,
  authUrl: "https://keystone.example.com:5000",
  endpointInterface: "public",
  collectionRegions: ["RegionOne"],
  trustedCertificateFingerprints: [],
  collectionProbeId: { toString: (): string => PROBE },
  isCredentialSet: true,
};

const NEW_CREDENTIAL: Record<string, unknown> = {
  applicationCredentialId: "credential-id",
  credentialSecret: "a-secret",
};

function decide(data: {
  values: Record<string, unknown>;
  saved?: OpenStackCheckSavedRow | null | undefined;
  cloud?: OpenStackCheckCloudFacts | undefined;
}): OpenStackCheckWriteDecision {
  return prepareOpenStackCheckWrite({
    values: data.values,
    saved: data.saved ?? null,
    cloud: data.cloud || PROBE_CLOUD,
    now: NOW,
  });
}

function decided(
  data: Parameters<typeof decide>[0],
): Exclude<OpenStackCheckWriteDecision, { error: string }> {
  const decision: OpenStackCheckWriteDecision = decide(data);

  if ("error" in decision) {
    throw new Error(`Refused: ${decision.error}`);
  }

  return decision;
}

function savedLifecycle(
  overrides: Partial<OpenStackCheckSavedRow> = {},
): OpenStackCheckSavedRow {
  const binding: unknown = getOpenStackCheckBinding(
    getOpenStackCheckConnection({ check: {}, cloud: PROBE_CLOUD }),
  );

  return {
    credentialKind: "applicationCredential",
    applicationCredentialId: "credential-id",
    isCredentialSet: true,
    credentialBinding: binding as OpenStackCheckSavedRow["credentialBinding"],
    isApiCheckEnabled: true,
    isLifecycleCheckEnabled: true,
    lifecycleProjectName: "oneuptime-checks",
    lastLifecycleCheckAt: new Date("2026-11-05T09:30:00.000Z"),
    ...overrides,
  };
}

describe("turning on the API checks", () => {
  test("one click on a cloud a probe collects: its probe, address and credential", () => {
    const decision: ReturnType<typeof decided> = decided({
      values: { isApiCheckEnabled: true },
    });

    expect(decision.serverColumns["nextApiCheckAt"]).toEqual(NOW);
    expect(decision.changes).toEqual(["API checks were turned on"]);
    expect(decision.isSettingsChanged).toBe(true);
  });

  test("a cloud the agent collects has no probe that can, so it asks for what it needs, one at a time", () => {
    expect(
      decide({ values: { isApiCheckEnabled: true }, cloud: AGENT_CLOUD }),
    ).toEqual({ error: expect.stringContaining("Keystone's address") });

    expect(
      decide({
        values: {
          isApiCheckEnabled: true,
          authUrl: "https://keystone.example.com/v3",
        },
        cloud: AGENT_CLOUD,
      }),
    ).toEqual({ error: expect.stringContaining("Pick a probe") });

    expect(
      decide({
        values: {
          isApiCheckEnabled: true,
          authUrl: "https://keystone.example.com/v3",
          probeId: { toString: (): string => PROBE },
        },
        cloud: AGENT_CLOUD,
      }),
    ).toEqual({ error: expect.stringContaining("Give these checks a credential") });

    expect(
      decided({
        values: {
          isApiCheckEnabled: true,
          authUrl: "https://keystone.example.com/v3",
          probeId: { toString: (): string => PROBE },
          ...NEW_CREDENTIAL,
        },
        cloud: AGENT_CLOUD,
      }).serverColumns["isCredentialSet"],
    ).toBe(true);
  });

  test("an interval is one it offers", () => {
    expect(
      decide({
        values: { isApiCheckEnabled: true, apiCheckIntervalInMinutes: 3 },
      }),
    ).toHaveProperty("error");

    for (const minutes of [1, 2, 5]) {
      expect(
        decide({
          values: {
            isApiCheckEnabled: true,
            apiCheckIntervalInMinutes: minutes,
          },
        }),
      ).not.toHaveProperty("error");
    }
  });

  test("an address is read as the probe would read it, and a plain http one is refused", () => {
    const values: Record<string, unknown> = {
      authUrl: "https://keystone.example.com:5000/v3/",
      ...NEW_CREDENTIAL,
    };

    decided({ values: values, cloud: AGENT_CLOUD });

    expect(values["authUrl"]).toBe("https://keystone.example.com:5000");

    expect(
      decide({
        values: { authUrl: "http://keystone.example.com/v3" },
        cloud: AGENT_CLOUD,
      }),
    ).toHaveProperty("error");
  });
});

describe("turning on the lifecycle check", () => {
  test("it needs a credential of its own and a project of its own, and the cloud's will not do", () => {
    expect(
      decide({
        values: {
          isLifecycleCheckEnabled: true,
          lifecycleProjectName: "oneuptime-checks",
        },
      }),
    ).toEqual({ error: expect.stringContaining("credential of its own") });

    expect(
      decide({
        values: { isLifecycleCheckEnabled: true, ...NEW_CREDENTIAL },
      }),
    ).toEqual({ error: expect.stringContaining("which project") });
  });

  test("the cloud's own projects are refused while the form is still open", () => {
    for (const name of ["admin", "Admin", "service", "SERVICE"]) {
      expect(
        decide({
          values: {
            isLifecycleCheckEnabled: true,
            lifecycleProjectName: name,
            ...NEW_CREDENTIAL,
          },
        }),
      ).toEqual({ error: expect.stringContaining("the cloud's own") });
    }
  });

  test("it turns the API checks on with it, because they carry its series", () => {
    const values: Record<string, unknown> = {
      isLifecycleCheckEnabled: true,
      lifecycleProjectName: "oneuptime-checks",
      ...NEW_CREDENTIAL,
    };

    const decision: ReturnType<typeof decided> = decided({ values: values });

    expect(values["isApiCheckEnabled"]).toBe(true);
    expect(decision.serverColumns["nextLifecycleCheckAt"]).toEqual(NOW);
    expect(decision.serverColumns["nextApiCheckAt"]).toEqual(NOW);
    expect(decision.changes).toContain("the lifecycle check was turned on");
  });

  test("turning the API checks off turns it off too", () => {
    const values: Record<string, unknown> = { isApiCheckEnabled: false };

    decided({ values: values, saved: savedLifecycle() });

    expect(values["isLifecycleCheckEnabled"]).toBe(false);
  });

  test("its interval stays between a quarter of an hour and a day", () => {
    for (const minutes of [14, 1441, 30.5, "30"]) {
      expect(
        decide({
          values: { lifecycleCheckIntervalInMinutes: minutes },
          saved: savedLifecycle(),
        }),
      ).toHaveProperty("error");
    }

    expect(
      decide({
        values: { lifecycleCheckIntervalInMinutes: 15 },
        saved: savedLifecycle(),
      }),
    ).not.toHaveProperty("error");
  });
});

describe("the secret", () => {
  test("an empty secret in an update keeps the saved one, as an edit form sends it", () => {
    const values: Record<string, unknown> = { credentialSecret: "" };

    decided({ values: values, saved: savedLifecycle() });

    expect("credentialSecret" in values).toBe(false);
  });

  test("a new name beside an old secret is refused, because it would send the secret somewhere else", () => {
    expect(
      decide({
        values: { applicationCredentialId: "another-credential" },
        saved: savedLifecycle(),
      }),
    ).toEqual({ error: expect.stringContaining("secret again") });
  });

  test("a new credential is bound where it was entered, and has to verify its project again", () => {
    const decision: ReturnType<typeof decided> = decided({
      values: { ...NEW_CREDENTIAL },
      saved: savedLifecycle(),
    });

    expect(decision.serverColumns).toMatchObject({
      isCredentialSet: true,
      credentialsUpdatedAt: NOW,
      pinnedLifecycleProjectId: null,
      credentialBinding: {
        endpointKey: "keystone.example.com:5000",
        probeId: PROBE,
      },
    });
  });

  test.each<[string, Record<string, unknown>, string]>([
    [
      "another address",
      { authUrl: "https://attacker.example.com" },
      "the Keystone it was entered for",
    ],
    [
      "another probe",
      { probeId: { toString: (): string => OTHER_PROBE } },
      "the probe it was entered for",
    ],
  ])(
    "a saved credential does not follow %s",
    (_name: string, values: Record<string, unknown>, says: string) => {
      expect(decide({ values: values, saved: savedLifecycle() })).toEqual({
        error: expect.stringContaining(says),
      });
    },
  );

  test("nor a certificate someone newly trusts, on a check's own address", () => {
    const connection = getOpenStackCheckConnection({
      check: { authUrl: "https://keystone.example.com" },
      cloud: AGENT_CLOUD,
    });

    expect(
      decide({
        values: {
          trustedCertificateFingerprints: [`${"AB:".repeat(31)}AB`],
        },
        saved: {
          ...savedLifecycle({
            authUrl: "https://keystone.example.com",
            probeId: { toString: (): string => PROBE },
          }),
          credentialBinding: getOpenStackCheckBinding({
            ...connection,
            probeId: PROBE,
          }) as unknown as OpenStackCheckSavedRow["credentialBinding"],
        },
        cloud: AGENT_CLOUD,
      }),
    ).toEqual({
      error: expect.stringContaining("certificates that were trusted"),
    });
  });

  test("when the cloud's own connection moves, a saved credential stays where it was entered for", () => {
    const moved: OpenStackCheckCloudFacts = {
      ...PROBE_CLOUD,
      authUrl: "https://other.example.com",
    };

    expect(
      getOpenStackCheckBindingRefusal({
        saved: savedLifecycle().credentialBinding,
        connection: getOpenStackCheckConnection({ check: {}, cloud: moved }),
      }),
    ).toContain("the Keystone it was entered for");

    expect(
      getOpenStackCheckBindingRefusal({
        saved: null,
        connection: getOpenStackCheckConnection({ check: {}, cloud: moved }),
      }),
    ).toContain("Enter the credential again");
  });

  test("a credential is read as one kind or the other, or not at all", () => {
    expect(
      readOpenStackCheckCredential({
        credentialKind: "applicationCredential",
        applicationCredentialId: "id",
        credentialSecret: "secret",
      }),
    ).toEqual({ kind: "applicationCredential", id: "id", secret: "secret" });

    expect(
      readOpenStackCheckCredential({
        credentialKind: "password",
        keystoneUsername: "user",
        credentialProjectName: "project",
        credentialSecret: "secret",
      }),
    ).toEqual({
      kind: "password",
      username: "user",
      password: "secret",
      userDomainName: "Default",
      projectName: "project",
      projectDomainName: "Default",
    });

    expect(readOpenStackCheckCredential({ credentialKind: "password" })).toBeNull();
    expect(
      readOpenStackCheckCredential({
        credentialKind: "applicationCredential",
        credentialSecret: "secret",
      }),
    ).toBeNull();
  });
});

describe("turning it off", () => {
  test("with runs behind it, the credential stays until a sweep finds nothing left", () => {
    const values: Record<string, unknown> = { isLifecycleCheckEnabled: false };

    const decision: ReturnType<typeof decided> = decided({
      values: values,
      saved: savedLifecycle(),
    });

    expect(decision.serverColumns["isSweepPending"]).toBe(true);
    expect(decision.serverColumns["nextLifecycleCheckAt"]).toEqual(NOW);
    expect(values["credentialSecret"]).toBeUndefined();
    expect(decision.changes).toEqual(["the lifecycle check was turned off"]);
  });

  test("with nothing that needs it, the secret and the key are forgotten", () => {
    const values: Record<string, unknown> = { isApiCheckEnabled: false };

    const decision: ReturnType<typeof decided> = decided({
      values: values,
      saved: savedLifecycle({
        isLifecycleCheckEnabled: false,
        isSweepPending: false,
      }),
    });

    expect(values["credentialSecret"]).toBeNull();
    expect(values["osProfilerKey"]).toBeNull();
    expect(decision.serverColumns).toMatchObject({
      isCredentialSet: false,
      isOsProfilerKeySet: false,
      credentialBinding: null,
    });
  });

  test("turned back on before a sweep has finished: runs again, and no sweep", () => {
    const decision: ReturnType<typeof decided> = decided({
      values: { isLifecycleCheckEnabled: true },
      saved: savedLifecycle({
        isLifecycleCheckEnabled: false,
        isSweepPending: true,
      }),
    });

    expect(decision.serverColumns["isSweepPending"]).toBe(false);
  });
});

describe("what else a write can say", () => {
  test("asking for a run brings it forward, and is no change of settings", () => {
    const values: Record<string, unknown> = {
      lifecycleRunRequestedAt: new Date("2000-01-01"),
    };

    const decision: ReturnType<typeof decided> = decided({
      values: values,
      saved: savedLifecycle(),
    });

    // The server's own clock, not what anyone sent.
    expect(values["lifecycleRunRequestedAt"]).toEqual(NOW);
    expect(decision.serverColumns["nextLifecycleCheckAt"]).toEqual(NOW);
    expect(decision.isSettingsChanged).toBe(false);
  });

  test("a check that is off cannot be run", () => {
    expect(
      decide({
        values: { lifecycleRunRequestedAt: NOW },
        saved: savedLifecycle({ isLifecycleCheckEnabled: false }),
      }),
    ).toHaveProperty("error");
  });

  test("the OSProfiler key is set, kept by an empty field, and removed only when asked", () => {
    const set: Record<string, unknown> = { osProfilerKey: "a-key" };

    expect(
      decided({ values: set, saved: savedLifecycle() }).serverColumns[
        "isOsProfilerKeySet"
      ],
    ).toBe(true);
    expect(set["osProfilerKey"]).toBe("a-key");

    const kept: Record<string, unknown> = { osProfilerKey: "" };

    expect(
      decided({ values: kept, saved: savedLifecycle() }).serverColumns[
        "isOsProfilerKeySet"
      ],
    ).toBeUndefined();
    expect("osProfilerKey" in kept).toBe(false);

    const removed: Record<string, unknown> = { osProfilerKey: null };

    expect(
      decided({ values: removed, saved: savedLifecycle() }).serverColumns[
        "isOsProfilerKeySet"
      ],
    ).toBe(false);
  });

  test("a project renamed for the check has to verify itself again", () => {
    expect(
      decided({
        values: { lifecycleProjectName: "another-project" },
        saved: savedLifecycle(),
      }).serverColumns["pinnedLifecycleProjectId"],
    ).toBeNull();
  });
});

describe("where a check connects", () => {
  test("its own address when it has one, or else the cloud's", () => {
    const own = getOpenStackCheckConnection({
      check: { authUrl: "https://mine.example.com", regions: ["One"] },
      cloud: PROBE_CLOUD,
    });

    expect(own).toMatchObject({
      authUrl: "https://mine.example.com",
      regions: ["One"],
      probeId: PROBE,
      isCloudsOwn: false,
    });

    expect(
      getOpenStackCheckConnection({ check: {}, cloud: PROBE_CLOUD }),
    ).toMatchObject({
      authUrl: "https://keystone.example.com:5000",
      regions: ["RegionOne"],
      probeId: PROBE,
      isCloudsOwn: true,
    });

    expect(
      getOpenStackCheckConnection({ check: {}, cloud: AGENT_CLOUD }),
    ).toMatchObject({ authUrl: null, probeId: null, isCloudsOwn: false });
  });
});

describe("what the lifecycle check was told to boot", () => {
  test("is held to what it can use", () => {
    expect(
      normalizeOpenStackLifecycleOptions({
        flavor: "  m1.tiny ",
        image: "",
        network: null,
        isFloatingIpEnabled: true,
        floatingIpNetwork: "public",
        isVolumeEnabled: true,
        volumeSizeInGiB: 2,
        volumeType: "fast",
        somethingElse: "ignored",
      }),
    ).toEqual({
      options: {
        flavor: "m1.tiny",
        isFloatingIpEnabled: true,
        floatingIpNetwork: "public",
        isVolumeEnabled: true,
        volumeSizeInGiB: 2,
        volumeType: "fast",
      },
    });

    expect(normalizeOpenStackLifecycleOptions(undefined)).toEqual({
      options: {},
    });
    expect(normalizeOpenStackLifecycleOptions({ isVolumeEnabled: true })).toEqual(
      { options: { isVolumeEnabled: true, volumeSizeInGiB: 1 } },
    );
  });

  test.each<[string, unknown]>([
    ["not an object", "flavor"],
    ["a list", []],
    ["a number for a name", { flavor: 1 }],
    ["a name too long", { image: "x".repeat(256) }],
    ["no size", { isVolumeEnabled: true, volumeSizeInGiB: 0 }],
    ["a size too big", { isVolumeEnabled: true, volumeSizeInGiB: 17 }],
    ["half a GiB", { isVolumeEnabled: true, volumeSizeInGiB: 1.5 }],
  ])("%s is refused", (_name: string, value: unknown) => {
    expect(normalizeOpenStackLifecycleOptions(value)).toHaveProperty("error");
  });
});
