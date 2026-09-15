/*
 * Ping round-trip time of a network device, in ms.
 *
 * Ping monitors write their RTT into MonitorMetricType.ResponseTime, but on
 * a network device that series is the SNMP walk's time (and is absent on a
 * ping-only poll), so the RTT needs a series of its own. It sits in the
 * `oneuptime.monitor.ping.*` namespace beside PacketLossPercent and Jitter,
 * which ARE reused from the Ping monitor. MonitorMetricType has no member
 * for it yet; this constant should graduate into that enum (and the device
 * metric catalog) rather than be duplicated.
 *
 * Lives under Common/Types rather than next to the writer in
 * Common/Server/Utils because the dashboard reads the same series back (the
 * device drawer's latency trend) and browser code must not import server
 * modules — NetworkDeviceMetricUtil pulls in the telemetry SDK and the
 * metric service at load. The server util re-exports it under the same
 * name, so its existing importers do not move.
 */
export const NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME: string =
  "oneuptime.monitor.ping.round.trip.time";
