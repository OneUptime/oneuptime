/*
 * The sizes of the attribute pickers' answers, shared by the server that
 * caps them and the explorers that read them (issue #4708).
 */

/*
 * The most attribute keys a project's key list holds
 * (TelemetryAttributeService.fetchAttributes). A list this long may be cut
 * short, so a picker cannot take "not in the list" to mean "the project does
 * not have this key" and looks the key up anyway.
 */
export const ATTRIBUTE_KEYS_LIMIT: number = 5000;

// The most values one value lookup answers with.
export const ATTRIBUTE_VALUES_LIMIT: number = 100;

/*
 * The longest value a lookup offers, in characters. A longer one (a stack
 * trace, a SQL statement) is no use as a line in a dropdown and can still be
 * typed or pasted; leaving it out keeps one answer under about 100 KB.
 */
export const MAX_SUGGESTED_ATTRIBUTE_VALUE_LENGTH: number = 1000;
