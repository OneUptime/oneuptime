import {
  ClassSource,
  callArguments,
  readClassSource,
  reachableText,
} from "../TestingUtils/ClassSource";
import { describe, expect, test } from "@jest/globals";
import path from "path";

/*
 * A SAVED STATE CHANGE WRITES ITS EVENT AS ONEUPTIME, AND ITS NOTES AS THE
 * PERSON WHO MADE IT.
 *
 * Once a state change is saved, its timeline service writes what follows from
 * it onto the event itself: its current state, and the stamps that go with
 * it (an episode's resolvedAt, a maintenance event's next reminder). Those
 * columns are derived from the timeline, and they are OneUptime's writes
 * (StateChangeFollowOn.getEventWriteProps): the caller's permission to create
 * the state change is the permission to change the event's state. Written
 * with the caller's props, a role that may create the change but not edit
 * the event had its change saved and the event's write refused - the event
 * kept its old state.
 *
 * Nothing else is widened: a note posted with the change is written with the
 * caller's own props, as are the services' other writes that name what the
 * caller sent. So is the root cause an incident's or an alert's resolve
 * carries (StateChangeRootCause, #7765): the person's own words, written
 * onto the event as them, with the permission to edit it that the change
 * asked for before it was saved.
 *
 * This reads each state timeline service's onCreateSuccess (and the helpers
 * of the class it calls).
 */

// packages/Common/Tests/Server/Services -> packages/Common
const COMMON_DIR: string = path.resolve(__dirname, "..", "..", "..");
const SERVICES_DIR: string = path.join(COMMON_DIR, "Server", "Services");

interface StateTimeline {
  // The state timeline service.
  file: string;
  // The service of the event it changes.
  eventService: string;
  // The services that post a note with the change, as the caller.
  noteWriters: Array<RegExp>;
  /*
   * What writes the root cause that comes with the change onto the event,
   * as the caller (#7765): the person's words, like the note.
   */
  rootCauseWriters: Array<RegExp>;
}

const STATE_TIMELINES: Array<StateTimeline> = [
  {
    file: "IncidentStateTimelineService.ts",
    eventService: "IncidentService",
    // A public note, or - what a private incident takes - a private one.
    noteWriters: [
      /IncidentPublicNoteService\.create/,
      /StateChangeNote\.postPrivateNotes/,
    ],
    rootCauseWriters: [/StateChangeRootCause\.save/],
  },
  {
    file: "AlertStateTimelineService.ts",
    eventService: "AlertService",
    noteWriters: [/StateChangeNote\.postPrivateNotes/],
    rootCauseWriters: [/StateChangeRootCause\.save/],
  },
  {
    file: "AlertEpisodeStateTimelineService.ts",
    eventService: "AlertEpisodeService",
    noteWriters: [/StateChangeNote\.postPrivateNotes/],
    rootCauseWriters: [],
  },
  {
    file: "IncidentEpisodeStateTimelineService.ts",
    eventService: "IncidentEpisodeService",
    noteWriters: [/StateChangeNote\.postPrivateNotes/],
    rootCauseWriters: [],
  },
  {
    file: "ScheduledMaintenanceStateTimelineService.ts",
    eventService: "ScheduledMaintenanceService",
    noteWriters: [/ScheduledMaintenancePublicNoteService\.create/],
    rootCauseWriters: [],
  },
  {
    file: "MonitorStatusTimelineService.ts",
    eventService: "MonitorService",
    noteWriters: [],
    rootCauseWriters: [],
  },
];

const AS_ONEUPTIME: RegExp =
  /props:\s*StateChangeFollowOn\.getEventWriteProps\(\s*onCreate\.createBy\.props\s*\)/;

const AS_THE_CALLER: RegExp = /props:\s*onCreate\.createBy\.props\b/;

describe.each(STATE_TIMELINES)(
  "$file",
  ({ file, eventService, noteWriters, rootCauseWriters }: StateTimeline) => {
    const classSource: ClassSource = readClassSource(
      path.join(SERVICES_DIR, file),
    );
    const onCreateSuccess: string = reachableText(
      classSource,
      "onCreateSuccess",
    );

    // The root cause that came with the change, written as the caller.
    const rootCauseWrites: Array<string> = rootCauseWriters.flatMap(
      (writer: RegExp): Array<string> => {
        return callArguments(onCreateSuccess, writer);
      },
    );

    // What the success hook does besides writing that root cause.
    const withoutRootCause: string = rootCauseWrites.reduce(
      (text: string, call: string): string => {
        return text.replace(call, "");
      },
      onCreateSuccess,
    );

    // Every other update its success hook makes to the event.
    const eventWrites: Array<string> = callArguments(
      withoutRootCause,
      new RegExp(`\\b${eventService}\\.(?:updateOneBy|updateOneById|updateBy)`),
    );

    test(`writes ${eventService}'s current state once the change is saved`, () => {
      expect(eventWrites.length).toBeGreaterThan(0);
    });

    test("writes it, and every other column it derives from the change, as OneUptime, named for the caller", () => {
      for (const write of eventWrites) {
        expect(write).toMatch(AS_ONEUPTIME);
      }
    });

    test("writes the root cause that comes with the change onto the event as the caller, and only it", () => {
      expect(rootCauseWrites.length).toBe(rootCauseWriters.length);

      for (const write of rootCauseWrites) {
        expect(write).toMatch(AS_THE_CALLER);
        expect(write).toMatch(
          new RegExp(`\\b${eventService}\\.updateOneById\\(`),
        );
        expect(write).toMatch(
          /data:\s*\{\s*rootCause:\s*writtenRootCause,?\s*\}/,
        );
      }
    });

    test("writes nothing else with the caller's props but the note and the root cause that come with the change", () => {
      let rest: string = withoutRootCause;

      for (const writer of noteWriters) {
        const calls: Array<string> = callArguments(onCreateSuccess, writer);

        expect(calls.length).toBeGreaterThan(0);

        for (const call of calls) {
          // The note is the caller's, and posted as them.
          expect(call).toMatch(AS_THE_CALLER);
          rest = rest.replace(call, "");
        }
      }

      expect(rest).not.toMatch(AS_THE_CALLER);
    });
  },
);
