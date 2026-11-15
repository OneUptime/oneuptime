/** @timezone UTC */

import describeBucketEnds from "./AggregationIntervalBucketEndCases";

/*
 * Where a bucket ends (see AggregationIntervalBucketEndCases), with the
 * process in UTC: only the zone the bucket was cut in may move it.
 */

describeBucketEnds("UTC");
