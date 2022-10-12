import Route from './API/Route';
import URL from './API/URL';

export default interface Link {
    title: string;
    to: Route | URL;
    openInNewTab?: boolean | undefined;
}
