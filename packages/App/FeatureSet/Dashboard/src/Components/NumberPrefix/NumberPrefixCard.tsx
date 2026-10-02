import {
  NUMBER_PREFIX_EDIT_BUTTON_TITLE,
  NUMBER_PREFIX_EDIT_MODAL_TITLE,
  NUMBER_PREFIX_PAGE_TITLE,
  NumberPrefixPage,
  NumberPrefixRow,
  getNumberPrefixColumns,
} from "./NumberPrefixSettings";
import {
  NumberPrefixExample,
  NumberPrefixPreview,
} from "./NumberPrefixExample";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "../../Pages/Settings/ProjectColumnEditGate";
import Project from "Common/Models/DatabaseModels/Project";
import { translateValidationMessage } from "Common/UI/Components/Forms/Validation";
import FormField from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import DetailField from "Common/UI/Components/ModelDetail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import Select from "Common/Types/BaseDatabase/Select";
import NumberPrefixUtil from "Common/Utils/Project/NumberPrefix";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  page: NumberPrefixPage;
}

/*
 * The card on each product's Number Prefix page: one row per kind of number
 * showing its prefix and the number it makes, and an Update button that
 * edits them all in one dialog, each field previewing its number as it is
 * typed and saying what is wrong with a prefix before it is saved.
 */
const NumberPrefixCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * The permission snapshot arrives on an API response header, so it can be
   * empty on the first paint. Loading the card re-renders the page, which
   * reads the permissions again.
   */
  const [, setIsCardLoaded] = useState<boolean>(false);

  /*
   * The prefixes take Project Owner, Project Admin or Edit Project. The
   * Project table's update list, which the card would otherwise gate on,
   * also lets Manage Billing in, whose save would be refused.
   */
  const editGate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: getNumberPrefixColumns(props.page),
    buttonTitle: NUMBER_PREFIX_EDIT_BUTTON_TITLE,
  });

  const formFields: Array<FormField<Project>> = props.page.rows.map(
    (row: NumberPrefixRow): FormField<Project> => {
      return {
        field: {
          [row.column]: true,
        } as SelectFormFields<Project>,
        title: row.formTitle,
        description: row.formDescription,
        required: false,
        placeholder: row.placeholder,
        fieldType: FormFieldSchemaType.Text,
        dataTestId: `number-prefix-field-${row.column}`,
        customValidation: (values: FormValues<Project>): string | null => {
          const error: string | null = NumberPrefixUtil.getError(
            (values as Record<string, unknown>)[row.column],
          );

          return error ? translateValidationMessage(error) : null;
        },
        getFooterElement: (values: FormValues<Project>): ReactElement => {
          return (
            <NumberPrefixPreview
              value={(values as Record<string, unknown>)[row.column]}
              dataTestId={`number-prefix-preview-${row.column}`}
            />
          );
        },
      };
    },
  );

  const detailFields: Array<DetailField<Project>> = props.page.rows.map(
    (row: NumberPrefixRow): DetailField<Project> => {
      return {
        field: {
          [row.column]: true,
        } as Select<Project>,
        title: row.label,
        fieldType: FieldType.Element,
        getElement: (item: Project): ReactElement => {
          return (
            <NumberPrefixExample
              prefix={
                (item as unknown as Record<string, string | null | undefined>)[
                  row.column
                ]
              }
              dataTestId={`number-prefix-row-${row.column}`}
            />
          );
        },
      };
    },
  );

  return (
    <CardModelDetail<Project>
      name={props.page.name}
      cardProps={{
        title: NUMBER_PREFIX_PAGE_TITLE,
        description: props.page.cardDescription,
        buttons: editGate.lockedButtons,
      }}
      isEditable={editGate.isEditable}
      editButtonText={NUMBER_PREFIX_EDIT_BUTTON_TITLE}
      editModalTitle={NUMBER_PREFIX_EDIT_MODAL_TITLE}
      editModalDescription={props.page.editDescription}
      formFields={formFields}
      modelDetailProps={{
        modelType: Project,
        id: props.page.detailId,
        onItemLoaded: () => {
          setIsCardLoaded(true);
        },
        fields: detailFields,
        modelId: ProjectUtil.getCurrentProjectId()!,
      }}
    />
  );
};

export default NumberPrefixCard;
