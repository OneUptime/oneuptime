import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import UserOverrideEdit, {
  USER_OVERRIDE_ENDED_REFUSAL,
  USER_OVERRIDE_END_IN_PAST_REFUSAL,
  USER_OVERRIDE_END_NOW_ENDS_THIS_MINUTE_REFUSAL,
  USER_OVERRIDE_END_NOW_NOT_STARTED_REFUSAL,
  USER_OVERRIDE_STARTED_REFUSAL,
  USER_OVERRIDE_START_IN_PAST_REFUSAL,
  UserOverrideSavedTimes,
  UserOverrideTimesChange,
} from "../../../Types/OnCallDutyPolicy/UserOverrideEdit";
import UserOverrideOverlap, {
  USER_OVERRIDE_CONFLICT_WHAT_TO_DO,
  UserOverrideTimes,
} from "../../../Types/OnCallDutyPolicy/UserOverrideOverlap";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MOBILE APP'S COPY OF WHAT AN EDIT OF A USER OVERRIDE MAY CHANGE SAYS
 * WHAT THE SERVER'S SAYS, CASE FOR CASE (#7897).
 *
 * The app edits overrides on the phone, held to the dashboard's rules, and
 * is built without Common's runtime code, so it keeps its own copy of them
 * (MobileApp/src/oncall/overrideEdit): what an edit may change, End Now's
 * end and refusals, the words of every refusal, how an overlap refusal is
 * told, and which override the server names for one. A copy drifts, and a
 * drift is silent: the phone would refuse what the server takes, send what
 * it refuses, or offer to edit the wrong override.
 *
 * So this suite compiles the app's file as it is, runs it in a fresh
 * context, and asks it and the server's rule about every combination of
 * saved times, changes and moments below, and about generated overlaps.
 * Any answer that differs fails here, whichever side moved.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const MOBILE_RULE_FILE: string = path.join(
  REPOSITORY_ROOT,
  "packages/MobileApp/src/oncall/overrideEdit.ts",
);

interface MobileTimes {
  startsAt: Date;
  endsAt: Date;
}

interface MobileScopeTimes extends MobileTimes {
  id?: string | null;
  overrideUserId: string;
  routeAlertsToUserId?: string | null;
  onCallDutyPolicyId?: string | null;
  createdAt?: Date | null;
}

interface MobileRule {
  OVERRIDE_ENDED_REFUSAL: string;
  OVERRIDE_STARTED_REFUSAL: string;
  OVERRIDE_START_IN_PAST_REFUSAL: string;
  OVERRIDE_END_IN_PAST_REFUSAL: string;
  OVERRIDE_END_NOW_NOT_STARTED_REFUSAL: string;
  OVERRIDE_END_NOW_ENDS_THIS_MINUTE_REFUSAL: string;
  OVERRIDE_ENDS_BEFORE_START_REFUSAL: string;
  OVERRIDE_CONFLICT_WHAT_TO_DO: string;
  hasEnded: (saved: MobileTimes, now: Date) => boolean;
  hasStarted: (saved: MobileTimes, now: Date) => boolean;
  isUnderWay: (saved: MobileTimes, now: Date) => boolean;
  isSameMinute: (a: Date, b: Date) => boolean;
  getEditRefusal: (data: {
    saved: MobileTimes;
    change: { startsAt?: Date | undefined; endsAt?: Date | undefined };
    now: Date;
  }) => string | null;
  getEndNow: (saved: MobileTimes, now: Date) => Date | null;
  getEndNowRefusal: (saved: MobileTimes, now: Date) => string | null;
  isOverlapRefusal: (message: string) => boolean;
  pickConflict: (
    candidate: MobileScopeTimes,
    others: Array<MobileScopeTimes>,
  ) => MobileScopeTimes | null;
}

// The app's file compiled to CommonJS as it is and run in a fresh context.
function loadMobileRule(): MobileRule {
  const source: string = fs.readFileSync(MOBILE_RULE_FILE, "utf8");

  const compiled: string = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: "overrideEdit.ts",
  }).outputText;

  const moduleObject: { exports: Record<string, unknown> } = { exports: {} };

  vm.runInNewContext(compiled, {
    module: moduleObject,
    exports: moduleObject.exports,
    Date: Date,
    Math: Math,
    require: (specifier: string): never => {
      throw new Error(
        `The app's overrideEdit.ts imports ${specifier}: it must import nothing, so this suite can run it as it is.`,
      );
    },
  });

  return moduleObject.exports as unknown as MobileRule;
}

const MOBILE: MobileRule = loadMobileRule();

const at: (iso: string) => Date = (iso: string): Date => {
  return new Date(iso);
};

// A whole number from `min` to `max`, both included.
const between: (random: SeededRandom, min: number, max: number) => number = (
  random: SeededRandom,
  min: number,
  max: number,
): number => {
  return min + random(max - min + 1);
};

const pickOne: <T>(random: SeededRandom, items: ReadonlyArray<T>) => T = <T>(
  random: SeededRandom,
  items: ReadonlyArray<T>,
): T => {
  return items[random(items.length)]!;
};

// Moments to ask at: on a minute, inside one, and just before the next.
const NOWS: Array<Date> = [
  at("2026-11-13T12:00:00.000Z"),
  at("2026-11-13T12:00:30.000Z"),
  at("2026-11-13T12:00:59.999Z"),
];

// Overrides around noon: to come, under way, ended, and at each edge.
const SAVED: Array<{ name: string; times: UserOverrideSavedTimes }> = [
  {
    name: "tomorrow",
    times: {
      startsAt: at("2026-11-14T09:00:00.000Z"),
      endsAt: at("2026-11-14T17:00:00.000Z"),
    },
  },
  {
    name: "later today",
    times: {
      startsAt: at("2026-11-13T12:01:00.000Z"),
      endsAt: at("2026-11-13T18:00:00.000Z"),
    },
  },
  {
    name: "under way, saved to the second",
    times: {
      startsAt: at("2026-11-13T08:00:45.000Z"),
      endsAt: at("2026-11-13T20:00:00.000Z"),
    },
  },
  {
    name: "started this minute",
    times: {
      startsAt: at("2026-11-13T12:00:10.000Z"),
      endsAt: at("2026-11-13T20:00:00.000Z"),
    },
  },
  {
    name: "starts exactly now",
    times: {
      startsAt: at("2026-11-13T12:00:00.000Z"),
      endsAt: at("2026-11-13T13:00:00.000Z"),
    },
  },
  {
    name: "ends this minute",
    times: {
      startsAt: at("2026-11-13T09:00:00.000Z"),
      endsAt: at("2026-11-13T12:00:50.000Z"),
    },
  },
  {
    name: "ended yesterday",
    times: {
      startsAt: at("2026-11-12T09:00:00.000Z"),
      endsAt: at("2026-11-12T17:00:00.000Z"),
    },
  },
];

// Times an edit may send.
const TIMES: Array<Date | undefined> = [
  undefined,
  at("2026-11-13T11:59:00.000Z"),
  at("2026-11-13T12:00:00.000Z"),
  at("2026-11-13T12:00:30.000Z"),
  at("2026-11-13T12:05:00.000Z"),
  at("2026-11-13T19:00:00.000Z"),
  at("2026-11-14T09:00:00.000Z"),
  at("2026-11-14T12:00:00.000Z"),
  at("2026-11-14T17:00:00.000Z"),
  at("2026-11-15T09:00:00.000Z"),
];

/*
 * The server's answer to an edit: UserOverrideEdit's refusal, then whether
 * the times the edit leaves come in order (OnCallDutyPolicyUserOverride-
 * Service.checkEdit), in its words.
 */
const SERVER_ORDER_REFUSAL: string =
  "An override has to end after it starts. Pick an end time later than its start time.";

function serverRefusal(data: {
  saved: UserOverrideSavedTimes;
  change: UserOverrideTimesChange;
  now: Date;
}): string | null {
  const refusal: string | null = UserOverrideEdit.getRefusal(data);

  if (refusal) {
    return refusal;
  }

  const startsAt: Date = data.change.startsAt || data.saved.startsAt;
  const endsAt: Date = data.change.endsAt || data.saved.endsAt;

  return endsAt.getTime() > startsAt.getTime() ? null : SERVER_ORDER_REFUSAL;
}

describe("the app's copy of the refusals", () => {
  test("says each of the server's word for word", () => {
    expect({
      ended: MOBILE.OVERRIDE_ENDED_REFUSAL,
      started: MOBILE.OVERRIDE_STARTED_REFUSAL,
      startInPast: MOBILE.OVERRIDE_START_IN_PAST_REFUSAL,
      endInPast: MOBILE.OVERRIDE_END_IN_PAST_REFUSAL,
      endNowNotStarted: MOBILE.OVERRIDE_END_NOW_NOT_STARTED_REFUSAL,
      endNowEndsThisMinute: MOBILE.OVERRIDE_END_NOW_ENDS_THIS_MINUTE_REFUSAL,
      order: MOBILE.OVERRIDE_ENDS_BEFORE_START_REFUSAL,
      whatToDo: MOBILE.OVERRIDE_CONFLICT_WHAT_TO_DO,
    }).toEqual({
      ended: USER_OVERRIDE_ENDED_REFUSAL,
      started: USER_OVERRIDE_STARTED_REFUSAL,
      startInPast: USER_OVERRIDE_START_IN_PAST_REFUSAL,
      endInPast: USER_OVERRIDE_END_IN_PAST_REFUSAL,
      endNowNotStarted: USER_OVERRIDE_END_NOW_NOT_STARTED_REFUSAL,
      endNowEndsThisMinute: USER_OVERRIDE_END_NOW_ENDS_THIS_MINUTE_REFUSAL,
      order: SERVER_ORDER_REFUSAL,
      whatToDo: USER_OVERRIDE_CONFLICT_WHAT_TO_DO,
    });
  });
});

describe("what an edit may change, as the server decides it", () => {
  test("every saved override, every change of either time or both, at every moment", () => {
    let asked: number = 0;

    for (const now of NOWS) {
      for (const saved of SAVED) {
        for (const startsAt of TIMES) {
          for (const endsAt of TIMES) {
            const change: UserOverrideTimesChange = {};

            if (startsAt) {
              change.startsAt = startsAt;
            }

            if (endsAt) {
              change.endsAt = endsAt;
            }

            expect({
              saved: saved.name,
              now: now.toISOString(),
              change: {
                startsAt: startsAt?.toISOString(),
                endsAt: endsAt?.toISOString(),
              },
              refusal: MOBILE.getEditRefusal({
                saved: saved.times,
                change: change,
                now: now,
              }),
            }).toEqual({
              saved: saved.name,
              now: now.toISOString(),
              change: {
                startsAt: startsAt?.toISOString(),
                endsAt: endsAt?.toISOString(),
              },
              refusal: serverRefusal({
                saved: saved.times,
                change: change,
                now: now,
              }),
            });

            asked++;
          }
        }
      }
    }

    expect(asked).toBe(NOWS.length * SAVED.length * TIMES.length ** 2);
  });

  test("where an override is - started, ended, under way - and two times in one minute", () => {
    for (const now of NOWS) {
      for (const saved of SAVED) {
        expect({
          saved: saved.name,
          hasStarted: MOBILE.hasStarted(saved.times, now),
          hasEnded: MOBILE.hasEnded(saved.times, now),
          isUnderWay: MOBILE.isUnderWay(saved.times, now),
        }).toEqual({
          saved: saved.name,
          hasStarted: UserOverrideEdit.hasStarted(saved.times, now),
          hasEnded: UserOverrideEdit.hasEnded(saved.times, now),
          isUnderWay: UserOverrideEdit.isUnderWay(saved.times, now),
        });
      }
    }

    for (const a of TIMES) {
      for (const b of TIMES) {
        if (a && b) {
          expect(MOBILE.isSameMinute(a, b)).toBe(
            UserOverrideEdit.isSameMinute(a, b),
          );
        }
      }
    }
  });
});

describe("End Now, as the server works it out", () => {
  test("the end it gives, and why it has nothing to do, for every saved override at every moment", () => {
    for (const now of NOWS) {
      for (const saved of SAVED) {
        expect({
          saved: saved.name,
          now: now.toISOString(),
          endsAt: MOBILE.getEndNow(saved.times, now)?.toISOString() || null,
          refusal: MOBILE.getEndNowRefusal(saved.times, now),
        }).toEqual({
          saved: saved.name,
          now: now.toISOString(),
          endsAt:
            UserOverrideEdit.getEndNow(saved.times, now)?.toISOString() || null,
          refusal: UserOverrideEdit.getEndNowRefusal(saved.times, now),
        });
      }
    }
  });
});

describe("an overlap, as the server tells it and names it", () => {
  test("a refusal for an overlap is told by what it ends with", () => {
    const refusal: string = `Jane Doe is already covered by Bob Lee on this policy from Nov 13 to Nov 14. ${USER_OVERRIDE_CONFLICT_WHAT_TO_DO}`;

    expect(MOBILE.isOverlapRefusal(refusal)).toBe(true);
    expect(MOBILE.isOverlapRefusal(`Payments: ${refusal}`)).toBe(true);
    expect(MOBILE.isOverlapRefusal(USER_OVERRIDE_ENDED_REFUSAL)).toBe(false);
  });

  test("the override it names, among generated others, is the one the server names", () => {
    const random: SeededRandom = seededRandom(7897);
    const people: Array<string> = ["jane", "kim"];
    const policies: Array<string | null> = [null, "payments", "checkout"];
    const covers: Array<string | null> = [null, "bob", "carol"];
    const hour: (value: number) => Date = (value: number): Date => {
      return new Date(Date.UTC(2026, 10, 13, value, 0, 0));
    };

    for (let round: number = 0; round < 400; round++) {
      const others: Array<UserOverrideTimes> = [];
      const count: number = between(random, 0, 6);

      for (let index: number = 0; index < count; index++) {
        const from: number = between(random, 0, 20);

        others.push({
          id: `other-${index}`,
          overrideUserId: pickOne(random, people),
          routeAlertsToUserId: pickOne(random, covers),
          onCallDutyPolicyId: pickOne(random, policies),
          startsAt: hour(from),
          endsAt: hour(from + between(random, 1, 4)),
          createdAt: hour(between(random, 0, 3)),
        });
      }

      const from: number = between(random, 0, 20);
      const candidate: UserOverrideTimes = {
        id:
          between(random, 0, 3) === 0 && others[0] ? others[0].id : "candidate",
        overrideUserId: "jane",
        routeAlertsToUserId: pickOne(random, covers),
        onCallDutyPolicyId: pickOne(random, policies),
        startsAt: hour(from),
        endsAt: hour(from + between(random, 1, 4)),
      };

      const server: UserOverrideTimes | undefined =
        UserOverrideOverlap.getConflicts(candidate, others)[0];
      const app: MobileScopeTimes | null = MOBILE.pickConflict(
        candidate as MobileScopeTimes,
        others as Array<MobileScopeTimes>,
      );

      expect({ round: round, named: app?.id || null }).toEqual({
        round: round,
        named: server?.id || null,
      });
    }
  });
});
