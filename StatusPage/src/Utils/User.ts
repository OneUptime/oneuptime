import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import Email from 'Common/Types/Email';
import ObjectID from 'Common/Types/ObjectID';
import Name from 'Common/Types/Name';

export default class User {
    public static getAccessToken(statusPageId: ObjectID): string {
        return LocalStorage.getItem(
            statusPageId.toString() + 'access_token'
        ) as string;
    }

    public static setAccessToken(statusPageId: ObjectID, token: string): void {
        LocalStorage.setItem(statusPageId.toString() + 'access_token', token);
    }

    public static setUserId(statusPageId: ObjectID, userId: ObjectID): void {
        LocalStorage.setItem(
            statusPageId.toString() + 'user_id',
            userId.toString()
        );
    }

    public static getUserId(statusPageId: ObjectID): ObjectID {
        return new ObjectID(
            (LocalStorage.getItem(
                statusPageId.toString() + 'user_id'
            ) as string) || ''
        );
    }

    public static getName(statusPageId: ObjectID): Name {
        return new Name(
            (LocalStorage.getItem(
                statusPageId.toString() + 'user_name'
            ) as string) || ''
        );
    }

    public static setName(statusPageId: ObjectID, name: Name): void {
        LocalStorage.setItem(
            statusPageId.toString() + 'user_name',
            name.toString()
        );
    }

    public static getEmail(statusPageId: ObjectID): Email {
        return new Email(
            LocalStorage.getItem(
                statusPageId.toString() + 'user_email'
            ) as string
        );
    }

    public static setEmail(statusPageId: ObjectID, email: Email): void {
        LocalStorage.setItem(statusPageId.toString() + 'user_email', email);
    }

    public static clear(): void {
        LocalStorage.clear();
    }

    public static removeUserId(statusPageId: ObjectID): void {
        LocalStorage.removeItem(statusPageId.toString() + 'user_id');
    }

    public static removeAccessToken(statusPageId: ObjectID): void {
        LocalStorage.removeItem(statusPageId.toString() + 'token');
    }

    public static removeInitialUrl(statusPageId: ObjectID): void {
        return sessionStorage.removeItem(
            statusPageId.toString() + 'initialUrl'
        );
    }

    public static isLoggedIn(statusPageId: ObjectID): boolean {
        return LocalStorage.getItem(statusPageId.toString() + 'access_token')
            ? true
            : false;
    }

    public static logout(): void {
        LocalStorage.clear();
    }
}
