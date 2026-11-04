import DataIssueReport from "Common/Models/DatabaseModels/DataIssueReport";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * Someone saying a table's data looks wrong. Whether OneUptime had already
 * raised it decides "caught first", on the Overview.
 */

export interface ComponentProps {
  dataAssetId: ObjectID;
}

const ReportDataProblem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <>
      <Button
        title="Report a Problem"
        icon={IconProp.Alert}
        buttonStyle={ButtonStyleType.NORMAL}
        onClick={() => {
          setIsOpen(true);
        }}
      />
      {isOpen ? (
        <ModelFormModal<DataIssueReport>
          title="Report a Problem"
          description="Say what looks wrong with this table's data."
          name="report-data-problem"
          modelType={DataIssueReport}
          onClose={() => {
            setIsOpen(false);
          }}
          submitButtonText="Report"
          onSuccess={() => {
            setIsOpen(false);
          }}
          onBeforeCreate={async (
            item: DataIssueReport,
          ): Promise<DataIssueReport> => {
            item.dataAssetId = props.dataAssetId;

            return item;
          }}
          formProps={{
            id: "report-data-problem",
            name: "report-data-problem",
            modelType: DataIssueReport,
            formType: FormType.Create,
            fields: [
              {
                field: { note: true },
                title: "What Looks Wrong",
                fieldType: FormFieldSchemaType.LongText,
                required: true,
                placeholder: "Yesterday's revenue is missing from this table.",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ReportDataProblem;
