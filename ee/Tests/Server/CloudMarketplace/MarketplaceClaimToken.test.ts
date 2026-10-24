import crypto from "crypto";
import { MARKETPLACE_PURCHASE_PENDING_COOKIE_NAME } from "Common/Types/Marketplace/MarketplacePurchase";
import MarketplaceClaimToken from "../../../Server/CloudMarketplace/MarketplaceClaimToken";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { describe, expect, it } from "@jest/globals";

/*
 * The token that lets the browser a marketplace purchase arrived in link it
 * to a project. A bearer secret: it travels only in an HttpOnly cookie
 * scoped to the marketplace API, and only its hash is stored.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

describe("MarketplaceClaimToken", () => {
  it("generates 256 random bits as hex, different every time", () => {
    const tokens: Set<string> = new Set();

    for (let index: number = 0; index < 50; index++) {
      const token: string = MarketplaceClaimToken.generate();

      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(MarketplaceClaimToken.isToken(token)).toBe(true);
      tokens.add(token);
    }

    expect(tokens.size).toBe(50);
  });

  it("stores the SHA-256 of the token", () => {
    const token: string = MarketplaceClaimToken.generate();

    expect(MarketplaceClaimToken.hash(token)).toBe(
      crypto.createHash("sha256").update(token, "utf8").digest("hex"),
    );
    expect(MarketplaceClaimToken.hash(token)).not.toBe(token);
  });

  it("recognizes only its own token format", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      `${"a".repeat(63)}g`,
      `${"a".repeat(64)}\n`,
      ["a".repeat(64)],
    ]) {
      expect(MarketplaceClaimToken.isToken(value)).toBe(false);
    }
  });

  it("expires a day from now", () => {
    const expiresAt: number = MarketplaceClaimToken.getExpiryDate().getTime();

    expect(Math.abs(expiresAt - (Date.now() + DAY_IN_MS))).toBeLessThan(5000);
  });

  it("sets the token HttpOnly on the marketplace API only, and a readable marker on the dashboard", () => {
    const cookie: jest.Mock = jest.fn();
    const res: ExpressResponse = { cookie } as unknown as ExpressResponse;
    const token: string = MarketplaceClaimToken.generate();

    MarketplaceClaimToken.setCookies(res, token);

    expect(cookie).toHaveBeenCalledTimes(2);
    expect(cookie).toHaveBeenCalledWith(
      "oneuptime-marketplace-purchase",
      token,
      expect.objectContaining({
        path: "/api/marketplace",
        httpOnly: true,
        sameSite: "lax",
        maxAge: DAY_IN_MS,
      }),
    );
    // The marker says only that a purchase is waiting; it carries nothing secret.
    expect(cookie).toHaveBeenCalledWith(
      MARKETPLACE_PURCHASE_PENDING_COOKIE_NAME,
      "1",
      expect.objectContaining({
        path: "/dashboard",
        httpOnly: false,
        sameSite: "lax",
        maxAge: DAY_IN_MS,
      }),
    );
  });

  it("clears both cookies on the paths they were set on", () => {
    const clearCookie: jest.Mock = jest.fn();
    const res: ExpressResponse = { clearCookie } as unknown as ExpressResponse;

    MarketplaceClaimToken.clearCookies(res);

    expect(clearCookie).toHaveBeenCalledWith(
      "oneuptime-marketplace-purchase",
      expect.objectContaining({ path: "/api/marketplace" }),
    );
    expect(clearCookie).toHaveBeenCalledWith(
      MARKETPLACE_PURCHASE_PENDING_COOKIE_NAME,
      expect.objectContaining({ path: "/dashboard" }),
    );
  });

  it("reads the token from the request, and nothing that is not one", () => {
    const token: string = MarketplaceClaimToken.generate();

    const read: (cookies: unknown) => string | null = (
      cookies: unknown,
    ): string | null => {
      return MarketplaceClaimToken.readFromRequest({
        cookies: cookies,
      } as unknown as ExpressRequest);
    };

    expect(read({ "oneuptime-marketplace-purchase": token })).toBe(token);
    expect(read({ "oneuptime-marketplace-purchase": "forged" })).toBeNull();
    expect(
      read({ [MARKETPLACE_PURCHASE_PENDING_COOKIE_NAME]: token }),
    ).toBeNull();
    expect(read({})).toBeNull();
    expect(read(undefined)).toBeNull();
  });
});
