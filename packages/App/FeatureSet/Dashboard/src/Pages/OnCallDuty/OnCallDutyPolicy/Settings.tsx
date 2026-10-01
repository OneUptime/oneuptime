import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import { ON_CALL_POLICY_ARCHIVE_COPY } from "../../../Components/Archive/ResourceArchiveCopy";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ExportModelCard from "Common/UI/Components/ImportExport/ExportModelCard";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Export and archive: things done to the on-call policy as a whole, as on a
 * workflow's, a monitor's or a dashboard's Settings page. Archive lives here
 * rather than on the policy's Overview, which is where every archivable
 * resource keeps it (see ResourceArchiveSettings.test.ts).
 */
const OnCallDutyPolicySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ExportModelCard modelId={modelId} modelType={OnCallDutyPolicy} />

      <div className="mt-5">
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
    </Fragment>
  );
};

export default OnCallDutyPolicySettings;
