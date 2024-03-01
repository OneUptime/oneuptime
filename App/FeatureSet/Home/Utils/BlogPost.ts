import HTTPResponse from "Common/Types/API/HTTPResponse";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import { marked } from "marked";
import { JSONObject, JSONObjectOrArray, JSONValue } from "Common/Types/JSON";
import BaseModel from "Common/Models/BaseModel";
import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";
import LocalCache from "CommonServer/Infrastructure/LocalCache";
import JSONFunctions from "Common/Types/JSONFunctions";

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

        if (blogPost) {
            return Promise.resolve(blogPost);
        }

        blogPost = await this.getBlogPostFromGitHub(fileName);

        // save this to cache
        LocalCache.setJSON("blog", fileName, JSONFunctions.serialize(blogPost as any));

        return blogPost;
    }

    public static async getBlogPostFromGitHub(fileName: string): Promise<BlogPost> {
        const fileUrl: URL = URL.fromString(`https://raw.githubusercontent.com/oneuptime/blog/master/blog/${fileName}/README.md`);

        const fileData: HTTPResponse<string | JSONObjectOrArray | BaseModel | BaseModel[] | AnalyticsBaseModel | AnalyticsBaseModel[]> = await API.get(fileUrl);

        let markdownContent: string = fileData.data.toString();

        const blogPostAuthor: BlogPostAuthor | null = this.getAuthorFromFileContent(markdownContent);

        const title = this.getTitleFromFileContent(markdownContent);
        const description = this.getDescriptionFromFileContent(markdownContent);

        markdownContent = this.removeAuthorTitleAndDescriptionFromMarkdown(markdownContent);

        const htmlBody: string = await marked(markdownContent);

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
    static removeAuthorTitleAndDescriptionFromMarkdown(markdownContent: string) {
        
        const authorLine: string | undefined = markdownContent.split('\n').find((line: string) => line.startsWith('Author:'));
        const titleLine: string | undefined = markdownContent.split('\n').find((line: string) => line.startsWith('#'));
        const descriptionLine: string | undefined = markdownContent.split('\n').find((line: string) => line.startsWith('>')) || '';

        if(!authorLine || !titleLine || !descriptionLine) {
            return markdownContent;
        }

        let lines: string[] = markdownContent.split('\n');

        if(authorLine){
            const authorLineIndex: number = markdownContent.split('\n').indexOf(authorLine);
            lines.splice(authorLineIndex, 1);
        }


        if(titleLine){
            const titleLineIndex: number = markdownContent.split('\n').indexOf(titleLine);
            lines.splice(titleLineIndex, 1);
        }

        if(descriptionLine){
            const descriptionLineIndex: number = markdownContent.split('\n').indexOf(descriptionLine);
            lines.splice(descriptionLineIndex, 1);
        }

        return lines.join('\n');
    }

    public static getBlogPostFromCache(fileName: string): BlogPost | null {
        const blogPost: BlogPost | null = LocalCache.getJSON("blog", fileName) as BlogPost | null;
        return blogPost;
    }


    public static getTitleFromFileContent(fileContent: string): string {
        // title is the first line that stars with "#"

        const titleLine: string = fileContent.split('\n').find((line: string) => line.startsWith('#'))?.replace('#', '') || 'OneUptime Blog';

        return titleLine;
    }


    public static getDescriptionFromFileContent(fileContent: string): string {
        // description is the first line that starts with ">"

        const descriptionLine: string | undefined = fileContent.split('\n').find((line: string) => line.startsWith('>'))?.replace('>', '') || '';

        return descriptionLine;
    }


    public static getAuthorFromFileContent(fileContent: string): BlogPostAuthor | null {

        // author line is in this format: Author: [username](githubUrl)

        const authorLine: string | undefined = fileContent.split('\n').find((line: string) => line.startsWith('Author:'));
        const authorUsername: string | undefined = authorLine?.split('[')[1]?.split(']')[0];
        const authorGitHubUrl: string | undefined = authorLine?.split('(')[1]?.split(')')[0];
        const authorProfileImageUrl: string = `https://avatars.githubusercontent.com/${authorUsername}`;

        if (!authorUsername || !authorGitHubUrl) {
            return null;
        }

        return {
            username: authorUsername,
            githubUrl: authorGitHubUrl,
            profileImageUrl: authorProfileImageUrl,
        }
    }
}