import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { fetchExternalStatusPages } from '../actions/status';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import moment from 'moment';
import ShouldRender from './ShouldRender';

class ExternalStatusPages extends Component {
    componentDidMount() {
        this.props.fetchExternalStatusPages(
            this.props.statusPage.projectId._id,
            this.props.statusPage._id
        );
    }
    render() {
        const { externalStatusPages, theme } = this.props;

        return (
            <div>
                {theme && theme === 'Clean Theme' && (
                    <div
                        className="box-inner"
                        style={{
                            paddingLeft: 0,
                            paddingRight: 0,
                            width: '100%',
                        }}
                    >
                        {externalStatusPages?.externalStatusPagesList?.map(
                            (link, i) => {
                                return (
                                    <div key={i}>
                                        <div className="date-big">
                                            {moment(link.createdAt).format(
                                                'LL'
                                            )}
                                        </div>
                                        <div className="list_k">
                                            <b> {link.name} </b>
                                        </div>
                                        <div className="incident_desc">
                                            {link.url}
                                        </div>
                                    </div>
                                );
                            }
                        )}
                        <ShouldRender
                            if={
                                externalStatusPages &&
                                externalStatusPages.externalStatusPagesList &&
                                externalStatusPages.externalStatusPagesList
                                    .length === 0
                            }
                        >
                            {' '}
                            <div className="nt_list">
                                You don&#39;t have any external status page.
                            </div>
                        </ShouldRender>
                    </div>
                )}
                {theme && theme === 'Classic Theme' && (
                    <div
                        className="twitter-feed white box"
                        style={{
                            overflow: 'visible',
                        }}
                    >
                        <div
                            className="messages"
                            style={{ position: 'relative' }}
                        >
                            <div
                                className="box-inner"
                                style={{
                                    paddingLeft: 0,
                                    paddingRight: 0,
                                    width: '100%',
                                }}
                            >
                                <div
                                    className="feed-header"
                                    style={{ display: 'block' }}
                                >
                                    <div className="feed-title">
                                        {' '}
                                        External Status Pages
                                    </div>
                                    <ul className="feed-contents plain">
                                        {externalStatusPages?.externalStatusPagesList?.map(
                                            (link, i) => {
                                                return (
                                                    <li
                                                        key={i}
                                                        className="incidentlist feed-item clearfix"
                                                        style={{
                                                            margin: '0 0 10px',
                                                            cursor: 'text',
                                                        }}
                                                    >
                                                        <div
                                                            className="ct_header"
                                                            style={{
                                                                marginBottom:
                                                                    '5px',
                                                            }}
                                                        >
                                                            <b> {link.name} </b>
                                                        </div>
                                                        <div
                                                            className="ct_desc"
                                                            style={{
                                                                marginBottom:
                                                                    '5px',
                                                            }}
                                                        >
                                                            {link.url}
                                                        </div>
                                                        <div
                                                            className="ct_time time"
                                                            style={{
                                                                fontSize:
                                                                    '11px',
                                                            }}
                                                        >
                                                            {moment(
                                                                link.createdAt
                                                            ).format(
                                                                'MMMM Do YYYY, h:mm a'
                                                            )}
                                                        </div>
                                                    </li>
                                                );
                                            }
                                        )}
                                    </ul>
                                    <ShouldRender
                                        if={
                                            externalStatusPages &&
                                            externalStatusPages.externalStatusPagesList &&
                                            externalStatusPages
                                                .externalStatusPagesList
                                                .length === 0
                                        }
                                    >
                                        {' '}
                                        <div className="cl_nolist">
                                            You don&#39;t have any external
                                            status page.
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }
}

ExternalStatusPages.displayName = 'ExternalStatusPages';
const mapStateToProps = state => ({
    statusPage: state.status.statusPage,
    externalStatusPages: state.status.externalStatusPages,
    requesting: state.status.announcementLogs.requesting,
    error: state.status.announcementLogs.error,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators({ fetchExternalStatusPages }, dispatch);

ExternalStatusPages.propTypes = {
    externalStatusPages: PropTypes.object,
    fetchExternalStatusPages: PropTypes.func,
    statusPage: PropTypes.object,
    theme: PropTypes.string,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ExternalStatusPages);
