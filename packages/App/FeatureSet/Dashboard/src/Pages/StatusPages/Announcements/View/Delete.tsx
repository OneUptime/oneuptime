import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import PageComponentProps from "../../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import React, { FunctionComponent, ReactElement } from "react";

const AnnouncementDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ModelDelete
      modelType={StatusPageAnnouncement}
      modelId={modelId}
      onDeleteSuccess={() => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.STATUS_PAGE_ANNOUNCEMENTS] as Route,
            {
              modelId,
            },
          ),
        );
      }}
    />
  );
};

export default AnnouncementDelete;
