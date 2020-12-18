/* eslint-disable*/
import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { reduxForm, Field, formValueSelector, change } from 'redux-form';
import {
    createMonitor,
    createMonitorSuccess,
    createMonitorFailure,
    resetCreateMonitor,
    editMonitor,
    editMonitorSwitch,
    setMonitorCriteria,
    addSeat,
    logFile,
    resetFile,
    setFileInputKey,
    uploadIdentityFile,
} from '../../actions/monitor';
import { RenderField } from '../basic/RenderField';
import { makeCriteria, API_URL } from '../../config';
import { FormLoader } from '../basic/Loader';
import { openModal, closeModal } from '../../actions/modal';
import {
    fetchMonitorCriteria,
    fetchMonitorsIncidents,
    fetchMonitorsSubscribers,
    toggleEdit,
} from '../../actions/monitor';
import { showUpgradeForm } from '../../actions/project';
import ShouldRender from '../basic/ShouldRender';
import { fetchSchedules, scheduleSuccess } from '../../actions/schedule';
import ApiAdvance from './ApiAdvance';
import ResponseComponent from './ResponseComponent';
import { User } from '../../config';
import { ValidateField } from '../../config';
import { RenderSelect } from '../basic/RenderSelect';
import AceEditor from 'react-ace';
import 'ace-builds/src-noconflict/mode-javascript';
import 'ace-builds/src-noconflict/theme-github';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS, PricingPlan as PlanListing } from '../../config';
import Tooltip from '../basic/Tooltip';
import PricingPlan from '../basic/PricingPlan';
const selector = formValueSelector('NewMonitor');
const dJSON = require('dirty-json');
import { history } from '../../store';
import uuid from 'uuid';
import { fetchCommunicationSlas } from '../../actions/incidentCommunicationSla';
import { fetchMonitorSlas } from '../../actions/monitorSla';
import { UploadFile } from '../basic/UploadFile';

class NewMonitor extends Component {
    constructor(props) {
        super(props);
        this.state = {
            advance: false,
            script: '',
            type: props.edit ? props.editMonitorProp.type : props.type,
            httpRequestLink: `${API_URL}/incomingHttpRequest/${uuid.v4()}`,
            mode: props.edit ? props.editMonitorProp.mode : props.mode,
            authentication: props.edit
                ? props.editMonitorProp.authentication
                : props.authentication,
        };
    }

    componentDidMount() {
        const userId = User.getUserId();
        const projectMember = this.props.currentProject.users.find(
            user => user.userId === userId
        );
        //load call schedules
        if (projectMember) {
            this.props.fetchMonitorSlas(this.props.currentProject._id);
            this.props.fetchCommunicationSlas(this.props.currentProject._id);
            this.props.fetchSchedules(this.props.currentProject._id);
        }
        this.props.fetchMonitorCriteria();
        this.props.setFileInputKey(new Date());
    }

    componentDidUpdate() {
        const { monitor } = this.props;
        if (
            monitor.newMonitor.error ===
            "You can't add any more monitors. Please upgrade plan."
        ) {
            this.props.showUpgradeForm();
        }
    }

    submitForm = values => {
        const thisObj = this;
        const postObj = { data: {}, criteria: {} };
        postObj.componentId = thisObj.props.componentId;
        postObj.projectId = this.props.projectId;
        postObj.incidentCommunicationSla = values.incidentCommunicationSla;
        postObj.monitorSla = values.monitorSla;
        postObj.name = values[`name_${this.props.index}`];
        postObj.type = values[`type_${this.props.index}`]
            ? values[`type_${this.props.index}`]
            : this.props.edit
            ? this.props.editMonitorProp.type
            : this.props.type;
        postObj.resourceCategory =
            values[`resourceCategory_${this.props.index}`];
        postObj.callScheduleId = values[`callSchedule_${this.props.index}`];
        if (postObj.type === 'manual')
            postObj.data.description =
                values[`description_${this.props.index}`] || null;

        if (postObj.type === 'device')
            postObj.data.deviceId = values[`deviceId_${this.props.index}`];

        if (postObj.type === 'url' || postObj.type === 'api')
            postObj.data.url = values[`url_${this.props.index}`];

        if (postObj.type === 'script') {
            postObj.data.script = thisObj.state.script;
        }

        if (
            postObj.type === 'server-monitor' &&
            values[`mode_${this.props.index}`] === 'agentless'
        ) {
            postObj.agentlessConfig = {
                host: values[`host_${this.props.index}`],
                port: values[`port_${this.props.index}`],
                username: values[`username_${this.props.index}`],
                authentication: values[`authentication_${this.props.index}`],
                password: values[`password_${this.props.index}`],
                identityFile: this.props.identityFile,
            };
        }

        if (postObj.type === 'incomingHttpRequest')
            postObj.data.link = thisObj.state.httpRequestLink;

        if (
            postObj.type === 'url' ||
            postObj.type === 'api' ||
            postObj.type === 'server-monitor' ||
            postObj.type === 'script' ||
            postObj.type === 'incomingHttpRequest'
        ) {
            if (
                values &&
                values[`up_${this.props.index}`] &&
                values[`up_${this.props.index}`].length
            ) {
                postObj.criteria.up = makeCriteria(
                    values[`up_${this.props.index}`]
                );
                postObj.criteria.up.createAlert =
                    values && values[`up_${this.props.index}_createAlert`]
                        ? true
                        : false;
                postObj.criteria.up.autoAcknowledge =
                    values && values[`up_${this.props.index}_autoAcknowledge`]
                        ? true
                        : false;
                postObj.criteria.up.autoResolve =
                    values && values[`up_${this.props.index}_autoResolve`]
                        ? true
                        : false;
            }

            if (
                values &&
                values[`degraded_${this.props.index}`] &&
                values[`degraded_${this.props.index}`].length
            ) {
                postObj.criteria.degraded = makeCriteria(
                    values[`degraded_${this.props.index}`]
                );
                postObj.criteria.degraded.createAlert =
                    values && values[`degraded_${this.props.index}_createAlert`]
                        ? true
                        : false;
                postObj.criteria.degraded.autoAcknowledge =
                    values &&
                    values[`degraded_${this.props.index}_autoAcknowledge`]
                        ? true
                        : false;
                postObj.criteria.degraded.autoResolve =
                    values && values[`degraded_${this.props.index}_autoResolve`]
                        ? true
                        : false;
            }

            if (
                values &&
                values[`down_${this.props.index}`] &&
                values[`down_${this.props.index}`].length
            ) {
                postObj.criteria.down = makeCriteria(
                    values[`down_${this.props.index}`]
                );
                postObj.criteria.down.createAlert =
                    values && values[`down_${this.props.index}_createAlert`]
                        ? true
                        : false;
                postObj.criteria.down.autoAcknowledge =
                    values && values[`down_${this.props.index}_autoAcknowledge`]
                        ? true
                        : false;
                postObj.criteria.down.autoResolve =
                    values && values[`down_${this.props.index}_autoResolve`]
                        ? true
                        : false;
            }
        }
        if (postObj.type === 'api') {
            if (
                values &&
                values[`method_${this.props.index}`] &&
                values[`method_${this.props.index}`].length
            ) {
                postObj.method = values[`method_${this.props.index}`];
            }
            if (
                values &&
                values[`headers_${this.props.index}`] &&
                values[`headers_${this.props.index}`].length
            ) {
                postObj.headers = values[`headers_${this.props.index}`];
            }
            if (
                values &&
                values[`bodyType_${this.props.index}`] &&
                values[`bodyType_${this.props.index}`].length
            ) {
                postObj.bodyType = values[`bodyType_${this.props.index}`];
            }
            if (
                values &&
                values[`formData_${this.props.index}`] &&
                values[`formData_${this.props.index}`].length &&
                (postObj.bodyType === 'form-data' ||
                    postObj.bodyType === 'x-www-form-urlencoded')
            ) {
                postObj.formData = values[`formData_${this.props.index}`];
            }
            if (
                values &&
                values[`text_${this.props.index}`] &&
                values[`text_${this.props.index}`].length &&
                !(
                    postObj.bodyType === 'form-data' ||
                    postObj.bodyType === 'x-www-form-urlencoded'
                )
            ) {
                let text = values[`text_${this.props.index}`];
                if (postObj.bodyType === 'application/json') {
                    try {
                        const val = text.replace(/^,{+|},+$/g, '');
                        const r = dJSON.parse(val);
                        text = JSON.stringify(r);
                    } catch (e) {}
                }
                postObj.text = text;
            }
        }

        if (this.props.edit) {
            const { monitorId } = this.props;
            postObj._id = this.props.editMonitorProp._id;
            this.props.editMonitor(postObj.projectId, postObj).then(() => {
                this.props.toggleEdit(false);
                thisObj.props.destroy();
                if (monitorId === this.props.editMonitorProp._id) {
                    this.props.fetchMonitorsIncidents(
                        postObj.projectId,
                        this.props.editMonitorProp._id,
                        0,
                        5
                    );
                    this.props.fetchMonitorsSubscribers(
                        postObj.projectId,
                        this.props.editMonitorProp._id,
                        0,
                        5
                    );
                } else {
                    this.props.fetchMonitorsIncidents(
                        postObj.projectId,
                        this.props.editMonitorProp._id,
                        0,
                        3
                    );
                }
                if (SHOULD_LOG_ANALYTICS) {
                    logEvent(
                        'EVENT: DASHBOARD > PROJECT > COMPONENT > MONITOR > EDIT MONITOR',
                        values
                    );
                }
            });
        } else {
            this.props.createMonitor(postObj.projectId, postObj).then(
                data => {
                    thisObj.props.reset();
                    if (SHOULD_LOG_ANALYTICS) {
                        logEvent(
                            'EVENT: DASHBOARD > PROJECT > COMPONENT > MONITOR > NEW MONITOR',
                            values
                        );
                    }
                    history.push(
                        `/dashboard/project/${this.props.currentProject._id}/${this.props.componentId}/monitoring/${data.data._id}`
                    );
                },
                error => {
                    if (error && error.message) {
                        return error;
                    }
                }
            );
        }

        this.setState({
            advance: false,
            script: '',
            type: this.props.edit
                ? this.props.editMonitorProp.type
                : this.props.type,
        });
    };

    scheduleChange = (e, value) => {
        //load call schedules
        if (value && value !== '') {
            this.props.fetchSchedules(value);
        } else {
            const userId = User.getUserId();
            const projectMember = this.props.currentProject.users.find(
                user => user.userId === userId
            );
            if (projectMember)
                this.props.fetchSchedules(this.props.currentProject._id);
        }
    };

    cancelEdit = () => {
        this.props.editMonitorSwitch(this.props.index);
        this.props.toggleEdit(false);
    };

    openAdvance = () => {
        this.setState({ advance: !this.state.advance });
    };

    changeBox = (e, value) => {
        this.setState({ advance: false, type: value });
        this.props.setMonitorCriteria(
            this.props.name,
            this.props.category,
            this.props.subProject,
            this.props.schedule,
            this.props.monitorSla,
            this.props.incidentCommunicationSla,
            value
        );
    };

    changeMode = (e, value) => {
        this.setState({ mode: value });
    };

    changeAuthentication = (e, value) => {
        this.setState({ authentication: value });
    };

    changeFile = e => {
        e.preventDefault();

        const { logFile, uploadIdentityFile, projectId } = this.props;

        const reader = new FileReader();
        const file = e.target.files[0];

        reader.onloadend = () => {
            const fileResult = reader.result;
            logFile(fileResult);
            uploadIdentityFile(projectId, file);
        };
        try {
            reader.readAsDataURL(file);
            console.log('*** Identity File ***', file);
        } catch (error) {
            return;
        }
    };

    removeFile = () => {
        const { setFileInputKey, resetFile } = this.props;

        setFileInputKey(new Date());
        resetFile();
    };

    scriptTextChange = newValue => {
        this.setState({ script: newValue });
    };

    monitorTypeDescription = {
        url:
            'Monitor your website and get notified when it goes down or performs poorly.',
        device:
            'Monitor IoT devices constantly and notify your team when they do not behave the way you want.',
        manual: (
            <>
                Manual monitors do not monitor any resource. You can change
                monitor status by using{' '}
                <a href="https://fyipe.com/docs">Fyipe’s API</a>. This is
                helpful when you use different monitoring tool but want to
                record monitor status on Fyipe.
            </>
        ),
        api: (
            <>
                Monitor{' '}
                <a href="https://en.wikipedia.org/wiki/Representational_state_transfer">
                    REST
                </a>{' '}
                endpoints constantly and notify your team when they do not
                behave the way you want.
            </>
        ),
        script:
            'Run custom JavaScript script and alerts you when script fails.',
        'server-monitor':
            'Monitor servers constantly and notify your team when they do not behave the way you want.',
    };

    getCurrentMonitorCount = monitor => {
        let count = 0;
        if (monitor.monitorsList.monitors.length > 0) {
            monitor.monitorsList.monitors.map(monitorObj => {
                count += monitorObj.count;
                return monitorObj;
            });
        }
        return count;
    };

    getNextPlan = plan => {
        const plans = ['Startup', 'Growth', 'Scale', 'Enterprise'];
        const nextPlanIndex = plans.indexOf(plan) + 1;

        if (nextPlanIndex >= plans.length) {
            return plans[plans.length - 1];
        }

        return plans[nextPlanIndex];
    };

    getUserCount = (project, subProjects) => {
        let count = 0;
        if (subProjects.length > 0) {
            const users = [];
            subProjects.map(subProject => {
                subProject.users.map(user => {
                    // ensure a user is not counted twice
                    // even when they're added to multiple subprojects
                    if (!users.includes(user.userId)) {
                        users.push(user.userId);
                    }
                    return user;
                });
                return subProject;
            });
            count = users.length;
        } else {
            count = project.users.length;
        }
        return count;
    };

    renderMonitorConfiguration = (name)=>{
        return(
            <div className="bs-ContentSection-content Box-root  Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                <div className="Box-root">
                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                    <span>{name} Monitor Configuration</span>
                    </span>
                    <p>
                        <span>
                            Setup your new monitor's configuration as per your needs.
                        </span>
                    </p>
                </div>
            </div>
        );
    }
    render() {
        const requesting =
            (this.props.monitor.newMonitor.requesting && !this.props.edit) ||
            (this.props.monitor.editMonitor.requesting && this.props.edit) ||
            this.props.requestingSla ||
            this.props.requestingMonitorSla;

        const {
            handleSubmit,
            subProjects,
            schedules,
            resourceCategoryList,
            monitor,
            project,
            currentPlanId,
            identityFile,
            fileInputKey,
        } = this.props;
        const { type, mode, authentication, httpRequestLink } = this.state;
        const unlimitedMonitors = ['Scale', 'Enterprise'];
        const planCategory =
            currentPlanId === 'enterprise'
                ? 'Enterprise'
                : PlanListing.getPlanById(currentPlanId).category;
        const numOfUsers = this.getUserCount(project, subProjects);
        const monitorPerUser =
            planCategory === 'Startup' ? 5 : planCategory === 'Growth' ? 10 : 0;
        const monitorCount = numOfUsers * monitorPerUser;
        const currentMonitorCount = this.getCurrentMonitorCount(monitor);
        const monitorTypesOptions=[
            {
                value:
                    'url',
                label:
                    'Website',
                icon:"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNTEyIDUxMjsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik00NzMuODg1LDIxMi42NzNjLTcuMzU4LTMuODAzLTE2LjQwOC0wLjkxOC0yMC4yMTEsNi40NDFsLTE3LjQ1NSwzMy43ODNsLTE2LjgwMy0zMy42MDUNCgkJCUM0MTYuODc2LDIxNC4yMSw0MTEuNjgyLDIxMSw0MDYsMjExcy0xMC44NzYsMy4yMS0xMy40MTYsOC4yOTJMMzc2LDI1Mi40NTlsLTE2LjU4NC0zMy4xNjcNCgkJCWMtMi42ODgtNS4zNzktOC4zMTgtOC42MjYtMTQuMzM0LTguMjY0bC0wLjkwOCwwLjA1NmMtNi42ODQsMC40MS0xMi4wNzIsNS4xMzgtMTMuNjI2LDExLjMwMw0KCQkJYy0xLjAyMi00LjEwOC0zLjc1Ny03Ljc2My03Ljg0LTkuODA0Yy03LjQwNy0zLjcwMy0xNi40MTktMC43MDItMjAuMTI0LDYuNzA4TDI4NiwyNTIuNDU5bC0xNi41ODMtMzMuMTY3DQoJCQlDMjY2Ljg3NSwyMTQuMjEsMjYxLjY4MiwyMTEsMjU2LDIxMXMtMTAuODc1LDMuMjEtMTMuNDE3LDguMjkyTDIyNiwyNTIuNDU5bC0xNi41ODMtMzMuMTY3DQoJCQljLTMuNzA1LTcuNDA5LTEyLjcxNi0xMC40MTMtMjAuMTI1LTYuNzA4Yy00LjA4MywyLjA0MS02LjgxOCw1LjY5Ni03Ljg0LDkuODAzYy0xLjU1My02LjE2NS02Ljk0Mi0xMC44OTQtMTMuNjI2LTExLjMwNA0KCQkJbC0wLjkwOC0wLjA1NmMtNi4wMDQtMC4zNy0xMS42NDUsMi44ODUtMTQuMzM0LDguMjY0TDEzNiwyNTIuNDU5bC0xNi41ODMtMzMuMTY3Yy01LjQ2MS0xMC44OTUtMjEuMjUzLTExLjE2MS0yNi44MzMsMA0KCQkJbC0xNi44MDMsMzMuNjA2bC0xNy40NTUtMzMuNzgyYy0zLjgwMi03LjM2LTEyLjg1MS0xMC4yNDMtMjAuMjExLTYuNDQxYy03LjM2LDMuODAzLTEwLjI0NCwxMi44NTItNi40NDEsMjAuMjEybDMxLDYwDQoJCQljNS42MjcsMTAuODkyLDIxLjI1NSwxMC43OTgsMjYuNzQzLTAuMTc3TDEwNiwyNTkuNTQxbDE2LjU4NCwzMy4xNjdjNS41MjQsMTEuMDQ3LDIxLjMyMiwxMS4wMjIsMjYuODMzLDBsMjcuOTQ5LTU1LjkNCgkJCWMxLjk2Ni0xLjkxMSwzLjQxMS00LjM2NCw0LjA5Ny03LjEzNWMwLjI2MSwxLjAyOSwwLjYyNywyLjA0NiwxLjEyMSwzLjAzNWwzMCw2MGM1LjUyNCwxMS4wNDcsMjEuMzIyLDExLjAyMiwyNi44MzMsMA0KCQkJTDI1NiwyNTkuNTQxbDE2LjU4MywzMy4xNjdjNS41MjQsMTEuMDQ3LDIxLjMyMywxMS4wMjMsMjYuODMzLDBsMzAtNjAuMDAxYzAuNDk0LTAuOTg4LDAuODYtMi4wMDUsMS4xMjEtMy4wMzQNCgkJCWMwLjY4NiwyLjc3MiwyLjEzMSw1LjIyNiw0LjA5OCw3LjEzN2wyNy45NDksNTUuODk4YzUuNTIyLDExLjA0NywyMS4zMjMsMTEuMDIyLDI2LjgzMiwwTDQwNiwyNTkuNTQxbDE2LjU4NCwzMy4xNjcNCgkJCWM1LjQ4MSwxMC45NjUsMjEuMTEsMTEuMDc4LDI2Ljc0MiwwLjE3N2wzMS02MC4wMDFDNDg0LjEyOSwyMjUuNTI0LDQ4MS4yNDUsMjE2LjQ3NSw0NzMuODg1LDIxMi42NzN6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik00OTMuMDMyLDE1OS4zMjlDNDU0LjkxMiw2Ni4yOTEsMzYyLjYxNywwLDI1NiwwQzE0OS4zNTYsMCw1Ny4wNzgsNjYuMzE0LDE4Ljk2OSwxNTkuMzI4QzcuNTAxLDE2Ny40OTIsMCwxODAuODgyLDAsMTk2DQoJCQl2MTIwYzAsMTUuMTE4LDcuNTAxLDI4LjUwOCwxOC45NjksMzYuNjcyQzU3LjA4Nyw0NDUuNzA3LDE0OS4zODEsNTEyLDI1Niw1MTJjMTA2LjY0NCwwLDE5OC45MjEtNjYuMzE0LDIzNy4wMzItMTU5LjMyOQ0KCQkJQzUwNC40OTksMzQ0LjUwNyw1MTIsMzMxLjExNyw1MTIsMzE2VjE5NkM1MTIsMTgwLjg4Myw1MDQuNDk5LDE2Ny40OTMsNDkzLjAzMiwxNTkuMzI5eiBNNDU2LjA0NSwxNTFoLTc2LjY4Nw0KCQkJYy05LjUzMy00MC44NDUtMjQuNDEzLTc2LjAxMi00My4zNDQtMTAyLjI1OGMtMS4zMjMtMS44MzMtMi42NjItMy42MTEtNC4wMTUtNS4zNDVDMzg0LjYwOCw2Mi40NCw0MjkuNDI1LDEwMC42ODcsNDU2LjA0NSwxNTF6DQoJCQkgTTI3MSwzMi41MTJDMzEyLjA0NSw0Ni4yOTMsMzM3LjcxMSwxMDguNDMsMzQ4LjQ4NiwxNTFIMjcxVjMyLjUxMnogTTI0MSwzMi41MTJWMTUxaC03Ny40ODcNCgkJCWM4LjYxNi0zNC4wMzksMjEuMTk4LTYzLjA3MywzNi44MDQtODQuNzA4QzIwOS42OTMsNTMuMjk0LDIyMy42MzksMzguMzQxLDI0MSwzMi41MTJ6IE0xODAuMDAxLDQzLjM5Nw0KCQkJYy0xLjM1MywxLjczNC0yLjY5MiwzLjUxMS00LjAxNSw1LjM0NUMxNTcuMDU1LDc0Ljk4OCwxNDIuMTc0LDExMC4xNTUsMTMyLjY0MiwxNTFINTUuOTU1DQoJCQlDODIuNTc1LDEwMC42ODcsMTI3LjM5MSw2Mi40NCwxODAuMDAxLDQzLjM5N3ogTTU1Ljk1NSwzNjFoNzYuNjg3YzguNzMsMzcuNDA1LDIzLjcyNyw3Ny4zMTUsNDcuMzU5LDEwNy42MDMNCgkJCUMxMjcuMzkxLDQ0OS41Niw4Mi41NzUsNDExLjMxMyw1NS45NTUsMzYxeiBNMjQxLDQ3OS40ODhDMTk5Ljk1NSw0NjUuNzA3LDE3NC4yODgsNDAzLjU3LDE2My41MTMsMzYxSDI0MVY0NzkuNDg4eiBNMjcxLDQ3OS40ODgNCgkJCVYzNjAuOGg3Ny40ODdDMzM3LjY5NSw0MDMuNDMzLDMxMS45NTgsNDY1LjczNiwyNzEsNDc5LjQ4OHogTTMzMS45OTksNDY4LjYwM2MyMy42MjktMzAuMjg0LDM4LjYyOC03MC4zOSw0Ny4zNTktMTA3LjgwM2g3Ni42ODcNCgkJCUM0MjkuNDI1LDQxMS4xMTMsMzg0LjYwOSw0NDkuNTYsMzMxLjk5OSw0NjguNjAzeiBNNDgyLDMxNmMwLDguMjcxLTYuNzI5LDE1LTE1LDE1Yy05LjUxNywwLTQxMS4xMiwwLTQyMiwwDQoJCQljLTguMjcxLDAtMTUtNi43MjktMTUtMTVWMTk2YzAtOC4yNzEsNi43MjktMTUsMTUtMTVjMTEuNDM1LDAsNDExLjczMiwwLDQyMiwwYzguMjcxLDAsMTUsNi43MjksMTUsMTVWMzE2eiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjwvc3ZnPg0K",
            },
            {
                value:
                    'device',
                label:
                    'IoT Device',
                icon:"data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjQ3OXB0IiB2aWV3Qm94PSItNjMgMSA0NzkgNDc5Ljk5OTkxIiB3aWR0aD0iNDc5cHQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0ibTM1Mi41IDE0NGMtLjAzOTA2Mi0zNS4zMjgxMjUtMjguNjcxODc1LTYzLjk2MDkzOC02NC02NGgtMjQuMzU5Mzc1Yy00LjE0MDYyNS00NS4zMTI1LTQyLjEzNjcxOS04MC04Ny42NDA2MjUtODBzLTgzLjUgMzQuNjg3NS04Ny42NDA2MjUgODBoLTI0LjM1OTM3NWMtMzUuMzQ3NjU2IDAtNjQgMjguNjUyMzQ0LTY0IDY0czI4LjY1MjM0NCA2NCA2NCA2NGg4OHYtMTZoLTg4Yy0yNi41MDc4MTIgMC00OC0yMS40OTIxODgtNDgtNDhzMjEuNDkyMTg4LTQ4IDQ4LTQ4aDQwdi04YzAtMzkuNzY1NjI1IDMyLjIzNDM3NS03MiA3Mi03MnM3MiAzMi4yMzQzNzUgNzIgNzJ2OGg0MGMyNi41MDc4MTIgMCA0OCAyMS40OTIxODggNDggNDhzLTIxLjQ5MjE4OCA0OC00OCA0OGgtODh2MTZoODhjMzUuMzI4MTI1LS4wMzkwNjIgNjMuOTYwOTM4LTI4LjY3MTg3NSA2NC02NHptMCAwIi8+PHBhdGggZD0ibTMyMC41IDQ1NnYtMTM2Yy0uMDE1NjI1LTEzLjI1LTEwLjc1LTIzLjk4NDM3NS0yNC0yNGgtMTZ2LTE3LjQ3MjY1NmMxMC41MjczNDQtMy43MDMxMjUgMTcuMTAxNTYyLTE0LjE4NzUgMTUuODQ3NjU2LTI1LjI3NzM0NHMtMTAuMDA3ODEyLTE5Ljg0Mzc1LTIxLjA5NzY1Ni0yMS4wOTc2NTYtMjEuNTc0MjE5IDUuMzIwMzEyLTI1LjI3NzM0NCAxNS44NDc2NTZoLTY1LjQ3MjY1NnYtMTAwLjY4NzVsMTguMzQzNzUgMTguMzQzNzUgMTEuMzEyNS0xMS4zMTI1LTM3LjY1NjI1LTM3LjY1NjI1LTM3LjY1NjI1IDM3LjY1NjI1IDExLjMxMjUgMTEuMzEyNSAxOC4zNDM3NS0xOC4zNDM3NXYxMDAuNjg3NWgtNjUuNDcyNjU2Yy0zLjcwMzEyNS0xMC41MjczNDQtMTQuMTg3NS0xNy4xMDU0NjktMjUuMjc3MzQ0LTE1Ljg0NzY1Ni0xMS4wODk4NDQgMS4yNTM5MDYtMTkuODQzNzUgMTAuMDAzOTA2LTIxLjA5NzY1NiAyMS4wOTM3NXM1LjMyMDMxMiAyMS41NzgxMjUgMTUuODQ3NjU2IDI1LjI3NzM0NHYyNS40NzY1NjJoLTQ4Yy0xMy4yNS4wMTU2MjUtMjMuOTg0Mzc1IDEwLjc1LTI0IDI0djk2Yy4wMTU2MjUgMTMuMjUgMTAuNzUgMjMuOTg0Mzc1IDI0IDI0aDQ4djE2aC0yNHYxNmg2NHYtMTZoLTI0di0xNmg0OGMxMy4yNS0uMDE1NjI1IDIzLjk4NDM3NS0xMC43NSAyNC0yNHYtOTZjLS4wMTU2MjUtMTMuMjUtMTAuNzUtMjMuOTg0Mzc1LTI0LTI0aC00OHYtMjUuNDcyNjU2YzYuNzc3MzQ0LTIuNDE3OTY5IDEyLjEwOTM3NS03Ljc1IDE0LjUyNzM0NC0xNC41MjczNDRoMTQ2Ljk0NTMxMmMyLjQxNzk2OSA2Ljc3NzM0NCA3Ljc1IDEyLjEwOTM3NSAxNC41MjczNDQgMTQuNTIzNDM4djE3LjQ3NjU2MmgtNDhjLTEzLjI1LjAxNTYyNS0yMy45ODQzNzUgMTAuNzUtMjQgMjR2MTM2Yy4wMTU2MjUgMTMuMjUgMTAuNzUgMjMuOTg0Mzc1IDI0IDI0aDgwYzEzLjI1LS4wMTU2MjUgMjMuOTg0Mzc1LTEwLjc1IDI0LTI0em0tMTc2LTMyYy0uMDAzOTA2IDQuNDE3OTY5LTMuNTgyMDMxIDcuOTk2MDk0LTggOGgtMTEyYy00LjQxNzk2OS0uMDAzOTA2LTcuOTk2MDk0LTMuNTgyMDMxLTgtOHYtMTZoMTI4em0tOC0xMDRjNC40MTc5NjkuMDAzOTA2IDcuOTk2MDk0IDMuNTgyMDMxIDggOHY2NGgtMTI4di02NGMuMDAzOTA2LTQuNDE3OTY5IDMuNTgyMDMxLTcuOTk2MDk0IDgtOHptLTU2LTU2Yy00LjQxNzk2OSAwLTgtMy41ODIwMzEtOC04czMuNTgyMDMxLTggOC04IDggMy41ODIwMzEgOCA4Yy0uMDAzOTA2IDQuNDE3OTY5LTMuNTgyMDMxIDcuOTk2MDk0LTggOHptMTkyLTE2YzQuNDE3OTY5IDAgOCAzLjU4MjAzMSA4IDhzLTMuNTgyMDMxIDgtOCA4LTgtMy41ODIwMzEtOC04Yy4wMDM5MDYtNC40MTc5NjkgMy41ODIwMzEtNy45OTYwOTQgOC04em0tNjQgNzJjLjAwMzkwNi00LjQxNzk2OSAzLjU4MjAzMS03Ljk5NjA5NCA4LThoODBjNC40MTc5NjkuMDAzOTA2IDcuOTk2MDk0IDMuNTgyMDMxIDggOHYxMDRoLTk2em0wIDEzNnYtMTZoOTZ2MTZjLS4wMDM5MDYgNC40MTc5NjktMy41ODIwMzEgNy45OTYwOTQtOCA4aC04MGMtNC40MTc5NjktLjAwMzkwNi03Ljk5NjA5NC0zLjU4MjAzMS04LTh6bTAgMCIvPjwvc3ZnPg==",
            },
            {
                value:
                    'manual',
                label:
                    'Manual',
                icon:'data:image/svg+xml;base64,PHN2ZyBpZD0iQ2FwYV8xIiBlbmFibGUtYmFja2dyb3VuZD0ibmV3IDAgMCA1MTIgNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHdpZHRoPSI1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGc+PHBhdGggZD0ibTEyMS40MDMgMjA5LjU1NWgzOC45NTFjMTAuNjM3IDAgMTkuMjkxLTguNjMxIDE5LjI5MS0xOS4yMzl2LTM4Ljg1OGMwLTEwLjYwOC04LjY1NC0xOS4yMzktMTkuMjkxLTE5LjIzOWgtMzguOTUxYy0xMC42MjEgMC0xOS4yNjIgOC42MzEtMTkuMjYyIDE5LjIzOXYzOC44NThjMCAxMC42MDggOC42NDEgMTkuMjM5IDE5LjI2MiAxOS4yMzl6bS43MzgtNTcuMzM4aDM3LjUwM3YzNy4zNGgtMzcuNTAzeiIvPjxwYXRoIGQ9Im00NjguNzA5IDI3OS40NzVjLTQuNzg5IDAtOS41OTYgMS4wMjUtMTMuOTgyIDMuMDQ4LTMuMzcyLTEwLjY4OS0xMS4zOTctMTcuNTYyLTIwLjU4LTIwLjQyOHYtMjE0LjkxYy0uMDAxLTI2LjAxOC0yMS4yMDgtNDcuMTg1LTQ3LjI3NS00Ny4xODVoLTMyOC41OTdjLTI2LjA2NyAwLTQ3LjI3NSAyMS4xNjctNDcuMjc1IDQ3LjE4NXYyNi42MTRjMCAxMi40OTkgMTAuMTgzIDIyLjY2OCAyMi43IDIyLjY2OGg5Ljc0NXYzNzUuNTc3YzAgMTIuNDk5IDEwLjE4MyAyMi42NjggMjIuNyAyMi42NjhoMjY0LjY1MmMxNy41NDQgMTEuMzY4IDM2LjY3OSAxNy4yODkgNTYuMTE4IDE3LjI4OCAxMC44MDggMCAyMS43MTMtMS44MjkgMzIuNDg0LTUuNTY2IDIzLjIzMy04LjA1OSA0My45OS0yNC45MDkgNTguNDQ4LTQ3LjQ0NyAxNS4zMy0yMy44OTggMjMuMzM1LTUzLjMwNCAyMy4xNS04NC45ODF2LTYxLjAyMmMwLTIxLjk5OS0xNi4yNDMtMzMuNTA5LTMyLjI4OC0zMy41MDl6bS00MDUuMjY0IDE5Mi41Njl2LTM3NS41NzdoOTEuNjI1YzUuNTIzIDAgMTAtNC40NzcgMTAtOS45OTlzLTQuNDc3LTkuOTk5LTEwLTkuOTk5aC0xMjEuMzdjLTEuNDYzIDAtMi43LTEuMjIzLTIuNy0yLjY3MXYtMjYuNjEzYzAtMTQuOTkxIDEyLjIzNS0yNy4xODcgMjcuMjc1LTI3LjE4N2gyODkuOTc5Yy01LjQ1MSA3LjY5LTguNjU2IDE3LjA3MS04LjY1NiAyNy4xODd2MjYuNjE0YzAgMS40NDgtMS4yMzYgMi42NzEtMi43IDIuNjcxaC05MS44MjNjLTUuNTIzIDAtMTAgNC40NzctMTAgOS45OTlzNC40NzcgOS45OTkgMTAgOS45OTloOTEuODIzYzEyLjUxNyAwIDIyLjctMTAuMTY5IDIyLjctMjIuNjY4di0yNi42MTVjMC0xNC45OTEgMTIuMjM1LTI3LjE4NyAyNy4yNzQtMjcuMTg3czI3LjI3NCAxMi4xOTYgMjcuMjc0IDI3LjE4N3YyMTQuOTA1Yy0xLjM0OS40MjEtMi42NzcuOTE4LTMuOTY1IDEuNTEyLTQuNTYtMTQuNDY0LTE3LjYzNi0yMS45NjUtMzAuNTgyLTIxLjk2NS00LjE3NiAwLTguMzYyLjc3OS0xMi4yNzQgMi4zMjF2LTU2LjMwNmMwLTIxLjk5OS0xNi4yMzUtMzMuNTEtMzIuMjczLTMzLjUxLTE2LjAzOSAwLTMyLjI3NCAxMS41MS0zMi4yNzQgMzMuNTF2MTQ0LjQ5MWMwIDQuNTUxLjA4MyA4LjcwMS4xNTUgMTIuMzYzLjAwOS4zOTUuMDE3Ljc5NS4wMjQgMS4xOTZsLTIzLjI0NC0yNC45MTljLTEzLjU0MS0xNC40OTUtMzMuMTItMTUuOTgyLTQ3LjYxMS0zLjYxNC0xNC4yNiAxMi4xNzEtMjAuODI5IDM2LjEyNi00LjkxNyA1Ni41NDdsNjkuNDA4IDg5LjA4M2MzLjMwMSA0LjIzNiA2LjczMyA4LjIwNCAxMC4yNzMgMTEuOTE1aC0yNDAuNzIxYy0xLjQ2NCAwLTIuNy0xLjIyMy0yLjctMi42N3ptNDE3LjU1Mi05Ny45OGMuMzE4IDU0LjQ2NC0yNi40MzQgOTkuMDA3LTY4LjE1MyAxMTMuNDc4LTM1LjI5NCAxMi4yNC03Mi44NTctMS42MDEtMTAwLjQ3NC0zNy4wMzNsLTY5LjQwNy04OS4wODJjLTguMjc4LTEwLjYyNC01LjA4NC0yMi44OTYgMi4xMjQtMjkuMDQ3IDEuNjgyLTEuNDM1IDQuOTAxLTMuNjA4IDguOTY5LTMuNjA4IDMuMjUzIDAgNy4wNSAxLjM4OSAxMS4wMzcgNS42NTdsMjQuMzUxIDI2LjEwNmM2Ljg3MyA3LjM2MiAxNS40MiAxNi41MjUgMjQuODk5IDEyLjY4MyA3LjU1MS0zLjA2MyA4LjI1NC0xMS41OTcgOC40ODUtMTQuNDAxLjMxNy0zLjg1Ny4yMjItOC42NDYuMTAxLTE0LjcwOS0uMDctMy41NjgtLjE1MS03LjYxMi0uMTUxLTExLjk2NHYtMTQ0LjQ5MmMwLTEyLjg2MSAxMC4yMjUtMTMuNTEyIDEyLjI3NC0xMy41MTJzMTIuMjczLjY1MSAxMi4yNzMgMTMuNTEydjE0My4xNmMwIDUuNTIyIDQuNDc4IDkuOTk5IDEwIDkuOTk5czEwLTQuNDc3IDEwLTkuOTk5di01NS42NjVjMC0xMi44NjEgMTAuMjI1LTEzLjUxMiAxMi4yNzQtMTMuNTEyIDMuMjM1IDAgNi4zMjMgMS4xNTUgOC40NyAzLjE3MSAyLjUyNCAyLjM2OCAzLjgwNCA1Ljg0NyAzLjgwNCAxMC4zNDJ2NTUuNjY1YzAgNS41MjIgNC40NzggOS45OTkgMTAgOS45OTlzMTAtNC40NzcgMTAtOS45OTl2LTM2LjczM2MwLTEyLjg3IDEwLjIxOC0xMy41MjIgMTIuMjY3LTEzLjUyMiAzLjIzNiAwIDYuMzI1IDEuMTU3IDguNDc1IDMuMTczIDIuNTI2IDIuMzcxIDMuODA3IDUuODUyIDMuODA3IDEwLjM0OHYzNi43MzNjMCA1LjUyMiA0LjQ3OCA5Ljk5OSAxMCA5Ljk5OXMxMC00LjQ3NyAxMC05Ljk5OXYtMTcuODI4YzAtMTIuODYgMTAuMjM2LTEzLjUxMSAxMi4yODgtMTMuNTExIDMuMjQgMCA2LjMzMyAxLjE1NiA4LjQ4MiAzLjE3MiAyLjUyNSAyLjM2NyAzLjgwNiA1Ljg0NiAzLjgwNiAxMC4zMzl2NjEuMDh6Ii8+PHBhdGggZD0ibTIwMS43MjEgMTQyLjIxOGMwIDUuNTIyIDQuNDc3IDkuOTk5IDEwIDkuOTk5aDgwLjAzMmM1LjUyMiAwIDEwLTQuNDc3IDEwLTkuOTk5cy00LjQ3OC05Ljk5OS0xMC05Ljk5OWgtODAuMDMyYy01LjUyMyAwLTEwIDQuNDc3LTEwIDkuOTk5eiIvPjxwYXRoIGQ9Im0yNzQuNzY0IDE4OS41NTdoLTYzLjA0M2MtNS41MjMgMC0xMCA0LjQ3Ny0xMCA5Ljk5OXM0LjQ3NyA5Ljk5OSAxMCA5Ljk5OWg2My4wNDNjNS41MjIgMCAxMC00LjQ3NyAxMC05Ljk5OXMtNC40NzgtOS45OTktMTAtOS45OTl6Ii8+PHBhdGggZD0ibTExMi4xNDEgMjY2LjkyaDE1Mi43MzZjNS41MjIgMCAxMC00LjQ3NyAxMC05Ljk5OXMtNC40NzgtOS45OTktMTAtOS45OTloLTE1Mi43MzZjLTUuNTIzIDAtMTAgNC40NzctMTAgOS45OTlzNC40NzcgOS45OTkgMTAgOS45OTl6Ii8+PHBhdGggZD0ibTExMi4xNDEgMzI0LjI1OGg4Mi4zOTFjNS41MjMgMCAxMC00LjQ3NyAxMC05Ljk5OXMtNC40NzctOS45OTktMTAtOS45OTloLTgyLjM5MWMtNS41MjMgMC0xMCA0LjQ3Ny0xMCA5Ljk5OXM0LjQ3NyA5Ljk5OSAxMCA5Ljk5OXoiLz48cGF0aCBkPSJtMTEyLjE0MSAzODEuNjI0aDcyLjU2MWM1LjUyMyAwIDEwLTQuNDc3IDEwLTkuOTk5cy00LjQ3Ny05Ljk5OS0xMC05Ljk5OWgtNzIuNTYxYy01LjUyMyAwLTEwIDQuNDc3LTEwIDkuOTk5czQuNDc3IDkuOTk5IDEwIDkuOTk5eiIvPjxwYXRoIGQ9Im0yMTguNTk2IDQxOC45NjRoLTEwNi40NTVjLTUuNTIzIDAtMTAgNC40NzctMTAgOS45OTlzNC40NzcgOS45OTkgMTAgOS45OTloMTA2LjQ1NWM1LjUyMyAwIDEwLTQuNDc3IDEwLTkuOTk5cy00LjQ3Ny05Ljk5OS0xMC05Ljk5OXoiLz48cGF0aCBkPSJtMjAwLjA3MiA5Ni40NjdoLjA1N2M1LjUyMyAwIDkuOTcyLTQuNDc3IDkuOTcyLTkuOTk5cy00LjUwNS05Ljk5OS0xMC4wMjgtOS45OTktMTAgNC40NzctMTAgOS45OTkgNC40NzYgOS45OTkgOS45OTkgOS45OTl6Ii8+PC9nPjwvc3ZnPg==',
            },
            {
                value:
                    'api',
                label:
                    'API',
                icon:'data:image/svg+xml;base64,PHN2ZyBpZD0iQ2FwYV8xIiBlbmFibGUtYmFja2dyb3VuZD0ibmV3IDAgMCA1MTIgNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHdpZHRoPSI1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGc+PHBhdGggZD0ibTQ2Ni4xMzcgMTkzLjkwNGMyLjM5LTguNTQ2IDMuNTk4LTE3LjM2OCAzLjU5OC0yNi4zMjkgMC01My44MjYtNDMuNzk4LTk3LjYxNy05Ny42MzMtOTcuNjE3LTMuODcxIDAtNy43MDkuMjIyLTExLjQ4Mi42NjMtNy43MjQtMTkuMjE2LTIwLjUwOC0zNS44MDctMzcuMzM1LTQ4LjM0Mi0xOS41NjctMTQuNTc1LTQyLjgzOS0yMi4yNzktNjcuMy0yMi4yNzktMjQuNDYgMC00Ny43MzEgNy43MDQtNjcuMjk4IDIyLjI3OS0xNi44MjcgMTIuNTM1LTI5LjYxMSAyOS4xMjQtMzcuMzM1IDQ4LjMzOS0zLjc2NS0uNDM4LTcuNjA0LS42Ni0xMS40ODMtLjY2LTUzLjgxOCAwLTk3LjYwNCA0My43OTEtOTcuNjA0IDk3LjYxNyAwIDguOTYxIDEuMjA4IDE3Ljc4MyAzLjU5OCAyNi4zMjktMjMuNTU5IDE0LjcxMS0zNy44NjMgNDAuMjQtMzcuODYzIDY4LjUxNiAwIDQ0LjU4OSAzNi4yNzEgODAuODY1IDgwLjg1NCA4MC44NjVoMTUuMzF2MzIuNTE5YzAgMTEuNjczIDkuNDk1IDIxLjE2OSAyMS4xNjYgMjEuMTY5aDMuOTUxYzIuNjg3IDkuMjc2IDYuMzkyIDE4LjIxNCAxMS4wNzMgMjYuNzA2bC0yLjc3MiAyLjc3M2MtNC4wMDUgMy45NzktNi4yMTUgOS4yOTEtNi4yMjUgMTQuOTU2LS4wMDkgNS42NzkgMi4xOTMgMTEuMDE1IDYuMTk3IDE1LjAxOWwyMi4xNjMgMjIuMTk1YzguMjczIDguMjIxIDIxLjcwMiA4LjIwOSAyOS45MjMtLjAxMmwyLjgyNS0yLjgxNWM4LjQ4NCA0LjY3MyAxNy40MTIgOC4zNzIgMjYuNjgxIDExLjA1NnYzLjk1M2MwIDExLjY4OCA5LjUwOCAyMS4xOTYgMjEuMTk0IDIxLjE5NmgzMS4zMThjMTEuNjg3IDAgMjEuMTk0LTkuNTA5IDIxLjE5NC0yMS4xOTZ2LTMuOTU2YzkuMjUtMi42ODQgMTguMTczLTYuMzgxIDI2LjY2NS0xMS4wNTFsMi44MDEgMi44MDNjOC4yNiA4LjI2IDIxLjY5OCA4LjI1OSAyOS45NTgtLjAwMWwyMi4xODctMjIuMTljOC4yMTgtOC4yNzMgOC4yMDgtMjEuNzAxLS4wMjMtMjkuOTM0bC0yLjgwMy0yLjgwNGM0LjY2OC04LjQ5MSA4LjM3Mi0xNy40MjYgMTEuMDY5LTI2LjY5OGgzLjkzNWMxMS42ODcgMCAyMS4xOTQtOS40OTYgMjEuMTk0LTIxLjE2OXYtMzIuNTE5aDE1LjMxYzQ0LjU4MyAwIDgwLjg1NC0zNi4yNzYgODAuODU0LTgwLjg2NS4wMDEtMjguMjc2LTE0LjMwMy01My44MDUtMzcuODYyLTY4LjUxNnptLTc4LjMwMSAxODEuOWMwIC42MjMtLjU1OSAxLjE2OS0xLjE5NCAxLjE2OWgtMTEuNjc3Yy00LjY3NCAwLTguNzI1IDMuMjM3LTkuNzU0IDcuNzk3LTIuODE1IDEyLjQ2MS03LjcyIDI0LjI5Mi0xNC41NzYgMzUuMTYzLTIuNDkyIDMuOTUxLTEuOTE3IDkuMTAyIDEuMzg3IDEyLjQwNWw4LjI3NSA4LjI3N2MuNDM4LjQzOC40MjcgMS4yNDcuMDAxIDEuNjc2bC0yMi4xNjMgMjIuMTY2Yy0uMjY4LjI2OC0uNjAzLjMyNC0uODM2LjMyNC0uMjM0IDAtLjU2OS0uMDU3LS44MzYtLjMyM2wtOC4yNzUtOC4yNzdjLTMuMzA1LTMuMzA0LTguNDU3LTMuODgtMTIuNDA4LTEuMzg3LTEwLjg4MyA2Ljg2Ni0yMi42OTcgMTEuNzYtMzUuMTE0IDE0LjU0NS00LjU2NiAxLjAyNC03LjgxMiA1LjA3OC03LjgxMiA5Ljc1OHYxMS43MDdjMCAuNjI2LS41NjkgMS4xOTYtMS4xOTQgMS4xOTZoLTMxLjMxOGMtLjYzNyAwLTEuMTk0LS41NTktMS4xOTQtMS4xOTZ2LTExLjcwN2MwLTQuNjgyLTMuMjQ3LTguNzM2LTcuODE1LTkuNzU5LTEyLjQ0MS0yLjc4NS0yNC4yNTEtNy42NzctMzUuMTAxLTE0LjUzOC0zLjk0OC0yLjQ5Ny05LjA5OC0xLjkyOS0xMi40MDUgMS4zNjlsLTguMzE1IDguMjg4Yy0uNDQ1LjQ0My0xLjIzOC40MzMtMS42NjguMDA1bC0yMi4xMzktMjIuMTcxYy0uMjg2LS4yODYtLjM0Ni0uNjItLjM0Ni0uODUxLjAwMS0uMzIuMTA5LS41OTEuMzQ1LS44MjVsOC4yNzYtOC4yNzdjMy4zMDgtMy4zMDggMy44OC04LjQ2OCAxLjM3OC0xMi40Mi02Ljg3Ni0xMC44NTktMTEuNzc1LTIyLjY3OS0xNC41NjItMzUuMTMtMS4wMjItNC41NjgtNS4wNzctNy44MTUtOS43NTktNy44MTVoLTExLjcwN2MtLjYzMiAwLTEuMTY2LS41MzUtMS4xNjYtMS4xNjl2LTMyLjUxOWg0Ni41ODNjLTEuMDg1IDUuNTE3LTEuNjUyIDExLjE0NS0xLjY1MiAxNi44NDQgMCA0Ny45MTggMzguOTc5IDg2LjkwMiA4Ni44OTEgODYuOTAyIDQ3LjkyOCAwIDg2LjkyLTM4Ljk4NCA4Ni45Mi04Ni45MDIgMC01LjY4NS0uNTcyLTExLjMxMi0xLjY2OC0xNi44NDRoNDYuNTk5djMyLjUxOXptMzUuMzEtNTIuNTE5aC0xMjIuMjY3Yy01LjUyMiAwLTEwIDQuNDc4LTEwIDEwczQuNDc4IDEwIDEwIDEwaDE5Ljg1NGMxLjQzNSA1LjQ5NCAyLjE3MyAxMS4xMzMgMi4xNzMgMTYuODQ0IDAgMzYuODktMzAuMDIxIDY2LjkwMi02Ni45MiA2Ni45MDItMzYuODg0IDAtNjYuODkxLTMwLjAxMy02Ni44OTEtNjYuOTAyIDAtNS43MzYuNzMxLTExLjM3NSAyLjE1MS0xNi44NDRoMTkuODQ3YzUuNTIyIDAgMTAtNC40NzggMTAtMTBzLTQuNDc4LTEwLTEwLTEwaC0xMjIuMjM5Yy0zMy41NTUgMC02MC44NTQtMjcuMzA0LTYwLjg1NC02MC44NjUgMC0yMy41MTUgMTMuMTQ0LTQ0LjUwNiAzNC4zMDMtNTQuNzgzIDQuNjUyLTIuMjYgNi44MTQtNy42OTUgNC45ODQtMTIuNTMzLTMuMzMyLTguODA4LTUuMDIxLTE4LjA2OS01LjAyMS0yNy41MjggMC00Mi43OTggMzQuODEyLTc3LjYxNyA3Ny42MDQtNzcuNjE3IDUuNTE0IDAgMTAuODkxLjU1NSAxNS45ODMgMS42NDcgNS4wNDEgMS4wODMgMTAuMDgxLTEuODQ4IDExLjYzNS02Ljc2NiAxMi4yNDgtMzguNzgyIDQ3LjgxMy02NC44NCA4OC40OTctNjQuODQgNDAuNjg2IDAgNzYuMjUgMjYuMDU3IDg4LjQ5OCA2NC44NCAxLjU1MiA0LjkxNCA2LjU4NCA3Ljg0NyAxMS42MjUgNi43NjggNS4xMjUtMS4wOTUgMTAuNTA2LTEuNjQ5IDE1Ljk5My0xLjY0OSA0Mi44MDcgMCA3Ny42MzMgMzQuODE5IDc3LjYzMyA3Ny42MTcgMCA5LjQ1OS0xLjY4OSAxOC43MjEtNS4wMjEgMjcuNTI4LTEuODMgNC44MzguMzMyIDEwLjI3MyA0Ljk4NCAxMi41MzMgMjEuMTU5IDEwLjI3NyAzNC4zMDMgMzEuMjY4IDM0LjMwMyA1NC43ODMgMCAzMy41NjEtMjcuMjk5IDYwLjg2NS02MC44NTQgNjAuODY1eiIvPjxwYXRoIGQ9Im0zNjEuNjEzIDE0MS44NzVjLTUuNTIyIDAtMTAgNC40NzgtMTAgMTB2OTguNjQ0YzAgNS41MjIgNC40NzggMTAgMTAgMTBzMTAtNC40NzggMTAtMTB2LTk4LjY0NGMwLTUuNTIyLTQuNDc3LTEwLTEwLTEweiIvPjxwYXRoIGQ9Im0yODEuOTc0IDE0MS44NzVoLTI3Ljk3NGMtNS40MzMgMC0xMCA0LjU1MS0xMCAxMHYxMDAuNDU4YzAgNS41MjIgNC40NzggMTAgMTAgMTBzMTAtNC40NzggMTAtMTB2LTMzLjY4OGM2LjIyLS4wMzggMTMuODY0LS4wNzggMTcuOTc0LS4wNzggMjEuNDU0IDAgMzguOTA4LTE3LjIwMiAzOC45MDgtMzguMzQ2cy0xNy40NTQtMzguMzQ2LTM4LjkwOC0zOC4zNDZ6bTAgNTYuNjkxYy00LjA5MiAwLTExLjYyNi4wMzktMTcuODI2LjA3Ny0uMDMtNi4zOTEtLjA2Mi0xNC4yMzQtLjA2Mi0xOC40MjMgMC0zLjU1LS4wMjUtMTEuNjg5LS4wNDktMTguMzQ2aDE3LjkzOGMxMC4yNDkgMCAxOC45MDggOC40MDEgMTguOTA4IDE4LjM0NnMtOC42NiAxOC4zNDYtMTguOTA5IDE4LjM0NnoiLz48cGF0aCBkPSJtMTc1LjI0MSAxNDkuNzYxYy0uMDI2LS4wNjktLjA1My0uMTM5LS4wODEtLjIwNy0xLjg4Mi00LjY2OS02LjM0Ni03LjY4Ny0xMS4zNzItNy42ODdzLTkuNDkgMy4wMTgtMTEuMzcyIDcuNjg3Yy0uMDI0LjA2LS4wNDguMTE5LS4wNy4xNzlsLTM3LjcyMyA5OS4wNDFjLTEuOTY2IDUuMTYxLjYyNCAxMC45MzggNS43ODUgMTIuOTA0IDUuMTYyIDEuOTY2IDEwLjkzOC0uNjI0IDEyLjkwNC01Ljc4NWw2Ljk0LTE4LjIyMWg0Ni43OTRsNi44NjcgMTguMTkyYzEuNTExIDQuMDA0IDUuMzE2IDYuNDcyIDkuMzU3IDYuNDcyIDEuMTczIDAgMi4zNjYtLjIwOCAzLjUyOS0uNjQ3IDUuMTY3LTEuOTUgNy43NzQtNy43MiA1LjgyNC0xMi44ODd6bS0yNy4zNzEgNjcuOTExIDE1Ljg4NS00MS43MDYgMTUuNzQyIDQxLjcwNnoiLz48cGF0aCBkPSJtMjU1Ljk4NSAzMjMuMjg1Yy01LjUyMiAwLTEwIDQuNDc4LTEwIDEwczQuNDc4IDEwIDEwIDEwaC4wNThjNS41MjIgMCA5Ljk3Mi00LjQ3OCA5Ljk3Mi0xMHMtNC41MDctMTAtMTAuMDMtMTB6Ii8+PC9nPjwvc3ZnPg==',
            },
            {
                value:
                    'script',
                label:
                    'Script',
                icon:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgNTExLjk5OSA1MTEuOTk5IiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA1MTEuOTk5IDUxMS45OTk7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4NCjxnPg0KCTxnPg0KCQk8cGF0aCBkPSJNMzU5Ljk4MywxMzAuMjk2SDIwMC4yMTljLTQuMTQ1LDAtNy41MDUsMy4zNi03LjUwNSw3LjUwNWMwLDQuMTQ1LDMuMzYsNy41MDUsNy41MDUsNy41MDVoMTU5Ljc2Mw0KCQkJYzQuMTQ1LDAsNy41MDYtMy4zNiw3LjUwNi03LjUwNUMzNjcuNDg4LDEzMy42NTUsMzY0LjEyOCwxMzAuMjk2LDM1OS45ODMsMTMwLjI5NnoiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHBhdGggZD0iTTE2NS4yOTcsMTMwLjI5NmgtMjUuMzA2Yy00LjE0NSwwLTcuNTA1LDMuMzYtNy41MDUsNy41MDVjMCw0LjE0NSwzLjM1OSw3LjUwNSw3LjUwNSw3LjUwNWgyNS4zMDYNCgkJCWM0LjE0NSwwLDcuNTA1LTMuMzYsNy41MDUtNy41MDVDMTcyLjgwMiwxMzMuNjU2LDE2OS40NDIsMTMwLjI5NiwxNjUuMjk3LDEzMC4yOTZ6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik0yMTguNDksMzYwLjM0MWgtNzguNDk5Yy00LjE0NSwwLTcuNTA1LDMuMzYtNy41MDUsNy41MDVjMCw0LjE0NiwzLjM2LDcuNTA1LDcuNTA1LDcuNTA1aDc4LjQ5OQ0KCQkJYzQuMTQ1LDAsNy41MDUtMy4zNiw3LjUwNS03LjUwNUMyMjUuOTk1LDM2My43LDIyMi42MzUsMzYwLjM0MSwyMTguNDksMzYwLjM0MXoiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHBhdGggZD0iTTI0OS45ODcsMjgzLjY2SDEzOS45OTFjLTQuMTQ1LDAtNy41MDUsMy4zNi03LjUwNSw3LjUwNWMwLDQuMTQ2LDMuMzYsNy41MDUsNy41MDUsNy41MDVoMTA5Ljk5Ng0KCQkJYzQuMTQ0LDAsNy41MDUtMy4zNiw3LjUwNS03LjUwNUMyNTcuNDkyLDI4Ny4wMTksMjU0LjEzMiwyODMuNjYsMjQ5Ljk4NywyODMuNjZ6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik0zMDMuNTMsMjA2Ljk3N0gxMzkuOTkxYy00LjE0NSwwLTcuNTA1LDMuMzYtNy41MDUsNy41MDVzMy4zNiw3LjUwNSw3LjUwNSw3LjUwNUgzMDMuNTMNCgkJCWM0LjE0NSwwLjAwMSw3LjUwNS0zLjM1OSw3LjUwNS03LjUwNVMzMDcuNjc1LDIwNi45NzcsMzAzLjUzLDIwNi45Nzd6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik00NDUuNTY0LDUzLjUxaC0zMTAuMTdjLTI3LjQ3NCwwLTQ5LjgyNSwyMi4zNTItNDkuODI1LDQ5LjgyNlYzOTguNjRINy41MDRjLTIuMDAzLDAtMy45MjQsMC44MDEtNS4zMzMsMi4yMjQNCgkJCWMtMS40MSwxLjQyNC0yLjE5MiwzLjM1Mi0yLjE3MSw1LjM1NWMwLjI5NiwyOS44LDIxLjcxMSw1Mi4yNzEsNDkuODEzLDUyLjI3MWgzMTAuMTdoMC45NDVjMjcuNDc0LDAsNDkuODI1LTIyLjM1Miw0OS44MjUtNDkuODI2DQoJCQl2LTkwLjk0M2MwLTQuMTQ1LTMuMzYxLTcuNTA0LTcuNTA2LTcuNTA0Yy00LjE0NSwwLTcuNTA1LDMuMzYtNy41MDUsNy41MDV2OTAuOTQzYzAsMTkuMTk4LTE1LjYxOCwzNC44MTUtMzQuODE0LDM0LjgxNWgtMC45NDUNCgkJCWMtMTkuNjI5LDAtMzQuNTkxLTE2LjA4My0zNC44MDMtMzcuNDA5Yy0wLjA0MS00LjExNi0zLjM4OS03LjQzMS03LjUwNS03LjQzMUgxMDAuNTgzVjEwMy4zMzUNCgkJCWMwLTE5LjE5OCwxNS42MTgtMzQuODE1LDM0LjgxNC0zNC44MTVoMjc0LjU1OGMtMC4yMiwwLjIyNS0wLjQyOCwwLjQ2MS0wLjY0NCwwLjY5MWMtMC4yNjIsMC4yNzktMC41MjcsMC41NTUtMC43ODMsMC44MzkNCgkJCWMtMC4yNzEsMC4zMDEtMC41MzIsMC42MS0wLjc5NSwwLjkxOGMtMC4yNTMsMC4yOTUtMC41MDgsMC41ODctMC43NTQsMC44ODhjLTAuMjU1LDAuMzEyLTAuNDk5LDAuNjMyLTAuNzQ3LDAuOTUNCgkJCWMtMC4yNCwwLjMwOC0wLjQ4MiwwLjYxMy0wLjcxNSwwLjkyN2MtMC4yMzgsMC4zMjItMC40NjYsMC42NTEtMC42OTcsMC45NzljLTAuMjI3LDAuMzIyLTAuNDU3LDAuNjQyLTAuNjc3LDAuOTY5DQoJCQljLTAuMjIxLDAuMzMxLTAuNDMyLDAuNjY5LTAuNjQ1LDEuMDA2Yy0wLjIxMywwLjMzNS0wLjQyOSwwLjY2Ny0wLjYzNCwxLjAwN2MtMC4yMDYsMC4zNDItMC40LDAuNjkxLTAuNTk3LDEuMDM4DQoJCQljLTAuMTk3LDAuMzQ1LTAuMzk5LDAuNjg4LTAuNTg4LDEuMDM5Yy0wLjE5LDAuMzUxLTAuMzY2LDAuNzEtMC41NDcsMS4wNjdjLTAuMTgxLDAuMzU2LTAuMzY3LDAuNzA5LTAuNTM5LDEuMDY5DQoJCQljLTAuMTczLDAuMzYyLTAuMzMyLDAuNzMxLTAuNDk3LDEuMDk3Yy0wLjE2NCwwLjM2NS0wLjMzMywwLjcyNy0wLjQ4OCwxLjA5NmMtMC4xNTcsMC4zNzMtMC4yOTksMC43NTMtMC40NDcsMS4xMw0KCQkJYy0wLjE0NiwwLjM3Mi0wLjI5NywwLjc0MS0wLjQzNCwxLjExN2MtMC4xNDEsMC4zODYtMC4yNjYsMC43NzktMC4zOTcsMS4xN2MtMC4xMjYsMC4zNzYtMC4yNTksMC43NDgtMC4zNzcsMS4xMjgNCgkJCWMtMC4xMjQsMC40LTAuMjMxLDAuODA3LTAuMzQ1LDEuMjEyYy0wLjEwNiwwLjM3OC0wLjIyLDAuNzUzLTAuMzE4LDEuMTM1Yy0wLjEwNywwLjQyLTAuMTk3LDAuODQ2LTAuMjk0LDEuMjcNCgkJCWMtMC4wODUsMC4zNzMtMC4xNzksMC43NDQtMC4yNTUsMS4xMmMtMC4wOSwwLjQ0MS0wLjE2MSwwLjg4Ny0wLjIzOSwxLjMzMmMtMC4wNjQsMC4zNjgtMC4xMzgsMC43MzItMC4xOTQsMS4xMDINCgkJCWMtMC4wNzIsMC40NzUtMC4xMjQsMC45NTYtMC4xODMsMS40MzVjLTAuMDQyLDAuMzQ2LTAuMDk1LDAuNjg4LTAuMTMsMS4wMzZjLTAuMDU0LDAuNTM2LTAuMDg3LDEuMDc4LTAuMTI0LDEuNjE5DQoJCQljLTAuMDIsMC4yOTctMC4wNTIsMC41OTItMC4wNjcsMC44OWMtMC4wNDIsMC44NDEtMC4wNjQsMS42ODgtMC4wNjQsMi41NHYyLjUxOXY2NC4wOTNjMCw0LjE0NiwzLjM2LDcuNTA1LDcuNTA1LDcuNTA1DQoJCQlzNy41MDUtMy4zNiw3LjUwNS03LjUwNVYxMTMuMzZoNzcuMjAzYzIuMDAzLDAsMy45MjQtMC44MDEsNS4zMzMtMi4yMjRjMS40MS0xLjQyNCwyLjE5Mi0zLjM1MiwyLjE3MS01LjM1NQ0KCQkJQzQ5NS4xNjEsNzUuOTgxLDQ3My43NDYsNTMuNTEsNDQ1LjU2NCw1My41MXogTTMxMC42OTMsNDEzLjY1MWMwLjEwMywwLjc3NywwLjIyMywxLjU0NiwwLjM1NiwyLjMxDQoJCQljMC4wNDQsMC4yNTYsMC4wOTgsMC41MDcsMC4xNDYsMC43NjJjMC4wOTUsMC41MDUsMC4xOSwxLjAxLDAuMjk4LDEuNTA4YzAuMDY0LDAuMjk5LDAuMTM3LDAuNTkzLDAuMjA1LDAuODg5DQoJCQljMC4xMDQsMC40NDksMC4yMDksMC44OTgsMC4zMjQsMS4zNDFjMC4wOCwwLjMxMSwwLjE2NywwLjYxOSwwLjI1MiwwLjkyN2MwLjExNywwLjQyMiwwLjIzNSwwLjg0MywwLjM2MSwxLjI2DQoJCQljMC4wOTQsMC4zMTMsMC4xOTMsMC42MjQsMC4yOTMsMC45MzRjMC4xMywwLjQwNiwwLjI2NSwwLjgxLDAuNDA0LDEuMjExYzAuMTA3LDAuMzA5LDAuMjE2LDAuNjE3LDAuMzI5LDAuOTIzDQoJCQljMC4xNDYsMC4zOTgsMC4yOTcsMC43OTIsMC40NTIsMS4xODRjMC4xMTgsMC4yOTgsMC4yMzUsMC41OTYsMC4zNTcsMC44OTFjMC4xNjUsMC4zOTcsMC4zMzcsMC43ODksMC41MSwxLjE4MQ0KCQkJYzAuMTI0LDAuMjgxLDAuMjQ3LDAuNTYzLDAuMzc2LDAuODQxYzAuMTksMC40MSwwLjM5LDAuODE0LDAuNTg5LDEuMjE3YzAuMTI0LDAuMjUsMC4yNDMsMC41MDIsMC4zNzEsMC43NQ0KCQkJYzAuMjQ0LDAuNDczLDAuNDk5LDAuOTM4LDAuNzU2LDEuNDAyYzAuMDkzLDAuMTY5LDAuMTgyLDAuMzQxLDAuMjc3LDAuNTA4YzAuMzU3LDAuNjI4LDAuNzI2LDEuMjQ2LDEuMTA3LDEuODU0DQoJCQljMC4wODksMC4xNDIsMC4xODQsMC4yNzgsMC4yNzQsMC40MTljMC4yOTcsMC40NjUsMC41OTgsMC45MjcsMC45MDksMS4zOGMwLjE0NCwwLjIwOSwwLjI5NCwwLjQxMiwwLjQ0LDAuNjE5DQoJCQljMC4yNjgsMC4zNzgsMC41MzYsMC43NTUsMC44MTQsMS4xMjRjMC4xNjcsMC4yMjIsMC4zMzgsMC40MzgsMC41MDgsMC42NTdjMC4yNjgsMC4zNDUsMC41MzgsMC42ODksMC44MTQsMS4wMjUNCgkJCWMwLjE4MiwwLjIyMSwwLjM2NywwLjQzOSwwLjU1MiwwLjY1N2MwLjI3NiwwLjMyNiwwLjU1NiwwLjY0OCwwLjg0LDAuOTY2YzAuMTkxLDAuMjE0LDAuMzg1LDAuNDI1LDAuNTgsMC42MzUNCgkJCWMwLjEzOSwwLjE1LDAuMjczLDAuMzA2LDAuNDE0LDAuNDU0SDQ5LjgxMnYwYy0xNy4yMjQsMC0zMC44NTUtMTIuMzg1LTM0LjA4LTI5LjgyOUgzMTAuNjkzeiBNNDExLjEyLDk4LjM0OA0KCQkJYzAuMDAzLTAuMDUxLDAuMDA4LTAuMTA0LDAuMDE1LTAuMTU2YzAuMDM0LTAuMjI5LDAuMDc2LTAuNDU2LDAuMTE1LTAuNjgzYzAuMDU0LTAuMzIsMC4xMDktMC42NCwwLjE3Mi0wLjk1OA0KCQkJYzAuMDQ4LTAuMjQyLDAuMTAyLTAuNDgyLDAuMTU1LTAuNzIyYzAuMDY2LTAuMjk4LDAuMTMzLTAuNTk1LDAuMjA2LTAuODljMC4wNjItMC4yNDgsMC4xMjgtMC40OTUsMC4xOTUtMC43NDENCgkJCWMwLjA3Ny0wLjI4MSwwLjE1Ni0wLjU2MiwwLjIzOS0wLjg0YzAuMDc1LTAuMjUyLDAuMTU0LTAuNTAyLDAuMjM1LTAuNzUxYzAuMDg2LTAuMjY2LDAuMTc2LTAuNTMsMC4yNjktMC43OTQNCgkJCWMwLjA5LTAuMjU1LDAuMTgxLTAuNTEsMC4yNzctMC43NjJjMC4wOTQtMC4yNDksMC4xOTMtMC40OTUsMC4yOTMtMC43NDJjMC4xMDUtMC4yNiwwLjIxLTAuNTE5LDAuMzIyLTAuNzc2DQoJCQljMC4wOTktMC4yMjksMC4yMDQtMC40NTUsMC4zMDgtMC42ODFjMC4xMjMtMC4yNjcsMC4yNDUtMC41MzYsMC4zNzQtMC43OTljMC4wOTYtMC4xOTYsMC4xOTktMC4zODgsMC4yOTktMC41ODINCgkJCWMwLjE0OC0wLjI4OCwwLjI5NC0wLjU3NiwwLjQ1LTAuODU5YzAuMDYtMC4xMSwwLjEyNi0wLjIxNiwwLjE4Ny0wLjMyNWMwLjY5My0xLjIyNywxLjQ1NC0yLjQxMSwyLjI4Ni0zLjU0DQoJCQljMC4wMDgtMC4wMTEsMC4wMTUtMC4wMjEsMC4wMjMtMC4wMzJjMC4yNjgtMC4zNjIsMC41NDUtMC43MTcsMC44MjYtMS4wNjljMC4wNDUtMC4wNTYsMC4wODgtMC4xMTMsMC4xMzMtMC4xNjkNCgkJCWMwLjI3NS0wLjM0LDAuNTU5LTAuNjczLDAuODQ2LTEuMDAyYzAuMDUzLTAuMDYxLDAuMTA2LTAuMTIzLDAuMTYtMC4xODRjMC4yOTItMC4zMywwLjU5MS0wLjY1MywwLjg5Ni0wLjk3Mg0KCQkJYzAuMDUtMC4wNTIsMC4wOTktMC4xMDUsMC4xNS0wLjE1N2MwLjMxNi0wLjMyNiwwLjYzOC0wLjY0NywwLjk2Ni0wLjk2MWMwLjAzNy0wLjAzNSwwLjA3NC0wLjA3LDAuMTExLTAuMTA2DQoJCQljMC4zNDYtMC4zMjgsMC42OTgtMC42NSwxLjA1OC0wLjk2NGMwLjAxMi0wLjAxMSwwLjAyNS0wLjAyMSwwLjAzNy0wLjAzMmM0LjU5Ni00LjAwMywxMC4yNTItNi44MjYsMTYuNDk0LTcuOTg4DQoJCQljMC4wMDMtMC4wMDEsMC4wMDctMC4wMDEsMC4wMS0wLjAwMmMwLjUxMS0wLjA5NSwxLjAyNy0wLjE3OSwxLjU0Ni0wLjI1MWMwLjAzMS0wLjAwNCwwLjA2Mi0wLjAwOCwwLjA5My0wLjAxMg0KCQkJYzAuNDk1LTAuMDY4LDAuOTkzLTAuMTI2LDEuNDk0LTAuMTczYzAuMDc2LTAuMDA3LDAuMTUzLTAuMDExLDAuMjMtMC4wMTdjMC40NTktMC4wNCwwLjkxOS0wLjA3NCwxLjM4My0wLjA5Ng0KCQkJYzAuMjY4LTAuMDEyLDAuNTM4LTAuMDE0LDAuODA4LTAuMDIxYzAuMjktMC4wMDcsMC41NzktMC4wMiwwLjg3MS0wLjAyYzE3LjIyNCwwLDMwLjg1NSwxMi4zODUsMzQuMDgsMjkuODI5SDQxMS4xMnoiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHBhdGggZD0iTTUxMS45OTIsMTkxLjgzMWMtMC4wMDEtMC4wODctMC4wMDMtMC4xNzQtMC4wMDYtMC4yNjJjLTAuMDMtMC43MDYtMC4xNTctMS4zODYtMC4zNy0yLjAzDQoJCQljLTAuMDEtMC4wMzItMC4wMTQtMC4wNjUtMC4wMjUtMC4wOTZjLTAuMDA5LTAuMDI2LTAuMDI0LTAuMDUtMC4wMzMtMC4wNzZjLTAuMTE4LTAuMzI5LTAuMjU0LTAuNjQ5LTAuNDE0LTAuOTU1DQoJCQljLTAuMDItMC4wMzgtMC4wNDMtMC4wNzMtMC4wNjMtMC4xMTFjLTAuMTQ4LTAuMjctMC4zMTItMC41MjktMC40OTEtMC43NzhjLTAuMDM4LTAuMDUzLTAuMDc0LTAuMTA4LTAuMTEzLTAuMTYNCgkJCWMtMC4xOTctMC4yNi0wLjQxMS0wLjUwNi0wLjY0LTAuNzM4Yy0wLjA1LTAuMDUxLTAuMTAzLTAuMDk4LTAuMTU0LTAuMTQ3Yy0wLjIxNi0wLjIwOC0wLjQ0NC0wLjQwMy0wLjY4NC0wLjU4NA0KCQkJYy0wLjAzMi0wLjAyNC0wLjA2Mi0wLjA1MS0wLjA5NS0wLjA3NWMtMC4yNy0wLjE5Ni0wLjU1Ni0wLjM3MS0wLjg1MS0wLjUzMWMtMC4wNTctMC4wMzEtMC4xMTQtMC4wNTktMC4xNzItMC4wODgNCgkJCWMtMC4zMDEtMC4xNTItMC42MDktMC4yOTEtMC45MzItMC40MDJjLTAuMDAyLTAuMDAxLTAuMDA0LTAuMDAyLTAuMDA2LTAuMDAyYy0wLjMyMS0wLjExLTAuNjU0LTAuMTkzLTAuOTkzLTAuMjYNCgkJCWMtMC4wNzUtMC4wMTUtMC4xNS0wLjAyOC0wLjIyNi0wLjA0Yy0wLjMzOS0wLjA1Ni0wLjY4My0wLjA5OC0xLjAzNi0wLjEwN2MtNjIuNzk4LTEuNjI1LTE0NC42ODQsMTMuNDkyLTE4Ni4wODMsNjAuNzUyDQoJCQljLTE4LjExOCwyMC42ODMtMjYuNDc4LDQ2LjkyMy0zNC41NjIsNzIuMjk4Yy0wLjY2MiwyLjA3Ny0xLjMyMyw0LjE1My0xLjk5LDYuMjI2Yy0wLjAyOCwwLjA4Ny0wLjA1NSwwLjE3NS0wLjA4LDAuMjY0DQoJCQlsLTEyLjY4NCw0NS4wNDljLTEuMTIzLDMuOTg5LDEuMjAxLDguMTM1LDUuMTksOS4yNTljMC42OCwwLjE5MiwxLjM2NSwwLjI4MiwyLjAzOCwwLjI4MmMzLjI3NywwLDYuMjg5LTIuMTY0LDcuMjIxLTUuNDc0DQoJCQlsMTEuNzY0LTQxLjc4MmMxNC4zODEtNi43NCwyNS45NjEtOS44OTIsNDEuNjAzLTE0LjE0NWM4LjExNC0yLjIwOCwxNy4zMTEtNC43MDgsMjguNDQtOC4xMzENCgkJCWMyNC4wNi03LjQsNzAuMjE2LTM4LjM2LDkxLjQ1OC02MS4zNDdjMTguNTc4LTIwLjEwNiwzNC4yMTEtMzUuMDQ4LDUyLjI3MS00OS45NjFjMC4wMjEtMC4wMTcsMC4wMzctMC4wMzgsMC4wNTgtMC4wNTYNCgkJCWMwLjI2My0wLjIyMywwLjUxMy0wLjQ2LDAuNzQzLTAuNzE3YzAuMDE0LTAuMDE2LDAuMDI5LTAuMDMsMC4wNDMtMC4wNDVjMC4yMjctMC4yNTcsMC40MzMtMC41MzMsMC42MjQtMC44MjENCgkJCWMwLjAzNS0wLjA1MywwLjA2OS0wLjEwNiwwLjEwMy0wLjE2YzAuMzYtMC41NzMsMC42NDQtMS4xOTYsMC44NC0xLjg2YzAuMDE5LTAuMDYzLDAuMDM3LTAuMTI1LDAuMDU0LTAuMTg5DQoJCQljMC4wODctMC4zMjYsMC4xNTktMC42NTgsMC4yMDItMWMwLjAwMi0wLjAxNCwwLjAwMi0wLjAyNywwLjAwMy0wLjA0MWMwLjAyOC0wLjIzMiwwLjA0OC0wLjQ2NywwLjA1NC0wLjcwNQ0KCQkJQzUxMi4wMDEsMTkxLjk5OSw1MTEuOTkzLDE5MS45MTUsNTExLjk5MiwxOTEuODMxeiBNMzI5Ljg5NywyNTUuMDMxYzE3LjQ2OS0xOS45NDMsNDQuMjQ0LTM0Ljk3Niw3OS41ODItNDQuNjgNCgkJCWM5LjQ5Ny0yLjYwOCwxOS41MzMtNC43NzIsMjkuODc2LTYuNDhjLTI2LjI4MSwxMi43NDUtNTEuNDEsMjguNzA4LTY1LjQ1MywzOC4wODljLTIyLjY2MywxNS4xNC00Ny4xMjcsMzMuNTA1LTY1LjE5Myw0OS44MzkNCgkJCUMzMTQuMDU1LDI3OC4yNTcsMzIwLjUxOCwyNjUuNzM4LDMyOS44OTcsMjU1LjAzMXogTTQ0NS45NzksMjM3LjQ1MmMtMjAuNjc0LDIyLjM3My02NS4zMjUsNTEuMTgzLTg0Ljg0Niw1Ny4xODYNCgkJCWMtMTAuODk0LDMuMzUtMTkuOTY0LDUuODE4LTI3Ljk2Nyw3Ljk5NGMtNy4yNDEsMS45NjktMTMuODI4LDMuNzYzLTIwLjM0Miw1LjgzMWMyLjkxNC0yLjc5MSw2LjMzLTUuOTIsMTAuMzU3LTkuNDMzDQoJCQljMTYuMjA2LTE0LjEzNiwzNy4xOC0yOS45NzEsNTkuMDU5LTQ0LjU4N2MzNy44ODItMjUuMzA3LDcyLjE2NC00My4wNzEsOTcuMzE1LTUwLjc3Mg0KCQkJQzQ2OC42MzIsMjEzLjczMSw0NTcuODg4LDIyNC41NjMsNDQ1Ljk3OSwyMzcuNDUyeiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjwvc3ZnPg0K',
            },
            {
                value:
                    'server-monitor',
                label:
                    'Server',
                icon:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgNDgwIDQ4MCIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNDgwIDQ4MDsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik00NTYsMTQ0YzEzLjI1NSwwLDI0LTEwLjc0NSwyNC0yNFYyNGMwLTEzLjI1NS0xMC43NDUtMjQtMjQtMjRIMjRDMTAuNzQ1LDAsMCwxMC43NDUsMCwyNHY5NmMwLDEzLjI1NSwxMC43NDUsMjQsMjQsMjQNCgkJCWgyNHYyNEgyNGMtMTMuMjU1LDAtMjQsMTAuNzQ1LTI0LDI0djk2YzAsMTMuMjU1LDEwLjc0NSwyNCwyNCwyNGgyNHYyNEgyNGMtMTMuMjU1LDAtMjQsMTAuNzQ1LTI0LDI0djk2DQoJCQljMCwxMy4yNTUsMTAuNzQ1LDI0LDI0LDI0aDQzMmMxMy4yNTUsMCwyNC0xMC43NDUsMjQtMjR2LTk2YzAtMTMuMjU1LTEwLjc0NS0yNC0yNC0yNGgtMjR2LTI0aDI0YzEzLjI1NSwwLDI0LTEwLjc0NSwyNC0yNHYtOTYNCgkJCWMwLTEzLjI1NS0xMC43NDUtMjQtMjQtMjRoLTI0di0yNEg0NTZ6IE00NTYsMzUyYzQuNDE4LDAsOCwzLjU4Miw4LDh2OTZjMCw0LjQxOC0zLjU4Miw4LTgsOEgyNGMtNC40MTgsMC04LTMuNTgyLTgtOHYtOTYNCgkJCWMwLTQuNDE4LDMuNTgyLTgsOC04SDQ1NnogTTY0LDMzNnYtMjRoMTZ2MjRINjR6IE05NiwzMzZ2LTI0aDI4OHYyNEg5NnogTTQwMCwzMzZ2LTI0aDE2djI0SDQwMHogTTQ1NiwxODRjNC40MTgsMCw4LDMuNTgyLDgsOA0KCQkJdjk2YzAsNC40MTgtMy41ODIsOC04LDhIMjRjLTQuNDE4LDAtOC0zLjU4Mi04LTh2LTk2YzAtNC40MTgsMy41ODItOCw4LThINDU2eiBNNjQsMTY4di0yNGgxNnYyNEg2NHogTTk2LDE2OHYtMjRoMjg4djI0SDk2eg0KCQkJIE00MDAsMTY4di0yNGgxNnYyNEg0MDB6IE0yNCwxMjhjLTQuNDE4LDAtOC0zLjU4Mi04LThWMjRjMC00LjQxOCwzLjU4Mi04LDgtOGg0MzJjNC40MTgsMCw4LDMuNTgyLDgsOHY5NmMwLDQuNDE4LTMuNTgyLDgtOCw4DQoJCQlIMjR6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik0yNTYsNjRIOTQuNTI4QzkwLjExLDUxLjUwMyw3Ni4zOTcsNDQuOTU0LDYzLjkwMSw0OS4zNzNTNDQuODU1LDY3LjUwMyw0OS4yNzMsODBzMTguMTMxLDE5LjA0NiwzMC42MjcsMTQuNjI3DQoJCQlDODYuNzM1LDkyLjIxMSw5Mi4xMTIsODYuODM1LDk0LjUyOCw4MEgyNTZjNC40MTgsMCw4LTMuNTgyLDgtOFMyNjAuNDE4LDY0LDI1Niw2NHogTTcyLDgwYy00LjQxOCwwLTgtMy41ODItOC04czMuNTgyLTgsOC04DQoJCQlzOCwzLjU4Miw4LDhTNzYuNDE4LDgwLDcyLDgweiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSIzNTIiIHk9IjMyIiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iMzg0IiB5PSIzMiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjQxNiIgeT0iMzIiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSIzMjAiIHk9IjMyIiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iMjg4IiB5PSIzMiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjM1MiIgeT0iNjQiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSIzODQiIHk9IjY0IiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iNDE2IiB5PSI2NCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjMyMCIgeT0iNjQiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSIyODgiIHk9IjY0IiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iMzUyIiB5PSI5NiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjM4NCIgeT0iOTYiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSI0MTYiIHk9Ijk2IiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iMzIwIiB5PSI5NiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjI4OCIgeT0iOTYiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cGF0aCBkPSJNMjU2LDIzMkg5NC41MjhjLTQuNDE4LTEyLjQ5Ny0xOC4xMzEtMTkuMDQ2LTMwLjYyNy0xNC42MjdTNDQuODU1LDIzNS41MDMsNDkuMjczLDI0OHMxOC4xMzEsMTkuMDQ2LDMwLjYyNywxNC42MjcNCgkJCWM2LjgzNS0yLjQxNiwxMi4yMTEtNy43OTMsMTQuNjI3LTE0LjYyN0gyNTZjNC40MTgsMCw4LTMuNTgyLDgtOFMyNjAuNDE4LDIzMiwyNTYsMjMyeiBNNzIsMjQ4Yy00LjQxOCwwLTgtMy41ODItOC04czMuNTgyLTgsOC04DQoJCQlzOCwzLjU4Miw4LDhTNzYuNDE4LDI0OCw3MiwyNDh6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjM1MiIgeT0iMjAwIiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iMzg0IiB5PSIyMDAiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSI0MTYiIHk9IjIwMCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjMyMCIgeT0iMjAwIiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iMjg4IiB5PSIyMDAiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSIzNTIiIHk9IjIzMiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjM4NCIgeT0iMjMyIiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iNDE2IiB5PSIyMzIiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSIzMjAiIHk9IjIzMiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjI4OCIgeT0iMjMyIiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iMzUyIiB5PSIyNjQiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSIzODQiIHk9IjI2NCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjQxNiIgeT0iMjY0IiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iMzIwIiB5PSIyNjQiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSIyODgiIHk9IjI2NCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik0yNTYsNDAwSDk0LjUyOGMtNC40MTgtMTIuNDk3LTE4LjEzMS0xOS4wNDYtMzAuNjI3LTE0LjYyN1M0NC44NTUsNDAzLjUwMyw0OS4yNzMsNDE2czE4LjEzMSwxOS4wNDYsMzAuNjI3LDE0LjYyNw0KCQkJYzYuODM1LTIuNDE2LDEyLjIxMS03Ljc5MywxNC42MjctMTQuNjI3SDI1NmM0LjQxOCwwLDgtMy41ODIsOC04UzI2MC40MTgsNDAwLDI1Niw0MDB6IE03Miw0MTZjLTQuNDE4LDAtOC0zLjU4Mi04LThzMy41ODItOCw4LTgNCgkJCXM4LDMuNTgyLDgsOFM3Ni40MTgsNDE2LDcyLDQxNnoiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iMzUyIiB5PSIzNjgiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSIzODQiIHk9IjM2OCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjQxNiIgeT0iMzY4IiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iMzIwIiB5PSIzNjgiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSIyODgiIHk9IjM2OCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjM1MiIgeT0iNDAwIiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iMzg0IiB5PSI0MDAiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSI0MTYiIHk9IjQwMCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjMyMCIgeT0iNDAwIiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iMjg4IiB5PSI0MDAiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSIzNTIiIHk9IjQzMiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjM4NCIgeT0iNDMyIiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHJlY3QgeD0iNDE2IiB5PSI0MzIiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cmVjdCB4PSIzMjAiIHk9IjQzMiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxyZWN0IHg9IjI4OCIgeT0iNDMyIiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8L3N2Zz4NCg==',
            },
            {
                value:
                    'incomingHttpRequest',
                label:
                    'Incoming HTTP Request',
                icon:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE2LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAxLjEvL0VOIiAiaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkIj4NCjxzdmcgdmVyc2lvbj0iMS4xIiBpZD0iQ2FwYV8xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4PSIwcHgiIHk9IjBweCINCgkgd2lkdGg9IjM1My42MnB4IiBoZWlnaHQ9IjM1My42MnB4IiB2aWV3Qm94PSIwIDAgMzUzLjYyIDM1My42MiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgMzUzLjYyIDM1My42MjsiDQoJIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik05OC41MzYsMTYwLjk5MmMtMy45MDIsOC41ODcsMC4zODgsMjAuOTk3LDExLjc4OSwzNC4wNjNsMzMuNDM4LDM4LjM0OWM5LjA1NCwxMC4zOSwyMS4xNzMsMTYuMDkyLDM0LjEwNiwxNi4wOTINCgkJCWMxMi45MjYsMCwyNS4wMjYtNS43MDIsMzQuMDg2LTE2LjA5MmwzMy40NDgtMzguMzQ5YzExLjU5My0xMy4zMDUsMTYuMDA2LTI1Ljg0OCwxMi4xMjEtMzQuMzk2DQoJCQljLTEuNTQ5LTMuNDEzLTUuODI5LTkuMTE4LTE3LjEzOC05LjExOGgtMTcuMjA0Yy00LjM2MiwwLTcuOTAxLTMuNTM5LTcuOTAxLTcuODk4VjY2LjE5MWMwLTI4LjE1Ny0yMi45MDctNTEuMDU5LTUxLjA1Ny01MS4wNTkNCgkJCUg2Ni40NDVjLTE1LjM1NSwwLTI1Ljk1OCw0Ljc0OC0yOS44NDYsMTMuNDA2Yy0zLjQ5MSw3Ljc2Ny0wLjgzLDE3LjIyNSw3LjQ5LDI2LjU2OEM1OS45Miw3Mi45Myw3NC44MjksODcuNjcxLDk3LjAyNyw4Ny42NzENCgkJCWgzNy43ODVjNC4zNjIsMCw3LjkwMSwzLjU0LDcuOTAxLDcuODk5djQ4LjA2NWMwLDQuMzU5LTMuNTM5LDcuODk4LTcuOTAxLDcuODk4aC0xOC4zNDQNCgkJCUMxMDQuNjExLDE1MS41NDIsMTAwLjE0OCwxNTcuNDY4LDk4LjUzNiwxNjAuOTkyeiBNMTQ4LjI5Nyw3Ni41MDdoLTUxLjI3Yy0xNy41ODUsMC0zMC4wNzQtMTIuNDc0LTQ0LjU5NS0yOC44MjUNCgkJCWMtNS4xNDQtNS43NzYtNy4yMDYtMTEuMS01LjYzNC0xNC41NTNjMS44ODEtNC4yMzUsOS40MTctNi44NCwxOS42NTQtNi44NGg5Ny43NzFjMjEuOTg1LDAsMzkuODg1LDE3Ljg5OSwzOS44ODUsMzkuOTAydjkwLjkzNw0KCQkJYzAsMy4wODIsMi40OTgsNS41Nyw1LjU4MSw1LjU3aDMwLjY5NmMyLjE2OCwwLDUuOTUxLDAuMzU1LDYuOTcyLDIuNTljMS4wODcsMi4zOTUsMC4zMiwxMC4xNTEtMTAuMzc0LDIyLjQzbC0zMy40NDMsMzguMzQ0DQoJCQljLTYuOTAxLDcuOTI3LTE2LjAyNiwxMi4yNzgtMjUuNjgsMTIuMjc4Yy05LjY1NiwwLTE4Ljc4OS00LjM3Ny0yNS42ODUtMTIuMjc4bC0zMy40NDgtMzguMzQ0DQoJCQljLTEwLjQzNi0xMS45NjEtMTEuMTI0LTE5LjY4OC0xMC4wMzItMjIuMDk3YzEuMTUzLTIuNTI5LDUuMzYyLTIuOTIzLDcuNzY0LTIuOTIzaDMxLjgyOWMzLjA4MywwLDUuNTg2LTIuNDkxLDUuNTg2LTUuNTdWODIuMDkzDQoJCQlDMTUzLjg4Myw3OS4wMTQsMTUxLjM4LDc2LjUwNywxNDguMjk3LDc2LjUwN3oiLz4NCgkJPHBhdGggZD0iTTMzMy4xNDEsMjIyLjYxOGgtNzkuODA2Yy0xLjU5NCwwLTMuMTE3LDAuNzA2LTQuMTc5LDEuODc5bC00Ni4yNDUsNTIuMTc3Yy01LjkyNiw2LjY4My0xNC4zODYsMTAuNTA2LTIzLjIzNCwxMC41MDYNCgkJCWMtNy43NDEsMC0xNS4xOTEtMi45MTUtMjAuOTgyLTguMTk1bC02MC4wMDEtNTQuODk4Yy0xLjAzNC0wLjkzOS0yLjM2OS0xLjQ3My0zLjc3Ni0xLjQ3M2gtNzQuNDQNCgkJCUM5LjE3OSwyMjIuNjEzLDAsMjMxLjc4NCwwLDI0My4wNzd2MzcuNDk2YzAsMzEuOTE1LDI5LjIyMSw1Ny45MTQsNjUuMTQzLDU3LjkxNGgyMjMuMzMyYzM1LjkyMiwwLDY1LjE0Ni0yNS45OTksNjUuMTQ2LTU3LjkxNA0KCQkJdi0zNy40OTZDMzUzLjYyLDIzMS43ODksMzQ0LjQzNSwyMjIuNjE4LDMzMy4xNDEsMjIyLjYxOHogTTI4OC40NzUsMzI3LjM0Mkg2NS4xNDNjLTI5Ljc2NywwLTUzLjk4MS0yMC45OTctNTMuOTgxLTQ2Ljc1OA0KCQkJdi0zNy40OTZjMC01LjEwOCw0LjE3OS05LjI4OCw5LjMxNS05LjI4OGg2NC4zNzZjNC4zNjIsMCwxMC41MDYsMi4zODIsMTMuNzMxLDUuMzMybDUyLjU4Myw0OC4xMDkNCgkJCWM3Ljg0NSw3LjE0OSwxNy45NjMsMTEuMDksMjguNTAyLDExLjA5YzEyLjA1LDAsMjMuNTU3LTUuMTc1LDMxLjU4NS0xNC4yNDlsMzkuMzU5LTQ0LjM4MWMyLjg5LTMuMjY2LDguNzc0LTUuOTExLDEzLjEzNy01LjkxMQ0KCQkJaDY5LjM4NmM1LjEzNCwwLDkuMzEyLDQuMTQ4LDkuMzEyLDkuMjg3djM3LjQ5NkMzNDIuNDQ4LDMwNi4zMzQsMzE4LjIzNywzMjcuMzQyLDI4OC40NzUsMzI3LjM0MnoiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8L3N2Zz4NCg==',
            },
        ];


        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        <ShouldRender if={!this.props.edit}>
                                            <span>New Monitor</span>
                                        </ShouldRender>

                                        <ShouldRender if={this.props.edit}>
                                            <span>
                                                Edit Monitor
                                                {this.props.editMonitorProp &&
                                                this.props.editMonitorProp.name
                                                    ? ' - ' +
                                                      this.props.editMonitorProp
                                                          .name
                                                    : null}
                                            </span>
                                        </ShouldRender>
                                    </span>
                                </span>
                                <p>
                                    <ShouldRender if={!this.props.edit}>
                                        <span>
                                            Monitor any resources (Websites,
                                            API, Servers, IoT Devices and more)
                                            constantly and notify your team when
                                            they do not behave the way you want.
                                        </span>
                                    </ShouldRender>
                                    <ShouldRender if={this.props.edit}>
                                        <span>
                                            Edit Name and URL of
                                            {this.props.editMonitorProp &&
                                            this.props.editMonitorProp.name
                                                ? ` ${this.props.editMonitorProp.name}`
                                                : ''}
                                        </span>
                                    </ShouldRender>
                                </p>
                            </div>
                        </div>

                        <form
                            id="form-new-monitor"
                            onSubmit={handleSubmit(this.submitForm)}
                        >
                            <div
                                className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                                style={{ boxShadow: 'none' }}
                            >
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                            <div className="bs-ContentSection-content Box-root  Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                                <div className="Box-root">
                                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                        <span>Basic Configuration</span>
                                                    </span>
                                                    <p>
                                                        <span>
                                                            Basic Configuration for your new Monitor.
                                                        </span>
                                                    </p>
                                                </div>
                                            </div>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Name
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={
                                                                RenderField
                                                            }
                                                            type="text"
                                                            name={`name_${this.props.index}`}
                                                            id="name"
                                                            placeholder="Home Page"
                                                            disabled={
                                                                requesting
                                                            }
                                                            validate={
                                                                ValidateField.text
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                                <ShouldRender
                                                    if={
                                                        resourceCategoryList &&
                                                        resourceCategoryList.length >
                                                            0
                                                    }
                                                >
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Resource Category
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <span className="flex">
                                                                <Field
                                                                    className="db-select-nw"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    name={`resourceCategory_${this.props.index}`}
                                                                    id="resourceCategory"
                                                                    placeholder="Choose Resource Category"
                                                                    disabled={
                                                                        requesting
                                                                    }
                                                                    options={[
                                                                        {
                                                                            value:
                                                                                '',
                                                                            label:
                                                                                'Select resource category',
                                                                        },
                                                                        ...(resourceCategoryList &&
                                                                        resourceCategoryList.length >
                                                                            0
                                                                            ? resourceCategoryList.map(
                                                                                  category => ({
                                                                                      value:
                                                                                          category._id,
                                                                                      label:
                                                                                          category.name,
                                                                                  })
                                                                              )
                                                                            : []),
                                                                    ]}
                                                                />
                                                                <Tooltip title="Resource Category">
                                                                    <div>
                                                                        <p>
                                                                            Resource
                                                                            Categories
                                                                            lets
                                                                            you
                                                                            group
                                                                            resources
                                                                            by
                                                                            categories
                                                                            on
                                                                            Status
                                                                            Page.
                                                                        </p>
                                                                    </div>
                                                                </Tooltip>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={!this.props.edit}
                                                >
                                                    <div className="bs-Fieldset-row" style={{
                                                                            marginTop:'20px',                                                                       
                                                                        }}>
                                                        <label className="bs-Fieldset-label">
                                                            Monitor Type
                                                        </label>

                                                        <div className="bs-Fieldset-fields">
                                                            <span className="flex">
                                                            <div className="price-list-3c">
                                                                {monitorTypesOptions.map((el)=>(
                                                                    <label
                                                                    // key={plan.planId}
                                                                    // htmlFor={`${plan.category}_${plan.type}`}
                                                                    style={{
                                                                        cursor: 'pointer',
                                                                        display:'block',
                                                                        border:'1px solid rgba(0,0,0,0.2)',
                                                                        textAlign:'center',
                                                                        listStyle:'none',}                                                                        
                                                                    }>
                                                                        <div className={`bs-Fieldset-fields Flex-justifyContent--center monitor-type-item Box-background--white`}
                                                                        style={{
                                                                            flex: 1,
                                                                            padding: 0,                                                                        
                                                                        }}>                                                                           
                                                                            <span
                                                                                style={{
                                                                                    marginBottom: '4px',
                                                                                }}
                                                                            >
                                                                                <img src={el.icon}
                                                                            style={{
                                                                                width:'40%',
                                                                                height:'100%',
                                                                            }}/>
                                                                            </span>
                                                                            <div
                                                                                className="radioButtonClass"
                                                                                style={{ width: '100%', display: 'flex',
                                                                                alignItems: 'center',
                                                                                justifyContent: 'center',
                                                                                color: '#4c4c4c', }}
                                                                            >
                                                                                <Field
                                                                                    required={true}
                                                                                    component="input"
                                                                                    type="radio"
                                                                                    id="type"
                                                                                    name={`type_${this.props.index}`}
                                                                                    className="Margin-right--4"
                                                                                    validate={
                                                                                        ValidateField.select
                                                                                    }                                
                                                                                    // id={id}
                                                                                    //value={value}
                                                                                />
                                                                                {/* <label htmlFor={id}>{details}</label> */}
                                                                            </div>
                                                                        </div>
                                                                    </label>
                                                                ))}
                                                            </div>                                                                        
                                                                {/* <Field
                                                                    className="db-select-nw"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    name={`type_${this.props.index}`}
                                                                    id="type"
                                                                    placeholder="Monitor Type"
                                                                    disabled={
                                                                        requesting
                                                                    }
                                                                    onChange={(
                                                                        e,
                                                                        v
                                                                    ) =>
                                                                        this.changeBox(
                                                                            e,
                                                                            v
                                                                        )
                                                                    }
                                                                    validate={
                                                                        ValidateField.select
                                                                    }
                                                                    options={[
                                                                        {
                                                                            value:
                                                                                '',
                                                                            label:
                                                                                'Select monitor type',
                                                                        },
                                                                        {
                                                                            value:
                                                                                'url',
                                                                            label:
                                                                                'Website',
                                                                        },
                                                                        {
                                                                            value:
                                                                                'device',
                                                                            label:
                                                                                'IoT Device',
                                                                        },
                                                                        {
                                                                            value:
                                                                                'manual',
                                                                            label:
                                                                                'Manual',
                                                                        },
                                                                        {
                                                                            value:
                                                                                'api',
                                                                            label:
                                                                                'API',
                                                                        },
                                                                        {
                                                                            value:
                                                                                'script',
                                                                            label:
                                                                                'Script',
                                                                        },
                                                                        {
                                                                            value:
                                                                                'server-monitor',
                                                                            label:
                                                                                'Server',
                                                                        },
                                                                        {
                                                                            value:
                                                                                'incomingHttpRequest',
                                                                            label:
                                                                                'Incoming HTTP Request',
                                                                        },
                                                                    ]}
                                                                /> */}
                                                                <Tooltip title="Monitor Types">
                                                                    <div>
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                What
                                                                                are
                                                                                monitors?
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            Monitors
                                                                            lets
                                                                            you
                                                                            monitor
                                                                            any
                                                                            reosurces
                                                                            you
                                                                            have
                                                                            like
                                                                            API&#39;s,
                                                                            Websites,
                                                                            Servers,
                                                                            Containers,
                                                                            IoT
                                                                            device
                                                                            or
                                                                            more.{' '}
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                Website
                                                                                Monitors
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            Monitor
                                                                            your
                                                                            website
                                                                            and
                                                                            get
                                                                            notified
                                                                            when
                                                                            it
                                                                            goes
                                                                            down
                                                                            or
                                                                            performs
                                                                            poorly.
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                IoT
                                                                                Device
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            Monitor
                                                                            IoT
                                                                            devices
                                                                            constantly
                                                                            and
                                                                            notify
                                                                            your
                                                                            team
                                                                            when
                                                                            they
                                                                            do
                                                                            not
                                                                            behave
                                                                            the
                                                                            way
                                                                            you
                                                                            want.{' '}
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                Manual
                                                                                Monitors
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            <>
                                                                                Manual
                                                                                monitors
                                                                                do
                                                                                not
                                                                                monitor
                                                                                any
                                                                                resource.
                                                                                You
                                                                                can
                                                                                change
                                                                                monitor
                                                                                status
                                                                                by
                                                                                using{' '}
                                                                                <a href="https://fyipe.com/docs">
                                                                                    Fyipe’s
                                                                                    API
                                                                                </a>

                                                                                .
                                                                                This
                                                                                is
                                                                                helpful
                                                                                when
                                                                                you
                                                                                use
                                                                                different
                                                                                monitoring
                                                                                tool
                                                                                but
                                                                                want
                                                                                to
                                                                                record
                                                                                monitor
                                                                                status
                                                                                on
                                                                                Fyipe.
                                                                            </>{' '}
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                API
                                                                                Monitor
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            <>
                                                                                Monitor{' '}
                                                                                <a href="https://en.wikipedia.org/wiki/Representational_state_transfer">
                                                                                    REST
                                                                                </a>{' '}
                                                                                endpoints
                                                                                constantly
                                                                                and
                                                                                notify
                                                                                your
                                                                                team
                                                                                when
                                                                                they
                                                                                do
                                                                                not
                                                                                behave
                                                                                the
                                                                                way
                                                                                you
                                                                                want.
                                                                            </>{' '}
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                Script
                                                                                Monitor
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            Run
                                                                            custom
                                                                            JavaScript
                                                                            script
                                                                            and
                                                                            alerts
                                                                            you
                                                                            when
                                                                            script
                                                                            fails.
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                Server
                                                                                Monitor
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            Monitor
                                                                            servers
                                                                            constantly
                                                                            and
                                                                            notify
                                                                            your
                                                                            team
                                                                            when
                                                                            they
                                                                            do
                                                                            not
                                                                            behave
                                                                            the
                                                                            way
                                                                            you
                                                                            want.
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                Incoming
                                                                                HTTP
                                                                                Request
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            Receives
                                                                            incoming
                                                                            HTTP
                                                                            get
                                                                            or
                                                                            post
                                                                            request
                                                                            and
                                                                            evaluates
                                                                            response
                                                                            body.
                                                                        </p>
                                                                    </div>
                                                                </Tooltip>
                                                            </span>
                                                            <span
                                                                className="Text-color--inherit Text-display--inline Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                                style={{
                                                                    marginTop: 10,
                                                                }}
                                                            >
                                                                <span>
                                                                    {
                                                                        this
                                                                            .monitorTypeDescription[
                                                                            [
                                                                                this
                                                                                    .state
                                                                                    .type,
                                                                            ]
                                                                        ]
                                                                    }
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </ShouldRender>

                                                <ShouldRender
                                                    if={
                                                        type ===
                                                            'server-monitor' &&
                                                        !this.props.edit
                                                    }
                                                >
                                                {this.renderMonitorConfiguration("Server")}                                                    
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Mode
                                                        </label>

                                                        <div className="bs-Fieldset-fields">
                                                            <span className="flex">
                                                                <Field
                                                                    className="db-select-nw"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    name={`mode_${this.props.index}`}
                                                                    id="mode"
                                                                    placeholder="Mode"
                                                                    disabled={
                                                                        requesting
                                                                    }
                                                                    onChange={(
                                                                        e,
                                                                        v
                                                                    ) =>
                                                                        this.changeMode(
                                                                            e,
                                                                            v
                                                                        )
                                                                    }
                                                                    validate={
                                                                        ValidateField.select
                                                                    }
                                                                    options={[
                                                                        {
                                                                            value:
                                                                                '',
                                                                            label:
                                                                                'Select monitoring mode',
                                                                        },
                                                                        {
                                                                            value:
                                                                                'agent',
                                                                            label:
                                                                                'Agent',
                                                                        },
                                                                        {
                                                                            value:
                                                                                'agentless',
                                                                            label:
                                                                                'Agentless',
                                                                        },
                                                                    ]}
                                                                ></Field>
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <ShouldRender
                                                        if={
                                                            mode === 'agentless'
                                                        }
                                                    >
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">
                                                                Host
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    type="text"
                                                                    name={`host_${this.props.index}`}
                                                                    id="host"
                                                                    placeholder="example.compute-1.amazonaws.com"
                                                                    disabled={
                                                                        requesting
                                                                    }
                                                                    validate={
                                                                        ValidateField.text
                                                                    }
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">
                                                                Port
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    type="text"
                                                                    name={`port_${this.props.index}`}
                                                                    id="port"
                                                                    placeholder="22"
                                                                    disabled={
                                                                        requesting
                                                                    }
                                                                    validate={
                                                                        ValidateField.text
                                                                    }
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">
                                                                Username
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    type="text"
                                                                    name={`username_${this.props.index}`}
                                                                    id="username"
                                                                    placeholder="root"
                                                                    disabled={
                                                                        requesting
                                                                    }
                                                                    validate={
                                                                        ValidateField.text
                                                                    }
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">
                                                                Authentication
                                                                Method
                                                            </label>

                                                            <div className="bs-Fieldset-fields">
                                                                <span className="flex">
                                                                    <Field
                                                                        className="db-select-nw"
                                                                        component={
                                                                            RenderSelect
                                                                        }
                                                                        name={`authentication_${this.props.index}`}
                                                                        id="authentication"
                                                                        placeholder="Authentication Method"
                                                                        disabled={
                                                                            requesting
                                                                        }
                                                                        onChange={(
                                                                            e,
                                                                            v
                                                                        ) =>
                                                                            this.changeAuthentication(
                                                                                e,
                                                                                v
                                                                            )
                                                                        }
                                                                        validate={
                                                                            ValidateField.select
                                                                        }
                                                                        options={[
                                                                            {
                                                                                value:
                                                                                    '',
                                                                                label:
                                                                                    'Select authentication method',
                                                                            },
                                                                            {
                                                                                value:
                                                                                    'password',
                                                                                label:
                                                                                    'Password',
                                                                            },
                                                                            {
                                                                                value:
                                                                                    'identityFile',
                                                                                label:
                                                                                    'Identity File',
                                                                            },
                                                                        ]}
                                                                    ></Field>
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <ShouldRender
                                                            if={
                                                                authentication ===
                                                                'password'
                                                            }
                                                        >
                                                            <div className="bs-Fieldset-row">
                                                                <label className="bs-Fieldset-label">
                                                                    Password
                                                                </label>
                                                                <div className="bs-Fieldset-fields">
                                                                    <Field
                                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                        component={
                                                                            RenderField
                                                                        }
                                                                        type="password"
                                                                        name={`password_${this.props.index}`}
                                                                        id="password"
                                                                        placeholder="Password"
                                                                        disabled={
                                                                            requesting
                                                                        }
                                                                        validate={
                                                                            ValidateField.text
                                                                        }
                                                                    />
                                                                </div>
                                                            </div>
                                                        </ShouldRender>

                                                        <ShouldRender
                                                            if={
                                                                authentication ===
                                                                'identityFile'
                                                            }
                                                        >
                                                            <div className="bs-Fieldset-row">
                                                                <label className="bs-Fieldset-label">
                                                                    Identity
                                                                    File
                                                                </label>
                                                                <div className="bs-Fieldset-fields">
                                                                    <div
                                                                        className="Box-root Flex-flex Flex-alignItems--center"
                                                                        style={{
                                                                            flexWrap:
                                                                                'wrap',
                                                                        }}
                                                                    >
                                                                        <div>
                                                                            <label
                                                                                className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                                type="button"
                                                                            >
                                                                                <ShouldRender
                                                                                    if={
                                                                                        !identityFile
                                                                                    }
                                                                                >
                                                                                    <span className="bs-Button--icon bs-Button--new"></span>
                                                                                    <span>
                                                                                        Upload
                                                                                        Identity
                                                                                        File
                                                                                    </span>
                                                                                </ShouldRender>
                                                                                <ShouldRender
                                                                                    if={
                                                                                        identityFile
                                                                                    }
                                                                                >
                                                                                    <span className="bs-Button--icon bs-Button--edit"></span>
                                                                                    <span>
                                                                                        Change
                                                                                        Identity
                                                                                        File
                                                                                    </span>
                                                                                </ShouldRender>
                                                                                <div className="bs-FileUploadButton-inputWrap">
                                                                                    <Field
                                                                                        className="bs-FileUploadButton-input"
                                                                                        component={
                                                                                            UploadFile
                                                                                        }
                                                                                        name={`identityFile_${this.props.index}`}
                                                                                        id="identityFile"
                                                                                        accept=".pem, .ppk"
                                                                                        onChange={
                                                                                            this
                                                                                                .changeFile
                                                                                        }
                                                                                        fileInputKey={
                                                                                            fileInputKey
                                                                                        }
                                                                                    />
                                                                                </div>
                                                                            </label>
                                                                        </div>
                                                                        <ShouldRender
                                                                            if={
                                                                                identityFile
                                                                            }
                                                                        >
                                                                            <div
                                                                                className="bs-Fieldset-fields"
                                                                                style={{
                                                                                    padding:
                                                                                        '0',
                                                                                }}
                                                                            >
                                                                                <button
                                                                                    className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                                    type="button"
                                                                                    onClick={
                                                                                        this
                                                                                            .removeFile
                                                                                    }
                                                                                    style={{
                                                                                        margin:
                                                                                            '10px 10px 0 0',
                                                                                    }}
                                                                                >
                                                                                    <span className="bs-Button--icon bs-Button--delete"></span>
                                                                                    <span>
                                                                                        Remove
                                                                                        Identity
                                                                                        File
                                                                                    </span>
                                                                                </button>
                                                                            </div>
                                                                        </ShouldRender>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </ShouldRender>
                                                    </ShouldRender>
                                                </ShouldRender>

                                                <ShouldRender
                                                    if={type === 'api'}
                                                >   
                                                    {this.renderMonitorConfiguration("API")}
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            HTTP Method
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-select-nw"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name={`method_${this.props.index}`}
                                                                id="method"
                                                                placeholder="Http Method"
                                                                disabled={
                                                                    requesting
                                                                }
                                                                validate={
                                                                    ValidateField.select
                                                                }
                                                                options={[
                                                                    {
                                                                        value:
                                                                            '',
                                                                        label:
                                                                            'Select method',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'get',
                                                                        label:
                                                                            'GET',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'post',
                                                                        label:
                                                                            'POST',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'put',
                                                                        label:
                                                                            'PUT',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'delete',
                                                                        label:
                                                                            'DELETE',
                                                                    },
                                                                ]}
                                                                style={{
                                                                    height:
                                                                        '28px',
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            URL
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="url"
                                                                name={`url_${this.props.index}`}
                                                                id="url"
                                                                placeholder={`https://mywebsite.com${
                                                                    type ===
                                                                    'api'
                                                                        ? '/api'
                                                                        : ''
                                                                }`}
                                                                disabled={
                                                                    requesting
                                                                }
                                                                validate={[
                                                                    ValidateField.required,
                                                                    ValidateField.url,
                                                                ]}
                                                            />
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        type === 'url'
                                                    }
                                                >   
                                                    {this.renderMonitorConfiguration("Website")}
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            URL
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="url"
                                                                name={`url_${this.props.index}`}
                                                                id="url"
                                                                placeholder={`https://mywebsite.com${
                                                                    type ===
                                                                    'api'
                                                                        ? '/api'
                                                                        : ''
                                                                }`}
                                                                disabled={
                                                                    requesting
                                                                }
                                                                validate={[
                                                                    ValidateField.required,
                                                                    ValidateField.url,
                                                                ]}
                                                            />
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        type ===
                                                        'incomingHttpRequest'
                                                    }
                                                >   
                                                    {this.renderMonitorConfiguration("Incoming HTTP Request")}
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Incoming URL
                                                        </label>
                                                        <div
                                                            className="bs-Fieldset-fields"
                                                            style={{
                                                                paddingTop:
                                                                    '7px',
                                                            }}
                                                        >
                                                            <a
                                                                href={
                                                                    httpRequestLink
                                                                }
                                                            >
                                                                {
                                                                    httpRequestLink
                                                                }
                                                            </a>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={type === 'manual'}
                                                >
                                                    {this.renderMonitorConfiguration("Manual")}
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Description
                                                            (optional)
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="text"
                                                                name={`description_${this.props.index}`}
                                                                id="description"
                                                                placeholder="Home Page's Monitor"
                                                                disabled={
                                                                    requesting
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                {type === 'device' && (
                                                    <div>                                                        
                                                        {this.renderMonitorConfiguration("IOT Device")}   
                                                        <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Device ID
                                                        </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    type="deviceId"
                                                                    name={`deviceId_${this.props.index}`}
                                                                    id="deviceId"
                                                                    placeholder="of234dfgqwe"
                                                                    disabled={
                                                                        requesting
                                                                    }
                                                                    validate={
                                                                        ValidateField.required
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>                                                    
                                                )}
                                                <ShouldRender
                                                    if={type === 'script'}
                                                >   
                                                    {this.renderMonitorConfiguration("Script")}
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Script
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <span>
                                                                <span>
                                                                    <AceEditor
                                                                        placeholder="Enter script here"
                                                                        mode="javascript"
                                                                        theme="github"
                                                                        value={
                                                                            this
                                                                                .state
                                                                                .script
                                                                        }
                                                                        style={{
                                                                            backgroundColor:
                                                                                '#fff',
                                                                            borderRadius:
                                                                                '4px',
                                                                            boxShadow:
                                                                                '0 0 0 1px rgba(50, 50, 93, 0.16), 0 0 0 1px rgba(50, 151, 211, 0), 0 0 0 2px rgba(50, 151, 211, 0), 0 1px 1px rgba(0, 0, 0, 0.08)',
                                                                        }}
                                                                        name={`script_${this.props.index}`}
                                                                        id="script"
                                                                        editorProps={{
                                                                            $blockScrolling: true,
                                                                        }}
                                                                        setOptions={{
                                                                            enableBasicAutocompletion: true,
                                                                            enableLiveAutocompletion: true,
                                                                            enableSnippets: true,
                                                                            showGutter: false,
                                                                        }}
                                                                        height="150px"
                                                                        highlightActiveLine={
                                                                            true
                                                                        }
                                                                        onChange={
                                                                            this
                                                                                .scriptTextChange
                                                                        }
                                                                    />
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        schedules &&
                                                        schedules.length > 0
                                                    }
                                                >
                                                <div className="bs-ContentSection-content Box-root  Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root">
                                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                            <span>Call Schedules</span>
                                                        </span>
                                                        <p>
                                                            <span>
                                                            Set the configuration for your Monitor's Call Schedules.
                                                            </span>
                                                        </p>
                                                    </div>
                                                </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Call Schedule
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <span className="flex">
                                                                <Field
                                                                    className="db-select-nw"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    name={`callSchedule_${this.props.index}`}
                                                                    id="callSchedule"
                                                                    placeholder="Call Schedule"
                                                                    disabled={
                                                                        requesting
                                                                    }
                                                                    style={{
                                                                        height:
                                                                            '28px',
                                                                    }}
                                                                    options={[
                                                                        {
                                                                            value:
                                                                                '',
                                                                            label:
                                                                                'Select call schedule',
                                                                        },
                                                                        ...(schedules &&
                                                                        schedules.length >
                                                                            0
                                                                            ? schedules.map(
                                                                                  schedule => ({
                                                                                      value:
                                                                                          schedule._id,
                                                                                      label:
                                                                                          schedule.name,
                                                                                  })
                                                                              )
                                                                            : []),
                                                                    ]}
                                                                />
                                                                <Tooltip title="Call Schedule">
                                                                    <div>
                                                                        <p>
                                                                            Call
                                                                            Schedules
                                                                            let's
                                                                            you
                                                                            connect
                                                                            your
                                                                            team
                                                                            members
                                                                            to
                                                                            specific
                                                                            monitors,
                                                                            so
                                                                            only
                                                                            on-duty
                                                                            members
                                                                            who
                                                                            are
                                                                            responsible
                                                                            for
                                                                            certain
                                                                            monitors
                                                                            are
                                                                            alerted
                                                                            when
                                                                            an
                                                                            incident
                                                                            is
                                                                            created.
                                                                        </p>
                                                                    </div>
                                                                </Tooltip>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        this.props.monitorSlas
                                                            .length > 0
                                                    }
                                                >
                                                <div className="bs-ContentSection-content Box-root  Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root">
                                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                            <span>Service Level Agreement</span>
                                                        </span>
                                                        <p>
                                                            <span>
                                                                Select the SLAs for your new Monitor.
                                                            </span>
                                                        </p>
                                                    </div>
                                                </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Monitor SLA
                                                        </label>

                                                        <div className="bs-Fieldset-fields">
                                                            <span className="flex">
                                                                {this.props
                                                                    .edit ? (
                                                                    <Field
                                                                        className="db-select-nw"
                                                                        component={
                                                                            RenderSelect
                                                                        }
                                                                        name="monitorSla"
                                                                        id="monitorSla"
                                                                        placeholder="Monitor SLA"
                                                                        disabled={
                                                                            requesting
                                                                        }
                                                                        options={[
                                                                            ...this.props.monitorSlas.map(
                                                                                sla => ({
                                                                                    value:
                                                                                        sla._id,
                                                                                    label:
                                                                                        sla.name,
                                                                                })
                                                                            ),
                                                                        ]}
                                                                    />
                                                                ) : (
                                                                    <Field
                                                                        className="db-select-nw"
                                                                        component={
                                                                            RenderSelect
                                                                        }
                                                                        name="monitorSla"
                                                                        id="monitorSla"
                                                                        placeholder="Monitor SLA"
                                                                        disabled={
                                                                            requesting
                                                                        }
                                                                        options={[
                                                                            {
                                                                                value:
                                                                                    '',
                                                                                label:
                                                                                    'Select Monitor SLA',
                                                                            },
                                                                            ...this.props.monitorSlas.map(
                                                                                sla => ({
                                                                                    value:
                                                                                        sla._id,
                                                                                    label:
                                                                                        sla.name,
                                                                                })
                                                                            ),
                                                                        ]}
                                                                    />
                                                                )}

                                                                <Tooltip title="Monitor SLA">
                                                                    <div>
                                                                        <p>
                                                                            SLA
                                                                            is
                                                                            used
                                                                            to
                                                                            make
                                                                            sure
                                                                            your
                                                                            monitors
                                                                            provide
                                                                            a
                                                                            certain
                                                                            reliability
                                                                            of
                                                                            service.
                                                                            We’ll
                                                                            alert
                                                                            your
                                                                            team
                                                                            when
                                                                            a
                                                                            particular
                                                                            monitor
                                                                            is
                                                                            about
                                                                            to
                                                                            breach
                                                                            it’s
                                                                            SLA.
                                                                        </p>
                                                                    </div>
                                                                </Tooltip>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        this.props.incidentSlas
                                                            .length > 0
                                                    }
                                                >
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Incident
                                                            Communication SLA
                                                        </label>

                                                        <div className="bs-Fieldset-fields">
                                                            <span className="flex">
                                                            {
                                                                this.props.edit ? (<Field
                                                                    className="db-select-nw"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    name="incidentCommunicationSla"
                                                                    id="incidentCommunicationSla"
                                                                    placeholder="Incident Communication SLA"
                                                                    disabled={
                                                                        requesting
                                                                    }
                                                                    options={[
                                                                        ...this.props.incidentSlas.map(sla => ({
                                                                            value: sla._id,
                                                                            label: sla.name,
                                                                        }))
                                                                    ]}
                                                                />) : (<Field
                                                                    className="db-select-nw"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    name="incidentCommunicationSla"
                                                                    id="incidentCommunicationSla"
                                                                    placeholder="Incident Communication SLA"
                                                                    disabled={
                                                                        requesting
                                                                    }
                                                                    options={[
                                                                        {
                                                                            value:
                                                                                '',
                                                                            label:
                                                                                'Select Incident Communication SLA',
                                                                        },
                                                                        ...this.props.incidentSlas.map(
                                                                            sla => ({
                                                                                value:
                                                                                    sla._id,
                                                                                label:
                                                                                    sla.name,
                                                                            })
                                                                        ),
                                                                    ]}
                                                                />)
                                                            }
                                                                
                                                                <Tooltip title="Incident Communication SLA">
                                                                    <div>
                                                                        <p>
                                                                            Incident
                                                                            communication
                                                                            SLA
                                                                            is
                                                                            used
                                                                            to
                                                                            make
                                                                            sure
                                                                            you
                                                                            keep
                                                                            you
                                                                            customers
                                                                            updated
                                                                            every
                                                                            few
                                                                            minutes
                                                                            on
                                                                            an
                                                                            active
                                                                            incident.
                                                                            Your
                                                                            team
                                                                            will
                                                                            get
                                                                            an
                                                                            email
                                                                            reminder
                                                                            when
                                                                            you
                                                                            forget
                                                                            to
                                                                            update
                                                                            an
                                                                            incident
                                                                            status,
                                                                            this
                                                                            will
                                                                            help
                                                                            you
                                                                            to
                                                                            communicate
                                                                            with
                                                                            your
                                                                            customers
                                                                            on
                                                                            time
                                                                            and
                                                                            keep
                                                                            them
                                                                            updated.
                                                                        </p>
                                                                    </div>
                                                                </Tooltip>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        type &&
                                                        (type === 'api' ||
                                                            type === 'url' ||
                                                            type ===
                                                                'server-monitor' ||
                                                            type === 'script' ||
                                                            type ===
                                                                'incomingHttpRequest') &&
                                                        !this.state.advance
                                                    }
                                                >
                                                <div className="bs-ContentSection-content Box-root  Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root">
                                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                            <span>Advanced</span>
                                                        </span>
                                                        <p>
                                                            <span>
                                                                Advanced Configuration settings for your new Monitor.
                                                            </span>
                                                        </p>
                                                    </div>
                                                </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label"></label>
                                                        <div className="bs-Fieldset-fields">
                                                            <button
                                                                id="advanceOptions"
                                                                className="button-as-anchor"
                                                                onClick={() =>
                                                                    this.openAdvance()
                                                                }
                                                            >
                                                                {' '}
                                                                Advance Options.
                                                            </button>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        this.state.advance &&
                                                        (type === 'api' ||
                                                            type === 'url' ||
                                                            type ===
                                                                'server-monitor' ||
                                                            type === 'script' ||
                                                            type ===
                                                                'incomingHttpRequest')
                                                    }
                                                >
                                                    <ShouldRender
                                                        if={
                                                            this.state
                                                                .advance &&
                                                            type === 'api'
                                                        }
                                                    >
                                                        <ApiAdvance
                                                            index={
                                                                this.props.index
                                                            }
                                                        />
                                                    </ShouldRender>
                                                    <ResponseComponent
                                                        head="Monitor up criteria"
                                                        tagline="This is where you describe when your monitor is considered up"
                                                        fieldname={`up_${this.props.index}`}
                                                        index={this.props.index}
                                                        type={this.state.type}
                                                    />
                                                    <ResponseComponent
                                                        head="Monitor degraded criteria"
                                                        tagline="This is where you describe when your monitor is considered degraded"
                                                        fieldname={`degraded_${this.props.index}`}
                                                        index={this.props.index}
                                                        type={this.state.type}
                                                    />
                                                    <ResponseComponent
                                                        head="Monitor down criteria"
                                                        tagline="This is where you describe when your monitor is considered down"
                                                        fieldname={`down_${this.props.index}`}
                                                        index={this.props.index}
                                                        type={this.state.type}
                                                    />
                                                </ShouldRender>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <div className="bs-Tail-copy">
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                        <ShouldRender
                                            if={
                                                this.props.monitor.newMonitor
                                                    .error ||
                                                this.props.monitor.editMonitor
                                                    .error
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span
                                                    style={{ color: 'red' }}
                                                    id="formNewMonitorError"
                                                >
                                                    {this.props.monitor
                                                        .newMonitor.error ||
                                                        this.props.monitor
                                                            .editMonitor.error}
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div>
                                    <ShouldRender
                                        if={!requesting && this.props.edit}
                                    >
                                        <button
                                            className="bs-Button"
                                            disabled={requesting}
                                            onClick={this.cancelEdit}
                                        >
                                            <span>Cancel</span>
                                        </button>
                                    </ShouldRender>
                                    <button
                                        id="addMonitorButton"
                                        className="bs-Button bs-Button--blue"
                                        disabled={requesting}
                                        type="submit"
                                    >
                                        <PricingPlan
                                            plan={this.getNextPlan(
                                                planCategory
                                            )}
                                            hideChildren={false}
                                            disabled={
                                                unlimitedMonitors.includes(
                                                    planCategory
                                                ) ||
                                                currentMonitorCount <
                                                    monitorCount
                                            }
                                        >
                                            <ShouldRender
                                                if={
                                                    !this.props.edit &&
                                                    !requesting
                                                }
                                            >
                                                <span>Add Monitor</span>
                                            </ShouldRender>
                                        </PricingPlan>
                                        <ShouldRender
                                            if={this.props.edit && !requesting}
                                        >
                                            <span>Edit Monitor </span>
                                        </ShouldRender>

                                        <ShouldRender if={requesting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}

NewMonitor.displayName = 'NewMonitor';

const NewMonitorForm = new reduxForm({
    form: 'NewMonitor',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(NewMonitor);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            createMonitor,
            createMonitorSuccess,
            createMonitorFailure,
            resetCreateMonitor,
            editMonitorSwitch,
            openModal,
            closeModal,
            editMonitor,
            logFile,
            resetFile,
            setFileInputKey,
            uploadIdentityFile,
            fetchMonitorCriteria,
            setMonitorCriteria,
            addSeat,
            fetchMonitorsIncidents,
            fetchMonitorsSubscribers,
            fetchSchedules,
            scheduleSuccess,
            showUpgradeForm,
            toggleEdit,
            fetchCommunicationSlas,
            fetchMonitorSlas,
        },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const name = selector(state, 'name_1000');
    const type = selector(state, 'type_1000');
    const mode = selector(state, 'mode_1000');
    const authentication = selector(state, 'authentication_1000');
    const category = selector(state, 'resourceCategory_1000');
    const schedule = selector(state, 'callSchedule_1000');
    const monitorSla = selector(state, 'monitorSla');
    const incidentCommunicationSla = selector(
        state,
        'incidentCommunicationSla'
    );
    let projectId = null;

    for (const project of state.component.componentList.components) {
        for (const component of project.components) {
            if (component._id === ownProps.componentId) {
                projectId = component.projectId._id;
                break;
            }
        }
    }
    if (projectId === null)
        projectId = ownProps.currentProject && ownProps.currentProject._id;

    const currentPlanId =
        state.project &&
        state.project.currentProject &&
        state.project.currentProject.stripePlanId
            ? state.project.currentProject.stripePlanId
            : '';

    if (ownProps.edit) {
        const monitorId = ownProps.match
            ? ownProps.match.params
                ? ownProps.match.params.monitorId
                : null
            : null;
        return {
            monitor: state.monitor,
            currentProject: state.project.currentProject,
            name,
            type,
            mode,
            authentication,
            category,
            identityFile: state.monitor.file,
            schedule,
            monitorSla,
            incidentCommunicationSla,
            subProjects: state.subProject.subProjects.subProjects,
            schedules: state.schedule.schedules.data,
            resourceCategoryList:
                state.resourceCategories.resourceCategoryListForNewResource
                    .resourceCategories,
            monitorId,
            project: state.project.currentProject
                ? state.project.currentProject
                : {},
            currentPlanId,
            projectId,
            incidentSlas:
                state.incidentSla.incidentCommunicationSlas.incidentSlas,
            requestingSla:
                state.incidentSla.incidentCommunicationSlas.requesting,
            fetchSlaError: state.incidentSla.incidentCommunicationSlas.error,
            monitorSlas: state.monitorSla.monitorSlas.slas,
            requestingMonitorSla: state.monitorSla.monitorSlas.requesting,
            fetchSlaError: state.monitorSla.monitorSlas.error,
        };
    } else {
        return {
            initialValues: state.monitor.newMonitor.initialValue,
            monitor: state.monitor,
            currentProject: state.project.currentProject,
            name,
            type,
            mode,
            authentication,
            category,
            identityFile: state.monitor.file,
            schedule,
            monitorSla,
            incidentCommunicationSla,
            resourceCategoryList:
                state.resourceCategories.resourceCategoryListForNewResource
                    .resourceCategories,
            subProjects: state.subProject.subProjects.subProjects,
            schedules: state.schedule.schedules.data,
            project: state.project.currentProject
                ? state.project.currentProject
                : {},
            currentPlanId,
            projectId,
            incidentSlas:
                state.incidentSla.incidentCommunicationSlas.incidentSlas,
            requestingSla:
                state.incidentSla.incidentCommunicationSlas.requesting,
            fetchSlaError: state.incidentSla.incidentCommunicationSlas.error,
            monitorSlas: state.monitorSla.monitorSlas.slas,
            requestingMonitorSla: state.monitorSla.monitorSlas.requesting,
            fetchSlaError: state.monitorSla.monitorSlas.error,
        };
    }
};

NewMonitor.propTypes = {
    index: PropTypes.oneOfType([
        PropTypes.string.isRequired,
        PropTypes.number.isRequired,
    ]),
    editMonitorSwitch: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    editMonitor: PropTypes.func.isRequired,
    createMonitor: PropTypes.func.isRequired,
    monitor: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    fetchMonitorsSubscribers: PropTypes.func.isRequired,
    fetchSchedules: PropTypes.func.isRequired,
    editMonitorProp: PropTypes.object,
    edit: PropTypes.bool,
    name: PropTypes.string,
    type: PropTypes.string,
    mode: PropTypes.string,
    authentication: PropTypes.string,
    category: PropTypes.string,
    subProject: PropTypes.string,
    schedule: PropTypes.string,
    monitorSla: PropTypes.string,
    incidentCommunicationSla: PropTypes.string,
    resourceCategoryList: PropTypes.array,
    schedules: PropTypes.array,
    monitorId: PropTypes.string,
    setMonitorCriteria: PropTypes.func,
    fetchMonitorCriteria: PropTypes.func,
    showUpgradeForm: PropTypes.func,
    project: PropTypes.object,
    currentPlanId: PropTypes.string,
    projectId: PropTypes.string,
    subProjects: PropTypes.array,
    toggleEdit: PropTypes.func,
    logFile: PropTypes.func,
    resetFile: PropTypes.func,
    identityFile: PropTypes.string,
    setFileInputKey: PropTypes.func,
    fileInputKey: PropTypes.string,
    uploadIdentityFile: PropTypes.func,
    fetchCommunicationSlas: PropTypes.func,
    incidentSlas: PropTypes.array,
    fetchSlaError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    requestingSla: PropTypes.bool,
    fetchMonitorSlas: PropTypes.func,
    monitorSlas: PropTypes.array,
    fetchMonitorSlaError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    requestingMonitorSla: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(NewMonitorForm);
