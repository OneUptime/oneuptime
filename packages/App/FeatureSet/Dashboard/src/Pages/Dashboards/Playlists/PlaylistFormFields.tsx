import DashboardPlaylist from "Common/Models/DatabaseModels/DashboardPlaylist";
import {
  DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS,
  DashboardPlaylistDashboard,
  getDashboardPlaylistIntervalChoices,
  readDashboardPlaylistDashboards,
} from "Common/Types/Dashboard/DashboardPlaylist";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement } from "react";
import PlaylistDashboardsField from "../../../Components/Dashboard/Playlist/PlaylistDashboardsField";
import { formatPlaylistInterval } from "../../../Components/Dashboard/Playlist/PlaylistDashboards";

/*
 * A playlist's create and edit forms (issue #5235): its name, its
 * dashboards in order, and how long each is shown. Three rows on one page,
 * the same on Create Playlist and on the playlist's Edit.
 */

export const PLAYLIST_NEEDS_A_DASHBOARD: string = translationKey(
  "Add at least one dashboard to the playlist.",
);

/*
 * The choices of "Show each dashboard for", in the reader's language ("1
 * minute", "1 Minute", "1 分钟"), with the playlist's own time among them
 * when the API set one the form does not offer.
 */
export function getPlaylistIntervalOptions(data: {
  language: string;
  currentIntervalInSeconds?: number | null | undefined;
}): Array<DropdownOption> {
  return getDashboardPlaylistIntervalChoices(data.currentIntervalInSeconds).map(
    (seconds: number): DropdownOption => {
      return {
        value: seconds,
        label: formatPlaylistInterval(seconds, data.language),
        // Already in the reader's words: drawn as it is.
        isUserContent: true,
      };
    },
  );
}

export function getPlaylistFormFields(data: {
  language: string;
  // The playlist being edited's own interval; none on Create.
  currentIntervalInSeconds?: number | null | undefined;
}): Fields<DashboardPlaylist> {
  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "NOC wall",
      validation: {
        minLength: 2,
      },
    },
    {
      field: {
        dashboards: true,
      },
      title: "Dashboards",
      description: "Shown in this order, one after another, round and round.",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: true,
      customValidation: (
        values: FormValues<DashboardPlaylist>,
      ): string | null => {
        const dashboards: Array<DashboardPlaylistDashboard> =
          readDashboardPlaylistDashboards(values.dashboards);

        return dashboards.length === 0
          ? translateText(PLAYLIST_NEEDS_A_DASHBOARD) ||
              PLAYLIST_NEEDS_A_DASHBOARD
          : null;
      },
      getCustomElement: (
        values: FormValues<DashboardPlaylist>,
        customElementProps: CustomElementProps,
      ): ReactElement => {
        return (
          <PlaylistDashboardsField
            {...customElementProps}
            /*
             * Passed after the spread: FormField hands a CustomComponent
             * `value || ""`, and the field reads the list itself.
             */
            initialValue={
              (values.dashboards as
                | Array<DashboardPlaylistDashboard>
                | undefined) || []
            }
          />
        );
      },
    },
    {
      field: {
        intervalInSeconds: true,
      },
      title: "Show each dashboard for",
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      defaultValue: DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS,
      dropdownOptions: getPlaylistIntervalOptions({
        language: data.language,
        currentIntervalInSeconds: data.currentIntervalInSeconds,
      }),
    },
  ];
}
