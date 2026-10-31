/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import API from "../../../UI/Utils/API/API";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import SecurityEventsForException from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsForException";
import { SECURITY_EVENTS_IN_SIGNAL_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsInSignal";
import ExceptionMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExceptionMonitor/ExceptionMonitorStepForm";

/*
 * THE DASHBOARD'S READERS OF AN EXCEPTION'S OCCURRENCES TAKE IN THOSE
 * MERGED INTO IT (TelemetryExceptionMerge): what they hold of an exception
 * is its id, so they ask the server for its group fingerprints - its own,
 * then those of the exceptions merged into it (POST
 * /telemetry-exception/group-fingerprints) - as the viewer.
 *
 *   - The security events above an exception's Overview are those whose
 *     request threw it or an exception merged into it.
 *   - The Exceptions monitor form's preview leaves out the occurrences of an
 *     exception merged into a resolved or archived one, as the monitor's
 *     own count does.
 *
 * An exception nothing was merged into reads exactly as before. The server
 * is stubbed at the doors these views use.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "90000000-0000-4000-8000-000000000001",
);
const EXCEPTION_ID: string = "90000000-0000-4000-8000-00000000000e";
const RESOLVED_ID: string = "90000000-0000-4000-8000-00000000000a";
const ARCHIVED_ID: string = "90000000-0000-4000-8000-00000000000b";

let previewQueries: Array<JSONObject> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionInstanceTable",
  () => {
    return {
      __esModule: true,
      default: (props: { query: JSONObject }): ReactElement => {
        previewQueries.push(props.query);
        return <div data-testid="exceptions-preview" />;
      },
    };
  },
);

// What the server answers the group fingerprints route with, by id.
let groups: Record<string, Array<string>>;
let groupRequests: Array<{ url: string; data: JSONObject }>;
let groupsRefused: boolean;

function answerGroups(): void {
  jest.spyOn(API, "post").mockImplementation((async (args: {
    url: { toString: () => string };
    data: JSONObject;
  }) => {
    groupRequests.push({ url: args.url.toString(), data: args.data });

    if (groupsRefused) {
      return new HTTPErrorResponse(500, { message: "down" }, {});
    }

    const ids: Array<string> =
      (args.data["telemetryExceptionIds"] as Array<string>) || [];

    return new HTTPResponse(
      200,
      {
        exceptions: ids
          .filter((id: string): boolean => {
            return Boolean(groups[id]);
          })
          .map((id: string) => {
            return { telemetryExceptionId: id, fingerprints: groups[id] };
          }),
      },
      {},
    );
  }) as never);
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let index: number = 0; index < 10; index++) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  previewQueries = [];
  groupRequests = [];
  groupsRefused = false;
  groups = {};
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({} as never);
  answerGroups();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the security events above an exception's Overview", () => {
  let eventQueries: Array<Record<string, unknown>>;

  beforeEach(() => {
    eventQueries = [];
    jest.spyOn(AnalyticsModelAPI, "getList").mockImplementation((async (args: {
      query: Record<string, unknown>;
    }) => {
      eventQueries.push(args.query);
      return {
        data: [
          Object.assign(new SecurityEvent(), {
            time: new Date("2026-10-27T06:45:12.000Z"),
            severityName: OcsfSeverity.High,
            severityId: 4,
            message: "SQL injection attempt",
          }),
        ],
        count: 1,
        skip: 0,
        limit: 50,
      };
    }) as never);
  });

  async function renderCallout(): Promise<void> {
    render(
      <MemoryRouter>
        <SecurityEventsForException
          telemetryExceptionId={new ObjectID(EXCEPTION_ID)}
        />
      </MemoryRouter>,
    );
    await settle();
  }

  function askedFingerprint(): unknown {
    return (eventQueries[0]!["attributes"] as Record<string, unknown>)[
      SECURITY_REQUEST_ATTRIBUTES.exceptionFingerprint
    ];
  }

  test("are those whose request threw it or an exception merged into it, and link to all of them", async () => {
    groups[EXCEPTION_ID] = ["fp-own", "fp-merged-a", "fp-merged-b"];

    await renderCallout();

    expect(groupRequests).toEqual([
      {
        url: expect.stringContaining(
          "/telemetry-exception/group-fingerprints",
        ) as unknown as string,
        data: { telemetryExceptionIds: [EXCEPTION_ID] },
      },
    ]);

    expect(askedFingerprint()).toBeInstanceOf(Includes);
    expect((askedFingerprint() as Includes).values).toEqual([
      "fp-own",
      "fp-merged-a",
      "fp-merged-b",
    ]);
    expect(eventQueries[0]!["projectId"]).toBe(PROJECT_ID);

    expect(screen.getByTestId(SECURITY_EVENTS_IN_SIGNAL_TEST_ID)).toBeVisible();
    const link: string =
      screen
        .getByTestId("security-events-in-signal-open")
        .getAttribute("href") || "";
    const filters: Array<[string, string]> = JSON.parse(
      new URLSearchParams(link.slice(link.indexOf("?") + 1)).get("filters")!,
    );
    expect(
      filters.map((pair: [string, string]): string => {
        return pair[1];
      }),
    ).toEqual(["fp-own", "fp-merged-a", "fp-merged-b"]);
  });

  test("nothing merged into it: by its own fingerprint, the plain equality it always was", async () => {
    groups[EXCEPTION_ID] = ["fp-own"];

    await renderCallout();

    expect(askedFingerprint()).toBe("fp-own");
  });

  test("an exception the viewer may not read, or a refused lookup, shows nothing and reads no events", async () => {
    await renderCallout();
    expect(eventQueries).toHaveLength(0);
    expect(screen.queryByTestId(SECURITY_EVENTS_IN_SIGNAL_TEST_ID)).toBeNull();

    cleanup();
    groups[EXCEPTION_ID] = ["fp-own"];
    groupsRefused = true;

    await renderCallout();
    expect(eventQueries).toHaveLength(0);
    expect(screen.queryByTestId(SECURITY_EVENTS_IN_SIGNAL_TEST_ID)).toBeNull();
  });
});

describe("the Exceptions monitor form's preview", () => {
  // The resolved and archived exceptions the preview's status reads find.
  let resolved: Array<TelemetryException>;
  let archived: Array<TelemetryException>;

  function exception(id: string, fingerprint: string): TelemetryException {
    const row: TelemetryException = new TelemetryException();
    row._id = id;
    row.fingerprint = fingerprint;
    return row;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    resolved = [exception(RESOLVED_ID, "fp-resolved")];
    archived = [exception(ARCHIVED_ID, "fp-archived")];

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
      query: Record<string, unknown>;
    }) => {
      const data: Array<TelemetryException> = args.query["isResolved"]
        ? resolved
        : args.query["isArchived"]
          ? archived
          : [];
      return { data, count: data.length, skip: 0, limit: 1000 };
    }) as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function openPreview(
    initial: Partial<MonitorStepExceptionMonitor> = {},
  ): Promise<void> {
    render(
      <ExceptionMonitorStepForm
        monitorStepExceptionMonitor={{
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          ...initial,
        }}
        onMonitorStepExceptionMonitorChanged={() => {
          // Not what these tests read.
        }}
        telemetryServices={[]}
        telemetryEntities={[]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Matching exceptions" }),
    );
    await settle();
  }

  function leftOut(): Array<string> {
    const fingerprint: JSONObject = previewQueries[previewQueries.length - 1]![
      "fingerprint"
    ] as JSONObject;

    expect(fingerprint["_type"]).toBe("IncludesNone");
    return fingerprint["value"] as Array<string>;
  }

  test("leaves out the exceptions merged into a resolved or archived one, as the monitor's count does", async () => {
    groups[RESOLVED_ID] = ["fp-resolved", "fp-merged-into-resolved"];
    groups[ARCHIVED_ID] = ["fp-archived", "fp-merged-into-archived"];

    await openPreview();

    expect(leftOut().sort()).toEqual(
      [
        "fp-archived",
        "fp-merged-into-archived",
        "fp-merged-into-resolved",
        "fp-resolved",
      ].sort(),
    );
    // One request for the exceptions read, as the viewer.
    expect(groupRequests).toHaveLength(1);
    expect(
      (groupRequests[0]!.data["telemetryExceptionIds"] as Array<string>).sort(),
    ).toEqual([ARCHIVED_ID, RESOLVED_ID].sort());
  });

  test("nothing merged into them: it leaves out what it did before", async () => {
    groups[RESOLVED_ID] = ["fp-resolved"];
    groups[ARCHIVED_ID] = ["fp-archived"];

    await openPreview();

    expect(leftOut()).toEqual(["fp-resolved", "fp-archived"]);
  });

  test("when what was merged cannot be read, the resolved and archived ones are still left out", async () => {
    groups[RESOLVED_ID] = ["fp-resolved", "fp-merged-into-resolved"];
    groupsRefused = true;

    await openPreview();

    expect(leftOut()).toEqual(["fp-resolved", "fp-archived"]);
  });

  test("a monitor that counts resolved and archived exceptions leaves nothing out, and asks for nothing", async () => {
    groups[RESOLVED_ID] = ["fp-resolved", "fp-merged-into-resolved"];

    await openPreview({ includeResolved: true, includeArchived: true });

    expect(
      previewQueries[previewQueries.length - 1]!["fingerprint"],
    ).toBeUndefined();
    expect(groupRequests).toHaveLength(0);
  });

  test("an archived exception's merged ones are left out when only archived ones are", async () => {
    groups[RESOLVED_ID] = ["fp-resolved", "fp-merged-into-resolved"];
    groups[ARCHIVED_ID] = ["fp-archived", "fp-merged-into-archived"];

    await openPreview({ includeResolved: true });

    expect(leftOut()).toEqual(["fp-archived", "fp-merged-into-archived"]);
  });
});
