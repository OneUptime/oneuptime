/*
 * The Webhook trigger's settings dialog opens on the URL to call, the methods
 * it accepts and a request to try it with. Those are promises to whoever wires
 * an outside system to the workflow, so they are checked here against the
 * route the server actually registers - not against a copy of it.
 */

import WebhookTrigger from "../../../Server/Types/Workflow/Components/Webhook";
import { ExpressRouter } from "../../../Server/Utils/Express";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import ObjectID from "../../../Types/ObjectID";
import {
  WEBHOOK_TRIGGER_EXAMPLE_BODY,
  WEBHOOK_TRIGGER_HTTP_METHODS,
  WEBHOOK_TRIGGER_PATH,
  getWebhookTriggerCurlExample,
  getWebhookTriggerUrl,
} from "../../../Types/Workflow/WebhookTrigger";
import { describe, expect, test } from "@jest/globals";

const SECRET: string = "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b";

describe("getWebhookTriggerUrl", () => {
  test("is the workflow service's trigger route followed by the secret key", () => {
    expect(
      getWebhookTriggerUrl({
        workflowServiceUrl: "https://oneuptime.com/workflow",
        secretKey: SECRET,
      }),
    ).toBe(`https://oneuptime.com/workflow/trigger/${SECRET}`);
  });

  test("gives the same URL whether or not the base ends in a slash", () => {
    const expected: string = `https://oneuptime.com/workflow/trigger/${SECRET}`;

    expect(
      getWebhookTriggerUrl({
        workflowServiceUrl: "https://oneuptime.com/workflow/",
        secretKey: SECRET,
      }),
    ).toBe(expected);
    expect(
      getWebhookTriggerUrl({
        workflowServiceUrl: "https://oneuptime.com/workflow//",
        secretKey: SECRET,
      }),
    ).toBe(expected);
  });

  test("keeps a self-hosted host and port as they are", () => {
    expect(
      getWebhookTriggerUrl({
        workflowServiceUrl: "http://oneuptime.internal:8080/workflow",
        secretKey: SECRET,
      }),
    ).toBe(`http://oneuptime.internal:8080/workflow/trigger/${SECRET}`);
  });

  test("encodes a secret that is not URL safe, so the path stays one segment", () => {
    expect(
      getWebhookTriggerUrl({
        workflowServiceUrl: "https://oneuptime.com/workflow",
        secretKey: "a/b c?d",
      }),
    ).toBe("https://oneuptime.com/workflow/trigger/a%2Fb%20c%3Fd");
  });
});

describe("getWebhookTriggerCurlExample", () => {
  const url: string = `https://oneuptime.com/workflow/trigger/${SECRET}`;
  const example: string = getWebhookTriggerCurlExample(url);

  test("posts JSON to the exact URL, one option per line", () => {
    expect(example.split("\n")).toEqual([
      `curl -X POST "${url}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${WEBHOOK_TRIGGER_EXAMPLE_BODY}'`,
    ]);
  });

  test("uses a method the trigger accepts", () => {
    const method: string = example.split(" ")[2] as string;

    expect(WEBHOOK_TRIGGER_HTTP_METHODS).toContain(method as HTTPMethod);
  });

  test("sends a body that is valid JSON, so it arrives as an object", () => {
    expect(JSON.parse(WEBHOOK_TRIGGER_EXAMPLE_BODY)).toEqual({
      message: "Hello",
    });
  });

  test("never contains a quote that would end the shell string early", () => {
    expect(WEBHOOK_TRIGGER_EXAMPLE_BODY).not.toContain("'");
    expect(url).not.toContain('"');
  });
});

describe("the trigger's advertised contract matches the server", () => {
  interface RegisteredRoute {
    method: string;
    path: string;
  }

  type RecordRoutesFunction = () => Promise<Array<RegisteredRoute>>;

  /*
   * A router that records every route registered on it, whatever the method,
   * so a route added under PUT or `all` shows up here too.
   */
  const recordRoutes: RecordRoutesFunction = async (): Promise<
    Array<RegisteredRoute>
  > => {
    const routes: Array<RegisteredRoute> = [];

    const router: ExpressRouter = new Proxy(
      {},
      {
        get: (_target: object, property: string | symbol): unknown => {
          return (path: string): void => {
            routes.push({
              method: String(property).toUpperCase(),
              path: path,
            });
          };
        },
      },
    ) as unknown as ExpressRouter;

    await new WebhookTrigger().init({
      router: router,
      executeWorkflow: async (): Promise<void> => {},
      scheduleWorkflow: async (): Promise<void> => {},
      removeWorkflow: async (_workflowId: ObjectID): Promise<void> => {},
    });

    return routes;
  };

  test("the server answers exactly the methods the dialog lists", async () => {
    const routes: Array<RegisteredRoute> = await recordRoutes();

    expect(
      routes
        .map((route: RegisteredRoute) => {
          return route.method;
        })
        .sort(),
    ).toEqual([...WEBHOOK_TRIGGER_HTTP_METHODS].sort());
  });

  test("every method is registered on the path the dialog builds", async () => {
    const routes: Array<RegisteredRoute> = await recordRoutes();

    for (const route of routes) {
      expect(route.path).toBe(`${WEBHOOK_TRIGGER_PATH}/:secretkey`);
    }
  });

  test("the dialog lists GET and POST", () => {
    expect([...WEBHOOK_TRIGGER_HTTP_METHODS]).toEqual([
      HTTPMethod.GET,
      HTTPMethod.POST,
    ]);
  });
});
