import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../../Server/Services/IncidentService";
import FindOneBy from "../../../../Server/Types/Database/FindOneBy";
import PrivateRecordPublicNoteRule from "../../../../Server/Utils/Notes/PrivateRecordPublicNoteRule";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import PrivateRecordPublicNotes, {
  PrivateRecordKind,
} from "../../../../Types/StatusPage/PrivateRecordPublicNotes";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpiedFunction } from "jest-mock";

/*
 * The one rule every way a public note is made asks: a private incident or
 * episode takes no new public notes (Types/StatusPage/PrivateRecordPublicNotes).
 * The services refuse a note on a record they read themselves
 * (assertRecordTakesPublicNotes); a state change and the chats ask about a
 * record by its id (isPrivate, assertStateChangeMayPostPublicNote), read as
 * OneUptime, in the record's project, and only its Private switch.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000002",
);

afterEach(() => {
  jest.restoreAllMocks();
});

function incident(isPrivate: unknown): Incident {
  const record: Incident = new Incident();
  record._id = RECORD_ID.toString();
  (record as unknown as Record<string, unknown>)["isPrivate"] = isPrivate;
  return record;
}

function episode(isPrivate: unknown): IncidentEpisode {
  const record: IncidentEpisode = new IncidentEpisode();
  record._id = RECORD_ID.toString();
  (record as unknown as Record<string, unknown>)["isPrivate"] = isPrivate;
  return record;
}

describe("PrivateRecordPublicNoteRule.assertRecordTakesPublicNotes", () => {
  test.each([
    [PrivateRecordKind.Incident, "This incident is private"],
    [PrivateRecordKind.IncidentEpisode, "This episode is private"],
  ])(
    "refuses a public note on a private %s with the one sentence",
    (kind: PrivateRecordKind, start: string) => {
      let error: unknown = null;

      try {
        PrivateRecordPublicNoteRule.assertRecordTakesPublicNotes({
          kind: kind,
          record: { isPrivate: true },
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        PrivateRecordPublicNotes.getRefusalMessage(kind),
      );
      expect((error as Error).message.startsWith(start)).toBe(true);
    },
  );

  test.each([
    ["not private", { isPrivate: false }],
    ["never set", { isPrivate: null }],
    ["not found", null],
    ["not read", undefined],
  ])(
    "lets a note through on a record %s",
    (_label: string, record: unknown) => {
      expect(() => {
        PrivateRecordPublicNoteRule.assertRecordTakesPublicNotes({
          kind: PrivateRecordKind.Incident,
          record: record as { isPrivate?: unknown } | null | undefined,
        });
      }).not.toThrow();
    },
  );
});

describe("PrivateRecordPublicNoteRule.isPrivate", () => {
  test("reads the incident as OneUptime, in its project, and only its Private switch", async () => {
    const findOneBy: SpiedFunction<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident(true));

    await expect(
      PrivateRecordPublicNoteRule.isPrivate({
        kind: PrivateRecordKind.Incident,
        recordId: RECORD_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(true);

    expect(findOneBy).toHaveBeenCalledTimes(1);
    const read: FindOneBy<Incident> = findOneBy.mock
      .calls[0]![0] as FindOneBy<Incident>;
    expect(read.query).toEqual({
      _id: RECORD_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(read.select).toEqual({ _id: true, isPrivate: true });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("reads an episode from its own table", async () => {
    const incidentRead: SpiedFunction<typeof IncidentService.findOneBy> =
      jest.spyOn(IncidentService, "findOneBy");
    const episodeRead: SpiedFunction<typeof IncidentEpisodeService.findOneBy> =
      jest
        .spyOn(IncidentEpisodeService, "findOneBy")
        .mockResolvedValue(episode(true));

    await expect(
      PrivateRecordPublicNoteRule.isPrivate({
        kind: PrivateRecordKind.IncidentEpisode,
        recordId: RECORD_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(true);

    expect(incidentRead).not.toHaveBeenCalled();
    expect(episodeRead).toHaveBeenCalledTimes(1);
    const read: FindOneBy<IncidentEpisode> = episodeRead.mock
      .calls[0]![0] as FindOneBy<IncidentEpisode>;
    expect(read.select).toEqual({ _id: true, isPrivate: true });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("reads by id alone when no project is named", async () => {
    const findOneBy: SpiedFunction<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident(false));

    await PrivateRecordPublicNoteRule.isPrivate({
      kind: PrivateRecordKind.Incident,
      recordId: RECORD_ID,
    });

    expect((findOneBy.mock.calls[0]![0] as FindOneBy<Incident>).query).toEqual({
      _id: RECORD_ID.toString(),
    });
  });

  test.each([
    ["not private", incident(false)],
    ["with Private never set", incident(null)],
    ["that is not found", null],
  ])(
    "an incident %s is not private",
    async (_label: string, found: Incident | null) => {
      jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(found);

      await expect(
        PrivateRecordPublicNoteRule.isPrivate({
          kind: PrivateRecordKind.Incident,
          recordId: RECORD_ID,
          projectId: PROJECT_ID,
        }),
      ).resolves.toBe(false);
    },
  );

  test("a failed read is not answered as 'not private': it fails", async () => {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      PrivateRecordPublicNoteRule.isPrivate({
        kind: PrivateRecordKind.Incident,
        recordId: RECORD_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("database is down");
  });
});

describe("PrivateRecordPublicNoteRule.assertStateChangeMayPostPublicNote", () => {
  test("refuses the change whole on a private incident, saying what to send instead", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident(true));

    let error: unknown = null;

    try {
      await PrivateRecordPublicNoteRule.assertStateChangeMayPostPublicNote({
        kind: PrivateRecordKind.Incident,
        recordId: RECORD_ID,
        projectId: PROJECT_ID,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      PrivateRecordPublicNotes.getStateChangeRefusalMessage(
        PrivateRecordKind.Incident,
      ),
    );
  });

  test("lets a change through on an incident that is not private", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident(false));

    await expect(
      PrivateRecordPublicNoteRule.assertStateChangeMayPostPublicNote({
        kind: PrivateRecordKind.Incident,
        recordId: RECORD_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();
  });
});
