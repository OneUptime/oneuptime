import ProductEvents from "./ProductEvents";
import { ProductEventName } from "../../Types/Analytics/ProductEvent";
import { JSONObject } from "../../Types/JSON";
import React, { useEffect, useRef } from "react";

/*
 * A guided setup's events (issue #6830, for the guided setups #6804, #6805
 * and #6806): guided_setup/started when it opens, guided_setup/step_reached
 * as it moves on, guided_setup/finished at its end - the thing works and was
 * tested - and guided_setup/left, with the step, when it is left before
 * that. In a setup's page:
 *
 *   const setupEvents: GuidedSetupEvents = useGuidedSetupEvents("website_down");
 *   setupEvents.reachStep("pick_who_to_tell");   // each step, as it shows
 *   setupEvents.finish();                        // once the test page arrived
 *
 * The hook sends started when the page mounts, and left when it unmounts or
 * the tab closes before finish(). The setup's and the steps' keys are
 * words the code chooses (snake_case), never what a person typed.
 */
export class GuidedSetupEvents {
  private readonly setup: string;
  private readonly now: () => number;
  private startedAtMs: number | null = null;
  private step: string | null = null;
  private stepNumber: number = 0;
  private isDone: boolean = false;

  public constructor(setup: string, now?: () => number) {
    this.setup = setup;
    this.now =
      now ||
      ((): number => {
        return Date.now();
      });
  }

  public start(): void {
    if (this.startedAtMs !== null) {
      return;
    }

    this.startedAtMs = this.now();
    ProductEvents.send(ProductEventName.GuidedSetupStarted, {
      setup: this.setup,
    });
  }

  // The setup moved on to this step. The same step twice in a row is once.
  public reachStep(step: string): void {
    if (this.isDone || step === this.step) {
      return;
    }

    this.step = step;
    this.stepNumber++;
    ProductEvents.send(ProductEventName.GuidedSetupStepReached, {
      ...this.getStepProperties(),
    });
  }

  // The setup reached its end. Nothing is sent for it after this.
  public finish(): void {
    if (this.isDone) {
      return;
    }

    this.isDone = true;

    const properties: JSONObject = { setup: this.setup };

    if (this.startedAtMs !== null) {
      properties["seconds_taken"] = Math.max(
        0,
        Math.round((this.now() - this.startedAtMs) / 1000),
      );
    }

    ProductEvents.send(ProductEventName.GuidedSetupFinished, properties);
  }

  // The setup was left before its end: at the step it was on.
  public leave(): void {
    if (this.isDone || this.startedAtMs === null) {
      return;
    }

    this.isDone = true;
    ProductEvents.send(ProductEventName.GuidedSetupLeft, {
      ...this.getStepProperties(),
    });
  }

  public isFinishedOrLeft(): boolean {
    return this.isDone;
  }

  private getStepProperties(): JSONObject {
    return {
      setup: this.setup,
      step: this.step || "",
      step_number: this.stepNumber,
    };
  }
}

/*
 * The setup's events for a page: started once on mount, left on unmount or
 * when the tab closes before finish().
 */
export const useGuidedSetupEvents: (setup: string) => GuidedSetupEvents = (
  setup: string,
): GuidedSetupEvents => {
  const eventsRef: React.MutableRefObject<GuidedSetupEvents | null> =
    useRef<GuidedSetupEvents | null>(null);

  if (!eventsRef.current) {
    eventsRef.current = new GuidedSetupEvents(setup);
  }

  const events: GuidedSetupEvents = eventsRef.current;

  useEffect(() => {
    events.start();

    const leaveOnClose: () => void = (): void => {
      events.leave();
    };

    window.addEventListener("pagehide", leaveOnClose);

    return () => {
      window.removeEventListener("pagehide", leaveOnClose);
      events.leave();
    };
  }, []);

  return events;
};
