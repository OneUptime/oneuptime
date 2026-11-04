import { describe, expect, test } from "@jest/globals";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudConnectionTest from "Common/Models/DatabaseModels/OpenStackCloudConnectionTest";
import Probe from "Common/Models/DatabaseModels/Probe";
import ObjectID from "Common/Types/ObjectID";
import OpenStackCollectionErrorCode, {
  OpenStackCollectionErrorUtil,
} from "Common/Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod from "Common/Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus from "Common/Types/OpenStack/OpenStackCollectionStatus";
import OpenStackConnectionTestStatus from "Common/Types/OpenStack/OpenStackConnectionTestStatus";
import {
  OpenStackAccessRead,
  OpenStackCollectionSummary,
  OpenStackConnectionTestSummary,
  OpenStackPresentedCertificate,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import { MAX_OPENSTACK_PORT_SCOPES } from "Common/Utils/OpenStack/OpenStackCollectionSettings";
import {
  OpenStackCollectionStatusView,
  OpenStackCollectionTone,
  OpenStackConnectionTestInput,
  OpenStackConnectionTestPhase,
  OpenStackConnectionTestView,
  OpenStackServiceRow,
  OpenStackTestReadRow,
  getDefaultOpenStackCollectionProbeId,
  getOpenStackCollectionProbeOptions,
  getOpenStackCollectionProbes,
  getOpenStackCollectionStatusView,
  getOpenStackConnectionTestBlocker,
  getOpenStackConnectionTestInput,
  getOpenStackConnectionTestView,
  getOpenStackInventoryPhrases,
  getOpenStackServiceRows,
  getOpenStackSwitchToProbeStart,
  isOpenStackConnectionTestSettled,
  isOpenStackProbeCollected,
  keepOpenStackCredentialKind,
  readOpenStackCredentialKind,
  readOpenStackNames,
  readOpenStackOptions,
  validateOpenStackAuthUrl,
  validateOpenStackFingerprints,
  validateOpenStackOptions,
  validateOpenStackRegions,
} from "../../FeatureSet/Dashboard/src/Components/OpenStack/OpenStackProbeCollectionView";

/*
 * What the Dashboard says about a cloud a probe collects: the probes it may be collected
 * through, where a connection test stands and exactly what it found, how the last collection
 * went and the one next step that fixes it, and what its forms hold.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const OWN: string = "12121212-0000-4000-8000-000000000001";
const OTHER_OWN: string = "12121212-0000-4000-8000-000000000002";
const GLOBAL: string = "12121212-0000-4000-8000-000000000003";
const CLOUD: string = "12121212-0000-4000-8000-000000000004";

const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

const CERTIFICATE: OpenStackPresentedCertificate = {
  fingerprint256: FINGERPRINT,
  subject: "CN=keystone.example.com",
  issuer: "CN=Cloud CA",
  isSelfSigned: false,
  host: "keystone.example.com",
  port: 5000,
};

function probe(data: {
  id?: string | undefined;
  name?: string | undefined;
  isGlobalProbe?: boolean | undefined;
}): Probe {
  const item: Probe = new Probe();

  if (data.id) {
    item._id = data.id;
  }

  if (data.name !== undefined) {
    item.name = data.name;
  }

  item.isGlobalProbe = Boolean(data.isGlobalProbe);

  return item;
}

const PROBES: Array<Probe> = [
  probe({ id: OWN, name: "Datacenter probe" }),
  probe({ id: GLOBAL, name: "probe-1", isGlobalProbe: true }),
  probe({ name: "no id" }),
];

function read(overrides: Partial<OpenStackAccessRead>): OpenStackAccessRead {
  return {
    regionName: "RegionOne",
    service: OpenStackServiceType.Compute,
    read: "servers",
    access: "ReadsEverything",
    ...overrides,
  };
}

function testSummary(
  overrides: Partial<OpenStackConnectionTestSummary> = {},
): OpenStackConnectionTestSummary {
  return {
    credentialKind: "applicationCredential",
    projectName: "monitoring",
    roleNames: ["reader", "oneuptime_monitoring"],
    hasAccessRules: true,
    isUnrestricted: false,
    canProbablyWrite: false,
    regionsInCatalog: ["RegionOne", "RegionTwo"],
    servicesByRegion: {},
    accessLevel: "FullView",
    reads: [],
    warnings: [],
    ...overrides,
  };
}

function collectionSummary(
  overrides: Partial<OpenStackCollectionSummary> = {},
): OpenStackCollectionSummary {
  return {
    credentialKind: "applicationCredential",
    regionNames: ["RegionOne"],
    services: [],
    hypervisorCount: 48,
    instanceCount: 1,
    networkCount: 2,
    volumeCount: 3,
    projectCount: 4,
    warnings: [],
    ...overrides,
  };
}

function testView(
  data: Partial<OpenStackCloudConnectionTest>,
): OpenStackConnectionTestView {
  const test: OpenStackCloudConnectionTest = new OpenStackCloudConnectionTest();
  Object.assign(test, data);
  return getOpenStackConnectionTestView(test, ENGLISH);
}

function statusView(
  data: Partial<OpenStackCloud>,
): OpenStackCollectionStatusView {
  const cloud: OpenStackCloud = new OpenStackCloud();
  Object.assign(cloud, data);
  return getOpenStackCollectionStatusView(cloud, ENGLISH);
}

function input(
  overrides: Partial<OpenStackConnectionTestInput> = {},
): OpenStackConnectionTestInput {
  return {
    authUrl: "https://keystone.example.com:5000/v3",
    endpointInterface: "public",
    regions: [],
    credentialKind: "applicationCredential",
    applicationCredentialId: "credential-id",
    keystoneUsername: "",
    userDomainName: "",
    projectName: "",
    projectDomainName: "",
    credentialSecret: "secret",
    probeId: OWN,
    trustedCertificateFingerprints: [],
    ...overrides,
  };
}

describe("the probes a cloud may be collected through", () => {
  test("on OneUptime Cloud a shared probe is never offered: it would receive a credential", () => {
    expect(
      getOpenStackCollectionProbes(PROBES, true).map((item: Probe) => {
        return item._id;
      }),
    ).toEqual([OWN]);
  });

  test("on a self-hosted instance its own probes can collect, and say so", () => {
    expect(getOpenStackCollectionProbeOptions(PROBES, false, ENGLISH)).toEqual([
      { label: "Datacenter probe", value: OWN },
      { label: "probe-1 (this instance's probe)", value: GLOBAL },
    ]);
  });

  test("a probe with no name is still named", () => {
    expect(
      getOpenStackCollectionProbeOptions([probe({ id: OWN })], true, ENGLISH),
    ).toEqual([{ label: `Probe ${OWN}`, value: OWN }]);
  });

  test("a new cloud starts on the only probe it may use, and on none when there is a choice", () => {
    expect(getDefaultOpenStackCollectionProbeId(PROBES, true)).toBe(OWN);
    expect(getDefaultOpenStackCollectionProbeId(PROBES, false)).toBe("");
    expect(getDefaultOpenStackCollectionProbeId([], true)).toBe("");
    expect(
      getDefaultOpenStackCollectionProbeId(
        [
          probe({ id: OWN, name: "one" }),
          probe({ id: OTHER_OWN, name: "two" }),
        ],
        true,
      ),
    ).toBe("");
  });

  test("a cloud is probe-collected only when it says so", () => {
    expect(isOpenStackProbeCollected(null)).toBe(false);
    expect(isOpenStackProbeCollected(undefined)).toBe(false);
    expect(isOpenStackProbeCollected({})).toBe(false);
    expect(
      isOpenStackProbeCollected({
        collectionMethod: OpenStackCollectionMethod.Agent,
      }),
    ).toBe(false);
    expect(
      isOpenStackProbeCollected({
        collectionMethod: OpenStackCollectionMethod.Probe,
      }),
    ).toBe(true);
  });
});

describe("what a connection test found", () => {
  test("waits for the probe, then says it is connecting, and neither is settled", () => {
    expect(testView({})).toMatchObject({
      phase: OpenStackConnectionTestPhase.Waiting,
      title: "Waiting for the probe to pick the test up…",
    });
    expect(
      testView({ status: OpenStackConnectionTestStatus.Running }),
    ).toMatchObject({
      phase: OpenStackConnectionTestPhase.Running,
      title: "The probe is connecting to the cloud…",
    });
    expect(isOpenStackConnectionTestSettled(undefined)).toBe(false);
    expect(
      isOpenStackConnectionTestSettled(OpenStackConnectionTestStatus.Pending),
    ).toBe(false);
    expect(
      isOpenStackConnectionTestSettled(OpenStackConnectionTestStatus.Running),
    ).toBe(false);
    expect(
      isOpenStackConnectionTestSettled(OpenStackConnectionTestStatus.Succeeded),
    ).toBe(true);
    expect(
      isOpenStackConnectionTestSettled(OpenStackConnectionTestStatus.Failed),
    ).toBe(true);
  });

  test.each([
    ["FullView", "This credential has the Full view"],
    ["InfrastructureOnly", "This credential is Infrastructure only"],
    ["ProjectView", "This credential has the Project view"],
    ["Other", "This credential reads part of what monitoring needs"],
  ] as Array<[OpenStackConnectionTestSummary["accessLevel"], string]>)(
    "a login that worked says the access level %s in the docs' words",
    (
      accessLevel: OpenStackConnectionTestSummary["accessLevel"],
      words: string,
    ) => {
      const view: OpenStackConnectionTestView = testView({
        status: OpenStackConnectionTestStatus.Succeeded,
        summary: testSummary({ accessLevel: accessLevel }),
      });

      expect(view.phase).toBe(OpenStackConnectionTestPhase.Succeeded);
      expect(view.title).toContain(words);
      expect(view.nextStep).toBeNull();
      expect(view.certificate).toBeNull();
    },
  );

  test("an answer with no summary still says it logged in, without claiming how much it reads", () => {
    expect(
      testView({ status: OpenStackConnectionTestStatus.Succeeded }).title,
    ).toContain("reads part of what monitoring needs");
  });

  test("says what it logged in as, and every region the catalog names", () => {
    const view: OpenStackConnectionTestView = testView({
      status: OpenStackConnectionTestStatus.Succeeded,
      summary: testSummary(),
    });

    expect(view.credentialLine).toBe(
      "Logged in to project monitoring with the roles reader, oneuptime_monitoring.",
    );
    expect(view.regionsInCatalog).toEqual(["RegionOne", "RegionTwo"]);

    expect(
      testView({
        status: OpenStackConnectionTestStatus.Succeeded,
        summary: testSummary({ roleNames: [] }),
      }).credentialLine,
    ).toBe("Logged in to project monitoring.");

    const { projectName: _left, ...withoutProject } = testSummary();
    void _left;

    expect(
      testView({
        status: OpenStackConnectionTestStatus.Succeeded,
        summary: withoutProject,
      }).credentialLine,
    ).toBeNull();
  });

  test("counts what answered in full, and lists the rest with the worst first", () => {
    const view: OpenStackConnectionTestView = testView({
      status: OpenStackConnectionTestStatus.Succeeded,
      summary: testSummary({
        reads: [
          read({ read: "servers" }),
          read({
            service: OpenStackServiceType.Volume,
            read: "volumes",
            access: "NotDeployed",
          }),
          read({
            service: OpenStackServiceType.Network,
            read: "networks",
            access: "OwnProjectOnly",
            reason: "1 project in 14 rows",
            goesWithout: "Networks of other projects",
            fix: "Assign the reader role on them.",
          }),
          read({
            service: OpenStackServiceType.Compute,
            read: "hypervisors",
            access: "Refused",
            reason: "HTTP 403",
          }),
          read({
            service: OpenStackServiceType.Placement,
            read: "resource providers",
            regionName: "RegionTwo",
            access: "Failing",
            reason: "HTTP 500",
          }),
          read({ read: "flavors" }),
        ],
      }),
    });

    expect(view.fullReadCount).toBe(2);
    expect(
      view.reads.map((row: OpenStackTestReadRow) => {
        return [row.label, row.title];
      }),
    ).toEqual([
      ["Failing", "Placement, RegionTwo: resource providers"],
      ["Refused", "Compute (Nova), RegionOne: hypervisors"],
      ["Own project only", "Networking (Neutron), RegionOne: networks"],
      ["Not deployed", "Block Storage (Cinder), RegionOne: volumes"],
    ]);

    expect(view.reads[2]).toMatchObject({
      reason: "1 project in 14 rows",
      goesWithout: "Networks of other projects",
      fix: "Assign the reader role on them.",
    });
    expect(view.reads[3]).toMatchObject({
      reason: null,
      goesWithout: null,
      fix: null,
    });

    // A key per read: the same read in two regions is two rows.
    expect(
      new Set(
        view.reads.map((row: OpenStackTestReadRow) => {
          return row.key;
        }),
      ).size,
    ).toBe(4);
  });

  test("a read of an unknown service is still named by what the probe called it", () => {
    const view: OpenStackConnectionTestView = testView({
      status: OpenStackConnectionTestStatus.Succeeded,
      summary: testSummary({
        reads: [
          read({
            service: "share" as OpenStackServiceType,
            read: "shares",
            access: "Refused",
          }),
        ],
      }),
    });

    expect(view.reads[0]!.title).toBe("share, RegionOne: shares");
  });

  test.each(Object.values(OpenStackCollectionErrorCode))(
    "a test that failed with %s says exactly what failed and what to do",
    (code: OpenStackCollectionErrorCode) => {
      const view: OpenStackConnectionTestView = testView({
        status: OpenStackConnectionTestStatus.Failed,
        errorCode: code,
        errorMessage: "What the probe wrote.",
      });

      expect(view.phase).toBe(OpenStackConnectionTestPhase.Failed);
      expect(view.title).toBe(
        OpenStackCollectionErrorUtil.getAdvice(code).title,
      );
      expect(view.nextStep).toBe(
        OpenStackCollectionErrorUtil.getAdvice(code).nextStep,
      );
      expect(view.message).toBe("What the probe wrote.");
      expect(view.title.length).toBeGreaterThan(0);
      expect((view.nextStep || "").length).toBeGreaterThan(0);
    },
  );

  test("a code nobody knows reads as OneUptime's own failure, never as nothing", () => {
    const view: OpenStackConnectionTestView = testView({
      status: OpenStackConnectionTestStatus.Failed,
      errorCode: "SomethingNew" as OpenStackCollectionErrorCode,
    });

    expect(view.title).toBe(
      OpenStackCollectionErrorUtil.getAdvice(
        OpenStackCollectionErrorCode.Internal,
      ).title,
    );
    expect(view.message).toBeNull();
  });

  test("a catalog on plain HTTP says to turn on TLS or use the agent", () => {
    const view: OpenStackConnectionTestView = testView({
      status: OpenStackConnectionTestStatus.Failed,
      errorCode: OpenStackCollectionErrorCode.InsecureEndpoint,
      errorMessage:
        "The catalog puts Compute (Nova) on plain HTTP, such as http://10.0.0.1:8774.",
    });

    expect(view.title).toBe("The catalog names a plain HTTP endpoint");
    expect(view.nextStep).toContain("Turn on TLS");
    expect(view.nextStep).toContain("use the OpenStack agent");
    expect(view.certificate).toBeNull();
  });

  test("offers the certificate only where trusting it is the fix", () => {
    for (const code of [
      OpenStackCollectionErrorCode.UntrustedCertificate,
      OpenStackCollectionErrorCode.CertificateChanged,
    ]) {
      expect(
        testView({
          status: OpenStackConnectionTestStatus.Failed,
          errorCode: code,
          presentedCertificate: CERTIFICATE,
        }).certificate,
      ).toEqual(CERTIFICATE);
    }

    expect(
      testView({
        status: OpenStackConnectionTestStatus.Failed,
        errorCode: OpenStackCollectionErrorCode.TlsFailed,
        presentedCertificate: CERTIFICATE,
      }).certificate,
    ).toBeNull();

    // A certificate with no fingerprint cannot be trusted.
    expect(
      testView({
        status: OpenStackConnectionTestStatus.Failed,
        errorCode: OpenStackCollectionErrorCode.UntrustedCertificate,
        presentedCertificate: { ...CERTIFICATE, fingerprint256: "" },
      }).certificate,
    ).toBeNull();
  });

  test("a test that stopped part of the way still says what it found", () => {
    const view: OpenStackConnectionTestView = testView({
      status: OpenStackConnectionTestStatus.Failed,
      errorCode: OpenStackCollectionErrorCode.NoPermission,
      summary: testSummary({
        accessLevel: "Other",
        reads: [read({ access: "Refused", reason: "HTTP 403" })],
        warnings: ["Keystone's list_limit cut the project list short."],
      }),
    });

    expect(view.regionsInCatalog).toEqual(["RegionOne", "RegionTwo"]);
    expect(view.reads).toHaveLength(1);
    expect(view.warnings).toEqual([
      "Keystone's list_limit cut the project list short.",
    ]);
  });
});

describe("how the last collection went", () => {
  test("nothing yet: checking, and the page asks again", () => {
    for (const status of [undefined, OpenStackCollectionStatus.Pending]) {
      const view: OpenStackCollectionStatusView = statusView(
        status ? { collectionStatus: status } : {},
      );

      expect(view).toMatchObject({
        tone: OpenStackCollectionTone.Checking,
        label: "Checking",
        title:
          "The probe collects this cloud with its new settings within a minute.",
        isPending: true,
      });
    }
  });

  test("succeeded: collecting, and nothing more to do", () => {
    expect(
      statusView({ collectionStatus: OpenStackCollectionStatus.Succeeded }),
    ).toEqual({
      tone: OpenStackCollectionTone.Collecting,
      label: "Collecting",
      title: "The probe is collecting this cloud.",
      message: null,
      nextStep: null,
      certificate: null,
      isPending: false,
    });
  });

  test("failed: not collecting, why, and the certificate where that is the fix", () => {
    const view: OpenStackCollectionStatusView = statusView({
      collectionStatus: OpenStackCollectionStatus.Failed,
      collectionErrorCode: OpenStackCollectionErrorCode.UntrustedCertificate,
      collectionError: "keystone.example.com's certificate is not trusted.",
      presentedCertificate: CERTIFICATE,
    });

    expect(view).toMatchObject({
      tone: OpenStackCollectionTone.Failing,
      label: "Not collecting",
      title: OpenStackCollectionErrorUtil.getAdvice(
        OpenStackCollectionErrorCode.UntrustedCertificate,
      ).title,
      message: "keystone.example.com's certificate is not trusted.",
      certificate: CERTIFICATE,
      isPending: false,
    });
  });

  test("partly: some services read, and it says what the rest need", () => {
    const view: OpenStackCollectionStatusView = statusView({
      collectionStatus: OpenStackCollectionStatus.PartiallySucceeded,
      collectionErrorCode: OpenStackCollectionErrorCode.NoPermission,
      collectionError: "Neutron refused the credential.",
    });

    expect(view).toMatchObject({
      tone: OpenStackCollectionTone.Partial,
      label: "Partly collecting",
      message: "Neutron refused the credential.",
      certificate: null,
      isPending: false,
    });
    expect((view.nextStep || "").length).toBeGreaterThan(0);
  });

  test("names the services that went without, and only those", () => {
    const rows: Array<OpenStackServiceRow> = getOpenStackServiceRows(
      collectionSummary({
        services: [
          {
            service: OpenStackServiceType.Compute,
            regionName: "RegionOne",
            outcome: "Succeeded",
            durationInMs: 10,
            requestCount: 3,
          },
          {
            service: OpenStackServiceType.Network,
            regionName: "RegionOne",
            outcome: "Failed",
            errorMessage: "Neutron answered HTTP 500.",
            durationInMs: 10,
            requestCount: 3,
          },
          {
            service: OpenStackServiceType.Volume,
            regionName: "RegionOne",
            outcome: "Refused",
            durationInMs: 10,
            requestCount: 1,
          },
          {
            service: OpenStackServiceType.Image,
            regionName: "RegionOne",
            outcome: "NotDeployed",
            durationInMs: 10,
            requestCount: 0,
          },
          {
            service: OpenStackServiceType.Placement,
            regionName: "RegionOne",
            outcome: "NotDue",
            durationInMs: 10,
            requestCount: 0,
          },
          {
            service: OpenStackServiceType.Identity,
            regionName: "RegionOne",
            outcome: "BackingOff",
            durationInMs: 10,
            requestCount: 0,
          },
          {
            service: OpenStackServiceType.Compute,
            regionName: "RegionTwo",
            outcome: "Partial",
            durationInMs: 10,
            requestCount: 3,
          },
        ],
      }),
      ENGLISH,
    );

    expect(
      rows.map((row: OpenStackServiceRow) => {
        return [row.label, row.title, row.message];
      }),
    ).toEqual([
      [
        "Failed",
        "Networking (Neutron), RegionOne",
        "Neutron answered HTTP 500.",
      ],
      ["Refused", "Block Storage (Cinder), RegionOne", null],
      ["Backing off", "Identity (Keystone), RegionOne", null],
      ["Read in part", "Compute (Nova), RegionTwo", null],
    ]);

    expect(getOpenStackServiceRows(null, ENGLISH)).toEqual([]);
    expect(getOpenStackServiceRows(undefined, ENGLISH)).toEqual([]);
  });

  test("says what was read in short phrases, with the plural right", () => {
    expect(getOpenStackInventoryPhrases(collectionSummary(), ENGLISH)).toEqual([
      "48 hypervisors",
      "1 instance",
      "2 networks",
      "3 volumes",
      "4 projects",
    ]);
    expect(getOpenStackInventoryPhrases(null, ENGLISH)).toEqual([]);
  });
});

describe("what Test connection tries", () => {
  test("needs the address and a probe", () => {
    const message: string = "Enter Keystone's address and pick a probe first.";

    expect(getOpenStackConnectionTestBlocker(input({ authUrl: "  " }))).toBe(
      message,
    );
    expect(getOpenStackConnectionTestBlocker(input({ probeId: "" }))).toBe(
      message,
    );
  });

  test("a secret typed goes with what it belongs to", () => {
    const message: string =
      "Enter what the secret belongs to: the application credential's ID, or the user name and project.";

    expect(
      getOpenStackConnectionTestBlocker(
        input({ applicationCredentialId: " " }),
      ),
    ).toBe(message);
    expect(
      getOpenStackConnectionTestBlocker(
        input({ credentialKind: "password", keystoneUsername: "reader" }),
      ),
    ).toBe(message);
    expect(
      getOpenStackConnectionTestBlocker(
        input({ credentialKind: "password", projectName: "monitoring" }),
      ),
    ).toBe(message);
    expect(
      getOpenStackConnectionTestBlocker(
        input({
          credentialKind: "password",
          keystoneUsername: "reader",
          projectName: "monitoring",
        }),
      ),
    ).toBeNull();
    expect(getOpenStackConnectionTestBlocker(input())).toBeNull();
  });

  test("no secret: a new cloud has to give one, a saved cloud tests its own", () => {
    expect(
      getOpenStackConnectionTestBlocker(input({ credentialSecret: "" })),
    ).toBe("Enter the credential's secret first.");
    expect(
      getOpenStackConnectionTestBlocker(
        input({
          credentialSecret: "",
          applicationCredentialId: "",
          openStackCloudId: new ObjectID(CLOUD),
        }),
      ),
    ).toBeNull();
  });

  test("reads the form as it stands, for either kind of credential", () => {
    expect(
      getOpenStackConnectionTestInput({
        authUrl: "https://keystone.example.com",
        endpointInterface: "internal",
        collectionRegions: ["RegionOne", "RegionTwo"],
        credentialKind: "password",
        keystoneUsername: "reader",
        userDomainName: "Example",
        projectName: "monitoring",
        projectDomainName: "Example",
        credentialSecret: "secret",
        collectionProbe: OWN,
        trustedCertificateFingerprints: [FINGERPRINT],
      } as unknown as FormValues<OpenStackCloud>),
    ).toEqual({
      authUrl: "https://keystone.example.com",
      endpointInterface: "internal",
      regions: ["RegionOne", "RegionTwo"],
      credentialKind: "password",
      applicationCredentialId: "",
      keystoneUsername: "reader",
      userDomainName: "Example",
      projectName: "monitoring",
      projectDomainName: "Example",
      credentialSecret: "secret",
      probeId: OWN,
      trustedCertificateFingerprints: [FINGERPRINT],
      openStackCloudId: undefined,
    });
  });

  test("an empty form tries public, and every region the catalog names", () => {
    expect(
      getOpenStackConnectionTestInput(
        {} as unknown as FormValues<OpenStackCloud>,
        new ObjectID(CLOUD),
      ),
    ).toMatchObject({
      authUrl: "",
      endpointInterface: "public",
      regions: [],
      credentialKind: "applicationCredential",
      credentialSecret: "",
      probeId: "",
      trustedCertificateFingerprints: [],
    });
  });

  test("an interface the column does not know starts on public", () => {
    expect(
      getOpenStackConnectionTestInput({
        endpointInterface: "sideways",
      } as unknown as FormValues<OpenStackCloud>).endpointInterface,
    ).toBe("public");
  });

  test.each([
    ["an id", OWN, OWN],
    ["an ObjectID", new ObjectID(OWN), OWN],
    ["a relation", { _id: OWN }, OWN],
    ["a relation that says id", { id: OWN }, OWN],
    ["nothing", null, ""],
  ])("reads the probe from %s", (_how: string, value: unknown, id: string) => {
    expect(
      getOpenStackConnectionTestInput({
        collectionProbe: value,
      } as unknown as FormValues<OpenStackCloud>).probeId,
    ).toBe(id);
  });

  test("reads the probe from the id column when the relation is not there", () => {
    expect(
      getOpenStackConnectionTestInput({
        collectionProbeId: OWN,
      } as unknown as FormValues<OpenStackCloud>).probeId,
    ).toBe(OWN);
  });
});

describe("what the forms hold", () => {
  test("a list of names, however it was given", () => {
    expect(readOpenStackNames(["RegionOne", " RegionTwo "])).toEqual([
      "RegionOne",
      "RegionTwo",
    ]);
    expect(readOpenStackNames("RegionOne, RegionTwo\nRegionThree,")).toEqual([
      "RegionOne",
      "RegionTwo",
      "RegionThree",
    ]);
    expect(readOpenStackNames("Region One, Region Two")).toEqual([
      "Region One",
      "Region Two",
    ]);
    expect(readOpenStackNames(["a", "a", ""])).toEqual(["a"]);
    expect(readOpenStackNames(null)).toEqual([]);
    expect(readOpenStackNames(undefined)).toEqual([]);
    expect(readOpenStackNames(7)).toEqual([]);
  });

  test("the kind of credential is an application credential unless it says password", () => {
    expect(readOpenStackCredentialKind({ credentialKind: "password" })).toBe(
      "password",
    );
    expect(
      readOpenStackCredentialKind({ credentialKind: "applicationCredential" }),
    ).toBe("applicationCredential");
    expect(readOpenStackCredentialKind({ credentialKind: null })).toBe(
      "applicationCredential",
    );
    expect(readOpenStackCredentialKind({})).toBe("applicationCredential");
  });

  test("the address is held to the server's own rule, and says what to do about plain HTTP", () => {
    expect(
      validateOpenStackAuthUrl("https://keystone.example.com:5000/v3"),
    ).toBeNull();

    const refusal: string | null = validateOpenStackAuthUrl(
      "http://keystone.example.com:5000/v3",
    );

    expect(refusal).toContain("Use https://.");
    expect(refusal).toContain("turn on TLS");
    expect(refusal).toContain("use the OpenStack agent");
    expect(validateOpenStackAuthUrl(undefined)).not.toBeNull();
  });

  test("regions, certificates and options are held to the server's rules too", () => {
    expect(validateOpenStackRegions(["RegionOne"])).toBeNull();
    expect(validateOpenStackRegions(["x".repeat(256)])).toBe(
      "That region's name is too long to be one.",
    );

    expect(validateOpenStackFingerprints([])).toBeNull();
    expect(validateOpenStackFingerprints(null)).toBeNull();
    expect(validateOpenStackFingerprints([FINGERPRINT])).toBeNull();
    expect(validateOpenStackFingerprints(["AB:CD"])).not.toBeNull();

    expect(validateOpenStackOptions(null)).toBeNull();
    expect(validateOpenStackOptions({ collectPorts: true })).toBeNull();
    expect(
      validateOpenStackOptions({
        collectPorts: true,
        portNetworkIds: Array.from(
          { length: MAX_OPENSTACK_PORT_SCOPES + 1 },
          (_value: unknown, index: number): string => {
            return `network-${index}`;
          },
        ),
      }),
    ).toContain("networks and projects to read ports from");
  });

  test("what is read beyond the defaults stays as a person set it, even past the limit", () => {
    expect(readOpenStackOptions(null)).toEqual({});
    expect(readOpenStackOptions("nonsense")).toEqual({});
    expect(readOpenStackOptions([])).toEqual({});
    expect(
      readOpenStackOptions({
        collectPorts: true,
        collectProjectLimits: true,
        portNetworkIds: [" network-1 ", ""],
        portProjectIds: [],
        somethingElse: true,
      }),
    ).toEqual({
      collectPorts: true,
      collectProjectLimits: true,
      portNetworkIds: ["network-1"],
    });

    // One list too long is said by the validation: it does not turn the switch off.
    const tooMany: Array<string> = Array.from(
      { length: MAX_OPENSTACK_PORT_SCOPES + 1 },
      (_value: unknown, index: number): string => {
        return `network-${index}`;
      },
    );

    expect(
      readOpenStackOptions({ collectPorts: true, portNetworkIds: tooMany }),
    ).toEqual({ collectPorts: true, portNetworkIds: tooMany });
  });

  test("a switch to a probe starts on an application credential and the only probe", () => {
    expect(
      getOpenStackSwitchToProbeStart({
        cloud: null,
        probes: PROBES,
        isBillingEnabled: true,
      }),
    ).toEqual({
      credentialKind: "applicationCredential",
      collectionProbe: OWN,
    });
  });

  test("a switch back to a probe starts from how the cloud last logged in", () => {
    expect(
      getOpenStackSwitchToProbeStart({
        cloud: {
          credentialKind: "password",
          collectionProbeId: new ObjectID(OTHER_OWN),
        },
        probes: PROBES,
        isBillingEnabled: true,
      }),
    ).toEqual({ credentialKind: "password" });
  });

  test("a switch with a choice of probes leaves the choice to the person", () => {
    expect(
      getOpenStackSwitchToProbeStart({
        cloud: null,
        probes: PROBES,
        isBillingEnabled: false,
      }),
    ).toEqual({ credentialKind: "applicationCredential" });
  });

  test("only the kind of credential the form is on is sent", () => {
    const password: OpenStackCloud = new OpenStackCloud();
    password.credentialKind = "password";
    password.applicationCredentialId = "";
    password.keystoneUsername = "reader";
    password.userDomainName = "Example";
    password.projectName = "monitoring";
    password.projectDomainName = "Example";

    const sentForPassword: OpenStackCloud =
      keepOpenStackCredentialKind(password);

    expect(sentForPassword.applicationCredentialId).toBeUndefined();
    expect(sentForPassword.keystoneUsername).toBe("reader");
    expect(sentForPassword.userDomainName).toBe("Example");
    expect(sentForPassword.projectName).toBe("monitoring");
    expect(sentForPassword.projectDomainName).toBe("Example");

    const applicationCredential: OpenStackCloud = new OpenStackCloud();
    applicationCredential.credentialKind = "applicationCredential";
    applicationCredential.applicationCredentialId = "credential-id";
    applicationCredential.keystoneUsername = "";
    applicationCredential.userDomainName = "";
    applicationCredential.projectName = "";
    applicationCredential.projectDomainName = "";

    const sentForApplicationCredential: OpenStackCloud =
      keepOpenStackCredentialKind(applicationCredential);

    expect(sentForApplicationCredential.applicationCredentialId).toBe(
      "credential-id",
    );
    expect(sentForApplicationCredential.keystoneUsername).toBeUndefined();
    expect(sentForApplicationCredential.userDomainName).toBeUndefined();
    expect(sentForApplicationCredential.projectName).toBeUndefined();
    expect(sentForApplicationCredential.projectDomainName).toBeUndefined();
  });
});
