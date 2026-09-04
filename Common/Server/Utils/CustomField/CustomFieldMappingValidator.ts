import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { getCustomFieldMappingCompatibilityError } from "../../../Types/CustomField/CustomFieldValueMapping";
import {
  CustomFieldMappingSourceInfo,
  getCustomFieldMappingSources,
} from "../../../Types/CustomField/CustomFieldMappingCatalog";
import BadDataException from "../../../Types/Exception/BadDataException";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CreateBy from "../../Types/Database/CreateBy";
import UpdateBy from "../../Types/Database/UpdateBy";
import {
  CustomFieldMappingSourceEntry,
  CustomFieldMappingTargetEntry,
  getCustomFieldMappingTarget,
} from "./CustomFieldMappingRegistry";

/*
 * Validation for the "map this field's value from a related resource"
 * configuration, run when a custom field DEFINITION is saved.
 *
 * This is the only moment a person is present to fix a bad mapping, and it is
 * worth being strict here because nothing downstream can be. The server never
 * validates a custom field VALUE against its definition — a dropdown value
 * that is not in the option list is accepted, stored, drawn as an uncoloured
 * badge, and cannot be filtered for, because the facet's option list is built
 * from the target definition. A mapping that copies "AWS" into a field
 * offering only "Acme"/"Globex" would manufacture exactly that, silently, on
 * every alert.
 *
 * The checks:
 *   - the resource must be one this definition's resource can actually reach
 *   - the source field must exist in the source's definition table
 *   - both sides must declare a field type, and it must be the same type
 *   - for dropdowns, every option the source can hold must be offered here
 *
 * A definition with no mapping configured skips all of it and costs nothing.
 */

export interface CustomFieldMappingDefinitionState {
  projectId?: ObjectID | undefined;
  customFieldType?: CustomFieldType | undefined;
  dropdownOptions?: string | undefined;
  mapFromResourceType?: string | undefined;
  mapFromCustomFieldName?: string | undefined;
}

export type NormalizeCustomFieldMappingFunction = (
  data: Record<string, unknown>,
) => void;

/*
 * Turning a mapping off has to clear BOTH columns, and `showIf` will not do it
 * for us: it hides the "field to copy from" input but BasicForm still posts the
 * whole value bag, so clearing "Map value from" leaves the field name behind.
 * A half-set mapping is not a state anything downstream should reason about.
 *
 * What this deliberately does NOT do is treat "absent" as "cleared". An update
 * payload is a PARTIAL: changing only the source field name says nothing about
 * the resource, and reading that as "turn the mapping off" would silently
 * delete a working mapping every time someone repointed it at another field.
 * Only an explicitly emptied key clears anything; the merged result is what
 * gets validated, by the caller.
 */
export const normalizeCustomFieldMappingPayload: NormalizeCustomFieldMappingFunction =
  (data: Record<string, unknown>): void => {
    const resource: unknown = data["mapFromResourceType"];
    const fieldName: unknown = data["mapFromCustomFieldName"];

    type IsClearedFunction = (value: unknown) => boolean;

    const isCleared: IsClearedFunction = (value: unknown): boolean => {
      if (value === undefined) {
        return false;
      }

      return typeof value !== "string" || value.trim().length === 0;
    };

    if (isCleared(resource) || isCleared(fieldName)) {
      data["mapFromResourceType"] = null;
      data["mapFromCustomFieldName"] = null;
      return;
    }

    if (resource !== undefined) {
      data["mapFromResourceType"] = (resource as string).trim();
    }

    if (fieldName !== undefined) {
      data["mapFromCustomFieldName"] = (fieldName as string).trim();
    }
  };

type ValidateStateFunction = (data: {
  target: CustomFieldMappingTargetEntry;
  state: CustomFieldMappingDefinitionState;
}) => Promise<void>;

const validateState: ValidateStateFunction = async (data: {
  target: CustomFieldMappingTargetEntry;
  state: CustomFieldMappingDefinitionState;
}): Promise<void> => {
  const resource: string | undefined = data.state.mapFromResourceType;
  const sourceFieldName: string | undefined = data.state.mapFromCustomFieldName;

  if (!resource && !sourceFieldName) {
    return;
  }

  /*
   * Half a mapping is rejected rather than quietly stored. It resolves nothing,
   * and the settings table would show a field claiming to be mapped to nowhere.
   */
  if (!resource || !sourceFieldName) {
    throw new BadDataException(
      "Choose both the resource to copy this field's value from and the field to copy, or leave both empty to enter values by hand.",
    );
  }

  const info: CustomFieldMappingSourceInfo | undefined =
    getCustomFieldMappingSources(data.target.definitionTableName).find(
      (candidate: CustomFieldMappingSourceInfo) => {
        return candidate.resource === resource;
      },
    );

  if (!info) {
    throw new BadDataException(
      `${data.target.targetName} custom fields cannot take their value from "${resource}".`,
    );
  }

  const source: CustomFieldMappingSourceEntry | undefined =
    data.target.sources.find((candidate: CustomFieldMappingSourceEntry) => {
      return candidate.info.resource === resource;
    });

  if (!source) {
    throw new BadDataException(
      `${data.target.targetName} custom fields cannot take their value from "${resource}".`,
    );
  }

  if (!data.state.projectId) {
    throw new BadDataException(
      "ProjectId is required to map a custom field's value from another resource.",
    );
  }

  const sourceDefinitions: Array<BaseModel> = await source
    .getSourceDefinitionService()
    .findBy({
      query: {
        projectId: data.state.projectId,
        name: sourceFieldName,
      },
      select: {
        name: true,
        customFieldType: true,
        dropdownOptions: true,
      },
      limit: 1,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

  const sourceDefinition: BaseModel | undefined = sourceDefinitions[0];

  if (!sourceDefinition) {
    throw new BadDataException(
      `${info.title} does not have a custom field called "${sourceFieldName}". Create it first, or choose a different field.`,
    );
  }

  const compatibilityError: string | null =
    getCustomFieldMappingCompatibilityError({
      targetFieldType: data.state.customFieldType,
      sourceFieldType: (sourceDefinition as any)["customFieldType"],
      targetDropdownOptions: data.state.dropdownOptions,
      sourceDropdownOptions: (sourceDefinition as any)["dropdownOptions"],
      sourceFieldName: sourceFieldName,
    });

  if (compatibilityError) {
    throw new BadDataException(compatibilityError);
  }
};

export type ValidateCustomFieldMappingOnCreateFunction = (data: {
  definitionModelType: { new (): BaseModel };
  createBy: CreateBy<any>;
}) => Promise<void>;

export const validateCustomFieldMappingOnCreate: ValidateCustomFieldMappingOnCreateFunction =
  async (data: {
    definitionModelType: { new (): BaseModel };
    createBy: CreateBy<any>;
  }): Promise<void> => {
    normalizeCustomFieldMappingPayload(
      data.createBy.data as unknown as Record<string, unknown>,
    );

    const target: CustomFieldMappingTargetEntry | undefined =
      getCustomFieldMappingTarget(new data.definitionModelType().tableName!);

    if (!target) {
      /*
       * Six of the nine definition tables carry the columns for lockstep with
       * their siblings but have no reachable source. Refusing a value there is
       * better than accepting one that could never resolve.
       */
      if ((data.createBy.data as any)["mapFromResourceType"]) {
        throw new BadDataException(
          "Custom fields on this resource cannot take their value from another resource.",
        );
      }

      return;
    }

    await validateState({
      target: target,
      state: {
        projectId:
          (data.createBy.props.tenantId as ObjectID | undefined) ||
          (data.createBy.data as any)["projectId"],
        customFieldType: (data.createBy.data as any)["customFieldType"],
        dropdownOptions: (data.createBy.data as any)["dropdownOptions"],
        mapFromResourceType: (data.createBy.data as any)["mapFromResourceType"],
        mapFromCustomFieldName: (data.createBy.data as any)[
          "mapFromCustomFieldName"
        ],
      },
    });
  };

export type ValidateCustomFieldMappingOnUpdateFunction = (data: {
  definitionModelType: { new (): BaseModel };
  definitionService: {
    findBy: (input: any) => Promise<Array<any>>;
  };
  updateBy: UpdateBy<any>;
}) => Promise<void>;

export const validateCustomFieldMappingOnUpdate: ValidateCustomFieldMappingOnUpdateFunction =
  async (data: {
    definitionModelType: { new (): BaseModel };
    definitionService: {
      findBy: (input: any) => Promise<Array<any>>;
    };
    updateBy: UpdateBy<any>;
  }): Promise<void> => {
    normalizeCustomFieldMappingPayload(
      data.updateBy.data as unknown as Record<string, unknown>,
    );

    const payload: Record<string, unknown> = data.updateBy
      .data as unknown as Record<string, unknown>;

    const touchesMapping: boolean = [
      "mapFromResourceType",
      "mapFromCustomFieldName",
      "customFieldType",
      "dropdownOptions",
    ].some((key: string) => {
      return payload[key] !== undefined;
    });

    if (!touchesMapping) {
      return;
    }

    const target: CustomFieldMappingTargetEntry | undefined =
      getCustomFieldMappingTarget(new data.definitionModelType().tableName!);

    if (!target) {
      if (payload["mapFromResourceType"]) {
        throw new BadDataException(
          "Custom fields on this resource cannot take their value from another resource.",
        );
      }

      return;
    }

    /*
     * The payload is a PARTIAL: changing only the source field name must still
     * be checked against the type and options already stored on the row. And
     * narrowing the target's dropdown options must be checked against a
     * mapping that was valid when it was saved.
     */
    const existingRows: Array<BaseModel> = await data.definitionService.findBy({
      query: data.updateBy.query,
      select: {
        projectId: true,
        customFieldType: true,
        dropdownOptions: true,
        mapFromResourceType: true,
        mapFromCustomFieldName: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const row of existingRows) {
      const merged: CustomFieldMappingDefinitionState = {
        projectId: (row as any)["projectId"],
        customFieldType:
          payload["customFieldType"] !== undefined
            ? (payload["customFieldType"] as CustomFieldType)
            : (row as any)["customFieldType"],
        dropdownOptions:
          payload["dropdownOptions"] !== undefined
            ? (payload["dropdownOptions"] as string)
            : (row as any)["dropdownOptions"],
        mapFromResourceType:
          payload["mapFromResourceType"] !== undefined
            ? (payload["mapFromResourceType"] as string) || undefined
            : (row as any)["mapFromResourceType"],
        mapFromCustomFieldName:
          payload["mapFromCustomFieldName"] !== undefined
            ? (payload["mapFromCustomFieldName"] as string) || undefined
            : (row as any)["mapFromCustomFieldName"],
      };

      await validateState({ target: target, state: merged });
    }
  };
