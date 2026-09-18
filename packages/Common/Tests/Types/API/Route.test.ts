import Route from "../../../Types/API/Route";
import BadDataException from "../../../Types/Exception/BadDataException";

describe("Route", () => {
  test("new Route() should throw an error if invalid characters are passed", () => {
    expect(() => {
      return new Route("api test");
    }).toThrowError(BadDataException);
    expect(() => {
      return new Route("api\test");
    }).toThrowError(BadDataException);
    expect(() => {
      return new Route("api`test");
    }).toThrowError(BadDataException);
    expect(() => {
      return new Route("/api|test");
    }).toThrowError(BadDataException);
  });

  test.each([
    "javascript:alert(document.domain)",
    "JaVaScRiPt:alert(1)",
    "data:text/plain,hello",
    "vbscript:msgbox(1)",
    "file:/etc/passwd",
    "http://evil.example/path",
    "https://evil.example/path",
    "mailto:user@example.com",
    "custom+scheme:value",
  ])("rejects scheme-like route %s", (routeValue: string) => {
    expect(() => {
      return new Route(routeValue);
    }).toThrowError(BadDataException);
  });

  test.each(["api`test", "javascript:alert(document.domain)"])(
    "route assignment rejects invalid value %s",
    (routeValue: string) => {
      const route: Route = new Route("/api/test");

      expect(() => {
        route.route = routeValue;
      }).toThrowError(BadDataException);
    },
  );

  test("Route.toString() should return valid string", () => {
    expect(new Route("/api/test").toString()).toBe("/api/test");
    expect(new Route("/api#test").toString()).toBe("/api#test");
    expect(new Route("/api-test").toString()).toBe("/api-test");
  });

  test.each([
    "/status-page/:statusPageId/incidents",
    "api/:resourceId",
    "/events?at=12:30",
    "/callback?next=custom:value",
    "/literal/javascript:alert(1)",
  ])("preserves legitimate colon use in %s", (routeValue: string) => {
    expect(new Route(routeValue).toString()).toBe(routeValue);
  });
});
