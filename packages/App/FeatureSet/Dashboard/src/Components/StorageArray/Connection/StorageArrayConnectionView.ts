import Probe from "Common/Models/DatabaseModels/Probe";
import StorageArrayConnection from "Common/Models/DatabaseModels/StorageArrayConnection";
import StorageArrayConnectionTest from "Common/Models/DatabaseModels/StorageArrayConnectionTest";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import StorageArrayCollectionErrorCode, {
  StorageArrayCollectionErrorCodeUtil,
} from "Common/Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import StorageArrayCollectionStatus from "Common/Types/StorageArray/Collection/StorageArrayCollectionStatus";
import StorageArrayConnectionTestStatus from "Common/Types/StorageArray/Collection/StorageArrayConnectionTestStatus";
import {
  StorageArrayCollectionArraySummary,
  StorageArrayCollectionSummary,
  StorageArrayPresentedCertificate,
} from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import { StorageArrayProbeCollector } from "Common/Types/StorageArray/Collection/StorageArrayProbeCollector";
import StorageArrayProbeCollectors from "Common/Types/StorageArray/Collection/StorageArrayProbeCollectors";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import { PowerMaxKind } from "Common/Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxSeries";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  Translator,
  translatableTerm,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  ClaimDue,
  ClaimDueState,
  readClaimDue,
} from "Common/Utils/Probe/ClaimDueTime";
import StorageArrayConnectionAddress, {
  StorageArrayAddressResult,
} from "Common/Utils/StorageArray/StorageArrayConnectionAddress";
import VMwareCertificateFingerprint from "Common/Utils/VMware/VMwareCertificateFingerprint";
import {
  StorageArrayCollectionStop,
  getStorageArrayCollectionStop as readCollectionStop,
} from "Common/Utils/StorageArray/StorageArrayCollectionStop";
import { getProbeCollectionDescription } from "../../Probe/ProbeCollectionDescription";

/*
 * What the Dashboard says about a storage array connection a probe collects
 * (#11004) - which probes may read it, where a connection test stands, how
 * the last collection went and what to do about it - as plain values, free
 * of React, so the pages and the tests read the same answers. The rules are
 * VMware's agentless collection's, for a Unisphere for PowerMax.
 *
 * Every sentence is looked up whole, in the reader's language, through the
 * translator the caller hands in.
 */

export const STORAGE_ARRAY_TEST_POLL_INTERVAL_IN_MS: number = 2000;
export const STORAGE_ARRAY_STATUS_POLL_INTERVAL_IN_MS: number = 10000;
export const STORAGE_ARRAY_TEST_MAX_WAIT_IN_MS: number = 5 * 60 * 1000;

/*
 * How long a connection can stay due before it is said that no probe has
 * come for it: a probe asks every ten seconds, a collection runs for at
 * most eight minutes and uploads for five more.
 */
export const STORAGE_ARRAY_COLLECTION_OVERDUE_AFTER_IN_MS: number =
  20 * 60 * 1000;

export interface StorageArrayErrorAdvice {
  title: string;
  nextStep: string;
}

// What each failure means, and the one thing that fixes it.
const ADVICE: Record<StorageArrayCollectionErrorCode, StorageArrayErrorAdvice> =
  {
    [StorageArrayCollectionErrorCode.InvalidAddress]: {
      title: translationKey("The address is not one the probe can use."),
      nextStep: translationKey(
        "Enter the address you open the server at in a browser, with https://.",
      ),
    },
    [StorageArrayCollectionErrorCode.AddressNotAllowed]: {
      title: translationKey("The probe does not connect to this address."),
      nextStep: translationKey(
        "Enter the server's own host name or IP address in your network.",
      ),
    },
    [StorageArrayCollectionErrorCode.AddressNotFound]: {
      title: translationKey("The probe cannot find this host name."),
      nextStep: translationKey(
        "Check the spelling, or enter the server's IP address.",
      ),
    },
    [StorageArrayCollectionErrorCode.ConnectionRefused]: {
      title: translationKey("The server refused the connection."),
      nextStep: translationKey(
        "Check the port: Unisphere for PowerMax serves its REST API on 8443 unless it was changed.",
      ),
    },
    [StorageArrayCollectionErrorCode.ConnectionTimedOut]: {
      title: translationKey("The probe gets no answer from the server."),
      nextStep: translationKey(
        "Allow the probe's machine through the firewall to the server's port, or pick a probe in the server's network.",
      ),
    },
    [StorageArrayCollectionErrorCode.ConnectionFailed]: {
      title: translationKey("The probe could not connect to the server."),
      nextStep: translationKey(
        "Check that the server is up and the probe's network reaches it, then test again.",
      ),
    },
    [StorageArrayCollectionErrorCode.TlsFailed]: {
      title: translationKey("The secure connection failed."),
      nextStep: translationKey(
        "Check that the address points at the server's HTTPS port.",
      ),
    },
    [StorageArrayCollectionErrorCode.UntrustedCertificate]: {
      title: translationKey("The server's certificate is not trusted."),
      nextStep: translationKey(
        "Check the fingerprint below against the server's certificate, then trust it.",
      ),
    },
    [StorageArrayCollectionErrorCode.CertificateChanged]: {
      title: translationKey("The server's certificate changed."),
      nextStep: translationKey(
        "If the certificate was renewed, check its fingerprint and trust it. Nothing is sent until you do.",
      ),
    },
    [StorageArrayCollectionErrorCode.NotManagementServer]: {
      title: translationKey("This address is not Unisphere's REST API."),
      nextStep: translationKey(
        "Enter the address and port you open Unisphere for PowerMax at, usually port 8443.",
      ),
    },
    [StorageArrayCollectionErrorCode.UnsupportedVersion]: {
      title: translationKey("This Unisphere is older than OneUptime reads."),
      nextStep: translationKey(
        "Upgrade to Unisphere for PowerMax 10.1 or later, or 10.3 or later to see ports and SRDF groups.",
      ),
    },
    [StorageArrayCollectionErrorCode.InvalidLogin]: {
      title: translationKey("The server refused the login."),
      nextStep: translationKey(
        "Check the user name and password, and that the account is not locked.",
      ),
    },
    [StorageArrayCollectionErrorCode.MissingRole]: {
      title: translationKey("The account may not read the arrays."),
      nextStep: translationKey(
        "In Unisphere, give the user the Monitor role on each array, and PerfMonitor for performance.",
      ),
    },
    [StorageArrayCollectionErrorCode.NoArrays]: {
      title: translationKey("The account sees no array this server manages."),
      nextStep: translationKey(
        "Check that this Unisphere manages arrays locally, and that the user has the Monitor role on them.",
      ),
    },
    [StorageArrayCollectionErrorCode.ApiError]: {
      title: translationKey("The server answered with an error."),
      nextStep: translationKey(
        "Check the server's health and its own logs, then test again.",
      ),
    },
    [StorageArrayCollectionErrorCode.TimedOut]: {
      title: translationKey("The server took too long to answer."),
      nextStep: translationKey(
        "It may be overloaded: read it every 10 minutes in More fields, or check its health.",
      ),
    },
    [StorageArrayCollectionErrorCode.PayloadTooLarge]: {
      title: translationKey(
        "This server's arrays are too large to send from one probe.",
      ),
      nextStep: translationKey(
        "Connect its arrays through more than one Unisphere, each read by a probe.",
      ),
    },
    [StorageArrayCollectionErrorCode.ProbeNotAllowed]: {
      title: translationKey("This probe may not read this server."),
      nextStep: translationKey(
        "Pick one of this project's own probes: shared probes never receive storage passwords.",
      ),
    },
    [StorageArrayCollectionErrorCode.ProbeNotAvailable]: {
      title: translationKey("No probe picked the work up."),
      nextStep: translationKey(
        "Check that the probe is connected in Custom Probes, and update it to the latest version.",
      ),
    },
    [StorageArrayCollectionErrorCode.PlatformNotSupported]: {
      title: translationKey("The probe cannot read this platform."),
      nextStep: translationKey("Update the probe to the latest version."),
    },
    [StorageArrayCollectionErrorCode.Internal]: {
      title: translationKey("The probe hit an unexpected error."),
      nextStep: translationKey(
        "Test again. If it keeps happening, check the probe's logs.",
      ),
    },
  };

export function getStorageArrayErrorAdvice(
  code: StorageArrayCollectionErrorCode | null | undefined,
): StorageArrayErrorAdvice {
  return ADVICE[
    code && StorageArrayCollectionErrorCodeUtil.isValid(code)
      ? code
      : StorageArrayCollectionErrorCode.Internal
  ];
}

export function getCollector(
  storageSystem: string | null | undefined,
): StorageArrayProbeCollector {
  return (
    StorageArrayProbeCollectors.getCollector(storageSystem) ||
    StorageArrayProbeCollectors.getDefault()
  );
}

// ---------------- Probes ----------------

export interface StorageArrayProbeOption {
  label: string;
  value: string;
}

/*
 * The probes a connection may be read through: the project's own - and, on
 * a self-hosted instance (billing off), the instance's global probes, which
 * are its operator's own. On OneUptime Cloud a global probe is shared by
 * every sign-up and never receives a storage password, so it is not
 * offered. The server holds to the same rule
 * (StorageArrayConnectionSettings.getProbeRefusal).
 */
export function getStorageArrayCollectionProbes(
  probes: Array<Probe>,
  isBillingEnabled: boolean,
): Array<Probe> {
  return probes.filter((probe: Probe): boolean => {
    if (!probe._id) {
      return false;
    }
    return probe.isGlobalProbe !== true || !isBillingEnabled;
  });
}

export function getStorageArrayProbeOptions(
  probes: Array<Probe>,
  isBillingEnabled: boolean,
  translator: Translator,
): Array<StorageArrayProbeOption> {
  return getStorageArrayCollectionProbes(probes, isBillingEnabled).map(
    (probe: Probe): StorageArrayProbeOption => {
      const name: string =
        probe.name ||
        translator.translateTemplate("Probe {{id}}", { id: String(probe._id) });
      return {
        label:
          probe.isGlobalProbe === true
            ? translator.translateTemplate("{{name}} (this instance's probe)", {
                name: name,
              })
            : name,
        value: String(probe._id),
      };
    },
  );
}

export function getDefaultStorageArrayProbeId(
  probes: Array<Probe>,
  isBillingEnabled: boolean,
): string {
  const eligible: Array<Probe> = getStorageArrayCollectionProbes(
    probes,
    isBillingEnabled,
  );
  return eligible.length === 1 ? String(eligible[0]!._id) : "";
}

// ---------------- What a test or a collection found ----------------

// "PowerMax 8500 · PowerMaxOS 6079.275.0", for one array.
export function getArrayLine(
  array: StorageArrayCollectionArraySummary,
): string {
  return [array.model?.replace(/_/g, " "), array.osVersion]
    .filter(Boolean)
    .join(" · ");
}

// The counts a test or a collection found, as short phrases.
export function getInventoryPhrases(
  summary: StorageArrayCollectionSummary | null | undefined,
  translator: Translator,
): Array<string> {
  if (!summary) {
    return [];
  }
  const local: Array<StorageArrayCollectionArraySummary> = (
    summary.arrays || []
  ).filter((array: StorageArrayCollectionArraySummary): boolean => {
    return array.isLocal;
  });
  let storageGroups: number = 0;
  let volumes: number = 0;
  for (const array of local) {
    storageGroups += array.counts[PowerMaxKind.StorageGroup] || 0;
    volumes += array.counts[StorageArrayResourceKind.Volume] || 0;
  }
  return [
    translator.translatePlural(
      { one: "{{count}} array", other: "{{count}} arrays" },
      local.length,
    ),
    translator.translatePlural(
      { one: "{{count}} storage group", other: "{{count}} storage groups" },
      storageGroups,
    ),
    translator.translatePlural(
      { one: "{{count}} volume", other: "{{count}} volumes" },
      volumes,
    ),
  ];
}

export enum PerformanceState {
  On = "On",
  RealTime = "RealTime",
  Off = "Off",
  Unknown = "Unknown",
}

// Whether Unisphere collects an array's performance, as the page says it.
export function getPerformanceState(
  array: StorageArrayCollectionArraySummary,
): PerformanceState {
  if (array.isPerformanceCollected === true) {
    return array.isRealtimeCollected && (array.realtimeObjects || []).length
      ? PerformanceState.RealTime
      : PerformanceState.On;
  }
  if (array.isPerformanceCollected === false) {
    return PerformanceState.Off;
  }
  return PerformanceState.Unknown;
}

export function getPerformanceWords(
  array: StorageArrayCollectionArraySummary,
  translator: Translator,
): string {
  switch (getPerformanceState(array)) {
    case PerformanceState.RealTime:
      return translator.translatePlural(
        {
          one: "Performance on, real time for {{count}} storage group",
          other: "Performance on, real time for {{count}} storage groups",
        },
        (array.realtimeObjects || []).length,
      );
    case PerformanceState.On:
      return translator.translateText("Performance on") as string;
    case PerformanceState.Off:
      return translator.translateText("Performance collection off") as string;
    default:
      return translator.translateText("Performance unknown") as string;
  }
}

// The connection whose last collection listed this array as its own.
export function findArrayConnection(
  connections: Array<StorageArrayConnection>,
  systemId: string | null | undefined,
): {
  connection: StorageArrayConnection;
  array: StorageArrayCollectionArraySummary;
} | null {
  if (!systemId) {
    return null;
  }
  for (const connection of connections) {
    const array: StorageArrayCollectionArraySummary | undefined = (
      connection.collectionSummary?.arrays || []
    ).find((candidate: StorageArrayCollectionArraySummary): boolean => {
      return candidate.isLocal && candidate.id === systemId;
    });
    if (array) {
      return { connection, array };
    }
  }
  return null;
}

// ---------------- The connection test ----------------

export enum StorageArrayTestPhase {
  Waiting = "Waiting",
  Running = "Running",
  Succeeded = "Succeeded",
  Failed = "Failed",
}

export interface StorageArrayTestView {
  phase: StorageArrayTestPhase;
  title: string;
  message: string | null;
  nextStep: string | null;
  inventory: Array<string>;
  // The arrays it found, local ones first: each with what may need a look.
  arrays: Array<StorageArrayCollectionArraySummary>;
  warnings: Array<string>;
  certificate: StorageArrayPresentedCertificate | null;
}

export function getStorageArrayTestView(
  test: Pick<
    StorageArrayConnectionTest,
    "status" | "errorCode" | "errorMessage" | "presentedCertificate" | "summary"
  >,
  translator: Translator,
): StorageArrayTestView {
  const empty: Omit<StorageArrayTestView, "phase" | "title"> = {
    message: null,
    nextStep: null,
    inventory: [],
    arrays: [],
    warnings: [],
    certificate: null,
  };

  switch (test.status) {
    case StorageArrayConnectionTestStatus.Running:
      return {
        ...empty,
        phase: StorageArrayTestPhase.Running,
        title: translator.translateText(
          "The probe is connecting to Unisphere…",
        ) as string,
      };
    case StorageArrayConnectionTestStatus.Succeeded: {
      const summary: StorageArrayCollectionSummary | undefined = test.summary;
      const product: string = [
        summary?.serverProductName,
        summary?.serverVersion,
      ]
        .filter(Boolean)
        .join(" ");
      const arrays: Array<StorageArrayCollectionArraySummary> = [
        ...(summary?.arrays || []),
      ].sort(
        (
          a: StorageArrayCollectionArraySummary,
          b: StorageArrayCollectionArraySummary,
        ): number => {
          return Number(b.isLocal) - Number(a.isLocal);
        },
      );
      return {
        ...empty,
        phase: StorageArrayTestPhase.Succeeded,
        title: product
          ? translator.translateTemplate(
              "Connected to {{product}}. The account can read:",
              { product: product },
            )
          : (translator.translateText(
              "Connected. The account can read:",
            ) as string),
        inventory: getInventoryPhrases(summary, translator),
        arrays: arrays,
        warnings: summary?.warnings || [],
      };
    }
    case StorageArrayConnectionTestStatus.Failed: {
      const advice: StorageArrayErrorAdvice = getStorageArrayErrorAdvice(
        test.errorCode,
      );
      return {
        ...empty,
        phase: StorageArrayTestPhase.Failed,
        title: translator.translateText(advice.title) as string,
        message: test.errorMessage || null,
        nextStep: translator.translateText(advice.nextStep) as string,
        certificate:
          StorageArrayCollectionErrorCodeUtil.isCertificateProblem(
            test.errorCode,
          ) && test.presentedCertificate?.fingerprint256
            ? test.presentedCertificate
            : null,
      };
    }
    default:
      return {
        ...empty,
        phase: StorageArrayTestPhase.Waiting,
        title: translator.translateText(
          "Waiting for the probe to pick the test up…",
        ) as string,
      };
  }
}

export interface StorageArrayTestInput {
  storageSystem: string;
  address: string;
  username: string;
  // Empty: the connection's saved password (storageArrayConnectionId).
  password: string;
  probeId: string;
  trustedCertificateFingerprint: string;
  storageArrayConnectionId?: ObjectID | undefined;
}

export function getStorageArrayTestBlocker(
  input: StorageArrayTestInput,
): string | null {
  if (
    !input.address.trim() ||
    !input.username.trim() ||
    !input.probeId ||
    (!input.password && !input.storageArrayConnectionId)
  ) {
    return translationKey(
      "Enter the address, user name, password and probe first.",
    );
  }
  return null;
}

function readString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function readProbeId(values: FormValues<StorageArrayConnection>): string {
  const probe: unknown =
    (values as Record<string, unknown>)["collectionProbe"] ??
    (values as Record<string, unknown>)["collectionProbeId"];
  if (!probe) {
    return "";
  }
  if (typeof probe === "string") {
    return probe;
  }
  if (probe instanceof ObjectID) {
    return probe.toString();
  }
  const relation: { _id?: unknown; id?: unknown } = probe as {
    _id?: unknown;
    id?: unknown;
  };
  return readString(relation._id || relation.id);
}

export function getStorageArrayTestInput(
  values: FormValues<StorageArrayConnection>,
  storageSystem: string,
  storageArrayConnectionId?: ObjectID | undefined,
): StorageArrayTestInput {
  const record: Record<string, unknown> = values as Record<string, unknown>;
  return {
    storageSystem: storageSystem,
    address: readString(record["address"]),
    username: readString(record["username"]),
    password: readString(record["password"]),
    probeId: readProbeId(values),
    trustedCertificateFingerprint: readString(
      record["trustedCertificateFingerprint"],
    ),
    storageArrayConnectionId: storageArrayConnectionId,
  };
}

export function validateStorageArrayAddress(
  value: unknown,
  storageSystem: string,
): string | null {
  const result: StorageArrayAddressResult =
    StorageArrayConnectionAddress.normalize(
      readString(value),
      getCollector(storageSystem),
    );
  return result.address ? null : translateText(result.error) || result.error;
}

export function validateTrustedCertificate(value: unknown): string | null {
  const text: string = readString(value).trim();
  if (!text || VMwareCertificateFingerprint.isValid(text)) {
    return null;
  }
  return (
    translateText(
      "Enter a SHA-256 fingerprint: 64 hexadecimal characters, such as AB:CD:EF:... .",
    ) || ""
  );
}

// ---------------- The collection ----------------

export type StorageArrayCollectionFacts = Pick<
  StorageArrayConnection,
  | "projectId"
  | "isPasswordSet"
  | "address"
  | "username"
  | "collectionProbeId"
  | "collectionProbe"
  | "collectionStatus"
  | "collectionErrorCode"
  | "collectionError"
  | "presentedCertificate"
  | "nextCollectionAt"
>;

// Why no probe reads this connection now, or null when one will.
export function getStorageArrayCollectionStop(
  connection: StorageArrayCollectionFacts,
  isBillingEnabled: boolean,
): StorageArrayCollectionStop | null {
  return readCollectionStop(connection, isBillingEnabled);
}

export function getStorageArrayNextCollection(
  connection: StorageArrayCollectionFacts,
  now: Date,
  isBillingEnabled: boolean,
): ClaimDue<StorageArrayCollectionStop> {
  return readClaimDue<StorageArrayCollectionStop>({
    stop: getStorageArrayCollectionStop(connection, isBillingEnabled),
    dueAt: connection.nextCollectionAt,
    now: now,
    overdueAfterInMs: STORAGE_ARRAY_COLLECTION_OVERDUE_AFTER_IN_MS,
  });
}

export function getStorageArrayCollectionDescription(
  connection: StorageArrayCollectionFacts &
    Pick<StorageArrayConnection, "collectionIntervalInMinutes">,
  translator: Translator,
  now: Date,
  isBillingEnabled: boolean,
): string | undefined {
  const state: ClaimDueState = getStorageArrayNextCollection(
    connection,
    now,
    isBillingEnabled,
  ).state;
  return getProbeCollectionDescription(
    {
      isCollected:
        state === ClaimDueState.Scheduled || state === ClaimDueState.DueNow,
      hasProbe: Boolean(connection.collectionProbeId),
      probeName:
        connection.collectionProbe?.name || translatableTerm("its probe"),
      address: connection.address,
      intervalInMinutes: connection.collectionIntervalInMinutes || 5,
    },
    translator,
  );
}

export enum StorageArrayCollectionTone {
  Checking = "Checking",
  Collecting = "Collecting",
  Failing = "Failing",
}

export interface StorageArrayCollectionStatusView {
  tone: StorageArrayCollectionTone;
  label: string;
  title: string;
  message: string | null;
  nextStep: string | null;
  certificate: StorageArrayPresentedCertificate | null;
  isPending: boolean;
}

const STOP_WORDS: Record<
  Exclude<
    StorageArrayCollectionStop,
    | StorageArrayCollectionStop.ProbeNotAllowed
    | StorageArrayCollectionStop.ProbeDisconnected
  >,
  { title: string; nextStep: string }
> = {
  [StorageArrayCollectionStop.NoPassword]: {
    title: translationKey("No password is saved for this connection."),
    nextStep: translationKey(
      "Enter the user's password with Edit Connection, and test the connection.",
    ),
  },
  [StorageArrayCollectionStop.NoAddress]: {
    title: translationKey("This connection has no address."),
    nextStep: translationKey(
      "Enter the server's address with Edit Connection, and test the connection.",
    ),
  },
  [StorageArrayCollectionStop.NoUserName]: {
    title: translationKey("This connection has no user name."),
    nextStep: translationKey(
      "Enter the user name with Edit Connection, and test the connection.",
    ),
  },
  [StorageArrayCollectionStop.NoProbe]: {
    title: translationKey("No probe is set to read this connection."),
    nextStep: translationKey(
      "Pick one of this project's probes with Edit Connection.",
    ),
  },
};

export function getStorageArrayCollectionStatusView(
  connection: StorageArrayCollectionFacts,
  translator: Translator,
  now: Date = new Date(),
  isBillingEnabled: boolean = false,
): StorageArrayCollectionStatusView {
  const notCollecting: string = translator.translateText(
    "Not collecting",
  ) as string;
  const stop: StorageArrayCollectionStop | null = getStorageArrayCollectionStop(
    connection,
    isBillingEnabled,
  );

  if (stop) {
    if (
      stop === StorageArrayCollectionStop.ProbeNotAllowed ||
      stop === StorageArrayCollectionStop.ProbeDisconnected
    ) {
      const advice: StorageArrayErrorAdvice = getStorageArrayErrorAdvice(
        stop === StorageArrayCollectionStop.ProbeNotAllowed
          ? StorageArrayCollectionErrorCode.ProbeNotAllowed
          : StorageArrayCollectionErrorCode.ProbeNotAvailable,
      );
      return {
        tone: StorageArrayCollectionTone.Failing,
        label: notCollecting,
        title: translator.translateText(advice.title) as string,
        message:
          stop === StorageArrayCollectionStop.ProbeDisconnected
            ? translator.translateTemplate(
                "Nothing reads this connection while {{probe}} is disconnected.",
                {
                  probe:
                    connection.collectionProbe?.name ||
                    translatableTerm("its probe"),
                },
              )
            : null,
        nextStep: translator.translateText(advice.nextStep) as string,
        certificate: null,
        isPending: false,
      };
    }
    return {
      tone: StorageArrayCollectionTone.Failing,
      label: notCollecting,
      title: translator.translateText(STOP_WORDS[stop].title) as string,
      message: null,
      nextStep: translator.translateText(STOP_WORDS[stop].nextStep) as string,
      certificate: null,
      isPending: false,
    };
  }

  if (
    readClaimDue<null>({
      stop: null,
      dueAt: connection.nextCollectionAt,
      now: now,
      overdueAfterInMs: STORAGE_ARRAY_COLLECTION_OVERDUE_AFTER_IN_MS,
    }).state === ClaimDueState.Overdue
  ) {
    const advice: StorageArrayErrorAdvice = getStorageArrayErrorAdvice(
      StorageArrayCollectionErrorCode.ProbeNotAvailable,
    );
    return {
      tone: StorageArrayCollectionTone.Failing,
      label: notCollecting,
      title: translator.translateText(advice.title) as string,
      message: translator.translateTemplate(
        "This connection was due to be read {{time}}, and no probe has come for it.",
        { time: OneUptimeDate.fromNow(connection.nextCollectionAt as Date) },
      ),
      nextStep: translator.translateText(advice.nextStep) as string,
      certificate: null,
      isPending: true,
    };
  }

  if (connection.collectionStatus === StorageArrayCollectionStatus.Succeeded) {
    return {
      tone: StorageArrayCollectionTone.Collecting,
      label: translator.translateText("Collecting") as string,
      title: translator.translateText(
        "The probe is reading every array behind this Unisphere.",
      ) as string,
      message: null,
      nextStep: null,
      certificate: null,
      isPending: false,
    };
  }

  if (connection.collectionStatus === StorageArrayCollectionStatus.Failed) {
    const advice: StorageArrayErrorAdvice = getStorageArrayErrorAdvice(
      connection.collectionErrorCode,
    );
    return {
      tone: StorageArrayCollectionTone.Failing,
      label: notCollecting,
      title: translator.translateText(advice.title) as string,
      message: connection.collectionError || null,
      nextStep: translator.translateText(advice.nextStep) as string,
      certificate:
        StorageArrayCollectionErrorCodeUtil.isCertificateProblem(
          connection.collectionErrorCode,
        ) && connection.presentedCertificate?.fingerprint256
          ? connection.presentedCertificate
          : null,
      isPending: false,
    };
  }

  return {
    tone: StorageArrayCollectionTone.Checking,
    label: translator.translateText("Checking") as string,
    title: translator.translateText(
      "The probe reads this Unisphere with its new settings within a minute.",
    ) as string,
    message: null,
    nextStep: null,
    certificate: null,
    isPending: true,
  };
}
