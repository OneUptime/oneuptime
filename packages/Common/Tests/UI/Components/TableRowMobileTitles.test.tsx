import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import TableRow from "../../../UI/Components/Table/TableRow";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";

/*
 * On a phone a table row is a card that labels each value with its column's
 * title. The header row that translates the titles on a wide screen
 * (TableHeader) is not shown there, and the card printed the titles as
 * written - so a phone in German read "Reporter Name" over every value while
 * the same table on a laptop said "Name der meldenden Person".
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return typeof value === "string" && value ? `[de] ${value}` : value;
        },
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" && value ? `[de] ${value}` : value;
        },
      };
    },
  };
});

interface Row {
  _id?: string | undefined;
  reporterName?: string | undefined;
  reporterEmail?: string | undefined;
}

const COLUMNS: Columns<Row> = [
  {
    key: "reporterName",
    title: "Reporter Name",
    type: FieldType.Text,
  },
  {
    key: "reporterEmail",
    title: "Reporter Email",
    type: FieldType.Text,
  },
];

afterEach(() => {
  cleanup();
});

describe("a table row on a phone", () => {
  test("labels each value with its column's translated title", () => {
    render(
      <TableRow<Row>
        item={{
          _id: "1",
          reporterName: "Ada Lovelace",
          reporterEmail: "ada@example.com",
        }}
        columns={COLUMNS}
        isMobile={true}
      />,
    );

    expect(screen.getByText("[de] Reporter Name")).toBeInTheDocument();
    expect(screen.getByText("[de] Reporter Email")).toBeInTheDocument();
    expect(screen.queryByText("Reporter Name")).not.toBeInTheDocument();

    // The values themselves are the row's data, and are not looked up.
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });
});
