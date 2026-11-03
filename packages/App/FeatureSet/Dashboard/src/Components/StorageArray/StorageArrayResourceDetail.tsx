import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import IconProp from "Common/Types/Icon/IconProp";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import OneUptimeDate from "Common/Types/Date";
import {
  SummaryField,
  getSummaryFieldKey,
} from "../Infrastructure/ResourceOverviewTab";
import ResourceMetricsTab from "../Infrastructure/ResourceMetricsTab";
import ResourcePartHero from "../ResourcePart/ResourcePartHero";
import ResourcePartReadError from "../ResourcePart/ResourcePartReadError";
import NeedsAttentionCard from "../ResourcePart/NeedsAttentionCard";
import ResourcePartOpenEventsCard from "../ResourcePart/ResourcePartOpenEventsCard";
import ResourcePartAlertsCard from "../ResourcePart/ResourcePartAlertsCard";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../ResourcePart/ResourcePartDetailsCard";
import { ResourceAttentionItem } from "../ResourcePart/ResourceAttention";
import {
  ResourcePartChip,
  ResourcePartStatus,
} from "../ResourcePart/ResourcePartTypes";
import { OpenIssueRecord } from "../ResourceTopology/ResourceTopologyIssues";
import StorageArrayResourceUtils, {
  getFileSystemProvisionedBytes,
} from "../../Pages/StorageArray/Utils/StorageArrayResourceUtils";
import {
  StorageArrayAssessment,
  assessStorageArrayPart,
  getStorageArrayAttentionItems,
  getStorageArrayAttentionKey,
  isStorageArrayIssueAbout,
} from "../../Pages/StorageArray/Utils/StorageArrayHealth";
import { loadFileSystemAvailableRatios } from "../../Pages/StorageArray/Utils/StorageArrayReadings";
import {
  StorageArrayPartRoutes,
  getStorageArrayPartRoutes,
} from "./Part/StorageArrayPartRoutes";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../MetricDescriptions/StorageArrayMetricDescriptions";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  kind: StorageArrayResourceKind;
  /*
   * The facts of the object's latest report, for its Details card. Called
   * only when the inventory has the row.
   */
  getSummaryFields: (row: StorageArrayResource) => Array<SummaryField>;
  // Charts for the Metrics tab, scoped to this array and this object.
  getQueryConfigs: (data: {
    arrayName: string;
    externalId: string;
  }) => Array<MetricQueryConfigData>;
  /*
   * translationKey() templates with {{name}}: what to say while the
   * inventory does not have the object, and the Metrics card's title.
   */
  emptyMessageTemplate: string;
  metricsTitleTemplate: string;
  // The Metrics card's description.
  description: string;
}

/*
 * What each kind of page says about its part, English, looked up where it
 * is drawn: where it sits, how Needs attention names it, its cards, and the
 * array's alerts that watch parts of its kind (a volume and a bucket have
 * none: whether the array as a whole is slow or full says it).
 */
interface PartTexts {
  icon: IconProp;
  location: string;
  current: string;
  attentionDescription: string;
  openTitle: string;
  openDescription: string;
  readError: string;
  detailsDescription: string;
  statusDescription?: string | undefined;
  alerts?:
    | { title: string; description: string; templateIds: Array<string> }
    | undefined;
}

const PART_TEXTS: Record<string, PartTexts> = {
  [StorageArrayResourceKind.Volume]: {
    icon: IconProp.Disc,
    location: translationKey("Volume of array {{array}}"),
    current: translationKey("This volume"),
    attentionDescription: translationKey(
      "What about this volume is broken or needs a look.",
    ),
    openTitle: translationKey("Open on this volume"),
    openDescription: translationKey(
      "Unresolved incidents and alerts about this volume, incidents first.",
    ),
    readError: translationKey("Couldn't load this volume"),
    detailsDescription: translationKey(
      "What the FlashArray reports about this volume.",
    ),
  },
  [StorageArrayResourceKind.Host]: {
    icon: IconProp.Server,
    location: translationKey("Host of array {{array}}"),
    current: translationKey("This host"),
    attentionDescription: translationKey(
      "What about this host is broken or needs a look.",
    ),
    openTitle: translationKey("Open on this host"),
    openDescription: translationKey(
      "Unresolved incidents and alerts about this host, incidents first.",
    ),
    readError: translationKey("Couldn't load this host"),
    detailsDescription: translationKey(
      "What the FlashArray reports about this host.",
    ),
    statusDescription: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostConnectivityColumn,
    alerts: {
      title: translationKey("Host alerts"),
      description: translationKey(
        "The array's alerts that watch its hosts, this one included: one monitor that fires for any host that no longer reaches the array through both controllers.",
      ),
      templateIds: ["purefa-host-connectivity-critical"],
    },
  },
  [StorageArrayResourceKind.FileSystem]: {
    icon: IconProp.Folder,
    location: translationKey("File system of array {{array}}"),
    current: translationKey("This file system"),
    attentionDescription: translationKey(
      "What about this file system is broken or needs a look.",
    ),
    openTitle: translationKey("Open on this file system"),
    openDescription: translationKey(
      "Unresolved incidents and alerts about this file system, incidents first.",
    ),
    readError: translationKey("Couldn't load this file system"),
    detailsDescription: translationKey(
      "What the FlashBlade reports about this file system.",
    ),
    statusDescription: STORAGE_ARRAY_METRIC_DESCRIPTIONS.fileSystemStatusColumn,
    alerts: {
      title: translationKey("File system alerts"),
      description: translationKey(
        "The FlashBlade's alerts that watch its file systems, this one included: one monitor that fires for any file system with less than 10% of its provisioned size left.",
      ),
      templateIds: ["purefb-file-system-near-full"],
    },
  },
  [StorageArrayResourceKind.Bucket]: {
    icon: IconProp.Cube,
    location: translationKey("Bucket of array {{array}}"),
    current: translationKey("This bucket"),
    attentionDescription: translationKey(
      "What about this bucket is broken or needs a look.",
    ),
    openTitle: translationKey("Open on this bucket"),
    openDescription: translationKey(
      "Unresolved incidents and alerts about this bucket, incidents first.",
    ),
    readError: translationKey("Couldn't load this bucket"),
    detailsDescription: translationKey(
      "What the FlashBlade reports about this bucket.",
    ),
  },
};

const LINK_CLASS_NAME: string =
  "font-medium text-gray-700 hover:text-indigo-600 hover:underline";

/*
 * The page behind one inventory object - a volume, a host, a file system,
 * a bucket - on the parts every resource's part page shares
 * (Components/ResourcePart): the hero with its state by the rules
 * (StorageArrayHealth), where it sits and its facts; what about it needs
 * attention, as the array's Overview says it; what is open on it; the
 * array's alerts that watch parts of its kind with Turn on N; what the
 * array reports about it; and a read that fails in its own frame with Try
 * again. The route param (subModelId) is the StorageArrayResource
 * externalId, the object's own name on the array, percent-encoded because
 * FlashArray names carry `/` and `::` - not a database id.
 */
const StorageArrayResourceDetail: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = StorageArrayResourceUtils.externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );
  const texts: PartTexts = PART_TEXTS[props.kind] as PartTexts;
  const routes: StorageArrayPartRoutes = getStorageArrayPartRoutes(modelId);

  const [storageArray, setStorageArray] = useState<StorageArray | null>(null);
  const [resource, setResource] = useState<StorageArrayResource | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingResource, setIsLoadingResource] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [resourceError, setResourceError] = useState<string>("");
  // A file system's latest available share of its provisioned size.
  const [availableRatio, setAvailableRatio] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState<number>(0);

  const fetchStorageArray: () => Promise<StorageArray | null> =
    async (): Promise<StorageArray | null> => {
      setIsLoading(true);
      let item: StorageArray | null = null;
      try {
        item = await ModelAPI.getItem({
          modelType: StorageArray,
          id: modelId,
          select: {
            name: true,
            storageSystem: true,
          },
        });
        setStorageArray(item);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
      setIsLoading(false);
      return item;
    };

  const fetchResource: () => Promise<void> = async (): Promise<void> => {
    setIsLoadingResource(true);
    setResourceError("");
    try {
      setResource(
        await StorageArrayResourceUtils.fetchStorageArrayResource({
          storageArrayId: modelId,
          kind: props.kind,
          externalId: externalId,
        }),
      );
    } catch (err) {
      setResourceError(API.getFriendlyMessage(err));
    }
    setIsLoadingResource(false);
  };

  const fetchReadings: (arrayName: string) => Promise<void> = async (
    arrayName: string,
  ): Promise<void> => {
    if (props.kind !== StorageArrayResourceKind.FileSystem) {
      return;
    }
    try {
      const ratios: Map<string, number> =
        await loadFileSystemAvailableRatios(arrayName);
      setAvailableRatio(ratios.get(externalId) ?? null);
    } catch {
      // Best-effort: the file system reads Available without it.
    }
  };

  const refresh: () => void = (): void => {
    setRefreshToken((token: number) => {
      return token + 1;
    });
    fetchResource().catch(() => {});
    if (storageArray?.name) {
      fetchReadings(storageArray.name).catch(() => {});
    }
  };

  useEffect(() => {
    fetchStorageArray()
      .then((item: StorageArray | null) => {
        if (item?.name) {
          fetchReadings(item.name).catch(() => {});
        }
      })
      .catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
      });
    fetchResource().catch(() => {});
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!storageArray?.name) {
    return <ErrorMessage message="Storage array not found." />;
  }

  const arrayName: string = storageArray.name;
  const row: StorageArrayResource | null = resource;
  const readings: { availableRatio: number | null } = {
    availableRatio: availableRatio,
  };
  const assessment: StorageArrayAssessment | null = row
    ? assessStorageArrayPart(row, readings)
    : null;

  const status: ResourcePartStatus | undefined = assessment
    ? { ...assessment.status, description: texts.statusDescription }
    : undefined;

  const chips: Array<ResourcePartChip> = row
    ? getHeroChips(props.kind, row, translator)
    : [];

  const hero: ReactElement = (
    <ResourcePartHero
      testId="storage-array-part-hero"
      icon={texts.icon}
      accent="orange"
      name={
        row ? StorageArrayResourceUtils.displayNameForResource(row) : externalId
      }
      status={status}
      location={
        <TranslatedSentence
          template={texts.location}
          slots={{
            array: (
              <Link to={routes.arrayRoute} className={LINK_CLASS_NAME}>
                <bdi>{arrayName}</bdi>
              </Link>
            ),
          }}
        />
      }
      lastReportAt={
        row?.lastSeenAt ? OneUptimeDate.fromString(row.lastSeenAt) : null
      }
      chips={chips}
    />
  );

  const renderOverview: () => ReactElement = (): ReactElement => {
    if (isLoadingResource) {
      return <PageLoader isVisible={true} />;
    }

    if (resourceError) {
      return (
        <ResourcePartReadError
          testId="storage-array-part-read-error"
          title={texts.readError}
          message={resourceError}
          onRetry={refresh}
        />
      );
    }

    if (!row) {
      return (
        <p
          className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm"
          data-testid="storage-array-part-not-reported"
        >
          {translator.translateTemplate(props.emptyMessageTemplate, {
            name: externalId,
          })}
        </p>
      );
    }

    const attentionItems: Array<ResourceAttentionItem> =
      getStorageArrayAttentionItems({
        arrayName: arrayName,
        array: {},
        parts: [row],
        readingsFor: () => {
          return readings;
        },
      });

    const detailRows: Array<ResourcePartDetailRow> = props
      .getSummaryFields(row)
      .map((field: SummaryField, index: number): ResourcePartDetailRow => {
        return {
          key: getSummaryFieldKey(field.title),
          label: field.title,
          value: field.value,
          description: field.description,
          // The first row is the part's own name on the array.
          mono: index === 0,
          copyText: field.copyText || (index === 0 ? externalId : undefined),
        };
      });

    return (
      <div data-testid="storage-array-part-overview">
        <NeedsAttentionCard
          testId="storage-array-part-attention"
          items={attentionItems}
          current={{
            key: getStorageArrayAttentionKey(row),
            label: texts.current,
          }}
          description={texts.attentionDescription}
        />

        <ResourcePartOpenEventsCard
          testId="storage-array-part-open"
          title={texts.openTitle}
          description={texts.openDescription}
          resourceRelation="storageArrays"
          resourceId={modelId}
          isAbout={(record: OpenIssueRecord): boolean => {
            return isStorageArrayIssueAbout(record, row);
          }}
          getIncidentRoute={routes.getIncidentRoute}
          getAlertRoute={routes.getAlertRoute}
          incidentsRoute={routes.incidentsRoute}
          alertsRoute={routes.alertsRoute}
          refreshToken={refreshToken}
        />

        {texts.alerts ? (
          <ResourcePartAlertsCard
            testId="storage-array-part-alerts"
            title={texts.alerts.title}
            description={texts.alerts.description}
            resourceType={MonitorRecommendationResourceType.StorageArray}
            templateIds={texts.alerts.templateIds}
            resourceId={modelId}
            resourceIdentifier={arrayName}
            context={{
              storageSystem: storageArray.storageSystem as string | undefined,
            }}
            getRecommendationsRoute={routes.getRecommendationsRoute}
            getMonitorRoute={routes.getMonitorRoute}
            refreshToken={refreshToken}
          />
        ) : (
          <></>
        )}

        <ResourcePartDetailsCard
          testId="storage-array-part-details"
          description={texts.detailsDescription}
          rows={detailRows}
        />
      </div>
    );
  };

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: renderOverview(),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={translator.translateTemplate(props.metricsTitleTemplate, {
            name: externalId,
          })}
          description={props.description}
        >
          <ResourceMetricsTab
            queryConfigs={props.getQueryConfigs({
              arrayName: arrayName,
              externalId: externalId,
            })}
          />
        </Card>
      ),
    },
  ];

  return (
    <div data-testid="storage-array-part-page" data-kind={props.kind}>
      {hero}
      <Tabs tabs={tabs} wrap={true} onTabChange={() => {}} />
    </div>
  );
};

/*
 * The facts a part's hero shows beside its state, in the reader's
 * language: a volume's size and the hosts it is connected to, a host's
 * volumes and group, a file system's size and protocols, a bucket's quota.
 */
function getHeroChips(
  kind: StorageArrayResourceKind,
  row: StorageArrayResource,
  translator: Translator,
): Array<ResourcePartChip> {
  const chips: Array<ResourcePartChip> = [];
  const count: number | null =
    row.connectionCount === null || row.connectionCount === undefined
      ? null
      : Number(row.connectionCount);

  if (kind === StorageArrayResourceKind.Volume) {
    const provisioned: number | null =
      StorageArrayResourceUtils.freshMetricValue(row, row.capacityBytes);
    if (provisioned !== null) {
      chips.push({
        key: "provisioned",
        icon: IconProp.Disc,
        label: translator.translateTemplate("{{size}} provisioned", {
          size: StorageArrayResourceUtils.formatBytes(provisioned),
        }),
      });
    }
    if (count !== null) {
      chips.push({
        key: "hosts",
        icon: IconProp.Server,
        label: translator.translatePlural(
          { one: "{{count}} host", other: "{{count}} hosts" },
          count,
        ),
      });
    }
  } else if (kind === StorageArrayResourceKind.Host) {
    if (count !== null) {
      chips.push({
        key: "volumes",
        icon: IconProp.Disc,
        label: translator.translatePlural(
          { one: "{{count}} volume", other: "{{count}} volumes" },
          count,
        ),
      });
    }
    if (row.groupName) {
      // The host group, as the array names it.
      chips.push({
        key: "host-group",
        icon: IconProp.Folder,
        label: row.groupName,
      });
    }
  } else if (kind === StorageArrayResourceKind.FileSystem) {
    const provisioned: number | null = getFileSystemProvisionedBytes(row);
    if (provisioned !== null) {
      chips.push({
        key: "provisioned",
        icon: IconProp.Disc,
        label: translator.translateTemplate("{{size}} provisioned", {
          size: StorageArrayResourceUtils.formatBytes(provisioned),
        }),
      });
    }
  } else if (kind === StorageArrayResourceKind.Bucket) {
    const quota: number | null = StorageArrayResourceUtils.freshMetricValue(
      row,
      row.capacityBytes,
    );
    if (quota !== null && quota > 0) {
      chips.push({
        key: "quota",
        icon: IconProp.Disc,
        label: translator.translateTemplate("{{size}} quota", {
          size: StorageArrayResourceUtils.formatBytes(quota),
        }),
      });
    }
  }

  return chips;
}

export default StorageArrayResourceDetail;
