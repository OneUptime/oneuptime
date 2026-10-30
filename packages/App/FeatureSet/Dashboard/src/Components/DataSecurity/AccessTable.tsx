import AppLink from "../AppLink/AppLink";
import { SensitivityPill } from "./DataSecurityPills";
import { getStoreViewRoute } from "./IssueListRoute";
import IssueMoment from "./IssueMoment";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreAccess from "Common/Models/DatabaseModels/DataStoreAccess";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  Gray500,
  Orange500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "Common/Types/DataSecurity/DataStoreAccess";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHO AND WHAT CAN REACH A DATA STORE.
 *
 * Each row is one grant the cloud readers found - a bucket policy, an ACL,
 * a role assignment, an IAM binding, a snapshot share - or a service seen
 * using the store in traces: who or what it gives access to, what it may
 * do, and the store, with how sensitive what it holds is. The Access page
 * draws two of these: what reaches the stores from outside your accounts,
 * anyone on the internet first, and what reaches them from inside.
 */

export const ACCESS_LEVEL_COLOR: Readonly<Record<string, Color>> = {
  [DataStoreAccessLevel.Admin]: Red500,
  [DataStoreAccessLevel.Write]: Orange500,
  [DataStoreAccessLevel.Read]: Yellow500,
};

const PUBLIC_BADGE: string = translationKey("Anyone on the internet");
const EXTERNAL_BADGE: string = translationKey("Outside your accounts");
const SEEN_IN_TRACES: string = translationKey("Seen in traces");

const levelOptions: Array<DropdownOption> = [
  DataStoreAccessLevel.Admin,
  DataStoreAccessLevel.Write,
  DataStoreAccessLevel.Read,
].map((level: DataStoreAccessLevel): DropdownOption => {
  return { value: level, label: level };
});

const principalTypeOptions: Array<DropdownOption> = Object.values(
  DataStorePrincipalType,
).map((type: string): DropdownOption => {
  return { value: type, label: type };
});

export interface AccessTableProps {
  id: string;
  title: string;
  description: string;
  noItemsMessage: string;
  // Outside your accounts (anyone on the internet first), or inside.
  isExternal: boolean;
}

const AccessTable: FunctionComponent<AccessTableProps> = (
  props: AccessTableProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const query: Query<DataStoreAccess> = {
    ...(projectId ? { projectId: projectId } : {}),
    isExternal: props.isExternal,
  };

  const filters: Array<Filter<DataStoreAccess>> = [
    {
      field: { accessLevel: true },
      title: "Access Level",
      type: FieldType.Dropdown,
      filterDropdownOptions: levelOptions,
    },
    {
      field: { principalType: true },
      title: "Principal Type",
      type: FieldType.Dropdown,
      filterDropdownOptions: principalTypeOptions,
    },
    {
      field: { dataStoreId: true },
      title: "Data Store",
      type: FieldType.Entity,
      filterEntityType: DataStore,
      filterQuery: projectId ? { projectId: projectId } : {},
      filterDropdownField: { label: "name", value: "_id" },
    },
  ];

  // Anyone on the internet is outside your accounts too.
  if (props.isExternal) {
    filters.unshift({
      field: { isPublic: true },
      title: "Anyone on the Internet",
      type: FieldType.Boolean,
    });
  }

  return (
    <ModelTable<DataStoreAccess>
      modelType={DataStoreAccess}
      id={props.id}
      name={props.id}
      userPreferencesKey={props.id}
      query={query}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      sortBy={props.isExternal ? "isPublic" : "accessLevel"}
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: props.title,
        description: props.description,
      }}
      noItemsMessage={props.noItemsMessage}
      showRefreshButton={true}
      searchableFields={["principal", "principalName", "grantedVia"]}
      selectMoreFields={{
        principal: true,
        isPublic: true,
        isExternal: true,
        isSeenInTraces: true,
        dataStoreId: true,
      }}
      filters={filters}
      columns={[
        {
          field: { principalName: true },
          title: "Principal",
          type: FieldType.Element,
          isNotCustomizable: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-sm",
          getExportValue: (access: DataStoreAccess): string => {
            return access.principalName || access.principal || "";
          },
          getElement: (access: DataStoreAccess): ReactElement => {
            return (
              <div className="min-w-[12rem]">
                <div className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                  <IsolatedText
                    text={access.principalName || access.principal || ""}
                  />
                </div>
                {access.principalName && access.principal ? (
                  <div className="font-mono text-xs text-gray-500 [overflow-wrap:anywhere]">
                    {access.principal}
                  </div>
                ) : (
                  <></>
                )}
                <div className="mt-1 flex flex-wrap gap-1">
                  {access.isPublic ? (
                    <Pill text={PUBLIC_BADGE} color={Red500} />
                  ) : access.isExternal ? (
                    <Pill text={EXTERNAL_BADGE} color={Orange500} />
                  ) : (
                    <></>
                  )}
                  {access.isSeenInTraces ? (
                    <Pill text={SEEN_IN_TRACES} color={Gray500} />
                  ) : (
                    <></>
                  )}
                </div>
              </div>
            );
          },
        },
        {
          field: { principalType: true },
          title: "Type",
          type: FieldType.Element,
          hideOnMobile: true,
          disableSort: true,
          getElement: (access: DataStoreAccess): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm text-gray-700">
                {access.principalType
                  ? translator.translateText(access.principalType) ||
                    access.principalType
                  : "-"}
              </span>
            );
          },
        },
        {
          field: { accessLevel: true },
          title: "Level",
          type: FieldType.Element,
          disableSort: true,
          getElement: (access: DataStoreAccess): ReactElement => {
            if (!access.accessLevel) {
              return <span className="text-sm text-gray-400">-</span>;
            }

            return (
              <Pill
                text={access.accessLevel}
                color={ACCESS_LEVEL_COLOR[access.accessLevel] || Gray500}
              />
            );
          },
        },
        {
          field: { grantedVia: true },
          title: "Granted Via",
          type: FieldType.Element,
          isHiddenByDefault: true,
          disableSort: true,
          hideOnMobile: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-xs",
          getElement: (access: DataStoreAccess): ReactElement => {
            return (
              <span className="text-sm text-gray-700 [overflow-wrap:anywhere]">
                <IsolatedText text={access.grantedVia || "-"} />
              </span>
            );
          },
        },
        {
          field: { dataStore: { name: true, kind: true } },
          title: "Data Store",
          type: FieldType.Element,
          disableSort: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-xs",
          getExportValue: (access: DataStoreAccess): string => {
            return access.dataStore?.name || "";
          },
          getElement: (access: DataStoreAccess): ReactElement => {
            const storeId: string = access.dataStoreId?.toString() || "";

            if (!storeId) {
              return <span className="text-sm text-gray-400">-</span>;
            }

            return (
              <div className="min-w-0">
                <AppLink
                  className="block min-w-0 text-sm font-medium text-gray-900 hover:underline [overflow-wrap:anywhere]"
                  to={getStoreViewRoute(storeId)}
                >
                  <IsolatedText text={access.dataStore?.name || storeId} />
                </AppLink>
                {access.dataStore?.kind ? (
                  <div className="text-xs text-gray-500">
                    {translator.translateText(access.dataStore.kind) ||
                      access.dataStore.kind}
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { dataStore: { sensitivity: true } },
          title: "Store Sensitivity",
          type: FieldType.Element,
          disableSort: true,
          getExportValue: (access: DataStoreAccess): string => {
            return access.dataStore?.sensitivity || "";
          },
          getElement: (access: DataStoreAccess): ReactElement => {
            return (
              <SensitivityPill sensitivity={access.dataStore?.sensitivity} />
            );
          },
        },
        {
          field: { lastUsedAt: true },
          title: "Last Used",
          type: FieldType.Element,
          hideOnMobile: true,
          isHiddenByDefault: true,
          getElement: (access: DataStoreAccess): ReactElement => {
            return <IssueMoment value={access.lastUsedAt} />;
          },
        },
      ]}
    />
  );
};

export default AccessTable;
