import PageComponentProps from "../PageComponentProps";
import {
  ExposurePill,
  SensitivityPill,
  SeverityPill,
} from "../../Components/DataSecurity/DataSecurityPills";
import StoreDataTypeList from "../../Components/DataSecurity/StoreDataTypeList";
import {
  SELF_MANAGED_STORE_KIND_OPTIONS,
  STORE_ENVIRONMENT_OPTIONS,
  STORE_EXPOSURE_OPTIONS,
  STORE_KIND_OPTIONS,
  STORE_PROVIDER_OPTIONS,
  STORE_SENSITIVITY_OPTIONS,
} from "../../Components/DataSecurity/StoreFieldOptions";
import StoreNameCell, {
  StoreLastCheckedCell,
  getDataStoreRoute,
} from "../../Components/DataSecurity/StoreNameCell";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreOwnerTeam from "Common/Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "Common/Models/DatabaseModels/DataStoreOwnerUser";
import Probe from "Common/Models/DatabaseModels/Probe";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DataStoreEnvironment from "Common/Types/DataSecurity/DataStoreEnvironment";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * EVERY PLACE DATA LIVES: the buckets, databases and warehouses Data
 * Security found in your clouds, your services' telemetry, and the
 * databases you added by hand. The riskiest first: a store's risk is its
 * worst open issue's. Each row says how sensitive the store is, what kinds
 * of data are in it, how exposed it is and who owns it, and opens the
 * store's own pages.
 *
 * A database you run yourself - which no cloud lists - is added here: its
 * name and kind, and, folded under More fields, its environment
 * (Production unless said otherwise), a description and how it is scanned
 * (a read-only connection string for OneUptime's workers, or one of your
 * probes inside your network, which reads the connection string from its
 * own environment so the string never reaches OneUptime).
 */

export const DATA_STORES_TABLE_ID: string = "data-security-stores-table";

/*
 * Its environment, a description and how it is scanned: folded away, since
 * most databases added by hand are production ones, and most people add a
 * store first and decide how to scan it later.
 */
const moreFieldsSection: FormFieldCollapsibleSection<DataStore> =
  getAdvancedFormSection<DataStore>({
    description:
      "Its environment and description, and how OneUptime samples its content. Leave the scanning fields empty to add it without content scans.",
    getSummary: (values: FormValues<DataStore>): Array<string> | undefined => {
      return !values.environment ||
        values.environment === DataStoreEnvironment.Production
        ? [translationKey("It is treated as a production database.")]
        : undefined;
    },
  });

const DataSecurityDataStores: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  // Labels and owners in Bulk Actions, as on every other resource list.
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<DataStore>({ modelType: DataStore });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<DataStore>({
      ownerUserModelType: DataStoreOwnerUser,
      ownerTeamModelType: DataStoreOwnerTeam,
      resourceIdField: "dataStoreId",
    });

  /*
   * The Owner and Labels chips above the table: a store can be found by
   * the person or the team that owns it - the server answers the Owner chip
   * in the list's own query - and the Owners column shows who that is.
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
    persistKey: DATA_STORES_TABLE_ID,
    ownerUserModelType: DataStoreOwnerUser,
    ownerTeamModelType: DataStoreOwnerTeam,
    resourceIdField: "dataStoreId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      <ModelTable<DataStore>
        modelType={DataStore}
        id={DATA_STORES_TABLE_ID}
        userPreferencesKey={DATA_STORES_TABLE_ID}
        name="Data Stores"
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: false,
        })}
        onFetchSuccess={(data: Array<DataStore>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        createVerb="Add"
        isViewable={true}
        showViewIdButton={true}
        showRefreshButton={true}
        sortBy="riskScore"
        sortOrder={SortOrder.Descending}
        bulkActions={{
          buttons: [...labelBulkActions, ...ownerBulkActions],
        }}
        cardProps={{
          title: "Data Stores",
          description:
            "Every bucket, database and telemetry stream Data Security knows, the riskiest first: what sensitive data each holds, how exposed it is and who owns it. Add a database you run yourself here.",
        }}
        noItemsMessage="No data stores yet. They appear once a cloud account with Data Security turned on is read, or when you add a database you run yourself."
        createFormTitle="Add a Database You Run"
        searchableFields={["name", "description"]}
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
        formFields={[
          {
            field: { name: true },
            title: "Name",
            description: "What your team calls the database.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "orders-db",
            validation: { minLength: 1 },
          },
          {
            field: { kind: true },
            title: "Kind",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: SELF_MANAGED_STORE_KIND_OPTIONS,
            required: true,
            placeholder: "Choose the database engine",
          },
          {
            field: { environment: true },
            title: "Environment",
            description:
              "Production data in a store that is not production is an issue of its own.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: STORE_ENVIRONMENT_OPTIONS,
            required: true,
            defaultValue: DataStoreEnvironment.Production,
            collapsibleSection: moreFieldsSection,
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "What the database is for",
            collapsibleSection: moreFieldsSection,
          },
          {
            field: { scanProbe: true },
            title: "Scan From Probe",
            description:
              "Scan from one of your probes, inside your network. Leave it empty to scan from OneUptime's workers with a connection string.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Probe,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Scan from OneUptime's workers",
            collapsibleSection: moreFieldsSection,
          },
          {
            field: { probeConnectionVariable: true },
            title: "Probe Connection Variable",
            description:
              "The environment variable on that probe that holds a read-only connection string. The connection string itself never reaches OneUptime.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "ORDERS_DB_URL",
            collapsibleSection: moreFieldsSection,
            showIf: (values: FormValues<DataStore>): boolean => {
              return Boolean(values.scanProbe);
            },
          },
          {
            field: { connectionString: true },
            title: "Connection String",
            description:
              "A read-only connection string for PostgreSQL, MySQL or SQL Server. It is encrypted and never shown again.",
            fieldType: FormFieldSchemaType.Password,
            required: false,
            placeholder: "postgresql://reader:password@db.internal:5432/app",
            collapsibleSection: moreFieldsSection,
            showIf: (values: FormValues<DataStore>): boolean => {
              return !values.scanProbe;
            },
          },
        ]}
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
            field: { sensitivity: true },
            title: "Sensitivity",
            type: FieldType.Dropdown,
            filterDropdownOptions: STORE_SENSITIVITY_OPTIONS,
          },
          {
            field: { exposure: true },
            title: "Exposure",
            type: FieldType.Dropdown,
            filterDropdownOptions: STORE_EXPOSURE_OPTIONS,
          },
          {
            field: { environment: true },
            title: "Environment",
            type: FieldType.Dropdown,
            filterDropdownOptions: STORE_ENVIRONMENT_OPTIONS,
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
                <div className="flex flex-col items-start gap-0.5">
                  <SensitivityPill
                    sensitivity={item.sensitivityOverride || item.sensitivity}
                  />
                  {item.sensitivityOverride ? (
                    <span className="text-xs text-gray-500">
                      {translator.translateText("Set by hand")}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
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
            getElement: (item: DataStore): ReactElement => {
              return <ExposurePill exposure={item.exposure} />;
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
            field: { environment: true },
            title: "Environment",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: DataStore): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {translator.translateText(item.environment) || "—"}
                </span>
              );
            },
          },
          {
            field: { configurationReadAt: true },
            title: "Last Checked",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: DataStore): ReactElement => {
              return <StoreLastCheckedCell store={item} />;
            },
          },
          {
            field: { openIssueCount: true },
            title: "Open Issues",
            type: FieldType.Element,
            getElement: (item: DataStore): ReactElement => {
              const count: number = item.openIssueCount || 0;

              if (count === 0) {
                return (
                  <TableEmptyValue
                    screenReaderText={translationKey("No open issues.")}
                  />
                );
              }

              return (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
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
          {
            field: { riskScore: true },
            title: "Risk Score",
            type: FieldType.Number,
            hideOnMobile: true,
          },
        ]}
      />
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default DataSecurityDataStores;
