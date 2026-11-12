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
import Team from "Common/Models/DatabaseModels/Team";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const TeamViewDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // The policies that page it and what it owns (#6813): on the page and in the dialog.
  const usedBy: UseUsedBySummaryResult = useUsedBySummary({
    recordKind: UsedByRecordKind.Team,
    recordId: modelId,
  });

  return (
    <Fragment>
      <UsedByImpactNotice state={usedBy.state} />
      <ModelDelete
        modelType={Team}
        modelId={modelId}
        confirmationContent={
          hasUsedByImpact(usedBy.state) ? (
            <UsedByImpactList state={usedBy.state} />
          ) : undefined
        }
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(RouteMap[PageMap.TEAMS] as Route),
          );
        }}
      />
    </Fragment>
  );
};

export default TeamViewDelete;
