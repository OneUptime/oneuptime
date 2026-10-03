import Monitor from "../../../Models/DatabaseModels/Monitor";
import Label from "../../../Models/DatabaseModels/Label";
import Domain from "../../../Models/DatabaseModels/Domain";
import EntityDropdown from "../../../UI/Components/EntityDropdown/EntityDropdown";
import { ENTITY_DROPDOWN_SEARCH_KEY } from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import Search from "../../../Types/BaseDatabase/Search";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "../../../Types/BaseDatabase/IncludesAnyOfGroups";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

/*
 * EntityDropdown's query prop: the entries it offers are only those that
 * match it - the verified domains of a project, say.
 *
 * The dropdown asks the server for entries itself: as its menu opens, as
 * the reader types, and for the entries of a label on the Labels tab. Every
 * one of those requests is narrowed by the query, or the menu offers what
 * the caller left out. Looking up the label of a value that is already
 * picked is not narrowed: a saved value must never show as a raw id.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

type ListRequest = {
  modelType: unknown;
  query: Record<string, unknown>;
  limit: number;
};

function requests(): Array<ListRequest> {
  return getListMock.mock.calls.map((call: Array<any>) => {
    return call[0] as ListRequest;
  });
}

const VERIFIED: { _id: string; domain: string } = {
  _id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  domain: "acme.com",
};

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

describe("EntityDropdown query", () => {
  beforeEach(() => {
    getListMock.mockReset();
    getListMock.mockImplementation(() => {
      return Promise.resolve({ data: [VERIFIED], count: 1 });
    });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  test("the search behind an opening menu asks only for matching entries", async () => {
    render(
      <EntityDropdown
        ariaLabel="Domain"
        modelType={Domain}
        labelField="domain"
        valueField="_id"
        query={{ isVerified: true }}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox", { name: "Domain" }));
    await flush();

    expect(requests()).toHaveLength(1);
    expect(requests()[0]!.query).toEqual({ isVerified: true });
    expect(
      await screen.findByRole("option", { name: "acme.com" }),
    ).toBeTruthy();
  });

  test("a typed search keeps the query and adds the text", async () => {
    render(
      <EntityDropdown
        ariaLabel="Domain"
        modelType={Domain}
        labelField="domain"
        valueField="_id"
        query={{ isVerified: true }}
      />,
    );

    const input: HTMLElement = screen.getByRole("combobox", { name: "Domain" });
    fireEvent.focus(input);
    await flush();

    fireEvent.change(input, { target: { value: "acme" } });

    await waitFor(
      () => {
        expect(requests().length).toBeGreaterThan(1);
      },
      { timeout: 2000 },
    );

    const last: ListRequest = requests()[requests().length - 1]!;

    expect(last.query["isVerified"]).toBe(true);
    expect(last.query["domain"]).toBeInstanceOf(Search);
  });

  /*
   * Regression (review finding 9): the typed search was written over the
   * query's own condition on the label field, so once the reader typed, the
   * menu offered rows the caller meant to leave out.
   */
  test("a typed search keeps the query's own condition on the label field, and adds the text beside it", async () => {
    const callersCondition: EndsWith<string> = new EndsWith(".com");

    render(
      <EntityDropdown
        ariaLabel="Domain"
        modelType={Domain}
        labelField="domain"
        valueField="_id"
        query={{ isVerified: true, domain: callersCondition }}
      />,
    );

    const input: HTMLElement = screen.getByRole("combobox", { name: "Domain" });
    fireEvent.focus(input);
    await flush();

    fireEvent.change(input, { target: { value: "acme" } });

    await waitFor(
      () => {
        expect(requests().length).toBeGreaterThan(1);
      },
      { timeout: 2000 },
    );

    const last: ListRequest = requests()[requests().length - 1]!;

    expect(last.query["isVerified"]).toBe(true);
    expect(last.query["domain"]).toBe(callersCondition);

    const search: MultiSearch = last.query[
      ENTITY_DROPDOWN_SEARCH_KEY
    ] as MultiSearch;

    expect(search).toBeInstanceOf(MultiSearch);
    expect(search.fields).toEqual(["domain"]);
    expect(search.value).toBe("acme");
  });

  test("the label of a value already picked is looked up without the query", async () => {
    const savedId: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    render(
      <EntityDropdown
        ariaLabel="Domain"
        modelType={Domain}
        labelField="domain"
        valueField="_id"
        query={{ isVerified: true }}
        value={savedId}
      />,
    );

    await flush();

    const lookUp: ListRequest | undefined = requests().find(
      (request: ListRequest) => {
        return Boolean(request.query["_id"]);
      },
    );

    expect(lookUp).toBeDefined();
    expect(lookUp!.query["isVerified"]).toBeUndefined();
  });

  test("an equal query handed in again on every render does not search again", async () => {
    const { rerender } = render(
      <EntityDropdown
        ariaLabel="Domain"
        modelType={Domain}
        labelField="domain"
        valueField="_id"
        query={{ isVerified: true }}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox", { name: "Domain" }));
    await flush();

    expect(requests()).toHaveLength(1);

    for (let i: number = 0; i < 3; i++) {
      rerender(
        <EntityDropdown
          ariaLabel="Domain"
          modelType={Domain}
          labelField="domain"
          valueField="_id"
          query={{ isVerified: true }}
        />,
      );
      await flush();
    }

    expect(requests()).toHaveLength(1);
  });

  test("a different query searches again, with the new query", async () => {
    const { rerender } = render(
      <EntityDropdown
        ariaLabel="Domain"
        modelType={Domain}
        labelField="domain"
        valueField="_id"
        query={{ isVerified: true }}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox", { name: "Domain" }));
    await flush();

    rerender(
      <EntityDropdown
        ariaLabel="Domain"
        modelType={Domain}
        labelField="domain"
        valueField="_id"
        query={{ isVerified: false }}
      />,
    );
    await flush();

    expect(requests()).toHaveLength(2);
    expect(requests()[1]!.query).toEqual({ isVerified: false });
  });

  test("without a query the search asks for everything, as before", async () => {
    render(
      <EntityDropdown
        ariaLabel="Domain"
        modelType={Domain}
        labelField="domain"
        valueField="_id"
      />,
    );

    fireEvent.focus(screen.getByRole("combobox", { name: "Domain" }));
    await flush();

    expect(requests()[0]!.query).toEqual({});
  });

  test("the Labels tab adds a label's entries that match the query only", async () => {
    getListMock.mockImplementation((request: any) => {
      if (request?.modelType === Label) {
        return Promise.resolve({
          data: [{ _id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Prod" }],
          count: 1,
        });
      }

      return Promise.resolve({ data: [], count: 0 });
    });

    render(
      <EntityDropdown
        isMultiSelect={true}
        ariaLabel="Monitors"
        modelType={Monitor}
        labelField="name"
        valueField="_id"
        enableLabelsTab={true}
        query={{ disableActiveMonitoring: false }}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox", { name: "Monitors" }));
    fireEvent.click(screen.getByRole("tab", { name: /Labels/ }));

    fireEvent.click(await screen.findByRole("option", { name: /^Prod$/ }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Add entries from/ }));
    await flush();

    const byLabel: Array<ListRequest> = requests().filter(
      (request: ListRequest) => {
        return (
          request.modelType === Monitor && Boolean(request.query["labels"])
        );
      },
    );

    expect(byLabel.length).toBeGreaterThan(0);

    for (const request of byLabel) {
      expect(request.query["disableActiveMonitoring"]).toBe(false);
    }
  });

  test("the Labels tab keeps the query's own condition on labels: a picked label is one more group", async () => {
    const callersLabel: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const pickedLabel: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    getListMock.mockImplementation((request: any) => {
      if (request?.modelType === Label) {
        return Promise.resolve({
          data: [{ _id: pickedLabel, name: "Prod" }],
          count: 1,
        });
      }

      return Promise.resolve({ data: [], count: 0 });
    });

    render(
      <EntityDropdown
        isMultiSelect={true}
        ariaLabel="Monitors"
        modelType={Monitor}
        labelField="name"
        valueField="_id"
        enableLabelsTab={true}
        query={{ labels: new Includes([callersLabel]) }}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox", { name: "Monitors" }));
    fireEvent.click(screen.getByRole("tab", { name: /Labels/ }));

    fireEvent.click(await screen.findByRole("option", { name: /^Prod$/ }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Add entries from/ }));
    await flush();

    const byLabel: Array<ListRequest> = requests().filter(
      (request: ListRequest) => {
        return (
          request.modelType === Monitor &&
          request.query["labels"] instanceof IncludesAnyOfGroups
        );
      },
    );

    expect(byLabel.length).toBeGreaterThan(0);

    for (const request of byLabel) {
      expect((request.query["labels"] as IncludesAnyOfGroups).groups).toEqual([
        [callersLabel],
        [pickedLabel],
      ]);
    }
  });

  test("with a condition on labels a label pick cannot be added to, there is no Labels tab", async () => {
    render(
      <EntityDropdown
        isMultiSelect={true}
        ariaLabel="Monitors"
        modelType={Monitor}
        labelField="name"
        valueField="_id"
        enableLabelsTab={true}
        query={{ labels: new NotNull() }}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox", { name: "Monitors" }));
    await flush();

    expect(screen.queryByRole("tab", { name: /Labels/ })).toBeNull();
  });
});
