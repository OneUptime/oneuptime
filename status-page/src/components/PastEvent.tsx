import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { Translate } from 'react-auto-translate';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import Events from './Events';
import ShouldRender from './ShouldRender';
import {
    fetchMorePastEvents,
    fetchPastEvents,
    showEventCard,
} from '../actions/status';

interface PastEventProps {
    fetchMorePastEvents?: Function;
    requestingmoreevents?: boolean;
    projectId?: string;
    skip?: number;
    count?: number;
    statusPageId?: string;
    statusPageSlug?: string;
    statusPage?: object;
    fetchPastEvents?: Function;
    pastEvents?: object;
    individualEvents?: object;
    monitorState?: unknown[];
    showEventCardState?: boolean;
    showEventCard?: Function;
}

class PastEvent extends Component<PastEventProps> {
    constructor(props: $TSFixMe) {
        super(props);

        this.getAll = this.getAll.bind(this);
        this.more = this.more.bind(this);
    }

    getAll = () => {

        this.props.showEventCard(true);

        this.props.fetchPastEvents(

            this.props.projectId,

            this.props.statusPageSlug,
            0
        );
    };

    more = () => {

        this.props.fetchMorePastEvents(

            this.props.projectId,

            this.props.statusPageSlug,

            this.props.skip + 1
        );
    };

    render() {
        let event = '';
        let contentBackground,
            primaryTextColor,
            secondaryTextColor,
            noteBackgroundColor;
        const subheading = {};

        if (this.props.statusPage) {

            const colors = this.props.statusPage.colors;
            contentBackground = {
                background: `rgba(${colors.statusPageBackground.r}, ${colors.statusPageBackground.g}, ${colors.statusPageBackground.b}, ${colors.statusPageBackground.a})`,
            };

            subheading.color = `rgba(${colors.subheading.r}, ${colors.subheading.g}, ${colors.subheading.b}, ${colors.subheading.a})`;
            primaryTextColor = {
                color: `rgba(${colors.primaryText.r}, ${colors.primaryText.g}, ${colors.primaryText.b}, ${colors.primaryText.a})`,
            };
            secondaryTextColor = {
                color: `rgba(${colors.secondaryText.r}, ${colors.secondaryText.g}, ${colors.secondaryText.b}, ${colors.secondaryText.a})`,
            };
            noteBackgroundColor = {
                background: `rgba(${colors.noteBackground.r}, ${colors.noteBackground.g}, ${colors.noteBackground.b})`,
            };
        }

        if (this.props.pastEvents && this.props.pastEvents.events) {

            event = (
                <Events

                    events={this.props.pastEvents.events}
                    secondaryTextColor={secondaryTextColor}
                    primaryTextColor={primaryTextColor}
                    noteBackgroundColor={noteBackgroundColor}

                    statusPageId={this.props.statusPageId}

                    statusPageSlug={this.props.statusPageSlug}

                    monitorState={this.props.monitorState}
                />
            );
        }

        if (

            this.props.individualEvents.show &&

            this.props.individualEvents.events
        ) {

            event = (
                <Events

                    events={this.props.individualEvents.events}
                    secondaryTextColor={secondaryTextColor}
                    primaryTextColor={primaryTextColor}
                    noteBackgroundColor={noteBackgroundColor}

                    statusPageId={this.props.statusPageId}

                    statusPageSlug={this.props.statusPageSlug}

                    monitorState={this.props.monitorState}
                />
            );
        }


        return (!this.props.individualEvents.show &&

            this.props.pastEvents.events.length > 0) ||

            this.props.individualEvents.show ||

            this.props.showEventCardState ? (
            <div
                id="scheduledEvents"
                className="twitter-feed white box"
                style={{ overflow: 'visible', ...contentBackground }}
            >
                <div className="messages" style={{ position: 'relative' }}>
                    <ShouldRender
                        if={

                            this.props.pastEvents &&

                            !this.props.pastEvents.error
                        }
                    >
                        <div
                            className="box-inner"
                            style={{
                                paddingLeft: 0,
                                paddingRight: 0,
                                width: '100%',
                            }}
                        >
                            <div className="feed-header">
                                <ShouldRender

                                    if={!this.props.individualEvents.show}
                                >
                                    <span
                                        className="feed-title"
                                        style={subheading}
                                    >
                                        <Translate>
                                            Scheduled Events Completed
                                        </Translate>
                                    </span>
                                </ShouldRender>
                                <ShouldRender

                                    if={this.props.individualEvents.show}
                                >
                                    <span
                                        className="feed-title"
                                        style={primaryTextColor}
                                    >
                                        <Translate>
                                            Scheduled Events for{' '}

                                            {this.props.individualEvents
                                                .monitorName

                                                ? this.props.individualEvents
                                                    .monitorName
                                                : ''}{' '}
                                            on{' '}

                                            {this.props.individualEvents.date
                                                ? moment(
                                                    this.props

                                                        .individualEvents.date
                                                ).format('LL')
                                                : ''}
                                        </Translate>
                                    </span>
                                </ShouldRender>
                            </div>
                            <ShouldRender
                                if={

                                    (!this.props.individualEvents.show &&

                                        this.props.pastEvents.events.length >
                                        0) ||

                                    (this.props.individualEvents.show &&

                                        this.props.individualEvents.events
                                            .length > 0)
                                }
                            >
                                <ul className="feed-contents plain">{event}</ul>
                            </ShouldRender>
                            <ShouldRender
                                if={

                                    this.props.individualEvents.show &&

                                    this.props.individualEvents.events
                                        .length === 0
                                }
                            >
                                <ul className="feed-contents plain">
                                    <li
                                        className="feed-item clearfix"
                                        style={{
                                            minHeight: '5px',
                                            marginBottom: '10px',
                                            display: 'flex',
                                            flexDirection: 'row',
                                            flexWrap: 'nowrap',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <span
                                            className="time"
                                            style={{
                                                fontSize: '0.8em',
                                                marginLeft: '0px',
                                                ...secondaryTextColor,
                                            }}
                                        >
                                            <Translate>
                                                No data available for this date.
                                            </Translate>
                                        </span>
                                    </li>
                                </ul>
                            </ShouldRender>
                            <ShouldRender
                                if={

                                    this.props.showEventCardState &&

                                    this.props.pastEvents.events.length === 0 &&

                                    this.props.individualEvents.events
                                        .length === 0
                                }
                            >
                                <ul className="feed-contents plain">
                                    <li
                                        className="feed-item clearfix"
                                        style={{
                                            minHeight: '5px',
                                            marginBottom: '10px',
                                            display: 'flex',
                                            flexDirection: 'row',
                                            flexWrap: 'nowrap',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <span
                                            className="time"
                                            style={{
                                                fontSize: '0.8em',
                                                marginLeft: '0px',
                                                ...secondaryTextColor,
                                            }}
                                        >
                                            <Translate>
                                                No Scheduled Events
                                            </Translate>
                                        </span>
                                    </li>
                                </ul>
                            </ShouldRender>
                        </div>

                        <ShouldRender
                            if={

                                this.props.pastEvents &&

                                this.props.pastEvents.events &&

                                this.props.pastEvents.events.length &&

                                this.props.count >

                                this.props.pastEvents.events.length &&

                                !this.props.pastEvents.requesting &&

                                !this.props.requestingmoreevents &&

                                !this.props.pastEvents.error &&

                                !this.props.individualEvents.show
                            }
                        >
                            <button
                                className="more button-as-anchor anchor-centered"
                                onClick={() => this.more()}
                            >
                                <Translate>More</Translate>
                            </button>
                        </ShouldRender>

                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                            }}
                        >
                            <ShouldRender
                                if={

                                    this.props.pastEvents &&

                                    !this.props.pastEvents.error &&

                                    !this.props.pastEvents.requesting &&

                                    this.props.individualEvents.show
                                }
                            >
                                <button
                                    className="all__btn"
                                    onClick={() => this.getAll()}
                                >
                                    <Translate>All Scheduled Events</Translate>
                                </button>
                            </ShouldRender>
                        </div>

                        <ShouldRender
                            if={

                                this.props.pastEvents.requesting ||

                                this.props.requestingmoreevents
                            }
                        >
                            <div className="ball-beat" id="notes-loader">
                                <div
                                    style={{ height: '12px', width: '12px' }}
                                ></div>
                                <div
                                    style={{ height: '12px', width: '12px' }}
                                ></div>
                                <div
                                    style={{ height: '12px', width: '12px' }}
                                ></div>
                            </div>
                        </ShouldRender>
                    </ShouldRender>
                </div>
            </div>
        ) : null;
    }
}


PastEvent.displayName = 'PastEvent';

const mapStateToProps = (state: $TSFixMe) => {
    let skip =
        state.status.pastEvents && state.status.pastEvents.skip
            ? state.status.pastEvents.skip
            : 0;
    let count =
        state.status.pastEvents && state.status.pastEvents.count
            ? state.status.pastEvents.count
            : 0;
    if (typeof skip === 'string') {
        skip = parseInt(skip, 10);
    }
    if (typeof count === 'string') {
        count = parseInt(count, 10);
    }

    return {
        requestingmoreevents: state.status.morePastEvents.requesting,
        skip,
        count,
        statusPage: state.status.statusPage,
        pastEvents: state.status.pastEvents,
        individualEvents: state.status.individualEvents,
        monitorState: state.status.statusPage.monitorsData,
        showEventCardState: state.status.showEventCard,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        fetchMorePastEvents,
        fetchPastEvents,
        showEventCard,
    },
    dispatch
);


PastEvent.propTypes = {
    fetchMorePastEvents: PropTypes.func,
    requestingmoreevents: PropTypes.bool,
    projectId: PropTypes.string,
    skip: PropTypes.number,
    count: PropTypes.number,
    statusPageId: PropTypes.string,
    statusPageSlug: PropTypes.string,
    statusPage: PropTypes.object,
    fetchPastEvents: PropTypes.func,
    pastEvents: PropTypes.object,
    individualEvents: PropTypes.object,
    monitorState: PropTypes.array,
    showEventCardState: PropTypes.bool,
    showEventCard: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(PastEvent);
