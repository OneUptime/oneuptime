import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import Table from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Card from "../../../../UI/Components/Card/Card";
import CardMoreMenu from "../../../../UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "../../../../UI/Components/MoreMenu/MoreMenuItem";
import { forgetRememberedTableFits } from "../../../../UI/Components/Table/useTableFit";
import {
  TABLE_DENSITY_ATTRIBUTE,
  TABLE_DENSITY_MENU_KEY,
  TABLE_DENSITY_MENU_TEXT,
  TABLE_DENSITY_TEST_ID,
  TableDensity,
  readTableDensity,
  useTableDensity,
  writeTableDensity,
} from "../../../../UI/Components/Table/TableDensity";
import {
  TABLE_BODY_CELL_CLASS_NAME,
  TABLE_HEADER_CONTENT_CLASS_NAME,
} from "../../../../UI/Components/Table/TableLayout";
import User from "../../../../UI/Utils/User";
import ObjectID from "../../../../Types/ObjectID";
import IconProp from "../../../../Types/Icon/IconProp";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../../Types/GenericObject";

/*
 * "A density toggle (S)": how tall a table's rows are is the person's
 * choice, for every table (TableDensity) - Comfortable, the 48px rows the
 * product draws, or Compact, 40px rows under a 32px header band, a fifth
 * more rows in the same room. Chosen in the ⋯ of the card a table is in
 * ("Compact rows"), kept per person in this browser, and the same for
 * every table drawn now and later. A phone's cards are not rows.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

const PERSON: string = "80000000-0000-4000-8000-000000000001";
const OTHER_PERSON: string = "80000000-0000-4000-8000-000000000002";

const setWindowWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

let person: string = PERSON;

beforeEach(() => {
  window.localStorage.clear();
  person = PERSON;
  setWindowWidth(1280);
  jest.spyOn(User, "getUserId").mockImplementation((): ObjectID => {
    return new ObjectID(person);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  forgetRememberedTableFits();
  window.localStorage.clear();
  setWindowWidth(1024);
});

describe("the density a person keeps", () => {
  test("is Comfortable until they choose otherwise", () => {
    expect(readTableDensity()).toBe(TableDensity.Comfortable);
  });

  test("Compact is kept for the person, in this browser", () => {
    writeTableDensity(TableDensity.Compact);

    expect(readTableDensity()).toBe(TableDensity.Compact);
    expect(
      JSON.parse(
        window.localStorage.getItem(`TableDensity.${PERSON}`) || "null",
      ),
    ).toEqual({ density: "compact" });
  });

  test("is one person's: another signed in here reads their own", () => {
    writeTableDensity(TableDensity.Compact);

    person = OTHER_PERSON;

    expect(readTableDensity()).toBe(TableDensity.Comfortable);
  });

  test("back to Comfortable keeps nothing at all", () => {
    writeTableDensity(TableDensity.Compact);
    writeTableDensity(TableDensity.Comfortable);

    expect(readTableDensity()).toBe(TableDensity.Comfortable);
    expect(window.localStorage.getItem(`TableDensity.${PERSON}`)).toBeNull();
  });

  test("a stored value that is not a density reads as Comfortable", () => {
    for (const junk of ['{"density":"tiny"}', '"compact"', "[]", "not json"]) {
      window.localStorage.setItem(`TableDensity.${PERSON}`, junk);
      expect(readTableDensity()).toBe(TableDensity.Comfortable);
    }
  });

  test("with no one signed in, it is kept for this browser", () => {
    jest.spyOn(User, "getUserId").mockImplementation((): ObjectID => {
      throw new Error("No one signed in");
    });

    writeTableDensity(TableDensity.Compact);

    expect(readTableDensity()).toBe(TableDensity.Compact);
    expect(window.localStorage.getItem("TableDensity.everyone")).not.toBeNull();
  });
});

describe("useTableDensity", () => {
  function Shows(props: { id: string }): ReactElement {
    const density: TableDensity = useTableDensity();

    return <p data-testid={props.id}>{density}</p>;
  }

  test("is read as a table is first drawn: a compact list never paints a frame of tall rows", () => {
    writeTableDensity(TableDensity.Compact);

    const seen: Array<TableDensity> = [];

    function Records(): ReactElement {
      const density: TableDensity = useTableDensity();
      seen.push(density);
      return <p>{density}</p>;
    }

    render(<Records />);

    expect(seen[0]).toBe(TableDensity.Compact);
  });

  test("every table drawn now changes with it", () => {
    render(
      <>
        <Shows id="first" />
        <Shows id="second" />
      </>,
    );

    act(() => {
      writeTableDensity(TableDensity.Compact);
    });

    expect(screen.getByTestId("first")).toHaveTextContent("compact");
    expect(screen.getByTestId("second")).toHaveTextContent("compact");
  });

  test("another tab's choice is read when the browser says it changed", () => {
    render(<Shows id="table" />);

    window.localStorage.setItem(
      `TableDensity.${PERSON}`,
      JSON.stringify({ density: "compact" }),
    );

    act(() => {
      window.dispatchEvent(new StorageEvent("storage"));
    });

    expect(screen.getByTestId("table")).toHaveTextContent("compact");
  });

  test("a table that is gone is told nothing", () => {
    const view: ReturnType<typeof render> = render(<Shows id="table" />);

    view.unmount();

    // No update on an unmounted table: nothing is thrown, nothing is drawn.
    expect(() => {
      writeTableDensity(TableDensity.Compact);
    }).not.toThrow();
  });
});

interface Service extends GenericObject {
  _id: string;
  name: string;
  owner: string;
}

const SERVICES: Array<Service> = [
  { _id: "1", name: "Checkout API", owner: "Ada Lovelace" },
  { _id: "2", name: "Login", owner: "Grace Hopper" },
];

const COLUMNS: Columns<Service> = [
  { key: "name", title: "Name", type: FieldType.Text },
  { key: "owner", title: "Owner", type: FieldType.Text },
];

function ServicesTable(props: { id: string }): ReactElement {
  return (
    <Table<Service>
      id={props.id}
      data={SERVICES}
      columns={COLUMNS}
      singularLabel="Service"
      pluralLabel="Services"
      currentPageNumber={1}
      totalItemsCount={SERVICES.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      onNavigateToPage={(): void => {}}
      sortOrder={SortOrder.Ascending}
      sortBy="name"
      onSortChanged={(): void => {}}
    />
  );
}

const moreMenu: () => ReactElement = (): ReactElement => {
  return (
    <CardMoreMenu key="more">
      {[
        <MoreMenuItem
          key="refresh"
          text="Refresh"
          icon={IconProp.Refresh}
          onClick={() => {}}
        />,
      ]}
    </CardMoreMenu>
  );
};

function ServicesCard(): ReactElement {
  return (
    <Card title="Services" buttons={[moreMenu()]}>
      <ServicesTable id="services" />
    </Card>
  );
}

const openMenu: () => HTMLElement = (): HTMLElement => {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
  });

  return screen.getByRole("menu");
};

const densityOf: (id: string) => string | null = (
  id: string,
): string | null => {
  return (
    document
      .getElementById(`${id}-body`)
      ?.closest("table")
      ?.getAttribute(TABLE_DENSITY_ATTRIBUTE) || null
  );
};

describe("a table's rows, as tall as the person chose", () => {
  test("the table says its density, which its cells and header read", () => {
    render(<ServicesTable id="services" />);

    expect(densityOf("services")).toBe("comfortable");

    // 4px off each side of a row's line, and of the header band's.
    expect(TABLE_BODY_CELL_CLASS_NAME).toContain(
      "[[data-density=compact]_&]:py-2",
    );
    expect(TABLE_HEADER_CONTENT_CLASS_NAME).toContain(
      "[[data-density=compact]_&]:py-2",
    );
    expect(
      document.querySelector("#services-body td")?.className || "",
    ).toContain("[[data-density=compact]_&]:py-2");
  });

  test("a person who chose Compact sees it from the first draw", () => {
    writeTableDensity(TableDensity.Compact);

    render(<ServicesTable id="services" />);

    expect(densityOf("services")).toBe("compact");
  });

  test("the card's ⋯ offers Compact rows, on or off, after the card's own items", () => {
    render(<ServicesCard />);

    const menu: HTMLElement = openMenu();
    const item: HTMLElement = within(menu).getByTestId(TABLE_DENSITY_TEST_ID);

    expect(TABLE_DENSITY_MENU_TEXT).toBe("Compact rows");
    expect(item).toHaveTextContent("Compact rows");
    // On or off of its own: a checkbox, not one choice of several.
    expect(item).toHaveAttribute("role", "menuitemcheckbox");
    expect(item).toHaveAttribute("aria-checked", "false");
    expect(
      within(menu).queryByTestId(`${TABLE_DENSITY_TEST_ID}-checked`),
    ).toBeNull();

    const items: Array<string> = within(menu)
      .getAllByRole(/menuitem/)
      .map((element: HTMLElement): string => {
        return (element.textContent || "").trim();
      });

    expect(items.indexOf("Refresh")).toBeLessThan(
      items.indexOf("Compact rows"),
    );
  });

  test("picked, the rows are compact - in this table and every other - and the item is ticked", () => {
    render(
      <>
        <ServicesCard />
        <ServicesTable id="elsewhere" />
      </>,
    );

    const menu: HTMLElement = openMenu();

    act(() => {
      fireEvent.click(within(menu).getByTestId(TABLE_DENSITY_TEST_ID));
    });

    expect(densityOf("services")).toBe("compact");
    expect(densityOf("elsewhere")).toBe("compact");
    expect(readTableDensity()).toBe(TableDensity.Compact);

    const item: HTMLElement = within(openMenu()).getByTestId(
      TABLE_DENSITY_TEST_ID,
    );

    expect(item).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId(`${TABLE_DENSITY_TEST_ID}-checked`),
    ).toBeInTheDocument();
  });

  test("picked again, the rows are comfortable again, and nothing is kept", () => {
    writeTableDensity(TableDensity.Compact);

    render(<ServicesCard />);

    const menu: HTMLElement = openMenu();

    act(() => {
      fireEvent.click(within(menu).getByTestId(TABLE_DENSITY_TEST_ID));
    });

    expect(densityOf("services")).toBe("comfortable");
    expect(window.localStorage.getItem(`TableDensity.${PERSON}`)).toBeNull();
  });

  test("two tables in one card share one item, which sets both", () => {
    render(
      <Card title="Services" buttons={[moreMenu()]}>
        <ServicesTable id="first" />
        <ServicesTable id="second" />
      </Card>,
    );

    const menu: HTMLElement = openMenu();

    expect(within(menu).getAllByTestId(TABLE_DENSITY_TEST_ID)).toHaveLength(1);
    expect(TABLE_DENSITY_MENU_KEY).toBe("table-density");

    act(() => {
      fireEvent.click(within(menu).getByTestId(TABLE_DENSITY_TEST_ID));
    });

    expect(densityOf("first")).toBe("compact");
    expect(densityOf("second")).toBe("compact");
  });

  test("a phone's cards are not rows: their card's ⋯ offers no density", () => {
    setWindowWidth(390);

    render(<ServicesCard />);

    expect(within(openMenu()).queryByTestId(TABLE_DENSITY_TEST_ID)).toBeNull();
  });
});
