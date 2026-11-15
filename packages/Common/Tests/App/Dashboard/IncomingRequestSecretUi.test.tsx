/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, RenderResult, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * What the Dashboard says about a project's incoming request secrets, away
 * from the secrets themselves:
 *
 *   - an Incoming Request monitor's heartbeat URL says, while the project
 *     requires a secret, that its senders must send one, in which header,
 *     and links to where the secrets are (issue #7526);
 *   - it also says, when the monitor got a request without a valid secret in
 *     the last day, that its requests are refused - or, before the project
 *     requires one, that they would be (issue #8498) - and nothing at all
 *     when there is nothing to say;
 *   - the setup card's example request sends the header, with a placeholder
 *     for the secret: whoever reads a monitor may not read the secrets;
 *   - Monitors > Settings > Incoming Request Secrets lists the monitors that
 *     got a request without a valid secret in the last day, says why, and is
 *     "all clear" only once requests have been checked for the whole day;
 *   - turning the requirement on asks first, turning it off does not;
 *   - every word of it reads in every Dashboard language.
 *
 * What the pages read (useIncomingRequestSecretStatus) is stubbed, and so is
 * the list's table: its rows come from the API.
 */

interface MockStatus {
  isRequired: boolean;
  withoutSecretAt: Date | null;
}

let mockStatus: MockStatus = { isRequired: false, withoutSecretAt: null };
const mockStatusReads: Array<string | undefined> = [];
const mockTableProps: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncomingRequestSecret/UseIncomingRequestSecretStatus",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/IncomingRequestSecret/UseIncomingRequestSecretStatus",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: (monitorId?: { toString: () => string }): MockStatus => {
        mockStatusReads.push(monitorId?.toString());
        return mockStatus;
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      mockTableProps.push(props);
      const ReactModule: typeof React = jest.requireActual(
        "react",
      ) as typeof React;
      return ReactModule.createElement(
        "div",
        { "data-testid": "model-table" },
        String((props["cardProps"] as { title?: string })?.title || ""),
      );
    },
  };
});

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    HOST: "oneuptime.example.com",
  };
});

import IncomingRequestSecretNote from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingRequestSecret/IncomingRequestSecretNote";
import IncomingRequestSecretsCopy, {
  INCOMING_REQUEST_SECRET_NOTE_TEST_ID,
  INCOMING_REQUEST_SECRET_PLACEHOLDER,
  INCOMING_REQUEST_WITHOUT_SECRET_NOTE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingRequestSecret/IncomingRequestSecretsCopy";
import RequestsWithoutSecretTable, {
  getCheckingSince,
  getRequestsWithoutSecretEmptyState,
  getRequestsWithoutSecretQuery,
  getWithoutSecretReasonLabel,
  REQUESTS_WITHOUT_SECRET_TABLE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingRequestSecret/RequestsWithoutSecretTable";
import { getRequireIncomingRequestSecretConfirmation } from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingRequestSecret/RequireIncomingRequestSecretCard";
import {
  getRecentWithoutSecretAt,
  NOTHING_TO_SAY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingRequestSecret/UseIncomingRequestSecretStatus";
import IncomingMonitorLink from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingRequestMonitor/IncomingMonitorLink";
import MonitorSetupCard, {
  getHeartbeatExampleCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorSetupCard";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import IncomingRequestSecret from "../../../Models/DatabaseModels/IncomingRequestSecret";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Route from "../../../Types/API/Route";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import Query from "../../../Types/BaseDatabase/Query";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  INCOMING_REQUEST_SECRET_HEADER,
  INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS,
  IncomingRequestSecretProblem,
} from "../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import EmptyStateOptions from "../../../UI/Components/ModelTable/EmptyStateOptions";
import { MonitorOverviewSetupKind } from "../../../Utils/Monitor/MonitorOverviewFamily";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_KEY: string = "5ec2e7a1-9b3c-4d2e-8f10-7a6b5c4d3e2f";
const URL: string = `https://oneuptime.example.com/heartbeat/${MONITOR_KEY}`;

const HOUR_IN_MS: number = 60 * 60 * 1000;
const NOW: Date = new Date("2026-11-15T12:00:00.000Z");

const hoursBefore: (hours: number, from?: Date) => Date = (
  hours: number,
  from: Date = NOW,
): Date => {
  return new Date(from.getTime() - hours * HOUR_IN_MS);
};

// A moment ago, by the real clock the components read.
const aMomentAgo: () => Date = (): Date => {
  return new Date(Date.now() - 10 * 60 * 1000);
};

// The template's words on either side of {{time}}.
const wordsAround: (template: string) => Array<string> = (
  template: string,
): Array<string> => {
  return template
    .split("{{time}}")
    .map((part: string): string => {
      return part.trim();
    })
    .filter((part: string): boolean => {
      return part.length > 0;
    });
};

const editorMonitor: () => Monitor = (): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.incomingRequestSecretKey = new ObjectID(MONITOR_KEY);
  return monitor;
};

const renderInRouter: (element: ReactElement) => RenderResult = (
  element: ReactElement,
): RenderResult => {
  return render(<MemoryRouter>{element}</MemoryRouter>);
};

const SECRETS_PAGE: string = RouteUtil.populateRouteParams(
  RouteMap[PageMap.MONITORS_SETTINGS_INCOMING_REQUEST_SECRETS] as Route,
).toString();

beforeEach(() => {
  mockStatus = { isRequired: false, withoutSecretAt: null };
  mockStatusReads.length = 0;
  mockTableProps.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("getHeartbeatExampleCommand", () => {
  test("is the plain request while the project requires no secret", () => {
    expect(
      getHeartbeatExampleCommand({ url: URL, isSecretRequired: false }),
    ).toBe(`curl -X POST "${URL}"`);
  });

  test("sends the secret header, with a placeholder, while the project requires one", () => {
    const command: string = getHeartbeatExampleCommand({
      url: URL,
      isSecretRequired: true,
    });

    expect(command).toBe(
      [
        `curl -X POST "${URL}" \\`,
        `  -H "${INCOMING_REQUEST_SECRET_HEADER}: ${INCOMING_REQUEST_SECRET_PLACEHOLDER}"`,
      ].join("\n"),
    );
  });
});

describe("getRecentWithoutSecretAt", () => {
  test("is null when the monitor never got a request without a valid secret", () => {
    expect(getRecentWithoutSecretAt(null, NOW)).toBeNull();
    expect(getRecentWithoutSecretAt(undefined, NOW)).toBeNull();
  });

  test("is null for a value that is not a date", () => {
    expect(getRecentWithoutSecretAt("not a date", NOW)).toBeNull();
  });

  test("is the moment while it is within the last day", () => {
    const at: Date = hoursBefore(23);

    expect(getRecentWithoutSecretAt(at, NOW)).toEqual(at);
    expect(getRecentWithoutSecretAt(at.toISOString(), NOW)).toEqual(at);
  });

  test("still counts a request exactly a day old", () => {
    const at: Date = hoursBefore(INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS);

    expect(getRecentWithoutSecretAt(at, NOW)).toEqual(at);
  });

  test("is null once the request is more than a day old: a fixed sender stops being mentioned", () => {
    expect(getRecentWithoutSecretAt(hoursBefore(25), NOW)).toBeNull();
  });

  test("is the same day the list and the server use", () => {
    expect(INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS).toBe(24);
  });
});

describe("IncomingRequestSecretNote", () => {
  test("says nothing when the project requires no secret and the monitor got none without one", () => {
    const { container } = renderInRouter(
      <IncomingRequestSecretNote status={NOTHING_TO_SAY} />,
    );

    expect(
      screen.queryByTestId(INCOMING_REQUEST_SECRET_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(INCOMING_REQUEST_WITHOUT_SECRET_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(container.textContent).toBe("");
  });

  test("says senders must send the secret, in which header, and links to the secrets", () => {
    renderInRouter(
      <IncomingRequestSecretNote
        status={{ isRequired: true, withoutSecretAt: null }}
      />,
    );

    const note: HTMLElement = screen.getByTestId(
      INCOMING_REQUEST_SECRET_NOTE_TEST_ID,
    );

    expect(note).toHaveTextContent(
      IncomingRequestSecretsCopy.monitorRequirementNote,
    );
    expect(note).toHaveTextContent(INCOMING_REQUEST_SECRET_HEADER);

    const link: HTMLElement = screen.getByRole("link", {
      name: IncomingRequestSecretsCopy.manageSecretsLink,
    });

    expect(link.getAttribute("href")).toBe(SECRETS_PAGE);
    expect(
      screen.queryByTestId(INCOMING_REQUEST_WITHOUT_SECRET_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("before the project requires a secret, says requests like the latest would be refused, and when it came", () => {
    const at: Date = aMomentAgo();

    renderInRouter(
      <IncomingRequestSecretNote
        status={{ isRequired: false, withoutSecretAt: at }}
      />,
    );

    const warning: HTMLElement = screen.getByTestId(
      INCOMING_REQUEST_WITHOUT_SECRET_NOTE_TEST_ID,
    );

    for (const words of wordsAround(
      IncomingRequestSecretsCopy.monitorWouldBeRefusedNote,
    )) {
      expect(warning).toHaveTextContent(words);
    }

    const time: HTMLElement | null = warning.querySelector("time");

    expect(time).not.toBeNull();
    expect(time!.getAttribute("dateTime")).toBe(at.toISOString());

    // Nothing is refused yet, so nothing says how to send the secret.
    expect(
      screen.queryByTestId(INCOMING_REQUEST_SECRET_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("while the project requires a secret, says the monitor's requests are being refused, above where the secret goes", () => {
    const at: Date = aMomentAgo();

    renderInRouter(
      <IncomingRequestSecretNote
        status={{ isRequired: true, withoutSecretAt: at }}
      />,
    );

    const warning: HTMLElement = screen.getByTestId(
      INCOMING_REQUEST_WITHOUT_SECRET_NOTE_TEST_ID,
    );
    const requirement: HTMLElement = screen.getByTestId(
      INCOMING_REQUEST_SECRET_NOTE_TEST_ID,
    );

    for (const words of wordsAround(
      IncomingRequestSecretsCopy.monitorRefusedNote,
    )) {
      expect(warning).toHaveTextContent(words);
    }

    expect(warning.textContent).not.toContain(
      wordsAround(IncomingRequestSecretsCopy.monitorWouldBeRefusedNote)[0],
    );
    expect(
      warning.compareDocumentPosition(requirement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("keeps the spacing it is given only when it draws something", () => {
    const { container, rerender } = renderInRouter(
      <IncomingRequestSecretNote status={NOTHING_TO_SAY} className="mt-3" />,
    );

    expect(container.querySelector(".mt-3")).toBeNull();

    rerender(
      <MemoryRouter>
        <IncomingRequestSecretNote
          status={{ isRequired: true, withoutSecretAt: null }}
          className="mt-3"
        />
      </MemoryRouter>,
    );

    expect(container.querySelector(".mt-3")).not.toBeNull();
  });
});

describe("an Incoming Request monitor's heartbeat URL", () => {
  test("the setup card says nothing of a secret while none is required and every request had one", () => {
    renderInRouter(
      <MonitorSetupCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.HeartbeatUrl}
        monitor={editorMonitor()}
      />,
    );

    expect(
      screen.queryByTestId(INCOMING_REQUEST_SECRET_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(INCOMING_REQUEST_WITHOUT_SECRET_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      INCOMING_REQUEST_SECRET_HEADER,
    );
  });

  test("the setup card asks about this monitor", () => {
    renderInRouter(
      <MonitorSetupCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.HeartbeatUrl}
        monitor={editorMonitor()}
      />,
    );

    expect(mockStatusReads).toContain(MONITOR_ID.toString());
  });

  test("the setup card's example sends the header, and the note says why, while one is required", () => {
    mockStatus = { isRequired: true, withoutSecretAt: null };

    renderInRouter(
      <MonitorSetupCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.HeartbeatUrl}
        monitor={editorMonitor()}
      />,
    );

    expect(
      screen.getByTestId(INCOMING_REQUEST_SECRET_NOTE_TEST_ID),
    ).toBeInTheDocument();
    expect(document.body.textContent).toContain(
      `${INCOMING_REQUEST_SECRET_HEADER}: ${INCOMING_REQUEST_SECRET_PLACEHOLDER}`,
    );
  });

  test("the setup card warns of a request without a secret before one is required, and its example stays plain", () => {
    mockStatus = { isRequired: false, withoutSecretAt: aMomentAgo() };

    renderInRouter(
      <MonitorSetupCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.HeartbeatUrl}
        monitor={editorMonitor()}
      />,
    );

    expect(
      screen.getByTestId(INCOMING_REQUEST_WITHOUT_SECRET_NOTE_TEST_ID),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      `${INCOMING_REQUEST_SECRET_HEADER}: ${INCOMING_REQUEST_SECRET_PLACEHOLDER}`,
    );
  });

  test("the Documentation page's URL card asks about its monitor, and carries the warning", () => {
    mockStatus = { isRequired: true, withoutSecretAt: aMomentAgo() };

    renderInRouter(
      <IncomingMonitorLink
        secretKey={new ObjectID(MONITOR_KEY)}
        monitorId={MONITOR_ID}
      />,
    );

    expect(mockStatusReads).toContain(MONITOR_ID.toString());
    expect(
      screen.getByTestId(INCOMING_REQUEST_WITHOUT_SECRET_NOTE_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(INCOMING_REQUEST_SECRET_NOTE_TEST_ID),
    ).toBeInTheDocument();
  });
});

describe("the list of requests without a secret", () => {
  test("asks for the project's Incoming Request monitors that got one in the last day", () => {
    const query: Query<Monitor> = getRequestsWithoutSecretQuery({
      projectId: PROJECT_ID,
      now: NOW,
    });

    expect(query.projectId).toEqual(PROJECT_ID);
    expect(query.monitorType).toBe(MonitorType.IncomingRequest);

    const since: GreaterThan<Date> =
      query.incomingRequestWithoutSecretAt as unknown as GreaterThan<Date>;

    expect(since).toBeInstanceOf(GreaterThan);
    expect(new Date(since.value).toISOString()).toBe(
      hoursBefore(INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS).toISOString(),
    );
  });

  test("says why each request had no valid secret", () => {
    expect(
      getWithoutSecretReasonLabel(IncomingRequestSecretProblem.NoSecret),
    ).toBe(IncomingRequestSecretsCopy.reasonNoSecret);
    expect(
      getWithoutSecretReasonLabel(IncomingRequestSecretProblem.WrongSecret),
    ).toBe(IncomingRequestSecretsCopy.reasonWrongSecret);
  });

  test("reads a missing or unknown reason as none sent", () => {
    expect(getWithoutSecretReasonLabel(undefined)).toBe(
      IncomingRequestSecretsCopy.reasonNoSecret,
    );
    expect(getWithoutSecretReasonLabel(null)).toBe(
      IncomingRequestSecretsCopy.reasonNoSecret,
    );
    expect(getWithoutSecretReasonLabel("Some Later Reason")).toBe(
      IncomingRequestSecretsCopy.reasonNoSecret,
    );
  });

  test("checks requests only since the project's oldest secret, and not at all without one", () => {
    const older: IncomingRequestSecret = new IncomingRequestSecret();
    older.createdAt = hoursBefore(30);
    const newer: IncomingRequestSecret = new IncomingRequestSecret();
    newer.createdAt = hoursBefore(2);

    expect(getCheckingSince([], 0)).toBeNull();
    expect(getCheckingSince([newer, older], 2)).toEqual(hoursBefore(30));
    expect(getCheckingSince([older, newer], 2)).toEqual(hoursBefore(30));
  });

  test("takes a secret whose age was not read as checking from now", () => {
    const before: number = Date.now();
    const since: Date | null = getCheckingSince(
      [new IncomingRequestSecret()],
      1,
    );

    expect(since).not.toBeNull();
    expect(since!.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("is all clear only once requests have been checked for the whole day", () => {
    const allClear: EmptyStateOptions = getRequestsWithoutSecretEmptyState({
      checkingSince: hoursBefore(INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS),
      now: NOW,
    });

    expect(allClear).toEqual({
      isAllClear: true,
      title: IncomingRequestSecretsCopy.withoutSecretAllClearTitle,
      description: IncomingRequestSecretsCopy.withoutSecretAllClearDescription,
    });
  });

  test("until then, says nothing has come yet, and that a less frequent sender may still show up", () => {
    const soFar: EmptyStateOptions = getRequestsWithoutSecretEmptyState({
      checkingSince: hoursBefore(1),
      now: NOW,
    });

    expect(soFar.isAllClear).toBeFalsy();
    expect(soFar.title).toBe(
      IncomingRequestSecretsCopy.withoutSecretSoFarTitle,
    );
    expect(soFar.description).toBe(
      IncomingRequestSecretsCopy.withoutSecretSoFarDescription,
    );
    expect(soFar.hideCreateButton).toBe(true);
  });

  test("is not drawn while the project has no secret, or before the secrets have loaded", () => {
    const { container, rerender } = renderInRouter(
      <RequestsWithoutSecretTable
        projectId={PROJECT_ID}
        checkingSince={null}
      />,
    );

    expect(container.textContent).toBe("");

    rerender(
      <MemoryRouter>
        <RequestsWithoutSecretTable
          projectId={PROJECT_ID}
          checkingSince={undefined}
        />
      </MemoryRouter>,
    );

    expect(container.textContent).toBe("");
    expect(mockTableProps).toHaveLength(0);
  });

  test("once the project has a secret, lists the monitors, latest first, read only, with why and when", () => {
    renderInRouter(
      <RequestsWithoutSecretTable
        projectId={PROJECT_ID}
        checkingSince={hoursBefore(48, new Date())}
      />,
    );

    expect(screen.getByTestId("model-table")).toHaveTextContent(
      IncomingRequestSecretsCopy.withoutSecretTableTitle,
    );

    const props: Record<string, unknown> = mockTableProps[
      mockTableProps.length - 1
    ] as Record<string, unknown>;

    expect(props["id"]).toBe(REQUESTS_WITHOUT_SECRET_TABLE_ID);
    expect(props["modelType"]).toBe(Monitor);
    expect(props["sortBy"]).toBe("incomingRequestWithoutSecretAt");
    expect(props["sortOrder"]).toBe(SortOrder.Descending);
    expect({
      create: props["isCreateable"],
      edit: props["isEditable"],
      delete: props["isDeleteable"],
      view: props["isViewable"],
    }).toEqual({ create: false, edit: false, delete: false, view: false });
    expect(props["emptyState"]).toEqual(
      expect.objectContaining({ isAllClear: true }),
    );

    const query: Query<Monitor> = props["query"] as Query<Monitor>;

    expect(query.projectId).toEqual(PROJECT_ID);
    expect(query.monitorType).toBe(MonitorType.IncomingRequest);

    const columns: Array<{ title: string; field: Record<string, boolean> }> =
      props["columns"] as Array<{
        title: string;
        field: Record<string, boolean>;
      }>;

    expect(
      columns.map((column: { title: string }): string => {
        return column.title;
      }),
    ).toEqual([
      "Monitor",
      IncomingRequestSecretsCopy.reasonTitle,
      IncomingRequestSecretsCopy.lastWithoutSecretTitle,
      IncomingRequestSecretsCopy.lastWithSecretTitle,
    ]);
    expect(
      columns.map((column: { field: Record<string, boolean> }): string => {
        return Object.keys(column.field)[0] as string;
      }),
    ).toEqual([
      "name",
      "incomingRequestWithoutSecretReason",
      "incomingRequestWithoutSecretAt",
      "incomingRequestWithSecretAt",
    ]);
  });
});

describe("turning the requirement on", () => {
  test("asks first, saying senders without a secret are refused from then on", () => {
    expect(getRequireIncomingRequestSecretConfirmation(true)).toEqual({
      title: IncomingRequestSecretsCopy.confirmTurnOnTitle,
      description: IncomingRequestSecretsCopy.confirmTurnOnDescription,
      submitButtonText: IncomingRequestSecretsCopy.confirmTurnOnButton,
    });
  });

  test("turning it off asks nothing", () => {
    expect(getRequireIncomingRequestSecretConfirmation(false)).toBeUndefined();
  });
});

describe("the words, in every Dashboard language", () => {
  const LOCALES: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  const readLocale: (code: string) => Record<string, unknown> = (
    code: string,
  ): Record<string, unknown> => {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
    ) as Record<string, unknown>;
  };

  const LANGUAGES: Array<string> = fs
    .readdirSync(LOCALES)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    });

  const words: Array<string> = Object.values(IncomingRequestSecretsCopy);

  // Persian writes a count in Persian digits.
  const PERSIAN_DIGITS: string = "۰۱۲۳۴۵۶۷۸۹";

  const withLatinDigits: (text: string) => string = (text: string): string => {
    return text.replace(/[۰-۹]/g, (digit: string): string => {
      return String(PERSIAN_DIGITS.indexOf(digit));
    });
  };

  test("are keys of the English locale", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const word of words) {
      expect({ word, key: english[word] }).toEqual({ word, key: word });
    }
  });

  test.each(LANGUAGES)("are in %s", (code: string) => {
    const locale: Record<string, unknown> = readLocale(code);

    for (const word of words) {
      expect({ word, present: typeof locale[word] === "string" }).toEqual({
        word,
        present: true,
      });
    }
  });

  test.each(LANGUAGES)(
    "keep the time slot and the day's hours in %s",
    (code: string) => {
      const locale: Record<string, unknown> = readLocale(code);

      for (const word of words) {
        const translated: string = locale[word] as string;

        if (word.includes("{{time}}")) {
          expect({ word, slot: translated.split("{{time}}").length }).toEqual({
            word,
            slot: 2,
          });
        }

        if (word.includes(`${INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS}`)) {
          expect({
            word,
            hours: withLatinDigits(translated).includes(
              `${INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS}`,
            ),
          }).toEqual({ word, hours: true });
        }
      }
    },
  );

  test.each(["de", "es", "ja", "fa", "ar"])(
    "every sentence is translated in %s, the header name kept as it is",
    (code: string) => {
      const locale: Record<string, unknown> = readLocale(code);

      for (const word of words) {
        const translated: string = locale[word] as string;

        if (word.includes(".")) {
          expect({ word, translated: translated !== word }).toEqual({
            word,
            translated: true,
          });
        }

        if (word.includes(INCOMING_REQUEST_SECRET_HEADER)) {
          expect(translated).toContain(INCOMING_REQUEST_SECRET_HEADER);
        }
      }
    },
  );
});
