/*
 * What Fixture.js keeps on the page for the specs to read and set: how many
 * overview requests the page has made, whether the next refresh takes
 * resource 39 offline, the input frames ResourceSearch.spec.ts times, and
 * the ids of the scheduled maintenance events ?maintenance=1 sends
 * (MaintenanceHistory.spec.ts). Both specs import it: TypeScript compiles
 * them together and takes one type for the window's property.
 */
export interface FixtureState {
  requests: number;
  refreshOffline: boolean;
  inputFrames?: Array<{ value: string; durationMs: number }>;
  maintenanceIds: Array<string>;
}

declare global {
  interface Window {
    __statusPageSearchFixture: FixtureState;
  }
}
