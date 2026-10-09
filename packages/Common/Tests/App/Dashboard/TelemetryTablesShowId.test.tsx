import "@testing-library/jest-dom";
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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { SpyInstance } from "jest-mock";

/*
 * "Show ID" on every telemetry table in the Dashboard that offers it.
 *
 * Issue #4615: on AI / LLM > Overview, Show ID on a row of Recent LLM Calls
 * crashed the page with minified React error #31. Every one of these tables
 * is an AnalyticsModelTable over ClickHouse rows, whose `_id` is an ObjectID
 * rather than the string a database row holds, so every one of them crashed
 * the same way: the LLM calls (AI / LLM > Overview and Calls), the spans of
 * every Traces list, the profiles, and both exception tables.
 *
 * The REAL components are mounted, down through AnalyticsModelTable and
 * BaseModelTable to the dialog. Only the edges are stubbed: the HTTP layer
 * (answered like the server, so AnalyticsModelAPI really deserializes the
 * rows - see ListApiFake), the project, the viewer and translation.
 */

const getCurrentProjectIdMock: jest.Mock<() => unknown> =
  jest.fn<() => unknown>();

/*
 * Replaced whole rather than spied on: the real module loads the browser
 * telemetry SDK, whose zone.js swaps out the global Promise, and React then
 * reports every awaited act() as not awaited.
 */
jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return getCurrentProjectIdMock();
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectMember];
      },
      getProjectPermissions: (): {
        permissions: Array<{ permission: Permission }>;
      } => {
        return { permissions: [{ permission: Permission.ProjectMember }] };
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
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

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import LlmCallsTable from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmCallsTable";
import TraceTable from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceTable";
import ProfileTable from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileTable";
import ExceptionInstanceTable from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionInstanceTable";
import OccuranceTable from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/OccuranceTable";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import {
  fakeListApi,
  ListApiFake,
  serializedObjectId,
} from "../../Helpers/ListApiFake";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const TRACE_ID: string = "0af7651916cd43dd8448eb211c80319c";

const ROW_IDS: Array<string> = [
  "0199c9b2-4f7e-7a10-9f1e-1234567890ab",
  "0199c9b2-5a11-7b22-8c33-abcdefabcdef",
];

// Fields every analytics row the tables list carries.
function baseRow(id: string): JSONObject {
  return {
    _id: serializedObjectId(id),
    projectId: serializedObjectId(PROJECT_ID),
    primaryEntityId: serializedObjectId(SERVICE_ID),
  };
}

// LLM calls and spans: the same Span rows.
const SPAN_ROWS: Array<JSONObject> = ROW_IDS.map(
  (id: string, index: number): JSONObject => {
    return {
      ...baseRow(id),
      name: index === 0 ? "chat gpt-4o-mini" : "chat claude-sonnet",
      traceId: TRACE_ID,
      spanId: index === 0 ? "b7ad6b7169203331" : "00f067aa0ba902b7",
      startTime: "2026-10-09T17:00:00.000Z",
      statusCode: SpanStatus.Ok,
      isLlmSpan: true,
      llmSystem: "openai",
      llmRequestModel: index === 0 ? "gpt-4o-mini" : "claude-sonnet",
      llmOperation: "chat",
      llmInputTokens: 120,
      llmOutputTokens: 48,
      llmTotalTokens: 168,
      llmCost: 0.00042,
      llmUserEmail: "dev@example.com",
      llmTeam: "platform",
    };
  },
);

const PROFILE_ROWS: Array<JSONObject> = ROW_IDS.map(
  (id: string): JSONObject => {
    return {
      ...baseRow(id),
      profileId: "profile-" + id.slice(0, 8),
      profileType: "cpu",
      startTime: "2026-10-09T17:00:00.000Z",
      durationNano: 60000000000,
      sampleCount: 120,
    };
  },
);

const EXCEPTION_ROWS: Array<JSONObject> = ROW_IDS.map(
  (id: string, index: number): JSONObject => {
    return {
      ...baseRow(id),
      time: "2026-10-09T17:00:00.000Z",
      traceId: TRACE_ID,
      spanId: "b7ad6b7169203331",
      spanName: "POST /v1/chat/completions",
      spanStatusCode: SpanStatus.Error,
      exceptionType: "RateLimitError",
      message: index === 0 ? "rate limited" : "context too long",
      fingerprint: "9f86d081884c7d659a2feaa0c55ad015",
      release: "assistant@1.0.0",
      environment: "production",
    };
  },
);

let api: ListApiFake;
let consoleErrorSpy: SpyInstance<typeof console.error>;

// What React logs when it is handed an object as a child.
function reactChildErrors(): Array<string> {
  return consoleErrorSpy.mock.calls
    .map((call: Array<unknown>): string => {
      return call.map(String).join(" ");
    })
    .filter((message: string): boolean => {
      return message.includes("Objects are not valid as a React child");
    });
}

beforeEach(() => {
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {
    return undefined;
  });
  consoleErrorSpy = jest.spyOn(console, "error");
});

afterEach(() => {
  cleanup();
  api?.restore();
  jest.restoreAllMocks();
});

interface TableCase {
  name: string;
  // The page or pages it is on.
  where: string;
  element: React.ReactElement;
  listPath: string;
  rows: Array<JSONObject>;
  title: string;
}

const CASES: Array<TableCase> = [
  {
    name: "LlmCallsTable",
    where: "AI / LLM > Overview (Recent LLM Calls) and AI / LLM > Calls",
    element: (
      <LlmCallsTable
        title="Recent LLM Calls"
        description="The most recent LLM, agent and tool calls."
      />
    ),
    listPath: "/span/get-list",
    rows: SPAN_ROWS,
    title: "LLM Call ID",
  },
  {
    name: "TraceTable",
    where: "Traces, and every service, host and monitor Traces tab",
    element: <TraceTable disableUrlState={true} />,
    listPath: "/span/get-list",
    rows: SPAN_ROWS,
    title: "Span ID",
  },
  {
    name: "ProfileTable",
    where: "Profiles, and every Profiles tab",
    element: <ProfileTable />,
    listPath: "/profile/get-list",
    rows: PROFILE_ROWS,
    title: "Performance Profile ID",
  },
  {
    name: "ExceptionInstanceTable",
    where: "the exceptions of a service, an incident or an alert",
    element: (
      <ExceptionInstanceTable
        title="Exceptions"
        description="Exceptions recorded by this service."
        query={{}}
        disableUrlState={true}
      />
    ),
    listPath: "/exceptions/get-list",
    rows: EXCEPTION_ROWS,
    title: "Exception ID",
  },
  {
    name: "OccuranceTable",
    where: "an exception's Occurrences",
    element: (
      <OccuranceTable exceptionFingerprint="9f86d081884c7d659a2feaa0c55ad015" />
    ),
    listPath: "/exceptions/get-list",
    rows: EXCEPTION_ROWS,
    title: "Occurrence ID",
  },
];

async function mountTable(testCase: TableCase): Promise<Array<HTMLElement>> {
  api = fakeListApi({ [testCase.listPath]: testCase.rows });

  await act(async () => {
    render(<MemoryRouter>{testCase.element}</MemoryRouter>);
  });

  await waitFor(() => {
    expect(screen.queryAllByTestId("row-actions")).toHaveLength(
      testCase.rows.length,
    );
  });

  return screen.getAllByTestId("row-actions");
}

async function showIdOf(rowActions: HTMLElement): Promise<void> {
  fireEvent.click(within(rowActions).getByTestId("row-actions-more-button"));

  await act(async () => {
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Show ID",
      }),
    );
  });
}

describe("Show ID on the telemetry tables (issue #4615)", () => {
  describe.each(CASES)("$name - $where", (testCase: TableCase) => {
    test("lists its rows from the API, as the browser does", async () => {
      await mountTable(testCase);

      expect(
        api.requests.some((url: string): boolean => {
          return url.split("?")[0]!.endsWith(testCase.listPath);
        }),
      ).toBe(true);
    });

    test("opens the row's ID instead of crashing", async () => {
      const rows: Array<HTMLElement> = await mountTable(testCase);

      await showIdOf(rows[1]!);

      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        testCase.title,
      );
      expect(screen.getByTestId("record-id-value").textContent).toBe(
        ROW_IDS[1],
      );
      expect(screen.getByTestId("modal")).not.toHaveTextContent(
        "[object Object]",
      );
      expect(reactChildErrors()).toEqual([]);
      // The table is still on the page behind the dialog.
      expect(screen.getAllByTestId("row-actions")).toHaveLength(2);
    });

    test("copies the ID's text", async () => {
      const writeText: jest.Mock<(text: string) => Promise<void>> = jest.fn<
        (text: string) => Promise<void>
      >(async (): Promise<void> => {});
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      const rows: Array<HTMLElement> = await mountTable(testCase);

      await showIdOf(rows[0]!);

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Copy ID to clipboard" }),
        );
      });

      expect(writeText).toHaveBeenCalledWith(ROW_IDS[0]);
    });

    test("closes and shows another row's own ID", async () => {
      const rows: Array<HTMLElement> = await mountTable(testCase);

      await showIdOf(rows[0]!);
      expect(screen.getByTestId("record-id-value").textContent).toBe(
        ROW_IDS[0],
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("modal-footer-close-button"));
      });

      await waitFor(() => {
        expect(screen.queryByTestId("modal")).toBeNull();
      });

      await showIdOf(rows[1]!);
      expect(screen.getByTestId("record-id-value").textContent).toBe(
        ROW_IDS[1],
      );
    });
  });
});
