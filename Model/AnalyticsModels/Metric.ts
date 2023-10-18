/** 
 * 
 *  CREATE TABLE opentelemetry_metrics
(
    name String,
    description String,
    unit String,
    time DateTime('UTC'),
    attributes Nested
    (
        key String,
        value String
    ),
    metric_values Nested
    (
        value Double,
        labels Nested
        (
            key String,
            value String
        )
    )
) ENGINE = MergeTree()
ORDER BY (name, time);

 * 
 */