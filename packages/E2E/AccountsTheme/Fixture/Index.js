/*
 * The sign-in pages' app as it ships (App/FeatureSet/Accounts/src/Index.tsx),
 * with what the pages ask a server answered from Data.js. MockApi is
 * imported first, so every request the pages make - through Common's API
 * client and its ModelAPI, which both end in API.fetch - is answered there,
 * and any it does not know is recorded for the spec to fail on.
 */
import "./MockApi";
import "../../../App/FeatureSet/Accounts/src/Index";
