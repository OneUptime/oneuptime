import { IsBillingEnabled } from "../../EnvironmentConfig";
import ProbeService from "../../Services/ProbeService";
import CreateBy from "../../Types/Database/CreateBy";
import UpdateBy from "../../Types/Database/UpdateBy";
import RelationIdUtil from "../Database/RelationIdUtil";
import logger from "../Logger";
import Probe from "../../../Models/DatabaseModels/Probe";
import StorageArrayConnection from "../../../Models/DatabaseModels/StorageArrayConnection";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import StorageArrayCollectionStatus from "../../../Types/StorageArray/Collection/StorageArrayCollectionStatus";
import { StorageArrayPresentedCertificate } from "../../../Types/StorageArray/Collection/StorageArrayProbeCollection";
import { StorageArrayProbeCollector } from "../../../Types/StorageArray/Collection/StorageArrayProbeCollector";
import StorageArrayProbeCollectors from "../../../Types/StorageArray/Collection/StorageArrayProbeCollectors";
import StorageArrayConnectionAddress, {
  StorageArrayAddressResult,
} from "../../../Utils/StorageArray/StorageArrayConnectionAddress";
import StorageArrayConnectionSettings, {
  MAX_STORAGE_ARRAY_PASSWORD_LENGTH,
  MAX_STORAGE_ARRAY_USERNAME_LENGTH,
  StorageArrayPasswordBinding,
} from "../../../Utils/StorageArray/StorageArrayConnectionSettings";
import VMwareCertificateFingerprint from "../../../Utils/VMware/VMwareCertificateFingerprint";

/*
 * The rules a storage array connection's writes follow (#11004), the shape
 * of VMware's (VMwareVCenterConnection): every write of a setting is
 * checked and normalized before it is saved, and once it is saved the
 * columns only the server writes follow from it - the password is marked
 * saved, the status goes back to Pending, the next collection is now, and
 * the settings version moves on so a collection of the old settings cannot
 * report over the new ones.
 */

type DataRecord = Record<string, unknown>;

const PROBE_KEYS: Array<string> = ["collectionProbeId", "collectionProbe"];

// The columns a person sets that decide how the server is reached.
export const STORAGE_ARRAY_CONNECTION_SETTING_COLUMNS: Array<string> = [
  "address",
  "username",
  "password",
  "collectionProbeId",
  "collectionProbe",
  "trustedCertificateFingerprint",
  "collectionIntervalInMinutes",
  "storageSystem",
];

// What an update reads of the saved row, to judge the write against it.
export const STORAGE_ARRAY_CONNECTION_SAVED_SELECT: Record<string, true> = {
  _id: true,
  projectId: true,
  storageSystem: true,
  address: true,
  username: true,
  isPasswordSet: true,
  collectionProbeId: true,
  trustedCertificateFingerprint: true,
  presentedCertificate: true,
};

export interface SavedStorageArrayConnection {
  _id?: string | undefined;
  projectId?: ObjectID | undefined;
  storageSystem?: string | undefined;
  address?: string | undefined;
  username?: string | undefined;
  isPasswordSet?: boolean | undefined;
  collectionProbeId?: ObjectID | undefined;
  trustedCertificateFingerprint?: string | undefined;
  presentedCertificate?: StorageArrayPresentedCertificate | undefined;
}

// What a saved write means for the columns only the server writes.
export interface StorageArrayConnectionChange {
  storageArrayConnectionId: ObjectID | null;
  // The settings changed: collect again at once, as Pending.
  isConnectionChanged: boolean;
  isCredentialChanged: boolean;
  // Whether a password is saved now; null when the write left it alone.
  isPasswordSet: boolean | null;
}

export default class StorageArrayConnectionRules {
  public static isConnectionWrite(data: DataRecord | undefined): boolean {
    if (!data) {
      return false;
    }
    return STORAGE_ARRAY_CONNECTION_SETTING_COLUMNS.some(
      (column: string): boolean => {
        return data[column] !== undefined;
      },
    );
  }

  public static getCollector(
    storageSystem: unknown,
  ): StorageArrayProbeCollector {
    const collector: StorageArrayProbeCollector | null =
      StorageArrayProbeCollectors.getCollector(
        typeof storageSystem === "string" ? storageSystem : null,
      );
    if (!collector) {
      throw new BadDataException(
        `Storage platform must be one of ${StorageArrayProbeCollectors.getStorageSystems().join(", ")}.`,
      );
    }
    return collector;
  }

  /*
   * Check and normalize a new connection in place: an address, a user
   * name, a password and a probe that may collect it, all required.
   */
  public static async prepareCreate(
    createBy: CreateBy<StorageArrayConnection>,
  ): Promise<StorageArrayConnectionChange> {
    const data: DataRecord = createBy.data as unknown as DataRecord;

    const collector: StorageArrayProbeCollector =
      StorageArrayConnectionRules.getCollector(
        data["storageSystem"] === undefined || data["storageSystem"] === null
          ? StorageArrayProbeCollectors.getDefault().storageSystem
          : data["storageSystem"],
      );
    data["storageSystem"] = collector.storageSystem;

    if (data["collectionIntervalInMinutes"] === undefined) {
      data["collectionIntervalInMinutes"] =
        collector.collectionInterval.defaultMinutes;
    }

    StorageArrayConnectionRules.normalizeSettings(data, collector);
    StorageArrayConnectionRules.requireSettings(data, {
      hasSavedPassword: false,
      collector: collector,
    });

    const projectId: ObjectID | null =
      (createBy.data.projectId as ObjectID | undefined) ||
      createBy.props.tenantId ||
      null;

    if (!projectId) {
      throw new BadDataException("The connection's project is missing.");
    }

    const probeId: ObjectID = RelationIdUtil.readIntoIdColumn(
      data,
      PROBE_KEYS,
      "Collection Probe",
    ) as ObjectID;

    await StorageArrayConnectionRules.assertProbeCanCollect({
      probeId: probeId,
      projectId: projectId,
    });

    // A connection nobody named is named after its host.
    const name: unknown = data["name"];
    if (typeof name !== "string" || !name.trim()) {
      data["name"] = StorageArrayConnectionAddress.getDefaultName(
        data["address"] as string,
        collector,
      );
    }

    // Nothing a person writes on create decides the server's own columns.
    for (const column of [
      "isPasswordSet",
      "credentialsUpdatedAt",
      "collectionStatus",
      "collectionErrorCode",
      "collectionError",
      "presentedCertificate",
      "collectionSummary",
      "nextCollectionAt",
      "lastCollectionAt",
      "lastSuccessfulCollectionAt",
      "collectionSettingsVersion",
    ]) {
      delete data[column];
    }

    return {
      storageArrayConnectionId: null,
      isConnectionChanged: true,
      isCredentialChanged: true,
      isPasswordSet: true,
    };
  }

  /*
   * Check and normalize an update of a connection's settings in place,
   * against the saved row. Empty for an update that names no setting.
   */
  public static async prepareUpdate(data: {
    updateBy: UpdateBy<StorageArrayConnection>;
    saved: Array<SavedStorageArrayConnection>;
  }): Promise<Array<StorageArrayConnectionChange>> {
    const update: DataRecord = data.updateBy.data as unknown as DataRecord;

    if (!StorageArrayConnectionRules.isConnectionWrite(update)) {
      return [];
    }

    if (data.saved.length === 0) {
      return [];
    }

    if (data.saved.length > 1) {
      throw new BadDataException(
        "Change the settings of one connection at a time.",
      );
    }

    const saved: SavedStorageArrayConnection = data.saved[0]!;

    if (
      update["storageSystem"] !== undefined &&
      update["storageSystem"] !== saved.storageSystem
    ) {
      throw new BadDataException(
        "A connection's platform is set when it is made. Connect a new one for another platform.",
      );
    }
    delete update["storageSystem"];

    const collector: StorageArrayProbeCollector =
      StorageArrayConnectionRules.getCollector(saved.storageSystem);

    StorageArrayConnectionRules.normalizeSettings(update, collector);

    /*
     * An empty password in an update is "keep the saved one" - the
     * dashboard's edit form sends its empty field - never "clear it".
     */
    const isPasswordGiven: boolean =
      StorageArrayConnectionRules.isPasswordGiven(update["password"]);
    if (!isPasswordGiven) {
      delete update["password"];
    }

    const projectId: ObjectID | null =
      saved.projectId || data.updateBy.props.tenantId || null;

    const next: DataRecord = {
      address:
        update["address"] !== undefined ? update["address"] : saved.address,
      username:
        update["username"] !== undefined ? update["username"] : saved.username,
      password: isPasswordGiven ? update["password"] : undefined,
      collectionProbeId: RelationIdUtil.isPresent(update, PROBE_KEYS)
        ? RelationIdUtil.readIntoIdColumn(
            update,
            PROBE_KEYS,
            "Collection Probe",
          )
        : saved.collectionProbeId,
      trustedCertificateFingerprint:
        update["trustedCertificateFingerprint"] !== undefined
          ? update["trustedCertificateFingerprint"]
          : saved.trustedCertificateFingerprint,
    };

    StorageArrayConnectionRules.requireSettings(next, {
      hasSavedPassword: saved.isPasswordSet === true,
      collector: collector,
    });

    if (!projectId) {
      throw new BadDataException("The connection's project is missing.");
    }

    const nextProbeId: ObjectID = next["collectionProbeId"] as ObjectID;

    await StorageArrayConnectionRules.assertProbeCanCollect({
      probeId: nextProbeId,
      projectId: projectId,
    });

    const savedBinding: StorageArrayPasswordBinding =
      StorageArrayConnectionRules.getBinding({
        address: saved.address,
        probeId: saved.collectionProbeId,
        trustedCertificateFingerprint: saved.trustedCertificateFingerprint,
        collector: collector,
      });

    const nextBinding: StorageArrayPasswordBinding =
      StorageArrayConnectionRules.getBinding({
        address: next["address"] as string | undefined,
        probeId: nextProbeId,
        trustedCertificateFingerprint: next["trustedCertificateFingerprint"] as
          | string
          | undefined,
        collector: collector,
      });

    if (!isPasswordGiven) {
      const refusal: string | null =
        StorageArrayConnectionRules.getRebindRefusal({
          saved: savedBinding,
          next: nextBinding,
          presentedFingerprint: saved.presentedCertificate?.fingerprint256,
        });
      if (refusal) {
        throw new BadDataException(refusal);
      }
    }

    const isUsernameChanged: boolean =
      update["username"] !== undefined && update["username"] !== saved.username;

    const isCredentialChanged: boolean = isPasswordGiven || isUsernameChanged;

    return [
      {
        storageArrayConnectionId: saved._id ? new ObjectID(saved._id) : null,
        isCredentialChanged: isCredentialChanged,
        isPasswordSet: isPasswordGiven ? true : null,
        isConnectionChanged:
          isCredentialChanged ||
          savedBinding.endpointKey !== nextBinding.endpointKey ||
          savedBinding.probeId !== nextBinding.probeId ||
          (savedBinding.trustedCertificateFingerprint || null) !==
            (nextBinding.trustedCertificateFingerprint || null),
      },
    ];
  }

  /*
   * Once the write is saved: the columns only the server writes, as
   * OneUptime - the person's own write already went through their
   * permission checks, and these columns are nobody's to write.
   */
  public static async afterWrite(data: {
    change: StorageArrayConnectionChange;
    writeServerColumns: (write: {
      storageArrayConnectionId: ObjectID;
      values: DataRecord;
      bumpSettingsVersion: boolean;
    }) => Promise<void>;
  }): Promise<void> {
    const change: StorageArrayConnectionChange = data.change;
    if (!change.storageArrayConnectionId) {
      return;
    }

    const values: DataRecord = {};

    if (change.isPasswordSet !== null) {
      values["isPasswordSet"] = change.isPasswordSet;
    }

    if (change.isCredentialChanged) {
      values["credentialsUpdatedAt"] = OneUptimeDate.getCurrentDate();
    }

    if (change.isConnectionChanged) {
      values["collectionStatus"] = StorageArrayCollectionStatus.Pending;
      values["collectionErrorCode"] = null;
      values["collectionError"] = null;
      values["presentedCertificate"] = null;
      // Collect with the new settings at once, not an interval from now.
      values["nextCollectionAt"] = OneUptimeDate.getCurrentDate();
    }

    if (Object.keys(values).length === 0 && !change.isConnectionChanged) {
      return;
    }

    try {
      await data.writeServerColumns({
        storageArrayConnectionId: change.storageArrayConnectionId,
        values: values,
        bumpSettingsVersion: change.isConnectionChanged,
      });
    } catch (error) {
      logger.error(
        `Could not record the settings of storage array connection ${change.storageArrayConnectionId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /*
   * Refuse a probe that may not collect a connection of this project. An
   * id of another project's probe gets the answer an id that matches
   * nothing gets.
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

    const refusal: string | null =
      StorageArrayConnectionSettings.getProbeRefusal({
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
   * The rebind rule (StorageArrayConnectionSettings.getPasswordRebindRefusal)
   * with the one exception "Trust this certificate" needs: trusting exactly
   * the certificate the probe found at the saved address, through the
   * saved probe, keeps the password - that certificate is not one an
   * editor chose.
   */
  public static getRebindRefusal(data: {
    saved: StorageArrayPasswordBinding;
    next: StorageArrayPasswordBinding;
    presentedFingerprint?: string | null | undefined;
  }): string | null {
    const isOnlyTrustingWhatWasPresented: boolean =
      data.saved.endpointKey === data.next.endpointKey &&
      data.saved.probeId === data.next.probeId &&
      data.next.trustedCertificateFingerprint !== null &&
      VMwareCertificateFingerprint.areEqual(
        data.next.trustedCertificateFingerprint,
        data.presentedFingerprint,
      );

    if (isOnlyTrustingWhatWasPresented) {
      return null;
    }

    return StorageArrayConnectionSettings.getPasswordRebindRefusal({
      saved: data.saved,
      next: data.next,
    });
  }

  public static getBinding(data: {
    address: string | null | undefined;
    probeId: ObjectID | string | null | undefined;
    trustedCertificateFingerprint: string | null | undefined;
    collector: StorageArrayProbeCollector;
  }): StorageArrayPasswordBinding {
    return {
      endpointKey: StorageArrayConnectionAddress.getEndpointKey(
        data.address,
        data.collector,
      ),
      probeId: data.probeId ? data.probeId.toString().toLowerCase() : null,
      trustedCertificateFingerprint: VMwareCertificateFingerprint.normalize(
        data.trustedCertificateFingerprint,
      ),
    };
  }

  public static isPasswordGiven(value: unknown): boolean {
    return typeof value === "string" && value.length > 0;
  }

  /*
   * Normalize what the write sets of the address, user name, password,
   * fingerprint and interval, refusing what cannot be normalized. Settings
   * the write leaves out are left alone.
   */
  public static normalizeSettings(
    data: DataRecord,
    collector: StorageArrayProbeCollector,
  ): void {
    if (data["address"] !== undefined && data["address"] !== null) {
      const result: StorageArrayAddressResult =
        StorageArrayConnectionAddress.normalize(
          String(data["address"]),
          collector,
        );
      if (!result.address) {
        throw new BadDataException(result.error);
      }
      data["address"] = result.address.url;
    }

    if (data["username"] !== undefined && data["username"] !== null) {
      const username: string = String(data["username"]).trim();
      if (username.length > MAX_STORAGE_ARRAY_USERNAME_LENGTH) {
        throw new BadDataException(
          `The user name may be at most ${MAX_STORAGE_ARRAY_USERNAME_LENGTH} characters.`,
        );
      }
      data["username"] = username || null;
    }

    if (
      typeof data["password"] === "string" &&
      (data["password"] as string).length > MAX_STORAGE_ARRAY_PASSWORD_LENGTH
    ) {
      throw new BadDataException(
        `The password may be at most ${MAX_STORAGE_ARRAY_PASSWORD_LENGTH} characters.`,
      );
    }

    if (data["trustedCertificateFingerprint"] !== undefined) {
      const raw: unknown = data["trustedCertificateFingerprint"];
      if (raw === null || (typeof raw === "string" && !raw.trim())) {
        data["trustedCertificateFingerprint"] = null;
      } else {
        const fingerprint: string | null =
          VMwareCertificateFingerprint.normalize(String(raw));
        if (!fingerprint) {
          throw new BadDataException(
            "The trusted certificate fingerprint must be a SHA-256 fingerprint: 64 hexadecimal characters, such as AB:CD:EF:... .",
          );
        }
        data["trustedCertificateFingerprint"] = fingerprint;
      }
    }

    if (data["collectionIntervalInMinutes"] !== undefined) {
      const interval: unknown = data["collectionIntervalInMinutes"];
      const value: unknown =
        typeof interval === "string" ? Number(interval) : interval;
      const refusal: string | null =
        StorageArrayConnectionSettings.getIntervalRefusal(value, collector);
      if (refusal) {
        throw new BadDataException(refusal);
      }
      data["collectionIntervalInMinutes"] = Number(interval);
    }
  }

  // A connection needs an address, a user name, a password and a probe.
  private static requireSettings(
    data: DataRecord,
    options: {
      hasSavedPassword: boolean;
      collector: StorageArrayProbeCollector;
    },
  ): void {
    if (!data["address"]) {
      throw new BadDataException(
        `Enter the address of ${options.collector.serverProductName}, such as ${options.collector.words.addressPlaceholder}.`,
      );
    }

    if (!data["username"]) {
      throw new BadDataException("Enter the user name.");
    }

    if (
      !StorageArrayConnectionRules.isPasswordGiven(data["password"]) &&
      !options.hasSavedPassword
    ) {
      throw new BadDataException("Enter the password.");
    }

    if (!RelationIdUtil.readConsistent(data, PROBE_KEYS, "Collection Probe")) {
      throw new BadDataException(
        `Pick the probe that reads this server: one in a network that reaches it on TCP ${options.collector.defaultPort}.`,
      );
    }
  }
}
