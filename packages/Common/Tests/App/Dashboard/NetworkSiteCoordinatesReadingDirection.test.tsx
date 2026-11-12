import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { drawLine, getDrawnText } from "../../Helpers/BidiLayout";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import Navigation from "../../../UI/Utils/Navigation";
import FormField from "../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  NUMBER_AT_THE_PAGE_START_CLASS_NAME,
  NUMBER_READS_LEFT_TO_RIGHT_CLASS_NAME,
} from "../../../UI/Components/Input/Input";

/*
 * A NETWORK SITE'S POINT ON THE MAP KEEPS ITS MINUS SIGN (#7099).
 *
 * A site with a latitude and a longitude shows them as one pair: in the
 * Sites list's Location column and as a site's Coordinates. Written as
 * plain text in a line of an Arabic or Persian page, laid out from the
 * right, "42.3601, -71.0589" (Boston) was drawn "71.0589- ,42.3601": the
 * minus sign on the other side of its number and the two numbers swapped,
 * another point to whoever read it.
 *
 * Both places draw the pair as one left-to-right isolate now
 * (SiteCoordinates), as the CSV import's preview does: in every language it
 * is drawn "42.3601, -71.0589". The pages are rendered for real here (their
 * table and their detail card are replaced by stand-ins that hand over what
 * they were given), and each cell is laid out by a copy of the Unicode
 * bidi algorithm (Tests/Helpers/BidiLayout) in the page's direction.
 */

interface CapturedColumn {
  title: string;
  getElement?: (item: NetworkSite) => ReactElement;
}

interface CapturedField {
  title?: string;
  getElement?: (item: NetworkSite) => ReactElement;
}

// A field of the form a table's Add button or a card's Edit button opens.
type CapturedFormField = Field<NetworkSite>;

let tableColumns: Array<CapturedColumn> = [];
let detailFields: Array<CapturedField> = [];
let formFields: Array<CapturedFormField> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: {
      columns: Array<CapturedColumn>;
      formFields?: Array<CapturedFormField>;
    }): null => {
      tableColumns = props.columns;
      formFields = [...formFields, ...(props.formFields || [])];
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: {
      modelDetailProps: { fields: Array<CapturedField> };
      formFields?: Array<CapturedFormField>;
    }): null => {
      detailFields = props.modelDetailProps.fields;
      // A page of several cards (Settings: Site Settings, Alerting): all of them.
      formFields = [...formFields, ...(props.formFields || [])];
      return null;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 0;
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<BaseModel>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          filterBar: null,
          emptyState: {},
          mergeFiltersIntoQuery: (
            base: Record<string, unknown> | undefined,
          ) => {
            return base || {};
          },
          hasActiveFilters: false,
          facetSelections: {},
          facetOperators: {},
          setFacetSelection: () => {},
          clearAllFacets: () => {},
          facetSaveState: {},
          restoreFacetState: () => {},
        };
      },
    };
  },
);

// The summary strip, the hierarchy tree and the health hero read on mount.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteSummaryCards",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteHierarchyTree",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteStatusHero",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import NetworkSitesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/Sites";
import NetworkSiteViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/Index";
import NetworkChildSitesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/ChildSites";
import NetworkSiteSettingsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/Settings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import SiteCoordinates, {
  formatSiteCoordinates,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteCoordinates";

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const RIGHT_TO_LEFT_LANGUAGES: Array<string> = ["ar", "fa"];
const ALL_LANGUAGES: Array<string> = ["ar", "fa", "en"];

const BOSTON: string = "42.3601, -71.0589";

// The marks a dir="ltr" and a dir="rtl" isolate stand for in a line.
const LEFT_TO_RIGHT_ISOLATE: string = String.fromCharCode(0x2066);
const RIGHT_TO_LEFT_ISOLATE: string = String.fromCharCode(0x2067);
const SITE_ID: string = "50000000-0000-4000-8000-000000007099";

const instances: Record<string, i18n> = {};
const locales: Record<string, Record<string, string>> = {};

beforeAll(async () => {
  for (const language of ALL_LANGUAGES) {
    const instance: i18n = createInstance();

    locales[language] = JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
    ) as Record<string, string>;

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: locales[language]! } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  tableColumns = [];
  detailFields = [];
  formFields = [];
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(SITE_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const site: (latitude?: number, longitude?: number) => NetworkSite = (
  latitude?: number,
  longitude?: number,
): NetworkSite => {
  const model: NetworkSite = new NetworkSite();
  model._id = SITE_ID;
  model.name = "Boston Store 1216";

  if (latitude !== undefined) {
    model.latitude = latitude;
  }

  if (longitude !== undefined) {
    model.longitude = longitude;
  }

  return model;
};

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/:projectId/network-sites"),
  currentProject: null,
  hasPaymentMethod: false,
};

const inLanguage: (language: string, element: ReactElement) => HTMLElement = (
  language: string,
  element: ReactElement,
): HTMLElement => {
  return render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter>
        <div data-testid="holder">{element}</div>
      </MemoryRouter>
    </I18nextProvider>,
  ).getByTestId("holder");
};

// A page, drawn in `language`: its table or card hands over what it was given.
const drawPage: (
  language: string,
  page: ReactElement,
) => Promise<void> = async (
  language: string,
  page: ReactElement,
): Promise<void> => {
  await act(async () => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <MemoryRouter>{page}</MemoryRouter>
      </I18nextProvider>,
    );
  });
};

// The Sites list's Location cell for `item`, drawn on a page in `language`.
const drawListCell: (
  language: string,
  item: NetworkSite,
) => Promise<HTMLElement> = async (
  language: string,
  item: NetworkSite,
): Promise<HTMLElement> => {
  await drawPage(language, <NetworkSitesPage {...PAGE_PROPS} />);

  const column: CapturedColumn | undefined = tableColumns.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === "Location";
    },
  );

  expect(column?.getElement).toBeDefined();
  cleanup();

  return inLanguage(language, column!.getElement!(item))
    .firstElementChild as HTMLElement;
};

// A site page's Coordinates value for `item`, drawn on a page in `language`.
const drawDetailValue: (
  language: string,
  item: NetworkSite,
) => Promise<HTMLElement> = async (
  language: string,
  item: NetworkSite,
): Promise<HTMLElement> => {
  await drawPage(language, <NetworkSiteViewPage {...PAGE_PROPS} />);

  const field: CapturedField | undefined = detailFields.find(
    (candidate: CapturedField): boolean => {
      return candidate.title === "Coordinates";
    },
  );

  expect(field?.getElement).toBeDefined();
  cleanup();

  return inLanguage(language, field!.getElement!(item))
    .firstElementChild as HTMLElement;
};

/*
 * An element's text as one line holds it: an isolate's marks around each
 * bdi or dir - LRI for ltr, RLI for rtl, FSI for a bdi of no dir.
 */
const asLine: (node: Node) => string = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element: Element = node as Element;
  const inner: string = Array.from(element.childNodes).map(asLine).join("");
  const dir: string | null = element.getAttribute("dir");

  if (dir === "ltr") {
    return `${LEFT_TO_RIGHT_ISOLATE}${inner}${POP_DIRECTIONAL_ISOLATE}`;
  }

  if (dir === "rtl") {
    return `${RIGHT_TO_LEFT_ISOLATE}${inner}${POP_DIRECTIONAL_ISOLATE}`;
  }

  if (element.tagName === "BDI") {
    return `${FIRST_STRONG_ISOLATE}${inner}${POP_DIRECTIONAL_ISOLATE}`;
  }

  return inner;
};

// What a reader sees, left to right, on a page read `language`'s way.
const drawnOnPage: (element: HTMLElement, language: string) => string = (
  element: HTMLElement,
  language: string,
): string => {
  return getDrawnText(
    drawLine(asLine(element), language === "en" ? "ltr" : "rtl"),
  );
};

describe("the bug: a point written as plain text in a right-to-left line", () => {
  test("loses its minus sign's place and swaps its numbers", () => {
    const drawn: string = getDrawnText(drawLine(BOSTON, "rtl"));

    expect(drawn).not.toBe(BOSTON);
    // The minus sign is drawn after the longitude, and the longitude first.
    expect(drawn.indexOf("71.0589")).toBeLessThan(drawn.indexOf("42.3601"));
    expect(drawn).toContain("71.0589-");
  });
});

describe("SiteCoordinates", () => {
  test("writes the pair as the fields and the import file do", () => {
    expect(formatSiteCoordinates(42.3601, -71.0589)).toBe(BOSTON);
    expect(formatSiteCoordinates(-33.8688, 151.2093)).toBe(
      "-33.8688, 151.2093",
    );
    expect(formatSiteCoordinates(0, 0)).toBe("0, 0");
    // Every digit it was given: never rounded as a count would be.
    expect(formatSiteCoordinates(51.50735123, -0.12775829)).toBe(
      "51.50735123, -0.12775829",
    );
  });

  test.each(ALL_LANGUAGES)(
    "%s: one left-to-right isolate, drawn latitude first with its minus sign in place",
    (language: string) => {
      const holder: HTMLElement = inLanguage(
        language,
        <SiteCoordinates latitude={42.3601} longitude={-71.0589} />,
      );
      const point: HTMLElement = holder.firstElementChild as HTMLElement;

      expect(point.tagName).toBe("BDI");
      expect(point).toHaveAttribute("dir", "ltr");
      expect(point).toHaveAttribute("data-testid", "site-coordinates");
      expect(point.textContent).toBe(BOSTON);
      expect(drawnOnPage(holder, language)).toBe(BOSTON);
    },
  );

  test("takes the test id and classes it is given", () => {
    const holder: HTMLElement = inLanguage(
      "ar",
      <SiteCoordinates
        latitude={-33.8688}
        longitude={151.2093}
        className="tabular-nums"
        dataTestId="site-csv-coordinates"
      />,
    );
    const point: HTMLElement = holder.firstElementChild as HTMLElement;

    expect(point).toHaveAttribute("data-testid", "site-csv-coordinates");
    expect(point).toHaveClass("tabular-nums");
    expect(drawnOnPage(holder, "ar")).toBe("-33.8688, 151.2093");
  });
});

describe("the Sites list's Location column", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: a point in the western hemisphere reads 42.3601, -71.0589",
    async (language: string) => {
      const cell: HTMLElement = await drawListCell(
        language,
        site(42.3601, -71.0589),
      );

      // The cell's line keeps its classes and the page's way.
      expect(cell.tagName).toBe("SPAN");
      expect(cell.getAttribute("class")).toBe("text-sm text-gray-600");
      expect(cell).not.toHaveAttribute("dir");

      // Its point is one left-to-right isolate, and nothing else.
      expect(cell.children).toHaveLength(1);
      const point: HTMLElement = cell.firstElementChild as HTMLElement;

      expect(point.tagName).toBe("BDI");
      expect(point).toHaveAttribute("dir", "ltr");
      expect(cell.textContent).toBe(BOSTON);
      expect(drawnOnPage(cell, language)).toBe(BOSTON);
    },
  );

  test("en: the cell reads as it always did", async () => {
    const cell: HTMLElement = await drawListCell("en", site(42.3601, -71.0589));

    expect(cell.tagName).toBe("SPAN");
    expect(cell.getAttribute("class")).toBe("text-sm text-gray-600");
    expect(cell).not.toHaveAttribute("dir");
    expect(cell.textContent).toBe(BOSTON);
    expect(drawnOnPage(cell, "en")).toBe(BOSTON);
  });

  test.each(ALL_LANGUAGES)(
    "%s: a site with no point says so, in the reader's words, with no isolate",
    async (language: string) => {
      const cell: HTMLElement = await drawListCell(language, site(42.3601));

      expect(cell.textContent).toBe(locales[language]!["Not pinned"]);
      expect(cell.querySelector("bdi")).toBeNull();
    },
  );
});

describe("a site's Coordinates", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: a point in the western hemisphere reads 42.3601, -71.0589",
    async (language: string) => {
      const value: HTMLElement = await drawDetailValue(
        language,
        site(42.3601, -71.0589),
      );

      expect(value.tagName).toBe("SPAN");
      expect(value).not.toHaveAttribute("dir");
      expect(value).not.toHaveAttribute("class");
      expect(value.children).toHaveLength(1);
      expect(value.firstElementChild?.tagName).toBe("BDI");
      expect(value.firstElementChild).toHaveAttribute("dir", "ltr");
      expect(value.textContent).toBe(BOSTON);
      expect(drawnOnPage(value, language)).toBe(BOSTON);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: a point south and east of zero keeps its signs too",
    async (language: string) => {
      const value: HTMLElement = await drawDetailValue(
        language,
        site(-33.8688, 151.2093),
      );

      expect(drawnOnPage(value, language)).toBe("-33.8688, 151.2093");
    },
  );

  test("en: the value reads as it always did", async () => {
    const value: HTMLElement = await drawDetailValue(
      "en",
      site(42.3601, -71.0589),
    );

    expect(value.tagName).toBe("SPAN");
    expect(value).not.toHaveAttribute("dir");
    expect(value.textContent).toBe(BOSTON);
    expect(drawnOnPage(value, "en")).toBe(BOSTON);
  });

  test.each(ALL_LANGUAGES)(
    "%s: a site with no point says so, with no isolate",
    async (language: string) => {
      const value: HTMLElement = await drawDetailValue(
        language,
        site(undefined, -71.0589),
      );

      expect(value.textContent).toBe(
        locales[language]!["Not pinned on the map"],
      );
      expect(value.querySelector("bdi")).toBeNull();
    },
  );
});

/*
 * THE FORMS THAT TAKE A SITE'S POINT.
 *
 * Add Site (the Sites list), Add Child Site (a site's Child Sites) and Edit
 * Settings (a site's Settings) ask for the latitude and the longitude in
 * number fields. On an Arabic or Persian page such a field showed Boston's
 * saved longitude as "71.0589-" and its example as "89.6501-"; a number
 * field there now reads its number left to right, at the field's right
 * (Input: NUMBER_READS_LEFT_TO_RIGHT_CLASS_NAME). Each form's own fields
 * are drawn here, as the form draws them, with Boston's point in them.
 */
describe("the forms that take a site's point", () => {
  const FORMS: Array<{ name: string; page: ReactElement }> = [
    { name: "Add Site", page: <NetworkSitesPage {...PAGE_PROPS} /> },
    {
      name: "Add Child Site",
      page: <NetworkChildSitesPage {...PAGE_PROPS} />,
    },
    {
      name: "Edit Settings",
      page: <NetworkSiteSettingsPage {...PAGE_PROPS} />,
    },
  ];

  // The form's field for `column`, as the page hands it to its form.
  const formFieldFor: (
    language: string,
    page: ReactElement,
    column: "latitude" | "longitude",
  ) => Promise<CapturedFormField> = async (
    language: string,
    page: ReactElement,
    column: "latitude" | "longitude",
  ): Promise<CapturedFormField> => {
    await drawPage(language, page);

    const field: CapturedFormField | undefined = formFields.find(
      (candidate: CapturedFormField): boolean => {
        return Boolean(
          candidate.field &&
            (candidate.field as Record<string, unknown>)[column],
        );
      },
    );

    expect(field).toBeDefined();
    cleanup();

    return field!;
  };

  // `field` drawn by the form's own field, holding `value`, on a `language` page.
  const drawFormField: (
    language: string,
    field: CapturedFormField,
    value: number,
  ) => HTMLInputElement = (
    language: string,
    field: CapturedFormField,
    value: number,
  ): HTMLInputElement => {
    const column: string = Object.keys(field.field || {})[0]!;

    return inLanguage(
      language,
      <FormField<NetworkSite>
        field={field}
        fieldName={column}
        index={0}
        isDisabled={false}
        error=""
        touched={false}
        currentValues={{ [column]: value } as FormValues<NetworkSite>}
        setFieldTouched={(): void => {}}
        setFieldValue={(): void => {}}
      />,
    ).querySelector("input") as HTMLInputElement;
  };

  const NUMBER_CLASSES: Array<string> = [
    ...NUMBER_READS_LEFT_TO_RIGHT_CLASS_NAME.split(" "),
    NUMBER_AT_THE_PAGE_START_CLASS_NAME,
  ];

  for (const form of FORMS) {
    test(`${form.name} asks for both in number fields, with a negative example`, async () => {
      const latitude: CapturedFormField = await formFieldFor(
        "en",
        form.page,
        "latitude",
      );
      const longitude: CapturedFormField = await formFieldFor(
        "en",
        form.page,
        "longitude",
      );

      expect(latitude.fieldType).toBe(FormFieldSchemaType.Number);
      expect(longitude.fieldType).toBe(FormFieldSchemaType.Number);
      expect(longitude.placeholder).toBe("-89.6501");
    });

    test.each(RIGHT_TO_LEFT_LANGUAGES)(
      `${form.name}, %s: Boston's longitude and the example read left to right, at the field's right`,
      async (language: string) => {
        const longitude: CapturedFormField = await formFieldFor(
          language,
          form.page,
          "longitude",
        );
        const input: HTMLInputElement = drawFormField(
          language,
          longitude,
          -71.0589,
        );

        expect(input).toHaveAttribute("type", "number");
        expect(input).toHaveValue(-71.0589);
        expect(input).toHaveAttribute("placeholder", "-89.6501");

        for (const className of NUMBER_CLASSES) {
          expect(input.className.split(" ")).toContain(className);
        }
      },
    );

    test(`${form.name}, en: the field is drawn as it always was`, async () => {
      const longitude: CapturedFormField = await formFieldFor(
        "en",
        form.page,
        "longitude",
      );
      const input: HTMLInputElement = drawFormField("en", longitude, -71.0589);

      expect(input).toHaveValue(-71.0589);
      expect(input).not.toHaveAttribute("dir");
      expect(input.className).not.toContain("unicode-bidi");
      expect(input.className).not.toContain(
        NUMBER_AT_THE_PAGE_START_CLASS_NAME,
      );
    });
  }
});

describe("every place the Dashboard writes a site's point", () => {
  // Every .tsx file under the Dashboard's source.
  const sourceFiles: (directory: string) => Array<string> = (
    directory: string,
  ): Array<string> => {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        files.push(...sourceFiles(entryPath));
      } else if (entry.name.endsWith(".tsx")) {
        files.push(entryPath);
      }
    }

    return files;
  };

  // A latitude and a longitude side by side as text: "{lat}, {lng}".
  const PAIRS_AS_TEXT: Array<string> = ["latitude}, {", "latitude}, ${"];

  test("draws it with SiteCoordinates, never as plain text", () => {
    const files: Array<string> = sourceFiles(DASHBOARD_SOURCE);
    const offenders: Array<string> = [];

    // A walk that found nothing would pass vacuously.
    expect(files.length).toBeGreaterThan(100);

    for (const file of files) {
      if (file.endsWith(`${path.sep}SiteCoordinates.tsx`)) {
        continue;
      }

      const source: string = fs.readFileSync(file, "utf8");

      for (const pair of PAIRS_AS_TEXT) {
        if (source.indexOf(pair) !== -1) {
          offenders.push(`${path.relative(DASHBOARD_SOURCE, file)}: ${pair}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the list, the site page and the CSV import all use it", () => {
    for (const page of [
      "Pages/NetworkSite/Sites.tsx",
      "Pages/NetworkSite/View/Index.tsx",
      "Components/NetworkSite/ImportSitesFromCsvModal.tsx",
    ]) {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SOURCE, page),
        "utf8",
      );

      expect(source).toContain("<SiteCoordinates");
    }
  });

  test("the scan finds a pair written as text", () => {
    // Negative control: what the list's cell said before #7099.
    const before: string = "<span>{item.latitude}, {item.longitude}</span>";

    expect(
      PAIRS_AS_TEXT.some((pair: string): boolean => {
        return before.indexOf(pair) !== -1;
      }),
    ).toBe(true);
    expect(
      PAIRS_AS_TEXT.some((pair: string): boolean => {
        return "{`${row.latitude}, ${row.longitude}`}".indexOf(pair) !== -1;
      }),
    ).toBe(true);
  });
});
