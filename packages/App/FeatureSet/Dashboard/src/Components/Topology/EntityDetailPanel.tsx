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
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import Service from "Common/Models/DatabaseModels/Service";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
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
import { TrafficTotals } from "./ServiceMapViewModel";

/*
 * Right-hand detail drawer for anything on a topology map. It keeps the user
 * on the map and answers, in order: how is it doing, what does it call, what
 * calls it, where does it run, and where can I go next (inventory, traces,
 * the matching network device for a host).
 */

export interface EntityTrafficSummary {
  inbound: TrafficTotals;
  outbound: TrafficTotals;
  statusLabel: string;
  statusColor: string;
  subtitle: string;
}

export interface ComponentProps {
  entity: InventoryItem;
  relationships: Array<InventoryItemRelationship>;
  entityByKey: Map<string, InventoryItem>;
  /** Service Map traffic for this node. */
  traffic?: EntityTrafficSummary | undefined;
  /** Active incidents/alerts affecting this service (Service Map overlay). */
  incidentStatus?: ServiceOperationalStatus | null | undefined;
  /** Seconds the depends-on metrics were aggregated over (cron window). */
  metricsWindowSeconds: number;
  onClose: () => void;
  onFocus: (entityKey: string) => void;
  focusButtonLabel?: string | undefined;
  onSelectEntity?: ((entityKey: string) => void) | undefined;
  /** Open a resource in the Infrastructure view. */
  onOpenInfrastructure?: ((entityKey: string) => void) | undefined;
}

interface ConnectionRow {
  relationship: InventoryItemRelationship;
  otherLabel: string;
  otherKey: string | null;
  otherType: string | undefined;
  sentence: string;
}

/*
 * Descriptive attributes worth a line in the drawer, in display order.
 *
 * This is a summary, so it is deliberately narrower than the item's own
 * Attributes card, which shows every descriptive attribute we hold. But
 * it must not tell a different story about the same machine, so the host
 * asset facts belong here too. `os.description` and `host.id` stay out:
 * both are long, and neither reads at a glance.
 */
const DETAIL_ATTRIBUTES: Array<{ key: string; label: string }> = [
  { key: "telemetry.sdk.language", label: "Language" },
  { key: "db.system.name", label: "Database engine" },
  { key: "network.protocol.name", label: "Protocol" },
  { key: "k8s.pod.name", label: "Pod name" },
  { key: "k8s.node.name", label: "Node" },
  { key: "os.type", label: "Operating system" },
  { key: "host.arch", label: "Architecture" },
  { key: "host.ip", label: "IP Address" },
  { key: "device.manufacturer", label: "Manufacturer" },
  { key: "device.model.name", label: "Model Name" },
  { key: "host.serial_number", label: "Serial Number" },
  { key: "cloud.provider", label: "Cloud provider" },
  { key: "cloud.region", label: "Region" },
];

const PLACEMENT_RELATIONSHIPS: Set<string> = new Set<string>([
  EntityRelationshipType.RunsOn,
  EntityRelationshipType.HostedOn,
]);

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
  const t: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };
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
   * time — use it directly; fall back to a by-name lookup only for rows
   * written before the pointer existed.
   */
  useEffect(() => {
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

  const sections: {
    calls: Array<ConnectionRow>;
    calledBy: Array<ConnectionRow>;
    runsOn: Array<ConnectionRow>;
    related: Array<ConnectionRow>;
  } = useMemo(() => {
    const calls: Array<ConnectionRow> = [];
    const calledBy: Array<ConnectionRow> = [];
    const runsOn: Array<ConnectionRow> = [];
    const related: Array<ConnectionRow> = [];
    const seen: Set<string> = new Set<string>();
    for (const relationship of props.relationships) {
      const outbound: boolean = relationship.fromEntityKey === entityKey;
      const inbound: boolean = relationship.toEntityKey === entityKey;
      if (!outbound && !inbound) {
        continue;
      }
      const id: string = `${relationship.fromEntityKey}|${relationship.relationshipType}|${relationship.toEntityKey}`;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const otherKeyRaw: string =
        (outbound ? relationship.toEntityKey : relationship.fromEntityKey) ||
        "";
      const other: InventoryItem | undefined =
        props.entityByKey.get(otherKeyRaw);
      const otherLabel: string =
        other?.displayName ||
        (other ? "Unnamed resource" : "Undiscovered resource");
      const verb: string = labelForRelationship(relationship.relationshipType);
      const row: ConnectionRow = {
        relationship,
        otherLabel,
        otherKey: other?.entityKey || null,
        otherType: other?.entityType,
        sentence: outbound
          ? `${displayName} ${verb} ${otherLabel}`
          : `${otherLabel} ${verb} ${displayName}`,
      };
      if (relationship.relationshipType === EntityRelationshipType.DependsOn) {
        (outbound ? calls : calledBy).push(row);
      } else if (
        outbound &&
        entity.entityType === EntityType.Service &&
        PLACEMENT_RELATIONSHIPS.has(relationship.relationshipType || "")
      ) {
        runsOn.push(row);
      } else {
        related.push(row);
      }
    }
    const byTraffic: (a: ConnectionRow, b: ConnectionRow) => number = (
      a: ConnectionRow,
      b: ConnectionRow,
    ): number => {
      return (
        (b.relationship.callCount || 0) - (a.relationship.callCount || 0) ||
        a.otherLabel.localeCompare(b.otherLabel)
      );
    };
    calls.sort(byTraffic);
    calledBy.sort(byTraffic);
    runsOn.sort((a: ConnectionRow, b: ConnectionRow): number => {
      return a.otherLabel.localeCompare(b.otherLabel);
    });
    return { calls, calledBy, runsOn, related };
  }, [props.relationships, props.entityByKey, entityKey, entity.entityType]);

  const typeMeta: { label: string; color: string } = metaForEntityType(
    entity.entityType,
  );

  const renderTraffic: (
    title: string,
    totals: TrafficTotals,
  ) => ReactElement = (title: string, totals: TrafficTotals): ReactElement => {
    return (
      <div className="rounded-lg border border-gray-200 px-3 py-2.5">
        <p className="text-xs font-medium text-gray-500">{t(title)}</p>
        {totals.calls > 0 ? (
          <div className="mt-1 grid grid-cols-3 gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {formatCallRate(totals.calls, props.metricsWindowSeconds)}
              </p>
              <p className="text-[11px] text-gray-400">{t("requests")}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {formatErrorRate(totals.calls, totals.errors)}
              </p>
              <p className="text-[11px] text-gray-400">{t("errors")}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {totals.avgDurationMs === null
                  ? "—"
                  : formatDurationMs(totals.avgDurationMs)}
              </p>
              <p className="text-[11px] text-gray-400">{t("avg latency")}</p>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-gray-500">{t("None observed")}</p>
        )}
      </div>
    );
  };

  const renderRows: (
    rows: Array<ConnectionRow>,
    options: { showMetrics: boolean; infrastructureLinks?: boolean },
  ) => ReactElement = (
    rows: Array<ConnectionRow>,
    options: { showMetrics: boolean; infrastructureLinks?: boolean },
  ): ReactElement => {
    return (
      <ul className="mt-1 divide-y divide-gray-100">
        {rows.map((row: ConnectionRow, index: number): ReactElement => {
          const rel: InventoryItemRelationship = row.relationship;
          const hasMetrics: boolean = Boolean(
            options.showMetrics && rel.callCount && rel.callCount > 0,
          );
          const navigate: ((key: string) => void) | undefined =
            options.infrastructureLinks && props.onOpenInfrastructure
              ? props.onOpenInfrastructure
              : props.onSelectEntity;
          const typeLabel: string = row.otherType
            ? metaForEntityType(row.otherType).label
            : "";
          return (
            <li key={index} className="py-2">
              {row.otherKey && navigate ? (
                <button
                  type="button"
                  className="w-full rounded-md text-left text-sm font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label={`${t("View details for")} ${row.otherLabel}`}
                  onClick={() => {
                    navigate(row.otherKey!);
                  }}
                >
                  {row.sentence} <span aria-hidden={true}>→</span>
                </button>
              ) : (
                <p className="text-sm text-gray-900">{row.sentence}</p>
              )}
              {(hasMetrics || typeLabel) && (
                <p className="mt-0.5 text-xs text-gray-500">
                  {typeLabel ? t(typeLabel) : ""}
                  {typeLabel && hasMetrics ? " · " : ""}
                  {hasMetrics
                    ? `${formatCallRate(rel.callCount!, props.metricsWindowSeconds)} · ${formatErrorRate(rel.callCount, rel.errorCount)} errors · avg ${formatDurationMs(rel.avgDurationMs)}`
                    : ""}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const attributes: Array<{ label: string; value: string }> =
    DETAIL_ATTRIBUTES.map((item: { key: string; label: string }) => {
      const bag: Record<string, unknown> = {
        ...((entity.identifyingAttributes as Record<string, unknown>) || {}),
        ...((entity.descriptiveAttributes as Record<string, unknown>) || {}),
      };
      const value: unknown = bag[item.key];
      return {
        label: item.label,
        value: typeof value === "string" ? value : "",
      };
    }).filter((item: { label: string; value: string }): boolean => {
      return Boolean(item.value) && item.value !== displayName;
    });

  const connectionCount: number =
    sections.calls.length +
    sections.calledBy.length +
    sections.runsOn.length +
    sections.related.length;

  return (
    <SideOver
      title={displayName}
      description={props.traffic?.subtitle || typeMeta.label}
      onClose={props.onClose}
      size={SideOverSize.Small}
    >
      <div className="space-y-6">
        {props.traffic && (
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: props.traffic.statusColor }}
              aria-hidden={true}
            />
            <span data-testid="entity-detail-status">
              {t(props.traffic.statusLabel)}
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            title={t(props.focusButtonLabel || "Explore connections")}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={() => {
              props.onFocus(entityKey);
            }}
          />
        </div>

        {props.traffic && (
          <div className="grid gap-2">
            {renderTraffic("Requests it answered", props.traffic.inbound)}
            {renderTraffic("Calls it made", props.traffic.outbound)}
            <p className="text-xs text-gray-400">
              {t("Latest ~15-minute window.")}
            </p>
          </div>
        )}

        {props.incidentStatus &&
        props.incidentStatus.activeIncidentCount > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {t("Active incidents")} (
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
              {t("Active alerts")} ({props.incidentStatus.activeAlertCount})
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

        {sections.calls.length > 0 && (
          <div data-testid="entity-detail-calls">
            <h3 className="text-sm font-semibold text-gray-900">
              {t("Calls")} ({sections.calls.length})
            </h3>
            {renderRows(sections.calls, { showMetrics: true })}
          </div>
        )}

        {sections.calledBy.length > 0 && (
          <div data-testid="entity-detail-called-by">
            <h3 className="text-sm font-semibold text-gray-900">
              {t("Called by")} ({sections.calledBy.length})
            </h3>
            {renderRows(sections.calledBy, { showMetrics: true })}
          </div>
        )}

        {sections.runsOn.length > 0 && (
          <div data-testid="entity-detail-runs-on">
            <h3 className="text-sm font-semibold text-gray-900">
              {t("Runs on")} ({sections.runsOn.length})
            </h3>
            {renderRows(sections.runsOn.slice(0, 25), {
              showMetrics: false,
              infrastructureLinks: true,
            })}
            {sections.runsOn.length > 25 && (
              <p className="mt-1 text-xs text-gray-500">
                +{sections.runsOn.length - 25} {t("more")}
              </p>
            )}
          </div>
        )}

        {sections.related.length > 0 && (
          <div data-testid="entity-detail-related">
            <h3 className="text-sm font-semibold text-gray-900">
              {t("Related infrastructure")} ({sections.related.length})
            </h3>
            {renderRows(sections.related.slice(0, 25), { showMetrics: false })}
          </div>
        )}

        {connectionCount === 0 && (
          <p className="text-sm text-gray-500">
            {t("No connections in the selected time range.")}
          </p>
        )}

        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {t("Details")}
          </h3>
          <dl className="mt-2 space-y-1 text-sm text-gray-600">
            <div className="flex justify-between gap-4">
              <dt>{t("Type")}</dt>
              <dd className="text-right text-gray-900">{t(typeMeta.label)}</dd>
            </div>
            {attributes.map(
              (item: { label: string; value: string }): ReactElement => {
                return (
                  <div key={item.label} className="flex justify-between gap-4">
                    <dt>{t(item.label)}</dt>
                    <dd className="break-all text-right text-gray-900">
                      {item.value}
                    </dd>
                  </div>
                );
              },
            )}
            {entity.firstSeenAt && (
              <div className="flex justify-between gap-4">
                <dt>{t("First seen")}</dt>
                <dd className="text-right">
                  {OneUptimeDate.getDateAsLocalFormattedString(
                    entity.firstSeenAt,
                  )}
                </dd>
              </div>
            )}
            {entity.lastSeenAt && (
              <div className="flex justify-between gap-4">
                <dt>{t("Last seen")}</dt>
                <dd className="text-right">
                  {OneUptimeDate.getDateAsLocalFormattedString(
                    entity.lastSeenAt,
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900">{t("Open")}</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {entity._id && (
              <li>
                <Link
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.INVENTORY_VIEW] as Route,
                    { modelId: new ObjectID(entity._id.toString()) },
                  )}
                  className="font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {t("Inventory details")}
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
                  {t("Traces for this service")}
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
                  {t("Network device:")} {matchedDevice.name || "device"}
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
