import PageComponentProps from "../../PageComponentProps";
import { useDataStoreViewContext } from "./DataStoreViewContext";
import DataStoreAccess from "Common/Models/DatabaseModels/DataStoreAccess";
import { Gray500, Orange500, Red500 } from "Common/Types/BrandColors";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "Common/Types/DataSecurity/DataStoreAccess";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHO CAN REACH THIS STORE, as its cloud's own settings say it - bucket
 * policies and ACLs, role assignments, IAM bindings, snapshot shares - and
 * the services seen using it in traces. Anyone on the internet, and anyone
 * outside your connected accounts, come first: that is the access to look
 * at.
 */

const ACCESS_LEVEL_OPTIONS: Array<DropdownOption> = [
  { label: "Read", value: DataStoreAccessLevel.Read },
  { label: "Write", value: DataStoreAccessLevel.Write },
  { label: "Admin", value: DataStoreAccessLevel.Admin },
];

const PRINCIPAL_TYPE_OPTIONS: Array<DropdownOption> = [
  { label: "Anyone", value: DataStorePrincipalType.Public },
  { label: "Account", value: DataStorePrincipalType.Account },
  { label: "Role", value: DataStorePrincipalType.Role },
  { label: "User", value: DataStorePrincipalType.User },
  { label: "Group", value: DataStorePrincipalType.Group },
  {
    label: "Service Principal",
    value: DataStorePrincipalType.ServicePrincipal,
  },
  { label: "Service Account", value: DataStorePrincipalType.ServiceAccount },
  { label: "Service", value: DataStorePrincipalType.Service },
];

// Where an entry reaches from: the internet, outside your accounts, or inside.
const ReachPill: FunctionComponent<{ entry: DataStoreAccess }> = (props: {
  entry: DataStoreAccess;
}): ReactElement => {
  if (props.entry.isPublic) {
    return <Pill text="Anyone on the internet" color={Red500} />;
  }

  if (props.entry.isExternal) {
    return <Pill text="Outside your accounts" color={Orange500} />;
  }

  return <Pill text="Your accounts" color={Gray500} />;
};

const DataStoreAccessPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataStoreId } = useDataStoreViewContext();

  return (
    <ModelTable<DataStoreAccess>
      modelType={DataStoreAccess}
      id="data-store-access-table"
      userPreferencesKey="data-store-access-table"
      name="Who Can Reach It"
      query={{ dataStoreId: dataStoreId }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showRefreshButton={true}
      // Outside your accounts first; anyone on the internet is outside too.
      sortBy="isExternal"
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: "Who Can Reach It",
        description:
          "Every person, role, account and service that can read or change this store, as its cloud's access settings say, and the services seen using it. Access from outside your accounts is listed first.",
      }}
      noItemsMessage="Nobody is known to reach this store yet. Its access is read with its configuration, from a cloud connection with Data Security turned on."
      searchableFields={["principal", "principalName"]}
      selectMoreFields={{
        principalName: true,
        isPublic: true,
        isSeenInTraces: true,
      }}
      filters={[
        {
          field: { isPublic: true },
          title: "Anyone on the Internet",
          type: FieldType.Boolean,
        },
        {
          field: { isExternal: true },
          title: "Outside Your Accounts",
          type: FieldType.Boolean,
        },
        {
          field: { accessLevel: true },
          title: "Access Level",
          type: FieldType.Dropdown,
          filterDropdownOptions: ACCESS_LEVEL_OPTIONS,
        },
        {
          field: { principalType: true },
          title: "Who",
          type: FieldType.Dropdown,
          filterDropdownOptions: PRINCIPAL_TYPE_OPTIONS,
        },
      ]}
      columns={[
        {
          field: { principal: true },
          title: "Who",
          type: FieldType.Element,
          getElement: (item: DataStoreAccess): ReactElement => {
            return (
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-900">
                  {item.isPublic
                    ? translator.translateText("Anyone on the internet")
                    : item.principalName || item.principal || "—"}
                </div>
                {item.principalName && item.principal && !item.isPublic ? (
                  <div className="truncate font-mono text-xs text-gray-500">
                    {item.principal}
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { principalType: true },
          title: "Type",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DataStoreAccess): ReactElement => {
            return item.principalType ? (
              <span className="text-sm text-gray-700">
                {translator.translateText(item.principalType)}
              </span>
            ) : (
              <TableEmptyValue />
            );
          },
        },
        {
          field: { isExternal: true },
          title: "Reach",
          type: FieldType.Element,
          getElement: (item: DataStoreAccess): ReactElement => {
            return <ReachPill entry={item} />;
          },
        },
        {
          field: { accessLevel: true },
          title: "Access Level",
          type: FieldType.Element,
          getElement: (item: DataStoreAccess): ReactElement => {
            return item.accessLevel ? (
              <span className="text-sm text-gray-700">
                {translator.translateText(item.accessLevel)}
              </span>
            ) : (
              <TableEmptyValue />
            );
          },
        },
        {
          field: { grantedVia: true },
          title: "Granted Via",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DataStoreAccess): ReactElement => {
            return (
              <div className="min-w-0">
                <div className="truncate text-sm text-gray-700">
                  {item.grantedVia || "—"}
                </div>
                {item.isSeenInTraces ? (
                  <div className="text-xs text-gray-500">
                    {translator.translateText("Seen using it in traces")}
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { lastUsedAt: true },
          title: "Last Used",
          type: FieldType.DateTime,
          hideOnMobile: true,
        },
      ]}
    />
  );
};

export default DataStoreAccessPage;
