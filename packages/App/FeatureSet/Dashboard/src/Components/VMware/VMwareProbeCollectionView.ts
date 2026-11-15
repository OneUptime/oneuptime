import Probe from "Common/Models/DatabaseModels/Probe";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterConnectionTest from "Common/Models/DatabaseModels/VMwareVCenterConnectionTest";
import {
  Translator,
  translatableTerm,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import VMwareCertificateFingerprint from "Common/Utils/VMware/VMwareCertificateFingerprint";
import VMwareVCenterAddress, {
  VCenterAddressResult,
} from "Common/Utils/VMware/VMwareVCenterAddress";
import VMwareCollectionErrorCode, {
  VMwareCollectionErrorAdvice,
  VMwareCollectionErrorUtil,
} from "Common/Types/VMware/VMwareCollectionError";
import VMwareCollectionMethod from "Common/Types/VMware/VMwareCollectionMethod";
import VMwareCollectionStatus from "Common/Types/VMware/VMwareCollectionStatus";
import VMwareConnectionTestStatus from "Common/Types/VMware/VMwareConnectionTestStatus";
import {
  VMwareCollectionSummary,
  VMwarePresentedCertificate,
} from "Common/Types/VMware/VMwareProbeCollection";
import {
  ClaimDue,
  ClaimDueState,
  readClaimDue,
} from "Common/Utils/Probe/ClaimDueTime";
import {
  VMwareCollectionStop,
  VMwareCollectionStopFacts,
  getVMwareCollectionStop,
} from "Common/Utils/VMware/VMwareCollectionStop";

/*
 * What the Dashboard says about a vCenter a probe collects - which probes
 * may collect it, where a connection test stands, how the last collection
 * went and what to do about it - as plain values, free of React, so the
 * pages and the tests read the same answers.
 *
 * Every sentence is looked up whole, in the reader's language, through the
 * translator the caller hands in.
 */

// How often a page asks again while a test or a first collection is pending.
export const VMWARE_TEST_POLL_INTERVAL_IN_MS: number = 2000;
export const VMWARE_STATUS_POLL_INTERVAL_IN_MS: number = 10000;

/*
 * How long the Dashboard waits for a test before it stops asking: the
 * server answers an abandoned test within its pickup and run timeouts
 * (90 s + 120 s), so this is only reached when the server stopped
 * answering too.
 */
export const VMWARE_TEST_MAX_WAIT_IN_MS: number = 5 * 60 * 1000;

export interface VMwareProbeOption {
  label: string;
  value: string;
}

/*
 * The probes a vCenter may be collected through: the project's own - and,
 * on a self-hosted instance (billing off), the instance's global probes,
 * which are its operator's own. On OneUptime Cloud a global probe is shared
 * by every sign-up and never receives a vCenter password, so it is not
 * offered. The server holds to the same rule (VMwareCollectionSettings).
 */
export function getVMwareCollectionProbes(
  probes: Array<Probe>,
  isBillingEnabled: boolean,
): Array<Probe> {
  return probes.filter((probe: Probe): boolean => {
    if (!probe._id) {
      return false;
    }

    const isGlobal: boolean = probe.isGlobalProbe === true;

    return !isGlobal || !isBillingEnabled;
  });
}

export function getVMwareCollectionProbeOptions(
  probes: Array<Probe>,
  isBillingEnabled: boolean,
  translator: Translator,
): Array<VMwareProbeOption> {
  return getVMwareCollectionProbes(probes, isBillingEnabled).map(
    (probe: Probe): VMwareProbeOption => {
      const name: string =
        probe.name ||
        translator.translateTemplate("Probe {{id}}", {
          id: String(probe._id),
        });
      const isGlobal: boolean = probe.isGlobalProbe === true;

      return {
        label: isGlobal
          ? translator.translateTemplate("{{name}} (this instance's probe)", {
              name: name,
            })
          : name,
        value: String(probe._id),
      };
    },
  );
}

/*
 * The probe a new vCenter starts on: the only one it may use, when there is
 * exactly one. With two there is no "the" probe, and with none the person
 * adds one first.
 */
export function getDefaultVMwareCollectionProbeId(
  probes: Array<Probe>,
  isBillingEnabled: boolean,
): string {
  const eligible: Array<Probe> = getVMwareCollectionProbes(
    probes,
    isBillingEnabled,
  );

  return eligible.length === 1 ? String(eligible[0]!._id) : "";
}

// Whether a vCenter's data comes from a probe that logs in to it.
export function isProbeCollected(
  vcenter: Pick<VMwareVCenter, "collectionMethod"> | null | undefined,
): boolean {
  return vcenter?.collectionMethod === VMwareCollectionMethod.Probe;
}

/*
 * What vSphere returned for a collection or a test, as short phrases a
 * person scans: "5 hosts", "10 virtual machines (9 running)".
 */
export function getVMwareInventoryPhrases(
  summary: VMwareCollectionSummary | null | undefined,
  translator: Translator,
): Array<string> {
  if (!summary) {
    return [];
  }

  const phrases: Array<string> = [
    translator.translatePlural(
      { one: "{{count}} datacenter", other: "{{count}} datacenters" },
      summary.datacenterCount,
    ),
    translator.translatePlural(
      { one: "{{count}} cluster", other: "{{count}} clusters" },
      summary.clusterCount,
    ),
    translator.translatePlural(
      { one: "{{count}} host", other: "{{count}} hosts" },
      summary.hostCount,
    ),
    translator.translatePlural(
      {
        one: "{{count}} virtual machine ({{running}} running)",
        other: "{{count}} virtual machines ({{running}} running)",
      },
      summary.vmCount,
      { running: translator.formatNumber(summary.poweredOnVmCount) },
    ),
    translator.translatePlural(
      { one: "{{count}} datastore", other: "{{count}} datastores" },
      summary.datastoreCount,
    ),
  ];

  return phrases;
}

// What vCenter is, from its own answer: "VMware vCenter Server 8.0.2".
export function getVMwareProductLine(
  summary: VMwareCollectionSummary | null | undefined,
): string | null {
  if (!summary) {
    return null;
  }

  const name: string = summary.productName || "";
  const version: string = summary.version || "";

  return [name, version].filter(Boolean).join(" ") || null;
}

export enum VMwareConnectionTestPhase {
  Waiting = "Waiting",
  Running = "Running",
  Succeeded = "Succeeded",
  Failed = "Failed",
}

export interface VMwareConnectionTestView {
  phase: VMwareConnectionTestPhase;
  title: string;
  message: string | null;
  nextStep: string | null;
  inventory: Array<string>;
  // vCenter's certificate, when trusting it fixes the test.
  certificate: VMwarePresentedCertificate | null;
}

// Where a connection test stands, in words.
export function getVMwareConnectionTestView(
  test: Pick<
    VMwareVCenterConnectionTest,
    "status" | "errorCode" | "errorMessage" | "presentedCertificate" | "summary"
  >,
  translator: Translator,
): VMwareConnectionTestView {
  switch (test.status) {
    case VMwareConnectionTestStatus.Running:
      return {
        phase: VMwareConnectionTestPhase.Running,
        title: translator.translateText(
          "The probe is connecting to vCenter…",
        ) as string,
        message: null,
        nextStep: null,
        inventory: [],
        certificate: null,
      };
    case VMwareConnectionTestStatus.Succeeded: {
      const product: string | null = getVMwareProductLine(test.summary);

      return {
        phase: VMwareConnectionTestPhase.Succeeded,
        title: product
          ? translator.translateTemplate(
              "Connected to {{product}}. The account can read:",
              { product: product },
            )
          : (translator.translateText(
              "Connected. The account can read:",
            ) as string),
        message: null,
        nextStep: null,
        inventory: getVMwareInventoryPhrases(test.summary, translator),
        certificate: null,
      };
    }
    case VMwareConnectionTestStatus.Failed: {
      const code: VMwareCollectionErrorCode = VMwareCollectionErrorUtil.isValid(
        test.errorCode,
      )
        ? test.errorCode
        : VMwareCollectionErrorCode.Internal;
      const advice: VMwareCollectionErrorAdvice =
        VMwareCollectionErrorUtil.getAdvice(code);

      return {
        phase: VMwareConnectionTestPhase.Failed,
        title: translator.translateText(advice.title) as string,
        message: test.errorMessage || null,
        nextStep: translator.translateText(advice.nextStep) as string,
        inventory: [],
        certificate:
          VMwareCollectionErrorUtil.isCertificateTrustProblem(code) &&
          test.presentedCertificate?.fingerprint256
            ? test.presentedCertificate
            : null,
      };
    }
    default:
      return {
        phase: VMwareConnectionTestPhase.Waiting,
        title: translator.translateText(
          "Waiting for the probe to pick the test up…",
        ) as string,
        message: null,
        nextStep: null,
        inventory: [],
        certificate: null,
      };
  }
}

export function isVMwareConnectionTestSettled(
  status: VMwareConnectionTestStatus | null | undefined,
): boolean {
  return (
    status === VMwareConnectionTestStatus.Succeeded ||
    status === VMwareConnectionTestStatus.Failed
  );
}

export enum VMwareCollectionTone {
  Checking = "Checking",
  Collecting = "Collecting",
  Failing = "Failing",
}

export interface VMwareCollectionStatusView {
  tone: VMwareCollectionTone;
  // The badge: "Checking", "Collecting", "Not collecting".
  label: string;
  title: string;
  message: string | null;
  nextStep: string | null;
  certificate: VMwarePresentedCertificate | null;
  // Whether the page should ask again soon.
  isPending: boolean;
}

/*
 * How long a vCenter can stay due before it is said that no probe has come
 * for it. A probe asks every ten seconds, and a collection still running
 * holds the next one back for at most its time budget of ten minutes, and
 * its upload for five more. Past that, nothing is asking: the probe is
 * offline, or too old.
 */
export const VMWARE_COLLECTION_OVERDUE_AFTER_IN_MS: number = 20 * 60 * 1000;

// The columns the stop and the next collection are read from, for a card's select.
export type VMwareCollectionScheduleFacts = VMwareCollectionStopFacts &
  Pick<VMwareVCenter, "nextCollectionAt">;

/*
 * When a probe collects this vCenter next, and whether that is a promise
 * (Common/Utils/Probe/ClaimDueTime): the vCenter's nextCollectionAt only
 * when nothing stops the claim handing it out (getVMwareCollectionStop). A
 * vCenter nothing may collect is set aside a quarter of an hour at a time,
 * so its nextCollectionAt keeps moving and promises nothing.
 */
export function getVMwareNextCollection(
  vcenter: VMwareCollectionScheduleFacts,
  now: Date,
  isBillingEnabled: boolean,
): ClaimDue<VMwareCollectionStop> {
  return readClaimDue<VMwareCollectionStop>({
    stop: getVMwareCollectionStop(vcenter, isBillingEnabled),
    dueAt: vcenter.nextCollectionAt,
    now: now,
    overdueAfterInMs: VMWARE_COLLECTION_OVERDUE_AFTER_IN_MS,
  });
}

// What the card says for a vCenter no probe collects, and the one thing that fixes it.
const STOP_WORDS: Record<
  Exclude<
    VMwareCollectionStop,
    | VMwareCollectionStop.ProbeNotAllowed
    | VMwareCollectionStop.ProbeDisconnected
  >,
  { title: string; nextStep: string }
> = {
  [VMwareCollectionStop.NoPassword]: {
    title: translationKey("No password is saved for this vCenter."),
    nextStep: translationKey(
      "Enter the vCenter user's password in Settings, and test the connection.",
    ),
  },
  [VMwareCollectionStop.NoAddress]: {
    title: translationKey("This vCenter has no address."),
    nextStep: translationKey(
      "Enter vCenter's address in Settings, and test the connection.",
    ),
  },
  [VMwareCollectionStop.NoUserName]: {
    title: translationKey("This vCenter has no user name."),
    nextStep: translationKey(
      "Enter the vCenter user's name in Settings, and test the connection.",
    ),
  },
  [VMwareCollectionStop.NoProbe]: {
    title: translationKey("No probe is set to collect this vCenter."),
    nextStep: translationKey("Pick one of this project's probes in Settings."),
  },
};

// Why no probe collects this vCenter, in words, or null when one will.
function getVMwareStopView(
  vcenter: VMwareCollectionStopFacts & Pick<VMwareVCenter, "collectionProbe">,
  translator: Translator,
  isBillingEnabled: boolean,
): VMwareCollectionStatusView | null {
  const stop: VMwareCollectionStop | null = getVMwareCollectionStop(
    vcenter,
    isBillingEnabled,
  );

  if (!stop) {
    return null;
  }

  let title: string;
  let message: string | null = null;
  let nextStep: string;

  if (
    stop === VMwareCollectionStop.ProbeNotAllowed ||
    stop === VMwareCollectionStop.ProbeDisconnected
  ) {
    const advice: VMwareCollectionErrorAdvice =
      VMwareCollectionErrorUtil.getAdvice(
        stop === VMwareCollectionStop.ProbeNotAllowed
          ? VMwareCollectionErrorCode.ProbeNotAllowed
          : VMwareCollectionErrorCode.ProbeNotAvailable,
      );

    title = translator.translateText(advice.title) as string;
    nextStep = translator.translateText(advice.nextStep) as string;

    if (stop === VMwareCollectionStop.ProbeDisconnected) {
      message = translator.translateTemplate(
        "Nothing collects this vCenter while {{probe}} is disconnected.",
        {
          probe: vcenter.collectionProbe?.name || translatableTerm("its probe"),
        },
      );
    }
  } else {
    title = translator.translateText(STOP_WORDS[stop].title) as string;
    nextStep = translator.translateText(STOP_WORDS[stop].nextStep) as string;
  }

  return {
    tone: VMwareCollectionTone.Failing,
    label: translator.translateText("Not collecting") as string,
    title: title,
    message: message,
    nextStep: nextStep,
    certificate: null,
    /*
     * Nothing changes it but a write to the vCenter or its probe coming
     * back, which the page reads again after: no need to keep asking.
     */
    isPending: false,
  };
}

/*
 * How a probe-collected vCenter's collection stands, in words. What stops
 * the probes' claim handing it out comes first: a vCenter nothing may
 * collect is set aside, never overdue, and its last report is not what it
 * is doing now. Then a vCenter overdue: no probe has come for it, whatever
 * it last reported.
 */
export function getVMwareCollectionStatusView(
  vcenter: VMwareCollectionStopFacts &
    Pick<
      VMwareVCenter,
      | "collectionStatus"
      | "collectionErrorCode"
      | "collectionError"
      | "presentedCertificate"
      | "nextCollectionAt"
      | "collectionProbe"
    >,
  translator: Translator,
  now: Date = new Date(),
  isBillingEnabled: boolean = false,
): VMwareCollectionStatusView {
  const stopView: VMwareCollectionStatusView | null = getVMwareStopView(
    vcenter,
    translator,
    isBillingEnabled,
  );

  if (stopView) {
    return stopView;
  }

  if (
    readClaimDue<null>({
      stop: null,
      dueAt: vcenter.nextCollectionAt,
      now: now,
      overdueAfterInMs: VMWARE_COLLECTION_OVERDUE_AFTER_IN_MS,
    }).state === ClaimDueState.Overdue
  ) {
    const advice: VMwareCollectionErrorAdvice =
      VMwareCollectionErrorUtil.getAdvice(
        VMwareCollectionErrorCode.ProbeNotAvailable,
      );

    return {
      tone: VMwareCollectionTone.Failing,
      label: translator.translateText("Not collecting") as string,
      title: translator.translateText(advice.title) as string,
      message: translator.translateTemplate(
        "This vCenter was due to be collected {{time}}, and no probe has come for it.",
        { time: OneUptimeDate.fromNow(vcenter.nextCollectionAt as Date) },
      ),
      nextStep: translator.translateText(advice.nextStep) as string,
      certificate: null,
      // It says so until the probe is back, which nobody has to reload the page to see.
      isPending: true,
    };
  }

  if (vcenter.collectionStatus === VMwareCollectionStatus.Succeeded) {
    return {
      tone: VMwareCollectionTone.Collecting,
      label: translator.translateText("Collecting") as string,
      title: translator.translateText(
        "The probe is collecting this vCenter.",
      ) as string,
      message: null,
      nextStep: null,
      certificate: null,
      isPending: false,
    };
  }

  if (vcenter.collectionStatus === VMwareCollectionStatus.Failed) {
    const code: VMwareCollectionErrorCode = VMwareCollectionErrorUtil.isValid(
      vcenter.collectionErrorCode,
    )
      ? vcenter.collectionErrorCode
      : VMwareCollectionErrorCode.Internal;
    const advice: VMwareCollectionErrorAdvice =
      VMwareCollectionErrorUtil.getAdvice(code);

    return {
      tone: VMwareCollectionTone.Failing,
      label: translator.translateText("Not collecting") as string,
      title: translator.translateText(advice.title) as string,
      message: vcenter.collectionError || null,
      nextStep: translator.translateText(advice.nextStep) as string,
      certificate:
        VMwareCollectionErrorUtil.isCertificateTrustProblem(code) &&
        vcenter.presentedCertificate?.fingerprint256
          ? vcenter.presentedCertificate
          : null,
      isPending: false,
    };
  }

  return {
    tone: VMwareCollectionTone.Checking,
    label: translator.translateText("Checking") as string,
    title: translator.translateText(
      "The probe collects this vCenter with its new settings within a minute.",
    ) as string,
    message: null,
    nextStep: null,
    certificate: null,
    isPending: true,
  };
}

/*
 * What "Test connection" tries: the form's address, account, probe and
 * certificate. An empty password tests a saved vCenter's own
 * (vmwareVCenterId), under the rule its saves are held to.
 */
export interface VMwareConnectionTestInput {
  vcenterUrl: string;
  vcenterUsername: string;
  // Empty: the vCenter's saved password (vmwareVCenterId).
  vcenterPassword: string;
  probeId: string;
  trustedCertificateFingerprint: string;
  vmwareVCenterId?: ObjectID | undefined;
}

// Why the form cannot be tested yet, or null when it can.
export function getVMwareConnectionTestBlocker(
  input: VMwareConnectionTestInput,
): string | null {
  if (
    !input.vcenterUrl.trim() ||
    !input.vcenterUsername.trim() ||
    !input.probeId ||
    (!input.vcenterPassword && !input.vmwareVCenterId)
  ) {
    return translationKey(
      "Enter the address, user name, password and probe first.",
    );
  }

  return null;
}

function readString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

// The probe a form value names, however the dropdown handed it in.
function readProbeId(values: FormValues<VMwareVCenter>): string {
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

// What a test of the form as it stands now would try.
export function getVMwareConnectionTestInput(
  values: FormValues<VMwareVCenter>,
  vmwareVCenterId?: ObjectID | undefined,
): VMwareConnectionTestInput {
  const record: Record<string, unknown> = values as Record<string, unknown>;

  return {
    vcenterUrl: readString(record["vcenterUrl"]),
    vcenterUsername: readString(record["vcenterUsername"]),
    vcenterPassword: readString(record["vcenterPassword"]),
    probeId: readProbeId(values),
    trustedCertificateFingerprint: readString(
      record["trustedCertificateFingerprint"],
    ),
    vmwareVCenterId: vmwareVCenterId,
  };
}

/*
 * The address as the server will read it, refused with the sentence the
 * server would answer with.
 */
export function validateVCenterAddress(value: unknown): string | null {
  const result: VCenterAddressResult = VMwareVCenterAddress.normalize(
    readString(value),
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
