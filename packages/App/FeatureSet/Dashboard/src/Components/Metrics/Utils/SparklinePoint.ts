/*
 * One point of a metric row's sparkline. It lives apart from the component
 * (MetricSparkline, which re-exports it) so that a React-free module - the
 * list's row scope, which an App suite reaches - can name it.
 */
export interface SparklinePoint {
  time: string;
  value: number;
}
