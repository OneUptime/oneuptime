import AlertSeverityService from "./AlertSeverityService";
import DatabaseService from "./DatabaseService";
import IncidentSeverityService from "./IncidentSeverityService";
import Model from "../../Models/DatabaseModels/TeamComplianceSetting";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
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

export const DUPLICATE_COMPLIANCE_RULE_MESSAGE: string =
  "This team already has a compliance rule that checks exactly the same thing. Edit that rule instead of adding another.";

export class TeamComplianceSettingService extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
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
     * update lands. Scoped to the caller's project when there is one - this
     * runs before the update's own permission check, so it must not be a way
     * to learn about another project's rules.
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
   * Severity ids from whatever shape a relation value arrives in: an id
   * string, an ObjectID, a model, or `{_id}` / `{id}` JSON - create hooks run
   * before the payload is normalised into models, so all of them occur.
   * Sorted and de-duplicated so two lists compare by content, and lower-cased
   * because Postgres compares uuids without case and hands them back lower
   * case: "ABC..." sent by a client is the stored "abc...", and must not slip
   * past the duplicate check as a different id.
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
