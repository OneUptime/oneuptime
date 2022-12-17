import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
import URL from 'Common/Types/API/URL';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import BaseAPI from 'CommonUI/src/Utils/API/API';
import { DASHBOARD_API_URL } from 'CommonUI/src/Config';
import useAsyncEffect from 'use-async-effect';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import BadDataException from 'Common/Types/Exception/BadDataException';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import ObjectID from 'Common/Types/ObjectID';
import BaseModel from 'Common/Models/BaseModel';
import StatusPageResource from 'Model/Models/StatusPageResource';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Route from 'Common/Types/API/Route';
import StatusPageAnnouncement from 'Model/Models/StatusPageAnnouncement';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Navigation from 'CommonUI/src/Utils/Navigation';
import EventItem, {
    ComponentProps as EventItemComponentProps,
} from 'CommonUI/src/Components/EventItem/EventItem';

export const getAnnouncementEventItem: Function = (
    announcement: StatusPageAnnouncement,
    isPreviewPage: boolean
): EventItemComponentProps => {
    return {
        eventTitle: announcement.title || '',
        eventDescription: announcement.description,
        eventTimeline: [],
        eventType: 'Announcement',
        footerEventStatus: 'Announced at',
        footerDateTime: announcement.showAnnouncementAt,
        eventViewRoute: RouteUtil.populateRouteParams(
            isPreviewPage
                ? (RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_DETAIL] as Route)
                : (RouteMap[PageMap.ANNOUNCEMENT_DETAIL] as Route),
            announcement.id!
        ),
    };
};

const Overview: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [_statusPageResources, setStatusPageResources] = useState<
        Array<StatusPageResource>
    >([]);
    const [announcement, setAnnouncement] =
        useState<StatusPageAnnouncement | null>(null);
    const [parsedData, setParsedData] =
        useState<EventItemComponentProps | null>(null);

    useAsyncEffect(async () => {
        try {
            setIsLoading(true);

            const id: ObjectID = LocalStorage.getItem(
                'statusPageId'
            ) as ObjectID;
            if (!id) {
                throw new BadDataException('Status Page ID is required');
            }

            const announcementId: string | undefined = Navigation.getLastParam()
                ?.toString()
                .replace('/', '');

            const response: HTTPResponse<JSONObject> =
                await BaseAPI.post<JSONObject>(
                    URL.fromString(DASHBOARD_API_URL.toString()).addRoute(
                        `/status-page/announcements/${id.toString()}/${announcementId}`
                    ),
                    {},
                    {}
                );
            const data: JSONObject = response.data;

            const announcement: StatusPageAnnouncement =
                 JSONFunctions.fromJSONObject(
                    (data['announcements'] as JSONObject) || [],
                    StatusPageAnnouncement
                );

            const statusPageResources: Array<StatusPageResource> =
                 JSONFunctions.fromJSONArray(
                    (data['statusPageResources'] as JSONArray) || [],
                    StatusPageResource
                );

            // save data. set()

            setAnnouncement(announcement);
            setStatusPageResources(statusPageResources);

            setIsLoading(false);
            props.onLoadComplete();
        } catch (err) {
            try {
                setError(
                    (err as HTTPErrorResponse).message ||
                        'Server Error. Please try again'
                );
            } catch (e) {
                setError('Server Error. Please try again');
            }
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isLoading) {
            // parse data;
            setParsedData(null);
            return;
        }

        if (!announcement) {
            return;
        }

        setParsedData(
            getAnnouncementEventItem(announcement, Boolean(props.isPreviewPage))
        );
    }, [isLoading]);

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    if (!parsedData) {
        return <PageLoader isVisible={true} />;
    }

    return (
        <Page>
            {announcement ? <EventItem {...parsedData} /> : <></>}
            {!announcement ? (
                <ErrorMessage error="No announcement found with this ID." />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Overview;
