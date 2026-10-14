/*
 * Whether the reader's main pointer is a finger.
 *
 * On a phone, focusing a search box as its list opens throws the keyboard
 * over half of what the list offers. So a list opens for browsing there, and
 * a tap on its box searches: the Add Component panel (ComponentsModal) and a
 * record step's Add field list (FieldPicker/AddFieldsPanel) both ask this.
 */

type PrefersTouchFunction = () => boolean;

const prefersTouch: PrefersTouchFunction = (): boolean => {
  try {
    return Boolean(
      typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(pointer: coarse)").matches,
    );
  } catch {
    return false;
  }
};

export default prefersTouch;
