import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Issue #3394: the owner-row invariant, exercised through the service.
 *
 * `OwnerRowUniqueness.test.ts` proves every owner model DECLARES the rule.
 * This proves the declaration actually bites on the write path that all the
 * non-dashboard callers share — REST, workflow components, `addOwners` and
 * the owner rule engines all reach the database through
 * `DatabaseService.create()`, which runs `checkUniqueColumnBy` before insert.
 *
 * The third test is the one that would have caught a subtler mistake: the
 * generic uniqueness check compares with `LOWER(column) = ...`, which is
 * correct for the name/domain columns that used to be its only callers and
 * invalid against a uuid column (Postgres has no `lower(uuid)`). Owner rows
 * are the first uuid user of the mechanism, so the lookup has to be an exact
 * ObjectID match or every owner create would 500 instead of deduplicating.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const TEAM_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const incidentOwnerTeamServiceInternals: {
  checkUniqueColumnBy: (
    createBy: CreateBy<IncidentOwnerTeam>,
  ) => Promise<CreateBy<IncidentOwnerTeam>>;
} = IncidentOwnerTeamService as unknown as {
  checkUniqueColumnBy: (
    createBy: CreateBy<IncidentOwnerTeam>,
  ) => Promise<CreateBy<IncidentOwnerTeam>>;
};

function createBy(): CreateBy<IncidentOwnerTeam> {
  const row: IncidentOwnerTeam = new IncidentOwnerTeam();
  row.projectId = PROJECT_ID;
  row.incidentId = INCIDENT_ID;
  row.teamId = TEAM_ID;

  return { data: row, props: { isRoot: true } };
}

function mockExistingRowCount(count: number): void {
  jest
    .spyOn(IncidentOwnerTeamService, "countBy")
    .mockResolvedValue(new PositiveNumber(count));
}

describe("Owner row de-duplication", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects a second owner row for the same incident, team and project", async () => {
    mockExistingRowCount(1);

    await expect(
      incidentOwnerTeamServiceInternals.checkUniqueColumnBy(createBy()),
    ).rejects.toThrow(BadDataException);
  });

  it("allows the first owner row through", async () => {
    mockExistingRowCount(0);

    await expect(
      incidentOwnerTeamServiceInternals.checkUniqueColumnBy(createBy()),
    ).resolves.toBeDefined();
  });

  it("scopes the lookup to the incident and project and matches the team id exactly", async () => {
    mockExistingRowCount(0);

    await incidentOwnerTeamServiceInternals.checkUniqueColumnBy(createBy());

    expect(IncidentOwnerTeamService.countBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID,
          /*
           * An ObjectID, not a Raw `LOWER(...)` expression. Scoped to the
           * incident and project too — an unscoped rule would make a team
           * able to own only one incident in the entire instance, which is
           * the ProjectCallSMSConfig failure mode from issue #3020.
           */
          teamId: expect.any(ObjectID),
        }),
      }),
    );
  });
});
