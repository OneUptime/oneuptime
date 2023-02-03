import type Route from './API/Route';
import type URL from './API/URL';

export default interface Link {
    title: string;
    to: Route | URL;
    openInNewTab?: boolean | undefined;
}
