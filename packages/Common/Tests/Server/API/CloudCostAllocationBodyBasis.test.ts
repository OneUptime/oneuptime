import { readAllocationBody } from "../../../Server/API/CloudCostViewAPI";
import { CloudCostBasis } from "../../../Types/Cloud/CloudCostBasis";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * THE BASIS A VIEW'S ALLOCATION IS READ ON (#11007).
 *
 * POST /cloud-cost-view/:id/allocation and /cloud-cost-group/:id/spend
 * take an optional basis - billed, amortized or net - as a script, the CLI
 * or an AI agent sends it; none reads the project's own (Cloud > Settings >
 * Cost Settings), and anything else is refused with what to send.
 */

const WINDOW: { startDate: string; endDate: string } = {
  startDate: "2026-11-01",
  endDate: "2026-11-30",
};

describe("an allocation's basis, as a request sends it", () => {
  test.each([
    CloudCostBasis.Billed,
    CloudCostBasis.Amortized,
    CloudCostBasis.Net,
  ])("%s is read as it is", (basis: CloudCostBasis) => {
    expect(readAllocationBody({ ...WINDOW, basis }).basis).toBe(basis);
  });

  test("none, null or empty is the project's: left for the read to look up", () => {
    expect(readAllocationBody({ ...WINDOW }).basis).toBeUndefined();
    expect(
      readAllocationBody({ ...WINDOW, basis: null }).basis,
    ).toBeUndefined();
    expect(readAllocationBody({ ...WINDOW, basis: "" }).basis).toBeUndefined();
  });

  test("anything else is refused, saying what to send", () => {
    for (const basis of ["Amortized", "amortizedCost", "unblended", 1, true]) {
      expect(() => {
        return readAllocationBody({ ...WINDOW, basis });
      }).toThrow(BadDataException);
      expect(() => {
        return readAllocationBody({ ...WINDOW, basis });
      }).toThrow("Send basis as billed, amortized or net.");
    }
  });

  test("the rest of the body is read as before", () => {
    const body: ReturnType<typeof readAllocationBody> = readAllocationBody({
      ...WINDOW,
      currency: " eur ",
      basis: CloudCostBasis.Net,
      compareWithPrevious: false,
    });

    expect(body.startDate.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(body.endDate.toISOString()).toBe("2026-11-30T00:00:00.000Z");
    expect(body.currency).toBe("eur");
    expect(body.compareWithPrevious).toBe(false);
    expect(body.basis).toBe(CloudCostBasis.Net);
  });
});
