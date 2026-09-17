import { beforeEach, describe, expect, test } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Email from "../../../Types/Email";
import User from "../../../Models/DatabaseModels/User";

/*
 * Server-side product analytics.
 *
 * The whole module is best-effort by design, and that is exactly what makes it
 * worth pinning: every branch here is a silent one. A self-hosted install has
 * no ANALYTICS_KEY, so `capture` must post nothing at all -- a regression that
 * started posting would send a stranger's install data to OneUptime's PostHog.
 * In the other direction, this runs inside signup, project-create and
 * plan-change request handlers, so ANY throw that escapes turns an analytics
 * problem into a failed signup. API.post resolves rather than rejects on an
 * HTTP error status, so a 401 from a bad key is a value to inspect, not a
 * rejection to catch -- miss that and events vanish with nothing in the log.
 *
 * EnvironmentConfig is mocked with requireActual spread, because Logger and
 * CaptureSpan read from it too and must stay real.
 */

const ANALYTICS_KEY: string = "phc_test_key";
const ANALYTICS_HOST: string = "https://analytics.example.com";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    AnalyticsKey: "phc_test_key",
    AnalyticsHost: "https://analytics.example.com",
  };
});

const postMock: jest.Mock = jest.fn();

jest.mock("../../../Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

const findOneByIdMock: jest.Mock = jest.fn();

jest.mock("../../../Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>) => {
        return findOneByIdMock(...args);
      },
    },
  };
});

const loggerErrorMock: jest.Mock = jest.fn();

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: (...args: Array<unknown>) => {
        return loggerErrorMock(...args);
      },
    },
  };
});

import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import * as EnvironmentConfig from "../../../Server/EnvironmentConfig";

interface MutableEnvironment {
  AnalyticsKey: string;
  AnalyticsHost: string;
}

const environment: MutableEnvironment =
  EnvironmentConfig as unknown as MutableEnvironment;

const setAnalyticsEnvironment: (data: {
  key: string;
  host: string;
}) => void = (data: { key: string; host: string }): void => {
  environment.AnalyticsKey = data.key;
  environment.AnalyticsHost = data.host;
};

// Lets a test settle the floating promise inside capture()/captureForUser().
const flush: () => Promise<void> = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const okResponse: () => HTTPResponse<JSONObject> =
  (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, { status: 1 }, {});
  };

const capturedBody: () => JSONObject = (): JSONObject => {
  return (postMock.mock.calls[0]?.[0] as { data: JSONObject }).data;
};

describe("ProductAnalytics", () => {
  beforeEach(() => {
    postMock.mockReset();
    findOneByIdMock.mockReset();
    loggerErrorMock.mockReset();
    postMock.mockResolvedValue(okResponse());
    setAnalyticsEnvironment({ key: ANALYTICS_KEY, host: ANALYTICS_HOST });
  });

  describe("isConfigured", () => {
    test("true only when both the key and the host are set", () => {
      expect(ProductAnalytics.isConfigured()).toBe(true);

      setAnalyticsEnvironment({ key: "", host: ANALYTICS_HOST });
      expect(ProductAnalytics.isConfigured()).toBe(false);

      setAnalyticsEnvironment({ key: ANALYTICS_KEY, host: "" });
      expect(ProductAnalytics.isConfigured()).toBe(false);

      setAnalyticsEnvironment({ key: "", host: "" });
      expect(ProductAnalytics.isConfigured()).toBe(false);
    });
  });

  describe("capture", () => {
    test("posts the event to the host's /capture/ route", () => {
      ProductAnalytics.capture({
        event: "project_created",
        distinctId: "someone@example.com",
      });

      expect(postMock).toHaveBeenCalledTimes(1);

      const call: { url: URL; data: JSONObject } = postMock.mock
        .calls[0]![0] as {
        url: URL;
        data: JSONObject;
      };

      expect(call.url.toString()).toBe(`${ANALYTICS_HOST}/capture/`);
      expect(call.data["api_key"]).toBe(ANALYTICS_KEY);
      expect(call.data["event"]).toBe("project_created");
      expect(call.data["distinct_id"]).toBe("someone@example.com");
    });

    test("stamps the server as the source so these events are separable from the browser's", () => {
      ProductAnalytics.capture({
        event: "plan_changed",
        distinctId: "someone@example.com",
      });

      expect(capturedBody()["properties"]).toEqual({
        source: "oneuptime-server",
      });
    });

    test("carries the caller's properties alongside the source", () => {
      ProductAnalytics.capture({
        event: "plan_changed",
        distinctId: "someone@example.com",
        properties: { plan: "growth", seats: 4 },
      });

      expect(capturedBody()["properties"]).toEqual({
        source: "oneuptime-server",
        plan: "growth",
        seats: 4,
      });
    });

    test("a caller may override the source deliberately", () => {
      // The spread puts the caller last; pin that rather than leave it to chance.
      ProductAnalytics.capture({
        event: "plan_changed",
        distinctId: "someone@example.com",
        properties: { source: "oneuptime-worker" },
      });

      expect((capturedBody()["properties"] as JSONObject)["source"]).toBe(
        "oneuptime-worker",
      );
    });

    test("posts nothing at all when analytics is not configured", () => {
      /*
       * The default for every self-hosted install. Posting here would ship a
       * stranger's usage to OneUptime's own PostHog.
       */
      setAnalyticsEnvironment({ key: "", host: "" });

      ProductAnalytics.capture({
        event: "project_created",
        distinctId: "someone@example.com",
      });

      expect(postMock).not.toHaveBeenCalled();
    });

    test("posts nothing when there is no distinct id to attribute the event to", () => {
      ProductAnalytics.capture({
        event: "project_created",
        distinctId: "",
      });

      expect(postMock).not.toHaveBeenCalled();
    });

    test("logs an HTTP error status instead of letting the event vanish", async () => {
      // API.post RESOLVES on an error status, so this is a value, not a throw.
      postMock.mockResolvedValue(
        new HTTPErrorResponse(401, { message: "Invalid API key" }, {}),
      );

      ProductAnalytics.capture({
        event: "project_created",
        distinctId: "someone@example.com",
      });

      await flush();

      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
      expect(String(loggerErrorMock.mock.calls[0]![0])).toContain("401");
    });

    test("says nothing when the post succeeds", async () => {
      ProductAnalytics.capture({
        event: "project_created",
        distinctId: "someone@example.com",
      });

      await flush();

      expect(loggerErrorMock).not.toHaveBeenCalled();
    });

    test("a rejected post is swallowed rather than becoming an unhandled rejection", async () => {
      postMock.mockRejectedValue(new Error("analytics host unreachable"));

      expect(() => {
        return ProductAnalytics.capture({
          event: "project_created",
          distinctId: "someone@example.com",
        });
      }).not.toThrow();

      await flush();

      expect(loggerErrorMock).toHaveBeenCalled();
    });

    test("a malformed ANALYTICS_HOST is logged, not thrown into the request handler", () => {
      /*
       * URL.fromString throws on a host it cannot parse. capture() runs inside
       * the signup and project-create handlers, so the throw must stop here.
       */
      setAnalyticsEnvironment({ key: ANALYTICS_KEY, host: "not a url" });

      expect(() => {
        return ProductAnalytics.capture({
          event: "project_created",
          distinctId: "someone@example.com",
        });
      }).not.toThrow();

      expect(loggerErrorMock).toHaveBeenCalled();
      expect(postMock).not.toHaveBeenCalled();
    });
  });

  describe("captureForUser", () => {
    const userWithEmail: (email: string) => User = (email: string): User => {
      const user: User = new User();
      user.email = new Email(email);
      return user;
    };

    test("resolves the user's email and uses it as the distinct id", async () => {
      findOneByIdMock.mockResolvedValue(userWithEmail("someone@example.com"));

      ProductAnalytics.captureForUser({
        userId: new ObjectID("f7e6d5c4-b3a2-4190-8877-665544332211"),
        event: "monitor_created",
        properties: { monitorType: "Website" },
      });

      await flush();

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(capturedBody()["distinct_id"]).toBe("someone@example.com");
      expect(capturedBody()["event"]).toBe("monitor_created");
      expect(capturedBody()["properties"]).toEqual({
        source: "oneuptime-server",
        monitorType: "Website",
      });
    });

    test("reads the user as root, because the acting user is not the one being looked up", async () => {
      findOneByIdMock.mockResolvedValue(userWithEmail("someone@example.com"));

      const userId: ObjectID = new ObjectID(
        "f7e6d5c4-b3a2-4190-8877-665544332211",
      );

      ProductAnalytics.captureForUser({
        userId: userId,
        event: "monitor_created",
      });

      await flush();

      expect(findOneByIdMock).toHaveBeenCalledWith({
        id: userId,
        select: { email: true },
        props: { isRoot: true },
      });
    });

    test("does nothing without a user id", async () => {
      // Probes, workflows and API keys create records with nobody attached.
      ProductAnalytics.captureForUser({
        userId: null,
        event: "monitor_created",
      });

      await flush();

      expect(findOneByIdMock).not.toHaveBeenCalled();
      expect(postMock).not.toHaveBeenCalled();
    });

    test("does not look the user up at all when analytics is not configured", async () => {
      setAnalyticsEnvironment({ key: "", host: "" });

      ProductAnalytics.captureForUser({
        userId: new ObjectID("f7e6d5c4-b3a2-4190-8877-665544332211"),
        event: "monitor_created",
      });

      await flush();

      // A self-hosted install must not pay for a database read per event.
      expect(findOneByIdMock).not.toHaveBeenCalled();
      expect(postMock).not.toHaveBeenCalled();
    });

    test("skips silently when the user no longer exists", async () => {
      findOneByIdMock.mockResolvedValue(null);

      ProductAnalytics.captureForUser({
        userId: new ObjectID("f7e6d5c4-b3a2-4190-8877-665544332211"),
        event: "monitor_created",
      });

      await flush();

      expect(postMock).not.toHaveBeenCalled();
      expect(loggerErrorMock).not.toHaveBeenCalled();
    });

    test("skips silently when the user has no email to identify them by", async () => {
      findOneByIdMock.mockResolvedValue(new User());

      ProductAnalytics.captureForUser({
        userId: new ObjectID("f7e6d5c4-b3a2-4190-8877-665544332211"),
        event: "monitor_created",
      });

      await flush();

      expect(postMock).not.toHaveBeenCalled();
    });

    test("a failed user lookup is logged, never propagated", async () => {
      findOneByIdMock.mockRejectedValue(new Error("database is down"));

      expect(() => {
        return ProductAnalytics.captureForUser({
          userId: new ObjectID("f7e6d5c4-b3a2-4190-8877-665544332211"),
          event: "monitor_created",
        });
      }).not.toThrow();

      await flush();

      expect(postMock).not.toHaveBeenCalled();
      expect(loggerErrorMock).toHaveBeenCalled();
    });
  });
});
