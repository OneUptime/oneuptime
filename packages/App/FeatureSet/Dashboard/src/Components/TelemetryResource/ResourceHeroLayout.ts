/*
 * HOW A RESOURCE HERO'S TOP ROW IS LAID OUT: the resource's icon, name,
 * badges and when it was last seen, and the refresh control beside them.
 *
 * Side by side on a phone, the refresh control and its interval picker left
 * the name a few letters: a Docker Swarm cluster's hero read "swa…" and its
 * description "The pr…" (follow-up of #5076, the Swarm pages on a phone).
 * So the top row sits in a container (`container-type: inline-size`), and
 * the name and the refresh control sit side by side only while the row is
 * at least RESOURCE_HERO_SIDE_BY_SIDE_MIN_WIDTH_REM wide: narrower, the
 * refresh control takes a line of its own under the name. Keyed to the
 * row's own width rather than the window's, because the hero sits beside
 * the resource's side menu - 382px of row at a 768px window, 586px at 1024.
 *
 * Only the top row is in the container: nothing the hero opens (the agent
 * version chip's upgrade dialog) is laid out inside one.
 *
 * Whole two-digit rems only: the Tailwind runtime sorts arbitrary container
 * variants as text.
 *
 * Plain strings, free of React, so App/Tests can read them.
 */

export const RESOURCE_HERO_SIDE_BY_SIDE_MIN_WIDTH_REM: number = 32;

// The container the top row measures.
export const RESOURCE_HERO_TOP_ROW_CONTAINER_CLASS_NAME: string =
  "[container-type:inline-size]";

// Stacked by default; side by side from 32rem of row.
export const RESOURCE_HERO_TOP_ROW_CLASS_NAME: string =
  "flex flex-col gap-4 [@container(min-width:32rem)]:flex-row [@container(min-width:32rem)]:items-start [@container(min-width:32rem)]:justify-between";
