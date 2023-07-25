import ObjectID from 'Common/Types/ObjectID';
import Typeof from 'Common/Types/Typeof';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import UserUtil from './User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Route from 'Common/Types/API/Route';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';

export default class StatusPageUtil {
    public static getStatusPageId(): ObjectID | null {
        const value: ObjectID | null = LocalStorage.getItem(
            'statusPageId'
        ) as ObjectID | null;

        if (value && typeof value === Typeof.String) {
            return new ObjectID(value.toString());
        }

        return value;
    }

    public static setStatusPageId(id: ObjectID | null): void {
        LocalStorage.setItem('statusPageId', id);
    }

    public static setIsPrivateStatusPage(isPrivate: boolean): void {
        LocalStorage.setItem('isPrivateStatusPage', isPrivate);
    }

    public static isPrivateStatusPage(): boolean {
        return Boolean(LocalStorage.getItem('isPrivateStatusPage'));
    }

    public static isPreviewPage(): boolean {
        return Navigation.containsInPath('/status-page/');
    }

    public static navigateToLoginPage(): void {
        Navigation.navigate(
            new Route(
                StatusPageUtil.isPreviewPage()
                    ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/login?redirectUrl=${Navigation.getCurrentPath()}`
                    : `/login?redirectUrl=${Navigation.getCurrentPath()}`
            ),
            { forceNavigate: true }
        );
    }

    public static checkIfUserHasLoggedIn(): void {
        if (
            StatusPageUtil.getStatusPageId() &&
            StatusPageUtil.isPrivateStatusPage() &&
            !UserUtil.isLoggedIn(StatusPageUtil.getStatusPageId()!)
        ) {
            StatusPageUtil.navigateToLoginPage();
        }
    }

    public static checkIfTheUserIsAuthenticated(
        errorResponse: HTTPErrorResponse
    ): void {
        if (
            errorResponse instanceof HTTPErrorResponse &&
            errorResponse.statusCode === 401
        ) {
            UserUtil.logout(StatusPageUtil.getStatusPageId()!);
            StatusPageUtil.navigateToLoginPage();
        }
    }
}
