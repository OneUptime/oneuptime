import SecurityCaseAIContextBuilder, {
  SecurityCaseTriageData,
  TriageLinkedHost,
} from "../../../../../Server/Utils/AI/Security/SecurityCaseAIContextBuilder";
import DockerHostService from "../../../../../Server/Services/DockerHostService";
import HostOwnerTeamService from "../../../../../Server/Services/HostOwnerTeamService";
import HostOwnerUserService from "../../../../../Server/Services/HostOwnerUserService";
import HostService from "../../../../../Server/Services/HostService";
import KubernetesClusterService from "../../../../../Server/Services/KubernetesClusterService";
import NetworkDeviceService from "../../../../../Server/Services/NetworkDeviceService";
import PodmanHostService from "../../../../../Server/Services/PodmanHostService";
import SecurityCaseNoteService from "../../../../../Server/Services/SecurityCaseNoteService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../../../Server/Services/SecurityDetectionService";
import SecurityPlaybookService from "../../../../../Server/Services/SecurityPlaybookService";
import SecurityProtectedEntityService from "../../../../../Server/Services/SecurityProtectedEntityService";
import logger from "../../../../../Server/Utils/Logger";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import Host from "../../../../../Models/DatabaseModels/Host";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import User from "../../../../../Models/DatabaseModels/User";
import Email from "../../../../../Types/Email";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import { InstructionLikeTextScan } from "../../../../../Utils/AI/InstructionLikeText";
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
 * THE CONTEXT ONEUPTIME AI TRIAGES A SECURITY CASE FROM NAMES PEOPLE AS THE
 * PROJECT KNOWS THEM (#9934).
 *
 * The triage names who owns each host the case's entities are, and who
 * wrote each of the case's notes, and OneUptime AI can repeat those names
 * to anyone who asks. They are read as OneUptime, so a read of the account
 * would hand it the account's own name - of someone the project only
 * invited, whose own name it does not see until they join (#9823). Each
 * is named as the project knows them instead: the name typed for them,
 * else their address. A member is named by their own name.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "99340000-2222-4000-8000-000000000001",
);
const CASE_ID: ObjectID = new ObjectID("99340000-2222-4000-8000-000000000002");
const HOST_ID: ObjectID = new ObjectID("99340000-2222-4000-8000-000000000003");

const MEMBER_ID: string = "99340000-2222-4000-8000-0000000000a1";
const NAMED_INVITEE_ID: string = "99340000-2222-4000-8000-0000000000b2";
const UNNAMED_INVITEE_ID: string = "99340000-2222-4000-8000-0000000000c3";

// The invitees' own account names: never in what OneUptime AI reads.
const OWN_NAMES: Array<string> = ["Ingrid Account", "Uma Account"];

let withheldIn: SpyInstance<
  typeof PendingInviteeProfiles.readWithheldProfilesInProject
>;

function person(id: string): User {
  const user: User = new User(new ObjectID(id));

  if (id === MEMBER_ID) {
    user.name = new Name("Mia Member");
    user.email = new Email("mia@example.com");
  } else if (id === NAMED_INVITEE_ID) {
    user.name = new Name("Ingrid Account");
    user.email = new Email("ingrid@example.com");
  } else {
    user.name = new Name("Uma Account");
    user.email = new Email("uma@example.com");
  }

  return user;
}

function expectNoOwnNameOfAnInvitee(value: unknown): void {
  const text: string =
    typeof value === "string" ? value : JSON.stringify(value);

  for (const name of OWN_NAMES) {
    expect(text).not.toContain(name);
  }
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  withheldIn = jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockImplementation((async (): Promise<Map<string, WithheldProfile>> => {
      return new Map<string, WithheldProfile>([
        [NAMED_INVITEE_ID, { inviteeName: "Ingrid from Security" }],
        [UNNAMED_INVITEE_ID, { inviteeName: null }],
      ]);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the owners of the hosts the case's entities are", () => {
  beforeEach(() => {
    jest.spyOn(DockerHostService, "findBy").mockResolvedValue([]);
    jest.spyOn(PodmanHostService, "findBy").mockResolvedValue([]);
    jest.spyOn(KubernetesClusterService, "findBy").mockResolvedValue([]);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);
    jest.spyOn(HostService, "findBy").mockResolvedValue([
      {
        id: HOST_ID,
        name: "web-1",
        hostIdentifier: "i-0abc",
        osType: "Linux",
      } as unknown as Host,
    ]);
    jest
      .spyOn(HostOwnerTeamService, "findBy")
      .mockResolvedValue([{ team: { name: "Platform" } }] as never);
    jest
      .spyOn(HostOwnerUserService, "findBy")
      .mockResolvedValue([
        { user: person(MEMBER_ID) },
        { user: person(NAMED_INVITEE_ID) },
        { user: person(UNNAMED_INVITEE_ID) },
      ] as never);
  });

  async function linkedHosts(): Promise<Array<TriageLinkedHost>> {
    return await SecurityCaseAIContextBuilder.readLinkedHosts({
      projectId: PROJECT_ID,
      entities: [{ type: SecurityEntityType.Host, value: "web-1" }],
    });
  }

  test("someone only invited by the name typed for them, else their address; a member by their own name", async () => {
    const linked: Array<TriageLinkedHost> = await linkedHosts();

    expect(linked).toHaveLength(1);
    expect(linked[0]!.ownerUsers).toEqual([
      "Mia Member",
      "Ingrid from Security",
      "uma@example.com",
    ]);
    expect(linked[0]!.ownerTeams).toEqual(["Platform"]);
    expectNoOwnNameOfAnInvitee(linked);
  });

  test("who is only invited is read once for the host's owners, in the case's project", async () => {
    await linkedHosts();

    expect(withheldIn).toHaveBeenCalledTimes(1);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
    expect([...withheldIn.mock.calls[0]![0].userIds].sort()).toEqual(
      [MEMBER_ID, NAMED_INVITEE_ID, UNNAMED_INVITEE_ID].sort(),
    );
  });

  test("the owners are read with their ids, so each can be told apart", async () => {
    const findOwners: SpyInstance<typeof HostOwnerUserService.findBy> =
      jest.spyOn(HostOwnerUserService, "findBy");

    await linkedHosts();

    expect(findOwners.mock.calls[0]![0].select).toEqual({
      user: { _id: true, name: true, email: true },
    });
  });

  test("the prompt OneUptime AI reads names them so, never by their own names", async () => {
    const linked: Array<TriageLinkedHost> = await linkedHosts();

    const prompt: string = SecurityCaseAIContextBuilder.buildContext({
      triage: {
        securityCase: {
          id: CASE_ID,
          _id: CASE_ID.toString(),
          caseNumberWithPrefix: "CASE-9",
          title: "Brute force against web-1",
          entities: [{ type: SecurityEntityType.Host, value: "web-1" }],
          detectionCount: 1,
        } as unknown as SecurityCase,
        detections: [],
        detectionTotal: 0,
        linkedHosts: linked,
        incident: null,
        protectedEntities: [],
        playbooks: [],
        notes: [],
      },
      scan: new InstructionLikeTextScan(),
    }).contextSummary;

    expect(prompt).toContain("Ingrid from Security");
    expect(prompt).toContain("uma@example.com");
    expect(prompt).toContain("Mia Member");
    expectNoOwnNameOfAnInvitee(prompt);
  });
});

describe("the authors of the case's notes", () => {
  beforeEach(() => {
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue({
      id: CASE_ID,
      _id: CASE_ID.toString(),
      caseNumberWithPrefix: "CASE-9",
      title: "Brute force",
      entities: [],
    } as unknown as SecurityCase);
    jest.spyOn(SecurityDetectionService, "findBy").mockResolvedValue([]);
    jest.spyOn(HostService, "findBy").mockResolvedValue([]);
    jest.spyOn(SecurityProtectedEntityService, "findBy").mockResolvedValue([]);
    jest.spyOn(SecurityPlaybookService, "findBy").mockResolvedValue([]);
  });

  test("someone only invited by the name typed for them, else their address; a member by their own name", async () => {
    const findNotes: SpyInstance<typeof SecurityCaseNoteService.findBy> = jest
      .spyOn(SecurityCaseNoteService, "findBy")
      .mockResolvedValue([
        { note: "Checked the VPN logs.", createdByUser: person(MEMBER_ID) },
        { note: "Reset the key.", createdByUser: person(NAMED_INVITEE_ID) },
        {
          note: "Called the vendor.",
          createdByUser: person(UNNAMED_INVITEE_ID),
        },
      ] as never);

    const triage: SecurityCaseTriageData =
      await SecurityCaseAIContextBuilder.read({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      });

    expect(
      triage.notes.map((note: SecurityCaseTriageData["notes"][number]) => {
        return note.author;
      }),
    ).toEqual(["Mia Member", "Ingrid from Security", "uma@example.com"]);
    expectNoOwnNameOfAnInvitee(triage.notes);

    expect(findNotes.mock.calls[0]![0].select).toMatchObject({
      createdByUser: { _id: true, name: true, email: true },
    });
    expect(
      withheldIn.mock.calls.some(
        (
          call: Parameters<
            typeof PendingInviteeProfiles.readWithheldProfilesInProject
          >,
        ): boolean => {
          return call[0].projectId === PROJECT_ID;
        },
      ),
    ).toBe(true);
  });

  test("an author with no name of their own is still a teammate", async () => {
    withheldIn.mockResolvedValue(new Map<string, WithheldProfile>() as never);

    const nameless: User = new User(new ObjectID(MEMBER_ID));

    jest
      .spyOn(SecurityCaseNoteService, "findBy")
      .mockResolvedValue([
        { note: "Looked into it.", createdByUser: nameless },
      ] as never);

    const triage: SecurityCaseTriageData =
      await SecurityCaseAIContextBuilder.read({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      });

    expect(triage.notes[0]!.author).toBe("A teammate");
  });
});
