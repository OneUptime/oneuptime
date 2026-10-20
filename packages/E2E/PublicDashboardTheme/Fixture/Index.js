/*
 * The public dashboard app as it ships
 * (App/FeatureSet/PublicDashboard/src/Index.tsx), with its API answered from
 * Data.js. Imported first, so every request the app makes - through its own
 * API client, which every widget's read goes through on a public dashboard -
 * is answered here, and any it makes that the fixture does not know is
 * recorded for the spec to fail on.
 */
import "./MockApi";
import "../../../App/FeatureSet/PublicDashboard/src/Index";
