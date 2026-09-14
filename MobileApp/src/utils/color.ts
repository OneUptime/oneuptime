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

/**
 * Whether a channel field actually carries a number we can use.
 *
 * toChannel cannot answer this: it returns 0 both for a channel that is genuinely
 * zero and for one that is missing entirely, and telling those two apart is the
 * whole point here.
 */
function isChannel(value: number | undefined): boolean {
  return typeof value === "number" && !Number.isNaN(value);
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

  const rawR: number | undefined = color.r ?? color.red;
  const rawG: number | undefined = color.g ?? color.green;
  const rawB: number | undefined = color.b ?? color.blue;

  /*
   * An object that names no channel at all still reaches this point - an empty
   * object, one carrying only a name, or one whose `value` was a number rather
   * than a hex string. Without this guard each missing channel becomes 0 and
   * the function returns "#000000": a badge that renders black-on-dark, i.e.
   * invisible, instead of the neutral grey it falls back to for every other
   * input it cannot read.
   *
   * The test is "did the object mention a channel", not "did the arithmetic come
   * out as zero", because r:0,g:0,b:0 is a colour the server really did send and
   * black is the right answer for it.
   */
  if (!isChannel(rawR) && !isChannel(rawG) && !isChannel(rawB)) {
    return "#9ca3af";
  }

  const r: number = toChannel(rawR);
  const g: number = toChannel(rawG);
  const b: number = toChannel(rawB);

  return (
    "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0")
  );
}
