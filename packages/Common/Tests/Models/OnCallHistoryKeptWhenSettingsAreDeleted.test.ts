import CallLog from "../../Models/DatabaseModels/CallLog";
import EmailLog from "../../Models/DatabaseModels/EmailLog";
import File from "../../Models/DatabaseModels/File";
import Entities from "../../Models/DatabaseModels/Index";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import PushNotificationLog from "../../Models/DatabaseModels/PushNotificationLog";
import SmsLog from "../../Models/DatabaseModels/SmsLog";
import Team from "../../Models/DatabaseModels/Team";
import TelegramLog from "../../Models/DatabaseModels/TelegramLog";
import User from "../../Models/DatabaseModels/User";
import UserOnCallLog from "../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import WebhookLog from "../../Models/DatabaseModels/WebhookLog";
import WhatsAppLog from "../../Models/DatabaseModels/WhatsAppLog";
import WorkspaceNotificationLog from "../../Models/DatabaseModels/WorkspaceNotificationLog";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * ON-CALL HISTORY IS NOT DELETED WITH THE SETTINGS IT NAMES (issue #9036).
 *
 * A run, its timeline, each person's page and that page's timeline name
 * the escalation rules, schedules and teams that paged, and the people who
 * were paged, covered for and acknowledged. Every one of those references
 * clears itself when the setting goes (ON DELETE SET NULL) and the row
 * stays: removing a level of a policy used to remove every run that last
 * reached it, with its timeline, and a run paging on it at that moment.
 * This holds every such relation - one added later too - to that.
 *
 * Two kinds are left to cascade, on purpose:
 *   - a person's own page and its timeline (UserOnCallLog.userId,
 *     UserOnCallLogTimeline.userId) go with their account - their personal
 *     record; the run's own line about them stays, the person cleared;
 *   - a run is owned through its policy (@OwnedThrough), and one with no
 *     policy is a direct page to every reader of it: deleting a policy
 *     deletes its runs. Archive keeps a policy's history.
 *
 * The notification delivery logs - each message an on-call page sent, by
 * call, email, push, SMS, Telegram, webhook, WhatsApp or workspace - name
 * the rule, schedule and team it went out through the same way, and keep
 * their rows the same way.
 *
 * And a picture's file (issue #9069): deleting it clears the picture, and
 * keeps the person, status page, dashboard, form, probe or AI agent that
 * showed it.
 */

type ModelClass = new () => unknown;

const HISTORY: Array<ModelClass> = [
  OnCallDutyPolicyExecutionLog,
  OnCallDutyPolicyExecutionLogTimeline,
  UserOnCallLog,
  UserOnCallLogTimeline,
];

const SETTINGS: Array<ModelClass> = [
  OnCallDutyPolicyEscalationRule,
  OnCallDutyPolicySchedule,
  Team,
  User,
];

// A person's own page goes with their account.
const PERSONAL: Array<string> = [
  "UserOnCallLog.user",
  "UserOnCallLogTimeline.user",
];

interface Reference {
  name: string;
  target: ModelClass;
  onDelete: string | undefined;
  relation: RelationMetadataArgs;
}

function nameOf(model: unknown): string {
  return (model as { name: string }).name;
}

function referencesFrom(models: Array<ModelClass>): Array<Reference> {
  return getMetadataArgsStorage()
    .relations.filter((relation: RelationMetadataArgs): boolean => {
      return (
        relation.relationType === "many-to-one" &&
        models.includes(relation.target as ModelClass)
      );
    })
    .map((relation: RelationMetadataArgs): Reference => {
      return {
        name: `${nameOf(relation.target)}.${relation.propertyName}`,
        target: (relation.type as () => ModelClass)(),
        onDelete: relation.options?.onDelete,
        relation: relation,
      };
    });
}

const toSettings: Array<Reference> = referencesFrom(HISTORY).filter(
  (reference: Reference): boolean => {
    return SETTINGS.includes(reference.target);
  },
);

// SET NULL needs a column that can be empty: the one the relation joins on.
function expectClearsItself(reference: Reference): void {
  expect(reference.onDelete).toBe("SET NULL");

  const joinColumn: string | undefined =
    getMetadataArgsStorage().joinColumns.find(
      (candidate: { target: unknown; propertyName: string }): boolean => {
        return (
          candidate.target === reference.relation.target &&
          candidate.propertyName === reference.relation.propertyName
        );
      },
    )?.name;

  const column: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (candidate: ColumnMetadataArgs): boolean => {
        return (
          candidate.target === reference.relation.target &&
          candidate.propertyName === joinColumn
        );
      },
    );

  expect(joinColumn).toBeTruthy();
  expect(column?.options.nullable).toBe(true);
  expect(reference.relation.options?.nullable).not.toBe(false);
}

const DELIVERY_LOGS: Array<ModelClass> = [
  CallLog,
  EmailLog,
  PushNotificationLog,
  SmsLog,
  TelegramLog,
  WebhookLog,
  WhatsAppLog,
  WorkspaceNotificationLog,
];

// The on-call settings a delivery log names: not its person, nor its policy.
const ON_CALL_SETTINGS: Array<ModelClass> = [
  OnCallDutyPolicyEscalationRule,
  OnCallDutyPolicySchedule,
  Team,
];

const logsToSettings: Array<Reference> = referencesFrom(DELIVERY_LOGS).filter(
  (reference: Reference): boolean => {
    return ON_CALL_SETTINGS.includes(reference.target);
  },
);

// A picture, by its relation's name: a logo, a favicon, an icon, a cover.
const PICTURE: RegExp =
  /^(profilePicture|logo|darkThemeLogo|favicon|icon|coverImage)File$/;

const pictures: Array<Reference> = referencesFrom(
  Entities as unknown as Array<ModelClass>,
).filter((reference: Reference): boolean => {
  return (
    reference.target === File && PICTURE.test(reference.relation.propertyName)
  );
});

describe("on-call history and the settings it names", () => {
  test("finds the history's references to rules, schedules, teams and people (the checks below are not vacuous)", () => {
    expect(toSettings.length).toBeGreaterThanOrEqual(20);

    for (const target of SETTINGS) {
      expect(
        toSettings.some((reference: Reference): boolean => {
          return reference.target === target;
        }),
      ).toBe(true);
    }
  });

  test.each(
    toSettings
      .filter((reference: Reference): boolean => {
        return !PERSONAL.includes(reference.name);
      })
      .map((reference: Reference): [string, Reference] => {
        return [reference.name, reference];
      }),
  )(
    "%s clears itself when what it names is deleted, and keeps its row",
    (_name: string, reference: Reference) => {
      expectClearsItself(reference);
    },
  );

  test("a person's own page, and its timeline, go with their account", () => {
    const personal: Array<Reference> = toSettings.filter(
      (reference: Reference): boolean => {
        return PERSONAL.includes(reference.name);
      },
    );

    expect(
      personal.map((reference: Reference) => {
        return [reference.name, reference.onDelete];
      }),
    ).toEqual([
      ["UserOnCallLog.user", "CASCADE"],
      ["UserOnCallLogTimeline.user", "CASCADE"],
    ]);
  });

  test("deleting a policy still deletes its runs: they are owned through it", () => {
    const toPolicy: Array<Reference> = referencesFrom(HISTORY).filter(
      (reference: Reference): boolean => {
        return reference.target === OnCallDutyPolicy;
      },
    );

    expect(
      toPolicy.map((reference: Reference) => {
        return [reference.name, reference.onDelete];
      }),
    ).toEqual(
      HISTORY.map((model: ModelClass) => {
        return [`${nameOf(model)}.onCallDutyPolicy`, "CASCADE"];
      }),
    );
  });
});

describe("notification delivery logs and the on-call settings they name", () => {
  test("finds each log's rule, schedule and team (the checks below are not vacuous)", () => {
    expect(
      logsToSettings
        .map((reference: Reference): string => {
          return reference.name;
        })
        .sort(),
    ).toEqual(
      DELIVERY_LOGS.flatMap((model: ModelClass): Array<string> => {
        return [
          `${nameOf(model)}.onCallDutyPolicyEscalationRule`,
          `${nameOf(model)}.onCallDutyPolicySchedule`,
          `${nameOf(model)}.team`,
        ];
      }).sort(),
    );
  });

  test.each(
    logsToSettings.map((reference: Reference): [string, Reference] => {
      return [reference.name, reference];
    }),
  )(
    "%s clears itself when what it names is deleted, and keeps its row",
    (_name: string, reference: Reference) => {
      expectClearsItself(reference);
    },
  );
});

describe("a picture's file (issue #9069)", () => {
  test("finds every picture (the checks below are not vacuous)", () => {
    expect(
      pictures
        .map((reference: Reference): string => {
          return reference.name;
        })
        .sort(),
    ).toEqual(
      [
        "AIAgent.iconFile",
        "Dashboard.darkThemeLogoFile",
        "Dashboard.faviconFile",
        "Dashboard.logoFile",
        "Form.faviconFile",
        "Form.logoFile",
        "Probe.iconFile",
        "StatusPage.coverImageFile",
        "StatusPage.darkThemeLogoFile",
        "StatusPage.faviconFile",
        "StatusPage.logoFile",
        "User.profilePictureFile",
      ].sort(),
    );
  });

  test.each(
    pictures.map((reference: Reference): [string, Reference] => {
      return [reference.name, reference];
    }),
  )(
    "%s clears itself when its file is deleted, and keeps what showed it",
    (_name: string, reference: Reference) => {
      expectClearsItself(reference);
    },
  );
});
