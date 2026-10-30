import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import fs from "fs";
import path from "path";

/*
 * A dashboard's Branding page (Dashboards -> a dashboard -> Branding) and
 * the logo for its dark theme (the #5284 follow-up). The Logo card takes a
 * second logo, made for a dark background, which the public dashboard draws
 * instead of the logo wherever it is dark; without one, the logo sits on a
 * light backdrop there. Each logo is drawn on the card on the page it is
 * made for, as on a status page's Branding page.
 *
 * The cards are recorded rather than drawn (CardModelDetail has suites of
 * its own): what matters here is what the page hands each card.
 */

type Recorded = { kind: string; props: Record<string, unknown> };

interface RecorderStore {
  latest: Map<string, Recorded>;
}

const store: RecorderStore = { latest: new Map<string, Recorded>() };

(
  globalThis as unknown as { __dashboardBrandingRecorded: RecorderStore }
).__dashboardBrandingRecorded = store;

type Recorder = (
  kind: string,
) => (props: Record<string, unknown>) => ReactElement;

const mockRecorder: Recorder = (kind: string) => {
  return (props: Record<string, unknown>): ReactElement => {
    const name: string = (props["name"] as string | undefined) || kind;

    (
      globalThis as unknown as { __dashboardBrandingRecorded: RecorderStore }
    ).__dashboardBrandingRecorded.latest.set(name, {
      kind: kind,
      props: props,
    });

    const react: typeof React = jest.requireActual("react") as typeof React;

    return react.createElement("div", {
      "data-testid": "recorded-card",
      "data-card": name,
      "data-kind": kind,
    });
  };
};

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return { __esModule: true, default: mockRecorder("card-model-detail") };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Branding/DashboardThemeCard",
  () => {
    return { __esModule: true, default: mockRecorder("theme-card") };
  },
);

import DashboardBranding from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Branding";
import DashboardBrandingCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Branding/DashboardBrandingCopy";
import StatusPageBrandingCopy from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageBrandingCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "../../../UI/Components/Types/FieldType";
import { DetailImageBackdrop } from "../../../UI/Components/Detail/DetailImageBackdrop";
import Navigation from "../../../UI/Utils/Navigation";
import TableColumnType from "../../../Types/Database/TableColumnType";

const DASHBOARD_ID: string = "44444444-4444-4444-8444-444444444444";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

const LOGO_CARD: string = "Dashboard > Branding > Logo";

type FieldShape = {
  field?: Record<string, unknown>;
  title?: string;
  fieldType?: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
  hideColumnDescription?: boolean;
  imageBackdrop?: DetailImageBackdrop;
};

beforeEach(() => {
  store.latest.clear();

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(DASHBOARD_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<DashboardBranding {...PAGE_PROPS} />);
  });
}

function propsOf(name: string): Record<string, unknown> {
  const card: Recorded | undefined = store.latest.get(name);

  expect([name, Boolean(card)]).toEqual([name, true]);

  return card!.props;
}

function formFieldsOf(name: string): Array<FieldShape> {
  return propsOf(name)["formFields"] as Array<FieldShape>;
}

function detailFieldsOf(name: string): Array<FieldShape> {
  return (propsOf(name)["modelDetailProps"] as Record<string, unknown>)[
    "fields"
  ] as Array<FieldShape>;
}

function columnsOf(fields: Array<FieldShape>): Array<string> {
  return fields.map((field: FieldShape): string => {
    return Object.keys(field.field || {})[0] || "";
  });
}

function fieldFor(
  fields: Array<FieldShape>,
  column: string,
): FieldShape | undefined {
  return fields.find((field: FieldShape): boolean => {
    return columnsOf([field])[0] === column;
  });
}

describe("the Branding page's cards", () => {
  test("title, logos, theme right under the logos, favicon: in that order", async () => {
    await renderPage();

    expect(
      screen.getAllByTestId("recorded-card").map((element: HTMLElement) => {
        return element.getAttribute("data-card");
      }),
    ).toEqual([
      "Dashboard > Branding > Title and Description",
      LOGO_CARD,
      "theme-card",
      "Dashboard > Branding > Favicon",
    ]);
  });
});

describe("the Logo card: the logo, and the logo for the dark theme", () => {
  test("says where the logo is shown, in a sentence of its own", async () => {
    await renderPage();

    expect(
      (propsOf(LOGO_CARD)["cardProps"] as Record<string, unknown>)[
        "description"
      ],
    ).toBe(DashboardBrandingCopy.logoDescription);
    expect(DashboardBrandingCopy.logoDescription).toBe(
      "Shown in your public dashboard's header.",
    );
  });

  test("its dialog takes the logo, then the dark theme logo: images, neither required", async () => {
    await renderPage();

    const fields: Array<FieldShape> = formFieldsOf(LOGO_CARD);

    expect(columnsOf(fields)).toEqual(["logoFile", "darkThemeLogoFile"]);

    for (const field of fields) {
      expect(field.fieldType).toBe(FormFieldSchemaType.ImageFile);
      expect(field.required).toBe(false);
      // Each says what it is in its own words, not the column's API line.
      expect(field.hideColumnDescription).toBe(true);
    }
  });

  test("each logo says where it is shown, and the dark one what happens without it", async () => {
    await renderPage();

    const fields: Array<FieldShape> = formFieldsOf(LOGO_CARD);
    const logo: FieldShape = fieldFor(fields, "logoFile")!;
    const darkLogo: FieldShape = fieldFor(fields, "darkThemeLogoFile")!;

    expect(logo.title).toBe("Logo");
    expect(logo.description).toBe(DashboardBrandingCopy.logoDescription);

    expect(darkLogo.title).toBe("Dark Theme Logo");
    expect(darkLogo.placeholder).toBe("Upload logo for the dark theme");
    expect(darkLogo.description).toBe(
      DashboardBrandingCopy.darkThemeLogoDescription,
    );
    expect(DashboardBrandingCopy.darkThemeLogoDescription).toBe(
      "Shown instead of the logo where your public dashboard is dark. Without one, the logo is shown on a light backdrop there.",
    );
  });

  test("the card shows both logos, each on the page it is made for, and says so when there is no dark one", async () => {
    await renderPage();

    const details: Array<FieldShape> = detailFieldsOf(LOGO_CARD);

    expect(columnsOf(details)).toEqual(["logoFile", "darkThemeLogoFile"]);

    const logo: FieldShape = fieldFor(details, "logoFile")!;
    const darkLogo: FieldShape = fieldFor(details, "darkThemeLogoFile")!;

    expect(logo.imageBackdrop).toBe(DetailImageBackdrop.Light);
    expect(darkLogo.imageBackdrop).toBe(DetailImageBackdrop.Dark);

    // The card reads the image itself, as it reads the logo's.
    expect(darkLogo.field).toEqual({
      darkThemeLogoFile: { file: true, fileType: true },
    });
    expect(darkLogo.fieldType).toBe(FieldType.ImageFile);
    expect(darkLogo.title).toBe("Dark Theme Logo");
    expect(darkLogo.placeholder).toBe(DashboardBrandingCopy.noDarkThemeLogo);
  });

  test("speaks the status page's words where they are the same, already in every language", () => {
    expect(DashboardBrandingCopy.noDarkThemeLogo).toBe(
      StatusPageBrandingCopy.noDarkThemeLogo,
    );
    expect(DashboardBrandingCopy.darkThemeLogoTitle).toBe("Dark Theme Logo");
    expect(DashboardBrandingCopy.darkThemeLogoPlaceholder).toBe(
      "Upload logo for the dark theme",
    );
  });
});

describe("the dark theme logo's column", () => {
  const dashboard: Dashboard = new Dashboard();

  test("is a file, read and written as the logo is", () => {
    const relation: ReturnType<Dashboard["getTableColumnMetadata"]> =
      dashboard.getTableColumnMetadata("darkThemeLogoFile");
    const logo: ReturnType<Dashboard["getTableColumnMetadata"]> =
      dashboard.getTableColumnMetadata("logoFile");

    expect(relation.type).toBe(TableColumnType.Entity);
    expect(relation.manyToOneRelationColumn).toBe("darkThemeLogoFileId");
    expect(relation.title).toBe("Dark Theme Logo");

    expect(dashboard.getColumnAccessControlFor("darkThemeLogoFile")).toEqual(
      dashboard.getColumnAccessControlFor("logoFile"),
    );
    expect(dashboard.getColumnAccessControlFor("darkThemeLogoFileId")).toEqual(
      dashboard.getColumnAccessControlFor("logoFileId"),
    );
    expect(logo.type).toBe(TableColumnType.Entity);
  });

  test("removing the file leaves the dashboard without it, never takes the dashboard with it", () => {
    const repository: string = path.join(__dirname, "..", "..", "..");
    const migration: string = fs.readFileSync(
      path.join(
        repository,
        "Server/Infrastructure/Postgres/SchemaMigrations/1808710000000-AddDashboardDarkThemeLogoKey.ts",
      ),
      "utf8",
    );

    expect(migration).toContain(
      'FOREIGN KEY ("darkThemeLogoFileId") REFERENCES "File"("_id") ON DELETE SET NULL',
    );
  });
});
