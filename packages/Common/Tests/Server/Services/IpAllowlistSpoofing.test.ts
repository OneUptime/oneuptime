import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import DashboardService from "../../../Server/Services/DashboardService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import { ExpressRequest } from "../../../Server/Utils/Express";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The dashboard and status page IP allowlists both read the client address off
 * the request. Nginx builds X-Forwarded-For with $proxy_add_x_forwarded_for,
 * which KEEPS what the caller sent and appends the address it saw -- so the
 * left of that header is written by the caller.
 *
 * The bug these tests pin: the services took the whole header, split it, and
 * asked whether ANY entry was allowlisted. A caller who sent
 * `X-Forwarded-For: <an allowlisted address>` arrived as
 * ["<allowlisted>", "<their real address>"], the first entry matched, and the
 * allowlist was gone. Knowing (or guessing) one allowlisted address was the
 * whole attack.
 */

const ALLOWLISTED_IP: string = "203.0.113.7";
const ALLOWLISTED_RANGE: string = "10.0.0.0/8";
const ATTACKER_IP: string = "198.51.100.5";
const ALLOWLIST: string = `${ALLOWLISTED_RANGE}\n${ALLOWLISTED_IP}`;

type BuildRequestFunction = (options?: {
  forwardedFor?: string | Array<string> | undefined;
  realIp?: string | undefined;
  remoteAddress?: string | undefined;
  ip?: string | undefined;
  ips?: Array<string> | undefined;
}) => ExpressRequest;

const buildRequest: BuildRequestFunction = (options?: {
  forwardedFor?: string | Array<string> | undefined;
  realIp?: string | undefined;
  remoteAddress?: string | undefined;
  ip?: string | undefined;
  ips?: Array<string> | undefined;
}): ExpressRequest => {
  const headers: Record<string, string | Array<string>> = {};

  if (options?.forwardedFor !== undefined) {
    headers["x-forwarded-for"] = options.forwardedFor;
  }

  if (options?.realIp !== undefined) {
    headers["x-real-ip"] = options.realIp;
  }

  return {
    params: {},
    body: {},
    query: {},
    cookies: {},
    headers,
    socket: { remoteAddress: options?.remoteAddress },
    ip: options?.ip,
    ips: options?.ips || [],
  } as unknown as ExpressRequest;
};

/*
 * What our Nginx hands the app for a caller at `peer` who put `spoofed` in
 * their own X-Forwarded-For.
 */
type ForwardedByNginxFunction = (
  peer: string,
  spoofed?: string | undefined,
) => string;

const forwardedByNginx: ForwardedByNginxFunction = (
  peer: string,
  spoofed?: string | undefined,
): string => {
  return spoofed === undefined ? peer : `${spoofed}, ${peer}`;
};

describe("dashboard IP allowlist", () => {
  let dashboardId: ObjectID;
  let dashboard: Dashboard;

  beforeEach(() => {
    jest.clearAllMocks();

    dashboardId = ObjectID.generate();

    dashboard = new Dashboard();
    dashboard.id = dashboardId;
    dashboard.projectId = ObjectID.generate();
    dashboard.isPublicDashboard = true;
    dashboard.enableMasterPassword = false;
    dashboard.ipWhitelist = ALLOWLIST;

    jest
      .spyOn(DashboardService, "findOneById")
      .mockResolvedValue(dashboard as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type CheckAccessFunction = (req: ExpressRequest) => Promise<{
    hasReadAccess: boolean;
    error?: unknown;
  }>;

  const checkAccess: CheckAccessFunction = (req: ExpressRequest) => {
    return DashboardService.hasReadAccess({ dashboardId, req });
  };

  describe("refuses a spoofed X-Forwarded-For", () => {
    it("refuses when the header begins with an allowlisted address", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({
            forwardedFor: forwardedByNginx(ATTACKER_IP, ALLOWLISTED_IP),
          }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("refuses when the header begins with an address inside an allowlisted range", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({
            forwardedFor: forwardedByNginx(ATTACKER_IP, "10.9.9.9"),
          }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("refuses however many allowlisted addresses are prepended", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({
            forwardedFor: `${ALLOWLISTED_IP}, 10.1.1.1, ${ALLOWLISTED_IP}, 10.2.2.2, ${ATTACKER_IP}`,
          }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("refuses when the allowlisted address is sent as a repeated header", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({
            forwardedFor: [ALLOWLISTED_IP, ATTACKER_IP],
          }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("refuses a forged X-Real-IP", async () => {
      /*
       * X-Real-IP is only trustworthy because our Nginx overwrites it, which
       * means it says nothing on a request that did not come through it. The
       * allowlist no longer consults it at all.
       */
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({
            forwardedFor: forwardedByNginx(ATTACKER_IP),
            realIp: ALLOWLISTED_IP,
          }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("refuses a forged req.ips entry", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({
            forwardedFor: forwardedByNginx(ATTACKER_IP),
            ips: [ALLOWLISTED_IP],
          }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("refuses when the trusted entry is unparseable rather than reading further left", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({ forwardedFor: `${ALLOWLISTED_IP}, unknown` }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });
  });

  describe("still admits legitimate callers", () => {
    it("admits an allowlisted address that Nginx appended", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({ forwardedFor: forwardedByNginx(ALLOWLISTED_IP) }),
        );

      expect(result.hasReadAccess).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("admits an address inside an allowlisted CIDR range", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({ forwardedFor: forwardedByNginx("10.4.5.6") }),
        );

      expect(result.hasReadAccess).toBe(true);
    });

    it("admits an allowlisted caller who also sent a junk X-Forwarded-For of their own", async () => {
      /*
       * A legitimate caller behind their own corporate proxy sends a header
       * we cannot interpret. It sits to the left of the Nginx entry, so it
       * changes nothing.
       */
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({
            forwardedFor: forwardedByNginx(ALLOWLISTED_IP, "unknown, 10.9.9.9"),
          }),
        );

      expect(result.hasReadAccess).toBe(true);
    });

    it("admits an allowlisted caller reaching the app directly with no proxy header", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(buildRequest({ remoteAddress: ALLOWLISTED_IP }));

      expect(result.hasReadAccess).toBe(true);
    });

    it("admits an allowlisted IPv4 caller reported in IPv4-mapped IPv6 form", async () => {
      /*
       * Node reports ::ffff:10.4.5.6 for an IPv4 peer on a dual-stack
       * listener. Unnormalized it would never match the 10.0.0.0/8 rule.
       */
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(buildRequest({ remoteAddress: "::ffff:10.4.5.6" }));

      expect(result.hasReadAccess).toBe(true);
    });

    it("refuses a non-allowlisted caller", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({ forwardedFor: forwardedByNginx(ATTACKER_IP) }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("refuses when no address can be established at all", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(buildRequest());

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("skips the check entirely when no allowlist is configured", async () => {
      delete dashboard.ipWhitelist;

      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({ forwardedFor: forwardedByNginx(ATTACKER_IP) }),
        );

      expect(result.hasReadAccess).toBe(true);
    });
  });
});

describe("status page IP allowlist", () => {
  let statusPageId: ObjectID;
  let statusPage: StatusPage;

  beforeEach(() => {
    jest.clearAllMocks();

    statusPageId = ObjectID.generate();

    statusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.projectId = ObjectID.generate();
    statusPage.isPublicStatusPage = true;
    statusPage.enableMasterPassword = false;
    statusPage.ipWhitelist = ALLOWLIST;

    jest
      .spyOn(StatusPageService, "findOneById")
      .mockResolvedValue(statusPage as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type CheckAccessFunction = (req: ExpressRequest) => Promise<{
    hasReadAccess: boolean;
    error?: unknown;
  }>;

  const checkAccess: CheckAccessFunction = (req: ExpressRequest) => {
    return StatusPageService.hasReadAccess({ statusPageId, req });
  };

  describe("refuses a spoofed X-Forwarded-For", () => {
    it("refuses when the header begins with an allowlisted address", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({
            forwardedFor: forwardedByNginx(ATTACKER_IP, ALLOWLISTED_IP),
          }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("refuses when the header begins with an address inside an allowlisted range", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({
            forwardedFor: forwardedByNginx(ATTACKER_IP, "10.9.9.9"),
          }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("refuses however many allowlisted addresses are prepended", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({
            forwardedFor: `${ALLOWLISTED_IP}, 10.1.1.1, ${ALLOWLISTED_IP}, ${ATTACKER_IP}`,
          }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("refuses a forged X-Real-IP", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({
            forwardedFor: forwardedByNginx(ATTACKER_IP),
            realIp: ALLOWLISTED_IP,
          }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("refuses when the trusted entry is unparseable rather than reading further left", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({ forwardedFor: `${ALLOWLISTED_IP}, unknown` }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });
  });

  describe("still admits legitimate callers", () => {
    it("admits an allowlisted address that Nginx appended", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({ forwardedFor: forwardedByNginx(ALLOWLISTED_IP) }),
        );

      expect(result.hasReadAccess).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("admits an address inside an allowlisted CIDR range", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({ forwardedFor: forwardedByNginx("10.4.5.6") }),
        );

      expect(result.hasReadAccess).toBe(true);
    });

    it("admits an allowlisted IPv4 caller reported in IPv4-mapped IPv6 form", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(buildRequest({ remoteAddress: "::ffff:10.4.5.6" }));

      expect(result.hasReadAccess).toBe(true);
    });

    it("refuses a non-allowlisted caller", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({ forwardedFor: forwardedByNginx(ATTACKER_IP) }),
        );

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("refuses when no address can be established at all", async () => {
      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(buildRequest());

      expect(result.hasReadAccess).toBe(false);
      expect(result.error).toBeInstanceOf(ForbiddenException);
    });

    it("skips the check entirely when no allowlist is configured", async () => {
      delete statusPage.ipWhitelist;

      const result: { hasReadAccess: boolean; error?: unknown } =
        await checkAccess(
          buildRequest({ forwardedFor: forwardedByNginx(ATTACKER_IP) }),
        );

      expect(result.hasReadAccess).toBe(true);
    });
  });
});
