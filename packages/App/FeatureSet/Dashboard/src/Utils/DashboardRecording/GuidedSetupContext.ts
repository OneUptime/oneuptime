/*
 * WHERE IN A GUIDED SETUP THE PERSON IS, FOR A RECORDING (issue #6834).
 *
 * GuidedSetupFrame - which also sends the setup's events (#6830) and asks
 * "How easy was that?" (#6832) - says which setup is open and which of its
 * steps, by the same keys its events carry. A recording reads it to tie a
 * sign of frustration to the step it happened on. Nothing else reads it,
 * and nothing is kept: the frame clears it when it leaves.
 */

export interface GuidedSetupPlace {
  // The setup's key in its events: "website_down".
  setup: string;
  // The step's key, or "summary" once every step is done.
  step: string;
}

type Listener = (place: GuidedSetupPlace | null) => void;

let currentPlace: GuidedSetupPlace | null = null;
const listeners: Set<Listener> = new Set<Listener>();

export default class GuidedSetupContext {
  public static set(place: GuidedSetupPlace | null): void {
    if (
      currentPlace?.setup === place?.setup &&
      currentPlace?.step === place?.step
    ) {
      return;
    }

    currentPlace = place ? { setup: place.setup, step: place.step } : null;

    for (const listener of Array.from(listeners)) {
      try {
        listener(currentPlace);
      } catch {
        // One listener that throws does not keep the others from hearing it.
      }
    }
  }

  // Cleared only by the setup that set it, so a quick hand-over is kept.
  public static clear(setup: string): void {
    if (currentPlace?.setup === setup) {
      GuidedSetupContext.set(null);
    }
  }

  public static get(): GuidedSetupPlace | null {
    return currentPlace;
  }

  public static subscribe(listener: Listener): () => void {
    listeners.add(listener);

    return (): void => {
      listeners.delete(listener);
    };
  }
}
