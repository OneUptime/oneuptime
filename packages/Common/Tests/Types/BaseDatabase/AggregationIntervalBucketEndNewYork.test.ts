/** @timezone America/New_York */

import describeBucketEnds from "./AggregationIntervalBucketEndCases";

/*
 * Where a bucket ends (see AggregationIntervalBucketEndCases), with the
 * process in America/New_York: only the zone the bucket was cut in may move it.
 */

describeBucketEnds("America/New_York");
