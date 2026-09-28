import AlertSeverityService from "./AlertSeverityService";
import DatabaseService from "./DatabaseService";
import IncidentSeverityService from "./IncidentSeverityService";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Model from "../../Models/DatabaseModels/TeamComplianceSetting";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ModelPermission from "../Types/Database/Permissions/Index";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import Includes from "../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import ComplianceNotificationChannel from "../../Types/Team/ComplianceNotificationChannel";
import ComplianceRule, {
  ComplianceSeverityKind,
} from "../../Types/Team/ComplianceRule";
import ComplianceRuleType from "../../Types/Team/ComplianceRuleType";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * The part of a compliance rule that decides what it checks: its type, the
 * channel it insists on (null = any) and the severities it is scoped to
 * (empty = every severity of its kind). Two rules with the same scope check
 * exactly the same thing, which is what "duplicate" means here.
 */
export interface ComplianceRuleScope {
  ruleType: ComplianceRuleType;
  notificationChannel: ComplianceNotificationChannel | null;
  severityKind: ComplianceSeverityKind | null;
  // Sorted, de-duplicated ids of the severity list the rule's kind uses.
  severityIds: Array<string>;
}

// A severity about to be deleted, as the severity services read it.
export interface DeletedSeverity {
  _id?: string | undefined;
  projectId?: ObjectID | undefined;
}

export const DUPLICATE_COMPLIANCE_RULE_MESSAGE: string =
  "This team already has a compliance rule that checks exactly the same thing. Edit that rule instead of adding another.";

/*
 * The two severity relations, and the model each one's items are written as.
 * Every list a payload carries for them is rewritten through
 * normaliseSeverityLists before anything is checked.
 */
const SEVERITY_LISTS: ReadonlyArray<{
  key: "incidentSeverities" | "alertSeverities";
  kind: ComplianceSeverityKind;
  buildItem: (id: string) => IncidentSeverity | AlertSeverity;
}> = [
  {
    key: "incidentSeverities",
    kind: ComplianceSeverityKind.Incident,
    buildItem: (id: string): IncidentSeverity => {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = id;
      return severity;
    },
  },
  {
    key: "alertSeverities",
    kind: ComplianceSeverityKind.Alert,
    buildItem: (id: string): AlertSeverity => {
      const severity: AlertSeverity = new AlertSeverity();
      severity._id = id;
      return severity;
    },
  },
];

export class TeamComplianceSettingService extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * Authorisation first. DatabaseService.create only checks the caller's
     * create permission AFTER this hook, and every check below reads as root
     * in the project the request names - which a caller picks with a header,
     * member of that project or not. Answering "that severity is not in this
     * project" or "that team already has this rule" before the permission
     * refusal would describe another project's severities and rules to
     * anyone signed in. The columns this hook clears later carry the same
     * create permissions, so the check DatabaseService repeats still passes.
     */
    if (!createBy.props.isRoot && !createBy.props.isMasterAdmin) {
      ModelPermission.checkCreatePermissions(
        this.modelType,
        createBy.data,
        createBy.props,
      );
    }

    const ruleType: ComplianceRuleType = this.assertKnownRuleType(
      createBy.data.ruleType,
    );

    this.assertValidChannel(createBy.data.notificationChannel);

    /*
     * Normalise before anything is stored: a method rule carries no channel
     * or severities, and an incident rule carries no alert severities. The
     * form hides the fields that do not apply, but the API accepts whatever it
     * is sent, and a stray alert severity on an incident rule would otherwise
     * sit in the database looking like part of the rule.
     */
    this.clearOptionsThatDoNotApply(createBy.data, ruleType, {
      clearUnsentOptions: false,
    });

    TeamComplianceSettingService.normaliseSeverityLists(createBy.data);

    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!projectId) {
      throw new BadDataException("Project ID is required.");
    }

    if (!createBy.data.teamId) {
      throw new BadDataException("Team ID is required.");
    }

    const scope: ComplianceRuleScope = TeamComplianceSettingService.getScope({
      ruleType: ruleType,
      notificationChannel: createBy.data.notificationChannel,
      incidentSeverities: createBy.data.incidentSeverities,
      alertSeverities: createBy.data.alertSeverities,
    });

    await this.assertSeveritiesBelongToProject(projectId, scope);

    await this.assertNoIdenticalRule({
      teamId: createBy.data.teamId,
      projectId: projectId,
      scope: scope,
      excludeSettingId: undefined,
    });

    return { createBy, carryForward: null };
  }

  /*
   * Toggling a rule on or off touches none of the fields that define it, so it
   * returns before reading anything: a disable must never fail because of the
   * rule's configuration.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: JSONObject = updateBy.data as JSONObject;

    const changesScope: boolean =
      data["ruleType"] !== undefined ||
      data["notificationChannel"] !== undefined ||
      data["incidentSeverities"] !== undefined ||
      data["alertSeverities"] !== undefined;

    if (!changesScope) {
      return { updateBy, carryForward: null };
    }

    /*
     * As on create: _updateBy checks the caller's update permission only
     * after this hook, and updateBy / updateOneBy do not check it before. The
     * reads below are scoped to the caller's project, but that project is
     * whatever the request named, so a caller who may not change rules there
     * is refused before any of them can answer.
     */
    if (!updateBy.props.isRoot && !updateBy.props.isMasterAdmin) {
      await this.assertMayUpdate(updateBy);
    }

    const newRuleType: ComplianceRuleType | undefined =
      data["ruleType"] !== undefined
        ? this.assertKnownRuleType(data["ruleType"])
        : undefined;

    this.assertValidChannel(data["notificationChannel"]);

    if (newRuleType) {
      /*
       * A new type makes the row's STORED options stale too, not only the ones
       * this update sends: switching "Call for Critical incidents" to
       * "Verified email" must not leave Call and Critical on the row, to come
       * back as the scope if the type is ever switched again.
       */
      this.clearOptionsThatDoNotApply(data, newRuleType, {
        clearUnsentOptions: true,
      });
    }

    /*
     * The rows being changed, read to work out what each will check once the
     * update lands. Scoped to the caller's project when there is one, so the
     * rows of another project are never checked, let alone described.
     */
    const query: JSONObject = { ...(updateBy.query as JSONObject) };

    if (updateBy.props.tenantId) {
      query["projectId"] = updateBy.props.tenantId;
    }

    const existingSettings: Array<Model> = await this.findBy({
      query: query,
      select: {
        _id: true,
        teamId: true,
        projectId: true,
        ruleType: true,
        notificationChannel: true,
        incidentSeverities: {
          _id: true,
        },
        alertSeverities: {
          _id: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (!newRuleType) {
      /*
       * The type stays, so drop whatever this update sends that the type does
       * not use - as create does - rather than store alert severities on an
       * incident rule unvalidated. Only when every row being updated has the
       * same type, because `data` is written to all of them.
       */
      const storedRuleTypes: Set<ComplianceRuleType> =
        new Set<ComplianceRuleType>();

      for (const existing of existingSettings) {
        if (ComplianceRule.isKnownRuleType(existing.ruleType)) {
          storedRuleTypes.add(existing.ruleType);
        }
      }

      const storedRuleType: ComplianceRuleType | undefined =
        Array.from(storedRuleTypes)[0];

      if (storedRuleTypes.size === 1 && storedRuleType) {
        this.clearOptionsThatDoNotApply(data, storedRuleType, {
          clearUnsentOptions: false,
        });
      }
    }

    /*
     * `data` is written to every row the update matches, so the lists it
     * sends are normalised once, here, and each row below is checked against
     * exactly what will be written to it.
     */
    TeamComplianceSettingService.normaliseSeverityLists(data);

    for (const existing of existingSettings) {
      const ruleType: ComplianceRuleType | undefined =
        newRuleType ||
        (ComplianceRule.isKnownRuleType(existing.ruleType)
          ? existing.ruleType
          : undefined);

      if (!ruleType || !existing.teamId || !existing.projectId) {
        continue;
      }

      const scope: ComplianceRuleScope = TeamComplianceSettingService.getScope({
        ruleType: ruleType,
        notificationChannel:
          data["notificationChannel"] !== undefined
            ? data["notificationChannel"]
            : existing.notificationChannel,
        incidentSeverities:
          data["incidentSeverities"] !== undefined
            ? data["incidentSeverities"]
            : existing.incidentSeverities,
        alertSeverities:
          data["alertSeverities"] !== undefined
            ? data["alertSeverities"]
            : existing.alertSeverities,
      });

      await this.assertSeveritiesBelongToProject(existing.projectId, scope);

      await this.assertNoIdenticalRule({
        teamId: existing.teamId,
        projectId: existing.projectId,
        scope: scope,
        excludeSettingId: existing.id || undefined,
      });
    }

    return { updateBy, carryForward: null };
  }

  /*
   * SEVERITY DELETES. A rule's severity scope is stored only as join rows,
   * and those cascade away with the severity. A rule left with no severity
   * reads exactly like one created for every severity of its kind, so
   * deleting the only severity "Call for Critical incidents" was scoped to
   * would quietly turn it into "Call for every incident severity" - failing
   * members against a rule nobody wrote.
   *
   * The severity services therefore ask, before the delete and while the join
   * rows still say what each rule was scoped to, which enabled rules are
   * scoped only to severities that are about to go
   * (getRulesScopedOnlyTo), and once the delete has actually happened they
   * pause those that were left with none (pauseRulesLeftWithoutSeverities).
   * A paused rule is listed as "Paused" on the Compliance page, for an admin
   * to re-scope or delete. Pausing only after the delete means a delete that
   * is refused - by the permission layer, or because incidents still use the
   * severity - pauses nothing.
   */
  @CaptureSpan()
  public async getRulesScopedOnlyTo(data: {
    severityKind: ComplianceSeverityKind;
    severities: Array<DeletedSeverity>;
  }): Promise<Array<string>> {
    const deletedIdsByProject: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const severity of data.severities) {
      const id: string | undefined = severity._id?.toString().toLowerCase();
      const projectId: string | undefined = severity.projectId?.toString();

      if (!id || !projectId) {
        continue;
      }

      const ids: Set<string> =
        deletedIdsByProject.get(projectId) || new Set<string>();
      ids.add(id);
      deletedIdsByProject.set(projectId, ids);
    }

    const ruleTypes: Array<ComplianceRuleType> = Object.values(
      ComplianceRuleType,
    ).filter((ruleType: ComplianceRuleType): boolean => {
      return ComplianceRule.getSeverityKind(ruleType) === data.severityKind;
    });

    const settingIds: Array<string> = [];

    for (const [projectId, deletedIds] of deletedIdsByProject) {
      const rules: Array<Model> = await this.findBy({
        query: {
          projectId: new ObjectID(projectId),
          ruleType: new Includes(ruleTypes),
          enabled: true,
        },
        select: {
          _id: true,
          ruleType: true,
          enabled: true,
          incidentSeverities: {
            _id: true,
          },
          alertSeverities: {
            _id: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const rule of rules) {
        const severityIds: Array<string> =
          TeamComplianceSettingService.getSeverityIdsOfKind(
            rule,
            data.severityKind,
          );

        if (
          rule._id &&
          rule.enabled === true &&
          ComplianceRule.getSeverityKind(rule.ruleType) === data.severityKind &&
          severityIds.length > 0 &&
          severityIds.every((id: string): boolean => {
            return deletedIds.has(id);
          })
        ) {
          settingIds.push(rule._id.toString());
        }
      }
    }

    return settingIds;
  }

  /*
   * The second half of a severity delete: of the rules getRulesScopedOnlyTo
   * named, pause the ones that are now left with no severity of their kind.
   * Re-read rather than assumed, so a rule whose severity survived (the
   * delete matched fewer rows than the lookup did) or that was re-scoped in
   * the meantime stays as it is.
   */
  @CaptureSpan()
  public async pauseRulesLeftWithoutSeverities(data: {
    severityKind: ComplianceSeverityKind;
    settingIds: Array<string>;
  }): Promise<Array<string>> {
    if (data.settingIds.length === 0) {
      return [];
    }

    const rules: Array<Model> = await this.findBy({
      query: {
        _id: new Includes(data.settingIds),
      },
      select: {
        _id: true,
        ruleType: true,
        enabled: true,
        incidentSeverities: {
          _id: true,
        },
        alertSeverities: {
          _id: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const toPause: Array<string> = [];

    for (const rule of rules) {
      if (
        rule._id &&
        rule.enabled === true &&
        ComplianceRule.getSeverityKind(rule.ruleType) === data.severityKind &&
        TeamComplianceSettingService.getSeverityIdsOfKind(
          rule,
          data.severityKind,
        ).length === 0
      ) {
        toPause.push(rule._id.toString());
      }
    }

    if (toPause.length === 0) {
      return [];
    }

    // An enabled-only update: the update hook reads nothing for it.
    await this.updateBy({
      query: {
        _id: new Includes(toPause),
      },
      data: {
        enabled: false,
      },
      limit: toPause.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return toPause;
  }

  /*
   * What a rule checks, from its stored (or about-to-be-stored) fields. Only
   * the options its type uses count: a channel on a method rule, or alert
   * severities on an incident rule, change nothing about what is checked.
   */
  public static getScope(data: {
    ruleType: ComplianceRuleType;
    notificationChannel: unknown;
    incidentSeverities: unknown;
    alertSeverities: unknown;
  }): ComplianceRuleScope {
    const severityKind: ComplianceSeverityKind | undefined =
      ComplianceRule.getSeverityKind(data.ruleType);

    const notificationChannel: ComplianceNotificationChannel | null =
      ComplianceRule.supportsChannel(data.ruleType) &&
      ComplianceRule.isKnownChannel(data.notificationChannel)
        ? data.notificationChannel
        : null;

    let severityIds: Array<string> = [];

    if (severityKind === ComplianceSeverityKind.Incident) {
      severityIds = TeamComplianceSettingService.getIds(
        data.incidentSeverities,
      );
    } else if (severityKind === ComplianceSeverityKind.Alert) {
      severityIds = TeamComplianceSettingService.getIds(data.alertSeverities);
    }

    return {
      ruleType: data.ruleType,
      notificationChannel: notificationChannel,
      severityKind: severityKind || null,
      severityIds: severityIds,
    };
  }

  public static isSameScope(
    a: ComplianceRuleScope,
    b: ComplianceRuleScope,
  ): boolean {
    return (
      a.ruleType === b.ruleType &&
      a.notificationChannel === b.notificationChannel &&
      a.severityIds.join(",") === b.severityIds.join(",")
    );
  }

  /*
   * Severity ids from a severity list as it is STORED (or once a payload has
   * been through normaliseSeverityLists): an id string, an ObjectID, a model,
   * or `{_id}` / `{id}` JSON. Sorted and de-duplicated so two lists compare by
   * content, and lower-cased because Postgres compares uuids without case and
   * hands them back lower case: "ABC..." sent by a client is the stored
   * "abc...", and must not slip past the duplicate check as a different id.
   *
   * Lenient on purpose - an unreadable item is skipped - so it is NOT the
   * reader for a payload: what the relation save writes is decided by
   * DatabaseService.sanitizeCreateOrUpdate, and resolveSentSeverityIds reads
   * a payload exactly the way that does.
   */
  public static getIds(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const ids: Set<string> = new Set<string>();

    for (const item of value) {
      let id: string | undefined = undefined;

      if (typeof item === "string") {
        id = item;
      } else if (item instanceof ObjectID) {
        id = item.toString();
      } else if (item && typeof item === "object") {
        const candidate: unknown =
          (item as JSONObject)["_id"] || (item as JSONObject)["id"];

        if (typeof candidate === "string") {
          id = candidate;
        } else if (candidate instanceof ObjectID) {
          id = candidate.toString();
        }
      }

      if (id && id.trim()) {
        ids.add(id.trim().toLowerCase());
      }
    }

    return Array.from(ids).sort();
  }

  /*
   * The severity ids a SENT list asks the relation save to write, read item
   * by item with exactly the precedence DatabaseService.sanitizeCreateOrUpdate
   * uses - an id string or ObjectID, else a string `_id`, else a string `id`,
   * else a model's own `_id` - so the ids this service validates are the ids
   * that would be written. An item that yields no valid uuid is refused
   * rather than skipped: the sanitizer would drop it (or write garbage), and
   * a list that silently lost its only item is a rule for EVERY severity.
   *
   * Trimmed, lower-cased (Postgres hands uuids back lower case, and TypeORM
   * compares join rows as case-sensitive strings) and de-duplicated (the join
   * table's primary key refuses the same severity twice), first occurrence
   * kept. Null is an empty list, as the relation save treats it; anything
   * else that is not a list is refused.
   */
  public static resolveSentSeverityIds(
    value: unknown,
    kind: ComplianceSeverityKind,
  ): Array<string> {
    if (value === null) {
      return [];
    }

    const noun: string =
      kind === ComplianceSeverityKind.Incident ? "incident" : "alert";

    if (!Array.isArray(value)) {
      throw new BadDataException(
        `The ${noun} severities of a compliance rule must be a list of severity ids.`,
      );
    }

    const ids: Array<string> = [];

    for (const item of value) {
      const id: string | undefined =
        TeamComplianceSettingService.resolveWrittenId(item);

      if (id === undefined) {
        throw new BadDataException(
          `Every ${noun} severity of a compliance rule must be a severity id.`,
        );
      }

      const normalised: string = id.trim().toLowerCase();

      ObjectID.validateUUID(normalised);

      if (!ids.includes(normalised)) {
        ids.push(normalised);
      }
    }

    return ids;
  }

  /*
   * Replaces each severity list a payload sends with the list
   * resolveSentSeverityIds read from it, as models carrying only `_id`. From
   * here on the scope that is validated and compared, and the join rows the
   * relation save writes, are one and the same list. Lists that are not sent
   * stay unsent.
   */
  public static normaliseSeverityLists(data: Model | JSONObject): void {
    const target: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;

    for (const list of SEVERITY_LISTS) {
      if (target[list.key] === undefined) {
        continue;
      }

      target[list.key] = TeamComplianceSettingService.resolveSentSeverityIds(
        target[list.key],
        list.kind,
      ).map((id: string): IncidentSeverity | AlertSeverity => {
        return list.buildItem(id);
      });
    }
  }

  // DatabaseService.sanitizeCreateOrUpdate's reading of one EntityArray item.
  private static resolveWrittenId(item: unknown): string | undefined {
    if (typeof item === "string" || item instanceof ObjectID) {
      return item.toString();
    }

    if (!item || typeof item !== "object") {
      return undefined;
    }

    const json: JSONObject = item as JSONObject;

    if (json["_id"] && typeof json["_id"] === "string") {
      return json["_id"];
    }

    if (json["id"] && typeof json["id"] === "string") {
      return json["id"];
    }

    /*
     * A model reaches this line only when its `_id` is empty or not a string,
     * and the sanitizer writes it as it is - with no id a uuid column takes.
     */
    return undefined;
  }

  private static getSeverityIdsOfKind(
    rule: Model,
    kind: ComplianceSeverityKind,
  ): Array<string> {
    return TeamComplianceSettingService.getIds(
      kind === ComplianceSeverityKind.Incident
        ? rule.incidentSeverities
        : rule.alertSeverities,
    );
  }

  /*
   * The update permission check _updateBy makes after this hook, made first.
   * It narrows a copy of the query; this hook's own reads add the project
   * themselves, so only the refusal matters here.
   */
  private async assertMayUpdate(updateBy: UpdateBy<Model>): Promise<void> {
    await ModelPermission.checkUpdateQueryPermissions(
      this.modelType,
      { ...updateBy.query },
      updateBy.data,
      updateBy.props,
    );
  }

  private assertKnownRuleType(value: unknown): ComplianceRuleType {
    if (!ComplianceRule.isKnownRuleType(value)) {
      throw new BadDataException(
        `"${String(value)}" is not a compliance rule type.`,
      );
    }

    return value;
  }

  // Null / undefined is "any channel" and always valid.
  private assertValidChannel(value: unknown): void {
    if (value === undefined || value === null) {
      return;
    }

    if (!ComplianceRule.isKnownChannel(value)) {
      throw new BadDataException(
        `"${String(value)}" is not a notification channel a compliance rule can require.`,
      );
    }
  }

  /*
   * `clearUnsentOptions` also clears the options `data` does not mention, so
   * an update writes them empty on the row instead of leaving what is stored.
   */
  private clearOptionsThatDoNotApply(
    data: Model | JSONObject,
    ruleType: ComplianceRuleType,
    options: { clearUnsentOptions: boolean },
  ): void {
    const target: JSONObject = data as JSONObject;
    const severityKind: ComplianceSeverityKind | undefined =
      ComplianceRule.getSeverityKind(ruleType);

    if (!ComplianceRule.supportsChannel(ruleType)) {
      if (
        options.clearUnsentOptions ||
        (target["notificationChannel"] !== undefined &&
          target["notificationChannel"] !== null)
      ) {
        target["notificationChannel"] = null;
      }
    }

    if (
      severityKind !== ComplianceSeverityKind.Incident &&
      (options.clearUnsentOptions || target["incidentSeverities"] !== undefined)
    ) {
      target["incidentSeverities"] = [];
    }

    if (
      severityKind !== ComplianceSeverityKind.Alert &&
      (options.clearUnsentOptions || target["alertSeverities"] !== undefined)
    ) {
      target["alertSeverities"] = [];
    }
  }

  /*
   * The severity relation accepts any id, and the compliance status is read as
   * root, so a severity from another project would otherwise be stored against
   * this rule and have its name shown on this project's page.
   */
  private async assertSeveritiesBelongToProject(
    projectId: ObjectID,
    scope: ComplianceRuleScope,
  ): Promise<void> {
    if (scope.severityIds.length === 0 || !scope.severityKind) {
      return;
    }

    for (const id of scope.severityIds) {
      ObjectID.validateUUID(id);
    }

    const count: PositiveNumber =
      scope.severityKind === ComplianceSeverityKind.Incident
        ? await IncidentSeverityService.countBy({
            query: {
              _id: new Includes(scope.severityIds),
              projectId: projectId,
            },
            props: {
              isRoot: true,
            },
          })
        : await AlertSeverityService.countBy({
            query: {
              _id: new Includes(scope.severityIds),
              projectId: projectId,
            },
            props: {
              isRoot: true,
            },
          });

    if (count.toNumber() !== scope.severityIds.length) {
      throw new BadDataException(
        `One or more of the selected ${scope.severityKind === ComplianceSeverityKind.Incident ? "incident" : "alert"} severities do not exist in this project.`,
      );
    }
  }

  private async assertNoIdenticalRule(data: {
    teamId: ObjectID;
    projectId: ObjectID;
    scope: ComplianceRuleScope;
    excludeSettingId: ObjectID | undefined;
  }): Promise<void> {
    const query: JSONObject = {
      teamId: data.teamId,
      projectId: data.projectId,
      ruleType: data.scope.ruleType,
    };

    if (data.excludeSettingId) {
      query["_id"] = QueryHelper.notEquals(data.excludeSettingId.toString());
    }

    const siblings: Array<Model> = await this.findBy({
      query: query,
      select: {
        _id: true,
        ruleType: true,
        notificationChannel: true,
        incidentSeverities: {
          _id: true,
        },
        alertSeverities: {
          _id: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const sibling of siblings) {
      const siblingScope: ComplianceRuleScope =
        TeamComplianceSettingService.getScope({
          ruleType: data.scope.ruleType,
          notificationChannel: sibling.notificationChannel,
          incidentSeverities: sibling.incidentSeverities,
          alertSeverities: sibling.alertSeverities,
        });

      if (TeamComplianceSettingService.isSameScope(siblingScope, data.scope)) {
        throw new BadDataException(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
      }
    }
  }
}

export default new TeamComplianceSettingService();
