import { IsBillingEnabled } from "../../EnvironmentConfig";
import OpenStackCloudFeedService from "../../Services/OpenStackCloudFeedService";
import ProbeService from "../../Services/ProbeService";
import CreateBy from "../../Types/Database/CreateBy";
import UpdateBy from "../../Types/Database/UpdateBy";
import RelationIdUtil from "../Database/RelationIdUtil";
import logger from "../Logger";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import { OpenStackCloudFeedEventType } from "../../../Models/DatabaseModels/OpenStackCloudFeed";
import Probe from "../../../Models/DatabaseModels/Probe";
import { Blue500, Gray500, Yellow500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionMethod, {
  OpenStackCollectionMethodUtil,
} from "../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus from "../../../Types/OpenStack/OpenStackCollectionStatus";
import {
  OpenStackCollectionOptions,
  OpenStackCredential,
} from "../../../Types/OpenStack/OpenStackProbeCollection";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import OpenStackAuthUrl, {
  OpenStackAddressResult,
} from "../../../Utils/OpenStack/OpenStackAuthUrl";
import OpenStackCollectionSettings, {
  OpenStackCredentialBinding,
} from "../../../Utils/OpenStack/OpenStackCollectionSettings";
import VMwareCertificateFingerprint from "../../../Utils/VMware/VMwareCertificateFingerprint";

/*
 * The rules of a cloud's probe collection settings, for OpenStackCloudService's create
 * and update hooks to apply. They are VMware's (VMwareVCenterConnection, #4647), for what
 * a cloud is:
 *
 *   - the auth URL is normalized (OpenStackAuthUrl) and a name is made from it when none
 *     was typed;
 *   - a probe-collected cloud has an auth URL, a credential, regions and a probe that may
 *     collect it (OpenStackCollectionSettings.getProbeRefusal: the project's own, or the
 *     instance's own on a self-hosted install);
 *   - the secret is write-only and bound to where it was entered for: an update that
 *     keeps it may not change the address, the probe, or trust a new certificate
 *     (getCredentialRebindRefusal), except trusting the very certificate the probe found
 *     at the saved address, which is what "Trust this certificate" on a failed collection
 *     does;
 *   - switching to the OpenStack agent forgets the secret.
 *
 * What the hooks decide that only the server writes - whether a secret is saved, when the
 * credential changed, that the probe should collect with the new settings now - is written
 * after the save, as OneUptime (afterWrite), with a feed line that says what changed and
 * who changed it.
 */

// The settings a person writes to set up probe collection.
export const OPENSTACK_CONNECTION_SETTING_COLUMNS: Array<string> = [
  "collectionMethod",
  "authUrl",
  "endpointInterface",
  "collectionRegions",
  "credentialKind",
  "applicationCredentialId",
  "keystoneUsername",
  "userDomainName",
  "projectName",
  "projectDomainName",
  "credentialSecret",
  "collectionProbeId",
  "collectionProbe",
  "trustedCertificateFingerprints",
  "collectionIntervalInMinutes",
  "collectionOptions",
];

const PROBE_KEYS: Array<string> = ["collectionProbeId", "collectionProbe"];

/*
 * What a create or an update decided for one cloud, handed from the before-hook to
 * afterWrite.
 */
export interface OpenStackConnectionChange {
  openStackCloudId: ObjectID | null;
  projectId: ObjectID | null;
  // The settings changed in a way the probe must try again (status -> Pending).
  isConnectionChanged: boolean;
  // The credential changed.
  isCredentialChanged: boolean;
  // Whether a secret is saved after the write; null when unchanged.
  isCredentialSet: boolean | null;
  // The cloud now uses the OpenStack agent: forget the probe's status.
  isSwitchedToAgent: boolean;
  feedLines: Array<MarkdownText>;
  feedColor: Color;
}

// The saved row an update is checked against.
export interface SavedOpenStackConnection {
  _id?: string | undefined;
  projectId?: ObjectID | undefined;
  collectionMethod?: OpenStackCollectionMethod | undefined;
  authUrl?: string | undefined;
  credentialKind?: string | undefined;
  applicationCredentialId?: string | undefined;
  keystoneUsername?: string | undefined;
  userDomainName?: string | undefined;
  projectName?: string | undefined;
  projectDomainName?: string | undefined;
  isCredentialSet?: boolean | undefined;
  collectionProbeId?: ObjectID | undefined;
  collectionRegions?: Array<string> | undefined;
  collectionOptions?: OpenStackCollectionOptions | undefined;
  trustedCertificateFingerprints?: Array<string> | undefined;
  presentedCertificate?: { fingerprint256?: string | undefined } | undefined;
}

export const OPENSTACK_CONNECTION_SAVED_SELECT: Record<string, true> = {
  _id: true,
  projectId: true,
  collectionMethod: true,
  authUrl: true,
  credentialKind: true,
  applicationCredentialId: true,
  keystoneUsername: true,
  userDomainName: true,
  projectName: true,
  projectDomainName: true,
  isCredentialSet: true,
  collectionProbeId: true,
  collectionRegions: true,
  collectionOptions: true,
  trustedCertificateFingerprints: true,
  presentedCertificate: true,
};

type DataRecord = Record<string, unknown>;

// What names a credential, without the secret: changing any is a new credential.
const CREDENTIAL_IDENTITY_COLUMNS: ReadonlyArray<string> = [
  "applicationCredentialId",
  "keystoneUsername",
  "userDomainName",
  "projectName",
  "projectDomainName",
];

export default class OpenStackCloudConnection {
  // Whether a write sets any of the probe collection settings.
  public static isConnectionWrite(data: DataRecord | undefined): boolean {
    if (!data) {
      return false;
    }

    return OPENSTACK_CONNECTION_SETTING_COLUMNS.some(
      (column: string): boolean => {
        return data[column] !== undefined;
      },
    );
  }

  /*
   * Check and normalize a new cloud's collection settings in place, and say what
   * afterWrite has to do once it is saved. Null for a cloud that names no probe collection
   * setting at all: one registered by the agent, or by ingest.
   */
  public static async prepareCreate(
    createBy: CreateBy<OpenStackCloud>,
  ): Promise<OpenStackConnectionChange | null> {
    const data: DataRecord = createBy.data as unknown as DataRecord;

    if (!OpenStackCloudConnection.isConnectionWrite(data)) {
      return null;
    }

    const method: OpenStackCollectionMethod =
      OpenStackCloudConnection.readMethod(data["collectionMethod"]) ||
      OpenStackCollectionMethod.Agent;

    data["collectionMethod"] = method;

    OpenStackCloudConnection.normalizeOptionalSettings(data);

    const projectId: ObjectID | null =
      (createBy.data.projectId as ObjectID | undefined) ||
      createBy.props.tenantId ||
      null;

    if (method === OpenStackCollectionMethod.Agent) {
      if (OpenStackCloudConnection.isSecretGiven(data["credentialSecret"])) {
        throw new BadDataException(
          "A credential is only saved for a cloud a probe collects. Set the collection method to Probe, or leave the credential out.",
        );
      }

      delete data["credentialSecret"];

      return {
        openStackCloudId: null,
        projectId: projectId,
        isConnectionChanged: false,
        isCredentialChanged: false,
        isCredentialSet: false,
        isSwitchedToAgent: false,
        feedLines: [],
        feedColor: Gray500,
      };
    }

    OpenStackCloudConnection.normalizeCredential(data);

    // Probe collection: everything it needs, checked.
    OpenStackCloudConnection.requireProbeSettings(data, {
      hasSavedSecret: false,
    });

    if (!projectId) {
      throw new BadDataException("The cloud's project is missing.");
    }

    const probeId: ObjectID = RelationIdUtil.readIntoIdColumn(
      data,
      PROBE_KEYS,
      "Collection Probe",
    ) as ObjectID;

    await OpenStackCloudConnection.assertProbeCanCollect({
      probeId: probeId,
      projectId: projectId,
    });

    // A cloud nobody named is named after its address.
    const name: unknown = data["name"];

    if (typeof name !== "string" || !name.trim()) {
      data["name"] = OpenStackAuthUrl.getDefaultName(data["authUrl"] as string);
    }

    return {
      openStackCloudId: null,
      projectId: projectId,
      isConnectionChanged: true,
      isCredentialChanged: true,
      isCredentialSet: true,
      isSwitchedToAgent: false,
      feedLines: [
        mdText`A probe collects it from ${FeedMarkdown.code(
          data["authUrl"] as string,
        )}.`,
      ],
      feedColor: Blue500,
    };
  }

  /*
   * Check and normalize an update of a cloud's collection settings in place, against the
   * saved row, and say what afterWrite has to do. Empty for an update that names no
   * setting.
   *
   * `saved` is the row the update writes, read by the caller with
   * OPENSTACK_CONNECTION_SAVED_SELECT (findRowsAndHoldUpdateToThem). A settings change
   * names one cloud: the credential rules compare with that one.
   */
  public static async prepareUpdate(data: {
    updateBy: UpdateBy<OpenStackCloud>;
    saved: Array<SavedOpenStackConnection>;
  }): Promise<Array<OpenStackConnectionChange>> {
    const update: DataRecord = data.updateBy.data as unknown as DataRecord;

    if (!OpenStackCloudConnection.isConnectionWrite(update)) {
      return [];
    }

    if (data.saved.length === 0) {
      return [];
    }

    if (data.saved.length > 1) {
      throw new BadDataException(
        "Change the collection settings of one cloud at a time.",
      );
    }

    const saved: SavedOpenStackConnection = data.saved[0]!;

    const savedMethod: OpenStackCollectionMethod =
      OpenStackCloudConnection.readMethod(saved.collectionMethod) ||
      OpenStackCollectionMethod.Agent;

    const requestedMethod: OpenStackCollectionMethod | null =
      update["collectionMethod"] === undefined
        ? null
        : OpenStackCloudConnection.readMethod(update["collectionMethod"]);

    if (update["collectionMethod"] !== undefined && !requestedMethod) {
      throw new BadDataException(
        `Collection method must be one of ${OpenStackCollectionMethodUtil.getAll().join(", ")}.`,
      );
    }

    const method: OpenStackCollectionMethod = requestedMethod || savedMethod;

    OpenStackCloudConnection.normalizeOptionalSettings(update);

    /*
     * An empty secret in an update is "keep the saved one", because the dashboard's edit
     * form sends its empty field, and never "clear it".
     */
    const isSecretGiven: boolean = OpenStackCloudConnection.isSecretGiven(
      update["credentialSecret"],
    );

    if (!isSecretGiven) {
      delete update["credentialSecret"];
    }

    const projectId: ObjectID | null =
      saved.projectId || data.updateBy.props.tenantId || null;

    const change: OpenStackConnectionChange = {
      openStackCloudId: saved._id ? new ObjectID(saved._id.toString()) : null,
      projectId: projectId,
      isConnectionChanged: false,
      isCredentialChanged: false,
      isCredentialSet: null,
      isSwitchedToAgent: false,
      feedLines: [],
      feedColor: Gray500,
    };

    if (method === OpenStackCollectionMethod.Agent) {
      if (isSecretGiven) {
        throw new BadDataException(
          "A credential is only saved for a cloud a probe collects. Set the collection method to Probe, or leave the credential out.",
        );
      }

      if (savedMethod === OpenStackCollectionMethod.Probe) {
        // The agent has its own credential, so OneUptime forgets this one.
        update["credentialSecret"] = null;
        change.isSwitchedToAgent = true;
        change.isCredentialSet = false;
        change.isCredentialChanged = true;
        change.feedLines.push(
          mdText`Its data now comes from the OpenStack agent. The saved credential was deleted, and its probe stopped collecting.`,
        );
        change.feedColor = Yellow500;
      }

      return [change];
    }

    OpenStackCloudConnection.normalizeCredential(update, saved);

    const valueOf: (column: string) => unknown = (column: string): unknown => {
      return update[column] !== undefined
        ? update[column]
        : (saved as unknown as DataRecord)[column];
    };

    // Probe collection, as it will be once the update is saved.
    const next: DataRecord = {
      authUrl: valueOf("authUrl"),
      credentialKind: valueOf("credentialKind"),
      applicationCredentialId: valueOf("applicationCredentialId"),
      keystoneUsername: valueOf("keystoneUsername"),
      userDomainName: valueOf("userDomainName"),
      projectName: valueOf("projectName"),
      projectDomainName: valueOf("projectDomainName"),
      credentialSecret: isSecretGiven ? update["credentialSecret"] : undefined,
      collectionRegions: valueOf("collectionRegions"),
      collectionProbeId: RelationIdUtil.isPresent(update, PROBE_KEYS)
        ? RelationIdUtil.readIntoIdColumn(
            update,
            PROBE_KEYS,
            "Collection Probe",
          )
        : saved.collectionProbeId,
      trustedCertificateFingerprints: valueOf("trustedCertificateFingerprints"),
    };

    const hasSavedSecret: boolean =
      savedMethod === OpenStackCollectionMethod.Probe &&
      saved.isCredentialSet === true;

    OpenStackCloudConnection.requireProbeSettings(next, {
      hasSavedSecret: hasSavedSecret,
    });

    if (!projectId) {
      throw new BadDataException("The cloud's project is missing.");
    }

    const nextProbeId: ObjectID = next["collectionProbeId"] as ObjectID;

    await OpenStackCloudConnection.assertProbeCanCollect({
      probeId: nextProbeId,
      projectId: projectId,
    });

    const savedBinding: OpenStackCredentialBinding =
      OpenStackCloudConnection.getBinding({
        authUrl: saved.authUrl,
        probeId: saved.collectionProbeId,
        trustedCertificateFingerprints: saved.trustedCertificateFingerprints,
      });

    const nextBinding: OpenStackCredentialBinding =
      OpenStackCloudConnection.getBinding({
        authUrl: next["authUrl"] as string | undefined,
        probeId: nextProbeId,
        trustedCertificateFingerprints: next[
          "trustedCertificateFingerprints"
        ] as Array<string> | undefined,
      });

    const isIdentityChanged: boolean =
      CREDENTIAL_IDENTITY_COLUMNS.some((column: string): boolean => {
        return (
          update[column] !== undefined &&
          update[column] !== (saved as unknown as DataRecord)[column]
        );
      }) ||
      (update["credentialKind"] !== undefined &&
        update["credentialKind"] !== saved.credentialKind);

    if (!isSecretGiven) {
      /*
       * A secret belongs to the credential it was entered for. Saving a new name beside
       * the old secret would send that secret somewhere it was never meant for.
       */
      if (isIdentityChanged) {
        throw new BadDataException(
          "Enter the credential's secret again: a saved one only goes with the credential it was entered for.",
        );
      }

      const refusal: string | null = OpenStackCloudConnection.getRebindRefusal({
        saved: savedBinding,
        next: nextBinding,
        presentedFingerprint: saved.presentedCertificate?.fingerprint256,
      });

      if (refusal) {
        throw new BadDataException(refusal);
      }
    }

    const isMethodSwitched: boolean =
      savedMethod !== OpenStackCollectionMethod.Probe;
    const isEndpointChanged: boolean =
      savedBinding.endpointKey !== nextBinding.endpointKey;
    const isProbeChanged: boolean =
      savedBinding.probeId !== nextBinding.probeId;
    const isFingerprintChanged: boolean =
      JSON.stringify(savedBinding.trustedCertificateFingerprints) !==
      JSON.stringify(nextBinding.trustedCertificateFingerprints);

    const isRegionsChanged: boolean =
      update["collectionRegions"] !== undefined &&
      JSON.stringify(update["collectionRegions"]) !==
        JSON.stringify(saved.collectionRegions || []);

    const isInterfaceChanged: boolean =
      update["endpointInterface"] !== undefined;

    change.isCredentialChanged = isSecretGiven || isIdentityChanged;
    change.isCredentialSet = isSecretGiven ? true : null;
    change.isConnectionChanged =
      isMethodSwitched ||
      isEndpointChanged ||
      isProbeChanged ||
      isFingerprintChanged ||
      isRegionsChanged ||
      isInterfaceChanged ||
      change.isCredentialChanged;

    if (isMethodSwitched) {
      change.feedLines.push(
        mdText`A probe now collects it from ${FeedMarkdown.code(
          next["authUrl"] as string,
        )}, instead of the OpenStack agent. Stop the agent once the first collection succeeds, or every metric arrives twice.`,
      );
      change.feedColor = Blue500;
    } else {
      if (isEndpointChanged) {
        change.feedLines.push(
          mdText`Its address changed to ${FeedMarkdown.code(
            next["authUrl"] as string,
          )}.`,
        );
      }

      if (isProbeChanged) {
        change.feedLines.push(mdText`Another probe collects it now.`);
      }

      if (change.isCredentialChanged) {
        change.feedLines.push(mdText`Its OpenStack credential changed.`);
      }

      if (isRegionsChanged) {
        change.feedLines.push(mdText`The regions it reads changed.`);
      }

      if (isFingerprintChanged) {
        change.feedLines.push(
          nextBinding.trustedCertificateFingerprints.length > 0
            ? mdText`The certificates trusted for it changed. It trusts ${String(
                nextBinding.trustedCertificateFingerprints.length,
              )} now.`
            : mdText`It no longer trusts a certificate of its own: each API's certificate must come from an authority the probe trusts.`,
        );
      }
    }

    if (
      update["collectionOptions"] !== undefined &&
      !isMethodSwitched &&
      JSON.stringify(update["collectionOptions"]) !==
        JSON.stringify(saved.collectionOptions || {})
    ) {
      change.feedLines.push(
        mdText`What it collects beyond the defaults changed.`,
      );
    }

    if (
      update["collectionIntervalInMinutes"] !== undefined &&
      !isMethodSwitched
    ) {
      change.feedLines.push(
        mdText`It is collected every ${String(
          update["collectionIntervalInMinutes"],
        )} minutes now.`,
      );
    }

    return [change];
  }

  /*
   * Once the write is saved: the columns only the server writes, and the feed line. As
   * OneUptime: the person's own write already went through their permission checks, and
   * these columns are nobody's to write.
   */
  public static async afterWrite(data: {
    change: OpenStackConnectionChange;
    userId?: ObjectID | undefined;
    /*
     * Writes `values` to the cloud, hook-free, adding one to collectionSettingsVersion in
     * the same statement when bumpSettingsVersion is set.
     */
    writeServerColumns: (write: {
      openStackCloudId: ObjectID;
      values: DataRecord;
      bumpSettingsVersion: boolean;
    }) => Promise<void>;
  }): Promise<void> {
    const change: OpenStackConnectionChange = data.change;

    if (!change.openStackCloudId) {
      return;
    }

    const values: DataRecord = {};

    if (change.isCredentialSet !== null) {
      values["isCredentialSet"] = change.isCredentialSet;
    }

    if (change.isCredentialChanged) {
      values["credentialsUpdatedAt"] = OneUptimeDate.getCurrentDate();
    }

    if (change.isSwitchedToAgent) {
      values["collectionStatus"] = null;
      values["collectionErrorCode"] = null;
      values["collectionError"] = null;
      values["presentedCertificate"] = null;
      values["nextCollectionAt"] = null;
    } else if (change.isConnectionChanged) {
      values["collectionStatus"] = OpenStackCollectionStatus.Pending;
      values["collectionErrorCode"] = null;
      values["collectionError"] = null;
      values["presentedCertificate"] = null;
      // Collect with the new settings at once, not an interval from now.
      values["nextCollectionAt"] = OneUptimeDate.getCurrentDate();
    }

    const bumpSettingsVersion: boolean =
      change.isConnectionChanged || change.isSwitchedToAgent;

    try {
      if (Object.keys(values).length > 0 || bumpSettingsVersion) {
        await data.writeServerColumns({
          openStackCloudId: change.openStackCloudId,
          values: values,
          bumpSettingsVersion: bumpSettingsVersion,
        });
      }
    } catch (error) {
      logger.error(
        `Could not record the collection settings of cloud ${change.openStackCloudId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }

    if (change.feedLines.length > 0 && change.projectId) {
      await OpenStackCloudFeedService.createOpenStackCloudFeedItem({
        openStackCloudId: change.openStackCloudId,
        projectId: change.projectId,
        openStackCloudFeedEventType:
          OpenStackCloudFeedEventType.OpenStackCloudUpdated,
        displayColor: change.feedColor,
        feedInfoInMarkdown: FeedMarkdown.join(
          [mdText`🔌 Data collection changed.`, ...change.feedLines],
          " ",
        ).toString(),
        userId: data.userId,
      });
    }
  }

  /*
   * Refuse a probe that may not collect a cloud of this project. An id of another
   * project's probe gets the answer an id that matches nothing gets.
   */
  public static async assertProbeCanCollect(data: {
    probeId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const probe: Probe | null = await ProbeService.findOneById({
      id: data.probeId,
      select: {
        _id: true,
        projectId: true,
        isGlobalProbe: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!probe) {
      throw new BadDataException(
        "Probe not found. Pick one of this project's probes.",
      );
    }

    const refusal: string | null = OpenStackCollectionSettings.getProbeRefusal({
      probe: {
        isGlobalProbe: probe.isGlobalProbe,
        projectId: probe.projectId?.toString() || null,
      },
      projectId: data.projectId.toString(),
      isBillingEnabled: IsBillingEnabled,
    });

    if (refusal) {
      throw new BadDataException(refusal);
    }
  }

  /*
   * The rebind rule (OpenStackCollectionSettings.getCredentialRebindRefusal), with the one
   * exception "Trust this certificate" needs: adding exactly the certificate the probe
   * found at the saved address, through the saved probe, keeps the credential. That
   * certificate is not one an editor chose.
   */
  public static getRebindRefusal(data: {
    saved: OpenStackCredentialBinding;
    next: OpenStackCredentialBinding;
    presentedFingerprint?: string | null | undefined;
  }): string | null {
    const added: Array<string> =
      data.next.trustedCertificateFingerprints.filter(
        (fingerprint: string): boolean => {
          return !data.saved.trustedCertificateFingerprints.some(
            (saved: string): boolean => {
              return VMwareCertificateFingerprint.areEqual(saved, fingerprint);
            },
          );
        },
      );

    const isOnlyTrustingWhatWasPresented: boolean =
      data.saved.endpointKey === data.next.endpointKey &&
      data.saved.probeId === data.next.probeId &&
      added.length === 1 &&
      VMwareCertificateFingerprint.areEqual(
        added[0],
        data.presentedFingerprint,
      );

    if (isOnlyTrustingWhatWasPresented) {
      return null;
    }

    return OpenStackCollectionSettings.getCredentialRebindRefusal({
      saved: data.saved,
      next: data.next,
    });
  }

  public static getBinding(data: {
    authUrl: string | null | undefined;
    probeId: ObjectID | string | null | undefined;
    trustedCertificateFingerprints: Array<string> | null | undefined;
  }): OpenStackCredentialBinding {
    const normalized: ReturnType<
      typeof OpenStackCollectionSettings.normalizeFingerprints
    > = OpenStackCollectionSettings.normalizeFingerprints(
      data.trustedCertificateFingerprints || [],
    );

    return {
      endpointKey: OpenStackAuthUrl.getEndpointKey(data.authUrl),
      probeId: data.probeId ? data.probeId.toString().toLowerCase() : null,
      trustedCertificateFingerprints: normalized.fingerprints || [],
    };
  }

  private static readMethod(value: unknown): OpenStackCollectionMethod | null {
    return OpenStackCollectionMethodUtil.isValid(value) ? value : null;
  }

  private static isSecretGiven(value: unknown): boolean {
    return typeof value === "string" && value.length > 0;
  }

  /*
   * Normalize what the write sets of the address, credential names, regions, interface,
   * fingerprints and interval, refusing what cannot be normalized. Settings the write
   * leaves out are left alone.
   */
  private static normalizeOptionalSettings(data: DataRecord): void {
    if (data["authUrl"] !== undefined && data["authUrl"] !== null) {
      const result: OpenStackAddressResult = OpenStackAuthUrl.normalize(
        String(data["authUrl"]),
      );

      if (!result.address) {
        throw new BadDataException(result.error);
      }

      data["authUrl"] = result.address.url;
    }

    if (data["endpointInterface"] !== undefined) {
      if (
        !OpenStackCollectionSettings.isEndpointInterface(
          data["endpointInterface"],
        )
      ) {
        throw new BadDataException(
          "The endpoint interface is public, internal or admin.",
        );
      }
    }

    if (data["collectionRegions"] !== undefined) {
      const regions: ReturnType<
        typeof OpenStackCollectionSettings.normalizeRegions
      > = OpenStackCollectionSettings.normalizeRegions(
        data["collectionRegions"],
      );

      if (!regions.regions) {
        throw new BadDataException(regions.error);
      }

      data["collectionRegions"] = regions.regions;
    }

    if (data["trustedCertificateFingerprints"] !== undefined) {
      const fingerprints: ReturnType<
        typeof OpenStackCollectionSettings.normalizeFingerprints
      > = OpenStackCollectionSettings.normalizeFingerprints(
        data["trustedCertificateFingerprints"],
      );

      if (!fingerprints.fingerprints) {
        throw new BadDataException(fingerprints.error);
      }

      data["trustedCertificateFingerprints"] = fingerprints.fingerprints;
    }

    if (data["collectionIntervalInMinutes"] !== undefined) {
      const interval: unknown = data["collectionIntervalInMinutes"];
      const refusal: string | null =
        OpenStackCollectionSettings.getIntervalRefusal(
          typeof interval === "string" ? Number(interval) : interval,
        );

      if (refusal) {
        throw new BadDataException(refusal);
      }

      data["collectionIntervalInMinutes"] = Number(interval);
    }

    if (data["collectionOptions"] !== undefined) {
      const options: ReturnType<
        typeof OpenStackCollectionSettings.normalizeOptions
      > = OpenStackCollectionSettings.normalizeOptions(
        data["collectionOptions"],
      );

      if (!options.options) {
        throw new BadDataException(options.error);
      }

      data["collectionOptions"] = options.options;
    }

    for (const column of CREDENTIAL_IDENTITY_COLUMNS) {
      const value: unknown = data[column];

      if (typeof value === "string") {
        data[column] = value.trim();
      }
    }
  }

  /*
   * Which of the two kinds a write with a secret gives, and every column that names it.
   * Only one kind is ever saved, so moving from one to the other clears what named the old
   * one. A write with no secret keeps what is saved, and the credential rules see to it.
   */
  private static normalizeCredential(
    data: DataRecord,
    saved?: SavedOpenStackConnection | undefined,
  ): void {
    const secret: unknown = data["credentialSecret"];

    if (typeof secret !== "string" || !secret) {
      return;
    }

    const read: ReturnType<typeof OpenStackCollectionSettings.readCredential> =
      OpenStackCollectionSettings.readCredentialColumns({
        written: data,
        saved: saved,
        secret: secret,
      });

    if (!read.credential) {
      throw new BadDataException(read.error);
    }

    const credential: OpenStackCredential = read.credential;

    data["credentialKind"] = credential.kind;

    if (credential.kind === "applicationCredential") {
      data["applicationCredentialId"] = credential.id;

      if (saved?.keystoneUsername || saved?.projectName) {
        data["keystoneUsername"] = null;
        data["userDomainName"] = null;
        data["projectName"] = null;
        data["projectDomainName"] = null;
      }

      return;
    }

    data["keystoneUsername"] = credential.username;
    data["userDomainName"] = credential.userDomainName;
    data["projectName"] = credential.projectName;
    data["projectDomainName"] = credential.projectDomainName;

    if (saved?.applicationCredentialId) {
      data["applicationCredentialId"] = null;
    }
  }

  /*
   * A probe-collected cloud needs an auth URL, a credential (a new secret, or the one
   * saved), at least one region and a probe.
   */
  private static requireProbeSettings(
    data: DataRecord,
    options: { hasSavedSecret: boolean },
  ): void {
    if (!data["authUrl"]) {
      throw new BadDataException(
        "Enter Keystone's address, such as https://keystone.example.com:5000/v3.",
      );
    }

    if (
      !OpenStackCloudConnection.isSecretGiven(data["credentialSecret"]) &&
      !options.hasSavedSecret
    ) {
      throw new BadDataException(
        "Enter an application credential's ID and secret.",
      );
    }

    if (
      !Array.isArray(data["collectionRegions"]) ||
      (data["collectionRegions"] as Array<string>).length === 0
    ) {
      throw new BadDataException(
        "Pick the regions to read. The connection test lists the ones the catalog names.",
      );
    }

    if (!RelationIdUtil.readConsistent(data, PROBE_KEYS, "Collection Probe")) {
      throw new BadDataException(
        "Pick the probe that collects this cloud: one in a network that can reach its APIs.",
      );
    }
  }
}
