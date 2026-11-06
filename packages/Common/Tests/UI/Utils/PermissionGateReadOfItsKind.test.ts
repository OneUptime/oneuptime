import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What a list names to someone who may read none of it (#5485's follow-up:
 * "The Probe no-access sentence names 22 permissions").
 *
 * Probe's read list is whoever may pick a probe as well as whoever reads
 * one: the permissions that create, edit or read monitors, monitor probes,
 * network devices and their discovery scans, network sites and vCenters,
 * and the operational-resource wildcards. A list's no-access state named
 * them all - "You need one of these permissions: Read Probe, Create
 * Monitor, Edit Monitor, ... Read vCenter." - where the one to ask for to
 * read the Probes list is Read Probe. It now names the read list's
 * permissions of the model's own kind: the groups its create, edit and
 * delete permissions are in (getReadPermissionsOfItsKind).
 */

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

import PermissionGate, {
  PermissionsToName,
} from "../../../UI/Utils/PermissionGate";
import DatabaseModels from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import LogSavedView from "../../../Models/DatabaseModels/LogSavedView";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Probe from "../../../Models/DatabaseModels/Probe";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import Team from "../../../Models/DatabaseModels/Team";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";

const ROLE_TITLES: Array<string> =
  PermissionHelper.getRolePermissionProps().map(
    (props: PermissionProps): string => {
      return props.title;
    },
  );

type NamedFunction = (model: BaseModel) => PermissionsToName;

// What the list's no-access state names.
const namedOfItsKind: NamedFunction = (model: BaseModel): PermissionsToName => {
  return PermissionGate.getPermissionsToName(
    PermissionGate.getReadPermissionsOfItsKind(model),
  );
};

// What it named before: the whole read list.
const namedOfAll: NamedFunction = (model: BaseModel): PermissionsToName => {
  return PermissionGate.getPermissionsToName(model.getReadPermissions());
};

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
});

describe("the Probes list", () => {
  test("its read list names 22 permissions, all but one another kind's, which let a picker show probes", () => {
    const all: PermissionsToName = namedOfAll(new Probe());

    expect(all.areRoles).toBe(false);
    expect(all.titles).toHaveLength(22);
    expect(all.titles[0]).toBe("Read Probe");
    expect(all.titles).toEqual(
      expect.arrayContaining([
        "Create Monitor",
        "Read Network Device",
        "Read All Operational Resources",
        "Read vCenter",
      ]),
    );
  });

  test("names Read Probe alone: the permission of its kind", () => {
    expect(PermissionGate.getReadPermissionsOfItsKind(new Probe())).toEqual([
      Permission.ReadProjectProbe,
    ]);
    expect(namedOfItsKind(new Probe())).toEqual({
      titles: ["Read Probe"],
      areRoles: false,
    } as PermissionsToName);
    expect(
      PermissionGate.getNeededPermissionsSentence(
        PermissionGate.getReadPermissionsOfItsKind(new Probe()),
      ),
    ).toBe("You need this permission: Read Probe.");
  });

  test("its kind is the group its own create, edit and delete permissions are in", () => {
    const props: Record<string, PermissionProps> =
      PermissionHelper.getAllPermissionPropsAsDictionary() as Record<
        string,
        PermissionProps
      >;
    const probe: Probe = new Probe();
    const groupOf: (permission: Permission) => string = (
      permission: Permission,
    ): string => {
      return String(props[permission]?.group);
    };

    expect(
      Array.from(
        new Set(
          [
            Permission.CreateProjectProbe,
            Permission.EditProjectProbe,
            Permission.DeleteProjectProbe,
          ].map(groupOf),
        ),
      ),
    ).toEqual([groupOf(Permission.ReadProjectProbe)]);
    expect(probe.getCreatePermissions()).toContain(
      Permission.CreateProjectProbe,
    );
    expect(probe.getUpdatePermissions()).toContain(Permission.EditProjectProbe);
    expect(probe.getDeletePermissions()).toContain(
      Permission.DeleteProjectProbe,
    );
    expect(groupOf(Permission.CreateProjectMonitor)).not.toBe(
      groupOf(Permission.ReadProjectProbe),
    );
  });
});

describe("other lists", () => {
  test("a list whose readers are of its kind names what it always named", () => {
    expect(namedOfItsKind(new Monitor())).toEqual(namedOfAll(new Monitor()));
    expect(namedOfItsKind(new Monitor()).titles).toEqual(["Read Monitor"]);
  });

  test("Project User, which every member holds, is no longer named beside a list's own read", () => {
    expect(namedOfAll(new Team()).titles).toEqual([
      "Project User",
      "Read Teams",
    ]);
    expect(namedOfItsKind(new Team()).titles).toEqual(["Read Teams"]);
    expect(namedOfItsKind(new Label()).titles).toEqual(["Read Label"]);
  });

  test("a list read by roles alone still names its roles", () => {
    const named: PermissionsToName = namedOfItsKind(new LogSavedView());

    expect(named.areRoles).toBe(true);
    expect(named).toEqual(namedOfAll(new LogSavedView()));
  });

  test("a model that writes nothing of its own names its whole read list", () => {
    const job: RunnerJob = new RunnerJob();

    expect(job.getUpdatePermissions()).toEqual([]);
    expect(job.getDeletePermissions()).toEqual([]);
    expect(PermissionGate.getReadPermissionsOfItsKind(job)).toEqual(
      job.getReadPermissions(),
    );
  });

  test("an agent read through any of the resources it runs on names each of them: each is its kind", () => {
    expect(namedOfItsKind(new ResourceAiAgent())).toEqual(
      namedOfAll(new ResourceAiAgent()),
    );
  });
});

/*
 * Across every database model: what a list's no-access state names is
 * always part of what its read list allows, never a role beside a
 * permission of its own, and never a sentence of 22 names again.
 */
describe("every database model's list", () => {
  const models: Array<BaseModel> = DatabaseModels.map(
    (ModelType: { new (): BaseModel }): BaseModel => {
      return new ModelType();
    },
  ).filter((model: BaseModel): boolean => {
    return (
      PermissionGate.getPermissionTitles(model.getReadPermissions()).length > 0
    );
  });

  test("there are hundreds of lists to read", () => {
    expect(models.length).toBeGreaterThan(400);
  });

  test("names only permissions its read list has, and something whenever it named something", () => {
    for (const model of models) {
      const read: Array<Permission> = model.getReadPermissions();
      const ofItsKind: Array<Permission> =
        PermissionGate.getReadPermissionsOfItsKind(model);

      for (const permission of ofItsKind) {
        expect({ model: model.tableName, permission, isRead: true }).toEqual({
          model: model.tableName,
          permission,
          isRead: read.includes(permission),
        });
      }

      expect({
        model: model.tableName,
        names: namedOfItsKind(model).titles.length > 0,
      }).toEqual({ model: model.tableName, names: true });
    }
  });

  test("never names a role beside a permission of its own", () => {
    for (const model of models) {
      const named: PermissionsToName = namedOfItsKind(model);

      if (!named.areRoles) {
        expect({
          model: model.tableName,
          roles: named.titles.filter((title: string): boolean => {
            return ROLE_TITLES.includes(title);
          }),
        }).toEqual({ model: model.tableName, roles: [] });
      }
    }
  });

  test("names no more than the whole list did, and ten at most", () => {
    for (const model of models) {
      const ofItsKind: number = namedOfItsKind(model).titles.length;

      expect({
        model: model.tableName,
        isNoLonger: ofItsKind <= namedOfAll(model).titles.length,
        isAtMostTen: ofItsKind <= 10,
      }).toEqual({
        model: model.tableName,
        isNoLonger: true,
        isAtMostTen: true,
      });
    }
  });
});
