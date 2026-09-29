import DatabaseService from "./DatabaseService";
import IncidentFormService from "./IncidentFormService";
import IncidentService from "./IncidentService";
import IncidentTemplateService from "./IncidentTemplateService";
import Model from "../../Models/DatabaseModels/IncidentCustomField";
import BadDataException from "../../Types/Exception/BadDataException";
import { INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS } from "../../Types/CustomField/CustomFieldSavedViews";
import { generateCustomFieldVariableKey } from "../../Types/CustomField/CustomFieldVariableKey";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import QueryHelper from "../Types/Database/QueryHelper";
import Query from "../Types/Database/Query";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import logger, { LogAttributes } from "../Utils/Logger";
import { backfillMappedCustomFieldValues } from "../Utils/CustomField/CustomFieldDefinitionMappingHooks";
import {
  validateCustomFieldMappingOnCreate,
  validateCustomFieldMappingOnUpdate,
} from "../Utils/CustomField/CustomFieldMappingValidator";
import { renameCustomField } from "../Utils/CustomField/CustomFieldRename";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * An incident custom field can take its value from the same field on the
 * incident's monitors instead of being typed in again
 * (OneUptime/oneuptime#3549). These hooks are the two halves of that
 * configuration being saved: refusing a mapping that could never resolve, and
 * filling in the incidents that already exist once one is saved.
 *
 * They also look after the two things an incident field is known by besides
 * its settings:
 *
 *   - its template key (variableKey), made from the name on create and never
 *     changed afterwards, so templates that use {{customFields.<key>}} keep
 *     working whatever the field is renamed to - and taken off every
 *     incident form's questions when the field is deleted (see
 *     onDeleteSuccess);
 *   - its name, which is what incidents store its values under. Renaming a
 *     field moves those values, and the saved views that name it, to the new
 *     name (see onUpdateSuccess).
 */

/*
 * What onBeforeUpdate hands to onUpdateSuccess: for a write that renames a
 * field, the name each field had before it, by field id.
 */
type RenameCarryForward = Dictionary<{
  oldName: string;
  projectId: ObjectID;
}> | null;

/*
 * What onBeforeDelete hands to onDeleteSuccess: each field the delete may
 * remove, with the project and template key it is known by - read before
 * the rows are gone.
 */
type DeleteCarryForward = Array<{
  id: string;
  projectId: ObjectID;
  variableKey: string;
}> | null;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await validateCustomFieldMappingOnCreate({
      definitionModelType: Model,
      createBy: createBy,
    });

    createBy.data.variableKey = await this.generateVariableKey(createBy);

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * The template key never changes after create. Dropped rather than
     * refused, so a client that saves back the whole record it read (key
     * included) is not rejected for it.
     */
    delete (updateBy.data as Dictionary<unknown>)["variableKey"];

    await validateCustomFieldMappingOnUpdate({
      definitionModelType: Model,
      definitionService: this,
      updateBy: updateBy,
    });

    const carryForward: RenameCarryForward = await this.prepareRename(updateBy);

    return { updateBy, carryForward: carryForward };
  }

  /*
   * The fields this delete may remove, read while they still exist: once
   * they are gone, nothing says which forms asked them. As root, and limited
   * to the caller's project, as prepareRename reads - the delete's own
   * permission check has not run yet; onDeleteSuccess only acts on the rows
   * it actually removed.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const query: Query<Model> =
      !deleteBy.props.isRoot && deleteBy.props.tenantId
        ? {
            ...deleteBy.query,
            projectId: deleteBy.props.tenantId,
          }
        : deleteBy.query;

    const fields: Array<Model> = await this.findBy({
      query: query,
      select: {
        _id: true,
        projectId: true,
        variableKey: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const carryForward: DeleteCarryForward = [];

    for (const field of fields) {
      if (field.id && field.projectId && field.variableKey) {
        carryForward.push({
          id: field.id.toString(),
          projectId: field.projectId,
          variableKey: field.variableKey,
        });
      }
    }

    return { deleteBy, carryForward: carryForward };
  }

  /*
   * A deleted field is taken off every incident form of its project (see
   * IncidentFormService.removeCustomFieldFromQuestions): otherwise a field
   * created later under the same key would appear on those public forms at
   * once. Incident templates keep their settings for it, on purpose.
   *
   * The field is already gone, so a failure here is logged rather than
   * thrown: the delete stands either way.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deletedIds: Set<string> = new Set<string>(
      itemIdsBeforeDelete.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    for (const field of (onDelete.carryForward as DeleteCarryForward) || []) {
      if (!deletedIds.has(field.id)) {
        continue;
      }

      try {
        await IncidentFormService.removeCustomFieldFromQuestions({
          projectId: field.projectId,
          variableKey: field.variableKey,
        });
      } catch (err) {
        logger.error(
          `IncidentCustomFieldService: could not take the deleted incident custom field "${field.variableKey}" off the incident forms of project ${field.projectId.toString()}; a field created later with the same key would be asked on them.`,
          {
            projectId: field.projectId.toString(),
          } as LogAttributes,
        );
        logger.error(err, {
          projectId: field.projectId.toString(),
        } as LogAttributes);
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    backfillMappedCustomFieldValues({
      definitionModelType: Model,
      projectId: createdItem.projectId,
      definitionName: "incident custom field",
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Before the mapping backfill below, which writes mapped values under the
     * field's name: by then the values already stored have to be under the
     * new name too.
     */
    await this.moveValuesOfRenamedFields({
      carryForward: onUpdate.carryForward as RenameCarryForward,
      updatedItemIds: updatedItemIds,
    });

    if (updatedItemIds.length > 0) {
      backfillMappedCustomFieldValues({
        definitionModelType: Model,
        projectId: await this.getProjectIdForBackfill(onUpdate, updatedItemIds),
        definitionName: "incident custom field",
      });
    }

    return onUpdate;
  }

  /*
   * The key for a new field: made from its name, and not one another field of
   * the project already has. Whatever the client sent is replaced, like the
   * other columns this service owns.
   *
   * Two fields created at the same moment could both be handed the same key;
   * the unique (projectId, variableKey) index then refuses the second create,
   * which can simply be retried, rather than letting two fields share a key.
   */
  private async generateVariableKey(
    createBy: CreateBy<Model>,
  ): Promise<string> {
    const projectId: ObjectID | undefined =
      (createBy.props.tenantId as ObjectID | undefined) ||
      createBy.data.projectId;

    const existing: Array<Model> = projectId
      ? await this.findBy({
          query: {
            projectId: projectId,
          },
          select: {
            variableKey: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        })
      : [];

    return generateCustomFieldVariableKey({
      name: createBy.data.name || "",
      existingKeys: existing.map((field: Model) => {
        return field.variableKey;
      }),
    });
  }

  /*
   * For a write that sets a name: the fields it renames, with the names they
   * had, and a refusal when the rename cannot be done safely.
   *
   * The store is read as root, like IncidentService reads incidents for its
   * update hooks, and limited to the caller's project: the update's own
   * permission check has not run yet, and a non-root caller must not learn
   * anything about another project's fields from a refusal.
   */
  private async prepareRename(
    updateBy: UpdateBy<Model>,
  ): Promise<RenameCarryForward> {
    const newName: unknown = updateBy.data.name;

    if (typeof newName !== "string") {
      return null;
    }

    const query: Query<Model> =
      !updateBy.props.isRoot && updateBy.props.tenantId
        ? {
            ...updateBy.query,
            projectId: updateBy.props.tenantId,
          }
        : updateBy.query;

    const fields: Array<Model> = await this.findBy({
      query: query,
      select: {
        _id: true,
        name: true,
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const renamed: Array<Model> = fields.filter((field: Model) => {
      return Boolean(field.id && field.projectId) && field.name !== newName;
    });

    if (renamed.length === 0) {
      return null;
    }

    /*
     * One name for several fields would leave them all storing their values
     * under the same key, merged beyond repair.
     */
    if (fields.length > 1) {
      throw new BadDataException(
        "Incident custom fields can only be renamed one at a time. Update a single field to change its name.",
      );
    }

    const field: Model = renamed[0]!;

    /*
     * Creating a field already refuses a name another field has
     * (UniqueColumnBy, case-insensitively), but an update does not check it,
     * and a rename onto another field's name would move this field's values
     * over that field's.
     */
    const clashes: number = (
      await this.countBy({
        query: {
          projectId: field.projectId!,
          name: QueryHelper.findWithSameText(newName),
          _id: QueryHelper.notEquals(field.id!.toString()),
        },
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    if (clashes > 0) {
      throw new BadDataException(
        "Another incident custom field already has this name. Choose a different name.",
      );
    }

    return {
      [field.id!.toString()]: {
        oldName: field.name || "",
        projectId: field.projectId!,
      },
    };
  }

  /*
   * Incidents store a field's values under its name, and incident templates
   * store the values they fill in the same way, so a renamed field's values
   * are moved to the new name in both, together with the saved views of the
   * incidents table that name it. Values a record held under the new name
   * without holding the old one - a deleted field's, which deleting leaves
   * behind - are cleared, so the renamed field never shows (or sends to
   * subscribers) answers that were never its own.
   *
   * With raw SQL (CustomFieldRename), not an update through this or any
   * other service: that would start the "On Update Incident" workflow for
   * every incident holding a value, and a rename changes no incident's
   * answers.
   *
   * The name is read back from the store rather than taken from the request,
   * so the values move to exactly the name that was saved. Awaited, so the
   * card reloading after the save already finds them under the new name.
   */
  private async moveValuesOfRenamedFields(data: {
    carryForward: RenameCarryForward;
    updatedItemIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.carryForward || data.updatedItemIds.length === 0) {
      return;
    }

    const renamedIds: Array<ObjectID> = data.updatedItemIds.filter(
      (id: ObjectID) => {
        return Boolean(data.carryForward![id.toString()]);
      },
    );

    if (renamedIds.length === 0) {
      return;
    }

    const fields: Array<Model> = await this.findBy({
      query: {
        _id: QueryHelper.any(
          renamedIds.map((id: ObjectID) => {
            return id.toString();
          }),
        ),
      },
      select: {
        _id: true,
        name: true,
      },
      limit: renamedIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const field of fields) {
      const before: { oldName: string; projectId: ObjectID } | undefined =
        data.carryForward[field.id!.toString()];

      if (!before || !field.name || field.name === before.oldName) {
        continue;
      }

      const newName: string = field.name;

      await renameCustomField({
        projectId: before.projectId,
        oldName: before.oldName,
        newName: newName,
        valueServices: [IncidentService, IncidentTemplateService],
        tableViewIds: INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS,
        definitionName: "incident custom field",
        /*
         * The values are all still under the old name: so is the field,
         * again, and the save fails. Left renamed, the field would show
         * none of its values, and renaming it back would clear them (the
         * move clears stale values under the name it moves to). Hook-free,
         * so the rename is not attempted again, and only if nobody has
         * renamed the field since.
         */
        onValuesNotMoved: async (): Promise<void> => {
          await this.updateColumnsByIdWithoutHooks({
            id: field.id!,
            data: { name: before.oldName },
            expectedData: { name: newName },
          });
        },
      });
    }
  }

  /*
   * `props.tenantId` is set on every dashboard write but not on internal
   * root-scoped ones, so fall back to the row itself rather than skipping the
   * backfill for a mapping that was changed by a script.
   */
  private async getProjectIdForBackfill(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<ObjectID | undefined> {
    const tenantId: ObjectID | undefined = onUpdate.updateBy.props.tenantId as
      | ObjectID
      | undefined;

    if (tenantId) {
      return tenantId;
    }

    const item: Model | null = await this.findOneById({
      id: updatedItemIds[0]!,
      select: { projectId: true },
      props: { isRoot: true },
    });

    return item?.projectId;
  }
}
export default new Service();
