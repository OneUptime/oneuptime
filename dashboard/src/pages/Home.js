import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import { loadPage } from '../actions/page';
import { logEvent } from '../analytics';
import { fetchUserSchedule } from '../actions/schedule';
import { IS_SAAS_SERVICE } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import AlertDisabledWarning from '../components/settings/AlertDisabledWarning';

class Home extends Component {
    componentDidMount() {
        this.props.loadPage('Home');
        if (IS_SAAS_SERVICE) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > HOME');
        }
        if (this.props.currentProjectId && this.props.userId.id) {
            this.props.fetchUserSchedule(
                this.props.currentProjectId,
                this.props.userId.id
            );
        }
    }

    componentDidUpdate(prevProps) {
        if (
            !prevProps.userId.id &&
            this.props.currentProjectId &&
            this.props.userId.id
        ) {
            this.props.fetchUserSchedule(
                this.props.currentProjectId,
                this.props.userId.id
            );
        }
    }

    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem route={pathname} name="Home" />
                    <AlertDisabledWarning page="Home" />
                </Fade>
            </Dashboard>
        );
    }
}

Home.displayName = 'Home';

Home.propTypes = {
    currentProjectId: PropTypes.string.isRequired,
    userId: PropTypes.string.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    loadPage: PropTypes.func,
    fetchUserSchedule: PropTypes.func,
};

const mapStateToProps = (state, props) => {
    const { projectId } = props.match.params;

    return {
        currentProjectId: projectId,
        userId: state.profileSettings.profileSetting.data,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            loadPage,
            fetchUserSchedule,
        },
        dispatch
    );
};

export default connect(mapStateToProps, mapDispatchToProps)(Home);
