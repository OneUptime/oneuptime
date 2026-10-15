/*
 * A device's Overview lists what the device is called and what it says about
 * itself. Several of those come from the same place: a discovery import
 * names a device after its SNMP system name and fills its description from
 * its system description, so the card used to show each twice, one row under
 * the other, word for word.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

/**
 * Whether `value` is worth a row of its own beside `shownAlready`: present,
 * and not the same words (ignoring case and the space around them).
 */
export function isDifferentText(
  value: string | null | undefined,
  shownAlready: string | null | undefined,
): boolean {
  const text: string = (value || "").trim();

  if (!text) {
    return false;
  }

  return text.toLowerCase() !== (shownAlready || "").trim().toLowerCase();
}
