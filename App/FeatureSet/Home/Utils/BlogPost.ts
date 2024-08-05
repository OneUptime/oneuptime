import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject, JSONObjectOrArray } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import Text from "Common/Types/Text";
import API from "Common/Utils/API";
import LocalCache from "CommonServer/Infrastructure/LocalCache";
import Markdown, { MarkdownContentType } from "CommonServer/Types/Markdown";

export interface BlogPostAuthor {
  username: string;
  githubUrl: string;
  profileImageUrl: string;
  name: string;
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

const GitHubRawUrl: string =
  "https://raw.githubusercontent.com/oneuptime/blog/master";

export default class BlogPostUtil {
  public static async getBlogPostList(
    tagName?: string | undefined,
  ): Promise<BlogPostHeader[]> {
    const fileUrl: URL = URL.fromString(`${GitHubRawUrl}/Blogs.json`);

    const fileData:
      | HTTPResponse<
          | JSONObjectOrArray
          | BaseModel
          | BaseModel[]
          | AnalyticsBaseModel
          | AnalyticsBaseModel[]
        >
      | HTTPErrorResponse = await API.get(fileUrl);

    if (fileData.isFailure()) {
      throw fileData as HTTPErrorResponse;
    }

    let jsonContent: string | JSONArray =
      (fileData.data as string | JSONArray) || [];

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
        blogUrl: `/blog/post/${fileName}`,
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
    let blogPost: BlogPost | null = this.getBlogPostFromCache(fileName);

    // if (blogPost) {
    //     return Promise.resolve(blogPost);
    // }

    blogPost = await this.getBlogPostFromGitHub(fileName);

    // save this to cache
    LocalCache.setJSON(
      "blog",
      fileName,
      JSONFunctions.serialize(blogPost as any),
    );

    return blogPost;
  }

  public static async getNameOfGitHubUser(username: string): Promise<string> {
    const fileUrl: URL = URL.fromString(
      `https://api.github.com/users/${username}`,
    );

    const fileData:
      | HTTPResponse<
          | JSONObjectOrArray
          | BaseModel
          | BaseModel[]
          | AnalyticsBaseModel
          | AnalyticsBaseModel[]
        >
      | HTTPErrorResponse = await API.get(fileUrl);

    if (fileData.isFailure()) {
      throw fileData as HTTPErrorResponse;
    }

    const name: string =
      (fileData.data as JSONObject)?.["name"]?.toString() || "";
    return name;
  }

  public static async getGitHubMarkdownFileContent(
    githubPath: string,
  ): Promise<string | null> {
    const fileUrl: URL = URL.fromString(`${GitHubRawUrl}/${githubPath}`);

    const fileData:
      | HTTPResponse<
          | JSONObjectOrArray
          | BaseModel
          | BaseModel[]
          | AnalyticsBaseModel
          | AnalyticsBaseModel[]
        >
      | HTTPErrorResponse = await API.get(fileUrl);

    if (fileData.isFailure()) {
      if ((fileData as HTTPErrorResponse).statusCode === 404) {
        return null;
      }

      throw fileData as HTTPErrorResponse;
    }

    const markdownContent: string =
      (fileData.data as JSONObject)?.["data"]?.toString() || "";
    return markdownContent;
  }

  public static async getTags(): Promise<string[]> {
    // check if tags are in cache
    let tags: string[] = LocalCache.getJSON("blog-tags", "tags") as string[];

    if (tags && tags.length > 0) {
      return tags;
    }

    tags = await this.getAllTagsFromGitHub();

    // save this to cache

    LocalCache.setJSON(
      "blog-tags",
      "tags",
      JSONFunctions.serialize(tags as any),
    );

    return tags;
  }

  public static async getAllTagsFromGitHub(): Promise<string[]> {
    const tagsMarkdownContent: string | null =
      await this.getGitHubMarkdownFileContent("Tags.md");

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

  public static async getBlogPostFromGitHub(
    fileName: string,
  ): Promise<BlogPost | null> {
    const fileUrl: URL = URL.fromString(
      `${GitHubRawUrl}/posts/${fileName}/README.md`,
    );

    const postDate: string = this.getPostDateFromFileName(fileName);
    const formattedPostDate: string =
      this.getFormattedPostDateFromFileName(fileName);

    const fileData:
      | HTTPResponse<
          | JSONObjectOrArray
          | BaseModel
          | BaseModel[]
          | AnalyticsBaseModel
          | AnalyticsBaseModel[]
        >
      | HTTPErrorResponse = await API.get(fileUrl);

    if (fileData.isFailure()) {
      if ((fileData as HTTPErrorResponse).statusCode === 404) {
        return null;
      }

      throw fileData as HTTPErrorResponse;
    }

    let markdownContent: string =
      (fileData.data as JSONObject)?.["data"]?.toString() || "";

    const blogPostAuthor: BlogPostAuthor | null =
      await this.getAuthorFromFileContent(markdownContent);

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
      socialMediaImageUrl: `${GitHubRawUrl}/posts/${fileName}/social-media.png`,
      blogUrl: `https://oneuptime.com/blog/post/${fileName}`, // this has to be oneuptime.com because its used in twitter cards and faceboomk cards. Please dont change this.
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

  public static getBlogPostFromCache(fileName: string): BlogPost | null {
    const blogPost: BlogPost | null = LocalCache.getJSON(
      "blog",
      fileName,
    ) as BlogPost | null;
    return blogPost;
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
      name: await this.getNameOfGitHubUser(authorUsername),
    };
  }
}
