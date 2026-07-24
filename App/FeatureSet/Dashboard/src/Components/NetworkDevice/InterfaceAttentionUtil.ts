/*
 * Ranking for the device Overview's interface preview: the handful of
 * interfaces most worth a look, out of possibly hundreds on a switch.
 *
 * Order: problem ports first (admin-up but operationally down), then
 * hottest by utilization, then errored, then everything else by ifIndex.
 * Administratively-disabled ports rank last within their band — a port
 * someone turned off on purpose is not a problem.
 *
 * Pure and react-free so it can be unit-tested in a plain Node context.
 */

export interface RankableInterface {
  interfaceIndex?: number | undefined;
  isOperationallyUp?: boolean | undefined;
  isAdministrativelyUp?: boolean | undefined;
  utilizationPercent?: number | undefined;
  errorsPerSecond?: number | undefined;
}

export function isProblemInterface(row: RankableInterface): boolean {
  return Boolean(row.isAdministrativelyUp) && !row.isOperationallyUp;
}

type AttentionScoreFunction = (row: RankableInterface) => number;

/*
 * Higher score = shown earlier. Bands are spaced far apart so a
 * utilization value can never promote a healthy port above a down one.
 */
const getAttentionScore: AttentionScoreFunction = (
  row: RankableInterface,
): number => {
  if (isProblemInterface(row)) {
    return 3_000_000;
  }

  const utilization: number = row.utilizationPercent || 0;
  const errorsPerSecond: number = row.errorsPerSecond || 0;

  if (errorsPerSecond > 0) {
    return 2_000_000 + Math.min(999_999, errorsPerSecond * 1000);
  }

  if (!row.isAdministrativelyUp) {
    // Deliberately disabled — least interesting.
    return -1;
  }

  return utilization;
};

export function rankInterfacesForAttention<T extends RankableInterface>(
  interfaces: Array<T>,
  limit: number,
): Array<T> {
  const sorted: Array<T> = [...interfaces].sort((a: T, b: T): number => {
    const scoreDifference: number = getAttentionScore(b) - getAttentionScore(a);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }
    return (a.interfaceIndex || 0) - (b.interfaceIndex || 0);
  });

  return sorted.slice(0, Math.max(0, limit));
}
