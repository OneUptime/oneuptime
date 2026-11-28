import ProbeSchedulingLane from "./ProbeSchedulingLane";

/*
 * A PROBE'S CONNECTION MOVES OFF A SCHEDULING LANE THAT IS BACKED UP
 * (issue #11121).
 *
 * KEDA adds App pods while probe requests wait for a probe scheduling slot
 * (app.keda.probeSchedulingQueueDepthThreshold). But a probe keeps its
 * connections open (Node's agent: keep-alive, the most recently freed
 * socket first), and so does nginx in front of the App (upstream
 * keepalive), and kube-proxy sends a connection, not a request, to a pod.
 * A probe that asks for work all the time never lets a connection go idle,
 * so its requests kept going to the pods that were there when it opened
 * them. Measured with the probe dispatch benchmark (--balance connection),
 * two pods backed up and two more made Ready: through nginx, the new pods
 * answered under 1% of the probes' requests for the next two minutes
 * (nginx opened 6 of its 108 connections to them) while the old ones kept
 * 32 requests waiting; probes sending to the Service directly, 9% for the
 * first 30 seconds and 35% for the next 90, with 35 and then 17 waiting.
 *
 * So while a lane of this process has requests waiting for a slot, the
 * answer to a request it ran says "Connection: close", and the probe (or
 * nginx) opens a new connection for its next one, which kube-proxy may send
 * to any pod - a new one, or one less busy. At most one answer per lane
 * every PROBE_SCHEDULING_RECONNECT_EVERY_MS says so: a pod sheds a few
 * connections a second while it is backed up, enough to spread them over
 * the pods within seconds, and never a connection per request, which would
 * bring back the churn of new connections the upstream keepalive is there
 * to avoid. With it, in the same runs, the old pods' queue fell from 32 to
 * about 1 within 10 seconds, and the new pods ran 7 to 8 of their 10 slots
 * from then on, for 15 to 20 new connections a second across the four
 * pods. A lane with nothing waiting asks nobody to reconnect.
 */

// The least time between two answers of a lane that ask to reconnect.
export const PROBE_SCHEDULING_RECONNECT_EVERY_MS: number = 100;

export class ProbeSchedulingReconnect {
  private lastAskedAt: Map<ProbeSchedulingLane, number> = new Map<
    ProbeSchedulingLane,
    number
  >();

  public constructor(
    private readonly everyMs: number = PROBE_SCHEDULING_RECONNECT_EVERY_MS,
    private readonly now: () => number = (): number => {
      return Date.now();
    },
  ) {}

  /*
   * Whether the answer to a request of `lane` should ask its client to
   * reconnect: requests are waiting for one of the lane's slots in this
   * process, and no answer of the lane asked in the last `everyMs`. A yes
   * counts as the lane's ask.
   */
  public shouldAskToReconnect(data: {
    lane: ProbeSchedulingLane;
    waiting: number;
  }): boolean {
    if (!(data.waiting > 0)) {
      return false;
    }

    const now: number = this.now();
    const last: number | undefined = this.lastAskedAt.get(data.lane);

    if (last !== undefined && now - last < this.everyMs && now >= last) {
      return false;
    }

    this.lastAskedAt.set(data.lane, now);
    return true;
  }
}

// The process's: every probe scheduling route of the App asks it.
export default new ProbeSchedulingReconnect();
