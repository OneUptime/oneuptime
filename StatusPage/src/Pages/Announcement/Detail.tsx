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
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import BadDataException from 'Common/Types/Exception/BadDataException';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import ObjectID from 'Common/Types/ObjectID';
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
import JSONFunctions from 'Common/Types/JSONFunctions';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import IconProp from 'Common/Types/Icon/IconProp';
import { Blue } from 'Common/Types/BrandColors';
import OneUptimeDate from 'Common/Types/Date';
import API from '../../Utils/API';
import StatusPageUtil from '../../Utils/StatusPage';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';

export const getAnnouncementEventItem: Function = (
    announcement: StatusPageAnnouncement,
    isPreviewPage: boolean,
    isSummary: boolean
): EventItemComponentProps => {
    return {
        eventTitle: announcement.title || '',
        eventDescription: announcement.description,
        eventTimeline: [],
        eventType: 'Announcement',
        eventViewRoute: !isSummary
            ? undefined
            : RouteUtil.populateRouteParams(
                  isPreviewPage
                      ? (RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_DETAIL] as Route)
                      : (RouteMap[PageMap.ANNOUNCEMENT_DETAIL] as Route),
                  announcement.id!
              ),
        isDetailItem: !isSummary,
        eventTypeColor: Blue,
        eventSecondDescription: announcement.showAnnouncementAt!
            ? 'Announced at ' +
              OneUptimeDate.getDateAsLocalFormattedString(
                  announcement.showAnnouncementAt!
              )
            : '',
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

    StatusPageUtil.checkIfUserHasLoggedIn();

    useAsyncEffect(async () => {
        try {
            if (!StatusPageUtil.getStatusPageId()) {
                return;
            }

            setIsLoading(true);

            const id: ObjectID = LocalStorage.getItem(
                'statusPageId'
            ) as ObjectID;
            if (!id) {
                throw new BadDataException('Status Page ID is required');
            }

            const announcementId: string | undefined =
                Navigation.getLastParamAsObjectID().toString();

            const response: HTTPResponse<JSONObject> =
                await BaseAPI.post<JSONObject>(
                    URL.fromString(DASHBOARD_API_URL.toString()).addRoute(
                        `/status-page/announcements/${id.toString()}/${announcementId}`
                    ),
                    {},
                    API.getDefaultHeaders(StatusPageUtil.getStatusPageId()!)
                );
            const data: JSONObject = response.data;

            const rawAnnouncements: JSONArray =
                (data['announcements'] as JSONArray) || [];

            const announcement: StatusPageAnnouncement =
                JSONFunctions.fromJSONObject(
                    (rawAnnouncements[0] as JSONObject) || {},
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
            if (err instanceof HTTPErrorResponse) {
                StatusPageUtil.checkIfTheUserIsAuthenticated(err);
            }

            setError(BaseAPI.getFriendlyMessage(err));
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
            getAnnouncementEventItem(
                announcement,
                Boolean(StatusPageUtil.isPreviewPage())
            )
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
        <Page
            title="Announcement"
            breadcrumbLinks={[
                {
                    title: 'Overview',
                    to: RouteUtil.populateRouteParams(
                        StatusPageUtil.isPreviewPage()
                            ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
                            : (RouteMap[PageMap.OVERVIEW] as Route)
                    ),
                },
                {
                    title: 'Announcements',
                    to: RouteUtil.populateRouteParams(
                        StatusPageUtil.isPreviewPage()
                            ? (RouteMap[
                                  PageMap.PREVIEW_ANNOUNCEMENT_LIST
                              ] as Route)
                            : (RouteMap[PageMap.ANNOUNCEMENT_LIST] as Route)
                    ),
                },
                {
                    title: 'Announcement',
                    to: RouteUtil.populateRouteParams(
                        StatusPageUtil.isPreviewPage()
                            ? (RouteMap[
                                  PageMap.PREVIEW_ANNOUNCEMENT_DETAIL
                              ] as Route)
                            : (RouteMap[PageMap.ANNOUNCEMENT_DETAIL] as Route),
                        Navigation.getLastParamAsObjectID()
                    ),
                },
            ]}
        >
            {announcement ? <EventItem {...parsedData} /> : <></>}
            {!announcement ? (
                <EmptyState
                    title={'No Announcement'}
                    description={'Announcement not found on this status page.'}
                    icon={IconProp.Announcement}
                />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Overview;
