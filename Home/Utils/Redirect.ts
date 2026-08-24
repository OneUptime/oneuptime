import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";

/*
 * Redirect without throwing away what the visitor arrived with.
 *
 * `res.redirect("/product/on-call")` drops the query string, and the query
 * string is where a paid click keeps its identity: Google Ads auto-tagging
 * appends `?gclid=` to the final URL and nothing else. A campaign whose final
 * URL is one of the short marketing paths — /self-hosted, /on-premise,
 * /incident-management, /on-call — therefore landed on the canonical page with
 * a clean URL, the capture script in Views/head-basic.ejs found nothing, and
 * every conversion from that campaign was unattributable. Spend was real,
 * measured conversions were zero, and smart bidding turns such a campaign off.
 *
 * The query is taken as raw bytes off `originalUrl` rather than re-serialised
 * from `req.query` on purpose: re-serialising reorders keys, normalises
 * percent-encoding and collapses repeated parameters, and the attribution
 * capture stores whatever bytes it is given.
 */

export type RedirectPreservingQueryFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  targetPath: string,
  statusCode?: number,
) => void;

export const redirectPreservingQuery: RedirectPreservingQueryFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  targetPath: string,
  statusCode?: number,
): void => {
  const target: string = appendQueryFrom(req, targetPath);

  if (statusCode) {
    res.redirect(statusCode, target);
    return;
  }

  res.redirect(target);
};

export type AppendQueryFromFunction = (
  req: ExpressRequest,
  targetPath: string,
) => string;

/*
 * Exported separately so the joining rules can be tested without a response.
 * `/self-hosted?` — a bare question mark with nothing after it — must not
 * become `/enterprise/self-hosted?`, and a target that already carries a query
 * must be joined with `&`. No current caller passes such a target; the branch
 * is one edit away from mattering.
 */
export const appendQueryFrom: AppendQueryFromFunction = (
  req: ExpressRequest,
  targetPath: string,
): string => {
  const originalUrl: string = req.originalUrl || "";
  const separatorIndex: number = originalUrl.indexOf("?");

  if (separatorIndex === -1) {
    return targetPath;
  }

  const query: string = originalUrl.slice(separatorIndex + 1);

  if (!query) {
    return targetPath;
  }

  const joiner: string = targetPath.includes("?") ? "&" : "?";

  return `${targetPath}${joiner}${query}`;
};
