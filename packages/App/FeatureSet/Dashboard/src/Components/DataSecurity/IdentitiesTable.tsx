import {
  IdentityLastUsedCell,
  IdentityLevelCell,
  IdentityNameCell,
  IdentityReachCell,
  getDataSecurityIdentityRoute,
  getIdentityName,
} from "./IdentityCells";
import {
  STORE_PROVIDER_OPTIONS,
  STORE_SENSITIVITY_OPTIONS,
} from "./StoreFieldOptions";
import StoreDataTypeList from "./StoreDataTypeList";
import DataSecurityIdentity from "Common/Models/DatabaseModels/DataSecurityIdentity";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DATA_SECURITY_IDENTITY_TYPES } from "Common/Types/DataSecurity/DataSecurityIdentity";
import { DataStoreAccessLevel } from "Common/Types/DataSecurity/DataStoreAccess";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHO CAN REACH YOUR DATA, ONE IDENTITY AT A TIME.
 *
 * Every identity that can reach a store - a role, a user, a group, a
 * service account, another account, anyone on the internet, or a service
 * seen using a store in traces - the riskiest first: the one that could do
 * the most harm with what it reaches (Types/DataSecurity/
 * DataSecurityIdentity). Each row says what it is, the most sensitive data
 * it reaches and how many stores, the most it may do, when it was last
 * used, and its risk; its own page says every store it reaches and how.
 *
 * At a laptop's width beside the side menu the list reads the identity,
 * what it reaches, the most it may do and its risk; when it was last used,
 * its data types and its type are a click away in Columns.
 */

export const DATA_SECURITY_IDENTITIES_TABLE_ID: string =
  "data-security-identities";

const LEVEL_OPTIONS: Array<DropdownOption> = [
  DataStoreAccessLevel.Admin,
  DataStoreAccessLevel.Write,
  DataStoreAccessLevel.Read,
].map((level: DataStoreAccessLevel): DropdownOption => {
  return { value: level, label: level };
});

const TYPE_OPTIONS: Array<DropdownOption> = DATA_SECURITY_IDENTITY_TYPES.map(
  (type: string): DropdownOption => {
    return { value: type, label: type };
  },
);

export interface ComponentProps {
  id?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  noItemsMessage?: string | undefined;
  // Narrows the list: the identities outside your accounts, say.
  query?: Query<DataSecurityIdentity> | undefined;
}

const IdentitiesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const id: string = props.id || DATA_SECURITY_IDENTITIES_TABLE_ID;

  return (
    <ModelTable<DataSecurityIdentity>
      modelType={DataSecurityIdentity}
      id={id}
      name={id}
      userPreferencesKey={id}
      query={{
        ...(projectId ? { projectId: projectId } : {}),
        ...(props.query || {}),
      }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={true}
      sortBy="riskScore"
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: props.title || "Who Can Reach Your Data",
        description:
          props.description ||
          "Every identity that can reach your stores, the riskiest first: what it reaches, the most it may do, and when it was last used.",
      }}
      noItemsMessage={
        props.noItemsMessage ||
        "No identity can reach your stores yet, or their access has not been read. It is read with each store's configuration."
      }
      showRefreshButton={true}
      searchableFields={["principalName", "principal"]}
      selectMoreFields={{
        principal: true,
        principalType: true,
        provider: true,
        isPublic: true,
        isExternal: true,
        isUnused: true,
        isSeenInTraces: true,
        storeCount: true,
        restrictedStoreCount: true,
        canChangeSensitiveData: true,
      }}
      onViewPage={(item: DataSecurityIdentity): Promise<Route> => {
        return Promise.resolve(getDataSecurityIdentityRoute(item._id!));
      }}
      filters={[
        {
          field: { highestSensitivity: true },
          title: "Reaches",
          type: FieldType.Dropdown,
          filterDropdownOptions: STORE_SENSITIVITY_OPTIONS,
        },
        {
          field: { highestAccessLevel: true },
          title: "Most It May Do",
          type: FieldType.Dropdown,
          filterDropdownOptions: LEVEL_OPTIONS,
        },
        {
          field: { isExternal: true },
          title: "Outside Your Accounts",
          type: FieldType.Boolean,
        },
        {
          field: { isUnused: true },
          title: "Not Used in 90 Days",
          type: FieldType.Boolean,
        },
        {
          field: { canChangeSensitiveData: true },
          title: "Can Change Sensitive Data",
          type: FieldType.Boolean,
        },
        {
          field: { principalType: true },
          title: "Type",
          type: FieldType.Dropdown,
          filterDropdownOptions: TYPE_OPTIONS,
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
          field: { principalName: true },
          title: "Identity",
          type: FieldType.Element,
          isNotCustomizable: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-sm",
          getExportValue: (identity: DataSecurityIdentity): string => {
            return getIdentityName(identity);
          },
          getElement: (identity: DataSecurityIdentity): ReactElement => {
            return <IdentityNameCell identity={identity} />;
          },
        },
        {
          field: { highestSensitivity: true },
          title: "Reaches",
          type: FieldType.Element,
          getExportValue: (identity: DataSecurityIdentity): string => {
            return identity.highestSensitivity || "";
          },
          getElement: (identity: DataSecurityIdentity): ReactElement => {
            return <IdentityReachCell identity={identity} />;
          },
        },
        {
          field: { highestAccessLevel: true },
          title: "Most It May Do",
          type: FieldType.Element,
          disableSort: true,
          getExportValue: (identity: DataSecurityIdentity): string => {
            return identity.highestAccessLevel || "";
          },
          getElement: (identity: DataSecurityIdentity): ReactElement => {
            return <IdentityLevelCell identity={identity} />;
          },
        },
        {
          field: { lastUsedAt: true },
          title: "Last Used",
          type: FieldType.Element,
          hideOnMobile: true,
          isHiddenByDefault: true,
          getElement: (identity: DataSecurityIdentity): ReactElement => {
            return <IdentityLastUsedCell identity={identity} />;
          },
        },
        {
          field: { dataTypeIds: true },
          title: "Data Types",
          type: FieldType.Element,
          hideOnMobile: true,
          isHiddenByDefault: true,
          getElement: (identity: DataSecurityIdentity): ReactElement => {
            return <StoreDataTypeList dataTypeIds={identity.dataTypeIds} />;
          },
        },
        {
          field: { riskScore: true },
          title: "Risk",
          type: FieldType.Element,
          headerTooltip: translationKey(
            "From 0 to 100: how much harm it could do with what it reaches.",
          ),
          getExportValue: (identity: DataSecurityIdentity): string => {
            return String(identity.riskScore || 0);
          },
          getElement: (identity: DataSecurityIdentity): ReactElement => {
            return (
              <span className="text-sm font-semibold tabular-nums text-gray-900">
                {translator.formatNumber(identity.riskScore || 0)}
              </span>
            );
          },
        },
      ]}
    />
  );
};

export default IdentitiesTable;
