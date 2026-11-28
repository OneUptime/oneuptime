/*
 * WHEN A PROBE'S WORKERS ASK FOR THEIR MONITORS (OneUptime issue #11333).
 *
 * Every minute, each worker of a probe asks the server for the monitors
 * that are due (Probe/Jobs/Monitor/FetchList), and the server hands each
 * one out stamped with its next whole minute. Each worker used to wait a
 * new random 0 to 45 seconds first, every minute, so a monitor checked every
 * minute was checked at one random second one minute and another the next:
 * 15 to 105 seconds apart.
 *
 * Now each worker asks at its own moment of the minute, the same moment
 * every minute, so what it is handed is checked a minute after it last was.
 * A probe's workers are spread evenly over the first `spreadMs` of the
 * minute: its first worker at a moment drawn once, as the probe starts, in
 * the first `spreadMs / workers`, and each next one `spreadMs / workers`
 * after the one before. So a probe's own workers never ask at once, and the
 * probes of a server - and the replicas of one probe, which share its id -
 * each ask at their own moments, spread over the minute as they were.
 *
 * Each worker's moment is counted from the start of the minute its tick
 * fired in: a tick fires at the minute's start (node-cron), and a little
 * late now and then, which its wait absorbs. A worker whose moment of the
 * minute has passed - a probe that has just started - asks at once.
 */
export default class ProbeFetchMoments {
  /*
   * Each worker's moment of the minute, in ms from its start: worker 1
   * first. `random` is a draw in [0, 1), made once for the probe.
   */
  public static getWorkerOffsetsMs(data: {
    workers: number;
    spreadMs: number;
    random: number;
  }): Array<number> {
    const workers: number = Math.max(1, Math.floor(data.workers) || 1);
    const spreadMs: number = Math.max(0, data.spreadMs) || 0;
    const random: number =
      Number.isFinite(data.random) && data.random >= 0 && data.random < 1
        ? data.random
        : 0;

    const stepMs: number = spreadMs / workers;
    const firstMs: number = random * stepMs;
    const offsets: Array<number> = [];

    for (let worker: number = 0; worker < workers; worker++) {
      offsets.push(Math.floor(firstMs + worker * stepMs));
    }

    return offsets;
  }

  /*
   * How long a worker whose moment is `offsetMs` waits, at `nowMs`, for its
   * moment of the minute it is in; none once that moment has passed.
   */
  public static getWaitMs(data: { offsetMs: number; nowMs: number }): number {
    const minuteStartMs: number = Math.floor(data.nowMs / 60000) * 60000;

    return Math.max(0, minuteStartMs + data.offsetMs - data.nowMs);
  }
}
