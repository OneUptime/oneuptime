import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import UserOnCallLog from "../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../Models/DatabaseModels/UserOnCallLogTimeline";
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
      expect(reference.onDelete).toBe("SET NULL");

      // SET NULL needs a column that can be empty: the one it joins on.
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

  test("a person stays when their picture's file is deleted (issue #9069)", () => {
    const picture: Array<Reference> = referencesFrom([User]).filter(
      (reference: Reference): boolean => {
        return reference.name === "User.profilePictureFile";
      },
    );

    expect(
      picture.map((reference: Reference) => {
        return reference.onDelete;
      }),
    ).toEqual(["SET NULL"]);
  });
});
