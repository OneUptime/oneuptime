import ProfilesOverview from "../../../Components/Profiles/ProfilesOverview";
import ProfileTable from "../../../Components/Profiles/ProfileTable";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A service's Profiles tab: the Profiler's overview, locked to this service
 * - where its time goes, what changed, each function's callers, callees,
 * source and fix - and, below it, its profiles one by one.
 *
 * Profiles ingested with this service's service.name carry its id as their
 * primaryEntityId, which is what the overview reads by and what the list
 * filters on, so the two describe the same profiles.
 */
const ServiceProfiles: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <div className="mb-6">
        <ProfilesOverview lockedEntityId={modelId.toString()} />
      </div>
      <ProfileTable
        modelId={modelId}
        noItemsMessage="No profiles found for this service."
      />
    </Fragment>
  );
};

export default ServiceProfiles;
