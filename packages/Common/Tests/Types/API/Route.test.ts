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

  /*
   * A Telegram token segment is scheme-like when it stands alone, so it is
   * refused bare - but with its leading "/" it is an ordinary absolute path.
   * URL.fromString relies on exactly this to keep Telegram URLs parseable.
   */
  test("accepts a token-like first segment once it has a leading slash", () => {
    expect(() => {
      return new Route("bot123456:ABC-def_ghi/sendMessage");
    }).toThrowError(BadDataException);

    expect(new Route("/bot123456:ABC-def_ghi/sendMessage").toString()).toBe(
      "/bot123456:ABC-def_ghi/sendMessage",
    );
  });

  test("addRoute prefixes the slash before validating a token-like string", () => {
    expect(new Route("").addRoute("bot123456:ABC/sendMessage").toString()).toBe(
      "/bot123456:ABC/sendMessage",
    );
    expect(new Route("/api").addRoute("bot1:x").toString()).toBe("/api/bot1:x");
  });

  test.each([
    ["javascript:alert(1)", true],
    ["JaVaScRiPt:alert(1)", true],
    ["https://example.com", true],
    ["bot123:ABC/sendMessage", true],
    ["a.b+c-d:e", true],
    ["/bot123:ABC/sendMessage", false],
    ["api/:resourceId", false],
    [":resourceId", false],
    ["1:2/x", false],
    ["_matrix/!room:server", false],
    ["#frag:ment", false],
    ["?next=a:b", false],
    ["", false],
  ])("hasSchemePrefix(%s) is %s", (routeValue: string, expected: boolean) => {
    expect(Route.hasSchemePrefix(routeValue)).toBe(expected);
  });

  test.each(["/~user", "/files/~backup", "/a~b", "~user/hook", "/p?x=~y"])(
    "accepts the unreserved character '~' in %s",
    (routeValue: string) => {
      expect(new Route(routeValue).toString()).toBe(routeValue);
    },
  );

  test.each(["/a b", "/a|b", "/a`b", '/a"b', "/a<b", "/a>b", "/a\\b", "/a^b"])(
    "still refuses the non-path character in %s",
    (routeValue: string) => {
      expect(() => {
        return new Route(routeValue);
      }).toThrowError(BadDataException);
    },
  );
});
