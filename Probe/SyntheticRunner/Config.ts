import NumberUtil from "Common/Utils/Number";
import Port from "Common/Types/Port";

export const PORT: Port = new Port(
  NumberUtil.parseNumberWithDefault({
    value: process.env["PORT"],
    defaultValue: 3885,
    min: 1,
  }),
);

export const SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS"],
    defaultValue: 60000,
    min: 1,
  });

export const SYNTHETIC_MONITOR_RETRY_DELAY_IN_MS: number = 1000;

export const SYNTHETIC_MONITOR_ATTEMPT_PADDING_IN_MS: number = 30000;

export const SYNTHETIC_MONITOR_CHILD_USER_ID: number = 1000;

export const SYNTHETIC_MONITOR_CHILD_GROUP_ID: number = 1000;

export const SYNTHETIC_MONITOR_CHILD_HOME_DIR: string =
  "/tmp/oneuptime-synthetic-runner";
