import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Navigation from "CommonUI/src/Utils/Navigation";
import Project from "Model/Models/Project";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import ModelPage from "CommonUI/src/Components/Page/ModelPage";
import SideMenuComponent from "./SideMenu";

const Projects: FunctionComponent = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <ModelPage
      modelId={modelId}
      modelNameField="name"
      modelType={Project}
      title={"Project"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Projects",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECTS] as Route,
          ),
        },
        {
          title: "Project",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_VIEW] as Route,
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <div>
        <CardModelDetail<Project>
          name="Project"
          cardProps={{
            title: "Project",
            description: "Project details",
          }}
          isEditable={true}
          editButtonText="Edit Project"
          formFields={[
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-user",
            fields: [
              {
                field: {
                  _id: true,
                },
                title: "Project ID",
                fieldType: FieldType.Text,
                placeholder: "-",
              },
              {
                field: {
                  name: true,
                },
                title: "Name",
                fieldType: FieldType.Text,
              },
            ],
            modelId: modelId,
          }}
        />
      </div>
    </ModelPage>
  );
};

export default Projects;
