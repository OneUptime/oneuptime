import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Dashboard from '../components/Dashboard';
import ShouldRender from '../components/basic/ShouldRender';
import Setting from '../components/statusPage/Setting';
import Basic from '../components/statusPage/Basic';
import Header from '../components/statusPage/Header';
import Monitors from '../components/statusPage/Monitors';
import Branding from '../components/statusPage/Branding';
import Links from '../components/statusPage/Links';
import DeleteBox from '../components/statusPage/DeleteBox';
import PrivateStatusPage from '../components/statusPage/PrivateStatusPage';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import { LoadingState } from '../components/basic/Loader';
import PropTypes from 'prop-types';
import { logEvent } from '../analytics';
import { IS_DEV } from '../config';
import { history } from '../store';
import {
    fetchSubProjectStatusPages,
    switchStatusPage,
    fetchProjectStatusPage,
} from '../actions/statusPage';

class StatusPage extends Component {
    async componentDidMount() {
        if (!this.props.statusPage.status._id) {
            const projectId = history.location.pathname
                .split('project/')[1]
                .split('/')[0];
            const statusPageId = history.location.pathname
                .split('status-page/')[1]
                .split('/')[0];
            await this.props.fetchProjectStatusPage(projectId);
            await this.props.fetchSubProjectStatusPages(projectId);

            if (
                this.props.statusPage.subProjectStatusPages &&
                this.props.statusPage.subProjectStatusPages.length > 0
            ) {
                const { subProjectStatusPages } = this.props.statusPage;
                subProjectStatusPages.forEach(subProject => {
                    const statusPages = subProject.statusPages;
                    const statusPage = statusPages.find(
                        page => page._id === statusPageId
                    );
                    if (statusPage) {
                        this.props.switchStatusPage(statusPage);
                    }
                });
            }
        }
        if (!IS_DEV) {
            logEvent('StatusPage Settings Loaded');
        }
    }

    render() {
        return (
            <Dashboard>
                <div className="Box-root">
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span data-reactroot="">
                                        <div>
                                            <div>
                                                <ShouldRender
                                                    if={
                                                        !this.props.statusPage
                                                            .requesting
                                                    }
                                                >
                                                    <div className="Box-root Margin-bottom--12">
                                                        <Header />
                                                    </div>
                                                    <div className="Box-root Margin-bottom--12">
                                                        <Basic />
                                                    </div>
                                                    <RenderIfSubProjectAdmin
                                                        subProjectId={
                                                            this.props.match
                                                                .params
                                                                .subProjectId
                                                        }
                                                    >
                                                        <div className="Box-root Margin-bottom--12">
                                                            <Monitors />
                                                        </div>
                                                    </RenderIfSubProjectAdmin>
                                                    <div className="Box-root Margin-bottom--12">
                                                        <Setting />
                                                    </div>
                                                    <RenderIfSubProjectAdmin
                                                        subProjectId={
                                                            this.props.match
                                                                .params
                                                                .subProjectId
                                                        }
                                                    >
                                                        <div className="Box-root Margin-bottom--12">
                                                            <Branding />
                                                        </div>
                                                        <div className="Box-root Margin-bottom--12">
                                                            <Links />
                                                        </div>
                                                    </RenderIfSubProjectAdmin>
                                                    <RenderIfSubProjectAdmin
                                                        subProjectId={
                                                            this.props.match
                                                                .params
                                                                .subProjectId
                                                        }
                                                    >
                                                        <div className="Box-root Margin-bottom--12">
                                                            <PrivateStatusPage />
                                                        </div>
                                                    </RenderIfSubProjectAdmin>
                                                    <RenderIfSubProjectAdmin
                                                        subProjectId={
                                                            this.props.match
                                                                .params
                                                                .subProjectId
                                                        }
                                                    >
                                                        <DeleteBox
                                                            match={
                                                                this.props.match
                                                            }
                                                        />
                                                    </RenderIfSubProjectAdmin>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        this.props.statusPage
                                                            .requesting
                                                    }
                                                >
                                                    <LoadingState />
                                                </ShouldRender>
                                            </div>
                                        </div>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchSubProjectStatusPages,
            switchStatusPage,
            fetchProjectStatusPage,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        statusPage: state.statusPage,
    };
}

StatusPage.propTypes = {
    statusPage: PropTypes.object.isRequired,
    switchStatusPage: PropTypes.func,
    fetchProjectStatusPage: PropTypes.func,
    fetchSubProjectStatusPages: PropTypes.func,
    match: PropTypes.object,
};

StatusPage.displayName = 'StatusPage';

export default connect(mapStateToProps, mapDispatchToProps)(StatusPage);
