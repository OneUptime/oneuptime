import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * `isLoading` used to start `false` and flip true inside the effect, which was
 * fine while custom field definitions only ever added optional table columns:
 * a column that appears late is just a column that appears late.
 *
 * The facet bar cannot read it that way. It restores its chips from the URL on
 * the very first render, and a chip whose definition has not arrived yet is
 * indistinguishable from a chip the user cleared — the difference being that
 * the second means "erase the shared link's filter". So the first render has
 * to be able to say "a request is coming", and these tests pin that.
 */

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so naming the mock directly would capture it before its
 * initializer has run.
 */
jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import useCustomFieldColumns, {
  CustomFieldColumnsResult,
} from "../../../../UI/Components/ModelTable/useCustomFieldColumns";
import { CustomFieldDefinition } from "../../../../UI/Components/ModelTable/CustomFieldColumns";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import ObjectID from "../../../../Types/ObjectID";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

interface Snapshot {
  isLoading: boolean;
  definitionNames: Array<string>;
  columnIds: Array<string>;
}

type HarnessPropsType = {
  customFieldsModelType?: { new (): BaseModel } | undefined;
  onRender: (snapshot: Snapshot) => void;
};

const Harness: React.FunctionComponent<HarnessPropsType> = (
  props: HarnessPropsType,
): React.ReactElement => {
  const result: CustomFieldColumnsResult<BaseModel> =
    useCustomFieldColumns<BaseModel>({
      customFieldsModelType: props.customFieldsModelType,
    });

  props.onRender({
    isLoading: result.isLoading,
    definitionNames: result.definitions.map((d: CustomFieldDefinition) => {
      return d.name;
    }),
    columnIds: result.columns.map((column: { id?: string | undefined }) => {
      return column.id || "";
    }),
  });

  return <div />;
};

type RenderHarnessFunction = (
  customFieldsModelType?: { new (): BaseModel } | undefined,
) => Array<Snapshot>;

const renderHarness: RenderHarnessFunction = (
  customFieldsModelType?: { new (): BaseModel } | undefined,
): Array<Snapshot> => {
  const snapshots: Array<Snapshot> = [];

  render(
    <Harness
      customFieldsModelType={customFieldsModelType}
      onRender={(snapshot: Snapshot) => {
        snapshots.push(snapshot);
      }}
    />,
  );

  return snapshots;
};

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
});

describe("useCustomFieldColumns — isLoading on the first render", () => {
  test("is true before the request has even been sent", () => {
    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
    getListMock.mockReturnValue(new Promise(() => {}));

    const snapshots: Array<Snapshot> = renderHarness(IncidentCustomField);

    expect(snapshots[0]!.isLoading).toBe(true);
  });

  test("is false when there is no definition model to load", () => {
    /*
     * Every table without custom fields renders this hook too. Reporting
     * "loading" there would make the facet bar hold its URL snapshot hostage
     * on pages that will never have a chip to wait for.
     */
    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));

    expect(renderHarness(undefined)[0]!.isLoading).toBe(false);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("is false when there is no current project", () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    expect(renderHarness(IncidentCustomField)[0]!.isLoading).toBe(false);
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("useCustomFieldColumns — settling", () => {
  test("goes false once the definitions land, and reports them sorted", () => {
    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
    getListMock.mockReturnValue(
      Promise.resolve({
        data: [
          { name: "Team", customFieldType: CustomFieldType.Text },
          { name: "Impacted Users", customFieldType: CustomFieldType.Number },
        ],
      }),
    );

    const snapshots: Array<Snapshot> = renderHarness(IncidentCustomField);

    return waitFor(() => {
      const last: Snapshot = snapshots[snapshots.length - 1]!;

      expect(last.isLoading).toBe(false);
      // Sorted, so a viewer's column layout does not shuffle between loads.
      expect(last.definitionNames).toEqual(["Impacted Users", "Team"]);
      expect(last.columnIds).toEqual([
        "customFields.Impacted Users",
        "customFields.Team",
      ]);
    });
  });

  test("goes false and yields nothing when the request fails", () => {
    /*
     * Custom fields are a paid feature the viewer may not be able to read, so
     * a failure here is expected in normal operation. It must settle rather
     * than leave every caller waiting forever.
     */
    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
    getListMock.mockReturnValue(Promise.reject(new Error("no permission")));

    const snapshots: Array<Snapshot> = renderHarness(IncidentCustomField);

    return waitFor(() => {
      const last: Snapshot = snapshots[snapshots.length - 1]!;

      expect(last.isLoading).toBe(false);
      expect(last.definitionNames).toEqual([]);
      expect(last.columnIds).toEqual([]);
    });
  });
});
