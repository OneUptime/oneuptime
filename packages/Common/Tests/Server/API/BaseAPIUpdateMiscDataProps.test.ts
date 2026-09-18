import BaseAPI from "../../../Server/API/BaseAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import UpdateByID from "../../../Server/Types/Database/UpdateByID";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import { getJestSpyOn } from "../../Spy";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
  };
});

/*
 * An update request can carry choices that are not columns in
 * `miscDataProps`, next to its `data` - the same envelope a create request has
 * always used. createItem passed them to the service; updateItem dropped them,
 * so "notify subscribers about this edit" could not reach
 * StatusPageAnnouncementService.onBeforeUpdate at all.
 */

const TEST_ID: string = "550e8400-e29b-41d4-a716-446655440042";

type AnnouncementUpdate = UpdateByID<StatusPageAnnouncement>;

describe("BaseAPI.updateItem misc data props", () => {
  let service: DatabaseService<StatusPageAnnouncement>;
  let api: BaseAPI<
    StatusPageAnnouncement,
    DatabaseService<StatusPageAnnouncement>
  >;
  let response: ExpressResponse;
  let updateOneById: jest.SpyInstance<any, any>;

  type RequestWithBodyFunction = (body: JSONObject) => OneUptimeRequest;

  const requestWithBody: RequestWithBodyFunction = (
    body: JSONObject,
  ): OneUptimeRequest => {
    return {
      params: { id: TEST_ID },
      body: body,
      headers: {},
    } as unknown as OneUptimeRequest;
  };

  type ForwardedUpdateFunction = () => AnnouncementUpdate;

  const forwardedUpdate: ForwardedUpdateFunction = (): AnnouncementUpdate => {
    expect(updateOneById).toHaveBeenCalledTimes(1);
    return updateOneById.mock.calls[0]![0] as AnnouncementUpdate;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    service = new DatabaseService<StatusPageAnnouncement>(
      StatusPageAnnouncement,
    );
    api = new BaseAPI<
      StatusPageAnnouncement,
      DatabaseService<StatusPageAnnouncement>
    >(StatusPageAnnouncement, service);

    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    updateOneById = getJestSpyOn(service, "updateOneById").mockResolvedValue(1);
  });

  it("hands the notify-subscribers choice to the service with the update", async () => {
    await api.updateItem(
      requestWithBody({
        data: { title: "Maintenance moved to Sunday" },
        miscDataProps: SubscriberUpdateNotification.getMiscDataProps(),
      }),
      response,
    );

    const update: AnnouncementUpdate = forwardedUpdate();

    expect(update.miscDataProps).toEqual({ notifySubscribersOfUpdate: true });
    expect(SubscriberUpdateNotification.isRequested(update.miscDataProps)).toBe(
      true,
    );
    expect(update.data).toEqual({ title: "Maintenance moved to Sunday" });
    expect(update.id).toEqual(new ObjectID(TEST_ID));
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  it("keeps misc data props out of the columns that get written", async () => {
    await api.updateItem(
      requestWithBody({
        data: { title: "Maintenance moved to Sunday" },
        miscDataProps: { notifySubscribersOfUpdate: true },
      }),
      response,
    );

    expect(
      (forwardedUpdate().data as JSONObject)["notifySubscribersOfUpdate"],
    ).toBeUndefined();
  });

  it("passes an explicit no through unchanged, so the service can see it was declined", async () => {
    await api.updateItem(
      requestWithBody({
        data: { title: "Typo fix" },
        miscDataProps: { notifySubscribersOfUpdate: false },
      }),
      response,
    );

    expect(forwardedUpdate().miscDataProps).toEqual({
      notifySubscribersOfUpdate: false,
    });
    expect(
      SubscriberUpdateNotification.isRequested(forwardedUpdate().miscDataProps),
    ).toBe(false);
  });

  it("sends an empty object when the request has no misc data props, as older clients do", async () => {
    await api.updateItem(
      requestWithBody({ data: { title: "Typo fix" } }),
      response,
    );

    expect(forwardedUpdate().miscDataProps).toEqual({});
  });

  it.each([
    ["null", null],
    ["a string", "notifySubscribersOfUpdate"],
    ["a number", 1],
    ["a boolean", true],
    ["an array", [{ notifySubscribersOfUpdate: true }]],
  ] as Array<[string, unknown]>)(
    "ignores misc data props that are %s instead of refusing the edit",
    async (_label: string, miscDataProps: unknown) => {
      await api.updateItem(
        requestWithBody({
          data: { title: "Typo fix" },
          miscDataProps: miscDataProps,
        } as JSONObject),
        response,
      );

      expect(forwardedUpdate().miscDataProps).toEqual({});
      expect(
        SubscriberUpdateNotification.isRequested(
          forwardedUpdate().miscDataProps,
        ),
      ).toBe(false);
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    },
  );

  it("still refuses an update with no columns even when misc data props ask for a notification", async () => {
    /*
     * A notification is about an edit. With nothing to write there is no
     * edit, so the existing "no fields to update" guard must still win.
     */
    await expect(
      api.updateItem(
        requestWithBody({
          data: {},
          miscDataProps: { notifySubscribersOfUpdate: true },
        }),
        response,
      ),
    ).rejects.toThrow(/No fields to update/i);

    expect(updateOneById).not.toHaveBeenCalled();
  });

  it("deserializes misc data props the same way createItem does", async () => {
    await api.updateItem(
      requestWithBody({
        data: { title: "Maintenance moved to Sunday" },
        miscDataProps: {
          notifySubscribersOfUpdate: true,
          nested: { reason: "date change" },
        },
      }),
      response,
    );

    expect(forwardedUpdate().miscDataProps).toEqual({
      notifySubscribersOfUpdate: true,
      nested: { reason: "date change" },
    });
  });
});
