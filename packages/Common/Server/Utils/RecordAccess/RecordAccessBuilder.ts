import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import RecordAccess, {
  RecordAccessKind,
  RecordAccessOperation,
  RecordAccessRefusalReason,
  RecordAccessResult,
  RecordAccessTables,
  RecordAccessVerdict,
} from "../../../Types/RecordAccess/RecordAccess";
import { UserPermission } from "../../../Types/Permission";
import LabelService from "../../Services/LabelService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import AccessControlPermission, {
  LabelGrant,
} from "../../Types/Database/Permissions/AccessControlPermission";
import CreateScopePermission, {
  CreateScope,
} from "../../Types/Database/Permissions/CreateScopePermission";
import OwnedScopePermission from "../../Types/Database/Permissions/OwnedScopePermission";
import PrivateRecordPermission from "../../Types/Database/Permissions/PrivateRecordPermission";
import ReadPermission from "../../Types/Database/Permissions/ReadPermission";
import TablePermission from "../../Types/Database/Permissions/TablePermission";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import { UnreadableReferenceException } from "../Database/ProjectScopedReferenceRefusal";
import logger from "../Logger";
import PrivateRecordWriteCheck from "../Permission/PrivateRecordWriteCheck";
import CaptureSpan from "../Telemetry/CaptureSpan";
import {
  getRecordAccessKindSpec,
  RecordAccessKindSpec,
  RecordAccessPart,
} from "./RecordAccessKinds";

/*
 * WHAT THE READER MAY DO ON ONE RECORD, WORKED OUT BY THE CHECKS A WRITE
 * RUNS (#10272, Types/RecordAccess/RecordAccess).
 *
 * Nothing here decides who may do what. Each operation is asked of the
 * server's own checks, without writing anything:
 *
 *   - a change or a delete of the record: the checks an update or a delete
 *     of it by its id runs (DatabaseService.findOneUpdatableById,
 *     findOneDeletableById) - the table's permission and its blocks, the
 *     team's blocks against its labels, the grants limited to labels or to
 *     owned records, a private record's owners, a write needing a read;
 *   - a new part of it (a note, a state change, a role, an owner): the
 *     checks a create of a row naming it runs (checkCallerMayCreate) -
 *     under a parent the reader may read, the private record's owners, what
 *     the reader's create permission reaches;
 *   - a change or a delete of a part: those of one of its rows - every row
 *     of a part names the record alone, and the rule weighs the record for
 *     each (RecordAccessKinds) - or nothing, while the record has no row of
 *     that part to change.
 *
 * Only a refusal is explained, from the same permission rows the checks
 * read and the record's labels, owners and privacy
 * (RecordAccessRefusalReason). An explanation never turns a refusal into
 * an allowance: whatever it finds, the operation stays refused.
 */

// How many teams that own a record are read, for the private reason.
const OWNER_TEAMS_READ: number = 50;

/*
 * The refusals a check answers with: the permission ones, a parent or a
 * reference the reader may not read, a plan, a missing record. Anything
 * else - the database, a check that could not run - is no answer about the
 * record, and leaves the operation out.
 */
const REFUSAL_CODES: ReadonlyArray<ExceptionCode> = [
  ExceptionCode.NotAuthorizedException,
  ExceptionCode.NotAuthenticatedException,
  ExceptionCode.ForbiddenException,
  ExceptionCode.PaymentRequiredException,
  ExceptionCode.NotFoundException,
];

// What a check answered: allowed, refused, or nothing to say.
type CheckAnswer = boolean | null;

// What the record holds that a refusal is explained by. Ids in lower case.
interface RecordFacts {
  labelIds: Array<string>;
  labelNames: Map<string, string>;
  isPrivate: boolean;
  isOwnedByReader: boolean;
  ownerTeamIds: Array<string>;
  ownerTeamNames: Map<string, string>;
}

// Where the reader's grants of one operation on one table reach.
interface OperationReach {
  // The labels its grants are limited to: none when one reaches further.
  labelIds: Array<string>;
  /*
   * The teams whose records an owned grant reaches - beside the labels, or
   * every grant limited to owned records - or null when none is.
   */
  ownedTeamIds: Array<string> | null;
  isOwnedOnly: boolean;
  // The labels a team's block takes away, for this operation.
  blockedLabelIds: Array<string>;
}

const idText: (value: unknown) => string = (value: unknown): string => {
  if (!value) {
    return "";
  }

  if (typeof value === "object" && value && "_id" in value) {
    return idText((value as { _id: unknown })._id);
  }

  return String(value).toLowerCase();
};

const idsOf: (
  values: ReadonlyArray<unknown> | null | undefined,
) => Array<string> = (
  values: ReadonlyArray<unknown> | null | undefined,
): Array<string> => {
  const ids: Array<string> = [];

  for (const value of values || []) {
    const id: string = idText(value);

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
};

const toDatabaseType: (
  operation: RecordAccessOperation,
) => DatabaseRequestType = (
  operation: RecordAccessOperation,
): DatabaseRequestType => {
  switch (operation) {
    case RecordAccessOperation.Create:
      return DatabaseRequestType.Create;
    case RecordAccessOperation.Update:
      return DatabaseRequestType.Update;
    case RecordAccessOperation.Delete:
      return DatabaseRequestType.Delete;
  }
};

export default class RecordAccessBuilder {
  @CaptureSpan()
  public static async build(data: {
    kind: RecordAccessKind;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<RecordAccessResult> {
    const spec: RecordAccessKindSpec = getRecordAccessKindSpec(data.kind);
    const recordModelType: DatabaseBaseModelType = spec.service
      .modelType as DatabaseBaseModelType;
    const recordTable: string = new recordModelType().tableName || "";

    /*
     * A record the reader may not read is answered as the API answers it:
     * missing. The record is read as the reader, by the rule every page's
     * read follows - a private one they do not see is missing too.
     */
    const record: BaseModel | null = await spec.service.findOneById({
      id: data.recordId,
      select: { _id: true } as Select<BaseModel>,
      props: data.props,
    });

    if (!record) {
      throw new NotFoundException(
        `${new recordModelType().singularName || "Record"} not found.`,
      );
    }

    // What the record holds, read once and only when a refusal is explained.
    let facts: Promise<RecordFacts> | null = null;
    const getFacts: () => Promise<RecordFacts> = (): Promise<RecordFacts> => {
      if (!facts) {
        facts = RecordAccessBuilder.readFacts({
          spec: spec,
          recordId: data.recordId,
          props: data.props,
        });
      }

      return facts;
    };

    const tables: RecordAccessTables = {};

    const decide: (data2: {
      modelType: DatabaseBaseModelType;
      operation: RecordAccessOperation;
      ask: () => Promise<boolean>;
    }) => Promise<RecordAccessVerdict | null> = async (data2: {
      modelType: DatabaseBaseModelType;
      operation: RecordAccessOperation;
      ask: () => Promise<boolean>;
    }): Promise<RecordAccessVerdict | null> => {
      return await RecordAccessBuilder.decide({
        modelType: data2.modelType,
        recordModelType: recordModelType,
        operation: data2.operation,
        props: data.props,
        ask: data2.ask,
        getFacts: getFacts,
        spec: spec,
        recordId: data.recordId,
      });
    };

    const record$: Promise<void> = (async (): Promise<void> => {
      const [update, remove]: [
        RecordAccessVerdict | null,
        RecordAccessVerdict | null,
      ] = await Promise.all([
        decide({
          modelType: recordModelType,
          operation: RecordAccessOperation.Update,
          ask: async (): Promise<boolean> => {
            return Boolean(
              await spec.service.findOneUpdatableById({
                id: data.recordId,
                select: { _id: true } as Select<BaseModel>,
                props: data.props,
              }),
            );
          },
        }),
        decide({
          modelType: recordModelType,
          operation: RecordAccessOperation.Delete,
          ask: async (): Promise<boolean> => {
            return Boolean(
              await spec.service.findOneDeletableById({
                id: data.recordId,
                select: { _id: true } as Select<BaseModel>,
                props: data.props,
              }),
            );
          },
        }),
      ]);

      tables[recordTable] = {
        ...(update ? { [RecordAccessOperation.Update]: update } : {}),
        ...(remove ? { [RecordAccessOperation.Delete]: remove } : {}),
      };
    })();

    const parts$: Array<Promise<void>> = spec.parts.map(
      async (part: RecordAccessPart): Promise<void> => {
        const partModelType: DatabaseBaseModelType = part.service
          .modelType as DatabaseBaseModelType;
        const tableName: string = new partModelType().tableName || "";

        const verdicts: Partial<
          Record<RecordAccessOperation, RecordAccessVerdict>
        > = await RecordAccessBuilder.decidePart({
          part: part,
          partModelType: partModelType,
          recordId: data.recordId,
          props: data.props,
          decide: decide,
        });

        tables[tableName] = verdicts;
      },
    );

    await Promise.all([record$, ...parts$]);

    return {
      kind: data.kind,
      recordId: data.recordId.toString(),
      tables: tables,
    };
  }

  // A part's operations: a new row naming the record, and one of its rows.
  private static async decidePart(data: {
    part: RecordAccessPart;
    partModelType: DatabaseBaseModelType;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
    decide: (data: {
      modelType: DatabaseBaseModelType;
      operation: RecordAccessOperation;
      ask: () => Promise<boolean>;
    }) => Promise<RecordAccessVerdict | null>;
  }): Promise<Partial<Record<RecordAccessOperation, RecordAccessVerdict>>> {
    const verdicts: Partial<
      Record<RecordAccessOperation, RecordAccessVerdict>
    > = {};

    const wantsRow: boolean = data.part.operations.some(
      (operation: RecordAccessOperation): boolean => {
        return operation !== RecordAccessOperation.Create;
      },
    );

    // One row of the part, read as OneUptime: every row of it is the same here.
    const rowId: ObjectID | null = wantsRow
      ? await RecordAccessBuilder.findOneRowOf({
          part: data.part,
          recordId: data.recordId,
          props: data.props,
        })
      : null;

    await Promise.all(
      data.part.operations.map(
        async (operation: RecordAccessOperation): Promise<void> => {
          let verdict: RecordAccessVerdict | null = null;

          if (operation === RecordAccessOperation.Create) {
            verdict = await data.decide({
              modelType: data.partModelType,
              operation: operation,
              ask: async (): Promise<boolean> => {
                await data.part.service.checkCallerMayCreate({
                  data: RecordAccessBuilder.getRowNaming({
                    part: data.part,
                    partModelType: data.partModelType,
                    recordId: data.recordId,
                    props: data.props,
                  }),
                  props: data.props,
                });

                return true;
              },
            });
          } else if (rowId) {
            verdict = await data.decide({
              modelType: data.partModelType,
              operation: operation,
              ask: async (): Promise<boolean> => {
                const ask: {
                  id: ObjectID;
                  select: Select<BaseModel>;
                  props: DatabaseCommonInteractionProps;
                } = {
                  id: rowId,
                  select: { _id: true } as Select<BaseModel>,
                  props: data.props,
                };

                return Boolean(
                  operation === RecordAccessOperation.Update
                    ? await data.part.service.findOneUpdatableById(ask)
                    : await data.part.service.findOneDeletableById(ask),
                );
              },
            });
          }

          if (verdict) {
            verdicts[operation] = verdict;
          }
        },
      ),
    );

    return verdicts;
  }

  /*
   * A new row of a part, as the page would send it: naming the record, in
   * the reader's project. What else the row holds - the note's words, the
   * person given a role - the checks weigh the same for any value.
   */
  private static getRowNaming(data: {
    part: RecordAccessPart;
    partModelType: DatabaseBaseModelType;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): BaseModel {
    const row: BaseModel = new data.partModelType();
    const tenantColumn: string | null = row.getTenantColumn();

    row.setValue(data.part.recordKey, new ObjectID(data.recordId.toString()));

    if (data.props.tenantId && tenantColumn) {
      row.setValue(tenantColumn, new ObjectID(data.props.tenantId.toString()));
    }

    return row;
  }

  private static async findOneRowOf(data: {
    part: RecordAccessPart;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ObjectID | null> {
    const rows: Array<BaseModel> = await data.part.service.findBy({
      query: {
        [data.part.recordKey]: data.recordId,
        ...(data.props.tenantId ? { projectId: data.props.tenantId } : {}),
      } as Query<BaseModel>,
      select: { _id: true } as Select<BaseModel>,
      skip: 0,
      limit: 1,
      props: { isRoot: true },
    });

    const id: string = idText(rows[0]?._id || rows[0]?.id);

    return id ? new ObjectID(id) : null;
  }

  /*
   * One operation, as the checks answer it, and why when they refuse it.
   * Refused on every record - the reader holds none of its permissions, or
   * a team's block with no labels takes them away - nothing is read: the
   * reader's own permissions say so, and the Dashboard's own lock names
   * what to ask for. Null when the checks could not answer.
   */
  private static async decide(data: {
    modelType: DatabaseBaseModelType;
    recordModelType: DatabaseBaseModelType;
    operation: RecordAccessOperation;
    props: DatabaseCommonInteractionProps;
    ask: () => Promise<boolean>;
    getFacts: () => Promise<RecordFacts>;
    spec: RecordAccessKindSpec;
    recordId: ObjectID;
  }): Promise<RecordAccessVerdict | null> {
    const type: DatabaseRequestType = toDatabaseType(data.operation);

    if (
      RecordAccessBuilder.isRefusedOnEveryRecord(
        data.modelType,
        data.props,
        type,
      )
    ) {
      return RecordAccess.refused(RecordAccessRefusalReason.Permission);
    }

    const answer: CheckAnswer = await RecordAccessBuilder.askCheck(data.ask);

    if (answer === null) {
      return null;
    }

    if (answer) {
      return RecordAccess.allowed();
    }

    try {
      return await RecordAccessBuilder.explain({
        modelType: data.modelType,
        recordModelType: data.recordModelType,
        type: type,
        props: data.props,
        facts: await data.getFacts(),
        spec: data.spec,
        recordId: data.recordId,
      });
    } catch (error) {
      // Refused all the same: only the why could not be read.
      logger.error(error);
      return RecordAccess.refused(RecordAccessRefusalReason.Other);
    }
  }

  private static async askCheck(
    ask: () => Promise<boolean>,
  ): Promise<CheckAnswer> {
    try {
      return await ask();
    } catch (error) {
      if (
        error instanceof UnreadableReferenceException ||
        (error instanceof Exception && REFUSAL_CODES.includes(error.code))
      ) {
        return false;
      }

      /*
       * A check that could not run says nothing about the record: the
       * operation is left out, and the reader's own permissions lock it as
       * before. The write itself is held to the rule whatever this says.
       */
      logger.debug(
        `A record's access could not be worked out for one operation: ${error}`,
      );
      return null;
    }
  }

  /*
   * Whether the reader's permissions refuse `type` on `modelType` before any
   * record is weighed: the table's permission, a block with no labels on
   * it, and a write's read (TablePermission). The same on every record.
   */
  public static isRefusedOnEveryRecord(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): boolean {
    if (props.isRoot || props.isMasterAdmin) {
      return false;
    }

    try {
      TablePermission.checkTableLevelPermissions(modelType, props, type);
      TablePermission.checkTableLevelBlockPermissions(modelType, props, type);

      if (type !== DatabaseRequestType.Read) {
        TablePermission.checkTableLevelReadForWrite(modelType, props, type);
      }
    } catch (error) {
      if (error instanceof Exception && REFUSAL_CODES.includes(error.code)) {
        return true;
      }

      throw error;
    }

    return false;
  }

  /*
   * WHY THE CHECKS REFUSED AN OPERATION ON THIS RECORD, from what they read:
   * the record private and none of its owners letting the reader (the rule's
   * own check, PrivateRecordWriteCheck); a block of a team of theirs on a
   * label the record carries; a grant limited to labels it does not carry,
   * or to records neither they nor the grant's team own. Each weighed for
   * the operation, for the read a write needs, and - for a part of the
   * record - for the record it is read through (an update of a part keeps to
   * the records the reader may change, BasePermission.addParentAccessToQuery).
   */
  private static async explain(data: {
    modelType: DatabaseBaseModelType;
    recordModelType: DatabaseBaseModelType;
    type: DatabaseRequestType;
    props: DatabaseCommonInteractionProps;
    facts: RecordFacts;
    spec: RecordAccessKindSpec;
    recordId: ObjectID;
  }): Promise<RecordAccessVerdict> {
    const facts: RecordFacts = data.facts;

    if (
      facts.isPrivate &&
      !(await PrivateRecordWriteCheck.reaches({
        modelType: data.modelType,
        type: data.type,
        recordService: data.spec.service,
        recordId: data.recordId,
        props: data.props,
      }))
    ) {
      const readerTeams: Array<string> = RecordAccessBuilder.getReaderTeamIds(
        data.props,
      );

      return RecordAccess.refused(RecordAccessRefusalReason.Private, {
        teamNames: facts.ownerTeamIds
          .filter((teamId: string): boolean => {
            return readerTeams.includes(teamId);
          })
          .map((teamId: string): string => {
            return facts.ownerTeamNames.get(teamId) || "";
          })
          .filter(Boolean),
      });
    }

    const reaches: Array<OperationReach> =
      RecordAccessBuilder.getReachesWeighed(data);

    const blocked: Array<string> = facts.labelIds.filter(
      (labelId: string): boolean => {
        return reaches.some((reach: OperationReach): boolean => {
          return reach.blockedLabelIds.includes(labelId);
        });
      },
    );

    if (blocked.length > 0) {
      return RecordAccess.refused(RecordAccessRefusalReason.BlockedLabels, {
        labelNames: blocked
          .map((labelId: string): string => {
            return facts.labelNames.get(labelId) || "";
          })
          .filter(Boolean),
      });
    }

    const isOwned: (teamIds: ReadonlyArray<string>) => boolean = (
      teamIds: ReadonlyArray<string>,
    ): boolean => {
      return (
        facts.isOwnedByReader ||
        facts.ownerTeamIds.some((teamId: string): boolean => {
          return teamIds.includes(teamId);
        })
      );
    };

    for (const reach of reaches) {
      if (reach.labelIds.length > 0) {
        const carries: boolean = facts.labelIds.some(
          (labelId: string): boolean => {
            return reach.labelIds.includes(labelId);
          },
        );

        if (carries || (reach.ownedTeamIds && isOwned(reach.ownedTeamIds))) {
          continue;
        }

        return RecordAccess.refused(
          reach.ownedTeamIds
            ? RecordAccessRefusalReason.LabelsOrOwned
            : RecordAccessRefusalReason.Labels,
          {
            labelNames: await RecordAccessBuilder.getLabelNames({
              labelIds: reach.labelIds,
              props: data.props,
            }),
          },
        );
      }

      if (reach.isOwnedOnly && !isOwned(reach.ownedTeamIds || [])) {
        return RecordAccess.refused(RecordAccessRefusalReason.Owned);
      }
    }

    return RecordAccess.refused(RecordAccessRefusalReason.Other);
  }

  /*
   * The grants the checks weighed for `type` on `modelType`: the
   * operation's own, the read a write needs, and for a part the read - and
   * on a change the update - of the record it is read through.
   */
  private static getReachesWeighed(data: {
    modelType: DatabaseBaseModelType;
    recordModelType: DatabaseBaseModelType;
    type: DatabaseRequestType;
    props: DatabaseCommonInteractionProps;
  }): Array<OperationReach> {
    const weighed: Array<[DatabaseBaseModelType, DatabaseRequestType]> = [
      [data.modelType, data.type],
    ];

    if (data.type !== DatabaseRequestType.Create) {
      weighed.push([data.modelType, DatabaseRequestType.Read]);
    }

    if (data.modelType !== data.recordModelType) {
      weighed.push([data.recordModelType, DatabaseRequestType.Read]);

      if (data.type === DatabaseRequestType.Update) {
        weighed.push([data.recordModelType, DatabaseRequestType.Update]);
      }
    }

    return weighed.map(
      ([modelType, type]: [
        DatabaseBaseModelType,
        DatabaseRequestType,
      ]): OperationReach => {
        return RecordAccessBuilder.getReach(modelType, data.props, type);
      },
    );
  }

  // Where the reader's grants of `type` on `modelType` reach, by the rule's reading.
  private static getReach(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): OperationReach {
    if (type === DatabaseRequestType.Create) {
      const scope: CreateScope = CreateScopePermission.getCreateScope(
        modelType,
        props,
      );

      return {
        labelIds: scope.isProjectWide ? [] : idsOf(scope.grantedLabelIds),
        ownedTeamIds:
          scope.isOwnedOnly || scope.isOwnedBesideLabels
            ? idsOf(scope.ownedTeamIds)
            : null,
        isOwnedOnly: scope.isOwnedOnly,
        blockedLabelIds: idsOf(
          scope.labelledBlocks.flatMap(
            (row: UserPermission): Array<unknown> => {
              return row.labelIds || [];
            },
          ),
        ),
      };
    }

    const grant: LabelGrant = AccessControlPermission.getLabelGrantForModel(
      modelType,
      props,
      type,
    );
    const isOwnedOnly: boolean = OwnedScopePermission.isLimitedToOwnedRecords(
      modelType,
      props,
      type,
    );

    return {
      labelIds: idsOf(grant.labelIds),
      ownedTeamIds: isOwnedOnly
        ? idsOf(OwnedScopePermission.getOwningTeamIds(modelType, props, type))
        : grant.ownedTeamIds
          ? idsOf(grant.ownedTeamIds)
          : null,
      isOwnedOnly: isOwnedOnly,
      blockedLabelIds: idsOf(
        ReadPermission.getBlockedLabelIds(
          modelType,
          props,
          type as
            | DatabaseRequestType.Read
            | DatabaseRequestType.Update
            | DatabaseRequestType.Delete,
        ),
      ),
    };
  }

  // The teams the reader's permissions are granted on.
  private static getReaderTeamIds(
    props: DatabaseCommonInteractionProps,
  ): Array<string> {
    return idsOf(
      DatabaseCommonInteractionPropsUtil.getPermissionRows(props).map(
        (row: UserPermission): unknown => {
          return row.teamId;
        },
      ),
    );
  }

  // What a refusal is explained by, read as OneUptime in the reader's project.
  private static async readFacts(data: {
    spec: RecordAccessKindSpec;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<RecordFacts> {
    const recordModelType: DatabaseBaseModelType = data.spec.service
      .modelType as DatabaseBaseModelType;
    const canBePrivate: boolean =
      PrivateRecordPermission.isPrivateRecordModel(recordModelType);
    const inProject: Record<string, unknown> = data.props.tenantId
      ? { projectId: data.props.tenantId }
      : {};

    const [record, ownedByReader, ownerTeams]: [
      BaseModel | null,
      Array<BaseModel>,
      Array<BaseModel>,
    ] = await Promise.all([
      data.spec.service.findOneBy({
        query: { _id: data.recordId, ...inProject } as Query<BaseModel>,
        select: {
          labels: { _id: true, name: true },
          ...(canBePrivate ? { isPrivate: true } : {}),
        } as Select<BaseModel>,
        props: { isRoot: true },
      }),
      data.props.userId
        ? data.spec.ownerUserService.findBy({
            query: {
              [data.spec.ownerKey]: data.recordId,
              userId: data.props.userId,
              ...inProject,
            } as Query<BaseModel>,
            select: { _id: true } as Select<BaseModel>,
            skip: 0,
            limit: 1,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
      data.spec.ownerTeamService.findBy({
        query: {
          [data.spec.ownerKey]: data.recordId,
          ...inProject,
        } as Query<BaseModel>,
        select: { teamId: true, team: { name: true } } as Select<BaseModel>,
        skip: 0,
        limit: OWNER_TEAMS_READ,
        props: { isRoot: true },
      }),
    ]);

    const labels: Array<Label> =
      ((record as unknown as { labels?: Array<Label> } | null)?.labels as
        | Array<Label>
        | undefined) || [];

    const labelNames: Map<string, string> = new Map<string, string>();

    for (const label of labels) {
      const id: string = idText(label._id || label.id);

      if (id) {
        labelNames.set(id, label.name || "");
      }
    }

    const ownerTeamNames: Map<string, string> = new Map<string, string>();

    for (const row of ownerTeams) {
      const values: { teamId?: unknown; team?: { name?: unknown } } =
        row as unknown as { teamId?: unknown; team?: { name?: unknown } };
      const id: string = idText(values.teamId);

      if (id) {
        ownerTeamNames.set(
          id,
          typeof values.team?.name === "string" ? values.team.name : "",
        );
      }
    }

    return {
      labelIds: [...labelNames.keys()],
      labelNames: labelNames,
      isPrivate:
        canBePrivate &&
        (record as unknown as { isPrivate?: unknown } | null)?.isPrivate ===
          true,
      isOwnedByReader: ownedByReader.length > 0,
      ownerTeamIds: [...ownerTeamNames.keys()],
      ownerTeamNames: ownerTeamNames,
    };
  }

  // The names of the labels a grant reaches, as the project wrote them.
  private static async getLabelNames(data: {
    labelIds: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<string>> {
    if (data.labelIds.length === 0) {
      return [];
    }

    const labels: Array<Label> = await LabelService.findBy({
      query: {
        _id: QueryHelper.any(data.labelIds),
        ...(data.props.tenantId ? { projectId: data.props.tenantId } : {}),
      } as Query<Label>,
      select: { _id: true, name: true },
      skip: 0,
      limit: data.labelIds.length,
      props: { isRoot: true },
    });

    // In the order the grants name them.
    const names: Map<string, string> = new Map<string, string>();

    for (const label of labels) {
      names.set(idText(label._id || label.id), label.name || "");
    }

    return data.labelIds
      .map((labelId: string): string => {
        return names.get(labelId) || "";
      })
      .filter(Boolean);
  }
}
