import LocalStorage from './LocalStorage';
import Email from 'Common/Types/Email';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import Name from 'Common/Types/Name';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Dictionary from 'Common/Types/Dictionary';
import API from 'Common/Utils/API';
import { IDENTITY_URL } from '../Config';

export default class User {
    public static setProfilePicId(id: ObjectID | null): void {
        if (!id) {
            LocalStorage.removeItem('profile_pic_id');
            return;
        }

        LocalStorage.setItem('profile_pic_id', id.toString());
    }

    public static getProfilePicId(): ObjectID | null {
        if (!LocalStorage.getItem('profile_pic_id')) {
            return null;
        }

        return new ObjectID(
            (LocalStorage.getItem('profile_pic_id') as string) || ''
        );
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

    public static getEmail(): Email | null {
        if (!LocalStorage.getItem('user_email')) {
            return null;
        }

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

    public static isMasterAdmin(): boolean {
        return LocalStorage.getItem('is_master_admin') as boolean;
    }

    public static setIsMasterAdmin(isMasterAdmin: boolean): void {
        LocalStorage.setItem('is_master_admin', isMasterAdmin);
    }

    public static isLoggedIn(): boolean {
        return Boolean(this.getEmail());
    }

    public static async logout(): Promise<void> {
        await API.post(
            URL.fromString(IDENTITY_URL.toString()).addRoute('/logout')
        );
        LocalStorage.clear();
    }

    public static getUtmParams(): Dictionary<string> {
        const localStorageItems: Dictionary<string> =
            LocalStorage.getAllItems();
        const result: Dictionary<string> = {};

        for (const key in localStorageItems) {
            if (!localStorageItems[key]) {
                continue;
            }

            if (key.startsWith('utm')) {
                result[key] = localStorageItems[key] as string;
            }
        }

        return result;
    }
}
