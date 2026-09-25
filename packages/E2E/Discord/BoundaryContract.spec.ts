import { APIResponse, expect, test, APIRequestContext } from "@playwright/test";

test("anonymous installation has an implemented authorization boundary", async ({
  request,
}: {
  request: APIRequestContext;
}): Promise<void> => {
  const response: APIResponse = await request.get("/api/discord/install-url");
  expect(
    response.status(),
    "Before implementation this fails with route 404",
  ).not.toBe(404);
  expect([401, 403].includes(response.status())).toBe(true);
});

test("invalid OAuth state reaches an implemented callback boundary", async ({
  request,
}: {
  request: APIRequestContext;
}): Promise<void> => {
  const response: APIResponse = await request.get(
    "/api/discord/oauth/install?state=invalid&code=unused",
    { maxRedirects: 0 },
  );
  expect(
    response.status(),
    "Before implementation this fails with route 404",
  ).not.toBe(404);
  expect(
    [400, 401, 403].includes(response.status()) ||
      ([302, 303].includes(response.status()) &&
        new RegExp("[?&]error=").test(response.headers()["location"] || "")),
  ).toBe(true);
});
