import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ExceptionActivity from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionActivity";
import {
  EXCEPTION_ACTIVITY_FOLDED_COUNT,
  getExceptionActivityLine,
  getExceptionActivityLines,
  getRelatedExceptionName,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionActivityPresentation";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryExceptionActivity, {
  TelemetryExceptionActivityType,
} from "../../../Models/DatabaseModels/TelemetryExceptionActivity";
import Team from "../../../Models/DatabaseModels/Team";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

/*
 * AN EXCEPTION'S ACTIVITY, ON ITS OVERVIEW.
 *
 * One sentence per entry, newest first: who did it - a person, an API key,
 * or OneUptime - and what, with the person, team, release or other
 * exception it names; the newest few shown and the rest folded; and, once
 * everything shows, when the exception was first seen.
 */

interface ListArgs {
  query: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
}

const getListMock: Mock<(args: ListArgs) => Promise<unknown>> =
  jest.fn<(args: ListArgs) => Promise<unknown>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (args: ListArgs): Promise<unknown> => {
        return getListMock(args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : String(error);
      },
    },
  };
});

const EXCEPTION_ID: string = "50000000-0000-4000-8000-000000000001";
const OTHER_ID: string = "50000000-0000-4000-8000-000000000002";

let entrySequence: number = 0;

function person(name: string | null, email: string): User {
  const user: User = new User();
  user._id = ObjectID.generate().toString();
  if (name) {
    user.name = new Name(name);
  }
  user.email = new Email(email);
  return user;
}

function team(name: string): Team {
  const model: Team = new Team();
  model._id = ObjectID.generate().toString();
  model.name = name;
  return model;
}

function relatedException(
  exceptionType: string,
  message: string,
): TelemetryException {
  const model: TelemetryException = new TelemetryException();
  model._id = OTHER_ID;
  model.exceptionType = exceptionType;
  model.message = message;
  return model;
}

function entry(
  activityType: TelemetryExceptionActivityType | string,
  overrides: Partial<TelemetryExceptionActivity> = {},
): TelemetryExceptionActivity {
  entrySequence++;
  const model: TelemetryExceptionActivity = new TelemetryExceptionActivity();
  model._id = `60000000-0000-4000-8000-${String(entrySequence).padStart(12, "0")}`;
  model.activityType = activityType as TelemetryExceptionActivityType;
  model.createdAt = new Date(Date.now() - (100 - entrySequence) * 60 * 1000);
  Object.assign(model, overrides);
  return model;
}

function exception(): TelemetryException {
  const model: TelemetryException = new TelemetryException();
  model._id = EXCEPTION_ID;
  model.firstSeenAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  model.firstSeenInRelease = "1.0.0";
  return model;
}

function renderActivity(
  entries: Array<TelemetryExceptionActivity>,
  refreshKey: string = "0",
): ReturnType<typeof render> {
  getListMock.mockResolvedValue({ data: entries, count: entries.length });

  return render(
    <MemoryRouter>
      <ExceptionActivity
        exception={exception()}
        telemetryExceptionId={new ObjectID(EXCEPTION_ID)}
        refreshKey={refreshKey}
      />
    </MemoryRouter>,
  );
}

async function sentences(): Promise<Array<string>> {
  await waitFor(() => {
    expect(screen.getByTestId("exception-activity-list")).toBeInTheDocument();
  });

  return screen
    .queryAllByTestId("exception-activity-entry")
    .map((element: HTMLElement): string => {
      return (element.querySelector("p")?.textContent || "").trim();
    });
}

beforeEach(() => {
  entrySequence = 0;
  getListMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("each kind of entry, as a sentence", () => {
  test("triage by a person, an API key and OneUptime", async () => {
    renderActivity([
      entry(TelemetryExceptionActivityType.Resolved, {
        user: person("Priya Raman", "priya@example.com"),
      }),
      entry(TelemetryExceptionActivityType.ResolvedInNextRelease, {
        user: person(null, "alex@example.com"),
        release: "2.4.0",
      }),
      entry(TelemetryExceptionActivityType.Reopened, {
        apiKeyName: "Deploy pipeline",
      }),
      entry(TelemetryExceptionActivityType.Regressed, { release: "2.4.1" }),
      entry(TelemetryExceptionActivityType.Archived),
    ]);

    expect(await sentences()).toEqual([
      "OneUptime archived this exception",
      "It came back in 2.4.1, after it was resolved",
      "Deploy pipeline (API key) reopened this exception",
      "alex@example.com resolved this exception in the next release, after 2.4.0",
      "Priya Raman resolved this exception",
    ]);
  });

  test("a regression without a release, and unarchiving", async () => {
    renderActivity([
      entry(TelemetryExceptionActivityType.Regressed),
      entry(TelemetryExceptionActivityType.Unarchived, {
        user: person("Priya Raman", "priya@example.com"),
      }),
    ]);

    expect(await sentences()).toEqual([
      "Priya Raman unarchived this exception",
      "It came back after it was resolved",
    ]);
  });

  test("assignments name the person or the team; one no longer there is someone", async () => {
    renderActivity([
      entry(TelemetryExceptionActivityType.Assigned, {
        user: person("Priya Raman", "priya@example.com"),
        assigneeTeam: team("Platform"),
      }),
      entry(TelemetryExceptionActivityType.Assigned, {
        user: person("Priya Raman", "priya@example.com"),
        assigneeUser: person("Alex Kim", "alex@example.com"),
      }),
      entry(TelemetryExceptionActivityType.Unassigned, {
        user: person("Alex Kim", "alex@example.com"),
      }),
    ]);

    expect(await sentences()).toEqual([
      "Alex Kim unassigned this exception from someone",
      "Priya Raman assigned this exception to Alex Kim",
      "Priya Raman assigned this exception to Platform",
    ]);
  });

  test("merges link the other exception; one deleted since is another exception", async () => {
    renderActivity([
      entry(TelemetryExceptionActivityType.Merged, {
        user: person("Priya Raman", "priya@example.com"),
        relatedTelemetryExceptionId: new ObjectID(OTHER_ID),
        relatedTelemetryException: relatedException(
          "TypeError",
          "x is undefined\n    at checkout",
        ),
      }),
      entry(TelemetryExceptionActivityType.MergedInto, {
        user: person("Priya Raman", "priya@example.com"),
        relatedTelemetryExceptionId: new ObjectID(OTHER_ID),
        relatedTelemetryException: relatedException("RangeError", "too far"),
      }),
      entry(TelemetryExceptionActivityType.Unmerged, {
        user: person("Alex Kim", "alex@example.com"),
      }),
      entry(TelemetryExceptionActivityType.UnmergedFrom, {
        user: person("Alex Kim", "alex@example.com"),
        relatedTelemetryExceptionId: new ObjectID(OTHER_ID),
      }),
    ]);

    expect(await sentences()).toEqual([
      "Alex Kim unmerged this exception from another exception",
      "Alex Kim unmerged another exception from this exception",
      "Priya Raman merged this exception into RangeError: too far",
      "Priya Raman merged TypeError: x is undefined into this exception",
    ]);

    const links: Array<HTMLElement> = screen.getAllByTestId(
      "exception-activity-related",
    );
    expect(links.length).toBe(3);
    expect(links[0]!.getAttribute("href")).toContain(OTHER_ID);
  });

  test("an entry of a kind this Dashboard does not know is left out", async () => {
    renderActivity([
      entry("SomethingNewer"),
      entry(TelemetryExceptionActivityType.Resolved),
    ]);

    expect(await sentences()).toEqual(["OneUptime resolved this exception"]);
  });
});

describe("the timeline", () => {
  test("reads its own exception's activity, newest first", async () => {
    renderActivity([]);

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    const args: ListArgs = getListMock.mock.calls[0]![0];
    expect(args.query["telemetryExceptionId"]?.toString()).toBe(EXCEPTION_ID);
    expect(args.sort).toEqual({ createdAt: SortOrder.Descending });
  });

  test("with nothing recorded yet, it says when the exception was first seen, and in which release", async () => {
    renderActivity([]);

    expect(await sentences()).toEqual([]);
    expect(
      screen.getByTestId("exception-activity-first-seen").textContent,
    ).toContain("First seen in 1.0.0");
  });

  test(`the newest ${EXCEPTION_ACTIVITY_FOLDED_COUNT} show; the rest unfold, and fold again`, async () => {
    const entries: Array<TelemetryExceptionActivity> = [];

    for (let index: number = 0; index < 7; index++) {
      entries.push(
        entry(
          index % 2 === 0
            ? TelemetryExceptionActivityType.Resolved
            : TelemetryExceptionActivityType.Reopened,
        ),
      );
    }

    renderActivity(entries);

    expect(await sentences()).toHaveLength(EXCEPTION_ACTIVITY_FOLDED_COUNT);
    // First seen is the oldest line: it shows once everything does.
    expect(
      screen.queryByTestId("exception-activity-first-seen"),
    ).not.toBeInTheDocument();

    const toggle: HTMLElement = screen.getByTestId("exception-activity-toggle");
    expect(toggle.textContent).toBe("Show 2 older entries");
    fireEvent.click(toggle);

    expect(await sentences()).toHaveLength(7);
    expect(
      screen.getByTestId("exception-activity-first-seen"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("exception-activity-toggle"));
    expect(await sentences()).toHaveLength(EXCEPTION_ACTIVITY_FOLDED_COUNT);
  });

  test("one older entry is one entry", async () => {
    const entries: Array<TelemetryExceptionActivity> = [];

    for (let index: number = 0; index < 6; index++) {
      entries.push(entry(TelemetryExceptionActivityType.Archived));
    }

    renderActivity(entries);
    await sentences();

    expect(screen.getByTestId("exception-activity-toggle").textContent).toBe(
      "Show 1 older entry",
    );
  });

  test("a read that fails says so, in the card", async () => {
    getListMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Could not reach the server");
    });

    render(
      <MemoryRouter>
        <ExceptionActivity
          exception={exception()}
          telemetryExceptionId={new ObjectID(EXCEPTION_ID)}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("exception-activity-error")).toHaveTextContent(
        "Could not reach the server",
      );
    });
  });

  test("a new refresh key - a change made on the page - reads it again", async () => {
    const view: ReturnType<typeof render> = renderActivity([]);
    await sentences();
    expect(getListMock).toHaveBeenCalledTimes(1);

    getListMock.mockResolvedValue({
      data: [
        entry(TelemetryExceptionActivityType.Resolved, {
          user: person("Priya Raman", "priya@example.com"),
        }),
      ],
      count: 1,
    });

    view.rerender(
      <MemoryRouter>
        <ExceptionActivity
          exception={exception()}
          telemetryExceptionId={new ObjectID(EXCEPTION_ID)}
          refreshKey="1"
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(async () => {
      expect(await sentences()).toEqual(["Priya Raman resolved this exception"]);
    });
  });
});

describe("the lines, apart from the card", () => {
  test("newest first, whatever order they arrive in", () => {
    const older: TelemetryExceptionActivity = entry(
      TelemetryExceptionActivityType.Resolved,
    );
    const newer: TelemetryExceptionActivity = entry(
      TelemetryExceptionActivityType.Reopened,
    );

    expect(
      getExceptionActivityLines([older, newer]).map((line) => {
        return line.activityType;
      }),
    ).toEqual([
      TelemetryExceptionActivityType.Reopened,
      TelemetryExceptionActivityType.Resolved,
    ]);
  });

  test("another exception's name: its type and its message's first line, cut to a line's length", () => {
    expect(
      getRelatedExceptionName(relatedException("TypeError", "x\n  at y")),
    ).toBe("TypeError: x");
    expect(getRelatedExceptionName(relatedException("", ""))).toBeNull();

    const long: string | null = getRelatedExceptionName(
      relatedException("Error", "a".repeat(5000)),
    );
    expect(long!.length).toBe(120);
    expect(long!.endsWith("…")).toBe(true);
  });

  test("an actor: the person's name, else their email, else the API key; else OneUptime", () => {
    expect(
      getExceptionActivityLine(
        entry(TelemetryExceptionActivityType.Resolved, {
          user: person("Priya Raman", "priya@example.com"),
          apiKeyName: "ignored",
        }),
      )!.actor,
    ).toEqual({ name: "Priya Raman", isApiKey: false });

    expect(
      getExceptionActivityLine(
        entry(TelemetryExceptionActivityType.Resolved, {
          apiKeyName: "Deploy pipeline",
        }),
      )!.actor,
    ).toEqual({ name: "Deploy pipeline", isApiKey: true });

    expect(
      getExceptionActivityLine(entry(TelemetryExceptionActivityType.Resolved))!
        .actor,
    ).toEqual({ name: null, isApiKey: false });
  });
});
