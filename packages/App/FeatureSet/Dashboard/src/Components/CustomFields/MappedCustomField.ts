import {
  CustomFieldFormCopy,
  MAPPED_CUSTOM_FIELD_SOURCE_COPY,
  MappedCustomFieldSourceCopy,
} from "./CustomFieldSettingsCopy";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import { CustomFieldMappingSourceInfo } from "Common/Types/CustomField/CustomFieldMappingCatalog";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import BadDataException from "Common/Types/Exception/BadDataException";

/*
 * A mapped custom field: one whose value is copied from a custom field of a
 * related resource (an incident's monitor) instead of being typed in.
 *
 * The maintainer: "when I create a new custom field By default, it should be
 * 'Enter values by hand.' If I want to create a mapped custom field, I can go
 * to the model table header. In the more options, there should be an option
 * to create a mapped custom field. When I click on that, only show me those
 * options."
 *
 * So a custom field settings card whose resource has something to copy from
 * (CustomFieldMappingCatalog: alerts, incidents and scheduled maintenance
 * events, from their monitors) has a "Create Mapped Custom Field" item in its
 * More menu, and its dialog asks for the field to copy, a name and a
 * description - nothing else. The new field takes the type and a dropdown's
 * options from the field it copies, which is also what the server requires of
 * a mapping (CustomFieldMappingValidator: the same type, and every option the
 * source can hold).
 *
 * The plain Create form never asks where values come from: they are typed in.
 * A field's mapping can still be changed, or turned off, from its Edit form,
 * under Advanced.
 *
 * Kept free of React, so App/Tests can read it.
 */

/*
 * The definition table a source's fields are listed in, as the model class
 * the picker and the save query. The catalog lives in Types (no models) so
 * the server can read it too; this is where it is bridged back.
 */
export const MAPPING_SOURCE_DEFINITION_MODELS: Record<
  string,
  DatabaseBaseModelType
> = {
  MonitorCustomField: MonitorCustomField,
};

export type GetMappingSourceDefinitionModelFunction = (
  source: CustomFieldMappingSourceInfo,
) => DatabaseBaseModelType | undefined;

export const getMappingSourceDefinitionModel: GetMappingSourceDefinitionModelFunction =
  (source: CustomFieldMappingSourceInfo): DatabaseBaseModelType | undefined => {
    return MAPPING_SOURCE_DEFINITION_MODELS[source.sourceDefinitionTableName];
  };

export type GetMappedCustomFieldSourceCopyFunction = (
  source: CustomFieldMappingSourceInfo,
) => MappedCustomFieldSourceCopy;

// What the mapped field dialog and the Edit form say about a source.
export const getMappedCustomFieldSourceCopy: GetMappedCustomFieldSourceCopyFunction =
  (source: CustomFieldMappingSourceInfo): MappedCustomFieldSourceCopy => {
    return MAPPED_CUSTOM_FIELD_SOURCE_COPY[source.resource];
  };

export type GetMappedCustomFieldMenuTitleFunction = (data: {
  source: CustomFieldMappingSourceInfo;
  // How many sources the card's resource can copy from.
  sourceCount: number;
}) => string;

/**
 * The More menu item that opens the dialog. Today every resource has one
 * source, the monitor; should one get two, each gets its own item, named
 * after its source.
 */
export const getMappedCustomFieldMenuTitle: GetMappedCustomFieldMenuTitleFunction =
  (data: {
    source: CustomFieldMappingSourceInfo;
    sourceCount: number;
  }): string => {
    if (data.sourceCount <= 1) {
      return CustomFieldFormCopy.createMappedFieldTitle;
    }

    return `${CustomFieldFormCopy.createMappedFieldTitle} (${data.source.title})`;
  };

export type GetNameAfterSourcePickFunction = (data: {
  // The name the form holds now.
  currentName: unknown;
  // The source field picked before this pick, if any.
  previousSourceFieldName: unknown;
  // The source field just picked.
  sourceFieldName: string;
}) => string;

/**
 * The new field's name once a source field is picked: the source field's
 * name, unless the field already has a name of its own - one typed in,
 * rather than one an earlier pick put there.
 */
export const getNameAfterSourcePick: GetNameAfterSourcePickFunction = (data: {
  currentName: unknown;
  previousSourceFieldName: unknown;
  sourceFieldName: string;
}): string => {
  const currentName: string =
    typeof data.currentName === "string" ? data.currentName : "";

  const previousSourceFieldName: string =
    typeof data.previousSourceFieldName === "string"
      ? data.previousSourceFieldName
      : "";

  if (
    currentName.trim().length === 0 ||
    currentName === previousSourceFieldName
  ) {
    return data.sourceFieldName;
  }

  return currentName;
};

export interface MappedSourceDefinition {
  name?: string | undefined;
  customFieldType?: CustomFieldType | undefined;
  dropdownOptions?: string | undefined;
}

export interface MappedCustomFieldColumns {
  mapFromResourceType: string;
  mapFromCustomFieldName: string;
  customFieldType: CustomFieldType;
  // Only a dropdown's: the source's options, every one of them.
  dropdownOptions?: string | undefined;
}

export type GetMappedCustomFieldColumnsFunction = (data: {
  source: CustomFieldMappingSourceInfo;
  sourceFieldName: string;
  // The source field as it is stored now; undefined when it is gone.
  sourceDefinition: MappedSourceDefinition | undefined;
}) => MappedCustomFieldColumns;

/**
 * What a new mapped field is saved with besides its name and description:
 * where it copies from, and the type - and a dropdown's options - of the
 * field it copies, read when it is saved.
 *
 * Throws when the source field is gone or has no type, saying so: the
 * server would refuse the mapping anyway, less clearly.
 */
export const getMappedCustomFieldColumns: GetMappedCustomFieldColumnsFunction =
  (data: {
    source: CustomFieldMappingSourceInfo;
    sourceFieldName: string;
    sourceDefinition: MappedSourceDefinition | undefined;
  }): MappedCustomFieldColumns => {
    if (!data.sourceDefinition) {
      throw new BadDataException(
        `${data.source.title} does not have a custom field called "${data.sourceFieldName}" any more. Pick another one.`,
      );
    }

    const customFieldType: CustomFieldType | undefined =
      data.sourceDefinition.customFieldType;

    if (
      !customFieldType ||
      !Object.values(CustomFieldType).includes(customFieldType)
    ) {
      throw new BadDataException(
        `The ${data.source.title.toLowerCase()} custom field "${data.sourceFieldName}" has no field type, so it cannot be copied. Give it one first.`,
      );
    }

    const columns: MappedCustomFieldColumns = {
      mapFromResourceType: data.source.resource,
      mapFromCustomFieldName: data.sourceFieldName,
      customFieldType: customFieldType,
    };

    if (
      customFieldType === CustomFieldType.Dropdown ||
      customFieldType === CustomFieldType.MultiSelectDropdown
    ) {
      columns.dropdownOptions = data.sourceDefinition.dropdownOptions || "";
    }

    return columns;
  };
