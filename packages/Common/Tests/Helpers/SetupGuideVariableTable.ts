/*
 * THE VARIABLES A SETUP GUIDE'S "ENVIRONMENT VARIABLES" TABLE NAMES.
 *
 * Each row's first cell names one variable, `DOCKER_HOST_NAME`, or a
 * numbered run of them, `ONEUPTIME_LOG_OPERATOR_1` to
 * `ONEUPTIME_LOG_OPERATOR_5` (the container agents' log operators, #11225),
 * which stands for every one from the first number to the last. Read in the
 * table's order, a run as its variables, so a guide's table can be held to
 * the variables an agent's compose file names.
 */

const ROW: RegExp = /^\| `([A-Z][A-Z0-9_]*)`(?: to `([A-Z][A-Z0-9_]*)`)? \|/gm;

const NUMBERED: RegExp = /^([A-Z][A-Z0-9_]*_)(\d+)$/;

export function getSetupGuideTableVariables(table: string): Array<string> {
  return Array.from(table.matchAll(ROW)).flatMap(
    (match: RegExpMatchArray): Array<string> => {
      const first: string = match[1]!;
      const last: string | undefined = match[2];

      if (!last) {
        return [first];
      }

      const from: RegExpMatchArray | null = first.match(NUMBERED);
      const to: RegExpMatchArray | null = last.match(NUMBERED);

      if (
        !from ||
        !to ||
        from[1] !== to[1] ||
        Number(to[2]) < Number(from[2])
      ) {
        throw new Error(`Not a numbered run of one variable: ${match[0]}`);
      }

      const names: Array<string> = [];

      for (let n: number = Number(from[2]); n <= Number(to[2]); n++) {
        names.push(`${from[1]}${n}`);
      }

      return names;
    },
  );
}
