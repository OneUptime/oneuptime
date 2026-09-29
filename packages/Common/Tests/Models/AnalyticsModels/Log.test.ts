import Log from "../../../Models/AnalyticsModels/Log";

describe("Analytics Log model", () => {
  test("should deserialize ClickHouse DateTime64 values as Date objects", () => {
    const log: Log = Log.fromJSON(
      {
        time: "2026-04-01 14:45:31.414000000",
      },
      Log,
    ) as Log;

    expect(log.time).toBeInstanceOf(Date);
    expect(log.time?.toISOString()).toBe("2026-04-01T14:45:31.414Z");
  });
});
