import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import NetworkSiteOwnerTeam from "Common/Models/DatabaseModels/NetworkSiteOwnerTeam";
import NetworkSiteOwnerUser from "Common/Models/DatabaseModels/NetworkSiteOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Who owns a site (#10188): the people and teams made owners of the alert
 * it raises when its health rolls up unhealthy (NetworkSiteService), and
 * the ones a role limited to what its holder owns lets change it. Sites are
 * owned, and filtered by owner, on the Sites list too, a selection at a
 * time.
 */
export const SITE_OWNERS_DESCRIPTION: string = translationKey(
  "People and teams who own this site. When the site raises an alert because it is unhealthy, they own the alert.",
);

export const SITE_OWNERS_EMPTY_DESCRIPTION: string = translationKey(
  "Add a teammate or a team to own the alerts this site raises when it is unhealthy.",
);

const NetworkSiteOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<NetworkSiteOwnerUser, NetworkSiteOwnerTeam>
      resourceId={modelId}
      resourceIdField="networkSiteId"
      resourceDisplayName="site"
      ownerUserModelType={NetworkSiteOwnerUser}
      ownerTeamModelType={NetworkSiteOwnerTeam}
      description={SITE_OWNERS_DESCRIPTION}
      emptyDescription={SITE_OWNERS_EMPTY_DESCRIPTION}
    />
  );
};

export default NetworkSiteOwners;
