import LocalStorage from './localstorage';
import Email from 'common/types/Email';
import URL from 'common/types/api/URL';
import { JSONObject } from 'common/types/JSON';

export default class User {
    public static getAccessToken() {
        return LocalStorage.getItem('access_token');
    }

    public static setAccessToken(token: string) {
        LocalStorage.setItem('access_token', token);
    }

    public static isCardRegistered() {
        return LocalStorage.getItem('cardRegistered');
    }

    public static setCardRegistered(value: boolean) {
        LocalStorage.setItem('cardRegistered', value.toString());
    }

    public static setUserId(id: string) {
        LocalStorage.setItem('id', id);
    }

    public static getUserId() {
        return LocalStorage.getItem('id');
    }

    public static getName() {
        return LocalStorage.getItem('name');
    }

    public static setName(name: string) {
        LocalStorage.setItem('name', name);
    }

    public static getEmail() {
        return LocalStorage.getItem('email');
    }

    public static setEmail(email: Email) {
        LocalStorage.setItem('email', email);
    }

    public static initialUrl() {
        return LocalStorage.getItem('initialUrl');
    }

    public static setInitialUrl(url: URL) {
        LocalStorage.setItem('initialUrl', url);
    }

    // TODO: Fix project type
    public static setProject(project: JSONObject) {
        LocalStorage.setItem('project', project);
    }

    public static getProject() {
        return LocalStorage.getItem('project');
    }

    public static clear() {
        LocalStorage.clear();
    }

    public static removeUserId() {
        LocalStorage.removeItem('id');
    }

    public static removeAccessToken() {
        LocalStorage.removeItem('token');
    }

    public static removeInitialUrl() {
        return sessionStorage.removeItem('initialUrl');
    }

    public static isLoggedIn() {
        return LocalStorage.getItem('access_token') ? true : false;
    }
}
