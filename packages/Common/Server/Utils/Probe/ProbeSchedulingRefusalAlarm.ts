import ProbeSchedulingLane from "./ProbeSchedulingLane";

/*
 * AN APP REPLICA THAT ANSWERS MOST PROBE REQUESTS BUSY FOR MINUTES ON END.
 *
 * A request answered busy now and then is the probe scheduling limit doing
 * its job (ProbeSchedulingLimiter): what it would have handed out stays due
 * for the probe's next request. On 27 November 2026 every replica answered
 * every request busy for twelve hours - the limiter had lost its slots -
 * and the once-a-minute busy warning, a warn line, was all that said so.
 *
 * So each lane of a replica counts, minute by minute of the clock, the
 * requests it gave a slot and the ones it answered busy. A refusing minute
 * is one in which it refused at least REFUSAL_ALARM_SHARE of them, and at
 * least REFUSAL_ALARM_MIN_REFUSED: a quiet install whose one probe asks a
 * few times a minute is still caught, one refusal in an idle minute is not.
 * Refusing minutes in a row that have lasted REFUSAL_ALARM_AFTER_MS raise
 * the alarm (ProbeAlarmLog, an error line), and it is raised again every
 * REFUSAL_ALARM_EVERY_MS while they go on: one line a lane every few
 * minutes, however many requests are refused. A minute that is not
 * refusing ends the run, and so does a whole minute in which no probe
 * asked: nothing was refused then. A run that raised the alarm says once
 * that it is over.
 *
 * It judges a minute once the next request comes, so nothing runs on a
 * timer and an idle replica costs nothing. Per replica, as the limit is:
 * one that lost its slots says so while the others hand out work. Its
 * clock is handed in, so its tests read the same rules as the limiter.
 */

// At least this share of a minute's requests refused: a refusing minute.
export const REFUSAL_ALARM_SHARE: number = 0.5;

// And at least this many of them.
export const REFUSAL_ALARM_MIN_REFUSED: number = 3;

// Refusing minutes in a row for this long: the alarm.
export const REFUSAL_ALARM_AFTER_MS: number = 3 * 60 * 1000;

// Raised again this often while the run goes on.
export const REFUSAL_ALARM_EVERY_MS: number = 5 * 60 * 1000;

const MINUTE_MS: number = 60 * 1000;

export enum ProbeSchedulingOutcome {
  // The request was given a slot.
  Granted = "granted",
  // The request was answered busy.
  Refused = "refused",
}

export enum RefusalAlarmNoticeKind {
  Raised = "raised",
  Over = "over",
}

export interface RefusalAlarmNotice {
  kind: RefusalAlarmNoticeKind;
  lane: ProbeSchedulingLane;
  // The first request the run refused.
  since: Date;
  // The end of the run's latest refusing minute.
  until: Date;
  // The requests of the run's minutes, and how many of them were refused.
  asked: number;
  refused: number;
}

// One minute of the clock's requests in a lane.
interface LaneMinute {
  // Minutes since the epoch.
  minute: number;
  granted: number;
  refused: number;
  firstRefusedAt: number | null;
}

// Refusing minutes in a row.
interface RefusingRun {
  since: number;
  until: number;
  asked: number;
  refused: number;
  raisedAt: number | null;
}

export class ProbeSchedulingRefusalAlarm {
  private readonly minutes: Map<ProbeSchedulingLane, LaneMinute> = new Map<
    ProbeSchedulingLane,
    LaneMinute
  >();
  private readonly runs: Map<ProbeSchedulingLane, RefusingRun> = new Map<
    ProbeSchedulingLane,
    RefusingRun
  >();

  // Read at each request, so a test's fake clock is read too.
  public constructor(
    private readonly now: () => number = (): number => {
      return Date.now();
    },
  ) {}

  /*
   * A request of the lane was given a slot or answered busy. Whatever it
   * says of the minute it closed - the alarm raised, or over - is handed
   * back to be said.
   */
  public record(
    lane: ProbeSchedulingLane,
    outcome: ProbeSchedulingOutcome,
  ): Array<RefusalAlarmNotice> {
    const now: number = this.now();
    const minute: number = Math.floor(now / MINUTE_MS);
    let notices: Array<RefusalAlarmNotice> = [];
    let current: LaneMinute | undefined = this.minutes.get(lane);

    if (current && current.minute !== minute) {
      notices = this.close(lane, current, minute, now);
      current = undefined;
    }

    if (!current) {
      current = { minute, granted: 0, refused: 0, firstRefusedAt: null };
      this.minutes.set(lane, current);
    }

    if (outcome === ProbeSchedulingOutcome.Refused) {
      current.refused++;
      current.firstRefusedAt = current.firstRefusedAt ?? now;
    } else {
      current.granted++;
    }

    return notices;
  }

  // The lane's minute `closed` is over: the next request came in `nextMinute`.
  private close(
    lane: ProbeSchedulingLane,
    closed: LaneMinute,
    nextMinute: number,
    now: number,
  ): Array<RefusalAlarmNotice> {
    const notices: Array<RefusalAlarmNotice> = [];
    const asked: number = closed.granted + closed.refused;
    const isRefusing: boolean =
      closed.refused >= REFUSAL_ALARM_MIN_REFUSED &&
      closed.refused >= asked * REFUSAL_ALARM_SHARE;
    let run: RefusingRun | undefined = this.runs.get(lane);

    if (!isRefusing) {
      this.end(lane, run, notices);
      return notices;
    }

    if (!run) {
      run = {
        since: closed.firstRefusedAt ?? closed.minute * MINUTE_MS,
        until: 0,
        asked: 0,
        refused: 0,
        raisedAt: null,
      };
      this.runs.set(lane, run);
    }

    run.asked += asked;
    run.refused += closed.refused;
    run.until = (closed.minute + 1) * MINUTE_MS;

    if (
      run.until - run.since >= REFUSAL_ALARM_AFTER_MS &&
      (run.raisedAt === null || now - run.raisedAt >= REFUSAL_ALARM_EVERY_MS)
    ) {
      run.raisedAt = now;
      notices.push(this.notice(RefusalAlarmNoticeKind.Raised, lane, run));
    }

    // A whole minute in which no probe asked: nothing was refused then.
    if (nextMinute > closed.minute + 1) {
      this.end(lane, run, notices);
    }

    return notices;
  }

  private end(
    lane: ProbeSchedulingLane,
    run: RefusingRun | undefined,
    notices: Array<RefusalAlarmNotice>,
  ): void {
    this.runs.delete(lane);

    if (run && run.raisedAt !== null) {
      notices.push(this.notice(RefusalAlarmNoticeKind.Over, lane, run));
    }
  }

  private notice(
    kind: RefusalAlarmNoticeKind,
    lane: ProbeSchedulingLane,
    run: RefusingRun,
  ): RefusalAlarmNotice {
    return {
      kind: kind,
      lane: lane,
      since: new Date(run.since),
      until: new Date(run.until),
      asked: run.asked,
      refused: run.refused,
    };
  }
}

// What the alarm's line says, with the lane as the limiter holds it now.
export interface RefusalAlarmLaneState {
  // The lane's name in words: "work", "monitor test".
  name: string;
  // The setting that sizes it.
  setting: string;
  running: number;
  waiting: number;
  slots: number;
}

// What the probes go without while a lane refuses them.
const WHAT_WAITS: Record<ProbeSchedulingLane, string> = {
  [ProbeSchedulingLane.Work]:
    "so the probes that ask it are refused most of the monitors and other work they ask for, and their checks wait past their time",
  [ProbeSchedulingLane.MonitorTests]:
    "so the Test Monitor runs people asked for wait for a probe",
};

// Whole minutes from `since` to `until`, at least one.
const minutesBetween: (since: Date, until: Date) => number = (
  since: Date,
  until: Date,
): number => {
  return Math.max(
    1,
    Math.round((until.getTime() - since.getTime()) / MINUTE_MS),
  );
};

// The alarm's words, without the prefix ProbeAlarmLog puts before them.
export function getRefusalAlarmText(data: {
  notice: RefusalAlarmNotice;
  lane: RefusalAlarmLaneState;
}): string {
  const notice: RefusalAlarmNotice = data.notice;
  const lane: RefusalAlarmLaneState = data.lane;
  const minutes: number = minutesBetween(notice.since, notice.until);

  if (notice.kind === RefusalAlarmNoticeKind.Over) {
    return `this App replica hands out probe work again in its ${lane.name} lane. It had answered ${notice.refused} of ${notice.asked} probe requests busy there from ${notice.since.toISOString()} to ${notice.until.toISOString()} (${minutes} min).`;
  }

  return `this App replica has answered ${notice.refused} of ${notice.asked} probe requests busy in its ${lane.name} lane since ${notice.since.toISOString()} (${minutes} min), ${WHAT_WAITS[notice.lane]}. Now ${lane.running} requests are running and ${lane.waiting} waiting for its ${lane.slots} slots (${lane.setting}=${lane.slots}). /metrics/probe-scheduling shows how every App replica hands out probe work.`;
}
