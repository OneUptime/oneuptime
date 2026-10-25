export type ExceptionsTabKey = "exceptions" | "overview" | "ai" | "setup";

// Which of Exceptions' tabs a page is under (its AI pages: the AI tab).
export function getActiveExceptionsTab(path: string): ExceptionsTabKey {
  if (path.includes("/exceptions/overview")) {
    return "overview";
  }
  if (path.includes("/exceptions/ai/")) {
    return "ai";
  }
  if (path.includes("/exceptions/documentation")) {
    return "setup";
  }
  return "exceptions";
}
