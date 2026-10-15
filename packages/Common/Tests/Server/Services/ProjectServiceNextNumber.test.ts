import DatabaseConfig from "../../../Server/DatabaseConfig";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SsoRequirementChanges from "../../../Server/Utils/SsoRequirementChanges";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  NUMBERED_RECORD_KINDS,
  NumberedRecordKind,
  NumberedRecordKindInfo,
  RecordNumbering,
} from "../../../Utils/Project/NextNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * What ProjectService does with where a project's numbers start
 * (Utils/Project/NextNumber), below the API and above the database:
 *
 *   - every create and update stores a start as a whole number from 1 to
 *     1,000,000,000, or null for none, and refuses anything else, naming
 *     the column; a write that does not carry a start leaves it alone;
 *   - an update that changes a start is refused at or below the highest
 *     number its kind has given out, in every project it writes, once the
 *     caller may make it - and a start sent as stored, or cleared, is not;
 *   - a number is taken in one UPDATE ... RETURNING statement that moves
 *     the counter to the higher of its next number and the start, without
 *     a lock;
 *   - getNumbering tells the dashboard where each kind stands.
 *
 * The statements run against a real Postgres in
 * RecordNumbersStartAtPostgres.test.ts; here the repository is a fake that
 * records what it is asked.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: false,
    NotificationSlackWebhookOnCreateProject: "",
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

type Data = Record<string, unknown>;

const KINDS: Array<NumberedRecordKindInfo> = [...NUMBERED_RECORD_KINDS];

function userProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public, Permission.User],
      projectIds: [],
      _type: "UserGlobalAccessPermission",
    },
  } as DatabaseCommonInteractionProps;
}

interface ServiceInternals {
  onBeforeUpdate: (updateBy: UpdateBy<Project>) => Promise<OnUpdate<Project>>;
  onBeforeCreate: (createBy: CreateBy<Project>) => Promise<OnCreate<Project>>;
  onUpdatePermitted: (updateBy: UpdateBy<Project>) => Promise<void>;
  checkNumbersStartAboveHighest: (updateBy: UpdateBy<Project>) => Promise<void>;
}

const internals: ServiceInternals = ProjectService as unknown as ServiceInternals;

function updateOf(data: Data): UpdateBy<Project> {
  return {
    query: { _id: PROJECT_ID.toString() },
    data: data,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as unknown as UpdateBy<Project>;
}

// A project row as findRowsAndHoldUpdateToThem reads it.
function projectRow(id: ObjectID, values: Data): Project {
  const project: Project = new Project();
  project._id = id.toString();

  for (const [key, value] of Object.entries(values)) {
    (project as unknown as Data)[key] = value;
  }

  return project;
}

async function refusalOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }

  return null;
}

describe("ProjectService: where numbers start", () => {
  beforeEach(() => {
    getJestSpyOn(UserService, "findOneById").mockResolvedValue(
      new User() as never,
    );
    getJestSpyOn(
      DatabaseConfig,
      "shouldDisableUserProjectCreation",
    ).mockResolvedValue(false as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("applyNextNumberRules", () => {
    it("stores a whole number, typed or sent as text, as a number", () => {
      const data: Data = {
        incidentNumbersStartAt: 2346,
        alertNumbersStartAt: "10000",
        scheduledMaintenanceNumbersStartAt: " 500 ",
      };

      ProjectService.applyNextNumberRules(data);

      expect(data).toEqual({
        incidentNumbersStartAt: 2346,
        alertNumbersStartAt: 10000,
        scheduledMaintenanceNumbersStartAt: 500,
      });
    });

    // The API's way to say "carry on from the highest number used".
    it("stores null or blank text as null: nothing chosen", () => {
      const data: Data = {
        incidentNumbersStartAt: null,
        incidentEpisodeNumbersStartAt: "",
        alertEpisodeNumbersStartAt: "   ",
      };

      ProjectService.applyNextNumberRules(data);

      expect(data).toEqual({
        incidentNumbersStartAt: null,
        incidentEpisodeNumbersStartAt: null,
        alertEpisodeNumbersStartAt: null,
      });
    });

    /*
     * An update that does not mention a start must not write one: adding
     * the key, even as null, would wipe a start every time the project was
     * renamed.
     */
    it("leaves data that carries no start alone", () => {
      const data: Data = { name: "Renamed", incidentNumberPrefix: "OPS-" };

      ProjectService.applyNextNumberRules(data);

      expect(data).toEqual({ name: "Renamed", incidentNumberPrefix: "OPS-" });
    });

    it.each(
      KINDS.map((info: NumberedRecordKindInfo): [string, string] => {
        return [info.startsAtColumn, info.title];
      }),
    )(
      "refuses %s that is not a whole number from 1 to 1,000,000,000, naming it by its title",
      (column: string, title: string) => {
        expect(() => {
          ProjectService.applyNextNumberRules({ [column]: "12.5" });
        }).toThrow(
          new BadDataException(`${title} must be a whole number, like 1000.`),
        );
        expect(() => {
          ProjectService.applyNextNumberRules({ [column]: 0 });
        }).toThrow(new BadDataException(`${title} must be 1 or more.`));
        expect(() => {
          ProjectService.applyNextNumberRules({ [column]: 1_000_000_001 });
        }).toThrow(
          new BadDataException(
            `${title} must be no higher than 1,000,000,000.`,
          ),
        );
      },
    );
  });

  describe("on create and update", () => {
    it("an update stores the start it carries as a number", async () => {
      const result: OnUpdate<Project> = await internals.onBeforeUpdate(
        updateOf({ incidentNumbersStartAt: "2346" }),
      );

      expect(
        (result.updateBy.data as unknown as Data)["incidentNumbersStartAt"],
      ).toBe(2346);
    });

    it("an update refuses a start that is not a whole number before anything is written", async () => {
      const error: unknown = await refusalOf(
        internals.onBeforeUpdate(updateOf({ alertNumbersStartAt: "abc" })),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "Alert Numbers Start At must be a whole number, like 1000.",
      );
    });

    // Terraform and the API can choose where numbers start for a new project.
    it("a new project can be created with its numbers starting where it chooses", async () => {
      const project: Project = new Project();
      project.name = "Moved from incident.io";
      (project as unknown as Data)["incidentNumbersStartAt"] = "2346";

      const result: OnCreate<Project> = await internals.onBeforeCreate({
        data: project,
        props: userProps(),
      } as CreateBy<Project>);

      expect(
        (result.createBy.data as unknown as Data)["incidentNumbersStartAt"],
      ).toBe(2346);
    });

    it("a new project is refused a start below 1", async () => {
      const project: Project = new Project();
      project.name = "Typo";
      (project as unknown as Data)["alertEpisodeNumbersStartAt"] = -1;

      const error: unknown = await refusalOf(
        internals.onBeforeCreate({
          data: project,
          props: userProps(),
        } as CreateBy<Project>),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "Alert Episode Numbers Start At must be 1 or more.",
      );
    });

    it("a new project created without a start has none: its numbers start at 1", async () => {
      const project: Project = new Project();
      project.name = "Fresh";

      const result: OnCreate<Project> = await internals.onBeforeCreate({
        data: project,
        props: userProps(),
      } as CreateBy<Project>);

      for (const info of KINDS) {
        expect(
          (result.createBy.data as unknown as Data)[info.startsAtColumn],
        ).toBeUndefined();
      }
    });
  });

  describe("a changed start must be above the highest number given out", () => {
    let rowsSpy: ReturnType<typeof getJestSpyOn>;
    let rows: Array<Project>;

    beforeEach(() => {
      rows = [];
      rowsSpy = getJestSpyOn(
        ProjectService,
        "findRowsAndHoldUpdateToThem",
      ).mockImplementation((async (): Promise<Array<Project>> => {
        return rows;
      }) as never);
    });

    it("accepts a start above the highest number", async () => {
      rows = [projectRow(PROJECT_ID, { incidentCounter: 2345 })];

      await internals.checkNumbersStartAboveHighest(
        updateOf({ incidentNumbersStartAt: 2346 }),
      );
      await internals.checkNumbersStartAboveHighest(
        updateOf({ incidentNumbersStartAt: 10000 }),
      );
    });

    it.each(KINDS)(
      "$kind: refuses a start at or below the highest number, saying which",
      async (info: NumberedRecordKindInfo) => {
        rows = [projectRow(PROJECT_ID, { [info.counterColumn]: 2345 })];

        for (const startsAt of [2345, 100, 1]) {
          const error: unknown = await refusalOf(
            internals.checkNumbersStartAboveHighest(
              updateOf({ [info.startsAtColumn]: startsAt }),
            ),
          );

          expect(error).toBeInstanceOf(BadDataException);
          expect((error as BadDataException).message).toBe(
            `${info.title} must be higher than 2345, the highest ${info.recordName} number used so far. A number is never used twice.`,
          );
        }
      },
    );

    it("reads each kind's own counter: another kind's numbers do not count", async () => {
      rows = [
        projectRow(PROJECT_ID, {
          incidentCounter: 5,
          alertCounter: 90000,
        }),
      ];

      await internals.checkNumbersStartAboveHighest(
        updateOf({ incidentNumbersStartAt: 6 }),
      );

      const error: unknown = await refusalOf(
        internals.checkNumbersStartAboveHighest(
          updateOf({ alertNumbersStartAt: 6 }),
        ),
      );

      expect(error).toBeInstanceOf(BadDataException);
    });

    /*
     * Terraform sends every value it holds on each apply. A start the
     * records have since passed is still the stored one, and must not fail
     * the apply.
     */
    it("a start sent as it is stored is no change, even once records have passed it", async () => {
      rows = [
        projectRow(PROJECT_ID, {
          incidentCounter: 10050,
          incidentNumbersStartAt: 10000,
        }),
      ];

      await internals.checkNumbersStartAboveHighest(
        updateOf({ incidentNumbersStartAt: 10000 }),
      );
    });

    it("moving a start down is allowed while no record has used the numbers in between", async () => {
      // A typo: 100000 for 10000, and no incident created since.
      rows = [
        projectRow(PROJECT_ID, {
          incidentCounter: 2345,
          incidentNumbersStartAt: 100000,
        }),
      ];

      await internals.checkNumbersStartAboveHighest(
        updateOf({ incidentNumbersStartAt: 10000 }),
      );
    });

    it("moving a start down is refused once a record has used it", async () => {
      rows = [
        projectRow(PROJECT_ID, {
          incidentCounter: 100000,
          incidentNumbersStartAt: 100000,
        }),
      ];

      const error: unknown = await refusalOf(
        internals.checkNumbersStartAboveHighest(
          updateOf({ incidentNumbersStartAt: 10000 }),
        ),
      );

      expect(error).toBeInstanceOf(BadDataException);
    });

    it("clearing a start is always allowed, without reading a row", async () => {
      await internals.checkNumbersStartAboveHighest(
        updateOf({ incidentNumbersStartAt: null }),
      );

      expect(rowsSpy).not.toHaveBeenCalled();
    });

    it("an update that changes no start reads no row", async () => {
      await internals.checkNumbersStartAboveHighest(
        updateOf({ name: "Renamed", incidentNumberPrefix: "OPS-" }),
      );

      expect(rowsSpy).not.toHaveBeenCalled();
    });

    it("reads the rows the update writes, with each changed kind's counter and start", async () => {
      rows = [projectRow(PROJECT_ID, { incidentCounter: 1, alertCounter: 1 })];

      const updateBy: UpdateBy<Project> = updateOf({
        incidentNumbersStartAt: 50,
        alertNumbersStartAt: 60,
        alertEpisodeNumbersStartAt: null,
      });

      await internals.checkNumbersStartAboveHighest(updateBy);

      expect(rowsSpy).toHaveBeenCalledTimes(1);
      expect(rowsSpy.mock.calls[0]![0]).toBe(updateBy);
      expect(rowsSpy.mock.calls[0]![1]).toEqual({
        _id: true,
        incidentCounter: true,
        incidentNumbersStartAt: true,
        alertCounter: true,
        alertNumbersStartAt: true,
      });
    });

    it("checks every project the update writes", async () => {
      rows = [
        projectRow(PROJECT_ID, { incidentCounter: 10 }),
        projectRow(OTHER_PROJECT_ID, { incidentCounter: 500 }),
      ];

      const error: unknown = await refusalOf(
        internals.checkNumbersStartAboveHighest(
          updateOf({ incidentNumbersStartAt: 100 }),
        ),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toContain("higher than 500");
    });

    it("a counter of nothing yet allows any start from 1", async () => {
      rows = [projectRow(PROJECT_ID, { incidentCounter: 0 })];

      await internals.checkNumbersStartAboveHighest(
        updateOf({ incidentNumbersStartAt: 1 }),
      );
    });

    /*
     * The refusal names the highest number, so it is made only once the
     * caller may make the update (onUpdatePermitted runs after every
     * permission check), and before the sign-in rules are checked or a
     * card is charged.
     */
    it("is checked once the update is permitted, before anything else it sets off", async () => {
      const order: Array<string> = [];

      rows = [projectRow(PROJECT_ID, { incidentCounter: 2345 })];
      rowsSpy.mockImplementation((async (): Promise<Array<Project>> => {
        order.push("check numbers");
        return rows;
      }) as never);
      getJestSpyOn(
        SsoRequirementChanges,
        "beforeProjectUpdate",
      ).mockImplementation((async (): Promise<void> => {
        order.push("sign-in rules");
      }) as never);
      getJestSpyOn(
        SsoRequirementChanges,
        "rememberProjectRulesBefore",
      ).mockImplementation((async (): Promise<void> => {
        order.push("remember rules");
      }) as never);
      getJestSpyOn(SsoRequirementChanges, "beforeWrite").mockImplementation(
        (async (): Promise<void> => {
          order.push("before write");
        }) as never,
      );

      const refused: unknown = await refusalOf(
        internals.onUpdatePermitted(updateOf({ incidentNumbersStartAt: 100 })),
      );

      expect(refused).toBeInstanceOf(BadDataException);
      expect(order).toEqual(["check numbers"]);

      order.length = 0;

      await internals.onUpdatePermitted(
        updateOf({ incidentNumbersStartAt: 9999 }),
      );

      expect(order).toEqual([
        "check numbers",
        "sign-in rules",
        "remember rules",
        "before write",
      ]);
    });
  });

  describe("taking a number", () => {
    interface FakeRepository {
      metadata: {
        tableName: string;
        primaryColumns: Array<{ databaseName: string }>;
        findColumnWithPropertyName: (
          name: string,
        ) => { databaseName: string } | undefined;
      };
      manager: { query: jest.Mock };
    }

    let repository: FakeRepository;
    let lockSpy: ReturnType<typeof getJestSpyOn>;

    function answer(value: unknown): void {
      repository.manager.query.mockImplementation(async () => {
        return value;
      });
    }

    beforeEach(() => {
      const project: Project = new Project();

      repository = {
        metadata: {
          tableName: "Project",
          primaryColumns: [{ databaseName: "_id" }],
          findColumnWithPropertyName: (name: string) => {
            return project.isTableColumn(name)
              ? { databaseName: name }
              : undefined;
          },
        },
        manager: { query: jest.fn() },
      };

      getJestSpyOn(ProjectService, "getRepository").mockReturnValue(
        repository as never,
      );
      lockSpy = getJestSpyOn(Semaphore, "lock");
    });

    const METHODS: Array<[NumberedRecordKind, keyof typeof ProjectService]> = [
      [NumberedRecordKind.Incident, "incrementAndGetIncidentCounter"],
      [
        NumberedRecordKind.IncidentEpisode,
        "incrementAndGetIncidentEpisodeCounter",
      ],
      [NumberedRecordKind.Alert, "incrementAndGetAlertCounter"],
      [NumberedRecordKind.AlertEpisode, "incrementAndGetAlertEpisodeCounter"],
      [
        NumberedRecordKind.ScheduledMaintenance,
        "incrementAndGetScheduledMaintenanceCounter",
      ],
    ];

    function take(
      method: keyof typeof ProjectService,
    ): Promise<{ counter: number; prefix: string | undefined }> {
      return (
        ProjectService[method] as unknown as (
          projectId: ObjectID,
        ) => Promise<{ counter: number; prefix: string | undefined }>
      ).call(ProjectService, PROJECT_ID);
    }

    it.each(METHODS)(
      "%s: one statement moves the counter to the higher of its next number and the start, and answers it with the prefix",
      async (kind: NumberedRecordKind, method: keyof typeof ProjectService) => {
        const info: NumberedRecordKindInfo = KINDS.find(
          (candidate: NumberedRecordKindInfo): boolean => {
            return candidate.kind === kind;
          },
        )!;

        answer([[{ counter: 10000, prefix: "INC-" }], 1]);

        expect(await take(method)).toEqual({ counter: 10000, prefix: "INC-" });

        expect(repository.manager.query).toHaveBeenCalledTimes(1);
        expect(repository.manager.query.mock.calls[0]).toEqual([
          `UPDATE "Project" SET "${info.counterColumn}" = GREATEST("${info.counterColumn}" + 1, COALESCE("${info.startsAtColumn}", 0)) WHERE "_id" = $1 RETURNING "${info.counterColumn}" AS "counter", "${info.prefixColumn}" AS "prefix"`,
          [PROJECT_ID.toString()],
        ]);
      },
    );

    /*
     * The counters used to be read back under a Valkey lock, in a second
     * statement. One statement needs no lock, and Valkey being down no
     * longer stops a record from being numbered.
     */
    it("takes no lock", async () => {
      answer([[{ counter: 1, prefix: null }], 1]);

      for (const [, method] of METHODS) {
        await take(method);
      }

      expect(lockSpy).not.toHaveBeenCalled();
    });

    it("reads the number however the driver hands the rows back", async () => {
      answer([{ counter: "42", prefix: "ALT-" }]);

      expect(await take("incrementAndGetAlertCounter")).toEqual({
        counter: 42,
        prefix: "ALT-",
      });
    });

    it("a project without a prefix gets none, and its numbers start with #", async () => {
      answer([[{ counter: 7, prefix: null }], 1]);

      expect(await take("incrementAndGetIncidentCounter")).toEqual({
        counter: 7,
        prefix: undefined,
      });

      answer([[{ counter: 8, prefix: "" }], 1]);

      expect(await take("incrementAndGetIncidentCounter")).toEqual({
        counter: 8,
        prefix: undefined,
      });
    });

    it("refuses when the project is gone: no number is made up", async () => {
      answer([[], 0]);

      const error: unknown = await refusalOf(
        take("incrementAndGetIncidentCounter"),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        `Could not read incidentCounter for project ${PROJECT_ID.toString()}`,
      );
    });

    it("refuses a counter that does not read as a number", async () => {
      answer([[{ counter: null, prefix: "INC-" }], 1]);

      expect(
        await refusalOf(take("incrementAndGetIncidentCounter")),
      ).toBeInstanceOf(BadDataException);
    });
  });

  describe("getNumbering", () => {
    it("says, for each kind, its prefix, the highest number, the next one and the start chosen", async () => {
      const findSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        ProjectService,
        "findOneById",
      ).mockResolvedValue(
        projectRow(PROJECT_ID, {
          incidentCounter: 2345,
          incidentNumbersStartAt: null,
          incidentNumberPrefix: "INC-",
          incidentEpisodeCounter: 0,
          incidentEpisodeNumbersStartAt: null,
          incidentEpisodeNumberPrefix: "IE-",
          alertCounter: 41,
          alertNumbersStartAt: 10000,
          alertNumberPrefix: null,
          alertEpisodeCounter: 12000,
          alertEpisodeNumbersStartAt: 10000,
          alertEpisodeNumberPrefix: "AE-",
          scheduledMaintenanceCounter: 3,
          scheduledMaintenanceNumbersStartAt: 4,
          scheduledMaintenanceNumberPrefix: "",
        }) as never,
      );

      const numbering: Array<RecordNumbering> =
        await ProjectService.getNumbering(PROJECT_ID);

      expect(numbering).toEqual([
        {
          kind: NumberedRecordKind.Incident,
          prefix: "INC-",
          highestNumber: 2345,
          nextNumber: 2346,
          numbersStartAt: null,
        },
        {
          kind: NumberedRecordKind.IncidentEpisode,
          prefix: "IE-",
          highestNumber: 0,
          nextNumber: 1,
          numbersStartAt: null,
        },
        {
          kind: NumberedRecordKind.Alert,
          prefix: null,
          highestNumber: 41,
          nextNumber: 10000,
          numbersStartAt: 10000,
        },
        {
          kind: NumberedRecordKind.AlertEpisode,
          prefix: "AE-",
          highestNumber: 12000,
          nextNumber: 12001,
          numbersStartAt: 10000,
        },
        {
          kind: NumberedRecordKind.ScheduledMaintenance,
          prefix: null,
          highestNumber: 3,
          nextNumber: 4,
          numbersStartAt: 4,
        },
      ]);

      // Read as OneUptime: the counters are no caller's to read.
      const call: { id: ObjectID; select: Data; props: Data } = findSpy.mock
        .calls[0]![0] as { id: ObjectID; select: Data; props: Data };

      expect(call.id.toString()).toBe(PROJECT_ID.toString());
      expect(call.props).toEqual({ isRoot: true });

      for (const info of KINDS) {
        expect(call.select[info.counterColumn]).toBe(true);
        expect(call.select[info.startsAtColumn]).toBe(true);
        expect(call.select[info.prefixColumn]).toBe(true);
      }
    });

    it("refuses a project that is not there", async () => {
      getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
        null as never,
      );

      const error: unknown = await refusalOf(
        ProjectService.getNumbering(PROJECT_ID),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe("Project not found");
    });
  });
});
