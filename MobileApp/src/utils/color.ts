export function rgbToHex(color: { r: number; g: number; b: number }): string {
  const r: number = Math.max(0, Math.min(255, Math.round(color.r)));
  const g: number = Math.max(0, Math.min(255, Math.round(color.g)));
  const b: number = Math.max(0, Math.min(255, Math.round(color.b)));

  return (
    "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0")
  );
}
