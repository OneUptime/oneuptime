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
import Card from "Common/UI/Components/Card/Card";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourceOverviewTab, {
  SummaryField,
} from "../Infrastructure/ResourceOverviewTab";
import ResourceMetricsTab from "../Infrastructure/ResourceMetricsTab";
import StorageArrayResourceUtils from "../../Pages/StorageArray/Utils/StorageArrayResourceUtils";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  kind: StorageArrayResourceKind;
  /*
   * The summary of the object's latest report. Called only when the
   * inventory has the row.
   */
  getSummaryFields: (
    row: StorageArrayResource,
    storageArray: StorageArray,
  ) => Array<SummaryField>;
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
 * The page behind one inventory object — a volume, a host, a file system,
 * a bucket. The route param (subModelId) is the StorageArrayResource
 * externalId, the object's own name on the array, percent-encoded because
 * FlashArray names carry `/` and `::` — not a database id, mirroring the
 * Ceph OSD detail route contract (Pages/Ceph/View/OsdDetail.tsx).
 */
const StorageArrayResourceDetail: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = StorageArrayResourceUtils.externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [storageArray, setStorageArray] = useState<StorageArray | null>(null);
  const [resource, setResource] = useState<StorageArrayResource | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingResource, setIsLoadingResource] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchStorageArray: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: StorageArray | null = await ModelAPI.getItem({
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
  };

  const fetchResource: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoadingResource(true);
    try {
      setResource(
        await StorageArrayResourceUtils.fetchStorageArrayResource({
          storageArrayId: modelId,
          kind: props.kind,
          externalId: externalId,
        }),
      );
    } catch {
      // Graceful degradation — the overview tab shows the empty state.
    }
    setIsLoadingResource(false);
  };

  useEffect(() => {
    fetchStorageArray().catch((err: Error) => {
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

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <ResourceOverviewTab
          summaryFields={
            resource ? props.getSummaryFields(resource, storageArray) : []
          }
          labels={{}}
          annotations={{}}
          isLoading={isLoadingResource}
          emptyMessage={translator.translateTemplate(
            props.emptyMessageTemplate,
            { name: externalId },
          )}
        />
      ),
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
              arrayName: storageArray.name,
              externalId: externalId,
            })}
          />
        </Card>
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default StorageArrayResourceDetail;
