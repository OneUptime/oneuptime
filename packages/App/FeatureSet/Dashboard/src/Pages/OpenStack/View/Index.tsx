import PageComponentProps from "../../PageComponentProps";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AgentVersion from "../../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../../Components/AgentVersion/AgentKind";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import OpenStackDocumentationCard from "../../../Components/OpenStack/DocumentationCard";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import ResourceConnectionGuideCard from "../../../Components/ResourceConnection/ResourceConnectionGuideCard";
import { getOpenStackCloudConnectionGuide } from "../../../Components/ResourceConnection/ResourceConnectionGuides";
import { isResourceStatusConnected } from "../../../Components/ResourceConnection/ResourceConnectionState";
import { getConfiguredOneUptimeUrl } from "../../../Components/SetupGuide/ConfiguredOneUptimeUrl";
import { formatBytes } from "../../../Components/TelemetryResource/telemetryFormat";
import { getResourceConnectionLabel } from "../../../Components/TelemetryResource/ResourceHeroStatus";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  OpenStackInventorySummary,
  fetchOpenStackInventorySummary,
  getOpenStackPercent,
  isOpenStackInventoryEmpty,
} from "../Utils/OpenStackResourceUtils";

/*
 * A cloud's Overview: whether its data is arriving, what it holds, and what has
 * been promised out of it. A cloud with nothing reported yet shows the setup
 * guide, because zeros would read as an empty cloud rather than as one that has
 * not connected.
 *
 * It says nothing about health, and has no "Healthy" pill: that verdict needs the
 * rules #5723 brings (OpenStackHealth), and until then this page has no way to
 * earn it. The pill goes beside the connection pill below, and Needs attention
 * under the data status card: see the note at each.
 */

interface CountChip {
  key: string;
  icon: IconProp;
  label: string;
  // A list to open. Regions and availability zones have no list of their own.
  page?: PageMap | undefined;
  isDanger?: boolean | undefined;
}

const CHIP_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700";
const LINK_CHIP_CLASS_NAME: string = `${CHIP_CLASS_NAME} hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`;
const DANGER_CHIP_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:border-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500";

/*
 * Only what the cloud reported: a kind with no rows has no chip, since a credential
 * that cannot list hypervisors has none to count, and "0 hypervisors" is not true.
 */
function getCountChips(
  summary: OpenStackInventorySummary,
  translator: Translator,
): Array<CountChip> {
  const chips: Array<CountChip> = [
    {
      key: "regions",
      icon: IconProp.Globe,
      label: translator.translatePlural(
        { one: "{{count}} region", other: "{{count}} regions" },
        summary.regionCount,
      ),
    },
    {
      key: "availability-zones",
      icon: IconProp.MapPin,
      label: translator.translatePlural(
        {
          one: "{{count}} availability zone",
          other: "{{count}} availability zones",
        },
        summary.availabilityZoneCount,
      ),
    },
    {
      key: "services",
      icon: IconProp.Activity,
      label: translator.translatePlural(
        { one: "{{count}} service", other: "{{count}} services" },
        summary.serviceCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_SERVICES,
    },
    {
      key: "hypervisors",
      icon: IconProp.ServerStack,
      label: translator.translatePlural(
        { one: "{{count}} hypervisor", other: "{{count}} hypervisors" },
        summary.hypervisorCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISORS,
    },
    {
      key: "instances",
      icon: IconProp.Cube,
      label: translator.translatePlural(
        { one: "{{count}} instance", other: "{{count}} instances" },
        summary.instanceCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES,
    },
    {
      key: "networks",
      icon: IconProp.Globe,
      label: translator.translatePlural(
        { one: "{{count}} network", other: "{{count}} networks" },
        summary.networkCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS,
    },
    {
      key: "routers",
      icon: IconProp.Share,
      label: translator.translatePlural(
        { one: "{{count}} router", other: "{{count}} routers" },
        summary.routerCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS,
    },
    {
      key: "floating-ips",
      icon: IconProp.MapPin,
      label: translator.translatePlural(
        { one: "{{count}} floating IP", other: "{{count}} floating IPs" },
        summary.floatingIpCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS,
    },
    {
      key: "volumes",
      icon: IconProp.Disc,
      label: translator.translatePlural(
        { one: "{{count}} volume", other: "{{count}} volumes" },
        summary.volumeCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES,
    },
    {
      key: "projects",
      icon: IconProp.Folder,
      label: translator.translatePlural(
        { one: "{{count}} project", other: "{{count}} projects" },
        summary.projectCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_PROJECTS,
    },
  ];

  const counts: Record<string, number> = {
    regions: summary.regionCount,
    "availability-zones": summary.availabilityZoneCount,
    services: summary.serviceCount,
    hypervisors: summary.hypervisorCount,
    instances: summary.instanceCount,
    networks: summary.networkCount,
    routers: summary.routerCount,
    "floating-ips": summary.floatingIpCount,
    volumes: summary.volumeCount,
    projects: summary.projectCount,
  };

  const reported: Array<CountChip> = chips.filter(
    (chip: CountChip): boolean => {
      return (counts[chip.key] || 0) > 0;
    },
  );

  /*
   * How many enabled services and agents are down is a count, not a verdict, and
   * the one a person opens this page for. One someone disabled is not counted.
   */
  if (summary.downServiceCount > 0) {
    reported.push({
      key: "services-down",
      icon: IconProp.ExclaimationCircle,
      label: translator.translatePlural(
        { one: "{{count}} service down", other: "{{count}} services down" },
        summary.downServiceCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_SERVICES,
      isDanger: true,
    });
  }

  return reported;
}

const NOT_REPORTED: string = translationKey("Not reported yet");

function formatPercent(percent: number | null): string {
  return percent === null ? "—" : `${Math.round(percent)}%`;
}

const OpenStackCloudOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cloud, setCloud] = useState<OpenStackCloud | null>(null);
  const [summary, setSummary] = useState<OpenStackInventorySummary | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const [item, inventory]: [
        OpenStackCloud | null,
        OpenStackInventorySummary | null,
      ] = await Promise.all([
        ModelAPI.getItem<OpenStackCloud>({
          modelType: OpenStackCloud,
          id: modelId,
          select: {
            name: true,
            otelCollectorStatus: true,
            lastSeenAt: true,
            agentVersion: true,
          },
        }),
        fetchOpenStackInventorySummary(modelId),
      ]);

      if (!inventory) {
        setError(
          translator.translateText(
            "This cloud's inventory could not be read.",
          ) || "This cloud's inventory could not be read.",
        );
      }

      setCloud(item);
      setSummary(inventory);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return (
      <ResourcePartReadError
        testId="openstack-overview-read-error"
        title="Couldn't load this cloud"
        message={error}
        onRetry={() => {
          fetchData().catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
          });
        }}
      />
    );
  }

  if (!cloud || !summary) {
    return <ErrorMessage message="Cloud not found." />;
  }

  const hasReported: boolean =
    Boolean(cloud.lastSeenAt) || !isOpenStackInventoryEmpty(summary);

  if (!hasReported) {
    return (
      <OpenStackDocumentationCard
        cloudName={cloud.name || ""}
        title="Connect this cloud"
        description="Nothing has been reported yet. Install the OneUptime OpenStack agent on a machine outside the cloud, and its services, hypervisors and instances appear here once data arrives."
      />
    );
  }

  const status: string = cloud.otelCollectorStatus || "";
  const isConnected: boolean = isResourceStatusConnected(status);

  const lastSeenText: string = cloud.lastSeenAt
    ? translator.translateTemplate("Last seen {{time}}", {
        time: OneUptimeDate.fromNow(cloud.lastSeenAt),
      })
    : translator.translateText("Never seen") || "Never seen";

  const documentationRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_DOCUMENTATION] as Route,
    { modelId: modelId },
  );

  const vcpuPercent: number | null = getOpenStackPercent(
    summary.vcpuAllocated,
    summary.vcpuCapacity,
  );
  const memoryPercent: number | null = getOpenStackPercent(
    summary.memoryAllocatedBytes,
    summary.memoryCapacityBytes,
  );
  const storagePercent: number | null = getOpenStackPercent(
    summary.storageUsedBytes,
    summary.storageCapacityBytes,
  );

  return (
    <Fragment>
      <ResourceConnectionGuideCard
        status={status}
        lastSeenAt={cloud.lastSeenAt}
        guide={getOpenStackCloudConnectionGuide(
          cloud.name || "",
          getConfiguredOneUptimeUrl(),
        )}
        documentationRoute={documentationRoute}
      />

      <div data-testid="openstack-overview-data-status">
        <Card
          title="Data status"
          description="Whether this cloud's data is reaching OneUptime, and what it has reported."
        >
          <div>
            <div className="flex flex-wrap items-center gap-3">
              {/*
               * #5723: the health pill goes here, beside the connection pill,
               * once OpenStackHealth can say so. A cloud with nothing reported
               * never reaches this card, so it can never show one.
               */}
              <span
                data-testid="openstack-overview-connection"
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  isConnected
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-amber-50 text-amber-700 ring-amber-200"
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    isConnected ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                {getResourceConnectionLabel({
                  translator: translator,
                  isConnected: isConnected,
                  status: status,
                })}
              </span>
              <span className="text-sm text-gray-500">{lastSeenText}</span>
              <AgentVersion
                kind={AgentKind.OpenStackAgent}
                version={cloud.agentVersion}
                variant="chip"
              />
              <Link
                to={documentationRoute}
                className="text-sm font-medium text-indigo-600 hover:underline"
              >
                {translator.translateText("Setup guide") || "Setup guide"}
              </Link>
            </div>
            <div
              data-testid="openstack-overview-counts"
              className="mt-4 flex flex-wrap items-center gap-1.5"
            >
              {getCountChips(summary, translator).map(
                (chip: CountChip): ReactElement => {
                  const content: ReactElement = (
                    <>
                      <Icon icon={chip.icon} className="h-3 w-3" />
                      <span>{chip.label}</span>
                    </>
                  );

                  if (!chip.page) {
                    return (
                      <span key={chip.key} className={CHIP_CLASS_NAME}>
                        {content}
                      </span>
                    );
                  }

                  return (
                    <Link
                      key={chip.key}
                      to={RouteUtil.populateRouteParams(
                        RouteMap[chip.page] as Route,
                        { modelId: modelId },
                      )}
                      className={
                        chip.isDanger
                          ? DANGER_CHIP_CLASS_NAME
                          : LINK_CHIP_CLASS_NAME
                      }
                    >
                      {content}
                    </Link>
                  );
                },
              )}
            </div>
          </div>
        </Card>
      </div>

      {/*
       * #5723: Needs attention goes here, between what the cloud holds and what
       * has been promised out of it, read from OpenStackHealth.
       */}

      {/*
       * No bar on these: its colours would be a verdict, and every threshold in
       * this product is its alert template's (#5723, #5729). Nova and Placement
       * report what is promised, so nothing here says CPU or usage.
       */}
      <div
        data-testid="openstack-overview-capacity"
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        <GoldenMetricTile
          title="vCPUs allocated"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(vcpuPercent)}
          sublabel={
            vcpuPercent === null
              ? NOT_REPORTED
              : translator.translateTemplate("{{used}} of {{total}}", {
                  used: String(Math.round(summary.vcpuAllocated)),
                  total: String(Math.round(summary.vcpuCapacity)),
                })
          }
          description="vCPUs Nova and Placement have promised to instances, out of what they can promise. This is what is promised, not how busy the hosts are."
        />
        <GoldenMetricTile
          title="Memory allocated"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatPercent(memoryPercent)}
          sublabel={
            memoryPercent === null
              ? NOT_REPORTED
              : translator.translateTemplate("{{used}} of {{total}}", {
                  used: formatBytes(summary.memoryAllocatedBytes),
                  total: formatBytes(summary.memoryCapacityBytes),
                })
          }
          description="Memory Nova and Placement have promised to instances, out of what they can promise. This is what is promised, not what is in use."
        />
        <GoldenMetricTile
          title="Storage used"
          icon={IconProp.Database}
          iconColor="amber"
          value={formatPercent(storagePercent)}
          sublabel={
            storagePercent === null
              ? NOT_REPORTED
              : translator.translateTemplate("{{used}} of {{total}}", {
                  used: formatBytes(summary.storageUsedBytes),
                  total: formatBytes(summary.storageCapacityBytes),
                })
          }
          description="How much of Cinder's storage pools is used, as the pools report it."
        />
      </div>
    </Fragment>
  );
};

export default OpenStackCloudOverview;
