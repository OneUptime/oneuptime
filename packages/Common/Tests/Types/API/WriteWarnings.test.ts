import { describe, expect, test } from "@jest/globals";
import WriteWarnings, {
  MAX_WRITE_WARNING_LENGTH,
  WRITE_WARNING_HEADER,
} from "../../../Types/API/WriteWarnings";

/*
 * WHAT A WRITE THROUGH THE API DOES THAT ITS CALLER SHOULD KNOW (#10436).
 *
 * One sentence per header line, in plain ASCII, which the Terraform
 * provider shows as a warning.
 */

describe("WriteWarnings", () => {
  test("the header the Terraform provider reads", () => {
    expect(WRITE_WARNING_HEADER).toBe("X-OneUptime-Write-Warning");
  });

  test("a sentence as one header line: printable ASCII, one line, cut to its length", () => {
    expect(
      WriteWarnings.toHeaderValue(
        "  2 monitors read\nlogs this filter drops: “Café” ✓  ",
      ),
    ).toBe("2 monitors read logs this filter drops: Caf");

    const long: string = WriteWarnings.toHeaderValue("a".repeat(5000));

    expect(long).toHaveLength(MAX_WRITE_WARNING_LENGTH);
  });

  test("the warnings an answer's headers carry, whatever the case of its name", () => {
    expect(
      WriteWarnings.fromHeaders({
        "x-oneuptime-write-warning": ["One.", "  ", "Two."],
        "content-type": "application/json",
      }),
    ).toEqual(["One.", "Two."]);
    expect(
      WriteWarnings.fromHeaders({ "X-OneUptime-Write-Warning": "Only." }),
    ).toEqual(["Only."]);
    expect(WriteWarnings.fromHeaders({})).toEqual([]);
    expect(WriteWarnings.fromHeaders(null)).toEqual([]);
  });
});
