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

class StatusPage extends Component {

    componentDidMount() {
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('StatusPage Settings Loaded');
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
                                                <ShouldRender if={!this.props.statusPage.requesting}>
                                                    <div className="Box-root Margin-bottom--12">
                                                        <Header />
                                                    </div>
                                                    <div className="Box-root Margin-bottom--12">
                                                        <Basic />
                                                    </div>
                                                    <RenderIfSubProjectAdmin subProjectId={this.props.match.params.subProjectId}>
                                                        <div className="Box-root Margin-bottom--12">
                                                            <Monitors />
                                                        </div>
                                                    </RenderIfSubProjectAdmin>
                                                    <div className="Box-root Margin-bottom--12">
                                                        <Setting />
                                                    </div>
                                                    <RenderIfSubProjectAdmin subProjectId={this.props.match.params.subProjectId}>
                                                        <div className="Box-root Margin-bottom--12">
                                                            <Branding />
                                                        </div>
                                                        <div className="Box-root Margin-bottom--12">
                                                            <Links />
                                                        </div>
                                                    </RenderIfSubProjectAdmin>
                                                    <RenderIfSubProjectAdmin subProjectId={this.props.match.params.subProjectId}>
                                                        <div className="Box-root Margin-bottom--12">
                                                            <PrivateStatusPage />
                                                        </div>
                                                    </RenderIfSubProjectAdmin>
                                                    <RenderIfSubProjectAdmin subProjectId={this.props.match.params.subProjectId}>
                                                        <DeleteBox match={this.props.match} />
                                                    </RenderIfSubProjectAdmin>
                                                </ShouldRender>
                                                <ShouldRender if={this.props.statusPage.requesting}>
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


const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({}, dispatch)
}


function mapStateToProps(state) {
    return {
        statusPage: state.statusPage,

    };
}

StatusPage.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

StatusPage.propTypes = {
    statusPage: PropTypes.object.isRequired,
    match: PropTypes.object
}

StatusPage.displayName = 'StatusPage'

export default connect(mapStateToProps, mapDispatchToProps)(StatusPage);