import logger from "Common/Server/Utils/Logger";

/*
 * IndexNow (https://www.indexnow.org): a notice to search engines that pages
 * changed, so they crawl them soon rather than whenever they next come by.
 * Bing - whose index grounds Copilot's answers - Yandex, Naver, Seznam and
 * Yep take part, and pass on to each other what any of them is sent. The
 * UpdateBlog job sends the posts each pull of the blog adds, changes or
 * removes (a removed post's address answers 404, which drops it sooner).
 *
 * The key shows a notice comes from the site: a search engine reads it at
 * INDEXNOW_KEY_PATH on the host the notice names. It is public by design -
 * anyone can read it there - so it is kept here rather than as a secret.
 */
export const INDEXNOW_KEY: string = "f1116b8541f25b1e65e888216f990bbf";

export const INDEXNOW_KEY_PATH: string = `/${INDEXNOW_KEY}.txt`;

export const INDEXNOW_ENDPOINT: string = "https://api.indexnow.org/indexnow";

// IndexNow takes at most 10,000 URLs in one request.
export const INDEXNOW_MAX_URLS_PER_REQUEST: number = 10000;

/*
 * Only oneuptime.com sends notices: every other install of this site keeps
 * itself out of search engines (robots.txt in Routes.ts).
 */
export const INDEXNOW_HOST: string = "oneuptime.com";

// How long a notice may take before it is given up.
export const INDEXNOW_TIMEOUT_IN_MS: number = 30 * 1000;

export interface IndexNowRequest {
  host: string;
  key: string;
  keyLocation: string;
  urlList: Array<string>;
}

// Sends one request to IndexNow, and gives back the HTTP status it answered.
export type IndexNowSender = (request: IndexNowRequest) => Promise<number>;

// posts/<post>/... : any file of a post, which its page shows.
const POST_FILE: RegExp = /^posts\/([^/]+)\/./;

// The blog posts a change to these files touches, once each, in their order.
export function getPostsInChangedFiles(
  changedFiles: ReadonlyArray<string>,
): Array<string> {
  const posts: Array<string> = [];
  const seen: Set<string> = new Set();

  for (const file of changedFiles) {
    const post: string | undefined = POST_FILE.exec(file)?.[1];

    if (post && !seen.has(post)) {
      seen.add(post);
      posts.push(post);
    }
  }

  return posts;
}

// The address of each post's page on `host`.
export function getPostPageUrls(
  host: string,
  posts: ReadonlyArray<string>,
): Array<string> {
  return posts.map((post: string): string => {
    return `https://${host}/blog/post/${encodeURIComponent(post)}/view`;
  });
}

// The requests that send these URLs: one per INDEXNOW_MAX_URLS_PER_REQUEST.
export function getIndexNowRequests(
  host: string,
  urls: ReadonlyArray<string>,
): Array<IndexNowRequest> {
  const requests: Array<IndexNowRequest> = [];

  for (
    let start: number = 0;
    start < urls.length;
    start += INDEXNOW_MAX_URLS_PER_REQUEST
  ) {
    requests.push({
      host: host,
      key: INDEXNOW_KEY,
      keyLocation: `https://${host}${INDEXNOW_KEY_PATH}`,
      urlList: urls.slice(start, start + INDEXNOW_MAX_URLS_PER_REQUEST),
    });
  }

  return requests;
}

// Sends a request to IndexNow over HTTP, giving up after INDEXNOW_TIMEOUT_IN_MS.
export const sendIndexNowRequest: IndexNowSender = async (
  request: IndexNowRequest,
): Promise<number> => {
  const controller: AbortController = new AbortController();
  const timer: NodeJS.Timeout = setTimeout(() => {
    controller.abort();
  }, INDEXNOW_TIMEOUT_IN_MS);

  try {
    const response: Response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "OneUptime-Home (+https://oneuptime.com/blog)",
      },
      body: JSON.stringify(request),
    });

    return response.status;
  } finally {
    clearTimeout(timer);
  }
};

/*
 * Tells IndexNow about the blog posts these changed files touch. Sends
 * nothing from any host but INDEXNOW_HOST, and nothing when no post changed.
 * A notice that fails is logged, not thrown: search engines crawl the post in
 * time anyway. Gives back how many URLs IndexNow accepted.
 */
export async function notifyIndexNowOfChangedPosts(data: {
  host: string;
  changedFiles: ReadonlyArray<string>;
  send?: IndexNowSender | undefined;
}): Promise<number> {
  if (data.host !== INDEXNOW_HOST) {
    return 0;
  }

  const posts: Array<string> = getPostsInChangedFiles(data.changedFiles);

  if (posts.length === 0) {
    return 0;
  }

  const send: IndexNowSender = data.send || sendIndexNowRequest;
  let accepted: number = 0;

  for (const request of getIndexNowRequests(
    data.host,
    getPostPageUrls(data.host, posts),
  )) {
    try {
      const status: number = await send(request);

      // 200: received; 202: received, the key not yet checked.
      if (status === 200 || status === 202) {
        accepted += request.urlList.length;
      } else {
        logger.warn(
          `IndexNow answered ${status} to a notice of ${request.urlList.length} blog posts.`,
        );
      }
    } catch (err) {
      logger.warn(
        `IndexNow could not be sent a notice of ${request.urlList.length} blog posts.`,
      );
      logger.debug(err);
    }
  }

  return accepted;
}
