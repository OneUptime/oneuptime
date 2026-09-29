import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Contract checks for the public OpenAPI specification endpoint.
 *
 * The App service serves a generated OpenAPI 3.0 document at
 * /api/openapi/spec (Common/Server/API/OpenAPI.ts -> OpenAPIUtil
 * .generateOpenAPISpec()). It is the machine-readable contract that the
 * Terraform provider generator, the API reference docs, and third-party
 * clients all consume, and Home/Utils/AIDiscovery.ts advertises it to AI
 * agents as `${baseUrl}/api/openapi/spec`.
 *
 * The spec is assembled at boot from every Postgres and Analytics model's Zod
 * schema. A regression in that assembly (an unregistered model, a schema that
 * throws, a broken route registration) can make the endpoint 500 or emit a
 * structurally invalid document while every /status probe stays green — no
 * other E2E suite exercises it. This suite pins the top-level OpenAPI document
 * shape so such a regression fails loudly.
 *
 * The "/api" prefix is used deliberately: nginx proxies `location /api`
 * unconditionally to the App service in both the self-hosted and billing
 * deployment modes, so this endpoint resolves the same way the deep
 * health-check suite's routes do.
 */

const OPENAPI_SPEC_ROUTE: string = "/api/openapi/spec";

test.describe("OpenAPI specification endpoint", () => {
  test(`${OPENAPI_SPEC_ROUTE} returns a well-formed OpenAPI 3.0 document`, async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const endpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute(OPENAPI_SPEC_ROUTE)
      .toString();

    const response: APIResponse = await page.request.get(endpoint);

    // The endpoint must answer with a success status code.
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);

    // ...and a JSON content type.
    const contentType: string | null =
      response.headers()["content-type"] || null;
    expect(contentType).toBeTruthy();
    expect(contentType!.toLowerCase()).toContain("json");

    // The body must parse as JSON.
    const spec: Record<string, any> = (await response.json()) as Record<
      string,
      any
    >;

    // OpenAPI version must be a 3.x document.
    expect(typeof spec["openapi"]).toBe("string");
    expect(spec["openapi"]).toMatch(/^3\./);

    // The info block identifies the OneUptime API and carries a version.
    expect(spec["info"]).toBeTruthy();
    expect(String(spec["info"].title)).toContain("OneUptime");
    expect(typeof spec["info"].version).toBe("string");
    expect(String(spec["info"].version).length).toBeGreaterThan(0);

    // At least one server whose URL is the /api base.
    expect(Array.isArray(spec["servers"])).toBe(true);
    expect(spec["servers"].length).toBeGreaterThan(0);
    expect(String(spec["servers"][0].url)).toContain("/api");

    // paths must be a non-empty object of registered endpoints.
    expect(spec["paths"]).toBeTruthy();
    expect(typeof spec["paths"]).toBe("object");
    expect(Object.keys(spec["paths"]).length).toBeGreaterThan(0);

    // components must expose reusable schemas and the ApiKey security scheme.
    expect(spec["components"]).toBeTruthy();

    const schemas: Record<string, any> = spec["components"].schemas || {};
    expect(Object.keys(schemas).length).toBeGreaterThan(0);

    const securitySchemes: Record<string, any> =
      spec["components"].securitySchemes || {};
    expect(securitySchemes["ApiKey"]).toBeTruthy();
    expect(securitySchemes["ApiKey"].type).toBe("apiKey");
    expect(securitySchemes["ApiKey"].in).toBe("header");
  });
});
