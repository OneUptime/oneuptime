/*
 * Materialized-path helpers for the NetworkSite hierarchy.
 *
 * A site's path is the slash-separated list of its ancestor IDs ending with
 * its own ID, in '/rootId/childId/.../ownId/' form. Root sites have the path
 * '/ownId/'. All helpers are pure string operations so the tree math is
 * unit-testable without a database.
 */
export class MaterializedPathUtil {
  /*
   * Builds the path for a site given its parent's path (null/undefined/empty
   * for root sites). Tolerates a parent path missing its leading or trailing
   * slash so a hand-edited row cannot poison every child path built from it.
   */
  public static buildPath(
    parentPath: string | null | undefined,
    siteId: string,
  ): string {
    const normalizedParent: string = MaterializedPathUtil.normalizePath(
      parentPath || "",
    );
    return `${normalizedParent || "/"}${siteId}/`;
  }

  // '/a/b/' -> ['a', 'b']; invalid/empty input -> [].
  public static segmentsOf(path: string | null | undefined): Array<string> {
    if (!path || typeof path !== "string") {
      return [];
    }
    return path.split("/").filter((segment: string) => {
      return segment.length > 0;
    });
  }

  /*
   * Number of ancestors above the site this path belongs to: '/a/' -> 0,
   * '/a/b/' -> 1. Empty/invalid paths report 0.
   */
  public static depthOf(path: string | null | undefined): number {
    const segments: Array<string> = MaterializedPathUtil.segmentsOf(path);
    return segments.length > 0 ? segments.length - 1 : 0;
  }

  /*
   * True when `path` belongs to a strict descendant of the site that owns
   * `ancestorPath` (a site is not its own descendant).
   */
  public static isDescendant(
    path: string | null | undefined,
    ancestorPath: string | null | undefined,
  ): boolean {
    if (!path || !ancestorPath) {
      return false;
    }
    const normalizedPath: string = MaterializedPathUtil.normalizePath(path);
    const normalizedAncestor: string =
      MaterializedPathUtil.normalizePath(ancestorPath);
    return (
      normalizedPath.startsWith(normalizedAncestor) &&
      normalizedPath !== normalizedAncestor
    );
  }

  /*
   * True when making the site with `siteId` a child of the site whose path is
   * `newParentPath` would create a cycle - i.e. the proposed parent is the
   * site itself or one of its descendants (its own ID appears anywhere in the
   * parent's path). A null/empty parent path (becoming a root) can never
   * create a cycle.
   */
  public static wouldCreateCycle(
    siteId: string,
    newParentPath: string | null | undefined,
  ): boolean {
    if (!siteId || !newParentPath) {
      return false;
    }
    const segments: Array<string> =
      MaterializedPathUtil.segmentsOf(newParentPath);
    return segments.includes(siteId);
  }

  /*
   * Rewrites subtree paths for a move: every affected path that starts with
   * `oldParentPath` gets that prefix replaced with `newParentPath`. Paths
   * outside the moved subtree are returned unchanged, in input order.
   */
  public static rebasePaths(
    oldParentPath: string,
    newParentPath: string,
    affectedPaths: Array<string>,
  ): Array<string> {
    const oldPrefix: string = MaterializedPathUtil.normalizePath(oldParentPath);
    const newPrefix: string = MaterializedPathUtil.normalizePath(newParentPath);

    return affectedPaths.map((path: string) => {
      const normalized: string = MaterializedPathUtil.normalizePath(path);
      if (!oldPrefix || !normalized.startsWith(oldPrefix)) {
        return path;
      }
      return `${newPrefix}${normalized.slice(oldPrefix.length)}`;
    });
  }

  // Ensures '/a/b/' form: leading + trailing slash, no empty segments.
  private static normalizePath(path: string): string {
    const segments: Array<string> = MaterializedPathUtil.segmentsOf(path);
    if (segments.length === 0) {
      return "";
    }
    return `/${segments.join("/")}/`;
  }
}

export default MaterializedPathUtil;
