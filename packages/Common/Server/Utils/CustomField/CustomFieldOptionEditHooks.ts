import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
  serializeCustomFieldDropdownOptions,
} from "../../../Types/CustomField/CustomFieldDropdownOption";
import {
  CustomFieldOptionCopier,
  CustomFieldOptionRename,
  CustomFieldOptionRenameMap,
  CustomFieldOptionUsage,
  getCustomFieldOptionRenamesProblem,
  getCustomFieldOptionValues,
  readCustomFieldOptionRenames,
  ReadCustomFieldOptionRenamesResult,
  RENAMED_DROPDOWN_OPTIONS_KEY,
  RenamedCustomFieldOptionList,
  renameCustomFieldOptionsInList,
  toCustomFieldOptionRenameMap,
} from "../../../Types/CustomField/CustomFieldOptionEdit";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import DatabaseService from "../../Services/DatabaseService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../Types/Database/Permissions/Index";
import QueryHelper from "../../Types/Database/QueryHelper";
import UpdateBy from "../../Types/Database/UpdateBy";
import logger, { LogAttributes } from "../Logger";
import {
  CustomFieldMappingSourceEntry,
  CustomFieldMappingTargetEntry,
  getCustomFieldMappingTargets,
} from "./CustomFieldMappingRegistry";
import {
  countCustomFieldOptionValues,
  moveCustomFieldOptionValues,
  renameCustomFieldOptionsInFormTemplates,
  renameCustomFieldOptionsInTableViews,
  updateCustomFieldDropdownOptions,
} from "./CustomFieldOptionRename";
import {
  CustomFieldValueStore,
  getCustomFieldValueStore,
} from "./CustomFieldValueStores";
import { EntityManager } from "typeorm";

/*
 * The two halves of saving a dropdown custom field whose options changed,
 * for every one of the nine custom field definition services (issue #4564):
 *
 *   - prepareCustomFieldOptionEdit, in onBeforeUpdate: reads the renames the
 *     write carries (RENAMED_DROPDOWN_OPTIONS_KEY in its miscDataProps,
 *     CustomFieldOptionEdit), refuses ones that cannot be made, and notes
 *     what the field held before the write;
 *   - applyCustomFieldOptionEdit, in onUpdateSuccess: moves the renamed
 *     values on the field's records and templates (CustomFieldOptionRename),
 *     then its saved views and form templates - and keeps every field that
 *     copies its value from this one offering what this one offers.
 *
 * Without renames nothing is moved: an option taken out of the list, or
 * whose text was changed without saying it was renamed (a Terraform plan, an
 * API client that does not send them), leaves every stored value exactly as
 * it is, and the dashboard shows those values as no longer an option.
 *
 * A FIELD THAT COPIES THIS ONE. An incident, alert or scheduled maintenance
 * field can copy its value from a monitor field (CustomFieldMappingCatalog),
 * and must offer every option the monitor field can hold, or the values it
 * copies are ones it does not offer. So when a monitor field's options are
 * renamed, the copying fields' options are renamed too and their values
 * moved, and every option the monitor field offers that they lack is added
 * to them - in the same transaction as the monitor field's own values.
 */

export interface CustomFieldOptionEditField {
  id: ObjectID;
  projectId: ObjectID;
  // The field's name before the write.
  name: string;
  // The field's options before the write.
  dropdownOptions: string | null;
}

export interface CustomFieldOptionEditCarryForward {
  fields: Array<CustomFieldOptionEditField>;
  renames: Array<CustomFieldOptionRename>;
}

type IsDropdownFunction = (customFieldType: unknown) => boolean;

const isDropdown: IsDropdownFunction = (customFieldType: unknown): boolean => {
  return (
    customFieldType === CustomFieldType.Dropdown ||
    customFieldType === CustomFieldType.MultiSelectDropdown
  );
};

type GetTableNameFunction = (modelType: { new (): BaseModel }) => string;

const getTableName: GetTableNameFunction = (modelType: {
  new (): BaseModel;
}): string => {
  return new modelType().tableName || "";
};

/*
 * A column of a row as it was read. Not getColumnValue, which answers null
 * for an empty value: an option list of "" is still the text to compare a
 * write with.
 */
type ColumnOfFunction = (model: BaseModel, column: string) => unknown;

const columnOf: ColumnOfFunction = (
  model: BaseModel,
  column: string,
): unknown => {
  return (model as unknown as Record<string, unknown>)[column];
};

type ReadStringFunction = (value: unknown) => string | null;

const readString: ReadStringFunction = (value: unknown): string | null => {
  return typeof value === "string" ? value : null;
};

/*
 * The definition tables whose fields other fields copy their values from:
 * today, the monitor custom fields.
 */
type IsMappingSourceFunction = (definitionTableName: string) => boolean;

const isMappingSource: IsMappingSourceFunction = (
  definitionTableName: string,
): boolean => {
  return getCustomFieldMappingTargets().some(
    (target: CustomFieldMappingTargetEntry): boolean => {
      return target.sources.some(
        (source: CustomFieldMappingSourceEntry): boolean => {
          return source.info.sourceDefinitionTableName === definitionTableName;
        },
      );
    },
  );
};

export interface PrepareCustomFieldOptionEditInput {
  definitionModelType: { new (): BaseModel };
  definitionService: DatabaseService<any>;
  updateBy: UpdateBy<any>;
}

/**
 * What applyCustomFieldOptionEdit needs once the write is saved, or null
 * when the write does nothing to any field's options that has to reach
 * further than the field itself. Throws, refusing the write, for renames
 * that cannot be made.
 *
 * The fields are the ones the update writes, read as the incident field
 * rename reads them (findRowsAndHoldUpdateToThem): for a teammate, only the
 * ones they may write, with the update held to them, so a refusal never
 * tells them about a field they cannot reach, and the fields written are
 * the fields whose options were checked.
 */
export const prepareCustomFieldOptionEdit: (
  input: PrepareCustomFieldOptionEditInput,
) => Promise<CustomFieldOptionEditCarryForward | null> = async (
  input: PrepareCustomFieldOptionEditInput,
): Promise<CustomFieldOptionEditCarryForward | null> => {
  const payload: Record<string, unknown> = input.updateBy.data as Record<
    string,
    unknown
  >;

  const read: ReadCustomFieldOptionRenamesResult = readCustomFieldOptionRenames(
    input.updateBy.miscDataProps?.[RENAMED_DROPDOWN_OPTIONS_KEY],
  );

  if (read.problem) {
    throw new BadDataException(read.problem);
  }

  const sendsOptions: boolean = payload["dropdownOptions"] !== undefined;
  const definitionTableName: string = getTableName(input.definitionModelType);

  /*
   * Without renames a new option list only matters beyond the field when
   * other fields copy this one's options.
   */
  if (
    read.renames.length === 0 &&
    (!sendsOptions || !isMappingSource(definitionTableName))
  ) {
    return null;
  }

  const fields: Array<BaseModel> =
    await input.definitionService.findRowsAndHoldUpdateToThem(input.updateBy, {
      _id: true,
      projectId: true,
      name: true,
      customFieldType: true,
      dropdownOptions: true,
    });

  if (read.renames.length > 0) {
    /*
     * A rename moves values of one field; the same list applied to several
     * would move values between options none of them was asked about.
     */
    if (fields.length > 1) {
      throw new BadDataException(
        "Options can be renamed on one custom field at a time. Update a single field to rename its options.",
      );
    }

    const field: BaseModel | undefined = fields[0];

    if (field) {
      const problem: string | null = getCustomFieldOptionRenamesProblem({
        renames: read.renames,
        customFieldType:
          readString(payload["customFieldType"]) ||
          readString(columnOf(field, "customFieldType")),
        dropdownOptions: sendsOptions
          ? readString(payload["dropdownOptions"])
          : readString(columnOf(field, "dropdownOptions")),
      });

      if (problem) {
        throw new BadDataException(problem);
      }
    }
  }

  const editedFields: Array<CustomFieldOptionEditField> = [];

  for (const field of fields) {
    const projectId: ObjectID | undefined = columnOf(field, "projectId") as
      | ObjectID
      | undefined;

    if (!field.id || !projectId) {
      continue;
    }

    editedFields.push({
      id: field.id,
      projectId: projectId,
      name: readString(columnOf(field, "name")) || "",
      dropdownOptions: readString(columnOf(field, "dropdownOptions")),
    });
  }

  if (editedFields.length === 0) {
    return null;
  }

  return {
    fields: editedFields,
    renames: read.renames,
  };
};

/*
 * A field of another resource that copies its value from a field of this
 * one, with what it needs to follow it.
 */
interface CopyingField {
  definitionTableName: string;
  // The copying resource, as the catalog names it: "Incident".
  resource: string;
  definitionService: DatabaseService<any>;
  store: CustomFieldValueStore | undefined;
  id: ObjectID;
  name: string;
  customFieldType: unknown;
  dropdownOptions: string | null;
}

type FindCopyingFieldsFunction = (data: {
  sourceDefinitionTableName: string;
  projectId: ObjectID;
  // The source field's names - before and after a rename - copiers name it by.
  sourceFieldNames: Array<string>;
}) => Promise<Array<CopyingField>>;

/**
 * The fields of the project that copy their value from the named field of
 * this definition table (mapFromResourceType / mapFromCustomFieldName).
 */
const findCopyingFields: FindCopyingFieldsFunction = async (data: {
  sourceDefinitionTableName: string;
  projectId: ObjectID;
  sourceFieldNames: Array<string>;
}): Promise<Array<CopyingField>> => {
  const names: Array<string> = data.sourceFieldNames.filter(
    (name: string, index: number, all: Array<string>): boolean => {
      return Boolean(name) && all.indexOf(name) === index;
    },
  );

  if (names.length === 0) {
    return [];
  }

  const copiers: Array<CopyingField> = [];

  for (const target of getCustomFieldMappingTargets()) {
    for (const source of target.sources) {
      if (
        source.info.sourceDefinitionTableName !== data.sourceDefinitionTableName
      ) {
        continue;
      }

      const definitionService: DatabaseService<any> =
        target.getDefinitionService() as unknown as DatabaseService<any>;

      const rows: Array<BaseModel> = await definitionService.findBy({
        query: {
          projectId: data.projectId,
          mapFromResourceType: source.info.resource,
          mapFromCustomFieldName: QueryHelper.any(names),
        },
        select: {
          _id: true,
          name: true,
          customFieldType: true,
          dropdownOptions: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const row of rows) {
        const name: string | null = readString(columnOf(row, "name"));

        if (!row.id || !name) {
          continue;
        }

        copiers.push({
          definitionTableName: target.definitionTableName,
          resource: target.targetName,
          definitionService: definitionService,
          store: getCustomFieldValueStore(target.definitionTableName),
          id: row.id,
          name: name,
          customFieldType: columnOf(row, "customFieldType"),
          dropdownOptions: readString(columnOf(row, "dropdownOptions")),
        });
      }
    }
  }

  return copiers;
};

export interface ApplyCustomFieldOptionEditInput {
  definitionModelType: { new (): BaseModel };
  definitionService: DatabaseService<any>;
  carryForward: CustomFieldOptionEditCarryForward | null | undefined;
  // The rows the write actually changed.
  updatedItemIds: Array<ObjectID>;
}

interface CopierPlan {
  copier: CopyingField;
  // The copier's new option list, serialized; null when it stays as it is.
  dropdownOptions: string | null;
}

/**
 * Carry a saved option edit to everything that holds the field's values.
 *
 * The values of the field and of every field copying it move in one
 * transaction: all of them or none. When they cannot be moved, the field's
 * options are put back the way they were (unless someone has changed them
 * since) and the failure is thrown, so the save reports an error and the
 * field and its values agree - left renamed, the field would offer an option
 * none of its records hold, while they all hold one it no longer offers.
 * Saved views and form templates are rewritten afterwards; one that cannot
 * be is logged, as the save itself has happened.
 *
 * Awaited by the services, so the settings page reloading after the save
 * already finds the values moved.
 */
export const applyCustomFieldOptionEdit: (
  input: ApplyCustomFieldOptionEditInput,
) => Promise<void> = async (
  input: ApplyCustomFieldOptionEditInput,
): Promise<void> => {
  const carryForward: CustomFieldOptionEditCarryForward | null | undefined =
    input.carryForward;

  if (
    !carryForward ||
    !Array.isArray(carryForward.fields) ||
    carryForward.fields.length === 0 ||
    input.updatedItemIds.length === 0
  ) {
    return;
  }

  const updatedIds: Set<string> = new Set<string>(
    input.updatedItemIds.map((id: ObjectID): string => {
      return id.toString();
    }),
  );

  const definitionTableName: string = getTableName(input.definitionModelType);
  const store: CustomFieldValueStore | undefined =
    getCustomFieldValueStore(definitionTableName);
  const isSource: boolean = isMappingSource(definitionTableName);

  for (const before of carryForward.fields) {
    if (!updatedIds.has(before.id.toString())) {
      continue;
    }

    // The field as it was saved.
    const field: BaseModel | null = await input.definitionService.findOneById({
      id: before.id,
      select: {
        name: true,
        customFieldType: true,
        dropdownOptions: true,
      },
      props: {
        isRoot: true,
      },
    });

    const fieldName: string | null = field
      ? readString(columnOf(field, "name"))
      : null;

    if (
      !field ||
      !fieldName ||
      !isDropdown(columnOf(field, "customFieldType"))
    ) {
      continue;
    }

    const savedOptions: string | null = readString(
      columnOf(field, "dropdownOptions"),
    );

    // Checked before the write; read again, as saved.
    const offered: Set<string> = new Set<string>(
      getCustomFieldOptionValues(savedOptions),
    );

    const renames: CustomFieldOptionRenameMap = toCustomFieldOptionRenameMap(
      carryForward.renames.filter(
        (rename: CustomFieldOptionRename): boolean => {
          return offered.has(rename.to);
        },
      ),
    );

    /*
     * Every option the field offers now: a field that copies it must offer
     * each one (CustomFieldMappingValidator), so whatever it lacks - added
     * by this save, or by an API client before the copying field existed -
     * is added to it.
     */
    const offeredOptions: Array<CustomFieldDropdownOption> =
      parseCustomFieldDropdownOptions(savedOptions);

    const copiers: Array<CopyingField> = isSource
      ? await findCopyingFields({
          sourceDefinitionTableName: definitionTableName,
          projectId: before.projectId,
          sourceFieldNames: [before.name, fieldName],
        })
      : [];

    const plans: Array<CopierPlan> = copiers
      .filter((copier: CopyingField): boolean => {
        return isDropdown(copier.customFieldType);
      })
      .map((copier: CopyingField): CopierPlan => {
        const result: RenamedCustomFieldOptionList =
          renameCustomFieldOptionsInList({
            options: parseCustomFieldDropdownOptions(copier.dropdownOptions),
            renames: renames,
            addOptions: offeredOptions,
          });

        return {
          copier: copier,
          dropdownOptions: result.changed
            ? serializeCustomFieldDropdownOptions(result.options)
            : null,
        };
      });

    if (
      renames.size === 0 &&
      !plans.some((plan: CopierPlan): boolean => {
        return plan.dropdownOptions !== null;
      })
    ) {
      continue;
    }

    const logAttributes: LogAttributes = {
      projectId: before.projectId.toString(),
    } as LogAttributes;

    const moved: Record<string, number> = {};

    try {
      await input.definitionService
        .getRepository()
        .manager.transaction(async (manager: EntityManager): Promise<void> => {
          if (renames.size > 0 && store) {
            for (const service of store.getValueServices()) {
              moved[service.getModel().tableName || "records"] =
                await moveCustomFieldOptionValues({
                  service: service,
                  projectId: before.projectId,
                  fieldName: fieldName,
                  renames: renames,
                  manager: manager,
                });
            }
          }

          for (const plan of plans) {
            if (plan.dropdownOptions !== null) {
              await updateCustomFieldDropdownOptions({
                service: plan.copier.definitionService,
                fieldId: plan.copier.id,
                expectedDropdownOptions: plan.copier.dropdownOptions,
                dropdownOptions: plan.dropdownOptions,
                manager: manager,
              });
            }

            if (renames.size > 0 && plan.copier.store) {
              for (const service of plan.copier.store.getValueServices()) {
                const key: string = `${service.getModel().tableName || "records"}.${plan.copier.name}`;

                moved[key] = await moveCustomFieldOptionValues({
                  service: service,
                  projectId: before.projectId,
                  fieldName: plan.copier.name,
                  renames: renames,
                  manager: manager,
                });
              }
            }
          }
        });
    } catch (error) {
      logger.error(
        `Could not carry the option changes of ${
          store?.definitionName || "custom field"
        } ${JSON.stringify(fieldName)} to its values; none were moved.`,
        logAttributes,
      );
      logger.error(error, logAttributes);

      /*
       * Only renames leave the field and its values disagreeing; options
       * added to the fields that copy this one are added again by the next
       * save of either.
       */
      if (renames.size === 0) {
        continue;
      }

      try {
        await input.definitionService.updateColumnsByIdWithoutHooks({
          id: before.id,
          data: { dropdownOptions: before.dropdownOptions } as never,
          expectedData: { dropdownOptions: savedOptions } as never,
        });
      } catch (restoreError) {
        logger.error(restoreError, logAttributes);
      }

      throw error;
    }

    if (renames.size === 0) {
      continue;
    }

    // Where the values are remembered rather than stored.
    const remembered: Array<{
      store: CustomFieldValueStore | undefined;
      id: ObjectID;
      name: string;
    }> = [
      { store: store, id: before.id, name: fieldName },
      ...plans.map(
        (
          plan: CopierPlan,
        ): {
          store: CustomFieldValueStore | undefined;
          id: ObjectID;
          name: string;
        } => {
          return {
            store: plan.copier.store,
            id: plan.copier.id,
            name: plan.copier.name,
          };
        },
      ),
    ];

    let views: number = 0;
    let forms: number = 0;

    for (const entry of remembered) {
      if (!entry.store) {
        continue;
      }

      try {
        views += await renameCustomFieldOptionsInTableViews({
          projectId: before.projectId,
          tableIds: entry.store.savedViewTableIds,
          fieldName: entry.name,
          renames: renames,
        });
      } catch (error) {
        logger.error(error, logAttributes);
      }

      if (!entry.store.formTargetType) {
        continue;
      }

      try {
        forms += await renameCustomFieldOptionsInFormTemplates({
          projectId: before.projectId,
          targetType: entry.store.formTargetType,
          customFieldId: entry.id,
          renames: renames,
        });
      } catch (error) {
        logger.error(error, logAttributes);
      }
    }

    logger.info(
      `Renamed ${renames.size} option(s) of ${
        store?.definitionName || "custom field"
      } ${JSON.stringify(fieldName)}: ${JSON.stringify(
        moved,
      )} records moved, ${views} saved views and ${forms} forms rewritten.`,
      logAttributes,
    );
  }
};

export interface GetCustomFieldOptionUsageInput {
  definitionModelType: { new (): BaseModel };
  definitionService: DatabaseService<any>;
  fieldId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

/**
 * How many of the project's records hold each value of a dropdown field,
 * and which fields copy it: what the option editor says a rename or a
 * removal will touch. Asked by someone editing the field, so it takes what
 * editing it takes - reading the field, and changing the project's fields of
 * its kind. The counts are of every record of the project, as the move would
 * be; only the counts are told, never which records.
 */
export const getCustomFieldOptionUsage: (
  input: GetCustomFieldOptionUsageInput,
) => Promise<CustomFieldOptionUsage> = async (
  input: GetCustomFieldOptionUsageInput,
): Promise<CustomFieldOptionUsage> => {
  const field: BaseModel | null = await input.definitionService.findOneById({
    id: input.fieldId,
    select: {
      name: true,
      customFieldType: true,
      projectId: true,
    },
    props: input.props,
  });

  const name: string | null = field
    ? readString(columnOf(field, "name"))
    : null;
  const projectId: ObjectID | undefined = field
    ? (columnOf(field, "projectId") as ObjectID | undefined)
    : undefined;

  if (!field || !name || !projectId) {
    throw new NotFoundException("Custom field not found.");
  }

  ModelPermission.checkTableWritePermission(
    input.definitionModelType,
    input.props,
    DatabaseRequestType.Update,
  );

  const usage: CustomFieldOptionUsage = { values: [], copiedBy: [] };

  if (!isDropdown(columnOf(field, "customFieldType"))) {
    return usage;
  }

  const definitionTableName: string = getTableName(input.definitionModelType);
  const store: CustomFieldValueStore | undefined =
    getCustomFieldValueStore(definitionTableName);

  if (store) {
    usage.values = await countCustomFieldOptionValues({
      service: store.getRecordService(),
      projectId: projectId,
      fieldName: name,
    });
  }

  if (isMappingSource(definitionTableName)) {
    usage.copiedBy = (
      await findCopyingFields({
        sourceDefinitionTableName: definitionTableName,
        projectId: projectId,
        sourceFieldNames: [name],
      })
    ).map((copier: CopyingField): CustomFieldOptionCopier => {
      return {
        resource: copier.resource,
        fieldName: copier.name,
      };
    });
  }

  return usage;
};
