import ProjectScopedReferenceValidator, {
  HeldRelationIds,
  ProjectScopedReference,
  ProjectScopedRelation,
  resolveReferenceIds,
} from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import IncidentService from "../../../../Server/Services/IncidentService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorService from "../../../../Server/Services/MonitorService";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The many-to-many half of the project guard. A service names its relation
 * lists (an incident's monitors, labels, on-call policies) and these helpers
 * turn a payload into references for validateReferencesBelongToProject, work
 * out what an update's rows already hold, and — for workers that copy stored
 * lists — keep only the ids a project can still use.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "3376855b-361c-427c-8982-bad7ada30414",
);

const MONITOR_A: string = "0e7c5d0e-8b44-4b53-9d3c-0f4e7a1b2c01";
const MONITOR_B: string = "0e7c5d0e-8b44-4b53-9d3c-0f4e7a1b2c02";
const MONITOR_C: string = "0e7c5d0e-8b44-4b53-9d3c-0f4e7a1b2c03";
const LABEL_A: string = "5f1e2d3c-4b5a-4968-8776-655443322110";

function relations(): Array<ProjectScopedRelation> {
  return [
    { column: "monitors", modelName: "Monitor", service: MonitorService },
    { column: "labels", modelName: "Label", service: LabelService },
  ];
}

function incident(data: {
  projectId: ObjectID;
  monitorIds?: Array<string>;
  labelIds?: Array<string>;
}): Incident {
  const model: Incident = new Incident();
  model.projectId = data.projectId;
  model.monitors = (data.monitorIds || []).map((id: string) => {
    const monitor: Monitor = new Monitor();
    monitor._id = id;
    return monitor;
  });
  model.labels = (data.labelIds || []).map((id: string) => {
    const label: Label = new Label();
    label._id = id;
    return label;
  });
  return model;
}

function describeReferences(
  references: Array<ProjectScopedReference>,
): Array<{ modelName: string; id: string; service: unknown }> {
  return references.map((reference: ProjectScopedReference) => {
    return {
      modelName: reference.modelName,
      id: reference.id!.toString(),
      service: reference.service,
    };
  });
}

describe("resolveReferenceIds", () => {
  it("reads every shape a relation list reaches a hook in", () => {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_A;

    expect(
      resolveReferenceIds([
        monitor,
        { _id: MONITOR_B },
        new ObjectID(MONITOR_C),
        LABEL_A,
      ]).map((id: ObjectID | string) => {
        return id.toString();
      }),
    ).toEqual([MONITOR_A, MONITOR_B, MONITOR_C, LABEL_A]);
  });

  it("skips entries with no id and treats a lone value as a list of one", () => {
    expect(
      resolveReferenceIds([null, {}, "", new ObjectID(""), undefined]),
    ).toEqual([]);
    expect(resolveReferenceIds(undefined)).toEqual([]);
    expect(resolveReferenceIds(null)).toEqual([]);
    expect(
      resolveReferenceIds(MONITOR_A).map((id: ObjectID | string) => {
        return id.toString();
      }),
    ).toEqual([MONITOR_A]);
  });
});

describe("ProjectScopedReferenceValidator.getRelationReferences", () => {
  it("makes one reference per id, against the relation's own model", () => {
    const references: Array<ProjectScopedReference> =
      ProjectScopedReferenceValidator.getRelationReferences({
        payload: {
          monitors: [MONITOR_A, { _id: MONITOR_B }],
          labels: [LABEL_A],
          title: "not a relation",
        },
        relations: relations(),
      });

    expect(describeReferences(references)).toEqual([
      { modelName: "Monitor", id: MONITOR_A, service: MonitorService },
      { modelName: "Monitor", id: MONITOR_B, service: MonitorService },
      { modelName: "Label", id: LABEL_A, service: LabelService },
    ]);
  });

  it("skips what the updated rows already hold in that project and column only", () => {
    const heldIds: HeldRelationIds = new Map([
      [
        PROJECT_ID.toString(),
        {
          monitors: new Set([MONITOR_A]),
          labels: new Set<string>(),
        },
      ],
      [
        OTHER_PROJECT_ID.toString(),
        {
          monitors: new Set([MONITOR_B]),
          labels: new Set([LABEL_A]),
        },
      ],
    ]);

    const references: Array<ProjectScopedReference> =
      ProjectScopedReferenceValidator.getRelationReferences({
        payload: {
          // Upper case: Postgres reads uuids back lower-cased.
          monitors: [MONITOR_A.toUpperCase(), MONITOR_B],
          labels: [LABEL_A],
        },
        relations: relations(),
        projectId: PROJECT_ID,
        heldIds: heldIds,
      });

    expect(describeReferences(references)).toEqual([
      { modelName: "Monitor", id: MONITOR_B, service: MonitorService },
      { modelName: "Label", id: LABEL_A, service: LabelService },
    ]);
  });

  it("checks everything when the project holds nothing", () => {
    const references: Array<ProjectScopedReference> =
      ProjectScopedReferenceValidator.getRelationReferences({
        payload: { monitors: [MONITOR_A] },
        relations: relations(),
        projectId: PROJECT_ID,
        heldIds: new Map(),
      });

    expect(references).toHaveLength(1);
  });
});

describe("ProjectScopedReferenceValidator.getHeldRelationIds", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the matched rows as root with their project and the listed relations", async () => {
    const findBy: SpyInstance<typeof IncidentService.findBy> = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([]);

    const query: { _id: string } = { _id: MONITOR_A };

    await ProjectScopedReferenceValidator.getHeldRelationIds({
      service: IncidentService as never,
      query: query as never,
      columns: ["monitors", "labels"],
    });

    expect(findBy).toHaveBeenCalledTimes(1);

    const args: Parameters<typeof IncidentService.findBy>[0] =
      findBy.mock.calls[0]![0];

    expect(args.query).toBe(query);
    expect(args.select).toEqual({
      _id: true,
      projectId: true,
      monitors: { _id: true },
      labels: { _id: true },
    });
    expect(args.props).toEqual({ isRoot: true });
  });

  it("counts an id as held only when every matched row in the project holds it", async () => {
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([
      incident({
        projectId: PROJECT_ID,
        monitorIds: [MONITOR_A, MONITOR_B.toUpperCase()],
        labelIds: [LABEL_A],
      }),
      incident({
        projectId: PROJECT_ID,
        monitorIds: [MONITOR_B, MONITOR_C],
      }),
      incident({
        projectId: OTHER_PROJECT_ID,
        monitorIds: [MONITOR_C],
      }),
    ]);

    const heldIds: HeldRelationIds =
      await ProjectScopedReferenceValidator.getHeldRelationIds({
        service: IncidentService as never,
        query: {} as never,
        columns: ["monitors", "labels"],
      });

    expect(
      Array.from(heldIds.get(PROJECT_ID.toString())!["monitors"]!),
    ).toEqual([MONITOR_B]);
    expect(Array.from(heldIds.get(PROJECT_ID.toString())!["labels"]!)).toEqual(
      [],
    );
    expect(
      Array.from(heldIds.get(OTHER_PROJECT_ID.toString())!["monitors"]!),
    ).toEqual([MONITOR_C]);
  });

  it("reads nothing when no relation list is being written", async () => {
    const findBy: SpyInstance<typeof IncidentService.findBy> = jest.spyOn(
      IncidentService,
      "findBy",
    );

    const heldIds: HeldRelationIds =
      await ProjectScopedReferenceValidator.getHeldRelationIds({
        service: IncidentService as never,
        query: {} as never,
        columns: [],
      });

    expect(heldIds.size).toBe(0);
    expect(findBy).not.toHaveBeenCalled();
  });
});

describe("ProjectScopedReferenceValidator.filterUsableInProject", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Stand-in for `SELECT ... WHERE _id = $1 AND projectId = $2`.
  function monitorsInProject(ids: Array<string>): jest.Mock {
    const findOneBy: jest.Mock = jest.fn(async (findBy: unknown) => {
      const query: { _id: unknown; projectId: unknown } = (
        findBy as { query: { _id: unknown; projectId: unknown } }
      ).query;

      if (
        String(query.projectId) === PROJECT_ID.toString() &&
        ids.includes(String(query._id).toLowerCase())
      ) {
        const monitor: Monitor = new Monitor();
        monitor._id = String(query._id);
        return monitor;
      }

      return null;
    }) as unknown as jest.Mock;

    jest
      .spyOn(MonitorService, "findOneBy")
      .mockImplementation(findOneBy as never);

    return findOneBy;
  }

  it("keeps the ids the project can use and reports the rest", async () => {
    monitorsInProject([MONITOR_A, MONITOR_C]);

    const result: {
      usableIds: Array<ObjectID | string>;
      droppedIds: Array<ObjectID | string>;
    } = await ProjectScopedReferenceValidator.filterUsableInProject({
      projectId: PROJECT_ID,
      ids: [new ObjectID(MONITOR_A), MONITOR_B, MONITOR_C],
      service: MonitorService,
    });

    expect(
      result.usableIds.map((id: ObjectID | string) => {
        return id.toString();
      }),
    ).toEqual([MONITOR_A, MONITOR_C]);
    expect(result.droppedIds).toEqual([MONITOR_B]);
  });

  it("looks a repeated id up once", async () => {
    const findOneBy: jest.Mock = monitorsInProject([MONITOR_A]);

    const result: {
      usableIds: Array<ObjectID | string>;
      droppedIds: Array<ObjectID | string>;
    } = await ProjectScopedReferenceValidator.filterUsableInProject({
      projectId: PROJECT_ID,
      ids: [MONITOR_A, MONITOR_A.toUpperCase()],
      service: MonitorService,
    });

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(result.usableIds).toEqual([MONITOR_A]);
    expect(result.droppedIds).toEqual([]);
  });

  it("drops a value that is not a uuid without a lookup", async () => {
    const findOneBy: jest.Mock = monitorsInProject([MONITOR_A]);

    const result: {
      usableIds: Array<ObjectID | string>;
      droppedIds: Array<ObjectID | string>;
    } = await ProjectScopedReferenceValidator.filterUsableInProject({
      projectId: PROJECT_ID,
      ids: ["not-a-uuid", MONITOR_A],
      service: MonitorService,
    });

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(result.usableIds).toEqual([MONITOR_A]);
    expect(result.droppedIds).toEqual(["not-a-uuid"]);
  });

  it("drops everything when there is no project to check against", async () => {
    const findOneBy: jest.Mock = monitorsInProject([MONITOR_A]);

    const result: {
      usableIds: Array<ObjectID | string>;
      droppedIds: Array<ObjectID | string>;
    } = await ProjectScopedReferenceValidator.filterUsableInProject({
      projectId: undefined,
      ids: [MONITOR_A],
      service: MonitorService,
    });

    expect(findOneBy).not.toHaveBeenCalled();
    expect(result.usableIds).toEqual([]);
    expect(result.droppedIds).toEqual([MONITOR_A]);
  });
});
