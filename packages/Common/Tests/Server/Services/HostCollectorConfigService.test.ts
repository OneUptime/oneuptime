import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HostCollectorConfig from "../../../Models/DatabaseModels/HostCollectorConfig";
import HostCollectorConfigService from "../../../Server/Services/HostCollectorConfigService";
import HostCollectorConfigVersionService from "../../../Server/Services/HostCollectorConfigVersionService";
import HostCollectorProjectConfigsMemo, {
  HostCollectorProjectConfig,
} from "../../../Server/Utils/HostCollector/HostCollectorProjectConfigsMemo";
import { getHostCollectorConfigHash } from "../../../Server/Utils/HostCollector/HostCollectorConfigHash";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  HOST_COLLECTOR_CONFIG_CHANGED_NOTE,
  HOST_COLLECTOR_CONFIG_CREATED_NOTE,
  HostCollectorOsType,
} from "../../../Types/HostCollector/HostCollector";
import { getHostCollectorDefaultConfig } from "../../../Utils/HostCollector/HostCollectorDefaultConfig";
import { getJestSpyOn } from "../../Spy";
import type { SpyInstance } from "jest-mock";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * Collector Configs, saved through the whole write as the people who save
 * them: their YAML is checked on every save, a new one starts as
 * OneUptime's default for its system, every change of the YAML is the next
 * version (and saving an older version's YAML says which one it put back),
 * no one may write the number or the hash themselves, and only Project
 * Owners, Admins and the Collector Config permissions may write one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7c9e6679-7425-40de-944b-e07fc1f90ae7",
);
const CONFIG_ID: string = "7c9e6679-7425-40de-944b-e07fc1f90001";
const USER_ID: ObjectID = new ObjectID("7c9e6679-7425-40de-944b-e07fc1f90002");

const LINUX_DEFAULT: string = getHostCollectorDefaultConfig(
  HostCollectorOsType.Linux,
);
const CHANGED: string = `${LINUX_DEFAULT}# changed\n`;

// The hooks that read the configs a write changes, called on their own.
interface ConfigWriteHooks {
  onUpdatePermitted(updateBy: UpdateBy<HostCollectorConfig>): Promise<void>;
  onBeforeDelete(
    deleteBy: DeleteBy<HostCollectorConfig>,
  ): Promise<OnDelete<HostCollectorConfig>>;
}

const hooks: ConfigWriteHooks =
  HostCollectorConfigService as unknown as ConfigWriteHooks;

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            } as UserPermission;
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

const WRITERS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
];

function newConfig(
  overrides: Partial<Record<string, unknown>> = {},
): HostCollectorConfig {
  const config: HostCollectorConfig = new HostCollectorConfig();
  config.projectId = PROJECT_ID;
  config.name = "Web servers";
  config.osType = HostCollectorOsType.Linux;
  Object.assign(config, overrides);
  return config;
}

describe("HostCollectorConfigService, through the whole write", () => {
  let configs: InMemoryTable;
  let versions: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});
    HostCollectorProjectConfigsMemo.clear();

    configs = useInMemoryTable(HostCollectorConfigService, [
      {
        _id: CONFIG_ID,
        projectId: PROJECT_ID.toString(),
        name: "Existing",
        osType: HostCollectorOsType.Linux,
        order: 0,
        configYaml: LINUX_DEFAULT,
        configHash: getHostCollectorConfigHash(LINUX_DEFAULT),
        currentVersionNumber: 1,
        version: 1,
      },
    ]);

    versions = useInMemoryTable(HostCollectorConfigVersionService, [
      {
        _id: "7c9e6679-7425-40de-944b-e07fc1f90003",
        projectId: PROJECT_ID.toString(),
        hostCollectorConfigId: CONFIG_ID,
        versionNumber: 1,
        configYaml: LINUX_DEFAULT,
        configHash: getHostCollectorConfigHash(LINUX_DEFAULT),
        changeNote: HOST_COLLECTOR_CONFIG_CREATED_NOTE,
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function lastInsertedConfig(): StoredRow {
    const row: StoredRow | undefined =
      configs.inserts[configs.inserts.length - 1];
    if (!row) {
      throw new Error("No config was inserted.");
    }
    return row;
  }

  function versionsOf(configId: string): Array<StoredRow> {
    return versions.rows
      .filter((row: StoredRow): boolean => {
        return (
          String(row["hostCollectorConfigId"]).toLowerCase() ===
          configId.toLowerCase()
        );
      })
      .sort((a: StoredRow, b: StoredRow): number => {
        return Number(a["versionNumber"]) - Number(b["versionNumber"]);
      });
  }

  describe("creating a config", () => {
    test.each(WRITERS)(
      "%s creates one: it starts as OneUptime's default for its system, as version 1",
      async (_who: string, permissions: Array<Permission>) => {
        const created: HostCollectorConfig =
          await HostCollectorConfigService.create({
            data: newConfig({ osType: HostCollectorOsType.Windows }),
            props: member(permissions),
          });

        const row: StoredRow = lastInsertedConfig();
        const windowsDefault: string = getHostCollectorDefaultConfig(
          HostCollectorOsType.Windows,
        );

        expect(row["configYaml"]).toBe(windowsDefault);
        expect(row["configHash"]).toBe(
          getHostCollectorConfigHash(windowsDefault),
        );
        expect(row["currentVersionNumber"]).toBe(1);

        const history: Array<StoredRow> = versionsOf(created.id!.toString());
        expect(history.length).toBe(1);
        expect(history[0]).toMatchObject({
          versionNumber: 1,
          configYaml: windowsDefault,
          changeNote: HOST_COLLECTOR_CONFIG_CREATED_NOTE,
        });
        expect(String(history[0]!["createdByUserId"])).toBe(USER_ID.toString());
      },
    );

    test("someone given Create Collector Config may create one", async () => {
      await HostCollectorConfigService.create({
        data: newConfig(),
        props: member([Permission.CreateHostCollectorConfig]),
      });

      expect(configs.inserts.length).toBe(1);
    });

    test.each([
      ["a project member", [Permission.ProjectMember]],
      [
        "someone who may only read configs",
        [Permission.ReadHostCollectorConfig],
      ],
    ])(
      "%s cannot create one",
      async (_who: string, permissions: Array<Permission>) => {
        await expect(
          HostCollectorConfigService.create({
            data: newConfig(),
            props: member(permissions),
          }),
        ).rejects.toThrow();
        expect(configs.inserts.length).toBe(0);
        expect(versions.inserts.length).toBe(0);
      },
    );

    test("YAML given on create is checked, and kept as given", async () => {
      await HostCollectorConfigService.create({
        data: newConfig({ configYaml: CHANGED }),
        props: member([Permission.ProjectAdmin]),
      });

      expect(lastInsertedConfig()["configYaml"]).toBe(CHANGED);
    });

    test("a config that breaks a rule is refused, saying why", async () => {
      const create: Promise<HostCollectorConfig> =
        HostCollectorConfigService.create({
          data: newConfig({
            configYaml: LINUX_DEFAULT.replace(
              "endpoint: ${env:ONEUPTIME_URL}/otlp",
              "endpoint: https://elsewhere.example.com/otlp",
            ),
          }),
          props: member([Permission.ProjectAdmin]),
        });

      await expect(create).rejects.toThrow(BadDataException);
      await expect(create).rejects.toThrow(
        "This config cannot be sent to hosts. exporters.otlp_http/oneuptime.endpoint: An otlphttp exporter sends only to this OneUptime",
      );
      expect(configs.inserts.length).toBe(0);
    });

    test("a system that is not one is refused", async () => {
      await expect(
        HostCollectorConfigService.create({
          data: newConfig({ osType: "plan9" }),
          props: member([Permission.ProjectAdmin]),
        }),
      ).rejects.toThrow(
        "System must be linux, windows, darwin (macOS) or any.",
      );
    });

    test("a name is required, and kept without the spaces around it", async () => {
      await expect(
        HostCollectorConfigService.create({
          data: newConfig({ name: "   " }),
          props: member([Permission.ProjectAdmin]),
        }),
      ).rejects.toThrow("Name is required.");

      await HostCollectorConfigService.create({
        data: newConfig({ name: "  Databases  " }),
        props: member([Permission.ProjectAdmin]),
      });
      expect(lastInsertedConfig()["name"]).toBe("Databases");
    });

    test.each([
      ["the version number", { currentVersionNumber: 99 }],
      ["the hash", { configHash: "0".repeat(64) }],
    ])(
      "%s is OneUptime's to write: a create that sets it is refused",
      async (_what: string, overrides: Partial<Record<string, unknown>>) => {
        await expect(
          HostCollectorConfigService.create({
            data: newConfig({ configYaml: CHANGED, ...overrides }),
            props: member([Permission.ProjectOwner]),
          }),
        ).rejects.toThrow();

        expect(configs.inserts.length).toBe(0);
        expect(versions.inserts.length).toBe(0);
      },
    );

    test("the hosts of the project read the new config with their next poll", async () => {
      const stale: Array<HostCollectorProjectConfig> = [];
      HostCollectorProjectConfigsMemo.set(PROJECT_ID.toString(), stale);

      await HostCollectorConfigService.create({
        data: newConfig(),
        props: member([Permission.ProjectAdmin]),
      });

      expect(
        HostCollectorProjectConfigsMemo.get(PROJECT_ID.toString()),
      ).toBeUndefined();
    });
  });

  describe("changing a config", () => {
    test.each(WRITERS)(
      "%s changes the YAML: it is the next version, Changed",
      async (_who: string, permissions: Array<Permission>) => {
        await HostCollectorConfigService.updateOneById({
          id: new ObjectID(CONFIG_ID),
          data: { configYaml: CHANGED },
          props: member(permissions),
        });

        expect(configs.get(CONFIG_ID)).toMatchObject({
          configYaml: CHANGED,
          configHash: getHostCollectorConfigHash(CHANGED),
          currentVersionNumber: 2,
        });

        const history: Array<StoredRow> = versionsOf(CONFIG_ID);
        expect(
          history.map((row: StoredRow): unknown => {
            return [row["versionNumber"], row["changeNote"]];
          }),
        ).toEqual([
          [1, HOST_COLLECTOR_CONFIG_CREATED_NOTE],
          [2, HOST_COLLECTOR_CONFIG_CHANGED_NOTE],
        ]);
        expect(history[1]!["configYaml"]).toBe(CHANGED);
      },
    );

    test("saving an older version's YAML puts that version back, as a new version that says so", async () => {
      await HostCollectorConfigService.updateOneById({
        id: new ObjectID(CONFIG_ID),
        data: { configYaml: CHANGED },
        props: member([Permission.ProjectAdmin]),
      });
      await HostCollectorConfigService.updateOneById({
        id: new ObjectID(CONFIG_ID),
        data: { configYaml: LINUX_DEFAULT },
        props: member([Permission.ProjectAdmin]),
      });

      expect(
        versionsOf(CONFIG_ID).map((row: StoredRow): unknown => {
          return [row["versionNumber"], row["changeNote"]];
        }),
      ).toEqual([
        [1, HOST_COLLECTOR_CONFIG_CREATED_NOTE],
        [2, HOST_COLLECTOR_CONFIG_CHANGED_NOTE],
        [3, "Put version 1 back"],
      ]);
      expect(configs.get(CONFIG_ID)!["currentVersionNumber"]).toBe(3);
    });

    test("saving the same YAML again is no new version", async () => {
      await HostCollectorConfigService.updateOneById({
        id: new ObjectID(CONFIG_ID),
        data: { configYaml: LINUX_DEFAULT },
        props: member([Permission.ProjectAdmin]),
      });

      expect(versionsOf(CONFIG_ID).length).toBe(1);
      expect(configs.get(CONFIG_ID)!["currentVersionNumber"]).toBe(1);
    });

    test("renaming a config is no new version", async () => {
      await HostCollectorConfigService.updateOneById({
        id: new ObjectID(CONFIG_ID),
        data: { name: "  Renamed  " },
        props: member([Permission.ProjectAdmin]),
      });

      expect(configs.get(CONFIG_ID)!["name"]).toBe("Renamed");
      expect(versionsOf(CONFIG_ID).length).toBe(1);
    });

    test("someone given Edit and Read Collector Config may change one", async () => {
      // A write needs the record to be readable too, as everywhere.
      await HostCollectorConfigService.updateOneById({
        id: new ObjectID(CONFIG_ID),
        data: { configYaml: CHANGED },
        props: member([
          Permission.EditHostCollectorConfig,
          Permission.ReadHostCollectorConfig,
        ]),
      });

      expect(configs.get(CONFIG_ID)!["configYaml"]).toBe(CHANGED);
    });

    test.each([
      ["a project member", [Permission.ProjectMember]],
      [
        "someone who may only create configs",
        [Permission.CreateHostCollectorConfig],
      ],
    ])(
      "%s cannot change one",
      async (_who: string, permissions: Array<Permission>) => {
        await expect(
          HostCollectorConfigService.updateOneById({
            id: new ObjectID(CONFIG_ID),
            data: { configYaml: CHANGED },
            props: member(permissions),
          }),
        ).rejects.toThrow();

        expect(configs.get(CONFIG_ID)!["configYaml"]).toBe(LINUX_DEFAULT);
        expect(versionsOf(CONFIG_ID).length).toBe(1);
      },
    );

    test("a change that breaks a rule is refused, and the config stays as it was", async () => {
      await expect(
        HostCollectorConfigService.updateOneById({
          id: new ObjectID(CONFIG_ID),
          data: {
            configYaml: `${LINUX_DEFAULT}extensions:\n  pprof:\n`,
          },
          props: member([Permission.ProjectAdmin]),
        }),
      ).rejects.toThrow(BadDataException);

      expect(configs.get(CONFIG_ID)!["configYaml"]).toBe(LINUX_DEFAULT);
      expect(versionsOf(CONFIG_ID).length).toBe(1);
    });

    test("an emptied config is refused: deleting it is how to go back to the default", async () => {
      await expect(
        HostCollectorConfigService.updateOneById({
          id: new ObjectID(CONFIG_ID),
          data: { configYaml: "  " },
          props: member([Permission.ProjectAdmin]),
        }),
      ).rejects.toThrow("A config cannot be empty.");
    });

    test("no one may write the version number or the hash", async () => {
      for (const data of [
        { currentVersionNumber: 50 },
        { configHash: "0".repeat(64) },
      ]) {
        await expect(
          HostCollectorConfigService.updateOneById({
            id: new ObjectID(CONFIG_ID),
            data: data,
            props: member([Permission.ProjectOwner]),
          }),
        ).rejects.toThrow();
      }

      expect(configs.get(CONFIG_ID)).toMatchObject({
        currentVersionNumber: 1,
        configHash: getHostCollectorConfigHash(LINUX_DEFAULT),
      });
    });

    test("a saved change reaches the project's hosts with their next poll", async () => {
      HostCollectorProjectConfigsMemo.set(PROJECT_ID.toString(), []);

      await HostCollectorConfigService.updateOneById({
        id: new ObjectID(CONFIG_ID),
        data: { configYaml: CHANGED },
        props: member([Permission.ProjectAdmin]),
      });

      expect(
        HostCollectorProjectConfigsMemo.get(PROJECT_ID.toString()),
      ).toBeUndefined();
    });

    test("a change of the YAML of two configs at once is refused, and both stay as they were", async () => {
      configs.rows.push({
        _id: "7c9e6679-7425-40de-944b-e07fc1f90004",
        projectId: PROJECT_ID.toString(),
        name: "Second",
        osType: HostCollectorOsType.Linux,
        order: 1,
        configYaml: LINUX_DEFAULT,
        configHash: getHostCollectorConfigHash(LINUX_DEFAULT),
        currentVersionNumber: 1,
        version: 1,
      });

      await expect(
        HostCollectorConfigService.updateBy({
          query: { projectId: PROJECT_ID },
          data: { configYaml: CHANGED },
          limit: 10,
          skip: 0,
          props: member([Permission.ProjectAdmin]),
        }),
      ).rejects.toThrow("Change the config of one Collector Config at a time.");

      for (const row of configs.rows) {
        expect(row["configYaml"]).toBe(LINUX_DEFAULT);
        expect(row["currentVersionNumber"]).toBe(1);
      }
      expect(versions.inserts.length).toBe(0);
    });
  });

  /*
   * The config a change of YAML is numbered from is the one the update
   * writes: read with findOneRowAndHoldUpdateToIt, which holds the update
   * to that config - never by the update's own query, which reads rows in
   * a window of its own (UpdateChecksReadHeldRows).
   */
  describe("the config a change of YAML is numbered from", () => {
    type HoldUpdateToOne =
      typeof HostCollectorConfigService.findOneRowAndHoldUpdateToIt;

    function holdUpdateTo(found: {
      row: HostCollectorConfig | null;
      writesMore: boolean;
    }): SpyInstance<HoldUpdateToOne> {
      return jest
        .spyOn(HostCollectorConfigService, "findOneRowAndHoldUpdateToIt")
        .mockResolvedValue(found);
    }

    function changeOfYaml(): UpdateBy<HostCollectorConfig> {
      return {
        query: { _id: new ObjectID(CONFIG_ID) },
        data: { configYaml: CHANGED },
        limit: 1,
        skip: 0,
        props: member([Permission.ProjectAdmin]),
      } as unknown as UpdateBy<HostCollectorConfig>;
    }

    test("is the config the update is held to: the update itself is handed over, and the next number is that config's", async () => {
      // Stored as version 1; the config the update writes is at version 6.
      const written: HostCollectorConfig = new HostCollectorConfig();
      written._id = CONFIG_ID;
      written.projectId = PROJECT_ID;
      written.currentVersionNumber = 6;
      written.configHash = getHostCollectorConfigHash(LINUX_DEFAULT);

      const held: SpyInstance<HoldUpdateToOne> = holdUpdateTo({
        row: written,
        writesMore: false,
      });
      const updateBy: UpdateBy<HostCollectorConfig> = changeOfYaml();

      await hooks.onUpdatePermitted(updateBy);

      expect(held).toHaveBeenCalledTimes(1);
      // The update itself, so it is held to the config read.
      expect(held.mock.calls[0]![0]).toBe(updateBy);
      expect(held.mock.calls[0]![1]).toEqual({
        _id: true,
        projectId: true,
        currentVersionNumber: true,
        configHash: true,
      });
      expect(updateBy.data).toMatchObject({
        currentVersionNumber: 7,
        configHash: getHostCollectorConfigHash(CHANGED),
      });
    });

    test("an update that writes no config numbers no version", async () => {
      holdUpdateTo({ row: null, writesMore: false });
      const updateBy: UpdateBy<HostCollectorConfig> = changeOfYaml();

      await hooks.onUpdatePermitted(updateBy);

      expect(updateBy.data).toEqual({ configYaml: CHANGED });
    });

    test("an update that writes more than one config is refused", async () => {
      holdUpdateTo({ row: null, writesMore: true });
      const updateBy: UpdateBy<HostCollectorConfig> = changeOfYaml();

      await expect(hooks.onUpdatePermitted(updateBy)).rejects.toThrow(
        "Change the config of one Collector Config at a time.",
      );
      expect(updateBy.data).toEqual({ configYaml: CHANGED });
    });

    test("a change that leaves the YAML alone reads no config", async () => {
      const held: SpyInstance<HoldUpdateToOne> = holdUpdateTo({
        row: null,
        writesMore: false,
      });

      await hooks.onUpdatePermitted({
        ...changeOfYaml(),
        data: { name: "Renamed" },
      } as unknown as UpdateBy<HostCollectorConfig>);

      expect(held).not.toHaveBeenCalled();
    });
  });

  describe("the versions", () => {
    test("no one may add, change or remove a version through the API", async () => {
      const owner: DatabaseCommonInteractionProps = member([
        Permission.ProjectOwner,
      ]);

      await expect(
        HostCollectorConfigVersionService.updateOneById({
          id: new ObjectID("7c9e6679-7425-40de-944b-e07fc1f90003"),
          data: { configYaml: "receivers: {}" },
          props: owner,
        }),
      ).rejects.toThrow();

      await expect(
        HostCollectorConfigVersionService.deleteOneById({
          id: new ObjectID("7c9e6679-7425-40de-944b-e07fc1f90003"),
          props: owner,
        }),
      ).rejects.toThrow();

      expect(versionsOf(CONFIG_ID).length).toBe(1);
      expect(versionsOf(CONFIG_ID)[0]!["configYaml"]).toBe(LINUX_DEFAULT);
    });
  });

  describe("deleting a config", () => {
    test("its project's hosts go back to the list with their next poll", async () => {
      HostCollectorProjectConfigsMemo.set(PROJECT_ID.toString(), []);

      await HostCollectorConfigService.deleteOneById({
        id: new ObjectID(CONFIG_ID),
        props: member([Permission.ProjectAdmin]),
      });

      expect(configs.get(CONFIG_ID)).toBeUndefined();
      expect(
        HostCollectorProjectConfigsMemo.get(PROJECT_ID.toString()),
      ).toBeUndefined();
    });

    test("a project member cannot delete one", async () => {
      await expect(
        HostCollectorConfigService.deleteOneById({
          id: new ObjectID(CONFIG_ID),
          props: member([Permission.ProjectMember]),
        }),
      ).rejects.toThrow();

      expect(configs.get(CONFIG_ID)).toBeDefined();
    });

    /*
     * The projects told are those of the configs the delete removes: read
     * with findRowsAndHoldDeleteToThem, which holds the delete to them -
     * never by the delete's own query (DeleteChecksReadHeldRows).
     */
    describe("the projects told", () => {
      type HoldDelete =
        typeof HostCollectorConfigService.findRowsAndHoldDeleteToThem;

      function holdDeleteTo(
        rows: Array<HostCollectorConfig>,
      ): SpyInstance<HoldDelete> {
        return jest
          .spyOn(HostCollectorConfigService, "findRowsAndHoldDeleteToThem")
          .mockResolvedValue(rows);
      }

      function deleteOfConfig(): DeleteBy<HostCollectorConfig> {
        return {
          query: { _id: new ObjectID(CONFIG_ID) },
          limit: 1,
          skip: 0,
          props: member([Permission.ProjectAdmin]),
        } as unknown as DeleteBy<HostCollectorConfig>;
      }

      test("are the projects of the configs the delete is held to: the delete itself is handed over", async () => {
        const otherProjectId: ObjectID = new ObjectID(
          "7c9e6679-7425-40de-944b-e07fc1f90005",
        );
        const removed: HostCollectorConfig = new HostCollectorConfig();
        removed._id = CONFIG_ID;
        removed.projectId = otherProjectId;

        const held: SpyInstance<HoldDelete> = holdDeleteTo([removed]);
        const deleteBy: DeleteBy<HostCollectorConfig> = deleteOfConfig();

        const onDelete: OnDelete<HostCollectorConfig> =
          await hooks.onBeforeDelete(deleteBy);

        expect(held).toHaveBeenCalledTimes(1);
        // The delete itself, so it is held to the configs read.
        expect(held.mock.calls[0]![0]).toBe(deleteBy);
        expect(held.mock.calls[0]![1]).toEqual({ projectId: true });
        expect(onDelete.deleteBy).toBe(deleteBy);
        expect(onDelete.carryForward).toEqual({
          projectIds: [otherProjectId.toString()],
        });
      });

      test("are none when the delete removes no config", async () => {
        holdDeleteTo([]);

        const onDelete: OnDelete<HostCollectorConfig> =
          await hooks.onBeforeDelete(deleteOfConfig());

        expect(onDelete.carryForward).toEqual({ projectIds: [] });
      });
    });
  });
});
