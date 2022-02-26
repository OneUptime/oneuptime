import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Translate } from 'react-auto-translate';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import Events from './Events';
import ShouldRender from './ShouldRender';
import {
    fetchMorePastEvents,
    fetchPastEvents,
    showEventCard,
} from '../actions/status';

class PastEvent extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.getAll = this.getAll.bind(this);
        this.more = this.more.bind(this);
    }

    getAll = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showEventCard' does not exist on type 'R... Remove this comment to see the full error message
        this.props.showEventCard(true);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchPastEvents' does not exist on type ... Remove this comment to see the full error message
        this.props.fetchPastEvents(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageSlug' does not exist on type '... Remove this comment to see the full error message
            this.props.statusPageSlug,
            0
        );
    };

    more = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMorePastEvents' does not exist on t... Remove this comment to see the full error message
        this.props.fetchMorePastEvents(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageSlug' does not exist on type '... Remove this comment to see the full error message
            this.props.statusPageSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        if (this.props.statusPage) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            const colors = this.props.statusPage.colors;
            contentBackground = {
                background: `rgba(${colors.statusPageBackground.r}, ${colors.statusPageBackground.g}, ${colors.statusPageBackground.b}, ${colors.statusPageBackground.a})`,
            };
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'color' does not exist on type '{}'.
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
        if (this.props.pastEvents && this.props.pastEvents.events) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'Element' is not assignable to type 'string'.
            event = (
                <Events
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                    events={this.props.pastEvents.events}
                    secondaryTextColor={secondaryTextColor}
                    primaryTextColor={primaryTextColor}
                    noteBackgroundColor={noteBackgroundColor}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageId' does not exist on type 'Re... Remove this comment to see the full error message
                    statusPageId={this.props.statusPageId}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageSlug' does not exist on type '... Remove this comment to see the full error message
                    statusPageSlug={this.props.statusPageSlug}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
                    monitorState={this.props.monitorState}
                />
            );
        }

        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
            this.props.individualEvents.show &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
            this.props.individualEvents.events
        ) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'Element' is not assignable to type 'string'.
            event = (
                <Events
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
                    events={this.props.individualEvents.events}
                    secondaryTextColor={secondaryTextColor}
                    primaryTextColor={primaryTextColor}
                    noteBackgroundColor={noteBackgroundColor}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageId' does not exist on type 'Re... Remove this comment to see the full error message
                    statusPageId={this.props.statusPageId}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageSlug' does not exist on type '... Remove this comment to see the full error message
                    statusPageSlug={this.props.statusPageSlug}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
                    monitorState={this.props.monitorState}
                />
            );
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
        return (!this.props.individualEvents.show &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.pastEvents.events.length > 0) ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
            this.props.individualEvents.show ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showEventCardState' does not exist on ty... Remove this comment to see the full error message
            this.props.showEventCardState ? (
            <div
                id="scheduledEvents"
                className="twitter-feed white box"
                style={{ overflow: 'visible', ...contentBackground }}
            >
                <div className="messages" style={{ position: 'relative' }}>
                    <ShouldRender
                        if={
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                            this.props.pastEvents &&
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
                                    if={this.props.individualEvents.show}
                                >
                                    <span
                                        className="feed-title"
                                        style={primaryTextColor}
                                    >
                                        <Translate>
                                            Scheduled Events for{' '}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
                                            {this.props.individualEvents
                                                .monitorName
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
                                                ? this.props.individualEvents
                                                      .monitorName
                                                : ''}{' '}
                                            on{' '}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
                                            {this.props.individualEvents.date
                                                ? moment(
                                                      this.props
                                                          // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
                                                          .individualEvents.date
                                                  ).format('LL')
                                                : ''}
                                        </Translate>
                                    </span>
                                </ShouldRender>
                            </div>
                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
                                    (!this.props.individualEvents.show &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                                        this.props.pastEvents.events.length >
                                            0) ||
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
                                    (this.props.individualEvents.show &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
                                        this.props.individualEvents.events
                                            .length > 0)
                                }
                            >
                                <ul className="feed-contents plain">{event}</ul>
                            </ShouldRender>
                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
                                    this.props.individualEvents.show &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'showEventCardState' does not exist on ty... Remove this comment to see the full error message
                                    this.props.showEventCardState &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                                    this.props.pastEvents.events.length === 0 &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
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
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                                this.props.pastEvents &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                                this.props.pastEvents.events &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                                this.props.pastEvents.events.length &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                this.props.count >
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                                    this.props.pastEvents.events.length &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                                !this.props.pastEvents.requesting &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestingmoreevents' does not exist on ... Remove this comment to see the full error message
                                !this.props.requestingmoreevents &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                                !this.props.pastEvents.error &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                                    this.props.pastEvents &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                                    !this.props.pastEvents.error &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                                    !this.props.pastEvents.requesting &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualEvents' does not exist on type... Remove this comment to see the full error message
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
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'pastEvents' does not exist on type 'Read... Remove this comment to see the full error message
                                this.props.pastEvents.requesting ||
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestingmoreevents' does not exist on ... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        fetchMorePastEvents,
        fetchPastEvents,
        showEventCard,
    },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
