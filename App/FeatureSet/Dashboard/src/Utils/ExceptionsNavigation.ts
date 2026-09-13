export type ExceptionsTabKey = "exceptions" | "overview" | "setup";

export function getActiveExceptionsTab(path: string): ExceptionsTabKey {
  if (path.includes("/exceptions/overview")) {
    return "overview";
  }
  if (path.includes("/exceptions/documentation")) {
    return "setup";
  }
  return "exceptions";
}
