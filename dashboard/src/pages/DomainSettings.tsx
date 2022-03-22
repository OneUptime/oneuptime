import React from 'react';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';

import Fade from 'react-awesome-reveal/Fade';
import { connect } from 'react-redux';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { openModal, closeModal } from '../actions/modal';
import { fetchCustomFields } from '../actions/monitorCustomField';
import Domains from '../components/domains/Domains';

class DomainSettings extends React.Component {
    ready = () => {

        const { fetchCustomFields } = this.props;
        fetchCustomFields(

            this.props.currentProject && this.props.currentProject._id,
            0,
            10
        );
    };

    componentDidMount() {
        this.ready();
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (

            prevProps?.currentProject?._id !== this.props?.currentProject?._id
        ) {
            this.ready();
        }
    }

    componentWillMount() {
        // resetIdCounter();
    }

    render() {
        const {

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,
        } = this.props;
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem

                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <div id="monitorSettingsPage">
                    <BreadCrumbItem route={pathname} name="Domains" />

                    <div>
                        <Domains

                            projectId={

                                this.props.currentProject &&

                                this.props.currentProject._id
                            }
                        />
                    </div>
                </div>
            </Fade>
        );
    }
}


DomainSettings.displayName = 'DomainSettings';

DomainSettings.propTypes = {
    location: PropTypes.object.isRequired,
    fetchCustomFields: PropTypes.func,
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
};
const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};
const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        openModal,
        closeModal,
        fetchCustomFields,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(DomainSettings);
