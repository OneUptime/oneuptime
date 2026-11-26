import DataStoreOwnerTeam from "../../../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "../../../../../Models/DatabaseModels/DataStoreOwnerUser";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../../Models/DatabaseModels/User";
import DataStoreOwnerTeamService from "../../../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../../../Server/Services/DataStoreOwnerUserService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../../../Server/Services/TeamPermissionService";
import TeamService from "../../../../../Server/Services/TeamService";
import UserService from "../../../../../Server/Services/UserService";
import { nameOwners } from "../../../../../Server/Utils/AI/DataSecurity/Actions/StoreOwnerChanges";
import { DataSecurityAiPlannedChange } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiAction";
import DataSecurityIssueDossier from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueDossier";
import DataStoreOwnerPlanner from "../../../../../Server/Utils/AI/DataSecurity/DataStoreOwnerPlanner";
import DataStoreOwnerEvidenceReader from "../../../../../Server/Utils/AI/DataSecurity/Owners/DataStoreOwnerEvidenceReader";
import { FEED_INVITEE_UNNAMED } from "../../../../../Server/Utils/Feed/FeedPersonName";
import { WithheldProfile } from "../../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import {
  DataStoreOwnerCandidate,
  DataStoreOwnerConfidence,
  DataStoreOwnerEvidenceSource,
  DataStoreOwnerKind,
  DataStoreOwnerRef,
} from "../../../../../Types/DataSecurity/DataStoreOwnerProposal";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import { DataStoreOwnerDirectory } from "../../../../../Utils/DataSecurity/DataStoreOwnerEvidence";
import {
  FEED_MEMBER_CASES,
  FEED_PERSON_CASES,
  FeedPersonCase,
  MEMBER_ADDRESS,
  expectNoAddressIn,
  feedPersonAccount,
  stubInvitations,
} from "../../../../Helpers/FeedPersonCases";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * DATA SECURITY'S AI NAMES A STORE'S OWNERS WITHOUT THEIR ADDRESS (#10681).
 *
 * OneUptime AI proposes who owns a data store, and its proposal - "Make
 * Ana Lee the owner of orders-db" - and the line that says the owners were
 * added are written on the store's and its issues' timelines, which the API
 * and workflows read. A member with no name was proposed by their address
 * ("Make ana.lee@acme.test the owner of ..."), and the owners a person
 * picked before approving were named by their name, else their address -
 * someone only invited by their account's own name.
 *
 * Now a candidate is named as every line names a member (the directory's
 * getName), the owners picked through FeedPersonName.readNames, and an
 * issue's analysis card names an owner only invited by the name typed with
 * their invitation, still without ever reading an address.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10681ddd-0000-4000-8000-000000000001",
);
const STORE_ID: ObjectID = new ObjectID("10681ddd-0000-4000-8000-000000000002");
const TEAM_ID: string = "10681ddd-0000-4000-8000-000000000003";
const PERSON_ID: string = "10681ddd-0000-4000-8000-0000000000a1";

let account: User | null;

beforeEach(() => {
  account = null;

  jest.spyOn(UserService, "findOneById").mockImplementation((async (args: {
    id: ObjectID;
  }) => {
    return args.id.toString() === PERSON_ID ? account : null;
  }) as never);
  jest.spyOn(TeamService, "findOneBy").mockImplementation((async () => {
    const team: Team = new Team(new ObjectID(TEAM_ID));
    team.name = "Payments";
    return team;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function setPerson(who: FeedPersonCase): ReturnType<typeof stubInvitations> {
  account = feedPersonAccount(new ObjectID(PERSON_ID), who);

  return stubInvitations(
    new Map<string, WithheldProfile>(
      who.invitation ? [[PERSON_ID, who.invitation]] : [],
    ),
  );
}

const PERSON: DataStoreOwnerRef = {
  kind: DataStoreOwnerKind.User,
  id: PERSON_ID,
};
const TEAM: DataStoreOwnerRef = { kind: DataStoreOwnerKind.Team, id: TEAM_ID };

describe.each(FEED_PERSON_CASES)(
  "$label, picked as a store's owner",
  (who: FeedPersonCase) => {
    test("the owners picked are named as every line names people, and a team by its name", async () => {
      setPerson(who);

      const named: Array<DataStoreOwnerRef & { name: string }> =
        await nameOwners({ projectId: PROJECT_ID, owners: [PERSON, TEAM] });

      expect(named).toEqual([
        { ...PERSON, name: who.named },
        { ...TEAM, name: "Payments" },
      ]);
      expectNoAddressIn(JSON.stringify(named));
    });
  },
);

describe("the owners picked", () => {
  test("who of them is only invited is read once, in the project", async () => {
    const withheldIn: ReturnType<typeof stubInvitations> = setPerson(
      FEED_PERSON_CASES[0]!,
    );

    await nameOwners({ projectId: PROJECT_ID, owners: [TEAM, PERSON] });

    expect(withheldIn).toHaveBeenCalledTimes(1);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
    expect(withheldIn.mock.calls[0]![0].userIds).toEqual([PERSON_ID]);
  });

  test("somebody who is gone has no name, as before", async () => {
    stubInvitations(new Map<string, WithheldProfile>());

    expect(
      await nameOwners({ projectId: PROJECT_ID, owners: [PERSON] }),
    ).toEqual([{ ...PERSON, name: "" }]);
  });
});

// The directory of the project's people, as the reader reads it.
async function readDirectoryWith(
  who: FeedPersonCase,
): Promise<DataStoreOwnerDirectory> {
  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async () => {
    const row: TeamMember = new TeamMember();
    row.userId = new ObjectID(PERSON_ID);
    row.teamId = new ObjectID(TEAM_ID);
    row.user = feedPersonAccount(new ObjectID(PERSON_ID), who);
    return [row];
  }) as never);
  jest.spyOn(TeamService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([] as never);

  return await DataStoreOwnerEvidenceReader.readDirectory(PROJECT_ID);
}

function candidateOf(name: string): DataStoreOwnerCandidate {
  return {
    ...PERSON,
    ref: "P1",
    name,
    evidenceIds: ["E1"],
    canOpenStore: false,
  };
}

describe.each(FEED_MEMBER_CASES)(
  "$label, found as a store's owner",
  (who: FeedPersonCase) => {
    test("the directory names them as every line names a member", () => {
      const directory: DataStoreOwnerDirectory = new DataStoreOwnerDirectory({
        people: [
          {
            id: PERSON_ID,
            name: who.account.name || "",
            email: who.account.email,
            teamIds: [],
          },
        ],
        teams: [],
        grantsByTeam: new Map(),
      });

      expect(directory.getName(PERSON)).toBe(who.named);
    });

    test("the directory read from the project names them so, and still finds them by their address", async () => {
      const directory: DataStoreOwnerDirectory = await readDirectoryWith(who);

      expect(directory.getName(PERSON)).toBe(who.named);
      // Evidence that names their address still reaches them.
      expect(directory.getPersonByEmail(MEMBER_ADDRESS)?.id).toBe(PERSON_ID);
    });

    test("a proposal to make them the owner is titled by that name, and its line holds no address", async () => {
      const directory: DataStoreOwnerDirectory = await readDirectoryWith(who);
      const candidate: DataStoreOwnerCandidate = candidateOf(
        directory.getName(PERSON),
      );

      const change: DataSecurityAiPlannedChange =
        DataStoreOwnerPlanner.toChange({
          plan: {
            dataStoreId: STORE_ID.toString(),
            dataStoreName: "orders-db",
            owners: [candidate],
            confidence: DataStoreOwnerConfidence.High,
            reason: "The service that writes the store names them.",
            disagreement: "",
            restsOn: ["E1"],
            evidence: [
              {
                id: "E1",
                source: DataStoreOwnerEvidenceSource.ServiceOwners,
                serviceId: "10681ddd-0000-4000-8000-0000000000e1",
                serviceName: "orders",
                isServiceTelemetry: false,
                owners: [PERSON],
              },
            ],
            candidates: [candidate],
            ruleFacts: [],
            isSensitive: true,
          },
        });

      expect(change.title).toBe(`Make ${who.named} the owner of orders-db`);
      expect(change.changeMarkdown).toContain(`**${who.named}** (person)`);
      expect(change.changeMarkdown).toContain(
        `${who.named} cannot open this store in Data Security today`,
      );
      expect(change.reasonMarkdown).toContain(`owned by **${who.named}**`);
      expectNoAddressIn(JSON.stringify(change));
    });
  },
);

// How an issue's analysis card names an owner: nobody it cannot name safely.
function cardNameOf(who: FeedPersonCase): Array<string> {
  if (who.invitation) {
    return [who.named];
  }

  const name: string = (who.account.name || "").trim();

  return name && !name.includes("@") ? [name] : [];
}

describe.each(FEED_PERSON_CASES)(
  "$label, owning the store an issue is on",
  (who: FeedPersonCase) => {
    test("the analysis card names them by what every line may say, counts them, and reads no address", async () => {
      setPerson(who);

      const findOwners: ReturnType<typeof jest.spyOn> = jest
        .spyOn(DataStoreOwnerUserService, "findBy")
        .mockImplementation((async () => {
          const row: DataStoreOwnerUser = new DataStoreOwnerUser();
          row._id = "10681ddd-0000-4000-8000-0000000000f1";
          row.userId = new ObjectID(PERSON_ID);

          // Only the name is read: never the address.
          const user: User = new User(new ObjectID(PERSON_ID));

          if (who.account.name !== undefined) {
            user.name = new Name(who.account.name);
          }

          row.user = user;
          return [row];
        }) as never);
      jest
        .spyOn(DataStoreOwnerTeamService, "findBy")
        .mockImplementation((async () => {
          const row: DataStoreOwnerTeam = new DataStoreOwnerTeam();
          row._id = "10681ddd-0000-4000-8000-0000000000f2";
          const team: Team = new Team(new ObjectID(TEAM_ID));
          team.name = "Payments";
          row.team = team;
          return [row];
        }) as never);

      const owners: Awaited<
        ReturnType<typeof DataSecurityIssueDossier.readOwners>
      > = await DataSecurityIssueDossier.readOwners(PROJECT_ID, STORE_ID);

      expect(owners.names).toEqual([...cardNameOf(who), "Payments"]);
      expect(owners.count).toBe(2);
      expect(owners.recordIds).toHaveLength(2);
      expectNoAddressIn(JSON.stringify(owners));
      expect(
        (findOwners.mock.calls[0]![0] as { select: unknown }).select,
      ).toEqual({ _id: true, userId: true, user: { name: true } });
    });
  },
);

test("REGRESSION: a member with no name is no longer proposed as an owner by their address", async () => {
  const directory: DataStoreOwnerDirectory = await readDirectoryWith(
    FEED_PERSON_CASES[5]!,
  );

  expect(directory.getName(PERSON)).toBe("ana.lee");
  expect(directory.getName(PERSON)).not.toBe(MEMBER_ADDRESS);
});

test("REGRESSION: an owner only invited with no name typed is named on the card as someone who hasn't joined", async () => {
  setPerson(FEED_PERSON_CASES[1]!);
  jest
    .spyOn(DataStoreOwnerUserService, "findBy")
    .mockImplementation((async () => {
      const row: DataStoreOwnerUser = new DataStoreOwnerUser();
      row.userId = new ObjectID(PERSON_ID);
      const user: User = new User(new ObjectID(PERSON_ID));
      user.name = new Name("Ivy Account");
      row.user = user;
      return [row];
    }) as never);
  jest
    .spyOn(DataStoreOwnerTeamService, "findBy")
    .mockResolvedValue([] as never);

  expect(
    (await DataSecurityIssueDossier.readOwners(PROJECT_ID, STORE_ID)).names,
  ).toEqual([FEED_INVITEE_UNNAMED]);
});
