import { JSONArray, JSONObject } from "Common/Types/JSON";

/*
 * The topology map's uplink-inference banner, computed without react.
 *
 * Endpoint uplink inference (issue #3489) places ping-monitored devices by
 * recognising them in a switch's MAC address table. It refuses far more often
 * than it draws — deliberately, because a cable drawn to the wrong rack is
 * worse than no cable at all — and each refusal has a cause the operator can
 * fix. This is how those causes reach the screen.
 *
 * Same shape and same reasoning as LinkRuleWarningUtil beside it: the payload
 * is untrusted JSON, a row missing its message must be dropped rather than
 * rendered as an empty bullet, and parsing lives here so it is an assertion in
 * the test suite rather than a hope — App/Tests cannot render a component.
 */

/** One bullet on the map's uplink-inference banner. Mirrors UplinkInferenceWarning. */
export interface TopologyUplinkWarning {
  reason: string;
  message: string;
  /*
   * The named devices, capped by the endpoint. Never assume this is all of
   * them — `deviceCount` is the true total and can be larger.
   */
  deviceIds: Array<string>;
  deviceCount: number;
}

const isFiniteNumber: (value: unknown) => value is number = (
  value: unknown,
): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

/** Narrow the endpoint's `uplinkInferenceWarnings` array, dropping malformed rows. */
export const parseUplinkWarnings: (
  raw: unknown,
) => Array<TopologyUplinkWarning> = (
  raw: unknown,
): Array<TopologyUplinkWarning> => {
  const rows: JSONArray = Array.isArray(raw) ? (raw as JSONArray) : [];

  return rows
    .map((row: unknown): TopologyUplinkWarning | null => {
      const warning: JSONObject = (row || {}) as JSONObject;
      const reason: unknown = warning["reason"];
      const message: unknown = warning["message"];

      if (typeof reason !== "string" || !reason) {
        return null;
      }
      if (typeof message !== "string" || !message) {
        return null;
      }

      /*
       * Held as unknown rather than as a JSONArray: that alias is an array
       * of JSONObject, so an `id is string` guard cannot narrow it and the
       * filter falls back to the overload returning JSONObject[].
       */
      const rawDeviceIds: Array<unknown> = Array.isArray(warning["deviceIds"])
        ? (warning["deviceIds"] as Array<unknown>)
        : [];

      const deviceIds: Array<string> = rawDeviceIds.filter(
        (id: unknown): id is string => {
          return typeof id === "string" && id.length > 0;
        },
      );

      const deviceCountRaw: unknown = warning["deviceCount"];
      /*
       * The endpoint's count wins when it is at least as large as the ids it
       * sent — that is why both are sent, the ids being capped and the count
       * not. A count SMALLER than the ids is a payload contradicting itself,
       * so the ids are believed instead.
       */
      const deviceCount: number = isFiniteNumber(deviceCountRaw)
        ? Math.max(deviceCountRaw, deviceIds.length)
        : deviceIds.length;

      if (deviceCount === 0) {
        // Nothing was affected, so there is nothing to warn about.
        return null;
      }

      return {
        reason: reason,
        message: message,
        deviceIds: deviceIds,
        deviceCount: deviceCount,
      };
    })
    .filter(
      (
        warning: TopologyUplinkWarning | null,
      ): warning is TopologyUplinkWarning => {
        return warning !== null;
      },
    );
};
