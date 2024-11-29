import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DuplicateModel from "Common/UI/Components/DuplicateModel/DuplicateModel";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

const DashboardDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <div className="mt-5">
        <DuplicateModel
          modelId={modelId}
          modelType={Dashboard}
          fieldsToDuplicate={{
            description: true,
            labels: true,
            dashboardViewConfig: true,
          }}
          navigateToOnSuccess={RouteUtil.populateRouteParams(
            RouteMap[PageMap.DASHBOARDS] as Route,
          )}
          fieldsToChange={[
            {
              field: {
                name: true,
              },
              title: "New Dashboard Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "New Dashboard Name",
              validation: {
                minLength: 2,
              },
            },
          ]}
        />
      </div>
    </Fragment>
  );
};

export default DashboardDelete;
