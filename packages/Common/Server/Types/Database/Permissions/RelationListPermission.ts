import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import CreatePermission, { RecordIdsFinder } from "./CreatePermission";
import ReadPermission from "./ReadPermission";
import TablePermission from "./TablePermission";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../Types/Dictionary";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../Types/HeldPermissions";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  getReferenceRefusalMessage,
  normalizeReferenceId,
  resolveReferenceIds,
  UnreadableReferenceException,
} from "../../../Utils/Database/ProjectScopedReferenceRefusal";
import RelationIdUtil from "../../../Utils/Database/RelationIdUtil";
import RelationNames from "../../../Utils/Database/RelationNames";
import WorkflowPrincipal from "../../../Utils/Workflow/WorkflowPrincipal";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

/*
 * A list of records a create or an update may name, or one record it names
 * in a field of its own, held to their read.
 */
export interface CheckedRelationList {
  // The column: a list ("monitors", "statusPages") or a relation ("monitor").
  column: string;
  // The model of the records it names.
  listedModelType: DatabaseBaseModelType;
  // How a refusal names the field: the column's title, "Monitors", "Monitor".
  title: string;
  /*
   * A single reference's ID column ("monitorId"): the relation and its ID
   * column are two names of the one reference, read together. Absent for a
   * list.
   */
  idColumn?: string | undefined;
}

/*
 * Records every project may name though no read of a project reaches them:
 * OneUptime's own global probes and AI agents, by the query that finds
 * them. A write that names one is held to its service's own rule for it
 * (ProbeService.isProbeAttachableToProject), not to the caller's read.
 */
const SHARED_RECORD_QUERIES: Dictionary<Dictionary<unknown>> = {
  Probe: { isGlobalProbe: true },
  AIAgent: { isGlobalAIAgent: true },
};

/*
 * The settings that hold credentials OneUptime uses for the record that
 * names them: the SMTP server a status page sends its email through, the
 * call and SMS provider a status page or an incoming call policy uses, the
 * credential the AI reaches a cluster with, the SNMP credentials a network
 * device or site is polled with, the video call provider a meeting is
 * started with, and the API key a permission is granted to.
 *
 * Their records are read as a whole table - no label or owner narrows a
 * read of them - so a write that names one is held to its caller's
 * permission to read that table, not to the project alone: a caller who may
 * read the table may name any of the project's records of it, and a caller
 * who may not - who holds none of its read permissions, or whose block with
 * no labels takes them away - names none of them. A workflow's step is lent
 * no read of them by acting as a Project Admin (isReadWithheldFromWorkflow):
 * whoever may edit a workflow decides what its steps name, so a step names
 * none of them, and is told a person who may read them has to make the
 * change (getWorkflowCredentialSettingRefusal). By table name.
 */
const CREDENTIAL_SETTINGS: Array<string> = [
  "ApiKey",
  "NetworkSnmpCredentialProfile",
  "ProjectCallSMSConfig",
  "ProjectSMTPConfig",
  "RunbookCredential",
  "VideoCallConnection",
];

/*
 * THE RECORDS A WRITE NAMES ARE RECORDS ITS CALLER MAY READ.
 *
 * A create or an update that names records - in a list (the monitors an
 * incident, an alert or a maintenance event affects, the status pages it
 * is shown on, the on-call policies it pages, an announcement's monitors, a
 * rule's monitors and runbooks), or one record in a field of its own (an
 * alert's monitor, a status page resource's monitor, a cost budget's
 * service, a layer's schedule), under either of its names - names only
 * records the caller may read, by the read rule of the named model's own
 * table: in the project the write is made in, carrying a label the caller's
 * read of them is limited to, not carrying a label a block takes away,
 * owned by them or one of their teams when their read reaches only what
 * they own, read through a parent they may read. A record they may not read
 * is answered like one that does not exist, in the words every reference
 * check answers with, and nothing is written.
 *
 * Only the records a write adds are asked about: on an update, a record a
 * row lists or names already is not asked about again, so an edit that
 * keeps an entry its editor may not read keeps it.
 *
 * OneUptime's global probes and AI agents, which every project may use, are
 * answered by the service that attaches them (SHARED_RECORD_QUERIES).
 *
 * A caller who holds no permission to read the listed model at all - the
 * roles OneUptime ships give incident responders no permission on monitors,
 * and they name the monitors an incident affects - is held to the project
 * and to their blocks with labels, not to a read they do not have: the
 * records must be the project's (the write's own reference check, or a
 * lookup by OneUptime when its service has none) and carry no label a block
 * of theirs takes away. A block with no labels on one of the listed model's
 * read permissions takes every record of it away.
 *
 * Records read as a whole table - labels, teams, people, severities,
 * monitor statuses, files - are not held to a read here: every member reads
 * them, and the reference check answers a record that is not the project's.
 * The settings that hold credentials (SMTP, call and SMS, credentials, SNMP
 * credentials, video call providers, API keys) are read as a whole table
 * too, and a write names one only when its caller may read that table
 * (CREDENTIAL_SETTINGS, isHeldToTableRead) - never through a workflow's
 * step, which holds no read of them.
 * The parent a model is read through, even when it is a list (an
 * announcement's status pages), is the parent rule's
 * (CreatePermission.checkParentPermission,
 * UpdatePermission.checkParentPermission). Root and master admin callers
 * are left alone.
 */
export default class RelationListPermission {
  // The checked lists of each model asked about, read from its metadata once.
  private static checkedLists: Map<
    DatabaseBaseModelType,
    Array<CheckedRelationList>
  > = new Map();

  // The checked single references of each model, read from its metadata once.
  private static checkedReferences: Map<
    DatabaseBaseModelType,
    Array<CheckedRelationList>
  > = new Map();

  /*
   * The lists of `modelType` held to the caller's read: every many-to-many
   * column a create or an update may write (its create or update permissions
   * name someone) whose records are read one by one or hold credentials
   * (isNamedOnlyWhenRead), but the parent the model's rows are read through.
   */
  public static getCheckedLists(
    modelType: DatabaseBaseModelType,
  ): Array<CheckedRelationList> {
    const cached: Array<CheckedRelationList> | undefined =
      RelationListPermission.checkedLists.get(modelType);

    if (cached) {
      return cached;
    }

    const model: BaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    const lists: Array<CheckedRelationList> = [];

    for (const columnName of Object.keys(columns)) {
      const column: TableColumnMetadata | undefined = columns[columnName];

      if (
        !column ||
        column.type !== TableColumnType.EntityArray ||
        !column.modelType ||
        columnName === model.canAccessIfCanReadOn
      ) {
        continue;
      }

      const isWritable: boolean =
        (accessControl[columnName]?.create || []).length > 0 ||
        (accessControl[columnName]?.update || []).length > 0;

      const listedModelType: DatabaseBaseModelType =
        column.modelType as DatabaseBaseModelType;

      if (
        !isWritable ||
        !RelationListPermission.isNamedOnlyWhenRead(listedModelType)
      ) {
        continue;
      }

      lists.push({
        column: columnName,
        listedModelType: listedModelType,
        title: column.title || new listedModelType().pluralName || columnName,
      });
    }

    RelationListPermission.checkedLists.set(modelType, lists);

    return lists;
  }

  /*
   * The single references of `modelType` held to the caller's read: every
   * relation to one record (RelationNames.getSingleRelations - the project
   * is the tenant check's) that a create or an update may write, under
   * either of its names, to a model whose records are read one by one or
   * hold credentials (isNamedOnlyWhenRead), but the parent the model's rows
   * are read through.
   */
  public static getCheckedReferences(
    modelType: DatabaseBaseModelType,
  ): Array<CheckedRelationList> {
    const cached: Array<CheckedRelationList> | undefined =
      RelationListPermission.checkedReferences.get(modelType);

    if (cached) {
      return cached;
    }

    const model: BaseModel = new modelType();
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    const isWritable: (column: string) => boolean = (
      column: string,
    ): boolean => {
      return (
        (accessControl[column]?.create || []).length > 0 ||
        (accessControl[column]?.update || []).length > 0
      );
    };

    const references: Array<CheckedRelationList> = [];

    for (const reference of RelationNames.getSingleRelations(model)) {
      if (reference.relation === model.canAccessIfCanReadOn) {
        continue;
      }

      const column: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(reference.relation);
      const referencedModelType: DatabaseBaseModelType | undefined =
        column?.modelType as DatabaseBaseModelType | undefined;

      if (
        !referencedModelType ||
        !(isWritable(reference.relation) || isWritable(reference.idColumn)) ||
        !RelationListPermission.isNamedOnlyWhenRead(referencedModelType)
      ) {
        continue;
      }

      references.push({
        column: reference.relation,
        idColumn: reference.idColumn,
        listedModelType: referencedModelType,
        title: reference.title,
      });
    }

    RelationListPermission.checkedReferences.set(modelType, references);

    return references;
  }

  /*
   * Every list and single reference of `modelType` held to the caller's
   * read: getCheckedLists, then getCheckedReferences.
   */
  public static getCheckedRelations(
    modelType: DatabaseBaseModelType,
  ): Array<CheckedRelationList> {
    return [
      ...RelationListPermission.getCheckedLists(modelType),
      ...RelationListPermission.getCheckedReferences(modelType),
    ];
  }

  /*
   * The query that finds the records of `modelType` every project may name,
   * or null for a model that has none (SHARED_RECORD_QUERIES).
   */
  public static getSharedRecordQuery(
    modelType: DatabaseBaseModelType,
  ): Dictionary<unknown> | null {
    const tableName: string = new modelType().tableName || "";

    return SHARED_RECORD_QUERIES[tableName] || null;
  }

  /*
   * Whether a write that names records of `modelType` is held to its
   * caller's read of them: records read one by one (isReadPerRecord), and
   * the settings that hold credentials, read as a whole table
   * (isHeldToTableRead).
   */
  public static isNamedOnlyWhenRead(modelType: DatabaseBaseModelType): boolean {
    return (
      RelationListPermission.isReadPerRecord(modelType) ||
      RelationListPermission.isHeldToTableRead(modelType)
    );
  }

  /*
   * Whether `modelType` is one of the settings that hold credentials
   * (CREDENTIAL_SETTINGS): a write names one of its records only when its
   * caller may read its table.
   */
  public static isHeldToTableRead(modelType: DatabaseBaseModelType): boolean {
    return CREDENTIAL_SETTINGS.includes(new modelType().tableName || "");
  }

  // The settings that hold credentials, by table name (CREDENTIAL_SETTINGS).
  public static getCredentialSettingsTables(): Array<string> {
    return [...CREDENTIAL_SETTINGS];
  }

  /*
   * Whether `props` may read `modelType`'s table at all, as a write that
   * names a setting that holds credentials asks it (isHeldToTableRead):
   * OneUptime and master admins may; a workflow's step may not read a
   * setting that holds credentials (isReadWithheldFromWorkflow); anyone else
   * holds one of the table's read permissions, or its read wildcard, and no
   * block with no labels takes any of them away. Asked in the props' own
   * project (tenantId). For a service that reads such a reference from a
   * column no metadata describes (a runbook's steps name the credentials
   * they run with), and for the read of runbook credentials that lets
   * OneUptime AI's commands use them (RunbookCredentialReaders).
   */
  public static mayReadTable(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
  ): boolean {
    if (props.isRoot || props.isMasterAdmin) {
      return true;
    }

    return RelationListPermission.getTableRead(modelType, props).isReader;
  }

  /*
   * How `props` holds the read of `modelType`'s table - the one answer both
   * mayReadTable and the records a write names (findReachableIds) are given:
   * blocked, when a block with no labels takes every one of its read
   * permissions away; a reader, when it holds one of them or the table's
   * read wildcard and is not blocked; or neither. A workflow's step is no
   * reader of a setting that holds credentials (isReadWithheldFromWorkflow).
   * OneUptime and master admins are the callers' to answer before asking.
   */
  private static getTableRead(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
  ): { isBlocked: boolean; isReader: boolean } {
    const readPermissions: Array<Permission> =
      TablePermission.getTablePermission(modelType, DatabaseRequestType.Read);

    const held: HeldPermissions = TablePermission.getHeldPermissions(props);

    if (HeldPermissionsUtil.isBlockedFromAny(held, readPermissions)) {
      return { isBlocked: true, isReader: false };
    }

    if (RelationListPermission.isReadWithheldFromWorkflow(modelType, props)) {
      return { isBlocked: false, isReader: false };
    }

    return {
      isBlocked: false,
      isReader: HeldPermissionsUtil.isGrantedAny(held, readPermissions, {
        wildcard: TablePermission.getModelWildcard(
          modelType,
          DatabaseRequestType.Read,
        ),
      }),
    };
  }

  /*
   * Whether `props` is a workflow's step and `modelType` a setting that
   * holds credentials (CREDENTIAL_SETTINGS) - the one place that decides a
   * step is not lent the read of one. A step acts as a Project Admin
   * (WorkflowPrincipal), who may read them, but whoever may edit a workflow
   * decides what its steps do, so a step reads none: getTableRead answers it
   * no reader, a write that names one is refused saying a person has to
   * make the change (checkNamedLists), and a refusal of the read of runbook
   * credentials says so too (RunbookCredentialReaders.getWorkflowNote).
   */
  public static isReadWithheldFromWorkflow(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return (
      WorkflowPrincipal.isWorkflow(props) &&
      RelationListPermission.isHeldToTableRead(modelType)
    );
  }

  /*
   * Whether a model's records are read one by one - whether a read of it
   * can reach some of its records and not others: records that carry labels
   * (a read limited to some of them, a block with labels), records read
   * through another record, records owned through a parent (and the
   * operational resources and the rest that carry labels and owners of
   * their own), private records, and records that carry the labels of the
   * records they name (ReadPermission.getLabelledReferences).
   */
  public static isReadPerRecord(modelType: DatabaseBaseModelType): boolean {
    const model: BaseModel = new modelType();

    if (
      model.getAccessControlColumn() ||
      model.canAccessIfCanReadOn ||
      model.ownedThrough ||
      CreatePermission.getParentPrivacyFilter(modelType)
    ) {
      return true;
    }

    const references: ReturnType<typeof ReadPermission.getLabelledReferences> =
      ReadPermission.getLabelledReferences(modelType);

    return references.keys.length > 0 || references.anyKindColumns.length > 0;
  }

  /*
   * The records each checked list and single reference of `modelType`
   * names in `data` (a create's model or an update's data), each once, as
   * sent - for the lists and references `data` names at all, by column. An
   * entry with no id is skipped, as the reference checks skip it; one that
   * clears a single reference names nothing.
   *
   * A single reference is read under both of its names. What a caller sends
   * must have them agree (RelationIdUtil.readConsistent, which refuses two
   * that do not). What a service's hooks leave behind (`afterHooks`) is not
   * the caller's to answer for: a hook may have written one name and left
   * the caller's other in place, so the record each of them names is asked
   * about.
   */
  public static getNamedIds(
    modelType: DatabaseBaseModelType,
    data: unknown,
    afterHooks: boolean = false,
  ): Dictionary<Array<string>> {
    const named: Dictionary<Array<string>> = {};

    if (!data || typeof data !== "object") {
      return named;
    }

    const record: Record<string, unknown> = data as Record<string, unknown>;

    for (const list of RelationListPermission.getCheckedLists(modelType)) {
      const value: unknown = record[list.column];

      if (value === undefined || value === null) {
        continue;
      }

      const seen: Set<string> = new Set<string>();
      const ids: Array<string> = [];

      for (const entry of resolveReferenceIds(value)) {
        const id: string = entry.toString().trim();

        if (seen.has(normalizeReferenceId(id))) {
          continue;
        }

        seen.add(normalizeReferenceId(id));
        ids.push(id);
      }

      named[list.column] = ids;
    }

    for (const reference of RelationListPermission.getCheckedReferences(
      modelType,
    )) {
      const idColumn: string = reference.idColumn || reference.column;

      if (
        record[reference.column] === undefined &&
        record[idColumn] === undefined
      ) {
        continue;
      }

      if (afterHooks) {
        named[reference.column] = RelationListPermission.getIdsUnderEachName(
          record,
          [idColumn, reference.column],
        );
        continue;
      }

      const id: ObjectID | null = RelationIdUtil.readConsistent(
        record,
        [idColumn, reference.column],
        reference.title,
      );

      named[reference.column] = id ? [id.toString().trim()] : [];
    }

    return named;
  }

  // The record each of `names` holds in `record`, each once (getNamedIds).
  private static getIdsUnderEachName(
    record: Record<string, unknown>,
    names: Array<string>,
  ): Array<string> {
    const seen: Set<string> = new Set<string>();
    const ids: Array<string> = [];

    for (const name of names) {
      const id: ObjectID | null = RelationIdUtil.read(record, [name]);

      if (!id) {
        continue;
      }

      const trimmed: string = id.toString().trim();

      if (seen.has(normalizeReferenceId(trimmed))) {
        continue;
      }

      seen.add(normalizeReferenceId(trimmed));
      ids.push(trimmed);
    }

    return ids;
  }

  /*
   * Of what `named` names (getNamedIds of a write), what `asked` - what an
   * ask before a service's hooks named - did not: the records a hook named
   * besides, by column. For the ask after the hooks (DatabaseService), which
   * looks up only those.
   */
  public static getIdsNotIn(
    named: Dictionary<Array<string>>,
    asked: Dictionary<Array<string>>,
  ): Dictionary<Array<string>> {
    const left: Dictionary<Array<string>> = {};

    for (const column of Object.keys(named)) {
      const askedIds: Set<string> = new Set<string>(
        (asked[column] || []).map(normalizeReferenceId),
      );

      const ids: Array<string> = (named[column] || []).filter(
        (id: string): boolean => {
          return !askedIds.has(normalizeReferenceId(id));
        },
      );

      if (ids.length > 0) {
        left[column] = ids;
      }
    }

    return left;
  }

  /*
   * Refuses a write that names records its caller may not read (see the
   * class comment). `heldIdsByColumn` is, for an update, the records each
   * row it writes lists or names already, by column - an update that
   * reaches no row names nothing. `findReadableIds` reads the named records
   * as the caller, with the read rule of their own table;
   * `findIdsInProject` reads them as OneUptime in the write's project;
   * `findSharedIds` finds, among them, the records every project may name
   * (SHARED_RECORD_QUERIES) - with none, none are. `referencesCheckedInProject`
   * says whether the write's own service holds every reference it names to
   * its project (ProjectReferencesService): with such a check, a caller
   * whose read of the named model is narrowed by nothing is not looked up.
   * `namedIds` is getNamedIds of the write, when the caller has it already.
   */
  @CaptureSpan()
  public static async checkNamedLists(data: {
    modelType: DatabaseBaseModelType;
    data: unknown;
    props: DatabaseCommonInteractionProps;
    heldIdsByColumn?: Dictionary<Array<Array<string>>> | undefined;
    findReadableIds: RecordIdsFinder;
    findIdsInProject: RecordIdsFinder;
    findSharedIds?: RecordIdsFinder | undefined;
    referencesCheckedInProject: boolean;
    namedIds?: Dictionary<Array<string>> | undefined;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const named: Dictionary<Array<string>> =
      data.namedIds ||
      RelationListPermission.getNamedIds(data.modelType, data.data);

    const refused: Array<string> = [];

    for (const relation of RelationListPermission.getCheckedRelations(
      data.modelType,
    )) {
      const ids: Array<string> | undefined = named[relation.column];

      if (!ids || ids.length === 0) {
        continue;
      }

      const newIds: Array<string> = RelationListPermission.getNewIds(
        ids,
        data.heldIdsByColumn
          ? data.heldIdsByColumn[relation.column] || []
          : null,
      );

      if (newIds.length === 0) {
        continue;
      }

      const readIds: Set<string> | null =
        await RelationListPermission.findReachableIds({
          list: relation,
          ids: newIds,
          props: data.props,
          findReadableIds: data.findReadableIds,
          findIdsInProject: data.findIdsInProject,
          findSharedIds: data.findSharedIds,
          referencesCheckedInProject: data.referencesCheckedInProject,
        });

      if (!readIds) {
        continue;
      }

      const unread: Array<string> = newIds.filter((id: string): boolean => {
        return !readIds.has(normalizeReferenceId(id));
      });

      // A workflow's step names none of a setting that holds credentials: it is told why.
      if (
        unread.length > 0 &&
        RelationListPermission.isReadWithheldFromWorkflow(
          relation.listedModelType,
          data.props,
        )
      ) {
        throw new NotAuthorizedException(
          RelationListPermission.getWorkflowCredentialSettingRefusal(relation),
        );
      }

      for (const id of unread) {
        refused.push(`${relation.title} "${id}"`);
      }
    }

    if (refused.length > 0) {
      throw new UnreadableReferenceException(
        getReferenceRefusalMessage({
          subject: (
            new data.modelType().singularName || "record"
          ).toLowerCase(),
          described: refused,
        }),
      );
    }
  }

  /*
   * Why a workflow's step cannot name a setting that holds credentials in
   * `relation`: no step is lent the read of one, so a person who may read
   * them has to make the change.
   */
  public static getWorkflowCredentialSettingRefusal(
    relation: CheckedRelationList,
  ): string {
    const settings: string =
      new relation.listedModelType().pluralName || relation.title;

    return `Workflow steps cannot set ${relation.title}: a setting that holds credentials is chosen only by a person who may read ${settings}. Ask someone who may read them to make this change.`;
  }

  /*
   * Of `ids`, the ones a row does not list or name yet: all of them on a
   * create (`heldIds` null), and on an update each one some row it writes
   * does not hold. An update that writes no row adds nothing.
   */
  private static getNewIds(
    ids: Array<string>,
    heldIds: Array<Array<string>> | null,
  ): Array<string> {
    if (!heldIds) {
      return ids;
    }

    const heldSets: Array<Set<string>> = heldIds.map(
      (held: Array<string>): Set<string> => {
        return new Set<string>(held.map(normalizeReferenceId));
      },
    );

    return ids.filter((id: string): boolean => {
      return heldSets.some((held: Set<string>): boolean => {
        return !held.has(normalizeReferenceId(id));
      });
    });
  }

  /*
   * Of `ids`, the ones the caller may name, lower-cased - or null when
   * nothing needs looking up: a caller who reads every record of the named
   * model, or who holds no read of it and no block with labels on it, on a
   * write whose service checks its references in the project itself. A
   * caller who holds no read of a setting that holds credentials
   * (isHeldToTableRead) may name none of them. A malformed id names no
   * record and is not looked up. The records every project may name
   * (SHARED_RECORD_QUERIES) are reachable to anyone a block with no labels
   * does not keep from the model altogether.
   */
  private static async findReachableIds(data: {
    list: CheckedRelationList;
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
    findReadableIds: RecordIdsFinder;
    findIdsInProject: RecordIdsFinder;
    findSharedIds?: RecordIdsFinder | undefined;
    referencesCheckedInProject: boolean;
  }): Promise<Set<string> | null> {
    const listedModelType: DatabaseBaseModelType = data.list.listedModelType;

    const tableRead: { isBlocked: boolean; isReader: boolean } =
      RelationListPermission.getTableRead(listedModelType, data.props);

    // A block with no labels on reading them takes every one of them away.
    if (tableRead.isBlocked) {
      return new Set<string>();
    }

    const isReader: boolean = tableRead.isReader;

    /*
     * A setting that holds credentials is named only by a caller who may
     * read its table (CREDENTIAL_SETTINGS): one who may not names none of
     * them, wherever they are.
     */
    if (
      !isReader &&
      RelationListPermission.isHeldToTableRead(listedModelType)
    ) {
      return new Set<string>();
    }

    const blockedLabelIds: Array<ObjectID> = isReader
      ? []
      : ReadPermission.getBlockedLabelIds(
          listedModelType,
          data.props,
          DatabaseRequestType.Read,
        );

    if (
      data.referencesCheckedInProject &&
      (isReader
        ? CreatePermission.readsEveryParent(listedModelType, data.props)
        : blockedLabelIds.length === 0)
    ) {
      return null;
    }

    const lookupIds: Array<string> = data.ids.filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });

    if (lookupIds.length === 0) {
      return new Set<string>();
    }

    const sharedQuery: Dictionary<unknown> | null =
      RelationListPermission.getSharedRecordQuery(listedModelType);

    const [foundIds, sharedIds]: [Array<string>, Array<string>] =
      await Promise.all([
        isReader
          ? data.findReadableIds({
              modelType: listedModelType,
              ids: lookupIds,
              query: CreatePermission.getParentLookupQuery({
                parentModelType: listedModelType,
                ids: lookupIds,
                props: data.props,
              }),
              props: data.props,
            })
          : data.findIdsInProject({
              modelType: listedModelType,
              ids: lookupIds,
              query: ReadPermission.addBlockedLabelsToQuery(
                listedModelType,
                {
                  _id: QueryHelper.any(lookupIds),
                } as Query<BaseModel>,
                blockedLabelIds,
              ),
              props: data.props,
            }),
        sharedQuery && data.findSharedIds
          ? data.findSharedIds({
              modelType: listedModelType,
              ids: lookupIds,
              query: {
                ...sharedQuery,
                _id: QueryHelper.any(lookupIds),
              } as Query<BaseModel>,
              props: data.props,
            })
          : Promise.resolve([] as Array<string>),
      ]);

    return new Set<string>(
      [...foundIds, ...sharedIds].map(normalizeReferenceId),
    );
  }
}
