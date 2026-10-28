import {
  AdminDashboardEnterprisePlugins,
  EnterprisePluginComponent,
  EnterpriseSettingsPage,
} from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import AuditLogExportPlugins from "./AuditLogExport/Plugins";
import BackupsPlugins from "./Backups/Plugins";
import CustomChannelsPlugins from "./CustomChannels/Plugins";
import WhiteLabelPlugins from "./WhiteLabel/Plugins";

/*
 * The Enterprise Settings pages of the Admin Dashboard, from every area that
 * adds one. The plugin has one key for the pages and one for their side menu
 * entries in each section, so the areas are merged here rather than spread
 * into the plugin, where the last one would hide the others.
 *
 * Entries keep this order in the section they belong to. Each draws itself -
 * or nothing, for a page the license does not allow (White Label).
 */
type SettingsArea = Pick<
  AdminDashboardEnterprisePlugins,
  | "SettingsPages"
  | "SettingsSideMenuItems"
  | "SettingsNotificationSideMenuItems"
>;

type SettingsSideMenuItemsKey =
  | "SettingsSideMenuItems"
  | "SettingsNotificationSideMenuItems";

export const ENTERPRISE_SETTINGS_AREAS: ReadonlyArray<SettingsArea> = [
  AuditLogExportPlugins,
  BackupsPlugins,
  CustomChannelsPlugins,
  WhiteLabelPlugins,
];

export const ENTERPRISE_SETTINGS_PAGES: ReadonlyArray<EnterpriseSettingsPage> =
  ENTERPRISE_SETTINGS_AREAS.flatMap(
    (area: SettingsArea): ReadonlyArray<EnterpriseSettingsPage> => {
      return area.SettingsPages || [];
    },
  );

/*
 * One section's entries. An area that adds nothing to the section draws
 * nothing, so it leaves no gap.
 */
const renderSideMenuItems: (key: SettingsSideMenuItemsKey) => ReactElement = (
  key: SettingsSideMenuItemsKey,
): ReactElement => {
  return (
    <Fragment>
      {ENTERPRISE_SETTINGS_AREAS.map(
        (area: SettingsArea, index: number): ReactElement => {
          const Item: EnterprisePluginComponent | undefined = area[key];

          return <Fragment key={index}>{Item ? <Item /> : <></>}</Fragment>;
        },
      )}
    </Fragment>
  );
};

export const EnterpriseSettingsSideMenuItems: FunctionComponent =
  (): ReactElement => {
    return renderSideMenuItems("SettingsSideMenuItems");
  };

export const EnterpriseSettingsNotificationSideMenuItems: FunctionComponent =
  (): ReactElement => {
    return renderSideMenuItems("SettingsNotificationSideMenuItems");
  };
