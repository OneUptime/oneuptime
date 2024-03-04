import HTTPResponse from 'Common/Types/API/HTTPResponse';
import API from 'Common/Utils/API';
import URL from 'Common/Types/API/URL';
import { marked } from 'marked';
import { JSONArray, JSONObject, JSONObjectOrArray } from 'Common/Types/JSON';
import BaseModel from 'Common/Models/BaseModel';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import LocalCache from 'CommonServer/Infrastructure/LocalCache';
import JSONFunctions from 'Common/Types/JSONFunctions';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import OneUptimeDate from 'Common/Types/Date';
import BadDataException from 'Common/Types/Exception/BadDataException';

export interface BlogPostAuthor {
    username: string;
    githubUrl: string;
    profileImageUrl: string;
    name: string;
}

export interface BlogPostHeader {
    title: string;
    description: string;
    author: BlogPostAuthor | null;
    formattedPostDate: string;
    fileName: string;
    tags: string[];
    postDate: string;
    blogUrl: string;
}

export interface BlogPost extends BlogPostHeader {
    htmlBody: string;
    markdownBody: string;
    socialMediaImageUrl: string;
}

const GitHubRawUrl: string =
    'https://raw.githubusercontent.com/oneuptime/blog/master';

export default class BlogPostUtil {
    public static async getBlogPostList(): Promise<BlogPostHeader[]> {
        const fileUrl: URL = URL.fromString(`${GitHubRawUrl}/Blog.json`);

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
            (fileData.data as JSONObject)?.['data']?.toString() || '';

        if (typeof jsonContent === 'string') {
            jsonContent = JSONFunctions.parse(jsonContent) as JSONArray;
        }

        return JSONFunctions.deserializeArray(
            jsonContent as Array<JSONObject>
        ) as any;
    }

    public static async getBlogPost(
        fileName: string
    ): Promise<BlogPost | null> {
        let blogPost: BlogPost | null = this.getBlogPostFromCache(fileName);

        // if (blogPost) {
        //     return Promise.resolve(blogPost);
        // }

        blogPost = await this.getBlogPostFromGitHub(fileName);

        // save this to cache
        LocalCache.setJSON(
            'blog',
            fileName,
            JSONFunctions.serialize(blogPost as any)
        );

        return blogPost;
    }

    public static async getNameOfGitHubUser(username: string): Promise<string> {
        const fileUrl: URL = URL.fromString(
            `https://api.github.com/users/${username}`
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
            (fileData.data as JSONObject)?.['name']?.toString() || '';
        return name;
    }

    public static async getGitHubMarkdownFileContent(
        githubPath: string
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
            (fileData.data as JSONObject)?.['data']?.toString() || '';
        return markdownContent;
    }

    public static async getTags(): Promise<string[]> {
        // check if tags are in cache
        let tags: string[] = LocalCache.getJSON(
            'blog-tags',
            'tags'
        ) as string[];

        if (tags && tags.length > 0) {
            return tags;
        }

        tags = await this.getAllTagsFromGitHub();

        // save this to cache

        LocalCache.setJSON(
            'blog-tags',
            'tags',
            JSONFunctions.serialize(tags as any)
        );

        return tags;
    }

    public static async getAllTagsFromGitHub(): Promise<string[]> {
        const tagsMarkdownContent = await this.getGitHubMarkdownFileContent(
            'Tags.md'
        );

        if (!tagsMarkdownContent) {
            return [];
        }

        const tags = tagsMarkdownContent
            .split('\n')
            .map((tag: string) => {
                return tag.trim();
            })
            .filter((tag: string) => {
                return tag.startsWith('-');
            })
            .map((tag: string) => {
                return tag.replace('-', '').trim();
            });

        return tags;
    }

    public static async getBlogPostFromGitHub(
        fileName: string
    ): Promise<BlogPost | null> {
        const fileUrl: URL = URL.fromString(
            `${GitHubRawUrl}/posts/${fileName}/README.md`
        );

        const postDate = this.getPostDateFromFileName(fileName);
        const formattedPostDate =
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
            (fileData.data as JSONObject)?.['data']?.toString() || '';

        const blogPostAuthor: BlogPostAuthor | null =
            await this.getAuthorFromFileContent(markdownContent);

        const title = this.getTitleFromFileContent(markdownContent);
        const description = this.getDescriptionFromFileContent(markdownContent);
        const tags = this.getTagsFromFileContent(markdownContent);

        markdownContent = this.getPostFromMarkdown(markdownContent);

        const renderer = this.getBlogRenderer();

        const htmlBody: string = await marked(markdownContent, {
            renderer: renderer,
        });

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
            blogUrl: `https://oneuptime.com/blog/post/${fileName}`,
        };

        return blogPost;
    }

    static getPostDateFromFileName(fileName: string): string {
        const year = fileName.split('-')[0];
        const month = fileName.split('-')[1];
        const day = fileName.split('-')[2];

        if (!year || !month || !day) {
            throw new BadDataException('Invalid file name');
        }

        return `${year}-${month}-${day}`;
    }

    static getFormattedPostDateFromFileName(fileName: string): string {
        // file name is of the format YYYY-MM-DD-Title.md
        const year = fileName.split('-')[0];
        const month = fileName.split('-')[1];
        const day = fileName.split('-')[2];

        if (!year || !month || !day) {
            throw new BadDataException('Invalid file name');
        }

        const date = OneUptimeDate.getDateFromYYYYMMDD(year, month, day);
        return OneUptimeDate.getDateAsLocalFormattedString(date, true);
    }

    static getBlogRenderer() {
        const renderer = new marked.Renderer();

        renderer.paragraph = function (text) {
            return `<p class="mt-2 mb-2 leading-8 text-gray-600">${text}</p>`;
        };

        renderer.blockquote = function (quote) {
            return `<blockquote class="p-4 pt-1 pb-1 my-4 border-s-4 border-indigo-500">
            <div class="leading-8 text-gray-600">${quote}</div>
        </blockquote>`;
        };

        renderer.code = function (code, language) {
            return `<pre class="my-4 p-4 bg-gray-100 text-gray-900 rounded-md"><code class="language-${language}">${code}</code></pre>`;
        };

        renderer.heading = function (text, level) {
            if (level === 1) {
                return `<h1 class="my-5 mt-8 text-4xl font-bold tracking-tight text-gray-800">${text}</h1>`;
            } else if (level === 2) {
                return `<h2 class="my-5  mt-8 text-3xl font-bold tracking-tight text-gray-800">${text}</h2>`;
            } else if (level === 3) {
                return `<h3 class="my-5  mt-8 text-2xl font-bold tracking-tight text-gray-800">${text}</h3>`;
            } else if (level === 4) {
                return `<h4 class="my-5  mt-8 text-xl font-bold tracking-tight text-gray-800">${text}</h4>`;
            } else if (level === 5) {
                return `<h5 class="my-5  mt-8 text-lg font-bold tracking-tight text-gray-800">${text}</h5>`;
            }
            return `<h6 class="my-5 tracking-tight font-bold text-gray-800">${text}</h6>`;
        };

        return renderer;
    }

    static getPostFromMarkdown(markdownContent: string) {
        const authorLine: string | undefined = markdownContent
            .split('\n')
            .find((line: string) => {
                return line.startsWith('Author:');
            });
        const titleLine: string | undefined = markdownContent
            .split('\n')
            .find((line: string) => {
                return line.startsWith('#');
            });
        const descriptionLine: string | undefined =
            markdownContent.split('\n').find((line: string) => {
                return line.startsWith('Description:');
            }) || '';

        const tagsLine: string | undefined =
            markdownContent.split('\n').find((line: string) => {
                return line.startsWith('Tags:');
            }) || '';

        if (!authorLine && !titleLine && !descriptionLine && !tagsLine) {
            return markdownContent;
        }

        const lines: string[] = markdownContent.split('\n');

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

        return lines.join('\n').trim();
    }

    public static getBlogPostFromCache(fileName: string): BlogPost | null {
        const blogPost: BlogPost | null = LocalCache.getJSON(
            'blog',
            fileName
        ) as BlogPost | null;
        return blogPost;
    }

    public static getTitleFromFileContent(fileContent: string): string {
        // title is the first line that stars with "#"

        const titleLine: string =
            fileContent
                .split('\n')
                .find((line: string) => {
                    return line.startsWith('#');
                })
                ?.replace('#', '') || 'OneUptime Blog';

        return titleLine;
    }

    public static getTagsFromFileContent(fileContent: string): string[] {
        // tags is the first line that starts with "Tags:"

        const tagsLine: string | undefined =
            fileContent
                .split('\n')
                .find((line: string) => {
                    return line.startsWith('Tags:');
                })
                ?.replace('Tags:', '') || '';

        return tagsLine.split(',').map((tag: string) => {
            return tag.trim();
        });
    }

    public static getDescriptionFromFileContent(fileContent: string): string {
        // description is the first line that starts with ">"

        const descriptionLine: string | undefined =
            fileContent
                .split('\n')
                .find((line: string) => {
                    return line.startsWith('Description:');
                })
                ?.replace('Description:', '') || '';

        return descriptionLine;
    }

    public static async getAuthorFromFileContent(
        fileContent: string
    ): Promise<BlogPostAuthor | null> {
        // author line is in this format: Author: [username](githubUrl)

        const authorLine: string | undefined = fileContent
            .split('\n')
            .find((line: string) => {
                return line.startsWith('Author:');
            });
        const authorUsername: string | undefined = authorLine
            ?.split('[')[1]
            ?.split(']')[0];
        const authorGitHubUrl: string | undefined = authorLine
            ?.split('(')[1]
            ?.split(')')[0];
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
