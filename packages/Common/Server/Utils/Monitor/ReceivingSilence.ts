import OneUptimeDate from "../../../Types/Date";
import ProductBrandingText from "../ProductBrandingText";
import ReceivingCoverage from "../Telemetry/ReceivingCoverage";

export interface MeasuredSilence {
  // Minutes since the resource was last heard from, by the clock.
  wallMinutes: number;
  /*
   * The part of those minutes OneUptime was receiving: what the resource's
   * silence really is, and what a "not heard from in N minutes" rule judges.
   */
  receivingMinutes: number;
  // The rest: minutes OneUptime itself was not receiving (issue #2825).
  notReceivingMinutes: number;
}

/*
 * How long a resource has really been silent: the time since it was last
 * heard from, without the time OneUptime itself was not receiving - a
 * restart, an upgrade, a backed-up ingest queue (issue #2825).
 *
 * Used by the checks that turn silence into "offline": a server agent that
 * stopped checking in, a heartbeat URL that stopped being called, an inbox
 * that stopped getting email. None of those could reach OneUptime while it
 * was not receiving, so that time is never held against them.
 */
export default class ReceivingSilence {
  /*
   * The silence of a resource last heard from at `lastHeardAt`, at `now`.
   *
   * The ledger is only asked when the clock alone says the silence has
   * reached `thresholdInMinutes`: below that no gap can make it longer, so
   * the common case - a resource heard from recently - costs nothing.
   */
  public static async measure(data: {
    lastHeardAt: Date | string;
    now: Date | string;
    thresholdInMinutes: number;
  }): Promise<MeasuredSilence> {
    const wallMinutes: number = OneUptimeDate.getDifferenceInMinutes(
      OneUptimeDate.fromString(data.lastHeardAt),
      OneUptimeDate.fromString(data.now),
    );

    if (wallMinutes < data.thresholdInMinutes) {
      return {
        wallMinutes,
        receivingMinutes: wallMinutes,
        notReceivingMinutes: 0,
      };
    }

    const receivingMinutes: number = Math.min(
      wallMinutes,
      await ReceivingCoverage.getReceivingMinutes({
        from: data.lastHeardAt,
        to: data.now,
      }),
    );

    return {
      wallMinutes,
      receivingMinutes,
      notReceivingMinutes: wallMinutes - receivingMinutes,
    };
  }

  /*
   * How a root cause says when it was last heard from: "It was received 25
   * minutes ago, 12 of them while OneUptime was not receiving requests, which
   * do not count." - or just "It was received 25 minutes ago." when OneUptime
   * was receiving all along. `verb` and `what` name the resource's side:
   * ("received", "requests"), ("received", "emails").
   */
  public static describe(data: {
    silence: MeasuredSilence;
    verb: string;
    what: string;
  }): string {
    const lastHeard: string = `It was ${data.verb} ${data.silence.wallMinutes} minutes ago`;

    if (data.silence.notReceivingMinutes <= 0) {
      return `${lastHeard}.`;
    }

    return `${lastHeard}, ${data.silence.notReceivingMinutes} of them while ${ProductBrandingText.getProductName()} was not receiving ${data.what}, which do not count.`;
  }
}
