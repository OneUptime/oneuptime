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
import React from "react";

/*
 * A NEW RUNBOOK LANDS ON ITS STEPS.
 *
 * A runbook is created with no steps, and steps are what it runs. Creating
 * one used to leave the reader on the list, and the runbook's Overview then
 * offered Run Now over nothing to run. Now Create Runbook opens the new
 * runbook's Steps page, which asks for the first step - as a new workflow
 * opens on its Builder. Saving an edit stays where it is.
 *
 * The list's table is a stand-in that keeps what the page hands it; the
 * create callback is the page's own.
 */

let mockTableProps: Record<string, unknown> | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockTableProps = props;
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    return {
      __esModule: true,
      buildBooleanFacetQuery: (): unknown => {
        return {};
      },
      default: (): Record<string, unknown> => {
        return {
          getOwnersForResource: (): Array<unknown> => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: (): void => {},
          filterBar: null,
          emptyState: undefined,
          mergeFiltersIntoQuery: (query: unknown): unknown => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: (): void => {},
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: (): Record<string, unknown> => {
      return { rowActions: [], bulkActions: [], modals: null };
    },
  };
});

import Runbooks from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runbooks";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import ObjectID from "../../../Types/ObjectID";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "5b1f0a0e-1111-4c1e-9a1e-000000000001",
);
const RUNBOOK_ID: string = "2a000000-0000-4000-8000-0000000000a1";

type CreateSuccess = (item: Runbook, modalType?: ModalType) => Promise<Runbook>;

let navigateSpy: jest.SpyInstance;

beforeEach(() => {
  mockTableProps = null;
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  navigateSpy = getJestSpyOn(Navigation, "navigate").mockImplementation(
    (): void => {},
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function onCreateSuccess(): CreateSuccess {
  render(<Runbooks {...({} as unknown as PageComponentProps)} />);

  expect(mockTableProps).not.toBeNull();

  const callback: unknown = mockTableProps!["onCreateSuccess"];

  expect(typeof callback).toBe("function");

  return callback as CreateSuccess;
}

function created(): Runbook {
  const runbook: Runbook = new Runbook();
  runbook._id = RUNBOOK_ID;
  runbook.name = "Database failover";
  return runbook;
}

describe("Create Runbook", () => {
  test("opens the new runbook's Steps page", async () => {
    const runbook: Runbook = created();

    const handedBack: Runbook = await onCreateSuccess()(
      runbook,
      ModalType.Create,
    );

    expect(handedBack).toBe(runbook);
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID.toString()}/runbooks/${RUNBOOK_ID}/steps`,
    );
  });

  test("an edit saved from the list stays where it is", async () => {
    await onCreateSuccess()(created(), ModalType.Edit);

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("a row the server handed back without an id goes nowhere", async () => {
    await onCreateSuccess()(new Runbook(), ModalType.Create);

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("the create form still asks for a name and a description, the rest folded", () => {
    onCreateSuccess();

    const fields: Array<Record<string, unknown>> = mockTableProps![
      "formFields"
    ] as Array<Record<string, unknown>>;
    const shown: Array<string> = fields
      .filter((field: Record<string, unknown>): boolean => {
        return !field["collapsibleSection"];
      })
      .map((field: Record<string, unknown>): string => {
        return Object.keys(
          (field["field"] as Record<string, unknown>) || {},
        )[0]!;
      });

    expect(shown).toEqual(["name", "description"]);
  });
});
