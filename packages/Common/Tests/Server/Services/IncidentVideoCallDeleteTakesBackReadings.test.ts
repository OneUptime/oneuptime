import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import User from "../../../Models/DatabaseModels/User";
import { Service as IncidentVideoCallServiceType } from "../../../Server/Services/IncidentVideoCallService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import IncidentCallTranscriptRemoval from "../../../Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptRemoval";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A CALL REMOVED FROM ITS INCIDENT TAKES WHAT ONEUPTIME AI READ IN IT WITH IT.
 *
 * Remove on the Video Call card deletes the call, and its transcript went
 * with the row - but what OneUptime AI read in it stayed in the incident's
 * feed and channels, though the privacy policy says a transcript and what
 * was read in it stay only until someone removes the transcript or the
 * call (#9290). The delete reads the calls it removes, held to them, and
 * once they are gone takes back each one's readings
 * (IncidentCallTranscriptRemoval.takeBackDeletedCall), naming who removed
 * it. A call with no transcript is deleted as before, and says nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

type Internals = {
  onBeforeDelete: (
    deleteBy: DeleteBy<IncidentVideoCall>,
  ) => Promise<OnDelete<IncidentVideoCall>>;
  onDeleteSuccess: (
    onDelete: OnDelete<IncidentVideoCall>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<IncidentVideoCall>>;
};

function callOf(data: {
  id: string;
  withTranscript?: boolean;
  withPosts?: boolean;
}): IncidentVideoCall {
  const call: IncidentVideoCall = new IncidentVideoCall();
  call.id = new ObjectID(data.id);
  call.projectId = PROJECT_ID;
  call.incidentId = INCIDENT_ID;
  call.provider = VideoCallProvider.Zoom;

  if (data.withTranscript) {
    call.transcriptAddedAt = new Date("2026-10-17T15:00:00.000Z");
  }

  if (data.withPosts) {
    call.callSummaryPosts = {
      posts: [{ postedAt: "2026-10-17T15:05:00.000Z", messages: [] }],
    };
  }

  return call;
}

const WITH_TRANSCRIPT: IncidentVideoCall = callOf({
  id: "33333333-3333-4333-8333-333333333333",
  withTranscript: true,
  withPosts: true,
});
const WITHOUT: IncidentVideoCall = callOf({
  id: "55555555-5555-4555-8555-555555555555",
});
// Its transcript is gone, but what was read in an earlier one is still posted.
const POSTS_ONLY: IncidentVideoCall = callOf({
  id: "77777777-7777-4777-8777-777777777777",
  withPosts: true,
});

const USER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
} as unknown as DatabaseCommonInteractionProps;

let service: IncidentVideoCallServiceType;
let internals: Internals;
let held: SpyInstance<
  (
    deleteBy: DeleteBy<IncidentVideoCall>,
    select: unknown,
  ) => Promise<Array<IncidentVideoCall>>
>;
let takeBack: SpyInstance<
  typeof IncidentCallTranscriptRemoval.takeBackDeletedCall
>;

beforeEach(() => {
  service = new IncidentVideoCallServiceType();
  internals = service as unknown as Internals;
  held = jest
    .spyOn(service as never, "findRowsAndHoldDeleteToThem")
    .mockResolvedValue([WITH_TRANSCRIPT, WITHOUT, POSTS_ONLY] as never) as never;
  takeBack = jest
    .spyOn(IncidentCallTranscriptRemoval, "takeBackDeletedCall")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function deleteByOf(
  overrides: Partial<DeleteBy<IncidentVideoCall>> = {},
): DeleteBy<IncidentVideoCall> {
  return {
    query: { incidentId: INCIDENT_ID },
    props: USER_PROPS,
    limit: 100,
    skip: 0,
    ...overrides,
  } as DeleteBy<IncidentVideoCall>;
}

describe("deleting incident calls", () => {
  test("reads the calls it removes, held to them, with what a removal needs of each", async () => {
    await internals.onBeforeDelete(deleteByOf());

    expect(held).toHaveBeenCalledTimes(1);
    expect(held.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        _id: true,
        projectId: true,
        incidentId: true,
        provider: true,
        title: true,
        videoCallConnectionId: true,
        transcriptAddedAt: true,
        transcriptInfo: true,
        callSummary: true,
        callSummaryStatus: true,
        callSummaryPosts: true,
      }),
    );
  });

  test("once they are gone, takes back what was read in each call that had a transcript or posts, naming who removed it", async () => {
    const onDelete: OnDelete<IncidentVideoCall> =
      await internals.onBeforeDelete(deleteByOf());

    await internals.onDeleteSuccess(onDelete, []);

    expect(takeBack.mock.calls).toEqual([
      [{ call: WITH_TRANSCRIPT, userId: USER_ID }],
      [{ call: POSTS_ONLY, userId: USER_ID }],
    ]);
  });

  test("the person named on the delete is who removed it", async () => {
    const deletedBy: User = new User();
    const otherUser: ObjectID = new ObjectID(
      "99999999-9999-4999-8999-999999999999",
    );
    deletedBy.id = otherUser;

    const onDelete: OnDelete<IncidentVideoCall> =
      await internals.onBeforeDelete(deleteByOf({ deletedByUser: deletedBy }));

    await internals.onDeleteSuccess(onDelete, []);

    expect(takeBack.mock.calls[0]![0].userId).toEqual(otherUser);
  });

  test("calls with no transcript are deleted as before: nothing is taken back, nothing said", async () => {
    held.mockResolvedValue([WITHOUT] as never);

    const onDelete: OnDelete<IncidentVideoCall> =
      await internals.onBeforeDelete(deleteByOf());

    await internals.onDeleteSuccess(onDelete, []);

    expect(takeBack).not.toHaveBeenCalled();
  });

  test("a delete with no carried calls - another hook's, an older shape - takes back nothing", async () => {
    await internals.onDeleteSuccess(
      { deleteBy: deleteByOf(), carryForward: null },
      [],
    );

    expect(takeBack).not.toHaveBeenCalled();
  });
});
