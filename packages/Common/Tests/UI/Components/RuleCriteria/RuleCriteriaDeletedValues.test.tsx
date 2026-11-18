import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A RULE'S CONDITION THAT NAMES A RECORD SINCE DELETED (#7807, #9066).
 *
 * A rule's conditions keep the ids they name when a record is deleted: the
 * rule matches nothing for it (a rule limited by a list alone is switched
 * off and says so above its conditions: RuleEmptiedLimitsAlert). Its form
 * looked each id up and, finding none, drew the raw id as a chip -
 * "0000000f-...". The criteria builder now says what a workspace rule's
 * Conditions step and card say: "No longer in this project", in the card's
 * muted italics, removable like any pick. EntityDropdown does so only where
 * its page asks (notFoundLabel); everywhere else an unresolved value reads
 * as before.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Includes from "../../../../Types/BaseDatabase/Includes";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import EntityDropdown from "../../../../UI/Components/EntityDropdown/EntityDropdown";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import RuleCriteriaBuilder from "../../../../UI/Components/RuleCriteria/RuleCriteriaBuilder";
import { RuleCriteriaCopy } from "../../../../UI/Components/RuleCriteria/RuleCriteriaFields";

const CHECKOUT: string = "0000000f-0000-4000-8000-000000000001";
const DELETED: string = "0000000f-0000-4000-8000-0000000000ff";

const NOT_FOUND: string = RuleCriteriaCopy.valueNotFound;

interface TestEntity {
  monitors?: Array<string>;
}

const MONITORS: Field<TestEntity> = {
  field: { monitors: true },
  title: "Monitors",
  fieldType: FormFieldSchemaType.MultiSelectDropdown,
  dropdownModal: { type: Monitor, labelField: "name", valueField: "_id" },
  placeholder: "Select Monitors",
};

const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

// The project's monitors: Checkout, and nothing else any more.
function serveMonitors(data?: { isRefused?: boolean }): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (data?.isRefused) {
      throw new Error("The server could not be reached.");
    }

    const query: any = request.query || {};
    const checkout: Monitor = new Monitor();
    checkout._id = CHECKOUT;
    checkout.name = "Checkout";

    const rows: Array<Monitor> = [checkout].filter(
      (monitor: Monitor): boolean => {
        return (
          !(query._id instanceof Includes) ||
          (query._id.values as Array<string>).includes(monitor._id as string)
        );
      },
    );

    return { data: rows, count: rows.length, skip: 0, limit: rows.length };
  });
}

function criteriaNaming(ids: Array<string>): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: [
      {
        field: "monitors",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids,
      },
    ],
  };
}

function chips(): Array<{ name: string; isNotFound: boolean }> {
  return screen
    .queryAllByTestId("entity-dropdown-chip-label")
    .map((label: HTMLElement) => {
      return {
        name: (label.textContent || "").trim(),
        isNotFound: label.getAttribute("data-not-found") === "true",
      };
    });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { de: { translation: GERMAN } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  getListMock.mockReset();
  serveMonitors();
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("a rule's condition naming a record since deleted", () => {
  test("REGRESSION: reads 'No longer in this project' beside the records still there, never its raw id", async () => {
    render(
      <RuleCriteriaBuilder<TestEntity>
        fields={[MONITORS]}
        value={criteriaNaming([CHECKOUT, DELETED])}
        onChange={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(chips()).toEqual([
        { name: "Checkout", isNotFound: false },
        { name: NOT_FOUND, isNotFound: true },
      ]);
    });

    expect(screen.queryByText(DELETED)).toBeNull();
    expect(
      screen
        .getAllByTestId("entity-dropdown-chip-label")
        .find((label: HTMLElement): boolean => {
          return label.getAttribute("data-not-found") === "true";
        }),
    ).toHaveClass("italic");
  });

  test("it can be taken out, and the condition keeps the rest", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <RuleCriteriaBuilder<TestEntity>
        fields={[MONITORS]}
        value={criteriaNaming([CHECKOUT, DELETED])}
        onChange={(criteria: RuleCriteria): void => {
          onChange(criteria);
        }}
      />,
    );

    const remove: HTMLElement = await screen.findByRole("button", {
      name: `Remove ${NOT_FOUND}`,
    });

    await userEvent.setup().click(remove);

    const last: RuleCriteria = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as RuleCriteria;

    expect(last.filters[0]?.value).toEqual([CHECKOUT]);
  });

  test("in German, in the reader's words", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    render(
      <RuleCriteriaBuilder<TestEntity>
        fields={[MONITORS]}
        value={criteriaNaming([DELETED])}
        onChange={(): void => {}}
      />,
    );

    expect(GERMAN[NOT_FOUND]).toBe("Nicht mehr in diesem Projekt");

    await waitFor(() => {
      expect(chips()).toEqual([
        { name: "Nicht mehr in diesem Projekt", isNotFound: true },
      ]);
    });
  });
});

describe("EntityDropdown's value that no record answers to", () => {
  test("reads as its page words it, once the look-up found nothing", async () => {
    render(
      <EntityDropdown
        modelType={Monitor}
        labelField="name"
        valueField="_id"
        isMultiSelect={true}
        value={[CHECKOUT, DELETED]}
        notFoundLabel={NOT_FOUND}
        onChange={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(chips()).toEqual([
        { name: "Checkout", isNotFound: false },
        { name: NOT_FOUND, isNotFound: true },
      ]);
    });
  });

  test("a page that does not ask still shows the id, as before", async () => {
    render(
      <EntityDropdown
        modelType={Monitor}
        labelField="name"
        valueField="_id"
        isMultiSelect={true}
        value={[CHECKOUT, DELETED]}
        onChange={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(chips()).toEqual([
        { name: "Checkout", isNotFound: false },
        { name: DELETED, isNotFound: false },
      ]);
    });
  });

  test("a look-up that failed calls nothing gone", async () => {
    serveMonitors({ isRefused: true });

    render(
      <EntityDropdown
        modelType={Monitor}
        labelField="name"
        valueField="_id"
        isMultiSelect={true}
        value={[DELETED]}
        notFoundLabel={NOT_FOUND}
        onChange={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(chips()).toEqual([{ name: DELETED, isNotFound: false }]);
  });

  test("a single pick no record answers to reads the same", async () => {
    render(
      <EntityDropdown
        modelType={Monitor}
        labelField="name"
        valueField="_id"
        value={DELETED}
        notFoundLabel={NOT_FOUND}
        onChange={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(NOT_FOUND)).toHaveAttribute(
        "data-not-found",
        "true",
      );
    });
  });
});
