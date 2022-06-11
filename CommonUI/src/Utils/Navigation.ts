import Route from 'Common/Types/API/Route';
import { useNavigate } from 'react-router-dom';

class Navigation {
    public static navigate(route: Route): void {
        useNavigate()(route.toString());
    }
}

export default Navigation;
