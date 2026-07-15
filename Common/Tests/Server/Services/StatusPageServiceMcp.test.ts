/**
 * StatusPageService MCP gate tests.
 *
 * resolveStatusPageIdOrNull and isMcpServerEnabled back the unauthenticated
 * public status page MCP tools, so their contract is security-relevant:
 * - a status page that does not exist and one that has MCP turned off must be
 *   indistinguishable to the caller (otherwise the tools become a status page
 *   enumeration oracle)
 * - a database failure must propagate rather than collapse into "disabled", so
 *   an outage is reported as an error instead of being silently reported as an
 *   owner's privacy choice
 *
 * Both services' findOneBy are spied on, so no database is touched.
 */

import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test, jest } from "@jest/globals";

const VALID_UUID: string = "550e8400-e29b-41d4-a716-446655440000";
const DOMAIN: string = "status.company.com";

function statusPageDomainWith(statusPageId: ObjectID | null): StatusPageDomain {
  return {
    statusPageId: statusPageId ?? undefined,
  } as unknown as StatusPageDomain;
}

function statusPageRow(): StatusPage {
  return { _id: VALID_UUID } as unknown as StatusPage;
}

function spyOnStatusPageFindOneBy(): jest.SpyInstance {
  return jest.spyOn(
    StatusPageService,
    "findOneBy",
  ) as unknown as jest.SpyInstance;
}

function spyOnDomainFindOneBy(): jest.SpyInstance {
  return jest.spyOn(
    StatusPageDomainService,
    "findOneBy",
  ) as unknown as jest.SpyInstance;
}

describe("StatusPageService MCP gate", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("resolveStatusPageIdOrNull", () => {
    test("resolves a UUID without querying the domain table", async () => {
      const domainSpy: jest.SpyInstance = spyOnDomainFindOneBy();

      const result: ObjectID | null =
        await StatusPageService.resolveStatusPageIdOrNull(VALID_UUID);

      expect(result?.toString()).toBe(VALID_UUID);
      expect(domainSpy).not.toHaveBeenCalled();
    });

    test("looks a domain up by fullDomain, requiring a verified domain", async () => {
      const statusPageId: ObjectID = new ObjectID(VALID_UUID);
      const domainSpy: jest.SpyInstance =
        spyOnDomainFindOneBy().mockResolvedValue(
          statusPageDomainWith(statusPageId) as never,
        );

      const result: ObjectID | null =
        await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);

      expect(result?.toString()).toBe(VALID_UUID);

      const args: Record<string, any> = domainSpy.mock.calls[0]![0] as Record<
        string,
        any
      >;

      expect(args["query"]["fullDomain"]).toBe(DOMAIN);
      expect(args["query"]["domain"]).toEqual({ isVerified: true });
      expect(args["props"]["isRoot"]).toBe(true);
    });

    test("returns null when the domain is not registered", async () => {
      spyOnDomainFindOneBy().mockResolvedValue(null as never);

      await expect(
        StatusPageService.resolveStatusPageIdOrNull(DOMAIN),
      ).resolves.toBeNull();
    });

    test("returns null when the domain row carries no status page", async () => {
      spyOnDomainFindOneBy().mockResolvedValue(
        statusPageDomainWith(null) as never,
      );

      await expect(
        StatusPageService.resolveStatusPageIdOrNull(DOMAIN),
      ).resolves.toBeNull();
    });

    test("returns null for an empty identifier without querying", async () => {
      const domainSpy: jest.SpyInstance = spyOnDomainFindOneBy();

      await expect(
        StatusPageService.resolveStatusPageIdOrNull(""),
      ).resolves.toBeNull();
      expect(domainSpy).not.toHaveBeenCalled();
    });

    test("returns null for a malformed UUID rather than throwing", async () => {
      await expect(
        StatusPageService.resolveStatusPageIdOrNull("not-a-uuid"),
      ).resolves.toBeNull();
    });

    test("returns null for a dotless hostname", async () => {
      /*
       * The dot is the discriminator, mirroring resolveStatusPageIdOrThrow in
       * StatusPageAPI. "localhost" therefore goes down the UUID path and fails
       * there. Pinned so the two resolvers cannot silently diverge.
       */
      await expect(
        StatusPageService.resolveStatusPageIdOrNull("localhost"),
      ).resolves.toBeNull();
    });
  });

  describe("isMcpServerEnabled", () => {
    test("is true when a UUID matches a status page with MCP enabled", async () => {
      spyOnStatusPageFindOneBy().mockResolvedValue(statusPageRow() as never);

      await expect(
        StatusPageService.isMcpServerEnabled(VALID_UUID),
      ).resolves.toBe(true);
    });

    test("is false when the status page has MCP disabled", async () => {
      /*
       * The enableMcpServer predicate is in the query, so a gated page simply
       * does not match.
       */
      spyOnStatusPageFindOneBy().mockResolvedValue(null as never);

      await expect(
        StatusPageService.isMcpServerEnabled(VALID_UUID),
      ).resolves.toBe(false);
    });

    test("folds the flag into the query and reads as root", async () => {
      const spy: jest.SpyInstance =
        spyOnStatusPageFindOneBy().mockResolvedValue(statusPageRow() as never);

      await StatusPageService.isMcpServerEnabled(VALID_UUID);

      const args: Record<string, any> = spy.mock.calls[0]![0] as Record<
        string,
        any
      >;

      expect(args["query"]["enableMcpServer"]).toBe(true);
      expect(args["query"]["_id"].toString()).toBe(VALID_UUID);
      expect(args["props"]["isRoot"]).toBe(true);
    });

    test("resolves a domain and then checks the flag", async () => {
      spyOnDomainFindOneBy().mockResolvedValue(
        statusPageDomainWith(new ObjectID(VALID_UUID)) as never,
      );
      const pageSpy: jest.SpyInstance =
        spyOnStatusPageFindOneBy().mockResolvedValue(statusPageRow() as never);

      await expect(StatusPageService.isMcpServerEnabled(DOMAIN)).resolves.toBe(
        true,
      );
      expect(pageSpy).toHaveBeenCalledTimes(1);
    });

    test("is false for an unknown status page, without a second query", async () => {
      spyOnDomainFindOneBy().mockResolvedValue(null as never);
      const pageSpy: jest.SpyInstance = spyOnStatusPageFindOneBy();

      await expect(StatusPageService.isMcpServerEnabled(DOMAIN)).resolves.toBe(
        false,
      );
      expect(pageSpy).not.toHaveBeenCalled();
    });

    test("is false for an unresolvable identifier", async () => {
      await expect(
        StatusPageService.isMcpServerEnabled("not-a-uuid"),
      ).resolves.toBe(false);
    });

    test("propagates a status page query failure instead of reporting disabled", async () => {
      /*
       * Fails closed either way, but the caller reports an error rather than
       * telling the agent the owner turned MCP off.
       */
      spyOnStatusPageFindOneBy().mockRejectedValue(
        new Error("connection terminated") as never,
      );

      await expect(
        StatusPageService.isMcpServerEnabled(VALID_UUID),
      ).rejects.toThrow("connection terminated");
    });

    test("propagates a domain query failure", async () => {
      spyOnDomainFindOneBy().mockRejectedValue(
        new Error("connection terminated") as never,
      );

      await expect(
        StatusPageService.isMcpServerEnabled(DOMAIN),
      ).rejects.toThrow("connection terminated");
    });
  });
});
