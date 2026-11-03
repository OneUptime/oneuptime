/*
 * The site's views and static files from this checkout rather than the
 * image's paths (/usr/src/app, where packages/Home sits in the Home image),
 * as Home's own tests read them (the jest.mock of Utils/Config in
 * Tests/RouteResponses.test.ts). Preloaded ahead of Index.ts, so the site
 * runs from a checkout with nothing else changed:
 *
 *   BLOG_ROOT=<a clone of the blog> PORT=4801 \
 *     node -r ts-node/register/transpile-only -r ./Scripts/CheckoutPaths.ts Index.ts
 *
 * BLOG_ROOT stands in for /usr/src/blog, where the image clones the blog.
 * The site serves a copy of it, made outside this repository: it reads its
 * blog's git history for each post's contributors, and in a folder inside
 * this checkout that would be the checkout's own history. Without BLOG_ROOT
 * the blog is a folder that does not exist, and the site serves no posts.
 *
 * The UpdateBlog job does not run: it pulls the blog's clone and tells
 * IndexNow which posts the pull changed when the host is oneuptime.com, and
 * a copy has nothing to pull and nothing to announce.
 *
 * The Lighthouse suite (packages/E2E/Lighthouse) runs the site this way.
 */
import * as HomeConfig from "../Utils/Config";
import fs from "fs";
import Module from "module";
import os from "os";
import path from "path";

const ImageHomeFolder: string = "/usr/src/app";
const ImageBlogFolder: string = "/usr/src/blog";

const CheckoutHomeFolder: string = path.resolve(__dirname, "..");

function copyOfTheBlog(): string {
  const outsideTheCheckout: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-home-blog-"),
  );
  const blog: string = path.join(outsideTheCheckout, "blog");
  const source: string | undefined = process.env["BLOG_ROOT"];

  if (source) {
    fs.cpSync(path.resolve(source), blog, { recursive: true });
  }

  return blog;
}

const BlogFolder: string = copyOfTheBlog();

function inThisCheckout(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  if (value === ImageBlogFolder) {
    return BlogFolder;
  }

  if (value === ImageHomeFolder || value.startsWith(`${ImageHomeFolder}/`)) {
    const checkoutPath: string = path.join(
      CheckoutHomeFolder,
      value.slice(ImageHomeFolder.length),
    );

    // A file the image has and the checkout does not would fail a page later.
    if (!fs.existsSync(checkoutPath)) {
      throw new Error(`${value} is not in this checkout at ${checkoutPath}.`);
    }

    return checkoutPath;
  }

  return value;
}

const configFile: string = require.resolve("../Utils/Config");
const cached: Module | undefined = require.cache[configFile];

if (!cached) {
  throw new Error(`${configFile} was imported but is not in require.cache.`);
}

// Every module that imports Utils/Config after this one gets these paths.
cached.exports = Object.fromEntries(
  Object.entries(HomeConfig).map(
    ([name, value]: [string, unknown]): [string, unknown] => {
      return [name, inThisCheckout(value)];
    },
  ),
);

// Routes.ts imports the job for what it schedules; it exports nothing.
const updateBlogFile: string = require.resolve("../Jobs/UpdateBlog");
const noUpdateBlog: Module = new Module(updateBlogFile);

noUpdateBlog.filename = updateBlogFile;
noUpdateBlog.loaded = true;
require.cache[updateBlogFile] = noUpdateBlog;
