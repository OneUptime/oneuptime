import {
  SecurityConnectorCheck,
  SecurityConnectorCheckStatus,
  summarizeCheckStatuses,
} from "../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { describe, expect, test } from "@jest/globals";

/*
 * The report verdict is folded from the checks. The rule is what the modal
 * banner shows, so it is pinned: any failure fails the report, otherwise
 * any warning makes it a warning, and skips are neutral (a skipped step is
 * explained by the failure that caused it, never counted twice).
 */

function check(
  status: SecurityConnectorCheckStatus,
  key: string = status,
): SecurityConnectorCheck {
  return {
    key,
    name: key,
    status,
    durationMs: 1,
    message: `${key} ${status}`,
  };
}

describe("summarizeCheckStatuses", () => {
  test("no checks is a pass (nothing failed, nothing warned)", () => {
    expect(summarizeCheckStatuses([])).toBe("pass");
  });

  test("all passing checks pass", () => {
    expect(summarizeCheckStatuses([check("pass"), check("pass")])).toBe("pass");
  });

  test("skips alone are neutral and leave the report passing", () => {
    expect(summarizeCheckStatuses([check("skip")])).toBe("pass");
    expect(summarizeCheckStatuses([check("pass"), check("skip")])).toBe("pass");
  });

  test("a single warning turns the report into a warning", () => {
    expect(
      summarizeCheckStatuses([check("pass"), check("warn"), check("skip")]),
    ).toBe("warn");
  });

  test("a single failure wins over any number of passes and warnings", () => {
    expect(
      summarizeCheckStatuses([
        check("pass"),
        check("warn"),
        check("fail"),
        check("warn"),
        check("skip"),
      ]),
    ).toBe("fail");
  });

  test("order does not matter", () => {
    const statuses: Array<SecurityConnectorCheckStatus> = [
      "warn",
      "pass",
      "fail",
    ];

    expect(
      summarizeCheckStatuses(
        statuses.map((status: SecurityConnectorCheckStatus) => {
          return check(status);
        }),
      ),
    ).toBe("fail");
    expect(
      summarizeCheckStatuses(
        [...statuses].reverse().map((status: SecurityConnectorCheckStatus) => {
          return check(status);
        }),
      ),
    ).toBe("fail");
  });
});
