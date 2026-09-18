import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import { JSONObject } from "../../../Types/JSON";

/*
 * Response.render is the only thing standing between a self-hosted install and
 * a Google Tag Manager snippet.
 *
 * The views it renders - the on-call acknowledge page, the SSO message page -
 * are rendered from a dozen call sites, none of which pass an analytics flag,
 * and their <head> partial now guards the GTM block on one. Somebody has to
 * supply it. Doing that per call site would have meant a dozen chances to
 * forget; doing it here means the default is right and a caller has to opt in
 * on purpose.
 */

interface RenderCall {
  path: string;
  variables: JSONObject;
}

describe("Response.render", () => {
  let rendered: Array<RenderCall>;
  let response: ExpressResponse;

  beforeEach(() => {
    rendered = [];

    response = {
      render: (path: string, variables: JSONObject): void => {
        rendered.push({ path, variables });
      },
    } as unknown as ExpressResponse;
  });

  afterEach(() => {
    jest.resetModules();
    delete process.env["BILLING_ENABLED"];
    delete process.env["GOOGLE_TAG_MANAGER_ENABLED"];
  });

  type LoadResponse = () => Promise<{
    render: (
      request: ExpressRequest,
      response: ExpressResponse,
      path: string,
      variables: JSONObject,
    ) => void;
  }>;

  const loadResponse: LoadResponse = async () => {
    const { default: ResponseUtil } = await import(
      "../../../Server/Utils/Response"
    );

    return ResponseUtil as unknown as Awaited<ReturnType<LoadResponse>>;
  };

  test("turns analytics off when billing is off", async () => {
    process.env["BILLING_ENABLED"] = "false";

    (await loadResponse()).render(
      {} as ExpressRequest,
      response,
      "/views/ViewMessage.ejs",
      { title: "Acknowledged" },
    );

    expect(rendered[0]?.variables["enableGoogleTagManager"]).toBe(false);
  });

  test("turns analytics off when billing is not configured at all", async () => {
    /*
     * The common self-hosted case: the variable is simply absent, not set to
     * "false".
     */
    delete process.env["BILLING_ENABLED"];

    (await loadResponse()).render(
      {} as ExpressRequest,
      response,
      "/views/ViewMessage.ejs",
      {},
    );

    expect(rendered[0]?.variables["enableGoogleTagManager"]).toBe(false);
  });

  test("leaves analytics on for the hosted product", async () => {
    process.env["BILLING_ENABLED"] = "true";

    (await loadResponse()).render(
      {} as ExpressRequest,
      response,
      "/views/ViewMessage.ejs",
      {},
    );

    expect(rendered[0]?.variables["enableGoogleTagManager"]).toBe(true);
  });

  test("turns analytics off when the tag is explicitly disabled", async () => {
    /*
     * CI forces BILLING_ENABLED=true to exercise the paid signup flow, and
     * those scripted registrations used to arrive in the production container
     * as real conversions. This is the switch that keeps them out.
     */
    process.env["BILLING_ENABLED"] = "true";
    process.env["GOOGLE_TAG_MANAGER_ENABLED"] = "false";

    (await loadResponse()).render(
      {} as ExpressRequest,
      response,
      "/views/ViewMessage.ejs",
      {},
    );

    expect(rendered[0]?.variables["enableGoogleTagManager"]).toBe(false);
  });

  test("the tag switch cannot turn analytics on for a self-hosted install", async () => {
    /*
     * Billing stays the necessary condition. Somebody setting the new variable
     * on a self-hosted deployment must not thereby start loading OneUptime's
     * container inside their network.
     */
    process.env["BILLING_ENABLED"] = "false";
    process.env["GOOGLE_TAG_MANAGER_ENABLED"] = "true";

    (await loadResponse()).render(
      {} as ExpressRequest,
      response,
      "/views/ViewMessage.ejs",
      {},
    );

    expect(rendered[0]?.variables["enableGoogleTagManager"]).toBe(false);
  });

  test("an unset tag switch leaves the hosted product measured", async () => {
    process.env["BILLING_ENABLED"] = "true";
    delete process.env["GOOGLE_TAG_MANAGER_ENABLED"];

    (await loadResponse()).render(
      {} as ExpressRequest,
      response,
      "/views/ViewMessage.ejs",
      {},
    );

    expect(rendered[0]?.variables["enableGoogleTagManager"]).toBe(true);
  });

  test("lets a caller override the default", async () => {
    process.env["BILLING_ENABLED"] = "true";

    (await loadResponse()).render(
      {} as ExpressRequest,
      response,
      "/views/ViewMessage.ejs",
      { enableGoogleTagManager: false },
    );

    expect(rendered[0]?.variables["enableGoogleTagManager"]).toBe(false);
  });

  test("passes the caller's own variables through untouched", async () => {
    process.env["BILLING_ENABLED"] = "false";

    (await loadResponse()).render(
      {} as ExpressRequest,
      response,
      "/views/AcknowledgeUserOnCallNotification.ejs",
      {
        title: "Acknowledge Incident",
        message: "Do you want to acknowledge this Incident?",
        acknowledgeUrl: "https://oneuptime.example.com/api/ack/1",
      },
    );

    expect(rendered[0]?.path).toBe(
      "/views/AcknowledgeUserOnCallNotification.ejs",
    );
    expect(rendered[0]?.variables["title"]).toBe("Acknowledge Incident");
    expect(rendered[0]?.variables["acknowledgeUrl"]).toBe(
      "https://oneuptime.example.com/api/ack/1",
    );
  });
});
