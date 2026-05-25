import PageComponentProps from "../../PageComponentProps";
import URL from "Common/Types/API/URL";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Team from "Common/Models/DatabaseModels/Team";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const TeamViewIndex: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <CardModelDetail
        name="Team Details"
        cardProps={{
          title: "Team Details",
          description: "Here are more details for this team.",
        }}
        videoLink={URL.fromString("https://youtu.be/TzmaTe4sbCI")}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Team Name",
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
            placeholder: "Team Description",
          },
        ]}
        modelDetailProps={{
          modelType: Team,
          id: "model-detail-team",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Team ID",
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
          ],
          modelId: Navigation.getLastParamAsObjectID(),
        }}
      />
    </Fragment>
  );
};

export default TeamViewIndex;
