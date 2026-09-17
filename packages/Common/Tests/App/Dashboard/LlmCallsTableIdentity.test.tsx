import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * ---------------------------------------------------------------------------
 * The LLM calls table's employee columns and filters
 * ---------------------------------------------------------------------------
 *
 * "Which of our engineers spent this?" is the question this table exists to
 * answer, and everything that answers it is configuration passed as props:
 * the User column and its email→id fallback, the Team column, the three text
 * filters, and the llmUserId entry in selectMoreFields. Dropping any of them
 * type-checks and renders — the table simply stops answering the question, or
 * answers it with an empty cell for half the fleet.
 *
 * So the table itself is mocked to capture its props, and the captured
 * getElement closure is then rendered directly. That also keeps this test off
 * the network: the real AnalyticsModelTable fetches on mount.
 */

type CapturedColumn = {
  field: Record<string, boolean>;
  title: string;
  isHiddenByDefault?: boolean | undefined;
  getElement?: ((item: Span) => React.ReactElement) | undefined;
  getExportValue?: ((item: Span) => string) | undefined;
};

type CapturedFilter = {
  field: Record<string, boolean>;
  title: string;
  type: unknown;
};

type CapturedTableProps = {
  columns?: Array<CapturedColumn>;
  filters?: Array<CapturedFilter>;
  selectMoreFields?: Record<string, boolean>;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

/*
 * The table loads the project's telemetry services on mount purely to colour
 * the Service cell. Stubbed to an immediately-resolving empty list so no
 * request escapes and no act() warning follows the resolve.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

import LlmCallsTable from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmCallsTable";
import Span from "../../../Models/AnalyticsModels/Span";
import FieldType from "../../../UI/Components/Types/FieldType";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type ColumnByTitleFunction = (title: string) => CapturedColumn;

const columnByTitle: ColumnByTitleFunction = (
  title: string,
): CapturedColumn => {
  const column: CapturedColumn | undefined = capturedTableProps?.columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === title;
    },
  );

  expect(column).toBeDefined();

  return column!;
};

type FilterByTitleFunction = (title: string) => CapturedFilter;

const filterByTitle: FilterByTitleFunction = (
  title: string,
): CapturedFilter => {
  const filter: CapturedFilter | undefined = capturedTableProps?.filters?.find(
    (candidate: CapturedFilter): boolean => {
      return candidate.title === title;
    },
  );

  expect(filter).toBeDefined();

  return filter!;
};

type MakeSpanFunction = (data: {
  llmUserEmail?: string | undefined;
  llmUserId?: string | undefined;
  llmTeam?: string | undefined;
}) => Span;

const makeSpan: MakeSpanFunction = (data: {
  llmUserEmail?: string | undefined;
  llmUserId?: string | undefined;
  llmTeam?: string | undefined;
}): Span => {
  const span: Span = new Span();

  span.llmUserEmail = data.llmUserEmail;
  span.llmUserId = data.llmUserId;
  span.llmTeam = data.llmTeam;

  return span;
};

type RenderTableFunction = () => Promise<void>;

/*
 * Awaited inside act(): the component loads telemetry services on mount and
 * setStates when that promise resolves, so an un-awaited render leaves a
 * state update escaping the test.
 */
const renderTable: RenderTableFunction = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <LlmCallsTable />
      </MemoryRouter>,
    );
  });

  expect(capturedTableProps).not.toBeNull();
};

describe("LlmCallsTable — employee columns", () => {
  beforeEach(() => {
    capturedTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("User and Team are shown by default", async () => {
    await renderTable();

    expect(columnByTitle("User").isHiddenByDefault).toBeFalsy();
    expect(columnByTitle("Team").isHiddenByDefault).toBeFalsy();
    expect(columnByTitle("Team").field).toEqual({ llmTeam: true });
  });

  test("the two identity columns did not widen the default table", async () => {
    /*
     * Provider and Operation moved into the column picker to pay for User and
     * Team. Pinned because it is a deliberate trade rather than an accident:
     * un-hiding them without hiding something else silently pushes cost and
     * status off the side of a laptop screen.
     */
    await renderTable();

    expect(columnByTitle("Provider").isHiddenByDefault).toBe(true);
    expect(columnByTitle("Operation").isHiddenByDefault).toBe(true);

    const visibleTitles: Array<string> = (capturedTableProps?.columns || [])
      .filter((column: CapturedColumn): boolean => {
        return !column.isHiddenByDefault;
      })
      .map((column: CapturedColumn): string => {
        return column.title;
      });

    expect(visibleTitles).toEqual([
      "Seen At",
      "Service",
      "Model",
      "User",
      "Team",
      "Tokens (in / out)",
      "Cost",
      "Status",
    ]);
  });

  test("the User cell prefers the email", async () => {
    await renderTable();

    const column: CapturedColumn = columnByTitle("User");

    render(
      column.getElement!(
        makeSpan({ llmUserEmail: "ada@example.com", llmUserId: "acct-9f2" }),
      ),
    );

    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.queryByText("acct-9f2")).not.toBeInTheDocument();
  });

  test("the User cell falls back to the id when no email was reported", async () => {
    /*
     * The gateway population: LiteLLM stamps a key-owner id and no email. If
     * the fallback were dropped, this whole class of emitter would render an
     * empty User column while the table still filtered on it.
     */
    await renderTable();

    render(
      columnByTitle("User").getElement!(makeSpan({ llmUserId: "acct-9f2" })),
    );

    expect(screen.getByText("acct-9f2")).toBeInTheDocument();
  });

  test("the User cell reads as absent, not as a nameless person", async () => {
    await renderTable();

    // Whitespace is what an unset environment variable produces at the emitter.
    render(
      columnByTitle("User").getElement!(makeSpan({ llmUserEmail: "   " })),
    );

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test("the CSV export carries the same fallback the cell renders", async () => {
    /*
     * An Element column exports its declared field's raw value unless it says
     * otherwise, so without getExportValue the export would drop exactly the
     * rows whose identity came from the id.
     */
    await renderTable();

    const column: CapturedColumn = columnByTitle("User");

    expect(column.getExportValue!(makeSpan({ llmUserId: "acct-9f2" }))).toBe(
      "acct-9f2",
    );
    expect(
      column.getExportValue!(makeSpan({ llmUserEmail: "ada@example.com" })),
    ).toBe("ada@example.com");
    expect(column.getExportValue!(makeSpan({}))).toBe("");
  });

  test("llmUserId is selected even though no column declares it", async () => {
    /*
     * The User column declares llmUserEmail; the fallback reads a field
     * nothing else asks for, so it has to be requested explicitly.
     */
    await renderTable();

    expect(capturedTableProps?.selectMoreFields?.["llmUserId"]).toBe(true);
  });
});

describe("LlmCallsTable — employee filters", () => {
  beforeEach(() => {
    capturedTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("email, id and team are free-text filters", async () => {
    /*
     * Text rather than a dropdown: the set of people who have made an LLM
     * call is not a bounded list the page can fetch upfront, unlike services.
     */
    await renderTable();

    expect(filterByTitle("User Email").field).toEqual({ llmUserEmail: true });
    expect(filterByTitle("User Email").type).toBe(FieldType.Text);

    expect(filterByTitle("User ID").field).toEqual({ llmUserId: true });
    expect(filterByTitle("User ID").type).toBe(FieldType.Text);

    expect(filterByTitle("Team").field).toEqual({ llmTeam: true });
    expect(filterByTitle("Team").type).toBe(FieldType.Text);
  });

  test("email and id are separate filters, not one merged input", async () => {
    /*
     * A filter narrows ONE stored column and most emitters populate exactly
     * one of the two, so a single merged "User" input would silently return
     * nothing for whichever half of the fleet reports the other spelling.
     */
    await renderTable();

    expect(filterByTitle("User Email").field).not.toEqual(
      filterByTitle("User ID").field,
    );
  });
});
