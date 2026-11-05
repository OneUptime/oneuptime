import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import OpenStackWasteCard from "../../../Components/OpenStack/OpenStackWasteCard";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import RecommendationsPage from "../../../Components/Recommendations/RecommendationsPage";
import {
  OpenStackSpendRead,
  fetchOpenStackSpend,
} from "../Utils/OpenStackSpendView";

/*
 * What to do next on this cloud: what's been left unused and could be reclaimed, then the monitors
 * worth having. The first of those is shown once a worker has read the cloud's usage. A read that
 * fails or hasn't happened leaves the rest of the page as it always was.
 */
const OpenStackCloudRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const read: OpenStackRead<OpenStackSpendRead> =
    useOpenStackRead<OpenStackSpendRead>(() => {
      return fetchOpenStackSpend(modelId);
    }, [modelId.toString()]);

  return (
    <Fragment>
      {read.data?.snapshot ? (
        <div className="mb-6">
          <OpenStackWasteCard
            openStackCloudId={modelId}
            snapshot={read.data.snapshot}
          />
        </div>
      ) : (
        <></>
      )}
      <RecommendationsPage
        resourceType={MonitorRecommendationResourceType.OpenStack}
      />
    </Fragment>
  );
};

export default OpenStackCloudRecommendations;
