import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceMoreSettings from "../../../Components/TelemetryResource/TelemetryResourceMoreSettings";
import AgentVersion from "../../../Components/AgentVersion/AgentVersion";
import XcpNgPoolDataCollectionCard from "../../../Components/XcpNg/XcpNgPoolDataCollectionCard";
import { AgentKind } from "../../../Components/AgentVersion/AgentKind";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A pool's settings, in the order a page's settings go: what it is called
 * and where it is read from (one card, edited in one place), how long its
 * telemetry is kept (folded under More settings), and, last, Archive.
 *
 * The pool is matched on its XAPI UUID (poolIdentifier, the agent's
 * xcp_ng.pool.id), never on its name, so the name is a display name that is
 * safe to change - it follows Xen Orchestra's name for the pool until
 * someone changes it here - and the UUID is folded under Advanced in the
 * card's Edit dialog, as a Kubernetes cluster's identifier is. What the
 * agent reports about where the pool is read from - the Xen Orchestra's
 * name, the pool's name there and the agent's version - is shown, never
 * edited.
 */
const XcpNgPoolSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ResourceDetailsCard<XcpNgPool>
        modelType={XcpNgPool}
        modelId={modelId}
        id="xcp-ng-pool-details"
        title="Pool Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Display Name",
          description:
            "Follows the pool's name in Xen Orchestra until you rename it here. Telemetry is matched by the pool's UUID, so renaming is safe.",
          placeholder: "Production pool",
        }}
        descriptionField={{
          placeholder: "Production XCP-ng pool in the Paris datacenter",
        }}
        identityFields={[
          {
            column: "poolIdentifier",
            title: "Pool UUID (xcp_ng.pool.id)",
            description:
              "Must match the pool's UUID in Xen Orchestra. Change it only when that changes: telemetry that still reports the old UUID creates a new pool.",
            placeholder: "b7569d99-30f8-178a-7d94-801de3e29b5b",
          },
        ]}
        detailFields={[
          {
            field: {
              xenOrchestraName: true,
            },
            title: "Xen Orchestra",
            fieldType: FieldType.Text,
            placeholder: "Not reported",
          },
          {
            field: {
              reportedName: true,
            },
            title: "Name in Xen Orchestra",
            fieldType: FieldType.Text,
            placeholder: "No name in Xen Orchestra",
          },
          {
            field: {
              agentVersion: true,
            },
            title: "Agent Version",
            fieldType: FieldType.Element,
            getElement: (item: XcpNgPool): ReactElement => {
              return (
                <AgentVersion
                  kind={AgentKind.XcpNgAgent}
                  version={item.agentVersion}
                  placeholder="Not reported"
                  setupGuideRoute={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.XCP_NG_POOL_VIEW_DOCUMENTATION] as Route,
                    { modelId: modelId },
                  )}
                />
              );
            },
          },
        ]}
      />
      {/* The XCP-ng Agent, or a probe through one of the connections. */}
      <XcpNgPoolDataCollectionCard modelId={modelId} />
      <TelemetryResourceMoreSettings<XcpNgPool>
        modelType={XcpNgPool}
        modelId={modelId}
        resourceName="XCP-ng pool"
        modelDetailIdPrefix="model-detail-xcp-ng-pool"
      />
      <ArchiveResourceCard<XcpNgPool>
        modelType={XcpNgPool}
        modelId={modelId}
        singularName="pool"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.XCP_NG_POOLS] as Route,
        )}
      />
    </Fragment>
  );
};

export default XcpNgPoolSettings;
