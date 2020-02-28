import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import EmailTemplatesBox from '../components/emailTemplates/EmailTemplatesBox';
import EmailSmtpBox from '../components/emailTemplates/EmailSmtpBox';
import { getEmailTemplates, getSmtpConfig } from '../actions/emailTemplates';
import { logEvent } from '../analytics';
import { IS_DEV } from '../config';

class EmailTemplates extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    ready = () => {
        this.props.getEmailTemplates(this.props.currentProject._id);
        this.props.getSmtpConfig(this.props.currentProject._id);
    };

    componentDidMount() {
        if (!IS_DEV) {
            logEvent('EmailTemplates page Loaded');
        }
    }

    render() {
        return (
            <Dashboard ready={this.ready}>
                <EmailTemplatesBox />
                <EmailSmtpBox />
            </Dashboard>
        );
    }
}

EmailTemplates.propTypes = {
    getEmailTemplates: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    getSmtpConfig: PropTypes.func.isRequired,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getEmailTemplates, getSmtpConfig }, dispatch);

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
    };
};

EmailTemplates.displayName = 'EmailTemplates';

export default connect(mapStateToProps, mapDispatchToProps)(EmailTemplates);
