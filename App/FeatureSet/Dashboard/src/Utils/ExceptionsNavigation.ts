export type ExceptionsTabKey =
  | "overview"
  | "unresolved"
  | "resolved"
  | "archived"
  | "setup";

export function getActiveExceptionsTab(path: string): ExceptionsTabKey {
  if (path.includes("/exceptions/unresolved")) {
    return "unresolved";
  }
  if (path.includes("/exceptions/overview")) {
    return "overview";
  }
  if (path.includes("/exceptions/resolved")) {
    return "resolved";
  }
  if (path.includes("/exceptions/archived")) {
    return "archived";
  }
  if (path.includes("/exceptions/documentation")) {
    return "setup";
  }
  return "unresolved";
}
