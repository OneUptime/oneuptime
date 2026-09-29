export default interface ExemplarPoint {
  x: Date;
  y: number;
  traceId: string;
  spanId?: string | undefined;
}
