import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import ProbeElement, {
  PROBE_NAME_CLASS_NAME,
} from "../../../UI/Components/Probe/Probe";
import RoleLabel, {
  ROLE_LABEL_NAME_CLASS_NAME,
} from "../../../UI/Components/RoleLabel/RoleLabel";
import Probe from "../../../Models/DatabaseModels/Probe";
import Color from "../../../Types/Color";
import TableBody from "../../../UI/Components/Table/TableBody";
import Column from "../../../UI/Components/Table/Types/Column";
import FieldType from "../../../UI/Components/Types/FieldType";
import { TABLE_MOBILE_FIELD_VALUE_CLASS_NAME } from "../../../UI/Components/Table/TableLayout";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";

/*
 * A PROBE'S AND A ROLE'S NAME ON AN ARABIC OR PERSIAN PHONE CARD (#6866).
 *
 * A table draws a probe (ProbeElement) and a role (RoleLabel) as a mark
 * beside a name, and its cell keeps the page's way for them: the name sets
 * its own way (IsolatedLine). In a table's row the cell keeps it to one
 * line, cut short at its own end. On a phone each row is a card whose
 * values wrap, and an English name's line - taken for a line kept to one
 * line, so aligned to its end - lined every one of its wrapped lines up on
 * the right of an Arabic card, where #6741 had already fixed the card's
 * other values.
 *
 * The name says it wraps now ([overflow-wrap:anywhere], PROBE_NAME_CLASS_NAME
 * and ROLE_LABEL_NAME_CLASS_NAME), so a name that reads the other way from
 * the page is as wide as its words beside its mark, at the page's start,
 * each of its lines from its own start
 * (CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME). These draw the real card
 * and the real row (TableBody).
 */

const ENGLISH_PROBE: string =
  "Singapore office behind the corporate proxy (sg-1)";
const ARABIC_PROBE: string = "مكتب سنغافورة خلف الوكيل";
const ENGLISH_ROLE: string = "Customer Communications Lead (EMEA)";
const ARABIC_ROLE: string = "قائد التواصل مع العملاء";

const CLAMPED_CLASSES: Array<string> =
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" ");

interface Row {
  _id: string;
  probe: Probe;
  roleName: string;
}

const COLUMNS: Array<Column<Row>> = [
  {
    title: "Probe",
    type: FieldType.Element,
    key: "probe",
    getElement: (row: Row): ReactElement => {
      return <ProbeElement probe={row.probe} />;
    },
  },
  {
    title: "Role",
    type: FieldType.Element,
    key: "roleName",
    getElement: (row: Row): ReactElement => {
      return <RoleLabel name={row.roleName} color={new Color("#b91c1c")} />;
    },
  },
];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "ar", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        ar: { translation: {} },
        fa: { translation: {} },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const rowOf: (probeName: string, roleName: string) => Row = (
  probeName: string,
  roleName: string,
): Row => {
  const probe: Probe = new Probe();
  probe._id = "0193c0de-6866-4aaa-8bbb-000000000001";
  probe.name = probeName;

  return {
    _id: "0193c0de-6866-4aaa-8bbb-000000000002",
    probe: probe,
    roleName: roleName,
  };
};

const drawRow: (data: {
  language: string;
  row: Row;
  isMobile: boolean;
}) => HTMLElement = (data: {
  language: string;
  row: Row;
  isMobile: boolean;
}): HTMLElement => {
  const body: ReactElement = (
    <TableBody<Row>
      id="probes-and-roles"
      data={[data.row]}
      columns={COLUMNS}
      selectedItems={[]}
      matchBulkSelectedItemByField={undefined}
      isMobile={data.isMobile}
    />
  );

  return render(
    <I18nextProvider i18n={instances[data.language]!}>
      <div data-testid="holder">
        {data.isMobile ? body : <table>{body}</table>}
      </div>
    </I18nextProvider>,
  ).getByTestId("holder");
};

const roleNameLine: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("role-label-name");
};

describe("on a phone's card", () => {
  test.each(["ar", "fa"])(
    "%s: an English probe's name wraps from its own start, as wide as its words beside its icon",
    (language: string) => {
      drawRow({
        language: language,
        row: rowOf(ENGLISH_PROBE, ARABIC_ROLE),
        isMobile: true,
      });

      const name: HTMLElement = screen.getByTestId("probe-name");

      expect(name).toHaveAttribute("dir", "ltr");
      expect(name.getAttribute("class")).toBe(
        `${PROBE_NAME_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      // Lined up by its end, its wrapped lines all stood on the card's right.
      expect(name).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);

      // The card's value and the icon's row keep the page's way.
      const value: HTMLElement = name.closest("dd") as HTMLElement;

      expect(value).not.toHaveAttribute("dir");
      expect(value.getAttribute("class")).toContain(
        TABLE_MOBILE_FIELD_VALUE_CLASS_NAME,
      );
      expect(screen.getByTestId("probe-icon").closest("[dir]")).toBeNull();
    },
  );

  test.each(["ar", "fa"])(
    "%s: an English role's name wraps from its own start, as wide as its words beside its mark",
    (language: string) => {
      drawRow({
        language: language,
        row: rowOf(ARABIC_PROBE, ENGLISH_ROLE),
        isMobile: true,
      });

      const name: HTMLElement = roleNameLine();

      expect(name.textContent).toBe(ENGLISH_ROLE);
      expect(name).toHaveAttribute("dir", "ltr");
      expect(name.getAttribute("class")).toBe(
        `${ROLE_LABEL_NAME_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(name).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
      expect(name.parentElement).not.toHaveAttribute("dir");
      expect(name.closest("dd")).not.toHaveAttribute("dir");
    },
  );

  test.each(["ar", "fa"])(
    "%s: Arabic names are drawn as they were: no dir, their own classes",
    (language: string) => {
      drawRow({
        language: language,
        row: rowOf(ARABIC_PROBE, ARABIC_ROLE),
        isMobile: true,
      });

      const probeName: HTMLElement = screen.getByTestId("probe-name");

      expect(probeName).not.toHaveAttribute("dir");
      expect(probeName.getAttribute("class")).toBe(PROBE_NAME_CLASS_NAME);
      expect(roleNameLine()).not.toHaveAttribute("dir");
      expect(roleNameLine().getAttribute("class")).toBe(
        ROLE_LABEL_NAME_CLASS_NAME,
      );
    },
  );

  test("on an English page nothing in the card has a dir, and Arabic names read right to left", () => {
    const holder: HTMLElement = drawRow({
      language: "en",
      row: rowOf(ENGLISH_PROBE, ENGLISH_ROLE),
      isMobile: true,
    });

    expect(holder.querySelectorAll("[dir]")).toHaveLength(0);
    expect(screen.getByTestId("probe-name").getAttribute("class")).toBe(
      PROBE_NAME_CLASS_NAME,
    );
    expect(roleNameLine().getAttribute("class")).toBe(
      ROLE_LABEL_NAME_CLASS_NAME,
    );

    cleanup();

    drawRow({
      language: "en",
      row: rowOf(ARABIC_PROBE, ARABIC_ROLE),
      isMobile: true,
    });

    expect(screen.getByTestId("probe-name")).toHaveAttribute("dir", "rtl");
    expect(screen.getByTestId("probe-name")).toHaveClass(...CLAMPED_CLASSES);
    expect(roleNameLine()).toHaveAttribute("dir", "rtl");
    expect(roleNameLine()).toHaveClass(...CLAMPED_CLASSES);
  });
});

describe("in a table's row", () => {
  test.each(["ar", "fa"])(
    "%s: the names read their own way; the cells keep the page's",
    (language: string) => {
      drawRow({
        language: language,
        row: rowOf(ENGLISH_PROBE, ENGLISH_ROLE),
        isMobile: false,
      });

      const probeName: HTMLElement = screen.getByTestId("probe-name");

      /*
       * The row's cell keeps them to one line: no wider than the cell
       * (max-w-full), each is cut short at its own end, at the page's start.
       */
      expect(probeName).toHaveAttribute("dir", "ltr");
      expect(probeName).toHaveClass(
        "overflow-hidden",
        "text-ellipsis",
        ...CLAMPED_CLASSES,
      );
      expect(probeName.closest("td")).not.toHaveAttribute("dir");

      expect(roleNameLine()).toHaveAttribute("dir", "ltr");
      expect(roleNameLine()).toHaveClass("min-w-0", ...CLAMPED_CLASSES);
      expect(roleNameLine().closest("td")).not.toHaveAttribute("dir");
    },
  );
});
