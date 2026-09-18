import "@testing-library/jest-dom";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Location, MemoryRouter } from "react-router-dom";

/*
 * A master admin who has an ID in hand - out of a support ticket, a log line,
 * an API response - needs to get from that ID to the user it belongs to. The
 * Users table's search box only covers name and email, so before this filter
 * existed the only route was paging through every user on the instance.
 *
 * The filter is declarative: the page hands ModelTable a `filters` array and
 * the shared table machinery does the rest. That makes the declaration itself
 * the whole feature, and losing a line of it is silent - the table renders
 * perfectly well with one fewer filter. Hence this file pins the declaration.
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

/*
 * The real ModelTable would drag in the pager, the URL state and a live fetch.
 * What this file is about is the props the page hands it, so a stand-in that
 * records them is both enough and more precise.
 */
type CapturedTableProps = {
  filters?: Array<Filter<User>> | undefined;
  searchableFields?: Array<string> | undefined;
  showViewIdButton?: boolean | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

import Users from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/Index";
import Filter from "../../../UI/Components/ModelFilter/Filter";
import FieldType from "../../../UI/Components/Types/FieldType";
import Navigation from "../../../UI/Utils/Navigation";
import User from "../../../Models/DatabaseModels/User";
import { getFilterKeys } from "../../../UI/Components/ModelTable/FilterDataToQuery";

type FilterTitledFunction = (title: string) => Filter<User>;

const filterTitled: FilterTitledFunction = (title: string): Filter<User> => {
  const filter: Filter<User> | undefined = (
    capturedTableProps?.filters || []
  ).find((candidate: Filter<User>) => {
    return candidate.title === title;
  });

  if (!filter) {
    throw new Error(
      `No "${title}" filter. Filters: ${(capturedTableProps?.filters || [])
        .map((candidate: Filter<User>) => {
          return candidate.title;
        })
        .join(", ")}`,
    );
  }

  return filter;
};

describe("Admin > Users page", () => {
  beforeEach(async () => {
    capturedTableProps = null;

    /*
     * The page reads the current route to build the row's view link. In the
     * app the router pushes this in; under test nothing does.
     */
    Navigation.setLocation({
      pathname: "/admin/users",
      search: "",
      hash: "",
      state: null,
      key: "test",
    } as Location);

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(capturedTableProps).not.toBeNull();
    });
  });

  describe("the User ID filter", () => {
    test("is offered as a filter", () => {
      expect(() => {
        return filterTitled("User ID");
      }).not.toThrow();
    });

    /*
     * `_id` and nothing else. A filter pointed at any other column would look
     * identical in the UI and quietly return the wrong rows.
     */
    test("filters on the user's own id column", () => {
      expect(filterTitled("User ID").field).toEqual({ _id: true });
    });

    /*
     * The type is what picks the input the filter modal renders. ObjectID
     * routes to the text input with its operator menu (contains / equals /
     * starts with / ...); Entity or Dropdown would render a picker of options
     * that nothing populates, leaving an admin with an ID and no way to type
     * it.
     */
    test("renders as a typed-in ID, not a picker", () => {
      expect(filterTitled("User ID").type).toBe(FieldType.ObjectID);
    });

    /*
     * `sanitizeFilterData` drops any key the table did not declare a filter
     * for, so an undeclared `_id` would be stripped between the modal and the
     * request - the modal would accept the ID and the table would come back
     * unfiltered.
     */
    test("declares _id as an allowed filter key", () => {
      expect(getFilterKeys<User>(capturedTableProps!.filters || [])).toContain(
        "_id",
      );
    });

    test("comes first, where an admin pasting an ID will look", () => {
      expect(capturedTableProps!.filters?.[0]?.title).toBe("User ID");
    });
  });

  describe("what it must not have displaced", () => {
    test("keeps the filters the page already had", () => {
      expect(
        (capturedTableProps!.filters || []).map((filter: Filter<User>) => {
          return filter.title;
        }),
      ).toEqual([
        "User ID",
        "Full Name",
        "Email",
        "Email Verified",
        "Last Active At",
      ]);
    });

    /*
     * Free-text search stays on name and email. Adding `_id` here would make
     * every single-character search match nearly every row on the instance,
     * because a hex id contains most characters somewhere.
     */
    test("leaves the search box searching names and emails", () => {
      expect(capturedTableProps!.searchableFields).toEqual(["name", "email"]);
    });

    /*
     * Filtering by ID is only half the loop - the other half is reading an ID
     * off a row to filter or search with elsewhere.
     */
    test("still lets an admin read a row's id", () => {
      expect(capturedTableProps!.showViewIdButton).toBe(true);
    });
  });
});
