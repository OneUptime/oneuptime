/*
 * The live network topology view moved to Components/Topology alongside
 * the other topology graphs (Service Map, Infrastructure) when it gained
 * search, auto-refresh and detail panels. This re-export keeps the
 * original import path — used by the Topology page's Network tab —
 * working.
 */
export { default } from "../Topology/NetworkTopologyLiveView";
