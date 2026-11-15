import { describe, expect, test } from "@jest/globals";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterConnectionTest from "Common/Models/DatabaseModels/VMwareVCenterConnectionTest";
import ObjectID from "Common/Types/ObjectID";
import VMwareCollectionErrorCode, {
  VMwareCollectionErrorUtil,
} from "Common/Types/VMware/VMwareCollectionError";
import { ClaimDueState } from "Common/Utils/Probe/ClaimDueTime";
import { getNextClaimWords } from "../../FeatureSet/Dashboard/src/Components/Probe/NextClaimWords";
import VMwareCollectionMethod from "Common/Types/VMware/VMwareCollectionMethod";
import VMwareCollectionStatus from "Common/Types/VMware/VMwareCollectionStatus";
import VMwareConnectionTestStatus from "Common/Types/VMware/VMwareConnectionTestStatus";
import { VMwareCollectionSummary } from "Common/Types/VMware/VMwareProbeCollection";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  VMWARE_COLLECTION_OVERDUE_AFTER_IN_MS,
  VMwareCollectionStatusView,
  VMwareCollectionTone,
  VMwareConnectionTestPhase,
  getDefaultVMwareCollectionProbeId,
  getVMwareCollectionProbeOptions,
  getVMwareCollectionProbes,
  getVMwareCollectionStatusView,
  getVMwareConnectionTestBlocker,
  getVMwareConnectionTestInput,
  getVMwareConnectionTestView,
  getVMwareInventoryPhrases,
  getVMwareNextCollection,
  getVMwareProductLine,
  isProbeCollected,
  isVMwareConnectionTestSettled,
  validateTrustedCertificate,
  validateVCenterAddress,
} from "../../FeatureSet/Dashboard/src/Components/VMware/VMwareProbeCollectionView";

/*
 * What the Dashboard says about a vCenter a probe collects: the probes it
 * may be collected through, where a connection test stands, how the last
 * collection went and the one next step that fixes it.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const OWN: string = "11111111-0000-4000-8000-000000000001";
const OTHER_OWN: string = "11111111-0000-4000-8000-000000000002";
const GLOBAL: string = "11111111-0000-4000-8000-000000000003";

const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

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

const PROJECT: string = "22222222-0000-4000-8000-000000000001";
const OTHER_PROJECT: string = "22222222-0000-4000-8000-000000000002";

// The vCenter's probe as the card reads it: the project's own, connected.
function probeOf(
  overrides: {
    isGlobalProbe?: boolean;
    projectId?: string;
    connectionStatus?: ProbeConnectionStatus;
  } = {},
): Probe {
  const item: Probe = new Probe();
  item._id = OWN;
  item.name = "Datacenter probe";
  item.isGlobalProbe = overrides.isGlobalProbe === true;
  item.projectId = new ObjectID(overrides.projectId || PROJECT);
  item.connectionStatus =
    overrides.connectionStatus || ProbeConnectionStatus.Connected;

  return item;
}

// What the claim needs to hand a vCenter to its probe (VMwareCollectionStop).
const COLLECTABLE: Partial<VMwareVCenter> = {
  projectId: new ObjectID(PROJECT),
  isVCenterPasswordSet: true,
  vcenterUrl: "https://vcsa.example.com",
  vcenterUsername: "monitoring@vsphere.local",
  collectionProbeId: new ObjectID(OWN),
  collectionProbe: probeOf(),
};

function summary(
  overrides: Partial<VMwareCollectionSummary> = {},
): VMwareCollectionSummary {
  return {
    productName: "VMware vCenter Server",
    version: "8.0.2",
    datacenterCount: 1,
    clusterCount: 2,
    hostCount: 5,
    vmCount: 10,
    poweredOnVmCount: 9,
    templateCount: 1,
    datastoreCount: 1,
    resourcePoolCount: 4,
    warnings: [],
    ...overrides,
  };
}

describe("the probes a vCenter may be collected through", () => {
  test("on OneUptime Cloud, only the project's own: a shared probe never receives a password", () => {
    expect(
      getVMwareCollectionProbes(PROBES, true).map((item: Probe) => {
        return item._id;
      }),
    ).toEqual([OWN]);
  });

  test("on a self-hosted instance, its own global probes too, named as such", () => {
    expect(getVMwareCollectionProbeOptions(PROBES, false, ENGLISH)).toEqual([
      { label: "Datacenter probe", value: OWN },
      { label: "probe-1 (this instance's probe)", value: GLOBAL },
    ]);
  });

  test("a probe without a name is offered by its id", () => {
    expect(
      getVMwareCollectionProbeOptions([probe({ id: OWN })], true, ENGLISH),
    ).toEqual([{ label: `Probe ${OWN}`, value: OWN }]);
  });

  test("starts on the only probe it may use - and on none when there is a choice", () => {
    expect(getDefaultVMwareCollectionProbeId(PROBES, true)).toBe(OWN);
    expect(getDefaultVMwareCollectionProbeId(PROBES, false)).toBe("");
    expect(
      getDefaultVMwareCollectionProbeId(
        [...PROBES, probe({ id: OTHER_OWN, name: "Branch" })],
        true,
      ),
    ).toBe("");
    expect(getDefaultVMwareCollectionProbeId([], true)).toBe("");
  });
});

describe("what a collection or a test found", () => {
  test("the inventory as phrases, plural where it should be", () => {
    expect(getVMwareInventoryPhrases(summary(), ENGLISH)).toEqual([
      "1 datacenter",
      "2 clusters",
      "5 hosts",
      "10 virtual machines (9 running)",
      "1 datastore",
    ]);
    expect(
      getVMwareInventoryPhrases(
        summary({ vmCount: 1, poweredOnVmCount: 0 }),
        ENGLISH,
      ),
    ).toContain("1 virtual machine (0 running)");
    expect(getVMwareInventoryPhrases(null, ENGLISH)).toEqual([]);
  });

  test("what vCenter is, from its own answer", () => {
    expect(getVMwareProductLine(summary())).toBe("VMware vCenter Server 8.0.2");
    expect(getVMwareProductLine(summary({ version: undefined }))).toBe(
      "VMware vCenter Server",
    );
    expect(
      getVMwareProductLine(
        summary({ productName: undefined, version: undefined }),
      ),
    ).toBeNull();
  });
});

describe("a connection test, in words", () => {
  function test_(
    overrides: Partial<VMwareVCenterConnectionTest>,
  ): VMwareVCenterConnectionTest {
    const item: VMwareVCenterConnectionTest = new VMwareVCenterConnectionTest();
    Object.assign(item, overrides);
    return item;
  }

  test("waiting for the probe, then running", () => {
    expect(getVMwareConnectionTestView(test_({}), ENGLISH)).toMatchObject({
      phase: VMwareConnectionTestPhase.Waiting,
      title: "Waiting for the probe to pick the test up…",
    });
    expect(
      getVMwareConnectionTestView(
        test_({ status: VMwareConnectionTestStatus.Running }),
        ENGLISH,
      ),
    ).toMatchObject({
      phase: VMwareConnectionTestPhase.Running,
      title: "The probe is connecting to vCenter…",
    });
  });

  test("a success says what vCenter is and what the account can read", () => {
    expect(
      getVMwareConnectionTestView(
        test_({
          status: VMwareConnectionTestStatus.Succeeded,
          summary: summary(),
        }),
        ENGLISH,
      ),
    ).toMatchObject({
      phase: VMwareConnectionTestPhase.Succeeded,
      title: "Connected to VMware vCenter Server 8.0.2. The account can read:",
      inventory: [
        "1 datacenter",
        "2 clusters",
        "5 hosts",
        "10 virtual machines (9 running)",
        "1 datastore",
      ],
    });
  });

  test("a failure says what went wrong, the probe's own sentence, and what to do", () => {
    expect(
      getVMwareConnectionTestView(
        test_({
          status: VMwareConnectionTestStatus.Failed,
          errorCode: VMwareCollectionErrorCode.InvalidLogin,
          errorMessage:
            "vCenter at vcsa:443 refused the login for oneuptime@vsphere.local.",
        }),
        ENGLISH,
      ),
    ).toEqual({
      phase: VMwareConnectionTestPhase.Failed,
      title: "vCenter refused the login",
      message:
        "vCenter at vcsa:443 refused the login for oneuptime@vsphere.local.",
      nextStep:
        "Check the user name - with its domain, such as oneuptime@vsphere.local - and the password, and that the account is not locked.",
      inventory: [],
      certificate: null,
    });
  });

  test("an untrusted certificate comes with the certificate, to trust it", () => {
    const certificate: VMwareVCenterConnectionTest["presentedCertificate"] = {
      fingerprint256: FINGERPRINT,
      subject: "CN=vcsa",
      issuer: "CN=CA",
      isSelfSigned: false,
    };

    expect(
      getVMwareConnectionTestView(
        test_({
          status: VMwareConnectionTestStatus.Failed,
          errorCode: VMwareCollectionErrorCode.UntrustedCertificate,
          presentedCertificate: certificate,
        }),
        ENGLISH,
      ).certificate,
    ).toEqual(certificate);

    // Not for a failure trusting a certificate would not fix.
    expect(
      getVMwareConnectionTestView(
        test_({
          status: VMwareConnectionTestStatus.Failed,
          errorCode: VMwareCollectionErrorCode.InvalidLogin,
          presentedCertificate: certificate,
        }),
        ENGLISH,
      ).certificate,
    ).toBeNull();
  });

  test("an unknown code reads as an unexpected error", () => {
    expect(
      getVMwareConnectionTestView(
        test_({
          status: VMwareConnectionTestStatus.Failed,
          errorCode: "Strange" as VMwareCollectionErrorCode,
        }),
        ENGLISH,
      ).title,
    ).toBe("The probe hit an unexpected error");
  });

  test("a test is settled once it succeeded or failed", () => {
    expect(
      isVMwareConnectionTestSettled(VMwareConnectionTestStatus.Pending),
    ).toBe(false);
    expect(
      isVMwareConnectionTestSettled(VMwareConnectionTestStatus.Running),
    ).toBe(false);
    expect(
      isVMwareConnectionTestSettled(VMwareConnectionTestStatus.Succeeded),
    ).toBe(true);
    expect(
      isVMwareConnectionTestSettled(VMwareConnectionTestStatus.Failed),
    ).toBe(true);
    expect(isVMwareConnectionTestSettled(undefined)).toBe(false);
  });
});

describe("a probe-collected vCenter's collection, in words", () => {
  // A vCenter the claim hands its probe: password, address, user name and the project's own probe.
  function vcenter(overrides: Partial<VMwareVCenter>): VMwareVCenter {
    const item: VMwareVCenter = new VMwareVCenter();
    Object.assign(item, COLLECTABLE, overrides);
    return item;
  }

  test("checking until the probe has tried the new settings - and the page asks again", () => {
    expect(getVMwareCollectionStatusView(vcenter({}), ENGLISH)).toMatchObject({
      tone: VMwareCollectionTone.Checking,
      label: "Checking",
      isPending: true,
    });
    expect(
      getVMwareCollectionStatusView(
        vcenter({ collectionStatus: VMwareCollectionStatus.Pending }),
        ENGLISH,
      ).isPending,
    ).toBe(true);
  });

  test("collecting", () => {
    expect(
      getVMwareCollectionStatusView(
        vcenter({ collectionStatus: VMwareCollectionStatus.Succeeded }),
        ENGLISH,
      ),
    ).toMatchObject({
      tone: VMwareCollectionTone.Collecting,
      label: "Collecting",
      title: "The probe is collecting this vCenter.",
      isPending: false,
    });
  });

  test("not collecting: why, and the certificate to trust when that fixes it", () => {
    const view: ReturnType<typeof getVMwareCollectionStatusView> =
      getVMwareCollectionStatusView(
        vcenter({
          collectionStatus: VMwareCollectionStatus.Failed,
          collectionErrorCode: VMwareCollectionErrorCode.CertificateChanged,
          collectionError: "vcsa presented a different certificate.",
          presentedCertificate: {
            fingerprint256: FINGERPRINT,
            subject: "CN=vcsa",
            issuer: "CN=CA",
            isSelfSigned: false,
          },
        }),
        ENGLISH,
      );

    expect(view).toMatchObject({
      tone: VMwareCollectionTone.Failing,
      label: "Not collecting",
      title: "vCenter's certificate changed",
      message: "vcsa presented a different certificate.",
      isPending: false,
    });
    expect(view.certificate?.fingerprint256).toBe(FINGERPRINT);
  });

  test("only a vCenter set to a probe is probe-collected", () => {
    expect(
      isProbeCollected(
        vcenter({ collectionMethod: VMwareCollectionMethod.Probe }),
      ),
    ).toBe(true);
    expect(
      isProbeCollected(
        vcenter({ collectionMethod: VMwareCollectionMethod.Agent }),
      ),
    ).toBe(false);
    expect(isProbeCollected(vcenter({}))).toBe(false);
    expect(isProbeCollected(null)).toBe(false);
  });
});

/*
 * A vCenter nothing may collect is set aside by the probes' claim a quarter
 * of an hour at a time (OneUptime issue #8042): its nextCollectionAt keeps
 * moving and never comes, so its last report ("Collecting") is not what it
 * is doing now, and its next collection is no time at all.
 */
describe("a vCenter no probe collects, and when one does next", () => {
  const NOW: Date = new Date("2026-11-15T12:00:00.000Z");
  const minutesFromNow: (minutes: number) => Date = (minutes: number): Date => {
    return new Date(NOW.getTime() + minutes * 60 * 1000);
  };

  function vcenter(overrides: Partial<VMwareVCenter>): VMwareVCenter {
    const item: VMwareVCenter = new VMwareVCenter();
    Object.assign(item, COLLECTABLE, overrides);
    return item;
  }

  function view(
    overrides: Partial<VMwareVCenter>,
    isBillingEnabled: boolean = true,
  ): VMwareCollectionStatusView {
    return getVMwareCollectionStatusView(
      vcenter(overrides),
      ENGLISH,
      NOW,
      isBillingEnabled,
    );
  }

  const LAST_REPORTS: Array<[string, Partial<VMwareVCenter>]> = [
    ["collecting", { collectionStatus: VMwareCollectionStatus.Succeeded }],
    [
      "failing",
      {
        collectionStatus: VMwareCollectionStatus.Failed,
        collectionErrorCode: VMwareCollectionErrorCode.CertificateChanged,
        presentedCertificate: {
          fingerprint256: FINGERPRINT,
          subject: "CN=vcsa",
          issuer: "CN=CA",
          isSelfSigned: false,
        },
      },
    ],
    ["never reported (checking)", {}],
  ];

  test.each([
    [
      "no password saved",
      { isVCenterPasswordSet: false },
      "No password is saved for this vCenter.",
      "Enter the vCenter user's password in Settings, and test the connection.",
    ],
    [
      "no address",
      { vcenterUrl: undefined },
      "This vCenter has no address.",
      "Enter vCenter's address in Settings, and test the connection.",
    ],
    [
      "no user name",
      { vcenterUsername: undefined },
      "This vCenter has no user name.",
      "Enter the vCenter user's name in Settings, and test the connection.",
    ],
    [
      "no probe named",
      { collectionProbeId: undefined, collectionProbe: undefined },
      "No probe is set to collect this vCenter.",
      "Pick one of this project's probes in Settings.",
    ],
  ])(
    "%s: not collecting, why and the fix, whatever it last reported",
    (
      _name: string,
      stop: Partial<VMwareVCenter>,
      title: string,
      nextStep: string,
    ) => {
      for (const [, report] of LAST_REPORTS) {
        // The set-aside keeps its due time a few minutes off: never overdue.
        expect(
          view({ ...report, ...stop, nextCollectionAt: minutesFromNow(17) }),
        ).toEqual({
          tone: VMwareCollectionTone.Failing,
          label: "Not collecting",
          title: title,
          message: null,
          nextStep: nextStep,
          certificate: null,
          isPending: false,
        });
      }
    },
  );

  test("a shared probe on OneUptime Cloud: the probe may not collect it", () => {
    const shared: Partial<VMwareVCenter> = {
      collectionStatus: VMwareCollectionStatus.Succeeded,
      collectionProbe: probeOf({ isGlobalProbe: true }),
    };
    const advice: ReturnType<typeof VMwareCollectionErrorUtil.getAdvice> =
      VMwareCollectionErrorUtil.getAdvice(
        VMwareCollectionErrorCode.ProbeNotAllowed,
      );

    expect(view(shared, true)).toMatchObject({
      tone: VMwareCollectionTone.Failing,
      label: "Not collecting",
      title: advice.title,
      nextStep: advice.nextStep,
    });
    // On a self-hosted instance, its global probes are its own: they may.
    expect(view(shared, false).tone).toBe(VMwareCollectionTone.Collecting);
  });

  test("another project's probe may not collect it, anywhere", () => {
    for (const isBillingEnabled of [true, false]) {
      expect(
        view(
          {
            collectionStatus: VMwareCollectionStatus.Succeeded,
            collectionProbe: probeOf({ projectId: OTHER_PROJECT }),
          },
          isBillingEnabled,
        ).title,
      ).toBe("This probe may not collect this vCenter");
    }
  });

  test("a disconnected probe: not collecting, the probe named", () => {
    expect(
      view({
        collectionStatus: VMwareCollectionStatus.Succeeded,
        collectionProbe: probeOf({
          connectionStatus: ProbeConnectionStatus.Disconnected,
        }),
      }),
    ).toMatchObject({
      tone: VMwareCollectionTone.Failing,
      label: "Not collecting",
      title: "The probe did not pick this up",
      message:
        "Nothing collects this vCenter while Datacenter probe is disconnected.",
    });
  });

  test("a disconnected probe the reader may not name is 'its probe'", () => {
    const probe: Probe = probeOf({
      connectionStatus: ProbeConnectionStatus.Disconnected,
    });
    probe.name = undefined;

    expect(view({ collectionProbe: probe }).message).toBe(
      "Nothing collects this vCenter while its probe is disconnected.",
    );
  });

  test("overdue with a probe able to take it: no probe has come for it, and the page goes on asking", () => {
    const advice: ReturnType<typeof VMwareCollectionErrorUtil.getAdvice> =
      VMwareCollectionErrorUtil.getAdvice(
        VMwareCollectionErrorCode.ProbeNotAvailable,
      );

    for (const [, report] of LAST_REPORTS) {
      expect(
        view({ ...report, nextCollectionAt: minutesFromNow(-21) }),
      ).toEqual({
        tone: VMwareCollectionTone.Failing,
        label: "Not collecting",
        title: advice.title,
        // When it was due, from the reader's clock ("21 minutes ago" on the day).
        message: expect.stringMatching(
          /^This vCenter was due to be collected .+, and no probe has come for it\.$/,
        ),
        nextStep: advice.nextStep,
        certificate: null,
        isPending: true,
      });
    }
  });

  test("due inside the grace, with a probe able to take it: what it last reported", () => {
    expect(
      view({
        collectionStatus: VMwareCollectionStatus.Succeeded,
        // A collection at its ten-minute budget, and its upload.
        nextCollectionAt: minutesFromNow(-19),
      }).tone,
    ).toBe(VMwareCollectionTone.Collecting);
    expect(VMWARE_COLLECTION_OVERDUE_AFTER_IN_MS).toBe(20 * 60 * 1000);
  });

  test("never run, with a probe able to take it: checking, as before", () => {
    expect(view({ nextCollectionAt: undefined })).toMatchObject({
      tone: VMwareCollectionTone.Checking,
      isPending: true,
    });
  });

  test("next collection: a time only when a probe will collect it then", () => {
    const next: (overrides: Partial<VMwareVCenter>) => string = (
      overrides: Partial<VMwareVCenter>,
    ): string => {
      return getNextClaimWords(
        getVMwareNextCollection(vcenter(overrides), NOW, true),
        ENGLISH,
      );
    };

    expect(
      getVMwareNextCollection(
        vcenter({ nextCollectionAt: minutesFromNow(2) }),
        NOW,
        true,
      ),
    ).toEqual({
      state: ClaimDueState.Scheduled,
      dueAt: minutesFromNow(2),
      stop: null,
    });
    expect(next({ nextCollectionAt: undefined })).toBe("Due now");
    expect(next({ nextCollectionAt: minutesFromNow(-1) })).toBe("Due now");
    expect(next({ nextCollectionAt: minutesFromNow(-21) })).toBe("Overdue");

    for (const stop of [
      { isVCenterPasswordSet: false },
      { vcenterUrl: undefined },
      { vcenterUsername: undefined },
      { collectionProbeId: undefined },
      { collectionProbe: probeOf({ projectId: OTHER_PROJECT }) },
      {
        collectionProbe: probeOf({
          connectionStatus: ProbeConnectionStatus.Disconnected,
        }),
      },
    ] as Array<Partial<VMwareVCenter>>) {
      // The set-aside's time, a few minutes off, is never shown.
      expect(next({ ...stop, nextCollectionAt: minutesFromNow(17) })).toBe(
        "Not scheduled",
      );
      expect(
        getVMwareNextCollection(
          vcenter({ ...stop, nextCollectionAt: minutesFromNow(17) }),
          NOW,
          true,
        ).dueAt,
      ).toBeNull();
    }
  });

  test("an archived vCenter is still collected, and its next time still shown", () => {
    expect(
      getVMwareNextCollection(
        vcenter({ isArchived: true, nextCollectionAt: minutesFromNow(2) }),
        NOW,
        true,
      ).state,
    ).toBe(ClaimDueState.Scheduled);
  });
});

describe("the connection form's rules", () => {
  test("an address is held to the server's reading of it", () => {
    expect(validateVCenterAddress("vcsa.example.com/ui")).toBeNull();
    expect(validateVCenterAddress("http://vcsa.example.com")).toBe(
      "Use https://. vCenter serves its API over HTTPS only, and OneUptime never sends a password unencrypted.",
    );
    expect(validateVCenterAddress(undefined)).toBe(
      "Enter vCenter's address, such as vcsa.example.com or https://10.0.0.20.",
    );
  });

  test("a trusted certificate is empty or a SHA-256 fingerprint", () => {
    expect(validateTrustedCertificate("")).toBeNull();
    expect(validateTrustedCertificate(null)).toBeNull();
    expect(validateTrustedCertificate(FINGERPRINT.toLowerCase())).toBeNull();
    expect(validateTrustedCertificate("AB:CD")).toBe(
      "Enter a SHA-256 fingerprint: 64 hexadecimal characters, such as AB:CD:EF:... .",
    );
  });

  test("a test is of what the form holds now, however the probe was picked", () => {
    const vcenterId: ObjectID = new ObjectID(OTHER_OWN);

    expect(
      getVMwareConnectionTestInput(
        {
          vcenterUrl: "vcsa.example.com",
          vcenterUsername: "oneuptime@vsphere.local",
          vcenterPassword: "secret",
          collectionProbe: { _id: OWN },
          trustedCertificateFingerprint: FINGERPRINT,
        } as never,
        vcenterId,
      ),
    ).toEqual({
      vcenterUrl: "vcsa.example.com",
      vcenterUsername: "oneuptime@vsphere.local",
      vcenterPassword: "secret",
      probeId: OWN,
      trustedCertificateFingerprint: FINGERPRINT,
      vmwareVCenterId: vcenterId,
    });

    expect(
      getVMwareConnectionTestInput({ collectionProbe: OWN } as never).probeId,
    ).toBe(OWN);
    expect(
      getVMwareConnectionTestInput({
        collectionProbeId: new ObjectID(OWN),
      } as never).probeId,
    ).toBe(OWN);
  });

  test("a test needs an address, a user, a probe - and a password, unless a saved vCenter's is used", () => {
    const complete: ReturnType<typeof getVMwareConnectionTestInput> = {
      vcenterUrl: "vcsa.example.com",
      vcenterUsername: "oneuptime@vsphere.local",
      vcenterPassword: "secret",
      probeId: OWN,
      trustedCertificateFingerprint: "",
    };

    expect(getVMwareConnectionTestBlocker(complete)).toBeNull();
    expect(
      getVMwareConnectionTestBlocker({ ...complete, vcenterPassword: "" }),
    ).toBe("Enter the address, user name, password and probe first.");
    expect(
      getVMwareConnectionTestBlocker({
        ...complete,
        vcenterPassword: "",
        vmwareVCenterId: new ObjectID(OTHER_OWN),
      }),
    ).toBeNull();
    expect(
      getVMwareConnectionTestBlocker({ ...complete, probeId: "" }),
    ).not.toBeNull();
    expect(
      getVMwareConnectionTestBlocker({ ...complete, vcenterUrl: "  " }),
    ).not.toBeNull();
  });
});
