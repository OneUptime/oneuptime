export default interface ExemplarPoint {
  x: Date;
  y: number;
  traceId: string;
  spanId?: string | undefined;
  /*
   * Drawn against the chart's second value axis (SecondYAxis), for an
   * exemplar of a series drawn there: y is in that axis's unit.
   */
  isOnSecondYAxis?: boolean | undefined;
}
