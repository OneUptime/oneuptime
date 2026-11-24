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
import UsedByDialog from "../../Components/UsedBy/UsedByDialog";
import { USED_BY_ACTION } from "../../Components/UsedBy/UsedByWords";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { UsedByRecordKind } from "Common/Types/UsedBy/UsedBy";
import { isNameTakenRefusal } from "Common/Types/Database/UniqueName";
import useSharedNames, {
  SharedNamesOfList,
} from "../../Components/SharedName/UseSharedNames";
import { SharedNameKind } from "Common/Types/Database/SharedNames";

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

  /*
   * Labels that share a name with another label (#9856): a label cannot
   * take another label's name, on a create or a rename (#9723), but labels
   * named alike before that keep their names, and every label picker lists
   * the name twice. Marked beside their chip, counted above the list with
   * how to tell them apart - what each one is on, under Used by - and each
   * given Rename as its row's button. Archived labels are in no picker, so
   * a label named as one is not marked.
   */
  const sharedNames: SharedNamesOfList<Label> = useSharedNames<Label>({
    kind: SharedNameKind.Label,
    modelType: Label,
    getNameElement: (item: Label): ReactElement => {
      return <LabelElement label={item} />;
    },
  });

  return (
    <Fragment>
      {/*
       * Above the list while labels share a name: how many, and how to tell
       * them apart. Nothing otherwise.
       */}
      {sharedNames.note}
      <ModelTable<Label>
        modelType={Label}
        actionButtons={[
          sharedNames.renameAction,
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
        refreshToggle={`${archive.refreshToggle}-${sharedNames.refreshToken}`}
        onFetchSuccess={(): void => {
          sharedNames.onListFetched();
        }}
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
        noItemsMessage={"No labels yet."}
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
            // Another label's name, said under the field (#9674).
            ownsServerError: isNameTakenRefusal,
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
          /*
           * The label as its chip, with the pill beside it when another
           * label shares its name (#9856). A badge: its words read their own
           * way (Pill), its dot the page's.
           */
          sharedNames.nameColumn,
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
      {sharedNames.renameModal}
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
