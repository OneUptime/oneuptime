import LocalStorage from './LocalStorage';
import Email from 'Common/Types/Email';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import Name from 'Common/Types/Name';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Dictionary from 'Common/Types/Dictionary';

export default class User {
    public static getAccessToken(): string {
        return LocalStorage.getItem('access_token') as string;
    }

    public static setAccessToken(token: string): void {
        LocalStorage.setItem('access_token', token);
    }

    public static setSsoToken(projectId: ObjectID, token: string): void {
        LocalStorage.setItem('sso:' + projectId.toString(), token);
    }

    public static getSsoToken(projectId: ObjectID): string | null {
        return LocalStorage.getItem('sso:' + projectId.toString()) as
            | string
            | null;
    }

    public static isCardRegistered(): boolean {
        return Boolean(LocalStorage.getItem('cardRegistered'));
    }

    public static setCardRegistered(value: boolean): void {
        LocalStorage.setItem('cardRegistered', value.toString());
    }

    public static setUserId(id: ObjectID): void {
        LocalStorage.setItem('user_id', id.toString());
    }

    public static getUserId(): ObjectID {
        return new ObjectID((LocalStorage.getItem('user_id') as string) || '');
    }

    public static getName(): Name {
        return new Name((LocalStorage.getItem('user_name') as string) || '');
    }

    public static setName(name: Name): void {
        LocalStorage.setItem('user_name', name.toString());
    }

    public static getEmail(): Email {
        return new Email(LocalStorage.getItem('user_email') as string);
    }

    public static setEmail(email: Email): void {
        LocalStorage.setItem('user_email', email);
    }

    public static initialUrl(): URL {
        if (LocalStorage.getItem('initialUrl')) {
            return URL.fromString(LocalStorage.getItem('initialUrl') as string);
        }

        throw new BadDataException('Initial URL not found');
    }

    public static setInitialUrl(url: URL): void {
        LocalStorage.setItem('initialUrl', url);
    }

    // TODO: Fix project type
    public static setProject(project: JSONObject): void {
        LocalStorage.setItem('project', project);
    }

    public static getAllSsoTokens(): Dictionary<string> {
        const localStorageItems: Dictionary<string> =
            LocalStorage.getAllItems();
        const result: Dictionary<string> = {};

        for (const key in localStorageItems) {
            if (!localStorageItems[key]) {
                continue;
            }

            if (key.startsWith('sso:')) {
                result[key] = localStorageItems[key] as string;
            }
        }

        return result;
    }

    public static getProject(): JSONObject {
        return LocalStorage.getItem('project') as JSONObject;
    }

    public static clear(): void {
        LocalStorage.clear();
    }

    public static removeUserId(): void {
        LocalStorage.removeItem('user_id');
    }

    public static removeAccessToken(): void {
        LocalStorage.removeItem('token');
    }

    public static removeInitialUrl(): void {
        return sessionStorage.removeItem('initialUrl');
    }

    public static isLoggedIn(): boolean {
        return LocalStorage.getItem('access_token') ? true : false;
    }

    public static logout(): void {
        LocalStorage.clear();
    }
}
