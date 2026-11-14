import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import {
  UsedByImpactList,
  UsedByImpactNotice,
  hasUsedByImpact,
} from "../../../Components/UsedBy/UsedByImpact";
import useUsedBySummary, {
  UseUsedBySummaryResult,
} from "../../../Components/UsedBy/useUsedBySummary";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { UsedByRecordKind } from "Common/Types/UsedBy/UsedBy";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import OnCallDutySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallScheduleDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // The policies that page it (#6813): said on the page and in the dialog.
  const usedBy: UseUsedBySummaryResult = useUsedBySummary({
    recordKind: UsedByRecordKind.OnCallSchedule,
    recordId: modelId,
  });

  return (
    <Fragment>
      <UsedByImpactNotice state={usedBy.state} />
      <ModelDelete
        modelType={OnCallDutySchedule}
        modelId={modelId}
        confirmationContent={
          hasUsedByImpact(usedBy.state) ? (
            <UsedByImpactList state={usedBy.state} />
          ) : undefined
        }
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default OnCallScheduleDelete;
