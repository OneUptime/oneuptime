/*
 * Escape in a shared Dropdown whose menu is closed belongs to what holds the
 * picker - a dialog closes on it, as it did when the picker was a raw
 * <select> (#9310). react-select prevents the default of every Escape it
 * sees, open menu or not, and a dialog leaves a key whose default was
 * prevented alone, so the Dropdown marks the ones it passes on, and the
 * dialog reads the mark.
 */

const passedOn: WeakSet<Event> = new WeakSet<Event>();

// The Dropdown did nothing with this Escape: its menu was closed.
export function passEscapeOn(event: Event): void {
  passedOn.add(event);
}

export function isEscapePassedOn(event: Event): boolean {
  return passedOn.has(event);
}
