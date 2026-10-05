import AlertSeverityService from "./AlertSeverityService";
import ProjectReferencesService from "./ProjectReferencesService";
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
 * channels it insists on (empty = any) and the severities it is scoped to
 * (empty = every severity of its kind). Two rules with the same scope check
 * exactly the same thing, which is what "duplicate" means here.
 */
export interface ComplianceRuleScope {
  ruleType: ComplianceRuleType;
  // In catalog order, each once (ComplianceRule.normaliseChannels).
  notificationChannels: Array<ComplianceNotificationChannel>;
  severityKind: ComplianceSeverityKind | null;
  // Sorted, de-duplicated ids of the severity list the rule's kind uses.
  severityIds: Array<string>;
}

// The two columns a rule's channels are stored in.
export interface StoredChannelColumns {
  notificationChannels?: unknown;
  notificationChannel?: unknown;
}

// A severity about to be deleted, as the severity services read it.
export interface DeletedSeverity {
  _id?: string | undefined;
  projectId?: ObjectID | undefined;
}

export const DUPLICATE_COMPLIANCE_RULE_MESSAGE: string =
  "This team already has a compliance rule that checks exactly the same thing. Edit that rule instead of adding another.";

/*
 * The key a severity delete sets to true in TeamComplianceSetting.options on
 * a rule it left with none of the severities it was scoped to (see SEVERITY
 * DELETES below). Such a rule checks nothing until an admin picks new
 * severities: it is paused, it cannot be turned back on as it is, it is no
 * duplicate of anything, and the compliance page says why. Any update that
 * changes the rule's scope removes the key.
 */
export const SEVERITIES_DELETED_OPTION: string = "severitiesDeleted";

export const SEVERITIES_DELETED_ENABLE_MESSAGE: string =
  "Every severity this rule was scoped to has been deleted. Edit the rule to choose new severities before turning it back on.";

export const OPTIONS_DIFFER_MESSAGE: string =
  "These compliance rules carry different options, so their scope cannot be changed in one update. Update them one at a time.";

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

export class TeamComplianceSettingService extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The severities are checked by this service's own hooks
   * (assertSeveritiesBelongToProject), after the rule type has dropped the
   * options it does not use - a stray severity on a rule that does not read
   * one is cleared rather than refused. The team is checked by
   * ProjectReferencesService.
   */
  protected override getListsCheckedByService(): Array<string> {
    return ["incidentSeverities", "alertSeverities"];
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

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

    TeamComplianceSettingService.normaliseChannelFields(createBy.data);

    /*
     * Normalise before anything is stored: a method rule carries no channels
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
      notificationChannels: TeamComplianceSettingService.getStoredChannels(
        createBy.data,
      ),
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
   * Toggling a rule on or off touches none of the fields that define it, so a
   * disable returns before reading anything: it must never fail because of
   * the rule's configuration. Turning a rule ON reads one thing - whether a
   * severity delete left it with nothing to check (SEVERITIES_DELETED_OPTION)
   * - because turning such a rule on as it is would make it check every
   * severity of its kind, a rule nobody wrote.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as JSONObject;

    const changesScope: boolean =
      data["ruleType"] !== undefined ||
      data["notificationChannels"] !== undefined ||
      data["notificationChannel"] !== undefined ||
      data["incidentSeverities"] !== undefined ||
      data["alertSeverities"] !== undefined;

    if (!changesScope) {
      if (data["enabled"] === true) {
        await this.assertNoRuleLeftWithoutSeveritiesIsTurnedOn(updateBy);
      }

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

    TeamComplianceSettingService.normaliseChannelFields(data);

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
    const existingSettings: Array<Model> = await this.findBy({
      query: TeamComplianceSettingService.getTargetQuery(updateBy),
      select: {
        _id: true,
        teamId: true,
        projectId: true,
        ruleType: true,
        notificationChannels: true,
        notificationChannel: true,
        options: true,
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

    /*
     * Every list this update sends is written to every row it matches, so it
     * is checked against the project of every one of those rows - by the
     * list's own kind, not by the row's type. A row whose stored type this
     * build does not recognise (legacy data, or written by a newer build) is
     * skipped by the scope checks below, and the relation save would
     * otherwise link it to another project's severity unchecked.
     */
    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const existing of existingSettings) {
      if (existing.projectId) {
        projectIds.set(existing.projectId.toString(), existing.projectId);
      }
    }

    for (const projectId of projectIds.values()) {
      for (const list of SEVERITY_LISTS) {
        if (data[list.key] === undefined) {
          continue;
        }

        await this.assertSeveritiesBelongToProject(projectId, {
          severityKind: list.kind,
          severityIds: TeamComplianceSettingService.getIds(data[list.key]),
        });
      }
    }

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
        // Sent as a pair by normaliseChannelFields, or not at all.
        notificationChannels: TeamComplianceSettingService.getStoredChannels(
          data["notificationChannels"] !== undefined ? data : existing,
        ),
        incidentSeverities:
          data["incidentSeverities"] !== undefined
            ? data["incidentSeverities"]
            : existing.incidentSeverities,
        alertSeverities:
          data["alertSeverities"] !== undefined
            ? data["alertSeverities"]
            : existing.alertSeverities,
      });

      /*
       * A list this update sends was checked above; one it keeps is the
       * stored list, re-checked here because a type change can make a list
       * the rule did not use until now its scope.
       */
      const isScopeListSent: boolean = SEVERITY_LISTS.some(
        (list: { key: string; kind: ComplianceSeverityKind }): boolean => {
          return (
            list.kind === scope.severityKind && data[list.key] !== undefined
          );
        },
      );

      if (!isScopeListSent) {
        await this.assertSeveritiesBelongToProject(existing.projectId, scope);
      }

      await this.assertNoIdenticalRule({
        teamId: existing.teamId,
        projectId: existing.projectId,
        scope: scope,
        excludeSettingId: existing.id || undefined,
      });
    }

    /*
     * The admin has chosen what the rule checks now - new severities, or
     * deliberately every severity - so a rule a severity delete left empty
     * is an ordinary rule again, in the same write.
     */
    TeamComplianceSettingService.clearSeveritiesDeletedMark(
      data,
      existingSettings,
    );

    return { updateBy, carryForward: null };
  }

  /*
   * An update that turns a rule on without re-scoping it is refused when a
   * severity delete left the rule with nothing to check: turned on as it is,
   * it would check every severity of its kind. The caller's permission is
   * checked first, as for a scope change, so the refusal describes nothing
   * to a caller who may not change the rule.
   */
  private async assertNoRuleLeftWithoutSeveritiesIsTurnedOn(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    if (!updateBy.props.isRoot && !updateBy.props.isMasterAdmin) {
      await this.assertMayUpdate(updateBy);
    }

    const rules: Array<Model> = await this.findBy({
      query: TeamComplianceSettingService.getTargetQuery(updateBy),
      select: {
        _id: true,
        ruleType: true,
        options: true,
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

    if (
      rules.some((rule: Model): boolean => {
        return TeamComplianceSettingService.isLeftWithoutSeverities(rule);
      })
    ) {
      throw new BadDataException(SEVERITIES_DELETED_ENABLE_MESSAGE);
    }
  }

  /*
   * The update's own query, narrowed to the caller's project when there is
   * one - a copy, so the caller's query object is left as it was.
   */
  private static getTargetQuery(updateBy: UpdateBy<Model>): JSONObject {
    const query: JSONObject = { ...(updateBy.query as JSONObject) };

    if (updateBy.props.tenantId) {
      query["projectId"] = updateBy.props.tenantId;
    }

    return query;
  }

  /*
   * True when TeamComplianceSetting.options carries SEVERITIES_DELETED_OPTION.
   * Exported for the compliance status, which lists such a rule as paused
   * with nothing to check.
   */
  public static hasSeveritiesDeletedMark(options: unknown): boolean {
    return (
      TeamComplianceSettingService.isPlainObject(options) &&
      options[SEVERITIES_DELETED_OPTION] === true
    );
  }

  /*
   * A rule a severity delete left with nothing to check: marked, of a type
   * scoped by severity, and still without a severity of its kind. A mark on a
   * rule that has severities again - it lost a race with a re-scope - is
   * stale, and the rule is judged by the severities it has.
   */
  public static isLeftWithoutSeverities(rule: Model): boolean {
    const kind: ComplianceSeverityKind | undefined =
      ComplianceRule.getSeverityKind(rule.ruleType);

    return (
      Boolean(kind) &&
      TeamComplianceSettingService.hasSeveritiesDeletedMark(rule.options) &&
      TeamComplianceSettingService.getSeverityIdsOfKind(rule, kind!).length ===
        0
    );
  }

  /*
   * Writes `options` without SEVERITIES_DELETED_OPTION, keeping every other
   * key: the options sent with the update when it sends any, else the
   * options stored on the rows it changes. `data` is written to every row
   * the update matches, so stored options are only rewritten when those rows
   * agree on them - otherwise one row's options would overwrite another's.
   */
  private static clearSeveritiesDeletedMark(
    data: JSONObject,
    existingSettings: Array<Model>,
  ): void {
    if (data["options"] !== undefined) {
      if (
        TeamComplianceSettingService.isPlainObject(data["options"]) &&
        SEVERITIES_DELETED_OPTION in data["options"]
      ) {
        data["options"] = TeamComplianceSettingService.withoutMark(
          data["options"],
        );
      }

      return;
    }

    const isAnyMarked: boolean = existingSettings.some(
      (existing: Model): boolean => {
        return TeamComplianceSettingService.hasSeveritiesDeletedMark(
          existing.options,
        );
      },
    );

    if (!isAnyMarked) {
      return;
    }

    const cleared: Array<JSONObject | null> = existingSettings.map(
      (existing: Model): JSONObject | null => {
        return TeamComplianceSettingService.isPlainObject(existing.options)
          ? TeamComplianceSettingService.withoutMark(existing.options)
          : null;
      },
    );

    const first: string = JSON.stringify(cleared[0] ?? null);

    if (
      cleared.some((options: JSONObject | null): boolean => {
        return JSON.stringify(options) !== first;
      })
    ) {
      throw new BadDataException(OPTIONS_DIFFER_MESSAGE);
    }

    data["options"] = cleared[0] ?? null;
  }

  // A copy of `options` without the mark; null when nothing else is left.
  private static withoutMark(options: JSONObject): JSONObject | null {
    const rest: JSONObject = { ...options };
    delete rest[SEVERITIES_DELETED_OPTION];

    return Object.keys(rest).length > 0 ? rest : null;
  }

  private static isPlainObject(value: unknown): value is JSONObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
   * rows still say what each rule was scoped to, which rules reference any of
   * the severities about to go (getRulesScopedToAnyOf), and once the delete
   * has actually happened they have those that were left with none paused
   * and marked (pauseRulesLeftWithoutSeverities, SEVERITIES_DELETED_OPTION).
   * The Compliance page lists a marked rule as having lost its severities,
   * for an admin to re-scope or delete; it cannot be turned back on as it is.
   * Pausing only after the delete means a delete that is refused - by the
   * permission layer, or because incidents still use the severity - pauses
   * nothing.
   *
   * ANY reference is carried forward, not only rules scoped to nothing but
   * the severities this delete removes: two deletes running side by side -
   * the two severities of a "Critical and Major" rule, deleted by Terraform
   * in parallel - each see the other's severity still attached before
   * either commits, so neither would carry the rule, and it would be left
   * scoped to nothing and checking everything. Each request re-reads after
   * its own delete has committed, so whichever commits last sees the rule
   * empty and pauses it. A rule that still has another severity is left
   * alone by the re-read.
   *
   * Paused rules are carried too: turning one on later must not make it
   * check every severity either.
   */
  @CaptureSpan()
  public async getRulesScopedToAnyOf(data: {
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
        },
        select: {
          _id: true,
          ruleType: true,
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
        if (
          rule._id &&
          ComplianceRule.getSeverityKind(rule.ruleType) === data.severityKind &&
          TeamComplianceSettingService.getSeverityIdsOfKind(
            rule,
            data.severityKind,
          ).some((id: string): boolean => {
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
   * The second half of a severity delete: of the rules getRulesScopedToAnyOf
   * named, pause and mark (SEVERITIES_DELETED_OPTION) the ones now left with
   * no severity of their kind, in one write per rule's own options so every
   * other key they hold is kept. Re-read rather than assumed, so a rule
   * whose severity survived (the delete matched fewer rows than the lookup
   * did, another of its severities is still there, or it was re-scoped in the
   * meantime) stays as it is.
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
        options: true,
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

    // Rule ids by the options they are written with, marked.
    const toPause: Map<string, { options: JSONObject; ids: Array<string> }> =
      new Map<string, { options: JSONObject; ids: Array<string> }>();
    const paused: Array<string> = [];

    for (const rule of rules) {
      if (
        !rule._id ||
        ComplianceRule.getSeverityKind(rule.ruleType) !== data.severityKind ||
        TeamComplianceSettingService.getSeverityIdsOfKind(
          rule,
          data.severityKind,
        ).length > 0
      ) {
        continue;
      }

      const isAlreadyPausedAndMarked: boolean =
        rule.enabled === false &&
        TeamComplianceSettingService.hasSeveritiesDeletedMark(rule.options);

      if (isAlreadyPausedAndMarked) {
        continue;
      }

      const options: JSONObject = {
        ...(TeamComplianceSettingService.isPlainObject(rule.options)
          ? rule.options
          : {}),
        [SEVERITIES_DELETED_OPTION]: true,
      };

      const key: string = JSON.stringify(options);
      const group: { options: JSONObject; ids: Array<string> } = toPause.get(
        key,
      ) || { options: options, ids: [] };

      group.ids.push(rule._id.toString());
      toPause.set(key, group);
      paused.push(rule._id.toString());
    }

    for (const group of toPause.values()) {
      /*
       * Neither the type, the channels nor a severity list: the update hook
       * reads nothing for it. (Cast: the write type of a JSON column is too
       * deep for the compiler to spell out.)
       */
      const pause: JSONObject = {
        enabled: false,
        options: group.options,
      };

      await this.updateBy({
        query: {
          _id: new Includes(group.ids),
        },
        data: pause as unknown as UpdateBy<Model>["data"],
        limit: group.ids.length,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }

    return paused;
  }

  /*
   * What a rule checks, from its stored (or about-to-be-stored) fields. Only
   * the options its type uses count: channels on a method rule, or alert
   * severities on an incident rule, change nothing about what is checked.
   * `notificationChannels` is a list; see getStoredChannels for reading one
   * off a row.
   */
  public static getScope(data: {
    ruleType: ComplianceRuleType;
    notificationChannels: unknown;
    incidentSeverities: unknown;
    alertSeverities: unknown;
  }): ComplianceRuleScope {
    const severityKind: ComplianceSeverityKind | undefined =
      ComplianceRule.getSeverityKind(data.ruleType);

    const notificationChannels: Array<ComplianceNotificationChannel> =
      ComplianceRule.supportsChannel(data.ruleType)
        ? ComplianceRule.normaliseChannels(data.notificationChannels)
        : [];

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
      notificationChannels: notificationChannels,
      severityKind: severityKind || null,
      severityIds: severityIds,
    };
  }

  /*
   * Both lists are canonical - channels in catalog order, severity ids sorted
   * - so the same selection compares equal however it was picked.
   */
  public static isSameScope(
    a: ComplianceRuleScope,
    b: ComplianceRuleScope,
  ): boolean {
    return (
      a.ruleType === b.ruleType &&
      a.notificationChannels.join(",") === b.notificationChannels.join(",") &&
      a.severityIds.join(",") === b.severityIds.join(",")
    );
  }

  /*
   * CHANNELS. What a rule insists on is the list in notificationChannels -
   * every one of them - and the older notificationChannel column holds the
   * first of that list, for everything that only knows the one column (see
   * the model). What follows keeps the two in step.
   */

  /*
   * The channels a row holds, from its two columns. Every build that knows
   * the list writes the pair together, the single column always the list's
   * first channel. A build that does not - an older replica still serving
   * during an upgrade, or a downgrade - writes only the single column and
   * leaves the list as it was. So a row with no list, or whose list the
   * single column no longer agrees with, was last written by such a build,
   * and its single column is what the rule says; otherwise the list is.
   * Rows from before the list existed have it backfilled by
   * AddTeamComplianceRuleNotificationChannels.
   *
   * The comparison is on the stored values, before anything unknown is
   * dropped, so a list a newer build wrote with a channel this one does not
   * know still counts - for the channels it does know.
   */
  public static getStoredChannels(
    row: StoredChannelColumns,
  ): Array<ComplianceNotificationChannel> {
    const single: unknown = row.notificationChannel ?? null;

    if (Array.isArray(row.notificationChannels)) {
      const first: unknown = row.notificationChannels[0] ?? null;

      if (first === single) {
        return ComplianceRule.normaliseChannels(row.notificationChannels);
      }
    }

    return ComplianceRule.isKnownChannel(single) ? [single] : [];
  }

  /*
   * The channels a SENT list asks for, as the list that will be stored:
   * catalog order, each once (the order they were picked in is not part of
   * the rule). Null is no channels - any channel. Anything else that is not
   * a list of channels this build knows is refused rather than dropped: a
   * list that silently lost a channel checks less than the admin asked for,
   * and one that lost its only channel checks every channel.
   */
  public static resolveSentChannels(
    value: unknown,
  ): Array<ComplianceNotificationChannel> {
    if (value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadDataException(
        "The notification channels of a compliance rule must be a list of channels.",
      );
    }

    for (const item of value) {
      TeamComplianceSettingService.assertKnownChannel(item);
    }

    return ComplianceRule.normaliseChannels(value);
  }

  /*
   * Rewrites whichever channel column a payload sends into the pair that is
   * stored: the list, and the single column set to its first channel. A
   * payload that sends the list is taken at its list, whatever single
   * channel rides along - a client that read a rule and sends it back sends
   * both, and after the list changes the single one it holds is stale. One
   * that sends only the single column (a client from before the list, or an
   * older Dashboard) asks for exactly that channel, or for any channel when
   * it is null. A payload that sends neither leaves both unsent.
   */
  public static normaliseChannelFields(data: Model | JSONObject): void {
    const target: JSONObject = data as JSONObject;
    const sentList: unknown = target["notificationChannels"];
    const sentSingle: unknown = target["notificationChannel"];

    if (sentList === undefined && sentSingle === undefined) {
      return;
    }

    // Null / undefined is "any channel"; anything else must be a channel.
    if (sentSingle !== undefined && sentSingle !== null) {
      TeamComplianceSettingService.assertKnownChannel(sentSingle);
    }

    let channels: Array<ComplianceNotificationChannel> = [];

    if (sentList !== undefined) {
      channels = TeamComplianceSettingService.resolveSentChannels(sentList);
    } else if (ComplianceRule.isKnownChannel(sentSingle)) {
      channels = [sentSingle];
    }

    TeamComplianceSettingService.setChannels(target, channels);
  }

  private static setChannels(
    target: JSONObject,
    channels: Array<ComplianceNotificationChannel>,
  ): void {
    target["notificationChannels"] = channels;
    target["notificationChannel"] = channels[0] ?? null;
  }

  private static assertKnownChannel(value: unknown): void {
    if (!ComplianceRule.isKnownChannel(value)) {
      throw new BadDataException(
        `"${String(value)}" is not a notification channel a compliance rule can require.`,
      );
    }
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

  /*
   * `clearUnsentOptions` also clears the options `data` does not mention, so
   * an update writes them empty on the row instead of leaving what is stored.
   * Channels arrive here already paired by normaliseChannelFields.
   */
  private clearOptionsThatDoNotApply(
    data: Model | JSONObject,
    ruleType: ComplianceRuleType,
    options: { clearUnsentOptions: boolean },
  ): void {
    const target: JSONObject = data as JSONObject;
    const severityKind: ComplianceSeverityKind | undefined =
      ComplianceRule.getSeverityKind(ruleType);

    if (
      !ComplianceRule.supportsChannel(ruleType) &&
      (options.clearUnsentOptions ||
        target["notificationChannels"] !== undefined)
    ) {
      TeamComplianceSettingService.setChannels(target, []);
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
    scope: {
      severityKind: ComplianceSeverityKind | null;
      severityIds: Array<string>;
    },
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
        notificationChannels: true,
        notificationChannel: true,
        options: true,
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
      /*
       * A rule a severity delete left with nothing to check is stored with
       * no severities, which is also how a rule for EVERY severity is
       * stored. It checks nothing and cannot be turned on until it is
       * re-scoped - when it is compared again - so it duplicates nothing.
       */
      if (TeamComplianceSettingService.isLeftWithoutSeverities(sibling)) {
        continue;
      }

      const siblingScope: ComplianceRuleScope =
        TeamComplianceSettingService.getScope({
          ruleType: data.scope.ruleType,
          notificationChannels:
            TeamComplianceSettingService.getStoredChannels(sibling),
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
