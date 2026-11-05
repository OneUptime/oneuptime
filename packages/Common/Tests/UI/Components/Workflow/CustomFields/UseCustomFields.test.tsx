/*
 * Issue #5942: reading a table's custom fields never gets in the builder's way.
 * Fields that cannot be read are simply not listed.
 */

jest.mock("../../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return { __esModule: true, default: { getList: jest.fn() } };
});

import { WorkflowCustomField } from "../../../../../UI/Components/Workflow/CustomFields/CustomFieldColumns";
import useCustomFields, {
  CustomFieldsState,
} from "../../../../../UI/Components/Workflow/CustomFields/UseCustomFields";
import "@testing-library/jest-dom";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, jest, test } from "@jest/globals";

const FIELD: WorkflowCustomField = { name: "Customer", options: [] };

type LoadMock = jest.Mock<
  (table: string) => Promise<Array<WorkflowCustomField>>
>;

type LoadOfFunction = (result: Array<WorkflowCustomField>) => LoadMock;

const loadOf: LoadOfFunction = (
  result: Array<WorkflowCustomField>,
): LoadMock => {
  return jest.fn(async () => {
    return result;
  }) as unknown as LoadMock;
};

describe("useCustomFields", () => {
  test("is loading until they arrive, then lists them", async () => {
    const load: LoadMock = loadOf([FIELD]);

    const { result } = renderHook(() => {
      return useCustomFields("Incident", load);
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.fields).toEqual([]);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.fields).toEqual([FIELD]);
    expect(load).toHaveBeenCalledWith("Incident");
  });

  test("does not wait for, or ask about, a table with none", () => {
    const load: LoadMock = loadOf([FIELD]);

    const { result } = renderHook(() => {
      return useCustomFields("Label", load);
    });

    expect(result.current).toEqual({ fields: [], isLoading: false });
    expect(load).not.toHaveBeenCalled();
  });

  test("does not wait for no table at all", () => {
    const load: LoadMock = loadOf([FIELD]);

    const { result } = renderHook(() => {
      return useCustomFields(undefined, load);
    });

    expect(result.current).toEqual({ fields: [], isLoading: false });
    expect(load).not.toHaveBeenCalled();
  });

  test("what cannot be read is not listed, and is no error", async () => {
    const load: LoadMock = jest.fn(async () => {
      throw new Error("Not on this plan");
    }) as unknown as LoadMock;

    const { result } = renderHook(() => {
      return useCustomFields("Incident", load);
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.fields).toEqual([]);
  });

  test("reads once per table, not once per render", async () => {
    const load: LoadMock = loadOf([FIELD]);

    const { result, rerender } = renderHook(() => {
      return useCustomFields("Incident", load);
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    rerender();
    rerender();

    expect(load).toHaveBeenCalledTimes(1);
  });

  test("a table's answer that arrives after another was asked for is dropped", async () => {
    let answerIncident: (fields: Array<WorkflowCustomField>) => void = () => {};

    const load: LoadMock = jest.fn((table: string) => {
      if (table === "Incident") {
        return new Promise<Array<WorkflowCustomField>>(
          (resolve: (fields: Array<WorkflowCustomField>) => void) => {
            answerIncident = resolve;
          },
        );
      }

      return Promise.resolve([{ name: "Alert Field", options: [] }]);
    }) as unknown as LoadMock;

    const { result, rerender } = renderHook(
      (props: { table: string }): CustomFieldsState => {
        return useCustomFields(props.table, load);
      },
      { initialProps: { table: "Incident" } },
    );

    rerender({ table: "Alert" });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    answerIncident([FIELD]);
    await Promise.resolve();

    expect(result.current.fields).toEqual([
      { name: "Alert Field", options: [] },
    ]);
  });
});
