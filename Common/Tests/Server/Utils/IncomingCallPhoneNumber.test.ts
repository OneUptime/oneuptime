import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../Utils/API";
import ClusterKeyAuthorization from "../../../Server/Middleware/ClusterKeyAuthorization";
import logger from "../../../Server/Utils/Logger";
import releaseIncomingCallPhoneNumber from "../../../Server/Utils/IncomingCallPhoneNumber";
import { JSONObject } from "../../../Types/JSON";

/*
 * Releasing a provisioned incoming-call number when its config is deleted.
 *
 * The Common layer cannot reach the call provider itself, so this hands the
 * release to the notification app's internal endpoint. It runs during cleanup,
 * behind a delete the user has already asked for, and its whole contract is
 * that it FAILS OPEN: the provider being unreachable, the notification app
 * being mid-restart, or the endpoint answering 500 must all leave the parent
 * delete to finish. A throw escaping here would leave the user's config
 * undeletable for as long as the provider is unwell.
 *
 * The endpoint is internal and authenticated by cluster key rather than by a
 * user, so the header is not optional decoration — a request without it is
 * rejected and the number silently stays provisioned, which is a bill the
 * project keeps paying for something it deleted.
 */

jest.mock("../../../Utils/API", () => {
  return { __esModule: true, default: { post: jest.fn() } };
});

jest.mock("../../../Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: { getClusterKeyHeaders: jest.fn() },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const api: { post: jest.Mock } = API as unknown as { post: jest.Mock };

const clusterKey: { getClusterKeyHeaders: jest.Mock } =
  ClusterKeyAuthorization as unknown as {
    getClusterKeyHeaders: jest.Mock;
  };

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const CONFIG_ID: ObjectID = ObjectID.generate();
const PROVIDER_NUMBER_ID: string = "PN_provider_abc123";

function callArgs(): JSONObject {
  return api.post.mock.calls[0]![0] as JSONObject;
}

function release(): Promise<void> {
  return releaseIncomingCallPhoneNumber({
    projectCallSMSConfigId: CONFIG_ID,
    callProviderPhoneNumberId: PROVIDER_NUMBER_ID,
  });
}

describe("releaseIncomingCallPhoneNumber", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.post.mockResolvedValue(undefined as never);
    clusterKey.getClusterKeyHeaders.mockReturnValue({
      clusterkey: "test-cluster-key",
    });
  });

  describe("the request it makes", () => {
    test("posts to the notification app's internal release endpoint", async () => {
      await release();

      expect(api.post).toHaveBeenCalledTimes(1);
      expect(callArgs()["url"]!.toString()).toContain(
        "/api/notification/phone-number/internal/release",
      );
    });

    /*
     * Both ids are needed: the provider's own id says which number to hand
     * back, and the config id is what the endpoint authorises the release
     * against. Dropping either silently leaves the number provisioned.
     */
    test("names both the config and the provider's number", async () => {
      await release();

      const data: JSONObject = callArgs()["data"] as JSONObject;

      expect(data["projectCallSMSConfigId"]).toBe(CONFIG_ID.toString());
      expect(data["callProviderPhoneNumberId"]).toBe(PROVIDER_NUMBER_ID);
    });

    /*
     * The id is sent as its string form, not as an ObjectID that would
     * serialize to whatever JSON.stringify makes of the instance.
     */
    test("the config id is sent as a plain string", async () => {
      await release();

      expect(
        typeof (callArgs()["data"] as JSONObject)["projectCallSMSConfigId"],
      ).toBe("string");
    });

    /*
     * An internal endpoint with no user behind it. Without the cluster key the
     * request is rejected and the number stays provisioned - and because this
     * function swallows failures, that rejection would be invisible.
     */
    test("carries the cluster key the internal endpoint authenticates on", async () => {
      await release();

      expect(clusterKey.getClusterKeyHeaders).toHaveBeenCalled();
      expect((callArgs()["headers"] as JSONObject)["clusterkey"]).toBe(
        "test-cluster-key",
      );
    });
  });

  describe("it fails open, so cleanup never blocks the delete", () => {
    /*
     * The parent delete has already been asked for. A provider or network
     * problem during cleanup must not resurrect the row the user deleted.
     */
    test("a rejected request resolves rather than throwing", async () => {
      api.post.mockRejectedValue(new Error("provider unreachable") as never);

      await expect(release()).resolves.toBeUndefined();
    });

    test("the failure is logged rather than swallowed silently", async () => {
      api.post.mockRejectedValue(new Error("provider unreachable") as never);

      await release();

      expect(mockedLogger.error).toHaveBeenCalled();
    });

    /*
     * A synchronous throw while the request is still being assembled - a
     * missing cluster key secret, say - is the same kind of cleanup failure
     * and must not escape either.
     */
    test("a throw while building the request is caught too", async () => {
      clusterKey.getClusterKeyHeaders.mockImplementation((): never => {
        throw new Error("no cluster key configured");
      });

      await expect(release()).resolves.toBeUndefined();
      expect(mockedLogger.error).toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    });

    test("a successful release logs no error", async () => {
      await release();

      expect(mockedLogger.error).not.toHaveBeenCalled();
    });
  });
});
