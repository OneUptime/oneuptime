import LabelsElement from "Common/UI/Components/Label/Labels";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green500, Red500 } from "Common/Types/BrandColors";

/*
 * The Workflow Details card's Edit asks for the name and the description,
 * and folds the Enabled switch and the labels under Advanced: a workflow is
 * usually turned on and off from its builder, which says what turning it on
 * does. Three rows, so no steps.
 */
const advancedSection: FormFieldCollapsibleSection<Workflow> =
  getAdvancedFormSection<Workflow>();

const Delete: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(0);

  return (
    <Fragment>
      <CardModelDetail<Workflow>
        name="Workflow > Workflow Details"
        cardProps={{
          title: "Workflow Details",
          description: "Here are more details for this workflow.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Status Page Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            collapsibleSection: advancedSection,
          },
          getLabelsFormField<Workflow>({
            collapsibleSection: advancedSection,
          }),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: Workflow,
          id: "model-detail-workflow",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Workflow ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FieldType.Element,
              getElement: (item: Workflow): ReactElement => {
                if (item.isEnabled) {
                  return (
                    <Pill text="Enabled" color={Green500} isMinimal={true} />
                  );
                }
                return <Pill text="Disabled" color={Red500} isMinimal={true} />;
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              getElement: (item: Workflow): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default Delete;
