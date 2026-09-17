/*
 * Dismissal belongs to the topmost layer that is open.
 *
 * A colour picker, an icon grid or an autocomplete menu inside a modal is
 * portalled to document.body so the modal body cannot clip it, and it closes
 * itself on a press that lands anywhere else. Very often "anywhere else" is the
 * modal's own backdrop, which reads the same press as a dismissal of the whole
 * dialog - so one click aimed at the popup takes the half-filled form with it.
 *
 * A popup that consumes a press records it here, and the backdrop skips any
 * press it finds. The set is keyed on the native event object and holds it
 * weakly, so nothing outlives the press it describes.
 */

const pressesConsumedByAnAnchoredPopup: WeakSet<Event> = new WeakSet<Event>();

export type ConsumePressFunction = (event: Event) => void;

export const consumePressForAnchoredPopup: ConsumePressFunction = (
  event: Event,
): void => {
  pressesConsumedByAnAnchoredPopup.add(event);
};

export type WasPressConsumedFunction = (event: Event) => boolean;

export const wasPressConsumedByAnAnchoredPopup: WasPressConsumedFunction = (
  event: Event,
): boolean => {
  return pressesConsumedByAnAnchoredPopup.has(event);
};
