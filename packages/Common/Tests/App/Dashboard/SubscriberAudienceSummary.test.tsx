import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * SubscriberAudienceSummary: "Will notify: Site 03 (up to 41 email), Site 07
 * (up to 18 email)", shown before an incident is declared or a public note is
 * posted.
 *
 * The raw call is stubbed and its request recorded, so these pin down what
 * it asks (the route, the tenant header, normalized ids), when it asks (once
 * per set of ids, a draft after the picking settles, never while notifying
 * is off), what it does with a late or failed answer, and what it says.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (
          error &&
          typeof error === "object" &&
          "message" in (error as Record<string, unknown>)
        ) {
          return String((error as Record<string, unknown>)["message"]);
        }

        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
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

import SubscriberAudienceSummary from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/SubscriberAudienceSummary";
import IncidentStatusPageScopeCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import {
  getSubscriberAudienceRequestBody,
  SUBSCRIBER_AUDIENCE_DEBOUNCE_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/useSubscriberAudience";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import IncidentSubscriberAudience, {
  IncidentSubscriberAudienceCounts,
  IncidentSubscriberAudienceExclusionReason,
  IncidentSubscriberAudienceResult,
} from "../../../Types/StatusPage/IncidentSubscriberAudience";

const INCIDENT_ID: string = "a0000000-0000-4000-8000-00000000000a";
const MONITOR_A: string = "c0000000-0000-4000-8000-000000000001";
const MONITOR_B: string = "c0000000-0000-4000-8000-000000000002";
const SITE_03: string = "b0000000-0000-4000-8000-000000000003";
const SITE_07: string = "b0000000-0000-4000-8000-000000000007";

function counts(
  partial: Partial<IncidentSubscriberAudienceCounts>,
): IncidentSubscriberAudienceCounts {
  return {
    ...IncidentSubscriberAudience.getEmptyCounts(),
    ...partial,
  };
}

function audience(
  partial: Partial<IncidentSubscriberAudienceResult> = {},
): IncidentSubscriberAudienceResult {
  return {
    hasMonitors: true,
    isScoped: true,
    isHiddenFromStatusPages: false,
    statusPages: [
      {
        statusPageId: SITE_03,
        name: "Site 03",
        subscriberCounts: counts({ email: 41 }),
      },
      {
        statusPageId: SITE_07,
        name: "Site 07",
        subscriberCounts: counts({ email: 18 }),
      },
    ],
    hiddenStatusPageCount: 0,
    excludedStatusPages: [],
    selectedStatusPagesNotListingMonitors: [],
    ...partial,
  };
}

function ok(
  result: IncidentSubscriberAudienceResult,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    IncidentSubscriberAudience.toJSON(result),
    {},
  );
}

function requestOf(call: number = 0): {
  url: string;
  data: JSONObject;
  headers: Record<string, string>;
} {
  const request: Record<string, unknown> = postMock.mock.calls[
    call
  ]![0] as Record<string, unknown>;

  return {
    url: String(request["url"]),
    data: request["data"] as JSONObject,
    headers: request["headers"] as Record<string, string>,
  };
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue(ok(audience()));
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("SubscriberAudienceSummary for an incident that exists", () => {
  test("asks the audience route with the tenant header, and says who will be notified", async () => {
    render(
      <SubscriberAudienceSummary
        request={{ incidentId: new ObjectID(INCIDENT_ID) }}
      />,
    );

    expect(await screen.findByText("Will notify:")).toBeInTheDocument();
    expect(screen.getByText("Site 03 (up to 41 email)")).toBeInTheDocument();
    expect(screen.getByText("Site 07 (up to 18 email)")).toBeInTheDocument();
    expect(
      screen.getByText(IncidentStatusPageScopeCopy.audienceOnceEachNote),
    ).toBeInTheDocument();
    expect(
      screen.getByText(IncidentStatusPageScopeCopy.audienceUpToNote),
    ).toBeInTheDocument();

    expect(postMock).toHaveBeenCalledTimes(1);

    const request: {
      url: string;
      data: JSONObject;
      headers: Record<string, string>;
    } = requestOf();

    expect(request.url).toMatch(/\/incident\/subscriber-audience$/);
    expect(request.data).toEqual({ incidentId: INCIDENT_ID });
    expect(request.headers).toEqual({ tenantid: "project-1" });
  });

  test("shows that it is working it out until the answer arrives", async () => {
    let resolve: (value: HTTPResponse<JSONObject>) => void = () => {};
    postMock.mockImplementation((() => {
      return new Promise((r: (value: HTTPResponse<JSONObject>) => void) => {
        resolve = r;
      });
    }) as never);

    render(<SubscriberAudienceSummary request={{ incidentId: INCIDENT_ID }} />);

    expect(
      screen.getByText(IncidentStatusPageScopeCopy.audienceLoading),
    ).toBeInTheDocument();
    expect(screen.getByTestId("subscriber-audience-summary")).toHaveAttribute(
      "data-state",
      "loading",
    );

    await act(async () => {
      resolve(ok(audience()));
    });

    expect(screen.getByText("Will notify:")).toBeInTheDocument();
  });

  test("a failed answer says so in a line, and never throws", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(422, { message: "Incident not found" }, {}),
    );

    render(<SubscriberAudienceSummary request={{ incidentId: INCIDENT_ID }} />);

    expect(
      await screen.findByText(IncidentStatusPageScopeCopy.audienceError),
    ).toBeInTheDocument();
    expect(screen.getByText("Incident not found")).toBeInTheDocument();
    expect(screen.getByTestId("subscriber-audience-summary")).toHaveAttribute(
      "data-state",
      "error",
    );
  });

  test("a thrown request is reported the same way", async () => {
    postMock.mockRejectedValue(new Error("Network down"));

    render(<SubscriberAudienceSummary request={{ incidentId: INCIDENT_ID }} />);

    expect(await screen.findByText("Network down")).toBeInTheDocument();
  });

  test("a hidden incident: nothing will be sent", async () => {
    postMock.mockResolvedValue(ok(audience({ isHiddenFromStatusPages: true })));

    render(<SubscriberAudienceSummary request={{ incidentId: INCIDENT_ID }} />);

    expect(
      await screen.findByText(
        IncidentStatusPageScopeCopy.audienceHiddenIncident,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Site 03 (up to 41 email)")).toBeNull();
    expect(screen.getByTestId("subscriber-audience-summary")).toHaveAttribute(
      "data-state",
      "warning",
    );
  });

  test("pages the viewer cannot see, and pages left out", async () => {
    postMock.mockResolvedValue(
      ok(
        audience({
          hiddenStatusPageCount: 2,
          excludedStatusPages: [
            {
              statusPageId: "x",
              name: "Site 05",
              reason:
                IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope,
            },
          ],
        }),
      ),
    );

    render(<SubscriberAudienceSummary request={{ incidentId: INCIDENT_ID }} />);

    expect(
      await screen.findByText("2 more status pages you do not have access to"),
    ).toBeInTheDocument();
    expect(screen.getByText("Not notified:")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Site 05 (not one of the pages this incident is limited to)",
      ),
    ).toBeInTheDocument();
  });
});

describe("SubscriberAudienceSummary for an incident being declared", () => {
  test("waits for the picking to settle, then asks once with normalized ids", async () => {
    jest.useFakeTimers();

    render(
      <SubscriberAudienceSummary
        request={{
          monitorIds: [{ _id: MONITOR_B, name: "B" }, MONITOR_A],
          statusPageIds: [SITE_07.toUpperCase(), SITE_03],
        }}
      />,
    );

    expect(postMock).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(SUBSCRIBER_AUDIENCE_DEBOUNCE_MS - 1);
    });

    expect(postMock).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(requestOf().data).toEqual({
      monitorIds: [MONITOR_A, MONITOR_B],
      statusPageIds: [SITE_03, SITE_07],
    });
  });

  test("re-rendering with the same ids in another shape does not ask again", async () => {
    const { rerender } = render(
      <SubscriberAudienceSummary
        request={{ monitorIds: [MONITOR_A], statusPageIds: [SITE_03] }}
      />,
    );

    expect(await screen.findByText("Will notify:")).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(1);

    rerender(
      <SubscriberAudienceSummary
        request={{
          monitorIds: [{ _id: MONITOR_A }],
          statusPageIds: [new ObjectID(SITE_03)],
        }}
      />,
    );

    await new Promise((r: (value: unknown) => void) => {
      setTimeout(r, SUBSCRIBER_AUDIENCE_DEBOUNCE_MS + 50);
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Will notify:")).toBeInTheDocument();
  });

  test("new ids ask again, and a late answer to the old ones is dropped", async () => {
    let resolveFirst: (value: HTTPResponse<JSONObject>) => void = () => {};

    postMock
      .mockImplementationOnce((() => {
        return new Promise((r: (value: HTTPResponse<JSONObject>) => void) => {
          resolveFirst = r;
        });
      }) as never)
      .mockResolvedValueOnce(
        ok(
          audience({
            statusPages: [
              {
                statusPageId: SITE_07,
                name: "Site 07",
                subscriberCounts: counts({ sms: 2 }),
              },
            ],
          }),
        ) as never,
      );

    const { rerender } = render(
      <SubscriberAudienceSummary
        request={{ monitorIds: [MONITOR_A], statusPageIds: [SITE_03] }}
      />,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    rerender(
      <SubscriberAudienceSummary
        request={{ monitorIds: [MONITOR_A], statusPageIds: [SITE_07] }}
      />,
    );

    expect(
      await screen.findByText("Site 07 (up to 2 SMS)"),
    ).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(2);

    // The first request answers late: it must not replace the second.
    await act(async () => {
      resolveFirst(ok(audience()));
    });

    expect(screen.getByText("Site 07 (up to 2 SMS)")).toBeInTheDocument();
    expect(screen.queryByText("Site 03 (up to 41 email)")).toBeNull();
  });

  test("no monitors, as the server says: nobody is notified", async () => {
    postMock.mockResolvedValue(
      ok(audience({ hasMonitors: false, statusPages: [] })),
    );

    render(
      <SubscriberAudienceSummary
        request={{ monitorIds: [], statusPageIds: [] }}
      />,
    );

    expect(
      await screen.findByText(IncidentStatusPageScopeCopy.audienceNoMonitors),
    ).toBeInTheDocument();
  });
});

describe("SubscriberAudienceSummary when nothing will be sent anyway", () => {
  test("a quiet reason is shown instead of asking", async () => {
    render(
      <SubscriberAudienceSummary
        request={{ monitorIds: [MONITOR_A], statusPageIds: [] }}
        quietReason={IncidentStatusPageScopeCopy.audienceNotifyOff}
      />,
    );

    expect(
      screen.getByText(IncidentStatusPageScopeCopy.audienceNotifyOff),
    ).toBeInTheDocument();
    expect(screen.getByTestId("subscriber-audience-summary")).toHaveAttribute(
      "data-state",
      "quiet",
    );

    await new Promise((r: (value: unknown) => void) => {
      setTimeout(r, SUBSCRIBER_AUDIENCE_DEBOUNCE_MS + 50);
    });

    expect(postMock).not.toHaveBeenCalled();
  });

  test("no request renders nothing and asks nothing", () => {
    const { container } = render(<SubscriberAudienceSummary request={null} />);

    expect(container).toBeEmptyDOMElement();
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe("getSubscriberAudienceRequestBody", () => {
  test("asks who a Retry of the 'created' notification reaches only when told to", () => {
    expect(
      getSubscriberAudienceRequestBody({
        incidentId: INCIDENT_ID,
        excludeStatusPagesNotifiedOnCreation: true,
      }),
    ).toEqual({
      incidentId: INCIDENT_ID,
      excludeStatusPagesNotifiedOnCreation: true,
    });
    expect(
      getSubscriberAudienceRequestBody({
        incidentId: INCIDENT_ID,
        excludeStatusPagesNotifiedOnCreation: false,
      }),
    ).toEqual({ incidentId: INCIDENT_ID });
  });

  test("an incident id, trimmed", () => {
    expect(
      getSubscriberAudienceRequestBody({ incidentId: ` ${INCIDENT_ID} ` }),
    ).toEqual({ incidentId: INCIDENT_ID });
  });

  test("an empty incident id asks nothing", () => {
    expect(getSubscriberAudienceRequestBody({ incidentId: "" })).toBeNull();
    expect(
      getSubscriberAudienceRequestBody({
        incidentId: "",
        excludeStatusPagesNotifiedOnCreation: true,
      }),
    ).toBeNull();
    expect(getSubscriberAudienceRequestBody(null)).toBeNull();
  });

  test("a draft's ids are normalized and sorted, so equal drafts are equal bodies", () => {
    expect(
      JSON.stringify(
        getSubscriberAudienceRequestBody({
          monitorIds: [MONITOR_B, { _id: MONITOR_A }],
          statusPageIds: undefined,
        }),
      ),
    ).toBe(
      JSON.stringify(
        getSubscriberAudienceRequestBody({
          monitorIds: [MONITOR_A.toUpperCase(), MONITOR_B, MONITOR_A],
          statusPageIds: [],
        }),
      ),
    );
  });
});
