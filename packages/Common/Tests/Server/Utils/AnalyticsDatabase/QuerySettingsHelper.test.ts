import QuerySettingsHelper, {
  getQuerySettings,
  DEFAULT_MAX_MEMORY_USAGE_IN_BYTES,
  DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY_IN_BYTES,
  DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_SORT_IN_BYTES,
} from "../../../../Server/Utils/AnalyticsDatabase/QuerySettingsHelper";

/*
 * Unit tests for getQuerySettings — the builder for the trailing
 * ` SETTINGS ...` clause appended verbatim to every ClickHouse read query.
 *
 * The clause is NOT parameterized; it is concatenated straight into SQL, so
 * the exact emitted text matters. These tests lock down:
 *   - the always-present per-query memory ceiling and spill thresholds,
 *   - correct quoting (strings single-quoted, numbers bare),
 *   - the conditional execution-time / overflow-mode settings, and
 *   - the ordering of the emitted parts.
 */

describe("getQuerySettings", () => {
  test("always emits the memory ceiling and spill thresholds by default", () => {
    const clause: string = getQuerySettings();

    expect(clause).toBe(
      ` SETTINGS max_memory_usage = ${DEFAULT_MAX_MEMORY_USAGE_IN_BYTES}, ` +
        `max_bytes_before_external_group_by = ${DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY_IN_BYTES}, ` +
        `max_bytes_before_external_sort = ${DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_SORT_IN_BYTES}`,
    );
  });

  test("produces the same output whether called with no args or undefined", () => {
    expect(getQuerySettings()).toBe(getQuerySettings(undefined));
  });

  test("always starts with the ` SETTINGS ` keyword and a leading space", () => {
    expect(getQuerySettings().startsWith(" SETTINGS ")).toBe(true);
    expect(
      getQuerySettings({ maxExecutionTimeInSeconds: 30 }).startsWith(
        " SETTINGS ",
      ),
    ).toBe(true);
  });

  test("omits execution-time settings when not provided", () => {
    const clause: string = getQuerySettings();

    expect(clause).not.toContain("max_execution_time");
    expect(clause).not.toContain("timeout_overflow_mode");
  });

  test("includes max_execution_time when provided", () => {
    const clause: string = getQuerySettings({ maxExecutionTimeInSeconds: 45 });

    expect(clause).toContain("max_execution_time = 45");
    // Execution time is emitted before the memory settings.
    expect(clause.indexOf("max_execution_time")).toBeLessThan(
      clause.indexOf("max_memory_usage"),
    );
  });

  test("single-quotes the timeout overflow mode", () => {
    expect(getQuerySettings({ timeoutOverflowMode: "break" })).toContain(
      "timeout_overflow_mode = 'break'",
    );
    expect(getQuerySettings({ timeoutOverflowMode: "throw" })).toContain(
      "timeout_overflow_mode = 'throw'",
    );
  });

  test("emits execution time before overflow mode before memory settings", () => {
    const clause: string = getQuerySettings({
      maxExecutionTimeInSeconds: 10,
      timeoutOverflowMode: "break",
    });

    const timePos: number = clause.indexOf("max_execution_time");
    const overflowPos: number = clause.indexOf("timeout_overflow_mode");
    const memoryPos: number = clause.indexOf("max_memory_usage");

    expect(timePos).toBeGreaterThan(-1);
    expect(timePos).toBeLessThan(overflowPos);
    expect(overflowPos).toBeLessThan(memoryPos);
  });

  test("honours overrides for the memory ceiling and spill thresholds", () => {
    const clause: string = getQuerySettings({
      maxMemoryUsageInBytes: 100,
      maxBytesBeforeExternalGroupByInBytes: 50,
      maxBytesBeforeExternalSortInBytes: 25,
    });

    expect(clause).toContain("max_memory_usage = 100");
    expect(clause).toContain("max_bytes_before_external_group_by = 50");
    expect(clause).toContain("max_bytes_before_external_sort = 25");
    // The defaults must not leak through when overridden.
    expect(clause).not.toContain(`${DEFAULT_MAX_MEMORY_USAGE_IN_BYTES}`);
  });

  test("emits numeric additional settings without quotes", () => {
    const clause: string = getQuerySettings({
      additionalSettings: { max_threads: 4 },
    });

    expect(clause).toContain("max_threads = 4");
    expect(clause).not.toContain("max_threads = '4'");
  });

  test("single-quotes string additional settings", () => {
    const clause: string = getQuerySettings({
      additionalSettings: { optimize_aggregation_in_order: "1" },
    });

    expect(clause).toContain("optimize_aggregation_in_order = '1'");
  });

  test("appends additional settings after the memory settings", () => {
    const clause: string = getQuerySettings({
      additionalSettings: { optimize_use_projections: 1 },
    });

    expect(clause.indexOf("max_bytes_before_external_sort")).toBeLessThan(
      clause.indexOf("optimize_use_projections"),
    );
  });

  test("joins every setting with a comma-and-space separator", () => {
    const clause: string = getQuerySettings({
      maxExecutionTimeInSeconds: 5,
      timeoutOverflowMode: "throw",
      additionalSettings: { max_threads: 2 },
    });

    /*
     * The clause after " SETTINGS " is a comma-separated list; splitting it
     * must yield one entry per emitted setting (2 conditional + 3 memory + 1
     * extra).
     */
    const body: string = clause.replace(" SETTINGS ", "");
    expect(body.split(", ").length).toBe(6);
  });

  test("class static method delegates to the standalone function", () => {
    const options: { maxExecutionTimeInSeconds: number } = {
      maxExecutionTimeInSeconds: 12,
    };

    expect(QuerySettingsHelper.getQuerySettings(options)).toBe(
      getQuerySettings(options),
    );
    expect(QuerySettingsHelper.getQuerySettings()).toBe(getQuerySettings());
  });
});
