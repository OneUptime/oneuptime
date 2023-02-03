import type Route from 'Common/Types/API/Route';
import type ObjectID from 'Common/Types/ObjectID';

export default interface ComponentProps {
    pageRoute: Route;
    statusPageId?: ObjectID | null | undefined;
    onLoadComplete: () => void;
    isPrivatePage: boolean;
    isPreviewPage?: boolean; // if this status page is not hosted on a domain, then this is true, otherwise false.
}
