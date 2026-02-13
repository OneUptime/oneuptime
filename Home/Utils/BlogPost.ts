import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import Text from "Common/Types/Text";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import { BlogRootPath } from "./Config";
import LocalFile from "Common/Server/Utils/LocalFile";
import DatabaseConfig from "Common/Server/DatabaseConfig";

export interface BlogPostAuthor {
  username: string;
  githubUrl: string;
  profileImageUrl: string;
  name: string;
  bio?: string | undefined; // optional bio from Authors.json
}

export interface BlogPostBaseProps {
  title: string;
  description: string;

  formattedPostDate: string;
  fileName: string;
  tags: string[];
  postDate: string;
  blogUrl: string;
}

export interface BlogPostHeader extends BlogPostBaseProps {
  authorGitHubUsername: string;
}

export interface BlogPost extends BlogPostBaseProps {
  htmlBody: string;
  markdownBody: string;
  socialMediaImageUrl: string;
  author: BlogPostAuthor | null;
}

export default class BlogPostUtil {
  // Cache Blogs.json contents to avoid repeated disk reads and external calls.
  private static blogsMetaCache: Array<JSONObject> | null = null;
  // Cache Authors.json (keyed by github username)
  private static authorsMetaCache: JSONObject | null = null;
  private static async getBlogsMeta(): Promise<Array<JSONObject>> {
    if (this.blogsMetaCache) {
      return this.blogsMetaCache;
    }

    const filePath: string = `${BlogRootPath}/Blogs.json`;
    let jsonContent: string | JSONArray = await LocalFile.read(filePath);
    if (typeof jsonContent === "string") {
      jsonContent = JSONFunctions.parseJSONArray(jsonContent);
    }
    const blogs: Array<JSONObject> = JSONFunctions.deserializeArray(
      jsonContent as Array<JSONObject>,
    );
    this.blogsMetaCache = blogs;
    return blogs;
  }

  private static async getAuthorsMeta(): Promise<JSONObject> {
    if (this.authorsMetaCache) {
      return this.authorsMetaCache;
    }
    const filePath: string = `${BlogRootPath}/Authors.json`;
    try {
      let jsonContent: string | JSONObject = await LocalFile.read(filePath);
      if (typeof jsonContent === "string") {
        jsonContent = JSONFunctions.parse(jsonContent) as JSONObject;
      }
      this.authorsMetaCache = jsonContent as JSONObject;
      return this.authorsMetaCache || ({} as JSONObject);
    } catch {
      this.authorsMetaCache = {} as JSONObject;
      return this.authorsMetaCache;
    }
  }

  public static async getBlogPostList(
    tagName?: string | undefined,
  ): Promise<BlogPostHeader[]> {
    const filePath: string = `${BlogRootPath}/Blogs.json`;

    let jsonContent: string | JSONArray = await LocalFile.read(filePath);

    if (typeof jsonContent === "string") {
      jsonContent = JSONFunctions.parseJSONArray(jsonContent);
    }

    const blogs: Array<JSONObject> = JSONFunctions.deserializeArray(
      jsonContent as Array<JSONObject>,
    ).reverse(); // reverse so new content comes first

    const resultList: Array<BlogPostHeader> = [];

    for (const blog of blogs) {
      const fileName: string = blog["post"] as string;
      const formattedPostDate: string =
        this.getFormattedPostDateFromFileName(fileName);
      const postDate: string = this.getPostDateFromFileName(fileName);

      resultList.push({
        title: blog["title"] as string,
        description: blog["description"] as string,
        fileName,
        formattedPostDate,
        postDate,
        tags: blog["tags"] as string[],
        authorGitHubUsername: blog["authorGitHubUsername"] as string,
        blogUrl: `/blog/post/${fileName}/view`,
      });
    }

    if (tagName) {
      return resultList.filter((blog: BlogPostHeader) => {
        return blog.tags
          .map((item: string) => {
            return Text.replaceAll(item.toLowerCase(), " ", "-");
          })
          .includes(tagName);
      });
    }

    return resultList;
  }

  public static async getBlogPost(fileName: string): Promise<BlogPost | null> {
    try {
      const blogPost: BlogPost | null =
        await this.getBlogPostFromFile(fileName);
      return blogPost;
    } catch {
      return null;
    }
  }

  public static async getTags(): Promise<string[]> {
    // check if tags are in cache

    const tags: string[] = await this.getAllTagsFromGitHub();
    return tags;
  }

  public static async getAllTagsFromGitHub(): Promise<string[]> {
    const filePath: string = `${BlogRootPath}/Tags.md`;

    const tagsMarkdownContent: string | null = await LocalFile.read(filePath);

    if (!tagsMarkdownContent) {
      return [];
    }

    const tags: Array<string> = tagsMarkdownContent
      .split("\n")
      .map((tag: string) => {
        return tag.trim();
      })
      .filter((tag: string) => {
        return tag.startsWith("-");
      })
      .map((tag: string) => {
        return tag.replace("-", "").trim();
      });

    return tags;
  }

  public static async getHomeUrl(): Promise<URL> {
    return await DatabaseConfig.getHomeUrl();
  }

  public static async getBlogPostFromFile(
    fileName: string,
  ): Promise<BlogPost | null> {
    const filePath: string = `${BlogRootPath}/posts/${fileName}/README.md`;

    const postDate: string = this.getPostDateFromFileName(fileName);
    const formattedPostDate: string =
      this.getFormattedPostDateFromFileName(fileName);

    let markdownContent: string = await LocalFile.read(filePath);

    // Resolve author WITHOUT hitting GitHub API. Use Blogs.json to get username, Authors.json for name/bio.
    let blogPostAuthor: BlogPostAuthor | null = null;
    try {
      const blogsMeta: Array<JSONObject> = await this.getBlogsMeta();
      const blogMeta: JSONObject | undefined = blogsMeta.find(
        (b: JSONObject) => {
          return (b["post"] as string) === fileName;
        },
      );
      const username: string | undefined = blogMeta?.[
        "authorGitHubUsername"
      ] as string | undefined;
      if (username) {
        const authorsMeta: JSONObject = await this.getAuthorsMeta();
        const authorMeta: JSONObject | undefined = authorsMeta[username] as
          | JSONObject
          | undefined;
        const authorName: string | undefined =
          (authorMeta?.["authorName"] as string) || undefined;
        const authorBio: string | undefined =
          (authorMeta?.["authorBio"] as string) || undefined;
        blogPostAuthor = {
          username,
          githubUrl: `https://github.com/${username}`,
          profileImageUrl: `https://avatars.githubusercontent.com/${username}`,
          name: authorName || username,
          bio: authorBio,
        };
      }
    } catch {
      // ignore and fallback
    }

    // Fallback to parsing markdown (no network) if metadata missing.
    if (!blogPostAuthor) {
      blogPostAuthor = await this.getAuthorFromFileContent(markdownContent);
    }

    const title: string = this.getTitleFromFileContent(markdownContent);
    const description: string =
      this.getDescriptionFromFileContent(markdownContent);
    const tags: Array<string> = this.getTagsFromFileContent(markdownContent);

    markdownContent = this.getPostFromMarkdown(markdownContent);

    const htmlBody: string = await Markdown.convertToHTML(
      markdownContent,
      MarkdownContentType.Blog,
    );

    const blogPost: BlogPost = {
      title,
      description,
      author: blogPostAuthor,
      htmlBody,
      markdownBody: markdownContent,
      fileName,
      tags,
      postDate,
      formattedPostDate,
      socialMediaImageUrl: `${(await this.getHomeUrl()).toString()}blog/post/${fileName}/social-media.png`,
      blogUrl: `${(await this.getHomeUrl()).toString()}blog/post/${fileName}/view`,
    };

    return blogPost;
  }

  private static getPostDateFromFileName(fileName: string): string {
    const year: string | undefined = fileName.split("-")[0];
    const month: string | undefined = fileName.split("-")[1];
    const day: string | undefined = fileName.split("-")[2];

    if (!year || !month || !day) {
      throw new BadDataException("Invalid file name");
    }

    return `${year}-${month}-${day}`;
  }

  private static getFormattedPostDateFromFileName(fileName: string): string {
    // file name is of the format YYYY-MM-DD-Title.md
    const year: string | undefined = fileName.split("-")[0];
    const month: string | undefined = fileName.split("-")[1];
    const day: string | undefined = fileName.split("-")[2];

    if (!year || !month || !day) {
      throw new BadDataException("Invalid file name");
    }

    const date: Date = OneUptimeDate.getDateFromYYYYMMDD(year, month, day);
    return OneUptimeDate.getDateAsLocalFormattedString(date, true);
  }

  private static getPostFromMarkdown(markdownContent: string): string {
    const authorLine: string | undefined = markdownContent
      .split("\n")
      .find((line: string) => {
        return line.startsWith("Author:");
      });
    const titleLine: string | undefined = markdownContent
      .split("\n")
      .find((line: string) => {
        return line.startsWith("#");
      });
    const descriptionLine: string | undefined =
      markdownContent.split("\n").find((line: string) => {
        return line.startsWith("Description:");
      }) || "";

    const tagsLine: string | undefined =
      markdownContent.split("\n").find((line: string) => {
        return line.startsWith("Tags:");
      }) || "";

    if (!authorLine && !titleLine && !descriptionLine && !tagsLine) {
      return markdownContent;
    }

    const lines: string[] = markdownContent.split("\n");

    if (authorLine) {
      const authorLineIndex: number = lines.indexOf(authorLine);
      lines.splice(authorLineIndex, 1);
    }

    if (titleLine) {
      const titleLineIndex: number = lines.indexOf(titleLine);
      lines.splice(titleLineIndex, 1);
    }

    if (descriptionLine) {
      const descriptionLineIndex: number = lines.indexOf(descriptionLine);
      lines.splice(descriptionLineIndex, 1);
    }

    if (tagsLine) {
      const tagsLineIndex: number = lines.indexOf(tagsLine);
      lines.splice(tagsLineIndex, 1);
    }

    return lines.join("\n").trim();
  }

  public static getTitleFromFileContent(fileContent: string): string {
    // title is the first line that stars with "#"

    const titleLine: string =
      fileContent
        .split("\n")
        .find((line: string) => {
          return line.startsWith("#");
        })
        ?.replace("#", "") || "OneUptime Blog";

    return titleLine;
  }

  public static getTagsFromFileContent(fileContent: string): string[] {
    // tags is the first line that starts with "Tags:"

    const tagsLine: string | undefined =
      fileContent
        .split("\n")
        .find((line: string) => {
          return line.startsWith("Tags:");
        })
        ?.replace("Tags:", "") || "";

    return tagsLine.split(",").map((tag: string) => {
      return tag.trim();
    });
  }

  public static getDescriptionFromFileContent(fileContent: string): string {
    // description is the first line that starts with ">"

    const descriptionLine: string | undefined =
      fileContent
        .split("\n")
        .find((line: string) => {
          return line.startsWith("Description:");
        })
        ?.replace("Description:", "") || "";

    return descriptionLine;
  }

  public static async getAuthorFromFileContent(
    fileContent: string,
  ): Promise<BlogPostAuthor | null> {
    // author line is in this format: Author: [username](githubUrl)

    const authorLine: string | undefined = fileContent
      .split("\n")
      .find((line: string) => {
        return line.startsWith("Author:");
      });
    const authorUsername: string | undefined = authorLine
      ?.split("[")[1]
      ?.split("]")[0];
    const authorGitHubUrl: string | undefined = authorLine
      ?.split("(")[1]
      ?.split(")")[0];
    const authorProfileImageUrl: string = `https://avatars.githubusercontent.com/${authorUsername}`;

    if (!authorUsername || !authorGitHubUrl) {
      return null;
    }

    return {
      username: authorUsername,
      githubUrl: authorGitHubUrl,
      profileImageUrl: authorProfileImageUrl,
      // Do NOT call GitHub; use username as name placeholder.
      name: authorUsername,
    };
  }
}
