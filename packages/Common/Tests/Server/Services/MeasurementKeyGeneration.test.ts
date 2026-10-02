import AlertMeasurement from "../../../Models/DatabaseModels/AlertMeasurement";
import IncidentMeasurement from "../../../Models/DatabaseModels/IncidentMeasurement";
import ScheduledMaintenanceMeasurement from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import AlertMeasurementService from "../../../Server/Services/AlertMeasurementService";
import IncidentMeasurementService from "../../../Server/Services/IncidentMeasurementService";
import ScheduledMaintenanceMeasurementService from "../../../Server/Services/ScheduledMaintenanceMeasurementService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import MeasurementKeyAssigner from "../../../Server/Utils/Measurement/MeasurementKeyAssigner";
import AlertMeasurementAnchorType from "../../../Types/Alerts/AlertMeasurementAnchorType";
import AlertStateRole from "../../../Types/Alerts/AlertStateRole";
import BadDataException from "../../../Types/Exception/BadDataException";
import IncidentMeasurementAnchorType from "../../../Types/Incident/IncidentMeasurementAnchorType";
import IncidentStateRole from "../../../Types/Incident/IncidentStateRole";
import ObjectID from "../../../Types/ObjectID";
import ScheduledMaintenanceMeasurementAnchorType from "../../../Types/ScheduledMaintenance/ScheduledMaintenanceMeasurementAnchorType";
import ScheduledMaintenanceStateRole from "../../../Types/ScheduledMaintenance/ScheduledMaintenanceStateRole";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The maintainer, on the measurement forms that asked for a Key: "it should
 * be automatically generated based on the name. If a human wants to edit
 * it, they can edit it as well, but please don't require an input from a
 * human."
 *
 * The server half of that, for incident, alert and scheduled maintenance
 * measurements alike - the dashboard leaves the key out unless someone
 * typed one, and so may an API client or Terraform:
 *
 *   - a create without a key (or with an empty one) gets the key the name
 *     makes, numbered -2, -3 ... past the keys the project's other
 *     measurements hold, read as root so a hidden one cannot clash;
 *   - a key that is sent is kept exactly as sent, or refused - when it is
 *     not a valid key, or another measurement of the project has it - and
 *     never renumbered behind the back of whoever typed it;
 *   - the metric name is built from whichever key the measurement ends up
 *     with.
 */

type AnyMeasurement =
  | IncidentMeasurement
  | AlertMeasurement
  | ScheduledMaintenanceMeasurement;

interface MeasurementService {
  findBy: (...args: Array<unknown>) => Promise<unknown>;
  getKeysInProject: (projectId: ObjectID | undefined) => Promise<Array<string>>;
}

interface Hooks {
  onBeforeCreate: (
    createBy: CreateBy<AnyMeasurement>,
  ) => Promise<OnCreate<AnyMeasurement>>;
}

interface MeasurementKind {
  label: string;
  service: MeasurementService;
  metricNamePrefix: string;
  // A definition whose two ends are valid, so only the key is under test.
  build: () => AnyMeasurement;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const TENANT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const KINDS: Array<MeasurementKind> = [
  {
    label: "incident measurements",
    service: IncidentMeasurementService as unknown as MeasurementService,
    metricNamePrefix: "oneuptime.incident.measurement.",
    build: (): AnyMeasurement => {
      const measurement: IncidentMeasurement = new IncidentMeasurement();
      measurement.startAnchorType =
        IncidentMeasurementAnchorType.ImpactStartedAt;
      measurement.endAnchorType =
        IncidentMeasurementAnchorType.StateRoleEntered;
      measurement.endIncidentStateRole = IncidentStateRole.Acknowledged;
      return measurement;
    },
  },
  {
    label: "alert measurements",
    service: AlertMeasurementService as unknown as MeasurementService,
    metricNamePrefix: "oneuptime.alert.measurement.",
    build: (): AnyMeasurement => {
      const measurement: AlertMeasurement = new AlertMeasurement();
      measurement.startAnchorType = AlertMeasurementAnchorType.CreatedAt;
      measurement.endAnchorType = AlertMeasurementAnchorType.StateRoleEntered;
      measurement.endAlertStateRole = AlertStateRole.Acknowledged;
      return measurement;
    },
  },
  {
    label: "scheduled maintenance measurements",
    service:
      ScheduledMaintenanceMeasurementService as unknown as MeasurementService,
    metricNamePrefix: "oneuptime.scheduled-maintenance.measurement.",
    build: (): AnyMeasurement => {
      const measurement: ScheduledMaintenanceMeasurement =
        new ScheduledMaintenanceMeasurement();
      measurement.startAnchorType =
        ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt;
      measurement.endAnchorType =
        ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered;
      measurement.endScheduledMaintenanceStateRole =
        ScheduledMaintenanceStateRole.Ongoing;
      return measurement;
    },
  },
];

describe.each(KINDS)("$label", (kind: MeasurementKind) => {
  const hooks: Hooks = kind.service as unknown as Hooks;

  let findBy: SpyInstance;

  // The keys the project's measurements hold, as the store would return them.
  const answerKeys: (keys: Array<string | undefined>) => void = (
    keys: Array<string | undefined>,
  ): void => {
    findBy.mockResolvedValue(
      keys.map((key: string | undefined) => {
        const existing: AnyMeasurement = kind.build();

        if (key !== undefined) {
          existing.key = key;
        }

        return existing;
      }) as never,
    );
  };

  const createBy: (input: {
    name?: string | undefined;
    key?: string | null | undefined;
    projectId?: ObjectID | undefined;
    tenantId?: ObjectID | undefined;
  }) => CreateBy<AnyMeasurement> = (input: {
    name?: string | undefined;
    key?: string | null | undefined;
    projectId?: ObjectID | undefined;
    tenantId?: ObjectID | undefined;
  }): CreateBy<AnyMeasurement> => {
    const measurement: AnyMeasurement = kind.build();

    if (input.projectId) {
      measurement.projectId = input.projectId;
    }

    if (input.name !== undefined) {
      measurement.name = input.name;
    }

    if (input.key !== undefined) {
      measurement.key = input.key as string;
    }

    return {
      data: measurement,
      props: input.tenantId
        ? { tenantId: input.tenantId, userId: ObjectID.generate() }
        : { isRoot: true },
    } as CreateBy<AnyMeasurement>;
  };

  beforeEach(() => {
    findBy = jest
      .spyOn(kind.service, "findBy")
      .mockResolvedValue([] as never) as unknown as SpyInstance;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("a create that leaves the key out", () => {
    test("gets the key the name makes", async () => {
      const create: CreateBy<AnyMeasurement> = createBy({
        name: "Time to Detect",
        projectId: PROJECT_ID,
      });

      await hooks.onBeforeCreate(create);

      expect(create.data.key).toBe("time-to-detect");
    });

    test("gets a metric name built from that key", async () => {
      const create: CreateBy<AnyMeasurement> = createBy({
        name: "Time to Detect",
        projectId: PROJECT_ID,
      });

      await hooks.onBeforeCreate(create);

      expect(create.data.metricName).toBe(
        `${kind.metricNamePrefix}time-to-detect`,
      );
    });

    test.each([
      ["an empty key", ""],
      ["a blank key", "   "],
      ["a null key", null],
    ])("treats %s as left out", async (_label: string, key: string | null) => {
      const create: CreateBy<AnyMeasurement> = createBy({
        name: "Time to Detect",
        key: key,
        projectId: PROJECT_ID,
      });

      await hooks.onBeforeCreate(create);

      expect(create.data.key).toBe("time-to-detect");
    });

    test("numbers the key when another measurement of the project has it", async () => {
      answerKeys(["time-to-detect", "time-to-resolve"]);

      const create: CreateBy<AnyMeasurement> = createBy({
        name: "Time to detect",
        projectId: PROJECT_ID,
      });

      await hooks.onBeforeCreate(create);

      expect(create.data.key).toBe("time-to-detect-2");
      expect(create.data.metricName).toBe(
        `${kind.metricNamePrefix}time-to-detect-2`,
      );
    });

    test("takes the first number no other measurement has", async () => {
      answerKeys(["time-to-detect", "time-to-detect-2", undefined]);

      const create: CreateBy<AnyMeasurement> = createBy({
        name: "Time to Detect",
        projectId: PROJECT_ID,
      });

      await hooks.onBeforeCreate(create);

      expect(create.data.key).toBe("time-to-detect-3");
    });

    test("reads every key of the project, as root, and only the keys", async () => {
      const create: CreateBy<AnyMeasurement> = createBy({
        name: "Time to Detect",
        projectId: PROJECT_ID,
      });

      await hooks.onBeforeCreate(create);

      expect(findBy).toHaveBeenCalledTimes(1);

      const query: Record<string, unknown> = findBy.mock.calls[0]![0] as Record<
        string,
        unknown
      >;

      expect(query["query"]).toEqual({ projectId: PROJECT_ID });
      expect(query["select"]).toEqual({ key: true });
      expect(query["props"]).toEqual({ isRoot: true });
    });

    test("reads the request's project when the create does not name one", async () => {
      const create: CreateBy<AnyMeasurement> = createBy({
        name: "Time to Detect",
        tenantId: TENANT_ID,
      });

      await hooks.onBeforeCreate(create);

      const query: Record<string, unknown> = findBy.mock.calls[0]![0] as Record<
        string,
        unknown
      >;

      expect(query["query"]).toEqual({ projectId: TENANT_ID });
    });

    test("with no project to look in, reads nothing and still makes the key", async () => {
      const create: CreateBy<AnyMeasurement> = createBy({
        name: "Time to Detect",
      });

      await hooks.onBeforeCreate(create);

      expect(findBy).not.toHaveBeenCalled();
      expect(create.data.key).toBe("time-to-detect");
    });

    test("a name with nothing usable in it still gets a key", async () => {
      const create: CreateBy<AnyMeasurement> = createBy({
        name: "!!!",
        projectId: PROJECT_ID,
      });

      await hooks.onBeforeCreate(create);

      expect(create.data.key).toBe("measurement");
    });

    test("a name in another script gets measurement, numbered on a clash", async () => {
      answerKeys(["measurement"]);

      const create: CreateBy<AnyMeasurement> = createBy({
        name: "検出までの時間",
        projectId: PROJECT_ID,
      });

      await hooks.onBeforeCreate(create);

      expect(create.data.key).toBe("measurement-2");
    });

    test("a long name gets a key the server accepts", async () => {
      const create: CreateBy<AnyMeasurement> = createBy({
        name: "The time from the first customer report to the incident commander joining",
        projectId: PROJECT_ID,
      });

      await hooks.onBeforeCreate(create);

      // Fifty characters, cut mid-word: still a key, if not a pretty one.
      expect(create.data.key).toBe(
        "the-time-from-the-first-customer-report-to-the-inc",
      );
      expect((create.data.key as string).length).toBe(50);
    });
  });

  describe("a create that sends a key", () => {
    test("keeps it exactly as sent", async () => {
      answerKeys(["time-to-detect"]);

      const create: CreateBy<AnyMeasurement> = createBy({
        name: "Time to Detect",
        key: "ttd",
        projectId: PROJECT_ID,
      });

      await hooks.onBeforeCreate(create);

      expect(create.data.key).toBe("ttd");
      expect(create.data.metricName).toBe(`${kind.metricNamePrefix}ttd`);
    });

    test.each(["Time To Detect", "time_to_detect", "-ttd", "a".repeat(51)])(
      "refuses %p, which is not a valid key",
      async (key: string) => {
        await expect(
          hooks.onBeforeCreate(
            createBy({ name: "Time to Detect", key, projectId: PROJECT_ID }),
          ),
        ).rejects.toThrow(BadDataException);
      },
    );

    test("refuses a key another measurement of the project has, and says which", async () => {
      answerKeys(["ttd"]);

      await expect(
        hooks.onBeforeCreate(
          createBy({
            name: "Time to Detect",
            key: "ttd",
            projectId: PROJECT_ID,
          }),
        ),
      ).rejects.toThrow(
        'Another measurement in this project already has the key "ttd". Pick a different key, or leave the key out and one is made from the name.',
      );
    });

    test("is never numbered behind the back of whoever typed it", async () => {
      answerKeys(["ttd"]);

      const create: CreateBy<AnyMeasurement> = createBy({
        name: "Time to Detect",
        key: "ttd",
        projectId: PROJECT_ID,
      });

      await expect(hooks.onBeforeCreate(create)).rejects.toThrow(
        BadDataException,
      );
      expect(create.data.key).toBe("ttd");
    });
  });

  describe("getKeysInProject", () => {
    test("lists the keys the project's measurements hold, skipping empty ones", async () => {
      answerKeys(["time-to-detect", undefined, "ttd", ""]);

      await expect(kind.service.getKeysInProject(PROJECT_ID)).resolves.toEqual([
        "time-to-detect",
        "ttd",
      ]);
    });

    test("reads nothing without a project", async () => {
      await expect(kind.service.getKeysInProject(undefined)).resolves.toEqual(
        [],
      );
      expect(findBy).not.toHaveBeenCalled();
    });
  });
});

describe("MeasurementKeyAssigner.getKeyForCreate", () => {
  test("reads the project's keys once, whichever way the key is decided", async () => {
    const reads: Array<string> = [];

    const getKeysInProject: () => Promise<Array<string>> = async (): Promise<
      Array<string>
    > => {
      reads.push("read");
      return ["time-to-detect"];
    };

    await expect(
      MeasurementKeyAssigner.getKeyForCreate({
        key: undefined,
        name: "Time to Detect",
        getKeysInProject,
      }),
    ).resolves.toBe("time-to-detect-2");

    await expect(
      MeasurementKeyAssigner.getKeyForCreate({
        key: "ttd",
        name: "Time to Detect",
        getKeysInProject,
      }),
    ).resolves.toBe("ttd");

    expect(reads).toHaveLength(2);
  });

  test("checks a typed key's shape before reading anything", async () => {
    let reads: number = 0;

    await expect(
      MeasurementKeyAssigner.getKeyForCreate({
        key: "Not A Key",
        name: "Time to Detect",
        getKeysInProject: async (): Promise<Array<string>> => {
          reads++;
          return [];
        },
      }),
    ).rejects.toThrow(BadDataException);

    expect(reads).toBe(0);
  });

  test("treats a missing name like a name with nothing usable in it", async () => {
    await expect(
      MeasurementKeyAssigner.getKeyForCreate({
        key: undefined,
        name: undefined,
        getKeysInProject: async (): Promise<Array<string>> => {
          return [];
        },
      }),
    ).resolves.toBe("measurement");
  });
});
