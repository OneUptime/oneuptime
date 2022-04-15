import LocalStorage from './localstorage';
import Email from 'Common/Types/Email';
import URL from 'Common/Types/api/URL';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import Name from 'Common/Types/Name';
import BadDataException from 'Common/Types/Exception/BadDataException';

export default class User {
    public static getAccessToken(): string {
        return LocalStorage.getItem('access_token') as string;
    }

    public static setAccessToken(token: string): void {
        LocalStorage.setItem('access_token', token);
    }

    public static isCardRegistered(): boolean {
        return Boolean(LocalStorage.getItem('cardRegistered'));
    }

    public static setCardRegistered(value: boolean): void {
        LocalStorage.setItem('cardRegistered', value.toString());
    }

    public static setUserId(id: ObjectID): void {
        LocalStorage.setItem('id', id.toString());
    }

    public static getUserId(): ObjectID {
        return new ObjectID((LocalStorage.getItem('id') as string) || '');
    }

    public static getName(): Name {
        return new Name((LocalStorage.getItem('name') as string) || '');
    }

    public static setName(name: string): void {
        LocalStorage.setItem('name', name);
    }

    public static getEmail(): Email {
        return new Email(LocalStorage.getItem('email') as string);
    }

    public static setEmail(email: Email): void {
        LocalStorage.setItem('email', email);
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

    public static getProject(): JSONObject {
        return LocalStorage.getItem('project') as JSONObject;
    }

    public static clear(): void {
        LocalStorage.clear();
    }

    public static removeUserId(): void {
        LocalStorage.removeItem('id');
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
}
