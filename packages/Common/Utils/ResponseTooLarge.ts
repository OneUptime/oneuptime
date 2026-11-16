import APIException from "../Types/Exception/ApiException";
import axios from "axios";

/*
 * AN ANSWER LARGER THAN A REQUEST READS (issue #8875).
 *
 * Axios stops reading an answer at the request's maxContentLength and
 * rejects with "maxContentLength size of 10485760 exceeded". That failure
 * is not like the others: the server answered, and asking again only reads
 * as much of the same answer again (API.isRetryableError), and a sender
 * says what happened in a sentence of its own, not in axios's words.
 */

// What axios rejects an answer with once it passes maxContentLength.
const AXIOS_TOO_LARGE_MESSAGE: RegExp =
  /^maxContentLength size of -?\d+ exceeded$/;

// How deep an APIException may wrap the AxiosError it came from.
const MAX_WRAPPING_DEPTH: number = 5;

export default class ResponseTooLarge {
  /*
   * Whether a request failed because its answer was larger than its
   * maxContentLength. Reads the AxiosError itself, or an APIException that
   * wraps it (API.fetch throws one, with the AxiosError as its error),
   * however deep.
   */
  public static isError(error: unknown): boolean {
    let cause: unknown = error;

    for (
      let depth: number = 0;
      depth < MAX_WRAPPING_DEPTH &&
      cause instanceof APIException &&
      cause.error;
      depth++
    ) {
      cause = cause.error;
    }

    return (
      axios.isAxiosError(cause) &&
      AXIOS_TOO_LARGE_MESSAGE.test(cause.message || "")
    );
  }

  /*
   * What a request whose answer was larger than its maxContentLength says,
   * in place of axios's words: "The answer was larger than 10 MB, so it was
   * not read." It names nothing of the URL, which can carry a secret.
   * `subject` says whose answer it was.
   */
  public static getMessage(
    maxContentLength: number,
    subject: string = "The answer",
  ): string {
    return `${subject} was larger than ${ResponseTooLarge.formatSize(maxContentLength)}, so it was not read.`;
  }

  // 10485760 -> "10 MB", 65536 -> "64 KB", 1572864 -> "1.5 MB".
  private static formatSize(bytes: number): string {
    const units: Array<[string, number]> = [
      ["GB", 1024 * 1024 * 1024],
      ["MB", 1024 * 1024],
      ["KB", 1024],
    ];

    for (const [unit, size] of units) {
      if (bytes >= size) {
        return `${Math.round((bytes / size) * 10) / 10} ${unit}`;
      }
    }

    const wholeBytes: number = Math.max(0, Math.round(bytes));

    return `${wholeBytes} byte${wholeBytes === 1 ? "" : "s"}`;
  }
}
