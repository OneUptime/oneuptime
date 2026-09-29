import NetworkSnmpCredentialProfileService, {
  Service as NetworkSnmpCredentialProfileServiceType,
} from "../../../Server/Services/NetworkSnmpCredentialProfileService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import NetworkSnmpCredentialProfile from "../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import * as SnmpCredentialUtil from "../../../Utils/NetworkDevice/SnmpCredentialUtil";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * NetworkDeviceService and NetworkSiteService each import the complete
 * monitoring/alerting service graph. This suite tests the profile service at
 * its own boundary, so both collaborators are replaced before modules load;
 * the individual tests still assert every count made through the boundary.
 */
jest.mock("../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      countBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/NetworkSiteService", () => {
  return {
    __esModule: true,
    default: {
      countBy: jest.fn(),
    },
  };
});

/*
 * The service owns two things and this suite pins both.
 *
 * THE NAME is trimmed on the way in and a blank one is refused, on create
 * and on update alike. It is unique per project and is the label every
 * device and site listing shows for the profile it joins. Without the trim,
 * "Branch v2c" and "Branch v2c " are two profiles that render identically;
 * without the blank check, "   " sails past the required-column check (it
 * is a truthy string) and produces a profile with no visible name in every
 * picker.
 *
 * THE DELETE GUARD refuses to delete a profile any device or site still
 * points at. Both foreign keys are ON DELETE SET NULL, so without the guard
 * the delete succeeds and every device using the profile - directly, or
 * through its site - silently goes from walked to ping-only on its next
 * poll. The guard counts devices AND sites, reads as root but scoped to the
 * caller's tenant, and names both counts in one message.
 *
 * Nothing here touches a database. The hooks are called directly; the
 * service's own reads and the two collaborators' counts are spied.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROFILE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SECOND_PROFILE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

type ServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkSnmpCredentialProfile>,
  ) => Promise<OnCreate<NetworkSnmpCredentialProfile>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkSnmpCredentialProfile>,
  ) => Promise<OnUpdate<NetworkSnmpCredentialProfile>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<NetworkSnmpCredentialProfile>,
  ) => Promise<OnDelete<NetworkSnmpCredentialProfile>>;
};

function buildService(): {
  service: NetworkSnmpCredentialProfileServiceType;
  internals: ServiceInternals;
} {
  const service: NetworkSnmpCredentialProfileServiceType =
    new NetworkSnmpCredentialProfileServiceType();

  const internals: ServiceInternals = service as unknown as ServiceInternals;

  return { service, internals };
}

function createBy(
  name: string | undefined,
  extra?: Partial<NetworkSnmpCredentialProfile>,
): CreateBy<NetworkSnmpCredentialProfile> {
  const profile: NetworkSnmpCredentialProfile =
    new NetworkSnmpCredentialProfile();
  profile.projectId = PROJECT_ID;

  if (name !== undefined) {
    profile.name = name;
  }

  Object.assign(profile, extra || {});

  return {
    data: profile,
    props: { isRoot: true },
  } as CreateBy<NetworkSnmpCredentialProfile>;
}

function updateBy(
  data: Partial<Record<keyof NetworkSnmpCredentialProfile, unknown>>,
): UpdateBy<NetworkSnmpCredentialProfile> {
  return {
    query: { _id: PROFILE_ID.toString() },
    data: data,
    props: { isRoot: true },
    limit: new PositiveNumber(1),
    skip: new PositiveNumber(0),
  } as unknown as UpdateBy<NetworkSnmpCredentialProfile>;
}

function deleteBy(
  props: DatabaseCommonInteractionProps,
): DeleteBy<NetworkSnmpCredentialProfile> {
  return {
    query: { _id: PROFILE_ID.toString() },
    props: props,
    limit: new PositiveNumber(1),
    skip: new PositiveNumber(0),
  } as unknown as DeleteBy<NetworkSnmpCredentialProfile>;
}

/*
 * A row as the delete guard's own findBy returns it: id, name and projectId
 * selected, nothing else.
 */
function profileRow(data: {
  id?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  name?: string | undefined;
}): NetworkSnmpCredentialProfile {
  const profile: NetworkSnmpCredentialProfile =
    new NetworkSnmpCredentialProfile();

  if (data.id) {
    profile.id = data.id;
  }

  if (data.projectId) {
    profile.projectId = data.projectId;
  }

  profile.name = data.name ?? "Branch v2c";

  return profile;
}

/*
 * A caller who is NOT root: a project member deleting through the API. This
 * is the case the tenant scoping exists for.
 */
const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  isRoot: false,
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

const ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
};

/*
 * Every read the service inherits from DatabaseService, spied so a test can
 * assert the create and update hooks made none of them. A hook that reads
 * would need a database, and - more to the point - a hook that reads before
 * the permission check runs is how a tenant leak starts (see the delete
 * guard, which reads and therefore has to re-scope by hand).
 */
function spyOnReads(
  service: NetworkSnmpCredentialProfileServiceType,
): Array<jest.SpyInstance> {
  return [
    jest
      .spyOn(service, "findBy")
      .mockRejectedValue(new Error("findBy must not be called")),
    jest
      .spyOn(service, "findOneBy")
      .mockRejectedValue(new Error("findOneBy must not be called")),
    jest
      .spyOn(service, "countBy")
      .mockRejectedValue(new Error("countBy must not be called")),
  ];
}

function deviceCountBy(): jest.Mock {
  return NetworkDeviceService.countBy as unknown as jest.Mock;
}

function siteCountBy(): jest.Mock {
  return NetworkSiteService.countBy as unknown as jest.Mock;
}

function stubCounts(data: { devices: number; sites: number }): void {
  deviceCountBy().mockResolvedValue(new PositiveNumber(data.devices));
  siteCountBy().mockResolvedValue(new PositiveNumber(data.sites));
}

beforeEach(() => {
  deviceCountBy().mockReset();
  siteCountBy().mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("onBeforeCreate - the name", () => {
  test("is trimmed", async () => {
    const { internals } = buildService();

    const result: OnCreate<NetworkSnmpCredentialProfile> =
      await internals.onBeforeCreate(createBy("  Branch offices v2c  "));

    expect(result.createBy.data.name).toBe("Branch offices v2c");
  });

  test("is returned unchanged when it has nothing to trim", async () => {
    const { internals } = buildService();

    const result: OnCreate<NetworkSnmpCredentialProfile> =
      await internals.onBeforeCreate(createBy("Core switches v3"));

    expect(result.createBy.data.name).toBe("Core switches v3");
  });

  /*
   * Interior whitespace is part of the name. "Branch  offices" with two
   * spaces is odd but is what the operator typed; only the edges are
   * anybody's business.
   */
  test("keeps interior whitespace", async () => {
    const { internals } = buildService();

    const result: OnCreate<NetworkSnmpCredentialProfile> =
      await internals.onBeforeCreate(createBy(" Branch  offices "));

    expect(result.createBy.data.name).toBe("Branch  offices");
  });

  test.each(["", " ", "   ", "\t", "\n", " \t\n "])(
    "a blank name %p is refused",
    async (name: string) => {
      const { internals } = buildService();

      await expect(internals.onBeforeCreate(createBy(name))).rejects.toThrow(
        BadDataException,
      );
    },
  );

  /*
   * The required-column check in DatabaseService also refuses an undefined
   * name, but it runs after this hook, and the hook must not crash on the
   * way there with a TypeError from calling trim() on undefined.
   */
  test("a missing name is refused with a BadDataException, not a TypeError", async () => {
    const { internals } = buildService();

    await expect(internals.onBeforeCreate(createBy(undefined))).rejects.toThrow(
      BadDataException,
    );
  });

  test("the refusal names the profile so the form can show it", async () => {
    const { internals } = buildService();

    await expect(internals.onBeforeCreate(createBy("   "))).rejects.toThrow(
      /SNMP Credential Profile name/,
    );
  });
});

describe("onBeforeCreate - everything that is not the name", () => {
  /*
   * The secrets are passed through byte for byte. A community string or a
   * passphrase may legitimately begin or end with whitespace, and a service
   * that "helpfully" trimmed one would produce a profile that never
   * authenticates, with nothing anywhere to say why. (Encryption at rest
   * happens in DatabaseService AFTER this hook, on the value as returned
   * here - so what this hook returns is what gets encrypted.)
   */
  test("the credentials are not trimmed or otherwise touched", async () => {
    const { internals } = buildService();

    const result: OnCreate<NetworkSnmpCredentialProfile> =
      await internals.onBeforeCreate(
        createBy("Branch", {
          snmpVersion: "V3",
          snmpCommunityString: " public ",
          snmpPort: 1161,
          snmpV3SecurityLevel: "authPriv",
          snmpV3Username: " monitoring ",
          snmpV3AuthProtocol: "SHA",
          snmpV3AuthKey: " auth key with spaces ",
          snmpV3PrivProtocol: "AES",
          snmpV3PrivKey: " priv key with spaces ",
        }),
      );

    expect(result.createBy.data.snmpVersion).toBe("V3");
    expect(result.createBy.data.snmpCommunityString).toBe(" public ");
    expect(result.createBy.data.snmpPort).toBe(1161);
    expect(result.createBy.data.snmpV3SecurityLevel).toBe("authPriv");
    expect(result.createBy.data.snmpV3Username).toBe(" monitoring ");
    expect(result.createBy.data.snmpV3AuthProtocol).toBe("SHA");
    expect(result.createBy.data.snmpV3AuthKey).toBe(" auth key with spaces ");
    expect(result.createBy.data.snmpV3PrivProtocol).toBe("AES");
    expect(result.createBy.data.snmpV3PrivKey).toBe(" priv key with spaces ");
  });

  /*
   * A profile with no credentials at all is allowed. It is a name an
   * operator can attach to devices now and fill in later, and the poller's
   * predicate (hasUsableCredentials) is what decides it is not yet usable -
   * refusing it here would just move the empty state to the form.
   */
  test("a profile with no credentials is accepted", async () => {
    const { internals } = buildService();

    const result: OnCreate<NetworkSnmpCredentialProfile> =
      await internals.onBeforeCreate(createBy("Not yet configured"));

    expect(result.createBy.data.name).toBe("Not yet configured");
  });

  test("it carries nothing forward and makes no database read", async () => {
    const { service, internals } = buildService();
    const reads: Array<jest.SpyInstance> = spyOnReads(service);

    const result: OnCreate<NetworkSnmpCredentialProfile> =
      await internals.onBeforeCreate(createBy("Branch"));

    expect(result.carryForward).toBeNull();

    for (const read of reads) {
      expect(read).not.toHaveBeenCalled();
    }
  });
});

describe("onBeforeUpdate - the name", () => {
  test("is trimmed when the update carries one", async () => {
    const { internals } = buildService();

    const result: OnUpdate<NetworkSnmpCredentialProfile> =
      await internals.onBeforeUpdate(updateBy({ name: "  Renamed  " }));

    expect(result.updateBy.data.name).toBe("Renamed");
  });

  test.each(["", "   ", "\t\n"])(
    "a blank name %p is refused",
    async (name: string) => {
      const { internals } = buildService();

      await expect(
        internals.onBeforeUpdate(updateBy({ name: name })),
      ).rejects.toThrow(BadDataException);
    },
  );

  /*
   * null is what a form sends when a field is cleared, and PartialEntity
   * allows it on every column. On the name it means "no name", which the
   * NOT NULL constraint would reject anyway - but as a database error, not
   * a form error. Refuse it here, where the message reaches the operator.
   */
  test("a null name is refused as blank rather than left for the database", async () => {
    const { internals } = buildService();

    await expect(
      internals.onBeforeUpdate(updateBy({ name: null })),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * PartialEntity also allows a `() => string` on any column, which is the
   * raw-SQL-expression escape hatch. A label built from a SQL expression is
   * not a thing, and letting one through would bypass both the trim and the
   * blank check.
   */
  test("a raw SQL expression is not accepted as a name", async () => {
    const { internals } = buildService();

    await expect(
      internals.onBeforeUpdate(
        updateBy({
          name: (): string => {
            return "UPPER(name)";
          },
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });
});

describe("onBeforeUpdate - updates that do not mention the name", () => {
  /*
   * THE CASE THAT MATTERS MOST for update. Rotating a community string is
   * the whole reason profiles exist, and it is an update whose data has no
   * `name` key at all. The hook must recognise "not mentioned" (undefined)
   * as distinct from "blank" and leave the row's name alone - a truthiness
   * check here would refuse every credential rotation as a blank rename.
   */
  test("a credential rotation passes through with the name untouched", async () => {
    const { internals } = buildService();

    const result: OnUpdate<NetworkSnmpCredentialProfile> =
      await internals.onBeforeUpdate(
        updateBy({ snmpCommunityString: "rotated-2026" }),
      );

    expect(result.updateBy.data.snmpCommunityString).toBe("rotated-2026");
    expect("name" in result.updateBy.data).toBe(false);
  });

  test("a description-only edit passes through", async () => {
    const { internals } = buildService();

    const result: OnUpdate<NetworkSnmpCredentialProfile> =
      await internals.onBeforeUpdate(
        updateBy({ description: "Used by the branch switches." }),
      );

    expect(result.updateBy.data.description).toBe(
      "Used by the branch switches.",
    );
    expect(result.updateBy.data.name).toBeUndefined();
  });

  test("the credentials are not trimmed on update either", async () => {
    const { internals } = buildService();

    const result: OnUpdate<NetworkSnmpCredentialProfile> =
      await internals.onBeforeUpdate(
        updateBy({
          name: " Renamed ",
          snmpV3AuthKey: " key with spaces ",
          snmpV3PrivKey: " other key ",
        }),
      );

    expect(result.updateBy.data.name).toBe("Renamed");
    expect(result.updateBy.data.snmpV3AuthKey).toBe(" key with spaces ");
    expect(result.updateBy.data.snmpV3PrivKey).toBe(" other key ");
  });

  test("it carries nothing forward and makes no database read", async () => {
    const { service, internals } = buildService();
    const reads: Array<jest.SpyInstance> = spyOnReads(service);

    const result: OnUpdate<NetworkSnmpCredentialProfile> =
      await internals.onBeforeUpdate(updateBy({ name: "Renamed" }));

    expect(result.carryForward).toBeNull();

    for (const read of reads) {
      expect(read).not.toHaveBeenCalled();
    }
  });
});

describe("onBeforeDelete - a profile still in use cannot be deleted", () => {
  const EXPECTED_MESSAGE: (devices: number, sites: number) => string = (
    devices: number,
    sites: number,
  ): string => {
    return `This SNMP Credential Profile is used by ${devices} devices and ${sites} sites. Remove it from them first, or point them at another profile.`;
  };

  test("refused when devices point at it", async () => {
    const { service, internals } = buildService();
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        profileRow({ id: PROFILE_ID, projectId: PROJECT_ID }),
      ]);
    stubCounts({ devices: 3, sites: 0 });

    await expect(
      internals.onBeforeDelete(deleteBy(MEMBER_PROPS)),
    ).rejects.toThrow(BadDataException);
    await expect(
      internals.onBeforeDelete(deleteBy(MEMBER_PROPS)),
    ).rejects.toThrow(EXPECTED_MESSAGE(3, 0));
  });

  /*
   * THE CASE THE SITE COUNT EXISTS FOR. A site can hold the only reference
   * to a profile while no device points at it directly - "set it once per
   * site" means most devices never will - and the device count alone says
   * this delete is safe when it is not.
   */
  test("refused when only sites point at it", async () => {
    const { service, internals } = buildService();
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        profileRow({ id: PROFILE_ID, projectId: PROJECT_ID }),
      ]);
    stubCounts({ devices: 0, sites: 2 });

    await expect(
      internals.onBeforeDelete(deleteBy(MEMBER_PROPS)),
    ).rejects.toThrow(EXPECTED_MESSAGE(0, 2));
  });

  /*
   * Both counts in one message, not the first non-zero one: the operator
   * should learn everything that has to move before the delete can go
   * through, rather than clearing the devices and then being told about
   * the sites.
   */
  test("refused naming both counts when both point at it", async () => {
    const { service, internals } = buildService();
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        profileRow({ id: PROFILE_ID, projectId: PROJECT_ID }),
      ]);
    stubCounts({ devices: 7, sites: 1 });

    await expect(
      internals.onBeforeDelete(deleteBy(MEMBER_PROPS)),
    ).rejects.toThrow(EXPECTED_MESSAGE(7, 1));
  });

  test("allowed when neither devices nor sites point at it", async () => {
    const { service, internals } = buildService();
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        profileRow({ id: PROFILE_ID, projectId: PROJECT_ID }),
      ]);
    stubCounts({ devices: 0, sites: 0 });

    const input: DeleteBy<NetworkSnmpCredentialProfile> =
      deleteBy(MEMBER_PROPS);
    const result: OnDelete<NetworkSnmpCredentialProfile> =
      await internals.onBeforeDelete(input);

    expect(result.deleteBy).toBe(input);
    expect(result.carryForward).toBeNull();
    expect(deviceCountBy()).toHaveBeenCalledTimes(1);
    expect(siteCountBy()).toHaveBeenCalledTimes(1);
  });

  test("a delete that matches no profile is allowed without counting anything", async () => {
    const { service, internals } = buildService();
    jest.spyOn(service, "findBy").mockResolvedValue([]);

    await internals.onBeforeDelete(deleteBy(MEMBER_PROPS));

    expect(deviceCountBy()).not.toHaveBeenCalled();
    expect(siteCountBy()).not.toHaveBeenCalled();
  });

  /*
   * A row the guard's own select could not fill in (no id, or no project)
   * cannot be counted against and must not crash the hook. The database's
   * own constraints make such a row impossible in practice; this pins that
   * the loop is defensive rather than trusting.
   */
  test("a row without an id or a project is skipped rather than counted", async () => {
    const { service, internals } = buildService();
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        profileRow({ id: undefined, projectId: PROJECT_ID }),
        profileRow({ id: PROFILE_ID, projectId: undefined }),
      ]);
    stubCounts({ devices: 99, sites: 99 });

    await internals.onBeforeDelete(deleteBy(MEMBER_PROPS));

    expect(deviceCountBy()).not.toHaveBeenCalled();
    expect(siteCountBy()).not.toHaveBeenCalled();
  });

  test("with several profiles, the first one in use stops the whole delete", async () => {
    const { service, internals } = buildService();
    jest.spyOn(service, "findBy").mockResolvedValue([
      profileRow({ id: PROFILE_ID, projectId: PROJECT_ID, name: "Unused" }),
      profileRow({
        id: SECOND_PROFILE_ID,
        projectId: PROJECT_ID,
        name: "In use",
      }),
    ]);
    deviceCountBy()
      .mockResolvedValueOnce(new PositiveNumber(0))
      .mockResolvedValueOnce(new PositiveNumber(4));
    siteCountBy()
      .mockResolvedValueOnce(new PositiveNumber(0))
      .mockResolvedValueOnce(new PositiveNumber(0));

    await expect(
      internals.onBeforeDelete(deleteBy(MEMBER_PROPS)),
    ).rejects.toThrow(EXPECTED_MESSAGE(4, 0));
  });
});

describe("onBeforeDelete - the counts come from tenant-scoped queries", () => {
  /*
   * The hook runs BEFORE DatabaseService applies the caller's tenant to the
   * delete query, and it reads as root so that it sees every profile the
   * delete would touch. Root plus the caller's raw query would hand back
   * other tenants' profiles - and then count other tenants' devices against
   * them. The caller's tenant is re-applied by hand.
   */
  test("the profiles are read as root, with the caller's tenant re-applied to the query", async () => {
    const { service, internals } = buildService();
    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([]);

    await internals.onBeforeDelete(deleteBy(MEMBER_PROPS));

    expect(findBySpy).toHaveBeenCalledTimes(1);

    const call: {
      query: Record<string, unknown>;
      props: { isRoot?: boolean };
    } = findBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: { isRoot?: boolean };
    };

    expect(call.props.isRoot).toBe(true);
    expect(call.query["_id"]).toBe(PROFILE_ID.toString());
    expect(call.query["projectId"]).toBe(PROJECT_ID);
  });

  test("a root caller's query is passed through untouched", async () => {
    const { service, internals } = buildService();
    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([]);

    await internals.onBeforeDelete(deleteBy(ROOT_PROPS));

    const call: { query: Record<string, unknown> } = findBySpy.mock
      .calls[0]![0] as { query: Record<string, unknown> };

    expect(call.query).toEqual({ _id: PROFILE_ID.toString() });
  });

  /*
   * The device and site counts are keyed on the PROFILE'S project, not the
   * caller's, and on the profile's id: "how many rows in this project point
   * at this row". Root, because the member deleting a profile is not
   * necessarily allowed to read every device, and a partial count would let
   * the delete through with devices still attached.
   */
  test("devices and sites are counted as root, in the profile's project, by profile id", async () => {
    const { service, internals } = buildService();
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        profileRow({ id: PROFILE_ID, projectId: OTHER_PROJECT_ID }),
      ]);
    stubCounts({ devices: 0, sites: 0 });

    await internals.onBeforeDelete(deleteBy(MEMBER_PROPS));

    for (const countBy of [deviceCountBy(), siteCountBy()]) {
      expect(countBy).toHaveBeenCalledTimes(1);

      const call: {
        query: Record<string, unknown>;
        props: { isRoot?: boolean };
      } = countBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        props: { isRoot?: boolean };
      };

      expect(call.props.isRoot).toBe(true);
      /*
       * Compared by value: BaseModel.id is a getter that mints a fresh
       * ObjectID from _id on every read, so the instance the service passed
       * is never the one this test holds.
       */
      expect(String(call.query["snmpCredentialProfileId"])).toBe(
        PROFILE_ID.toString(),
      );
      expect(String(call.query["projectId"])).toBe(OTHER_PROJECT_ID.toString());
      expect(Object.keys(call.query).sort()).toEqual([
        "projectId",
        "snmpCredentialProfileId",
      ]);
    }
  });

  test("each profile being deleted is counted separately", async () => {
    const { service, internals } = buildService();
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        profileRow({ id: PROFILE_ID, projectId: PROJECT_ID }),
        profileRow({ id: SECOND_PROFILE_ID, projectId: PROJECT_ID }),
      ]);
    stubCounts({ devices: 0, sites: 0 });

    await internals.onBeforeDelete(deleteBy(MEMBER_PROPS));

    const countedProfileIds: (countBy: jest.Mock) => Array<string> = (
      countBy: jest.Mock,
    ): Array<string> => {
      return countBy.mock.calls.map((call: Array<unknown>): string => {
        return (
          (call[0] as { query: { snmpCredentialProfileId: ObjectID } }).query
            .snmpCredentialProfileId as ObjectID
        ).toString();
      });
    };

    expect(countedProfileIds(deviceCountBy())).toEqual([
      PROFILE_ID.toString(),
      SECOND_PROFILE_ID.toString(),
    ]);
    expect(countedProfileIds(siteCountBy())).toEqual([
      PROFILE_ID.toString(),
      SECOND_PROFILE_ID.toString(),
    ]);
  });
});

describe("hasUsableCredentials on the service", () => {
  /*
   * The service exposes the predicate for callers that hold a service and
   * not the util, and it must be THE predicate - the same function the
   * poller applies to a device row - not a second opinion that could drift.
   * Spying on the util's export pins the delegation.
   */
  test("delegates to the shared util, so a device and a profile get one answer", () => {
    const spy: jest.SpyInstance = jest
      .spyOn(SnmpCredentialUtil, "hasUsableCredentials")
      .mockReturnValue(true);

    const profile: NetworkSnmpCredentialProfile =
      new NetworkSnmpCredentialProfile();
    profile.snmpVersion = "V3";
    profile.snmpV3Username = "monitoring";

    expect(
      NetworkSnmpCredentialProfileService.hasUsableCredentials(profile),
    ).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(profile);
  });

  test("answers for a real profile without a spy", () => {
    const usable: NetworkSnmpCredentialProfile =
      new NetworkSnmpCredentialProfile();
    usable.snmpVersion = "V2c";
    usable.snmpCommunityString = "public";

    const unusable: NetworkSnmpCredentialProfile =
      new NetworkSnmpCredentialProfile();
    unusable.snmpVersion = "V2c";
    unusable.snmpCommunityString = "   ";

    expect(
      NetworkSnmpCredentialProfileService.hasUsableCredentials(usable),
    ).toBe(true);
    expect(
      NetworkSnmpCredentialProfileService.hasUsableCredentials(unusable),
    ).toBe(false);
  });
});
