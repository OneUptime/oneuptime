import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "Common/Models/DatabaseModels/Label";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import LabelsElement from "Common/UI/Components/Label/Labels";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelDetailField from "Common/UI/Components/ModelDetail/Field";
import { announceModelHeaderChanged } from "Common/UI/Components/Page/ModelHeaderEvents";
import FieldType from "Common/UI/Components/Types/FieldType";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement } from "react";

/*
 * WHERE A RESOURCE'S NAME, DESCRIPTION, LABELS AND IDENTITY ARE EDITED.
 *
 * "Please also find similar issues across the project and fix them as well.
 * The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer.
 *
 * Depending on the product, a resource's details used to be edited in zero,
 * one or two places: a Kubernetes cluster's name in the Overview's Cluster
 * Details card and again in Settings (its cluster name only in the
 * Overview), a host's nowhere at all - a host discovered as "ip-10-0-3-17"
 * could never be renamed or described. Now every resource telemetry
 * discovers is edited in one place, this card, the first one on its
 * Settings page; an Overview shows the same details read-only, with an
 * "Edit in Settings" link (EditInSettingsLink) that leads here.
 *
 * The card shows the name, the description, what the resource's telemetry
 * is matched on and its labels. Its Edit dialog is one short page:
 *
 *   - the name: a "Display Name" when telemetry is matched on an identifier
 *     of its own (renaming is safe), or the "Name" telemetry is matched on
 *     (Ceph, Proxmox, Docker Swarm, vCenter, IoT fleet, service), whose help
 *     says that a rename has to be made on the agent too;
 *   - the description;
 *   - folded under Advanced: the identifier, when the server lets a person
 *     change it (its column's update permissions say so - a RUM
 *     application's service.name, say, never changes), with help that says
 *     changing it re-keys the resource, and the labels.
 *
 * The server holds a changed identifier or matched name to the create rules
 * (DiscoveredResourceUpdate). A save tells the page header to read the
 * record again (ModelHeaderEvents), so the new name shows at once.
 *
 * Common/Tests/UI/Components/Forms/ResourceDetailsOnePlaceGuard.test.ts
 * keeps it so: no other form edits these fields.
 */

export const RESOURCE_DETAILS_EDIT_BUTTON_TEXT: string =
  translationKey("Edit Details");

export interface ResourceDetailsNameField {
  // "Display Name", or "Name" when telemetry is matched on the name.
  title: string;
  // What renaming does: safe, or a rename to make on the agent too.
  description: string;
  placeholder: string;
}

export interface ResourceIdentityField {
  // The column the telemetry is matched on: "hostIdentifier".
  column: string;
  // Titled after the attribute it must equal: "Host Name (host.name)".
  title: string;
  /*
   * Shown under the field when it can be changed: that telemetry is matched
   * by it, so changing it re-keys the resource.
   */
  description?: string | undefined;
  placeholder?: string | undefined;
}

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  // The read-only details' id.
  id: string;
  // "Host Details".
  title: string;
  description: string;
  nameField: ResourceDetailsNameField;
  descriptionField: { placeholder: string };
  // What the telemetry is matched on, when it is not the name.
  identityFields?: Array<ResourceIdentityField> | undefined;
  // Read-only rows the agent reports, after the identity (a Ceph fsid).
  detailFields?: Array<ModelDetailField<TBaseModel>> | undefined;
  onSaveSuccess?: ((item: TBaseModel) => void) | undefined;
}

/**
 * Whether a person may change a column at all: the column declares who may
 * update it, and a column no one may update (a RUM application's
 * service.name) is shown, never offered for editing.
 */
export function isResourceColumnEditable<TBaseModel extends BaseModel>(
  modelType: { new (): TBaseModel },
  column: string,
): boolean {
  const update: Array<unknown> | undefined = new modelType()
    .getColumnAccessControlFor(column)
    ?.update as Array<unknown> | undefined;

  return Array.isArray(update) && update.length > 0;
}

/*
 * The identifier always holds a value, so "Configured" on the folded section
 * would always show. It says so only for labels, the one thing in there
 * people set by choice.
 */
const hasLabels: <TBaseModel>(values: FormValues<TBaseModel>) => boolean = <
  TBaseModel,
>(
  values: FormValues<TBaseModel>,
): boolean => {
  const labels: unknown = (values as Record<string, unknown>)["labels"];
  return Array.isArray(labels) && labels.length > 0;
};

const ResourceDetailsCard: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const identityFields: Array<ResourceIdentityField> =
    props.identityFields || [];

  const editableIdentityFields: Array<ResourceIdentityField> =
    identityFields.filter((identity: ResourceIdentityField): boolean => {
      return isResourceColumnEditable(props.modelType, identity.column);
    });

  const advancedSection: FormFieldCollapsibleSection<TBaseModel> =
    getAdvancedFormSection<TBaseModel>({
      isConfigured: hasLabels,
    });

  const formFields: Fields<TBaseModel> = [
    {
      field: { name: true } as unknown as SelectFormFields<TBaseModel>,
      title: props.nameField.title,
      description: props.nameField.description,
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: props.nameField.placeholder,
    },
    {
      field: { description: true } as unknown as SelectFormFields<TBaseModel>,
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: props.descriptionField.placeholder,
    },
    ...editableIdentityFields.map(
      (identity: ResourceIdentityField): Field<TBaseModel> => {
        return {
          field: {
            [identity.column]: true,
          } as unknown as SelectFormFields<TBaseModel>,
          title: identity.title,
          ...(identity.description
            ? { description: identity.description }
            : {}),
          fieldType: FormFieldSchemaType.Text,
          required: true,
          ...(identity.placeholder
            ? { placeholder: identity.placeholder }
            : {}),
          collapsibleSection: advancedSection,
        };
      },
    ),
    getLabelsFormField<TBaseModel>({
      collapsibleSection: advancedSection,
    }),
  ];

  const detailFields: Array<ModelDetailField<TBaseModel>> = [
    {
      field: { name: true } as unknown as Select<TBaseModel>,
      title: props.nameField.title,
      fieldType: FieldType.Text,
    },
    {
      field: { description: true } as unknown as Select<TBaseModel>,
      title: "Description",
      fieldType: FieldType.Text,
      placeholder: "No description",
    },
    ...identityFields.map(
      (identity: ResourceIdentityField): ModelDetailField<TBaseModel> => {
        return {
          field: {
            [identity.column]: true,
          } as unknown as Select<TBaseModel>,
          title: identity.title,
          fieldType: FieldType.Text,
        };
      },
    ),
    ...(props.detailFields || []),
    {
      field: {
        labels: {
          name: true,
          color: true,
        },
      } as unknown as Select<TBaseModel>,
      title: "Labels",
      fieldType: FieldType.Element,
      getElement: (item: TBaseModel): ReactElement => {
        return (
          <LabelsElement
            labels={
              ((item as unknown as Record<string, unknown>)["labels"] as
                | Array<Label>
                | undefined) || []
            }
          />
        );
      },
    },
  ];

  return (
    <CardModelDetail<TBaseModel>
      name={props.title}
      cardProps={{
        title: props.title,
        description: props.description,
      }}
      isEditable={true}
      editButtonText={RESOURCE_DETAILS_EDIT_BUTTON_TEXT}
      formFields={formFields}
      onSaveSuccess={(item: TBaseModel): void => {
        // The page header shows the name and the labels: read them again.
        announceModelHeaderChanged({
          modelType: props.modelType,
          modelId: props.modelId,
        });

        if (props.onSaveSuccess) {
          props.onSaveSuccess(item);
        }
      }}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 2,
        modelType: props.modelType,
        id: props.id,
        modelId: props.modelId,
        fields: detailFields,
      }}
    />
  );
};

export default ResourceDetailsCard;
