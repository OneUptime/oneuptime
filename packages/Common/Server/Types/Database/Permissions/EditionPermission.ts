import { IsBillingEnabled } from "../../../../Server/EnvironmentConfig";
import EnterpriseEdition from "../../../Enterprise/EnterpriseEdition";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "../../../Enterprise/EnterpriseFeature";
import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

// Whether one column value of an update can only tighten security.
export type TightenOnlyColumnRule = (value: unknown) => boolean;

/*
 * The shortest SCIM bearer token a rotation may set without the license. The
 * Dashboard's "Reset token" generates a UUID (36 characters) and services
 * default to one, so this only turns away a token short enough to be weaker
 * than the one it replaces.
 */
export const MIN_ROTATED_SCIM_BEARER_TOKEN_LENGTH: number = 32;

// Replacing a (possibly leaked) SCIM bearer token with a new, long one.
const isRotatedBearerToken: TightenOnlyColumnRule = (
  value: unknown,
): boolean => {
  return (
    typeof value === "string" &&
    value.trim().length >= MIN_ROTATED_SCIM_BEARER_TOKEN_LENGTH
  );
};

/*
 * The updates an administrator may make to enterprise configuration while
 * the feature is unavailable, because they can only tighten security: the
 * incident-response moves. Keyed by table name, like the facade's feature
 * map; a model that is not listed has none.
 *
 *   bearerToken        rotate a leaked SCIM bearer token (project or status
 *                      page SCIM).
 *
 * TeamComplianceSetting has no entry: switching a compliance rule off
 * relaxes it.
 */
const TIGHTEN_ONLY_UPDATES: ReadonlyMap<
  string,
  Readonly<Record<string, TightenOnlyColumnRule>>
> = new Map<string, Readonly<Record<string, TightenOnlyColumnRule>>>([
  ["ProjectSCIM", { bearerToken: isRotatedBearerToken }],
  ["StatusPageSCIM", { bearerToken: isRotatedBearerToken }],
]);

export default class EditionPermissions {
  /*
   * Gates the enterprise CONFIGURATION models, the ones marked with
   * @TableEditionAccessControl({ requiresEnterprise: true }): project and
   * status page SCIM configurations and team compliance settings.
   *
   * Only creating and updating them needs the license. Reading and deleting
   * are always allowed, so an install that dropped to the Community Edition,
   * or whose license lapsed, can still see what it has configured and remove
   * it. Only configuration is gated here, and none of it is ever deleted.
   * Whether what exists RUNS is decided at runtime by
   * EnterpriseEdition.isFeatureActive: SCIM and audit logging stop while a
   * self-hosted license is lapsed and resume when a license is activated.
   *
   * The one kind of update that needs no license either is a TIGHTEN-ONLY
   * update (see TIGHTEN_ONLY_UPDATES): every column it writes is on the
   * model's list with a value that can only tighten security - rotating a
   * leaked SCIM bearer token. A lapsed license must never stand between an
   * administrator and that move during an incident. The same holds on the
   * Community Edition, deliberately and for the same reason reads and deletes
   * do: the move can only reduce what the configuration allows, and a token
   * rotated there stays rotated when the install returns to the Enterprise
   * Edition, instead of the leaked one coming back live. Anything else in the
   * same update - even one more column - makes it an ordinary update, which
   * needs the license.
   *
   * `updateData` is what the update writes. Only UpdatePermission, which has
   * it, passes it; without it an update is judged by the full check (fail
   * closed). TablePermission leaves updates to UpdatePermission for that
   * reason.
   *
   * Master admins are subject to this check - Create/UpdatePermission call it
   * before their master-admin early return - because a master admin can
   * write any project's SCIM configuration and team compliance settings, and
   * those writes would otherwise never be gated. Internal root writes
   * (props.isRoot) are never checked.
   *
   * On the cloud / billing-enabled deployment enforcement is left to
   * BillingPermission: it already gates these models by the plan tier in
   * their @TableBillingAccessControl, so a second check would be redundant.
   *
   * Deliberately synchronous. TablePermission and CreatePermission are
   * synchronous and their callers do not await them, so an async check with a
   * missed await would turn the refusal into an unhandled rejection and let
   * the write through. The license is read from the enterprise module's
   * cached snapshot, and an unknown snapshot refuses the write (fail closed).
   */
  @CaptureSpan()
  public static checkEditionPermissions(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    operation: DatabaseRequestType,
    updateData?: unknown,
  ): void {
    if (IsBillingEnabled) {
      return;
    }

    if (props.isRoot) {
      return;
    }

    if (
      operation !== DatabaseRequestType.Create &&
      operation !== DatabaseRequestType.Update
    ) {
      return;
    }

    const model: BaseModel = new modelType();

    if (!model.requiresEnterprise) {
      return;
    }

    if (
      operation === DatabaseRequestType.Update &&
      EditionPermissions.isTightenOnlyUpdate(model.tableName, updateData)
    ) {
      return;
    }

    const feature: EnterpriseFeature | null =
      EnterpriseEdition.getModelFeature(modelType);

    if (feature) {
      EnterpriseEdition.assertFeatureAvailableSync(feature);
      return;
    }

    /*
     * An enterprise model the facade has no feature for (its guard test
     * should make this impossible). Fail closed: only a license entitled to
     * every enterprise feature may configure it.
     */
    for (const enterpriseFeature of ALL_ENTERPRISE_FEATURES) {
      EnterpriseEdition.assertFeatureAvailableSync(enterpriseFeature);
    }
  }

  /*
   * Gates enterprise configuration kept in COLUMNS of core models (see
   * EnterpriseEdition.getEnterpriseColumnsForTableName): the retention
   * overrides on Project, Service and every telemetry resource.
   *
   * A create or update that writes an override - any value retention would
   * use - needs the column's feature, like a write to an enterprise model
   * (checkEditionPermissions). Clearing an override (null, an empty value,
   * or a retention config with no retention in it) never does, for the same
   * reason reads and deletes of enterprise models never do: an install that
   * dropped to the Community Edition, or whose license lapsed, must still be
   * able to remove what it configured. Every other column of the same write
   * is left to the usual checks.
   *
   * Same rules as checkEditionPermissions otherwise: synchronous, internal
   * root writes are never checked, master admins are, and with billing on
   * (OneUptime Cloud) the plan gates these columns instead, through their
   * @ColumnBillingAccessControl.
   */
  @CaptureSpan()
  public static checkEnterpriseColumnPermissions(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    operation: DatabaseRequestType,
    data: unknown,
  ): void {
    if (IsBillingEnabled) {
      return;
    }

    if (props.isRoot) {
      return;
    }

    if (
      operation !== DatabaseRequestType.Create &&
      operation !== DatabaseRequestType.Update
    ) {
      return;
    }

    for (const feature of EditionPermissions.getEnterpriseFeaturesWritten(
      new modelType().tableName,
      data,
    )) {
      EnterpriseEdition.assertFeatureAvailableSync(feature);
    }
  }

  /*
   * The features whose enterprise columns this write sets to a value that
   * takes effect (see isEnterpriseColumnValueSet), without duplicates.
   * Anything that is not a plain object of columns writes none.
   */
  public static getEnterpriseFeaturesWritten(
    tableName: string | null | undefined,
    data: unknown,
  ): Array<EnterpriseFeature> {
    const columns: Readonly<Record<string, EnterpriseFeature>> | null =
      EnterpriseEdition.getEnterpriseColumnsForTableName(tableName);

    if (!columns || !data || typeof data !== "object" || Array.isArray(data)) {
      return [];
    }

    const features: Array<EnterpriseFeature> = [];

    for (const [column, feature] of Object.entries(columns)) {
      const value: unknown = (data as Record<string, unknown>)[column];

      if (
        EditionPermissions.isEnterpriseColumnValueSet(value) &&
        !features.includes(feature)
      ) {
        features.push(feature);
      }
    }

    return features;
  }

  /*
   * Whether a value written to an enterprise column sets something, as
   * opposed to clearing it. Retention only ever uses positive numbers
   * (resolveTelemetryRetentionInDays skips everything else), so a value sets
   * an override when it is, or contains at any depth, a positive number - or
   * a string of one, which the API accepts for a number column. null, "",
   * zero, {} and a retention config whose every entry is blank all clear.
   */
  public static isEnterpriseColumnValueSet(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0;
    }

    if (typeof value === "string") {
      const trimmed: string = value.trim();

      if (!trimmed) {
        return false;
      }

      const parsed: number = Number(trimmed);

      return Number.isFinite(parsed) && parsed > 0;
    }

    if (typeof value === "object") {
      return Object.values(value as Record<string, unknown>).some(
        (entry: unknown): boolean => {
          return EditionPermissions.isEnterpriseColumnValueSet(entry);
        },
      );
    }

    return false;
  }

  /*
   * True when the update writes at least one column, and every column it
   * writes is on the table's tighten-only list with a value that passes the
   * column's rule. Columns set to undefined are not written and are ignored.
   * Anything that is not a plain object of columns is not tighten-only.
   */
  public static isTightenOnlyUpdate(
    tableName: string | null | undefined,
    updateData: unknown,
  ): boolean {
    const rules: Readonly<Record<string, TightenOnlyColumnRule>> | undefined =
      tableName ? TIGHTEN_ONLY_UPDATES.get(tableName) : undefined;

    if (!rules) {
      return false;
    }

    if (
      !updateData ||
      typeof updateData !== "object" ||
      Array.isArray(updateData)
    ) {
      return false;
    }

    const writtenColumns: Array<[string, unknown]> = Object.entries(
      updateData as Record<string, unknown>,
    ).filter(([, value]: [string, unknown]): boolean => {
      return value !== undefined;
    });

    if (writtenColumns.length === 0) {
      return false;
    }

    return writtenColumns.every(
      ([column, value]: [string, unknown]): boolean => {
        const rule: TightenOnlyColumnRule | undefined =
          Object.prototype.hasOwnProperty.call(rules, column)
            ? rules[column]
            : undefined;

        return Boolean(rule && rule(value));
      },
    );
  }

  // The tables with tighten-only updates, and their columns (for guard tests).
  public static getTightenOnlyColumns(): ReadonlyMap<
    string,
    ReadonlyArray<string>
  > {
    const columns: Map<string, ReadonlyArray<string>> = new Map<
      string,
      ReadonlyArray<string>
    >();

    for (const [tableName, rules] of TIGHTEN_ONLY_UPDATES) {
      columns.set(tableName, Object.keys(rules));
    }

    return columns;
  }
}
