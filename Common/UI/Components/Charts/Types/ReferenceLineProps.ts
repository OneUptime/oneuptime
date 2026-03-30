export default interface ChartReferenceLineProps {
  value: number;
  label?: string | undefined;
  color: string; // CSS color, e.g. "#f59e0b" or "red"
  strokeDasharray?: string | undefined; // e.g. "4 4" for dashed
}
