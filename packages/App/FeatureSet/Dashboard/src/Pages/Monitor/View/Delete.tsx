import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import SloImpactWarning from "../../../Components/Monitor/SloImpactWarning";
import {
  UsedByImpactList,
  UsedByImpactNotice,
  hasUsedByImpact,
} from "../../../Components/UsedBy/UsedByImpact";
import useUsedBySummary, {
  UseUsedBySummaryResult,
} from "../../../Components/UsedBy/useUsedBySummary";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { UsedByRecordKind, UsedByRelation } from "Common/Types/UsedBy/UsedBy";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const MonitorDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // What still refers to it (#6813): said on the page and in the dialog.
  const usedBy: UseUsedBySummaryResult = useUsedBySummary({
    recordKind: UsedByRecordKind.Monitor,
    recordId: modelId,
  });

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      <SloImpactWarning monitorId={modelId} />
      {/*
       * The SLOs have their own warning just above, which says what an SLO
       * left with no monitors does; the dialog still lists them.
       */}
      <UsedByImpactNotice
        state={usedBy.state}
        leaveOut={[UsedByRelation.MonitorSlos]}
      />
      <ModelDelete
        modelType={Monitor}
        modelId={modelId}
        confirmationContent={
          hasUsedByImpact(usedBy.state) ? (
            <UsedByImpactList state={usedBy.state} />
          ) : undefined
        }
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(RouteMap[PageMap.MONITORS] as Route, {
              modelId,
            }),
          );
        }}
      />
    </Fragment>
  );
};

export default MonitorDelete;
