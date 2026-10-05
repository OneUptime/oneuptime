import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import UserService from "../../../Server/Services/UserService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectScopedReferenceValidator, {
  ProjectScopedReferenceException,
} from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import ObjectID from "../../../Types/ObjectID";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

/*
 * An incident or alert episode update names a state and a severity, which
 * must be its own project's. The service checks them itself - against the
 * project of every episode the update changes: the request's project, or,
 * for an update with none on its request (one OneUptime makes itself, a
 * master admin's), each episode's own. Checking them against "the
 * request's project" alone checked nothing for those updates.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-e915-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-e915-4aaa-8bbb-000000000002",
);
const EPISODE_ID: string = "0193c0de-e915-4aaa-8bbb-0000000000e1";
const OTHER_EPISODE_ID: string = "0193c0de-e915-4aaa-8bbb-0000000000e2";
const OWN_SEVERITY: string = "0193c0de-e915-4aaa-8bbb-0000000000a1";
const FOREIGN_SEVERITY: string = "0193c0de-e915-4aaa-8bbb-0000000000b2";
const OWN_STATE: string = "0193c0de-e915-4aaa-8bbb-0000000000a3";
const FOREIGN_STATE: string = "0193c0de-e915-4aaa-8bbb-0000000000b4";

interface EpisodeCase {
  name: string;
  service: DatabaseService<DatabaseBaseModel>;
  modelType: { new (): DatabaseBaseModel };
  subject: string;
  severityIdColumn: string;
  severityRelation: string;
  severityTitle: string;
  stateIdColumn: string;
  stateTitle: string;
  severityTable: string;
  stateTable: string;
}

const CASES: Array<EpisodeCase> = [
  {
    name: "an incident episode",
    service:
      IncidentEpisodeService as unknown as DatabaseService<DatabaseBaseModel>,
    modelType: IncidentEpisode,
    subject: "incident episode",
    severityIdColumn: "incidentSeverityId",
    severityRelation: "incidentSeverity",
    severityTitle: "Incident Severity",
    stateIdColumn: "currentIncidentStateId",
    stateTitle: "Incident State",
    severityTable: "IncidentSeverity",
    stateTable: "IncidentState",
  },
  {
    name: "an alert episode",
    service:
      AlertEpisodeService as unknown as DatabaseService<DatabaseBaseModel>,
    modelType: AlertEpisode,
    subject: "alert episode",
    severityIdColumn: "alertSeverityId",
    severityRelation: "alertSeverity",
    severityTitle: "Alert Severity",
    stateIdColumn: "currentAlertStateId",
    stateTitle: "Alert State",
    severityTable: "AlertSeverity",
    stateTable: "AlertState",
  },
];

function episode(
  modelType: { new (): DatabaseBaseModel },
  id: string,
  projectId: ObjectID,
): DatabaseBaseModel {
  const row: DatabaseBaseModel = new modelType();
  row._id = id;
  row.setColumnValue("projectId", projectId);
  return row;
}

function onBeforeUpdate(
  testCase: EpisodeCase,
  data: Record<string, unknown>,
  props: Record<string, unknown>,
): Promise<unknown> {
  return (
    testCase.service as unknown as {
      onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
    }
  )
    .onBeforeUpdate({
      data: data,
      query: { _id: EPISODE_ID },
      props: props,
    })
    .then(
      () => {
        return "went on";
      },
      (error: unknown) => {
        return error;
      },
    );
}

const NO_PROJECT_ON_THE_REQUEST: Array<[string, Record<string, unknown>]> = [
  ["OneUptime's own update", { isRoot: true }],
  [
    "a master admin's update",
    {
      isMasterAdmin: true,
      userId: new ObjectID("0193c0de-e915-4aaa-8bbb-0000000000c1"),
    },
  ],
];

beforeEach(() => {
  stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      IncidentSeverity: [OWN_SEVERITY],
      IncidentState: [OWN_STATE],
      AlertSeverity: [OWN_SEVERITY],
      AlertState: [OWN_STATE],
    },
  });

  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue("a teammate" as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(CASES)(
  "$name updated with no project on its request",
  (testCase: EpisodeCase) => {
    beforeEach(() => {
      // The episode the update matches is in PROJECT_ID.
      jest
        .spyOn(testCase.service, "findBy")
        .mockResolvedValue([
          episode(testCase.modelType, EPISODE_ID, PROJECT_ID),
        ] as never);
    });

    test.each(NO_PROJECT_ON_THE_REQUEST)(
      "%s naming another project's severity is refused",
      async (_who: string, props: Record<string, unknown>) => {
        const outcome: unknown = await onBeforeUpdate(
          testCase,
          { [testCase.severityIdColumn]: new ObjectID(FOREIGN_SEVERITY) },
          props,
        );

        expect(outcome).toBeInstanceOf(ProjectScopedReferenceException);
        expect((outcome as Error).message).toBe(
          ProjectScopedReferenceValidator.getRefusalMessage({
            subject: testCase.subject,
            described: [`${testCase.severityTitle} "${FOREIGN_SEVERITY}"`],
          }),
        );
      },
    );

    test.each(NO_PROJECT_ON_THE_REQUEST)(
      "%s naming another project's severity by the relation is refused",
      async (_who: string, props: Record<string, unknown>) => {
        const outcome: unknown = await onBeforeUpdate(
          testCase,
          { [testCase.severityRelation]: { _id: FOREIGN_SEVERITY } },
          props,
        );

        expect(outcome).toBeInstanceOf(ProjectScopedReferenceException);
        expect((outcome as Error).message).toContain(FOREIGN_SEVERITY);
      },
    );

    test.each(NO_PROJECT_ON_THE_REQUEST)(
      "%s naming another project's state is refused",
      async (_who: string, props: Record<string, unknown>) => {
        const outcome: unknown = await onBeforeUpdate(
          testCase,
          { [testCase.stateIdColumn]: new ObjectID(FOREIGN_STATE) },
          props,
        );

        expect(outcome).toBeInstanceOf(ProjectScopedReferenceException);
        expect((outcome as Error).message).toContain(FOREIGN_STATE);
      },
    );

    test.each(NO_PROJECT_ON_THE_REQUEST)(
      "%s naming the episode's own project's severity and state goes on",
      async (_who: string, props: Record<string, unknown>) => {
        expect(
          await onBeforeUpdate(
            testCase,
            {
              [testCase.severityIdColumn]: new ObjectID(OWN_SEVERITY),
              [testCase.stateIdColumn]: new ObjectID(OWN_STATE),
            },
            props,
          ),
        ).toBe("went on");
      },
    );

    test("the severity is checked against the project the episode is in", async () => {
      const validate: SpyInstance = getJestSpyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      );

      await onBeforeUpdate(
        testCase,
        { [testCase.severityIdColumn]: new ObjectID(OWN_SEVERITY) },
        { isRoot: true },
      );

      const ownCheck: { projectId: ObjectID | undefined } | undefined =
        validate.mock.calls
          .map((call: Array<unknown>) => {
            return call[0] as {
              projectId: ObjectID | undefined;
              subject?: string | undefined;
            };
          })
          .find((data: { subject?: string | undefined }): boolean => {
            return data.subject === testCase.subject;
          });

      expect(ownCheck?.projectId?.toString()).toBe(PROJECT_ID.toString());
    });

    test("an update matching episodes of two projects is checked against each", async () => {
      jest
        .spyOn(testCase.service, "findBy")
        .mockResolvedValue([
          episode(testCase.modelType, EPISODE_ID, PROJECT_ID),
          episode(testCase.modelType, OTHER_EPISODE_ID, OTHER_PROJECT_ID),
        ] as never);

      // The severity is PROJECT_ID's, so the other project's episode refuses it.
      const outcome: unknown = await onBeforeUpdate(
        testCase,
        { [testCase.severityIdColumn]: new ObjectID(OWN_SEVERITY) },
        { isRoot: true },
      );

      expect(outcome).toBeInstanceOf(ProjectScopedReferenceException);
      expect((outcome as Error).message).toContain(OWN_SEVERITY);
    });

    test("an update matching no episode checks nothing, and goes on", async () => {
      jest.spyOn(testCase.service, "findBy").mockResolvedValue([] as never);

      expect(
        await onBeforeUpdate(
          testCase,
          { [testCase.severityIdColumn]: new ObjectID(FOREIGN_SEVERITY) },
          { isRoot: true },
        ),
      ).toBe("went on");
    });
  },
);

describe.each(CASES)("$name updated in a project", (testCase: EpisodeCase) => {
  test("is checked against the request's project, without reading the episodes' projects", async () => {
    const readProjects: SpyInstance = getJestSpyOn(
      ProjectScopedReferenceValidator,
      "getProjectIdsOfRecords",
    );

    const outcome: unknown = await onBeforeUpdate(
      testCase,
      { [testCase.severityIdColumn]: new ObjectID(FOREIGN_SEVERITY) },
      { tenantId: PROJECT_ID },
    );

    expect(outcome).toBeInstanceOf(ProjectScopedReferenceException);
    expect(readProjects).not.toHaveBeenCalled();
  });

  test("goes on for its own project's severity", async () => {
    expect(
      await onBeforeUpdate(
        testCase,
        { [testCase.severityIdColumn]: new ObjectID(OWN_SEVERITY) },
        { tenantId: PROJECT_ID },
      ),
    ).toBe("went on");
  });
});

describe("ProjectScopedReferenceValidator.validateUpdateReferences", () => {
  const SEVERITY_REFERENCE: (id: string) => {
    modelName: string;
    id: string;
    service: DatabaseService<DatabaseBaseModel>;
  } = (id: string) => {
    return {
      modelName: "Incident Severity",
      id: id,
      service: ProjectScopedReferenceValidator.getLookupService(
        IncidentSeverity,
      ) as unknown as DatabaseService<DatabaseBaseModel>,
    };
  };

  test("reads nothing for an update that names no reference", async () => {
    const findBy: SpyInstance = getJestSpyOn(IncidentEpisodeService, "findBy");

    await ProjectScopedReferenceValidator.validateUpdateReferences({
      service: IncidentEpisodeService,
      updateBy: {
        data: {},
        query: { _id: EPISODE_ID },
        props: { isRoot: true },
      } as never,
      references: [],
    });

    expect(findBy).not.toHaveBeenCalled();
  });

  test("reads each matched record's project once, in any case", async () => {
    jest
      .spyOn(IncidentEpisodeService, "findBy")
      .mockResolvedValue([
        episode(IncidentEpisode, EPISODE_ID, PROJECT_ID),
        episode(
          IncidentEpisode,
          OTHER_EPISODE_ID,
          new ObjectID(PROJECT_ID.toString().toUpperCase()),
        ),
      ] as never);

    const projectIds: Array<ObjectID> =
      await ProjectScopedReferenceValidator.getProjectIdsOfRecords({
        service:
          IncidentEpisodeService as unknown as DatabaseService<DatabaseBaseModel>,
        query: { _id: EPISODE_ID } as never,
      });

    expect(
      projectIds.map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    ).toEqual([PROJECT_ID.toString().toLowerCase()]);
  });

  test("a record's project is read as root, so the read is not narrowed to the caller", async () => {
    const findBy: SpyInstance = getJestSpyOn(
      IncidentEpisodeService,
      "findBy",
    ).mockResolvedValue([]);

    await ProjectScopedReferenceValidator.getProjectIdsOfRecords({
      service:
        IncidentEpisodeService as unknown as DatabaseService<DatabaseBaseModel>,
      query: { _id: EPISODE_ID } as never,
    });

    expect(findBy.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(findBy.mock.calls[0]![0].select).toEqual({
      _id: true,
      projectId: true,
    });
  });

  test("a model with no project has no projects to read", async () => {
    const findBy: SpyInstance = getJestSpyOn(UserService, "findBy");

    expect(
      await ProjectScopedReferenceValidator.getProjectIdsOfRecords({
        service: UserService as unknown as DatabaseService<DatabaseBaseModel>,
        query: {} as never,
      }),
    ).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("refuses another project's record against the request's project", async () => {
    await expect(
      ProjectScopedReferenceValidator.validateUpdateReferences({
        service: IncidentEpisodeService,
        updateBy: {
          data: {},
          query: { _id: EPISODE_ID },
          props: { tenantId: PROJECT_ID },
        } as never,
        references: [SEVERITY_REFERENCE(FOREIGN_SEVERITY)],
        subject: "incident episode",
      }),
    ).rejects.toThrow(ProjectScopedReferenceException);
  });

  test("accepts the project's own record against a matched record's project", async () => {
    jest
      .spyOn(IncidentEpisodeService, "findBy")
      .mockResolvedValue([
        episode(IncidentEpisode, EPISODE_ID, PROJECT_ID),
      ] as never);

    await expect(
      ProjectScopedReferenceValidator.validateUpdateReferences({
        service: IncidentEpisodeService,
        updateBy: {
          data: {},
          query: { _id: EPISODE_ID },
          props: { isRoot: true },
        } as never,
        references: [SEVERITY_REFERENCE(OWN_SEVERITY)],
        subject: "incident episode",
      }),
    ).resolves.toBeUndefined();
  });

  test("the severity models stay the lookups the episodes use", () => {
    // A rename of either model would move the check to another service.
    expect(new IncidentSeverity().tableName).toBe("IncidentSeverity");
    expect(new AlertSeverity().tableName).toBe("AlertSeverity");
  });
});
