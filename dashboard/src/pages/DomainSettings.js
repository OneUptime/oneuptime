import React from 'react';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import Dashboard from '../components/Dashboard';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { openModal, closeModal } from '../actions/modal';
import { fetchCustomFields } from '../actions/monitorCustomField';
import Domains from '../components/domains/Domains';

class DomainSettings extends React.Component {
    ready = () => {
        const { fetchCustomFields, match } = this.props;
        fetchCustomFields(match.params.projectId, 0, 10);
    };

    componentWillMount() {
        // resetIdCounter();
    }

    render() {
        const {
            location: { pathname },
            match,
        } = this.props;

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <div id="monitorSettingsPage">
                        <BreadCrumbItem route={pathname} name="Domains" />

                        <div>
                            <Domains projectId={match.params.projectId} />
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

DomainSettings.displayName = 'DomainSettings';
DomainSettings.propTypes = {
    location: PropTypes.object.isRequired,
    match: PropTypes.object,
    fetchCustomFields: PropTypes.func,
};
const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
    };
};
const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            openModal,
            closeModal,
            fetchCustomFields,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(DomainSettings);
