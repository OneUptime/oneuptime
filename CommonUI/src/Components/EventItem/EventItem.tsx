import Route from 'Common/Types/API/Route';
import { Blue } from 'Common/Types/BrandColors';
import OneUptimeDate from 'Common/Types/Date';
import React, { FunctionComponent, ReactElement } from 'react';
import Link from '../Link/Link';
import URL from 'Common/Types/API/URL';

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
}

const EventItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            <div
                className="active-event-box-body"
                style={{ marginBottom: '0px', paddingBottom: '0px' }}
            >
                <h2 className="active-event-box-body-title">
                    {props.eventTitle}
                </h2>
                {props.eventDescription && (
                    <p className="active-event-box-body-description">
                        {props.eventDescription}
                    </p>
                )}
                {props.eventMiniDescription && (
                    <p className="small active-event-box-body-description">
                        {props.eventMiniDescription}
                    </p>
                )}
            </div>
            <div
                className="active-event-box-body"
                style={{ marginTop: '0px', paddingTop: '0px' }}
            >
                {props.eventResourcesAffected &&
                props.eventResourcesAffected?.length > 0 ? (
                    <div key={0} className="active-event-box-body-description">
                        {' '}
                        <span
                            style={{
                                fontWeight: 400,
                            }}
                        >
                            <b>Resources Affected</b> -{' '}
                            {props.eventResourcesAffected?.join(',')}
                        </span>{' '}
                    </div>
                ) : (
                    <></>
                )}

                {props.eventTimeline &&
                    props.eventTimeline.map((item: TimelineItem, i: number) => {
                        return (
                            <div
                                key={i + 1}
                                className="active-event-box-body-description"
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

                <div className="active-event-box-body-timestamp">
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
