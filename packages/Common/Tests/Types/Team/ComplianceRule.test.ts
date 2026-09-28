import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserMicrosoftTeams from "../../../Models/DatabaseModels/UserMicrosoftTeams";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserSlack from "../../../Models/DatabaseModels/UserSlack";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ComplianceNotificationChannel from "../../../Types/Team/ComplianceNotificationChannel";
import ComplianceRule, {
  COMPLIANCE_CHANNEL_DEFINITIONS,
  COMPLIANCE_RULE_DEFINITIONS,
  ComplianceChannelDefinition,
  ComplianceRuleCategory,
  ComplianceRuleDefinition,
  ComplianceSeverityKind,
  joinAsProse,
} from "../../../Types/Team/ComplianceRule";
import ComplianceRuleType from "../../../Types/Team/ComplianceRuleType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The team compliance rule catalog (Types/Team/ComplianceRule.ts) is read by
 * three parties that must never disagree: the settings service (what a rule
 * may carry), the ee server (how a rule is evaluated and which reason a
 * member gets) and the Dashboard (how a rule is offered, titled and
 * described). So this pins:
 *
 *  - the stored enum values, which rows in the database already hold;
 *  - that every rule type and channel has exactly one definition, in the
 *    order the Dashboard offers them, with the shape its category needs;
 *  - that the catalog matches the models it talks about - one channel per
 *    method a UserNotificationRule can point at, and "has a verification
 *    step" exactly where the method table has an isVerified column;
 *  - every lookup and predicate, per rule type;
 *  - the exact titles and sentences, since they are what a user reads;
 *  - that the catalog stays pure, because it is bundled into the Dashboard.
 */

const ON_CALL_RULE_TYPES: Array<ComplianceRuleType> = [
  ComplianceRuleType.HasIncidentOnCallRules,
  ComplianceRuleType.HasAlertOnCallRules,
  ComplianceRuleType.HasIncidentEpisodeOnCallRules,
  ComplianceRuleType.HasAlertEpisodeOnCallRules,
];

const METHOD_RULE_TYPES: Array<ComplianceRuleType> = [
  ComplianceRuleType.HasNotificationCallMethod,
  ComplianceRuleType.HasNotificationSMSMethod,
  ComplianceRuleType.HasNotificationPushMethod,
  ComplianceRuleType.HasNotificationEmailMethod,
  ComplianceRuleType.HasNotificationWhatsAppMethod,
  ComplianceRuleType.HasNotificationTelegramMethod,
  ComplianceRuleType.HasNotificationSlackMethod,
  ComplianceRuleType.HasNotificationMicrosoftTeamsMethod,
  ComplianceRuleType.HasNotificationWebhookMethod,
];

const ALL_CHANNELS: Array<ComplianceNotificationChannel> = Object.values(
  ComplianceNotificationChannel,
);

type ModelType = { new (): BaseModel };

interface ChannelExpectation {
  channel: ComplianceNotificationChannel;
  label: string;
  methodNoun: string;
  hasVerification: boolean;
  methodRuleType: ComplianceRuleType;
  // The table a member's method on this channel lives in.
  methodModel: ModelType;
  // The sentence the method rule for this channel describes itself with.
  methodSentence: string;
}

const CHANNELS: Array<ChannelExpectation> = [
  {
    channel: ComplianceNotificationChannel.Call,
    label: "Call",
    methodNoun: "phone number for calls",
    hasVerification: true,
    methodRuleType: ComplianceRuleType.HasNotificationCallMethod,
    methodModel: UserCall,
    methodSentence: "Every member has a verified phone number for calls.",
  },
  {
    channel: ComplianceNotificationChannel.SMS,
    label: "SMS",
    methodNoun: "phone number for SMS",
    hasVerification: true,
    methodRuleType: ComplianceRuleType.HasNotificationSMSMethod,
    methodModel: UserSMS,
    methodSentence: "Every member has a verified phone number for SMS.",
  },
  {
    channel: ComplianceNotificationChannel.Push,
    label: "Push notification",
    methodNoun: "push notification device",
    hasVerification: true,
    methodRuleType: ComplianceRuleType.HasNotificationPushMethod,
    methodModel: UserPush,
    methodSentence: "Every member has a verified push notification device.",
  },
  {
    channel: ComplianceNotificationChannel.Email,
    label: "Email",
    methodNoun: "email address",
    hasVerification: true,
    methodRuleType: ComplianceRuleType.HasNotificationEmailMethod,
    methodModel: UserEmail,
    methodSentence: "Every member has a verified email address.",
  },
  {
    channel: ComplianceNotificationChannel.WhatsApp,
    label: "WhatsApp",
    methodNoun: "WhatsApp number",
    hasVerification: true,
    methodRuleType: ComplianceRuleType.HasNotificationWhatsAppMethod,
    methodModel: UserWhatsApp,
    methodSentence: "Every member has a verified WhatsApp number.",
  },
  {
    channel: ComplianceNotificationChannel.Telegram,
    label: "Telegram",
    methodNoun: "Telegram account",
    hasVerification: true,
    methodRuleType: ComplianceRuleType.HasNotificationTelegramMethod,
    methodModel: UserTelegram,
    methodSentence: "Every member has a verified Telegram account.",
  },
  {
    channel: ComplianceNotificationChannel.Slack,
    label: "Slack",
    methodNoun: "Slack account",
    hasVerification: true,
    methodRuleType: ComplianceRuleType.HasNotificationSlackMethod,
    methodModel: UserSlack,
    methodSentence: "Every member has a verified Slack account.",
  },
  {
    channel: ComplianceNotificationChannel.MicrosoftTeams,
    label: "Microsoft Teams",
    methodNoun: "Microsoft Teams account",
    hasVerification: true,
    methodRuleType: ComplianceRuleType.HasNotificationMicrosoftTeamsMethod,
    methodModel: UserMicrosoftTeams,
    methodSentence: "Every member has a verified Microsoft Teams account.",
  },
  {
    channel: ComplianceNotificationChannel.Webhook,
    label: "Webhook",
    methodNoun: "webhook",
    hasVerification: false,
    methodRuleType: ComplianceRuleType.HasNotificationWebhookMethod,
    methodModel: UserWebhook,
    // A webhook has no verification step, so the sentence does not ask for one.
    methodSentence: "Every member has a webhook notification method.",
  },
];

interface OnCallExpectation {
  ruleType: ComplianceRuleType;
  notificationRuleType: NotificationRuleType;
  severityKind: ComplianceSeverityKind;
  subject: string;
  title: string;
}

const ON_CALL_RULES: Array<OnCallExpectation> = [
  {
    ruleType: ComplianceRuleType.HasIncidentOnCallRules,
    notificationRuleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityKind: ComplianceSeverityKind.Incident,
    subject: "incident",
    title: "Incident on-call rules",
  },
  {
    ruleType: ComplianceRuleType.HasAlertOnCallRules,
    notificationRuleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    severityKind: ComplianceSeverityKind.Alert,
    subject: "alert",
    title: "Alert on-call rules",
  },
  {
    ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
    notificationRuleType:
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    severityKind: ComplianceSeverityKind.Incident,
    subject: "incident episode",
    title: "Incident episode on-call rules",
  },
  {
    ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
    notificationRuleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    severityKind: ComplianceSeverityKind.Alert,
    subject: "alert episode",
    title: "Alert episode on-call rules",
  },
];

const definitionOf: (
  ruleType: ComplianceRuleType,
) => ComplianceRuleDefinition = (
  ruleType: ComplianceRuleType,
): ComplianceRuleDefinition => {
  const definition: ComplianceRuleDefinition | undefined =
    ComplianceRule.getDefinition(ruleType);

  expect(definition).toBeDefined();

  return definition!;
};

const NOT_RULE_TYPES: Array<[string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["an empty string", ""],
  ["a free-text rule of old", "RequireTwoFactorAuth"],
  ["a value in the wrong case", "hasincidentoncallrules"],
  ["a channel", "Call"],
  ["a number", 1],
  ["an object", { ruleType: "HasIncidentOnCallRules" }],
  ["a prototype key", "constructor"],
];

describe("ComplianceRuleType and ComplianceNotificationChannel - stored values", () => {
  test("every rule type is stored as its own name, and the list is exactly these thirteen", () => {
    expect(Object.entries(ComplianceRuleType)).toEqual([
      ["HasNotificationEmailMethod", "HasNotificationEmailMethod"],
      ["HasNotificationSMSMethod", "HasNotificationSMSMethod"],
      ["HasNotificationCallMethod", "HasNotificationCallMethod"],
      ["HasNotificationPushMethod", "HasNotificationPushMethod"],
      ["HasNotificationWhatsAppMethod", "HasNotificationWhatsAppMethod"],
      ["HasNotificationTelegramMethod", "HasNotificationTelegramMethod"],
      ["HasNotificationSlackMethod", "HasNotificationSlackMethod"],
      [
        "HasNotificationMicrosoftTeamsMethod",
        "HasNotificationMicrosoftTeamsMethod",
      ],
      ["HasNotificationWebhookMethod", "HasNotificationWebhookMethod"],
      ["HasIncidentOnCallRules", "HasIncidentOnCallRules"],
      ["HasAlertOnCallRules", "HasAlertOnCallRules"],
      ["HasIncidentEpisodeOnCallRules", "HasIncidentEpisodeOnCallRules"],
      ["HasAlertEpisodeOnCallRules", "HasAlertEpisodeOnCallRules"],
    ]);
  });

  test("every channel is stored as its own name", () => {
    expect(Object.entries(ComplianceNotificationChannel)).toEqual([
      ["Call", "Call"],
      ["SMS", "SMS"],
      ["Push", "Push"],
      ["Email", "Email"],
      ["WhatsApp", "WhatsApp"],
      ["Telegram", "Telegram"],
      ["Slack", "Slack"],
      ["MicrosoftTeams", "MicrosoftTeams"],
      ["Webhook", "Webhook"],
    ]);
  });

  test("every channel fits the notificationChannel column (varchar 100)", () => {
    for (const channel of ALL_CHANNELS) {
      expect(channel.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("COMPLIANCE_RULE_DEFINITIONS - the catalog", () => {
  test("has exactly one definition per rule type", () => {
    const ruleTypes: Array<string> = COMPLIANCE_RULE_DEFINITIONS.map(
      (definition: ComplianceRuleDefinition): string => {
        return definition.ruleType;
      },
    );

    expect(new Set(ruleTypes).size).toBe(ruleTypes.length);
    expect([...ruleTypes].sort()).toEqual(
      Object.values(ComplianceRuleType).sort(),
    );
  });

  test("offers the on-call rules first, then the method rules, in this order", () => {
    expect(
      COMPLIANCE_RULE_DEFINITIONS.map(
        (definition: ComplianceRuleDefinition): ComplianceRuleType => {
          return definition.ruleType;
        },
      ),
    ).toEqual([...ON_CALL_RULE_TYPES, ...METHOD_RULE_TYPES]);
  });

  test("the method rules follow the channel order", () => {
    const methodChannels: Array<ComplianceNotificationChannel | undefined> =
      COMPLIANCE_RULE_DEFINITIONS.filter(
        (definition: ComplianceRuleDefinition): boolean => {
          return (
            definition.category === ComplianceRuleCategory.NotificationMethod
          );
        },
      ).map(
        (
          definition: ComplianceRuleDefinition,
        ): ComplianceNotificationChannel | undefined => {
          return definition.methodChannel;
        },
      );

    expect(methodChannels).toEqual(ALL_CHANNELS);
  });

  test("every definition has a title and a one-sentence description, and no two titles are the same", () => {
    const titles: Array<string> = [];

    for (const definition of COMPLIANCE_RULE_DEFINITIONS) {
      expect(definition.title.trim()).toBe(definition.title);
      expect(definition.title.length).toBeGreaterThan(0);
      expect(definition.description.trim()).toBe(definition.description);
      expect(definition.description.endsWith(".")).toBe(true);
      titles.push(definition.title);
    }

    expect(new Set(titles).size).toBe(titles.length);
  });

  test.each(ON_CALL_RULES)(
    "$ruleType is an on-call rule on '$notificationRuleType', scoped by $severityKind severities",
    (expected: OnCallExpectation) => {
      const definition: ComplianceRuleDefinition = definitionOf(
        expected.ruleType,
      );

      expect(definition).toEqual({
        ruleType: expected.ruleType,
        category: ComplianceRuleCategory.OnCallRule,
        title: expected.title,
        description: `Members are notified when an ${expected.subject} on-call policy pages them - for the severities and channel you choose.`,
        notificationRuleType: expected.notificationRuleType,
        severityKind: expected.severityKind,
        subject: expected.subject,
      });
      expect(definition.methodChannel).toBeUndefined();
    },
  );

  test.each(CHANNELS)(
    "the $channel method rule is $methodRuleType and carries no on-call options",
    (expected: ChannelExpectation) => {
      const definition: ComplianceRuleDefinition = definitionOf(
        expected.methodRuleType,
      );

      expect(definition.category).toBe(
        ComplianceRuleCategory.NotificationMethod,
      );
      expect(definition.methodChannel).toBe(expected.channel);
      expect(definition.notificationRuleType).toBeUndefined();
      expect(definition.severityKind).toBeUndefined();
      expect(definition.subject).toBeUndefined();
    },
  );

  test("each on-call notification rule type is checked by exactly one compliance rule", () => {
    const used: Array<NotificationRuleType | undefined> =
      COMPLIANCE_RULE_DEFINITIONS.filter(
        (definition: ComplianceRuleDefinition): boolean => {
          return definition.category === ComplianceRuleCategory.OnCallRule;
        },
      ).map(
        (
          definition: ComplianceRuleDefinition,
        ): NotificationRuleType | undefined => {
          return definition.notificationRuleType;
        },
      );

    expect([...used].sort()).toEqual(
      [
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      ].sort(),
    );
    // Going on or off call has no severity and pages nobody.
    expect(used).not.toContain(NotificationRuleType.WHEN_USER_GOES_ON_CALL);
    expect(used).not.toContain(NotificationRuleType.WHEN_USER_GOES_OFF_CALL);
  });

  test("the severity kind always matches the notification rule type's own kind", () => {
    for (const definition of COMPLIANCE_RULE_DEFINITIONS) {
      if (definition.category !== ComplianceRuleCategory.OnCallRule) {
        continue;
      }

      const isAlert: boolean = (definition.notificationRuleType || "")
        .toLowerCase()
        .includes("alert");

      expect({
        ruleType: definition.ruleType,
        severityKind: definition.severityKind,
      }).toEqual({
        ruleType: definition.ruleType,
        severityKind: isAlert
          ? ComplianceSeverityKind.Alert
          : ComplianceSeverityKind.Incident,
      });
    }
  });
});

describe("COMPLIANCE_CHANNEL_DEFINITIONS - the channels", () => {
  test("has exactly one definition per channel, in the enum's order", () => {
    expect(
      COMPLIANCE_CHANNEL_DEFINITIONS.map(
        (
          definition: ComplianceChannelDefinition,
        ): ComplianceNotificationChannel => {
          return definition.channel;
        },
      ),
    ).toEqual(ALL_CHANNELS);
  });

  test.each(CHANNELS)(
    "$channel reads as '$label', asks for a '$methodNoun'",
    (expected: ChannelExpectation) => {
      expect(ComplianceRule.getChannelDefinition(expected.channel)).toEqual({
        channel: expected.channel,
        label: expected.label,
        methodNoun: expected.methodNoun,
        hasVerification: expected.hasVerification,
      });
    },
  );

  test.each(CHANNELS)(
    "$channel maps back to its method rule, $methodRuleType",
    (expected: ChannelExpectation) => {
      expect(ComplianceRule.getMethodRuleTypeForChannel(expected.channel)).toBe(
        expected.methodRuleType,
      );
      expect(definitionOf(expected.methodRuleType).methodChannel).toBe(
        expected.channel,
      );
    },
  );

  test("only a webhook skips verification", () => {
    expect(
      COMPLIANCE_CHANNEL_DEFINITIONS.filter(
        (definition: ComplianceChannelDefinition): boolean => {
          return !definition.hasVerification;
        },
      ).map(
        (
          definition: ComplianceChannelDefinition,
        ): ComplianceNotificationChannel => {
          return definition.channel;
        },
      ),
    ).toEqual([ComplianceNotificationChannel.Webhook]);
  });

  test("an unknown channel has no method rule", () => {
    expect(
      ComplianceRule.getMethodRuleTypeForChannel(
        "Pager" as ComplianceNotificationChannel,
      ),
    ).toBeUndefined();
  });
});

describe("the catalog matches the notification models", () => {
  test.each(CHANNELS)(
    "$channel: 'has a verification step' is exactly whether its method table has isVerified",
    (expected: ChannelExpectation) => {
      /*
       * The server asks for isVerified: true on every channel that has the
       * column, and for mere existence on the one that does not. A channel
       * that claimed verification without the column would never pass.
       */
      const columns: Array<string> =
        new expected.methodModel().getTableColumns().columns;

      expect({
        channel: expected.channel,
        hasIsVerified: columns.includes("isVerified"),
      }).toEqual({
        channel: expected.channel,
        hasIsVerified: expected.hasVerification,
      });
      expect(columns).toContain("userId");
      expect(columns).toContain("projectId");
    },
  );

  test("a notification rule can point at exactly the methods the channels name - no more, no fewer", () => {
    /*
     * "Did the member set up a Telegram rule for Critical incidents" needs a
     * channel for Telegram. If UserNotificationRule gains a tenth method, a
     * channel has to be added with it, or members relying on that method are
     * reported as unreachable.
     */
    const rule: UserNotificationRule = new UserNotificationRule();
    const infrastructure: Array<ModelType> = [
      Project,
      User,
      IncidentSeverity,
      AlertSeverity,
    ];

    const methodModels: Array<string> = rule
      .getTableColumns()
      .columns.map((column: string): TableColumnMetadata => {
        return rule.getTableColumnMetadata(column);
      })
      .filter((metadata: TableColumnMetadata): boolean => {
        return (
          metadata.type === TableColumnType.Entity &&
          Boolean(metadata.modelType) &&
          !infrastructure.includes(metadata.modelType as ModelType)
        );
      })
      .map((metadata: TableColumnMetadata): string => {
        return (metadata.modelType as ModelType).name;
      })
      .sort();

    expect(methodModels).toEqual(
      CHANNELS.map((expected: ChannelExpectation): string => {
        return expected.methodModel.name;
      }).sort(),
    );
  });
});

describe("ComplianceRule - lookups and predicates", () => {
  test.each(Object.values(ComplianceRuleType))(
    "%s is known and has its definition",
    (ruleType: ComplianceRuleType) => {
      expect(ComplianceRule.isKnownRuleType(ruleType)).toBe(true);
      expect(ComplianceRule.getDefinition(ruleType)?.ruleType).toBe(ruleType);
    },
  );

  test.each(NOT_RULE_TYPES)(
    "%s is not a rule type",
    (_label: string, value: unknown) => {
      expect(ComplianceRule.isKnownRuleType(value)).toBe(false);
      expect(
        ComplianceRule.getDefinition(value as string | undefined),
      ).toBeUndefined();
    },
  );

  test.each(ALL_CHANNELS)("%s is a known channel", (channel: string) => {
    expect(ComplianceRule.isKnownChannel(channel)).toBe(true);
    expect(ComplianceRule.getChannelDefinition(channel)?.channel).toBe(channel);
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["an unknown channel", "Pager"],
    ["a channel in the wrong case", "call"],
    ["a label rather than a value", "Microsoft Teams"],
    ["a number", 3],
  ])("%s is not a channel", (_label: string, value: unknown) => {
    expect(ComplianceRule.isKnownChannel(value)).toBe(false);
    expect(
      ComplianceRule.getChannelDefinition(value as string | undefined),
    ).toBeUndefined();
  });

  test.each(ON_CALL_RULES)(
    "$ruleType takes a channel and a $severityKind severity scope",
    (expected: OnCallExpectation) => {
      expect(ComplianceRule.isOnCallRule(expected.ruleType)).toBe(true);
      expect(ComplianceRule.supportsChannel(expected.ruleType)).toBe(true);
      expect(ComplianceRule.supportsSeverityScope(expected.ruleType)).toBe(
        true,
      );
      expect(ComplianceRule.getSeverityKind(expected.ruleType)).toBe(
        expected.severityKind,
      );
    },
  );

  test.each(METHOD_RULE_TYPES)(
    "%s takes neither a channel nor a severity scope",
    (ruleType: ComplianceRuleType) => {
      expect(ComplianceRule.isOnCallRule(ruleType)).toBe(false);
      expect(ComplianceRule.supportsChannel(ruleType)).toBe(false);
      expect(ComplianceRule.supportsSeverityScope(ruleType)).toBe(false);
      expect(ComplianceRule.getSeverityKind(ruleType)).toBeUndefined();
    },
  );

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an unknown rule type", "RequireTwoFactorAuth"],
  ])(
    "%s takes nothing, and has no severity kind",
    (_label: string, value: string | null | undefined) => {
      expect(ComplianceRule.isOnCallRule(value)).toBe(false);
      expect(ComplianceRule.supportsChannel(value)).toBe(false);
      expect(ComplianceRule.supportsSeverityScope(value)).toBe(false);
      expect(ComplianceRule.getSeverityKind(value)).toBeUndefined();
    },
  );
});

describe("ComplianceRule.getTitle", () => {
  test.each(ON_CALL_RULES)(
    "$ruleType with no channel is '$title'",
    (expected: OnCallExpectation) => {
      expect(ComplianceRule.getTitle({ ruleType: expected.ruleType })).toBe(
        expected.title,
      );
      expect(
        ComplianceRule.getTitle({
          ruleType: expected.ruleType,
          notificationChannel: null,
        }),
      ).toBe(expected.title);
    },
  );

  test.each([
    [
      ComplianceRuleType.HasIncidentOnCallRules,
      ComplianceNotificationChannel.Call,
      "Call for incidents",
    ],
    [
      ComplianceRuleType.HasAlertOnCallRules,
      ComplianceNotificationChannel.Push,
      "Push notification for alerts",
    ],
    [
      ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      ComplianceNotificationChannel.SMS,
      "SMS for incident episodes",
    ],
    [
      ComplianceRuleType.HasAlertEpisodeOnCallRules,
      ComplianceNotificationChannel.MicrosoftTeams,
      "Microsoft Teams for alert episodes",
    ],
    [
      ComplianceRuleType.HasIncidentOnCallRules,
      ComplianceNotificationChannel.Webhook,
      "Webhook for incidents",
    ],
  ])(
    "%s on %s is '%s'",
    (
      ruleType: ComplianceRuleType,
      channel: ComplianceNotificationChannel,
      title: string,
    ) => {
      expect(
        ComplianceRule.getTitle({
          ruleType: ruleType,
          notificationChannel: channel,
        }),
      ).toBe(title);
    },
  );

  test("every on-call rule on every channel is titled '<channel label> for <subject>s'", () => {
    for (const expected of ON_CALL_RULES) {
      for (const channel of CHANNELS) {
        expect(
          ComplianceRule.getTitle({
            ruleType: expected.ruleType,
            notificationChannel: channel.channel,
          }),
        ).toBe(`${channel.label} for ${expected.subject}s`);
      }
    }
  });

  test("an on-call rule with an unknown channel keeps its plain title", () => {
    expect(
      ComplianceRule.getTitle({
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannel: "Pager",
      }),
    ).toBe("Alert on-call rules");
  });

  test.each(METHOD_RULE_TYPES)(
    "%s is titled by the catalog, whatever channel it carries",
    (ruleType: ComplianceRuleType) => {
      const title: string = definitionOf(ruleType).title;

      expect(ComplianceRule.getTitle({ ruleType: ruleType })).toBe(title);
      expect(
        ComplianceRule.getTitle({
          ruleType: ruleType,
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
      ).toBe(title);
    },
  );

  test("the method rule titles are the catalog's", () => {
    expect(
      METHOD_RULE_TYPES.map((ruleType: ComplianceRuleType): string => {
        return ComplianceRule.getTitle({ ruleType: ruleType });
      }),
    ).toEqual([
      "Verified phone for calls",
      "Verified phone for SMS",
      "Verified push device",
      "Verified email",
      "Verified WhatsApp",
      "Verified Telegram",
      "Verified Slack",
      "Verified Microsoft Teams",
      "Webhook configured",
    ]);
  });

  test("an unknown rule type is shown as stored, so the row still says something", () => {
    expect(
      ComplianceRule.getTitle({
        ruleType: "RequireTwoFactorAuth",
        notificationChannel: ComplianceNotificationChannel.Call,
      }),
    ).toBe("RequireTwoFactorAuth");
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["empty", ""],
  ])(
    "a %s rule type is 'Unknown rule'",
    (_label: string, value: string | null | undefined) => {
      expect(ComplianceRule.getTitle({ ruleType: value })).toBe("Unknown rule");
    },
  );
});

describe("ComplianceRule.describe", () => {
  test.each(CHANNELS)(
    "the $channel method rule reads '$methodSentence'",
    (expected: ChannelExpectation) => {
      expect(
        ComplianceRule.describe({ ruleType: expected.methodRuleType }),
      ).toBe(expected.methodSentence);
    },
  );

  test("a method rule ignores a channel and severities it does not take", () => {
    expect(
      ComplianceRule.describe({
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        notificationChannel: ComplianceNotificationChannel.Call,
        severityNames: ["Critical"],
      }),
    ).toBe("Every member has a verified email address.");
  });

  test.each<[ComplianceRuleType, string]>([
    [
      ComplianceRuleType.HasIncidentOnCallRules,
      "Every member has an incident on-call rule for every incident severity.",
    ],
    [
      ComplianceRuleType.HasAlertOnCallRules,
      "Every member has an alert on-call rule for every alert severity.",
    ],
    [
      ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      "Every member has an incident episode on-call rule for every incident episode severity.",
    ],
    [
      ComplianceRuleType.HasAlertEpisodeOnCallRules,
      "Every member has an alert episode on-call rule for every alert episode severity.",
    ],
  ])(
    "%s on any channel for every severity: '%s'",
    (ruleType: ComplianceRuleType, sentence: string) => {
      expect(ComplianceRule.describe({ ruleType: ruleType })).toBe(sentence);
      expect(
        ComplianceRule.describe({
          ruleType: ruleType,
          notificationChannel: null,
          severityNames: [],
        }),
      ).toBe(sentence);
    },
  );

  test.each<[Array<string>, string]>([
    [["Critical"], "Every member has an incident on-call rule for Critical."],
    [
      ["Critical", "Major"],
      "Every member has an incident on-call rule for Critical and Major.",
    ],
    [
      ["Critical", "Major", "Minor"],
      "Every member has an incident on-call rule for Critical, Major and Minor.",
    ],
  ])("names %j as prose", (severityNames: Array<string>, sentence: string) => {
    expect(
      ComplianceRule.describe({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        severityNames: severityNames,
      }),
    ).toBe(sentence);
  });

  test("the channel is named when the rule insists on one - the example the catalog documents", () => {
    expect(
      ComplianceRule.describe({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        severityNames: ["Critical Incident", "Major Incident"],
      }),
    ).toBe(
      "Every member has an incident on-call rule that notifies them by Call for Critical Incident and Major Incident.",
    );
  });

  test.each<
    [ComplianceRuleType, ComplianceNotificationChannel, Array<string>, string]
  >([
    [
      ComplianceRuleType.HasAlertOnCallRules,
      ComplianceNotificationChannel.Push,
      [],
      "Every member has an alert on-call rule that notifies them by Push notification for every alert severity.",
    ],
    [
      ComplianceRuleType.HasAlertEpisodeOnCallRules,
      ComplianceNotificationChannel.Webhook,
      ["P1"],
      "Every member has an alert episode on-call rule that notifies them by Webhook for P1.",
    ],
    [
      ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      ComplianceNotificationChannel.MicrosoftTeams,
      ["Sev 1", "Sev 2", "Sev 3"],
      "Every member has an incident episode on-call rule that notifies them by Microsoft Teams for Sev 1, Sev 2 and Sev 3.",
    ],
  ])(
    "%s on %s for %j",
    (
      ruleType: ComplianceRuleType,
      channel: ComplianceNotificationChannel,
      severityNames: Array<string>,
      sentence: string,
    ) => {
      expect(
        ComplianceRule.describe({
          ruleType: ruleType,
          notificationChannel: channel,
          severityNames: severityNames,
        }),
      ).toBe(sentence);
    },
  );

  test("an unknown channel reads as 'any channel'", () => {
    expect(
      ComplianceRule.describe({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: "Pager",
        severityNames: ["Critical"],
      }),
    ).toBe("Every member has an incident on-call rule for Critical.");
  });

  test("every rule, on every channel, reads as one sentence about every member", () => {
    for (const ruleType of Object.values(ComplianceRuleType)) {
      for (const channel of [null, ...ALL_CHANNELS]) {
        for (const severityNames of [[], ["A"], ["A", "B"]]) {
          const sentence: string = ComplianceRule.describe({
            ruleType: ruleType,
            notificationChannel: channel,
            severityNames: severityNames,
          });

          expect(sentence.startsWith("Every member has ")).toBe(true);
          expect(sentence.endsWith(".")).toBe(true);
          expect(sentence.endsWith("..")).toBe(false);
          expect(sentence).not.toContain("  ");
          expect(sentence).not.toContain("undefined");
          // "an incident", never "a incident" - nor "an verified".
          expect(sentence).not.toMatch(/\ba [aeiou]/);
          expect(sentence).not.toMatch(/\ban [b-df-hj-np-tv-z]/);
        }
      }
    }
  });

  test.each([
    [
      "an unknown rule type",
      "RequireTwoFactorAuth",
      'Unknown compliance rule "RequireTwoFactorAuth".',
    ],
    ["a missing rule type", undefined, 'Unknown compliance rule "".'],
    ["a null rule type", null, 'Unknown compliance rule "".'],
  ])(
    "%s is described as unknown",
    (_label: string, ruleType: string | null | undefined, sentence: string) => {
      expect(
        ComplianceRule.describe({
          ruleType: ruleType,
          notificationChannel: ComplianceNotificationChannel.Call,
          severityNames: ["Critical"],
        }),
      ).toBe(sentence);
    },
  );
});

describe("joinAsProse", () => {
  test.each<[Array<string>, string]>([
    [[], ""],
    [["Critical"], "Critical"],
    [["Critical", "Major"], "Critical and Major"],
    [["Critical", "Major", "Minor"], "Critical, Major and Minor"],
    [["P1", "P2", "P3", "P4"], "P1, P2, P3 and P4"],
  ])("%j reads as %j", (items: Array<string>, prose: string) => {
    expect(joinAsProse(items)).toBe(prose);
  });

  test("does not change the list it is given", () => {
    const items: Array<string> = ["Critical", "Major", "Minor"];

    joinAsProse(items);

    expect(items).toEqual(["Critical", "Major", "Minor"]);
  });
});

describe("the compliance types stay pure", () => {
  /*
   * ComplianceRule.ts, the enums and the wire contract are bundled into the
   * Dashboard. Importing anything from Server/ or Models/ there would drag
   * the server (or TypeORM) into the browser bundle.
   */
  const TEAM_TYPES_DIRECTORY: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Types",
    "Team",
  );

  type ImportsOfFunction = (fileName: string) => Array<string>;

  const importsOf: ImportsOfFunction = (fileName: string): Array<string> => {
    const source: string = fs.readFileSync(
      path.join(TEAM_TYPES_DIRECTORY, fileName),
      "utf8",
    );

    const importPattern: RegExp = /^(?:import|export)[^;]*?from\s+"([^"]+)";/gm;
    const specifiers: Array<string> = [];
    let match: RegExpExecArray | null = importPattern.exec(source);

    while (match) {
      specifiers.push(match[1]!);
      match = importPattern.exec(source);
    }

    return specifiers;
  };

  test("the import scan sees the catalog's imports, multi-line ones included", () => {
    expect(importsOf("ComplianceRule.ts").sort()).toEqual(
      [
        "./ComplianceNotificationChannel",
        "./ComplianceRuleType",
        "../NotificationRule/NotificationRuleType",
      ].sort(),
    );
    expect(importsOf("TeamComplianceStatus.ts")).toContain("./ComplianceRule");
  });

  test.each([
    "ComplianceRule.ts",
    "ComplianceRuleType.ts",
    "ComplianceNotificationChannel.ts",
    "TeamComplianceStatus.ts",
  ])("%s imports only other types", (fileName: string) => {
    for (const specifier of importsOf(fileName)) {
      expect({
        fileName,
        specifier,
        relative: specifier.startsWith("."),
      }).toEqual({ fileName, specifier, relative: true });

      const resolved: string = path.resolve(TEAM_TYPES_DIRECTORY, specifier);
      const typesRoot: string = path.dirname(TEAM_TYPES_DIRECTORY);

      expect({
        fileName,
        specifier,
        insideTypes: resolved.startsWith(typesRoot + path.sep),
      }).toEqual({ fileName, specifier, insideTypes: true });
    }
  });
});
