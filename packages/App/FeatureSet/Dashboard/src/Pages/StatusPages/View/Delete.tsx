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
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const StatusPageDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // What visitors see on it now (#6813): said on the page and in the dialog.
  const usedBy: UseUsedBySummaryResult = useUsedBySummary({
    recordKind: UsedByRecordKind.StatusPage,
    recordId: modelId,
  });

  return (
    <Fragment>
      <UsedByImpactNotice state={usedBy.state} />
      <ModelDelete
        modelType={StatusPage}
        modelId={modelId}
        confirmationContent={
          hasUsedByImpact(usedBy.state) ? (
            <UsedByImpactList state={usedBy.state} />
          ) : undefined
        }
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGES] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default StatusPageDelete;
