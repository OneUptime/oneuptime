import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * Network > Settings > Address Names (issue #5340): the names people give
 * addresses and subnets nothing else names. A plain list - a name and an
 * address or subnet - added here or with "Name this address" on a Traffic
 * page, with the form the Traffic page's dialog uses. ModelTable is the
 * product's own (its props are captured here); the offline
 * NetworkTrafficNames suite drives the real list.
 */

interface CapturedColumn {
  field: Record<string, boolean>;
  title: string;
  getElement?: ((item: unknown) => React.ReactElement) | undefined;
}

interface CapturedTable {
  modelType: unknown;
  isCreateable: boolean;
  isEditable: boolean;
  isDeleteable: boolean;
  isViewable: boolean;
  cardProps: { title: string; description: string };
  helpContent: { title: string; description: string; markdown: string };
  noItemsMessage: string;
  searchableFields: Array<string>;
  formFields: Array<{ field: Record<string, boolean> }>;
  columns: Array<CapturedColumn>;
  sortBy: string;
}

let captured: CapturedTable | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable): React.ReactElement => {
      captured = props;
      return <div data-testid="model-table" />;
    },
  };
});

import NetworkAddressNamesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/AddressNames";
import NetworkAddressName from "../../../Models/DatabaseModels/NetworkAddressName";
import Route from "../../../Types/API/Route";

afterEach(() => {
  cleanup();
  captured = null;
});

function renderPage(): CapturedTable {
  render(
    <NetworkAddressNamesPage
      pageRoute={
        new Route("/dashboard/p/network-devices/settings/address-names")
      }
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  if (!captured) {
    throw new Error("The list was not drawn");
  }

  return captured;
}

describe("Network > Settings > Address Names", () => {
  test("a list of the project's Address Names, made, changed and removed here", () => {
    const table: CapturedTable = renderPage();

    expect(screen.getByTestId("model-table")).toBeInTheDocument();
    expect(table.modelType).toBe(NetworkAddressName);
    expect(table.isCreateable).toBe(true);
    expect(table.isEditable).toBe(true);
    expect(table.isDeleteable).toBe(true);
    // A row says all there is: no page of its own.
    expect(table.isViewable).toBe(false);
    expect(table.cardProps.title).toBe("Address Names");
    expect(table.sortBy).toBe("name");
  });

  test("found by a name or by an address", () => {
    expect(renderPage().searchableFields).toEqual(["name", "address"]);
  });

  test("the same two fields as the Traffic page's Name this address", () => {
    expect(
      renderPage().formFields.map(
        (field: { field: Record<string, boolean> }) => {
          return Object.keys(field.field)[0];
        },
      ),
    ).toEqual(["name", "address"]);
  });

  test("says where traffic names come from, in the order they are picked", () => {
    const markdown: string = renderPage().helpContent.markdown;

    const ownName: number = markdown.indexOf("A name on this page");
    const inventory: number = markdown.indexOf("Your inventory");
    const dns: number = markdown.indexOf("DNS");

    expect(ownName).toBeGreaterThan(-1);
    expect(inventory).toBeGreaterThan(ownName);
    expect(dns).toBeGreaterThan(inventory);
    expect(markdown).toContain("10.18.167.0/24");
    expect(markdown).toContain("narrowest");
  });

  test("an empty list says how to add the first name", () => {
    expect(renderPage().noItemsMessage).toContain("Name this address");
  });

  test("a name reads the way its letters do; an address left to right, in the mono face", () => {
    const table: CapturedTable = renderPage();
    const [nameColumn, addressColumn] = table.columns;
    const row: NetworkAddressName = new NetworkAddressName();
    row.name = "حقوق و دستمزد";
    row.address = "10.18.167.0/24";

    expect(nameColumn!.title).toBe("Name");
    expect(addressColumn!.title).toBe("Address or Subnet");

    render(
      <div>
        <span data-testid="name-cell">{nameColumn!.getElement!(row)}</span>
        <span data-testid="address-cell">
          {addressColumn!.getElement!(row)}
        </span>
      </div>,
    );

    const name: HTMLElement = screen.getByTestId("name-cell")
      .firstElementChild as HTMLElement;
    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "rtl");

    const address: HTMLElement = screen.getByTestId("traffic-address-text");
    expect(address).toHaveAttribute("dir", "ltr");
    expect(address).toHaveClass("font-mono");
    expect(address).toHaveTextContent("10.18.167.0/24");
  });

  /*
   * The table gives a cell's span, p, div or a its rows' line height; a
   * bdi straight in the cell kept its own, and the address sat a few
   * pixels above the name beside it.
   */
  test("the address sits level with the name: it is drawn in a span, which the cell gives its line height", () => {
    const table: CapturedTable = renderPage();
    const addressColumn: CapturedColumn = table.columns[1]!;
    const row: NetworkAddressName = new NetworkAddressName();
    row.name = "Backup appliance";
    row.address = "10.18.167.20";

    render(
      <div data-testid="address-cell">{addressColumn.getElement!(row)}</div>,
    );

    const cell: HTMLElement = screen.getByTestId("address-cell");
    const first: HTMLElement = cell.firstElementChild as HTMLElement;

    expect(first.tagName).toBe("SPAN");
    expect(first).toHaveClass("text-sm", "text-gray-700");
    expect(first.firstElementChild).toBe(
      screen.getByTestId("traffic-address-text"),
    );
  });
});
