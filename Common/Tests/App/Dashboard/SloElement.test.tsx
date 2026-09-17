import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * SloElement is how an SLO is named wherever it shows up as an affected
 * resource: the incident and alert "Affected Resources" card and the
 * resources cell of every incident and alert list. It has to link to the
 * SLO's overview (that is the whole point of listing it), and it has to
 * render for a user who only has the relation-readable columns, `_id` and
 * `name`.
 *
 * AppLink is replaced by a plain anchor so the href can be read and a click
 * can stand in for navigation.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
        onNavigateComplete?: (() => void) | undefined;
      }): ReactElement => {
        return React.createElement(
          "a",
          {
            href: props.to?.toString(),
            className: props.className,
            onClick: (event: { preventDefault: () => void }): void => {
              event.preventDefault();
              props.onNavigateComplete?.();
            },
          },
          props.children,
        );
      },
    };
  },
);

import SloElement from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloElement";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const SLO_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";

type BuildSloFunction = (data: {
  id?: string | undefined;
  name?: string | undefined;
}) => ServiceLevelObjective;

const buildSlo: BuildSloFunction = (data: {
  id?: string | undefined;
  name?: string | undefined;
}): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();

  if (data.id) {
    slo._id = data.id;
  }

  if (data.name !== undefined) {
    slo.name = data.name;
  }

  return slo;
};

beforeEach(() => {
  // Route population reads the project id from the current URL.
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
});

afterEach(() => {
  cleanup();
});

describe("SloElement", () => {
  test("links the SLO's name to its overview in the current project", () => {
    render(
      <SloElement
        serviceLevelObjective={buildSlo({
          id: SLO_ID,
          name: "Checkout availability",
        })}
      />,
    );

    const link: HTMLElement = screen.getByRole("link");

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/slos/${SLO_ID}`,
    );
    expect(link).toHaveTextContent("Checkout availability");
    expect(link).toHaveClass("hover:underline");
  });

  test("wraps the name in a flex span, which the affected resources card truncates", () => {
    render(
      <SloElement
        serviceLevelObjective={buildSlo({
          id: SLO_ID,
          name: "Checkout availability",
        })}
      />,
    );

    const nameSpan: Element | null = screen
      .getByRole("link")
      .querySelector("span.flex");

    expect(nameSpan).not.toBeNull();
    expect(nameSpan).toHaveTextContent("Checkout availability");
  });

  test("shows no icon unless asked, and the gauge icon when asked", () => {
    const slo: ServiceLevelObjective = buildSlo({
      id: SLO_ID,
      name: "Checkout availability",
    });

    const { rerender } = render(<SloElement serviceLevelObjective={slo} />);

    expect(screen.getByRole("link").querySelector("svg")).toBeNull();

    rerender(<SloElement serviceLevelObjective={slo} showIcon={true} />);

    expect(screen.getByRole("link").querySelector("svg")).not.toBeNull();
  });

  test("tells the caller when navigation completes, so a drawer or modal can close", () => {
    const onNavigateComplete: MockFunction = getJestMockFunction();

    render(
      <SloElement
        serviceLevelObjective={buildSlo({
          id: SLO_ID,
          name: "Checkout availability",
        })}
        onNavigateComplete={onNavigateComplete}
      />,
    );

    fireEvent.click(screen.getByRole("link"));

    expect(onNavigateComplete).toHaveBeenCalledTimes(1);
  });

  test("an SLO without an id is named but not linked", () => {
    render(
      <SloElement
        serviceLevelObjective={buildSlo({ name: "Checkout availability" })}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Checkout availability")).toBeInTheDocument();
  });

  test("an SLO with neither id nor name renders nothing rather than failing", () => {
    const { container } = render(
      <SloElement serviceLevelObjective={buildSlo({})} />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("");
  });

  test("a name is text, never markup", () => {
    const hostileName: string = '<img src="x" onerror="alert(1)"> Checkout';

    const { container } = render(
      <SloElement
        serviceLevelObjective={buildSlo({ id: SLO_ID, name: hostileName })}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link")).toHaveTextContent(hostileName);
  });
});
