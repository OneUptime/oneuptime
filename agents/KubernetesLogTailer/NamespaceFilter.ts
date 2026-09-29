const escapeRegularExpression: (value: string) => string = (
  value: string,
): string => {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
};

export const compileNamespacePattern: (pattern: string) => RegExp = (
  pattern: string,
): RegExp => {
  const source: string = pattern
    .split("*")
    .map((segment: string): string => {
      return escapeRegularExpression(segment);
    })
    .join(".*");

  return new RegExp(`^(?:${source})$`);
};

export default class NamespaceFilter {
  private readonly includePatterns: Array<RegExp>;
  private readonly excludePatterns: Array<RegExp>;

  public constructor(
    includePatterns: Array<string>,
    excludePatterns: Array<string>,
  ) {
    this.includePatterns = includePatterns.map(compileNamespacePattern);
    this.excludePatterns = excludePatterns.map(compileNamespacePattern);
  }

  public isAllowed(namespace: string): boolean {
    if (
      this.includePatterns.length > 0 &&
      !this.matchesAny(namespace, this.includePatterns)
    ) {
      return false;
    }

    return !this.matchesAny(namespace, this.excludePatterns);
  }

  private matchesAny(namespace: string, patterns: Array<RegExp>): boolean {
    return patterns.some((pattern: RegExp): boolean => {
      return pattern.test(namespace);
    });
  }
}
