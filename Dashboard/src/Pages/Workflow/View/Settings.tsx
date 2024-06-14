import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import DuplicateModel from "CommonUI/src/Components/DuplicateModel/DuplicateModel";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "CommonUI/src/Utils/Navigation";
import Workflow from "Model/Models/Workflow";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <DuplicateModel
        modelId={modelId}
        modelType={Workflow}
        fieldsToDuplicate={{
          description: true,
          graph: true,
          isEnabled: true,
          labels: true,
        }}
        navigateToOnSuccess={RouteUtil.populateRouteParams(
          new Route(RouteMap[PageMap.WORKFLOWS]?.toString()),
        )}
        fieldsToChange={[
          {
            field: {
              name: true,
            },
            title: "New Workflow Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "New Workflow Name",
            validation: {
              minLength: 2,
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default Settings;
