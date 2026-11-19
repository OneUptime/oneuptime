import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import OwnedByFilter from "../OwnedByFilter";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import QueryUtil from "../QueryUtil";
import OwnedScopePermission from "./OwnedScopePermission";
import ReadPermission, {
  LabelledReferences,
  getLabelledModelTypes,
} from "./ReadPermission";
import TablePermission from "./TablePermission";
import type { TelemetryReadScope } from "../../../Utils/Telemetry/TelemetryReadScope";
import { combineWithPrivacyClause } from "../../../Utils/PrivacyFilterUtil";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OwnedBy, { OwnedByMatch } from "../../../../Types/BaseDatabase/OwnedBy";
import { FindWhereProperty } from "../../../../Types/BaseDatabase/Query";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import { OwnedThroughMetadata } from "../../../../Types/Database/AccessControl/OwnedThrough";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { getMetadataArgsStorage } from "typeorm";

/*
 * WHAT EVERY READER OF A SUBJECT MAY READ (#9576), for a run of OneUptime's
 * own whose writing all of them read: an AI investigation's report, in its
 * incident's or alert's feed and channels (Types/BaseDatabase/ReadAudience).
 *
 * The run reads as root, and the permission layer narrows each of its reads
 * here - the model reads (BasePermission, for every read made with the
 * run's props: each tool's, each starting context's) and the telemetry
 * reads (AnalyticsDatabase/ModelPermission, getTelemetryScope) - as it
 * narrows a person's by their grants. One rule for every kind of record:
 *
 *   - A KIND NOBODY IS NARROWED ON IS READ WHOLE. Owners and labels are how
 *     a project sets a record apart for some of its people: a role limited
 *     to what its members own, or to some labels, reads only what is set
 *     apart for it, and a team blocked from a label never reads what
 *     carries it. When no team, custom role or API key of the project holds
 *     a permission that reads the kind (its own read permissions, a role
 *     that grants them - Project Member, Viewer - or the operational
 *     resources' wildcard) only by owner, owners narrow nobody's reads of
 *     it; the same for labels. Everyone who may read the subject and the
 *     kind then reads all of it, so the run reads all of it and loses
 *     nothing - the many projects that set no permission scope read as
 *     before.
 *   - A KIND SOMEBODY IS NARROWED ON is read as nobody in particular may
 *     read it (#9562): none that an owner sets apart, when some read of it
 *     is limited to owners; none that a label sets apart, when some read of
 *     it is limited to or blocked from labels.
 *   - WHAT THE SUBJECT NAMES ITSELF is read whoever owns it and whatever
 *     labels it carries: its own record, and the records its Affected
 *     Resources list (ReadAudience.named) - its feed, emails and channels
 *     name them to every one of its readers already.
 *   - A PRIVATE INCIDENT, ALERT OR EPISODE is read by its owners alone, so
 *     never by the run, unless it is the subject.
 *   - A RECORD READ THROUGH OTHERS - a status timeline through its monitor,
 *     a note through its incident, an exception group through its service,
 *     a table through its data store - is left out with any record it names
 *     that is left out: the records the label rule weighs a model without
 *     labels of its own by (ReadPermission.getLabelledReferences), and the
 *     one a model without owners of its own takes them from (@OwnedThrough).
 *     A permission of its own held only by owner or label narrows it
 *     through them as well. All of it is one condition on the record's id
 *     (getKeptCondition).
 *
 * What is left out is never named, counted or reached through: each read's
 * own query leaves it out, so no list holds it, no count adds it and no
 * aggregate sums it. The names of the records joined onto a record that is
 * read (an alert's monitor) are read with it, as the permission layer reads
 * them for a person ("which rows a relation exposes is a property of the
 * outer query": QueryPermission.checkRelationQueryPermission).
 *
 * "Nobody in particular" approximates what every reader may read: a role
 * limited to what its members own, or to some labels, still reads the
 * names of records nobody set apart, and a role that may read the subject
 * but not a kind at all still reads the names of that kind's records
 * nobody set apart. Working out every reader's grants would read every
 * member's permissions for every report, and would leave a project with
 * one narrowed role next to nothing to investigate with; nobody set those
 * records apart from anyone.
 */

type ModelType = { new (): BaseModel };

/*
 * The kinds whose private records their owners alone read
 * (PrivateRecordPermission): never read for an audience, unless named.
 */
const PRIVATE_KINDS: ReadonlySet<string> = new Set<string>([
  "Incident",
  "Alert",
  "IncidentEpisode",
  "AlertEpisode",
]);

// The column a private kind marks its private records by.
const PRIVATE_COLUMN: string = "isPrivate";

// The condition a read of one model takes, and the column it is on (its id).
export interface ReadAudienceCondition {
  column: string;
  condition: FindWhereProperty<any>;
}

/*
 * Whether the permissions of a record read through others are held only by
 * owner or label themselves: the records it names are then weighed by
 * their owners, or their labels, whatever their own kind's permissions say.
 */
interface NarrowedThrough {
  owners: boolean;
  labels: boolean;
}

const NOT_NARROWED_THROUGH: NarrowedThrough = { owners: false, labels: false };

// Worked out once per model class: what decides a kind never changes.
const labelsJoinTableCache: WeakMap<
  ModelType,
  { joinTableName: string; ownerColumnName: string } | null
> = new WeakMap<
  ModelType,
  { joinTableName: string; ownerColumnName: string } | null
>();

export default class ReadAudiencePermission {
  // The audience props read for: only with isRoot, never a person's.
  public static getAudience(
    props: DatabaseCommonInteractionProps | null | undefined,
  ): ReadAudience | null {
    if (!props || !props.isRoot || !props.readAudience) {
      return null;
    }

    return props.readAudience;
  }

  /*
   * The props a run reads with for its audience: as OneUptime, held to the
   * audience's project (the model layer adds the tenant to every query of a
   * model with a project column), and narrowed by the audience.
   */
  public static getReadProps(
    audience: ReadAudience,
  ): DatabaseCommonInteractionProps {
    return {
      isRoot: true,
      tenantId: new ObjectID(audience.projectId),
      readAudience: audience,
    };
  }

  /*
   * Whether no team, custom role or API key of the project reads anything
   * only by owner or label: every kind is read whole, and only private
   * records are left out.
   */
  public static narrowsNobody(audience: ReadAudience): boolean {
    return (
      audience.ownedOnlyPermissions.length === 0 &&
      audience.labelledPermissions.length === 0
    );
  }

  // A model's name, as the owner table registry and ReadAudience.named key it.
  public static getKindName(modelType: ModelType): string {
    return (modelType as unknown as { name: string }).name;
  }

  // Whether a kind's private records are read by their owners alone.
  public static isPrivateKind(modelType: ModelType): boolean {
    return PRIVATE_KINDS.has(ReadAudiencePermission.getKindName(modelType));
  }

  /*
   * Whether records of the model can be set apart by their own owners,
   * labels or privacy: a kind, which a record read through others can name
   * (getReferences).
   */
  public static isKind(modelType: ModelType): boolean {
    return (
      OwnedScopePermission.hasOwnerTables(modelType) ||
      Boolean(new modelType().getAccessControlColumn()) ||
      ReadAudiencePermission.isPrivateKind(modelType)
    );
  }

  /*
   * Whether some team, custom role or API key reads this kind only by
   * owner: a permission that reads it - its own, a role granting it, or
   * its wildcard - held scoped to Owned, on a kind the Owned scope narrows
   * reads of (not one other records are set up with: a probe, a template,
   * an on-call schedule - OwnedScopePermission.leavesReadsAlone).
   */
  public static isNarrowedByOwners(
    modelType: ModelType,
    audience: ReadAudience,
  ): boolean {
    return (
      OwnedScopePermission.hasOwnerTables(modelType) &&
      !OwnedScopePermission.leavesReadsAlone(modelType) &&
      ReadAudiencePermission.isReadWithAnyOf(
        modelType,
        audience.ownedOnlyPermissions,
      )
    );
  }

  /*
   * Whether some team, custom role or API key reads this kind only for
   * some labels, or is blocked from it for some: a permission that reads
   * it held limited to labels, or blocked with labels.
   */
  public static isNarrowedByLabels(
    modelType: ModelType,
    audience: ReadAudience,
  ): boolean {
    return (
      Boolean(new modelType().getAccessControlColumn()) &&
      ReadAudiencePermission.isReadWithAnyOf(
        modelType,
        audience.labelledPermissions,
      )
    );
  }

  // Whether some reader of the kind reads it only by owner or label.
  public static isNarrowed(
    modelType: ModelType,
    audience: ReadAudience,
  ): boolean {
    return (
      ReadAudiencePermission.isNarrowedByOwners(modelType, audience) ||
      ReadAudiencePermission.isNarrowedByLabels(modelType, audience)
    );
  }

  // The records of a kind the subject names itself, by id (lower case).
  public static getNamedIds(
    modelType: ModelType,
    audience: ReadAudience,
  ): Array<string> {
    return audience.named[ReadAudiencePermission.getKindName(modelType)] || [];
  }

  // Whether the subject names this record itself.
  public static isNamed(
    modelType: ModelType,
    id: ObjectID | string,
    audience: ReadAudience,
  ): boolean {
    return ReadAudiencePermission.getNamedIds(modelType, audience).includes(
      id.toString().toLowerCase(),
    );
  }

  /*
   * THE RECORDS OF A MODEL THE AUDIENCE READS, as one condition on their
   * id: not private; owned by nobody, where some read of the model is
   * limited to owners; carrying no label, where some read of it is limited
   * to or blocked from labels; and - with `followReferences` - naming no
   * record the audience leaves out, of the kinds the label rule weighs a
   * model without labels of its own by (a table by its data store) and of
   * the one it takes its owners from (@OwnedThrough). Or named by the
   * subject. Null when it reads every record of the model.
   *
   * `through`: the permissions of a record read through this one narrow it
   * by owners or labels themselves (getNamesNoneLeftOutCondition). The
   * records named inside a reference are weighed by their own owners,
   * labels and privacy only, never their own references in turn: what the
   * label rule follows, one record further than the one read.
   */
  public static getKeptCondition(
    modelType: ModelType,
    audience: ReadAudience,
    options: {
      through?: NarrowedThrough | undefined;
      followReferences?: boolean | undefined;
    } = {},
  ): FindWhereProperty<any> | null {
    const through: NarrowedThrough = options.through || NOT_NARROWED_THROUGH;
    const parts: Array<{
      columnName?: string | undefined;
      condition: FindWhereProperty<any>;
    }> = [];

    if (options.followReferences) {
      parts.push(
        ...ReadAudiencePermission.getReferenceParts(modelType, audience),
      );
    }

    if (ReadAudiencePermission.isPrivateKind(modelType)) {
      parts.push({
        columnName: PRIVATE_COLUMN,
        condition: QueryHelper.isFalseOrNull(),
      });
    }

    if (
      OwnedScopePermission.hasOwnerTables(modelType) &&
      (ReadAudiencePermission.isNarrowedByOwners(modelType, audience) ||
        (through.owners && !OwnedScopePermission.leavesReadsAlone(modelType)))
    ) {
      parts.push({
        condition: OwnedByFilter.getIdCondition(
          modelType,
          new OwnedBy({ match: OwnedByMatch.NoOwner }),
        ),
      });
    }

    const labelsJoinTable: {
      joinTableName: string;
      ownerColumnName: string;
    } | null = ReadAudiencePermission.getLabelsJoinTable(modelType);

    if (
      labelsJoinTable &&
      (ReadAudiencePermission.isNarrowedByLabels(modelType, audience) ||
        through.labels)
    ) {
      parts.push({
        condition: QueryHelper.noEntitiesInManyToMany(labelsJoinTable),
      });
    }

    if (parts.length === 0) {
      return null;
    }

    const kept: FindWhereProperty<any> = QueryHelper.allOfConditions(parts);
    const named: Array<string> = ReadAudiencePermission.getNamedIds(
      modelType,
      audience,
    );

    if (named.length === 0) {
      return kept;
    }

    return QueryHelper.anyOfConditions([
      { condition: kept },
      { condition: QueryHelper.any(named) },
    ]);
  }

  /*
   * THE RECORDS OF A KIND THE AUDIENCE LEAVES OUT, in its project, as a
   * condition on their id: getKeptCondition's records turned around. Null
   * when it leaves out none.
   */
  public static getSetApartCondition(
    modelType: ModelType,
    audience: ReadAudience,
    through: NarrowedThrough = NOT_NARROWED_THROUGH,
  ): FindWhereProperty<any> | null {
    const kept: FindWhereProperty<any> | null =
      ReadAudiencePermission.getKeptCondition(modelType, audience, {
        through,
      });

    if (!kept) {
      return null;
    }

    const tenantColumn: string | null = new modelType().getTenantColumn();

    return QueryHelper.allOfConditions([
      ...(tenantColumn
        ? [
            {
              columnName: tenantColumn,
              condition: QueryHelper.any([audience.projectId]),
            },
          ]
        : []),
      { condition: QueryHelper.notCondition(kept) },
    ]);
  }

  /*
   * THE CONDITIONS A READ OF A MODEL TAKES FOR AN AUDIENCE: the one on its
   * id that keeps the records it reads (getKeptCondition, references
   * followed). Empty when the read keeps every row.
   */
  public static getConditions(
    modelType: ModelType,
    audience: ReadAudience,
  ): Array<ReadAudienceCondition> {
    const kept: FindWhereProperty<any> | null =
      ReadAudiencePermission.getKeptCondition(modelType, audience, {
        followReferences: true,
      });

    return kept ? [{ column: "_id", condition: kept }] : [];
  }

  /*
   * The parts of a model's condition that weigh it by the records it names,
   * each on the key naming them: the key names no record of its kinds the
   * audience leaves out, or none at all. Of a model without labels of its
   * own, every record the label rule weighs it by
   * (ReadPermission.getLabelledReferences) - a key that can name a record
   * of any kind (a resource id several kinds share) against every kind that
   * leaves records out; of a model without owners of its own, the record it
   * takes its owners from (@OwnedThrough). A permission of the model's own
   * held only by owner or label weighs those records by their owners or
   * labels too (`through`).
   */
  private static getReferenceParts(
    modelType: ModelType,
    audience: ReadAudience,
  ): Array<{ columnName: string; condition: FindWhereProperty<any> }> {
    const through: NarrowedThrough = {
      owners: ReadAudiencePermission.isReadWithAnyOf(
        modelType,
        audience.ownedOnlyPermissions,
      ),
      labels: ReadAudiencePermission.isReadWithAnyOf(
        modelType,
        audience.labelledPermissions,
      ),
    };
    const parts: Array<{
      columnName: string;
      condition: FindWhereProperty<any>;
    }> = [];

    for (const [column, kinds] of ReadAudiencePermission.getReferences(
      modelType,
    )) {
      const condition: FindWhereProperty<any> | null =
        ReadAudiencePermission.getNamesNoneLeftOutCondition(
          kinds,
          audience,
          through,
        );

      if (condition) {
        parts.push({ columnName: column, condition });
      }
    }

    if (new modelType().getAccessControlColumn()) {
      return parts;
    }

    const references: LabelledReferences =
      ReadPermission.getLabelledReferences(modelType);

    if (references.anyKindColumns.length > 0) {
      const everyKind: Array<ModelType> = Array.from(
        new Set<ModelType>([
          ...getLabelledModelTypes(),
          ...ReadAudiencePermission.getPrivateKindTypes(),
        ]),
      );

      for (const column of references.anyKindColumns) {
        const condition: FindWhereProperty<any> | null =
          ReadAudiencePermission.getNamesNoneLeftOutCondition(
            everyKind,
            audience,
            through,
          );

        if (condition) {
          parts.push({ columnName: column, condition });
        }
      }
    }

    return parts;
  }

  /*
   * A read's query, narrowed for its audience (getConditions): each
   * condition AND-ed with what the query asks of the same column, never in
   * its place - a read of one record by its id stays a read of that one.
   */
  public static addToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    audience: ReadAudience,
  ): Query<TBaseModel> {
    const conditions: Array<ReadAudienceCondition> =
      ReadAudiencePermission.getConditions(modelType, audience);

    if (conditions.length === 0) {
      return query;
    }

    const narrowed: Query<TBaseModel> = { ...query };

    for (const each of conditions) {
      const asked: Query<TBaseModel> = QueryUtil.serializeQuery(modelType, {
        [each.column]: (query as Record<string, unknown>)[each.column],
      } as Query<TBaseModel>);

      (narrowed as Record<string, unknown>)[each.column] =
        combineWithPrivacyClause(
          ReadPermission.getSupportedFilter(
            (asked as Record<string, unknown>)[each.column],
            "Cannot keep a read for everyone who may see its subject beside an unsupported filter.",
          ),
          each.condition,
        );
    }

    return narrowed;
  }

  /*
   * WHOSE TELEMETRY THE AUDIENCE READS: every resource's, less those set
   * apart (ReadAudience.telemetryBlockedIds, worked out with the audience).
   * A telemetry row belongs to the resource its key names, so a resource
   * left out takes its logs, spans, metrics, exceptions and profiles with
   * it, as a block with labels takes them from a person.
   */
  public static getTelemetryScope(audience: ReadAudience): TelemetryReadScope {
    return {
      readableIds: null,
      blockedIds: audience.telemetryBlockedIds.map((id: string): string => {
        return id.toLowerCase();
      }),
    };
  }

  /*
   * The keys of a record read through others, each with the kinds it can
   * name: the records the label rule weighs it by, and the one it takes
   * its owners from.
   */
  public static getReferences(
    modelType: ModelType,
  ): Map<string, Array<ModelType>> {
    const references: Map<string, Set<ModelType>> = new Map<
      string,
      Set<ModelType>
    >();

    const add: (column: string, kind: ModelType) => void = (
      column: string,
      kind: ModelType,
    ): void => {
      if (!ReadAudiencePermission.isKind(kind)) {
        return;
      }

      const kinds: Set<ModelType> =
        references.get(column) || new Set<ModelType>();
      kinds.add(kind);
      references.set(column, kinds);
    };

    // A model with labels of its own is weighed by them alone (the label rule).
    if (!new modelType().getAccessControlColumn()) {
      for (const reference of ReadPermission.getLabelledReferences(modelType)
        .keys) {
        for (const kind of reference.modelTypes) {
          add(reference.column, kind);
        }
      }
    }

    // A model with owners of its own is owned by them alone.
    const ownedThrough: OwnedThroughMetadata | null =
      OwnedScopePermission.hasOwnerTables(modelType)
        ? null
        : OwnedScopePermission.getOwnedThrough(modelType);

    if (ownedThrough) {
      for (const parent of ownedThrough.parentModels) {
        add(ownedThrough.fkColumn, parent as unknown as ModelType);
      }
    }

    return new Map<string, Array<ModelType>>(
      Array.from(references.entries()).map(
        ([column, kinds]: [string, Set<ModelType>]): [
          string,
          Array<ModelType>,
        ] => {
          return [column, Array.from(kinds)];
        },
      ),
    );
  }

  /*
   * The join table a kind's labels are kept in, from its own declaration
   * (so it is known before any database is connected), else from the
   * connected database. Null for a kind with no labels. A kind that
   * declares labels it cannot resolve is refused, as the label rule refuses
   * it: its records could not be told apart.
   */
  public static getLabelsJoinTable(modelType: ModelType): {
    joinTableName: string;
    ownerColumnName: string;
  } | null {
    if (labelsJoinTableCache.has(modelType)) {
      return labelsJoinTableCache.get(modelType) || null;
    }

    const labelsColumn: string | null =
      new modelType().getAccessControlColumn();

    if (!labelsColumn) {
      labelsJoinTableCache.set(modelType, null);
      return null;
    }

    const declared:
      | {
          name?: string | undefined;
          joinColumns?: Array<{ name?: string | undefined }> | undefined;
        }
      | undefined = getMetadataArgsStorage().joinTables.find(
      (joinTable: { target: unknown; propertyName: string }): boolean => {
        return (
          joinTable.target === modelType &&
          joinTable.propertyName === labelsColumn
        );
      },
    );

    if (declared?.name && declared.joinColumns?.[0]?.name) {
      const fromDeclaration: {
        joinTableName: string;
        ownerColumnName: string;
      } = {
        joinTableName: declared.name,
        ownerColumnName: declared.joinColumns[0].name,
      };

      labelsJoinTableCache.set(modelType, fromDeclaration);

      return fromDeclaration;
    }

    const fromDatabase: {
      joinTableName: string;
      ownerColumnName: string;
    } | null = QueryUtil.getManyToManyRelationMetadata(modelType, labelsColumn);

    if (!fromDatabase) {
      throw new BadDataException(
        "Cannot leave out records by their labels without the table their labels are kept in.",
      );
    }

    const resolved: { joinTableName: string; ownerColumnName: string } = {
      joinTableName: fromDatabase.joinTableName,
      ownerColumnName: fromDatabase.ownerColumnName,
    };

    labelsJoinTableCache.set(modelType, resolved);

    return resolved;
  }

  /*
   * A key that names no record left out of any of `kinds`: one condition
   * per kind that leaves records out, all of them met. Null when none does.
   */
  private static getNamesNoneLeftOutCondition(
    kinds: ReadonlyArray<ModelType>,
    audience: ReadAudience,
    through: NarrowedThrough,
  ): FindWhereProperty<any> | null {
    const parts: Array<{ condition: FindWhereProperty<any> }> = [];

    for (const kind of kinds) {
      const setApart: FindWhereProperty<any> | null =
        ReadAudiencePermission.getSetApartCondition(kind, audience, through);

      if (!setApart) {
        continue;
      }

      parts.push({
        condition: QueryHelper.namesNoRecordWhere({
          tableName: new kind().tableName as string,
          condition: setApart,
        }),
      });
    }

    return parts.length > 0 ? QueryHelper.allOfConditions(parts) : null;
  }

  // The private kinds' model classes, from the labelled models.
  private static getPrivateKindTypes(): Array<ModelType> {
    return getLabelledModelTypes().filter((modelType: ModelType): boolean => {
      return ReadAudiencePermission.isPrivateKind(modelType);
    });
  }

  /*
   * Whether one of `permissions` reads the model: one of its read
   * permissions (a role that grants them is one of them: Project Member,
   * Viewer), or the wildcard an operational resource's read accepts.
   */
  private static isReadWithAnyOf(
    modelType: ModelType,
    permissions: ReadonlyArray<string>,
  ): boolean {
    if (permissions.length === 0) {
      return false;
    }

    const reading: Array<string> = TablePermission.getTablePermission(
      modelType,
      DatabaseRequestType.Read,
    ).map((permission: Permission): string => {
      return permission.toString();
    });
    const wildcard: Permission | null = TablePermission.getModelWildcard(
      modelType,
      DatabaseRequestType.Read,
    );

    if (wildcard) {
      reading.push(wildcard.toString());
    }

    return reading.some((permission: string): boolean => {
      return permissions.includes(permission);
    });
  }
}
