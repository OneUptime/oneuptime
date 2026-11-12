import {
  formatPhoneNumberPrintFindings,
  scanPhoneNumberPrints,
} from "../PhoneNumberPrints";
import { describe, expect, test } from "@jest/globals";

describe("probe", () => {
  test("findings", () => {
    expect(formatPhoneNumberPrintFindings(scanPhoneNumberPrints())).toBe("");
  });
});
