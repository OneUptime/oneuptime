import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import Model from "../../../Models/DatabaseModels/IncidentInternalNote";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * IncidentInternalNoteService.onCreateSuccess announces every new note with a
 * "posted private note" feed item + an UNCONDITIONAL workspace ping. Sentinel's
 * RCA note is system-authored (createdByUserId = null) and already has its own
 * RootCause feed item whose workspace ping is quiet-mode gated — so the
 * announcement must be skipped for user-less notes, or every RCA would be
 * double-posted and inconclusive investigations would ping the workspace
 * through the back door.
 *
 * These tests lock in the rule: user-authored notes announce; system-authored
 * notes don't.
 */

function fakeNote(userId?: ObjectID | undefined): Model {
  return {
    id: ObjectID.generate(),
    incidentId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    note: "test note",
    createdByUserId: userId,
    createdByUser: undefined,
  } as unknown as Model;
}

describe("IncidentInternalNoteService.onCreateSuccess", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("system-authored note (no user) posts NO feed item and NO workspace ping", async () => {
    const createFeedItem: jest.SpyInstance = jest.spyOn(
      IncidentFeedService,
      "createIncidentFeedItem",
    );
    const getIncidentNumber: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "getIncidentNumber",
    );

    const note: Model = fakeNote(undefined);

    const result: Model = await IncidentInternalNoteService.onCreateSuccess(
      { createBy: { data: note, props: { isRoot: true } }, carryForward: null },
      note,
    );

    expect(result).toBe(note);
    expect(createFeedItem).not.toHaveBeenCalled();
    expect(getIncidentNumber).not.toHaveBeenCalled();
  });

  test("user-authored note still announces with a feed item", async () => {
    const createFeedItem: jest.SpyInstance = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
      number: 42,
      numberWithPrefix: "INC-42",
    });
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.example/incident"));
    // No attachments on this note.
    jest
      .spyOn(IncidentInternalNoteService, "findOneById")
      .mockResolvedValue(null);

    const userId: ObjectID = ObjectID.generate();
    const note: Model = fakeNote(userId);

    await IncidentInternalNoteService.onCreateSuccess(
      { createBy: { data: note, props: { isRoot: true } }, carryForward: null },
      note,
    );

    expect(createFeedItem).toHaveBeenCalledTimes(1);
    expect(createFeedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        workspaceNotification: expect.objectContaining({
          sendWorkspaceNotification: true,
        }),
      }),
    );
  });
});
