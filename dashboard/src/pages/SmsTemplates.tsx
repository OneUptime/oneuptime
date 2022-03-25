import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import { Fade } from 'react-awesome-reveal';
import { bindActionCreators, Dispatch } from 'redux';
import SmsTemplatesBox from '../components/smsTemplates/SmsTemplatesBox';
import SmsSmtpBox from '../components/smsTemplates/SmsSmtpBox';
import { getSmsTemplates, getSmtpConfig } from '../actions/smsTemplates';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import AdvancedIncidentNotification from '../components/settings/AdvancedIncidentNotification';

interface SmsTemplatesProps {
    getSmsTemplates: Function;
    currentProject: object;
    getSmtpConfig: Function;
    switchToProjectViewerNav?: boolean;
    location?: {
        pathname?: string
    };
}

class SmsTemplates extends Component<SmsTemplatesProps> {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
    }

    ready = () => {

        this.props.getSmsTemplates(this.props.currentProject._id);

        this.props.getSmtpConfig(this.props.currentProject._id);
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

    override render() {
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
                <BreadCrumbItem route={pathname} name="SMS &#38; Calls" />
                <SmsTemplatesBox />
                <SmsSmtpBox />
                <AdvancedIncidentNotification type="sms" />
            </Fade>
        );
    }
}


SmsTemplates.propTypes = {
    getSmsTemplates: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    getSmtpConfig: PropTypes.func.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ getSmsTemplates, getSmtpConfig }, dispatch);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};


SmsTemplates.displayName = 'SmsTemplates';

export default connect(mapStateToProps, mapDispatchToProps)(SmsTemplates);
