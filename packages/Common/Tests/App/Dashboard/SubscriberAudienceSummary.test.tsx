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
 * posted, and in the confirmation before a notification is sent again.
 *
 * The raw call is stubbed and its request recorded, so these pin down what
 * it asks (the route, the tenant header, normalized ids), when it asks (once
 * per set of ids, a draft after the picking settles, never without a
 * request), what it does with a late or failed answer, and what it says.
 *
 * Under a "notify subscribers" checkbox it says nothing until it has
 * someone to name or a status page scope problem to point out: no
 * working-it-out line, and no "No status page subscribers will be notified:
 * no monitors are attached" - the warning the maintainer asked to remove. A
 * confirmation (saysWhenNobodyIsNotified) always answers.
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

/*
 * Lets every answer already given land. Under a checkbox "still working it
 * out" and "nothing to say" both render nothing, so a test that expects
 * nothing must wait for the answer first, or it would pass while loading.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r: (value: unknown) => void) => {
      setTimeout(r, 20);
    });
  });
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

  test("in a confirmation, shows that it is working it out until the answer arrives", async () => {
    let resolve: (value: HTTPResponse<JSONObject>) => void = () => {};
    postMock.mockImplementation((() => {
      return new Promise((r: (value: HTTPResponse<JSONObject>) => void) => {
        resolve = r;
      });
    }) as never);

    render(
      <SubscriberAudienceSummary
        request={{ incidentId: INCIDENT_ID }}
        saysWhenNobodyIsNotified={true}
      />,
    );

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

  /*
   * Most answers under a checkbox are "nobody", which shows nothing: a
   * working-it-out line would flash up only to disappear.
   */
  test("under a checkbox, shows nothing while it works it out, then who will be notified", async () => {
    let resolve: (value: HTTPResponse<JSONObject>) => void = () => {};
    postMock.mockImplementation((() => {
      return new Promise((r: (value: HTTPResponse<JSONObject>) => void) => {
        resolve = r;
      });
    }) as never);

    const { container } = render(
      <SubscriberAudienceSummary request={{ incidentId: INCIDENT_ID }} />,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByText(IncidentStatusPageScopeCopy.audienceLoading),
    ).toBeNull();

    await act(async () => {
      resolve(ok(audience()));
    });

    expect(screen.getByText("Will notify:")).toBeInTheDocument();
    expect(screen.getByTestId("subscriber-audience-summary")).toHaveAttribute(
      "data-state",
      "info",
    );
  });

  test("under a checkbox, an answer that never comes shows nothing", async () => {
    postMock.mockImplementation((() => {
      return new Promise(() => {});
    }) as never);

    const { container } = render(
      <SubscriberAudienceSummary request={{ incidentId: INCIDENT_ID }} />,
    );

    await new Promise((r: (value: unknown) => void) => {
      setTimeout(r, 50);
    });

    expect(container).toBeEmptyDOMElement();
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

  /*
   * The maintainer's screenshot: 'Notify Status Page Subscribers' ticked on
   * an incident with no monitor, and under it "No status page subscribers
   * will be notified: no monitors are attached. Subscribers hear about an
   * incident through the monitors their status pages list."
   */
  test("no monitors, as the server says: nothing at all under the checkbox", async () => {
    postMock.mockResolvedValue(
      ok(audience({ hasMonitors: false, statusPages: [] })),
    );

    const { container } = render(
      <SubscriberAudienceSummary
        request={{ monitorIds: [], statusPageIds: [] }}
      />,
    );

    await waitFor(
      () => {
        expect(postMock).toHaveBeenCalledTimes(1);
      },
      { timeout: SUBSCRIBER_AUDIENCE_DEBOUNCE_MS + 1000 },
    );
    await settle();

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/no monitors are attached/i)).toBeNull();
    expect(screen.queryByText(/hear about an incident/i)).toBeNull();
  });

  test("monitors that no status page lists: nothing under the checkbox", async () => {
    postMock.mockResolvedValue(ok(audience({ statusPages: [] })));

    const { container } = render(
      <SubscriberAudienceSummary
        request={{ monitorIds: [MONITOR_A], statusPageIds: [] }}
      />,
    );

    await waitFor(
      () => {
        expect(postMock).toHaveBeenCalledTimes(1);
      },
      { timeout: SUBSCRIBER_AUDIENCE_DEBOUNCE_MS + 1000 },
    );
    await settle();

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByText(IncidentStatusPageScopeCopy.audienceNoStatusPages),
    ).toBeNull();
  });

  test("pages picked but no monitor: names the pages, which will not show it", async () => {
    postMock.mockResolvedValue(
      ok(
        audience({
          hasMonitors: false,
          statusPages: [],
          selectedStatusPagesNotListingMonitors: [
            { statusPageId: SITE_03, name: "Site 03" },
          ],
        }),
      ),
    );

    render(
      <SubscriberAudienceSummary
        request={{ monitorIds: [], statusPageIds: [SITE_03] }}
      />,
    );

    expect(
      await screen.findByText(
        IncidentStatusPageScopeCopy.audienceNoStatusPages,
        undefined,
        { timeout: SUBSCRIBER_AUDIENCE_DEBOUNCE_MS + 1000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Site 03 (lists none of these monitors)"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("subscriber-audience-summary")).toHaveAttribute(
      "data-state",
      "warning",
    );
  });
});

describe("SubscriberAudienceSummary under a checkbox, when no one will be notified", () => {
  test("pages with no subscribers yet: nothing", async () => {
    postMock.mockResolvedValue(
      ok(
        audience({
          statusPages: [
            {
              statusPageId: SITE_03,
              name: "Site 03",
              subscriberCounts: counts({}),
            },
          ],
        }),
      ),
    );

    const { container } = render(
      <SubscriberAudienceSummary request={{ incidentId: INCIDENT_ID }} />,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    await settle();

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByText(IncidentStatusPageScopeCopy.audienceNoSubscribers),
    ).toBeNull();
  });

  test("only a page that does not show incidents is left out: nothing", async () => {
    postMock.mockResolvedValue(
      ok(
        audience({
          statusPages: [],
          excludedStatusPages: [
            {
              statusPageId: "x",
              name: "Internal",
              reason: IncidentSubscriberAudienceExclusionReason.HidesIncidents,
            },
          ],
        }),
      ),
    );

    const { container } = render(
      <SubscriberAudienceSummary request={{ incidentId: INCIDENT_ID }} />,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    await settle();

    expect(container).toBeEmptyDOMElement();
  });

  test("a page that only shows incidents limited to it keeps it out: a warning, with the page and why", async () => {
    postMock.mockResolvedValue(
      ok(
        audience({
          isScoped: false,
          statusPages: [],
          excludedStatusPages: [
            {
              statusPageId: "x",
              name: "Site 05",
              reason:
                IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents,
            },
          ],
        }),
      ),
    );

    render(<SubscriberAudienceSummary request={{ incidentId: INCIDENT_ID }} />);

    expect(
      await screen.findByText(
        IncidentStatusPageScopeCopy.audienceNoStatusPages,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Not notified:")).toBeInTheDocument();
    expect(
      screen.getByText("Site 05 (only shows incidents limited to it)"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("subscriber-audience-summary")).toHaveAttribute(
      "data-state",
      "warning",
    );
  });

  test("a failed answer is still said: it is not the same as nobody", async () => {
    postMock.mockRejectedValue(new Error("Network down"));

    render(
      <SubscriberAudienceSummary
        request={{ monitorIds: [MONITOR_A], statusPageIds: [] }}
      />,
    );

    expect(
      await screen.findByText(
        IncidentStatusPageScopeCopy.audienceError,
        undefined,
        {
          timeout: SUBSCRIBER_AUDIENCE_DEBOUNCE_MS + 1000,
        },
      ),
    ).toBeInTheDocument();
  });
});

describe("SubscriberAudienceSummary in a confirmation, when no one will be notified", () => {
  test("no monitors: says no status page will show it", async () => {
    postMock.mockResolvedValue(
      ok(audience({ hasMonitors: false, statusPages: [] })),
    );

    render(
      <SubscriberAudienceSummary
        request={{ incidentId: INCIDENT_ID }}
        saysWhenNobodyIsNotified={true}
      />,
    );

    expect(
      await screen.findByText(
        IncidentStatusPageScopeCopy.audienceNoStatusPages,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no monitors are attached/i)).toBeNull();
  });

  test("pages with no subscribers yet: says so, with the pages", async () => {
    postMock.mockResolvedValue(
      ok(
        audience({
          statusPages: [
            {
              statusPageId: SITE_03,
              name: "Site 03",
              subscriberCounts: counts({}),
            },
          ],
        }),
      ),
    );

    render(
      <SubscriberAudienceSummary
        request={{ incidentId: INCIDENT_ID }}
        saysWhenNobodyIsNotified={true}
      />,
    );

    expect(
      await screen.findByText(
        IncidentStatusPageScopeCopy.audienceNoSubscribers,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Site 03 (no subscribers yet)"),
    ).toBeInTheDocument();
  });

  test("a Retry that every page was sent in full: says so, and why", async () => {
    postMock.mockResolvedValue(
      ok(
        audience({
          statusPages: [],
          excludedStatusPages: [
            {
              statusPageId: SITE_07,
              name: "Site 07",
              reason: IncidentSubscriberAudienceExclusionReason.AlreadyNotified,
            },
          ],
        }),
      ),
    );

    render(
      <SubscriberAudienceSummary
        request={{
          incidentId: INCIDENT_ID,
          excludeStatusPagesNotifiedOnCreation: true,
        }}
        saysWhenNobodyIsNotified={true}
      />,
    );

    expect(
      await screen.findByText(
        IncidentStatusPageScopeCopy.audienceNoStatusPages,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Site 07 (already sent this notification in full)"),
    ).toBeInTheDocument();
    expect(requestOf().data).toEqual({
      incidentId: INCIDENT_ID,
      excludeStatusPagesNotifiedOnCreation: true,
    });
  });
});

describe("SubscriberAudienceSummary without a request", () => {
  test("no request renders nothing and asks nothing", async () => {
    const { container } = render(<SubscriberAudienceSummary request={null} />);

    expect(container).toBeEmptyDOMElement();

    await new Promise((r: (value: unknown) => void) => {
      setTimeout(r, SUBSCRIBER_AUDIENCE_DEBOUNCE_MS + 50);
    });

    expect(postMock).not.toHaveBeenCalled();
  });

  test("nor in a confirmation", () => {
    const { container } = render(
      <SubscriberAudienceSummary
        request={null}
        saysWhenNobodyIsNotified={true}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(postMock).not.toHaveBeenCalled();
  });

  test("a request going away mid-flight takes the summary with it", async () => {
    const { container, rerender } = render(
      <SubscriberAudienceSummary request={{ incidentId: INCIDENT_ID }} />,
    );

    expect(await screen.findByText("Will notify:")).toBeInTheDocument();

    // 'Notify Status Page Subscribers' is unticked: nothing is asked.
    rerender(<SubscriberAudienceSummary request={null} />);

    expect(container).toBeEmptyDOMElement();
    expect(postMock).toHaveBeenCalledTimes(1);
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
