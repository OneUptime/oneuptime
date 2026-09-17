import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ObjectID from "Common/Types/ObjectID";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const SloOwners: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      {/*
       * Owners are notified on status change — worth knowing here that the
       * SLO is disabled or unmeasurable, because then no status change can
       * ever happen and nobody will be notified of anything.
       */}
      <SloNoticeBanner sloId={modelId} />
      <OwnersCard<
        ServiceLevelObjectiveOwnerUser,
        ServiceLevelObjectiveOwnerTeam
      >
        resourceId={modelId}
        resourceIdField="serviceLevelObjectiveId"
        resourceDisplayName="SLO"
        ownerUserModelType={ServiceLevelObjectiveOwnerUser}
        ownerTeamModelType={ServiceLevelObjectiveOwnerTeam}
      />
    </Fragment>
  );
};

export default SloOwners;
