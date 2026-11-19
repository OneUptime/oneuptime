import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * WHAT A MAINTENANCE EVENT'S EDIT, AND THE STATUS PAGE PICKER'S HELP, SAY OF
 * THE STATUS PAGES PICKED (#9974, #9975).
 *
 * The event's Edit asks for its status pages, its publish time and its
 * reminders, with no Subscriber Notifications section to say what the pages
 * picked do. Under the picker it now says so when that is nothing - it
 * shows on none of them, or it shows and tells nobody - and why; under the
 * reminders, which are not sent. The words are the rule Schedule
 * Maintenance Event reads (ScheduledMaintenanceSubscriberReach), drawn here
 * by the real components from the real reach route's answer (stood in for
 * at the network: ScheduledMaintenanceReachAnswers), and asked with the
 * event's own id, so the server checks whether the reader may update it.
 *
 * The picker's help said the pages picked "show this event and notify their
 * subscribers": it now says which pages count and what none picked means,
 * and promises nothing of them.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

import {
  MAINTENANCE_REMINDERS_REASON_TEST_ID,
  MAINTENANCE_STATUS_PAGES_REASON_TEST_ID,
  MaintenanceRemindersReason,
  MaintenanceStatusPagesReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceReachLines";
import {
  MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED,
  MAINTENANCE_PAGES_PICKED_DO_NOT_NOTIFY,
  MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED,
  MaintenanceReachRecord,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceReach";
import MaintenanceStatusPagesCopy from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceStatusPagesCopy";
import { getMaintenanceStatusPagesFormField } from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceStatusPagesFormField";
import { REMINDERS_NOT_SENT_BEFORE_PUBLISHING_TEXT } from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenancePublishing";
import {
  STATUS_PAGE_VISIBILITY_KIND_COPY,
  StatusPageVisibilityKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPageVisibility/StatusPageVisibilitySwitchCopy";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import PositiveNumber from "../../../Types/PositiveNumber";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { PublicNoteNothingSentReason } from "../../../Types/StatusPage/PublicNoteReach";
import {
  MAINTENANCE_NOTIFIES,
  SCHEDULED_MAINTENANCE_REACH_ROUTE,
  ScheduledMaintenanceReachAnswer,
  ScheduledMaintenanceReachAsk,
  answerScheduledMaintenanceReach,
  maintenanceNothingSent,
} from "./ScheduledMaintenanceReachAnswers";

const EVENT_ID: string = "66666666-6666-4666-8666-666666666666";
const PAGE_ID: string = "b0000000-0000-4000-8000-000000000001";

const HOUR: number = 60 * 60 * 1000;

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: {
        translation: JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
        ) as Record<string, string>,
      },
    },
    interpolation: { escapeValue: false },
  });
});

const HIDDEN: string =
  STATUS_PAGE_VISIBILITY_KIND_COPY[
    StatusPageVisibilityKind.ScheduledMaintenance
  ].switchOffDescription;

function reminder(days: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = EventInterval.Day;
  recurring.intervalCount = new PositiveNumber(days);
  return recurring;
}

/*
 * An event's Edit as the page hands it to the notes: the form's values -
 * its status pages, its start, its publish time, its reminders, its id -
 * with what the event says of its subscribers and the Edit does not hold.
 */
function editValues(fields?: Record<string, unknown>): Record<string, unknown> {
  return {
    _id: EVENT_ID,
    statusPages: [PAGE_ID],
    startsAt: new Date(Date.now() + 10 * 24 * HOUR),
    endsAt: new Date(Date.now() + 10 * 24 * HOUR + 2 * HOUR),
    sendSubscriberNotificationsOnBeforeTheEvent: [],
    isVisibleOnStatusPage: true,
    shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
    shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
    shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
    ...(fields || {}),
  };
}

let reachAsks: Array<ScheduledMaintenanceReachAsk> = [];

function answer(reach: ScheduledMaintenanceReachAnswer): void {
  reachAsks = answerScheduledMaintenanceReach(reach);
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function renderNote(note: ReactElement, language?: i18n): Promise<void> {
  render(
    language ? <I18nextProvider i18n={language}>{note}</I18nextProvider> : note,
  );
  await flush();
}

function statusPagesNote(values: Record<string, unknown>): ReactElement {
  return (
    <MaintenanceStatusPagesReason
      values={values}
      record={MaintenanceReachRecord.Event}
    />
  );
}

beforeEach(() => {
  answer(MAINTENANCE_NOTIFIES);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("under the Edit's status page picker", () => {
  test("asks the event's reach route about the pages picked, with the event's own id", async () => {
    await renderNote(statusPagesNote(editValues()));

    expect(reachAsks).toHaveLength(1);
    expect(reachAsks[0]).toMatchObject({
      route: SCHEDULED_MAINTENANCE_REACH_ROUTE,
      statusPageIds: [PAGE_ID],
      recordId: EVENT_ID,
    });
  });

  test("pages that show it and notify: no note", async () => {
    await renderNote(statusPagesNote(editValues()));

    expect(
      screen.queryByTestId(MAINTENANCE_STATUS_PAGES_REASON_TEST_ID),
    ).toBeNull();
  });

  test("pages that hide maintenance events: it shows on none of them, and nobody is told", async () => {
    answer(maintenanceNothingSent(PublicNoteNothingSentReason.NoStatusPages));

    await renderNote(statusPagesNote(editValues()));

    expect(
      screen.getByTestId(MAINTENANCE_STATUS_PAGES_REASON_TEST_ID),
    ).toHaveTextContent(
      `${MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED} ${MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED}`,
    );
  });

  /*
   * Nothing showing is worth saying whatever the event asks of its
   * subscribers: an event that tells nobody anything still does not show.
   */
  test("pages that hide maintenance events, for an event that asks nothing of its subscribers: that it shows on none, still", async () => {
    answer(maintenanceNothingSent(PublicNoteNothingSentReason.NoStatusPages));

    await renderNote(
      statusPagesNote(
        editValues({
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: false,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: false,
        }),
      ),
    );

    const note: HTMLElement = screen.getByTestId(
      MAINTENANCE_STATUS_PAGES_REASON_TEST_ID,
    );

    expect(note).toHaveTextContent(MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED);
    expect(note).not.toHaveTextContent(MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED);
  });

  test("pages that send nothing: that nobody is told", async () => {
    answer(
      maintenanceNothingSent(PublicNoteNothingSentReason.NotificationsOff),
    );

    await renderNote(statusPagesNote(editValues()));

    expect(
      screen.getByTestId(MAINTENANCE_STATUS_PAGES_REASON_TEST_ID),
    ).toHaveTextContent(MAINTENANCE_PAGES_PICKED_DO_NOT_NOTIFY);
  });

  test("pages that send nothing, for an event that asks nothing of its subscribers: no note, nothing being lost", async () => {
    answer(
      maintenanceNothingSent(PublicNoteNothingSentReason.NotificationsOff),
    );

    await renderNote(
      statusPagesNote(
        editValues({
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: false,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: false,
        }),
      ),
    );

    expect(
      screen.queryByTestId(MAINTENANCE_STATUS_PAGES_REASON_TEST_ID),
    ).toBeNull();
  });

  test("an event hidden from its status pages: that, before anything the pages do", async () => {
    answer(maintenanceNothingSent(PublicNoteNothingSentReason.NoStatusPages));

    await renderNote(
      statusPagesNote(editValues({ isVisibleOnStatusPage: false })),
    );

    expect(
      screen.getByTestId(MAINTENANCE_STATUS_PAGES_REASON_TEST_ID),
    ).toHaveTextContent(HIDDEN);
  });

  test("no page picked: that it appears on none, and nothing is asked", async () => {
    await renderNote(statusPagesNote(editValues({ statusPages: [] })));

    expect(
      screen.getByTestId(MAINTENANCE_STATUS_PAGES_REASON_TEST_ID),
    ).toHaveTextContent(MaintenanceStatusPagesCopy.notShownWarning);
    expect(reachAsks).toEqual([]);
  });

  test.each([
    ["not known yet", "never"],
    ["a refusal", new HTTPErrorResponse(403, { message: "No." }, {})],
  ] as Array<[string, ScheduledMaintenanceReachAnswer]>)(
    "an answer that is %s: no promise either way, so no note",
    async (_label: string, reach: ScheduledMaintenanceReachAnswer) => {
      answer(reach);

      await renderNote(statusPagesNote(editValues()));

      expect(
        screen.queryByTestId(MAINTENANCE_STATUS_PAGES_REASON_TEST_ID),
      ).toBeNull();
    },
  );

  test("reads in the reader's language", async () => {
    answer(maintenanceNothingSent(PublicNoteNothingSentReason.NoStatusPages));

    await renderNote(statusPagesNote(editValues()), german);

    const inGerman: string = german.t(MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED);

    expect(inGerman).not.toBe(MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED);
    expect(
      screen.getByTestId(MAINTENANCE_STATUS_PAGES_REASON_TEST_ID),
    ).toHaveTextContent(inGerman);
  });
});

describe("under the Edit's reminders", () => {
  test("a reminder due before the event is published: that it is not sent", async () => {
    await renderNote(
      <MaintenanceRemindersReason
        values={editValues({
          // Published a day before it starts; reminded two days before.
          publishOnStatusPageAt: new Date(Date.now() + 9 * 24 * HOUR),
          sendSubscriberNotificationsOnBeforeTheEvent: [reminder(2)],
        })}
      />,
    );

    expect(
      screen.getByTestId(MAINTENANCE_REMINDERS_REASON_TEST_ID),
    ).toHaveTextContent(REMINDERS_NOT_SENT_BEFORE_PUBLISHING_TEXT);
  });

  test("reminders the pages pass on: no note", async () => {
    await renderNote(
      <MaintenanceRemindersReason
        values={editValues({
          sendSubscriberNotificationsOnBeforeTheEvent: [reminder(2)],
        })}
      />,
    );

    expect(
      screen.queryByTestId(MAINTENANCE_REMINDERS_REASON_TEST_ID),
    ).toBeNull();
  });
});

/*
 * #9975: the picker's help on Create, the event's Edit and the templates'
 * forms keeps to which pages count and what none picked means.
 */
describe("the status page picker's help", () => {
  test.each([
    [
      "an event's",
      MaintenanceStatusPagesCopy.pickerDescription,
      getMaintenanceStatusPagesFormField<ScheduledMaintenance>({
        stepId: "status-pages",
      }).description,
    ],
    [
      "a template's",
      MaintenanceStatusPagesCopy.templatePickerDescription,
      getMaintenanceStatusPagesFormField<ScheduledMaintenanceTemplate>({
        stepId: "resources-affected",
        isTemplate: true,
      }).description,
    ],
  ])(
    "%s says only these pages can show it or notify, and promises neither",
    (_label: string, copy: string, description: unknown) => {
      expect(description).toBe(copy);
      expect(copy).toContain("Only these status pages can show");
      expect(copy).toContain("or notify their subscribers");
      expect(copy).not.toMatch(/status pages (show|notify)/);
      expect(copy).not.toContain("and notify");
      expect(german.t(copy)).not.toBe(copy);
    },
  );

  /*
   * The note is drawn above the suggestions under the picker, from the
   * form's values, for a form that hands one (the event's Edit). Create and
   * the templates' forms say it in their Subscriber Notifications section,
   * and hand none.
   */
  test("a note handed to the picker is drawn above its suggestions, from the form's values", () => {
    const values: Record<string, unknown> = editValues();
    const seen: Array<unknown> = [];
    const note: ReactElement = <span data-testid="note" />;
    const footerProps: { setValue: (value: unknown) => void } = {
      setValue: (): void => {},
    };

    const withNote: ReactElement | undefined =
      getMaintenanceStatusPagesFormField<ScheduledMaintenance>({
        stepId: "status-pages",
        getReachNote: (handed: unknown): ReactElement => {
          seen.push(handed);
          return note;
        },
      }).getFooterElement!(values as never, undefined, footerProps);

    const children: Array<ReactElement> = React.Children.toArray(
      (withNote!.props as { children?: React.ReactNode }).children,
    ) as Array<ReactElement>;

    expect(children).toHaveLength(2);
    expect(children[0]!.props).toEqual(note.props);
    expect(seen).toEqual([values]);

    const withoutNote: ReactElement | undefined =
      getMaintenanceStatusPagesFormField<ScheduledMaintenance>({
        stepId: "status-pages",
      }).getFooterElement!(values as never, undefined, footerProps);

    // Only the suggestions, as before.
    expect(
      React.Children.toArray(
        (withoutNote!.props as { children?: React.ReactNode }).children,
      ),
    ).toHaveLength(0);
  });
});
