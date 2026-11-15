/** @timezone Pacific/Auckland */

import describeBucketEnds from "./AggregationIntervalBucketEndCases";

/*
 * Where a bucket ends (see AggregationIntervalBucketEndCases), with the
 * process in Pacific/Auckland: only the zone the bucket was cut in may move it.
 */

describeBucketEnds("Pacific/Auckland");
