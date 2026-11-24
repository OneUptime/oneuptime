import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import SecurityCaseFeed from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseFeed";
import { getSecurityCaseFeedKind } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseFeedKind";
import SecurityCaseFeedModel, {
  SecurityCaseFeedEventType,
} from "../../../Models/DatabaseModels/SecurityCaseFeed";
import { Blue500, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import {
  FeedEntryKind,
  FeedTone,
  SHARED_FEED_ENTRY_KINDS,
  getFeedEntryColor,
} from "../../../UI/Components/Feed/FeedEntryKind";

/*
 * ModelAPI is the only thing between a case's timeline and the network.
 * Stubbed inline, with the "mock" prefix jest requires of anything a hoisted
 * factory closes over, as ResourceFeed.test does: it answers with the rows a
 * test sets.
 */
let mockFeedRows: Array<SecurityCaseFeedModel> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (): Promise<unknown> => {
        return Promise.resolve({
          data: mockFeedRows,
          count: mockFeedRows.length,
        });
      },
    },
  };
});

/*
 * The real Icon draws an SVG that says nothing of which icon it is, or in
 * which color. This one names both, so each entry's look can be read back
 * off the page. Everything else the module exports stays real.
 */
jest.mock("../../../UI/Components/Icon/Icon", () => {
  const actualIconModule: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Icon/Icon",
  ) as Record<string, unknown>;

  return {
    ...actualIconModule,
    __esModule: true,
    default: (props: {
      icon: string;
      color?: { toString: () => string } | undefined;
    }): React.ReactElement => {
      return (
        <span
          data-icon={props.icon}
          data-color={props.color ? props.color.toString() : ""}
          aria-hidden="true"
        />
      );
    },
  };
});

/*
 * EVERY ENTRY ON A CASE'S TIMELINE DRAWS AS IT IS MEANT TO (#10340, #10352).
 *
 * getSecurityCaseFeedKind gives each event a case records its icon and
 * tone. #10676 gave a Response Plan step that stopped holding a look of its
 * own, an undo arrow; #10683 (#10352) gave it a shield in the same switch,
 * above it, so the shield won: the step drew as a case opening does, and
 * never as the undone step #10676 meant. Each event type is drawn here in
 * one timeline and read back by its event type: the icon it is meant to
 * have, and its color - its tone's, or for a Record entry the color the
 * server wrote it in. A case left in the switch below another of the same
 * event type changes what is drawn, and fails here.
 */

const CASE_ID: ObjectID = ObjectID.generate();

// The color each entry is written in: what a Record entry is drawn in.
const ROW_COLOR: Color = Blue500;

// What each event type is meant to look like, by its icon and its tone.
const MEANT_LOOKS: Record<
  SecurityCaseFeedEventType,
  Pick<FeedEntryKind, "icon" | "tone">
> = {
  [SecurityCaseFeedEventType.CaseOpened]: {
    icon: IconProp.ShieldExclamation,
    tone: FeedTone.Danger,
  },
  [SecurityCaseFeedEventType.DetectionAdded]: {
    icon: IconProp.Bolt,
    tone: FeedTone.Warning,
  },
  // As on an incident's timeline.
  [SecurityCaseFeedEventType.StatusChanged]:
    SHARED_FEED_ENTRY_KINDS.StateChanged,
  [SecurityCaseFeedEventType.PriorityChanged]:
    SHARED_FEED_ENTRY_KINDS.SeverityChanged,
  [SecurityCaseFeedEventType.AssigneeChanged]: {
    icon: IconProp.User,
    tone: FeedTone.People,
  },
  [SecurityCaseFeedEventType.CaseUpdated]: SHARED_FEED_ENTRY_KINDS.Updated,
  [SecurityCaseFeedEventType.PrivateNote]: SHARED_FEED_ENTRY_KINDS.PrivateNote,
  [SecurityCaseFeedEventType.PlaybookRun]: {
    icon: IconProp.Play,
    tone: FeedTone.Record,
  },
  [SecurityCaseFeedEventType.PlaybookStep]: {
    icon: IconProp.ChevronRight,
    tone: FeedTone.Record,
  },
  [SecurityCaseFeedEventType.ApprovalRequested]: {
    icon: IconProp.ExclaimationCircle,
    tone: FeedTone.Warning,
  },
  [SecurityCaseFeedEventType.ApprovalDecided]: {
    icon: IconProp.CheckCircle,
    tone: FeedTone.Record,
  },
  [SecurityCaseFeedEventType.ThreatIntel]: {
    icon: IconProp.Bug,
    tone: FeedTone.Warning,
  },
  [SecurityCaseFeedEventType.EntityActivity]: {
    icon: IconProp.MagnifyingGlass,
    tone: FeedTone.Info,
  },
  [SecurityCaseFeedEventType.Notification]: {
    icon: IconProp.Email,
    tone: FeedTone.Info,
  },
  [SecurityCaseFeedEventType.IncidentDeclared]: {
    icon: IconProp.Alert,
    tone: FeedTone.Danger,
  },
  [SecurityCaseFeedEventType.ResponseAction]: {
    icon: IconProp.ShieldCheck,
    tone: FeedTone.Record,
  },
  // OneUptime AI's triage reads as an AI investigation's report does.
  [SecurityCaseFeedEventType.AiTriage]: SHARED_FEED_ENTRY_KINDS.AIRootCause,
  // OneUptime AI working the case (#10352).
  [SecurityCaseFeedEventType.AiResponse]: {
    icon: IconProp.Sparkles,
    tone: FeedTone.AI,
  },
  [SecurityCaseFeedEventType.Task]: {
    icon: IconProp.ClipboardDocumentCheck,
    tone: FeedTone.Record,
  },
  [SecurityCaseFeedEventType.Evidence]: {
    icon: IconProp.PaperClip,
    tone: FeedTone.Record,
  },
  [SecurityCaseFeedEventType.ResponseTarget]: {
    icon: IconProp.Clock,
    tone: FeedTone.Record,
  },
  // A step that stopped holding (#10340): undone, in the server's red.
  [SecurityCaseFeedEventType.StepCheck]: {
    icon: IconProp.ArrowUturnLeft,
    tone: FeedTone.Record,
  },
};

const EVENT_TYPES: Array<SecurityCaseFeedEventType> = Object.values(
  SecurityCaseFeedEventType,
);

// The color the server writes an entry in: a step that stopped holding in red.
function rowColorOf(eventType: SecurityCaseFeedEventType): Color {
  return eventType === SecurityCaseFeedEventType.StepCheck ? Red500 : ROW_COLOR;
}

// One entry of an event type, a minute older than the one before it.
function rowOf(
  eventType: SecurityCaseFeedEventType,
  index: number,
): SecurityCaseFeedModel {
  const row: SecurityCaseFeedModel = new SecurityCaseFeedModel(
    ObjectID.generate(),
  );

  row.securityCaseId = CASE_ID;
  row.securityCaseFeedEventType = eventType;
  row.feedInfoInMarkdown = `An entry of ${eventType}.`;
  row.displayColor = rowColorOf(eventType);
  row.postedAt = new Date(Date.UTC(2026, 10, 20, 12, 0) - index * 60_000);

  return row;
}

interface DrawnLook {
  icon: string | null;
  color: string | null;
}

// The look an entry of this event type is drawn with, read off the page.
function drawnLookOf(eventType: SecurityCaseFeedEventType): DrawnLook {
  const entries: Array<Element> = Array.from(
    document.querySelectorAll(
      `[data-testid="feed-entry"][data-event-type="${eventType}"]`,
    ),
  );

  expect([eventType, entries.length]).toEqual([eventType, 1]);

  const icon: Element | null =
    entries[0]!.querySelector('[data-testid="feed-entry-icon"] [data-icon]') ||
    null;

  return {
    icon: icon?.getAttribute("data-icon") || null,
    color: icon?.getAttribute("data-color") || null,
  };
}

beforeEach(() => {
  mockFeedRows = EVENT_TYPES.map(
    (eventType: SecurityCaseFeedEventType, index: number) => {
      return rowOf(eventType, index);
    },
  );
  // The chosen sort order is remembered, so one test's choice must not leak.
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("a security case's timeline", () => {
  test("knows every event type a case records, and gives each the look it is meant to have", () => {
    expect(Object.keys(MEANT_LOOKS).sort()).toEqual([...EVENT_TYPES].sort());

    for (const eventType of EVENT_TYPES) {
      const kind: FeedEntryKind | undefined =
        getSecurityCaseFeedKind(eventType);

      expect({
        eventType,
        icon: kind?.icon,
        tone: kind?.tone,
      }).toEqual({
        eventType,
        icon: MEANT_LOOKS[eventType].icon,
        tone: MEANT_LOOKS[eventType].tone,
      });
    }
  });

  test("draws each entry with its own icon, in its tone's color or the color the server wrote it in", async () => {
    render(<SecurityCaseFeed securityCaseId={CASE_ID} />);

    /*
     * The first test to render markdown pays for the lazy MarkdownViewer
     * chunk, as ResourceFeed.test says: give the cold load room.
     */
    await waitFor(
      () => {
        expect(screen.getAllByTestId("feed-entry")).toHaveLength(
          EVENT_TYPES.length,
        );
        expect(screen.getByText(/An entry of StepCheck\./)).toBeInTheDocument();
      },
      { timeout: 20000 },
    );

    for (const eventType of EVENT_TYPES) {
      const meant: Pick<FeedEntryKind, "icon" | "tone"> =
        MEANT_LOOKS[eventType];

      expect({ eventType, ...drawnLookOf(eventType) }).toEqual({
        eventType,
        icon: meant.icon,
        color: getFeedEntryColor({
          kind: meant,
          rowColor: rowColorOf(eventType),
        }).toString(),
      });
    }
  });

  test("draws a step that stopped holding as undone, in the server's red - never as a case opening, nor as a task", async () => {
    render(<SecurityCaseFeed securityCaseId={CASE_ID} />);

    await waitFor(
      () => {
        expect(screen.getByText(/An entry of StepCheck\./)).toBeInTheDocument();
      },
      { timeout: 20000 },
    );

    const step: DrawnLook = drawnLookOf(SecurityCaseFeedEventType.StepCheck);

    expect(step).toEqual({
      icon: IconProp.ArrowUturnLeft,
      color: Red500.toString(),
    });
    expect(step.icon).not.toBe(
      drawnLookOf(SecurityCaseFeedEventType.CaseOpened).icon,
    );
    // Its own look, not a task's: the step's task may still be ticked off.
    expect(step.icon).not.toBe(
      drawnLookOf(SecurityCaseFeedEventType.Task).icon,
    );
  });
});
