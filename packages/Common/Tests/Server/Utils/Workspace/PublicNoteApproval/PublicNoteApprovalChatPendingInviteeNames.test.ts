import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import User from "../../../../../Models/DatabaseModels/User";
import UserService from "../../../../../Server/Services/UserService";
import logger from "../../../../../Server/Utils/Logger";
import PublicNoteApprovalNotifications from "../../../../../Server/Utils/Notes/PublicNoteApprovalNotifications";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import WorkspacePublicNoteApprovalActions, {
  PublicNoteApprovalPressAnswer,
  PublicNoteApprovalPressOutcome,
} from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalActions";
import Email from "../../../../../Types/Email";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import {
  BOB,
  CAROL,
  DAVE,
  NAMES,
  NOTES_URL,
  PROJECT_ID,
  buttonValue,
  keepCopies,
  memberProps,
  replacedWith,
  restoreWorld,
  settled,
  startWorld,
  world,
} from "./PublicNoteApprovalChatWorld";

/*
 * THE CHAT MESSAGES OF A PUBLIC NOTE'S APPROVAL NAME PEOPLE AS ITS PROJECT
 * KNOWS THEM (#9934).
 *
 * Over the real engine, the real press logic and the real names
 * (PublicNoteApprovalNotifications.getUserNames), with people read as
 * OneUptime. Legal's step names Carol, who was invited to the project and
 * has not accepted. Every copy of the approval message, the decider's
 * answer and the record's feed then say who the note waits for: Carol by
 * the name the project typed for her - never her account's own name,
 * which the project does not see until she joins (#9823). Whoever decided
 * is named the same way. Every name is read in the note's own project.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const RECORD_LINK: string = `[Incident INC-42](${NOTES_URL})`;

// Carol's account's own name: the project typed "Carol from Legal".
const CAROLS_OWN_NAME: string = "Caroline Account-Holder";

let withheldIn: SpyInstance<
  typeof PendingInviteeProfiles.readWithheldProfilesInProject
>;

// The text of the only copy replaced in `workspaceType`, times taken out.
function onlyText(workspaceType: WorkspaceType): string {
  const texts: Array<string> = replacedWith(workspaceType);

  expect(texts).toHaveLength(1);

  return texts[0]!.replace(/\{\{TIME\([^)]*\)\}\}/g, "{{TIME}}");
}

beforeEach(() => {
  startWorld();

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });

  // The real names, not the world's: read as OneUptime, then as the project knows them.
  (
    jest.spyOn(
      PublicNoteApprovalNotifications,
      "getUserNames",
    ) as unknown as AnySpy
  ).mockRestore();

  jest.spyOn(UserService, "findBy").mockImplementation((async (args: {
    query: { _id: unknown };
  }): Promise<Array<User>> => {
    const asked: string = JSON.stringify(args.query._id);

    return Object.keys(NAMES)
      .filter((id: string): boolean => {
        return asked.includes(id);
      })
      .map((id: string): User => {
        const user: User = new User(new ObjectID(id));
        user.name = new Name(id === CAROL ? CAROLS_OWN_NAME : NAMES[id]!);
        user.email = new Email(`${NAMES[id]!.toLowerCase()}@example.com`);
        return user;
      });
  }) as never);

  withheldIn = jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockImplementation((async (): Promise<Map<string, WithheldProfile>> => {
      return new Map<string, WithheldProfile>([
        [CAROL, { inviteeName: "Carol from Legal" }],
      ]);
    }) as never);
});

afterEach(async () => {
  await restoreWorld();
});

describe("a step that names someone only invited", () => {
  test("the decider's answer, every copy and the feed name her by the name typed for her", async () => {
    const chat: WorkspaceType = WorkspaceType.Slack;

    await keepCopies([BOB, DAVE], [chat]);

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: buttonValue(),
        props: memberProps(BOB),
      });

    await settled();

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(pressed.answer.markdown).toBe(
      `✅ You approved a **public note** on ${RECORD_LINK} for step 1 of 2 (Support). It waits for step 2 of 2 (Legal): Carol from Legal.`,
    );
    expect(onlyText(chat)).toBe(
      `✅ This public note on ${RECORD_LINK} was approved for step 1 of 2 (Support) by **Bob** at {{TIME}}. It waits for step 2 of 2 (Legal): Carol from Legal.`,
    );

    const everythingWritten: string = JSON.stringify({
      answer: pressed.answer,
      replaced: world.replaced,
      feed: world.feed,
    });

    expect(everythingWritten).toContain("Carol from Legal");
    expect(everythingWritten).not.toContain(CAROLS_OWN_NAME);

    // Every name was read in the note's own project.
    expect(withheldIn).toHaveBeenCalled();

    for (const call of withheldIn.mock.calls) {
      expect(call[0].projectId.toString()).toBe(PROJECT_ID.toString());
    }
  });

  test("a member who decided is named by their own name", async () => {
    const chat: WorkspaceType = WorkspaceType.MicrosoftTeams;

    await keepCopies([BOB, DAVE], [chat]);

    await WorkspacePublicNoteApprovalActions.approve({
      value: buttonValue(),
      props: memberProps(DAVE),
    });

    await settled();

    expect(onlyText(chat)).toBe(
      `✅ This public note on ${RECORD_LINK} was approved for step 1 of 2 (Support) by **Dave** at {{TIME}}. It waits for step 2 of 2 (Legal): Carol from Legal.`,
    );
  });

  test("with no name typed for her, she is named by her address", async () => {
    withheldIn.mockImplementation((async (): Promise<
      Map<string, WithheldProfile>
    > => {
      return new Map<string, WithheldProfile>([[CAROL, { inviteeName: null }]]);
    }) as never);

    const chat: WorkspaceType = WorkspaceType.Mattermost;

    await keepCopies([BOB, DAVE], [chat]);

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: buttonValue(),
        props: memberProps(BOB),
      });

    await settled();

    expect(pressed.answer.markdown).toBe(
      `✅ You approved a **public note** on ${RECORD_LINK} for step 1 of 2 (Support). It waits for step 2 of 2 (Legal): carol@example.com.`,
    );
    expect(
      JSON.stringify({ replaced: world.replaced, feed: world.feed }),
    ).not.toContain(CAROLS_OWN_NAME);
  });
});
