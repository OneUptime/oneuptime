import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
import URL from 'Common/Types/API/URL';
import JSONFunctions from 'Common/Types/JSONFunctions';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';

import useAsyncEffect from 'use-async-effect';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import BadDataException from 'Common/Types/Exception/BadDataException';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import ObjectID from 'Common/Types/ObjectID';
import EventHistoryList, {
    ComponentProps as EventHistoryListComponentProps,
} from 'CommonUI/src/Components/EventHistoryList/EventHistoryList';
import { ComponentProps as EventHistoryDayListComponentProps } from 'CommonUI/src/Components/EventHistoryList/EventHistoryDayList';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import StatusPageAnnouncement from 'Model/Models/StatusPageAnnouncement';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import { getAnnouncementEventItem } from './Detail';
import Route from 'Common/Types/API/Route';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import IconProp from 'Common/Types/Icon/IconProp';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import API from '../../Utils/API';
import StatusPageUtil from '../../Utils/StatusPage';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import { STATUS_PAGE_API_URL } from '../../Utils/Config';
import Section from '../../Components/Section/Section';

const Overview: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [announcements, setAnnouncements] = useState<
        Array<StatusPageAnnouncement>
    >([]);

    const [activeAnnounementsParsedData, setActiveAnnouncementsParsedData] =
        useState<EventHistoryListComponentProps | null>(null);
    const [pastAnnouncementsParsedData, setPastAnnouncementsParsedData] =
        useState<EventHistoryListComponentProps | null>(null);

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
            const response: HTTPResponse<JSONObject> =
                await API.post<JSONObject>(
                    URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
                        `/announcements/${id.toString()}`
                    ),
                    {},
                    API.getDefaultHeaders(StatusPageUtil.getStatusPageId()!)
                );

            if (!response.isSuccess()) {
                throw response;
            }
            const data: JSONObject = response.data;

            const announcements: Array<StatusPageAnnouncement> =
                JSONFunctions.fromJSONArray(
                    (data['announcements'] as JSONArray) || [],
                    StatusPageAnnouncement
                );

            // save data. set()

            setAnnouncements(announcements);

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

    const getAnouncementsParsedData: Function = (
        announcements: Array<StatusPageAnnouncement>
    ): EventHistoryListComponentProps => {
        const eventHistoryListComponentProps: EventHistoryListComponentProps = {
            items: [],
        };

        const days: Dictionary<EventHistoryDayListComponentProps> = {};

        for (const announcement of announcements) {
            const dayString: string = OneUptimeDate.getDateString(
                announcement.showAnnouncementAt!
            );

            if (!days[dayString]) {
                days[dayString] = {
                    date: announcement.showAnnouncementAt!,
                    items: [],
                };
            }

            days[dayString]?.items.push(
                getAnnouncementEventItem(
                    announcement,
                    Boolean(StatusPageUtil.isPreviewPage()),
                    true
                )
            );
        }

        for (const key in days) {
            eventHistoryListComponentProps.items.push(
                days[key] as EventHistoryDayListComponentProps
            );
        }
        return eventHistoryListComponentProps;
    };

    useEffect(() => {
        if (isLoading) {
            // parse data;
            setActiveAnnouncementsParsedData(null);
            setPastAnnouncementsParsedData(null);
            return;
        }

        const activeAnnouncement: Array<StatusPageAnnouncement> =
            announcements.filter((announcement: StatusPageAnnouncement) => {
                return OneUptimeDate.isBefore(
                    OneUptimeDate.getCurrentDate(),
                    announcement.endAnnouncementAt!
                );
            });

        const pastAnnouncement: Array<StatusPageAnnouncement> =
            announcements.filter((announcement: StatusPageAnnouncement) => {
                return OneUptimeDate.isAfter(
                    OneUptimeDate.getCurrentDate(),
                    announcement.endAnnouncementAt!
                );
            });

        setActiveAnnouncementsParsedData(
            getAnouncementsParsedData(activeAnnouncement)
        );
        setPastAnnouncementsParsedData(
            getAnouncementsParsedData(pastAnnouncement)
        );
    }, [isLoading]);

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    return (
        <Page
            title="Announcements"
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
            ]}
        >
            {activeAnnounementsParsedData?.items &&
            activeAnnounementsParsedData?.items.length > 0 ? (
                <div>
                    <Section title="Active Announcements" />

                    <EventHistoryList
                        items={activeAnnounementsParsedData?.items || []}
                    />
                </div>
            ) : (
                <></>
            )}

            {pastAnnouncementsParsedData?.items &&
            pastAnnouncementsParsedData?.items.length > 0 ? (
                <div>
                    <Section title="Past Announcements" />
                    <EventHistoryList
                        items={pastAnnouncementsParsedData?.items || []}
                    />
                </div>
            ) : (
                <></>
            )}

            {announcements.length === 0 ? (
                <EmptyState
                    id="announcements-empty-state"
                    title={'No Announcements'}
                    description={'No announcements posted so far on this page.'}
                    icon={IconProp.Announcement}
                />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Overview;
