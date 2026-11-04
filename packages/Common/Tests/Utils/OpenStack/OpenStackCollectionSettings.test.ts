import { describe, expect, test } from "@jest/globals";
import { OpenStackCredential } from "../../../Types/OpenStack/OpenStackProbeCollection";
import OpenStackCollectionSettings, {
  DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_OPENSTACK_CREDENTIAL_FIELD_LENGTH,
  MAX_OPENSTACK_PORT_SCOPES,
  MAX_OPENSTACK_REGIONS,
  MAX_OPENSTACK_REGION_NAME_LENGTH,
  MAX_OPENSTACK_SECRET_LENGTH,
  MAX_OPENSTACK_TRUSTED_CERTIFICATES,
  MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  OpenStackCredentialBinding,
} from "../../../Utils/OpenStack/OpenStackCollectionSettings";

/*
 * The rules a probe-collected cloud is held to, in the one place the server's save hook,
 * the probe-ingest routes and the dashboard's form read them from. A credential is
 * write-only and goes only where it was entered for, which is what all this is about.
 */

const FINGERPRINT_A: string = Array.from({ length: 32 }, () => {
  return "AA";
}).join(":");
const FINGERPRINT_B: string = Array.from({ length: 32 }, () => {
  return "BB";
}).join(":");

describe("the interval", () => {
  test("the agent's own, by default: charts and alerts see the same density of data", () => {
    expect(DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES).toBe(2);
    expect(
      OpenStackCollectionSettings.getIntervalRefusal(
        DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
      ),
    ).toBeNull();
  });

  test.each([
    [MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES],
    [5],
    [MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES],
  ])("%s minutes", (value: number) => {
    expect(OpenStackCollectionSettings.getIntervalRefusal(value)).toBeNull();
  });

  test.each([
    [0],
    [-1],
    [61],
    [1.5],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    ["2"],
    [null],
    [undefined],
  ])("%s is refused", (value: unknown) => {
    expect(OpenStackCollectionSettings.getIntervalRefusal(value)).toBe(
      "Collect every 1 to 60 minutes, in whole minutes.",
    );
  });
});

describe("the endpoint interface", () => {
  test.each(["public", "internal", "admin"])("%s", (value: string) => {
    expect(OpenStackCollectionSettings.isEndpointInterface(value)).toBe(true);
  });

  test.each(["PUBLIC", "private", "", null, undefined, 1])(
    "%s is not one",
    (value: unknown) => {
      expect(OpenStackCollectionSettings.isEndpointInterface(value)).toBe(
        false,
      );
    },
  );
});

describe("which probe may hold a cloud's credential", () => {
  test("the project's own", () => {
    expect(
      OpenStackCollectionSettings.getProbeRefusal({
        probe: { isGlobalProbe: false, projectId: "p1" },
        projectId: "p1",
        isBillingEnabled: true,
      }),
    ).toBeNull();
  });

  test("not another project's, on any instance", () => {
    for (const isBillingEnabled of [true, false]) {
      expect(
        OpenStackCollectionSettings.getProbeRefusal({
          probe: { isGlobalProbe: false, projectId: "p2" },
          projectId: "p1",
          isBillingEnabled: isBillingEnabled,
        }),
      ).toBe(
        "This probe belongs to another project. Pick one of this project's probes.",
      );
    }
  });

  test.each([
    ["marked global", { isGlobalProbe: true, projectId: "p1" }],
    ["with no project", { isGlobalProbe: false, projectId: null }],
    ["with nothing said", {}],
  ])(
    "a shared probe (%s) never on OneUptime Cloud, where every sign-up runs on it",
    (
      _name: string,
      probe: { isGlobalProbe?: boolean; projectId?: string | null },
    ) => {
      expect(
        OpenStackCollectionSettings.getProbeRefusal({
          probe: probe,
          projectId: "p1",
          isBillingEnabled: true,
        }),
      ).toContain("Shared probes never receive OpenStack credentials");
    },
  );

  test("a self-hosted instance's global probes are its operator's own", () => {
    expect(
      OpenStackCollectionSettings.getProbeRefusal({
        probe: { isGlobalProbe: true },
        projectId: "p1",
        isBillingEnabled: false,
      }),
    ).toBeNull();
  });
});

describe("where a saved credential may go", () => {
  const SAVED: OpenStackCredentialBinding = {
    endpointKey: "keystone.example.com:5000",
    probeId: "probe-1",
    trustedCertificateFingerprints: [FINGERPRINT_A],
  };

  function refusal(
    next: Partial<OpenStackCredentialBinding>,
    saved: OpenStackCredentialBinding = SAVED,
  ): string | null {
    return OpenStackCollectionSettings.getCredentialRebindRefusal({
      saved: saved,
      next: { ...saved, ...next },
    });
  }

  test("nothing changed: it stays", () => {
    expect(refusal({})).toBeNull();
  });

  test("another address asks for it again, or a server of one's own would be handed it", () => {
    expect(refusal({ endpointKey: "evil.example.com:5000" })).toContain(
      "only sent to the Keystone it was entered for",
    );
  });

  test("another probe asks for it again", () => {
    expect(refusal({ probeId: "probe-2" })).toContain(
      "only sent through the probe it was entered for",
    );
  });

  test("no probe at all asks for it again", () => {
    expect(refusal({ probeId: null })).toContain(
      "only sent through the probe it was entered for",
    );
  });

  test("a new certificate asks for it again, or a machine in the middle could read it", () => {
    expect(
      refusal({
        trustedCertificateFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
      }),
    ).toContain("only sent to the certificates that were trusted");
  });

  test("trusting fewer is stricter, and keeps it", () => {
    expect(refusal({ trustedCertificateFingerprints: [] })).toBeNull();
  });

  test("the same certificate spelled differently is the same certificate", () => {
    expect(
      refusal({
        trustedCertificateFingerprints: [
          FINGERPRINT_A.toLowerCase().split(":").join(""),
        ],
      }),
    ).toBeNull();
  });

  test("no certificate trusted before, and one now, is a new one", () => {
    expect(
      refusal(
        { trustedCertificateFingerprints: [FINGERPRINT_A] },
        { ...SAVED, trustedCertificateFingerprints: [] },
      ),
    ).not.toBeNull();
  });
});

describe("the credential a person typed", () => {
  function credential(
    data: Parameters<typeof OpenStackCollectionSettings.readCredential>[0],
  ): OpenStackCredential {
    const read: ReturnType<typeof OpenStackCollectionSettings.readCredential> =
      OpenStackCollectionSettings.readCredential(data);

    if (!read.credential) {
      throw new Error(read.error);
    }

    return read.credential;
  }

  function error(
    data: Parameters<typeof OpenStackCollectionSettings.readCredential>[0],
  ): string | undefined {
    return OpenStackCollectionSettings.readCredential(data).error;
  }

  test("an application credential", () => {
    expect(
      credential({
        applicationCredentialId: "  an-id  ",
        applicationCredentialSecret: "a secret with spaces ",
      }),
    ).toEqual({
      kind: "applicationCredential",
      id: "an-id",
      // A secret's spaces are its own.
      secret: "a secret with spaces ",
    });
  });

  test("an application credential first, when both are given: it is the better one", () => {
    expect(
      credential({
        applicationCredentialId: "an-id",
        applicationCredentialSecret: "secret",
        username: "admin",
        password: "hunter2",
        projectName: "admin",
      }).kind,
    ).toBe("applicationCredential");
  });

  test.each([
    [{ applicationCredentialId: "an-id" }],
    [{ applicationCredentialSecret: "secret" }],
    [{ applicationCredentialId: "  ", applicationCredentialSecret: "secret" }],
  ])("half of one (%j)", (data: Record<string, string>) => {
    expect(error(data)).toBe(
      "An application credential needs both its ID and its secret.",
    );
  });

  test("a user name and password, with their project", () => {
    expect(
      credential({
        username: " monitor ",
        password: " pass word ",
        projectName: " monitoring ",
        userDomainName: " Users ",
        projectDomainName: " Projects ",
      }),
    ).toEqual({
      kind: "password",
      username: "monitor",
      password: " pass word ",
      projectName: "monitoring",
      userDomainName: "Users",
      projectDomainName: "Projects",
    });
  });

  test("the domains are Default unless named, as Keystone's own default is", () => {
    expect(
      credential({ username: "a", password: "b", projectName: "c" }),
    ).toMatchObject({
      userDomainName: "Default",
      projectDomainName: "Default",
    });
  });

  test("nothing says to enter the better one", () => {
    expect(error({})).toBe("Enter an application credential's ID and secret.");
  });

  test.each([
    [{ username: "a" }],
    [{ password: "b" }],
    [{ projectName: "c" }],
    [{ username: "a", password: "b" }],
    [{ username: "a", projectName: "c" }],
    [{ password: "b", projectName: "c" }],
  ])("part of the other (%j)", (data: Record<string, string>) => {
    expect(error(data)).toBe(
      "A user name and password also need the project they log in to.",
    );
  });

  test.each([
    [
      "an ID",
      {
        applicationCredentialId: "x".repeat(
          MAX_OPENSTACK_CREDENTIAL_FIELD_LENGTH + 1,
        ),
        applicationCredentialSecret: "s",
      },
    ],
    [
      "a secret",
      {
        applicationCredentialId: "x",
        applicationCredentialSecret: "s".repeat(
          MAX_OPENSTACK_SECRET_LENGTH + 1,
        ),
      },
    ],
    [
      "a user name",
      {
        username: "x".repeat(MAX_OPENSTACK_CREDENTIAL_FIELD_LENGTH + 1),
        password: "p",
        projectName: "c",
      },
    ],
    [
      "a project",
      {
        username: "x",
        password: "p",
        projectName: "x".repeat(MAX_OPENSTACK_CREDENTIAL_FIELD_LENGTH + 1),
      },
    ],
    [
      "a password",
      {
        username: "x",
        password: "p".repeat(MAX_OPENSTACK_SECRET_LENGTH + 1),
        projectName: "c",
      },
    ],
  ])("%s too long to be one", (_name: string, data: Record<string, string>) => {
    expect(error(data)).toContain("too long");
  });

  test("what is not text is nothing", () => {
    expect(
      error({
        applicationCredentialId: 7,
        applicationCredentialSecret: { a: 1 },
        username: [],
        password: null,
        projectName: 3,
      }),
    ).toBe("Enter an application credential's ID and secret.");
  });
});

describe("the credential a write of the columns gives", () => {
  function read(
    written: Record<string, unknown>,
    saved?: Record<string, unknown>,
  ): ReturnType<typeof OpenStackCollectionSettings.readCredential> {
    return OpenStackCollectionSettings.readCredentialColumns({
      written: written,
      saved: saved,
      secret: "the-secret",
    });
  }

  const SAVED_PASSWORD: Record<string, unknown> = {
    credentialKind: "password",
    keystoneUsername: "monitor",
    userDomainName: "Users",
    projectName: "monitoring",
    projectDomainName: "Projects",
  };

  const SAVED_APPLICATION: Record<string, unknown> = {
    credentialKind: "applicationCredential",
    applicationCredentialId: "saved-id",
  };

  test("what the write names decides", () => {
    expect(read({ applicationCredentialId: "an-id" }).credential).toEqual({
      kind: "applicationCredential",
      id: "an-id",
      secret: "the-secret",
    });
    expect(
      read({ keystoneUsername: "a", projectName: "b" }).credential?.kind,
    ).toBe("password");
  });

  test("an application credential wins when both are named", () => {
    expect(
      read({ applicationCredentialId: "an-id", keystoneUsername: "a" })
        .credential?.kind,
    ).toBe("applicationCredential");
  });

  test("a secret alone is the saved credential's", () => {
    expect(read({}, SAVED_APPLICATION).credential).toEqual({
      kind: "applicationCredential",
      id: "saved-id",
      secret: "the-secret",
    });
    expect(read({}, SAVED_PASSWORD).credential).toEqual({
      kind: "password",
      username: "monitor",
      password: "the-secret",
      userDomainName: "Users",
      projectName: "monitoring",
      projectDomainName: "Projects",
    });
  });

  test("what the write names goes over what is saved", () => {
    expect(
      read({ projectName: "other" }, SAVED_PASSWORD).credential,
    ).toMatchObject({
      username: "monitor",
      projectName: "other",
    });
    expect(
      read({ applicationCredentialId: "new-id" }, SAVED_APPLICATION).credential,
    ).toMatchObject({ id: "new-id" });
  });

  test("a new kind ignores what the old one saved", () => {
    expect(
      read({ keystoneUsername: "a", projectName: "b" }, SAVED_APPLICATION)
        .credential?.kind,
    ).toBe("password");
    expect(
      read({ applicationCredentialId: "new-id" }, SAVED_PASSWORD).credential
        ?.kind,
    ).toBe("applicationCredential");
  });

  test("a secret with nothing naming it", () => {
    expect(read({}).error).toBe(
      "An application credential needs both its ID and its secret.",
    );
  });

  test("a project with no user", () => {
    expect(read({ projectName: "b" }).error).toBe(
      "A user name and password also need the project they log in to.",
    );
  });
});

describe("the regions a person picked", () => {
  test("trimmed, without repeats, and in the cloud's own case", () => {
    expect(
      OpenStackCollectionSettings.normalizeRegions([
        " RegionOne ",
        "RegionTwo",
        "RegionOne",
        "regionone",
        "",
        "  ",
      ]),
    ).toEqual({ regions: ["RegionOne", "RegionTwo", "regionone"] });
  });

  test("a comma-separated line, as a form can send it", () => {
    expect(OpenStackCollectionSettings.normalizeRegions("a, b,,c")).toEqual({
      regions: ["a", "b", "c"],
    });
  });

  test.each([[null], [undefined], [7], [{}]])(
    "%j is none",
    (value: unknown) => {
      expect(OpenStackCollectionSettings.normalizeRegions(value)).toEqual({
        regions: [],
      });
    },
  );

  test("what is not a name", () => {
    expect(OpenStackCollectionSettings.normalizeRegions(["a", 7])).toEqual({
      error: "A region's name is text, such as RegionOne.",
    });
  });

  test("a name too long to be one", () => {
    expect(
      OpenStackCollectionSettings.normalizeRegions([
        "x".repeat(MAX_OPENSTACK_REGION_NAME_LENGTH + 1),
      ]),
    ).toEqual({ error: "That region's name is too long to be one." });
  });

  test("as many as a cloud has, and no more", () => {
    const names: Array<string> = Array.from(
      { length: MAX_OPENSTACK_REGIONS + 1 },
      (_value: unknown, index: number): string => {
        return `region-${index}`;
      },
    );

    expect(
      OpenStackCollectionSettings.normalizeRegions(
        names.slice(0, MAX_OPENSTACK_REGIONS),
      ),
    ).toEqual({ regions: names.slice(0, MAX_OPENSTACK_REGIONS) });

    expect(OpenStackCollectionSettings.normalizeRegions(names)).toEqual({
      error: `One cloud can have at most ${MAX_OPENSTACK_REGIONS} regions.`,
    });
  });
});

describe("what is read beyond the defaults", () => {
  test.each([[null], [undefined], [{}]])("%j is nothing", (value: unknown) => {
    expect(OpenStackCollectionSettings.normalizeOptions(value)).toEqual({
      options: {},
    });
  });

  test("the switches, only when they are on", () => {
    expect(
      OpenStackCollectionSettings.normalizeOptions({
        collectPorts: true,
        collectProjectLimits: false,
      }),
    ).toEqual({ options: { collectPorts: true } });
  });

  test("a switch that is not a yes is not on", () => {
    expect(
      OpenStackCollectionSettings.normalizeOptions({
        collectPorts: "true",
        collectProjectLimits: 1,
      }),
    ).toEqual({ options: {} });
  });

  test("the scopes, trimmed and without repeats", () => {
    expect(
      OpenStackCollectionSettings.normalizeOptions({
        collectPorts: true,
        portNetworkIds: [" a ", "a", "", "b"],
        portProjectIds: ["c"],
      }),
    ).toEqual({
      options: {
        collectPorts: true,
        portNetworkIds: ["a", "b"],
        portProjectIds: ["c"],
      },
    });
  });

  test("anything else in it never reaches a probe", () => {
    expect(
      OpenStackCollectionSettings.normalizeOptions({
        collectPorts: true,
        somethingElse: { a: 1 },
      }),
    ).toEqual({ options: { collectPorts: true } });
  });

  test.each([
    ["a list", []],
    ["text", "ports"],
    ["a number", 7],
  ])("%s is not options", (_name: string, value: unknown) => {
    expect(
      OpenStackCollectionSettings.normalizeOptions(value).error,
    ).toBeDefined();
  });

  test.each([
    ["not a list", { portNetworkIds: "a" }],
    ["not text", { portProjectIds: [7] }],
  ])("scopes %s", (_name: string, value: unknown) => {
    expect(OpenStackCollectionSettings.normalizeOptions(value)).toEqual({
      error: "Name ports' networks and projects by their IDs.",
    });
  });

  test("an ID too long to be one", () => {
    expect(
      OpenStackCollectionSettings.normalizeOptions({
        portNetworkIds: ["x".repeat(MAX_OPENSTACK_CREDENTIAL_FIELD_LENGTH + 1)],
      }).error,
    ).toContain("too long");
  });

  test("each scope is a list on every collection, so there is a limit to them", () => {
    const ids: Array<string> = Array.from(
      { length: MAX_OPENSTACK_PORT_SCOPES },
      (_value: unknown, index: number): string => {
        return `id-${index}`;
      },
    );

    expect(
      OpenStackCollectionSettings.normalizeOptions({ portNetworkIds: ids })
        .error,
    ).toBeUndefined();

    expect(
      OpenStackCollectionSettings.normalizeOptions({
        portNetworkIds: ids,
        portProjectIds: ["one-too-many"],
      }).error,
    ).toContain(`at most ${MAX_OPENSTACK_PORT_SCOPES}`);
  });
});

describe("the certificates a person trusted", () => {
  test("in the one spelling, without repeats", () => {
    expect(
      OpenStackCollectionSettings.normalizeFingerprints([
        FINGERPRINT_A,
        FINGERPRINT_A.toLowerCase(),
        FINGERPRINT_A.split(":").join(""),
        FINGERPRINT_B,
      ]),
    ).toEqual({ fingerprints: [FINGERPRINT_A, FINGERPRINT_B] });
  });

  test("one by itself", () => {
    expect(
      OpenStackCollectionSettings.normalizeFingerprints(FINGERPRINT_A),
    ).toEqual({ fingerprints: [FINGERPRINT_A] });
  });

  test.each([[null], [undefined], [""]])("%j is none", (value: unknown) => {
    expect(OpenStackCollectionSettings.normalizeFingerprints(value)).toEqual({
      fingerprints: [],
    });
  });

  test.each([[["not a fingerprint"]], [["AA:BB"]], [[7]], [[null]], ["AA"]])(
    "%j is not a fingerprint",
    (value: unknown) => {
      expect(
        OpenStackCollectionSettings.normalizeFingerprints(value).error,
      ).toContain("SHA-256");
    },
  );

  test("a host per service, and no more than a cloud can have", () => {
    const many: Array<string> = Array.from(
      { length: MAX_OPENSTACK_TRUSTED_CERTIFICATES + 1 },
      (_value: unknown, index: number): string => {
        return Array.from({ length: 32 }, () => {
          return index.toString(16).padStart(2, "0").toUpperCase();
        }).join(":");
      },
    );

    expect(
      OpenStackCollectionSettings.normalizeFingerprints(
        many.slice(0, MAX_OPENSTACK_TRUSTED_CERTIFICATES),
      ).error,
    ).toBeUndefined();

    expect(OpenStackCollectionSettings.normalizeFingerprints(many)).toEqual({
      error: `One cloud can trust at most ${MAX_OPENSTACK_TRUSTED_CERTIFICATES} certificates.`,
    });
  });
});
