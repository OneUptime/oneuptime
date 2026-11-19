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
} from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import HostLogSession from "../../../Models/DatabaseModels/HostLogSession";
import {
  HOST_LOG_SESSION_ATTRIBUTE,
  HostLogSessionLevel,
  HostLogSessionStatus,
} from "../../../Types/Host/HostLogSession";
import ObjectID from "../../../Types/ObjectID";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  CANCELLED_MESSAGE,
  DEVICE_SILENT_WHILE_COLLECTING_MESSAGE,
  DEVICE_SILENT_WHILE_REQUESTED_MESSAGE,
  NOBODY_ALLOWED_MESSAGE,
} from "../../../Utils/Host/AndroidAgentLogSessions";

/*
 * Issue #9806 on an Android device's Logs page: its log sessions - every
 * app's logs for a while, allowed at the device - are asked for and
 * followed there, above the logs, and a session's lines can be shown on
 * their own. A server's Logs page is as it was.
 */

const HOST_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const SESSION_ID: string = "3f2a1b0c-0000-4000-8000-0000000000aa";

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        return new (
          jest.requireActual("../../../Types/ObjectID") as {
            default: typeof ObjectID;
          }
        ).default(HOST_ID);
      },
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

// The logs below, as what the page hands them.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: {
        logQuery?: { attributes?: Record<string, string> };
        noLogsMessage?: string;
        attributeFilterDisplayKeys?: Record<string, string>;
      }) => {
        return (
          <div data-testid="logs">
            <span data-testid="logs-query">
              {JSON.stringify(props.logQuery?.attributes || {})}
            </span>
            <span data-testid="logs-empty">{props.noLogsMessage}</span>
          </div>
        );
      },
    };
  },
);

// The sessions' list, as a stand-in that picks one.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostLogSessions",
  () => {
    return {
      __esModule: true,
      default: (props: { onShowLines: (session: HostLogSession) => void }) => {
        return (
          <button
            data-testid="log-sessions"
            onClick={() => {
              const Model: typeof HostLogSession = (
                jest.requireActual(
                  "../../../Models/DatabaseModels/HostLogSession",
                ) as { default: typeof HostLogSession }
              ).default;
              const session: HostLogSession = new Model();
              session._id = SESSION_ID;
              session.createdAt = new Date("2026-11-19T10:00:00.000Z");
              props.onShowLines(session);
            }}
          >
            Log Sessions
          </button>
        );
      },
    };
  },
);

import HostLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Logs";
import HostLogSessionText, {
  KNOWN_STATUS_MESSAGES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostLogSessionText";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

function host(osType: string): Record<string, unknown> {
  return {
    _id: HOST_ID,
    hostIdentifier: "store-0412-kiosk-02",
    name: "Store 0412 kiosk 2",
    osType: osType,
  };
}

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<HostLogs {...({} as PageComponentProps)} />);
  });
}

beforeEach(() => {
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("an Android device's Logs page", () => {
  test("asks for and follows its log sessions above the logs", async () => {
    getItemMock.mockResolvedValue(host("android") as never);
    await renderPage();

    expect(screen.getByTestId("log-sessions")).toBeInTheDocument();
    expect(screen.getByTestId("logs-empty").textContent).toContain(
      "OneUptime Android agent",
    );
  });

  test("shows a session's lines on their own, and all the logs again", async () => {
    getItemMock.mockResolvedValue(host("android") as never);
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByTestId("log-sessions"));
    });

    expect(
      JSON.parse(screen.getByTestId("logs-query").textContent || "{}"),
    ).toEqual({
      "resource.host.name": "store-0412-kiosk-02",
      [HOST_LOG_SESSION_ATTRIBUTE]: SESSION_ID,
    });
    expect(screen.getByTestId("logs-empty").textContent).toContain(
      "No lines from this log session yet.",
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Show All Logs"));
    });

    expect(
      JSON.parse(screen.getByTestId("logs-query").textContent || "{}"),
    ).toEqual({ "resource.host.name": "store-0412-kiosk-02" });
  });
});

describe("a server's Logs page", () => {
  test("is as it was: no log sessions, and the collector's hint", async () => {
    getItemMock.mockResolvedValue(host("linux") as never);
    await renderPage();

    expect(screen.queryByTestId("log-sessions")).toBeNull();
    expect(screen.getByTestId("logs-empty").textContent).toContain(
      "OTel collector",
    );
  });
});

describe("a log session in words", () => {
  const translator: ReturnType<typeof getGlobalTranslator> =
    getGlobalTranslator();

  function session(data: Partial<HostLogSession>): HostLogSession {
    const row: HostLogSession = new HostLogSession();
    Object.assign(row, data);
    return row;
  }

  test("every status has its words and a tone that says how it is going", () => {
    for (const status of Object.values(HostLogSessionStatus)) {
      expect(
        HostLogSessionText.getStatusLabel(translator, status).length,
      ).toBeGreaterThan(0);
    }
    expect(
      HostLogSessionText.getStatusTone(HostLogSessionStatus.Collecting),
    ).toBe(PillTone.Success);
    expect(
      HostLogSessionText.getStatusTone(HostLogSessionStatus.Declined),
    ).toBe(PillTone.Danger);
    expect(
      HostLogSessionText.getStatusTone(HostLogSessionStatus.AwaitingApproval),
    ).toBe(PillTone.Warning);
  });

  test("what happens next while it waits or runs", () => {
    expect(
      HostLogSessionText.getStatusDetail(
        translator,
        session({ status: HostLogSessionStatus.Requested }),
      ),
    ).toBe("The device picks it up the next time it checks, within a minute.");
    expect(
      HostLogSessionText.getStatusDetail(
        translator,
        session({
          status: HostLogSessionStatus.Collecting,
          endsAt: new Date("2026-11-19T10:30:00.000Z"),
        }),
      ),
    ).toMatch(/^Sending every app's logs until .+\.$/);
  });

  test("why it ended, in the agent's words", () => {
    expect(
      HostLogSessionText.getStatusDetail(
        translator,
        session({
          status: HostLogSessionStatus.Declined,
          statusMessage: "Declined on the device.",
        }),
      ),
    ).toBe("Declined on the device.");
    expect(
      HostLogSessionText.getStatusDetail(
        translator,
        session({
          status: HostLogSessionStatus.Ended,
          statusMessage: "A reason from a newer agent.",
        }),
      ),
    ).toBe("A reason from a newer agent.");
  });

  test("every reason the agent and OneUptime write is one the Dashboard translates", () => {
    const kotlin: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../../agents/AndroidAgent/app/src/main/java/com/oneuptime/androidagent/logsession/LogSessionManager.kt",
      ),
      "utf8",
    );
    const agentReasons: Array<string> = Array.from(
      kotlin.matchAll(/^\s+[A-Z_]+\("(.+)"\),$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!.replace(/\\'/g, "'");
    });

    expect(agentReasons.length).toBeGreaterThanOrEqual(10);
    for (const reason of [
      ...agentReasons,
      NOBODY_ALLOWED_MESSAGE,
      DEVICE_SILENT_WHILE_REQUESTED_MESSAGE,
      DEVICE_SILENT_WHILE_COLLECTING_MESSAGE,
      CANCELLED_MESSAGE,
    ]) {
      expect(KNOWN_STATUS_MESSAGES).toContain(reason);
    }
  });

  test("how long and at what level", () => {
    expect(
      withoutIsolateMarks(
        HostLogSessionText.getDurationLabel(translator, 15),
      ).replace(/\u00a0/g, " "),
    ).toBe("15 minutes");
    expect(
      withoutIsolateMarks(
        HostLogSessionText.getDurationLabel(translator, 60),
      ).replace(/\u00a0/g, " "),
    ).toBe("1 hour");
    expect(
      withoutIsolateMarks(
        HostLogSessionText.getDurationLabel(translator, 240),
      ).replace(/\u00a0/g, " "),
    ).toBe("4 hours");
    expect(
      HostLogSessionText.getLevelLabel(translator, HostLogSessionLevel.Debug),
    ).toBe("Debug and above");
    expect(
      HostLogSessionText.getDurationOptions(translator).map(
        (option: DropdownOption) => {
          return option.value;
        },
      ),
    ).toEqual([15, 30, 60, 120, 240]);
  });

  test("only a session that sent lines offers to show them", () => {
    expect(
      HostLogSessionText.hasLines(
        session({ status: HostLogSessionStatus.AwaitingApproval }),
      ),
    ).toBe(false);
    expect(
      HostLogSessionText.hasLines(
        session({
          status: HostLogSessionStatus.Ended,
          startedAt: new Date("2026-11-19T10:00:00.000Z"),
        }),
      ),
    ).toBe(true);
  });
});
