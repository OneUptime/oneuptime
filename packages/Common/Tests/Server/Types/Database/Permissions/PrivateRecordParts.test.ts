import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import PrivateRecordPermission, {
  ALSO_PART_OF,
  PRIVATE_RECORD_KINDS,
  PrivateRecordColumn,
  PrivateRecordKind,
} from "../../../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { getMetadataArgsStorage } from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * EVERY KIND OF PRIVATE RECORD, AND EVERY PART OF ONE, IS HELD TO THE RULE.
 *
 * A private incident, alert or episode is seen only by its owners, and
 * changed only with the permissions of the teams that own it and of the
 * people named as its owners (PrivateRecordPermission). The rule names the
 * kinds' tables itself, as the privacy filters do, and reaches a part of
 * one - a note, an owner, a state change, a role - through the key the part
 * names it by. So here:
 *
 *   - the kinds are exactly the models that can be marked private, and each
 *     names the tables its model keeps its owners and labels in;
 *   - every part of a private record - every model read through one
 *     (@CanAccessIfCanReadOn) - is listed, names it by a key column, and is
 *     read only through the record's privacy filter: a part added to a kind
 *     is a part added here, and its service filters what it reads.
 */

const SERVICES_DIRECTORY: string = path.join(
  __dirname,
  "../../../../../Server/Services",
);

const modelName: (modelType: { new (): BaseModel }) => string = (modelType: {
  new (): BaseModel;
}): string => {
  return (modelType as unknown as { name: string }).name;
};

const modelOfTable: (tableName: string) => { new (): BaseModel } = (
  tableName: string,
): { new (): BaseModel } => {
  const found: { new (): BaseModel } | undefined = AllModelTypes.find(
    (modelType: { new (): BaseModel }): boolean => {
      return new modelType().tableName === tableName;
    },
  );

  if (!found) {
    throw new Error(`No model has the table ${tableName}.`);
  }

  return found;
};

/*
 * Every part of a private record, by model, with the key that names it. A
 * new one belongs here once its service reads it through the record's
 * privacy filter (checked below) - every write of it is held to the rule
 * already, by that key.
 */
const PARTS: Record<string, { kind: string; key: string }> = {
  AlertEpisodeFeed: { kind: "AlertEpisode", key: "alertEpisodeId" },
  AlertEpisodeInternalNote: { kind: "AlertEpisode", key: "alertEpisodeId" },
  AlertEpisodeMember: { kind: "Alert", key: "alertId" },
  AlertEpisodeOwnerTeam: { kind: "AlertEpisode", key: "alertEpisodeId" },
  AlertEpisodeOwnerUser: { kind: "AlertEpisode", key: "alertEpisodeId" },
  AlertEpisodeStateTimeline: { kind: "AlertEpisode", key: "alertEpisodeId" },
  AlertFeed: { kind: "Alert", key: "alertId" },
  AlertInternalNote: { kind: "Alert", key: "alertId" },
  AlertMeasurementValue: { kind: "Alert", key: "alertId" },
  AlertOwnerTeam: { kind: "Alert", key: "alertId" },
  AlertOwnerUser: { kind: "Alert", key: "alertId" },
  AlertStateTimeline: { kind: "Alert", key: "alertId" },
  AlertVideoCall: { kind: "Alert", key: "alertId" },
  IncidentAlert: { kind: "Incident", key: "incidentId" },
  IncidentEpisodeFeed: { kind: "IncidentEpisode", key: "incidentEpisodeId" },
  IncidentEpisodeInternalNote: {
    kind: "IncidentEpisode",
    key: "incidentEpisodeId",
  },
  IncidentEpisodeMember: { kind: "Incident", key: "incidentId" },
  IncidentEpisodeOwnerTeam: {
    kind: "IncidentEpisode",
    key: "incidentEpisodeId",
  },
  IncidentEpisodeOwnerUser: {
    kind: "IncidentEpisode",
    key: "incidentEpisodeId",
  },
  IncidentEpisodePublicNote: {
    kind: "IncidentEpisode",
    key: "incidentEpisodeId",
  },
  IncidentEpisodeRoleMember: {
    kind: "IncidentEpisode",
    key: "incidentEpisodeId",
  },
  IncidentEpisodeStateTimeline: {
    kind: "IncidentEpisode",
    key: "incidentEpisodeId",
  },
  IncidentFeed: { kind: "Incident", key: "incidentId" },
  IncidentInternalNote: { kind: "Incident", key: "incidentId" },
  IncidentMeasurementValue: { kind: "Incident", key: "incidentId" },
  IncidentMember: { kind: "Incident", key: "incidentId" },
  IncidentOwnerTeam: { kind: "Incident", key: "incidentId" },
  IncidentOwnerUser: { kind: "Incident", key: "incidentId" },
  IncidentPublicNote: { kind: "Incident", key: "incidentId" },
  IncidentSla: { kind: "Incident", key: "incidentId" },
  IncidentStateTimeline: { kind: "Incident", key: "incidentId" },
  IncidentVideoCall: { kind: "Incident", key: "incidentId" },
};

describe("the kinds of private record", () => {
  test("are exactly the models that can be marked private", () => {
    const privateModels: Array<string> = AllModelTypes.filter(
      (modelType: { new (): BaseModel }): boolean => {
        return Boolean(new modelType().getTableColumnMetadata("isPrivate"));
      },
    )
      .map((modelType: { new (): BaseModel }): string => {
        return new modelType().tableName || "";
      })
      .sort();

    expect(
      PRIVATE_RECORD_KINDS.map((kind: PrivateRecordKind): string => {
        return kind.tableName;
      }).sort(),
    ).toEqual(privateModels);
  });

  test.each([...PRIVATE_RECORD_KINDS])(
    "$tableName names the tables its model keeps its owners in",
    (kind: PrivateRecordKind) => {
      const pair: OwnerTablePair | undefined = OwnerTableRegistry.get(
        modelName(modelOfTable(kind.tableName)),
      );

      expect(pair).toBeDefined();
      expect(pair!.fkColumn).toBe(kind.ownerKey);
      expect(new pair!.ownerUserService.modelType().tableName).toBe(
        kind.ownerUserTable,
      );
      expect(new pair!.ownerTeamService.modelType().tableName).toBe(
        kind.ownerTeamTable,
      );

      // The owner rows name a person, and a team, by these columns.
      expect(
        new pair!.ownerUserService.modelType().getTableColumnMetadata(
          "userId",
        ),
      ).toBeDefined();
      expect(
        new pair!.ownerTeamService.modelType().getTableColumnMetadata(
          "teamId",
        ),
      ).toBeDefined();
    },
  );

  test.each([...PRIVATE_RECORD_KINDS])(
    "$tableName names the table its model keeps its labels in",
    (kind: PrivateRecordKind) => {
      const modelType: { new (): BaseModel } = modelOfTable(kind.tableName);
      const labelsColumn: string | null = new modelType().getAccessControlColumn();

      expect(labelsColumn).toBe("labels");

      const joinTable: JoinTableMetadataArgs | undefined =
        getMetadataArgsStorage().joinTables.find(
          (candidate: JoinTableMetadataArgs): boolean => {
            return (
              candidate.target === modelType &&
              candidate.propertyName === labelsColumn
            );
          },
        );

      expect(joinTable?.name).toBe(kind.labelTable);
      expect(joinTable?.joinColumns?.[0]?.name).toBe(kind.labelRecordKey);
      expect(joinTable?.inverseJoinColumns?.[0]?.name).toBe(kind.labelKey);
    },
  );
});

describe("every part of a private record", () => {
  const parts: Array<{ modelType: { new (): BaseModel }; column: PrivateRecordColumn }> =
    AllModelTypes.map((modelType: { new (): BaseModel }) => {
      return {
        modelType: modelType,
        column: PrivateRecordPermission.getPrivateRecordColumn(modelType),
      };
    })
      .filter(
        (entry: {
          modelType: { new (): BaseModel };
          column: PrivateRecordColumn | null;
        }): boolean => {
          return Boolean(entry.column && !entry.column.isRecord);
        },
      )
      .map(
        (entry: {
          modelType: { new (): BaseModel };
          column: PrivateRecordColumn | null;
        }) => {
          return {
            modelType: entry.modelType,
            column: entry.column!,
          };
        },
      );

  test("is listed, with the kind and the key it is a part of one by", () => {
    const found: Record<string, { kind: string; key: string }> = {};

    for (const part of parts) {
      found[modelName(part.modelType)] = {
        kind: part.column.kind.tableName,
        key: part.column.column,
      };
    }

    expect(found).toEqual(PARTS);
  });

  test.each(Object.keys(PARTS).map((name: string) => [name]))(
    "%s is read through its record by a key column of its own",
    (name: string) => {
      const modelType: { new (): BaseModel } = AllModelTypes.find(
        (candidate: { new (): BaseModel }): boolean => {
          return modelName(candidate) === name;
        },
      )!;
      const model: BaseModel = new modelType();
      const relation: TableColumnMetadata = model.getTableColumnMetadata(
        model.canAccessIfCanReadOn!,
      );

      expect(relation.type).toBe(TableColumnType.Entity);
      expect(relation.manyToOneRelationColumn).toBe(PARTS[name]!.key);
      expect(model.getTableColumnMetadata(PARTS[name]!.key)).toBeDefined();
    },
  );

  test.each(Object.keys(PARTS).map((name: string) => [name]))(
    "%s's service reads it only through its record's privacy filter",
    (name: string) => {
      const kind: string = PARTS[name]!.kind;
      const servicePath: string = path.join(
        SERVICES_DIRECTORY,
        `${name}Service.ts`,
      );

      expect(fs.existsSync(servicePath)).toBe(true);

      const source: string = fs.readFileSync(servicePath, "utf8");
      const filter: string = `apply${kind}RelatedRecordPrivacyFilter`;

      // A read, a count, and the filter of the record it is a part of.
      expect(source).toContain(filter);
      expect(source).toContain("onBeforeFind(");
      expect(source).toContain("countBy(");

      const findHook: string = source.slice(
        source.indexOf("onBeforeFind("),
        source.indexOf("onBeforeFind(") + 600,
      );
      const countHook: string = source.slice(
        source.indexOf("countBy("),
        source.indexOf("countBy(") + 600,
      );

      // Directly, or through a helper of the service's that applies it.
      for (const hook of [findHook, countHook]) {
        expect(
          hook.includes(filter) || hook.includes("applyPrivacyFilters("),
        ).toBe(true);
      }
    },
  );
});

/*
 * A part that names a second private record beside the one it is read
 * through - an episode's member row its episode, an incident's link to an
 * alert the alert - is as much a part of that one: its writes are held to
 * both (ALSO_PART_OF), and its service reads it through both privacy
 * filters.
 */
const ALSO_PARTS: Record<string, Array<{ kind: string; key: string }>> = {
  AlertEpisodeMember: [{ kind: "AlertEpisode", key: "alertEpisodeId" }],
  IncidentEpisodeMember: [
    { kind: "IncidentEpisode", key: "incidentEpisodeId" },
  ],
  IncidentAlert: [{ kind: "Alert", key: "alertId" }],
};

/*
 * Every other model that names a private record, and why it is no part of
 * one: what OneUptime writes about a record (a log of a notification sent,
 * a page, an AI run), a record of another product that points at one, or a
 * record that is itself private-capable. A new model naming a private record
 * is classified here - a part, a second part, or none - before it ships.
 */
const NAMES_BUT_IS_NO_PART: Record<string, string> = {
  AIConversation: "a person's own conversation with OneUptime AI about it",
  Alert: "a private kind itself; its episode is OneUptime's to write",
  AutoRemediationDecision: "OneUptime AI's own decision, written by OneUptime",
  AutoRemediationSuggestion: "OneUptime AI's own suggestion, written by OneUptime",
  CallLog: "a log of a call OneUptime made",
  DataSecurityIssue: "a Data Security issue, which may point at one",
  EmailLog: "a log of an email OneUptime sent",
  FormSubmission: "a form's answer, which may have declared one",
  Incident: "a private kind itself; its episode is OneUptime's to write",
  LlmLog: "a log of a call OneUptime made to an AI provider",
  OnCallDutyPolicyExecutionLog: "a page of an on-call policy, its own record",
  OnCallDutyPolicyExecutionLogTimeline: "a step of a page, its own record",
  PushNotificationLog: "a log of a push notification OneUptime sent",
  RumSessionPin: "a session replay pinned to it, a record of RUM",
  RumSessionReplayView: "a session replay's view, a record of RUM",
  RunbookExecution: "a run of a runbook, held to the runbook's permissions",
  SecurityCase: "a security case, which may point at one",
  SmsLog: "a log of an SMS OneUptime sent",
  TelegramLog: "a log of a Telegram message OneUptime sent",
  UserOnCallLog: "a person's page, its own record",
  UserOnCallLogTimeline: "a step of a person's page, its own record",
  WebhookLog: "a log of a webhook OneUptime called",
  WhatsAppLog: "a log of a WhatsApp message OneUptime sent",
  WorkspaceNotificationLog: "a log of a Slack or Teams message OneUptime sent",
};

describe("a part that names a second private record", () => {
  test("is listed with that record's kind and key", () => {
    const listed: Record<string, Array<{ kind: string; key: string }>> = {};

    for (const [table, keys] of Object.entries(ALSO_PART_OF)) {
      const modelType: { new (): BaseModel } = modelOfTable(table);

      listed[modelName(modelType)] = keys.map(
        (key: string): { kind: string; key: string } => {
          const column: PrivateRecordColumn | undefined =
            PrivateRecordPermission.getPrivateRecordColumns(modelType).find(
              (candidate: PrivateRecordColumn): boolean => {
                return candidate.column === key;
              },
            );

          return { kind: column?.kind.tableName || "", key: key };
        },
      );
    }

    expect(listed).toEqual(ALSO_PARTS);
  });

  test.each(Object.keys(ALSO_PARTS).map((name: string) => [name]))(
    "%s's service reads it through both records' privacy filters",
    (name: string) => {
      const source: string = fs.readFileSync(
        path.join(SERVICES_DIRECTORY, `${name}Service.ts`),
        "utf8",
      );

      for (const kind of [
        PARTS[name]!.kind,
        ...ALSO_PARTS[name]!.map((part: { kind: string }): string => {
          return part.kind;
        }),
      ]) {
        expect(source).toContain(`apply${kind}RelatedRecordPrivacyFilter`);
      }
    },
  );

  test("each one's writes are held to every record it is a part of", () => {
    for (const name of Object.keys(ALSO_PARTS)) {
      const modelType: { new (): BaseModel } = AllModelTypes.find(
        (candidate: { new (): BaseModel }): boolean => {
          return modelName(candidate) === name;
        },
      )!;

      expect(
        PrivateRecordPermission.getPrivateRecordColumns(modelType)
          .map((column: PrivateRecordColumn): string => {
            return `${column.kind.tableName}:${column.column}`;
          })
          .sort(),
      ).toEqual(
        [
          `${PARTS[name]!.kind}:${PARTS[name]!.key}`,
          ...ALSO_PARTS[name]!.map(
            (part: { kind: string; key: string }): string => {
              return `${part.kind}:${part.key}`;
            },
          ),
        ].sort(),
      );
    }
  });
});

describe("every model that names a private record", () => {
  test("is a part of it, a second part, or listed with why it is none", () => {
    const kinds: Set<string> = new Set<string>(
      PRIVATE_RECORD_KINDS.map((kind: PrivateRecordKind): string => {
        return kind.tableName;
      }),
    );

    const unclassified: Array<string> = [];

    for (const modelType of AllModelTypes) {
      const model: BaseModel = new modelType();
      const name: string = modelName(modelType);

      const namesOne: boolean = model
        .getTableColumns()
        .columns.some((column: string): boolean => {
          const metadata: TableColumnMetadata | undefined =
            model.getTableColumnMetadata(column);

          return Boolean(
            metadata &&
              metadata.type === TableColumnType.Entity &&
              metadata.modelType &&
              kinds.has(new metadata.modelType().tableName || ""),
          );
        });

      if (
        namesOne &&
        !PARTS[name] &&
        !ALSO_PARTS[name] &&
        !NAMES_BUT_IS_NO_PART[name]
      ) {
        unclassified.push(name);
      }
    }

    expect(unclassified).toEqual([]);
  });

  test("the list of those that are none names only models that name one", () => {
    for (const name of Object.keys(NAMES_BUT_IS_NO_PART)) {
      expect(
        AllModelTypes.some((candidate: { new (): BaseModel }): boolean => {
          return modelName(candidate) === name;
        }),
      ).toBe(true);
      expect(PARTS[name]).toBeUndefined();
    }
  });
});
