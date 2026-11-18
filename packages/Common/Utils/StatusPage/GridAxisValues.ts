/*
 * A GRID GROUP'S ROWS AND COLUMNS, AS ITS AXIS VALUES LIST THEM.
 *
 * A status page group in grid view names its rows and its columns as comma
 * separated text (StatusPageGroup.rowAxisValues and columnAxisValues). The
 * Dashboard's Resources screen (ResourceExplorer) and the public status page
 * (GroupNestingLayout, the Overview) both read them here, so the two agree on
 * which grids have no rows or columns yet (#9476).
 *
 * A module of its own, which imports nothing: it is all the public page needs
 * of the Resources screen's model, and reading it from that model brought the
 * model, and the group hierarchy its navigator draws, into every status
 * page's first load (packages/Common/Scripts/first-load-budgets.js;
 * Tests/UI/StatusPageOverviewFirstLoadBuild.test.ts holds them out of it).
 */
export const parseGridAxisValues: (
  raw?: string | null | undefined,
) => Array<string> = (raw?: string | null | undefined): Array<string> => {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((value: string): string => {
      return value.trim();
    })
    .filter((value: string): boolean => {
      return value.length > 0;
    });
};

export default parseGridAxisValues;
