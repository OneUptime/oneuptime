/** @timezone Asia/Kolkata */

import describeBucketEnds from "./AggregationIntervalBucketEndCases";

/*
 * Where a bucket ends (see AggregationIntervalBucketEndCases), with the
 * process in Asia/Kolkata: only the zone the bucket was cut in may move it.
 */

describeBucketEnds("Asia/Kolkata");
