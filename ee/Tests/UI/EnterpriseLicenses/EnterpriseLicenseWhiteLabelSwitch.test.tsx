import "@testing-library/jest-dom";
import { describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import fs from "fs";
import nodePath from "path";
import React from "react";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import { JSONObject } from "Common/Types/JSON";
import {
  CAN_BE_WHITE_LABELLED_DESCRIPTION,
  CAN_BE_WHITE_LABELLED_TITLE,
  WhiteLabelBadge,
} from "../../../AdminDashboard/EnterpriseLicenses/Components/LicenseUtil";

/*
 * "There should be a new 'Can be white-labelled' (or something as such)
 * toggle on the enterprise licence form." - the maintainer.
 *
 * On OneUptime Cloud's license screens: the switch on the create form and the
 * edit form (License step), shown on the license's details, and a badge in
 * the license list. Off unless OneUptime turns it on.
 *
 * The admin forms are asserted against their source, the way the other
 * license-screen suites do (EnterpriseLicenseCreateWiring); the switch's
 * column and the badge are exercised for real.
 */

const SCREENS_DIR: string = nodePath.join(
  __dirname,
  "../../../AdminDashboard/EnterpriseLicenses",
);

const COMMENTS: RegExp = /\/\*[\s\S]*?\*\//g;

const readSource: (file: string) => string = (file: string): string => {
  return fs
    .readFileSync(nodePath.join(SCREENS_DIR, file), "utf8")
    .replace(COMMENTS, "");
};

const listSource: string = readSource("Pages/Index.tsx");
const viewSource: string = readSource("Pages/View/Index.tsx");

// The part of a source between `formFields={[` and the next closing `]}`.
const formFieldsOf: (source: string) => string = (source: string): string => {
  return (source.split("formFields={[")[1] || "").split("]}")[0] as string;
};

// One field's declaration, from its `field: {` to the next field's.
const fieldDeclaration: (formFields: string, column: string) => string = (
  formFields: string,
  column: string,
): string => {
  return (formFields.split(`${column}: true`)[1] || "").split("field: {")[0] as string;
};

describe("the switch on the license forms", () => {
  test.each([
    ["the create form", listSource],
    ["the edit form", viewSource],
  ])(
    "%s offers it as a toggle on the License step, not required",
    (_label: string, source: string) => {
      const field: string = fieldDeclaration(
        formFieldsOf(source),
        "canBeWhiteLabelled",
      );

      expect(field).toContain("title: CAN_BE_WHITE_LABELLED_TITLE");
      expect(field).toContain("description: CAN_BE_WHITE_LABELLED_DESCRIPTION");
      expect(field).toContain("FormFieldSchemaType.Toggle");
      expect(field).toContain('stepId: "license"');
      expect(field).toContain("required: false");
    },
  );

  test("the license's details show it", () => {
    const details: string = viewSource.split("modelDetailProps={{")[1] || "";
    const field: string = (details.split("canBeWhiteLabelled: true")[1] ||
      "").split("field: {")[0] as string;

    expect(field).toContain("title: CAN_BE_WHITE_LABELLED_TITLE");
    expect(field).toContain("FieldType.Boolean");
  });

  test("the list reads it, and badges a license that has it", () => {
    expect(
      (listSource.split("selectMoreFields={{")[1] || "").split("}}")[0],
    ).toContain("canBeWhiteLabelled: true");
    expect(listSource).toContain(
      "item.canBeWhiteLabelled ? <WhiteLabelBadge /> : <></>",
    );
  });

  test("says what it allows in one plain sentence, and how it reaches the customer", () => {
    expect(CAN_BE_WHITE_LABELLED_TITLE).toBe("Can be white-labelled");
    expect(CAN_BE_WHITE_LABELLED_DESCRIPTION).toContain(
      "replace the OneUptime name and logo",
    );
    expect(CAN_BE_WHITE_LABELLED_DESCRIPTION).toContain(
      "Admin Dashboard > Settings > White Label",
    );
    expect(CAN_BE_WHITE_LABELLED_DESCRIPTION).toContain(
      "signed license token",
    );
  });
});

describe("EnterpriseLicense.canBeWhiteLabelled", () => {
  const metadata: TableColumnMetadata = new EnterpriseLicense().getTableColumnMetadata(
    "canBeWhiteLabelled",
  ) as TableColumnMetadata;

  test("is a boolean that is off unless OneUptime turns it on", () => {
    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.defaultValue).toBe(false);
    expect(metadata.isDefaultValueColumn).toBe(true);
  });

  test("is for OneUptime's master admins only, like every other license column", () => {
    const access: Record<string, unknown> =
      new EnterpriseLicense().getColumnAccessControlFor(
        "canBeWhiteLabelled",
      ) as unknown as Record<string, unknown>;

    expect(access["create"]).toEqual([]);
    expect(access["read"]).toEqual([]);
    expect(access["update"]).toEqual([]);
  });

  test.each([true, false])(
    "survives the trip from the posted form onto the model (%s)",
    (value: boolean) => {
      const license: EnterpriseLicense = BaseModel.fromJSON(
        {
          companyName: "Acme Reseller Inc",
          expiresAt: "2027-01-01",
          canBeWhiteLabelled: value,
        } as JSONObject,
        EnterpriseLicense,
      ) as EnterpriseLicense;

      expect(license.canBeWhiteLabelled).toBe(value);
    },
  );
});

describe("WhiteLabelBadge", () => {
  test("reads White-label", () => {
    render(<WhiteLabelBadge />);

    expect(screen.getByTestId("license-white-label-badge")).toHaveTextContent(
      "White-label",
    );
  });
});
