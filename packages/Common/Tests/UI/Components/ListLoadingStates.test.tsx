import List, { ComponentProps } from "../../../UI/Components/List/List";
import FieldType from "../../../UI/Components/Types/FieldType";
import "@testing-library/jest-dom";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import React from "react";

/*
 * The list's loading contract, mirroring the table's: a first load (nothing
 * fetched yet) renders card-shaped skeletons in ListBody's own wrapper so
 * nothing shifts when data lands; a refetch keeps the stale cards visible,
 * dimmed and unclickable; error and empty only speak once loading finishes.
 */

describe("List loading states", () => {
  interface ListData {
    id: string;
    name: string;
    description: string;
  }

  const fields: ComponentProps<ListData>["fields"] = [
    {
      title: "ID",
      key: "id",
      fieldType: FieldType.Text,
      colSpan: 1,
    },
    {
      title: "Name",
      key: "name",
      fieldType: FieldType.Text,
      colSpan: 2,
    },
    {
      title: "Description",
      key: "description",
      fieldType: FieldType.Text,
      colSpan: 2,
    },
  ];

  const defaultProps: ComponentProps<ListData> = {
    data: [
      { id: "1", name: "Item 1", description: "Description 1" },
      { id: "2", name: "Item 2", description: "Description 2" },
    ],
    id: "test-list",
    fields: fields,
    onNavigateToPage: jest.fn(),
    currentPageNumber: 1,
    totalItemsCount: 10,
    itemsOnPage: 10,
    error: "",
    isLoading: false,
    singularLabel: "Item",
    pluralLabel: "Items",
  };

  describe("first load (nothing to show yet)", () => {
    it("renders skeleton cards instead of a spinner", () => {
      render(<List {...defaultProps} isLoading={true} data={[]} />);

      expect(screen.getByTestId("list-skeleton-loader")).toBeInTheDocument();
      expect(screen.queryByTestId("component-loader")).toBeNull();
    });

    it("announces itself as a polite status with a Loading label", () => {
      render(<List {...defaultProps} isLoading={true} data={[]} />);

      const loader: HTMLElement = screen.getByTestId("list-skeleton-loader");
      expect(loader).toHaveAttribute("role", "status");
      expect(loader).toHaveAttribute("aria-live", "polite");
      expect(loader).toHaveTextContent("Loading");
    });

    it("matches ListBody's wrapper so nothing shifts when data lands", () => {
      render(<List {...defaultProps} isLoading={true} data={[]} />);

      expect(screen.getByTestId("list-skeleton-loader")).toHaveClass(
        "space-y-6",
        "p-6",
        "border-t",
      );
    });

    it("renders one card per item on the page, capped at 6", () => {
      render(
        <List {...defaultProps} isLoading={true} data={[]} itemsOnPage={25} />,
      );

      const loader: HTMLElement = screen.getByTestId("list-skeleton-loader");
      expect(loader.querySelectorAll(":scope > div")).toHaveLength(6);
    });

    it("renders fewer cards for a smaller page size", () => {
      render(
        <List {...defaultProps} isLoading={true} data={[]} itemsOnPage={3} />,
      );

      const loader: HTMLElement = screen.getByTestId("list-skeleton-loader");
      expect(loader.querySelectorAll(":scope > div")).toHaveLength(3);
    });

    it("gives each card one placeholder line per field", () => {
      render(<List {...defaultProps} isLoading={true} data={[]} />);

      const loader: HTMLElement = screen.getByTestId("list-skeleton-loader");
      const firstCard: Element = loader.querySelectorAll(
        ":scope > div",
      )[0] as Element;

      expect(
        firstCard.querySelectorAll('[data-testid="skeleton"]'),
      ).toHaveLength(fields.length);
    });
  });

  describe("refetch with cards already on screen", () => {
    it("keeps the real cards and shows no skeletons", () => {
      render(<List {...defaultProps} isLoading={true} />);

      expect(screen.queryByTestId("list-skeleton-loader")).toBeNull();
      expect(screen.getByText("Item 1")).toBeInTheDocument();
    });

    it("dims the stale cards and blocks pointer events on them", () => {
      render(<List {...defaultProps} isLoading={true} />);

      const content: HTMLElement = screen.getByTestId("list-content");
      expect(content).toHaveClass("opacity-60");
      expect(content).toHaveClass("pointer-events-none");
    });

    it("an idle list is neither dimmed nor blocked", () => {
      render(<List {...defaultProps} />);

      const content: HTMLElement = screen.getByTestId("list-content");
      expect(content).not.toHaveClass("opacity-60");
      expect(content).not.toHaveClass("pointer-events-none");
    });

    /*
     * Loading outranks error: mid-refetch the error prop can only be stale
     * (the parent clears it before every fetch), so surfacing it over live
     * cards would report a failure that is not happening.
     */
    it("a stale error does not interrupt the dimmed cards", () => {
      render(<List {...defaultProps} isLoading={true} error="stale failure" />);

      expect(screen.getByText("Item 1")).toBeInTheDocument();
      expect(screen.queryByText("stale failure")).toBeNull();
    });
  });

  describe("after loading finishes", () => {
    it("an error replaces the cards", () => {
      render(<List {...defaultProps} error="Something went wrong" />);

      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(screen.queryByTestId("list-skeleton-loader")).toBeNull();
    });

    it("an empty result shows the no-items message, not skeletons", () => {
      render(
        <List {...defaultProps} data={[]} noItemsMessage="Nothing here" />,
      );

      expect(screen.getByText("Nothing here")).toBeInTheDocument();
      expect(screen.queryByTestId("list-skeleton-loader")).toBeNull();
    });
  });
});
