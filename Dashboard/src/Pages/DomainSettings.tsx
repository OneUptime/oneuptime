import React from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';

import { Fade } from 'react-awesome-reveal';
import { connect } from 'react-redux';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../Utils/getParentRoute';
import { openModal, closeModal } from '../actions/modal';
import { fetchCustomFields } from '../actions/monitorCustomField';
import Domains from '../components/domains/Domains';

interface DomainSettingsProps {
    location: object;
    fetchCustomFields?: Function;
    currentProject: object;
    switchToProjectViewerNav?: boolean;
}

class DomainSettings extends React.Component<DomainSettingsProps> {
    ready = () => {

        const { fetchCustomFields }: $TSFixMe = this.props;
        fetchCustomFields(

            this.props.currentProject && this.props.currentProject._id,
            0,
            10
        );
    };

    override componentDidMount() {
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

    override render() {
        const {

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,
        } = this.props;
        const projectName: $TSFixMe = currentProject ? currentProject.name : '';
        const projectId: $TSFixMe = currentProject ? currentProject._id : '';
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
const mapStateToProps: Function = (state: RootState) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};
const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
        closeModal,
        fetchCustomFields,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(DomainSettings);
