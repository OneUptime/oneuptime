import PageComponentProps from "../PageComponentProps";
import { SensitivityPill } from "../../Components/DataSecurity/DataSecurityPills";
import {
  STORE_KIND_OPTIONS,
  STORE_PROVIDER_OPTIONS,
} from "../../Components/DataSecurity/StoreFieldOptions";
import StoreNameCell, {
  getDataStoreRoute,
} from "../../Components/DataSecurity/StoreNameCell";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreOwnerTeam from "Common/Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "Common/Models/DatabaseModels/DataStoreOwnerUser";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The stores that are gone from their clouds or sources: a bucket that was
 * deleted, a database that was shut down, a service that stopped sending.
 * Data Security archives them rather than forgetting them, so what they
 * held and who could reach them stay on record; one found again comes back
 * to Data Stores by itself. Few visits need this, so it waits under
 * Advanced in the side menu.
 */

export const ARCHIVED_STORES_TABLE_ID: string =
  "data-security-archived-stores-table";

const DataSecurityArchivedStores: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * The Owner and Labels chips above the table, as on Data Stores: an
   * archived store can be found by the person or the team that owned it.
   */
  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<DataStore>({
    persistKey: ARCHIVED_STORES_TABLE_ID,
    ownerUserModelType: DataStoreOwnerUser,
    ownerTeamModelType: DataStoreOwnerTeam,
    resourceIdField: "dataStoreId",
    showLabelsFacet: true,
  });

  return (
    <ModelTable<DataStore>
      modelType={DataStore}
      id={ARCHIVED_STORES_TABLE_ID}
      userPreferencesKey={ARCHIVED_STORES_TABLE_ID}
      name="Archived Stores"
      topContent={filterBar}
      emptyState={facetEmptyState}
      currentFacetState={facetSaveState}
      onFacetStateRestored={restoreFacetState}
      query={mergeFiltersIntoQuery({
        isArchived: true,
      })}
      onFetchSuccess={(data: Array<DataStore>) => {
        onResourcesFetched(data);
      }}
      isDeleteable={true}
      isEditable={false}
      isCreateable={false}
      isViewable={true}
      showViewIdButton={true}
      showRefreshButton={true}
      sortBy="lastSeenAt"
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: "Archived Stores",
        description:
          "Stores no longer found in their cloud or source, kept with their history. A store found again comes back to Data Stores by itself.",
      }}
      noItemsMessage="No archived stores. A store is archived when it is gone from its cloud or source."
      searchableFields={["name", "description"]}
      selectMoreFields={{
        kind: true,
        region: true,
        sensitivityOverride: true,
      }}
      /*
       * View opens the store's own page. The default view route (this
       * list's URL + /<id>) would be ".../stores/archived/<id>", which no
       * route matches.
       */
      onViewPage={(item: DataStore): Promise<Route> => {
        return Promise.resolve(getDataStoreRoute(item._id!));
      }}
      filters={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
        },
        {
          field: { kind: true },
          title: "Kind",
          type: FieldType.Dropdown,
          filterDropdownOptions: STORE_KIND_OPTIONS,
        },
        {
          field: { provider: true },
          title: "Provider",
          type: FieldType.Dropdown,
          filterDropdownOptions: STORE_PROVIDER_OPTIONS,
        },
      ]}
      columns={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Element,
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
          field: { _id: true },
          title: "Owners",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DataStore): ReactElement => {
            return (
              <OwnersCell
                owners={getOwnersForResource(item)}
                isLoading={isLoadingOwners}
              />
            );
          },
        },
        {
          field: { lastSeenAt: true },
          title: "Last Seen",
          type: FieldType.DateTime,
        },
      ]}
    />
  );
};

export default DataSecurityArchivedStores;
