import DataMigrationBase from "./DataMigrationBase";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import EncryptColumnInPlace, {
  ColumnToEncrypt,
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

/*
 * Encrypts the SNMP credentials of network devices and discovery scans
 * stored before their columns were kept encrypted at rest (#9014), as a
 * credential profile's are:
 *
 *   - NetworkDevice.snmpCommunityString, .snmpV3AuthKey and .snmpV3PrivKey,
 *     and the authKey and privKey of the deprecated snmpV3Auth object that
 *     devices created before those columns still carry;
 *   - NetworkDeviceDiscoveryScan.snmpCommunityString, .snmpV3AuthKey and
 *     .snmpV3PrivKey, and the community string and v3 keys inside each entry
 *     of its snmpConfigs list.
 *
 * All of them together: a scan's credentials are copied into the devices
 * it imports and mirrored between its list and its own columns, so one
 * left as written would keep the very secret encrypted beside it. The text
 * columns are encrypted whole, the JSON ones field by field, keeping their
 * shape (EncryptColumnInPlace, jsonFields): each only while the row still
 * holds the value read, so a credential saved meanwhile is already
 * encrypted and stays as its write stored it.
 *
 * Idempotent, and safe to run twice at once. Every reader reads the same
 * credentials before, during and after: DatabaseService decrypts our
 * ciphertext and hands back a value that is not one as it is, so the
 * probes keep polling devices and sweeping scans with them, and the imports
 * keep creating devices with them. One table, or one row, that cannot be
 * read or written costs the others nothing, and no log line carries a
 * value.
 */
export default class EncryptSnmpCredentials extends DataMigrationBase {
  public constructor() {
    super("EncryptSnmpCredentials");
  }

  public override async migrate(): Promise<void> {
    for (const target of EncryptSnmpCredentials.getTargets()) {
      await EncryptColumnInPlace.encrypt({
        migrationName: this.name,
        target: target,
      });
    }
  }

  // Every column this encrypts, in the order it encrypts them.
  public static getTargets(): Array<ColumnToEncrypt> {
    const devices: ModelRepository =
      NetworkDeviceService.getRepository() as unknown as ModelRepository;
    const scans: ModelRepository =
      NetworkDeviceDiscoveryScanService.getRepository() as unknown as ModelRepository;

    return [
      {
        kind: "network device",
        repository: devices,
        column: "snmpCommunityString",
      },
      {
        kind: "network device",
        repository: devices,
        column: "snmpV3AuthKey",
      },
      {
        kind: "network device",
        repository: devices,
        column: "snmpV3PrivKey",
      },
      {
        kind: "network device",
        repository: devices,
        column: "snmpV3Auth",
        jsonFields: EncryptSnmpCredentials.getEncryptedFields(
          new NetworkDevice(),
          "snmpV3Auth",
        ),
      },
      {
        kind: "discovery scan",
        repository: scans,
        column: "snmpCommunityString",
      },
      {
        kind: "discovery scan",
        repository: scans,
        column: "snmpV3AuthKey",
      },
      {
        kind: "discovery scan",
        repository: scans,
        column: "snmpV3PrivKey",
      },
      {
        kind: "discovery scan",
        repository: scans,
        column: "snmpConfigs",
        jsonFields: EncryptSnmpCredentials.getEncryptedFields(
          new NetworkDeviceDiscoveryScan(),
          "snmpConfigs",
        ),
      },
    ];
  }

  // The fields a JSON column keeps encrypted, as its model declares them.
  private static getEncryptedFields(
    model: NetworkDevice | NetworkDeviceDiscoveryScan,
    column: string,
  ): Array<string> {
    return [...(model.getTableColumnMetadata(column).encryptedFields || [])];
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
