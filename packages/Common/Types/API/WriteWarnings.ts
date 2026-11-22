/*
 * WHAT A WRITE THROUGH THE API DOES THAT ITS CALLER SHOULD KNOW (#10436).
 *
 * A create or an update through the API is code acting for a person who is
 * not there to read a question: a script, `terraform apply`, a pipeline.
 * Refusing it until someone confirms would break every one of them and
 * help nobody, since a caller would only learn to send "confirmed". So a
 * write that takes something others depend on goes through, and its answer
 * says so beside the record, in a header no client has to know about:
 *
 *   X-OneUptime-Write-Warning: Security Events read 1,240 of the 45,300 logs this filter matched in the last day, ...
 *
 * one sentence per header line, in English and in plain ASCII (a header
 * carries nothing else), naming counts and never a record's name. The
 * Terraform provider shows each as a warning (StaticFiles/entries.go). A
 * write with nothing to say sends no such header.
 *
 * Read by the server and by clients, so it imports nothing that needs a
 * server or React.
 */

export const WRITE_WARNING_HEADER: string = "X-OneUptime-Write-Warning";

// The longest one warning is sent: a sentence or two.
export const MAX_WRITE_WARNING_LENGTH: number = 1000;

export default class WriteWarnings {
  /*
   * A sentence as a header line carries it: one line, printable ASCII,
   * nothing a header could not hold, cut at MAX_WRITE_WARNING_LENGTH.
   */
  public static toHeaderValue(sentence: string): string {
    return (
      String(sentence || "")
        // Anything a header line cannot hold reads as a space.
        .replace(/[^\x20-\x7E]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_WRITE_WARNING_LENGTH)
    );
  }

  // The warnings an answer's headers carry, whatever the case of the header's name.
  public static fromHeaders(
    headers: Record<string, unknown> | null | undefined,
  ): Array<string> {
    if (!headers || typeof headers !== "object") {
      return [];
    }

    const name: string = WRITE_WARNING_HEADER.toLowerCase();

    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== name) {
        continue;
      }

      return (Array.isArray(value) ? value : [value])
        .filter((item: unknown): item is string => {
          return typeof item === "string";
        })
        .map((item: string): string => {
          return item.trim();
        })
        .filter((item: string): boolean => {
          return item.length > 0;
        });
    }

    return [];
  }
}
