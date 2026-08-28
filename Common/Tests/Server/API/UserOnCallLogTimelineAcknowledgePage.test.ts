/*
 * The alert/incident services reach the isolated-vm native addon through the
 * template renderer they import. Nothing here runs a sandbox, and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import { mockRouter } from "./Helpers";
import UserNotificationLogTimelineAPI from "../../../Server/API/UserOnCallLogTimelineAPI";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GET /user-notification-log-timeline/acknowledge-page/:itemId - the page
 * https://github.com/OneUptime/oneuptime/issues/3457 was filed about.
 *
 * It is reached from an SMS, an email or a push notification, by somebody who
 * has not logged in and, quite possibly, has just been woken up. It used to
 * render the notification's title and a button and nothing else. These tests
 * pin what the route now hands the template for each of the four things that
 * can page a person, and that the button survives when the context does not.
 *
 * The database is stubbed throughout. OnCallNotificationContext.test.ts covers
 * how each resource becomes rows; what is left worth testing here is the wiring
 * between the route, the read and the view.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    render: jest.fn(),
    redirect: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
  };
});

const ACKNOWLEDGE_PAGE_ROUTE: string =
  "/user-notification-log-timeline/acknowledge-page/:itemId";

const ACKNOWLEDGE_ROUTE: string =
  "/user-notification-log-timeline/acknowledge/:itemId";

const RAISED_AT: Date = new Date(Date.UTC(2026, 0, 15, 9, 30, 0));

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type CallRoute = (uri: string, itemId: string) => Promise<void>;

const callRoute: CallRoute = async (
  uri: string,
  itemId: string,
): Promise<void> => {
  const handler: RouterFunction = mockRouter.match("GET", uri)
    .handlerFunction as RouterFunction;

  await handler(
    { params: { itemId: itemId } } as unknown as ExpressRequest,
    {} as unknown as ExpressResponse,
    (() => {
      throw new Error("the route handler must not fall through to next()");
    }) as unknown as NextFunction,
  );
};

type RenderedVariables = () => JSONObject;

const renderedVariables: RenderedVariables = (): JSONObject => {
  const render: jest.Mock = Response.render as unknown as jest.Mock;

  expect(render).toHaveBeenCalledTimes(1);

  return render.mock.calls[0]?.[3] as JSONObject;
};

type RenderedPath = () => string;

const renderedPath: RenderedPath = (): string => {
  const render: jest.Mock = Response.render as unknown as jest.Mock;

  return render.mock.calls[0]?.[2] as string;
};

type DetailValue = (variables: JSONObject, label: string) => string | undefined;

const detailValue: DetailValue = (
  variables: JSONObject,
  label: string,
): string | undefined => {
  const details: Array<JSONObject> = (variables["details"] ||
    []) as Array<JSONObject>;

  return details.find((detail: JSONObject): boolean => {
    return detail["label"] === label;
  })?.["value"] as string | undefined;
};

type BuildTimelineItem = (
  overrides: Partial<UserOnCallLogTimeline>,
) => UserOnCallLogTimeline;

const buildTimelineItem: BuildTimelineItem = (
  overrides: Partial<UserOnCallLogTimeline>,
): UserOnCallLogTimeline => {
  const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  timelineItem.projectId = ObjectID.generate();

  const user: User = new User();
  user.timezone = Timezone.AmericaNew_York;
  timelineItem.user = user;

  Object.assign(timelineItem, overrides);

  return timelineItem;
};

describe("the acknowledge page route", () => {
  beforeAll(() => {
    new UserNotificationLogTimelineAPI();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    (Response.render as unknown as jest.Mock).mockClear();
    (Response.redirect as unknown as jest.Mock).mockClear();
    (Response.sendErrorResponse as unknown as jest.Mock).mockClear();

    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(new Hostname("oneuptime.example.com"));
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS);
  });

  test("is registered", () => {
    expect(mockRouter.match("GET", ACKNOWLEDGE_PAGE_ROUTE)).toBeTruthy();
  });

  describe("an alert", () => {
    beforeEach(() => {
      const alertId: ObjectID = ObjectID.generate();

      jest.spyOn(UserOnCallLogTimelineService, "findOneById").mockResolvedValue(
        buildTimelineItem({
          triggeredByAlertId: alertId,
        }),
      );

      const alert: Alert = new Alert();
      alert.title = "CPU above 90% on prod-web-1";
      alert.description = "CPU has been pinned for fifteen minutes.";
      alert.createdAt = RAISED_AT;
      alert.alertNumberWithPrefix = "ALT-42";

      const project: Project = new Project();
      project.name = "Acme Production";
      alert.project = project;

      const monitor: Monitor = new Monitor();
      monitor.name = "prod-web-1 CPU";
      alert.monitor = monitor;

      const severity: AlertSeverity = new AlertSeverity();
      severity.name = "Critical";
      severity.color = new Color("#dc2626");
      alert.alertSeverity = severity;

      const state: AlertState = new AlertState();
      state.name = "Created";
      alert.currentAlertState = state;

      jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);
    });

    test("renders the acknowledge page", async () => {
      await callRoute(ACKNOWLEDGE_PAGE_ROUTE, ObjectID.generate().toString());

      expect(renderedPath()).toContain("AcknowledgeUserOnCallNotification.ejs");
    });

    test("hands the view the severity, state, project, monitor and time raised", async () => {
      await callRoute(ACKNOWLEDGE_PAGE_ROUTE, ObjectID.generate().toString());

      const variables: JSONObject = renderedVariables();

      expect(detailValue(variables, "Severity")).toBe("Critical");
      expect(detailValue(variables, "Current State")).toBe("Created");
      expect(detailValue(variables, "Project")).toBe("Acme Production");
      expect(detailValue(variables, "Monitor")).toBe("prod-web-1 CPU");
      expect(detailValue(variables, "Raised At")).toBe(
        "Jan 15, 2026, 4:30 AM EST",
      );
    });

    test("hands the view the title, number and description", async () => {
      await callRoute(ACKNOWLEDGE_PAGE_ROUTE, ObjectID.generate().toString());

      const variables: JSONObject = renderedVariables();

      expect(variables["resourceTitle"]).toBe("CPU above 90% on prod-web-1");
      expect(variables["resourceNumber"]).toBe("ALT-42");
      expect(variables["resourceDescription"]).toBe(
        "CPU has been pinned for fifteen minutes.",
      );
    });

    test("keeps the wording and the acknowledge link it always had", async () => {
      const itemId: string = ObjectID.generate().toString();

      await callRoute(ACKNOWLEDGE_PAGE_ROUTE, itemId);

      const variables: JSONObject = renderedVariables();

      expect(variables["title"]).toBe(
        "Acknowledge Alert - CPU above 90% on prod-web-1",
      );
      expect(variables["message"]).toBe(
        "Do you want to acknowledge this Alert?",
      );
      expect(variables["acknowledgeText"]).toBe("Acknowledge Alert");
      expect(variables["acknowledgeUrl"]).toBe(
        `https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/${itemId}`,
      );
    });

    test("renders the timestamps in the recipient's own timezone", async () => {
      /*
       * Not the container's. The page is rendered server-side, so the process
       * timezone is whatever the deployment happens to run in.
       */
      await callRoute(ACKNOWLEDGE_PAGE_ROUTE, ObjectID.generate().toString());

      expect(detailValue(renderedVariables(), "Raised At")).toContain("EST");
    });
  });

  describe("an incident", () => {
    beforeEach(() => {
      jest.spyOn(UserOnCallLogTimelineService, "findOneById").mockResolvedValue(
        buildTimelineItem({
          triggeredByIncidentId: ObjectID.generate(),
        }),
      );

      const incident: Incident = new Incident();
      incident.title = "Checkout is down";
      incident.declaredAt = RAISED_AT;
      incident.incidentNumberWithPrefix = "INC-7";

      const monitor: Monitor = new Monitor();
      monitor.name = "Checkout API";
      incident.monitors = [monitor];

      const severity: IncidentSeverity = new IncidentSeverity();
      severity.name = "SEV1";
      incident.incidentSeverity = severity;

      jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);
    });

    test("says Incident everywhere the page names the resource type", async () => {
      await callRoute(ACKNOWLEDGE_PAGE_ROUTE, ObjectID.generate().toString());

      const variables: JSONObject = renderedVariables();

      expect(variables["title"]).toBe(
        "Acknowledge Incident - Checkout is down",
      );
      expect(variables["message"]).toBe(
        "Do you want to acknowledge this Incident?",
      );
      expect(variables["acknowledgeText"]).toBe("Acknowledge Incident");
    });

    test("hands the view the incident's own rows", async () => {
      await callRoute(ACKNOWLEDGE_PAGE_ROUTE, ObjectID.generate().toString());

      const variables: JSONObject = renderedVariables();

      expect(variables["resourceNumber"]).toBe("INC-7");
      expect(detailValue(variables, "Severity")).toBe("SEV1");
      expect(detailValue(variables, "Monitors")).toBe("Checkout API");
      expect(detailValue(variables, "Declared At")).toBe(
        "Jan 15, 2026, 4:30 AM EST",
      );
    });
  });

  describe("an alert episode", () => {
    beforeEach(() => {
      jest.spyOn(UserOnCallLogTimelineService, "findOneById").mockResolvedValue(
        buildTimelineItem({
          triggeredByAlertEpisodeId: ObjectID.generate(),
        }),
      );

      const episode: AlertEpisode = new AlertEpisode();
      episode.title = "Elevated error rate";
      episode.createdAt = RAISED_AT;
      episode.alertCount = 5;
      episode.episodeNumberWithPrefix = "AEP-3";

      jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue(episode);
    });

    test("says Alert Episode and carries the episode's rows", async () => {
      await callRoute(ACKNOWLEDGE_PAGE_ROUTE, ObjectID.generate().toString());

      const variables: JSONObject = renderedVariables();

      expect(variables["title"]).toBe(
        "Acknowledge Alert Episode - Elevated error rate",
      );
      expect(variables["acknowledgeText"]).toBe("Acknowledge Alert Episode");
      expect(variables["resourceNumber"]).toBe("AEP-3");
      expect(detailValue(variables, "Alerts In Episode")).toBe("5");
    });
  });

  describe("an incident episode", () => {
    beforeEach(() => {
      jest.spyOn(UserOnCallLogTimelineService, "findOneById").mockResolvedValue(
        buildTimelineItem({
          triggeredByIncidentEpisodeId: ObjectID.generate(),
        }),
      );

      const episode: IncidentEpisode = new IncidentEpisode();
      episode.title = "Payments degradation";
      episode.declaredAt = RAISED_AT;
      episode.incidentCount = 2;
      episode.episodeNumberWithPrefix = "IEP-9";

      jest
        .spyOn(IncidentEpisodeService, "findOneById")
        .mockResolvedValue(episode);
    });

    test("says Incident Episode and carries the episode's rows", async () => {
      await callRoute(ACKNOWLEDGE_PAGE_ROUTE, ObjectID.generate().toString());

      const variables: JSONObject = renderedVariables();

      expect(variables["title"]).toBe(
        "Acknowledge Incident Episode - Payments degradation",
      );
      expect(variables["acknowledgeText"]).toBe("Acknowledge Incident Episode");
      expect(variables["resourceNumber"]).toBe("IEP-9");
      expect(detailValue(variables, "Incidents In Episode")).toBe("2");
    });
  });

  describe("when the resource has been deleted", () => {
    /*
     * The context read is best effort. Losing the description must never cost
     * the engineer the button - the notification is still theirs to
     * acknowledge.
     */
    beforeEach(() => {
      const alertModel: Alert = new Alert();
      alertModel.title = "CPU above 90% on prod-web-1";

      jest.spyOn(UserOnCallLogTimelineService, "findOneById").mockResolvedValue(
        buildTimelineItem({
          triggeredByAlertId: ObjectID.generate(),
          triggeredByAlert: alertModel,
        }),
      );

      jest.spyOn(AlertService, "findOneById").mockResolvedValue(null);
    });

    test("still renders an acknowledgeable page", async () => {
      const itemId: string = ObjectID.generate().toString();

      await callRoute(ACKNOWLEDGE_PAGE_ROUTE, itemId);

      const variables: JSONObject = renderedVariables();

      expect(variables["acknowledgeText"]).toBe("Acknowledge Alert");
      expect(variables["acknowledgeUrl"]).toBe(
        `https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/${itemId}`,
      );
      expect(variables["details"]).toEqual([]);
    });

    test("falls back to the title the timeline row kept", async () => {
      await callRoute(ACKNOWLEDGE_PAGE_ROUTE, ObjectID.generate().toString());

      const variables: JSONObject = renderedVariables();

      expect(variables["title"]).toBe(
        "Acknowledge Alert - CPU above 90% on prod-web-1",
      );
      expect(variables["resourceTitle"]).toBe("CPU above 90% on prod-web-1");
    });
  });

  describe("when the timeline row does not exist", () => {
    test("refuses rather than rendering", async () => {
      jest
        .spyOn(UserOnCallLogTimelineService, "findOneById")
        .mockResolvedValue(null);

      await callRoute(ACKNOWLEDGE_PAGE_ROUTE, ObjectID.generate().toString());

      expect(Response.render).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    });
  });
});

describe("the acknowledge route", () => {
  beforeAll(() => {
    new UserNotificationLogTimelineAPI();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    (Response.render as unknown as jest.Mock).mockClear();
    (Response.redirect as unknown as jest.Mock).mockClear();
    (Response.sendErrorResponse as unknown as jest.Mock).mockClear();

    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(new Hostname("oneuptime.example.com"));
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS);
  });

  test("acknowledges and redirects to the resource in the dashboard", async () => {
    const alertId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();

    const timelineItem: UserOnCallLogTimeline = buildTimelineItem({
      projectId: projectId,
      triggeredByAlertId: alertId,
    });

    jest
      .spyOn(UserOnCallLogTimelineService, "findOneById")
      .mockResolvedValue(timelineItem);

    const updateOneById: jest.Mock = jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(1) as unknown as jest.Mock;

    await callRoute(ACKNOWLEDGE_ROUTE, ObjectID.generate().toString());

    expect(updateOneById).toHaveBeenCalledTimes(1);

    const redirect: jest.Mock = Response.redirect as unknown as jest.Mock;

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(String(redirect.mock.calls[0]?.[2])).toBe(
      `https://oneuptime.example.com/dashboard/${projectId.toString()}/alerts/${alertId.toString()}`,
    );
  });

  test("routes an alert episode to the episode page", async () => {
    const episodeId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();

    jest.spyOn(UserOnCallLogTimelineService, "findOneById").mockResolvedValue(
      buildTimelineItem({
        projectId: projectId,
        triggeredByAlertEpisodeId: episodeId,
      }),
    );

    jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(1);

    await callRoute(ACKNOWLEDGE_ROUTE, ObjectID.generate().toString());

    const redirect: jest.Mock = Response.redirect as unknown as jest.Mock;

    expect(String(redirect.mock.calls[0]?.[2])).toBe(
      `https://oneuptime.example.com/dashboard/${projectId.toString()}/alerts/episodes/${episodeId.toString()}`,
    );
  });

  test("routes an incident episode to the episode page", async () => {
    const episodeId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();

    jest.spyOn(UserOnCallLogTimelineService, "findOneById").mockResolvedValue(
      buildTimelineItem({
        projectId: projectId,
        triggeredByIncidentEpisodeId: episodeId,
      }),
    );

    jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(1);

    await callRoute(ACKNOWLEDGE_ROUTE, ObjectID.generate().toString());

    const redirect: jest.Mock = Response.redirect as unknown as jest.Mock;

    expect(String(redirect.mock.calls[0]?.[2])).toBe(
      `https://oneuptime.example.com/dashboard/${projectId.toString()}/incidents/episodes/${episodeId.toString()}`,
    );
  });

  test("shows the same context on the already-acknowledged page", async () => {
    /*
     * Following the link twice - or a colleague getting there first - used to
     * land on a page as bare as the one the issue was about.
     */
    const alertId: ObjectID = ObjectID.generate();

    jest.spyOn(UserOnCallLogTimelineService, "findOneById").mockResolvedValue(
      buildTimelineItem({
        triggeredByAlertId: alertId,
        isAcknowledged: true,
      }),
    );

    const alert: Alert = new Alert();
    alert.title = "CPU above 90% on prod-web-1";
    alert.createdAt = RAISED_AT;

    const severity: AlertSeverity = new AlertSeverity();
    severity.name = "Critical";
    alert.alertSeverity = severity;

    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);

    const updateOneById: jest.Mock = jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(1) as unknown as jest.Mock;

    await callRoute(ACKNOWLEDGE_ROUTE, ObjectID.generate().toString());

    expect(updateOneById).not.toHaveBeenCalled();
    expect(renderedPath()).toContain("ViewMessage.ejs");

    const variables: JSONObject = renderedVariables();

    expect(variables["title"]).toBe(
      "Notification Already Acknowledged - CPU above 90% on prod-web-1",
    );
    expect(variables["viewDetailsText"]).toBe("View Alert");
    expect(detailValue(variables, "Severity")).toBe("Critical");
  });

  test("refuses a notification that points at nothing", async () => {
    jest
      .spyOn(UserOnCallLogTimelineService, "findOneById")
      .mockResolvedValue(buildTimelineItem({}));

    jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(1);

    await callRoute(ACKNOWLEDGE_ROUTE, ObjectID.generate().toString());

    expect(Response.redirect).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
  });
});
