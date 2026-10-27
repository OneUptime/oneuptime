import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React, { ReactElement } from "react";
import DashboardPlaylist from "../../../Models/DatabaseModels/DashboardPlaylist";
import {
  DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS,
  DashboardPlaylistDashboard,
} from "../../../Types/Dashboard/DashboardPlaylist";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import Field, {
  CustomElementProps,
} from "../../../UI/Components/Forms/Types/Field";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";

/*
 * A playlist's create and edit forms (issue #5235): its name, its
 * dashboards in order, and how long each is shown - three rows on one page
 * (LongFormStepsGuard), the same on Create Playlist and on Edit. The
 * interval's choices are in the reader's words, and an interval the API set
 * that the form does not offer is still among them, so an edit never
 * changes it unasked.
 */

// The field is drawn for real in PlaylistDashboardsField.test.tsx.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboardsField",
  () => {
    return {
      __esModule: true,
      default: (props: {
        initialValue?: unknown;
        error?: string;
      }): ReactElement => {
        return (
          <div data-testid="dashboards-field">
            {JSON.stringify(props.initialValue)}|{props.error || ""}
          </div>
        );
      },
    };
  },
);

import {
  PLAYLIST_NEEDS_A_DASHBOARD,
  getPlaylistFormFields,
  getPlaylistIntervalOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Playlists/PlaylistFormFields";

const OVERVIEW: string = "db000000-0000-4000-8000-000000000001";

// Intl writes some languages' spaces as no-break spaces.
const ANY_SPACE: RegExp = /\s/g;

function labels(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption): string => {
    return String(option.label).replace(ANY_SPACE, " ");
  });
}

function fieldOf(
  fields: Fields<DashboardPlaylist>,
  name: string,
): Field<DashboardPlaylist> {
  const found: Field<DashboardPlaylist> | undefined = fields.find(
    (field: Field<DashboardPlaylist>): boolean => {
      return Object.keys(field.field || {})[0] === name;
    },
  );

  if (!found) {
    throw new Error(`No ${name} field.`);
  }

  return found;
}

afterEach(() => {
  cleanup();
});

describe("Show each dashboard for", () => {
  test("offers 15 seconds to an hour, in English words, the numbers as values", () => {
    const options: Array<DropdownOption> = getPlaylistIntervalOptions({
      language: "en",
    });

    expect(labels(options)).toEqual([
      "15 seconds",
      "30 seconds",
      "1 minute",
      "2 minutes",
      "5 minutes",
      "10 minutes",
      "15 minutes",
      "30 minutes",
      "1 hour",
    ]);
    expect(
      options.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual([15, 30, 60, 120, 300, 600, 900, 1800, 3600]);
    // Written in the reader's language already: not looked up again.
    expect(
      options.every((option: DropdownOption): boolean => {
        return option.isUserContent === true;
      }),
    ).toBe(true);
  });

  test("in the reader's language", () => {
    expect(labels(getPlaylistIntervalOptions({ language: "de" }))).toEqual(
      expect.arrayContaining(["1 Minute", "2 Minuten", "1 Stunde"]),
    );
    expect(labels(getPlaylistIntervalOptions({ language: "fr" }))).toEqual(
      expect.arrayContaining(["30 secondes", "1 heure"]),
    );
  });

  test("an interval the API set that the form does not offer is among the choices, in its place", () => {
    const options: Array<DropdownOption> = getPlaylistIntervalOptions({
      language: "en",
      currentIntervalInSeconds: 45,
    });

    expect(labels(options).slice(0, 4)).toEqual([
      "15 seconds",
      "30 seconds",
      "45 seconds",
      "1 minute",
    ]);

    expect(
      labels(
        getPlaylistIntervalOptions({
          language: "en",
          currentIntervalInSeconds: 7200,
        }),
      ).slice(-2),
    ).toEqual(["1 hour", "2 hours"]);
  });

  test("one already offered is not offered twice", () => {
    expect(
      getPlaylistIntervalOptions({
        language: "en",
        currentIntervalInSeconds: 60,
      }),
    ).toHaveLength(9);
  });
});

describe("the form", () => {
  const fields: Fields<DashboardPlaylist> = getPlaylistFormFields({
    language: "en",
  });

  test("is three rows on one page: Name, Dashboards, Show each dashboard for", () => {
    expect(
      fields.map((field: Field<DashboardPlaylist>): string => {
        return String(field.title);
      }),
    ).toEqual(["Name", "Dashboards", "Show each dashboard for"]);
    expect(
      fields.every((field: Field<DashboardPlaylist>): boolean => {
        return field.required === true && !field.stepId;
      }),
    ).toBe(true);
  });

  test("Name is text with an example of its own", () => {
    const name: Field<DashboardPlaylist> = fieldOf(fields, "name");

    expect(name.fieldType).toBe(FormFieldSchemaType.Text);
    expect(name.placeholder).toBe("NOC wall");
  });

  test("Show each dashboard for starts at a minute, and says it in its label alone", () => {
    const interval: Field<DashboardPlaylist> = fieldOf(
      fields,
      "intervalInSeconds",
    );

    expect(interval.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(interval.defaultValue).toBe(
      DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS,
    );
    expect(DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS).toBe(60);
    // The column's description is written for the API: seconds and a range.
    expect(interval.hideColumnDescription).toBe(true);
    expect(interval.dropdownOptions).toHaveLength(9);
  });

  test("the edit form offers the playlist's own interval", () => {
    const interval: Field<DashboardPlaylist> = fieldOf(
      getPlaylistFormFields({ language: "en", currentIntervalInSeconds: 45 }),
      "intervalInSeconds",
    );

    expect(labels(interval.dropdownOptions || [])).toContain("45 seconds");
  });

  test("Dashboards asks for at least one before the form is sent", () => {
    const dashboards: Field<DashboardPlaylist> = fieldOf(fields, "dashboards");

    expect(dashboards.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    expect(
      dashboards.customValidation!({} as FormValues<DashboardPlaylist>),
    ).toBe(PLAYLIST_NEEDS_A_DASHBOARD);
    expect(
      dashboards.customValidation!({
        dashboards: "",
      } as unknown as FormValues<DashboardPlaylist>),
    ).toBe("Add at least one dashboard to the playlist.");
    expect(
      dashboards.customValidation!({
        dashboards: [{ dashboardId: OVERVIEW }],
      } as unknown as FormValues<DashboardPlaylist>),
    ).toBeNull();
  });

  test("Dashboards hands the field the stored list, or an empty one on Create", () => {
    const dashboards: Field<DashboardPlaylist> = fieldOf(fields, "dashboards");
    const props: CustomElementProps = {
      error: "Add at least one dashboard to the playlist.",
      initialValue: "",
    } as unknown as CustomElementProps;

    const view: ReturnType<typeof render> = render(
      dashboards.getCustomElement!({} as FormValues<DashboardPlaylist>, props),
    );

    // FormField hands a CustomComponent "", and the list wins over it.
    expect(screen.getByTestId("dashboards-field")).toHaveTextContent(
      "[]|Add at least one dashboard to the playlist.",
    );

    view.unmount();

    const stored: Array<DashboardPlaylistDashboard> = [
      { dashboardId: OVERVIEW },
    ];

    render(
      dashboards.getCustomElement!(
        { dashboards: stored } as unknown as FormValues<DashboardPlaylist>,
        props,
      ),
    );

    expect(screen.getByTestId("dashboards-field")).toHaveTextContent(
      JSON.stringify(stored),
    );
  });
});
