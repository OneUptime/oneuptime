import { describe, expect, test } from "@jest/globals";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import StorageArrayConnection from "Common/Models/DatabaseModels/StorageArrayConnection";
import StorageArrayConnectionTest from "Common/Models/DatabaseModels/StorageArrayConnectionTest";
import ObjectID from "Common/Types/ObjectID";
import StorageArrayCollectionErrorCode from "Common/Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import StorageArrayCollectionStatus from "Common/Types/StorageArray/Collection/StorageArrayCollectionStatus";
import StorageArrayConnectionTestStatus from "Common/Types/StorageArray/Collection/StorageArrayConnectionTestStatus";
import {
  StorageArrayCollectionArraySummary,
  StorageArrayCollectionSummary,
} from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import StorageArrayProbeCollectors from "Common/Types/StorageArray/Collection/StorageArrayProbeCollectors";
import { PowerMaxKind } from "Common/Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxSeries";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";
import { ClaimDueState } from "Common/Utils/Probe/ClaimDueTime";
import { StorageArrayCollectionStop } from "Common/Utils/StorageArray/StorageArrayCollectionStop";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import { getNextClaimWords } from "../../FeatureSet/Dashboard/src/Components/Probe/NextClaimWords";
import {
  PerformanceState,
  STORAGE_ARRAY_COLLECTION_OVERDUE_AFTER_IN_MS,
  StorageArrayCollectionStatusView,
  StorageArrayCollectionTone,
  StorageArrayTestPhase,
  StorageArrayTestView,
  findArrayConnection,
  getArrayLine,
  getCollector,
  getDefaultStorageArrayProbeId,
  getInventoryPhrases,
  getPerformanceState,
  getPerformanceWords,
  getStorageArrayCollectionDescription,
  getStorageArrayCollectionProbes,
  getStorageArrayCollectionStatusView,
  getStorageArrayCollectionStop,
  getStorageArrayErrorAdvice,
  getStorageArrayNextCollection,
  getStorageArrayProbeOptions,
  getStorageArrayTestBlocker,
  getStorageArrayTestInput,
  getStorageArrayTestView,
  validateStorageArrayAddress,
  validateTrustedCertificate,
} from "../../FeatureSet/Dashboard/src/Components/StorageArray/Connection/StorageArrayConnectionView";

/*
 * What the Dashboard says about a storage array connection a probe reads
 * (#11004): the probes it may be read through, where a connection test
 * stands, what it found on each array, how the last collection went and the
 * one next step that fixes it - every failure the issue names (unreachable,
 * the certificate, a wrong role, performance off) in words.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const OWN: string = "11111111-0000-4000-8000-000000000001";
const GLOBAL: string = "11111111-0000-4000-8000-000000000003";
const PROJECT: string = "22222222-0000-4000-8000-000000000001";
const OTHER_PROJECT: string = "22222222-0000-4000-8000-000000000002";

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

function probeOf(
  overrides: {
    isGlobalProbe?: boolean;
    projectId?: string;
    connectionStatus?: ProbeConnectionStatus;
    isNameless?: boolean;
  } = {},
): Probe {
  const item: Probe = new Probe();
  item._id = OWN;
  if (!overrides.isNameless) {
    item.name = "Datacenter probe";
  }
  item.isGlobalProbe = overrides.isGlobalProbe === true;
  item.projectId = new ObjectID(overrides.projectId || PROJECT);
  item.connectionStatus =
    overrides.connectionStatus || ProbeConnectionStatus.Connected;
  return item;
}

// A connection the claim hands its probe: password, address, user and the project's own probe.
function connection(
  overrides: Partial<StorageArrayConnection> = {},
): StorageArrayConnection {
  const item: StorageArrayConnection = new StorageArrayConnection();
  Object.assign(
    item,
    {
      projectId: new ObjectID(PROJECT),
      storageSystem: StorageSystem.DellPowerMax,
      isPasswordSet: true,
      address: "https://unisphere.example.com:8443",
      username: "oneuptime-monitor",
      collectionProbeId: new ObjectID(OWN),
      collectionProbe: probeOf(),
      collectionIntervalInMinutes: 5,
    },
    overrides,
  );
  return item;
}

function array(
  overrides: Partial<StorageArrayCollectionArraySummary> = {},
): StorageArrayCollectionArraySummary {
  return {
    id: "000220200269",
    model: "PowerMax_8500",
    osVersion: "6079.275.0",
    isLocal: true,
    isCollected: true,
    isPerformanceCollected: true,
    isRealtimeCollected: false,
    realtimeObjects: [],
    counts: {
      [PowerMaxKind.StorageGroup]: 4,
      [StorageArrayResourceKind.Volume]: 120,
    },
    warnings: [],
    ...overrides,
  };
}

function summary(
  arrays: Array<StorageArrayCollectionArraySummary>,
  overrides: Partial<StorageArrayCollectionSummary> = {},
): StorageArrayCollectionSummary {
  return {
    serverProductName: "Unisphere for PowerMax",
    serverVersion: "T10.4.0.83",
    apiVersion: "104",
    arrays,
    warnings: [],
    ...overrides,
  };
}

describe("the probes a connection may be read through", () => {
  const PROBES: Array<Probe> = [
    probe({ id: OWN, name: "Datacenter probe" }),
    probe({ id: GLOBAL, name: "probe-1", isGlobalProbe: true }),
    probe({ name: "no id" }),
  ];

  test("on OneUptime Cloud, only the project's own: a shared probe never receives a password", () => {
    expect(getStorageArrayCollectionProbes(PROBES, true)).toHaveLength(1);
    expect(getStorageArrayProbeOptions(PROBES, true, ENGLISH)).toEqual([
      { label: "Datacenter probe", value: OWN },
    ]);
  });

  test("on a self-hosted instance, its own global probes too, named as such", () => {
    expect(getStorageArrayProbeOptions(PROBES, false, ENGLISH)).toEqual([
      { label: "Datacenter probe", value: OWN },
      { label: "probe-1 (this instance's probe)", value: GLOBAL },
    ]);
  });

  test("a probe without a name is offered by its id", () => {
    expect(
      getStorageArrayProbeOptions([probe({ id: OWN })], true, ENGLISH),
    ).toEqual([{ label: `Probe ${OWN}`, value: OWN }]);
  });

  test("starts on the only probe it may use - and on none when there is a choice", () => {
    expect(getDefaultStorageArrayProbeId(PROBES, true)).toBe(OWN);
    expect(getDefaultStorageArrayProbeId(PROBES, false)).toBe("");
    expect(getDefaultStorageArrayProbeId([], true)).toBe("");
  });
});

describe("what a test or a collection found", () => {
  test("the local arrays' storage groups and volumes, as phrases", () => {
    expect(
      getInventoryPhrases(
        summary([
          array(),
          array({
            id: "000297900330",
            counts: {
              [PowerMaxKind.StorageGroup]: 1,
              [StorageArrayResourceKind.Volume]: 1,
            },
          }),
          array({ id: "000220002429", isLocal: false, counts: {} }),
        ]),
        ENGLISH,
      ),
    ).toEqual(["2 arrays", "5 storage groups", "121 volumes"]);
    expect(
      getInventoryPhrases(
        summary([array({ counts: { [PowerMaxKind.StorageGroup]: 1 } })]),
        ENGLISH,
      ),
    ).toEqual(["1 array", "1 storage group", "0 volumes"]);
    expect(getInventoryPhrases(null, ENGLISH)).toEqual([]);
  });

  test("an array's line: its model in words and its microcode", () => {
    expect(getArrayLine(array())).toBe("PowerMax 8500 · 6079.275.0");
    expect(getArrayLine(array({ model: undefined }))).toBe("6079.275.0");
    expect(
      getArrayLine(array({ model: undefined, osVersion: undefined })),
    ).toBe("");
  });

  test("whether Unisphere collects an array's performance, and in real time for how many groups", () => {
    expect(getPerformanceState(array())).toBe(PerformanceState.On);
    expect(getPerformanceWords(array(), ENGLISH)).toBe("Performance on");

    const realtime: StorageArrayCollectionArraySummary = array({
      isRealtimeCollected: true,
      realtimeObjects: ["Oracle_PROD_SG", "SAP_SG"],
    });
    expect(getPerformanceState(realtime)).toBe(PerformanceState.RealTime);
    expect(getPerformanceWords(realtime, ENGLISH)).toBe(
      "Performance on, real time for 2 storage groups",
    );
    expect(
      getPerformanceWords(
        array({ isRealtimeCollected: true, realtimeObjects: ["SG"] }),
        ENGLISH,
      ),
    ).toBe("Performance on, real time for 1 storage group");
    // Real time on with no group registered is just on.
    expect(
      getPerformanceState(
        array({ isRealtimeCollected: true, realtimeObjects: [] }),
      ),
    ).toBe(PerformanceState.On);

    expect(getPerformanceState(array({ isPerformanceCollected: false }))).toBe(
      PerformanceState.Off,
    );
    expect(
      getPerformanceWords(array({ isPerformanceCollected: false }), ENGLISH),
    ).toBe("Performance collection off");
    expect(getPerformanceState(array({ isPerformanceCollected: null }))).toBe(
      PerformanceState.Unknown,
    );
    expect(
      getPerformanceWords(array({ isPerformanceCollected: null }), ENGLISH),
    ).toBe("Performance unknown");
  });
});

describe("a connection test, in words", () => {
  function testOf(
    overrides: Partial<StorageArrayConnectionTest>,
  ): StorageArrayConnectionTest {
    const item: StorageArrayConnectionTest = new StorageArrayConnectionTest();
    Object.assign(item, overrides);
    return item;
  }

  test("waiting for the probe, then running", () => {
    expect(
      getStorageArrayTestView(
        testOf({ status: StorageArrayConnectionTestStatus.Pending }),
        ENGLISH,
      ),
    ).toMatchObject({
      phase: StorageArrayTestPhase.Waiting,
      title: "Waiting for the probe to pick the test up…",
    });
    expect(getStorageArrayTestView(testOf({}), ENGLISH).phase).toBe(
      StorageArrayTestPhase.Waiting,
    );
    expect(
      getStorageArrayTestView(
        testOf({ status: StorageArrayConnectionTestStatus.Running }),
        ENGLISH,
      ),
    ).toMatchObject({
      phase: StorageArrayTestPhase.Running,
      title: "The probe is connecting to Unisphere…",
    });
  });

  test("a success says what Unisphere is, what the account can read, each array (local first) and what to look at", () => {
    const view: StorageArrayTestView = getStorageArrayTestView(
      testOf({
        status: StorageArrayConnectionTestStatus.Succeeded,
        summary: summary(
          [
            array({ id: "000220002429", isLocal: false, counts: {} }),
            array({
              isPerformanceCollected: false,
              warnings: ["Performance collection is off for 000220200269."],
            }),
          ],
          {
            warnings: ["Unisphere T10.1.0.468 lists no ports or SRDF groups."],
          },
        ),
      }),
      ENGLISH,
    );

    expect(view.phase).toBe(StorageArrayTestPhase.Succeeded);
    expect(view.title).toBe(
      "Connected to Unisphere for PowerMax T10.4.0.83. The account can read:",
    );
    expect(view.inventory).toEqual([
      "1 array",
      "4 storage groups",
      "120 volumes",
    ]);
    expect(
      view.arrays.map((entry: StorageArrayCollectionArraySummary) => {
        return entry.id;
      }),
    ).toEqual(["000220200269", "000220002429"]);
    expect(view.warnings).toEqual([
      "Unisphere T10.1.0.468 lists no ports or SRDF groups.",
    ]);
    expect(view.certificate).toBeNull();
  });

  test("a success without the server's name still says it connected", () => {
    expect(
      getStorageArrayTestView(
        testOf({
          status: StorageArrayConnectionTestStatus.Succeeded,
          summary: { arrays: [array()], warnings: [] },
        }),
        ENGLISH,
      ).title,
    ).toBe("Connected. The account can read:");
  });

  test.each([
    [
      StorageArrayCollectionErrorCode.ConnectionTimedOut,
      "The probe gets no answer from the server.",
    ],
    [
      StorageArrayCollectionErrorCode.InvalidLogin,
      "The server refused the login.",
    ],
    [
      StorageArrayCollectionErrorCode.MissingRole,
      "The account may not read the arrays.",
    ],
    [
      StorageArrayCollectionErrorCode.UnsupportedVersion,
      "This Unisphere is older than OneUptime reads.",
    ],
    [
      StorageArrayCollectionErrorCode.NotManagementServer,
      "This address is not Unisphere's REST API.",
    ],
    [
      StorageArrayCollectionErrorCode.NoArrays,
      "The account sees no array this server manages.",
    ],
  ])(
    "a failure (%s) says what went wrong, the probe's own sentence, and what to do",
    (code: StorageArrayCollectionErrorCode, title: string) => {
      const view: StorageArrayTestView = getStorageArrayTestView(
        testOf({
          status: StorageArrayConnectionTestStatus.Failed,
          errorCode: code,
          errorMessage: "The probe's own sentence.",
        }),
        ENGLISH,
      );
      expect(view).toMatchObject({
        phase: StorageArrayTestPhase.Failed,
        title: title,
        message: "The probe's own sentence.",
      });
      expect(view.nextStep).toBeTruthy();
      // Only a certificate failure comes with a certificate.
      expect(view.certificate).toBeNull();
    },
  );

  test("an untrusted or changed certificate comes with the certificate, to trust it", () => {
    for (const code of [
      StorageArrayCollectionErrorCode.UntrustedCertificate,
      StorageArrayCollectionErrorCode.CertificateChanged,
    ]) {
      const view: StorageArrayTestView = getStorageArrayTestView(
        testOf({
          status: StorageArrayConnectionTestStatus.Failed,
          errorCode: code,
          presentedCertificate: {
            fingerprint256: FINGERPRINT,
            subject: "CN=unisphere.example.com",
            issuer: "CN=unisphere.example.com",
            isSelfSigned: true,
          },
        }),
        ENGLISH,
      );
      expect(view.certificate?.fingerprint256).toBe(FINGERPRINT);
    }
    // No fingerprint, nothing to trust.
    expect(
      getStorageArrayTestView(
        testOf({
          status: StorageArrayConnectionTestStatus.Failed,
          errorCode: StorageArrayCollectionErrorCode.UntrustedCertificate,
          presentedCertificate: {
            fingerprint256: "",
            subject: "",
            issuer: "",
            isSelfSigned: false,
          },
        }),
        ENGLISH,
      ).certificate,
    ).toBeNull();
  });

  test("every failure code has its own words, and an unknown one reads as an unexpected error", () => {
    const titles: Set<string> = new Set();
    for (const code of Object.values(StorageArrayCollectionErrorCode)) {
      const advice: { title: string; nextStep: string } =
        getStorageArrayErrorAdvice(code);
      expect(advice.title.endsWith(".")).toBe(true);
      expect(advice.nextStep.endsWith(".")).toBe(true);
      titles.add(advice.title);
    }
    expect(titles.size).toBe(
      Object.values(StorageArrayCollectionErrorCode).length,
    );
    expect(
      getStorageArrayErrorAdvice("Nonsense" as StorageArrayCollectionErrorCode)
        .title,
    ).toBe("The probe hit an unexpected error.");
    expect(getStorageArrayErrorAdvice(null).title).toBe(
      "The probe hit an unexpected error.",
    );
  });

  test("performance collection off and a missing PerfMonitor role are named where Unisphere has them", () => {
    expect(
      getStorageArrayErrorAdvice(StorageArrayCollectionErrorCode.MissingRole)
        .nextStep,
    ).toBe(
      "In Unisphere, give the user the Monitor role on each array, and PerfMonitor for performance.",
    );
    expect(
      getStorageArrayErrorAdvice(
        StorageArrayCollectionErrorCode.UntrustedCertificate,
      ).nextStep,
    ).toBe(
      "Check the fingerprint below against the server's certificate, then trust it.",
    );
  });
});

describe("a connection's collection, in words", () => {
  test("checking until the probe has tried the new settings - and the page asks again", () => {
    expect(
      getStorageArrayCollectionStatusView(connection(), ENGLISH),
    ).toMatchObject({
      tone: StorageArrayCollectionTone.Checking,
      label: "Checking",
      isPending: true,
    });
    expect(
      getStorageArrayCollectionStatusView(
        connection({ collectionStatus: StorageArrayCollectionStatus.Pending }),
        ENGLISH,
      ).isPending,
    ).toBe(true);
  });

  test("collecting", () => {
    expect(
      getStorageArrayCollectionStatusView(
        connection({
          collectionStatus: StorageArrayCollectionStatus.Succeeded,
        }),
        ENGLISH,
      ),
    ).toMatchObject({
      tone: StorageArrayCollectionTone.Collecting,
      label: "Collecting",
      title: "The probe is reading every array behind this Unisphere.",
      isPending: false,
    });
  });

  test("not collecting: why, the probe's sentence, and the certificate to trust when that fixes it", () => {
    const view: StorageArrayCollectionStatusView =
      getStorageArrayCollectionStatusView(
        connection({
          collectionStatus: StorageArrayCollectionStatus.Failed,
          collectionErrorCode:
            StorageArrayCollectionErrorCode.CertificateChanged,
          collectionError: "unisphere presented a different certificate.",
          presentedCertificate: {
            fingerprint256: FINGERPRINT,
            subject: "CN=unisphere",
            issuer: "CN=CA",
            isSelfSigned: false,
          },
        }),
        ENGLISH,
      );

    expect(view).toMatchObject({
      tone: StorageArrayCollectionTone.Failing,
      label: "Not collecting",
      title: "The server's certificate changed.",
      message: "unisphere presented a different certificate.",
      isPending: false,
    });
    expect(view.certificate?.fingerprint256).toBe(FINGERPRINT);
  });

  test("a failure that is not the certificate's has none to trust", () => {
    expect(
      getStorageArrayCollectionStatusView(
        connection({
          collectionStatus: StorageArrayCollectionStatus.Failed,
          collectionErrorCode: StorageArrayCollectionErrorCode.InvalidLogin,
          presentedCertificate: {
            fingerprint256: FINGERPRINT,
            subject: "",
            issuer: "",
            isSelfSigned: true,
          },
        }),
        ENGLISH,
      ).certificate,
    ).toBeNull();
  });

  test.each([
    [
      "no password",
      { isPasswordSet: false },
      StorageArrayCollectionStop.NoPassword,
      "No password is saved for this connection.",
    ],
    [
      "no address",
      { address: undefined },
      StorageArrayCollectionStop.NoAddress,
      "This connection has no address.",
    ],
    [
      "no user name",
      { username: undefined },
      StorageArrayCollectionStop.NoUserName,
      "This connection has no user name.",
    ],
    [
      "no probe",
      { collectionProbeId: undefined, collectionProbe: undefined },
      StorageArrayCollectionStop.NoProbe,
      "No probe is set to read this connection.",
    ],
  ])(
    "%s: nothing reads it, whatever it last reported",
    (
      _name: string,
      overrides: Partial<StorageArrayConnection>,
      stop: StorageArrayCollectionStop,
      title: string,
    ) => {
      const item: StorageArrayConnection = connection({
        collectionStatus: StorageArrayCollectionStatus.Succeeded,
        ...overrides,
      });
      expect(getStorageArrayCollectionStop(item, true)).toBe(stop);
      expect(getStorageArrayCollectionStatusView(item, ENGLISH)).toMatchObject({
        tone: StorageArrayCollectionTone.Failing,
        label: "Not collecting",
        title: title,
        isPending: false,
      });
    },
  );

  test("a shared probe on OneUptime Cloud may not read it", () => {
    const item: StorageArrayConnection = connection({
      collectionStatus: StorageArrayCollectionStatus.Succeeded,
      collectionProbe: probeOf({ isGlobalProbe: true }),
    });
    expect(
      getStorageArrayCollectionStatusView(item, ENGLISH, new Date(), true),
    ).toMatchObject({
      tone: StorageArrayCollectionTone.Failing,
      title: "This probe may not read this server.",
      nextStep:
        "Pick one of this project's own probes: shared probes never receive storage passwords.",
    });
    // Self-hosted, the instance's own probe may.
    expect(
      getStorageArrayCollectionStatusView(item, ENGLISH, new Date(), false)
        .tone,
    ).toBe(StorageArrayCollectionTone.Collecting);
  });

  test("another project's probe may not read it, anywhere", () => {
    const item: StorageArrayConnection = connection({
      collectionProbe: probeOf({ projectId: OTHER_PROJECT }),
    });
    for (const isBillingEnabled of [true, false]) {
      expect(getStorageArrayCollectionStop(item, isBillingEnabled)).toBe(
        StorageArrayCollectionStop.ProbeNotAllowed,
      );
    }
  });

  test("a disconnected probe: not collecting, the probe named", () => {
    expect(
      getStorageArrayCollectionStatusView(
        connection({
          collectionProbe: probeOf({
            connectionStatus: ProbeConnectionStatus.Disconnected,
          }),
        }),
        ENGLISH,
      ),
    ).toMatchObject({
      tone: StorageArrayCollectionTone.Failing,
      title: "No probe picked the work up.",
      message:
        "Nothing reads this connection while Datacenter probe is disconnected.",
    });
    expect(
      getStorageArrayCollectionStatusView(
        connection({
          collectionProbe: probeOf({
            connectionStatus: ProbeConnectionStatus.Disconnected,
            isNameless: true,
          }),
        }),
        ENGLISH,
      ).message,
    ).toBe("Nothing reads this connection while its probe is disconnected.");
  });

  test("overdue with a probe able to take it: no probe has come for it, and the page goes on asking", () => {
    const now: Date = new Date("2026-11-26T10:00:00.000Z");
    const view: StorageArrayCollectionStatusView =
      getStorageArrayCollectionStatusView(
        connection({
          collectionStatus: StorageArrayCollectionStatus.Succeeded,
          nextCollectionAt: new Date(
            now.getTime() -
              STORAGE_ARRAY_COLLECTION_OVERDUE_AFTER_IN_MS -
              60_000,
          ),
        }),
        ENGLISH,
        now,
      );
    expect(view).toMatchObject({
      tone: StorageArrayCollectionTone.Failing,
      title: "No probe picked the work up.",
      isPending: true,
    });
    expect(view.message).toMatch(
      /^This connection was due to be read .+, and no probe has come for it\.$/,
    );
  });

  test("next collection: a time only when a probe will read it then", () => {
    const now: Date = new Date("2026-11-26T10:00:00.000Z");
    const later: Date = new Date(now.getTime() + 3 * 60_000);

    expect(
      getStorageArrayNextCollection(
        connection({ nextCollectionAt: later }),
        now,
        true,
      ),
    ).toMatchObject({ state: ClaimDueState.Scheduled, dueAt: later });
    expect(
      getStorageArrayNextCollection(
        connection({ nextCollectionAt: later, isPasswordSet: false }),
        now,
        true,
      ),
    ).toMatchObject({
      state: ClaimDueState.Stopped,
      dueAt: null,
      stop: StorageArrayCollectionStop.NoPassword,
    });
    expect(
      getNextClaimWords(
        getStorageArrayNextCollection(connection({}), now, true),
        ENGLISH,
      ),
    ).toBeTruthy();
  });

  test("the card's description is a promise only while a probe comes for it", () => {
    const now: Date = new Date("2026-11-26T10:00:00.000Z");
    expect(
      getStorageArrayCollectionDescription(
        connection({ nextCollectionAt: new Date(now.getTime() + 60_000) }),
        ENGLISH,
        now,
        true,
      ),
    ).toBe(
      "Collected by Datacenter probe from https://unisphere.example.com:8443, every 5 minutes. No agent runs for it.",
    );
    expect(
      getStorageArrayCollectionDescription(
        connection({
          collectionProbe: probeOf({
            connectionStatus: ProbeConnectionStatus.Disconnected,
          }),
        }),
        ENGLISH,
        now,
        true,
      ),
    ).toBe(
      "Set to be collected by Datacenter probe from https://unisphere.example.com:8443, every 5 minutes.",
    );
    expect(
      getStorageArrayCollectionDescription(
        connection({
          collectionProbeId: undefined,
          collectionProbe: undefined,
        }),
        ENGLISH,
        now,
        true,
      ),
    ).toBeUndefined();
  });
});

describe("the connection form's rules", () => {
  test("an address is held to the server's reading of it", () => {
    expect(
      validateStorageArrayAddress(
        "https://unisphere.example.com:8443",
        StorageSystem.DellPowerMax,
      ),
    ).toBeNull();
    expect(
      validateStorageArrayAddress(
        "unisphere.example.com",
        StorageSystem.DellPowerMax,
      ),
    ).toBeNull();
    expect(
      validateStorageArrayAddress(
        "ftp://unisphere.example.com",
        StorageSystem.DellPowerMax,
      ),
    ).toBeTruthy();
    expect(
      validateStorageArrayAddress("", StorageSystem.DellPowerMax),
    ).toBeTruthy();
  });

  test("a trusted certificate is empty or a SHA-256 fingerprint", () => {
    expect(validateTrustedCertificate("")).toBeNull();
    expect(validateTrustedCertificate(undefined)).toBeNull();
    expect(validateTrustedCertificate(FINGERPRINT)).toBeNull();
    expect(
      validateTrustedCertificate(FINGERPRINT.replace(/:/g, "").toLowerCase()),
    ).toBeNull();
    expect(validateTrustedCertificate("AB:CD")).toBe(
      "Enter a SHA-256 fingerprint: 64 hexadecimal characters, such as AB:CD:EF:... .",
    );
  });

  test("a test is of what the form holds now, however the probe was picked", () => {
    const id: ObjectID = ObjectID.generate();
    for (const picked of [OWN, new ObjectID(OWN), { _id: OWN }, { id: OWN }]) {
      expect(
        getStorageArrayTestInput(
          {
            address: "https://unisphere.example.com",
            username: "oneuptime-monitor",
            password: "pw",
            collectionProbe: picked,
            trustedCertificateFingerprint: FINGERPRINT,
          } as never,
          StorageSystem.DellPowerMax,
          id,
        ),
      ).toEqual({
        storageSystem: StorageSystem.DellPowerMax,
        address: "https://unisphere.example.com",
        username: "oneuptime-monitor",
        password: "pw",
        probeId: OWN,
        trustedCertificateFingerprint: FINGERPRINT,
        storageArrayConnectionId: id,
      });
    }
    expect(
      getStorageArrayTestInput({} as never, StorageSystem.DellPowerMax),
    ).toMatchObject({ address: "", username: "", password: "", probeId: "" });
  });

  test("a test needs an address, a user, a probe - and a password, unless a saved connection's is used", () => {
    const input: ReturnType<typeof getStorageArrayTestInput> = {
      storageSystem: StorageSystem.DellPowerMax,
      address: "https://unisphere.example.com",
      username: "oneuptime-monitor",
      password: "pw",
      probeId: OWN,
      trustedCertificateFingerprint: "",
    };
    expect(getStorageArrayTestBlocker(input)).toBeNull();
    for (const missing of [
      { address: " " },
      { username: "" },
      { probeId: "" },
      { password: "" },
    ]) {
      expect(getStorageArrayTestBlocker({ ...input, ...missing })).toBe(
        "Enter the address, user name, password and probe first.",
      );
    }
    expect(
      getStorageArrayTestBlocker({
        ...input,
        password: "",
        storageArrayConnectionId: ObjectID.generate(),
      }),
    ).toBeNull();
  });

  test("the platform's words come from its collector, PowerMax's by default", () => {
    expect(getCollector(null)).toBe(StorageArrayProbeCollectors.getDefault());
    expect(getCollector("unknown.platform").storageSystem).toBe(
      StorageSystem.DellPowerMax,
    );
    expect(getCollector(StorageSystem.DellPowerMax).words.connectTitle).toBe(
      "Connect Unisphere",
    );
  });
});

describe("the connection an array is read through", () => {
  function connectionWith(
    id: string,
    arrays: Array<StorageArrayCollectionArraySummary>,
  ): StorageArrayConnection {
    return connection({
      _id: id,
      collectionSummary: summary(arrays),
    } as Partial<StorageArrayConnection>);
  }

  test("is the one whose last collection listed it as its own", () => {
    const first: StorageArrayConnection = connectionWith(
      "33333333-0000-4000-8000-000000000001",
      [array({ id: "000220002429", isLocal: false })],
    );
    const second: StorageArrayConnection = connectionWith(
      "33333333-0000-4000-8000-000000000002",
      [array({ id: "000220002429" })],
    );

    const found: ReturnType<typeof findArrayConnection> = findArrayConnection(
      [first, second],
      "000220002429",
    );
    expect(found?.connection).toBe(second);
    expect(found?.array.isLocal).toBe(true);
  });

  test("none lists an array it does not know, or one with no identifier", () => {
    const only: StorageArrayConnection = connectionWith(
      "33333333-0000-4000-8000-000000000001",
      [array()],
    );
    expect(findArrayConnection([only], "000000000000")).toBeNull();
    expect(findArrayConnection([only], null)).toBeNull();
    expect(findArrayConnection([only], undefined)).toBeNull();
    expect(findArrayConnection([connection()], "000220200269")).toBeNull();
  });
});
