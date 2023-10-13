import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import Email from 'Common/Types/Email';
import ObjectID from 'Common/Types/ObjectID';
import Name from 'Common/Types/Name';
import { IDENTITY_URL } from 'CommonUI/src/Config';
import API from 'Common/Utils/API';
import URL from 'Common/Types/API/URL';

export default class User {
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

    public static removeName(statusPageId: ObjectID): void {
        LocalStorage.removeItem(statusPageId.toString() + 'user_name');
    }

    public static removeUser(statusPageId: ObjectID): void {
        this.removeUserId(statusPageId);
        this.removeUserEmail(statusPageId);
        this.removeName(statusPageId);
    }

    public static getEmail(statusPageId: ObjectID): Email | null {
        if (!LocalStorage.getItem(statusPageId.toString() + 'user_email')) {
            return null;
        }

        return new Email(
            LocalStorage.getItem(
                statusPageId.toString() + 'user_email'
            ) as string
        );
    }

    public static setEmail(statusPageId: ObjectID, email: Email): void {
        LocalStorage.setItem(statusPageId.toString() + 'user_email', email);
    }

    public static removeUserId(statusPageId: ObjectID): void {
        LocalStorage.removeItem(statusPageId.toString() + 'user_id');
    }

    public static removeUserEmail(statusPageId: ObjectID): void {
        LocalStorage.removeItem(statusPageId.toString() + 'user_email');
    }

    public static removeInitialUrl(statusPageId: ObjectID): void {
        return sessionStorage.removeItem(
            statusPageId.toString() + 'initialUrl'
        );
    }

    public static isLoggedIn(statusPageId: ObjectID): boolean {
        return Boolean(this.getEmail(statusPageId));
    }

    public static async logout(statusPageId: ObjectID): Promise<void> {
        await API.post(
            URL.fromString(IDENTITY_URL.toString())
                .addRoute('/status-page/logout')
                .addRoute('/' + statusPageId.toString())
        );
        this.removeUser(statusPageId);
    }
}
