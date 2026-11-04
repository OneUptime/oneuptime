import {
  OPENSTACK_ENDPOINT_INTERFACES,
  OpenStackCollectionOptions,
  OpenStackCredential,
  OpenStackEndpointInterface,
} from "../../Types/OpenStack/OpenStackProbeCollection";
import VMwareCertificateFingerprint from "../VMware/VMwareCertificateFingerprint";

/*
 * The rules a probe-collected cloud's settings are held to, in one pure place so the
 * server's save hook, the probe-ingest routes and the dashboard's form all apply the
 * same ones. They are VMware's (#4647) on purpose: a saved credential is encrypted
 * and write-only, and is only ever sent to where it was entered for.
 */

/*
 * How often a probe collects a cloud. Two minutes is the agent's own interval for
 * compute, network, volume and placement, so the alert templates and charts see the
 * same density of data whichever way a cloud is collected. Identity and image are
 * read every five, as the agent does, whatever this says.
 */
export const DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES: number = 2;
export const MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES: number = 1;
export const MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES: number = 60;

export const MAX_OPENSTACK_CREDENTIAL_FIELD_LENGTH: number = 256;
export const MAX_OPENSTACK_SECRET_LENGTH: number = 1024;

// A cloud with more regions than this has several Keystones in all but name.
export const MAX_OPENSTACK_REGIONS: number = 64;
export const MAX_OPENSTACK_REGION_NAME_LENGTH: number = 255;

// A cloud can have a host per service, and each can have a certificate of its own.
export const MAX_OPENSTACK_TRUSTED_CERTIFICATES: number = 32;

/*
 * Ports are read one list per network or project named, every collection, so this is
 * also a bound on the calls a person can ask a cloud to take.
 */
export const MAX_OPENSTACK_PORT_SCOPES: number = 64;

// What the rules need to know about a probe.
export interface OpenStackCollectionProbeFacts {
  isGlobalProbe?: boolean | null | undefined;
  projectId?: string | null | undefined;
}

/*
 * Where a saved credential may be sent: the Keystone it was entered for, through the
 * probe it was entered for, to the certificates trusted when it was entered. See
 * getCredentialRebindRefusal.
 */
export interface OpenStackCredentialBinding {
  // "host:port/path" (OpenStackAuthUrl.getEndpointKey), or null.
  endpointKey: string | null;
  probeId: string | null;
  trustedCertificateFingerprints: Array<string>;
}

// What names a credential in a cloud's columns. The secret is one column, for either kind.
export interface OpenStackCredentialColumns {
  credentialKind?: unknown;
  applicationCredentialId?: unknown;
  keystoneUsername?: unknown;
  userDomainName?: unknown;
  projectName?: unknown;
  projectDomainName?: unknown;
}

export default class OpenStackCollectionSettings {
  /*
   * Why an interval is refused, or null when it is a whole number of minutes inside
   * the bounds.
   */
  public static getIntervalRefusal(value: unknown): string | null {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES ||
      value > MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES
    ) {
      return `Collect every ${MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES} to ${MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES} minutes, in whole minutes.`;
    }

    return null;
  }

  public static isEndpointInterface(
    value: unknown,
  ): value is OpenStackEndpointInterface {
    return (
      typeof value === "string" &&
      (OPENSTACK_ENDPOINT_INTERFACES as ReadonlyArray<string>).includes(value)
    );
  }

  /*
   * Why a probe may not collect a cloud of `projectId`, or null when it may.
   *
   * A probe that collects a cloud receives its credential, so it has to be a probe
   * the project itself runs. A global probe is shared: on OneUptime Cloud (billing
   * on) every sign-up's monitors run on it, and it must never hold one customer's
   * credential, nor be pointed into the network it runs in. On a self-hosted instance
   * the global probes are the instance's own, run by the same people as everything
   * else, so there they may.
   */
  public static getProbeRefusal(data: {
    probe: OpenStackCollectionProbeFacts;
    projectId: string;
    isBillingEnabled: boolean;
  }): string | null {
    const isGlobal: boolean =
      data.probe.isGlobalProbe === true || !data.probe.projectId;

    if (isGlobal) {
      if (data.isBillingEnabled) {
        return "Pick a probe of your own. Shared probes never receive OpenStack credentials: add a probe in the cloud's network and pick it here.";
      }

      return null;
    }

    if (data.probe.projectId !== data.projectId) {
      return "This probe belongs to another project. Pick one of this project's probes.";
    }

    return null;
  }

  /*
   * Why an update that keeps the saved credential must not, or null when it may keep
   * it.
   *
   * The credential is write-only: nobody can read it back, including the people who
   * may edit the cloud. That is only true if editing cannot send it somewhere they
   * can read it. So it is bound to where it was entered for, and changing any of
   * these asks for it again:
   *
   *   - the address (host, port and path): otherwise pointing the cloud at a server
   *     of one's own would deliver it there;
   *   - the probe: otherwise a probe of one's own would be handed it;
   *   - the trusted certificates, to add one: otherwise trusting a certificate of
   *     one's own would let a machine in the middle read it.
   *
   * Trusting fewer is stricter, so it keeps the credential.
   */
  public static getCredentialRebindRefusal(data: {
    saved: OpenStackCredentialBinding;
    next: OpenStackCredentialBinding;
  }): string | null {
    if (data.saved.endpointKey !== data.next.endpointKey) {
      return "Enter the credential again: a saved credential is only sent to the Keystone it was entered for.";
    }

    if ((data.saved.probeId || null) !== (data.next.probeId || null)) {
      return "Enter the credential again: a saved credential is only sent through the probe it was entered for.";
    }

    const isSomeCertificateNew: boolean =
      data.next.trustedCertificateFingerprints.some(
        (fingerprint: string): boolean => {
          return !data.saved.trustedCertificateFingerprints.some(
            (saved: string): boolean => {
              return VMwareCertificateFingerprint.areEqual(saved, fingerprint);
            },
          );
        },
      );

    if (isSomeCertificateNew) {
      return "Enter the credential again: a saved credential is only sent to the certificates that were trusted when it was entered.";
    }

    return null;
  }

  /*
   * The credential a person typed, read as one of the two kinds, or the sentence that
   * says what is missing. Application credential first: what is given of one wins,
   * because it is the better of the two.
   */
  public static readCredential(data: {
    applicationCredentialId?: unknown;
    applicationCredentialSecret?: unknown;
    username?: unknown;
    password?: unknown;
    userDomainName?: unknown;
    projectName?: unknown;
    projectDomainName?: unknown;
  }):
    | { credential: OpenStackCredential; error?: undefined }
    | { credential?: undefined; error: string } {
    const text: (value: unknown) => string = (value: unknown): string => {
      return typeof value === "string" ? value.trim() : "";
    };

    const id: string = text(data.applicationCredentialId);
    // A secret's spaces are its own, so it is not trimmed.
    const secret: string =
      typeof data.applicationCredentialSecret === "string"
        ? data.applicationCredentialSecret
        : "";

    if (id || secret) {
      if (!id || !secret) {
        return {
          error: "An application credential needs both its ID and its secret.",
        };
      }

      if (
        id.length > MAX_OPENSTACK_CREDENTIAL_FIELD_LENGTH ||
        secret.length > MAX_OPENSTACK_SECRET_LENGTH
      ) {
        return { error: "That application credential is too long to be one." };
      }

      return {
        credential: {
          kind: "applicationCredential",
          id: id,
          secret: secret,
        },
      };
    }

    const username: string = text(data.username);
    const password: string =
      typeof data.password === "string" ? data.password : "";
    const projectName: string = text(data.projectName);

    if (!username && !password && !projectName) {
      return { error: "Enter an application credential's ID and secret." };
    }

    if (!username || !password || !projectName) {
      return {
        error: "A user name and password also need the project they log in to.",
      };
    }

    if (
      username.length > MAX_OPENSTACK_CREDENTIAL_FIELD_LENGTH ||
      projectName.length > MAX_OPENSTACK_CREDENTIAL_FIELD_LENGTH ||
      password.length > MAX_OPENSTACK_SECRET_LENGTH
    ) {
      return { error: "That user name, password or project is too long." };
    }

    return {
      credential: {
        kind: "password",
        username: username,
        password: password,
        userDomainName: text(data.userDomainName) || "Default",
        projectName: projectName,
        projectDomainName: text(data.projectDomainName) || "Default",
      },
    };
  }

  /*
   * The credential a write gives: the one secret, and the columns that name it. What the
   * write names decides which kind it is, then what is saved, so a new password for the
   * saved user is that user's, and a new secret for the saved application credential is
   * that credential's. An application credential wins when both are named: it is the
   * better of the two, and only one is ever saved.
   */
  public static readCredentialColumns(data: {
    written: OpenStackCredentialColumns;
    saved?: OpenStackCredentialColumns | undefined;
    secret: string;
  }): ReturnType<typeof OpenStackCollectionSettings.readCredential> {
    const { written, saved, secret } = data;

    const isGiven: (value: unknown) => boolean = (value: unknown): boolean => {
      return typeof value === "string" && value.trim().length > 0;
    };

    const isPassword: boolean = isGiven(written.applicationCredentialId)
      ? false
      : isGiven(written.keystoneUsername) || isGiven(written.projectName)
        ? true
        : saved?.credentialKind === "password";

    if (!isPassword) {
      return OpenStackCollectionSettings.readCredential({
        applicationCredentialId: isGiven(written.applicationCredentialId)
          ? written.applicationCredentialId
          : saved?.applicationCredentialId,
        applicationCredentialSecret: secret,
      });
    }

    const valueOf: (column: keyof OpenStackCredentialColumns) => unknown = (
      column: keyof OpenStackCredentialColumns,
    ): unknown => {
      return written[column] !== undefined ? written[column] : saved?.[column];
    };

    return OpenStackCollectionSettings.readCredential({
      username: valueOf("keystoneUsername"),
      password: secret,
      userDomainName: valueOf("userDomainName"),
      projectName: valueOf("projectName"),
      projectDomainName: valueOf("projectDomainName"),
    });
  }

  /*
   * The regions a person picked: trimmed, without repeats, bounded. A region's name
   * is the cloud's own word, so its case stays.
   */
  public static normalizeRegions(
    value: unknown,
  ): { regions: Array<string>; error?: undefined } | { error: string } {
    const items: Array<unknown> = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];

    const regions: Array<string> = [];

    for (const item of items) {
      if (typeof item !== "string") {
        return { error: "A region's name is text, such as RegionOne." };
      }

      const name: string = item.trim();

      if (!name) {
        continue;
      }

      if (name.length > MAX_OPENSTACK_REGION_NAME_LENGTH) {
        return { error: "That region's name is too long to be one." };
      }

      if (!regions.includes(name)) {
        regions.push(name);
      }
    }

    if (regions.length > MAX_OPENSTACK_REGIONS) {
      return {
        error: `One cloud can have at most ${MAX_OPENSTACK_REGIONS} regions.`,
      };
    }

    return { regions: regions };
  }

  /*
   * What is read beyond the defaults, as the two switches and the ports' scopes it can
   * be, or the sentence that says what is wrong. Anything else in it is dropped: the
   * probe is handed this as it is, so it holds what the probe knows and nothing more.
   */
  public static normalizeOptions(
    value: unknown,
  ):
    | { options: OpenStackCollectionOptions; error?: undefined }
    | { error: string } {
    if (value === null || value === undefined) {
      return { options: {} };
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      return {
        error: "The collection options are not in the form they should be.",
      };
    }

    const raw: Record<string, unknown> = value as Record<string, unknown>;
    const options: OpenStackCollectionOptions = {};

    if (raw["collectPorts"] === true) {
      options.collectPorts = true;
    }

    if (raw["collectProjectLimits"] === true) {
      options.collectProjectLimits = true;
    }

    let scopes: number = 0;

    for (const key of ["portNetworkIds", "portProjectIds"] as const) {
      const given: unknown = raw[key];

      if (given === undefined || given === null) {
        continue;
      }

      if (!Array.isArray(given)) {
        return { error: "Name ports' networks and projects by their IDs." };
      }

      const ids: Array<string> = [];

      for (const item of given) {
        if (typeof item !== "string") {
          return { error: "Name ports' networks and projects by their IDs." };
        }

        const id: string = item.trim();

        if (id.length > MAX_OPENSTACK_CREDENTIAL_FIELD_LENGTH) {
          return { error: "That network or project ID is too long to be one." };
        }

        if (id && !ids.includes(id)) {
          ids.push(id);
        }
      }

      scopes += ids.length;

      if (ids.length > 0) {
        options[key] = ids;
      }
    }

    if (scopes > MAX_OPENSTACK_PORT_SCOPES) {
      return {
        error: `Name at most ${MAX_OPENSTACK_PORT_SCOPES} networks and projects to read ports from: each is a list on every collection.`,
      };
    }

    return { options: options };
  }

  /*
   * The trusted certificates a person gave, in the canonical spelling and without
   * repeats, or the sentence that says one of them is not a fingerprint.
   */
  public static normalizeFingerprints(
    value: unknown,
  ): { fingerprints: Array<string>; error?: undefined } | { error: string } {
    if (value === null || value === undefined || value === "") {
      return { fingerprints: [] };
    }

    const items: Array<unknown> = Array.isArray(value) ? value : [value];
    const fingerprints: Array<string> = [];

    for (const item of items) {
      const fingerprint: string | null = VMwareCertificateFingerprint.normalize(
        typeof item === "string" ? item : "",
      );

      if (!fingerprint) {
        return {
          error:
            "A trusted certificate fingerprint must be a SHA-256 fingerprint: 64 hexadecimal characters, such as AB:CD:EF:... .",
        };
      }

      if (!fingerprints.includes(fingerprint)) {
        fingerprints.push(fingerprint);
      }
    }

    if (fingerprints.length > MAX_OPENSTACK_TRUSTED_CERTIFICATES) {
      return {
        error: `One cloud can trust at most ${MAX_OPENSTACK_TRUSTED_CERTIFICATES} certificates.`,
      };
    }

    return { fingerprints: fingerprints };
  }
}
