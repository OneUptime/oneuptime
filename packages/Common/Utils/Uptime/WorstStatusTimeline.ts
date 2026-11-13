import Event from "./Event";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";

/*
 * Which status wins an instant several events cover.
 *
 * A monitor group is in the worst status among its monitors (the docs: "One
 * monitor going Offline makes the whole group Offline"), and worst is the
 * project's own order of statuses - their priority. When the caller says
 * which statuses count as downtime, those outrank every status that does
 * not, whatever their priority: the group is down whenever at least one of
 * its monitors is down, which is how its uptime percentage has always been
 * measured (MonitorStatusTimelineService.getMergedDowntimeSeconds). With the
 * downtime statuses at the top of the order - every page that counts Offline
 * (and Degraded) as down - the two orders are the same.
 */
export interface WorstStatusTimelineOptions {
  downtimeMonitorStatusIds?: Array<ObjectID | string> | undefined;
}

interface TimedEvent {
  event: Event;
  start: number;
  end: number;
  isDowntime: boolean;
  priority: number;
  // position in the input: the last tie-break, so the result never depends on sort stability.
  order: number;
}

type OutranksFunction = (a: TimedEvent, b: TimedEvent) => boolean;

/*
 * Whether `a` takes an instant both cover from `b`: a downtime status first
 * (when the caller named them), then the higher priority. Of two events of
 * the same rank, the one that started first keeps the time - an event that
 * merely starts later does not interrupt an equal one - and then the one
 * that came first.
 */
const outranks: OutranksFunction = (a: TimedEvent, b: TimedEvent): boolean => {
  if (a.isDowntime !== b.isDowntime) {
    return a.isDowntime;
  }

  if (a.priority !== b.priority) {
    return a.priority > b.priority;
  }

  if (a.start !== b.start) {
    return a.start < b.start;
  }

  return a.order < b.order;
};

/*
 * A binary max-heap of the events covering the sweep's current instant,
 * ordered by `outranks`. Ended events are left in it and dropped when they
 * reach the top - an ended event can only ever be below a live one that
 * outranks it, so the top, once live, is the winner.
 */
class EventHeap {
  private items: Array<TimedEvent> = [];

  public get size(): number {
    return this.items.length;
  }

  public peek(): TimedEvent | undefined {
    return this.items[0];
  }

  public push(item: TimedEvent): void {
    this.items.push(item);

    let index: number = this.items.length - 1;

    while (index > 0) {
      const parent: number = Math.floor((index - 1) / 2);

      if (!outranks(this.items[index]!, this.items[parent]!)) {
        break;
      }

      this.swap(index, parent);
      index = parent;
    }
  }

  public pop(): TimedEvent | undefined {
    const top: TimedEvent | undefined = this.items[0];
    const last: TimedEvent | undefined = this.items.pop();

    if (this.items.length === 0 || !last) {
      return top;
    }

    this.items[0] = last;

    let index: number = 0;

    for (;;) {
      const left: number = index * 2 + 1;
      const right: number = left + 1;
      let best: number = index;

      if (
        left < this.items.length &&
        outranks(this.items[left]!, this.items[best]!)
      ) {
        best = left;
      }

      if (
        right < this.items.length &&
        outranks(this.items[right]!, this.items[best]!)
      ) {
        best = right;
      }

      if (best === index) {
        break;
      }

      this.swap(index, best);
      index = best;
    }

    return top;
  }

  private swap(a: number, b: number): void {
    const item: TimedEvent = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = item;
  }
}

export default class WorstStatusTimeline {
  /**
   * One timeline out of the events of one or more monitors: at every
   * instant, the status that wins it among the events covering it (see
   * WorstStatusTimelineOptions), and nothing where no event covers it.
   *
   * The result never overlaps itself, is in start order, and joins pieces
   * of one status that meet. So however many monitors cover a day, the
   * time it adds up to for that day is at most the day: each instant is
   * counted once, in one status. And a gap no monitor recorded stays a gap
   * rather than being counted as any status.
   *
   * This replaces a merge that compared each event with the LAST one it
   * kept and nothing else. With several monitors covering the same hours it
   * kept overlapping events side by side - a group of eight monitors all
   * Offline for a day counted eight days of Offline in it - and cut others
   * to a negative length, which took time away from the day instead
   * (issue #6697). It also let a better status that merely ran on longer
   * cut a worse one short: A Offline from 10:00 to 11:00 and B Operational
   * from 10:30 to 12:00 kept only half an hour of A's outage.
   *
   * A sweep over every start and end, keeping the events that cover the
   * current instant in a heap: O(n log n) for n events.
   */
  public static merge(
    events: Array<Event>,
    options?: WorstStatusTimelineOptions | undefined,
  ): Array<Event> {
    const downtimeIds: Set<string> = new Set<string>(
      (options?.downtimeMonitorStatusIds || []).map(
        (id: ObjectID | string): string => {
          return id.toString();
        },
      ),
    );

    const timedEvents: Array<TimedEvent> = [];

    for (let i: number = 0; i < events.length; i++) {
      const event: Event | undefined = events[i];

      if (!event || !event.startDate || !event.endDate) {
        continue;
      }

      const start: number = OneUptimeDate.fromString(event.startDate).getTime();
      const end: number = OneUptimeDate.fromString(event.endDate).getTime();

      // an event that does not run forward covers nothing.
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        continue;
      }

      timedEvents.push({
        event: event,
        start: start,
        end: end,
        isDowntime: downtimeIds.has(event.eventStatusId?.toString() || ""),
        priority: Number.isFinite(event.priority) ? event.priority : 0,
        order: i,
      });
    }

    if (timedEvents.length === 0) {
      return [];
    }

    timedEvents.sort((a: TimedEvent, b: TimedEvent): number => {
      return a.start - b.start || a.order - b.order;
    });

    const boundarySet: Set<number> = new Set<number>();

    for (const timedEvent of timedEvents) {
      boundarySet.add(timedEvent.start);
      boundarySet.add(timedEvent.end);
    }

    const boundaries: Array<number> = Array.from(boundarySet).sort(
      (a: number, b: number): number => {
        return a - b;
      },
    );

    const heap: EventHeap = new EventHeap();
    const merged: Array<Event> = [];
    let nextEvent: number = 0;

    for (let i: number = 0; i < boundaries.length - 1; i++) {
      const from: number = boundaries[i]!;
      const to: number = boundaries[i + 1]!;

      while (
        nextEvent < timedEvents.length &&
        timedEvents[nextEvent]!.start <= from
      ) {
        heap.push(timedEvents[nextEvent]!);
        nextEvent++;
      }

      while (heap.size > 0 && heap.peek()!.end <= from) {
        heap.pop();
      }

      const winner: TimedEvent | undefined = heap.peek();

      // no event covers [from, to): nothing was recorded then.
      if (!winner) {
        continue;
      }

      const last: Event | undefined = merged[merged.length - 1];

      if (
        last &&
        last.endDate.getTime() === from &&
        last.eventStatusId.toString() === winner.event.eventStatusId.toString()
      ) {
        last.endDate = new Date(to);
        continue;
      }

      merged.push({
        startDate: new Date(from),
        endDate: new Date(to),
        label: winner.event.label,
        priority: winner.event.priority,
        color: winner.event.color,
        eventStatusId: winner.event.eventStatusId,
      });
    }

    return merged;
  }
}
