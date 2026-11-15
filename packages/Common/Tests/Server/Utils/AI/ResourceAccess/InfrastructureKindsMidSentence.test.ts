import { describe, expect, test } from "@jest/globals";
import AIInvestigationEngine from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import InfrastructureInvestigationToolkit from "../../../../../Server/Utils/AI/ResourceAccess/InfrastructureInvestigationToolkit";
import ResourceAccessContext, {
  describeResource,
  describeResourceInSentence,
} from "../../../../../Server/Utils/AI/ResourceAccess/ResourceAccessContext";
import { RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME } from "../../../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import { describeResourceNoun } from "../../../../../Server/Services/ResourceAiAccessService";
import { describeResourceInSentence as describeAgentResourceInSentence } from "../../../../../Server/Services/ResourceAiAgentService";
import { buildResourceQuestion } from "../../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import { describeChangeTarget } from "../../../../../Server/Utils/AutoRemediation/RemediationChatMessage";
import { getResourceSentenceName } from "../../../../../Types/AI/ResourceAiAccessPermissions";
import { AIChatCitation } from "../../../../../Types/AI/AIChatTypes";
import { AiRemediationCommand } from "../../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
} from "../../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../../Types/Runbook/RunbookStepType";
import ResourceCommandPolicy from "../../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import {
  DEFAULT_LANGUAGE,
  toSentenceTerm,
} from "../../../../../Types/Translator";
import {
  InvestigationEvidenceCheckedEntry,
  parseInvestigationReport,
} from "../../../../../Utils/AI/InvestigationReport";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
} from "../../../../Helpers/DashboardLocales";

/*
 * AN INFRASTRUCTURE COMMAND'S CITATION, AND THE SERVER'S OTHER LINES ABOUT A
 * RESOURCE, NAME ITS KIND AS A SENTENCE DOES (#8133).
 *
 * #7940 made the AI Investigation card name a resource's kind in the middle
 * of a line the way a sentence says it ("host web-1", "Docker host web-2"),
 * and #7952 did the same for the server's activity and report-lead lines.
 * A command OneUptime AI ran through a resource's AI agent is cited by a
 * label of its own, which took its noun from AI_RESOURCE_TYPE_INFO's
 * display names - labels - so the report's Evidence checked list read:
 *
 *   - [C1] `uptime` on Host "db" — succeeded
 *   - [C2] `docker ps -a` on Docker host "web-1" — succeeded
 *
 * Every kind now reads as toSentenceTerm cases its display name, which is
 * the card's own word for it (getResourceSentenceName): "host", "database
 * server", "Docker host", "AWS account". A label at the start of a line, or
 * the model's list of resources, keeps the display name.
 */

function readyResource(
  resourceType: AiResourceType,
  resourceName: string = "db",
): ResourceAiAccessStatus {
  return {
    resourceType,
    resourceId: "0193c0de-eeee-4aaa-8bbb-000000000001",
    resourceName,
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
    agent: {
      agentId: "0193c0de-eeee-4aaa-8bbb-000000000002",
      connectionStatus: "connected",
      isOnline: true,
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
  };
}

// A kind as the middle of an English sentence says it.
const sentenceNounOf: (type: AiResourceType) => string = (
  type: AiResourceType,
): string => {
  return toSentenceTerm(
    AI_RESOURCE_TYPE_INFO[type].displayName,
    DEFAULT_LANGUAGE,
  );
};

const citationOf: (
  type: AiResourceType,
  command: string,
  name?: string,
) => string = (
  type: AiResourceType,
  command: string,
  name: string = "db",
): string => {
  return InfrastructureInvestigationToolkit.getCitationLabel({
    displayCommand: command,
    resource: readyResource(type, name),
  });
};

describe("an infrastructure command's citation", () => {
  // The lines the issue was filed for.
  test.each([
    [AiResourceType.Host, "uptime", "db", '`uptime` on host "db"'],
    [
      AiResourceType.DockerHost,
      "docker ps -a",
      "web-1",
      '`docker ps -a` on Docker host "web-1"',
    ],
    [
      AiResourceType.DatabaseServer,
      "db status",
      "orders",
      '`db status` on database server "orders"',
    ],
    [
      AiResourceType.AwsAccount,
      "cloud whoami",
      "prod",
      '`cloud whoami` on AWS account "prod"',
    ],
    [
      AiResourceType.VMwareVCenter,
      "govc about",
      "vc-1",
      '`govc about` on VMware vCenter "vc-1"',
    ],
    [
      AiResourceType.GoogleCloudProject,
      "cloud whoami",
      "shop",
      '`cloud whoami` on Google Cloud project "shop"',
    ],
  ])(
    "a %s reads as a sentence says it",
    (type: AiResourceType, command: string, name: string, expected: string) => {
      expect(citationOf(type, command, name)).toBe(expected);
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "a %s's noun is its display name cased for the middle of a sentence",
    (type: AiResourceType) => {
      expect(citationOf(type, "x")).toBe(
        `\`x\` on ${sentenceNounOf(type)} "db"`,
      );
    },
  );

  test("no kind takes a label's capital after on", () => {
    for (const type of ALL_AI_RESOURCE_TYPES) {
      const label: string = citationOf(type, "x");
      const word: string = label.split(" on ")[1]!.split(" ")[0]!;

      // Lower-case, or a name's or an abbreviation's capital: Docker, AWS.
      expect(toSentenceTerm(word, DEFAULT_LANGUAGE)).toBe(word);
      expect(label).not.toMatch(/ on (Host|Database server) /);
    }
  });

  test("a type this build does not know is a resource", () => {
    expect(
      InfrastructureInvestigationToolkit.getCitationLabel({
        displayCommand: "x",
        resource: readyResource("FutureThing" as AiResourceType, "f"),
      }),
    ).toBe('`x` on resource "f"');
  });

  test("the name stays quoted beside the command", () => {
    expect(citationOf(AiResourceType.Host, "df -h", "web 1")).toBe(
      '`df -h` on host "web 1"',
    );
  });
});

/*
 * The report's Evidence checked list shows the labels as they are, and the
 * Dashboard reads a citation back by its id, never by these words.
 */
describe("the report's evidence list", () => {
  const CITATIONS: Array<AIChatCitation> = [
    {
      id: "C1",
      toolName: RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
      label: citationOf(AiResourceType.Host, "uptime"),
      rowCount: 1,
      queryArguments: {},
    },
    {
      id: "C2",
      toolName: RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
      label: citationOf(AiResourceType.DockerHost, "docker ps -a", "web-1"),
      rowCount: 1,
      queryArguments: {},
    },
    {
      id: "C3",
      toolName: RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
      label: citationOf(AiResourceType.DatabaseServer, "db status", "orders"),
      rowCount: 0,
      queryArguments: {},
    },
  ];

  const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
    {
      contentInMarkdown: "**Summary** — db is slow [C1].",
      citations: CITATIONS,
      totalTokens: 100,
      llmCallCount: 2,
      toolCallCount: 3,
      modelName: "gpt-4.1-mini",
    },
    "**Summary** — db is slow.\n\n**Most likely root cause** — x.",
    0,
    3,
  );

  test("reads one kind beside another the same way", () => {
    expect(markdown).toContain('- **[C1]** `uptime` on host "db" — succeeded');
    expect(markdown).toContain(
      '- **[C2]** `docker ps -a` on Docker host "web-1" — succeeded',
    );
    expect(markdown).toContain(
      '- **[C3]** `db status` on database server "orders" — command returned an error',
    );
    expect(markdown).not.toContain("on Host");
    expect(markdown).not.toContain("on Database server");
  });

  test("is read back by each citation's id, with its label as written", () => {
    const entries: Array<InvestigationEvidenceCheckedEntry> =
      parseInvestigationReport(markdown).evidenceChecked;

    expect(
      entries.map((entry: InvestigationEvidenceCheckedEntry): string => {
        return `${entry.citationId}: ${entry.label}`;
      }),
    ).toEqual([
      'C1: `uptime` on host "db"',
      'C2: `docker ps -a` on Docker host "web-1"',
      'C3: `db status` on database server "orders"',
    ]);
  });

  // A report posted before this change keeps its words, and still reads.
  test("an earlier report's label still reads back", () => {
    const earlier: string = markdown.replace(
      '`uptime` on host "db"',
      '`uptime` on Host "db"',
    );

    expect(parseInvestigationReport(earlier).evidenceChecked[0]).toMatchObject({
      citationId: "C1",
      label: '`uptime` on Host "db"',
    });
  });
});

describe("the server's nouns for a kind of resource", () => {
  test.each(ALL_AI_RESOURCE_TYPES)(
    "a %s is named alike everywhere in the middle of a sentence",
    (type: AiResourceType) => {
      const noun: string = sentenceNounOf(type);

      // Written out where the agent can read it, beside the display name.
      expect(AI_RESOURCE_TYPE_INFO[type].sentenceName).toBe(noun);
      // The AI Investigation card's word, which the Dashboard translates.
      expect(getResourceSentenceName(type)).toBe(noun);
      expect(describeResourceNoun(type)).toBe(noun);
      expect(describeAgentResourceInSentence(type)).toBe(noun);
      expect(describeResourceInSentence(readyResource(type, "r"))).toBe(
        `${noun} "r"`,
      );
    },
  );

  test("an unknown type is a resource", () => {
    expect(describeResourceNoun("FutureThing" as AiResourceType)).toBe(
      "resource",
    );
  });

  // Where a resource starts a line of the model's list, its label stays.
  test.each([
    [AiResourceType.Host, 'Host "r"'],
    [AiResourceType.DatabaseServer, 'Database server "r"'],
    [AiResourceType.DockerHost, 'Docker host "r"'],
  ])(
    "a %s starts a line as its label",
    (type: AiResourceType, label: string) => {
      expect(describeResource(readyResource(type, "r"))).toBe(label);
    },
  );

  test("the model's context lists a resource by its label", () => {
    expect(
      ResourceAccessContext.buildContextSection([
        readyResource(AiResourceType.Host, "db-host"),
      ]),
    ).toContain('- Host "db-host" (resourceId:');
  });

  test("the panel's sentence for people names it as a sentence does", () => {
    expect(
      ResourceAccessContext.describeMissingAccessForHumans(
        readyResource(AiResourceType.Host, "db-host"),
      ),
    ).toBe(
      'OneUptime AI can run read-only commands on host "db-host" through the Host AI agent.',
    );
    expect(
      ResourceAccessContext.describeMissingAccessForHumans(
        readyResource(AiResourceType.DatabaseServer, "orders"),
      ),
    ).toBe(
      'OneUptime AI can run read-only commands on database server "orders" through the Database AI agent.',
    );
  });
});

/*
 * The command policy's reasons go into the server's refusals ("Refused by
 * the host command policy: ...") and the agent's, so they name the kind as a
 * sentence does too, after "this" - never "a Host", nor "a AWS account".
 */
describe("the command policy's reasons", () => {
  const programOf: (type: AiResourceType) => string = (
    type: AiResourceType,
  ): string => {
    return AI_RESOURCE_TYPE_INFO[type].programs[0]!;
  };

  test.each(ALL_AI_RESOURCE_TYPES)(
    "another program on a %s is refused naming this kind as a sentence does",
    (type: AiResourceType) => {
      const result: ResourceCommandPolicyResult =
        ResourceCommandPolicy.evaluateCommand({
          resourceType: type,
          command: "notaprogram --flag",
        });

      expect(result.reason).toContain(
        `a command for this ${sentenceNounOf(type)} starts with "${programOf(type)}"`,
      );
      expect(result.reason).not.toMatch(/ for an? /);
    },
  );

  test("a host's refusal says host after its policy and after this", () => {
    const result: ResourceCommandPolicyResult =
      ResourceCommandPolicy.evaluateCommand({
        resourceType: AiResourceType.Host,
        command: "docker ps",
      });

    expect(result.reason).toContain(
      '"docker" is not a program the Host AI agent runs: a command for this host starts with "systemctl"',
    );
    expect(result.reason).not.toContain("this Host");
  });

  test("the toolkit's refusal reads host throughout, but for the agent's name", () => {
    const reason: string = ResourceCommandPolicy.evaluateCommand({
      resourceType: AiResourceType.Host,
      command: "docker ps",
    }).reason;

    expect(
      `Refused by the ${describeResourceNoun(AiResourceType.Host)} command policy: ${reason}`,
    ).toMatch(
      /^Refused by the host command policy: "docker" is not a program the Host AI agent runs: a command for this host starts with/,
    );
  });

  // A change each kind's policy accepts, for its read-only agent to refuse.
  const CHANGES: ReadonlyArray<string> = [
    "docker restart web",
    "systemctl restart nginx",
    "pvesh create /nodes/pve1/qemu/100/status/reboot",
    "govc vm.power -r web-01",
    "ceph osd set noout",
    "db cancel-query 1234",
    "cloud restart-service arn:aws:ecs:us-east-1:123456789012:service/prod/web",
    "openstack server reboot 358ee736-ba74-40ba-a354-7ead413c5df6",
    "docker service update --force web",
  ];

  const readOnlyRefusalOf: (type: AiResourceType) => string | null = (
    type: AiResourceType,
  ): string | null => {
    for (const command of CHANGES) {
      const result: ResourceCommandPolicyResult =
        ResourceCommandPolicy.evaluateCommand({ resourceType: type, command });

      if (result.tier === "Read" || result.tier === "Denied") {
        continue;
      }

      return ResourceCommandPolicy.getWriteScopeRefusal({
        result,
        allowWrites: false,
        writeTargets: [],
        protectedTargets: [],
        resourceType: type,
      });
    }

    return null;
  };

  const REFUSING_TYPES: Array<AiResourceType> = ALL_AI_RESOURCE_TYPES.filter(
    (type: AiResourceType): boolean => {
      return readOnlyRefusalOf(type) !== null;
    },
  );

  test("most kinds have a change here for their read-only agent to refuse", () => {
    expect(REFUSING_TYPES).toEqual(
      expect.arrayContaining([
        AiResourceType.Host,
        AiResourceType.DockerHost,
        AiResourceType.DatabaseServer,
      ]),
    );
  });

  test.each(REFUSING_TYPES)(
    "a read-only %s's agent refuses a change naming this kind as a sentence does",
    (type: AiResourceType) => {
      expect(readOnlyRefusalOf(type)).toContain(
        `The ${AI_RESOURCE_TYPE_INFO[type].agentDisplayName} for this ${sentenceNounOf(type)} is read-only`,
      );
    },
  );

  test("a read-only host's agent refuses a restart naming this host", () => {
    expect(
      ResourceCommandPolicy.getWriteScopeRefusal({
        result: ResourceCommandPolicy.evaluateCommand({
          resourceType: AiResourceType.Host,
          command: "systemctl restart nginx",
        }),
        allowWrites: false,
        writeTargets: [],
        protectedTargets: [],
        resourceType: AiResourceType.Host,
      }),
    ).toContain("The Host AI agent for this host is read-only");
  });
});

describe("the remediation round's lines", () => {
  const change: (type: AiResourceType, name: string) => AiRemediationCommand = (
    type: AiResourceType,
    name: string,
  ): AiRemediationCommand => {
    return {
      sequence: 1,
      stepType: RunbookStepType.ResourceCommand,
      resourceType: type,
      resourceId: "0193c0de-eeee-4aaa-8bbb-000000000001",
      resourceNameSnapshot: name,
      command: "x",
    } as unknown as AiRemediationCommand;
  };

  test.each(ALL_AI_RESOURCE_TYPES)(
    "a change on a %s names its target as a sentence does",
    (type: AiResourceType) => {
      expect(describeChangeTarget(change(type, "prod"))).toBe(
        `${sentenceNounOf(type)} "prod"`,
      );
    },
  );

  test("a database server's change reads on database server, never Database server", () => {
    expect(
      describeChangeTarget(change(AiResourceType.DatabaseServer, "orders")),
    ).toBe('database server "orders"');
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "the question a %s round asks names it as a sentence does",
    (type: AiResourceType) => {
      expect(
        buildResourceQuestion({
          resource: readyResource(type, "web-1"),
          mode: "Suggest",
        }),
      ).toContain(
        `A signal has been declared on ${sentenceNounOf(type)} "web-1".`,
      );
    },
  );
});

/*
 * The card names these kinds through the Dashboard's files, in the reader's
 * language. In every language, a host and a Docker host say "host" the same
 * way, as the server's English now does.
 */
describe("the card, in every language", () => {
  const cardWord: (language: string, type: AiResourceType) => string = (
    language: string,
    type: AiResourceType,
  ): string => {
    return dashboardTranslator(language).translateTerm(
      getResourceSentenceName(type),
      { inSentence: true },
    );
  };

  test("English draws the server's words", () => {
    for (const type of ALL_AI_RESOURCE_TYPES) {
      expect(cardWord("en", type)).toBe(describeResourceNoun(type));
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s says host alike in a host and a Docker host",
    (language: string) => {
      const host: string = cardWord(language, AiResourceType.Host);
      const dockerHost: string = cardWord(language, AiResourceType.DockerHost);
      const podmanHost: string = cardWord(language, AiResourceType.PodmanHost);

      for (const named of [dockerHost, podmanHost]) {
        if (named.toLowerCase().includes(host.toLowerCase())) {
          expect(named).toContain(host);
        }
      }
    },
  );

  test("the languages whose word for a Docker host holds their word for a host are checked", () => {
    const checked: Array<string> = DASHBOARD_LANGUAGES.filter(
      (language: string): boolean => {
        return cardWord(language, AiResourceType.DockerHost)
          .toLowerCase()
          .includes(cardWord(language, AiResourceType.Host).toLowerCase());
      },
    );

    expect(checked.length).toBeGreaterThanOrEqual(15);
    expect(checked).toEqual(expect.arrayContaining(["de", "fr", "ja", "fa"]));
  });
});
