type ColorInput =
  | string
  | {
      r?: number;
      g?: number;
      b?: number;
      red?: number;
      green?: number;
      blue?: number;
      value?: string;
      color?: string;
    }
  | null
  | undefined;

function toChannel(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeHex(color: string): string | null {
  const trimmed: string = color.trim();

  const hex6: RegExp = /^#?([0-9a-fA-F]{6})$/;
  const hex3: RegExp = /^#?([0-9a-fA-F]{3})$/;

  const sixMatch: RegExpExecArray | null = hex6.exec(trimmed);
  if (sixMatch) {
    return `#${sixMatch[1]}`.toLowerCase();
  }

  const threeMatch: RegExpExecArray | null = hex3.exec(trimmed);
  if (threeMatch) {
    const expanded: string = threeMatch[1]
      .split("")
      .map((ch: string) => {
        return ch + ch;
      })
      .join("");
    return `#${expanded}`.toLowerCase();
  }

  return null;
}

export function rgbToHex(color: ColorInput): string {
  if (!color) {
    return "#9ca3af";
  }

  if (typeof color === "string") {
    return normalizeHex(color) || "#9ca3af";
  }

  if (typeof color.value === "string") {
    return normalizeHex(color.value) || "#9ca3af";
  }

  if (typeof color.color === "string") {
    return normalizeHex(color.color) || "#9ca3af";
  }

  const r: number = toChannel(color.r ?? color.red);
  const g: number = toChannel(color.g ?? color.green);
  const b: number = toChannel(color.b ?? color.blue);

  return (
    "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0")
  );
}
