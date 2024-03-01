import HTTPResponse from 'Common/Types/API/HTTPResponse';
import API from 'Common/Utils/API';
import URL from 'Common/Types/API/URL';
import { marked } from 'marked';
import { JSONObject, JSONObjectOrArray } from 'Common/Types/JSON';
import BaseModel from 'Common/Models/BaseModel';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import LocalCache from 'CommonServer/Infrastructure/LocalCache';
import JSONFunctions from 'Common/Types/JSONFunctions';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';

export interface BlogPostAuthor {
    username: string;
    githubUrl: string;
    profileImageUrl: string;
}

export interface BlogPost {
    title: string;
    description: string;
    author: BlogPostAuthor | null;
    htmlBody: string;
    markdownBody: string;
    fileName: string;
}

export default class BlogPostUtil {
    public static async getBlogPost(fileName: string): Promise<BlogPost> {
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

    public static async getBlogPostFromGitHub(
        fileName: string
    ): Promise<BlogPost> {
        const fileUrl: URL = URL.fromString(
            `https://raw.githubusercontent.com/oneuptime/blog/master/posts/${fileName}/README.md`
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

        let markdownContent: string =
            (fileData.data as JSONObject)?.['data']?.toString() || '';

        const blogPostAuthor: BlogPostAuthor | null =
            this.getAuthorFromFileContent(markdownContent);

        const title = this.getTitleFromFileContent(markdownContent);
        const description = this.getDescriptionFromFileContent(markdownContent);

        markdownContent =
            this.removeAuthorTitleAndDescriptionFromMarkdown(markdownContent);

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
        };

        return blogPost;
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

    static removeAuthorTitleAndDescriptionFromMarkdown(
        markdownContent: string
    ) {
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
                return line.startsWith('>');
            }) || '';

        if (!authorLine || !titleLine || !descriptionLine) {
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

        return lines.join('\n');
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

    public static getDescriptionFromFileContent(fileContent: string): string {
        // description is the first line that starts with ">"

        const descriptionLine: string | undefined =
            fileContent
                .split('\n')
                .find((line: string) => {
                    return line.startsWith('>');
                })
                ?.replace('>', '') || '';

        return descriptionLine;
    }

    public static getAuthorFromFileContent(
        fileContent: string
    ): BlogPostAuthor | null {
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
        };
    }
}
