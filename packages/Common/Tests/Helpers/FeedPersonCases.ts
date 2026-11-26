import User from "../../Models/DatabaseModels/User";
import { FEED_INVITEE_UNNAMED } from "../../Server/Utils/Feed/FeedPersonName";
import MattermostUtil from "../../Server/Utils/Workspace/Mattermost/Mattermost";
import MicrosoftTeamsUtil from "../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../Server/Utils/Workspace/Slack/Slack";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../Server/Utils/TeamMember/PendingInviteeProfiles";
import Email from "../../Types/Email";
import Name from "../../Types/Name";
import ObjectID from "../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import { expect, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE PEOPLE A FEED ENTRY OR A CHANNEL LINE CAN NAME, AND HOW EVERY LINE
 * NAMES THEM (FeedPersonName: #10668, #10669, #10681).
 *
 * For a test of a line writer: each kind of person - their account as
 * OneUptime holds it, and their invitation when they are only invited - and
 * the name every line says for them:
 *
 *   - someone only invited, by the name typed with their invitation; with
 *     none, only spaces, or an address typed as the name, as "someone who
 *     hasn't joined the project yet" - never by their account's own name
 *     (#9823) or any address;
 *   - a member, by their name; with none, or one that holds an address, by
 *     the part of their address before the "@".
 *
 * None of FEED_PERSON_ADDRESSES is ever in a line, and neither is an
 * invitee's own account name (expectNoAddressIn). The addresses are on
 * acme.test, a name RFC 2606 reserves: nobody's.
 */

// Their account's own name, which the project does not see until they join.
export const INVITEE_ACCOUNT_NAME: string = "Ivy Account";

// The address their account has, and the one they were invited at (#10175).
export const INVITEE_ACCOUNT_ADDRESS: string = "ivy@acme.test";
export const INVITED_ADDRESS: string = "ivy.invited@acme.test";

// A member's address.
export const MEMBER_ADDRESS: string = "ana.lee@acme.test";

// Every address in play: none of them is ever in a line.
export const FEED_PERSON_ADDRESSES: ReadonlyArray<string> = [
  INVITEE_ACCOUNT_ADDRESS,
  INVITED_ADDRESS,
  MEMBER_ADDRESS,
];

export interface FeedPersonCase {
  label: string;
  // Their account, as OneUptime holds it.
  account: { name?: string | undefined; email: string };
  // Set: only invited to the project, with what their invitation kept.
  invitation?: WithheldProfile | undefined;
  // How every line names them.
  named: string;
}

export const FEED_PERSON_CASES: ReadonlyArray<FeedPersonCase> = [
  {
    label: "someone only invited, with a name typed",
    account: { name: INVITEE_ACCOUNT_NAME, email: INVITEE_ACCOUNT_ADDRESS },
    invitation: {
      inviteeName: "Ivy from Payments",
      inviteeEmail: INVITED_ADDRESS,
    },
    named: "Ivy from Payments",
  },
  {
    label: "someone only invited, with no name typed",
    account: { name: INVITEE_ACCOUNT_NAME, email: INVITEE_ACCOUNT_ADDRESS },
    invitation: { inviteeName: null, inviteeEmail: INVITED_ADDRESS },
    named: FEED_INVITEE_UNNAMED,
  },
  {
    label: "someone only invited, with only spaces typed as the name",
    account: { name: INVITEE_ACCOUNT_NAME, email: INVITEE_ACCOUNT_ADDRESS },
    invitation: { inviteeName: "   ", inviteeEmail: INVITED_ADDRESS },
    named: FEED_INVITEE_UNNAMED,
  },
  {
    label: "someone only invited, with an address typed as the name",
    account: { name: INVITEE_ACCOUNT_NAME, email: INVITEE_ACCOUNT_ADDRESS },
    invitation: { inviteeName: INVITED_ADDRESS, inviteeEmail: INVITED_ADDRESS },
    named: FEED_INVITEE_UNNAMED,
  },
  {
    label: "a member",
    account: { name: "Ana Lee", email: MEMBER_ADDRESS },
    named: "Ana Lee",
  },
  {
    label: "a member with no name",
    account: { email: MEMBER_ADDRESS },
    named: "ana.lee",
  },
  {
    label: "a member whose name is their address",
    account: { name: MEMBER_ADDRESS, email: MEMBER_ADDRESS },
    named: "ana.lee",
  },
];

/*
 * The members among them: who a line names where only a member can be - a
 * person who acted, or one told about a case.
 */
export const FEED_MEMBER_CASES: ReadonlyArray<FeedPersonCase> =
  FEED_PERSON_CASES.filter((person: FeedPersonCase): boolean => {
    return !person.invitation;
  });

// Their account, as OneUptime reads it, under `id`.
export function feedPersonAccount(id: ObjectID, person: FeedPersonCase): User {
  const user: User = new User(id);

  if (person.account.name !== undefined) {
    user.name = new Name(person.account.name);
  }

  user.email = new Email(person.account.email);

  return user;
}

/*
 * Who of the people asked about is only invited to the project:
 * PendingInviteeProfiles' read, which FeedPersonName asks once for the
 * people of a line. `invited` holds each invitation by the person's
 * lower-cased id; anybody else is a member.
 */
export function stubInvitations(
  invited: Map<string, WithheldProfile>,
): SpyInstance<typeof PendingInviteeProfiles.readWithheldProfilesInProject> {
  return jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockImplementation(
      async (data: {
        userIds: Array<string>;
      }): Promise<Map<string, WithheldProfile>> => {
        const withheld: Map<string, WithheldProfile> = new Map<
          string,
          WithheldProfile
        >();

        for (const userId of data.userIds) {
          const profile: WithheldProfile | undefined = invited.get(
            userId.toLowerCase(),
          );

          if (profile) {
            withheld.set(userId.toLowerCase(), profile);
          }
        }

        return withheld;
      },
    );
}

// The invitations of `people`, by lower-cased id, for stubInvitations.
export function invitationsOf(
  people: ReadonlyArray<{ id: ObjectID; person: FeedPersonCase }>,
): Map<string, WithheldProfile> {
  const invited: Map<string, WithheldProfile> = new Map<
    string,
    WithheldProfile
  >();

  for (const entry of people) {
    if (entry.person.invitation) {
      invited.set(entry.id.toString().toLowerCase(), entry.person.invitation);
    }
  }

  return invited;
}

// No address in play, and no invitee's own account name, anywhere in `text`.
export function expectNoAddressIn(text: string): void {
  for (const address of FEED_PERSON_ADDRESSES) {
    expect(text).not.toContain(address);
  }

  expect(text).not.toContain("@acme.test");
  expect(text).not.toContain(INVITEE_ACCOUNT_NAME);
}

// What a chat shows of a post, as it is sent to it.
export interface ChatRendering {
  workspaceType: WorkspaceType;
  // The payload the workspace is sent, as JSON.
  posted: string;
}

/*
 * A post's Markdown as Slack, Microsoft Teams and Mattermost are sent it:
 * each workspace's own rendering of the message's Markdown block (what
 * WorkspaceNotificationRuleService posts), with the line a phone shows.
 */
export function renderInEveryChat(
  markdown: string,
  notificationText?: string | undefined,
): Array<ChatRendering> {
  const messageBlocks: Array<WorkspaceMessageBlock> = [
    {
      _type: "WorkspacePayloadMarkdown",
      text: markdown,
    } as WorkspacePayloadMarkdown,
  ];

  return [
    {
      workspaceType: WorkspaceType.Slack,
      posted: JSON.stringify({
        blocks: SlackUtil.getBlocksFromWorkspaceMessagePayload({
          messageBlocks,
        }),
        text: notificationText || "",
      }),
    },
    {
      workspaceType: WorkspaceType.MicrosoftTeams,
      posted: JSON.stringify({
        card: MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
          messageBlocks,
        }),
        text: notificationText || "",
      }),
    },
    {
      workspaceType: WorkspaceType.Mattermost,
      posted: JSON.stringify(
        MattermostUtil.toPost({
          blocks: MattermostUtil.getBlocksFromWorkspaceMessagePayload({
            messageBlocks,
          }),
          teamId: "team",
          text: notificationText,
        }),
      ),
    },
  ];
}

/*
 * The part of a name every chat shows as typed: its longest stretch with no
 * apostrophe, which a chat may write as a character reference.
 */
export function nameAsEveryChatShowsIt(named: string): string {
  return named.split("'").reduce((longest: string, part: string): string => {
    return part.length > longest.length ? part : longest;
  }, "");
}
