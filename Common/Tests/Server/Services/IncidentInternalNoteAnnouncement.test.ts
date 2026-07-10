import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import Model from "../../../Models/DatabaseModels/IncidentInternalNote";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * IncidentInternalNoteService.onCreateSuccess announces every new note with a
 * "posted private note" feed item + workspace ping — INCLUDING user-less
 * system notes: the SLA note-reminder job (SendNoteReminders.ts) creates notes
 * with no createdByUserId and relies entirely on this hook for its feed entry
 * and Slack/Teams ping (it sets isOwnerNotified itself, so the hook is its
 * only push channel).
 *
 * Callers that must NOT announce (Sentinel's RCA note, which has its own
 * quiet-mode-gated RootCause feed item) opt out explicitly with
 * props.ignoreHooks — see IncidentInvestigationRunner. These tests lock in
 * that the hook announces for both user-authored and user-less notes, so the
 * SLA flow can't be silenced again by a "system notes are quiet" shortcut.
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

  function mockAnnouncementDeps(): jest.SpyInstance {
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
    // No attachments on these notes.
    jest
      .spyOn(IncidentInternalNoteService, "findOneById")
      .mockResolvedValue(null);
    return createFeedItem;
  }

  test("user-authored note announces with a feed item attributed to the user", async () => {
    const createFeedItem: jest.SpyInstance = mockAnnouncementDeps();
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

  test("user-less system note (e.g. SLA reminder) still announces", async () => {
    const createFeedItem: jest.SpyInstance = mockAnnouncementDeps();
    const note: Model = fakeNote(undefined);

    await IncidentInternalNoteService.onCreateSuccess(
      { createBy: { data: note, props: { isRoot: true } }, carryForward: null },
      note,
    );

    expect(createFeedItem).toHaveBeenCalledTimes(1);
    expect(createFeedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceNotification: expect.objectContaining({
          sendWorkspaceNotification: true,
        }),
      }),
    );
  });
});
