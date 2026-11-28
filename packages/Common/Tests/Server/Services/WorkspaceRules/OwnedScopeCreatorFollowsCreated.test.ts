import UserService from "../../../../Server/Services/UserService";
import WorkspaceCreatedMessageFirst from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import CreatedRecordWorld, {
  CREATED_KINDS,
  CreatedKind,
  EXISTING_CHANNEL,
  OwnedCreate,
  PLATFORM_TEAM,
} from "./CreatedRecordWorld";
import { makeRule, OWNER, RULE_USER } from "./WorkspaceRuleWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A CREATOR WHOSE ROLE CREATES ONLY WHAT THEY OWN IS ANNOUNCED AFTER THE
 * RECORD THEY CREATED (#11352).
 *
 * A person whose permission to create an incident, an alert, an episode, a
 * maintenance event, a monitor or an on-call policy reaches only what they
 * own - an Owned-scope custom role - is made the record's owner right after
 * its INSERT, before anything else happens to it
 * (DatabaseService.makeCreatorOwnerOrUndo): otherwise the record is one
 * they could not read again. Their owner row's hook writes "Added Ana Lee
 * to the Incident INC-42 as the owner" and posts it to Slack and Microsoft
 * Teams.
 *
 * Every other message about a new record waits for its Created message
 * (WorkspaceCreatedMessageFirst), but the hold was set in the record's
 * create hook, which runs later: so a channel a rule names heard "Added Ana
 * Lee ... as the owner" before "Incident Created". Now DatabaseService holds
 * a record's messages as it writes it, before its creator is made its
 * owner, for every kind; the create hook takes the hold over, and a create
 * that ends before its hook does lets it go.
 *
 * Driven through each kind's real create() - DatabaseService's own steps in
 * their own order, the creator's create permission scoped to Owned, the
 * real create chain - the real owner services' hooks, rule matching and
 * messages, against a fake Slack (CreatedRecordWorld).
 */

// Each person by the name their owner lines give them.
const NAMES: Record<string, string> = {
  [OWNER.toString()]: "Ana Lee",
  [RULE_USER.toString()]: "Ravi Shah",
};

interface KindUnderTest {
  // What its rules are made for.
  eventType: NotificationRuleEventType;
  // Its owner condition.
  ownersCheck: NotificationRuleConditionCheckOn;
  // What its Created message says.
  created: string;
  // Its first status is posted too, after its Created message: a monitor's.
  postsFirstStatus: boolean;
}

const KINDS: Record<CreatedKind, KindUnderTest> = {
  alert: {
    eventType: NotificationRuleEventType.Alert,
    ownersCheck: NotificationRuleConditionCheckOn.AlertOwners,
    created: "Alert ALT-7 Created",
    postsFirstStatus: false,
  },
  incident: {
    eventType: NotificationRuleEventType.Incident,
    ownersCheck: NotificationRuleConditionCheckOn.IncidentOwners,
    created: "Incident INC-42 Created",
    postsFirstStatus: false,
  },
  incidentEpisode: {
    eventType: NotificationRuleEventType.IncidentEpisode,
    ownersCheck: NotificationRuleConditionCheckOn.IncidentEpisodeOwners,
    created: "Episode IE-3 Created",
    postsFirstStatus: false,
  },
  alertEpisode: {
    eventType: NotificationRuleEventType.AlertEpisode,
    ownersCheck: NotificationRuleConditionCheckOn.AlertEpisodeOwners,
    created: "Episode AE-4 Created",
    postsFirstStatus: false,
  },
  scheduledMaintenance: {
    eventType: NotificationRuleEventType.ScheduledMaintenance,
    ownersCheck: NotificationRuleConditionCheckOn.ScheduledMaintenanceOwners,
    created: "Scheduled Maintenance SM-5 Created",
    postsFirstStatus: false,
  },
  monitor: {
    eventType: NotificationRuleEventType.Monitor,
    ownersCheck: NotificationRuleConditionCheckOn.MonitorOwners,
    created: "Monitor Created",
    postsFirstStatus: true,
  },
  onCallPolicy: {
    eventType: NotificationRuleEventType.OnCallDutyPolicy,
    ownersCheck: NotificationRuleConditionCheckOn.OnCallDutyPolicyOwners,
    created: "On-Call Policy Created",
    postsFirstStatus: false,
  },
};

let world: CreatedRecordWorld;

beforeEach(() => {
  world = new CreatedRecordWorld();
  world.install();
  world.addSlackChannel(EXISTING_CHANNEL);

  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockImplementation((async (data: {
      userId: ObjectID;
    }): Promise<MarkdownText> => {
      return mdText`${NAMES[data.userId.toString()] || "Somebody"}`;
    }) as never);
});

afterEach(async () => {
  // Whatever a test left held goes, so the next one starts with none.
  for (const kind of CREATED_KINDS) {
    await WorkspaceCreatedMessageFirst.postHeld(world.recordOf(kind));
  }

  jest.restoreAllMocks();
});

function ownedBy(
  kind: CreatedKind,
  ids: Array<ObjectID>,
): NotificationRuleCondition {
  return {
    checkOn: KINDS[kind].ownersCheck,
    conditionType: ConditionType.ContainsAny,
    value: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

// One rule: every record of the kind, or those its filters match, posted to #platform-alerts.
function postsToExistingChannel(
  kind: CreatedKind,
  filters: Array<NotificationRuleCondition> = [],
): void {
  world.rules = [
    makeRule({
      name: `Every ${KINDS[kind].eventType} in #platform-alerts`,
      eventType: KINDS[kind].eventType,
      filters: filters,
      createsChannel: false,
      existingChannels: EXISTING_CHANNEL.name,
    }),
  ];
}

/*
 * What a post is, from its text: the record's Created message, a monitor's
 * first status, or an owner added - named by who it is.
 */
function describePost(kind: CreatedKind, post: string): string {
  if (post.includes(KINDS[kind].created)) {
    return "Created";
  }

  if (post.includes("Changed Monitor")) {
    return "first status";
  }

  if (post.includes("Added") && post.includes("as the owner")) {
    if (post.includes("Added team")) {
      return post.includes("Platform") ? "Platform added" : "a team added";
    }

    const who: string =
      Object.values(NAMES).find((name: string): boolean => {
        return post.includes(name);
      }) || "Somebody";

    return `${who} added`;
  }

  return post.slice(0, 80);
}

// What #platform-alerts heard, in order.
function said(kind: CreatedKind): Array<string> {
  return world.postsIn(EXISTING_CHANNEL.id).map((post: string): string => {
    return describePost(kind, post);
  });
}

/*
 * What #platform-alerts is to hear of the record: its Created message,
 * then - in the order each was made - its creator, made its owner right
 * after its INSERT, a monitor's first status, and the owners its create
 * chain adds after that.
 */
function heard(
  kind: CreatedKind,
  addedLater: Array<string> = [],
): Array<string> {
  return [
    "Created",
    "Ana Lee added",
    ...(KINDS[kind].postsFirstStatus ? ["first status"] : []),
    ...addedLater,
  ];
}

describe.each(
  CREATED_KINDS.map((kind: CreatedKind): [CreatedKind] => {
    return [kind];
  }),
)(
  "a new %s, created by a person whose role creates only what they own",
  (kind: CreatedKind) => {
    test("REGRESSION (#11352): a rule posting every one to an existing channel - its Created message first, then its creator made its owner, each once", async () => {
      postsToExistingChannel(kind);

      const created: OwnedCreate = await world.createAsOwnedCreator(
        kind,
        OWNER,
      );

      expect(created.error).toBeNull();
      expect(said(kind)).toEqual(heard(kind));
    });

    test("REGRESSION (#11352): a rule naming its creator as an owner matches its Created message, which comes first", async () => {
      postsToExistingChannel(kind, [ownedBy(kind, [OWNER])]);

      await world.createAsOwnedCreator(kind, OWNER);

      expect(said(kind)).toEqual(heard(kind));
    });

    test("REGRESSION (#11352): the owners its owner rules add follow its creator, who was made its owner first, all after its Created message", async () => {
      postsToExistingChannel(kind);
      world.ownerRulesAdd = { teams: [PLATFORM_TEAM] };

      await world.createAsOwnedCreator(kind, OWNER);

      expect(said(kind)).toEqual(heard(kind, ["Platform added"]));
    });

    test("a rule asking for an owner it does not have posts nothing about it, its creator's line included", async () => {
      postsToExistingChannel(kind, [ownedBy(kind, [RULE_USER])]);

      await world.createAsOwnedCreator(kind, OWNER);

      expect(said(kind)).toEqual([]);
    });

    test("its create relied on its creator owning it: they were made its owner after its INSERT, with its messages held already, before its create hook ran", async () => {
      postsToExistingChannel(kind);

      const created: OwnedCreate = await world.createAsOwnedCreator(
        kind,
        OWNER,
      );

      // DatabaseService's own reading of the create, not one a test stood in.
      expect(created.reliesOnOwnership).toBe(true);
      expect(created.steps).toEqual([
        "insert",
        "owner row (held)",
        "create hook (held)",
      ]);
    });

    test("REGRESSION (#11352): its creator cannot be made its owner - it is taken out again, nothing about it reaches the channel, and its hold goes with the create, not once it has lasted its longest", async () => {
      postsToExistingChannel(kind);

      const created: OwnedCreate = await world.createAsOwnedCreator(
        kind,
        OWNER,
        { ownerRowFails: true },
      );

      expect(created.error?.message).toContain("was not created");
      expect(created.steps).toEqual([
        "insert",
        "owner row (held)",
        "taken out (held)",
      ]);
      expect(said(kind)).toEqual([]);

      // Let go by the create as it failed: no create chain was to.
      expect(WorkspaceCreatedMessageFirst.isHeld(created.record)).toBe(false);
    });
  },
);
