import ProfilesOverview from "../../../Components/Profiles/ProfilesOverview";
import ProfileTable from "../../../Components/Profiles/ProfileTable";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * A service's Profiles tab: the Profiler's overview, locked to this service
 * - where its time goes, what changed, each function's callers, callees,
 * source and fix - and, below it, its profiles one by one.
 *
 * Profiles ingested with this service's service.name carry its id as their
 * primaryEntityId, which is what the overview reads by and what the list
 * filters on, so the two describe the same profiles. The list therefore
 * waits for the overview: with no profile in 30 days the overview's first
 * steps are the page, and an empty list under them would only say "nothing
 * yet" a second time.
 */
const ServiceProfiles: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [hasProfiles, setHasProfiles] = useState<boolean | null>(null);

  return (
    <Fragment>
      <div className="mb-6">
        <ProfilesOverview
          lockedEntityId={modelId.toString()}
          onHasProfiles={setHasProfiles}
        />
      </div>
      {hasProfiles ? (
        <ProfileTable
          modelId={modelId}
          noItemsMessage="No profiles found for this service."
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default ServiceProfiles;
