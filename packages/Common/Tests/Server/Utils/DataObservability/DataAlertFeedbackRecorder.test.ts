import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataAlertFeedbackRecorder from "../../../../Server/Utils/DataObservability/DataAlertFeedbackRecorder";
import Alert from "../../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataAlertFeedback } from "../../../../Types/DataObservability/DataAlertFeedback";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT SOMEONE SAID ABOUT A DATA ALERT, AND WHOSE THE ALERT'S RESOLUTION IS.
 *
 * "Expected" and "not an issue" resolve the alert. That resolution was
 * written as plain root, so the audit log credited it to System though a
 * person decided it; it is now made on their behalf (OnBehalfOfProps),
 * like resolving the alert by hand. Who may give feedback is the route's
 * to say, and is not asked again.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ALERT_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const ASSET_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const RESOLVED_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OPEN_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const PERSON: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
  userTenantAccessPermission: {},
};

let changeState: jest.SpyInstance;
let feedbackWrite: jest.SpyInstance;

beforeEach(() => {
  const dataAlert: DataAlert = new DataAlert(
    new ObjectID("77777777-7777-4777-8777-777777777777"),
  );
  dataAlert.dataAssetId = ASSET_ID;

  jest.spyOn(DataAlertService, "findOneBy").mockResolvedValue(dataAlert);
  feedbackWrite = jest
    .spyOn(DataAlertService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined);

  const alert: Alert = new Alert(ALERT_ID);
  alert.currentAlertStateId = OPEN_ID;
  jest.spyOn(AlertService, "findOneBy").mockResolvedValue(alert);

  const asset: DataAsset = new DataAsset(ASSET_ID);
  asset.rowCountChangeTolerancePercent = 5;
  jest.spyOn(DataAssetService, "findOneById").mockResolvedValue(asset);
  jest
    .spyOn(DataAssetService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined);

  jest
    .spyOn(AlertStateService, "getResolvedAlertState")
    .mockResolvedValue({ id: RESOLVED_ID } as never);
  changeState = jest
    .spyOn(AlertService, "changeAlertState")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function say(
  feedback: string,
  props?: DatabaseCommonInteractionProps | undefined,
): Promise<void> {
  await DataAlertFeedbackRecorder.record({
    projectId: PROJECT_ID,
    alertId: ALERT_ID,
    userId: USER_ID,
    feedback: feedback,
    props: props,
  });
}

describe("feedback that closes a data alert", () => {
  test.each([[DataAlertFeedback.NotAnIssue], [DataAlertFeedback.Expected]])(
    "%s resolves the alert on the behalf of whoever said so",
    async (feedback: DataAlertFeedback) => {
      await say(feedback, PERSON);

      expect(changeState).toHaveBeenCalledTimes(1);

      const change: Record<string, unknown> = changeState.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(change["alertStateId"]).toBe(RESOLVED_ID);
      expect(change["createdByUserId"]).toBe(USER_ID);
      // Root, as before, with who they are and nothing they may do.
      expect(change["props"]).toEqual({
        isRoot: true,
        userId: USER_ID,
        userType: UserType.User,
      });
    },
  );

  test("said with nobody named, the resolution is OneUptime's own", async () => {
    await say(DataAlertFeedback.NotAnIssue, undefined);

    expect(
      (changeState.mock.calls[0]![0] as Record<string, unknown>)["props"],
    ).toEqual({ isRoot: true });
  });

  test("an alert already resolved is not resolved again", async () => {
    const resolved: Alert = new Alert(ALERT_ID);
    resolved.currentAlertStateId = RESOLVED_ID;
    jest.spyOn(AlertService, "findOneBy").mockResolvedValue(resolved);

    await say(DataAlertFeedback.NotAnIssue, PERSON);

    expect(changeState).not.toHaveBeenCalled();
  });

  test("feedback that the alert was useful keeps it open", async () => {
    await say(DataAlertFeedback.Useful, PERSON);

    expect(feedbackWrite).toHaveBeenCalledTimes(1);
    expect(changeState).not.toHaveBeenCalled();
  });

  test("feedback that is not one of the three is refused, and nothing is written", async () => {
    await expect(say("Meh", PERSON)).rejects.toThrow(BadDataException);

    expect(feedbackWrite).not.toHaveBeenCalled();
    expect(changeState).not.toHaveBeenCalled();
  });
});
