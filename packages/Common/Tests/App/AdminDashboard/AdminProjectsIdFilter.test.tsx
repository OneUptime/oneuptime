import "@testing-library/jest-dom";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Location, MemoryRouter } from "react-router-dom";

/*
 * Same story as the Users table: a master admin holding a project ID - from a
 * billing record, a support ticket, a telemetry attribute - needs to reach the
 * project. Search covers the project name only, so an ID was previously a dead
 * end.
 *
 * The Projects page has a second axis this file has to hold steady: it rebuilds
 * its form fields whenever the billing toggle flips, in an effect. The filters
 * must not be collateral damage of that re-render, so every assertion here runs
 * against the props captured after the effect has settled.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

type CapturedTableProps = {
  filters?: Array<Filter<Project>> | undefined;
  searchableFields?: Array<string> | undefined;
  showViewIdButton?: boolean | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;
let renderCount: number = 0;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      renderCount = renderCount + 1;
      return null;
    },
  };
});

import Projects from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/Index";
import Filter from "../../../UI/Components/ModelFilter/Filter";
import FieldType from "../../../UI/Components/Types/FieldType";
import Navigation from "../../../UI/Utils/Navigation";
import Project from "../../../Models/DatabaseModels/Project";
import { getFilterKeys } from "../../../UI/Components/ModelTable/FilterDataToQuery";

type FilterTitledFunction = (title: string) => Filter<Project>;

const filterTitled: FilterTitledFunction = (title: string): Filter<Project> => {
  const filter: Filter<Project> | undefined = (
    capturedTableProps?.filters || []
  ).find((candidate: Filter<Project>) => {
    return candidate.title === title;
  });

  if (!filter) {
    throw new Error(
      `No "${title}" filter. Filters: ${(capturedTableProps?.filters || [])
        .map((candidate: Filter<Project>) => {
          return candidate.title;
        })
        .join(", ")}`,
    );
  }

  return filter;
};

describe("Admin > Projects page", () => {
  beforeEach(async () => {
    capturedTableProps = null;
    renderCount = 0;

    /*
     * The page reads the current route to build the row's view link. In the
     * app the router pushes this in; under test nothing does.
     */
    Navigation.setLocation({
      pathname: "/admin/projects",
      search: "",
      hash: "",
      state: null,
      key: "test",
    } as Location);

    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>,
    );

    // The form-field effect renders a second time; wait it out.
    await waitFor(() => {
      expect(renderCount).toBeGreaterThan(1);
    });
  });

  describe("the Project ID filter", () => {
    test("is offered as a filter", () => {
      expect(() => {
        return filterTitled("Project ID");
      }).not.toThrow();
    });

    test("filters on the project's own id column", () => {
      expect(filterTitled("Project ID").field).toEqual({ _id: true });
    });

    /*
     * ObjectID routes to the free-text input with the operator menu. A
     * Dropdown or Entity type would render a picker instead, which is useless
     * to someone who has the ID and not the name.
     */
    test("renders as a typed-in ID, not a picker", () => {
      expect(filterTitled("Project ID").type).toBe(FieldType.ObjectID);
    });

    /*
     * Undeclared keys are stripped from the outgoing query by
     * `sanitizeFilterData`, so this is what stops the filter being silently
     * dropped between the modal and the request.
     */
    test("declares _id as an allowed filter key", () => {
      expect(
        getFilterKeys<Project>(capturedTableProps!.filters || []),
      ).toContain("_id");
    });

    test("comes first, where an admin pasting an ID will look", () => {
      expect(capturedTableProps!.filters?.[0]?.title).toBe("Project ID");
    });

    /*
     * The page re-renders on its own whenever the billing toggle flips. The
     * filter list is rebuilt inline on each of those renders, so this guards
     * against it being tangled up with the form-field state that does change.
     */
    test("survives the page's own re-renders", () => {
      expect(renderCount).toBeGreaterThan(1);
      expect(filterTitled("Project ID").field).toEqual({ _id: true });
    });
  });

  describe("what it must not have displaced", () => {
    test("keeps the filters the page already had", () => {
      expect(
        (capturedTableProps!.filters || []).map((filter: Filter<Project>) => {
          return filter.title;
        }),
      ).toEqual(["Project ID", "Name", "Created At"]);
    });

    /*
     * `_id` deliberately stays out of free-text search: a hex id contains most
     * characters somewhere, so searching "a" would match nearly every project.
     */
    test("leaves the search box searching names", () => {
      expect(capturedTableProps!.searchableFields).toEqual(["name"]);
    });

    test("still lets an admin read a row's id", () => {
      expect(capturedTableProps!.showViewIdButton).toBe(true);
    });
  });
});
