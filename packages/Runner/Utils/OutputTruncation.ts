/*
 * A step's output cut to at most maxBytes bytes of UTF-8, with a line that
 * says it was cut. Pure, with no import of the Runner's Config: the
 * JavaScript sandbox's process (JavaScriptSandbox/SandboxWorker) cuts its own
 * output with it, and that process never reads the Runner's settings.
 */
export const TRUNCATED_OUTPUT_MARKER: string = "\n... [output truncated]";

export function truncateToBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }

  return (
    Buffer.from(text, "utf8").slice(0, maxBytes).toString("utf8") +
    TRUNCATED_OUTPUT_MARKER
  );
}
