/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import DatabaseConfig from "../../../Server/DatabaseConfig";
import HostFeedService from "../../../Server/Services/HostFeedService";
import HostLabelRuleEngineService from "../../../Server/Services/HostLabelRuleEngineService";
import HostOwnerTeamService from "../../../Server/Services/HostOwnerTeamService";
import HostService from "../../../Server/Services/HostService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import LabelService from "../../../Server/Services/LabelService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import Host from "../../../Models/DatabaseModels/Host";
import HostLabelRule from "../../../Models/DatabaseModels/HostLabelRule";
import HostOwnerTeam from "../../../Models/DatabaseModels/HostOwnerTeam";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentLabelRule from "../../../Models/DatabaseModels/IncidentLabelRule";
import Label from "../../../Models/DatabaseModels/Label";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { formatSloFeedEntityNames } from "../../../Utils/Slo/SloFeedMarkdown";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * THE TEXT OF A FEW FEED ITEMS, PINNED.
 *
 * Feed items are written by many services, each building its own Markdown.
 * This pins the exact text of one item of each common shape - a resource
 * created by a person, an owner team added, a resource label rule, an
 * incident label rule and an SLO's label list - for a name typed the
 * ordinary way and for a name full of Markdown, so any change to how feed
 * text is written shows here as a diff of the text itself.
 */

const ORDINARY_NAME: string = "Payments API (EU) - prod";

const MARKDOWN_NAME: string =
  "![x](https://tracker.example/p.png) [Reset](https://evil.example/login) <!channel> *bold* `code` _x_ ~s~ R&D &lt;";

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const HOST_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const LABEL_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const INCIDENT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

interface FeedText {
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string | undefined;
}

let feedTexts: Array<FeedText> = [];

// A feed item's text, as the feed service is handed it.
function recordFeedText(data: any): Promise<void> {
  feedTexts.push({
    feedInfoInMarkdown: data.feedInfoInMarkdown,
    moreInformationInMarkdown: data.moreInformationInMarkdown,
  });
  return Promise.resolve();
}

beforeEach(() => {
  feedTexts = [];

  stubProjectDirectory({});

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/dashboard"));

  jest
    .spyOn(HostFeedService, "createHostFeedItem")
    .mockImplementation(recordFeedText);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation(recordFeedText);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function hostNamed(name: string): Host {
  const host: Host = new Host(HOST_ID);
  host.projectId = PROJECT_ID;
  host.name = name;
  host.description = "Primary database host";
  host.labels = [];
  return host;
}

async function hostCreatedBy(personName: string): Promise<FeedText> {
  jest
    .spyOn(HostService, "findOneById")
    .mockResolvedValue(hostNamed(personName));

  const person: User = new User(USER_ID);
  person.name = new Name(personName);
  jest.spyOn(UserService, "findOneBy").mockResolvedValue(person);

  const created: Host = hostNamed(personName);
  created.hostIdentifier = personName;

  await (HostService as any).writeHostCreatedFeed(created, {
    createBy: { props: { userId: USER_ID } },
  });

  return feedTexts[0]!;
}

async function ownerTeamAdded(name: string): Promise<FeedText> {
  jest.spyOn(HostService, "findOneById").mockResolvedValue(hostNamed(name));

  const team: Team = new Team(TEAM_ID);
  team.name = name;
  jest.spyOn(TeamService, "findOneById").mockResolvedValue(team);

  const ownerTeam: HostOwnerTeam = new HostOwnerTeam();
  ownerTeam.hostId = HOST_ID;
  ownerTeam.projectId = PROJECT_ID;
  ownerTeam.teamId = TEAM_ID;

  await HostOwnerTeamService.onCreateSuccess(
    { createBy: { props: { userId: USER_ID } } } as any,
    ownerTeam,
  );

  return feedTexts[0]!;
}

async function hostLabelRuleRan(name: string): Promise<FeedText> {
  jest.spyOn(HostService, "findOneById").mockResolvedValue(hostNamed(name));

  const builder: any = {
    createQueryBuilder: () => {
      return builder;
    },
    relation: () => {
      return builder;
    },
    of: () => {
      return builder;
    },
    add: async () => {},
  };
  jest.spyOn(HostService, "getRepository").mockReturnValue(builder);

  const rule: HostLabelRule = new HostLabelRule(RULE_ID);
  rule.name = name;
  rule.hostNamePattern = ".*";
  rule.labelsToAdd = [new Label(LABEL_ID)];

  await HostLabelRuleEngineService.applyRulesToExistingResource({
    resource: hostNamed(name),
    rules: [rule],
    allowOwnerNotification: false,
  });

  return feedTexts[0]!;
}

async function incidentLabelRuleRan(name: string): Promise<FeedText> {
  const label: Label = new Label(LABEL_ID);
  label.name = name;
  jest.spyOn(LabelService, "findBy").mockResolvedValue([label]);

  const rule: IncidentLabelRule = new IncidentLabelRule(RULE_ID);
  rule.name = name;

  const incident: Incident = new Incident(INCIDENT_ID);
  incident.projectId = PROJECT_ID;

  await (IncidentLabelRuleEngineService as any).createRuleExecutedFeedItem({
    incident: incident,
    matchedRules: [rule],
    addedLabelIds: [LABEL_ID.toString()],
  });

  return feedTexts[0]!;
}

/*
 * What each item says, for each name. An ordinary name reads exactly as
 * typed; a name full of Markdown must too, and must not become a link, an
 * image, a mention or code.
 */
const EXPECTED: Record<string, FeedText | string> = {
  "hostCreated.markdown": {
    feedInfoInMarkdown:
      "🚀 [Host \\!\\[x\\]\\(https://tracker.example/p.png\\) \\[Reset\\]\\(https://evil.example/login\\) \\<\u2060\\!channel> \\*bold\\* \\`code\\` \\_x\\_ \\~s\\~ R&D \\&lt;](https://oneuptime.example/dashboard/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/host/11111111-1111-4111-8111-111111111111) was created by **[\\!\\[x\\]\\(https://tracker.example/p.png\\) \\[Reset\\]\\(https://evil.example/login\\) \\<\u2060\\!channel> \\*bold\\* \\`code\\` \\_x\\_ \\~s\\~ R&D \\&lt;](https://oneuptime.example/dashboard/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/settings/users/55555555-5555-4555-8555-555555555555)**.",
    moreInformationInMarkdown:
      "**Created by**: [\\!\\[x\\]\\(https://tracker.example/p.png\\) \\[Reset\\]\\(https://evil.example/login\\) \\<\u2060\\!channel> \\*bold\\* \\`code\\` \\_x\\_ \\~s\\~ R&D \\&lt;](https://oneuptime.example/dashboard/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/settings/users/55555555-5555-4555-8555-555555555555)\n\n**How it was created**: Added by a user, from the OneUptime dashboard or through the OneUptime API.\n\n**Automatically created from telemetry**: No.\n\n**Host identifier**: `` ![x](https://tracker.example/p.png) [Reset](https://evil.example/login) <\u2060!channel> *bold* `code` _x_ ~s~ R&D &lt; ``\n\n**Description**: Primary database host",
  },
  "hostCreated.ordinary": {
    feedInfoInMarkdown:
      "🚀 [Host Payments API \\(EU\\) - prod](https://oneuptime.example/dashboard/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/host/11111111-1111-4111-8111-111111111111) was created by **[Payments API \\(EU\\) - prod](https://oneuptime.example/dashboard/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/settings/users/55555555-5555-4555-8555-555555555555)**.",
    moreInformationInMarkdown:
      "**Created by**: [Payments API \\(EU\\) - prod](https://oneuptime.example/dashboard/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/settings/users/55555555-5555-4555-8555-555555555555)\n\n**How it was created**: Added by a user, from the OneUptime dashboard or through the OneUptime API.\n\n**Automatically created from telemetry**: No.\n\n**Host identifier**: `Payments API (EU) - prod`\n\n**Description**: Primary database host",
  },
  "hostLabelRule.markdown": {
    feedInfoInMarkdown:
      "🏷️ 1 label(s) were attached to [Host \\!\\[x\\]\\(https://tracker.example/p.png\\) \\[Reset\\]\\(https://evil.example/login\\) \\<\u2060\\!channel> \\*bold\\* \\`code\\` \\_x\\_ \\~s\\~ R&D \\&lt;](https://oneuptime.example/dashboard/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/host/11111111-1111-4111-8111-111111111111) by label rule.",
    moreInformationInMarkdown:
      "**Label rules that matched**: `` ![x](https://tracker.example/p.png) [Reset](https://evil.example/login) <\u2060!channel> *bold* `code` _x_ ~s~ R&D &lt; ``",
  },
  "hostLabelRule.ordinary": {
    feedInfoInMarkdown:
      "🏷️ 1 label(s) were attached to [Host Payments API \\(EU\\) - prod](https://oneuptime.example/dashboard/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/host/11111111-1111-4111-8111-111111111111) by label rule.",
    moreInformationInMarkdown:
      "**Label rules that matched**: `Payments API (EU) - prod`",
  },
  "incidentLabelRule.markdown": {
    feedInfoInMarkdown:
      "🏷️ **Incident Label Rule executed:** **!\\[x\\](https://tracker.example/p.png) \\[Reset\\](https://evil.example/login) \\<\u2060!channel> \\*bold\\* \\`code\\` \\_x\\_ \\~s\\~ R&D \\&lt;**\n\nAdded the following label to the incident:\n- !\\[x\\](https://tracker.example/p.png) \\[Reset\\](https://evil.example/login) \\<\u2060!channel> \\*bold\\* \\`code\\` \\_x\\_ \\~s\\~ R&D \\&lt;",
    moreInformationInMarkdown: undefined,
  },
  "incidentLabelRule.ordinary": {
    feedInfoInMarkdown:
      "🏷️ **Incident Label Rule executed:** **Payments API (EU) - prod**\n\nAdded the following label to the incident:\n- Payments API (EU) - prod",
    moreInformationInMarkdown: undefined,
  },
  "ownerTeamAdded.markdown": {
    feedInfoInMarkdown:
      "👨🏻‍👩🏻‍👦🏻 Added team **!\\[x\\](https://tracker.example/p.png) \\[Reset\\](https://evil.example/login) \\<\u2060!channel> \\*bold\\* \\`code\\` \\_x\\_ \\~s\\~ R&D \\&lt;** as an owner of [Host \\!\\[x\\]\\(https://tracker.example/p.png\\) \\[Reset\\]\\(https://evil.example/login\\) \\<\u2060\\!channel> \\*bold\\* \\`code\\` \\_x\\_ \\~s\\~ R&D \\&lt;](https://oneuptime.example/dashboard/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/host/11111111-1111-4111-8111-111111111111).",
    moreInformationInMarkdown: undefined,
  },
  "ownerTeamAdded.ordinary": {
    feedInfoInMarkdown:
      "👨🏻‍👩🏻‍👦🏻 Added team **Payments API (EU) - prod** as an owner of [Host Payments API \\(EU\\) - prod](https://oneuptime.example/dashboard/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/host/11111111-1111-4111-8111-111111111111).",
    moreInformationInMarkdown: undefined,
  },
  "sloLabels.markdown":
    "!\\[x\\](https://tracker.example/p.png) \\[Reset\\](https://evil.example/login) \\<\u2060!channe…, Tier 1",
  "sloLabels.ordinary": "Payments API (EU) - prod, Tier 1",
};

const NAMES: Array<[string, string]> = [
  ["ordinary", ORDINARY_NAME],
  ["markdown", MARKDOWN_NAME],
];

describe("feed item texts", () => {
  test.each(NAMES)(
    "a host created by a person, both with the %s name",
    async (label: string, name: string) => {
      expect(await hostCreatedBy(name)).toEqual(
        EXPECTED[`hostCreated.${label}`],
      );
    },
  );

  test.each(NAMES)(
    "an owner team added to a host, both with the %s name",
    async (label: string, name: string) => {
      expect(await ownerTeamAdded(name)).toEqual(
        EXPECTED[`ownerTeamAdded.${label}`],
      );
    },
  );

  test.each(NAMES)(
    "a host label rule run, rule and host with the %s name",
    async (label: string, name: string) => {
      expect(await hostLabelRuleRan(name)).toEqual(
        EXPECTED[`hostLabelRule.${label}`],
      );
    },
  );

  test.each(NAMES)(
    "an incident label rule run, rule and label with the %s name",
    async (label: string, name: string) => {
      expect(await incidentLabelRuleRan(name)).toEqual(
        EXPECTED[`incidentLabelRule.${label}`],
      );
    },
  );

  test.each(NAMES)(
    "an SLO's labels, one with the %s name",
    async (label: string, name: string) => {
      expect(
        formatSloFeedEntityNames([
          { name: name },
          { name: "Tier 1" },
        ]).toString(),
      ).toEqual(EXPECTED[`sloLabels.${label}`]);
    },
  );
});
