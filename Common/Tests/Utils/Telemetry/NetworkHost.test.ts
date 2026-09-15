import { describe, expect, test } from "@jest/globals";
import {
  isLoopbackHost,
  normalizeHost,
} from "../../../Utils/Telemetry/NetworkHost";

describe("normalizeHost", () => {
  test.each([
    ["api.example.com", "api.example.com"],
    ["  API.Example.COM  ", "api.example.com"],
    ["api.example.com:443", "api.example.com"],
    ["https://api.example.com/v1/charges?key=secret", "api.example.com"],
    ["http://user:pass@api.example.com:8080/x", "api.example.com"],
    ["[2001:db8::1]:8443", "2001:db8::1"],
    ["2001:db8::1", "2001:db8::1"],
    ["payments.svc.cluster.local.", "payments.svc.cluster.local"],
    ["10.0.0.12:5432", "10.0.0.12"],
  ])("%s → %s", (input: string, expected: string) => {
    expect(normalizeHost(input)).toBe(expected);
  });

  test.each([[""], ["   "], [undefined], [null], ["/only/a/path"]])(
    "%s has no host",
    (input: string | undefined | null) => {
      expect(normalizeHost(input)).toBeNull();
    },
  );
});

describe("isLoopbackHost", () => {
  test.each([
    ["localhost"],
    ["app.localhost"],
    ["127.0.0.1"],
    ["127.3.2.1"],
    ["::1"],
    ["0.0.0.0"],
  ])("%s is loopback", (host: string) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  test.each([["10.0.0.1"], ["localhost.example.com"], ["api"], ["1270.0.0.1"]])(
    "%s is not loopback",
    (host: string) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});
