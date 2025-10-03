import DuplicateModel from "Common/UI/Components/DuplicateModel/DuplicateModel";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import OnCallDutySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallDutyScheduleSettings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      <div className="mt-5">
        <DuplicateModel
          modelId={modelId}
          modelType={OnCallDutySchedule}
          fieldsToDuplicate={{
            description: true,
            labels: true,
          }}
          navigateToOnSuccess={RouteUtil.populateRouteParams(
            RouteMap[PageMap.ON_CALL_DUTY_SCHEDULES] as Route,
          )}
          fieldsToChange={[
            {
              field: {
                name: true,
              },
              title: "New Schedule Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "New Schedule Name",
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

export default OnCallDutyScheduleSettings;
