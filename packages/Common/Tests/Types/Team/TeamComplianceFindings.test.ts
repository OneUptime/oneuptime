import { describe, expect, test } from "@jest/globals";
import ComplianceNotificationChannel from "../../../Types/Team/ComplianceNotificationChannel";
import {
  COMPLIANCE_CHANNEL_DEFINITIONS,
  COMPLIANCE_RULE_DEFINITIONS,
  ComplianceChannelDefinition,
  ComplianceRuleCategory,
  ComplianceRuleDefinition,
  joinAsProse,
} from "../../../Types/Team/ComplianceRule";
import ComplianceRuleType from "../../../Types/Team/ComplianceRuleType";
import {
  getComplianceFindingText,
  getComplianceReasonText,
  getComplianceWarningText,
  METHOD_MISSING_SENTENCES,
  ON_CALL_FINDING_SENTENCES,
  UNUSABLE_TARGETS,
} from "../../../Types/Team/TeamComplianceFindings";
import {
  TeamComplianceFindingJSON,
  TeamComplianceFindingKind,
  TeamComplianceSeverityJSON,
  TeamComplianceWarningKind,
} from "../../../Types/Team/TeamComplianceStatus";
import { translatableTerm, Translator } from "../../../Types/Translator";
import { getWhoCanTurnOnSentence } from "../../../Utils/Project/NotificationChannels";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A RULE'S WARNINGS AND A MEMBER'S REASONS, IN THE READER'S LANGUAGE (#8632).
 *
 * The server words what is wrong with a team compliance rule, and why a
 * member fails it, and sent only its English sentences: "Call notifications
 * are switched off for this project, ...", "No Call rule for incident
 * severities: Critical". The page drew them as they came, so every reader
 * met them in English, the severities' default names included. It sends
 * what it found as data now, beside the same English, and both are worded
 * by TeamComplianceFindings.
 *
 * Here: the English is the server's English word for word - each sentence
 * rebuilt the way TeamComplianceEvaluator built it before - and German,
 * Arabic and Persian word every sentence, with no English left, the
 * severities as their list names them and a project's own names as written.
 */

const ON_CALL_RULES: Array<ComplianceRuleDefinition> =
  COMPLIANCE_RULE_DEFINITIONS.filter(
    (definition: ComplianceRuleDefinition): boolean => {
      return definition.category === ComplianceRuleCategory.OnCallRule;
    },
  );

const METHOD_CHANNELS: Array<ComplianceChannelDefinition> =
  COMPLIANCE_CHANNEL_DEFINITIONS.filter(
    (definition: ComplianceChannelDefinition): boolean => {
      return Boolean(definition.method);
    },
  );

const labelOf: (channel: ComplianceNotificationChannel) => string = (
  channel: ComplianceNotificationChannel,
): string => {
  return COMPLIANCE_CHANNEL_DEFINITIONS.find(
    (definition: ComplianceChannelDefinition): boolean => {
      return definition.channel === channel;
    },
  )!.label;
};

const CRITICAL: TeamComplianceSeverityJSON = { id: "s1", name: "Critical" };
const MAJOR: TeamComplianceSeverityJSON = { id: "s2", name: "Major" };
// A project's own severity name, which reads as written in every language.
const PAGER_ONLY: TeamComplianceSeverityJSON = {
  id: "s3",
  name: "Sev-0 (pager only)",
};
const UNNAMED: TeamComplianceSeverityJSON = { id: "s4", name: "" };

describe("the server's English, word for word", () => {
  test("every warning on its own", () => {
    expect(
      getComplianceWarningText({
        kind: TeamComplianceWarningKind.UnknownRuleType,
      }),
    ).toBe("This rule type is not recognised, so it is not checked.");
    expect(
      getComplianceWarningText({
        kind: TeamComplianceWarningKind.SeveritiesDeleted,
      }),
    ).toBe(
      "Every severity this rule was scoped to has been deleted, so it is paused. Edit it to choose new severities, or delete it.",
    );
    expect(
      getComplianceWarningText({
        kind: TeamComplianceWarningKind.CustomChannelsNotActive,
      }),
    ).toBe(
      "Custom channels are a OneUptime Enterprise feature, and this server has no Enterprise license that includes them, so nothing is sent to a custom channel and members are not checked for one.",
    );
    expect(
      getComplianceWarningText({
        kind: TeamComplianceWarningKind.NoCustomChannelOn,
      }),
    ).toBe(
      "No custom channel is turned on, so nothing is sent to one and members are not checked for one. A server admin can turn one on in the Admin Dashboard, under Settings > Notifications > Custom Channels.",
    );
  });

  // The who-can sentence is Utils/Project/NotificationChannels', word for word.
  test("WhatsApp switched off, with who can turn it on", () => {
    expect(
      getComplianceWarningText({
        kind: TeamComplianceWarningKind.WhatsAppSwitchedOff,
      }),
    ).toBe(
      `WhatsApp is switched off for this project, so members cannot add a WhatsApp number to meet this rule. ${getWhoCanTurnOnSentence("it")}`,
    );
  });

  test.each([
    [ComplianceNotificationChannel.Call],
    [ComplianceNotificationChannel.SMS],
    [ComplianceNotificationChannel.Telegram],
  ])(
    "%s switched off: the one-channel sentence",
    (channel: ComplianceNotificationChannel) => {
      const label: string = labelOf(channel);

      expect(
        getComplianceWarningText({
          kind: TeamComplianceWarningKind.ChannelsSwitchedOff,
          channels: [channel],
        }),
      ).toBe(
        `${label} notifications are switched off for this project, so members will not be notified by ${label} even when they meet this rule. ${getWhoCanTurnOnSentence("them")}`,
      );
    },
  );

  test.each([
    [[ComplianceNotificationChannel.Call, ComplianceNotificationChannel.SMS]],
    [
      [
        ComplianceNotificationChannel.Telegram,
        ComplianceNotificationChannel.SMS,
        ComplianceNotificationChannel.Call,
      ],
    ],
  ])(
    "several channels switched off share one sentence: %j",
    (channels: Array<ComplianceNotificationChannel>) => {
      const ordered: Array<ComplianceNotificationChannel> =
        COMPLIANCE_CHANNEL_DEFINITIONS.map(
          (definition: ComplianceChannelDefinition) => {
            return definition.channel;
          },
        ).filter((channel: ComplianceNotificationChannel): boolean => {
          return channels.includes(channel);
        });

      expect(
        getComplianceWarningText({
          kind: TeamComplianceWarningKind.ChannelsSwitchedOff,
          channels: channels,
        }),
      ).toBe(
        `${joinAsProse(ordered.map(labelOf))} notifications are switched off for this project, so members will not be notified on these channels even when they meet this rule. ${getWhoCanTurnOnSentence("them")}`,
      );
    },
  );

  test("a method rule's reason, for every channel with a method", () => {
    expect(Object.keys(METHOD_MISSING_SENTENCES).sort()).toEqual(
      METHOD_CHANNELS.map((definition: ComplianceChannelDefinition) => {
        return definition.channel;
      }).sort(),
    );

    // The four that predate custom wording, as installs have always shown them.
    expect(
      getComplianceFindingText(
        {
          kind: TeamComplianceFindingKind.MethodMissing,
          channel: ComplianceNotificationChannel.Call,
        },
        ComplianceRuleType.HasNotificationCallMethod,
      ),
    ).toBe("No verified phone number configured for call notifications");
    expect(
      getComplianceFindingText(
        {
          kind: TeamComplianceFindingKind.MethodMissing,
          channel: ComplianceNotificationChannel.Webhook,
        },
        ComplianceRuleType.HasNotificationWebhookMethod,
      ),
    ).toBe("No webhook configured for notifications");
  });

  test("what an unusable rule points at: an unverified method, or a custom channel that is off - never a webhook", () => {
    for (const definition of COMPLIANCE_CHANNEL_DEFINITIONS) {
      const target: string | undefined = UNUSABLE_TARGETS[definition.channel];

      if (!definition.method) {
        expect(target).toBe("a custom channel that is turned off");
      } else if (definition.method.hasVerification) {
        expect({ channel: definition.channel, target }).toEqual({
          channel: definition.channel,
          target: `an unverified ${definition.method.noun}`,
        });
      } else {
        expect({ channel: definition.channel, target }).toEqual({
          channel: definition.channel,
          target: undefined,
        });
      }
    }
  });

  test.each(
    ON_CALL_RULES.map((rule: ComplianceRuleDefinition) => {
      return [rule];
    }),
  )(
    "every finding of an on-call rule, as the server says it: %#",
    (rule: ComplianceRuleDefinition) => {
      const subject: string = rule.subject || "";
      const say: (finding: TeamComplianceFindingJSON) => string = (
        finding: TeamComplianceFindingJSON,
      ): string => {
        return getComplianceFindingText(finding, rule.ruleType);
      };

      expect(say({ kind: TeamComplianceFindingKind.CouldNotCheck })).toBe(
        `Could not check ${subject} notification rules for this user - they may no longer be a member of this project`,
      );
      expect(
        say({
          kind: TeamComplianceFindingKind.MissingRules,
          severities: [CRITICAL, MAJOR],
        }),
      ).toBe(
        `Missing notification rules for ${subject} severities: Critical, Major`,
      );
      expect(
        say({
          kind: TeamComplianceFindingKind.NoChannelRule,
          channel: ComplianceNotificationChannel.Push,
          severities: [CRITICAL],
        }),
      ).toBe(`No Push notification rule for ${subject} severities: Critical`);
      expect(
        say({
          kind: TeamComplianceFindingKind.UnusableChannelRule,
          channel: ComplianceNotificationChannel.Call,
          severities: [CRITICAL, MAJOR],
        }),
      ).toBe(
        `The Call rule for ${subject} severities Critical, Major points at an unverified phone number for calls`,
      );
      expect(
        say({
          kind: TeamComplianceFindingKind.UnusableChannelRule,
          channel: ComplianceNotificationChannel.CustomChannel,
          severities: [CRITICAL],
        }),
      ).toBe(
        `The Custom channel rule for ${subject} severities Critical points at a custom channel that is turned off`,
      );
      expect(
        say({
          kind: TeamComplianceFindingKind.RefusedChannelRule,
          channel: ComplianceNotificationChannel.SMS,
          severities: [MAJOR],
        }),
      ).toBe(
        `The SMS rule for ${subject} severities Major is never sent, because another notification method on it belongs to a different user`,
      );
      expect(
        say({
          kind: TeamComplianceFindingKind.OptedOut,
          severities: [MAJOR],
        }),
      ).toBe(`Opted out of ${subject} notifications for: Major`);
    },
  );

  test("a severity with no name reads as its id, as the server always wrote it", () => {
    expect(
      getComplianceFindingText(
        {
          kind: TeamComplianceFindingKind.MissingRules,
          severities: [UNNAMED],
        },
        ComplianceRuleType.HasAlertOnCallRules,
      ),
    ).toBe("Missing notification rules for alert severities: s4");
  });

  test("a member's findings on one rule, one after another, with the server's '. '", () => {
    expect(
      getComplianceReasonText(
        [
          {
            kind: TeamComplianceFindingKind.NoChannelRule,
            channel: ComplianceNotificationChannel.Call,
            severities: [CRITICAL],
          },
          {
            kind: TeamComplianceFindingKind.NoChannelRule,
            channel: ComplianceNotificationChannel.Push,
            severities: [CRITICAL],
          },
          { kind: TeamComplianceFindingKind.OptedOut, severities: [MAJOR] },
        ],
        ComplianceRuleType.HasIncidentOnCallRules,
      ),
    ).toBe(
      "No Call rule for incident severities: Critical. No Push notification rule for incident severities: Critical. Opted out of incident notifications for: Major",
    );
  });

  test("a finding it does not know leaves the whole reason to the server's English", () => {
    expect(
      getComplianceReasonText(
        [
          { kind: TeamComplianceFindingKind.OptedOut, severities: [MAJOR] },
          {
            kind: "somethingNew" as TeamComplianceFindingKind,
          },
        ],
        ComplianceRuleType.HasIncidentOnCallRules,
      ),
    ).toBe("");
    expect(
      getComplianceReasonText([], ComplianceRuleType.HasIncidentOnCallRules),
    ).toBe("");
    // An on-call finding on a rule type with no on-call words.
    expect(
      getComplianceFindingText(
        { kind: TeamComplianceFindingKind.CouldNotCheck },
        "HasCarrierPigeon",
      ),
    ).toBe("");
  });

  test("the catalog has one set of on-call sentences per on-call rule, and nothing else", () => {
    expect(Object.keys(ON_CALL_FINDING_SENTENCES).sort()).toEqual(
      ON_CALL_RULES.map((rule: ComplianceRuleDefinition) => {
        return rule.ruleType;
      }).sort(),
    );
  });
});

describe("in the reader's language", () => {
  const EVERY_WARNING: Array<{
    kind: TeamComplianceWarningKind;
    channels?: Array<ComplianceNotificationChannel>;
  }> = [
    { kind: TeamComplianceWarningKind.UnknownRuleType },
    { kind: TeamComplianceWarningKind.SeveritiesDeleted },
    { kind: TeamComplianceWarningKind.CustomChannelsNotActive },
    { kind: TeamComplianceWarningKind.NoCustomChannelOn },
    { kind: TeamComplianceWarningKind.WhatsAppSwitchedOff },
    {
      kind: TeamComplianceWarningKind.ChannelsSwitchedOff,
      channels: [ComplianceNotificationChannel.Call],
    },
    {
      kind: TeamComplianceWarningKind.ChannelsSwitchedOff,
      channels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.SMS,
      ],
    },
  ];

  const EVERY_FINDING: Array<TeamComplianceFindingJSON> = [
    { kind: TeamComplianceFindingKind.CouldNotCheck },
    {
      kind: TeamComplianceFindingKind.MissingRules,
      severities: [PAGER_ONLY],
    },
    {
      kind: TeamComplianceFindingKind.NoChannelRule,
      channel: ComplianceNotificationChannel.Call,
      severities: [PAGER_ONLY],
    },
    {
      kind: TeamComplianceFindingKind.UnusableChannelRule,
      channel: ComplianceNotificationChannel.Push,
      severities: [PAGER_ONLY],
    },
    {
      kind: TeamComplianceFindingKind.RefusedChannelRule,
      channel: ComplianceNotificationChannel.SMS,
      severities: [PAGER_ONLY],
    },
    {
      kind: TeamComplianceFindingKind.OptedOut,
      severities: [PAGER_ONLY],
    },
  ];

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every sentence the findings are said with",
    (language: string) => {
      const keys: Array<string> = [
        ...Object.values(METHOD_MISSING_SENTENCES),
        ...Object.values(UNUSABLE_TARGETS),
        ...Object.values(ON_CALL_FINDING_SENTENCES).flatMap(
          (sentences: Record<string, string> | undefined) => {
            return Object.values(sentences || {});
          },
        ),
      ] as Array<string>;
      const unworded: Array<string> = keys.filter((key: string): boolean => {
        return !isWordedInDashboardLocale(key, language);
      });

      expect(unworded).toEqual([]);
    },
  );

  test.each(["de", "ar", "fa"])(
    "%s: every warning reads in the language, with no English sentence left",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const warning of EVERY_WARNING) {
        const english: string = getComplianceWarningText(warning);
        const worded: string = getComplianceWarningText(warning, translator);

        expect({ warning, differs: worded !== english }).toEqual({
          warning,
          differs: true,
        });
        // Not even its first words, nor who can turn it on.
        expect(worded).not.toContain("switched off");
        expect(worded).not.toContain("A Project Owner");
      }
    },
  );

  test("German: a channel is named by its German name, in its sentence", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      getComplianceWarningText(
        {
          kind: TeamComplianceWarningKind.ChannelsSwitchedOff,
          channels: [ComplianceNotificationChannel.Push],
        },
        german,
      ),
    ).toContain(german.translateTerm("Push notification"));
  });

  test.each(["de", "ar", "fa"])(
    "%s: every finding of an incident rule reads in the language; a project's severity as written",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const finding of EVERY_FINDING) {
        const english: string = getComplianceFindingText(
          finding,
          ComplianceRuleType.HasIncidentOnCallRules,
        );
        const worded: string = getComplianceFindingText(
          finding,
          ComplianceRuleType.HasIncidentOnCallRules,
          translator,
        );

        expect({ kind: finding.kind, differs: worded !== english }).toEqual({
          kind: finding.kind,
          differs: true,
        });
        expect(worded).not.toContain("severities");

        if (finding.severities) {
          expect(worded).toContain(PAGER_ONLY.name);
        }
      }
    },
  );

  test("German: a default severity name takes the reader's word through the caller's severity value", () => {
    const german: Translator = dashboardTranslator("de");

    const worded: string = getComplianceFindingText(
      {
        kind: TeamComplianceFindingKind.MissingRules,
        severities: [CRITICAL, PAGER_ONLY],
      },
      ComplianceRuleType.HasIncidentOnCallRules,
      german,
      (severity: TeamComplianceSeverityJSON) => {
        return severity.name === "Critical"
          ? translatableTerm("Critical Incident")
          : severity.name;
      },
    );

    expect(worded).toContain(german.translateTerm("Critical Incident"));
    expect(worded).toContain(PAGER_ONLY.name);
    expect(worded).not.toContain("Critical Incident");
  });

  test.each([
    ["de", ". "],
    ["ja", "。"],
    ["zh-CN", "。"],
    ["hi", "। "],
    ["ar", ". "],
  ])(
    "%s: a member's findings follow one another with the language's own full stop",
    (language: string, fullStop: string) => {
      const translator: Translator = dashboardTranslator(language);
      const findings: Array<TeamComplianceFindingJSON> = [
        {
          kind: TeamComplianceFindingKind.NoChannelRule,
          channel: ComplianceNotificationChannel.Call,
          severities: [PAGER_ONLY],
        },
        { kind: TeamComplianceFindingKind.OptedOut, severities: [PAGER_ONLY] },
      ];

      expect(
        getComplianceReasonText(
          findings,
          ComplianceRuleType.HasIncidentOnCallRules,
          translator,
        ),
      ).toBe(
        findings
          .map((finding: TeamComplianceFindingJSON): string => {
            return getComplianceFindingText(
              finding,
              ComplianceRuleType.HasIncidentOnCallRules,
              translator,
            );
          })
          .join(fullStop),
      );
    },
  );
});
