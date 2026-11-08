import AuditLogService from "../../Services/AuditLogService";
import DatabaseService from "../../Services/DatabaseService";
import Select from "../../Types/Database/Select";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * LABELS A LABEL RULE ADDS, AND THE AUDIT LOG ENTRY EACH RECORD GETS FOR
 * THEM (issue #6284).
 *
 * Every label rule engine adds the labels its rules match with one relation
 * statement - `relation(Model, "labels").of(id).add(ids)` - which runs no
 * DatabaseService hook, so a rule's labels never reached the audit log,
 * though the same labels added by hand are recorded. Every engine adds them
 * here instead (the LabelRulesRecordTheirLabels guard holds each one to it),
 * and each record it changes gets an Update entry with its labels before and
 * after, named as the recorder names every label:
 *
 *   - by the person who ran the rule (Run now), with their props;
 *   - as OneUptime's own - a system event, kept when the project stores
 *     system events - for a rule applied as a record is created.
 *
 * A record that already had every label adds no entry. The network device
 * rules' Run now adds a page of devices' labels at once, and records them
 * through recordInAuditLog, a few entries at a time. A Run now writes one
 * entry per record it labels and no more - at most one pass of records per
 * request (RULE_RUN_RESOURCES_PER_PASS) - and none are dropped past a cap:
 * an audit log that stops recording changes after some number of them is
 * not one.
 */

// How many entries are written at once.
export const RULE_LABEL_AUDIT_ENTRIES_AT_ONCE: number = 10;

const NAME_COLUMNS: ReadonlyArray<string> = ["name", "title", "displayName"];

export interface RuleLabelsAdded<TModel extends BaseModel> {
  // The record as it was: its id, project, name and labels.
  before: TModel;
  // The labels added to it.
  labelIds: Array<string>;
}

type ModelType<TModel extends BaseModel> = { new (): TModel };

export default class RuleAddedLabels {
  /*
   * Adds `labelIds` - labels of the record's own project, checked by the
   * engine - to one record, leaving out those it has already, and records
   * the change. Answers the labels it added.
   */
  public static async add<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    resourceId: ObjectID;
    labelIds: Array<string>;
    // Who ran the rule; none for a rule applied as the record is created.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<Array<string>> {
    if (data.labelIds.length === 0) {
      return [];
    }

    const before: TModel | null = await data.service.findOneById({
      id: data.resourceId,
      select: RuleAddedLabels.getBeforeSelect(data.service.getModel()),
      props: { isRoot: true },
    });

    if (!before) {
      return [];
    }

    const had: Set<string> = RuleAddedLabels.getLabelIds(before);
    const toAdd: Array<string> = Array.from(new Set<string>(data.labelIds))
      .filter((id: string): boolean => {
        return !had.has(id.toLowerCase());
      });

    if (toAdd.length === 0) {
      return [];
    }

    await data.service
      .getRepository()
      .createQueryBuilder()
      .relation(data.service.modelType, "labels")
      .of(data.resourceId.toString())
      .add(toAdd);

    await RuleAddedLabels.recordInAuditLog({
      modelType: data.service.modelType,
      changes: [{ before, labelIds: toAdd }],
      props: data.props,
    });

    return toAdd;
  }

  /*
   * An Update entry for each record a rule added labels to, its labels
   * before and after, a few at a time. Like every audit write, it never
   * fails the rule it records (AuditLogService).
   */
  public static async recordInAuditLog<TModel extends BaseModel>(data: {
    modelType: ModelType<TModel>;
    changes: Array<RuleLabelsAdded<TModel>>;
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<void> {
    const changes: Array<RuleLabelsAdded<TModel>> = data.changes.filter(
      (change: RuleLabelsAdded<TModel>): boolean => {
        return Boolean(change.before.id) && change.labelIds.length > 0;
      },
    );

    for (
      let start: number = 0;
      start < changes.length;
      start += RULE_LABEL_AUDIT_ENTRIES_AT_ONCE
    ) {
      await Promise.all(
        changes
          .slice(start, start + RULE_LABEL_AUDIT_ENTRIES_AT_ONCE)
          .map(async (change: RuleLabelsAdded<TModel>): Promise<void> => {
            await AuditLogService.recordUpdate({
              model: new data.modelType(),
              before: change.before,
              updatedFields: {
                labels: RuleAddedLabels.getLabelsAfter(change),
              } as unknown as JSONObject,
              itemId: change.before.id!,
              props: data.props || { isRoot: true },
            });
          }),
      );
    }
  }

  /*
   * What a record is read with before labels are added to it: its project,
   * what names it, and its labels with their names - so an entry names
   * them without looking them up.
   */
  public static getBeforeSelect<TModel extends BaseModel>(
    model: TModel,
  ): Select<TModel> {
    const select: Record<string, unknown> = {
      _id: true,
      labels: { _id: true, name: true },
    };
    const tenantColumn: string | null = model.getTenantColumn();

    if (tenantColumn) {
      select[tenantColumn] = true;
    }

    for (const column of NAME_COLUMNS) {
      if (model.isTableColumn(column)) {
        select[column] = true;
      }
    }

    return select as Select<TModel>;
  }

  // A record's labels after a rule added to them: those it had, then the new.
  private static getLabelsAfter<TModel extends BaseModel>(
    change: RuleLabelsAdded<TModel>,
  ): Array<Label> {
    const had: Array<Label> = RuleAddedLabels.getLabels(change.before);
    const hadIds: Set<string> = RuleAddedLabels.getLabelIds(change.before);
    const added: Array<Label> = [];

    for (const id of new Set<string>(change.labelIds)) {
      if (hadIds.has(id.toLowerCase())) {
        continue;
      }

      added.push(new Label(new ObjectID(id)));
    }

    return [...had, ...added];
  }

  private static getLabels<TModel extends BaseModel>(
    record: TModel,
  ): Array<Label> {
    const labels: unknown = (record as unknown as Record<string, unknown>)[
      "labels"
    ];

    return Array.isArray(labels) ? (labels as Array<Label>) : [];
  }

  private static getLabelIds<TModel extends BaseModel>(
    record: TModel,
  ): Set<string> {
    const ids: Set<string> = new Set<string>();

    for (const label of RuleAddedLabels.getLabels(record)) {
      const id: string | undefined = label?._id?.toString();

      if (id) {
        ids.add(id.toLowerCase());
      }
    }

    return ids;
  }
}
