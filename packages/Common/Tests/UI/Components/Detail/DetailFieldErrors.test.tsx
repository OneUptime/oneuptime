import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

const loggerErrorMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the compiled
 * requires, so loggerErrorMock is still unassigned when the factory runs.
 * Dereferencing it lazily, at call time, is what makes this work.
 */
jest.mock("../../../../UI/Utils/Logger", () => {
  return {
    __esModule: true,
    Logger: {
      error: (...args: Array<any>) => {
        return loggerErrorMock(...args);
      },
      warn: () => {
        return undefined;
      },
      log: () => {
        return undefined;
      },
      info: () => {
        return undefined;
      },
    },
  };
});

import Detail from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";
import FieldType from "../../../../UI/Components/Types/FieldType";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Color from "../../../../Types/Color";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Detail's getField is a plain closure called from Detail's own render, so a
 * throw out of a field's getElement used to unwind the entire route up to the
 * app level ErrorBoundary - replacing the whole page with "Something went
 * wrong" over one bad cell. That is issue #3374: an Incident Episode with no
 * severity threw "Episode Severity not found" from the severity renderer and
 * took the detail page with it.
 *
 * The two call sites in that issue are fixed at source, but the same shape
 * exists in ~20 other getElement callbacks across the dashboard. These tests
 * pin the framework level guard: a throwing field renderer degrades to
 * whatever the field type already rendered, logs the misconfiguration, and
 * costs exactly one field - never the page.
 */

interface DetailItem {
  incidentSeverity?: IncidentSeverity | undefined;
  title?: string | undefined;
  description?: string | undefined;
}

type RenderDetailFunction = (
  item: DetailItem,
  fields: Array<Field<DetailItem>>,
) => HTMLElement;

const renderDetail: RenderDetailFunction = (
  item: DetailItem,
  fields: Array<Field<DetailItem>>,
): HTMLElement => {
  const { container } = render(
    <Detail<DetailItem>
      item={item}
      fields={fields}
      showDetailsInNumberOfColumns={1}
    />,
  );

  return container;
};

type BuildSeverityFunction = (name: string, color?: Color) => IncidentSeverity;

const buildSeverity: BuildSeverityFunction = (
  name: string,
  color?: Color,
): IncidentSeverity => {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = new ObjectID("severity-id").toString();
  severity.name = name;

  if (color) {
    severity.color = color;
  }

  return severity;
};

type ThrowingFieldFunction = (
  key: keyof DetailItem,
  title: string,
  error: unknown,
) => Field<DetailItem>;

const throwingField: ThrowingFieldFunction = (
  key: keyof DetailItem,
  title: string,
  error: unknown,
): Field<DetailItem> => {
  return {
    key: key,
    title: title,
    fieldType: FieldType.Element,
    getElement: (): ReactElement => {
      throw error;
    },
  };
};

const badgeSelector: string = '[data-dropdown-value-badge="true"]';

beforeEach(() => {
  loggerErrorMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("Detail: a throwing field renderer never takes down the page", () => {
  test("does not rethrow out of render when getElement throws", () => {
    expect(() => {
      renderDetail({ title: "Episode one" }, [
        throwingField("title", "Episode Title", new Error("boom")),
      ]);
    }).not.toThrow();
  });

  test("renders the surrounding grid, so the route survives", () => {
    const container: HTMLElement = renderDetail({ title: "Episode one" }, [
      throwingField("title", "Episode Title", new Error("boom")),
    ]);

    // The label is still rendered - the row exists, only its value is missing.
    expect(container.textContent).toContain("Episode Title");
  });

  test("costs exactly one field - the siblings still render their values", () => {
    const container: HTMLElement = renderDetail(
      { title: "Episode one", description: "A long running episode" },
      [
        throwingField("title", "Episode Title", new Error("boom")),
        {
          key: "description",
          title: "Description",
          fieldType: FieldType.Text,
        },
      ],
    );

    expect(container.textContent).toContain("Description");
    expect(container.textContent).toContain("A long running episode");
  });

  test("logs the misconfiguration once, naming the field and the message", () => {
    renderDetail({ title: "Episode one" }, [
      throwingField(
        "title",
        "Episode Title",
        new BadDataException("Episode Severity not found"),
      ),
    ]);

    expect(loggerErrorMock).toHaveBeenCalledTimes(1);

    const logged: string = String(loggerErrorMock.mock.calls[0]?.[0]);

    expect(logged).toContain("title");
    expect(logged).toContain("Episode Severity not found");
  });

  test("logs once per throwing field when several fields throw", () => {
    const container: HTMLElement = renderDetail(
      { title: "Episode one", description: "A long running episode" },
      [
        throwingField("title", "Episode Title", new Error("first")),
        throwingField("description", "Description", new Error("second")),
      ],
    );

    expect(loggerErrorMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Episode Title");
    expect(container.textContent).toContain("Description");
  });

  test("catches a thrown non Error value and still logs it", () => {
    expect(() => {
      renderDetail({ title: "Episode one" }, [
        throwingField("title", "Episode Title", "a bare string"),
      ]);
    }).not.toThrow();

    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(String(loggerErrorMock.mock.calls[0]?.[0])).toContain(
      "a bare string",
    );
  });

  test("keeps the entity badge the field type already rendered", () => {
    /*
     * data is computed from the field key and transformed by the Entity
     * branch before getElement runs, so swallowing the throw leaves the
     * framework's own rendering of the relation in place.
     */
    const container: HTMLElement = renderDetail(
      { incidentSeverity: buildSeverity("Critical", new Color("#ef4444")) },
      [
        {
          key: "incidentSeverity",
          title: "Episode Severity",
          fieldType: FieldType.Entity,
          getElement: (): ReactElement => {
            throw new BadDataException("Episode Severity not found");
          },
        },
      ],
    );

    const badge: HTMLElement | null =
      container.querySelector<HTMLElement>(badgeSelector);

    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Critical");
  });

  test("falls back to the field placeholder when the relation is absent", () => {
    const container: HTMLElement = renderDetail({}, [
      {
        key: "incidentSeverity",
        title: "Episode Severity",
        fieldType: FieldType.Entity,
        placeholder: "No severity",
        getElement: (): ReactElement => {
          throw new BadDataException("Episode Severity not found");
        },
      },
    ]);

    expect(container.textContent).toContain("No severity");
    expect(container.querySelector(badgeSelector)).toBeNull();
  });

  test("never shows the app level error boundary copy", () => {
    const container: HTMLElement = renderDetail({ title: "Episode one" }, [
      throwingField("title", "Episode Title", new Error("boom")),
    ]);

    expect(container.textContent).not.toContain("Something went wrong");
    expect(container.textContent).not.toContain(
      "An unexpected error has occurred",
    );
  });
});

describe("Detail: fields that do not throw are untouched by the guard", () => {
  test("renders the element a healthy getElement returns", () => {
    const container: HTMLElement = renderDetail({ title: "Episode one" }, [
      {
        key: "title",
        title: "Episode Title",
        fieldType: FieldType.Element,
        getElement: (item: DetailItem): ReactElement => {
          return <span data-testid="custom">{item.title}</span>;
        },
      },
    ]);

    expect(
      container.querySelector<HTMLElement>('[data-testid="custom"]')
        ?.textContent,
    ).toEqual("Episode one");
  });

  test("does not log anything when no field throws", () => {
    renderDetail({ title: "Episode one" }, [
      {
        key: "title",
        title: "Episode Title",
        fieldType: FieldType.Text,
      },
    ]);

    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  test("getElement still wins over the value the field type computed", () => {
    const container: HTMLElement = renderDetail(
      { incidentSeverity: buildSeverity("Critical", new Color("#ef4444")) },
      [
        {
          key: "incidentSeverity",
          title: "Episode Severity",
          fieldType: FieldType.Entity,
          getElement: (): ReactElement => {
            return <span data-testid="custom">Handled</span>;
          },
        },
      ],
    );

    expect(container.querySelector('[data-testid="custom"]')).not.toBeNull();
    expect(container.querySelector(badgeSelector)).toBeNull();
  });

  test("a getElement that returns a placeholder dash renders the dash", () => {
    /*
     * The shape both episode detail pages now use for an absent severity or
     * state. It must survive the guard untouched and must not log.
     */
    const container: HTMLElement = renderDetail({}, [
      {
        key: "incidentSeverity",
        title: "Episode Severity",
        fieldType: FieldType.Entity,
        getElement: (item: DetailItem): ReactElement => {
          if (!item["incidentSeverity"]) {
            return <>-</>;
          }

          return <span data-testid="custom">present</span>;
        },
      },
    ]);

    expect(container.textContent).toContain("Episode Severity");
    expect(container.textContent).toContain("-");
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
