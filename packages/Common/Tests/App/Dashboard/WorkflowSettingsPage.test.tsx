import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A workflow's Settings page, after the webhook secret key moved out of it.
 *
 * The maintainer's question was whether the key belonged in the Webhook
 * component rather than in workflow settings. It now lives with the Webhook
 * trigger (WebhookTriggerPanel); this page keeps what applies to the workflow
 * as a whole - Duplicate, Export and Archive - and no longer loads the
 * workflow's graph to decide whether to show a webhook card. The only read it
 * makes is the Archive card's, of `isArchived`.
 */

const mockGetItem: MockFunction = getJestMockFunction();
const mockUpdateById: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return mockUpdateById(...args);
      },
    },
  };
});

let mockDuplicateProps: Record<string, unknown> | null = null;

jest.mock("../../../UI/Components/DuplicateModel/DuplicateModel", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): React.ReactElement => {
      mockDuplicateProps = props;

      return <div data-testid="duplicate-workflow">Duplicate Workflow</div>;
    },
  };
});

jest.mock("../../../UI/Components/ImportExport/ExportModelCard", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="export-workflow">Export Workflow</div>;
    },
  };
});

import Settings from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Settings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Permission from "../../../Types/Permission";
import { WORKFLOW_ARCHIVE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ResourceArchiveCopy";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161002",
);

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/workflows/settings"),
  currentProject: null,
  hasPaymentMethod: false,
};

beforeEach(() => {
  mockGetItem.mockReset();
  mockUpdateById.mockReset();
  mockDuplicateProps = null;
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("workflow Settings", () => {
  test("has no webhook secret key card: no key, no reveal, no reset", () => {
    const { container } = render(<Settings {...PAGE_PROPS} />);

    expect(container).not.toHaveTextContent(/webhook/i);
    expect(container).not.toHaveTextContent(/secret/i);
    expect(screen.queryByText("Click to reveal")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reset/i }),
    ).not.toBeInTheDocument();
  });

  test("keeps Duplicate and Export, in that order", () => {
    render(<Settings {...PAGE_PROPS} />);

    const duplicate: HTMLElement = screen.getByTestId("duplicate-workflow");
    const exportCard: HTMLElement = screen.getByTestId("export-workflow");

    expect(
      duplicate.compareDocumentPosition(exportCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(mockDuplicateProps?.["modelId"]).toBe(WORKFLOW_ID);
  });

  test("reads only isArchived, which every workflow reader may read, so a Viewer gets no failing request", () => {
    mockGetItem.mockReturnValue(new Promise<never>(() => {}));

    render(<Settings {...PAGE_PROPS} />);

    // The Archive card's read, and nothing else: no graph, no secret key.
    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(
      (mockGetItem.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select,
    ).toEqual({ isArchived: true });
    expect(
      new Workflow().getColumnAccessControlFor("isArchived")?.read,
    ).toEqual(
      expect.arrayContaining([Permission.Viewer, Permission.ReadWorkflow]),
    );
    expect(mockUpdateById).not.toHaveBeenCalled();
  });

  test("ends with the Archive card, after Duplicate and Export", async () => {
    mockGetItem.mockResolvedValue({ isArchived: false });

    render(<Settings {...PAGE_PROPS} />);

    const archiveTitle: HTMLElement =
      await screen.findByText("Archive workflow");

    expect(
      screen
        .getByTestId("export-workflow")
        .compareDocumentPosition(archiveTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Says what archiving a workflow does, not the telemetry default.
    expect(
      screen.getByText(WORKFLOW_ARCHIVE_COPY.archiveCardDescription),
    ).toBeInTheDocument();
    expect(screen.queryByText(/telemetry/i)).toBeNull();
  });

  test("a duplicate is given a key of its own by the server, never a copy of this one", () => {
    render(<Settings {...PAGE_PROPS} />);

    expect(
      Object.keys(
        (mockDuplicateProps?.["fieldsToDuplicate"] as Record<
          string,
          unknown
        >) || {},
      ).sort(),
    ).toEqual(["description", "graph", "labels"]);
  });
});
