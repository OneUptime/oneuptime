/*
 * The status page app as it ships (App/FeatureSet/StatusPage/src/Index.tsx),
 * with its API answered from Data.js. Imported first, so every request the
 * app makes - through its own API client and its ModelAPI, which both end in
 * API.fetch - is answered here, and any it makes that the fixture does not
 * know is recorded for the spec to fail on.
 *
 * The query string sets the page: `theme` (Light, Dark or System),
 * `private=1` (a page only signed-in readers see), `sso=1` (a private
 * page that also offers single sign-on) and `darkLogo=1` (a page with a
 * logo made for the dark theme too).
 */
import "./MockApi";
import "../../../App/FeatureSet/StatusPage/src/Index";
