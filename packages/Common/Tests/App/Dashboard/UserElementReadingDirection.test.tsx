import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";

jest.mock("../../../UI/Images/users/blank-profile.svg", () => {
  return "data:image/svg+xml;base64,////YXZhdGFy";
});

import UserElement, {
  TABLE_CELL_USER_NAME_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/User/User";
import { TableCellContext } from "../../../UI/Components/Table/TableCellContext";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";

/*
 * A person in a table's cell is cut short to the cell, and on a Persian page
 * an English name lost its start: "...negro de la Vega" (#5330). Each line
 * of the person - the name, the address - reads the way it is written where
 * the page reads the other way, so it loses its end instead, and still
 * starts beside the picture as the page's lines do.
 */

const USER_ID: string = "00000000-0000-4000-8000-000000000001";

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { en: { translation: {} }, fa: { translation: {} } },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const drawInCell: (data: {
  language: string;
  name: string;
  email: string;
}) => void = (data: {
  language: string;
  name: string;
  email: string;
}): void => {
  render(
    <I18nextProvider i18n={instances[data.language]!}>
      <TableCellContext.Provider value={true}>
        <UserElement
          user={{ _id: USER_ID, name: data.name, email: data.email }}
        />
      </TableCellContext.Provider>
    </I18nextProvider>,
  );
};

describe("on a Persian page", () => {
  test("an English name and its address read left to right, lined up as the page's lines", () => {
    drawInCell({
      language: "fa",
      name: "José Ignacio Negro de la Vega",
      email: "jose.ignacio@acme-commerce.example",
    });

    const nameLine: HTMLElement = screen.getByTestId("user-name-line");
    const email: HTMLElement = screen.getByTestId("user-email");

    expect(nameLine).toHaveAttribute("dir", "ltr");
    expect(nameLine).toHaveClass(
      TABLE_CELL_USER_NAME_CLASS_NAME,
      LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
    );
    expect(email).toHaveAttribute("dir", "ltr");
    expect(email).toHaveClass("truncate", LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });

  test("a Persian name reads as the page does; its address still left to right", () => {
    drawInCell({
      language: "fa",
      name: "سارا احمدی",
      email: "sara@acme-commerce.example",
    });

    expect(screen.getByTestId("user-name-line")).not.toHaveAttribute("dir");
    expect(screen.getByTestId("user-email")).toHaveAttribute("dir", "ltr");
  });
});

describe("on an English page", () => {
  test("an English person is drawn as before: no direction of its own", () => {
    drawInCell({
      language: "en",
      name: "José Ignacio Negro de la Vega",
      email: "jose.ignacio@acme-commerce.example",
    });

    const nameLine: HTMLElement = screen.getByTestId("user-name-line");

    expect(nameLine).not.toHaveAttribute("dir");
    expect(nameLine).toHaveAttribute("class", TABLE_CELL_USER_NAME_CLASS_NAME);
    expect(screen.getByTestId("user-email")).not.toHaveAttribute("dir");
  });

  test("a Persian name reads right to left", () => {
    drawInCell({
      language: "en",
      name: "سارا احمدی",
      email: "sara@acme-commerce.example",
    });

    expect(screen.getByTestId("user-name-line")).toHaveAttribute("dir", "rtl");
  });
});
