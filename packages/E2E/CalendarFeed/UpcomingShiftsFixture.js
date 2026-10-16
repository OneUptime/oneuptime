/*
 * What /my-shifts answers the Upcoming shifts card with, per ?shifts=
 * scenario - the shapes the server's materializer really produces
 * (OnCallShiftMaterializer): one shift per rotation turn, so a person alone
 * on a daily rotation gets thirty back-to-back shifts a month, each its own
 * row in the old card.
 *
 *   ?shifts=   mixed (default: on call now, a shift tomorrow, a night
 *              covering for Bob, a week-long turn as seven back-to-back
 *              shifts, a policy-only shift, two layers of one schedule and
 *              a shift past the 30-day edge) | daily (one person on a
 *              24-hour daily rotation, handing over to themselves at 16:20
 *              UTC, 17:20 in London in summer: the maintainer's screenshot)
 *              | weekdays (09:00-17:00 UTC on every weekday: more rows than
 *              the card shows at first) | dst (a daily 17:20 rotation in
 *              London across the end of summer time, 25 October 2026) |
 *              long (names longer than a phone is wide) | empty |
 *              truncated (mixed, and one schedule could not be computed) |
 *              truncated-empty | error (the first read fails, Try again
 *              reads mixed)
 *
 * Every shift is built from `now`, the clock the page reads, so a spec that
 * fixes the browser's clock gets the same rows every time.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const UPCOMING_SHIFTS_SCENARIOS = [
  "mixed",
  "daily",
  "weekdays",
  "dst",
  "long",
  "empty",
  "truncated",
  "truncated-empty",
  "error",
];

// Midnight UTC of the day `now` falls on, `days` days on, at `hours` UTC.
function utcDayAt(now, days, hours, minutes) {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return new Date(day.getTime() + days * DAY + hours * HOUR + (minutes || 0) * MINUTE);
}

export function buildUpcomingShifts(scenario, data) {
  const now = data.now;
  let sequence = 0;

  function shift(start, end, fields) {
    sequence++;
    const scheduleId = (fields && fields.scheduleId) || data.scheduleId;
    return {
      shiftKey: `${scheduleId}:${Math.floor(start.getTime() / 1000)}${
        fields && fields.policyVariantOf ? `:${fields.policyVariantOf.policyId}` : ""
      }`,
      contentHash: `hash-${sequence}`,
      projectId: data.projectId,
      projectName: data.projectName,
      scheduleId: scheduleId,
      scheduleName: "Primary on-call",
      scheduleTimezone: "UTC",
      userId: data.userId,
      userName: "Valeria",
      start: start.toISOString(),
      end: end.toISOString(),
      coverageSeconds: Math.round((end.getTime() - start.getTime()) / 1000),
      layerId: `${scheduleId}-layer-1`,
      layerName: "Layer 1",
      policies: [],
      isPast: start.getTime() < now.getTime(),
      lastModifiedAt: new Date(now.getTime() - DAY).toISOString(),
      shiftConfigVersion: 1,
      ...fields,
    };
  }

  // Back-to-back turns of one person: one shift each, as the server sends them.
  function turns(firstStart, turnLength, count, fields) {
    const result = [];
    for (let index = 0; index < count; index++) {
      const start = new Date(firstStart.getTime() + index * turnLength);
      result.push(shift(start, new Date(start.getTime() + turnLength), fields));
    }
    return result;
  }

  const database = {
    scheduleId: "30000000-0000-4000-8000-000000000002",
    scheduleName: "Database",
    layerId: "30000000-0000-4000-8000-000000000002-layer-1",
    layerName: "Layer 1",
  };

  const platformWeekdays = {
    scheduleId: "30000000-0000-4000-8000-000000000003",
    scheduleName: "Platform",
    layerId: "30000000-0000-4000-8000-000000000003-layer-1",
    layerName: "Weekdays",
  };

  const platformWeekend = {
    ...platformWeekdays,
    layerId: "30000000-0000-4000-8000-000000000003-layer-2",
    layerName: "Weekend",
  };

  function mixed() {
    // On call since the top of the hour two hours ago, for eight hours.
    const currentStart = new Date(now);
    currentStart.setUTCMinutes(0, 0, 0);
    const runningStart = new Date(currentStart.getTime() - 2 * HOUR);

    return [
      shift(runningStart, new Date(runningStart.getTime() + 8 * HOUR)),
      shift(utcDayAt(now, 1, 9), utcDayAt(now, 1, 17)),
      shift(utcDayAt(now, 3, 22), utcDayAt(now, 4, 6), {
        override: {
          originalUserId: "10000000-0000-4000-8000-000000000009",
          originalUserName: "Bob Smith",
          overrideStartsAt: utcDayAt(now, 3, 22).toISOString(),
          overrideEndsAt: utcDayAt(now, 4, 6).toISOString(),
        },
      }),
      // A week-long turn, as seven daily shifts of the same layer.
      ...turns(utcDayAt(now, 6, 9), DAY, 7, database),
      shift(utcDayAt(now, 16, 9), utcDayAt(now, 16, 17), {
        policyVariantOf: {
          policyId: "60000000-0000-4000-8000-000000000001",
          policyName: "Checkout",
          globalUserId: "10000000-0000-4000-8000-000000000009",
        },
      }),
      shift(utcDayAt(now, 20, 9), utcDayAt(now, 20, 17), platformWeekdays),
      shift(utcDayAt(now, 24, 10), utcDayAt(now, 24, 18), platformWeekend),
      // Starts inside the 30 days, ends after them.
      ...turns(utcDayAt(now, 29, 18), DAY, 2, database),
    ];
  }

  switch (scenario) {
    case "empty":
    case "truncated-empty":
      return [];
    case "daily": {
      // 17:20 in London in summer is 16:20 UTC.
      let start = utcDayAt(now, 0, 16, 20);
      if (start.getTime() > now.getTime()) {
        start = new Date(start.getTime() - DAY);
      }
      const shifts = [];
      while (start.getTime() < now.getTime() + 30 * DAY) {
        shifts.push(
          shift(start, new Date(start.getTime() + DAY), {
            scheduleId: "30000000-0000-4000-8000-000000000004",
            scheduleName: "Team AWeekly",
            projectName: "OneUptime Telemetry",
            layerId: "30000000-0000-4000-8000-000000000004-layer-1",
            layerName: "Layer 1",
          }),
        );
        start = new Date(start.getTime() + DAY);
      }
      return shifts;
    }
    case "weekdays": {
      const shifts = [];
      for (let days = 0; days <= 30; days++) {
        const start = utcDayAt(now, days, 9);
        const weekday = start.getUTCDay();
        if (weekday === 0 || weekday === 6) {
          continue;
        }
        const end = utcDayAt(now, days, 17);
        if (end.getTime() <= now.getTime() || start.getTime() >= now.getTime() + 30 * DAY) {
          continue;
        }
        shifts.push(shift(start, end, { scheduleName: "Support hours" }));
      }
      return shifts;
    }
    case "dst": {
      /*
       * Summer time ends in London at 01:00 UTC on 25 October 2026. A
       * rotation that hands over at 17:20 London time hands over at 16:20
       * UTC before it and 17:20 UTC after it, so the turn across it is 25
       * hours long.
       */
      const london = {
        scheduleId: "30000000-0000-4000-8000-000000000005",
        scheduleName: "London nights",
        scheduleTimezone: "Europe/London",
      };
      const handOffs = [
        "2026-10-22T16:20:00.000Z",
        "2026-10-23T16:20:00.000Z",
        "2026-10-24T16:20:00.000Z",
        "2026-10-25T17:20:00.000Z",
        "2026-10-26T17:20:00.000Z",
      ];
      const shifts = [];
      for (let index = 0; index < handOffs.length - 1; index++) {
        shifts.push(
          shift(new Date(handOffs[index]), new Date(handOffs[index + 1]), london),
        );
      }
      // An eight-hour night across the change: nine hours on the wall clock's word.
      shifts.push(
        shift(
          new Date("2026-10-24T23:00:00.000Z"),
          new Date("2026-10-25T08:00:00.000Z"),
          {
            scheduleId: "30000000-0000-4000-8000-000000000006",
            scheduleName: "Overnight support",
            scheduleTimezone: "Europe/London",
            layerId: "30000000-0000-4000-8000-000000000006-layer-1",
          },
        ),
      );
      return shifts.filter((item) => {
        return new Date(item.end).getTime() > now.getTime();
      });
    }
    case "long":
      return [
        shift(utcDayAt(now, 1, 9), utcDayAt(now, 1, 17), {
          scheduleName:
            "Platform Infrastructure Primary Escalation Rotation for the EMEA Region (follow-the-sun)",
          override: {
            originalUserId: "10000000-0000-4000-8000-000000000009",
            originalUserName: "Maximilian Alexander von Hohenberg-Lichtenstein",
            overrideStartsAt: utcDayAt(now, 1, 9).toISOString(),
            overrideEndsAt: utcDayAt(now, 1, 17).toISOString(),
          },
        }),
        shift(utcDayAt(now, 2, 9), utcDayAt(now, 2, 17), {
          scheduleName:
            "Platform Infrastructure Primary Escalation Rotation for the EMEA Region (follow-the-sun)",
          policyVariantOf: {
            policyId: "60000000-0000-4000-8000-000000000002",
            policyName:
              "Payments and Checkout Critical Path Escalation Policy (business hours only)",
            globalUserId: "10000000-0000-4000-8000-000000000009",
          },
        }),
      ];
    default:
      return mixed();
  }
}
