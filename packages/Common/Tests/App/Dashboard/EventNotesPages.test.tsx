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
import React, { FunctionComponent, ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Every note page in the dashboard - public and private notes of incidents,
 * alerts, scheduled maintenance events and both kinds of episode - is a thin
 * wrapper around one notes feed. This pins what each page hands the feed: the
 * right note model and parent column, the download route for its files (or
 * none, where the note type has no such route), its templates and where they
 * are managed, its "Draft with AI" endpoint, and the link to the other kind
 * of note on the same event. It also pins that a new event gets a new feed,
 * so a draft can never be posted on the wrong one.
 */

type RecordedFeedProps = {
  modelType: unknown;
  visibility: string;
  eventNoun: string;
  parentIdField: string;
  parentId: { toString: () => string };
  attachmentApiPath?: string;
  subscriberNotifications?: unknown;
  templates?: {
    modelType: unknown;
    settingsRoute?: { toString: () => string };
  };
  ai?: {
    title: string;
    description: string;
    templates: Array<unknown>;
    generate: (data: { template?: string }) => Promise<string>;
  };
  siblingRoute?: { toString: () => string };
};

let feedRenders: Array<RecordedFeedProps> = [];
let feedMounts: Array<string> = [];

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
          feedMounts.push(props.parentId.toString());
        }, []);
        return <div data-testid="event-notes-feed" />;
      },
    };
  },
);

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "11111111-1111-4111-8111-111111111111" };
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
import IncidentInternalNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/InternalNote";
import AlertInternalNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/InternalNote";
import ScheduledMaintenancePublicNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/PublicNote";
import ScheduledMaintenanceInternalNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/InternalNote";
import IncidentEpisodePublicNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/PublicNote";
import IncidentEpisodeInternalNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/InternalNote";
import AlertEpisodeInternalNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/InternalNote";
import { getNoteGenerator } from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/GenerateNoteWithAI";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import AlertEpisodeInternalNote from "../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import AlertNoteTemplate from "../../../Models/DatabaseModels/AlertNoteTemplate";
import IncidentEpisodeInternalNote from "../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenanceInternalNote from "../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceNoteTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  INTERNAL_NOTE_TEMPLATES,
  PUBLIC_NOTE_TEMPLATES,
} from "../../../UI/Components/AI/AITemplates";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const EVENT_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_EVENT_ID: string = "33333333-3333-4333-8333-333333333333";

interface NotePageCase {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  visibility: "public" | "private";
  noteModel: unknown;
  eventNoun: string;
  parentIdField: string;
  attachmentApiPath: string | undefined;
  templateModel: unknown;
  templatesPath: string;
  ai?:
    | {
        endpoint: string;
        noteType: "public" | "internal" | undefined;
        title: string;
        templates: Array<unknown>;
      }
    | undefined;
  siblingPath?: string | undefined;
}

const INCIDENTS: string = `/dashboard/${PROJECT_ID}/incidents`;
const ALERTS: string = `/dashboard/${PROJECT_ID}/alerts`;
const MAINTENANCE: string = `/dashboard/${PROJECT_ID}/scheduled-maintenance-events`;

const PAGES: Array<NotePageCase> = [
  {
    name: "incident public notes",
    Page: IncidentPublicNotePage,
    visibility: "public",
    noteModel: IncidentPublicNote,
    eventNoun: "incident",
    parentIdField: "incidentId",
    attachmentApiPath: "/incident-public-note/attachment",
    templateModel: IncidentNoteTemplate,
    templatesPath: `${INCIDENTS}/settings/note-templates`,
    ai: {
      endpoint: `/incident/generate-note-from-ai/${EVENT_ID}`,
      noteType: "public",
      title: "Generate Public Note with AI",
      templates: PUBLIC_NOTE_TEMPLATES,
    },
    siblingPath: `${INCIDENTS}/${EVENT_ID}/internal-notes`,
  },
  {
    name: "incident private notes",
    Page: IncidentInternalNotePage,
    visibility: "private",
    noteModel: IncidentInternalNote,
    eventNoun: "incident",
    parentIdField: "incidentId",
    attachmentApiPath: "/incident-internal-note/attachment",
    templateModel: IncidentNoteTemplate,
    templatesPath: `${INCIDENTS}/settings/note-templates`,
    ai: {
      endpoint: `/incident/generate-note-from-ai/${EVENT_ID}`,
      noteType: "internal",
      title: "Generate Private Note with AI",
      templates: INTERNAL_NOTE_TEMPLATES,
    },
    siblingPath: `${INCIDENTS}/${EVENT_ID}/public-notes`,
  },
  {
    name: "alert private notes",
    Page: AlertInternalNotePage,
    visibility: "private",
    noteModel: AlertInternalNote,
    eventNoun: "alert",
    parentIdField: "alertId",
    attachmentApiPath: "/alert-internal-note/attachment",
    templateModel: AlertNoteTemplate,
    templatesPath: `${ALERTS}/settings/note-templates`,
    ai: {
      endpoint: `/alert/generate-note-from-ai/${EVENT_ID}`,
      // Alerts only have private notes; their endpoint takes no type.
      noteType: undefined,
      title: "Generate Private Note with AI",
      templates: INTERNAL_NOTE_TEMPLATES,
    },
    siblingPath: undefined,
  },
  {
    name: "scheduled maintenance public notes",
    Page: ScheduledMaintenancePublicNotePage,
    visibility: "public",
    noteModel: ScheduledMaintenancePublicNote,
    eventNoun: "scheduled maintenance event",
    parentIdField: "scheduledMaintenanceId",
    attachmentApiPath: "/scheduled-maintenance-public-note/attachment",
    templateModel: ScheduledMaintenanceNoteTemplate,
    templatesPath: `${MAINTENANCE}/settings/note-templates`,
    ai: {
      endpoint: `/scheduled-maintenance/generate-note-from-ai/${EVENT_ID}`,
      noteType: "public",
      title: "Generate Public Note with AI",
      templates: PUBLIC_NOTE_TEMPLATES,
    },
    siblingPath: `${MAINTENANCE}/${EVENT_ID}/internal-notes`,
  },
  {
    name: "scheduled maintenance private notes",
    Page: ScheduledMaintenanceInternalNotePage,
    visibility: "private",
    noteModel: ScheduledMaintenanceInternalNote,
    eventNoun: "scheduled maintenance event",
    parentIdField: "scheduledMaintenanceId",
    attachmentApiPath: "/scheduled-maintenance-internal-note/attachment",
    templateModel: ScheduledMaintenanceNoteTemplate,
    templatesPath: `${MAINTENANCE}/settings/note-templates`,
    ai: {
      endpoint: `/scheduled-maintenance/generate-note-from-ai/${EVENT_ID}`,
      noteType: "internal",
      title: "Generate Private Note with AI",
      templates: INTERNAL_NOTE_TEMPLATES,
    },
    siblingPath: `${MAINTENANCE}/${EVENT_ID}/public-notes`,
  },
  {
    name: "incident episode public notes",
    Page: IncidentEpisodePublicNotePage,
    visibility: "public",
    noteModel: IncidentEpisodePublicNote,
    eventNoun: "episode",
    parentIdField: "incidentEpisodeId",
    attachmentApiPath: "/incident-episode-public-note/attachment",
    templateModel: IncidentNoteTemplate,
    templatesPath: `${INCIDENTS}/settings/note-templates`,
    siblingPath: `${INCIDENTS}/episodes/${EVENT_ID}/internal-notes`,
  },
  {
    name: "incident episode private notes",
    Page: IncidentEpisodeInternalNotePage,
    visibility: "private",
    noteModel: IncidentEpisodeInternalNote,
    eventNoun: "episode",
    parentIdField: "incidentEpisodeId",
    // Episode private notes have no download route for files.
    attachmentApiPath: undefined,
    templateModel: IncidentNoteTemplate,
    templatesPath: `${INCIDENTS}/settings/note-templates`,
    siblingPath: `${INCIDENTS}/episodes/${EVENT_ID}/public-notes`,
  },
  {
    name: "alert episode private notes",
    Page: AlertEpisodeInternalNotePage,
    visibility: "private",
    noteModel: AlertEpisodeInternalNote,
    eventNoun: "episode",
    parentIdField: "alertEpisodeId",
    attachmentApiPath: undefined,
    templateModel: AlertNoteTemplate,
    templatesPath: `${ALERTS}/settings/note-templates`,
    siblingPath: undefined,
  },
];

let currentEventId: string = EVENT_ID;

function buildProject(): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID;
  return project;
}

beforeEach(() => {
  currentEventId = EVENT_ID;
  feedRenders = [];
  feedMounts = [];
  // Public pages look up their event's notify setting first.
  getItemMock.mockImplementation(async () => {
    return null;
  });
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

describe.each(PAGES)("$name", (page: NotePageCase) => {
  function element(): ReactElement {
    return (
      <page.Page
        pageRoute={new Route("/dashboard/notes")}
        currentProject={buildProject()}
        hasPaymentMethod={true}
      />
    );
  }

  async function renderPage(): Promise<RenderResult> {
    const view: RenderResult = render(element());
    await screen.findByTestId("event-notes-feed");
    return view;
  }

  function feed(): RecordedFeedProps {
    return feedRenders[feedRenders.length - 1]!;
  }

  test("draws this event's notes of the right kind", async () => {
    await renderPage();

    expect(feed().modelType).toBe(page.noteModel);
    expect(feed().visibility).toBe(page.visibility);
    expect(feed().eventNoun).toBe(page.eventNoun);
    expect(feed().parentIdField).toBe(page.parentIdField);
    expect(feed().parentId.toString()).toBe(EVENT_ID);
  });

  test("offers files only where the note type can serve them back", async () => {
    await renderPage();

    expect(feed().attachmentApiPath).toBe(page.attachmentApiPath);
  });

  test("offers this area's note templates and links to where they are managed", async () => {
    await renderPage();

    expect(feed().templates?.modelType).toBe(page.templateModel);
    expect(feed().templates?.settingsRoute?.toString()).toBe(
      page.templatesPath,
    );
  });

  test("links to the other kind of note on the same event, where there is one", async () => {
    await renderPage();

    expect(feed().siblingRoute?.toString()).toBe(page.siblingPath);
  });

  test("only public pages carry a subscriber notification setting", async () => {
    await renderPage();

    if (page.visibility === "public") {
      expect(feed().subscriberNotifications).toBeDefined();
    } else {
      expect(feed().subscriberNotifications).toBeUndefined();
    }
  });

  if (page.ai) {
    const ai: NonNullable<NotePageCase["ai"]> = page.ai;

    test("drafts with AI through this event's endpoint", async () => {
      const post: MockFunction = jest
        .spyOn(API, "post")
        .mockResolvedValue(
          new HTTPResponse(200, { note: "Drafted." }, {}) as never,
        ) as unknown as MockFunction;
      await renderPage();

      expect(feed().ai?.title).toBe(ai.title);
      expect(feed().ai?.templates).toBe(ai.templates);

      await expect(feed().ai!.generate({ template: "Status" })).resolves.toBe(
        "Drafted.",
      );

      const request: {
        url: { toString: () => string };
        data: Record<string, unknown>;
      } = post.mock.calls[0]![0] as unknown as {
        url: { toString: () => string };
        data: Record<string, unknown>;
      };
      expect(request.url.toString()).toMatch(new RegExp(`${ai.endpoint}$`));
      expect(request.data).toEqual(
        ai.noteType
          ? { template: "Status", noteType: ai.noteType }
          : { template: "Status" },
      );
    });
  } else {
    test("offers no AI drafting", async () => {
      await renderPage();

      expect(feed().ai).toBeUndefined();
    });
  }

  test("a new event gets a new feed, so no draft follows you there", async () => {
    const view: RenderResult = await renderPage();

    currentEventId = OTHER_EVENT_ID;
    view.rerender(element());
    await screen.findByTestId("event-notes-feed");

    expect(feedMounts[0]).toBe(EVENT_ID);
    expect(feedMounts[feedMounts.length - 1]).toBe(OTHER_EVENT_ID);
    expect(feed().parentId.toString()).toBe(OTHER_EVENT_ID);
  });
});

describe("getNoteGenerator", () => {
  test("surfaces the server's refusal as the error", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(
          400,
          { message: "No LLM provider is configured." },
          {},
        ) as never,
      );

    await expect(
      getNoteGenerator({
        apiPath: "/incident/generate-note-from-ai",
        eventId: new ObjectID(EVENT_ID),
        noteType: "public",
      })({ template: "x" }),
    ).rejects.toThrow("No LLM provider is configured.");
  });

  test("falls back to a generic message when the refusal has none", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(new HTTPErrorResponse(500, {}, {}) as never);

    await expect(
      getNoteGenerator({
        apiPath: "/alert/generate-note-from-ai",
        eventId: new ObjectID(EVENT_ID),
      })({}),
    ).rejects.toThrow();
  });
});
