/*
 * The box around a topology map's "Line labels" / "Connection labels"
 * picker, in the bar over the map (the Topology page's maps and the message
 * queue map). The picker is the shared Dropdown, so its height, border,
 * focus ring, menu and dark look are every other picker's (#9294). The box
 * is wide enough for "Average latency" in the longer languages, and never
 * wider than the bar on a phone.
 */
export const TOPOLOGY_LINE_LABEL_DROPDOWN_CLASS_NAME: string =
  "relative w-48 max-w-full overflow-visible";
