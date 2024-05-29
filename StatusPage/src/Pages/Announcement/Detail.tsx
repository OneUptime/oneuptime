import Page from '../../Components/Page/Page';
import API from '../../Utils/API';
import { STATUS_PAGE_API_URL } from '../../Utils/Config';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import StatusPageUtil from '../../Utils/StatusPage';
import PageComponentProps from '../PageComponentProps';
import BaseModel from 'Common/Models/BaseModel';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { Blue500 } from 'Common/Types/BrandColors';
import OneUptimeDate from 'Common/Types/Date';
import BadDataException from 'Common/Types/Exception/BadDataException';
import IconProp from 'Common/Types/Icon/IconProp';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import EventItem, {
    ComponentProps as EventItemComponentProps,
} from 'CommonUI/src/Components/EventItem/EventItem';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import Navigation from 'CommonUI/src/Utils/Navigation';
import StatusPageAnnouncement from 'Model/Models/StatusPageAnnouncement';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import useAsyncEffect from 'use-async-effect';

type GetAnnouncementEventItemFunctionProps = {
    announcement: StatusPageAnnouncement;
    isPreviewPage: boolean;
    isSummary: boolean;
};

type GetAnnouncementEventItemFunction = (
    data: GetAnnouncementEventItemFunctionProps
) => EventItemComponentProps;

export const getAnnouncementEventItem: GetAnnouncementEventItemFunction = (
    data: GetAnnouncementEventItemFunctionProps
): EventItemComponentProps => {
    const { announcement, isPreviewPage, isSummary } = data;

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
        eventTypeColor: Blue500,
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
                await API.post<JSONObject>(
                    URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
                        `/announcements/${id.toString()}/${announcementId}`
                    ),
                    {},
                    API.getDefaultHeaders(StatusPageUtil.getStatusPageId()!)
                );

            if (!response.isSuccess()) {
                throw response;
            }
            const data: JSONObject = response.data;

            const rawAnnouncements: JSONArray =
                (data['announcements'] as JSONArray) || [];

            const announcement: StatusPageAnnouncement =
                BaseModel.fromJSONObject(
                    (rawAnnouncements[0] as JSONObject) || {},
                    StatusPageAnnouncement
                );

            // save data. set()

            setAnnouncement(announcement);

            setIsLoading(false);
            props.onLoadComplete();
        } catch (err) {
            if (err instanceof HTTPErrorResponse) {
                await StatusPageUtil.checkIfTheUserIsAuthenticated(err);
            }

            setError(API.getFriendlyMessage(err));
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
            getAnnouncementEventItem({
                announcement,
                isPreviewPage: Boolean(StatusPageUtil.isPreviewPage()),
                isSummary: false,
            })
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
                    id="announcement-empty-state"
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
