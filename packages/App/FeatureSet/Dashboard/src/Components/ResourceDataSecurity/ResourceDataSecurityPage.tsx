import PageComponentProps from "../../Pages/PageComponentProps";
import {
  ExposurePill,
  SensitivityPill,
  SeverityPill,
} from "../DataSecurity/DataSecurityPills";
import StoreDataTypeList from "../DataSecurity/StoreDataTypeList";
import StoreIssuesTable from "../DataSecurity/StoreIssuesTable";
import StoreNameCell, {
  getDataStoreRoute,
} from "../DataSecurity/StoreNameCell";
import {
  RESOURCE_DATA_STORES_DESCRIPTIONS,
  RESOURCE_NO_DATA_STORES_DESCRIPTIONS,
} from "./ResourceDataSecurityPages";
import useResourceDataScope, {
  ResourceDataScopeState,
} from "./UseResourceDataScope";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { MAX_RESOURCE_SCOPE_STORES } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A RESOURCE'S DATA SECURITY PAGE (#9547): what Data Security says about the
 * data stores a Kubernetes cluster, a container host, a database, a cloud
 * resource or a service holds (Types/DataSecurity/DataStoreResource) - each
 * store with how sensitive and how exposed it is and what kinds of data it
 * holds, then the open issues on them, the riskiest first. A store and an
 * issue open on their own pages in Data Security, where they are worked;
 * nothing is copied here.
 *
 * The stores are the ones the server says are the resource's (POST
 * /data-security/resource-scope), read with the reader's own permissions.
 */

export const RESOURCE_DATA_SECURITY_STORES_TABLE_ID: string =
  "resource-data-security-stores-table";
export const RESOURCE_DATA_SECURITY_ISSUES_TABLE_ID: string =
  "resource-data-security-open-issues-table";

const NO_OPEN_ISSUES: string = translationKey("No open issues.");

export const RESOURCE_DATA_STORES_READ_FAILED: string = translationKey(
  "The data stores of this resource could not be read.",
);

export interface ComponentProps extends PageComponentProps {
  kind: DataStoreResourceKind;
}

const ResourceDataSecurityPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const { scope, isLoading, error }: ResourceDataScopeState =
    useResourceDataScope({
      kind: props.kind,
      modelId,
      isEnabled: true,
    });

  if (isLoading) {
    return <PageSkeleton shape="table" />;
  }

  if (error || !scope) {
    return <ErrorMessage message={error || RESOURCE_DATA_STORES_READ_FAILED} />;
  }

  const storeIds: Array<ObjectID> = scope.dataStoreIds.map(
    (id: string): ObjectID => {
      return new ObjectID(id);
    },
  );
  const dataStoresRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_SECURITY_STORES] as Route,
  );

  if (storeIds.length === 0) {
    return (
      <Card
        title="Data Stores"
        description={RESOURCE_DATA_STORES_DESCRIPTIONS[props.kind]}
      >
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.Database}
          title="No data stores here yet"
          description={RESOURCE_NO_DATA_STORES_DESCRIPTIONS[props.kind]}
          isCompact={true}
        />
      </Card>
    );
  }

  return (
    <Fragment>
      <ModelTable<DataStore>
        modelType={DataStore}
        id={RESOURCE_DATA_SECURITY_STORES_TABLE_ID}
        userPreferencesKey={RESOURCE_DATA_SECURITY_STORES_TABLE_ID}
        name="Data Stores"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          _id: new Includes(storeIds),
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        showRefreshButton={true}
        sortBy="riskScore"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: "Data Stores",
          description: RESOURCE_DATA_STORES_DESCRIPTIONS[props.kind],
          buttons: [
            {
              title: "Open in Data Security",
              icon: IconProp.ShieldCheck,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                Navigation.navigate(dataStoresRoute);
              },
            },
          ],
        }}
        noItemsMessage="No data stores here yet."
        selectMoreFields={{
          kind: true,
          region: true,
          sensitivity: true,
          sensitivityOverride: true,
          highestIssueSeverity: true,
          contentScannedAt: true,
        }}
        onViewPage={(item: DataStore): Promise<Route> => {
          return Promise.resolve(getDataStoreRoute(item._id!));
        }}
        filters={[]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Element,
            getLineText: drawsItsOwnLines,
            getElement: (item: DataStore): ReactElement => {
              return <StoreNameCell store={item} />;
            },
          },
          {
            field: { sensitivity: true },
            title: "Sensitivity",
            type: FieldType.Element,
            getElement: (item: DataStore): ReactElement => {
              return (
                <SensitivityPill
                  sensitivity={item.sensitivityOverride || item.sensitivity}
                />
              );
            },
          },
          {
            field: { dataTypeIds: true },
            title: "Data Types",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: DataStore): ReactElement => {
              return <StoreDataTypeList dataTypeIds={item.dataTypeIds} />;
            },
          },
          {
            field: { exposure: true },
            title: "Exposure",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: DataStore): ReactElement => {
              return <ExposurePill exposure={item.exposure} />;
            },
          },
          {
            field: { openIssueCount: true },
            title: "Open Issues",
            type: FieldType.Element,
            getElement: (item: DataStore): ReactElement => {
              const count: number = item.openIssueCount || 0;

              if (count === 0) {
                return <TableEmptyValue screenReaderText={NO_OPEN_ISSUES} />;
              }

              return (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium tabular-nums text-gray-900">
                    {translator.formatNumber(count)}
                  </span>
                  {item.highestIssueSeverity ? (
                    <SeverityPill severity={item.highestIssueSeverity} />
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
        ]}
      />

      {scope.isTruncated ? (
        <p className="-mt-2 mb-4 text-xs text-gray-500">
          {translator.translatePlural(
            {
              one: "Showing the first {{count}} data store.",
              other: "Showing the first {{count}} data stores.",
            },
            MAX_RESOURCE_SCOPE_STORES,
          )}
        </p>
      ) : (
        <></>
      )}

      <StoreIssuesTable
        dataStoreId={storeIds}
        statuses={[DataSecurityIssueStatus.Open]}
        id={RESOURCE_DATA_SECURITY_ISSUES_TABLE_ID}
        title="Open Issues"
        description="What puts this data at risk now, the riskiest first. Each issue opens in Data Security, where it is worked."
        noItemsMessage="No open issues on these data stores."
        showStatus={false}
        showStore={storeIds.length > 1}
        sortBy="riskScore"
      />
    </Fragment>
  );
};

export default ResourceDataSecurityPage;
