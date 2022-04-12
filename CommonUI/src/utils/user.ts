import LocalStorage from './localstorage';
import Email from 'Common/Types/Email';
import URL from 'Common/Types/api/URL';
import { JSONObject } from 'Common/Types/JSON';

export default class User {
    public static getAccessToken(): string {
        return LocalStorage.getItem('access_token');
    }

    public static setAccessToken(token: string) {
        LocalStorage.setItem('access_token', token);
    }

    public static isCardRegistered(): boolean {
        return LocalStorage.getItem('cardRegistered');
    }

    public static setCardRegistered(value: boolean) {
        LocalStorage.setItem('cardRegistered', value.toString());
    }

    public static setUserId(id: string) {
        LocalStorage.setItem('id', id);
    }

    public static getUserId(): string {
        return LocalStorage.getItem('id');
    }

    public static getName(): string {
        return LocalStorage.getItem('name');
    }

    public static setName(name: string) {
        LocalStorage.setItem('name', name);
    }

    public static getEmail(): string {
        return LocalStorage.getItem('email');
    }

    public static setEmail(email: Email): void {
        LocalStorage.setItem('email', email);
    }

    public static initialUrl(): string {
        return LocalStorage.getItem('initialUrl');
    }

    public static setInitialUrl(url: URL): void {
        LocalStorage.setItem('initialUrl', url);
    }

    // TODO: Fix project type
    public static setProject(project: JSONObject) {
        LocalStorage.setItem('project', project);
    }

    public static getProject(): JSONObject {
        return LocalStorage.getItem('project');
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
