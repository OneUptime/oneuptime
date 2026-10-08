/*
 * The browser's push service, stood in for in the page and in the service
 * worker alike: PushRegistration.spec.ts adds this file to every page, and
 * the fixture server appends it to the worker it serves.
 *
 * Chromium here has no push service, and it refuses push in a Playwright
 * context as it does in an incognito window. PushManager's subscribe and
 * getSubscription, and a subscription's unsubscribe, are answered by the
 * fixture server instead (/__fixture/push-service/*). It holds the one
 * subscription this browser has - the page and the worker see the same one,
 * as they do in a real browser - and lets a test replace or drop it the way
 * a push service does. PushManager.permissionState is the browser's own.
 */
(function () {
  if (typeof PushManager === "undefined") {
    return;
  }

  // As the fixture server stores a subscription: its JSON, and the server key it was made for.
  function toSubscription(stored) {
    if (!stored) {
      return null;
    }

    return {
      endpoint: stored.endpoint,
      expirationTime: null,
      options: {
        userVisibleOnly: true,
        applicationServerKey: new Uint8Array(stored.applicationServerKey)
          .buffer,
      },
      toJSON: function () {
        return {
          endpoint: stored.endpoint,
          expirationTime: null,
          keys: { p256dh: stored.keys.p256dh, auth: stored.keys.auth },
        };
      },
      unsubscribe: async function () {
        const response = await fetch("/__fixture/push-service/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: stored.endpoint }),
        });

        return response.ok;
      },
    };
  }

  function toBytes(key) {
    if (!key) {
      return [];
    }

    if (key instanceof ArrayBuffer) {
      return Array.from(new Uint8Array(key));
    }

    return Array.from(
      new Uint8Array(key.buffer, key.byteOffset, key.byteLength),
    );
  }

  PushManager.prototype.getSubscription = async function () {
    const response = await fetch("/__fixture/push-service/subscription");

    return toSubscription(await response.json());
  };

  PushManager.prototype.subscribe = async function (options) {
    // As a browser does: no subscription without permission to show notifications.
    if ((await this.permissionState({ userVisibleOnly: true })) !== "granted") {
      throw new DOMException(
        "Registration failed - permission denied",
        "NotAllowedError",
      );
    }

    const response = await fetch("/__fixture/push-service/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        applicationServerKey: toBytes(options && options.applicationServerKey),
        subscriber: typeof window === "undefined" ? "worker" : "page",
      }),
    });

    const answer = await response.json();

    if (!response.ok) {
      throw new DOMException(answer.message, answer.name);
    }

    return toSubscription(answer);
  };

  // For a test that hands the worker a pushsubscriptionchange event.
  self.__pushServiceStandIn = { toSubscription: toSubscription };
})();
