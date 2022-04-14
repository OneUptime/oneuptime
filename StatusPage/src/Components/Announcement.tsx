import React, { Component } from 'react';

import { Translate } from 'react-auto-translate';
import PropTypes from 'prop-types';
import { getAnnouncements } from '../actions/status';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { handleResources } from '../config';
import ShouldRender from './ShouldRender';
import Markdown from 'markdown-to-jsx';

interface AnnouncementProps {
    theme?: string;
    getAnnouncements?: Function;
    statusPage?: object;
    announcement?: object;
    monitorState?: unknown[];
    history?: object;
}

//import { translate } from '../config';
class Announcement extends Component<ComponentProps> {
    announcement: $TSFixMe;
    counter: $TSFixMe;
    limit: PositiveNumber;
    constructor(props: $TSFixMe) {
        super(props);
        this.limit = 2;
        this.counter = 2;
        this.announcement = '';
    }

    handleRouting = (announcementSlug: $TSFixMe) => {
        const {

            history,

            statusPage: { slug },
        } = this.props;
        history.push(`/StatusPage/${slug}/announcement/${announcementSlug}`);
    };

    addMore = async () => {
        const {

            getAnnouncements,

            statusPage: { projectId, _id },
        } = this.props;
        this.limit += this.counter;
        await getAnnouncements(projectId._id, _id, 0, this.limit);
    };

    override render() {

        const { announcement, monitorState } = this.props;
        return (
            <>
                {announcement && (
                    <>

                        {this.props.theme ? (
                            <div
                                className="clean_ann"
                                onClick={e => {
                                    e.preventDefault();
                                    this.handleRouting(announcement.slug);
                                }}
                            >
                                <span className="ann_header">{ }</span>
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


Announcement.displayName = 'Announcement';


Announcement.propTypes = {
    theme: PropTypes.string,
    getAnnouncements: PropTypes.func,
    statusPage: PropTypes.object,
    announcement: PropTypes.object,
    monitorState: PropTypes.array,
    history: PropTypes.object,
    //language: PropTypes.object,
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        statusPage: state.status.statusPage,
        language: state.status.language,
        announcement:
            state.status.announcements.list.allAnnouncements &&
            state.status.announcements.list.allAnnouncements.length > 0 &&
            state.status.announcements.list.allAnnouncements[0],
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ getAnnouncements }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(Announcement);

interface AnnouncementBoxProps {
    announcement?: object;
    monitorState?: unknown[];
    type?: boolean;
}

function AnnouncementBox({
    announcement,
    monitorState,
    type
}: AnnouncementBoxProps) {
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
