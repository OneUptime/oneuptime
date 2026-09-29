import {
  BURST_THRESHOLD,
  BURST_WINDOW_MINUTES,
  CLAIM_EPOCH_MINUTES,
  FLUSH_AFTER_MINUTES,
} from "../../../../Server/Utils/EmailRollup/EmailRollupConstants";
import { describe, expect, test } from "@jest/globals";

/*
 * THE BURST WINDOW, SIZED AGAINST THE FLOOD THAT GOT THROUGH.
 *
 * EmailRollupWriter.test.ts pins the writer's MECHANISM against the
 * constants symbolically, so it passes at any value of them. This suite pins
 * the VALUE, in the units of the incident that chose it, so narrowing the
 * window back fails loudly instead of silently reopening the blind spot.
 *
 * The incident: one Kubernetes monitor created from a OneUptime
 * recommendation raised and resolved the same condition over and over -
 * 39 owner emails, 19 open and 20 resolve, in under two hours. Both event
 * types map to RollupCategory.Alerts, so they share one burst counter.
 *
 * That is about 3.3 emails per ten minutes: PERSISTENTLY UNDER a trip point
 * of four. A slow flap is exactly the shape a short window cannot see, and it
 * is the shape that actually reaches people's inboxes.
 */

// 19 open + 20 resolve, in under two hours.
const FLAP_EMAIL_COUNT: number = 39;
const FLAP_DURATION_MINUTES: number = 118;

function itemsPerWindow(windowMinutes: number): number {
  return (FLAP_EMAIL_COUNT / FLAP_DURATION_MINUTES) * windowMinutes;
}

describe("the burst window is sized to catch a slow flap", () => {
  /*
   * THE REGRESSION TEST. If someone puts the window back to ten minutes, or
   * raises the threshold past what the observed rate reaches, this fails.
   */
  test("the observed flap rate trips the throttle at the shipped window", () => {
    expect(itemsPerWindow(BURST_WINDOW_MINUTES)).toBeGreaterThanOrEqual(
      BURST_THRESHOLD,
    );
  });

  /*
   * And the reason the window changed: at ten minutes the same flap never
   * reaches the trip point, so every one of the 39 emails is sent
   * immediately. This assertion is what makes the one above meaningful -
   * without it, "the rate trips the throttle" would also pass at a window of
   * ten if the threshold were lowered instead, which is a different and worse
   * trade (it would coalesce ordinary incidents).
   */
  test("a ten-minute window would have missed it entirely", () => {
    expect(itemsPerWindow(10)).toBeLessThan(BURST_THRESHOLD);
  });

  test("the shipped window is wider than the one that missed it", () => {
    expect(BURST_WINDOW_MINUTES).toBeGreaterThan(10);
  });

  /*
   * The threshold is deliberately UNCHANGED: it still covers one incident's
   * whole normal lifecycle (created -> acknowledged -> resolved) plus one
   * more event, so a single real incident is never coalesced.
   */
  test("one incident's full lifecycle still sends immediately", () => {
    const CREATED_ACKNOWLEDGED_RESOLVED: number = 3;

    expect(BURST_THRESHOLD).toBeGreaterThan(CREATED_ACKNOWLEDGED_RESOLVED);
  });

  /*
   * Widening the window must not have disturbed the flush invariant.
   * CLAIM_EPOCH_MINUTES === FLUSH_AFTER_MINUTES is what makes "a legitimate
   * consecutive flush always lands in a later epoch" true, and it is
   * independent of the burst window.
   */
  test("the flush invariant is untouched by the window change", () => {
    expect(CLAIM_EPOCH_MINUTES).toBe(FLUSH_AFTER_MINUTES);
    expect(FLUSH_AFTER_MINUTES).toBeLessThan(BURST_WINDOW_MINUTES);
  });
});
