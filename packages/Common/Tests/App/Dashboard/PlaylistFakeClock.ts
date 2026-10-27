import { PlaylistClock } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/UsePlaylistPlayer";

/*
 * A clock a test turns by hand, for the dashboard playlist player (issue
 * #5235): `now` is what the test says, and a timer fires when the test
 * moves the time past it - in order, each at its own time - and never by
 * itself. No real wait anywhere.
 */

interface ScheduledTimer {
  id: number;
  at: number;
  callback: () => void;
}

export default class PlaylistFakeClock implements PlaylistClock {
  public time: number;
  private timers: Array<ScheduledTimer> = [];
  private nextId: number = 1;

  public constructor(start: number) {
    this.time = start;
  }

  public now = (): number => {
    return this.time;
  };

  public setTimeout = (callback: () => void, delayInMs: number): unknown => {
    const id: number = this.nextId++;

    this.timers.push({
      id: id,
      at: this.time + Math.max(0, delayInMs),
      callback: callback,
    });

    return id;
  };

  public clearTimeout = (handle: unknown): void => {
    this.timers = this.timers.filter((timer: ScheduledTimer): boolean => {
      return timer.id !== handle;
    });
  };

  // The timers waiting, soonest first.
  public pending(): Array<{ at: number }> {
    return [...this.timers]
      .sort((a: ScheduledTimer, b: ScheduledTimer): number => {
        return a.at - b.at;
      })
      .map((timer: ScheduledTimer): { at: number } => {
        return { at: timer.at };
      });
  }

  /*
   * Moves the time on by `ms`, firing every timer that falls due on the
   * way, each at its own time. A timer a callback sets that falls due
   * within the same move fires too.
   */
  public advance(ms: number): void {
    const end: number = this.time + ms;

    for (;;) {
      const due: ScheduledTimer | undefined = [...this.timers]
        .filter((timer: ScheduledTimer): boolean => {
          return timer.at <= end;
        })
        .sort((a: ScheduledTimer, b: ScheduledTimer): number => {
          return a.at - b.at;
        })[0];

      if (!due) {
        break;
      }

      this.time = Math.max(this.time, due.at);
      this.timers = this.timers.filter((timer: ScheduledTimer): boolean => {
        return timer.id !== due.id;
      });
      due.callback();
    }

    this.time = end;
  }
}
