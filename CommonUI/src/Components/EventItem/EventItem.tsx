import Route from 'Common/Types/API/Route';
import { Blue, VeryLightGrey } from 'Common/Types/BrandColors';
import OneUptimeDate from 'Common/Types/Date';
import React, { FunctionComponent, ReactElement } from 'react';
import Link from '../Link/Link';
import URL from 'Common/Types/API/URL';
import Color from 'Common/Types/Color';
import Pill from '../Pill/Pill';

export interface TimelineItem {
    date: Date;
    text: string | ReactElement;
    isBold?: boolean | undefined;
}
export interface ComponentProps {
    eventTitle: string;
    eventResourcesAffected?: Array<string> | undefined;
    eventDescription?: string | undefined;
    eventTimeline: Array<TimelineItem>;
    eventMiniDescription?: string | undefined;
    eventType: string;
    eventViewRoute?: Route | URL | undefined;
    footerEventStatus?: string | undefined;
    footerDateTime?: Date | undefined;
    isDetailItem: boolean;
    currentStatus?: string;
    currentStatusColor?: Color;
    anotherStatus?: string | undefined;
    anotherStatusColor?: Color | undefined;
    dateTime?: Date | undefined
}

const EventItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className='mt-5 mb-5 bg-white shadow rounded-xl border-gray-100 p-5'>
            <div>
                <div className='flex space-x-1'>
                    {props.currentStatus && props.currentStatusColor && (
                        <div>
                            <Pill
                                text={props.currentStatus}
                                color={props.currentStatusColor}
                            />
                        </div>
                    )}
                    {props.anotherStatus && props.anotherStatusColor && (
                        <div>
                            <Pill
                                text={props.anotherStatus}
                                color={props.anotherStatusColor}
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
                    <p

                        className="mt-0 text-gray-400 text-sm"
                    >
                        {props.eventDescription}
                    </p>

                )}

                {props.dateTime && (
                    <p

                        className="mt-3 text-gray-500 text-sm"
                    >
                        {OneUptimeDate.getDateAsLocalFormattedString(props.dateTime)}
                    </p>

                )}

                {props.eventMiniDescription && (
                    <p
                        className="mt-3 text-gray-400 text-sm"
                    >
                        {props.eventMiniDescription}
                    </p>
                )}
            </div>
            <div

            >

                <div className="w-full border-t border-gray-200 mt-5 mb-5 -ml-5 -mr-5 -pr-5"></div>

                {props.eventResourcesAffected &&
                    props.eventResourcesAffected?.length > 0 ? (
                    <div
                        key={0}
                    >

                        <div className='flex space-x-1'>
                            <div className='text-sm text-gray-400 mr-3 mt-1'>Affected resources</div>
                            {props.eventResourcesAffected?.map((item) => {
                                return <Pill text={item} color={VeryLightGrey} style={{
                                    backgroundColor: "#f3f4f6",
                                    color: "#9ca3af"
                                }} />
                            })}
                        </div>
                    </div>
                ) : (
                    <></>
                )}
                <div className="w-full border-t border-gray-200 mt-5 mb-5 -ml-5 -mr-5 -pr-5"></div>
                {props.eventTimeline &&
                    props.eventTimeline.map((item: TimelineItem, i: number) => {
                        return (
                            <div
                                key={i + 1}
                                className="active-event-box-body-description"
                                style={{ marginTop: '10px' }}
                            >
                                {' '}
                                <span
                                    style={{
                                        fontWeight: item.isBold ? 500 : 400,
                                    }}
                                >
                                    {item.text}
                                </span>{' '}
                                <span className="color-grey">
                                    {' '}
                                    -{' '}
                                    {`${OneUptimeDate.getDateAsFormattedString(
                                        item.date
                                    )}.`}
                                </span>{' '}
                            </div>
                        );
                    })}

                <div
                    className="active-event-box-body-timestamp"
                    style={{ marginTop: '10px' }}
                >
                    {props.footerEventStatus && props.footerDateTime ? (
                        <span>
                            {props.footerEventStatus} at{' '}
                            {OneUptimeDate.getDateAsLocalFormattedString(
                                props.footerDateTime,
                                false
                            )}
                            .{' '}
                        </span>
                    ) : (
                        <></>
                    )}

                    {props.eventViewRoute ? (
                        <span>
                            <Link
                                className="underline pointer"
                                to={props.eventViewRoute}
                                style={{
                                    color: Blue.toString(),
                                }}
                            >
                                <>{props.eventType} Details</>
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
