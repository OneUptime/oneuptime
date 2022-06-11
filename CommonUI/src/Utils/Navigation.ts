import Route from 'Common/Types/API/Route';
import { NavigateFunction } from 'react-router-dom';

abstract class Navigation {

    public static navigateHook: NavigateFunction;

    public static navigate(route: Route): void {
        if (this.navigateHook) {
            this.navigateHook(route.toString());
       }
    }
}

export default Navigation;
