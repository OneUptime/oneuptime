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
import { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import HostLogSession from "../../../Models/DatabaseModels/HostLogSession";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  HOST_LOG_SESSION_NOTE_MAX_LENGTH,
  HostLogSessionStatus,
} from "../../../Types/Host/HostLogSession";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

/*
 * A device's Log Sessions list (#9966): a request carries a note for the
 * person at the device, the note shows under who asked, and a session that
 * sent lines downloads them as a Logcat text file - through the server,
 * with the reader's permissions, saved under the name the server gives.
 */

const HOST_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const SESSION_ID: string = "3f2a1b0c-0000-4000-8000-0000000000aa";

const recordedTables: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", { "data-testid": "log-sessions" });
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new (
          jest.requireActual("../../../Types/ObjectID") as {
            default: typeof ObjectID;
          }
        ).default("3f2a1b0c-0000-4000-8000-000000000001");
      },
    },
  };
});

const apiGetMock: MockFunction = getJestMockFunction();

/*
 * The real client imports Confirm It's You (Reauthentication), which imports
 * this mock back while the real client is still loading: its
 * getFriendlyMessage is read when it is called, not while the mock is made.
 */
jest.mock("../../../UI/Utils/API/API", () => {
  const actual: { default: { getFriendlyMessage: (err: unknown) => string } } =
    jest.requireActual("../../../UI/Utils/API/API") as {
      default: { getFriendlyMessage: (err: unknown) => string };
    };
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>) => {
        return apiGetMock(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return actual.default.getFriendlyMessage(err);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "3f2a1b0c-0000-4000-8000-000000000001" };
      },
      updateById: jest.fn(),
    },
  };
});

const downloadFileMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    default: (...args: Array<unknown>) => {
      return downloadFileMock(...args);
    },
  };
});

import HostLogSessions from "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostLogSessions";
import downloadHostLogSessionLines, {
  readLinesAnswer,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostLogSessionDownload";

interface FormField {
  field: Record<string, unknown>;
  title: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  validation?: { maxLength?: number };
}

interface ActionButton {
  title: string;
  isVisible: (item: HostLogSession) => boolean;
  onClick: (
    item: HostLogSession,
    onComplete: () => void,
    onError: (error: Error) => void,
  ) => void;
}

interface Column {
  title: string;
  getElement?: (item: HostLogSession) => ReactElement;
  getExportValue?: (item: HostLogSession) => string;
}

function table(): Record<string, unknown> {
  expect(recordedTables.length).toBeGreaterThan(0);
  return recordedTables[recordedTables.length - 1]!;
}

function session(data: Partial<HostLogSession> = {}): HostLogSession {
  const row: HostLogSession = new HostLogSession();
  row._id = SESSION_ID;
  row.status = HostLogSessionStatus.Ended;
  Object.assign(row, data);
  return row;
}

async function renderList(): Promise<void> {
  await act(async () => {
    render(
      <HostLogSessions
        hostId={new ObjectID(HOST_ID)}
        onShowLines={() => {
          return undefined;
        }}
      />,
    );
  });
}

beforeEach(() => {
  recordedTables.length = 0;
  apiGetMock.mockReset();
  downloadFileMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("asking for a log session", () => {
  test("the form asks for a note last, optional, no longer than a note may be", async () => {
    await renderList();

    const fields: Array<FormField> = table()["formFields"] as Array<FormField>;

    expect(
      fields.map((field: FormField): string => {
        return field.title;
      }),
    ).toEqual(["Duration", "Lowest Level", "Note"]);

    const note: FormField = fields[2]!;
    expect(note.field).toEqual({ note: true });
    expect(note.required).toBe(false);
    expect(note.validation?.maxLength).toBe(HOST_LOG_SESSION_NOTE_MAX_LENGTH);
    expect(note.placeholder).toBe(
      "Checking why the payment app crashes after 6pm",
    );
    // A description is one short sentence (ShortDescriptionsGuard).
    expect(note.description!.length).toBeLessThanOrEqual(150);
    expect(note.description).toMatch(/\.$/);
  });

  test("the list reads each session's note", async () => {
    await renderList();

    expect(
      (table()["selectMoreFields"] as Record<string, unknown>)["note"],
    ).toBe(true);
  });
});

describe("a session's note in the list", () => {
  function requestedBy(): Column {
    return (table()["columns"] as Array<Column>).find((column: Column) => {
      return column.title === "Requested By";
    })!;
  }

  test("shows under who asked, as they wrote it", async () => {
    await renderList();
    const requester: User = new User();
    requester.name = new Name("Dana Reyes");

    render(
      requestedBy().getElement!(
        session({
          createdByUser: requester,
          note: "Checking why the payment app crashes after 6pm",
        }),
      ),
    );

    expect(screen.getByText("Dana Reyes")).toBeInTheDocument();
    expect(
      screen.getByText("Checking why the payment app crashes after 6pm"),
    ).toBeInTheDocument();
  });

  test("a session without a note shows only who asked, and the export is the name", async () => {
    await renderList();
    const requester: User = new User();
    requester.name = new Name("Dana Reyes");
    const row: HostLogSession = session({ createdByUser: requester });

    const { container } = render(requestedBy().getElement!(row));

    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(requestedBy().getExportValue!(row)).toBe("Dana Reyes");
  });
});

describe("Download Lines", () => {
  function download(): ActionButton {
    return (table()["actionButtons"] as Array<ActionButton>).find(
      (button: ActionButton) => {
        return button.title === "Download Lines";
      },
    )!;
  }

  test("is offered for a session that sent lines, and only then", async () => {
    await renderList();

    expect(download()).toBeDefined();
    expect(download().isVisible(session({ startedAt: new Date() }))).toBe(true);
    expect(
      download().isVisible(
        session({
          status: HostLogSessionStatus.Collecting,
          startedAt: new Date(),
        }),
      ),
    ).toBe(true);
    // Never allowed, so it never started: it has no lines.
    expect(download().isVisible(session())).toBe(false);
  });

  test("asks the server for the session's file and saves it under the server's name", async () => {
    apiGetMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          fileName: "store-0412-kiosk-02-log-session-2026-11-19-14-02.txt",
          content: "11-19 14:03:07.123   580  1029 I Kiosk   : line 0\n",
          lineCount: 1,
          isTruncated: false,
        },
        {},
      ),
    );
    await renderList();

    const done: MockFunction = getJestMockFunction();
    const failed: MockFunction = getJestMockFunction();

    await act(async () => {
      download().onClick(
        session({ startedAt: new Date() }),
        done as unknown as () => void,
        failed as unknown as (error: Error) => void,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const asked: { url: { toString: () => string }; headers: unknown } =
      apiGetMock.mock.calls[0]![0] as never;
    expect(asked.url.toString()).toContain(
      `/host-log-session/${SESSION_ID}/lines`,
    );
    expect(asked.headers).toEqual({
      tenantid: "3f2a1b0c-0000-4000-8000-000000000001",
    });
    expect(downloadFileMock).toHaveBeenCalledWith({
      content: "11-19 14:03:07.123   580  1029 I Kiosk   : line 0\n",
      filename: "store-0412-kiosk-02-log-session-2026-11-19-14-02.txt",
      mimeType: "text/plain;charset=utf-8;",
    });
    expect(done).toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  test("a refusal saves nothing and says why", async () => {
    apiGetMock.mockResolvedValue(
      new HTTPErrorResponse(
        422,
        { message: "You do not have permission to read Logs." },
        {},
      ),
    );

    await expect(
      downloadHostLogSessionLines(SESSION_ID),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
    expect(downloadFileMock).not.toHaveBeenCalled();
  });

  test("an answer read defensively: no file from an older server is an empty file with a name", () => {
    expect(readLinesAnswer(undefined)).toEqual({
      fileName: "log-session.txt",
      content: "",
      lineCount: 0,
      isTruncated: false,
    });
    expect(
      readLinesAnswer({
        fileName: "  kiosk-log-session.txt ",
        content: "x\n",
        lineCount: 100000,
        isTruncated: true,
      }),
    ).toEqual({
      fileName: "kiosk-log-session.txt",
      content: "x\n",
      lineCount: 100000,
      isTruncated: true,
    });
  });
});
