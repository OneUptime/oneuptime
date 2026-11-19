/*
 * PasswordHash carries a TS diagnostic that fails any suite whose require
 * graph reaches it (see HostServiceUpdateLastSeen.test.ts): replaced with a
 * factory, as there.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import HostLogSessionLines, {
  LOG_SESSION_CLOCK_SLACK_MINUTES,
  LOG_SESSION_LINES_PAGE_SIZE,
  NO_LINES_MESSAGE,
  SESSION_NOT_FOUND_MESSAGE,
} from "../../../../Server/Utils/Host/HostLogSessionLines";
import HostLogSessionService from "../../../../Server/Services/HostLogSessionService";
import LogService from "../../../../Server/Services/LogService";
import Host from "../../../../Models/DatabaseModels/Host";
import HostLogSession from "../../../../Models/DatabaseModels/HostLogSession";
import User from "../../../../Models/DatabaseModels/User";
import Log from "../../../../Models/AnalyticsModels/Log";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import {
  HOST_LOG_SESSION_ATTRIBUTE,
  HostLogSessionLevel,
} from "../../../../Types/Host/HostLogSession";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { HostLogSessionFile } from "../../../../Utils/Host/HostLogSessionFile";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Download Lines (#9966): a log session's lines as a file, read as viewing
 * them is - the session with the reader's permissions, its lines as Logs
 * reads them, with the reader's permissions too - in pages, the oldest
 * first, and no more than a file holds.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SESSION_ID: ObjectID = ObjectID.generate();

const READER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

let session: HostLogSession | null = null;
let lines: Array<Log> = [];
let findBy: jest.Mock<(...args: Array<unknown>) => Promise<Array<Log>>>;
let countBy: jest.Mock<(...args: Array<unknown>) => Promise<PositiveNumber>>;
let findOneById: jest.Mock<
  (...args: Array<unknown>) => Promise<HostLogSession | null>
>;

function aSession(data: Partial<HostLogSession> = {}): HostLogSession {
  const row: HostLogSession = new HostLogSession();
  row._id = SESSION_ID.toString();
  row.projectId = PROJECT_ID;
  row.createdAt = new Date("2026-11-19T14:02:41.000Z");
  row.startedAt = new Date("2026-11-19T14:03:00.000Z");
  row.endsAt = new Date("2026-11-19T14:33:00.000Z");
  row.endedAt = new Date("2026-11-19T14:33:05.000Z");
  row.minimumLevel = HostLogSessionLevel.Info;
  row.note = "Checking why the payment app crashes after 6pm";

  const host: Host = new Host();
  host.name = "Front kiosk";
  host.hostIdentifier = "store-0412-kiosk-02";
  row.host = host;

  const requester: User = new User();
  requester.name = new Name("Dana Reyes");
  row.createdByUser = requester;

  Object.assign(row, data);
  return row;
}

function aLine(index: number): Log {
  const log: Log = new Log();
  log.time = new Date(Date.UTC(2026, 10, 19, 14, 3, 7, 0) + index);
  log.severityNumber = 9;
  log.body = `line ${index}`;
  log.attributes = {
    "android.log.tag": "Kiosk",
    "process.pid": 100,
    "thread.id": 101,
  };
  return log;
}

beforeEach(() => {
  session = aSession();
  lines = [];

  findOneById = jest.fn(async () => {
    return session;
  });
  findBy = jest.fn(async (...args: Array<unknown>) => {
    const { skip, limit } = args[0] as { skip: number; limit: number };
    return lines.slice(skip, skip + limit);
  });
  countBy = jest.fn(async () => {
    return new PositiveNumber(lines.length);
  });

  jest
    .spyOn(HostLogSessionService, "findOneById")
    .mockImplementation(findOneById as never);
  jest.spyOn(LogService, "findBy").mockImplementation(findBy as never);
  jest.spyOn(LogService, "countBy").mockImplementation(countBy as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function download(): Promise<HostLogSessionFile> {
  return await HostLogSessionLines.getFile({
    sessionId: SESSION_ID,
    props: READER,
  });
}

describe("who may download a session's lines", () => {
  test("the session is read with the reader's own permissions, with its device", async () => {
    await download();

    const asked: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = findOneById.mock.calls[0]![0] as never;

    expect(asked.id).toBe(SESSION_ID);
    expect(asked.props).toBe(READER);
    expect(asked.select["host"]).toEqual({ name: true, hostIdentifier: true });
  });

  test("its lines are read with the reader's own permissions, as Logs reads them", async () => {
    lines = [aLine(0)];

    await download();

    for (const call of findBy.mock.calls) {
      expect((call[0] as { props: unknown }).props).toBe(READER);
    }
  });

  test("a session the reader cannot see is not found, and no line is read", async () => {
    session = null;

    await expect(download()).rejects.toThrow(NotFoundException);
    await expect(download()).rejects.toThrow(SESSION_NOT_FOUND_MESSAGE);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("a reader who may not read logs is refused, as Logs refuses them", async () => {
    findBy.mockImplementation(async () => {
      throw new NotAuthorizedException(
        "You do not have permission to read Logs.",
      );
    });

    await expect(download()).rejects.toThrow(NotAuthorizedException);
  });
});

describe("which lines", () => {
  test("the device's lines tagged with the session, the oldest first, from a day before it was asked for to a day after it ended", async () => {
    await download();

    const asked: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    } = findBy.mock.calls[0]![0] as never;

    expect(asked.query["projectId"]!.toString()).toBe(PROJECT_ID.toString());
    expect(asked.query["attributes"]).toEqual({
      "resource.host.name": "store-0412-kiosk-02",
      [HOST_LOG_SESSION_ATTRIBUTE]: SESSION_ID.toString(),
    });

    const time: InBetween<Date> = asked.query["time"] as InBetween<Date>;
    const slack: number = LOG_SESSION_CLOCK_SLACK_MINUTES * 60 * 1000;
    expect(time.startValue.getTime()).toBe(
      session!.createdAt!.getTime() - slack,
    );
    expect(time.endValue.getTime()).toBe(session!.endedAt!.getTime() + slack);

    expect(asked.sort).toEqual({ time: SortOrder.Ascending });
    expect(asked.select).toEqual({
      time: true,
      severityText: true,
      severityNumber: true,
      body: true,
      attributes: true,
    });
  });

  test("while it runs, its lines so far: up to a day past the end it was given", async () => {
    session = aSession({ endedAt: undefined });

    await download();

    const time: InBetween<Date> = (
      findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query["time"] as InBetween<Date>;
    expect(time.endValue.getTime()).toBe(
      session!.endsAt!.getTime() + LOG_SESSION_CLOCK_SLACK_MINUTES * 60 * 1000,
    );
  });

  test("a session nobody allowed has no lines, and says so", async () => {
    session = aSession({ startedAt: undefined });

    await expect(download()).rejects.toThrow(NO_LINES_MESSAGE);
    expect(findBy).not.toHaveBeenCalled();
  });
});

describe("the file", () => {
  test("holds the session's lines as logcat -v threadtime, under what the session is", async () => {
    lines = [aLine(0), aLine(1)];

    const file: HostLogSessionFile = await download();

    expect(file.content.split("\n")).toEqual([
      `--------- OneUptime log session ${SESSION_ID.toString()} on Front kiosk, requested by Dana Reyes on 2026-11-19 14:02 UTC`,
      "--------- Note: Checking why the payment app crashes after 6pm",
      "--------- Info and above, as logcat -v threadtime, times in UTC",
      "11-19 14:03:07.000   100   101 I Kiosk   : line 0",
      "11-19 14:03:07.001   100   101 I Kiosk   : line 1",
      "",
    ]);
    expect(file.fileName).toBe("Front-kiosk-log-session-2026-11-19-14-02.txt");
    expect(file.lineCount).toBe(2);
    expect(file.isTruncated).toBe(false);
    // Whole: nothing is counted.
    expect(countBy).not.toHaveBeenCalled();
  });

  test("is read a page at a time, until a page comes back short", async () => {
    lines = Array.from(
      { length: LOG_SESSION_LINES_PAGE_SIZE * 2 + 3 },
      (_value: unknown, index: number): Log => {
        return aLine(index);
      },
    );

    const file: HostLogSessionFile = await download();

    expect(
      findBy.mock.calls.map((call: Array<unknown>): number => {
        return (call[0] as { skip: number }).skip;
      }),
    ).toEqual([
      0,
      LOG_SESSION_LINES_PAGE_SIZE,
      LOG_SESSION_LINES_PAGE_SIZE * 2,
    ]);
    expect(file.lineCount).toBe(LOG_SESSION_LINES_PAGE_SIZE * 2 + 3);
    expect(file.isTruncated).toBe(false);
  });

  test("stops reading once it is full, and says how many lines the session has", async () => {
    lines = Array.from(
      { length: 100_020 },
      (_value: unknown, index: number): Log => {
        return aLine(index);
      },
    );

    const file: HostLogSessionFile = await download();

    expect(file.lineCount).toBe(100_000);
    expect(file.isTruncated).toBe(true);
    expect(findBy.mock.calls.length).toBeLessThanOrEqual(
      Math.ceil(100_000 / LOG_SESSION_LINES_PAGE_SIZE) + 1,
    );
    expect((countBy.mock.calls[0]![0] as { props: unknown }).props).toBe(
      READER,
    );
    expect(file.content.trimEnd().split("\n").pop()).toBe(
      "--------- OneUptime: the first 100000 lines of 100020. A file holds at most 100000 lines and 32 MB; read the rest in Logs.",
    );
  });
});
