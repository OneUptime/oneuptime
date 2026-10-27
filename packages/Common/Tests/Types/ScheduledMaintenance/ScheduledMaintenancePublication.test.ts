/** @timezone Asia/Kolkata */
import ScheduledMaintenancePublication, {
  NOT_PUBLISHED_YET_SKIPPED_MESSAGE,
  PUBLISH_ON_STATUS_PAGE_AT_COLUMN,
  REMINDER_NOT_SENT_HIDDEN_MESSAGE,
  REMINDER_NOT_SENT_NOT_PUBLISHED_YET_MESSAGE,
  ScheduledMaintenancePublicationColumns,
  ScheduledMaintenancePublicationState,
  VISIBLE_ON_STATUS_PAGE_COLUMN,
} from "../../../Types/ScheduledMaintenance/ScheduledMaintenancePublication";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import OneUptimeDate from "../../../Types/Date";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * When a scheduled maintenance event is public (GitHub issue #5249): Visible
 * on Status Page on, and published - no Publish on Status Page At, or one
 * that has come. The status page's reads apply it in SQL
 * (StatusPageVisibilityQuery.shownScheduledMaintenance), the subscriber jobs
 * and the dashboard in code, here.
 *
 * The customer's own example runs through it: an event created on 1
 * October for 1 December, published on 24 November.
 *
 * Run in India (UTC+05:30, a zone a half hour off UTC), as the docblock
 * asks: a publish time is an instant, so the zone of the machine reading it
 * changes nothing.
 */

const CREATED_AT: Date = new Date("2026-10-01T08:00:00.000Z");
const PUBLISH_AT: Date = new Date("2026-11-24T09:00:00.000Z");
const STARTS_AT: Date = new Date("2026-12-01T02:00:00.000Z");

const MILLISECOND: number = 1;

function event(
  columns: ScheduledMaintenancePublicationColumns,
): ScheduledMaintenancePublicationColumns {
  return columns;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the zone this suite runs in", () => {
  test("is India's, half an hour off UTC, as the docblock asks", () => {
    // UTC+05:30 is -330 minutes in getTimezoneOffset's sign.
    expect(new Date("2026-11-24T09:00:00.000Z").getTimezoneOffset()).toBe(
      -330,
    );
  });
});

describe("ScheduledMaintenancePublication.isPublished", () => {
  test("an event with no publish time is published from the start, as every event before the column", () => {
    for (const publishOnStatusPageAt of [undefined, null, ""]) {
      expect(
        ScheduledMaintenancePublication.isPublished(
          event({ publishOnStatusPageAt }),
          CREATED_AT,
        ),
      ).toBe(true);
    }
  });

  test("the customer's example: hidden on 1 October, published on 24 November, still published on 1 December", () => {
    const planned: ScheduledMaintenancePublicationColumns = event({
      publishOnStatusPageAt: PUBLISH_AT,
    });

    expect(
      ScheduledMaintenancePublication.isPublished(planned, CREATED_AT),
    ).toBe(false);
    expect(
      ScheduledMaintenancePublication.isPublished(planned, PUBLISH_AT),
    ).toBe(true);
    expect(ScheduledMaintenancePublication.isPublished(planned, STARTS_AT)).toBe(
      true,
    );
  });

  test("published exactly at its time, and not a millisecond before", () => {
    const planned: ScheduledMaintenancePublicationColumns = event({
      publishOnStatusPageAt: PUBLISH_AT,
    });

    expect(
      ScheduledMaintenancePublication.isPublished(
        planned,
        new Date(PUBLISH_AT.getTime() - MILLISECOND),
      ),
    ).toBe(false);
    expect(
      ScheduledMaintenancePublication.isPublished(planned, new Date(PUBLISH_AT)),
    ).toBe(true);
  });

  test("a time written as an ISO string in any zone, or as the dashboard's JSON, is the same instant", () => {
    for (const written of [
      "2026-11-24T09:00:00.000Z",
      "2026-11-24T14:30:00+05:30",
      "2026-11-24T04:00:00-05:00",
      { _type: "DateTime", value: "2026-11-24T09:00:00.000Z" },
    ]) {
      const planned: ScheduledMaintenancePublicationColumns = event({
        publishOnStatusPageAt: written,
      });

      expect({
        written,
        before: ScheduledMaintenancePublication.isPublished(
          planned,
          new Date(PUBLISH_AT.getTime() - MILLISECOND),
        ),
        at: ScheduledMaintenancePublication.isPublished(planned, PUBLISH_AT),
      }).toEqual({ written, before: false, at: true });
    }
  });

  test("a value that is there but is not a time keeps the event unpublished, never shown early", () => {
    for (const publishOnStatusPageAt of ["not a time", "2026-13-45", {}]) {
      expect(
        ScheduledMaintenancePublication.isPublished(
          event({ publishOnStatusPageAt }),
          STARTS_AT,
        ),
      ).toBe(false);
    }
  });

  test("without a time given, as of the current time", () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date(PUBLISH_AT.getTime() - MILLISECOND));

    expect(
      ScheduledMaintenancePublication.isPublished(
        event({ publishOnStatusPageAt: PUBLISH_AT }),
      ),
    ).toBe(false);

    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date(PUBLISH_AT));

    expect(
      ScheduledMaintenancePublication.isPublished(
        event({ publishOnStatusPageAt: PUBLISH_AT }),
      ),
    ).toBe(true);
  });

  test("no record is published from the start: there is nothing to hold back", () => {
    expect(ScheduledMaintenancePublication.isPublished(null, CREATED_AT)).toBe(
      true,
    );
    expect(
      ScheduledMaintenancePublication.isPublished(undefined, CREATED_AT),
    ).toBe(true);
  });
});

describe("ScheduledMaintenancePublication.getPublishAt and hasPublishTime", () => {
  test("the publish time as a date, or null when there is none", () => {
    expect(
      ScheduledMaintenancePublication.getPublishAt(
        event({ publishOnStatusPageAt: "2026-11-24T14:30:00+05:30" }),
      )?.toISOString(),
    ).toBe(PUBLISH_AT.toISOString());

    for (const publishOnStatusPageAt of [undefined, null, ""]) {
      expect(
        ScheduledMaintenancePublication.getPublishAt(
          event({ publishOnStatusPageAt }),
        ),
      ).toBeNull();
      expect(
        ScheduledMaintenancePublication.hasPublishTime(
          event({ publishOnStatusPageAt }),
        ),
      ).toBe(false);
    }

    expect(
      ScheduledMaintenancePublication.hasPublishTime(
        event({ publishOnStatusPageAt: PUBLISH_AT }),
      ),
    ).toBe(true);
    expect(ScheduledMaintenancePublication.getPublishAt(null)).toBeNull();
  });

  test("a value that is not a time has a publish time but no date to show", () => {
    const odd: ScheduledMaintenancePublicationColumns = event({
      publishOnStatusPageAt: "not a time",
    });

    expect(ScheduledMaintenancePublication.hasPublishTime(odd)).toBe(true);
    expect(ScheduledMaintenancePublication.getPublishAt(odd)).toBeNull();
  });
});

describe("ScheduledMaintenancePublication.isShown and getState", () => {
  test("shown: Visible on Status Page on, and published", () => {
    expect(
      ScheduledMaintenancePublication.isShown(
        event({ isVisibleOnStatusPage: true }),
        CREATED_AT,
      ),
    ).toBe(true);
    expect(
      ScheduledMaintenancePublication.isShown(
        event({
          isVisibleOnStatusPage: true,
          publishOnStatusPageAt: PUBLISH_AT,
        }),
        STARTS_AT,
      ),
    ).toBe(true);
  });

  test("not shown while its publish time is still to come, whatever the switch says", () => {
    expect(
      ScheduledMaintenancePublication.isShown(
        event({
          isVisibleOnStatusPage: true,
          publishOnStatusPageAt: PUBLISH_AT,
        }),
        CREATED_AT,
      ),
    ).toBe(false);
  });

  test("never shown while the switch is off, whatever the time - nor when it was never read", () => {
    for (const isVisibleOnStatusPage of [false, null, undefined, "false"]) {
      expect(
        ScheduledMaintenancePublication.isShown(
          event({ isVisibleOnStatusPage, publishOnStatusPageAt: null }),
          STARTS_AT,
        ),
      ).toBe(false);
    }

    expect(ScheduledMaintenancePublication.isShown(null, STARTS_AT)).toBe(
      false,
    );
  });

  test("a switch written as text reads as the database stores it", () => {
    expect(
      ScheduledMaintenancePublication.isShown(
        event({ isVisibleOnStatusPage: "true" }),
        STARTS_AT,
      ),
    ).toBe(true);
  });

  test("where an event stands: hidden, waiting for its time, or published", () => {
    expect(
      ScheduledMaintenancePublication.getState(
        event({
          isVisibleOnStatusPage: false,
          publishOnStatusPageAt: PUBLISH_AT,
        }),
        CREATED_AT,
      ),
    ).toBe(ScheduledMaintenancePublicationState.Hidden);

    expect(
      ScheduledMaintenancePublication.getState(
        event({
          isVisibleOnStatusPage: true,
          publishOnStatusPageAt: PUBLISH_AT,
        }),
        CREATED_AT,
      ),
    ).toBe(ScheduledMaintenancePublicationState.Scheduled);

    expect(
      ScheduledMaintenancePublication.getState(
        event({
          isVisibleOnStatusPage: true,
          publishOnStatusPageAt: PUBLISH_AT,
        }),
        PUBLISH_AT,
      ),
    ).toBe(ScheduledMaintenancePublicationState.Published);

    expect(
      ScheduledMaintenancePublication.getState(
        event({ isVisibleOnStatusPage: true }),
        CREATED_AT,
      ),
    ).toBe(ScheduledMaintenancePublicationState.Published);
  });

  test("waiting to publish: on, with its time still to come", () => {
    const planned: ScheduledMaintenancePublicationColumns = event({
      isVisibleOnStatusPage: true,
      publishOnStatusPageAt: PUBLISH_AT,
    });

    expect(
      ScheduledMaintenancePublication.isWaitingToPublish(planned, CREATED_AT),
    ).toBe(true);
    expect(
      ScheduledMaintenancePublication.isWaitingToPublish(planned, PUBLISH_AT),
    ).toBe(false);
    // Hidden is not waiting: nothing happens at its time.
    expect(
      ScheduledMaintenancePublication.isWaitingToPublish(
        event({ ...planned, isVisibleOnStatusPage: false }),
        CREATED_AT,
      ),
    ).toBe(false);
  });

  test("reads a scheduled maintenance event model as it is", () => {
    const model: ScheduledMaintenance = new ScheduledMaintenance();
    model.isVisibleOnStatusPage = true;
    model.publishOnStatusPageAt = PUBLISH_AT;

    expect(ScheduledMaintenancePublication.isShown(model, CREATED_AT)).toBe(
      false,
    );
    expect(ScheduledMaintenancePublication.isShown(model, PUBLISH_AT)).toBe(
      true,
    );
  });
});

describe("the rule's columns and words", () => {
  test("names both columns of the model, which a reader must read together", () => {
    const model: ScheduledMaintenance = new ScheduledMaintenance();

    expect([...ScheduledMaintenancePublication.columns]).toEqual([
      VISIBLE_ON_STATUS_PAGE_COLUMN,
      PUBLISH_ON_STATUS_PAGE_AT_COLUMN,
    ]);

    for (const column of ScheduledMaintenancePublication.columns) {
      expect({ column, isColumn: model.hasColumn(column) }).toEqual({
        column,
        isColumn: true,
      });
    }
  });

  test("the publish time is a date the API can write, and nobody has to", () => {
    const model: ScheduledMaintenance = new ScheduledMaintenance();
    const metadata: { required?: boolean; title?: string } =
      model.getTableColumnMetadata(PUBLISH_ON_STATUS_PAGE_AT_COLUMN) as {
        required?: boolean;
        title?: string;
      };

    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("Publish on Status Page At");
  });

  test("says why a notification or a reminder is not sent, in whole sentences", () => {
    for (const sentence of [
      NOT_PUBLISHED_YET_SKIPPED_MESSAGE,
      REMINDER_NOT_SENT_HIDDEN_MESSAGE,
      REMINDER_NOT_SENT_NOT_PUBLISHED_YET_MESSAGE,
    ]) {
      expect(sentence.endsWith(".")).toBe(true);
      expect(sentence.length).toBeLessThan(150);
    }

    expect(NOT_PUBLISHED_YET_SKIPPED_MESSAGE).toContain("not published");
    expect(REMINDER_NOT_SENT_HIDDEN_MESSAGE).toContain("hidden");
    expect(REMINDER_NOT_SENT_NOT_PUBLISHED_YET_MESSAGE).toContain(
      "not published",
    );
  });
});
