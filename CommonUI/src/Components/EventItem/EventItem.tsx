import Route from 'Common/Types/API/Route';
import { VeryLightGrey } from 'Common/Types/BrandColors';
import OneUptimeDate from 'Common/Types/Date';
import React, { FunctionComponent, ReactElement } from 'react';
import Link from '../Link/Link';
import URL from 'Common/Types/API/URL';
import Color from 'Common/Types/Color';
import Pill from '../Pill/Pill';
import BaseModel from 'Common/Models/BaseModel';
import Icon from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import MarkdownViewer from '../Markdown.tsx/MarkdownViewer';

export enum TimelineItemType {
    StateChange = 'StateChange',
    Note = 'Note',
}

export interface TimelineItem {
    date: Date;
    note?: string;
    type: TimelineItemType;
    state?: BaseModel;
    icon: IconProp;
    iconColor: Color;
}

export interface ComponentProps {
    eventTitle: string;
    eventResourcesAffected?: Array<string> | undefined;
    eventDescription?: string | undefined;
    eventTimeline: Array<TimelineItem>;
    eventMiniDescription?: string | undefined;
    eventTypeColor: Color;
    eventType: string;
    eventViewRoute?: Route | URL | undefined;
    isDetailItem: boolean;
    currentStatus?: string;
    currentStatusColor?: Color;
    anotherStatus?: string | undefined;
    anotherStatusColor?: Color | undefined;
    eventSecondDescription: string;
}

const EventItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mt-5 mb-5 bg-white shadow rounded-xl border-gray-100 p-5">
            <div>
                <div className="flex space-x-1">
                    <div>
                        <Pill
                            key={1}
                            text={props.eventType}
                            color={props.eventTypeColor}
                            isMinimal={true}
                        />
                    </div>
                    {props.currentStatus && props.currentStatusColor && (
                        <div>
                            <Pill
                                key={2}
                                text={props.currentStatus}
                                color={props.currentStatusColor}
                                isMinimal={true}
                            />
                        </div>
                    )}
                    {props.anotherStatus && props.anotherStatusColor && (
                        <div>
                            <Pill
                                key={3}
                                text={props.anotherStatus}
                                color={props.anotherStatusColor}
                                isMinimal={true}
                            />
                        </div>
                    )}
                </div>
                <div className="mt-5">
                    <h2
                        className="active-event-box-body-title"
                        style={{
                            fontSize: props.isDetailItem ? '20px' : '16px',
                        }}
                    >
                        {props.eventTitle}
                    </h2>
                </div>
                {props.eventDescription && (
                    <p className="mt-0 text-gray-400 text-sm">
                        {props.eventDescription}
                    </p>
                )}

                {props.eventSecondDescription && (
                    <p className="mt-3 text-gray-500 text-sm">
                        {props.eventSecondDescription}
                    </p>
                )}

                {props.eventMiniDescription && (
                    <p className="mt-3 text-gray-400 text-sm">
                        {props.eventMiniDescription}
                    </p>
                )}
            </div>
            <div>
                {props.eventResourcesAffected &&
                    props.eventResourcesAffected?.length > 0 && (
                        <div
                            className="w-full border-t border-gray-200 mt-5 mb-5 -ml-5 -mr-5 -pr-5"
                            style={{ width: 'calc(100% + 2.5em)' }}
                        ></div>
                    )}

                {props.eventResourcesAffected &&
                props.eventResourcesAffected?.length > 0 ? (
                    <div key={0}>
                        <div className="flex space-x-1">
                            <div className="text-sm text-gray-400 mr-3 mt-1">
                                Affected resources
                            </div>
                            {props.eventResourcesAffected?.map(
                                (item: string, i: number) => {
                                    return (
                                        <Pill
                                            key={i}
                                            text={item}
                                            color={VeryLightGrey}
                                            style={{
                                                backgroundColor: '#f3f4f6',
                                                color: '#9ca3af',
                                            }}
                                        />
                                    );
                                }
                            )}
                        </div>
                    </div>
                ) : (
                    <></>
                )}

                {props.eventTimeline && props.eventTimeline.length > 0 && (
                    <div
                        className={`w-full border-t border-gray-200 mt-5 -ml-5 ${
                            props.eventTimeline &&
                            props.eventTimeline.length > 0
                                ? 'mb-5'
                                : 'mb-0'
                        } -mr-5 -pr-5`}
                        style={{ width: 'calc(100% + 2.5em)' }}
                    ></div>
                )}

                <div className="flow-root">
                    <ul role="list" className="-mb-8">
                        {props.eventTimeline &&
                            props.eventTimeline.map(
                                (item: TimelineItem, i: number) => {
                                    if (
                                        item.type ===
                                        TimelineItemType.StateChange
                                    ) {
                                        return (
                                            <li key={i}>
                                                <div className="relative pb-8">
                                                    {i !==
                                                        props.eventTimeline
                                                            .length -
                                                            1 && (
                                                        <span
                                                            className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-gray-200"
                                                            aria-hidden="true"
                                                        ></span>
                                                    )}
                                                    <div className="relative flex items-start space-x-3">
                                                        <div>
                                                            <div className="relative px-1">
                                                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 ring-8 ring-white">
                                                                    <Icon
                                                                        icon={
                                                                            item.icon
                                                                        }
                                                                        className="h-5 w-5 text-gray-500"
                                                                        style={{
                                                                            color: item.iconColor.toString(),
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="min-w-0 flex-1 py-0">
                                                            <div className="text-sm leading-8 text-gray-500">
                                                                <span className="mr-2">
                                                                    <span className="font-medium text-gray-900 mr-1">
                                                                        {
                                                                            props.eventType
                                                                        }
                                                                    </span>
                                                                    state
                                                                    changed to
                                                                </span>
                                                                <span className="mr-1">
                                                                    <Pill
                                                                        text={
                                                                            item.state?.getColumnValue(
                                                                                'name'
                                                                            ) as string
                                                                        }
                                                                        color={
                                                                            item.state?.getColumnValue(
                                                                                'color'
                                                                            ) as Color
                                                                        }
                                                                        isMinimal={
                                                                            true
                                                                        }
                                                                    />
                                                                </span>
                                                            </div>
                                                            <div>
                                                                <span className="text-sm leading-8 text-gray-500 whitespace-nowrap">
                                                                    {OneUptimeDate.getDateAsLocalFormattedString(
                                                                        item.date
                                                                    )}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </li>
                                        );
                                    }

                                    if (item.type === TimelineItemType.Note) {
                                        return (
                                            <li key={i}>
                                                <div className="relative pb-8">
                                                    {i !==
                                                        props.eventTimeline
                                                            .length -
                                                            1 && (
                                                        <span
                                                            className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-gray-200"
                                                            aria-hidden="true"
                                                        ></span>
                                                    )}
                                                    <div className="relative flex items-start space-x-3">
                                                        <div>
                                                            <div className="relative px-1">
                                                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 ring-8 ring-white">
                                                                    <Icon
                                                                        icon={
                                                                            item.icon
                                                                        }
                                                                        className="h-5 w-5 text-gray-500"
                                                                        style={{
                                                                            color: item.iconColor.toString(),
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div>
                                                                <div className="text-sm">
                                                                    <span className="font-medium text-gray-900">
                                                                        Update
                                                                        to this{' '}
                                                                        {
                                                                            props.eventType
                                                                        }
                                                                    </span>
                                                                </div>
                                                                <p className="mt-0.5 text-sm text-gray-500">
                                                                    posted on{' '}
                                                                    {OneUptimeDate.getDateAsLocalFormattedString(
                                                                        item.date
                                                                    )}
                                                                </p>
                                                            </div>
                                                            <div className="mt-2 text-sm text-gray-700">
                                                                <p>
                                                                    <MarkdownViewer
                                                                        text={
                                                                            item.note ||
                                                                            ''
                                                                        }
                                                                    />
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </li>
                                        );
                                    }

                                    return <></>;
                                }
                            )}
                    </ul>
                </div>

                {props.eventViewRoute && (
                    <div
                        className="w-full border-t border-gray-200 mt-5 mb-5 -ml-5 -mr-5 -pr-5"
                        style={{ width: 'calc(100% + 2.5em)' }}
                    ></div>
                )}

                <div className="active-event-box-body-timestamp mt-5 flex justify-end">
                    {props.eventViewRoute ? (
                        <span>
                            <Link
                                className="cursor-pointer text-gray-400 hover:text-gray-500 text-sm"
                                to={props.eventViewRoute}
                            >
                                <>View {props.eventType}</>
                            </Link>
                        </span>
                    ) : (
                        <></>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EventItem;
