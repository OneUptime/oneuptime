import AIAgent from "../../../../Models/DatabaseModels/AIAgent";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Probe from "../../../../Models/DatabaseModels/Probe";
import Team from "../../../../Models/DatabaseModels/Team";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import ProjectScopedReferenceValidator, {
  ProjectScopedReferenceException,
} from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A few models keep rows every project shares: a global probe runs any
 * project's monitors, a global AI agent and a global LLM provider serve every
 * project. A reference to one of those is the project's to make - exactly as
 * ProbeService.getProbesAttachableToProject lets a monitor use a global probe
 * - so the reference check counts them as the project's, while another
 * project's own probe still reads exactly like one that does not exist.
 *
 * The Probe table is stubbed: a pinned read (by project) and a shared read
 * (by the global flag) each answer what the database would.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2d9f6c1e-5a4b-4c3d-8e7f-0a1b2c3d4e5f",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "2d9f6c1e-0000-4000-8000-0000000000ee",
);

const OWN_PROBE: string = "9b0be000-0000-4000-8000-000000000001";
const GLOBAL_PROBE: string = "9b0be000-0000-4000-8000-0000000000aa";
const FOREIGN_PROBE: string = "9b0be000-0000-4000-8000-0000000000ff";
// Flagged global, but it belongs to a project: it stays that project's.
const OWNED_FLAGGED_PROBE: string = "9b0be000-0000-4000-8000-0000000000bb";
const MISSING_PROBE: string = "9b0be000-0000-4000-8000-0000000000dd";

interface ProbeRow {
  id: string;
  projectId: ObjectID | null;
  isGlobalProbe: boolean;
}

const PROBES: Array<ProbeRow> = [
  { id: OWN_PROBE, projectId: PROJECT_ID, isGlobalProbe: false },
  { id: GLOBAL_PROBE, projectId: null, isGlobalProbe: true },
  { id: FOREIGN_PROBE, projectId: OTHER_PROJECT_ID, isGlobalProbe: false },
  { id: OWNED_FLAGGED_PROBE, projectId: OTHER_PROJECT_ID, isGlobalProbe: true },
];

// QueryHelper.isNull (a Raw "IS NULL"), as the shared read asks for "no project".
function isNullOperator(value: unknown): boolean {
  if (!(value instanceof FindOperator)) {
    return false;
  }

  const getSql: ((alias: string) => string) | undefined = (
    value as unknown as { getSql?: (alias: string) => string }
  ).getSql;

  return Boolean(getSql) && getSql!("column").includes("IS NULL");
}

type FindByInput = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
};

let probeReads: Array<FindByInput>;

function idsIn(query: Record<string, unknown>): Array<string> {
  // QueryHelper.any is a Raw operator; the ids are its one bound parameter.
  const operator: unknown = query["_id"];
  expect(operator).toBeInstanceOf(FindOperator);

  const values: Array<unknown> = Object.values(
    (operator as FindOperator<unknown>).objectLiteralParameters || {},
  )[0] as Array<unknown>;

  return values.map((id: unknown): string => {
    return String(id).toLowerCase();
  });
}

beforeEach(() => {
  probeReads = [];

  const probes: DatabaseService<Probe> =
    ProjectScopedReferenceValidator.getLookupService(Probe);

  jest.spyOn(probes, "findBy").mockImplementation((async (
    input: FindByInput,
  ): Promise<Array<Probe>> => {
    probeReads.push(input);

    const ids: Array<string> = idsIn(input.query);

    return PROBES.filter((row: ProbeRow): boolean => {
      if (!ids.includes(row.id)) {
        return false;
      }

      if (input.query["isGlobalProbe"] === true) {
        return (
          row.isGlobalProbe &&
          (!isNullOperator(input.query["projectId"]) || !row.projectId)
        );
      }

      if (input.query["projectId"]) {
        return row.projectId?.toString() === String(input.query["projectId"]);
      }

      return true;
    }).map((row: ProbeRow): Probe => {
      const probe: Probe = new Probe();
      probe._id = row.id;

      if (row.projectId) {
        probe.projectId = row.projectId;
      }

      return probe;
    });
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function probeReference(id: string): {
  modelName: string;
  id: string;
  service: DatabaseService<DatabaseBaseModel>;
} {
  return {
    modelName: "Probe",
    id: id,
    service: ProjectScopedReferenceValidator.getLookupService(
      Probe,
    ) as unknown as DatabaseService<DatabaseBaseModel>,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectScopedReferenceException);
    return (error as Error).message;
  }

  throw new Error("The reference was not refused.");
}

describe("rows every project shares", () => {
  test("are marked by a column on the probe, AI agent and LLM provider", () => {
    expect(
      ProjectScopedReferenceValidator.getSharedRowColumn(new Probe()),
    ).toBe("isGlobalProbe");
    expect(
      ProjectScopedReferenceValidator.getSharedRowColumn(new AIAgent()),
    ).toBe("isGlobalAIAgent");
    expect(
      ProjectScopedReferenceValidator.getSharedRowColumn(new LlmProvider()),
    ).toBe("isGlobalLlm");
    expect(
      ProjectScopedReferenceValidator.getSharedRowColumn(new Team()),
    ).toBeNull();
  });

  test("are looked up by id, the shared flag and no project, selecting only the id", async () => {
    const found: Set<string> =
      await ProjectScopedReferenceValidator.findSharedIds({
        service: ProjectScopedReferenceValidator.getLookupService(
          Probe,
        ) as unknown as DatabaseService<DatabaseBaseModel>,
        ids: [GLOBAL_PROBE, FOREIGN_PROBE, OWNED_FLAGGED_PROBE],
      });

    expect(Array.from(found)).toEqual([GLOBAL_PROBE]);
    expect(probeReads).toHaveLength(1);
    expect(probeReads[0]!.query["isGlobalProbe"]).toBe(true);
    expect(isNullOperator(probeReads[0]!.query["projectId"])).toBe(true);
    expect(probeReads[0]!.select).toEqual({ _id: true });
  });

  test("a flagged row that belongs to a project stays that project's", async () => {
    const refusal: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "monitor test",
        references: [probeReference(OWNED_FLAGGED_PROBE)],
      }),
    );

    expect(refusal).toContain(`Probe "${OWNED_FLAGGED_PROBE}"`);
    expect(
      await ProjectScopedReferenceValidator.keepIdsInProject({
        modelType: Probe,
        projectId: PROJECT_ID,
        ids: [OWNED_FLAGGED_PROBE, GLOBAL_PROBE],
      }),
    ).toEqual([GLOBAL_PROBE]);
  });

  test("are not looked up for a model without them", async () => {
    const teams: DatabaseService<Team> =
      ProjectScopedReferenceValidator.getLookupService(Team);
    const teamRead: ReturnType<typeof jest.spyOn> = jest.spyOn(teams, "findBy");

    const found: Set<string> =
      await ProjectScopedReferenceValidator.findSharedIds({
        service: teams as unknown as DatabaseService<DatabaseBaseModel>,
        ids: [FOREIGN_PROBE],
      });

    expect(found.size).toBe(0);
    expect(teamRead).not.toHaveBeenCalled();
  });
});

describe("a reference to a probe", () => {
  test("may name the project's own probe or a global one", async () => {
    await expect(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "monitor test",
        references: [probeReference(OWN_PROBE), probeReference(GLOBAL_PROBE)],
      }),
    ).resolves.toBeUndefined();
  });

  test("may not name another project's probe, answered like a probe that does not exist", async () => {
    const foreign: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "monitor test",
        references: [probeReference(FOREIGN_PROBE)],
      }),
    );

    const missing: string = await refusalOf(
      ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "monitor test",
        references: [probeReference(MISSING_PROBE)],
      }),
    );

    expect(foreign).toBe(
      `This monitor test references records that are not in this project: Probe "${FOREIGN_PROBE}". Please pick values from this project and try again.`,
    );
    expect(missing.replace(MISSING_PROBE, FOREIGN_PROBE)).toBe(foreign);
  });

  test("is checked by the project first, and by the shared flag only for what is left", async () => {
    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: PROJECT_ID,
      subject: "monitor test",
      references: [probeReference(OWN_PROBE), probeReference(GLOBAL_PROBE)],
    });

    expect(probeReads).toHaveLength(2);
    expect(String(probeReads[0]!.query["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
    expect(idsIn(probeReads[1]!.query)).toEqual([GLOBAL_PROBE]);
    expect(probeReads[1]!.query["isGlobalProbe"]).toBe(true);
  });

  test("reads nothing shared when every probe is the project's own", async () => {
    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: PROJECT_ID,
      subject: "monitor test",
      references: [probeReference(OWN_PROBE)],
    });

    expect(probeReads).toHaveLength(1);
  });
});

describe("an engine keeping only the project's probes", () => {
  test("keeps the project's own and the global ones, in the order given", async () => {
    expect(
      await ProjectScopedReferenceValidator.keepIdsInProject({
        modelType: Probe,
        projectId: PROJECT_ID,
        ids: [GLOBAL_PROBE, FOREIGN_PROBE, OWN_PROBE],
      }),
    ).toEqual([GLOBAL_PROBE, OWN_PROBE]);
  });
});
