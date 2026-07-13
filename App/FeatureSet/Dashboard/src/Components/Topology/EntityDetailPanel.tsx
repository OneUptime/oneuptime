import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Link from "Common/UI/Components/Link/Link";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import TelemetryEntityRelationship from "Common/Models/DatabaseModels/TelemetryEntityRelationship";
import Service from "Common/Models/DatabaseModels/Service";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import EntityType from "Common/Types/Telemetry/EntityType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import OneUptimeDate from "Common/Types/Date";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  formatCallRate,
  formatDurationMs,
  formatErrorRate,
  labelForRelationship,
  metaForEntityType,
} from "./TopologyMeta";
import {
  ServiceOperationalStatus,
  ServiceStatusItem,
} from "./OperationalOverlay";

/*
 * Right-hand detail drawer for a topology node. Keeps the user on the map
 * (no navigation on click) while still offering deep links: the entity
 * detail page, service traces (via the registry's resourceId pointer,
 * with a by-name fallback for pre-pointer rows), active incidents and
 * alerts (Service Map overlay), and the matching network device for Host
 * entities (cross-layer link, matched on hostname/sysName since the two
 * features share no foreign key).
 */

export interface ComponentProps {
  entity: TelemetryEntity;
  relationships: Array<TelemetryEntityRelationship>;
  entityByKey: Map<string, TelemetryEntity>;
  /** Active incidents/alerts affecting this service (Service Map overlay). */
  incidentStatus?: ServiceOperationalStatus | null | undefined;
  /** Seconds the depends-on metrics were aggregated over (cron window). */
  metricsWindowSeconds: number;
  onClose: () => void;
  onFocus: (entityKey: string) => void;
}

interface EdgeRow {
  direction: "outbound" | "inbound";
  relationship: TelemetryEntityRelationship;
  otherLabel: string;
}

function normalizeHostName(value: string | undefined): string {
  if (!value) {
    return "";
  }
  // "host/web-1.example.com" and "WEB-1" should both match "web-1".
  const withoutPrefix: string = value.toLowerCase().replace(/^host\//, "");
  return withoutPrefix.split(".")[0] || withoutPrefix;
}

/** One active incident/alert row: title link + severity line. */
function renderStatusItem(
  item: ServiceStatusItem,
  viewRoute: Route,
  fallbackColor: string,
): ReactElement {
  return (
    <li key={item.id} className="py-2">
      <Link
        to={RouteUtil.populateRouteParams(viewRoute, {
          modelId: new ObjectID(item.id),
        })}
        className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        {item.title}
      </Link>
      {item.severityName ? (
        <p
          className="mt-0.5 text-xs font-medium"
          style={{ color: item.severityColor || fallbackColor }}
        >
          {item.severityName}
        </p>
      ) : (
        <></>
      )}
    </li>
  );
}

const EntityDetailPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const { entity } = props;
  const entityKey: string = entity.entityKey || "";
  const displayName: string = entity.displayName || "Unnamed entity";

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [matchedDevice, setMatchedDevice] = useState<NetworkDevice | null>(
    null,
  );

  /*
   * Service entities: the traces link needs the Service row id. The
   * registry stamps the (resourceType, resourceId) pointer at reconcile
   * time now — use it directly; fall back to a by-name lookup only for
   * rows written before the pointer existed.
   */
  useEffect(() => {
    /*
     * Stale-write guard: the pointer branch resolves synchronously, so an
     * unguarded by-name fetch from a previously selected entity would
     * always land AFTER it and overwrite the newer selection's id.
     */
    let cancelled: boolean = false;
    setServiceId(null);
    if (entity.entityType === EntityType.Service && entity.displayName) {
      if (entity.resourceType === "Service" && entity.resourceId) {
        setServiceId(entity.resourceId.toString());
      } else {
        const load: () => Promise<void> = async (): Promise<void> => {
          try {
            const result: ListResult<Service> = await ModelAPI.getList<Service>(
              {
                modelType: Service,
                query: {
                  projectId: ProjectUtil.getCurrentProjectId()!,
                  name: entity.displayName!,
                },
                select: { _id: true },
                sort: {},
                skip: 0,
                limit: 1,
              },
            );
            if (!cancelled && result.data[0]?._id) {
              setServiceId(result.data[0]._id.toString());
            }
          } catch {
            // Best-effort deep link; the panel works without it.
          }
        };
        void load();
      }
    }
    return () => {
      cancelled = true;
    };
  }, [entity]);

  // Host entities: find a network device with the same hostname/sysName.
  useEffect(() => {
    let cancelled: boolean = false;
    setMatchedDevice(null);
    const hostKey: string = normalizeHostName(entity.displayName);
    if (entity.entityType === EntityType.Host && hostKey) {
      const load: () => Promise<void> = async (): Promise<void> => {
        try {
          const result: ListResult<NetworkDevice> =
            await ModelAPI.getList<NetworkDevice>({
              modelType: NetworkDevice,
              query: { projectId: ProjectUtil.getCurrentProjectId()! },
              select: { _id: true, name: true, hostname: true, sysName: true },
              sort: {},
              skip: 0,
              limit: 500,
            });
          const match: NetworkDevice | undefined = result.data.find(
            (device: NetworkDevice) => {
              return (
                normalizeHostName(device.hostname) === hostKey ||
                normalizeHostName(device.sysName) === hostKey ||
                normalizeHostName(device.name) === hostKey
              );
            },
          );
          if (!cancelled) {
            setMatchedDevice(match || null);
          }
        } catch {
          // Cross-layer link is best-effort.
        }
      };
      void load();
    }
    return () => {
      cancelled = true;
    };
  }, [entity]);

  const edgeRows: Array<EdgeRow> = useMemo(() => {
    const rows: Array<EdgeRow> = [];
    for (const relationship of props.relationships) {
      if (relationship.fromEntityKey === entityKey) {
        const other: TelemetryEntity | undefined = props.entityByKey.get(
          relationship.toEntityKey || "",
        );
        rows.push({
          direction: "outbound",
          relationship,
          otherLabel:
            other?.displayName ||
            `${(relationship.toEntityKey || "").substring(0, 8)}…`,
        });
      } else if (relationship.toEntityKey === entityKey) {
        const other: TelemetryEntity | undefined = props.entityByKey.get(
          relationship.fromEntityKey || "",
        );
        rows.push({
          direction: "inbound",
          relationship,
          otherLabel:
            other?.displayName ||
            `${(relationship.fromEntityKey || "").substring(0, 8)}…`,
        });
      }
    }
    return rows;
  }, [props.relationships, props.entityByKey, entityKey]);

  const typeMeta: { label: string; color: string } = metaForEntityType(
    entity.entityType,
  );

  const renderEdgeRow: (row: EdgeRow, index: number) => ReactElement = (
    row: EdgeRow,
    index: number,
  ): ReactElement => {
    const rel: TelemetryEntityRelationship = row.relationship;
    const hasMetrics: boolean = Boolean(rel.callCount && rel.callCount > 0);
    const sentence: string =
      row.direction === "outbound"
        ? `${displayName} ${labelForRelationship(rel.relationshipType)} ${row.otherLabel}`
        : `${row.otherLabel} ${labelForRelationship(rel.relationshipType)} ${displayName}`;
    return (
      <li key={index} className="py-2">
        <p className="text-sm text-gray-900">{sentence}</p>
        {hasMetrics && (
          <p className="mt-0.5 text-xs text-gray-500">
            {formatCallRate(rel.callCount!, props.metricsWindowSeconds)} ·{" "}
            {formatErrorRate(rel.callCount, rel.errorCount)} errors · avg{" "}
            {formatDurationMs(rel.avgDurationMs)}
          </p>
        )}
      </li>
    );
  };

  return (
    <SideOver
      title={displayName}
      description={typeMeta.label}
      onClose={props.onClose}
      size={SideOverSize.Small}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <Button
            title={translateString("Focus on this node") || ""}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={() => {
              props.onFocus(entityKey);
            }}
          />
        </div>

        {props.incidentStatus &&
        props.incidentStatus.activeIncidentCount > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {translateString("Active incidents") || ""} (
              {props.incidentStatus.activeIncidentCount})
            </h3>
            <ul className="mt-1 divide-y divide-gray-100">
              {props.incidentStatus.incidents.map(
                (item: ServiceStatusItem): ReactElement => {
                  return renderStatusItem(
                    item,
                    RouteMap[PageMap.INCIDENT_VIEW] as Route,
                    "#dc2626",
                  );
                },
              )}
            </ul>
          </div>
        ) : (
          <></>
        )}

        {props.incidentStatus && props.incidentStatus.activeAlertCount > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {translateString("Active alerts") || ""} (
              {props.incidentStatus.activeAlertCount})
            </h3>
            <ul className="mt-1 divide-y divide-gray-100">
              {props.incidentStatus.alerts.map(
                (item: ServiceStatusItem): ReactElement => {
                  return renderStatusItem(
                    item,
                    RouteMap[PageMap.ALERT_VIEW] as Route,
                    "#f59e0b",
                  );
                },
              )}
            </ul>
          </div>
        ) : (
          <></>
        )}

        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {translateString("Details") || ""}
          </h3>
          <dl className="mt-2 space-y-1 text-sm text-gray-600">
            {entity.firstSeenAt && (
              <div className="flex justify-between gap-4">
                <dt>{translateString("First seen") || ""}</dt>
                <dd>
                  {OneUptimeDate.getDateAsLocalFormattedString(
                    entity.firstSeenAt,
                  )}
                </dd>
              </div>
            )}
            {entity.lastSeenAt && (
              <div className="flex justify-between gap-4">
                <dt>{translateString("Last seen") || ""}</dt>
                <dd>
                  {OneUptimeDate.getDateAsLocalFormattedString(
                    entity.lastSeenAt,
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {translateString("Connections") || ""} ({edgeRows.length})
          </h3>
          {edgeRows.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">
              {translateString("No connections in the selected time range.") ||
                ""}
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-gray-100">
              {edgeRows.map(renderEdgeRow)}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {translateString("Open") || ""}
          </h3>
          <ul className="mt-2 space-y-2 text-sm">
            {entity._id && (
              <li>
                <Link
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.ENTITIES_VIEW] as Route,
                    { modelId: new ObjectID(entity._id.toString()) },
                  )}
                  className="font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {translateString("Entity details") || ""}
                </Link>
              </li>
            )}
            {serviceId && (
              <li>
                <Link
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SERVICE_VIEW_TRACES] as Route,
                    { modelId: new ObjectID(serviceId) },
                  )}
                  className="font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {translateString("Traces for this service") || ""}
                </Link>
              </li>
            )}
            {matchedDevice?._id && (
              <li>
                <Link
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
                    { modelId: new ObjectID(matchedDevice._id.toString()) },
                  )}
                  className="font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {translateString("Network device:") || ""}{" "}
                  {matchedDevice.name || "device"}
                </Link>
              </li>
            )}
          </ul>
        </div>
      </div>
    </SideOver>
  );
};

export default EntityDetailPanel;
