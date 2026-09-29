import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The header's create button reads "<createVerb> <singularName>". It used to
 * be translated one word at a time, so a table with createVerb "Link" read
 * "Link" out of context - most locales translated it as the noun ("a link"),
 * and a verb-noun phrase does not keep English word order in many languages
 * either. The whole phrase is now looked up first and the word-by-word join
 * is only the fallback. Translation is mocked with a dictionary per test.
 */

let dictionary: Record<string, string> = {};
let lookedUp: Array<string> = [];

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

    lookedUp.push(value);

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

type TableOptions = {
  createVerb?: string | undefined;
  singularName?: string | undefined;
  onCreateClick?: (() => void) | undefined;
};

describe("BaseModelTable header create button title", () => {
  type MakePropsFunction = (
    options: TableOptions,
  ) => BaseModelTableProps<Monitor>;

  const makeProps: MakePropsFunction = (
    options: TableOptions,
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
      id: "create-title-table",
      name: "Create Title",
      userPreferencesKey: "create-title-table",
      urlStateKey: "create-title-table",
      columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
      filters: [],
      cardProps: { title: "Things", description: "All things" },
      isCreateable: true,
      isEditable: false,
      isDeleteable: false,
      isViewable: false,
      callbacks: callbacks,
      ...(options.createVerb ? { createVerb: options.createVerb } : {}),
      ...(options.singularName ? { singularName: options.singularName } : {}),
      ...(options.onCreateClick
        ? { onCreateClick: options.onCreateClick }
        : {}),
    } as unknown as BaseModelTableProps<Monitor>;
  };

  type CardButtonTextsFunction = () => Array<string>;

  const cardButtonTexts: CardButtonTextsFunction = (): Array<string> => {
    return Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="card-button"]'),
    ).map((button: HTMLElement): string => {
      return (button.textContent || "").trim();
    });
  };

  type RenderedTitleFunction = (options: TableOptions) => Promise<string>;

  /* The header's first card button is the create button. */
  const renderedTitle: RenderedTitleFunction = async (
    options: TableOptions,
  ): Promise<string> => {
    render(<BaseModelTable<Monitor> {...makeProps(options)} />);

    await waitFor(() => {
      expect(cardButtonTexts().length).toBeGreaterThan(0);
    });

    return cardButtonTexts()[0]!;
  };

  beforeEach(() => {
    dictionary = {};
    lookedUp = [];
    PermissionGate.clearPermissionPropsCache();
    window.history.replaceState(window.history.state, "", "/dashboard/things");
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("uses the whole phrase's translation when there is one", async () => {
    dictionary = {
      "Link Alert": "Alarm verknüpfen",
      Link: "Verknüpfung",
      Alert: "Alarm",
    };

    expect(
      await renderedTitle({ createVerb: "Link", singularName: "Alert" }),
    ).toBe("Alarm verknüpfen");
    expect(lookedUp).toContain("Link Alert");
  });

  test("falls back to word by word when the phrase has no translation", async () => {
    dictionary = {
      Invite: "Einladen",
      Member: "Mitglied",
    };

    expect(
      await renderedTitle({ createVerb: "Invite", singularName: "Member" }),
    ).toBe("Einladen Mitglied");
  });

  test("reads the same in English, where the phrase maps to itself", async () => {
    dictionary = {
      "Link Alert": "Link Alert",
      Link: "Link",
      Alert: "Alert",
    };

    expect(
      await renderedTitle({ createVerb: "Link", singularName: "Alert" }),
    ).toBe("Link Alert");
  });

  test("is unchanged with no translations at all", async () => {
    expect(
      await renderedTitle({ createVerb: "Link", singularName: "Alert" }),
    ).toBe("Link Alert");
  });

  test("defaults the verb to Create and the noun to the model's name", async () => {
    dictionary = {
      "Create Monitor": "Monitor erstellen",
    };

    expect(await renderedTitle({})).toBe("Monitor erstellen");
  });

  test("defaults still translate word by word without a phrase entry", async () => {
    dictionary = {
      Create: "Erstellen",
    };

    expect(await renderedTitle({})).toBe("Erstellen Monitor");
  });

  test("still opens the page's own create flow", async () => {
    const onCreateClick: MockFunction = getJestMockFunction();
    dictionary = {
      "Link Alert": "Alarm verknüpfen",
    };

    await renderedTitle({
      createVerb: "Link",
      singularName: "Alert",
      onCreateClick: onCreateClick as unknown as () => void,
    });

    fireEvent.click(
      document.querySelector<HTMLElement>('[data-testid="card-button"]')!,
    );

    expect(onCreateClick).toHaveBeenCalledTimes(1);
  });
});
