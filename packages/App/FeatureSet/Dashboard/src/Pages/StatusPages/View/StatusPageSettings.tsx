import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ExportModelCard from "Common/UI/Components/ImportExport/ExportModelCard";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import StatusPageDisplaySettingsCard from "../../../Components/StatusPage/StatusPageDisplaySettingsCard";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import { STATUS_PAGE_ARCHIVE_COPY } from "../../../Components/Archive/ResourceArchiveCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

/*
 * Advanced -> Advanced Settings: what the status page shows, then the things
 * done to the page as a whole - export and archive - as on a monitor's, a
 * workflow's, a dashboard's or an on-call policy's Settings page.
 *
 * What the page shows was six cards here, each behind its own Edit button
 * (and the incidents one a two-step dialog); it is one card now, whose
 * switches and numbers save as they are changed. Whether the page shows a
 * Subscribe link, and which channels visitors can use there, are switched in
 * one place: the Channels card on Subscribers -> Subscriber Settings.
 */
const StatusPageSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <StatusPageDisplaySettingsCard statusPageId={modelId} />

      {/*
       * The page's JSON export lived on a page no menu linked to. The status
       * page list can export several at once; this is the one-page export
       * every other resource keeps on its Settings page.
       */}
      <ExportModelCard modelId={modelId} modelType={StatusPage} />

      {/*
       * Last on the page: taking the page offline is a decision about the
       * page as a whole, not one more thing it shows.
       */}
      <ArchiveResourceCard<StatusPage>
        modelType={StatusPage}
        modelId={modelId}
        singularName={STATUS_PAGE_ARCHIVE_COPY.singularName}
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.STATUS_PAGES] as Route,
        )}
        archiveCardDescription={STATUS_PAGE_ARCHIVE_COPY.archiveCardDescription}
        unarchiveCardDescription={
          STATUS_PAGE_ARCHIVE_COPY.unarchiveCardDescription
        }
        archiveConfirmMessage={STATUS_PAGE_ARCHIVE_COPY.archiveConfirmMessage}
        unarchiveConfirmMessage={
          STATUS_PAGE_ARCHIVE_COPY.unarchiveConfirmMessage
        }
      />
    </Fragment>
  );
};

export default StatusPageSettings;
