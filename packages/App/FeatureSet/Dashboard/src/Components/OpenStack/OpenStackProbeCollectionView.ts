import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudConnectionTest from "Common/Models/DatabaseModels/OpenStackCloudConnectionTest";
import Probe from "Common/Models/DatabaseModels/Probe";
import ObjectID from "Common/Types/ObjectID";
import OpenStackCollectionErrorCode, {
  OpenStackCollectionErrorAdvice,
  OpenStackCollectionErrorUtil,
} from "Common/Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod from "Common/Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus from "Common/Types/OpenStack/OpenStackCollectionStatus";
import OpenStackConnectionTestStatus from "Common/Types/OpenStack/OpenStackConnectionTestStatus";
import {
  DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  OpenStackAccessLevel,
  OpenStackAccessRead,
  OpenStackCollectionOptions,
  OpenStackCollectionSummary,
  OpenStackCredentialKind,
  OpenStackEndpointInterface,
  OpenStackPresentedCertificate,
  OpenStackReadAccess,
  OpenStackServiceOutcome,
  OpenStackServiceSummary,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import {
  OPENSTACK_SERVICE_TITLES,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  Translator,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import OpenStackAuthUrl, {
  OpenStackAddressResult,
} from "Common/Utils/OpenStack/OpenStackAuthUrl";
import OpenStackCollectionSettings from "Common/Utils/OpenStack/OpenStackCollectionSettings";

/*
 * What the Dashboard says about a cloud a probe collects: which probes may collect it,
 * where a connection test stands, how the last collection went and what to do about it, as
 * plain values free of React, so the pages and the tests read the same answers.
 *
 * Every sentence is looked up whole, in the reader's language, through the translator the
 * caller hands in. What a probe reports in words (its error messages, its warnings, what
 * each read rests on) is shown as it wrote it.
 */

// How often a page asks again while a test or a first collection is pending.
export const OPENSTACK_TEST_POLL_INTERVAL_IN_MS: number = 2000;
export const OPENSTACK_STATUS_POLL_INTERVAL_IN_MS: number = 10000;

/*
 * How long the Dashboard waits for a test before it stops asking: the server answers an
 * abandoned test within its pickup and run timeouts (90 s + 180 s), so this is only reached
 * when the server stopped answering too.
 */
export const OPENSTACK_TEST_MAX_WAIT_IN_MS: number = 5 * 60 * 1000;

export interface OpenStackProbeOption {
  label: string;
  value: string;
}

/*
 * The probes a cloud may be collected through: the project's own and, on a self-hosted
 * instance (billing off), the instance's global probes, which are its operator's own. On
 * OneUptime Cloud a global probe is shared by every sign-up and never receives a credential,
 * so it is not offered. The server holds to the same rule (OpenStackCollectionSettings).
 */
export function getOpenStackCollectionProbes(
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

export function getOpenStackCollectionProbeOptions(
  probes: Array<Probe>,
  isBillingEnabled: boolean,
  translator: Translator,
): Array<OpenStackProbeOption> {
  return getOpenStackCollectionProbes(probes, isBillingEnabled).map(
    (probe: Probe): OpenStackProbeOption => {
      const name: string =
        probe.name ||
        translator.translateTemplate("Probe {{id}}", {
          id: String(probe._id),
        });

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

/*
 * The probe a new cloud starts on: the only one it may use, when there is exactly one. With
 * two there is no "the" probe, and with none the person adds one first.
 */
export function getDefaultOpenStackCollectionProbeId(
  probes: Array<Probe>,
  isBillingEnabled: boolean,
): string {
  const eligible: Array<Probe> = getOpenStackCollectionProbes(
    probes,
    isBillingEnabled,
  );

  return eligible.length === 1 ? String(eligible[0]!._id) : "";
}

// Whether a cloud's data comes from a probe that reads its APIs.
export function isOpenStackProbeCollected(
  cloud: Pick<OpenStackCloud, "collectionMethod"> | null | undefined,
): boolean {
  return cloud?.collectionMethod === OpenStackCollectionMethod.Probe;
}

/*
 * ---------------------------------------------------------------------------
 * What a connection test found
 * ---------------------------------------------------------------------------
 */

// The levels the docs give, each in the words they use.
const ACCESS_LEVEL_TITLES: Record<OpenStackAccessLevel, string> = {
  FullView: translationKey(
    "Connected. This credential has the Full view: it reads everything monitoring needs.",
  ),
  InfrastructureOnly: translationKey(
    "Connected. This credential is Infrastructure only: hypervisors, services and every project's instances, with volumes and networks only where its role is assigned.",
  ),
  ProjectView: translationKey(
    "Connected. This credential has the Project view: its own project's instances, volumes and networks, and no infrastructure.",
  ),
  Other: translationKey(
    "Connected. This credential reads part of what monitoring needs. The list below says what it does not.",
  ),
};

const READ_ACCESS_LABELS: Record<OpenStackReadAccess, string> = {
  ReadsEverything: translationKey("Reads everything"),
  OwnProjectOnly: translationKey("Own project only"),
  Refused: translationKey("Refused"),
  NotDeployed: translationKey("Not deployed"),
  Failing: translationKey("Failing"),
};

export enum OpenStackConnectionTestPhase {
  Waiting = "Waiting",
  Running = "Running",
  Succeeded = "Succeeded",
  Failed = "Failed",
}

// One read that did not answer in full, as the test panel lists it.
export interface OpenStackTestReadRow {
  key: string;
  access: OpenStackReadAccess;
  // "Own project only", in the reader's language.
  label: string;
  // "Networking (Neutron), RegionOne: networks".
  title: string;
  // What it rests on, as the probe wrote it: "HTTP 403".
  reason: string | null;
  goesWithout: string | null;
  fix: string | null;
}

export interface OpenStackConnectionTestView {
  phase: OpenStackConnectionTestPhase;
  title: string;
  message: string | null;
  nextStep: string | null;
  // Every region the catalog names, whichever were asked about.
  regionsInCatalog: Array<string>;
  // What the credential logs in as, when the probe got that far.
  credentialLine: string | null;
  // How many reads answered in full, and the ones that did not.
  fullReadCount: number;
  reads: Array<OpenStackTestReadRow>;
  warnings: Array<string>;
  // The API's certificate, when trusting it fixes the test.
  certificate: OpenStackPresentedCertificate | null;
}

function getServiceTitle(service: OpenStackServiceType | string): string {
  return OPENSTACK_SERVICE_TITLES[service as OpenStackServiceType] || service;
}

function getCredentialLine(
  summary: OpenStackCloudConnectionTest["summary"],
  translator: Translator,
): string | null {
  if (!summary) {
    return null;
  }

  const roles: string = (summary.roleNames || []).join(", ");

  if (summary.projectName && roles) {
    return translator.translateTemplate(
      "Logged in to project {{project}} with the roles {{roles}}.",
      { project: summary.projectName, roles: roles },
    );
  }

  if (summary.projectName) {
    return translator.translateTemplate("Logged in to project {{project}}.", {
      project: summary.projectName,
    });
  }

  return null;
}

/*
 * The reads a person has to know about, most of a problem first: what is refused or failing,
 * then what only reaches its own project, then what the cloud does not run.
 */
function getReadRows(
  reads: Array<OpenStackAccessRead>,
  translator: Translator,
): Array<OpenStackTestReadRow> {
  const rank: Record<OpenStackReadAccess, number> = {
    Failing: 0,
    Refused: 1,
    OwnProjectOnly: 2,
    NotDeployed: 3,
    ReadsEverything: 4,
  };

  return reads
    .filter((read: OpenStackAccessRead): boolean => {
      return read.access !== "ReadsEverything";
    })
    .map((read: OpenStackAccessRead, index: number) => {
      return { read: read, index: index };
    })
    .sort(
      (
        left: { read: OpenStackAccessRead; index: number },
        right: { read: OpenStackAccessRead; index: number },
      ): number => {
        return (
          rank[left.read.access] - rank[right.read.access] ||
          left.index - right.index
        );
      },
    )
    .map((entry: { read: OpenStackAccessRead }): OpenStackTestReadRow => {
      const read: OpenStackAccessRead = entry.read;

      return {
        key: `${read.regionName}/${read.service}/${read.read}`,
        access: read.access,
        label: translator.translateText(READ_ACCESS_LABELS[read.access]) as string,
        title: translator.translateTemplate("{{service}}, {{region}}: {{read}}", {
          service: getServiceTitle(read.service),
          region: read.regionName,
          read: read.read,
        }),
        reason: read.reason || null,
        goesWithout: read.goesWithout || null,
        fix: read.fix || null,
      };
    });
}

// Where a connection test stands, in words.
export function getOpenStackConnectionTestView(
  test: Pick<
    OpenStackCloudConnectionTest,
    "status" | "errorCode" | "errorMessage" | "presentedCertificate" | "summary"
  >,
  translator: Translator,
): OpenStackConnectionTestView {
  const summary: OpenStackCloudConnectionTest["summary"] = test.summary;
  const reads: Array<OpenStackAccessRead> = summary?.reads || [];

  const found: Pick<
    OpenStackConnectionTestView,
    | "regionsInCatalog"
    | "credentialLine"
    | "fullReadCount"
    | "reads"
    | "warnings"
  > = {
    regionsInCatalog: summary?.regionsInCatalog || [],
    credentialLine: getCredentialLine(summary, translator),
    fullReadCount: reads.filter((read: OpenStackAccessRead): boolean => {
      return read.access === "ReadsEverything";
    }).length,
    reads: getReadRows(reads, translator),
    warnings: summary?.warnings || [],
  };

  switch (test.status) {
    case OpenStackConnectionTestStatus.Running:
      return {
        phase: OpenStackConnectionTestPhase.Running,
        title: translator.translateText(
          "The probe is connecting to the cloud…",
        ) as string,
        message: null,
        nextStep: null,
        certificate: null,
        ...found,
      };
    case OpenStackConnectionTestStatus.Succeeded:
      return {
        phase: OpenStackConnectionTestPhase.Succeeded,
        title: translator.translateText(
          ACCESS_LEVEL_TITLES[summary?.accessLevel || "Other"],
        ) as string,
        message: null,
        nextStep: null,
        certificate: null,
        ...found,
      };
    case OpenStackConnectionTestStatus.Failed: {
      const code: OpenStackCollectionErrorCode =
        OpenStackCollectionErrorUtil.isValid(test.errorCode)
          ? test.errorCode
          : OpenStackCollectionErrorCode.Internal;
      const advice: OpenStackCollectionErrorAdvice =
        OpenStackCollectionErrorUtil.getAdvice(code);

      return {
        phase: OpenStackConnectionTestPhase.Failed,
        title: translator.translateText(advice.title) as string,
        message: test.errorMessage || null,
        nextStep: translator.translateText(advice.nextStep) as string,
        certificate:
          OpenStackCollectionErrorUtil.isCertificateTrustProblem(code) &&
          test.presentedCertificate?.fingerprint256
            ? test.presentedCertificate
            : null,
        ...found,
      };
    }
    default:
      return {
        phase: OpenStackConnectionTestPhase.Waiting,
        title: translator.translateText(
          "Waiting for the probe to pick the test up…",
        ) as string,
        message: null,
        nextStep: null,
        certificate: null,
        ...found,
      };
  }
}

export function isOpenStackConnectionTestSettled(
  status: OpenStackConnectionTestStatus | null | undefined,
): boolean {
  return (
    status === OpenStackConnectionTestStatus.Succeeded ||
    status === OpenStackConnectionTestStatus.Failed
  );
}

/*
 * ---------------------------------------------------------------------------
 * How the last collection went
 * ---------------------------------------------------------------------------
 */

export enum OpenStackCollectionTone {
  Checking = "Checking",
  Collecting = "Collecting",
  Partial = "Partial",
  Failing = "Failing",
}

export interface OpenStackCollectionStatusView {
  tone: OpenStackCollectionTone;
  // The badge: "Checking", "Collecting", "Partly collecting", "Not collecting".
  label: string;
  title: string;
  message: string | null;
  nextStep: string | null;
  certificate: OpenStackPresentedCertificate | null;
  // Whether the page should ask again soon.
  isPending: boolean;
}

// How a probe-collected cloud's collection stands, in words.
export function getOpenStackCollectionStatusView(
  cloud: Pick<
    OpenStackCloud,
    | "collectionStatus"
    | "collectionErrorCode"
    | "collectionError"
    | "presentedCertificate"
  >,
  translator: Translator,
): OpenStackCollectionStatusView {
  if (cloud.collectionStatus === OpenStackCollectionStatus.Succeeded) {
    return {
      tone: OpenStackCollectionTone.Collecting,
      label: translator.translateText("Collecting") as string,
      title: translator.translateText(
        "The probe is collecting this cloud.",
      ) as string,
      message: null,
      nextStep: null,
      certificate: null,
      isPending: false,
    };
  }

  if (
    cloud.collectionStatus === OpenStackCollectionStatus.Failed ||
    cloud.collectionStatus === OpenStackCollectionStatus.PartiallySucceeded
  ) {
    const isPartial: boolean =
      cloud.collectionStatus === OpenStackCollectionStatus.PartiallySucceeded;
    const code: OpenStackCollectionErrorCode =
      OpenStackCollectionErrorUtil.isValid(cloud.collectionErrorCode)
        ? cloud.collectionErrorCode
        : OpenStackCollectionErrorCode.Internal;
    const advice: OpenStackCollectionErrorAdvice =
      OpenStackCollectionErrorUtil.getAdvice(code);

    return {
      tone: isPartial
        ? OpenStackCollectionTone.Partial
        : OpenStackCollectionTone.Failing,
      label: translator.translateText(
        isPartial ? "Partly collecting" : "Not collecting",
      ) as string,
      title: translator.translateText(advice.title) as string,
      message: cloud.collectionError || null,
      nextStep: translator.translateText(advice.nextStep) as string,
      certificate:
        OpenStackCollectionErrorUtil.isCertificateTrustProblem(code) &&
        cloud.presentedCertificate?.fingerprint256
          ? cloud.presentedCertificate
          : null,
      isPending: false,
    };
  }

  return {
    tone: OpenStackCollectionTone.Checking,
    label: translator.translateText("Checking") as string,
    title: translator.translateText(
      "The probe collects this cloud with its new settings within a minute.",
    ) as string,
    message: null,
    nextStep: null,
    certificate: null,
    isPending: true,
  };
}

const SERVICE_OUTCOME_LABELS: Record<OpenStackServiceOutcome, string> = {
  Succeeded: translationKey("Read"),
  Partial: translationKey("Read in part"),
  Failed: translationKey("Failed"),
  Refused: translationKey("Refused"),
  NotDeployed: translationKey("Not deployed"),
  BackingOff: translationKey("Backing off"),
  NotDue: translationKey("Not due"),
};

export interface OpenStackServiceRow {
  key: string;
  outcome: OpenStackServiceOutcome;
  // "Backing off", in the reader's language.
  label: string;
  // "Networking (Neutron), RegionOne".
  title: string;
  message: string | null;
}

/*
 * The services that went without in the last collection, each with why: what the card names
 * when some were read and another was not. One the cloud does not run, or one not due yet,
 * is nothing to say.
 */
export function getOpenStackServiceRows(
  summary: OpenStackCollectionSummary | null | undefined,
  translator: Translator,
): Array<OpenStackServiceRow> {
  return (summary?.services || [])
    .filter((service: OpenStackServiceSummary): boolean => {
      return (
        service.outcome === "Partial" ||
        service.outcome === "Failed" ||
        service.outcome === "Refused" ||
        service.outcome === "BackingOff"
      );
    })
    .map((service: OpenStackServiceSummary): OpenStackServiceRow => {
      return {
        key: `${service.regionName}/${service.service}`,
        outcome: service.outcome,
        label: translator.translateText(
          SERVICE_OUTCOME_LABELS[service.outcome],
        ) as string,
        title: translator.translateTemplate("{{service}}, {{region}}", {
          service: getServiceTitle(service.service),
          region: service.regionName,
        }),
        message: service.errorMessage || null,
      };
    });
}

// What a collection read, as short phrases a person scans: "48 hypervisors".
export function getOpenStackInventoryPhrases(
  summary: OpenStackCollectionSummary | null | undefined,
  translator: Translator,
): Array<string> {
  if (!summary) {
    return [];
  }

  return [
    translator.translatePlural(
      { one: "{{count}} hypervisor", other: "{{count}} hypervisors" },
      summary.hypervisorCount,
    ),
    translator.translatePlural(
      { one: "{{count}} instance", other: "{{count}} instances" },
      summary.instanceCount,
    ),
    translator.translatePlural(
      { one: "{{count}} network", other: "{{count}} networks" },
      summary.networkCount,
    ),
    translator.translatePlural(
      { one: "{{count}} volume", other: "{{count}} volumes" },
      summary.volumeCount,
    ),
    translator.translatePlural(
      { one: "{{count}} project", other: "{{count}} projects" },
      summary.projectCount,
    ),
  ];
}

/*
 * ---------------------------------------------------------------------------
 * What the forms hold
 * ---------------------------------------------------------------------------
 */

/*
 * What "Test connection" tries: the form's address, credential, regions, probe and
 * certificates. An empty secret tests a saved cloud's own credential (openStackCloudId),
 * under the rule its saves are held to.
 */
export interface OpenStackConnectionTestInput {
  authUrl: string;
  endpointInterface: OpenStackEndpointInterface;
  // Empty: every region the catalog names.
  regions: Array<string>;
  credentialKind: OpenStackCredentialKind;
  applicationCredentialId: string;
  keystoneUsername: string;
  userDomainName: string;
  projectName: string;
  projectDomainName: string;
  // Empty: the cloud's saved credential (openStackCloudId).
  credentialSecret: string;
  probeId: string;
  trustedCertificateFingerprints: Array<string>;
  openStackCloudId?: ObjectID | undefined;
}

// Why the form cannot be tested yet, or null when it can.
export function getOpenStackConnectionTestBlocker(
  input: OpenStackConnectionTestInput,
): string | null {
  if (!input.authUrl.trim() || !input.probeId) {
    return translationKey("Enter Keystone's address and pick a probe first.");
  }

  // A secret typed here goes with what names it, on the form.
  if (input.credentialSecret) {
    const isNamed: boolean =
      input.credentialKind === "password"
        ? Boolean(input.keystoneUsername.trim() && input.projectName.trim())
        : Boolean(input.applicationCredentialId.trim());

    return isNamed
      ? null
      : translationKey(
          "Enter what the secret belongs to: the application credential's ID, or the user name and project.",
        );
  }

  return input.openStackCloudId
    ? null
    : translationKey("Enter the credential's secret first.");
}

function readString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

/*
 * The names a list field holds, however it holds them: what a person typed, with commas or
 * on lines of their own, or the array the column stores. A name's own spaces stay inside it.
 */
export function readOpenStackNames(value: unknown): Array<string> {
  const items: Array<unknown> = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : [];

  const names: Array<string> = [];

  for (const item of items) {
    const name: string = readString(item).trim();

    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

// The probe a form value names, however the dropdown handed it in.
function readProbeId(values: FormValues<OpenStackCloud>): string {
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

// Which kind of credential the form is on: what it says, or what the columns name.
export function readOpenStackCredentialKind(
  values: Record<string, unknown>,
): OpenStackCredentialKind {
  return values["credentialKind"] === "password"
    ? "password"
    : "applicationCredential";
}

/*
 * What "Collect With a Probe" starts on, over what the cloud holds. A cloud that has only ever
 * had an agent holds nothing for these, and a form's default only fills in what a record left
 * out, which a column holding nothing did not.
 */
export function getOpenStackSwitchToProbeStart(data: {
  cloud: Pick<OpenStackCloud, "credentialKind" | "collectionProbeId"> | null;
  probes: Array<Probe>;
  isBillingEnabled: boolean;
}): FormValues<OpenStackCloud> {
  const start: Record<string, unknown> = {
    credentialKind: data.cloud?.credentialKind || "applicationCredential",
  };

  const onlyProbeId: string = getDefaultOpenStackCollectionProbeId(
    data.probes,
    data.isBillingEnabled,
  );

  if (!data.cloud?.collectionProbeId && onlyProbeId) {
    start["collectionProbe"] = onlyProbeId;
  }

  return start as FormValues<OpenStackCloud>;
}

/*
 * The columns of the kind of credential the form is on, and none of the other's. A form sends
 * every field it has, hidden or not, and only one kind is ever saved: the server keeps to the
 * one the columns written name, and works out the other's clearing itself.
 */
export function keepOpenStackCredentialKind(
  item: OpenStackCloud,
): OpenStackCloud {
  if (item.credentialKind === "password") {
    delete item.applicationCredentialId;
    return item;
  }

  delete item.keystoneUsername;
  delete item.userDomainName;
  delete item.projectName;
  delete item.projectDomainName;

  return item;
}

// What a test of the form as it stands now would try.
export function getOpenStackConnectionTestInput(
  values: FormValues<OpenStackCloud>,
  openStackCloudId?: ObjectID | undefined,
): OpenStackConnectionTestInput {
  const record: Record<string, unknown> = values as Record<string, unknown>;

  return {
    authUrl: readString(record["authUrl"]),
    endpointInterface: OpenStackCollectionSettings.isEndpointInterface(
      record["endpointInterface"],
    )
      ? record["endpointInterface"]
      : DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
    regions: readOpenStackNames(record["collectionRegions"]),
    credentialKind: readOpenStackCredentialKind(record),
    applicationCredentialId: readString(record["applicationCredentialId"]),
    keystoneUsername: readString(record["keystoneUsername"]),
    userDomainName: readString(record["userDomainName"]),
    projectName: readString(record["projectName"]),
    projectDomainName: readString(record["projectDomainName"]),
    // A password field hands its value on wrapped, once the form has read it.
    credentialSecret: readString(record["credentialSecret"]),
    probeId: readProbeId(values),
    trustedCertificateFingerprints: readOpenStackNames(
      record["trustedCertificateFingerprints"],
    ),
    openStackCloudId: openStackCloudId,
  };
}

/*
 * The address as the server will read it, refused with the sentence the server would answer
 * with. That is where a person hears a plain HTTP address will not do, and what to do instead.
 */
export function validateOpenStackAuthUrl(value: unknown): string | null {
  const result: OpenStackAddressResult = OpenStackAuthUrl.normalize(
    readString(value),
  );

  return result.address ? null : translateText(result.error) || result.error;
}

export function validateOpenStackRegions(value: unknown): string | null {
  const result: ReturnType<
    typeof OpenStackCollectionSettings.normalizeRegions
  > = OpenStackCollectionSettings.normalizeRegions(readOpenStackNames(value));

  return result.regions ? null : translateText(result.error) || result.error;
}

export function validateOpenStackFingerprints(value: unknown): string | null {
  const result: ReturnType<
    typeof OpenStackCollectionSettings.normalizeFingerprints
  > = OpenStackCollectionSettings.normalizeFingerprints(
    readOpenStackNames(value),
  );

  return result.fingerprints
    ? null
    : translateText(result.error) || result.error;
}

export function validateOpenStackOptions(value: unknown): string | null {
  const result: ReturnType<
    typeof OpenStackCollectionSettings.normalizeOptions
  > = OpenStackCollectionSettings.normalizeOptions(value || {});

  return result.options ? null : translateText(result.error) || result.error;
}

/*
 * What is read beyond the defaults, as the switches show it and however far along a person is:
 * one list too long is said by validateOpenStackOptions, and it does not turn the switch off.
 */
export function readOpenStackOptions(
  value: unknown,
): OpenStackCollectionOptions {
  const raw: Record<string, unknown> =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const options: OpenStackCollectionOptions = {};

  if (raw["collectProjectLimits"] === true) {
    options.collectProjectLimits = true;
  }

  if (raw["collectPorts"] === true) {
    options.collectPorts = true;
  }

  const portNetworkIds: Array<string> = readOpenStackNames(
    raw["portNetworkIds"],
  );
  const portProjectIds: Array<string> = readOpenStackNames(
    raw["portProjectIds"],
  );

  if (portNetworkIds.length > 0) {
    options.portNetworkIds = portNetworkIds;
  }

  if (portProjectIds.length > 0) {
    options.portProjectIds = portProjectIds;
  }

  return options;
}
