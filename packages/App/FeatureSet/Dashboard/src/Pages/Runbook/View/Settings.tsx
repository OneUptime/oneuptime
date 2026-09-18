import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import React, { FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green500, Red500 } from "Common/Types/BrandColors";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail<Runbook>
      name="Runbook > Enable / Disable"
      cardProps={{
        title: "Enable / Disable Runbook",
        description:
          "When disabled, this runbook will not be executable manually or by any triggers. Existing executions are unaffected.",
      }}
      isEditable={true}
      editButtonText="Edit"
      formFields={[
        {
          field: { isEnabled: true },
          title: "Enabled",
          description:
            "Turn this off to stop the runbook from running until it is re-enabled.",
          fieldType: FormFieldSchemaType.Toggle,
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: Runbook,
        id: "model-detail-runbook-enabled",
        fields: [
          {
            field: { isEnabled: true },
            title: "Status",
            fieldType: FieldType.Element,
            getElement: (item: Runbook): ReactElement => {
              if (item.isEnabled) {
                return (
                  <Pill text="Enabled" color={Green500} isMinimal={true} />
                );
              }
              return <Pill text="Disabled" color={Red500} isMinimal={true} />;
            },
          },
        ],
        modelId,
      }}
    />
  );
};

export default Settings;
