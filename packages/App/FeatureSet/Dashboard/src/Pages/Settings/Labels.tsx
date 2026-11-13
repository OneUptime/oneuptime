import ProjectUtil from "Common/UI/Utils/Project";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import LabelElement from "Common/UI/Components/Label/Label";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import useArchivableValues, {
  ArchivableValues,
} from "../../Components/ArchivableValue/UseArchivableValues";
import { ArchivableValueType } from "Common/Utils/ArchivableValues";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import UsedByDialog from "../../Components/UsedBy/UsedByDialog";
import { USED_BY_ACTION } from "../../Components/UsedBy/UsedByWords";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { UsedByRecordKind } from "Common/Types/UsedBy/UsedBy";

const Labels: FunctionComponent<PageComponentProps> = (): ReactElement => {
  // Archive and Unarchive, and the folded Archived section. See the hook.
  const archive: ArchivableValues<Label> = useArchivableValues<Label>({
    modelType: Label,
    type: ArchivableValueType.Label,
    // An archived label looks as it does on everything that has it.
    getNameElement: (item: Label): ReactElement => {
      return <LabelElement label={item} />;
    },
  });

  /*
   * "Used by" (#6813): a label has no page of its own, so each row's ⋯ menu
   * opens what carries it - how many monitors, status pages, incidents and
   * the rest - with the records themselves a click further.
   */
  const [usedByLabelId, setUsedByLabelId] = useState<ObjectID | null>(null);

  return (
    <Fragment>
      <ModelTable<Label>
        modelType={Label}
        actionButtons={[
          {
            title: USED_BY_ACTION,
            icon: IconProp.Link,
            buttonStyleType: ButtonStyleType.NORMAL,
            placement: ActionButtonPlacement.MoreMenu,
            onClick: async (
              item: Label,
              onCompleteAction: VoidFunction,
            ): Promise<void> => {
              if (item._id) {
                setUsedByLabelId(new ObjectID(item._id.toString()));
              }

              onCompleteAction();
            },
          },
          ...archive.actionButtons,
        ]}
        getDeleteConfirmation={archive.getDeleteConfirmation}
        bulkActions={archive.bulkActions}
        refreshToggle={archive.refreshToggle}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...archive.query,
        }}
        id="labels-table"
        name="Settings > Labels"
        userPreferencesKey="labels-table"
        saveFilterProps={{
          tableId: "labels-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Labels",
          description:
            "Group resources with labels. A team's permission can be limited to the resources with certain labels.",
          titleGlossaryTerm: GlossaryTerm.Label,
        }}
        noItemsMessage={"No labels found."}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "internal-service",
            validation: {
              minLength: 2,
            },
            // Not the column's "Any friendly name of this object", written for the API.
            hideColumnDescription: true,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "This label is for all the internal services.",
            hideColumnDescription: true,
          },
          {
            field: {
              color: true,
            },
            title: "Label Color",
            fieldType: FormFieldSchemaType.Color,
            required: true,
            placeholder: "Please select color for this label.",
          },
        ]}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        selectMoreFields={{
          color: true,
        }}
        showViewIdButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              description: true,
            },
            type: FieldType.Text,
            title: "Description",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,

            // A badge: its words read their own way (Pill), its dot the page's.
            getLineText: drawsItsOwnLines,
            getElement: (item: Label): ReactElement => {
              return <LabelElement label={item} />;
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
        ]}
      />
      {archive.element}
      {usedByLabelId ? (
        <UsedByDialog
          recordKind={UsedByRecordKind.Label}
          recordId={usedByLabelId}
          onClose={() => {
            setUsedByLabelId(null);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default Labels;
