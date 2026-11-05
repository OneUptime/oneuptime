import { JSONObject } from "../../Types/JSON";
import OpenStackCollectionMethod from "../../Types/OpenStack/OpenStackCollectionMethod";
import {
  DEFAULT_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB,
  MAX_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB,
  OpenStackLifecycleCheckOptions,
  getOpenStackApiIntervalRefusal,
  getOpenStackLifecycleIntervalRefusal,
} from "../../Types/OpenStack/OpenStackCheck";
import {
  DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  OpenStackCredential,
  OpenStackEndpointInterface,
} from "../../Types/OpenStack/OpenStackProbeCollection";
import VMwareCertificateFingerprint from "../VMware/VMwareCertificateFingerprint";
import OpenStackAuthUrl, { OpenStackAddressResult } from "./OpenStackAuthUrl";
import OpenStackCollectionSettings, {
  MAX_OPENSTACK_CREDENTIAL_FIELD_LENGTH,
  MAX_OPENSTACK_REGIONS,
  MAX_OPENSTACK_REGION_NAME_LENGTH,
  MAX_OPENSTACK_SECRET_LENGTH,
  MAX_OPENSTACK_TRUSTED_CERTIFICATES,
  OpenStackCredentialBinding,
} from "./OpenStackCollectionSettings";

/*
 * THE RULES OF A CLOUD'S CHECKS, in one pure place so the save hook and the claim apply the same
 * ones. They are the cloud's own connection rules (OpenStackCloudConnection), for the same reason:
 * a credential here is write-only and is only ever sent where it was entered for.
 *
 * What the lifecycle check may write with is decided again by the probe before every run
 * (OpenStackCheckGuard). What is refused here is what a person can be told while they are still
 * looking at the form.
 */

// The longest name of a flavor, image, network or volume type a person can give.
const MAX_OPTION_LENGTH: number = 255;

// What a cloud has of its own that a check's connection can use.
export interface OpenStackCheckCloudFacts {
  collectionMethod?: OpenStackCollectionMethod | undefined;
  authUrl?: string | undefined;
  endpointInterface?: string | undefined;
  collectionRegions?: Array<string> | undefined;
  trustedCertificateFingerprints?: Array<string> | undefined;
  collectionProbeId?: { toString(): string } | undefined;
  isCredentialSet?: boolean | undefined;
}

// The columns of a check that decide where it runs and what with.
export interface OpenStackCheckSavedRow {
  probeId?: { toString(): string } | undefined;
  authUrl?: string | undefined;
  endpointInterface?: string | undefined;
  regions?: Array<string> | undefined;
  trustedCertificateFingerprints?: Array<string> | undefined;
  credentialKind?: string | undefined;
  applicationCredentialId?: string | undefined;
  keystoneUsername?: string | undefined;
  userDomainName?: string | undefined;
  credentialProjectName?: string | undefined;
  credentialProjectDomainName?: string | undefined;
  isCredentialSet?: boolean | undefined;
  credentialBinding?: JSONObject | undefined;
  isApiCheckEnabled?: boolean | undefined;
  isLifecycleCheckEnabled?: boolean | undefined;
  lifecycleProjectName?: string | undefined;
  lastLifecycleCheckAt?: Date | undefined;
  isSweepPending?: boolean | undefined;
  isOsProfilerKeySet?: boolean | undefined;
}

export interface OpenStackCheckConnection {
  probeId: string | null;
  authUrl: string | null;
  endpointInterface: OpenStackEndpointInterface;
  regions: Array<string>;
  trustedCertificateFingerprints: Array<string>;
  // These are the cloud's own settings, so a probe that collects it can use its credential.
  isCloudsOwn: boolean;
}

function readInterface(value: unknown): OpenStackEndpointInterface {
  return OpenStackCollectionSettings.isEndpointInterface(value)
    ? value
    : DEFAULT_OPENSTACK_ENDPOINT_INTERFACE;
}

function isProbeCollected(cloud: OpenStackCheckCloudFacts): boolean {
  return (
    cloud.collectionMethod === OpenStackCollectionMethod.Probe &&
    Boolean(cloud.authUrl)
  );
}

/*
 * Where a check connects. An address of its own wins, for a cloud the agent collects, or one
 * checked from somewhere other than where it is collected from. Otherwise the cloud's, which is
 * what makes API checks one click on a cloud a probe already collects.
 */
export function getOpenStackCheckConnection(data: {
  check: OpenStackCheckSavedRow;
  cloud: OpenStackCheckCloudFacts;
}): OpenStackCheckConnection {
  const { check, cloud } = data;
  const probeId: string | null =
    check.probeId?.toString() || cloud.collectionProbeId?.toString() || null;

  if (check.authUrl) {
    return {
      probeId: probeId,
      authUrl: check.authUrl,
      endpointInterface: readInterface(check.endpointInterface),
      regions: Array.isArray(check.regions) ? check.regions : [],
      trustedCertificateFingerprints: Array.isArray(
        check.trustedCertificateFingerprints,
      )
        ? check.trustedCertificateFingerprints
        : [],
      isCloudsOwn: false,
    };
  }

  return {
    probeId: probeId,
    authUrl: isProbeCollected(cloud) ? (cloud.authUrl as string) : null,
    endpointInterface: readInterface(cloud.endpointInterface),
    regions: Array.isArray(cloud.collectionRegions)
      ? cloud.collectionRegions
      : [],
    trustedCertificateFingerprints: Array.isArray(
      cloud.trustedCertificateFingerprints,
    )
      ? cloud.trustedCertificateFingerprints
      : [],
    isCloudsOwn: isProbeCollected(cloud),
  };
}

export function getOpenStackCheckBinding(
  connection: OpenStackCheckConnection,
): OpenStackCredentialBinding {
  return {
    endpointKey: OpenStackAuthUrl.getEndpointKey(connection.authUrl),
    probeId: connection.probeId,
    trustedCertificateFingerprints: connection.trustedCertificateFingerprints,
  };
}

// Why a saved binding does not cover where a check now connects, or null when it does.
export function getOpenStackCheckBindingRefusal(data: {
  saved: unknown;
  connection: OpenStackCheckConnection;
}): string | null {
  const saved: OpenStackCredentialBinding | null = readBinding(data.saved);

  if (!saved) {
    return "Enter the credential again: nothing says where it was entered for.";
  }

  return OpenStackCollectionSettings.getCredentialRebindRefusal({
    saved: saved,
    next: getOpenStackCheckBinding(data.connection),
  });
}

function readBinding(value: unknown): OpenStackCredentialBinding | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  return {
    endpointKey:
      typeof raw["endpointKey"] === "string" ? raw["endpointKey"] : null,
    probeId: typeof raw["probeId"] === "string" ? raw["probeId"] : null,
    trustedCertificateFingerprints: Array.isArray(
      raw["trustedCertificateFingerprints"],
    )
      ? (raw["trustedCertificateFingerprints"] as Array<string>)
      : [],
  };
}

/*
 * The credential a row holds, or null when it holds none it can use. The secret is one column for
 * either kind, because only one kind is ever saved.
 */
export function readOpenStackCheckCredential(row: {
  credentialKind?: string | undefined;
  applicationCredentialId?: string | undefined;
  keystoneUsername?: string | undefined;
  userDomainName?: string | undefined;
  credentialProjectName?: string | undefined;
  credentialProjectDomainName?: string | undefined;
  credentialSecret?: string | undefined;
}): OpenStackCredential | null {
  if (!row.credentialSecret) {
    return null;
  }

  if (row.credentialKind === "applicationCredential") {
    return row.applicationCredentialId
      ? {
          kind: "applicationCredential",
          id: row.applicationCredentialId,
          secret: row.credentialSecret,
        }
      : null;
  }

  if (
    row.credentialKind === "password" &&
    row.keystoneUsername &&
    row.credentialProjectName
  ) {
    return {
      kind: "password",
      username: row.keystoneUsername,
      password: row.credentialSecret,
      userDomainName: row.userDomainName || "Default",
      projectName: row.credentialProjectName,
      projectDomainName: row.credentialProjectDomainName || "Default",
    };
  }

  return null;
}

/*
 * What the lifecycle check was told to boot, held to what it can use: what a form left blank is
 * left out, and a size is a whole number of GiB a check has any business asking for.
 */
export function normalizeOpenStackLifecycleOptions(
  value: unknown,
): { options: OpenStackLifecycleCheckOptions } | { error: string } {
  if (value === null || value === undefined) {
    return { options: {} };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "The lifecycle check's options are not ones it can read." };
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const options: OpenStackLifecycleCheckOptions = {};

  for (const key of [
    "flavor",
    "image",
    "network",
    "floatingIpNetwork",
    "volumeType",
  ] as const) {
    const item: unknown = raw[key];

    if (item === null || item === undefined) {
      continue;
    }

    if (typeof item !== "string") {
      return { error: `The lifecycle check's ${key} has to be text.` };
    }

    const trimmed: string = item.trim();

    if (trimmed.length > MAX_OPTION_LENGTH) {
      return { error: `The lifecycle check's ${key} is too long to be one.` };
    }

    if (trimmed) {
      options[key] = trimmed;
    }
  }

  if (raw["isFloatingIpEnabled"] === true) {
    options.isFloatingIpEnabled = true;
  }

  if (raw["isVolumeEnabled"] === true) {
    options.isVolumeEnabled = true;

    const size: unknown =
      raw["volumeSizeInGiB"] ?? DEFAULT_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB;

    if (
      typeof size !== "number" ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > MAX_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB
    ) {
      return {
        error: `The lifecycle check's volume is 1 to ${MAX_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB} GiB, in whole GiB.`,
      };
    }

    options.volumeSizeInGiB = size;
  }

  return { options: options };
}

// What a check's writes leave for the server to write, as OneUptime, after the save.
export interface OpenStackCheckServerColumns {
  [column: string]: unknown;
}

export type OpenStackCheckWriteDecision =
  | { error: string }
  | {
      serverColumns: OpenStackCheckServerColumns;
      // What a feed line says of this write. Empty when nobody would want to know.
      changes: Array<string>;
      // The check's settings changed, so an older report no longer speaks for it.
      isSettingsChanged: boolean;
    };

// The columns a person writes to change what a check does: any other write is nothing to decide.
export const OPENSTACK_CHECK_SETTING_COLUMNS: ReadonlyArray<string> = [
  "probeId",
  "probe",
  "authUrl",
  "endpointInterface",
  "regions",
  "trustedCertificateFingerprints",
  "credentialKind",
  "applicationCredentialId",
  "keystoneUsername",
  "userDomainName",
  "credentialProjectName",
  "credentialProjectDomainName",
  "credentialSecret",
  "isApiCheckEnabled",
  "apiCheckIntervalInMinutes",
  "isLifecycleCheckEnabled",
  "lifecycleCheckIntervalInMinutes",
  "lifecycleProjectName",
  "lifecycleCheckOptions",
  "lifecycleRunRequestedAt",
  "osProfilerKey",
];

const CREDENTIAL_NAME_COLUMNS: ReadonlyArray<string> = [
  "applicationCredentialId",
  "keystoneUsername",
  "userDomainName",
  "credentialProjectName",
  "credentialProjectDomainName",
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * Checks one write of a check against the row it changes and the cloud it is of, normalizes it in
 * place, and says what the server writes itself once it is saved.
 */
export function prepareOpenStackCheckWrite(data: {
  // What is being written. Changed in place: this is what is saved.
  values: Record<string, unknown>;
  saved: OpenStackCheckSavedRow | null;
  cloud: OpenStackCheckCloudFacts;
  now: Date;
}): OpenStackCheckWriteDecision {
  const { values, saved, cloud, now } = data;
  const changes: Array<string> = [];

  if (values["authUrl"] !== undefined) {
    const address: string = text(values["authUrl"]);

    if (address) {
      const normalized: OpenStackAddressResult =
        OpenStackAuthUrl.normalize(address);

      if (!normalized.address) {
        return { error: normalized.error };
      }

      values["authUrl"] = normalized.address.url;
    } else {
      values["authUrl"] = null;
    }
  }

  if (
    values["endpointInterface"] !== undefined &&
    values["endpointInterface"] !== null &&
    !OpenStackCollectionSettings.isEndpointInterface(
      values["endpointInterface"],
    )
  ) {
    return { error: "Check the public, internal or admin endpoints." };
  }

  if (values["regions"] !== undefined && values["regions"] !== null) {
    const regions: unknown = values["regions"];

    if (
      !Array.isArray(regions) ||
      regions.length > MAX_OPENSTACK_REGIONS ||
      regions.some((region: unknown): boolean => {
        return (
          typeof region !== "string" ||
          !region.trim() ||
          region.length > MAX_OPENSTACK_REGION_NAME_LENGTH
        );
      })
    ) {
      return { error: "Regions are a list of the catalog's region names." };
    }

    values["regions"] = (regions as Array<string>).map(
      (region: string): string => {
        return region.trim();
      },
    );
  }

  if (
    values["trustedCertificateFingerprints"] !== undefined &&
    values["trustedCertificateFingerprints"] !== null
  ) {
    const fingerprints: unknown = values["trustedCertificateFingerprints"];

    if (
      !Array.isArray(fingerprints) ||
      fingerprints.length > MAX_OPENSTACK_TRUSTED_CERTIFICATES
    ) {
      return { error: "Trusted certificates are a list of fingerprints." };
    }

    const normalized: Array<string> = [];

    for (const item of fingerprints) {
      const fingerprint: string | null = VMwareCertificateFingerprint.normalize(
        typeof item === "string" ? item : null,
      );

      if (!fingerprint) {
        return { error: "That is not a certificate's SHA-256 fingerprint." };
      }

      if (!normalized.includes(fingerprint)) {
        normalized.push(fingerprint);
      }
    }

    values["trustedCertificateFingerprints"] = normalized;
  }

  if (values["apiCheckIntervalInMinutes"] !== undefined) {
    const refusal: string | null = getOpenStackApiIntervalRefusal(
      values["apiCheckIntervalInMinutes"],
    );

    if (refusal) {
      return { error: refusal };
    }
  }

  if (values["lifecycleCheckIntervalInMinutes"] !== undefined) {
    const refusal: string | null = getOpenStackLifecycleIntervalRefusal(
      values["lifecycleCheckIntervalInMinutes"],
    );

    if (refusal) {
      return { error: refusal };
    }
  }

  if (values["lifecycleCheckOptions"] !== undefined) {
    const normalized:
      | { options: OpenStackLifecycleCheckOptions }
      | { error: string } = normalizeOpenStackLifecycleOptions(
      values["lifecycleCheckOptions"],
    );

    if ("error" in normalized) {
      return { error: normalized.error };
    }

    values["lifecycleCheckOptions"] = normalized.options;
  }

  if (values["lifecycleProjectName"] !== undefined) {
    const name: string = text(values["lifecycleProjectName"]);

    if (name.length > MAX_OPENSTACK_CREDENTIAL_FIELD_LENGTH) {
      return { error: "That project's name is too long to be one." };
    }

    if (["admin", "service"].includes(name.toLowerCase())) {
      return {
        error: `Project ${name} is the cloud's own. The lifecycle check only runs in a project it has to itself: create one with its own quota.`,
      };
    }

    values["lifecycleProjectName"] = name || null;
  }

  /*
   * An empty secret in an update is "keep the saved one", because the form sends its empty field,
   * and never "clear it".
   */
  const secret: unknown = values["credentialSecret"];
  const isSecretGiven: boolean =
    typeof secret === "string" && secret.length > 0;

  if (!isSecretGiven) {
    delete values["credentialSecret"];
  }

  const merged: OpenStackCheckSavedRow = {
    ...(saved || {}),
    ...(values as OpenStackCheckSavedRow),
  };

  const serverColumns: OpenStackCheckServerColumns = {};

  if (isSecretGiven) {
    const read: ReturnType<
      typeof OpenStackCollectionSettings.readCredentialColumns
    > = OpenStackCollectionSettings.readCredentialColumns({
      written: {
        applicationCredentialId: values["applicationCredentialId"],
        keystoneUsername: values["keystoneUsername"],
        userDomainName: values["userDomainName"],
        projectName: values["credentialProjectName"],
        projectDomainName: values["credentialProjectDomainName"],
      },
      saved: saved
        ? {
            credentialKind: saved.credentialKind,
            applicationCredentialId: saved.applicationCredentialId,
            keystoneUsername: saved.keystoneUsername,
            userDomainName: saved.userDomainName,
            projectName: saved.credentialProjectName,
            projectDomainName: saved.credentialProjectDomainName,
          }
        : undefined,
      secret: secret as string,
    });

    if (read.error !== undefined) {
      return { error: read.error };
    }

    const credential: OpenStackCredential = read.credential;

    if (
      credential.kind === "password"
        ? credential.password.length > MAX_OPENSTACK_SECRET_LENGTH
        : credential.secret.length > MAX_OPENSTACK_SECRET_LENGTH
    ) {
      return { error: "That secret is too long to be one." };
    }

    values["credentialKind"] = credential.kind;

    if (credential.kind === "applicationCredential") {
      values["applicationCredentialId"] = credential.id;
      values["keystoneUsername"] = null;
      values["userDomainName"] = null;
      values["credentialProjectName"] = null;
      values["credentialProjectDomainName"] = null;
    } else {
      values["applicationCredentialId"] = null;
      values["keystoneUsername"] = credential.username;
      values["userDomainName"] = credential.userDomainName;
      values["credentialProjectName"] = credential.projectName;
      values["credentialProjectDomainName"] = credential.projectDomainName;
    }

    merged.credentialKind = credential.kind;
    merged.isCredentialSet = true;

    serverColumns["isCredentialSet"] = true;
    serverColumns["credentialsUpdatedAt"] = now;
    // A new credential can be for another project, and that has to be verified again.
    serverColumns["pinnedLifecycleProjectId"] = null;
    changes.push("the credential was changed");
  } else {
    const isNameChanged: boolean = CREDENTIAL_NAME_COLUMNS.some(
      (column: string): boolean => {
        return (
          values[column] !== undefined &&
          text(values[column]) !==
            text((saved as Record<string, unknown> | null)?.[column])
        );
      },
    );

    if (isNameChanged) {
      return {
        error:
          "Enter the credential's secret again: a saved one only goes with the credential it was entered for.",
      };
    }
  }

  const connection: OpenStackCheckConnection = getOpenStackCheckConnection({
    check: merged,
    cloud: cloud,
  });

  const isSecretSaved: boolean = Boolean(merged.isCredentialSet);

  if (isSecretGiven) {
    serverColumns["credentialBinding"] = getOpenStackCheckBinding(connection);
  } else if (saved?.isCredentialSet) {
    const refusal: string | null = getOpenStackCheckBindingRefusal({
      saved: saved.credentialBinding,
      connection: connection,
    });

    if (refusal) {
      return { error: refusal };
    }
  }

  // A check's own address needs its own credential, because the cloud's is not sent elsewhere.
  if (values["isLifecycleCheckEnabled"] === true) {
    values["isApiCheckEnabled"] = true;
    merged.isApiCheckEnabled = true;
  }

  // The API checks are what carries the lifecycle check's series: see OpenStackCheckMetrics.
  if (values["isApiCheckEnabled"] === false && merged.isLifecycleCheckEnabled) {
    values["isLifecycleCheckEnabled"] = false;
    merged.isLifecycleCheckEnabled = false;
  }

  const wasApiOn: boolean = saved?.isApiCheckEnabled === true;
  const wasLifecycleOn: boolean = saved?.isLifecycleCheckEnabled === true;
  const isApiOn: boolean = merged.isApiCheckEnabled === true;
  const isLifecycleOn: boolean = merged.isLifecycleCheckEnabled === true;

  if (isApiOn) {
    if (!connection.authUrl) {
      return {
        error:
          "Give these checks Keystone's address and a credential: this cloud's agent has them, and no probe does.",
      };
    }

    if (!connection.probeId) {
      return {
        error:
          "Pick a probe to run these checks, outside the cloud. A check inside a failed cloud says nothing.",
      };
    }

    if (!isSecretSaved && !(connection.isCloudsOwn && cloud.isCredentialSet)) {
      return {
        error:
          "Give these checks a credential: this cloud has no saved one a probe can use.",
      };
    }
  }

  if (isLifecycleOn) {
    if (!isSecretSaved) {
      return {
        error:
          "Give the lifecycle check a credential of its own, on a project it has to itself. It writes, so it never uses the one that collects this cloud.",
      };
    }

    if (!merged.lifecycleProjectName) {
      return {
        error:
          "Say which project the lifecycle check has to itself. A credential on any other is refused before anything is written.",
      };
    }
  }

  if (
    values["lifecycleProjectName"] !== undefined &&
    values["lifecycleProjectName"] !== (saved?.lifecycleProjectName || null)
  ) {
    serverColumns["pinnedLifecycleProjectId"] = null;
  }

  if (isApiOn && !wasApiOn) {
    serverColumns["nextApiCheckAt"] = now;
    changes.push("API checks were turned on");
  }

  if (!isApiOn && wasApiOn) {
    changes.push("API checks were turned off");
  }

  if (isLifecycleOn && !wasLifecycleOn) {
    serverColumns["nextLifecycleCheckAt"] = now;
    serverColumns["isSweepPending"] = false;
    changes.push("the lifecycle check was turned on");
  }

  if (!isLifecycleOn && wasLifecycleOn) {
    changes.push("the lifecycle check was turned off");
  }

  /*
   * Turned off with runs behind it: anything a dead run left is still there, and only this check's
   * credential can reach it, so that is kept until a sweep finds nothing named for the check.
   */
  const isSweepPending: boolean =
    !isLifecycleOn &&
    (saved?.isSweepPending === true ||
      (wasLifecycleOn && Boolean(saved?.lastLifecycleCheckAt)));

  if (!isLifecycleOn && wasLifecycleOn && isSweepPending) {
    serverColumns["isSweepPending"] = true;
    serverColumns["nextLifecycleCheckAt"] = now;
  }

  // A run someone asked for runs next, if it can run at all.
  if (values["lifecycleRunRequestedAt"] !== undefined) {
    if (!isLifecycleOn) {
      return { error: "Turn the lifecycle check on to run it." };
    }

    values["lifecycleRunRequestedAt"] = now;
    serverColumns["nextLifecycleCheckAt"] = now;
  }

  const key: unknown = values["osProfilerKey"];

  if (key === null) {
    serverColumns["isOsProfilerKeySet"] = false;
    changes.push("the OSProfiler key was removed");
  } else if (typeof key === "string" && key.trim()) {
    if (key.length > MAX_OPENSTACK_SECRET_LENGTH) {
      return { error: "That key is too long to be one." };
    }

    serverColumns["isOsProfilerKeySet"] = true;
    changes.push("the OSProfiler key was changed");
  } else {
    delete values["osProfilerKey"];
  }

  /*
   * With no check left that needs it, a secret is only something to lose. Asked for again if
   * anyone turns one back on.
   */
  if (!isApiOn && !isLifecycleOn && !isSweepPending && isSecretSaved) {
    values["credentialSecret"] = null;
    values["osProfilerKey"] = null;
    serverColumns["isCredentialSet"] = false;
    serverColumns["isOsProfilerKeySet"] = false;
    serverColumns["credentialBinding"] = null;
    serverColumns["pinnedLifecycleProjectId"] = null;
  }

  const isSettingsChanged: boolean = OPENSTACK_CHECK_SETTING_COLUMNS.some(
    (column: string): boolean => {
      return (
        column !== "lifecycleRunRequestedAt" && values[column] !== undefined
      );
    },
  );

  serverColumns["checkError"] = null;

  return {
    serverColumns: serverColumns,
    changes: changes,
    isSettingsChanged: isSettingsChanged,
  };
}
