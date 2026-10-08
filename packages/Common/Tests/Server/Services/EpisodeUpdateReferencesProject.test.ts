import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import UserService from "../../../Server/Services/UserService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectScopedReferenceValidator, {
  ProjectScopedReferenceException,
  ProjectScopedSingleRelation,
} from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../../../Server/Utils/Database/RelationIdUtil";
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

import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
type SpyInstance = ReturnType<typeof getJestSpyOn>;

/*
 * An incident or alert episode update names a state and a severity, which
 * must be its own project's. The service checks them itself - against the
 * project of every episode the update changes: the request's project, or,
 * for an update with none on its request (one OneUptime makes itself, a
 * master admin's), each episode's own. Checking them against "the
 * request's project" alone checked nothing for those updates. There, an id
 * every matched episode of the project already holds is left alone, as the
 * generic reference check leaves it: writing it back attaches nothing new.
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
    .mockResolvedValue(FeedMarkdown.asMarkdown("a teammate") as never);
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
  test("is checked against the request's project, without reading the episodes", async () => {
    const readHeld: SpyInstance = getJestSpyOn(
      ProjectScopedReferenceValidator,
      "getHeldRelationIds",
    );

    const outcome: unknown = await onBeforeUpdate(
      testCase,
      { [testCase.severityIdColumn]: new ObjectID(FOREIGN_SEVERITY) },
      { tenantId: PROJECT_ID },
    );

    expect(outcome).toBeInstanceOf(ProjectScopedReferenceException);
    expect(readHeld).not.toHaveBeenCalled();
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
  const SEVERITY: ProjectScopedSingleRelation = {
    idColumn: "incidentSeverityId",
    relation: "incidentSeverity",
    modelName: "Incident Severity",
    service: ProjectScopedReferenceValidator.getLookupService(
      IncidentSeverity,
    ) as unknown as DatabaseService<DatabaseBaseModel>,
  };

  function validate(data: {
    payload: Record<string, unknown>;
    props: Record<string, unknown>;
    skip?: number | undefined;
    limit?: number | undefined;
  }): Promise<void> {
    return ProjectScopedReferenceValidator.validateUpdateReferences({
      service: IncidentEpisodeService,
      updateBy: {
        data: data.payload,
        query: { _id: EPISODE_ID },
        skip: data.skip ?? 0,
        limit: data.limit ?? 1,
        props: data.props,
      } as never,
      relations: [SEVERITY],
      subject: "incident episode",
    });
  }

  // An episode of `projectId` holding `severityId` (null: none).
  function episodeHolding(
    id: string,
    projectId: ObjectID,
    severityId: string | null,
  ): DatabaseBaseModel {
    const row: DatabaseBaseModel = episode(IncidentEpisode, id, projectId);

    if (severityId) {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = severityId;
      row.setColumnValue("incidentSeverity", severity);
    }

    return row;
  }

  test("reads nothing for an update that names none of its relations", async () => {
    const findBy: SpyInstance = getJestSpyOn(IncidentEpisodeService, "findBy");

    await validate({ payload: { title: "Renamed" }, props: { isRoot: true } });

    expect(findBy).not.toHaveBeenCalled();
  });

  test("refuses two names that disagree before reading anything", async () => {
    const findBy: SpyInstance = getJestSpyOn(IncidentEpisodeService, "findBy");

    await expect(
      validate({
        payload: {
          incidentSeverityId: new ObjectID(OWN_SEVERITY),
          incidentSeverity: { _id: FOREIGN_SEVERITY },
        },
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      RelationIdUtil.getConflictMessage("Incident Severity", [
        "incidentSeverityId",
        "incidentSeverity",
      ]),
    );
    expect(findBy).not.toHaveBeenCalled();
  });

  test("refuses another project's record against the request's project", async () => {
    await expect(
      validate({
        payload: { incidentSeverityId: new ObjectID(FOREIGN_SEVERITY) },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(ProjectScopedReferenceException);
  });

  test("accepts the project's own record against a matched record's project", async () => {
    jest
      .spyOn(IncidentEpisodeService, "findBy")
      .mockResolvedValue([
        episodeHolding(EPISODE_ID, PROJECT_ID, null),
      ] as never);

    await expect(
      validate({
        payload: { incidentSeverity: { _id: OWN_SEVERITY } },
        props: { isRoot: true },
      }),
    ).resolves.toBeUndefined();
  });

  test("reads the records the update writes, as root: its query, skip and limit", async () => {
    const findBy: SpyInstance = getJestSpyOn(
      IncidentEpisodeService,
      "findBy",
    ).mockResolvedValue([]);

    await validate({
      payload: { incidentSeverityId: new ObjectID(OWN_SEVERITY) },
      props: { isRoot: true },
      skip: 5,
      limit: 20,
    });

    const read: Record<string, unknown> = findBy.mock.calls[0]![0];

    expect(read["query"]).toEqual({ _id: EPISODE_ID });
    expect(read["skip"]).toBe(5);
    expect(read["limit"]).toBe(20);
    expect(read["props"]).toEqual({ isRoot: true });
    expect(read["select"]).toEqual({
      _id: true,
      projectId: true,
      incidentSeverity: { _id: true },
    });
  });

  test("an id every matched record of the project already holds is left alone", async () => {
    jest
      .spyOn(IncidentEpisodeService, "findBy")
      .mockResolvedValue([
        episodeHolding(EPISODE_ID, PROJECT_ID, FOREIGN_SEVERITY),
        episodeHolding(OTHER_EPISODE_ID, PROJECT_ID, FOREIGN_SEVERITY),
      ] as never);

    await expect(
      validate({
        payload: { incidentSeverityId: new ObjectID(FOREIGN_SEVERITY) },
        props: { isRoot: true },
      }),
    ).resolves.toBeUndefined();
  });

  test("an id only some of the matched records hold is checked", async () => {
    jest
      .spyOn(IncidentEpisodeService, "findBy")
      .mockResolvedValue([
        episodeHolding(EPISODE_ID, PROJECT_ID, FOREIGN_SEVERITY),
        episodeHolding(OTHER_EPISODE_ID, PROJECT_ID, null),
      ] as never);

    await expect(
      validate({
        payload: { incidentSeverityId: new ObjectID(FOREIGN_SEVERITY) },
        props: { isRoot: true },
      }),
    ).rejects.toThrow(ProjectScopedReferenceException);
  });

  test("an id a record holds in the request's project is still checked", async () => {
    // The request's project decides, as it did before: no held ids are read.
    const findBy: SpyInstance = getJestSpyOn(IncidentEpisodeService, "findBy");

    await expect(
      validate({
        payload: { incidentSeverityId: new ObjectID(FOREIGN_SEVERITY) },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(ProjectScopedReferenceException);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("the severity models stay the lookups the episodes use", () => {
    // A rename of either model would move the check to another service.
    expect(new IncidentSeverity().tableName).toBe("IncidentSeverity");
    expect(new AlertSeverity().tableName).toBe("AlertSeverity");
  });
});
