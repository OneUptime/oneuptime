import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A table's card title says what its word means (#6819): a list page where
 * a word is first met - "On-Call Policies", "Monitor Groups", "SLOs" -
 * passes the Glossary term in its cardProps, and the title's words are
 * drawn as a defined term beside the plan's badge. A table that does not
 * ask marks nothing.
 */

let dictionary: Record<string, string> = {};

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
  const translate: (value: string | undefined) => string | undefined = (
    value: string | undefined,
  ): string | undefined => {
    if (typeof value !== "string" || value.length === 0) {
      return value;
    }

    return dictionary[value] ?? value;
  };

  return {
    __esModule: true,
    default: () => {
      return {
        translateString: translate,
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? translate(value) : value;
        },
      };
    },
  };
});

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";
import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import { DEFINED_TERM_TEST_ID } from "../../../../UI/Components/Glossary/DefinedTerm";

const makeProps: (
  cardProps: BaseModelTableProps<Monitor>["cardProps"],
) => BaseModelTableProps<Monitor> = (
  cardProps: BaseModelTableProps<Monitor>["cardProps"],
): BaseModelTableProps<Monitor> => {
  const callbacks: BaseTableCallbacks<Monitor> = {
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject): Monitor => {
      return item as unknown as Monitor;
    },
    getJSONFromModel: (item: Monitor): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<Monitor>> => {
      return { data: [], count: 0, skip: data.skip, limit: data.limit };
    },
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): React.ReactElement => {
      return <div data-testid="create-edit-modal" />;
    },
  } as unknown as BaseTableCallbacks<Monitor>;

  return {
    modelType: Monitor,
    id: "glossary-table",
    name: "Glossary Table",
    userPreferencesKey: "glossary-table",
    urlStateKey: "glossary-table",
    columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
    filters: [],
    cardProps: cardProps,
    isCreateable: false,
    isEditable: false,
    isDeleteable: false,
    isViewable: false,
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<Monitor>;
};

const heading: () => Promise<HTMLElement> = async (): Promise<HTMLElement> => {
  return waitFor(() => {
    return screen.getByTestId("card-details-heading");
  });
};

beforeEach(() => {
  dictionary = {};
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/things");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a table's card title", () => {
  test("is drawn as a defined term when its cardProps name a Glossary term", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          title: "Monitor Groups",
          titleGlossaryTerm: GlossaryTerm.MonitorGroup,
          description: "Monitors that together make up one service.",
        })}
      />,
    );

    const word: HTMLElement = within(await heading()).getByTestId(
      DEFINED_TERM_TEST_ID,
    );

    expect(word).toHaveTextContent("Monitor Groups");
    expect(word).toHaveAttribute("data-glossary-term", "monitor-group");
    // Once: the card does not mark the table's title a second time.
    expect(screen.getAllByTestId(DEFINED_TERM_TEST_ID)).toHaveLength(1);
  });

  test("is drawn in the reader's language", async () => {
    dictionary = { "Monitor Groups": "Monitorgruppen" };

    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          title: "Monitor Groups",
          titleGlossaryTerm: GlossaryTerm.MonitorGroup,
        })}
      />,
    );

    expect(
      within(await heading()).getByTestId(DEFINED_TERM_TEST_ID),
    ).toHaveTextContent("Monitorgruppen");
  });

  test("is plain words on a table that names no term", async () => {
    render(
      <BaseModelTable<Monitor> {...makeProps({ title: "Monitor Groups" })} />,
    );

    expect(await heading()).toHaveTextContent("Monitor Groups");
    expect(screen.queryByTestId(DEFINED_TERM_TEST_ID)).toBeNull();
  });
});
