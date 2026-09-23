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
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Incidents, Scheduled Maintenance and Incident Episodes > View > Public
 * Notes.
 *
 * An event created without notifying status page subscribers (a quiet or
 * private incident, a maintenance event or an episode created with its notify
 * setting off) should not have its first public note be what tells them. Each
 * public note page therefore loads the event's own flag before it draws the
 * notes feed, and hands the feed where "Notify status page subscribers"
 * starts, and why.
 *
 * The feed (Components/EventNotes/EventNotes) is a prop recorder here: what is
 * under test is what each page hands it and when. The feed's own behaviour -
 * that the flag it is handed is what gets posted - is pinned in
 * EventNotes.test.tsx.
 */

const getItemMock: MockFunction = getJestMockFunction();

type RecordedFeedProps = {
  modelType: unknown;
  visibility: string;
  eventNoun: string;
  parentIdField: string;
  parentId: { toString: () => string };
  currentProject: unknown;
  attachmentApiPath?: string;
  subscriberNotifications?: {
    isNotifyingByDefault: boolean;
    quietDescription: string;
  };
};

let feedRenders: Array<RecordedFeedProps> = [];
let feedMounts: Array<string> = [];
let feedUnmounts: Array<string> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotes",
  () => {
    const ReactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;
    return {
      __esModule: true,
      default: (props: RecordedFeedProps): ReactElement => {
        feedRenders.push(props);
        ReactModule.useEffect(() => {
          const id: string = props.parentId.toString();
          feedMounts.push(id);
          return () => {
            feedUnmounts.push(id);
          };
        }, []);
        return <div data-testid="event-notes-feed" />;
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
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

import IncidentPublicNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/PublicNote";
import ScheduledMaintenancePublicNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/PublicNote";
import IncidentEpisodePublicNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/PublicNote";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import Navigation from "../../../UI/Utils/Navigation";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const EVENT_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_EVENT_ID: string = "33333333-3333-4333-8333-333333333333";

interface PublicNotePageCase {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  parentModel: { new (): BaseModel };
  flag: string;
  quietDescription: string;
  noteModel: unknown;
  parentIdField: string;
  eventNoun: string;
  attachmentApiPath: string;
}

const PAGES: Array<PublicNotePageCase> = [
  {
    name: "incident",
    Page: IncidentPublicNotePage,
    parentModel: Incident,
    flag: "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    quietDescription:
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
    noteModel: IncidentPublicNote,
    parentIdField: "incidentId",
    eventNoun: "incident",
    attachmentApiPath: "/incident-public-note/attachment",
  },
  {
    name: "scheduled maintenance event",
    Page: ScheduledMaintenancePublicNotePage,
    parentModel: ScheduledMaintenance,
    flag: "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
    quietDescription:
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    noteModel: ScheduledMaintenancePublicNote,
    parentIdField: "scheduledMaintenanceId",
    eventNoun: "scheduled maintenance event",
    attachmentApiPath: "/scheduled-maintenance-public-note/attachment",
  },
  {
    name: "incident episode",
    Page: IncidentEpisodePublicNotePage,
    parentModel: IncidentEpisode,
    flag: "shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated",
    quietDescription:
      PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
    noteModel: IncidentEpisodePublicNote,
    parentIdField: "incidentEpisodeId",
    eventNoun: "episode",
    attachmentApiPath: "/incident-episode-public-note/attachment",
  },
];

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (reason: unknown) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (
      promiseResolve: (value: T) => void,
      promiseReject: (reason: unknown) => void,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );
  return { promise, resolve, reject };
}

type ItemRequest = {
  modelType: unknown;
  id?: ObjectID;
  select?: Record<string, unknown>;
};

let currentEventId: string = EVENT_ID;

beforeEach(() => {
  currentEventId = EVENT_ID;
  feedRenders = [];
  feedMounts = [];
  feedUnmounts = [];

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(currentEventId);
    });
});

afterEach(() => {
  cleanup();
  getItemMock.mockReset();
  jest.restoreAllMocks();
});

describe.each(PAGES)("$name public notes page", (page: PublicNotePageCase) => {
  function buildParent(id: string, notified: boolean | undefined): BaseModel {
    const parent: BaseModel = new page.parentModel();
    parent._id = id;
    if (notified !== undefined) {
      (parent as unknown as Record<string, unknown>)[page.flag] = notified;
    }
    return parent;
  }

  function buildProject(): Project {
    const project: Project = new Project();
    project._id = PROJECT_ID;
    return project;
  }

  function element(
    currentProject: Project | null = buildProject(),
  ): ReactElement {
    return (
      <page.Page
        pageRoute={new Route("/dashboard/notes")}
        currentProject={currentProject}
        hasPaymentMethod={true}
      />
    );
  }

  function parentRequests(): Array<ItemRequest> {
    return getItemMock.mock.calls
      .map((args: Array<unknown>) => {
        return args[0] as ItemRequest;
      })
      .filter((request: ItemRequest) => {
        return request.modelType === page.parentModel;
      });
  }

  function feed(): RecordedFeedProps {
    const latest: RecordedFeedProps | undefined =
      feedRenders[feedRenders.length - 1];
    if (!latest) {
      throw new Error("The page drew no notes feed");
    }
    return latest;
  }

  async function renderFor(
    notified: boolean | undefined,
  ): Promise<RenderResult> {
    getItemMock.mockImplementation((...args: Array<unknown>) => {
      const request: ItemRequest = args[0] as ItemRequest;
      return Promise.resolve(buildParent(request.id!.toString(), notified));
    });
    const view: RenderResult = render(element());
    await screen.findByTestId("event-notes-feed");
    return view;
  }

  describe("loading the event's notify setting", () => {
    test("asks once, by the event in the route, for only that event's flag", async () => {
      await renderFor(false);

      const requests: Array<ItemRequest> = parentRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0]!.id?.toString()).toBe(EVENT_ID);
      expect(requests[0]!.select).toEqual({ [page.flag]: true });
    });

    test("shows a loader and no feed until the event has loaded", async () => {
      const parent: Deferred<BaseModel | null> = createDeferred();
      getItemMock.mockReturnValue(parent.promise);

      render(element());

      expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
      expect(screen.queryByTestId("event-notes-feed")).toBeNull();
      expect(feedRenders).toHaveLength(0);

      await act(async () => {
        parent.resolve(buildParent(EVENT_ID, false));
      });

      expect(screen.getByTestId("event-notes-feed")).toBeInTheDocument();
      expect(screen.queryByTestId("bar-loader")).toBeNull();
      // The composer reads its start once: the first feed already knows.
      for (const props of feedRenders) {
        expect(props.subscriberNotifications?.isNotifyingByDefault).toBe(false);
      }
    });

    test("shows the error and no feed when the event cannot be loaded", async () => {
      getItemMock.mockReturnValue(
        Promise.reject(new Error("The event could not be loaded.")),
      );

      render(element());

      expect(
        await screen.findByText("The event could not be loaded."),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("event-notes-feed")).toBeNull();
      expect(screen.queryByTestId("bar-loader")).toBeNull();
    });
  });

  describe("where the notify box starts", () => {
    test("an event created without notifying subscribers starts it unticked, with the reason", async () => {
      await renderFor(false);

      expect(feed().subscriberNotifications).toEqual({
        isNotifyingByDefault: false,
        quietDescription: page.quietDescription,
      });
    });

    test.each([
      ["that notified subscribers", true],
      ["with no setting stored", undefined],
    ])(
      "an event %s starts it ticked",
      async (_label: string, notified: boolean | undefined) => {
        await renderFor(notified);

        expect(feed().subscriberNotifications?.isNotifyingByDefault).toBe(true);
        expect(feed().subscriberNotifications?.quietDescription).toBe(
          page.quietDescription,
        );
      },
    );

    test("an event the lookup does not find falls back to notifying", async () => {
      getItemMock.mockReturnValue(Promise.resolve(null));
      render(element());
      await screen.findByTestId("event-notes-feed");

      expect(feed().subscriberNotifications?.isNotifyingByDefault).toBe(true);
    });
  });

  describe("the feed it draws", () => {
    test("is this event's public notes, in this project", async () => {
      await renderFor(true);

      expect(feed().modelType).toBe(page.noteModel);
      expect(feed().visibility).toBe("public");
      expect(feed().eventNoun).toBe(page.eventNoun);
      expect(feed().parentIdField).toBe(page.parentIdField);
      expect(feed().parentId.toString()).toBe(EVENT_ID);
      expect((feed().currentProject as Project)._id).toBe(PROJECT_ID);
      expect(feed().attachmentApiPath).toBe(page.attachmentApiPath);
    });

    test("passes a missing project through for the feed to refuse", async () => {
      getItemMock.mockReturnValue(Promise.resolve(buildParent(EVENT_ID, true)));
      render(element(null));
      await screen.findByTestId("event-notes-feed");

      expect(feed().currentProject).toBeNull();
    });
  });

  describe("moving to another event", () => {
    test("ignores a slower answer for the event the page has already left", async () => {
      const first: Deferred<BaseModel | null> = createDeferred();
      const second: Deferred<BaseModel | null> = createDeferred();
      getItemMock.mockImplementation((...args: Array<unknown>) => {
        const request: ItemRequest = args[0] as ItemRequest;
        return request.id?.toString() === EVENT_ID
          ? first.promise
          : second.promise;
      });

      const view: RenderResult = render(element());
      currentEventId = OTHER_EVENT_ID;
      view.rerender(element());

      await waitFor(() => {
        expect(parentRequests()).toHaveLength(2);
      });

      await act(async () => {
        second.resolve(buildParent(OTHER_EVENT_ID, false));
      });
      await act(async () => {
        first.resolve(buildParent(EVENT_ID, true));
      });

      expect(feed().parentId.toString()).toBe(OTHER_EVENT_ID);
      expect(feed().subscriberNotifications?.isNotifyingByDefault).toBe(false);
    });

    test("ignores a slower failure for the event the page has already left", async () => {
      const first: Deferred<BaseModel | null> = createDeferred();
      getItemMock.mockImplementation((...args: Array<unknown>) => {
        const request: ItemRequest = args[0] as ItemRequest;
        return request.id?.toString() === EVENT_ID
          ? first.promise
          : Promise.resolve(buildParent(OTHER_EVENT_ID, true));
      });

      const view: RenderResult = render(element());
      currentEventId = OTHER_EVENT_ID;
      view.rerender(element());
      await screen.findByTestId("event-notes-feed");

      await act(async () => {
        first.reject(new Error("Old event failed."));
      });

      expect(screen.queryByText("Old event failed.")).toBeNull();
      expect(screen.getByTestId("event-notes-feed")).toBeInTheDocument();
    });

    test("waits for the next event's setting, and mounts a fresh feed for it", async () => {
      const view: RenderResult = await renderFor(true);
      expect(feedMounts).toEqual([EVENT_ID]);

      const next: Deferred<BaseModel | null> = createDeferred();
      getItemMock.mockReturnValue(next.promise);
      currentEventId = OTHER_EVENT_ID;
      view.rerender(element());

      await waitFor(() => {
        expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("event-notes-feed")).toBeNull();
      /*
       * The old feed - and any draft in it - is gone, and no feed was ever
       * drawn for the new event with the old event's setting.
       */
      expect(feedUnmounts).toEqual([EVENT_ID]);
      expect(feedMounts).toEqual([EVENT_ID]);

      feedRenders = [];
      await act(async () => {
        next.resolve(buildParent(OTHER_EVENT_ID, false));
      });

      expect(feedMounts).toEqual([EVENT_ID, OTHER_EVENT_ID]);
      for (const props of feedRenders) {
        expect(props.parentId.toString()).toBe(OTHER_EVENT_ID);
        expect(props.subscriberNotifications?.isNotifyingByDefault).toBe(false);
      }
    });

    test("an error for one event does not stick to the next", async () => {
      getItemMock.mockReturnValueOnce(
        Promise.reject(new Error("Could not load this one.")),
      );
      const view: RenderResult = render(element());
      expect(
        await screen.findByText("Could not load this one."),
      ).toBeInTheDocument();

      getItemMock.mockReturnValue(
        Promise.resolve(buildParent(OTHER_EVENT_ID, true)),
      );
      currentEventId = OTHER_EVENT_ID;
      view.rerender(element());

      await screen.findByTestId("event-notes-feed");
      expect(screen.queryByText("Could not load this one.")).toBeNull();
    });

    test("rendering the same event again neither reloads it nor replaces the feed", async () => {
      const view: RenderResult = await renderFor(true);

      view.rerender(element());
      view.rerender(element());

      expect(parentRequests()).toHaveLength(1);
      expect(feedMounts).toEqual([EVENT_ID]);
      expect(feedUnmounts).toEqual([]);
      expect(screen.queryByTestId("bar-loader")).toBeNull();
    });
  });
});
