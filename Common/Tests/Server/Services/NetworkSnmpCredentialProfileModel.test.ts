import fs from "fs";
import path from "path";
import { afterEach, describe, expect, test } from "@jest/globals";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { getMetadataArgsStorage } from "typeorm";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSnmpCredentialProfile from "../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import Project from "../../../Models/DatabaseModels/Project";
import NetworkSnmpCredentialProfileService from "../../../Server/Services/NetworkSnmpCredentialProfileService";
import Services from "../../../Server/Services/Index";
import Encryption from "../../../Server/Utils/Encryption";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import ColumnType from "../../../Types/Database/ColumnType";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getUniqueColumnBy } from "../../../Types/Database/UniqueColumnBy";
import GenericFunction from "../../../Types/GenericFunction";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";

/*
 * NetworkSnmpCredentialProfile: the contracts that live in decorator metadata
 * and in wiring, which no functional test would notice losing.
 *
 * A profile is a row of SNMP credentials that devices and sites point at
 * instead of carrying their own, and the poller resolves them in a fixed
 * order: the device's columns, then the device's profile, then the site's
 * profile. Three properties of the table are what make that safe to ship:
 *
 *  1. THE SECRETS ARE EXACTLY AS RESTRICTED AS THEY WERE ON THE DEVICE. The
 *     community string and the two v3 keys were already hidden from Viewer
 *     and SettingsViewer on NetworkDevice, and never selectable through a
 *     relation. Moving them onto a row that devices and sites JOIN is the
 *     obvious way to leak them: a device listing that selects
 *     `snmpCredentialProfile: { snmpCommunityString: true }` must be refused
 *     for the same callers it was refused for before. So the three columns
 *     are compared against the device's, permission for permission.
 *
 *  2. THE SECRETS ARE ENCRYPTED AT REST. `encrypted: true` on exactly those
 *     three columns is what makes DatabaseService encrypt them on every
 *     write and decrypt them on every server-side read. Drop the flag from
 *     one and that column silently goes back to plaintext in the database
 *     with nothing else changing; add it to a fourth and a column nobody
 *     expected to be ciphertext becomes unreadable through any path that
 *     bypasses the service. The list is pinned exactly, and the round trip
 *     is exercised through the service's own encrypt and decrypt steps.
 *
 *  3. DELETING A PROFILE NEVER DELETES WHAT USES IT. Both foreign keys are
 *     ON DELETE SET NULL, so deleting a profile drops its devices and sites
 *     down the resolution order instead of taking them with it. A CASCADE on
 *     either - the action most NetworkDevice relations use - would make
 *     deleting "Branch v2c" delete every branch switch.
 *
 * Nothing here touches a database: the model is instantiated and read for
 * its decorator metadata, the repository is stubbed for the one read that
 * exercises decryption, and the router registration that lives in another
 * workspace is read off the source.
 */

/*
 * The API router lives in the App workspace, which this suite cannot import.
 * It is read as text - the same thing the other wiring tests in this
 * directory do - so the assertion is on the registration itself rather than
 * on a re-export somebody could add to make it pass.
 */
const BASE_API_INDEX_SOURCE: string = fs.readFileSync(
  path.join(__dirname, "../../../../App/FeatureSet/BaseAPI/Index.ts"),
  "utf8",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROFILE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const SECRET_COLUMNS: ReadonlyArray<string> = [
  "snmpCommunityString",
  "snmpV3AuthKey",
  "snmpV3PrivKey",
];

const NON_SECRET_CREDENTIAL_COLUMNS: ReadonlyArray<string> = [
  "snmpVersion",
  "snmpPort",
  "snmpV3SecurityLevel",
  "snmpV3Username",
  "snmpV3AuthProtocol",
  "snmpV3PrivProtocol",
];

/*
 * Every column an operator writes on the profile form, and the two audit
 * relations. `_id`, `createdAt` and the rest come from BaseModel and are not
 * listed - the test that walks every column reads them from the model.
 */
const DECLARED_COLUMNS: ReadonlyArray<string> = [
  "project",
  "projectId",
  "name",
  "description",
  ...NON_SECRET_CREDENTIAL_COLUMNS,
  ...SECRET_COLUMNS,
  "createdByUser",
  "createdByUserId",
  "deletedByUser",
  "deletedByUserId",
];

function profile(): NetworkSnmpCredentialProfile {
  return new NetworkSnmpCredentialProfile();
}

function relationArgs(
  target: GenericFunction,
  propertyName: string,
): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === target && relation.propertyName === propertyName
      );
    },
  );
}

function columnArgs(
  target: GenericFunction,
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === target && column.propertyName === propertyName;
    },
  );
}

function accessControlFor(
  model: BaseModel,
  columnName: string,
): ColumnAccessControl {
  const accessControl: ColumnAccessControl | null =
    model.getColumnAccessControlFor(columnName);

  expect(accessControl).not.toBeNull();

  return accessControl as ColumnAccessControl;
}

function sorted(permissions: ReadonlyArray<Permission>): Array<string> {
  return permissions
    .map((permission: Permission): string => {
      return permission.toString();
    })
    .sort();
}

/*
 * The device's read list for a column, with the device's own granular
 * permission swapped for the profile's. That is the ONLY difference the
 * profile is allowed to have from the device on a secret column.
 */
function deviceReadListAsProfile(columnName: string): Array<string> {
  return sorted(
    accessControlFor(new NetworkDevice(), columnName).read.map(
      (permission: Permission): Permission => {
        return permission === Permission.ReadNetworkDevice
          ? Permission.ReadNetworkSnmpCredentialProfile
          : permission;
      },
    ),
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkSnmpCredentialProfile is a project-scoped, API-exposed table", () => {
  /*
   * The tenant column is what makes every read, write and permission check
   * project-scoped by default. Without it a credential table is global, and
   * one project's community strings are readable from another.
   */
  test("it is scoped to a project by projectId", () => {
    expect(profile().getTenantColumn()).toBe("projectId");
  });

  test("it is served at /network-snmp-credential-profile", () => {
    expect(profile().getCrudApiPath()?.toString()).toBe(
      "/network-snmp-credential-profile",
    );
  });

  test("it maps to the NetworkSnmpCredentialProfile table", () => {
    expect(profile().tableName).toBe("NetworkSnmpCredentialProfile");
  });

  /*
   * A model that is not in AllModelTypes gets no table created for it and no
   * permission catalogue coverage - and the two relations that already point
   * at it from NetworkDevice and NetworkSite would fail at connection time.
   */
  test("the model is registered", () => {
    expect(AllModelTypes).toContain(NetworkSnmpCredentialProfile);
  });

  test("the service is registered", () => {
    expect(Services).toContain(NetworkSnmpCredentialProfileService);
  });

  test("the CRUD router is mounted in the API", () => {
    expect(BASE_API_INDEX_SOURCE).toContain(
      'import NetworkSnmpCredentialProfile from "Common/Models/DatabaseModels/NetworkSnmpCredentialProfile";',
    );
    /*
     * Matched with whitespace wildcards rather than as a literal, because
     * prettier decides how the generic and its arguments wrap and that must
     * not be what this test is about.
     */
    expect(BASE_API_INDEX_SOURCE).toMatch(
      /new BaseAPI<\s*NetworkSnmpCredentialProfile,\s*NetworkSnmpCredentialProfileServiceType\s*>\(\s*NetworkSnmpCredentialProfile,\s*NetworkSnmpCredentialProfileService,?\s*\)\.getRouter\(\)/,
    );
  });
});

describe("the columns", () => {
  test("every column the form writes is declared", () => {
    const model: NetworkSnmpCredentialProfile = profile();

    for (const columnName of DECLARED_COLUMNS) {
      expect(model.getTableColumns().hasColumn(columnName)).toBe(true);
    }
  });

  /*
   * Required is EXACTLY name and projectId. Every credential column is
   * optional on purpose: a v2c profile has no username, a v3 profile has no
   * community string, and a noAuthNoPriv profile has no keys. Making any of
   * them required would make one of those shapes impossible to save, and
   * a profile with no credentials at all is a legitimate "attach now, fill
   * in later" state - the poller's predicate, not the schema, decides when
   * it is usable.
   */
  test("required columns are exactly name and projectId", () => {
    expect(profile().getRequiredColumns().columns.sort()).toEqual([
      "name",
      "projectId",
    ]);
  });

  /*
   * No slug, and no @SlugifyColumn. A profile is never addressed by URL
   * slug - it is picked from a dropdown on a device or a site - and a slug
   * column would be one more thing that has to stay unique per project for
   * no reader.
   */
  test("there is no slug column", () => {
    expect(profile().getTableColumns().hasColumn("slug")).toBe(false);
    expect(profile().getSlugifyColumn()).toBeFalsy();
  });

  /*
   * Global uniqueness would mean the first project to create "Default v2c"
   * stops every other project from having one.
   */
  test("name is unique per project, not globally", () => {
    expect(getUniqueColumnBy(profile(), "name")).toBe("projectId");
  });

  test("name is a required ShortText readable through a relation, so listings can show it", () => {
    const metadata: TableColumnMetadata =
      profile().getTableColumnMetadata("name");

    expect(metadata.required).toBe(true);
    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.canReadOnRelationQuery).toBe(true);
  });

  test("project is a relation to Project that cascades on project delete", () => {
    const metadata: TableColumnMetadata =
      profile().getTableColumnMetadata("project");

    expect(metadata.type).toBe(TableColumnType.Entity);
    expect(metadata.modelType).toBe(Project);
    expect(metadata.manyToOneRelationColumn).toBe("projectId");
    expect(
      relationArgs(NetworkSnmpCredentialProfile, "project")?.options.onDelete,
    ).toBe("CASCADE");
  });
});

describe("the non-secret credential columns are the device's, column for column", () => {
  /*
   * The poller reads a device row and a profile row through one predicate,
   * and a profile has to be able to hold anything a device could. So each
   * non-secret credential column carries the same TableColumn type and the
   * same TypeORM column type, length and default as the device's column of
   * the same name. (The secret columns deliberately differ - see the next
   * block - because ciphertext does not fit in the device's varchar.)
   */
  test.each(NON_SECRET_CREDENTIAL_COLUMNS)(
    "%s has the same type, length and default as on NetworkDevice",
    (columnName: string) => {
      const profileMetadata: TableColumnMetadata =
        profile().getTableColumnMetadata(columnName);
      const deviceMetadata: TableColumnMetadata =
        new NetworkDevice().getTableColumnMetadata(columnName);

      expect(profileMetadata.type).toBe(deviceMetadata.type);
      expect(profileMetadata.required).toBe(false);
      expect(deviceMetadata.required).toBe(false);

      const profileColumn: ColumnMetadataArgs | undefined = columnArgs(
        NetworkSnmpCredentialProfile,
        columnName,
      );
      const deviceColumn: ColumnMetadataArgs | undefined = columnArgs(
        NetworkDevice,
        columnName,
      );

      expect(profileColumn).toBeDefined();
      expect(deviceColumn).toBeDefined();
      expect(profileColumn?.options.type).toBe(deviceColumn?.options.type);
      expect(profileColumn?.options.length).toBe(deviceColumn?.options.length);
      expect(profileColumn?.options.default).toBe(
        deviceColumn?.options.default,
      );
      expect(profileColumn?.options.nullable).toBe(true);
    },
  );

  /*
   * The two defaults are spelled out as well as compared, because they are
   * what a freshly created profile is polled with: "V2c" is the stored
   * spelling SnmpVersionUtil.parse expects, and 161 is the SNMP port.
   */
  test("snmpVersion defaults to V2c and snmpPort to 161", () => {
    expect(
      columnArgs(NetworkSnmpCredentialProfile, "snmpVersion")?.options.default,
    ).toBe("V2c");
    expect(
      columnArgs(NetworkSnmpCredentialProfile, "snmpPort")?.options.default,
    ).toBe(161);
    expect(
      columnArgs(NetworkSnmpCredentialProfile, "snmpPort")?.options.type,
    ).toBe(ColumnType.Number);
  });
});

describe("the three secret columns are encrypted at rest", () => {
  /*
   * THE LIST, EXACTLY. getEncryptedColumns() is what DatabaseService.encrypt
   * and DatabaseService.decrypt iterate, so this single assertion is the
   * whole of "which columns are ciphertext in the database". Compared as a
   * sorted array rather than three toContain checks so that a fourth column
   * picking up the flag - the username, say, which the poller and the UI
   * both expect to read as plain text - fails here rather than in
   * production.
   */
  test("exactly snmpCommunityString, snmpV3AuthKey and snmpV3PrivKey are encrypted", () => {
    expect(profile().getEncryptedColumns().columns.sort()).toEqual(
      [...SECRET_COLUMNS].sort(),
    );
  });

  test.each(SECRET_COLUMNS)(
    "%s carries encrypted: true",
    (columnName: string) => {
      expect(profile().getTableColumnMetadata(columnName).encrypted).toBe(true);
    },
  );

  test.each([...NON_SECRET_CREDENTIAL_COLUMNS, "name", "description"])(
    "%s, by contrast, is stored as plain text",
    (columnName: string) => {
      expect(
        profile().getTableColumnMetadata(columnName).encrypted,
      ).toBeFalsy();
    },
  );

  /*
   * Ciphertext is salted base64, two to three times the plaintext, so an
   * encrypted column cannot be the device's varchar(100): a long community
   * string would overflow it on write. Every other encrypted text column in
   * the schema is `text` for the same reason, and these three follow.
   */
  test.each(SECRET_COLUMNS)(
    "%s is a nullable, defaultless text column, because ciphertext is longer than plaintext",
    (columnName: string) => {
      const metadata: TableColumnMetadata =
        profile().getTableColumnMetadata(columnName);

      expect(metadata.type).toBe(TableColumnType.VeryLongText);
      expect(metadata.required).toBe(false);

      const column: ColumnMetadataArgs | undefined = columnArgs(
        NetworkSnmpCredentialProfile,
        columnName,
      );

      expect(column).toBeDefined();
      expect(column?.options.type).toBe(ColumnType.VeryLongText);
      expect(column?.options.nullable).toBe(true);
      expect(column?.options.default).toBeUndefined();
      expect(column?.options.length).toBeUndefined();
    },
  );

  /*
   * The device's own three columns are NOT encrypted: they predate
   * encryption at rest, still hold plaintext in a varchar, and bringing them
   * in line means re-encrypting every existing row in a separate migration.
   * This pins the gap the model's WHY comment describes; when that migration
   * lands, this test flips and the comment can go with it.
   */
  test.each(SECRET_COLUMNS)(
    "the device's own %s is still plaintext - a separate migration, not this table's job",
    (columnName: string) => {
      expect(
        new NetworkDevice().getTableColumnMetadata(columnName).encrypted,
      ).toBeFalsy();
    },
  );
});

describe("the secrets round-trip through the service's encrypt and decrypt", () => {
  type ServiceCryptoInternals = {
    encrypt: (
      data: NetworkSnmpCredentialProfile,
    ) => Promise<NetworkSnmpCredentialProfile>;
    decrypt: (
      data: NetworkSnmpCredentialProfile,
    ) => Promise<NetworkSnmpCredentialProfile>;
  };

  const internals: ServiceCryptoInternals =
    NetworkSnmpCredentialProfileService as unknown as ServiceCryptoInternals;

  function plaintextProfile(): NetworkSnmpCredentialProfile {
    const row: NetworkSnmpCredentialProfile = profile();
    row.id = PROFILE_ID;
    row.projectId = PROJECT_ID;
    row.name = "Branch v3";
    row.snmpVersion = "V3";
    row.snmpV3Username = "monitoring";
    row.snmpCommunityString = "public";
    row.snmpV3AuthKey = "auth-passphrase";
    row.snmpV3PrivKey = "priv-passphrase";

    return row;
  }

  /*
   * DatabaseService.encrypt is the step every create and update runs after
   * the service's own hooks. Driving it directly pins that the model's
   * metadata - not anything in the service - is what turns the three secrets
   * into ciphertext, and that nothing else on the row is touched.
   */
  test("the create/update encrypt step turns exactly the three secrets into ciphertext", async () => {
    const row: NetworkSnmpCredentialProfile = plaintextProfile();

    const encrypted: NetworkSnmpCredentialProfile =
      await internals.encrypt(row);

    expect(encrypted.snmpCommunityString).not.toBe("public");
    expect(encrypted.snmpV3AuthKey).not.toBe("auth-passphrase");
    expect(encrypted.snmpV3PrivKey).not.toBe("priv-passphrase");

    expect(await Encryption.decrypt(encrypted.snmpCommunityString!)).toBe(
      "public",
    );
    expect(await Encryption.decrypt(encrypted.snmpV3AuthKey!)).toBe(
      "auth-passphrase",
    );
    expect(await Encryption.decrypt(encrypted.snmpV3PrivKey!)).toBe(
      "priv-passphrase",
    );

    expect(encrypted.name).toBe("Branch v3");
    expect(encrypted.snmpVersion).toBe("V3");
    expect(encrypted.snmpV3Username).toBe("monitoring");
  });

  test("the find decrypt step hands the plaintext back", async () => {
    const stored: NetworkSnmpCredentialProfile =
      await internals.encrypt(plaintextProfile());

    const decrypted: NetworkSnmpCredentialProfile =
      await internals.decrypt(stored);

    expect(decrypted.snmpCommunityString).toBe("public");
    expect(decrypted.snmpV3AuthKey).toBe("auth-passphrase");
    expect(decrypted.snmpV3PrivKey).toBe("priv-passphrase");
  });

  /*
   * An unset secret must stay unset rather than becoming the ciphertext of
   * "" - a v2c profile has no keys and a v3 profile has no community
   * string, and the poller's predicate reads absence as absence.
   */
  test("an absent secret is left absent on both sides", async () => {
    const row: NetworkSnmpCredentialProfile = profile();
    row.name = "v2c only";
    row.snmpVersion = "V2c";
    row.snmpCommunityString = "public";

    const encrypted: NetworkSnmpCredentialProfile =
      await internals.encrypt(row);

    expect(encrypted.snmpV3AuthKey).toBeUndefined();
    expect(encrypted.snmpV3PrivKey).toBeUndefined();

    const decrypted: NetworkSnmpCredentialProfile =
      await internals.decrypt(encrypted);

    expect(decrypted.snmpV3AuthKey).toBeUndefined();
    expect(decrypted.snmpV3PrivKey).toBeUndefined();
    expect(decrypted.snmpCommunityString).toBe("public");
  });

  /*
   * The same thing through the public read path: a findBy as root, with the
   * repository stubbed to return a row exactly as the database holds it
   * (ciphertext), comes back plaintext. This is the read the poller makes.
   */
  test("a findBy as root returns the secrets decrypted", async () => {
    const stored: NetworkSnmpCredentialProfile =
      await internals.encrypt(plaintextProfile());

    jest
      .spyOn(NetworkSnmpCredentialProfileService, "getRepository")
      .mockReturnValue({
        find: async (): Promise<Array<NetworkSnmpCredentialProfile>> => {
          return [stored];
        },
      } as unknown as ReturnType<
        typeof NetworkSnmpCredentialProfileService.getRepository
      >);

    const rows: Array<NetworkSnmpCredentialProfile> =
      await NetworkSnmpCredentialProfileService.findBy({
        query: {
          projectId: PROJECT_ID,
        },
        select: {
          _id: true,
          snmpVersion: true,
          snmpV3Username: true,
          snmpCommunityString: true,
          snmpV3AuthKey: true,
          snmpV3PrivKey: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    expect(rows.length).toBe(1);
    expect(rows[0]!.snmpCommunityString).toBe("public");
    expect(rows[0]!.snmpV3AuthKey).toBe("auth-passphrase");
    expect(rows[0]!.snmpV3PrivKey).toBe("priv-passphrase");
    expect(rows[0]!.snmpV3Username).toBe("monitoring");
  });
});

describe("every column carries column access control", () => {
  /*
   * A column with no ColumnAccessControl is invisible to the permission
   * layer: it is neither readable nor writable by anybody, and the
   * generated API reference documents it as if it did not exist. Walking
   * every column THIS MODEL declares catches the one somebody adds without
   * it. BaseModel's own columns (_id, createdAt, version and the rest) are
   * excluded from the walk: they get their access control from the table's
   * permissions inside getColumnAccessControlForAllColumns, or are
   * server-managed and deliberately have none, and either way they are
   * BaseModel's business rather than this table's.
   */
  test("no column this model declares is missing its access control", () => {
    const model: NetworkSnmpCredentialProfile = profile();
    const inheritedColumns: Set<string> = new Set<string>(
      new BaseModel().getTableColumns().columns,
    );
    const declaredColumns: Array<string> = model
      .getTableColumns()
      .columns.filter((columnName: string): boolean => {
        return !inheritedColumns.has(columnName);
      });

    /*
     * The list at the top of the file is the whole of what this model adds.
     * If the walk finds a column that list does not know about, somebody
     * added one and this suite has nothing to say about it yet.
     */
    expect(declaredColumns.sort()).toEqual([...DECLARED_COLUMNS].sort());

    for (const columnName of declaredColumns) {
      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(columnName);

      expect(accessControl).not.toBeNull();
      expect(Array.isArray(accessControl?.read)).toBe(true);
      expect(Array.isArray(accessControl?.create)).toBe(true);
      expect(Array.isArray(accessControl?.update)).toBe(true);
    }
  });

  test("every declared column honours the granular read permission", () => {
    const model: NetworkSnmpCredentialProfile = profile();

    for (const columnName of DECLARED_COLUMNS) {
      expect(accessControlFor(model, columnName).read).toContain(
        Permission.ReadNetworkSnmpCredentialProfile,
      );
    }
  });

  /*
   * The audit columns are written by the server, never by the API. Granting
   * update on deletedByUserId would let a caller forge who deleted a row.
   */
  test.each(["deletedByUser", "deletedByUserId"])(
    "%s is server-owned: nobody may create or update it",
    (columnName: string) => {
      const accessControl: ColumnAccessControl = accessControlFor(
        profile(),
        columnName,
      );

      expect(accessControl.create).toEqual([]);
      expect(accessControl.update).toEqual([]);
    },
  );

  test.each(["project", "projectId", "createdByUser", "createdByUserId"])(
    "%s is set on create and never moved",
    (columnName: string) => {
      expect(accessControlFor(profile(), columnName).update).toEqual([]);
    },
  );
});

describe("the three secret columns are as restricted as the device's", () => {
  /*
   * Column for column, the profile's secret read list is the device's secret
   * read list with ReadNetworkDevice swapped for the profile's own granular
   * permission - nothing added, nothing removed. Compared as sorted arrays
   * rather than as a list of "must not contain" assertions, so a role added
   * to the device's list later shows up here as a diff to think about
   * rather than as a silent pass.
   */
  test.each(SECRET_COLUMNS)(
    "%s is exactly as restricted to read as it is on NetworkDevice",
    (columnName: string) => {
      expect(sorted(accessControlFor(profile(), columnName).read)).toEqual(
        deviceReadListAsProfile(columnName),
      );
    },
  );

  /*
   * ...which, spelled out, means Viewer and SettingsViewer cannot read them
   * while ProjectMember and the granular permission can. Both halves are
   * asserted: a list that excluded everybody would pass the "not Viewer"
   * check and lock the operator out of their own credentials.
   */
  test.each(SECRET_COLUMNS)(
    "%s is hidden from Viewer and SettingsViewer, and readable by members",
    (columnName: string) => {
      const read: Array<Permission> = accessControlFor(
        profile(),
        columnName,
      ).read;

      expect(read).not.toContain(Permission.Viewer);
      expect(read).not.toContain(Permission.SettingsViewer);
      expect(read).toContain(Permission.ProjectOwner);
      expect(read).toContain(Permission.ProjectAdmin);
      expect(read).toContain(Permission.ProjectMember);
      expect(read).toContain(Permission.ReadNetworkSnmpCredentialProfile);
    },
  );

  /*
   * Not selectable through a relation, exactly as on the device. This is
   * the property that makes a profile safe to JOIN: the device and site
   * listings select their profile's name and version through the relation,
   * and a select that reaches for a secret through it is refused for every
   * caller, not just the restricted ones.
   */
  test.each(SECRET_COLUMNS)(
    "%s is not readable on a relation query",
    (columnName: string) => {
      expect(
        profile().getTableColumnMetadata(columnName).canReadOnRelationQuery,
      ).toBeFalsy();
      expect(
        new NetworkDevice().getTableColumnMetadata(columnName)
          .canReadOnRelationQuery,
      ).toBeFalsy();
    },
  );

  /*
   * Secret to READ, not to write: the operator who may edit the profile may
   * set and rotate its secrets. A write list narrower than the row's would
   * make the form save everything except the credential.
   */
  test.each(SECRET_COLUMNS)(
    "%s can still be written by whoever can edit the profile",
    (columnName: string) => {
      const accessControl: ColumnAccessControl = accessControlFor(
        profile(),
        columnName,
      );

      expect(sorted(accessControl.create)).toEqual(
        sorted(profile().createRecordPermissions),
      );
      expect(sorted(accessControl.update)).toEqual(
        sorted(profile().updateRecordPermissions),
      );
    },
  );

  /*
   * The contrast is the point. The non-secret credential columns - version,
   * port, protocols, the v3 security NAME - are as readable as the row
   * itself, so a Viewer can see that a device is walked as "v3 authPriv as
   * monitoring" without seeing the keys.
   */
  test.each(NON_SECRET_CREDENTIAL_COLUMNS)(
    "%s, by contrast, is readable by Viewer and SettingsViewer",
    (columnName: string) => {
      const read: Array<Permission> = accessControlFor(
        profile(),
        columnName,
      ).read;

      expect(read).toContain(Permission.Viewer);
      expect(read).toContain(Permission.SettingsViewer);
      expect(sorted(read)).toEqual(sorted(profile().readRecordPermissions));
    },
  );
});

describe("deleting a profile detaches what uses it", () => {
  /*
   * NetworkDevice and NetworkSite both point at a profile, and both must
   * do so with ON DELETE SET NULL. The resolution order is what makes SET
   * NULL the right answer: a device whose profile is deleted falls through
   * to its site's profile, or to ping-only, which is exactly what "no
   * profile" has always meant. CASCADE would make deleting a credential set
   * delete the inventory that used it. (The service's delete guard is what
   * stops that fall-through happening by accident; the FK action is what
   * stops it deleting anything if the guard is ever bypassed.)
   */
  test("NetworkDevice points at the profile with SET NULL", () => {
    const metadata: TableColumnMetadata =
      new NetworkDevice().getTableColumnMetadata("snmpCredentialProfile");

    expect(metadata.type).toBe(TableColumnType.Entity);
    expect(metadata.modelType).toBe(NetworkSnmpCredentialProfile);
    expect(metadata.manyToOneRelationColumn).toBe("snmpCredentialProfileId");
    expect(
      relationArgs(NetworkDevice, "snmpCredentialProfile")?.options.onDelete,
    ).toBe("SET NULL");
  });

  test("NetworkSite points at the profile with SET NULL", () => {
    const metadata: TableColumnMetadata =
      new NetworkSite().getTableColumnMetadata("snmpCredentialProfile");

    expect(metadata.type).toBe(TableColumnType.Entity);
    expect(metadata.modelType).toBe(NetworkSnmpCredentialProfile);
    expect(metadata.manyToOneRelationColumn).toBe("snmpCredentialProfileId");
    expect(
      relationArgs(NetworkSite, "snmpCredentialProfile")?.options.onDelete,
    ).toBe("SET NULL");
  });

  test("the pointer on each is optional, because no profile means ping-only", () => {
    expect(
      new NetworkDevice().getTableColumnMetadata("snmpCredentialProfileId")
        .required,
    ).toBe(false);
    expect(
      new NetworkSite().getTableColumnMetadata("snmpCredentialProfileId")
        .required,
    ).toBe(false);
  });
});

describe("the four credential-profile permissions", () => {
  interface ProfilePermissionUnderTest {
    name: string;
    permission: Permission;
  }

  /*
   * The names are written out rather than derived from the enum, because
   * the stored value is the half that matters: a team's permission row
   * persists the string, so a value that ever drifts from its member name
   * orphans every grant already handed out.
   */
  const PROFILE_PERMISSIONS: Array<ProfilePermissionUnderTest> = [
    {
      name: "CreateNetworkSnmpCredentialProfile",
      permission: Permission.CreateNetworkSnmpCredentialProfile,
    },
    {
      name: "ReadNetworkSnmpCredentialProfile",
      permission: Permission.ReadNetworkSnmpCredentialProfile,
    },
    {
      name: "EditNetworkSnmpCredentialProfile",
      permission: Permission.EditNetworkSnmpCredentialProfile,
    },
    {
      name: "DeleteNetworkSnmpCredentialProfile",
      permission: Permission.DeleteNetworkSnmpCredentialProfile,
    },
  ];

  /*
   * A permission the enum declares but the catalogue does not describe
   * cannot be granted: the team-permission editor renders from
   * getAllPermissionProps, so a missing descriptor means the permission
   * exists, gates the model, and can never be handed to anybody.
   */
  test.each(PROFILE_PERMISSIONS)(
    "$name has a catalogue entry in the Monitor group",
    (entry: ProfilePermissionUnderTest) => {
      const descriptor: PermissionProps | undefined =
        PermissionHelper.getAllPermissionProps().find(
          (props: PermissionProps): boolean => {
            return props.permission === entry.permission;
          },
        );

      expect(descriptor).toBeDefined();
      /*
       * Monitor, not Settings: profiles are configured under Network next
       * to device roles and site types, and the group is what decides which
       * section of the permission editor they appear in.
       */
      expect(descriptor?.group).toBe(PermissionGroup.Monitor);
      expect(descriptor?.isAssignableToTenant).toBe(true);
      /*
       * The wording the editor shows. "SNMP Credential Profile", not the
       * enum member's "NetworkSnmpCredentialProfile", is what an operator
       * granting it is looking for.
       */
      expect(descriptor?.title).toContain("SNMP Credential Profile");
    },
  );

  test.each(PROFILE_PERMISSIONS)(
    "$name is stored under exactly its own name",
    (entry: ProfilePermissionUnderTest) => {
      expect(entry.permission.toString()).toBe(entry.name);
    },
  );

  /*
   * The table's own access control has to accept the granular permissions,
   * or granting "Create SNMP Credential Profile" to a team would grant
   * nothing at all - the catalogue entry would exist and the gate would
   * still refuse.
   */
  test("the model's table access control honours each of them", () => {
    const model: NetworkSnmpCredentialProfile = profile();

    expect(model.createRecordPermissions).toContain(
      Permission.CreateNetworkSnmpCredentialProfile,
    );
    expect(model.readRecordPermissions).toContain(
      Permission.ReadNetworkSnmpCredentialProfile,
    );
    expect(model.updateRecordPermissions).toContain(
      Permission.EditNetworkSnmpCredentialProfile,
    );
    expect(model.deleteRecordPermissions).toContain(
      Permission.DeleteNetworkSnmpCredentialProfile,
    );
  });

  /*
   * The row itself is readable by Viewer and SettingsViewer - they can see
   * that a profile exists and what it is called - while the write side is
   * members and up. The secret columns narrow the read side; nothing
   * narrows it at the table.
   */
  test("the row is readable by viewers and writable by members and up", () => {
    const model: NetworkSnmpCredentialProfile = profile();

    expect(model.readRecordPermissions).toContain(Permission.Viewer);
    expect(model.readRecordPermissions).toContain(Permission.SettingsViewer);

    for (const writeSide of [
      model.createRecordPermissions,
      model.updateRecordPermissions,
      model.deleteRecordPermissions,
    ]) {
      expect(writeSide).toContain(Permission.ProjectOwner);
      expect(writeSide).toContain(Permission.ProjectAdmin);
      expect(writeSide).toContain(Permission.ProjectMember);
      expect(writeSide).not.toContain(Permission.Viewer);
      expect(writeSide).not.toContain(Permission.SettingsViewer);
    }
  });
});
