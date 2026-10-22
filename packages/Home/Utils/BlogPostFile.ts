import NotFoundUtil from "./NotFound";
import { ExpressResponse, NextFunction } from "Common/Server/Utils/Express";

/*
 * How the route that serves a blog post's files (API/BlogAPI.ts,
 * /blog/post/<post>/<file>) answers a file it could not send.
 *
 * Express hands a file it cannot send to the error handler, and the server's
 * error handler (Common/Server/Utils/StartServer.ts) answers every error it
 * does not know with 500 - a missing file's 404 too. Addresses that no post
 * has a file at, such as /blog/post/<post>/view-15, which search engines
 * found and asked for, answered 500, and Google Search Console listed them
 * as "Server error (5xx)". So the route answers these itself:
 *
 *   - no such file - nothing by that name, a folder by that name, or a name
 *     that climbs out of the post's folder - is a page that does not exist,
 *     and gets the site's 404 page, as any other unknown address does;
 *   - a request the file cannot satisfy - a range past its end, a failed
 *     precondition - gets the status the send chose;
 *   - a reader who went away is not answered, as Express does not;
 *   - anything else is a real failure, for the error handler.
 */

interface FileSendError extends Error {
  code?: string;
  syscall?: string;
  status?: number;
  statusCode?: number;
  headers?: Record<string, string>;
}

/*
 * What `send` answers a file it does not have with: missing (404), above the
 * post's folder (403), or a name it cannot read (400).
 */
const NO_SUCH_FILE_STATUSES: ReadonlyArray<number> = [400, 403, 404];

type OnFileSent = (err?: Error) => void;

export const onBlogPostFileSent: (
  res: ExpressResponse,
  next: NextFunction,
) => OnFileSent = (res: ExpressResponse, next: NextFunction): OnFileSent => {
  return (err?: Error): void => {
    if (!err) {
      return;
    }

    const error: FileSendError = err as FileSendError;

    if (error.code === "ECONNABORTED" || error.syscall === "write") {
      return;
    }

    if (res.headersSent) {
      return next(err);
    }

    const status: number | undefined = error.status ?? error.statusCode;

    if (
      error.code === "EISDIR" ||
      (status !== undefined && NO_SUCH_FILE_STATUSES.includes(status))
    ) {
      return NotFoundUtil.renderNotFound(res);
    }

    if (status !== undefined && status >= 400 && status < 500) {
      if (error.headers) {
        res.set(error.headers);
      }

      res.status(status).end();
      return;
    }

    return next(err);
  };
};
