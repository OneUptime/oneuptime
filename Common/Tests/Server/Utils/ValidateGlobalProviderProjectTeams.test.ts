import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";

/*
 * TeamService reaches Postgres, so it is replaced with a fake whose only job
 * is to answer "which teams exist and which project does each belong to".
 * The mock must be declared before the module under test is imported.
 */
const findByMock: jest.Mock = jest.fn();

jest.mock("../../../Server/Services/TeamService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>) => {
        return findByMock(...args);
      },
    },
  };
});

import validateGlobalProviderProjectTeams, {
  resolveAttachmentProjectId,
} from "../../../Server/Utils/ValidateGlobalProviderProjectTeams";

type MakeTeamFunction = (data: { id: string; projectId?: string }) => Team;

const makeTeam: MakeTeamFunction = (data: {
  id: string;
  projectId?: string;
}): Team => {
  const team: Team = new Team();
  team.id = new ObjectID(data.id);

  if (data.projectId) {
    team.projectId = new ObjectID(data.projectId);
  }

  return team;
};

describe("resolveAttachmentProjectId", () => {
  const projectId: ObjectID = ObjectID.generate();

  test("should prefer an explicit projectId", () => {
    const other: Project = new Project();
    other.id = ObjectID.generate();

    expect(
      resolveAttachmentProjectId({ projectId, project: other })?.toString(),
    ).toEqual(projectId.toString());
  });

  test("should fall back to the project relation's id", () => {
    const project: Project = new Project();
    project.id = projectId;

    expect(resolveAttachmentProjectId({ project })?.toString()).toEqual(
      projectId.toString(),
    );
  });

  test("should fall back to a bare _id on the project relation", () => {
    /*
     * The Admin Dashboard entity dropdown submits the related Project as a
     * plain object carrying only `_id`, which is the shape this branch exists
     * for.
     */
    const project: Project = {
      _id: projectId.toString(),
    } as unknown as Project;

    expect(resolveAttachmentProjectId({ project })?.toString()).toEqual(
      projectId.toString(),
    );
  });

  test("should return undefined when neither is present", () => {
    expect(resolveAttachmentProjectId({})).toBeUndefined();
    expect(
      resolveAttachmentProjectId({ project: new Project() }),
    ).toBeUndefined();
  });
});

describe("validateGlobalProviderProjectTeams", () => {
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    findByMock.mockReset();
  });

  test("should do nothing when no teams are selected", async () => {
    await expect(
      validateGlobalProviderProjectTeams({ teams: undefined, projectId }),
    ).resolves.toBeUndefined();

    await expect(
      validateGlobalProviderProjectTeams({ teams: [], projectId }),
    ).resolves.toBeUndefined();

    // No teams means no reason to hit the database at all.
    expect(findByMock).not.toHaveBeenCalled();
  });

  test("should reject teams selected without a project", async () => {
    const team: Team = makeTeam({ id: ObjectID.generate().toString() });

    await expect(
      validateGlobalProviderProjectTeams({
        teams: [team],
        projectId: undefined,
      }),
    ).rejects.toThrow(BadDataException);

    expect(findByMock).not.toHaveBeenCalled();
  });

  test("should pass when every team belongs to the target project", async () => {
    const first: string = ObjectID.generate().toString();
    const second: string = ObjectID.generate().toString();

    findByMock.mockResolvedValue([
      makeTeam({ id: first, projectId: projectId.toString() }),
      makeTeam({ id: second, projectId: projectId.toString() }),
    ]);

    await expect(
      validateGlobalProviderProjectTeams({
        teams: [makeTeam({ id: first }), makeTeam({ id: second })],
        projectId,
      }),
    ).resolves.toBeUndefined();

    expect(findByMock).toHaveBeenCalledTimes(1);
  });

  test("should reject a team that belongs to a different project", async () => {
    /*
     * This is the guard's whole reason to exist: the SSO login fan-out
     * provisions a TeamMember with the attachment's projectId and the team's
     * id, and runs with ignoreHooks, so a cross-project team here would
     * produce a corrupt membership row that nothing else would catch.
     */
    const mine: string = ObjectID.generate().toString();
    const theirs: string = ObjectID.generate().toString();

    findByMock.mockResolvedValue([
      makeTeam({ id: mine, projectId: projectId.toString() }),
      makeTeam({ id: theirs, projectId: otherProjectId.toString() }),
    ]);

    await expect(
      validateGlobalProviderProjectTeams({
        teams: [makeTeam({ id: mine }), makeTeam({ id: theirs })],
        projectId,
      }),
    ).rejects.toThrow(
      "All selected teams must belong to the project this provider is attached to.",
    );
  });

  test("should reject when a selected team does not exist", async () => {
    const present: string = ObjectID.generate().toString();
    const missing: string = ObjectID.generate().toString();

    findByMock.mockResolvedValue([
      makeTeam({ id: present, projectId: projectId.toString() }),
    ]);

    await expect(
      validateGlobalProviderProjectTeams({
        teams: [makeTeam({ id: present }), makeTeam({ id: missing })],
        projectId,
      }),
    ).rejects.toThrow("One or more selected teams could not be found.");
  });

  test("should reject a team with no project at all", async () => {
    const teamId: string = ObjectID.generate().toString();

    findByMock.mockResolvedValue([makeTeam({ id: teamId })]);

    await expect(
      validateGlobalProviderProjectTeams({
        teams: [makeTeam({ id: teamId })],
        projectId,
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("should accept teams submitted as bare _id objects", async () => {
    const teamId: string = ObjectID.generate().toString();

    findByMock.mockResolvedValue([
      makeTeam({ id: teamId, projectId: projectId.toString() }),
    ]);

    await expect(
      validateGlobalProviderProjectTeams({
        teams: [{ _id: teamId } as unknown as Team],
        projectId,
      }),
    ).resolves.toBeUndefined();
  });

  test("should skip the lookup when no team carries an id", async () => {
    // Nothing identifiable to validate, so there is nothing to query for.
    await expect(
      validateGlobalProviderProjectTeams({
        teams: [new Team()],
        projectId,
      }),
    ).resolves.toBeUndefined();

    expect(findByMock).not.toHaveBeenCalled();
  });
});
