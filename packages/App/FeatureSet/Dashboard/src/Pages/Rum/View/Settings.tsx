import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import {
  isResourceRetentionCardDrawn,
  TELEMETRY_RESOURCE_MORE_SETTINGS_TEST_ID,
} from "../../../Components/TelemetryResource/TelemetryResourceMoreSettings";
import {
  RUM_RETENTION_MORE_DESCRIPTION,
  SESSION_REPLAY_RETENTION_TITLE,
} from "../../../Components/TelemetryResource/TelemetryRetentionFold";
import useRetentionFold, {
  RetentionFold,
} from "../../../Components/TelemetryResource/UseRetentionFold";
import SessionReplayRetentionSettingsCard from "../../../Components/SessionReplay/SessionReplayRetentionSettingsCard";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import { foldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ObjectID from "Common/Types/ObjectID";
import { useParams } from "react-router-dom";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const RumApplicationSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  /*
   * Retention overrides - an Enterprise feature most projects never use -
   * and how long session replays are kept wait folded under More settings
   * (TelemetryRetentionFold), each named in the folded header.
   */
  const retentionFold: RetentionFold = useRetentionFold({
    isEnterpriseCardDrawn: isResourceRetentionCardDrawn(),
    hasOwnRetention: true,
  });

  return (
    <Fragment>
      {/*
       * The service.name its SDK reports never changes: it is shown, never
       * edited (its column takes no updates).
       */}
      <ResourceDetailsCard<RumApplication>
        modelType={RumApplication}
        modelId={modelId}
        id="rum-application-details"
        title="Application Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Display Name",
          description:
            "Shown everywhere this resource appears. Telemetry is not matched by the display name, so renaming is safe.",
          placeholder: "Storefront",
        }}
        descriptionField={{
          placeholder: "Customer-facing storefront web app",
        }}
        identityFields={[
          {
            column: "appIdentifier",
            title: "App Name (service.name)",
          },
        ]}
      />
      <AdvancedPageSection
        description={RUM_RETENTION_MORE_DESCRIPTION}
        items={[
          ...retentionFold.items,
          foldedSectionItem(SESSION_REPLAY_RETENTION_TITLE),
        ]}
        dataTestId={TELEMETRY_RESOURCE_MORE_SETTINGS_TEST_ID}
      >
        <TelemetryResourceRetentionSettings<RumApplication>
          modelType={RumApplication}
          modelId={modelId}
          resourceName="RUM application"
          modelDetailIdPrefix="rum-application"
          onRetentionChange={retentionFold.onRetentionChange}
        />
        <SessionReplayRetentionSettingsCard rumApplicationId={modelId} />
      </AdvancedPageSection>
      <ArchiveResourceCard<RumApplication>
        modelType={RumApplication}
        modelId={modelId}
        singularName="application"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.RUM_APPLICATIONS] as Route,
        )}
      />
    </Fragment>
  );
};

export default RumApplicationSettings;
