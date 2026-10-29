import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * Page's recordHeading: a numbered record's page is headed by its number
 * and its name - "INC-18 Manually declared" - in place of its title, the
 * name drawn as typed. ModelPage hands it in (ModelPageNumbersTheRecord);
 * these pin what Page itself does with it.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          // A German Dashboard, which translates interface words only.
          if (key === "Incident") {
            return "Vorfall";
          }
          if (key === "Overview") {
            return "Übersicht";
          }
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (): void => {},
    },
  };
});

import Page, {
  PAGE_RECORD_HEADING_TEST_IDS,
} from "../../../UI/Components/Page/Page";

afterEach(() => {
  cleanup();
  document.title = "OneUptime";
});

function heading(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

describe("Page's recordHeading", () => {
  test("heads the page with the number and the name, in place of the title", () => {
    render(
      <Page
        title="Incident"
        recordHeading={{ number: "INC-18", name: "Manually declared" }}
      >
        <div>Body</div>
      </Page>,
    );

    expect(heading()).toHaveAttribute(
      "data-testid",
      PAGE_RECORD_HEADING_TEST_IDS.heading,
    );
    expect(heading()).toHaveTextContent("INC-18 Manually declared");
    // The page's own title, in German, is not in it.
    expect(heading().textContent).not.toContain("Vorfall");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  test("draws the name as typed, even a name that is interface text", () => {
    render(
      <Page title="Incident" recordHeading={{ number: "INC-18", name: "Overview" }}>
        <div>Body</div>
      </Page>,
    );

    expect(
      screen.getByTestId(PAGE_RECORD_HEADING_TEST_IDS.name),
    ).toHaveTextContent("Overview");
    expect(heading().textContent).not.toContain("Übersicht");
  });

  test("names the browser tab by it when there is no trail", () => {
    render(
      <Page
        title="Incident"
        recordHeading={{ number: "INC-18", name: "Manually declared" }}
      >
        <div>Body</div>
      </Page>,
    );

    expect(document.title).toBe("OneUptime | INC-18 Manually declared");
  });

  test.each([
    ["no number", { number: " ", name: "Manually declared" }],
    ["no name", { number: "INC-18", name: "" }],
  ])(
    "with %s it heads the page with its title, as before",
    (_case: string, recordHeading: { number: string; name: string }) => {
      render(
        <Page title="Incident" recordHeading={recordHeading}>
          <div>Body</div>
        </Page>,
      );

      expect(heading().textContent).toBe("Vorfall");
      expect(
        screen.queryByTestId(PAGE_RECORD_HEADING_TEST_IDS.number),
      ).toBeNull();
    },
  );

  test("a page without one keeps its title heading", () => {
    render(
      <Page title="Incident">
        <div>Body</div>
      </Page>,
    );

    expect(heading().textContent).toBe("Vorfall");
    expect(heading()).not.toHaveAttribute("data-testid");
    expect(heading()).toHaveClass("sm:truncate");
  });

  test("an error is shown in place of the page, heading and all", () => {
    render(
      <Page
        title="Incident"
        recordHeading={{ number: "INC-18", name: "Manually declared" }}
        error="Cannot load incident."
      >
        <div>Body</div>
      </Page>,
    );

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByText("Cannot load incident.")).toBeInTheDocument();
  });
});
