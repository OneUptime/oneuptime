import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY FEED ENTRY AND CHANNEL LINE NAMES ITS PEOPLE IN ONE PLACE (#10668,
 * #10669).
 *
 * A record's feed entries are posted to its Slack, Microsoft Teams and
 * Mattermost channels, and a channel can be read by people outside the
 * project - a shared channel, a guest. So can a feed: workflows and the API
 * take its entries anywhere. So no line may say anybody's email address, and
 * someone only invited to the project (#10412) is named by the name typed
 * with their invitation, never by their account's own (#9823).
 *
 * #10651 held the on-call lines to that (OnCallLinesNamePeopleInOnePlace
 * Guard). Every other line built its names itself: the owner entries of
 * twenty kinds of record put an invitee's address in the account's place
 * (PendingInviteeProfiles.nameInProject) and printed every owner's address
 * after their name, the owner rules' lists named an invitee by their
 * address, the owners notified were listed by name and address, and a dozen
 * chat answers named a member with no name by their address. One fix in one
 * line left the others saying it.
 *
 * Now every line names its people through FeedPersonName - directly, or
 * through UserService.getUserMarkdownString and OnCallChatByWorkspace, which
 * name them through it. This reads every file that writes a feed entry or
 * posts a channel line, and the helpers that write the names into them, so a
 * new line cannot name a person any other way: none of them
 *
 *   - asks PendingInviteeProfiles to name somebody (nameInProject,
 *     getNameInProject, getAddressInProject): it names an invitee by their
 *     address;
 *   - puts a person's address in a template, or falls back from a name to
 *     an address ("name || email");
 *
 * but in the places listed below, each with why: what only the project's
 * own people read - a refusal, a Dashboard answer, an owner's own email -
 * and what is not held yet. An entry the source no longer needs fails -
 * delete it. What FeedPersonName itself is handed is the rule's own input.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../../..");

// Where feed entries are written and channel lines posted.
const ROOTS: Array<string> = [
  "packages/Common/Server",
  "packages/App/FeatureSet/Workers",
];

// What writes a record's feed entry, or posts a channel line.
const WRITES_A_LINE: RegExp =
  /\b\w*FeedService\.create\w*FeedItem\(|\.sendWorkspaceMarkdownNotification\(|\bOnCallDutyPolicyFeedService\.sendWorkspaceNotification\(/;

/*
 * The helpers that write a person's name into a feed entry or a channel
 * line for the files that post it: held as those files are.
 */
const LINE_HELPERS: Array<string> = [
  "packages/Common/Server/Utils/Rules/RuleFeedMarkdown.ts",
  "packages/Common/Server/Utils/Rules/OwnerRuleFeed.ts",
  "packages/Common/Server/Utils/Notification/OwnerNotificationFeedText.ts",
  "packages/Common/Server/Utils/Slo/SloFeedUtil.ts",
  "packages/Common/Server/Utils/ResourceFeed/ResourceFeedUtil.ts",
  "packages/Common/Server/Utils/Incident/IncidentRoleFeedText.ts",
  "packages/Common/Server/Utils/OnCall/OnCallChatText.ts",
  "packages/Common/Server/Utils/OnCall/OnCallChatByWorkspace.ts",
  "packages/Common/Server/Utils/Workspace/Workspace.ts",
  "packages/Common/Server/Utils/Workspace/WorkspaceOnCallNow.ts",
  "packages/Common/Server/Utils/Workspace/WorkspaceActionAnswers.ts",
  "packages/Common/Server/Utils/Workspace/WorkspaceIncidentActions.ts",
  "packages/Common/Server/Utils/Workspace/WorkspaceRemediationActions.ts",
  "packages/Common/Server/Utils/Workspace/SavedChatMessageAuthor.ts",
  "packages/Common/Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice.ts",
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsOnCallMention.ts",
  "packages/Common/Server/Utils/AutoRemediation/RemediationChatMessage.ts",
  "packages/Common/Server/Utils/Notes/SavedChatMessageNote.ts",
];

// The files the guard must find among the writers: one of each kind of line.
const KNOWN_LINE_WRITERS: Array<string> = [
  // Owner entries, of every kind of record that has them.
  "packages/Common/Server/Services/IncidentOwnerUserService.ts",
  "packages/Common/Server/Services/AlertOwnerUserService.ts",
  "packages/Common/Server/Services/IncidentEpisodeOwnerUserService.ts",
  "packages/Common/Server/Services/AlertEpisodeOwnerUserService.ts",
  "packages/Common/Server/Services/MonitorOwnerUserService.ts",
  "packages/Common/Server/Services/ScheduledMaintenanceOwnerUserService.ts",
  "packages/Common/Server/Services/ServiceOwnerUserService.ts",
  "packages/Common/Server/Services/HostOwnerUserService.ts",
  "packages/Common/Server/Services/DockerHostOwnerUserService.ts",
  "packages/Common/Server/Services/DockerSwarmClusterOwnerUserService.ts",
  "packages/Common/Server/Services/KubernetesClusterOwnerUserService.ts",
  "packages/Common/Server/Services/PodmanHostOwnerUserService.ts",
  "packages/Common/Server/Services/ProxmoxClusterOwnerUserService.ts",
  "packages/Common/Server/Services/VMwareVCenterOwnerUserService.ts",
  "packages/Common/Server/Services/OpenStackCloudOwnerUserService.ts",
  "packages/Common/Server/Services/CephClusterOwnerUserService.ts",
  "packages/Common/Server/Services/StorageArrayOwnerUserService.ts",
  "packages/Common/Server/Services/DatabaseServerOwnerUserService.ts",
  "packages/Common/Server/Services/DataStoreOwnerUserService.ts",
  "packages/Common/Server/Services/DataAssetOwnerUserService.ts",
  "packages/Common/Server/Services/CloudResourceOwnerUserService.ts",
  "packages/Common/Server/Services/ServiceLevelObjectiveOwnerUserService.ts",
  "packages/Common/Server/Services/OnCallDutyPolicyOwnerUserService.ts",
  // Incident roles, action items, state changes.
  "packages/Common/Server/Services/IncidentMemberService.ts",
  "packages/Common/Server/Services/IncidentPostmortemActionItemService.ts",
  "packages/Common/Server/Services/IncidentStateTimelineService.ts",
  // The owners told, in the record's feed.
  "packages/App/FeatureSet/Workers/Jobs/IncidentOwners/SendNotePostedNotification.ts",
  "packages/App/FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendAlertAddedNotification.ts",
];

/*
 * The ways a line named its people itself. What FeedPersonName is handed is
 * left out first: it is the rule's own input, not a name built elsewhere.
 */
const NAMES_A_PERSON_ITSELF: Array<{
  key: string;
  pattern: RegExp;
  what: string;
}> = [
  {
    key: "nameInProject",
    pattern: /(?<!get)\bnameInProject\(/g,
    what: "PendingInviteeProfiles.nameInProject: an invited address in the account's place",
  },
  {
    key: "getNameInProject",
    pattern: /\bgetNameInProject\(/g,
    what: "PendingInviteeProfiles.getNameInProject: someone pending by their invited address",
  },
  {
    key: "getAddressInProject",
    pattern: /\bgetAddressInProject\(/g,
    what: "PendingInviteeProfiles.getAddressInProject: a person's address",
  },
  {
    key: "addressInTemplate",
    pattern: /\$\{[^}]*\.email\b[^}]*\}/g,
    what: "a person's address in a template",
  },
  {
    key: "nameElseAddress",
    pattern: /\.name\b[^;\n]*\|\|[^;\n]*\.email\b/g,
    what: "a name, else an address",
  },
];

/*
 * Where a person may be named another way, and why: "file" -> the ways it
 * uses, each with why. An entry the source no longer needs fails below.
 */
const MAY_NAME_ANOTHER_WAY: Record<string, Record<string, string>> = {
  "packages/Common/Server/Services/OnCallDutyPolicyEscalationRuleUserService.ts":
    {
      getNameInProject:
        "the refusal of someone the rule names already, read only by whoever adds them",
    },
  "packages/Common/Server/Services/OnCallDutyPolicyUserOverrideService.ts": {
    getNameInProject:
      "the refusal of an override that overlaps another, read only by whoever adds it",
  },
  "packages/Common/Server/Utils/Workspace/WorkspaceChannelMembers.ts": {
    getNameInProject:
      "the answer to Add people, read in the Dashboard by whoever pressed it",
    nameElseAddress:
      "the people in a record's channel, listed on its card in the Dashboard",
  },
  "packages/Common/Server/API/DataSecurityAPI.ts": {
    nameElseAddress:
      "the record of processing a project exports for its auditor, read in the project",
  },
  "packages/App/FeatureSet/Workers/Jobs/IncidentOwners/SendCreatedResourceNotification.ts":
    {
      addressInTemplate:
        "who declared the incident, in the email to each of its owners",
    },
  "packages/App/FeatureSet/Workers/Jobs/AlertOwners/SendCreatedResourceNotification.ts":
    {
      addressInTemplate:
        "who declared the alert, in the email to each of its owners",
    },
  "packages/App/FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendCreatedResourceNotification.ts":
    {
      addressInTemplate:
        "who declared the episode, in the email to each of its owners",
    },
  "packages/App/FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendCreatedResourceNotification.ts":
    {
      addressInTemplate:
        "who declared the episode, in the email to each of its owners",
    },
  /*
   * Not held yet: the Security product's lines - cases, their tasks,
   * playbooks and hunts - are another piece of work's (#10681).
   */
  "packages/Common/Server/Services/SecurityCaseService.ts": {
    nameInProject: "not held yet (#10681)",
    nameElseAddress: "not held yet (#10681)",
  },
  "packages/Common/Server/Services/SecurityCaseTaskService.ts": {
    nameInProject: "not held yet (#10681)",
    nameElseAddress: "not held yet (#10681)",
  },
  "packages/Common/Server/Utils/SecurityCase/SecurityCaseNotifications.ts": {
    getNameInProject: "not held yet (#10681)",
    addressInTemplate: "not held yet (#10681)",
    nameElseAddress: "not held yet (#10681)",
  },
  "packages/Common/Server/Utils/SecurityPlaybook/SecurityPlaybookActions.ts": {
    nameInProject: "not held yet (#10681)",
    addressInTemplate: "not held yet (#10681)",
    nameElseAddress: "not held yet (#10681)",
  },
  "packages/Common/Server/Utils/SecurityEvent/Hunts/SecurityHuntNotifications.ts":
    {
      nameElseAddress: "not held yet (#10681)",
    },
};

// The shared place itself: the one place a person is named.
const SHARED_PLACE: Array<string> = [
  "packages/Common/Server/Utils/Feed/FeedPersonName.ts",
  "packages/Common/Server/Utils/Feed/FeedPersonNameRule.ts",
];

const SOURCE_FILE: RegExp = /\.tsx?$/;

const SKIPPED_DIRECTORIES: Array<string> = ["node_modules", "build", "dist"];

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      SKIPPED_DIRECTORIES.includes(entry.name) ||
      entry.name.startsWith(".")
    ) {
      continue;
    }

    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

// The code of a source, without its comments: a comment may name a helper.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/*
 * What the shared place is handed - FeedPersonName, or the pure rule it
 * extends (FeedPersonNameRule) - is the rule's input: left out of the check.
 */
function withoutTheSharedPlace(source: string): string {
  return source.replace(
    /\bFeedPersonName(?:Rule)?\.\w+\(\s*\{[^{}]*\}\s*\)/g,
    "",
  );
}

interface LineWriter {
  file: string;
  source: string;
}

const LINE_WRITERS: Array<LineWriter> = ROOTS.flatMap(
  (root: string): Array<string> => {
    return sourceFiles(path.join(REPO_ROOT, root));
  },
)
  .map((file: string): LineWriter => {
    return {
      file: relative(file),
      source: withoutTheSharedPlace(
        withoutComments(fs.readFileSync(file, "utf8")),
      ),
    };
  })
  .filter((writer: LineWriter): boolean => {
    return (
      !SHARED_PLACE.includes(writer.file) &&
      (WRITES_A_LINE.test(writer.source) || LINE_HELPERS.includes(writer.file))
    );
  });

// The ways each writer names a person itself, by key: "file" -> keys found.
function waysUsed(writer: LineWriter): Array<string> {
  return NAMES_A_PERSON_ITSELF.filter((way: { pattern: RegExp }): boolean => {
    way.pattern.lastIndex = 0;
    return way.pattern.test(writer.source);
  }).map((way: { key: string }): string => {
    return way.key;
  });
}

describe("every feed entry and channel line names its people through FeedPersonName (#10668, #10669)", () => {
  test("the guard finds every kind of line writer, and every helper listed", () => {
    const found: Array<string> = LINE_WRITERS.map(
      (writer: LineWriter): string => {
        return writer.file;
      },
    );

    for (const file of [...KNOWN_LINE_WRITERS, ...LINE_HELPERS]) {
      expect(found).toContain(file);
    }

    // Hundreds of files write a line: the guard reads them all.
    expect(found.length).toBeGreaterThan(150);
  });

  test("no file that writes a line names a person another way, but where listed", () => {
    const offenders: Array<string> = [];

    for (const writer of LINE_WRITERS) {
      const allowed: Record<string, string> =
        MAY_NAME_ANOTHER_WAY[writer.file] || {};

      for (const key of waysUsed(writer)) {
        if (!allowed[key]) {
          const way: { what: string } = NAMES_A_PERSON_ITSELF.find(
            (candidate: { key: string }): boolean => {
              return candidate.key === key;
            },
          )!;

          offenders.push(`${writer.file}: ${way.what}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("every place listed still needs it: an entry the source no longer needs is deleted", () => {
    const stale: Array<string> = [];

    for (const [file, ways] of Object.entries(MAY_NAME_ANOTHER_WAY)) {
      const writer: LineWriter | undefined = LINE_WRITERS.find(
        (candidate: LineWriter): boolean => {
          return candidate.file === file;
        },
      );

      const used: Array<string> = writer ? waysUsed(writer) : [];

      for (const key of Object.keys(ways)) {
        if (!used.includes(key)) {
          stale.push(`${file}: ${key}`);
        }
      }
    }

    expect(stale).toEqual([]);
  });

  test.each(KNOWN_LINE_WRITERS)(
    "%s names nobody but through the shared place",
    (file: string) => {
      const writer: LineWriter | undefined = LINE_WRITERS.find(
        (candidate: LineWriter): boolean => {
          return candidate.file === file;
        },
      );

      expect(writer).toBeDefined();
      expect(
        waysUsed(writer!).filter((key: string): boolean => {
          return !MAY_NAME_ANOTHER_WAY[file]?.[key];
        }),
      ).toEqual([]);
    },
  );

  test("the guard sees what it guards against: each way is caught in a line that used it", () => {
    const before: LineWriter = {
      file: "packages/Common/Server/Services/ExampleOwnerUserService.ts",
      source: withoutTheSharedPlace(
        withoutComments(
          [
            "  protected override async onDeleteSuccess(): Promise<void> {",
            "    await PendingInviteeProfiles.nameInProject({ users: [user], projectId });",
            "    const name = PendingInviteeProfiles.getNameInProject({ userId, name, email, withheld });",
            "    const address = PendingInviteeProfiles.getAddressInProject({ userId, email, withheld });",
            "    const line = mdText`Removed **${user.name.toString()}** (${user.email?.toString()}) as an owner`;",
            "    const named = user.name?.toString().trim() || user.email?.toString().trim();",
            "  }",
          ].join("\n"),
        ),
      ),
    };

    expect(waysUsed(before).sort()).toEqual(
      NAMES_A_PERSON_ITSELF.map((way: { key: string }): string => {
        return way.key;
      }).sort(),
    );

    // The shared place's own input, and a name it gave, are no way of their own.
    const after: LineWriter = {
      file: before.file,
      source: withoutTheSharedPlace(
        withoutComments(
          [
            "    const owner = await UserService.getUserMarkdownString({ userId, projectId });",
            "    const name = FeedPersonNameRule.getMemberName({ name: user.name, email: user.email });",
            "    const line = mdText`Removed **${owner}** as an owner`;",
            "    const listed = mdText`👤 ${FeedPersonName.getName({ userId: user.id, name: user.name, email: user.email, withheld })}`;",
          ].join("\n"),
        ),
      ),
    };

    expect(waysUsed(after)).toEqual([]);
  });
});
