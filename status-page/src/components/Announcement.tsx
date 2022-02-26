import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Translate } from 'react-auto-translate';
import PropTypes from 'prop-types';
import { getAnnouncements } from '../actions/status';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { handleResources } from '../config';
import ShouldRender from './ShouldRender';
import Markdown from 'markdown-to-jsx';
//import { translate } from '../config';
class Announcement extends Component {
    announcement: $TSFixMe;
    counter: $TSFixMe;
    limit: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        this.limit = 2;
        this.counter = 2;
        this.announcement = '';
    }

    handleRouting = (announcementSlug: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'history' does not exist on type 'Readonl... Remove this comment to see the full error message
            history,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            statusPage: { slug },
        } = this.props;
        history.push(`/status-page/${slug}/announcement/${announcementSlug}`);
    };

    addMore = async () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getAnnouncements' does not exist on type... Remove this comment to see the full error message
            getAnnouncements,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            statusPage: { projectId, _id },
        } = this.props;
        this.limit += this.counter;
        await getAnnouncements(projectId._id, _id, 0, this.limit);
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'announcement' does not exist on type 'Re... Remove this comment to see the full error message
        const { announcement, monitorState } = this.props;
        return (
            <>
                {announcement && (
                    <>
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'theme' does not exist on type 'Readonly<... Remove this comment to see the full error message
                        {this.props.theme ? (
                            <div
                                className="clean_ann"
                                onClick={e => {
                                    e.preventDefault();
                                    this.handleRouting(announcement.slug);
                                }}
                            >
                                <span className="ann_header">{}</span>
                                <AnnouncementBox
                                    announcement={announcement}
                                    monitorState={monitorState}
                                />
                            </div>
                        ) : (
                            <div
                                className="announcement_classic"
                                onClick={e => {
                                    e.preventDefault();
                                    this.handleRouting(announcement.slug);
                                }}
                            >
                                <div className="ann_header classic_header">
                                    <Translate>ANNOUNCEMENT</Translate>
                                </div>
                                <AnnouncementBox
                                    announcement={announcement}
                                    monitorState={monitorState}
                                    type={true}
                                />
                            </div>
                        )}
                    </>
                )}
            </>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Announcement.displayName = 'Announcement';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Announcement.propTypes = {
    theme: PropTypes.string,
    getAnnouncements: PropTypes.func,
    statusPage: PropTypes.object,
    announcement: PropTypes.object,
    monitorState: PropTypes.array,
    history: PropTypes.object,
    //language: PropTypes.object,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        statusPage: state.status.statusPage,
        language: state.status.language,
        announcement:
            state.status.announcements.list.allAnnouncements &&
            state.status.announcements.list.allAnnouncements.length > 0 &&
            state.status.announcements.list.allAnnouncements[0],
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ getAnnouncements }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(Announcement);

function AnnouncementBox({
    announcement,
    monitorState,
    type
}: $TSFixMe) {
    return <>
        <div className="icon_ann">
            <div className={type ? 'ann_title classic_font' : 'ann_title'}>
                {announcement.name}
            </div>
        </div>
        <div className="ann_desc" style={{ whiteSpace: 'pre-wrap' }}>
            {announcement?.description &&
                announcement.description.split('\n').map((elem: $TSFixMe, index: $TSFixMe) => (
                    <Markdown
                        key={`${elem}-${index}`}
                        options={{
                            forceBlock: true,
                        }}
                    >
                        {elem}
                    </Markdown>
                ))}
        </div>
        <ShouldRender if={announcement.monitors.length > 0}>
            <div className={'resources_aff'}>
                <span className={type && 'classic_font'}>
                    <Translate>Resources Affected: </Translate>
                </span>
                <span>
                    {' '}
                    {announcement &&
                        handleResources(monitorState, announcement)}
                </span>
            </div>
        </ShouldRender>
        <div className="ongoing__schedulebox classic_icon_x">
            <span className="sp__icon sp__icon--more"></span>
        </div>
    </>;
}

AnnouncementBox.propTypes = {
    announcement: PropTypes.object,
    monitorState: PropTypes.array,
    type: PropTypes.bool,
};

AnnouncementBox.displayName = 'AnnouncementBox';
