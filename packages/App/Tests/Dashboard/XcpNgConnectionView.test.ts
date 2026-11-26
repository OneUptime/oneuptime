import { describe, expect, test } from "@jest/globals";
import { ProbeConnectionStatus } from "Common/Models/DatabaseModels/Probe";
import XcpNgConnection from "Common/Models/DatabaseModels/XcpNgConnection";
import XcpNgConnectionTest from "Common/Models/DatabaseModels/XcpNgConnectionTest";
import ObjectID from "Common/Types/ObjectID";
import XcpNgCollectionErrorCode, {
  XcpNgCollectionErrorUtil,
} from "Common/Types/XcpNg/XcpNgCollectionError";
import XcpNgCollectionMethod from "Common/Types/XcpNg/XcpNgCollectionMethod";
import XcpNgCollectionStatus from "Common/Types/XcpNg/XcpNgCollectionStatus";
import XcpNgConnectionTestStatus from "Common/Types/XcpNg/XcpNgConnectionTestStatus";
import XcpNgConnectionType from "Common/Types/XcpNg/XcpNgConnectionType";
import { XcpNgCollectionSummary } from "Common/Types/XcpNg/XcpNgProbeCollection";
import XcpNgXapiAccountKind from "Common/Types/XcpNg/XcpNgXapiAccount";
import { ClaimDueState } from "Common/Utils/Probe/ClaimDueTime";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  XCP_NG_COLLECTION_OVERDUE_AFTER_IN_MS,
  XcpNgCollectionStatusView,
  XcpNgCollectionTone,
  XcpNgConnectionTestPhase,
  XcpNgConnectionTestView,
  XcpNgNotice,
  XcpNgNoticeTone,
  XcpNgPoolReadBy,
  getXcpNgAccountNotice,
  getXcpNgApiTokenExpiryNotice,
  getXcpNgApiTokenProblemNotice,
  getXcpNgCollectionDescription,
  getXcpNgCollectionStatusView,
  getXcpNgConnectionTestBlocker,
  getXcpNgConnectionTestInput,
  getXcpNgConnectionTestView,
  getXcpNgConnectionTypeLabel,
  getXcpNgConnectionTypeOptions,
  getXcpNgFormConnectionType,
  getXcpNgInventoryPhrases,
  getXcpNgNextCollection,
  getXcpNgPoolNames,
  getXcpNgPoolReadBy,
  getXcpNgProductLine,
  getXcpNgTrustHint,
  isXcpNgConnectionTestSettled,
  isXcpNgPoolInSummary,
  validateXcpNgAddress,
  validateXcpNgTrustedCertificate,
} from "../../FeatureSet/Dashboard/src/Components/XcpNg/XcpNgConnectionView";

/*
 * What the Dashboard says about an XCP-ng connection a probe reads
 * (#10996, #10999): where a test stands and what it found, how the last
 * read went and the one next step that fixes it, what its token or account
 * may do, and how a pool is read. Words a vCenter's page uses are the same
 * keys, so they read alike and are translated once.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");
const NOW: Date = new Date("2026-11-18T07:00:00.000Z");
const PROJECT_ID: string = "11111111-0000-4000-8000-0000000000aa";
const PROBE_ID: string = "11111111-0000-4000-8000-000000000001";
const POOL_ID: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";
const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

function summary(
  overrides: Partial<XcpNgCollectionSummary> = {},
): XcpNgCollectionSummary {
  return {
    connectionType: XcpNgConnectionType.XenOrchestra,
    pools: [
      {
        poolId: POOL_ID,
        poolName: "Production",
        hostCount: 3,
        runningHostCount: 2,
        vmCount: 12,
        runningVmCount: 9,
        storageRepositoryCount: 4,
      },
      {
        poolId: "3c1e4f70-1b7e-4a31-8c55-7f2d9e4a0001",
        hostCount: 1,
        runningHostCount: 1,
        vmCount: 1,
        runningVmCount: 1,
        storageRepositoryCount: 1,
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function connection(overrides: Record<string, unknown> = {}): XcpNgConnection {
  const row: XcpNgConnection = new XcpNgConnection();
  Object.assign(row, {
    projectId: PROJECT_ID,
    connectionType: XcpNgConnectionType.XenOrchestra,
    address: "https://xo.example.com",
    isOpenMetricsSecretSet: true,
    collectionProbeId: new ObjectID(PROBE_ID),
    collectionProbe: {
      name: "Paris probe",
      isGlobalProbe: false,
      projectId: PROJECT_ID,
      connectionStatus: ProbeConnectionStatus.Connected,
    },
    collectionIntervalInMinutes: 1,
    nextCollectionAt: new Date(NOW.getTime() + 30_000),
    ...overrides,
  });
  return row;
}

function testRow(overrides: Record<string, unknown> = {}): XcpNgConnectionTest {
  const row: XcpNgConnectionTest = new XcpNgConnectionTest();
  Object.assign(row, {
    connectionType: XcpNgConnectionType.XenOrchestra,
    ...overrides,
  });
  return row;
}

describe("what a connection reads", () => {
  test("is named for a person, and offered as two choices", () => {
    expect(
      getXcpNgConnectionTypeLabel(XcpNgConnectionType.XenOrchestra, ENGLISH),
    ).toBe("Xen Orchestra");
    expect(getXcpNgConnectionTypeLabel(XcpNgConnectionType.Xapi, ENGLISH)).toBe(
      "Pool master (XAPI)",
    );
    expect(getXcpNgConnectionTypeLabel(undefined, ENGLISH)).toBe(
      "Xen Orchestra",
    );
    expect(
      getXcpNgConnectionTypeOptions().map((option: { value: string }) => {
        return option.value;
      }),
    ).toEqual([XcpNgConnectionType.XenOrchestra, XcpNgConnectionType.Xapi]);
  });

  test("a Connect form is on Xen Orchestra until another is picked", () => {
    expect(getXcpNgFormConnectionType({} as never)).toBe(
      XcpNgConnectionType.XenOrchestra,
    );
    expect(
      getXcpNgFormConnectionType({
        connectionType: XcpNgConnectionType.Xapi,
      } as never),
    ).toBe(XcpNgConnectionType.Xapi);
  });
});

describe("getXcpNgInventoryPhrases", () => {
  test("adds up a Xen Orchestra's pools", () => {
    expect(getXcpNgInventoryPhrases(summary(), ENGLISH)).toEqual([
      "2 pools",
      "4 hosts (3 running)",
      "13 VMs (10 running)",
      "5 storage repositories",
    ]);
  });

  test("leaves the pool count out for one pool's XAPI, and says one in the singular", () => {
    expect(
      getXcpNgInventoryPhrases(
        summary({
          connectionType: XcpNgConnectionType.Xapi,
          pools: [
            {
              poolId: POOL_ID,
              hostCount: 1,
              runningHostCount: 1,
              vmCount: 1,
              runningVmCount: 0,
              storageRepositoryCount: 1,
            },
          ],
        }),
        ENGLISH,
      ),
    ).toEqual([
      "1 host (1 running)",
      "1 VM (0 running)",
      "1 storage repository",
    ]);
    expect(getXcpNgInventoryPhrases(undefined, ENGLISH)).toEqual([]);
  });

  test("names each pool as XCP-ng does, or by the first part of its UUID", () => {
    expect(getXcpNgPoolNames(summary())).toEqual(["Production", "3c1e4f70"]);
  });

  test("says what the master runs", () => {
    expect(
      getXcpNgProductLine(
        summary({ productName: "XCP-ng", productVersion: "8.3.0" }),
      ),
    ).toBe("XCP-ng 8.3.0");
    expect(getXcpNgProductLine(summary())).toBeNull();
  });
});

describe("getXcpNgConnectionTestView", () => {
  test("waits, then runs, each in its own words", () => {
    expect(getXcpNgConnectionTestView(testRow(), ENGLISH).phase).toBe(
      XcpNgConnectionTestPhase.Waiting,
    );
    expect(
      getXcpNgConnectionTestView(
        testRow({ status: XcpNgConnectionTestStatus.Running }),
        ENGLISH,
      ).title,
    ).toBe("The probe is connecting to Xen Orchestra…");
    expect(
      getXcpNgConnectionTestView(
        testRow({
          status: XcpNgConnectionTestStatus.Running,
          connectionType: XcpNgConnectionType.Xapi,
        }),
        ENGLISH,
      ).title,
    ).toBe("The probe is connecting to the pool master…");
  });

  test("a Xen Orchestra that answered lists its pools", () => {
    const view: XcpNgConnectionTestView = getXcpNgConnectionTestView(
      testRow({
        status: XcpNgConnectionTestStatus.Succeeded,
        summary: summary(),
      }),
      ENGLISH,
    );

    expect(view.phase).toBe(XcpNgConnectionTestPhase.Succeeded);
    expect(view.title).toBe(
      "Connected to Xen Orchestra. The account can read:",
    );
    expect(view.inventory).toContain("2 pools");
    expect(view.poolNames).toEqual(["Production", "3c1e4f70"]);
    expect(view.notices).toEqual([]);
  });

  test("a pool that answered says what it runs, and warns of root", () => {
    const view: XcpNgConnectionTestView = getXcpNgConnectionTestView(
      testRow({
        status: XcpNgConnectionTestStatus.Succeeded,
        connectionType: XcpNgConnectionType.Xapi,
        summary: summary({
          connectionType: XcpNgConnectionType.Xapi,
          productName: "XCP-ng",
          productVersion: "8.3.0",
          account: { kind: XcpNgXapiAccountKind.Root, name: "root", roles: [] },
        }),
      }),
      ENGLISH,
    );

    expect(view.title).toBe("Connected to XCP-ng 8.3.0. The account can read:");
    expect(view.poolNames).toEqual([]);
    expect(view.notices).toHaveLength(1);
    expect(view.notices[0]?.tone).toBe(XcpNgNoticeTone.Warning);
    expect(view.notices[0]?.title).toContain("root");
  });

  test("a failure says what is wrong and the one next step, with the certificate when trusting it fixes it", () => {
    const untrusted: XcpNgConnectionTestView = getXcpNgConnectionTestView(
      testRow({
        status: XcpNgConnectionTestStatus.Failed,
        errorCode: XcpNgCollectionErrorCode.UntrustedCertificate,
        errorMessage: "Xen Orchestra presented its own certificate.",
        presentedCertificate: {
          fingerprint256: FINGERPRINT,
          subject: "O=XOA",
          issuer: "O=XOA",
          isSelfSigned: true,
          validFrom: "",
          validTo: "",
          verificationError: "self-signed certificate",
        },
      }),
      ENGLISH,
    );

    expect(untrusted.phase).toBe(XcpNgConnectionTestPhase.Failed);
    expect(untrusted.title).toBe(
      XcpNgCollectionErrorUtil.getAdvice(
        XcpNgCollectionErrorCode.UntrustedCertificate,
      ).title,
    );
    expect(untrusted.message).toBe(
      "Xen Orchestra presented its own certificate.",
    );
    expect(untrusted.certificate?.fingerprint256).toBe(FINGERPRINT);

    const wrongSecret: XcpNgConnectionTestView = getXcpNgConnectionTestView(
      testRow({
        status: XcpNgConnectionTestStatus.Failed,
        errorCode: XcpNgCollectionErrorCode.WrongSecret,
        presentedCertificate: { fingerprint256: FINGERPRINT },
      }),
      ENGLISH,
    );
    expect(wrongSecret.certificate).toBeNull();

    // A code it does not know reads as the internal error, never blank.
    expect(
      getXcpNgConnectionTestView(
        testRow({
          status: XcpNgConnectionTestStatus.Failed,
          errorCode: "Unknown",
        }),
        ENGLISH,
      ).title,
    ).toBe(
      XcpNgCollectionErrorUtil.getAdvice(XcpNgCollectionErrorCode.Internal)
        .title,
    );
  });

  test("is settled once it succeeded or failed", () => {
    expect(
      isXcpNgConnectionTestSettled(XcpNgConnectionTestStatus.Succeeded),
    ).toBe(true);
    expect(isXcpNgConnectionTestSettled(XcpNgConnectionTestStatus.Failed)).toBe(
      true,
    );
    expect(
      isXcpNgConnectionTestSettled(XcpNgConnectionTestStatus.Running),
    ).toBe(false);
    expect(isXcpNgConnectionTestSettled(undefined)).toBe(false);
  });
});

describe("notices: what a token or an account may do", () => {
  test("an AD user with more than read-only is named, with its roles", () => {
    const notice: XcpNgNotice | null = getXcpNgAccountNotice(
      {
        kind: XcpNgXapiAccountKind.Elevated,
        name: "EXAMPLE\\ops",
        roles: ["read-only", "pool-operator"],
      },
      ENGLISH,
    );

    expect(notice?.title).toBe(
      "EXAMPLE\\ops can change this pool: its roles are read-only, pool-operator.",
    );
  });

  test("a read-only account needs no notice", () => {
    expect(
      getXcpNgAccountNotice(
        {
          kind: XcpNgXapiAccountKind.ReadOnly,
          name: "EXAMPLE\\oneuptime",
          roles: ["read-only"],
        },
        ENGLISH,
      ),
    ).toBeNull();
    expect(getXcpNgAccountNotice(undefined, ENGLISH)).toBeNull();
  });

  test("a token that changes things is a danger, one that cannot read all a warning", () => {
    expect(
      getXcpNgApiTokenProblemNotice(
        { errorCode: XcpNgCollectionErrorCode.TokenNotReadOnly },
        ENGLISH,
      )?.tone,
    ).toBe(XcpNgNoticeTone.Danger);
    expect(
      getXcpNgApiTokenProblemNotice(
        { errorCode: XcpNgCollectionErrorCode.TokenCannotReadAlarms },
        ENGLISH,
      )?.tone,
    ).toBe(XcpNgNoticeTone.Warning);
    expect(
      getXcpNgApiTokenProblemNotice({ isReadOnly: true }, ENGLISH),
    ).toBeNull();
  });

  test("a token is warned about two weeks before it expires, and once it has", () => {
    const inDays: (days: number) => Date = (days: number): Date => {
      return new Date(NOW.getTime() + days * 86_400_000);
    };

    expect(
      getXcpNgApiTokenExpiryNotice(
        connection({ isApiTokenSet: true, apiTokenExpiresAt: inDays(30) }),
        ENGLISH,
        NOW,
      ),
    ).toBeNull();
    expect(
      getXcpNgApiTokenExpiryNotice(
        connection({ isApiTokenSet: true, apiTokenExpiresAt: inDays(5) }),
        ENGLISH,
        NOW,
      )?.tone,
    ).toBe(XcpNgNoticeTone.Warning);
    expect(
      getXcpNgApiTokenExpiryNotice(
        connection({ isApiTokenSet: true, apiTokenExpiresAt: inDays(-1) }),
        ENGLISH,
        NOW,
      )?.tone,
    ).toBe(XcpNgNoticeTone.Danger);
    // No token, or a pool: nothing to say.
    expect(
      getXcpNgApiTokenExpiryNotice(
        connection({ isApiTokenSet: false, apiTokenExpiresAt: inDays(-1) }),
        ENGLISH,
        NOW,
      ),
    ).toBeNull();
    expect(
      getXcpNgApiTokenExpiryNotice(
        connection({
          connectionType: XcpNgConnectionType.Xapi,
          isApiTokenSet: true,
          apiTokenExpiresAt: inDays(-1),
        }),
        ENGLISH,
        NOW,
      ),
    ).toBeNull();
  });
});

describe("getXcpNgCollectionStatusView", () => {
  test("a connection a probe reads says so, in its kind's words", () => {
    const view: XcpNgCollectionStatusView = getXcpNgCollectionStatusView(
      connection({ collectionStatus: XcpNgCollectionStatus.Succeeded }),
      ENGLISH,
      NOW,
    );
    expect(view.tone).toBe(XcpNgCollectionTone.Collecting);
    expect(view.label).toBe("Collecting");
    expect(view.title).toBe("The probe is reading this Xen Orchestra.");

    expect(
      getXcpNgCollectionStatusView(
        connection({
          connectionType: XcpNgConnectionType.Xapi,
          username: "root",
          isPasswordSet: true,
          collectionStatus: XcpNgCollectionStatus.Succeeded,
        }),
        ENGLISH,
        NOW,
      ).title,
    ).toBe("The probe is reading this pool.");
  });

  test("a new connection is being checked, and the page asks again", () => {
    const view: XcpNgCollectionStatusView = getXcpNgCollectionStatusView(
      connection({ collectionStatus: XcpNgCollectionStatus.Pending }),
      ENGLISH,
      NOW,
    );
    expect(view.tone).toBe(XcpNgCollectionTone.Checking);
    expect(view.isPending).toBe(true);
  });

  test("a failed read says why, with the certificate to trust", () => {
    const view: XcpNgCollectionStatusView = getXcpNgCollectionStatusView(
      connection({
        collectionStatus: XcpNgCollectionStatus.Failed,
        collectionErrorCode: XcpNgCollectionErrorCode.CertificateChanged,
        collectionError: "The certificate changed.",
        presentedCertificate: { fingerprint256: FINGERPRINT },
      }),
      ENGLISH,
      NOW,
    );
    expect(view.tone).toBe(XcpNgCollectionTone.Failing);
    expect(view.message).toBe("The certificate changed.");
    expect(view.certificate?.fingerprint256).toBe(FINGERPRINT);
  });

  test("what stops the claim comes first, whatever the last read said", () => {
    const view: XcpNgCollectionStatusView = getXcpNgCollectionStatusView(
      connection({
        isOpenMetricsSecretSet: false,
        collectionStatus: XcpNgCollectionStatus.Succeeded,
      }),
      ENGLISH,
      NOW,
    );
    expect(view.label).toBe("Not collecting");
    expect(view.title).toBe(
      "No OpenMetrics secret is saved for this connection.",
    );
    expect(view.isPending).toBe(false);

    expect(
      getXcpNgCollectionStatusView(
        connection({
          collectionProbe: {
            name: "Paris probe",
            isGlobalProbe: false,
            projectId: PROJECT_ID,
            connectionStatus: ProbeConnectionStatus.Disconnected,
          },
          collectionStatus: XcpNgCollectionStatus.Succeeded,
        }),
        ENGLISH,
        NOW,
      ).message,
    ).toBe("Nothing reads this connection while Paris probe is disconnected.");
  });

  test("one long overdue says no probe has come for it", () => {
    const view: XcpNgCollectionStatusView = getXcpNgCollectionStatusView(
      connection({
        collectionStatus: XcpNgCollectionStatus.Succeeded,
        nextCollectionAt: new Date(
          NOW.getTime() - XCP_NG_COLLECTION_OVERDUE_AFTER_IN_MS - 60_000,
        ),
      }),
      ENGLISH,
      NOW,
    );
    expect(view.tone).toBe(XcpNgCollectionTone.Failing);
    expect(view.message).toContain("no probe has come for it");
    expect(view.isPending).toBe(true);
  });

  test("the next read is a promise only while nothing stops the claim", () => {
    expect(
      getXcpNgNextCollection(connection(), NOW, true).state,
    ).toBe(ClaimDueState.Scheduled);
    expect(
      getXcpNgNextCollection(connection({ address: null }), NOW, true).state,
    ).not.toBe(ClaimDueState.Scheduled);
  });

  test("the description says who reads it, from where and how often", () => {
    expect(
      getXcpNgCollectionDescription(connection(), ENGLISH, NOW, true),
    ).toBe(
      "Collected by Paris probe from https://xo.example.com, every 1 minute. No agent runs for it.",
    );
  });
});

describe("Test connection's input", () => {
  test("reads the form, whatever shape the probe picker handed in", () => {
    expect(
      getXcpNgConnectionTestInput({
        connectionType: XcpNgConnectionType.Xapi,
        address: "10.0.0.10",
        collectionProbe: { _id: PROBE_ID },
        username: "root",
        password: "pw",
      } as never),
    ).toMatchObject({
      connectionType: XcpNgConnectionType.Xapi,
      address: "10.0.0.10",
      probeId: PROBE_ID,
      username: "root",
      password: "pw",
    });
  });

  test("an edit's test takes the saved connection's kind", () => {
    expect(
      getXcpNgConnectionTestInput({ address: "x" } as never, {
        xcpNgConnectionId: new ObjectID(PROBE_ID),
        connectionType: XcpNgConnectionType.Xapi,
      }).connectionType,
    ).toBe(XcpNgConnectionType.Xapi);
  });

  test("asks for each kind's own fields first, and takes a saved connection's secrets", () => {
    const base: Parameters<typeof getXcpNgConnectionTestBlocker>[0] = {
      connectionType: XcpNgConnectionType.XenOrchestra,
      address: "https://xo.example.com",
      probeId: PROBE_ID,
      trustedCertificateFingerprint: "",
      openMetricsSecret: "secret",
      apiToken: "",
      username: "",
      password: "",
    };

    expect(getXcpNgConnectionTestBlocker(base)).toBeNull();
    expect(
      getXcpNgConnectionTestBlocker({ ...base, openMetricsSecret: "" }),
    ).toContain("OpenMetrics secret");
    expect(
      getXcpNgConnectionTestBlocker({
        ...base,
        openMetricsSecret: "",
        xcpNgConnectionId: new ObjectID(PROBE_ID),
      }),
    ).toBeNull();
    expect(
      getXcpNgConnectionTestBlocker({
        ...base,
        connectionType: XcpNgConnectionType.Xapi,
        username: "root",
      }),
    ).toContain("password");
    expect(
      getXcpNgConnectionTestBlocker({
        ...base,
        connectionType: XcpNgConnectionType.Xapi,
        username: "root",
        password: "pw",
      }),
    ).toBeNull();
  });
});

describe("validation, as the server answers", () => {
  test("an address is refused with the server's own sentence", () => {
    expect(
      validateXcpNgAddress("https://xo.example.com", XcpNgConnectionType.XenOrchestra),
    ).toBeNull();
    expect(
      validateXcpNgAddress("http://xo.example.com", XcpNgConnectionType.XenOrchestra),
    ).toContain("https://");
    expect(
      validateXcpNgAddress("https://10.0.0.10/v5", XcpNgConnectionType.Xapi),
    ).toContain("without a path");
  });

  test("a fingerprint is 64 hexadecimal characters, or nothing", () => {
    expect(validateXcpNgTrustedCertificate("")).toBeNull();
    expect(validateXcpNgTrustedCertificate(FINGERPRINT)).toBeNull();
    expect(validateXcpNgTrustedCertificate("AB:CD")).toContain("SHA-256");
  });

  test("says where to compare a fingerprint before trusting it", () => {
    expect(getXcpNgTrustHint(XcpNgConnectionType.Xapi)).toContain(
      "/etc/xensource/xapi-ssl.pem",
    );
    expect(getXcpNgTrustHint(XcpNgConnectionType.XenOrchestra)).toContain(
      "xo-server",
    );
  });
});

describe("how a pool is read", () => {
  test("by the agent, a connection, or a connection since deleted", () => {
    expect(getXcpNgPoolReadBy({ collectionMethod: undefined })).toBe(
      XcpNgPoolReadBy.Agent,
    );
    expect(
      getXcpNgPoolReadBy({
        collectionMethod: XcpNgCollectionMethod.Agent,
        xcpNgConnectionId: new ObjectID(PROBE_ID),
      }),
    ).toBe(XcpNgPoolReadBy.Agent);
    expect(
      getXcpNgPoolReadBy({
        collectionMethod: XcpNgCollectionMethod.Probe,
        xcpNgConnectionId: new ObjectID(PROBE_ID),
      }),
    ).toBe(XcpNgPoolReadBy.Connection);
    expect(
      getXcpNgPoolReadBy({ collectionMethod: XcpNgCollectionMethod.Probe }),
    ).toBe(XcpNgPoolReadBy.RemovedConnection);
  });

  test("a connection can read a pool its last read saw", () => {
    expect(isXcpNgPoolInSummary(summary(), POOL_ID.toUpperCase())).toBe(true);
    expect(isXcpNgPoolInSummary(summary(), "00000000-0000-4000-8000-000000000000")).toBe(false);
    expect(isXcpNgPoolInSummary(undefined, POOL_ID)).toBe(false);
  });
});
