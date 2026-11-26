import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ProbeUtil from "../../Utils/Probe";
import AppLink from "../../Components/AppLink/AppLink";
import {
  STORAGE_ARRAY_CONNECTION_FORM_STEPS,
  getStorageArrayConnectFormFields,
} from "../../Components/StorageArray/Connection/StorageArrayConnectionFormFields";
import {
  StorageArrayCollectionStatusView,
  StorageArrayCollectionTone,
  getCollector,
  getStorageArrayCollectionStatusView,
} from "../../Components/StorageArray/Connection/StorageArrayConnectionView";
import Probe from "Common/Models/DatabaseModels/Probe";
import StorageArrayConnection from "Common/Models/DatabaseModels/StorageArrayConnection";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { StorageArrayProbeCollector } from "Common/Types/StorageArray/Collection/StorageArrayProbeCollector";
import { CONNECT_PLATFORM_QUERY_PARAMETER } from "../../Components/StorageArray/Connection/StorageArrayConnectOffer";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import { BILLING_ENABLED } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * STORAGE ARRAY CONNECTIONS (#11004): the Unisphere for PowerMax servers a
 * probe reads arrays from, and Connect Unisphere - VMware's Connect vCenter
 * for a server that adds every array behind it. Each connection's page
 * says how its collection is doing and which arrays it found.
 *
 * Opened with `?create=1&platform=<platform>` (the Storage Arrays list's
 * Connect Unisphere, StorageArrayConnectOffer), it opens that platform's
 * Connect form at once, as every list opens its create form from its
 * address (CreateFormAddress).
 */

function toneOf(view: StorageArrayCollectionStatusView): PillTone {
  switch (view.tone) {
    case StorageArrayCollectionTone.Collecting:
      return PillTone.Success;
    case StorageArrayCollectionTone.Failing:
      return PillTone.Danger;
    default:
      return PillTone.Info;
  }
}

const StorageArrayConnections: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  // The platform a Connect link named, or the default one (getCollector).
  const [collector] = useState<StorageArrayProbeCollector>(
    getCollector(
      Navigation.getQueryStringByName(CONNECT_PLATFORM_QUERY_PARAMETER),
    ),
  );
  const [probes, setProbes] = useState<Array<Probe>>([]);

  useEffect(() => {
    ProbeUtil.getAllProbes()
      .then((allProbes: Array<Probe>) => {
        setProbes(allProbes);
      })
      .catch(() => {
        // The picker then offers none, and says how to add one.
      });
  }, []);

  const viewRoute: (id: ObjectID) => Route = (id: ObjectID): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.STORAGE_ARRAYS_CONNECTION_VIEW] as Route,
      { modelId: id },
    );
  };

  return (
    <ModelTable<StorageArrayConnection>
      modelType={StorageArrayConnection}
      id="storage-array-connections-table"
      userPreferencesKey="storage-array-connections-table"
      isDeleteable={false}
      isEditable={false}
      isCreateable={true}
      isViewable={true}
      createVerb="Connect"
      opensCreateFormFromAddress={true}
      name="Storage Array Connections"
      singularName="Unisphere"
      pluralName="Connections"
      cardProps={{
        title: "Connections",
        description: collector.words.listDescription,
      }}
      noItemsMessage="No Unisphere connected yet. Connect one with a read-only account, and every PowerMax it manages appears in Storage Arrays."
      showRefreshButton={true}
      formSteps={STORAGE_ARRAY_CONNECTION_FORM_STEPS}
      formFields={getStorageArrayConnectFormFields({
        probes: probes,
        isBillingEnabled: BILLING_ENABLED,
        translator: translator,
        collector: collector,
      })}
      onBeforeCreate={async (
        item: StorageArrayConnection,
        miscDataProps: JSONObject,
      ): Promise<StorageArrayConnection> => {
        void miscDataProps;
        item.storageSystem = collector.storageSystem;
        return item;
      }}
      onCreateSuccess={(
        item: StorageArrayConnection,
        modalType?: ModalType,
      ): Promise<StorageArrayConnection> => {
        // Its page is where the first collection shows.
        if (item._id && modalType !== ModalType.Edit) {
          Navigation.navigate(viewRoute(new ObjectID(item._id.toString())));
        }
        return Promise.resolve(item);
      }}
      query={{}}
      searchableFields={["name", "address", "description"]}
      filters={[]}
      selectMoreFields={{
        projectId: true,
        isPasswordSet: true,
        username: true,
        collectionProbeId: true,
        collectionProbe: {
          name: true,
          isGlobalProbe: true,
          projectId: true,
          connectionStatus: true,
        },
        collectionStatus: true,
        collectionErrorCode: true,
        collectionError: true,
        presentedCertificate: true,
        nextCollectionAt: true,
        collectionSummary: true,
      }}
      columns={[
        {
          field: {
            name: true,
          },
          title: "Name",
          type: FieldType.Element,
          getElement: (item: StorageArrayConnection): ReactElement => {
            return (
              <AppLink
                to={viewRoute(new ObjectID(item._id as string))}
                className="text-sm font-medium text-gray-900 hover:underline"
              >
                {(item.name as string) || <TableEmptyValue />}
              </AppLink>
            );
          },
        },
        {
          field: {
            collectionStatus: true,
          },
          title: "Status",
          type: FieldType.Element,
          getElement: (item: StorageArrayConnection): ReactElement => {
            const view: StorageArrayCollectionStatusView =
              getStorageArrayCollectionStatusView(
                item,
                translator,
                new Date(),
                BILLING_ENABLED,
              );
            return (
              <Pill
                text={view.label}
                isUserContent={true}
                tone={toneOf(view)}
              />
            );
          },
        },
        {
          field: {
            address: true,
          },
          title: "Address",
          type: FieldType.Text,
          hideOnMobile: true,
        },
        {
          field: {
            collectionSummary: true,
          },
          title: "Arrays",
          type: FieldType.Element,
          disableSort: true,
          getElement: (item: StorageArrayConnection): ReactElement => {
            const local: number = (item.collectionSummary?.arrays || []).filter(
              (array: { isLocal: boolean }): boolean => {
                return array.isLocal;
              },
            ).length;
            if (!item.collectionSummary) {
              return <TableEmptyValue screenReaderText="Not collected yet" />;
            }
            return (
              <span className="text-sm text-gray-700">
                {translator.translatePlural(
                  { one: "{{count}} array", other: "{{count}} arrays" },
                  local,
                )}
              </span>
            );
          },
        },
        {
          field: {
            lastSuccessfulCollectionAt: true,
          },
          title: "Last Collected",
          type: FieldType.DateTime,
          hideOnMobile: true,
        },
      ]}
      onViewPage={(item: StorageArrayConnection): Promise<Route> => {
        return Promise.resolve(viewRoute(new ObjectID(item._id as string)));
      }}
    />
  );
};

export default StorageArrayConnections;
