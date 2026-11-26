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
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import StorageArrayResourceKindUtil from "Common/Types/StorageArray/StorageArrayResourceKindUtil";
import {
  StorageArrayKindDefinition,
  StorageArrayKindPage,
} from "Common/Types/StorageArray/StorageArrayPlatform";
import IconProp from "Common/Types/Icon/IconProp";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
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
import {
  ResourcePartAttention,
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
import { chartWordsInReadersLanguage } from "../Metrics/Utils/ChartWordsInReadersLanguage";
import ResourceStorageCard from "../ResourcePart/ResourceStorageCard";
import { StorageUsage } from "Common/Utils/Storage/StorageUsage";
import {
  getStorageArrayKindSummaryFields,
  getStorageArrayPartQueries,
  getStorageArrayRowUsage,
} from "./StorageArrayKindView";
import { translatableTerm } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  // A shared kind, or one only the array's platform has (an aggregate).
  kind: StorageArrayResourceKind | string;
  /*
   * The array and the object's name on it, where the route does not end
   * in .../<array>/<list>/<externalId>: a platform kind's part route
   * (.../<array>/inventory/<kind>/<externalId>) carries its kind too.
   */
  storageArrayId?: ObjectID | undefined;
  externalId?: string | undefined;
  /*
   * The facts of the object's latest report, for its Details card. Called
   * only when the inventory has the row. A platform that declares the
   * kind's facts (StorageArrayKindPage.part.fields) draws its own instead.
   */
  getSummaryFields?: ((row: StorageArrayResource) => Array<SummaryField>) | undefined;
  /*
   * Charts for the Metrics tab, scoped to this array and this object. The
   * array's platform's charts for the kind (StorageArrayKindPage.part)
   * when absent: what every shared kind's page does since #11122.
   */
  getQueryConfigs?:
    | ((data: {
        arrayName: string;
        externalId: string;
      }) => Array<MetricQueryConfigData>)
    | undefined;
  /*
   * translationKey() templates with {{name}}: what to say while the
   * inventory does not have the object, and the Metrics card's title. The
   * platform's words for the first win (notReportedMessage).
   */
  emptyMessageTemplate: string;
  metricsTitleTemplate: string;
  /*
   * The Metrics card's description, where the array's platform has none
   * (StorageArrayKindPage.part.metricsDescription).
   */
  description: string;
  /*
   * How full the part is, for a part that holds data against a size - a
   * bucket's quota, a file system's provisioned size - drawn in a Storage
   * card under Needs attention (#9647). readings carries what the
   * inventory has no column for (a file system's available share).
   */
  storage?:
    | {
        description: string;
        getUsage: (
          row: StorageArrayResource,
          readings: { availableRatio: number | null },
        ) => StorageUsage | null;
        // English: why there is no reading ("No quota", "Not reported").
        getNoUsageText?:
          | ((row: StorageArrayResource) => string | undefined)
          | undefined;
      }
    | undefined;
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
  /*
   * The {{kind}} of a platform kind's location ("Aggregate of array
   * {{array}}"), in the reader's words.
   */
  locationKind?: string | undefined;
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
      "What the array reports about this volume.",
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
      "What the array reports about this host.",
    ),
    statusDescription: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostConnectivityColumn,
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
      "What the array reports about this file system.",
    ),
    statusDescription: STORAGE_ARRAY_METRIC_DESCRIPTIONS.fileSystemStatusColumn,
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
      "What the array reports about this bucket.",
    ),
  },
};

/*
 * The words of a kind only the array's platform has (a NetApp aggregate,
 * SVM, LUN or SnapMirror relationship): its definition's name, set into
 * sentences every such kind shares.
 */
function getPlatformPartTexts(
  kind: string,
  storageSystem: string | null | undefined,
  translator: Translator,
): PartTexts {
  const definition: StorageArrayKindDefinition | null =
    StorageArrayPlatformRegistry.getKindDefinition(kind, storageSystem);
  const name: string = definition?.singularLabel || kind;
  const inSentence: ReturnType<typeof translatableTerm> = translatableTerm(
    name,
    { inSentence: true },
  );
  return {
    icon: definition?.icon || IconProp.Squares,
    location: translationKey("{{kind}} of array {{array}}"),
    locationKind: translator.translateText(name),
    current: translator.translateTemplate(PLATFORM_PART_CURRENT, {
      kind: inSentence,
    }),
    attentionDescription: translator.translateTemplate(
      PLATFORM_PART_ATTENTION,
      { kind: inSentence },
    ),
    openTitle: translator.translateTemplate(PLATFORM_PART_OPEN_TITLE, {
      kind: inSentence,
    }),
    openDescription: translator.translateTemplate(
      PLATFORM_PART_OPEN_DESCRIPTION,
      { kind: inSentence },
    ),
    readError: translator.translateTemplate(PLATFORM_PART_READ_ERROR, {
      kind: inSentence,
    }),
    detailsDescription: translator.translateTemplate(PLATFORM_PART_DETAILS, {
      kind: inSentence,
    }),
  };
}

const PLATFORM_PART_CURRENT: string = translationKey("This {{kind}}");
const PLATFORM_PART_ATTENTION: string = translationKey(
  "What about this {{kind}} is broken or needs a look.",
);
const PLATFORM_PART_OPEN_TITLE: string = translationKey("Open on this {{kind}}");
const PLATFORM_PART_OPEN_DESCRIPTION: string = translationKey(
  "Unresolved incidents and alerts about this {{kind}}, incidents first.",
);
const PLATFORM_PART_READ_ERROR: string = translationKey(
  "Couldn't load this {{kind}}",
);
const PLATFORM_PART_DETAILS: string = translationKey(
  "What the array reports about this {{kind}}.",
);

// What a part's Storage card says while it has no size or use yet.
const PLATFORM_PART_USAGE_NOT_REPORTED: string = translationKey("Not reported");

/*
 * Where a part's Storage bar turns amber and red: the lines its list's Used
 * column draws at (StorageArrayKindColumn usage), the array's capacity
 * lines otherwise.
 */
function getUsageLines(page: StorageArrayKindPage): {
  warningPercent?: number | undefined;
  criticalPercent?: number | undefined;
} {
  for (const column of page.columns || []) {
    if (column.type === "usage") {
      return {
        warningPercent: column.warningPercent,
        criticalPercent: column.criticalPercent,
      };
    }
  }
  return {};
}

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
  const modelId: ObjectID =
    props.storageArrayId ?? Navigation.getLastParamAsObjectID(2);
  const externalId: string =
    props.externalId ??
    StorageArrayResourceUtils.externalIdFromRouteParam(
      Navigation.getLastParamAsString(),
    );

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
          kind: props.kind as StorageArrayResourceKind,
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
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!storageArray?.name) {
    return <ErrorMessage message="Storage array not found." />;
  }

  const arrayName: string = storageArray.name;
  const storageSystem: string | undefined = storageArray.storageSystem as
    | string
    | undefined;
  const routes: StorageArrayPartRoutes = getStorageArrayPartRoutes(
    modelId,
    storageSystem,
  );
  /*
   * What the array's platform says and charts for this kind (#11122): its
   * descriptions, its charts and, for a kind only it has, the facts it
   * lists. A shared kind's page keeps its own words where the platform
   * says nothing.
   */
  const kindPage: StorageArrayKindPage | null =
    StorageArrayPlatformRegistry.getKindPage(storageSystem, props.kind);
  const texts: PartTexts = Object.prototype.hasOwnProperty.call(
    PART_TEXTS,
    props.kind,
  )
    ? (PART_TEXTS[props.kind] as PartTexts)
    : getPlatformPartTexts(props.kind, storageSystem, translator);
  const partAlerts: PartTexts["alerts"] = kindPage?.part?.alerts
    ? {
        title: kindPage.part.alerts.title,
        description: kindPage.part.alerts.description,
        templateIds: [...kindPage.part.alerts.templateIds],
      }
    : texts.alerts;
  const detailsDescription: string =
    kindPage?.part?.detailsDescription || texts.detailsDescription;
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

  /*
   * What needs attention on the part, read once by the array's rules: the
   * Overview's card lists it, and the hero's status opens it when it says
   * something is wrong (#9594).
   */
  const attention: ResourcePartAttention = {
    items: row
      ? getStorageArrayAttentionItems({
          arrayName: arrayName,
          array: {},
          parts: [row],
          readingsFor: () => {
            return readings;
          },
        })
      : [],
    description: texts.attentionDescription,
    current: row
      ? { key: getStorageArrayAttentionKey(row), label: texts.current }
      : undefined,
  };

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
            ...(texts.locationKind
              ? { kind: <>{texts.locationKind}</> }
              : {}),
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
      attention={attention}
    />
  );

  const renderOverview: () => ReactElement = (): ReactElement => {
    if (isLoadingResource) {
      return <PageSkeleton />;
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
          {translator.translateTemplate(
            kindPage?.part?.notReportedMessage || props.emptyMessageTemplate,
            {
              name: externalId,
            },
          )}
        </p>
      );
    }

    /*
     * A fact only once the array reported it, as on every resource's
     * Details: a FlashBlade file system that sends no latency or IOPS had
     * five rows of dashes. The first row is the part's own name, always.
     */
    const summaryFields: Array<SummaryField> = kindPage?.part?.fields
      ? getStorageArrayKindSummaryFields(kindPage.part.fields, row)
      : props.getSummaryFields
        ? props.getSummaryFields(row)
        : [
            {
              title: StorageArrayResourceKindUtil.getSingularLabel(props.kind),
              value: StorageArrayResourceUtils.displayNameForResource(row),
            },
          ];
    const detailRows: Array<ResourcePartDetailRow> = summaryFields
      .filter((field: SummaryField, index: number): boolean => {
        return index === 0 || !isUnreportedSummaryValue(field.value);
      })
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
          items={attention.items}
          current={attention.current}
          description={attention.description}
        />

        {props.storage ? (
          <ResourceStorageCard
            testId="storage-array-part-storage"
            description={
              kindPage?.part?.storageDescription || props.storage.description
            }
            usage={props.storage.getUsage(row, readings)}
            noUsageText={props.storage.getNoUsageText?.(row)}
            measuredAt={
              row.metricsUpdatedAt
                ? new Date(row.metricsUpdatedAt as Date)
                : undefined
            }
          />
        ) : kindPage?.part?.storageDescription ? (
          <ResourceStorageCard
            testId="storage-array-part-storage"
            description={kindPage.part.storageDescription}
            usage={getStorageArrayRowUsage(row, getUsageLines(kindPage))}
            noUsageText={PLATFORM_PART_USAGE_NOT_REPORTED}
            measuredAt={
              row.metricsUpdatedAt
                ? new Date(row.metricsUpdatedAt as Date)
                : undefined
            }
          />
        ) : (
          <></>
        )}

        <ResourcePartOpenEventsCard
          testId="storage-array-part-open"
          title={texts.openTitle}
          description={texts.openDescription}
          resourceRelation="storageArrays"
          resourceId={modelId}
          isAbout={(record: OpenIssueRecord): boolean => {
            return isStorageArrayIssueAbout(record, row, storageSystem);
          }}
          getIncidentRoute={routes.getIncidentRoute}
          getAlertRoute={routes.getAlertRoute}
          incidentsRoute={routes.incidentsRoute}
          alertsRoute={routes.alertsRoute}
          refreshToken={refreshToken}
        />

        {partAlerts ? (
          <ResourcePartAlertsCard
            testId="storage-array-part-alerts"
            title={partAlerts.title}
            description={partAlerts.description}
            resourceType={MonitorRecommendationResourceType.StorageArray}
            templateIds={partAlerts.templateIds}
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
          description={detailsDescription}
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
          description={kindPage?.part?.metricsDescription || props.description}
        >
          <ResourceMetricsTab
            queryConfigs={chartWordsInReadersLanguage(
              props.getQueryConfigs
                ? props.getQueryConfigs({
                    arrayName: arrayName,
                    externalId: externalId,
                  })
                : kindPage?.part
                  ? getStorageArrayPartQueries(kindPage.part, {
                      arrayName: arrayName,
                      externalId: externalId,
                      row: row,
                    })
                  : [],
              translator,
            )}
          />
        </Card>
      ),
    },
  ];

  return (
    <div data-testid="storage-array-part-page" data-kind={props.kind}>
      {hero}
      <Tabs label="Resource" tabs={tabs} wrap={true} onTabChange={() => {}} />
    </div>
  );
};

// A Details value the array never sent: the dash its formatters write for one.
export function isUnreportedSummaryValue(
  value: SummaryField["value"],
): boolean {
  return typeof value === "string" && (value.trim() === "" || value === "—");
}

/*
 * The facts a part's hero shows beside its state, in the reader's
 * language: a volume's size and the hosts it is connected to, a host's
 * volumes and group, a file system's size and protocols, a bucket's quota.
 */
function getHeroChips(
  kind: string,
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
        label: translator.translateTemplate(
          "{{size}} provisioned",
          { size: StorageArrayResourceUtils.formatBytes(provisioned) },
          // "68.0 TiB" reads as written in a Persian chip.
          { setsValuesApart: true },
        ),
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
        label: translator.translateTemplate(
          "{{size}} provisioned",
          { size: StorageArrayResourceUtils.formatBytes(provisioned) },
          // "68.0 TiB" reads as written in a Persian chip.
          { setsValuesApart: true },
        ),
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
        label: translator.translateTemplate(
          "{{size}} quota",
          { size: StorageArrayResourceUtils.formatBytes(quota) },
          { setsValuesApart: true },
        ),
      });
    }
  }

  return chips;
}

export default StorageArrayResourceDetail;
