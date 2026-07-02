import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";

describe("URL", () => {
  test("new URL() should return a valid object", () => {
    const url: URL = new URL(
      Protocol.HTTPS,
      new Hostname("localhost:5000"),
      new Route("/api/test"),
    );
    expect(url.hostname).toBeInstanceOf(Hostname);
    expect(url.protocol).toBe("https://");
    expect(url.route).toBeInstanceOf(Route);
    expect(url.isHttps()).toBe(true);
    expect(url.toString).toBeTruthy();
  });
  test("URL.fromString should create URL object", () => {
    let url: URL = URL.fromString("https://localhost:5000/api/test");
    expect(url).toBeInstanceOf(URL);
    expect(url.protocol).toBe("https://");
    url = URL.fromString("mongodb://localhost:27017/test");
    expect(url).toBeInstanceOf(URL);
    expect(url.protocol).toBe("mongodb://");
    url = URL.fromString("ws://localhost:5000/api/test");
    expect(url).toBeInstanceOf(URL);
    expect(url.protocol).toBe("ws://");
    url = URL.fromString("wss://localhost:5000/api/test");
    expect(url).toBeInstanceOf(URL);
    expect(url.protocol).toBe("wss://");
  });

  test("URL.fromString should correctly split hostname and port when a non-default port is present", () => {
    const url: URL = URL.fromString("https://example.com:9449/some/path");
    expect(url.hostname.hostname).toBe("example.com");
    expect(url.hostname.port?.toNumber()).toBe(9449);
  });

  test("URL.fromString should leave port undefined when no port is present in the URL", () => {
    const url: URL = URL.fromString("https://example.com/some/path");
    expect(url.hostname.hostname).toBe("example.com");
    expect(url.hostname.port).toBeUndefined();
  });

  test("URL.toString should return a valid URL", () => {
    const url: URL = new URL(
      Protocol.HTTPS,
      new Hostname("localhost:5000"),
      new Route("/api/test"),
    );
    expect(url.toString()).toBe("https://localhost:5000/api/test");
  });
});
