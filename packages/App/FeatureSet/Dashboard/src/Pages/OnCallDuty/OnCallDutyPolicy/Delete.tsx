import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import { ON_CALL_POLICY_ARCHIVE_COPY } from "../../../Components/Archive/ResourceArchiveCopy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallPolicyDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      {/*
       * Archive first: it stops the policy paging anyone just as deleting
       * would, but keeps it - escalation rules, history and all - and can be
       * undone. Most people reaching this page want that.
       */}
      <div className="mb-5">
        <ArchiveResourceCard<OnCallDutyPolicy>
          modelType={OnCallDutyPolicy}
          modelId={modelId}
          singularName={ON_CALL_POLICY_ARCHIVE_COPY.singularName}
          listRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route,
          )}
          archiveCardDescription={
            ON_CALL_POLICY_ARCHIVE_COPY.archiveCardDescription
          }
          unarchiveCardDescription={
            ON_CALL_POLICY_ARCHIVE_COPY.unarchiveCardDescription
          }
          archiveConfirmMessage={
            ON_CALL_POLICY_ARCHIVE_COPY.archiveConfirmMessage
          }
          unarchiveConfirmMessage={
            ON_CALL_POLICY_ARCHIVE_COPY.unarchiveConfirmMessage
          }
        />
      </div>
      <ModelDelete
        modelType={OnCallDutyPolicy}
        modelId={modelId}
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

export default OnCallPolicyDelete;
