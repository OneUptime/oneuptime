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
                icon:"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgNTA4IDUwOCIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNTA4IDUwODsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik0yNTQsMEMxNDYuNywwLDAsODEuMSwwLDI1NGMwLDE2OC41LDE0MS4xLDI1NCwyNTQsMjU0YzE5My43LDAsMjU0LTE2OS43LDI1NC0yNTRDNTA4LDEyOS42LDQxMi44LDAsMjU0LDB6IE0xOTUuMSwyMy45DQoJCQljLTI2LjUsMjIuNi00OC41LDYwLTYyLjcsMTA2LjRjLTE4LjQtMTAuOS0zNS4zLTI0LjQtNTAuMy00MC4xQzExMy4xLDU3LjcsMTUyLjMsMzQuOSwxOTUuMSwyMy45eiBNNzEuMiwxMDIuNA0KCQkJYzE2LjgsMTcuNSwzNS45LDMyLjQsNTYuNyw0NC4yYy03LjgsMzAuMy0xMi40LDYzLjktMTMsOTkuMkgxNi42QzE4LjQsMTkzLjEsMzcuNiwxNDIuOCw3MS4yLDEwMi40eiBNNzEuMiw0MDUuNg0KCQkJYy0zMy43LTQwLjQtNTIuOC05MC43LTU0LjYtMTQzLjRoOTguM2MwLjYsMzUuNCw1LjIsNjguOSwxMyw5OS4yQzEwNy4yLDM3My4zLDg4LjEsMzg4LjEsNzEuMiw0MDUuNnogTTgyLjEsNDE3LjkNCgkJCWMxNS0xNS43LDMxLjktMjkuMiw1MC4zLTQwLjFjMTQuMiw0Ni4zLDM2LjIsODMuOCw2Mi43LDEwNi40QzE1Mi4zLDQ3My4xLDExMy4xLDQ1MC4zLDgyLjEsNDE3Ljl6IE0yNDUuOCw0OTENCgkJCWMtNDIuNi01LjQtNzkuMy01My05OS4xLTEyMS4yYzMwLjYtMTUuNSw2NC40LTI0LjIsOTkuMS0yNS41VjQ5MXogTTI0NS44LDMyOGMtMzYuMiwxLjItNzEuNCwxMC4xLTEwMy4zLDI1LjcNCgkJCWMtNi43LTI4LTEwLjctNTguOS0xMS4zLTkxLjVoMTE0LjZWMzI4eiBNMjQ1LjgsMjQ1LjhIMTMxLjJjMC42LTMyLjYsNC42LTYzLjUsMTEuMy05MS41YzMyLDE1LjYsNjcuMiwyNC41LDEwMy4zLDI1LjdWMjQ1Ljh6DQoJCQkgTTI0NS44LDE2My43Yy0zNC44LTEuMi02OC41LTEwLTk5LjEtMjUuNUMxNjYuNSw2OS45LDIwMy4yLDIyLjQsMjQ1LjgsMTdWMTYzLjd6IE00MzYuOCwxMDIuNGMzMy42LDQwLjQsNTIuOCw5MC43LDU0LjYsMTQzLjQNCgkJCWgtOTguMmMtMC42LTM1LjQtNS4yLTY4LjktMTMtOTkuMkM0MDAuOSwxMzQuNyw0MjAsMTE5LjksNDM2LjgsMTAyLjR6IE00MjUuOSw5MC4xYy0xNSwxNS43LTMxLjksMjkuMi01MC4zLDQwLjENCgkJCWMtMTQuMi00Ni4zLTM2LjItODMuNy02Mi43LTEwNi40QzM1NS43LDM0LjksMzk0LjksNTcuNyw0MjUuOSw5MC4xeiBNMjYyLjIsMTdjNDIuNiw1LjQsNzkuMyw1Myw5OS4xLDEyMS4yDQoJCQljLTMwLjYsMTUuNS02NC4zLDI0LjItOTkuMSwyNS41VjE3eiBNMjYyLjIsMTgwYzM2LjItMS4yLDcxLjQtMTAuMSwxMDMuMy0yNS43YzYuNywyOCwxMC43LDU4LjksMTEuMyw5MS41SDI2Mi4yVjE4MHoNCgkJCSBNMjYyLjIsMjYyLjJoMTE0LjZjLTAuNiwzMi42LTQuNiw2My41LTExLjMsOTEuNWMtMzEuOS0xNS43LTY3LjEtMjQuNi0xMDMuMy0yNS43VjI2Mi4yeiBNMjYyLjIsNDkxVjM0NC4zDQoJCQljMzQuOCwxLjIsNjguNSwxMCw5OS4xLDI1LjVDMzQxLjUsNDM4LjEsMzA0LjgsNDg1LjYsMjYyLjIsNDkxeiBNMzEyLjksNDg0LjFjMjYuNS0yMi42LDQ4LjUtNjAsNjIuNy0xMDYuNA0KCQkJYzE4LjQsMTAuOSwzNS4zLDI0LjQsNTAuMyw0MC4xQzM5NC45LDQ1MC4zLDM1NS43LDQ3My4xLDMxMi45LDQ4NC4xeiBNNDM2LjgsNDA1LjZjLTE2LjgtMTcuNS0zNS45LTMyLjMtNTYuNi00NC4yDQoJCQljNy44LTMwLjMsMTIuNC02My45LDEzLTk5LjJoOTguMkM0ODkuNiwzMTQuOSw0NzAuNCwzNjUuMiw0MzYuOCw0MDUuNnoiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8L3N2Zz4NCg==",
            },
            {
                value:
                    'device',
                label:
                    'IoT Device',
                icon:"data:image/svg+xml;base64,PHN2ZyBpZD0iTGF5ZXJfMSIgZW5hYmxlLWJhY2tncm91bmQ9Im5ldyAwIDAgNDgwLjA2NSA0ODAuMDY1IiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDQ4MC4wNjUgNDgwLjA2NSIgd2lkdGg9IjUxMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJtMjI1Ljg4OCAyODMuODVjMCA3LjgxNyA2LjMyNSAxNC4xNDQgMTQuMTQ0IDE0LjE0NCA3LjgxNyAwIDE0LjE0NC02LjMyNSAxNC4xNDQtMTQuMTQ0IDAtNy44MTctNi4zMjUtMTQuMTQ1LTE0LjE0NC0xNC4xNDUtNy44MTcuMDAxLTE0LjE0NCA2LjMyNi0xNC4xNDQgMTQuMTQ1em00MC0yNS44NTZjLTE0LjI1Ny0xNC4yNTctMzcuNDU1LTE0LjI1Ny01MS43MTIgMC0zLjEyNCAzLjEyNC04LjE4OSAzLjEyNC0xMS4zMTMgMC0zLjEyNS0zLjEyNC0zLjEyNS04LjE4OSAwLTExLjMxMyAyMC40OTUtMjAuNDk1IDUzLjg0NC0yMC40OTUgNzQuMzM5IDAgNS4wNTYgNS4wNTUgMS40MDUgMTMuNjU3LTUuNjU3IDEzLjY1Ny0yLjA0Ny0uMDAxLTQuMDk1LS43ODItNS42NTctMi4zNDR6bTMwLjA4LTMwLjA4Yy0zMC45MTYtMzAuOTE2LTgwLjk1NC0zMC45MTgtMTExLjg3MiAwLTMuMTI0IDMuMTI0LTguMTg5IDMuMTI0LTExLjMxMyAwLTMuMTI1LTMuMTI0LTMuMTI1LTguMTg5IDAtMTEuMzEzIDM3LjE2OC0zNy4xNjkgOTcuMzI3LTM3LjE3MyAxMzQuNDk5IDAgNS4wNTYgNS4wNTUgMS40MDUgMTMuNjU3LTUuNjU3IDEzLjY1Ny0yLjA0OC0uMDAxLTQuMDk1LS43ODEtNS42NTctMi4zNDR6bS01NS45MzYtMTAzLjg4MmMtNjMuOTYyIDAtMTE2IDUyLjAzOC0xMTYgMTE2czUyLjAzOCAxMTYgMTE2IDExNmM0Ny45NzYgMCA5MS41OTktMzAuMTQzIDEwOC41NTEtNzUuMDA2IDEuNTYyLTQuMTMyIDYuMTc3LTYuMjE5IDEwLjMxMS00LjY1NiA0LjEzMyAxLjU2MiA2LjIxOCA2LjE3OCA0LjY1NiAxMC4zMTEtMTkuMDUgNTAuNDE3LTY3LjUyNiA4NS4zNTEtMTIzLjUxOCA4NS4zNTEtNzIuNzg1IDAtMTMyLTU5LjIxNS0xMzItMTMyczU5LjIxNS0xMzIgMTMyLTEzMiAxMzIgNTkuMjE1IDEzMiAxMzJjMCA0LjQxOC0zLjU4MiA4LTggOHMtOC0zLjU4Mi04LThjMC02My45NjMtNTIuMDM3LTExNi0xMTYtMTE2em0tMTg3LjM1NSAyMzguODE1Yy00OC44NjYtNzQuMzMzLTQ4LjkzMi0xNzEuMjAxLS4wMDEtMjQ1LjYzMiAzMS4wNzkgMTguOTA5IDcxLjM1Ny0zLjUyNiA3MS4zNTctNDAuMTg0IDAtOC45MS0yLjQ5Mi0xNy4yNDktNi44MTYtMjQuMzU3IDY0LjgwMi00Mi42MDIgMTQ2LjM1Ni00Ny45MSAyMTUuMDM0LTE2Ljg0MyA0LjAyNiAxLjgyMiA4Ljc2Ni4wMzQgMTAuNTg2LTMuOTkyIDEuODIxLTQuMDI2LjAzNC04Ljc2Ni0zLjk5Mi0xMC41ODYtNzQuMTkyLTMzLjU2LTE2Mi40MTktMjcuNTUyLTIzMi4yNDkgMTkuMjc1LTguMDgxLTYuNTU3LTE4LjM2OS0xMC40OTctMjkuNTYzLTEwLjQ5Ny0zOS41NzggMC02MS4yMzkgNDYuMDc4LTM2LjUwMyA3Ni41NjMtNTQuMDI0IDgwLjU2Ni01NC4wNTQgMTg2LjI2NCAwIDI2Ni44NzUtMjQuNzM2IDMwLjQ4Ni0zLjA3NiA3Ni41NjMgMzYuNTAzIDc2LjU2MyAyNS45MTYgMCA0Ny0yMS4wODQgNDctNDctLjAwMS0zNi42NzMtNDAuMjkzLTU5LjA4MS03MS4zNTYtNDAuMTg1em0yNC4zNTUtMzE2LjgxNWMxNy4wOTMgMCAzMSAxMy45MDcgMzEgMzFzLTEzLjkwNyAzMS0zMSAzMS0zMS0xMy45MDctMzEtMzEgMTMuOTA3LTMxIDMxLTMxem0wIDM4OGMtMTcuMDkzIDAtMzEtMTMuOTA3LTMxLTMxczEzLjkwNy0zMSAzMS0zMSAzMSAxMy45MDcgMzEgMzEtMTMuOTA2IDMxLTMxIDMxem0zNjIuNTAzLTMyNy40MzhjMjQuNzM2LTMwLjQ4MyAzLjA3OC03Ni41NjMtMzYuNTAzLTc2LjU2My0yNS45MTYgMC00NyAyMS4wODQtNDcgNDcgMCAzNi42NzQgNDAuMjk0IDU5LjA4MiA3MS4zNTYgNDAuMTg0IDQ4Ljg2NCA3NC4zMjggNDguOTMxIDE3MS4yMDIgMCAyNDUuNjMyLTMxLjA3OS0xOC45MDgtNzEuMzU2IDMuNTI2LTcxLjM1NiA0MC4xODQgMCA4LjkxIDIuNDkyIDE3LjI0OCA2LjgxNiAyNC4zNTUtNjUuNjQzIDQzLjE1My0xNDguNTQ1IDQ4LjEwNi0yMTcuOTQ3IDE1LjUwMS00LTEuODc4LTguNzY0LS4xNi0xMC42NDMgMy44MzlzLS4xNiA4Ljc2NCAzLjgzOSAxMC42NDNjNzUuMDk0IDM1LjI3OSAxNjQuNzgzIDI5LjQ5OSAyMzUuMzczLTE3LjgzNCAzMC40ODYgMjQuNzM2IDc2LjU2MiAzLjA3NCA3Ni41NjItMzYuNTAzIDAtMTEuMTk0LTMuOTQtMjEuNDgxLTEwLjQ5Ny0yOS41NjMgNTQuMDI1LTgwLjU2NSA1NC4wNTUtMTg2LjI2NSAwLTI2Ni44NzV6bS02Ny41MDMtMjkuNTYyYzAtMTcuMDkzIDEzLjkwNy0zMSAzMS0zMXMzMSAxMy45MDcgMzEgMzEtMTMuOTA3IDMxLTMxIDMxLTMxLTEzLjkwNy0zMS0zMXptMzEgMzU3Yy0xNy4wOTMgMC0zMS0xMy45MDctMzEtMzFzMTMuOTA3LTMxIDMxLTMxIDMxIDEzLjkwNyAzMSAzMS0xMy45MDYgMzEtMzEgMzF6Ii8+PC9zdmc+",
            },
            {
                value:
                    'manual',
                label:
                    'Manual',
                icon:'data:image/svg+xml;base64,PHN2ZyBpZD0iQ2FwYV8xIiBlbmFibGUtYmFja2dyb3VuZD0ibmV3IDAgMCA1MTIgNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHdpZHRoPSI1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGc+PGc+PHBhdGggZD0ibTM2Ni42NDkgMzY0LjYzNmgzMHY3Ni43OTloLTMweiIvPjxwYXRoIGQ9Im0zODEuNjE1IDM0NC43MTJjNy44NDYgMCAxNS4zNjMtNi44OTkgMTUtMTUtLjM2NC04LjEyNy02LjU5MS0xNS0xNS0xNS03Ljg0NiAwLTE1LjM2MyA2Ljg5OS0xNSAxNSAuMzY0IDguMTI3IDYuNTkxIDE1IDE1IDE1eiIvPjwvZz48Zz48cGF0aCBkPSJtNDA4LjA5NyAyNTUuMTZ2LTI1NS4xNmgtMzQyLjE3MmMtMzYuMzUxIDAtNjUuOTI1IDI4LjcwNC02NS45MjUgNjUuMDU1djM4Mi45NmguMzE3YzMuMzMyIDM1LjgzNSAzMy41NTggNjMuOTg1IDcwLjI0OCA2My45ODVoMzExLjI0NWM3MS43ODcgMCAxMzAuMTktNTcuNTMzIDEzMC4xOS0xMjkuMzE5IDAtNjIuNzg0LTQ0LjY3NC0xMTUuMzI5LTEwMy45MDMtMTI3LjUyMXptLTMwLjA0Ny0yLjYxYy02Ni4wOTkgMS44ODUtMTIwLjAwOSA1My4yNzgtMTI1Ljg4NyAxMTguMzE5aC0xMzEuNTE3di0zNDEuNjkyaDI1Ny40MDR6bS0zMTIuMTI1LTIyMy4zNzNoMjQuNjczdjM0MS42OTJoLTIwLjAzM2MtMTUuMDcxIDAtMjkuMDQyIDQuNzY1LTQwLjUxOCAxMi44NDV2LTMxOC42NTljMC0xOS43ODQgMTYuMDk1LTM1Ljg3OCAzNS44NzgtMzUuODc4em00LjY0IDQ1Mi43NzZjLTIyLjM0MiAwLTQwLjUxOC0xOC4xNzctNDAuNTE4LTQwLjUxOCAwLTIyLjM0MiAxOC4xNzYtNDAuNTE4IDQwLjUxOC00MC41MThoMTgyLjMzOWMxLjI1IDguODc2IDMuMzk1IDE3LjQ2OCA2LjM0NyAyNS42OGgtMTgzLjEwOXYzMC4wNDdoMTk4LjU5M2M2LjUxOSA5LjQwOSAxNC4yNDQgMTcuOTIgMjIuOTUxIDI1LjMxaC0yMjcuMTIxem0zMTEuMjQ2Ljg3Yy01NS4yMTkgMC0xMDAuMTQyLTQ0LjkyNC0xMDAuMTQyLTEwMC4xNDJzNDQuOTIzLTEwMC4xNDIgMTAwLjE0Mi0xMDAuMTQyIDEwMC4xNDIgNDQuOTI0IDEwMC4xNDIgMTAwLjE0Mi00NC45MjQgMTAwLjE0Mi0xMDAuMTQyIDEwMC4xNDJ6Ii8+PHBhdGggZD0ibTIwMC43OTYgODcuNmgxMDAuNTYxdjMwLjA0N2gtMTAwLjU2MXoiLz48cGF0aCBkPSJtMTY2LjgyOCAxNTIuODMxaDE2OC40OTd2MzAuMDQ3aC0xNjguNDk3eiIvPjwvZz48L2c+PC9zdmc+',
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
                icon:'data:image/svg+xml;base64,PHN2ZyBpZD0iX3gzMV9weCIgZW5hYmxlLWJhY2tncm91bmQ9Im5ldyAwIDAgMjQgMjQiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHdpZHRoPSI1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0ibTE5LjUgMjRoLTE1Yy0xLjM3OCAwLTIuNS0xLjEyMi0yLjUtMi41di0xOWMwLTEuMzc4IDEuMTIyLTIuNSAyLjUtMi41aDE1YzEuMzc4IDAgMi41IDEuMTIyIDIuNSAyLjV2MTljMCAxLjM3OC0xLjEyMiAyLjUtMi41IDIuNXptLTE1LTIzYy0uODI3IDAtMS41LjY3My0xLjUgMS41djE5YzAgLjgyNy42NzMgMS41IDEuNSAxLjVoMTVjLjgyNyAwIDEuNS0uNjczIDEuNS0xLjV2LTE5YzAtLjgyNy0uNjczLTEuNS0xLjUtMS41eiIvPjxwYXRoIGQ9Im04LjUgMTZjLS4xNjIgMC0uMzItLjA3OC0uNDE3LS4yMjNsLTItM2MtLjExMi0uMTY4LS4xMTItLjM4NyAwLS41NTVsMi0zYy4xNTItLjIzLjQ2Mi0uMjkyLjY5My0uMTM5LjIzLjE1My4yOTIuNDYzLjEzOS42OTNsLTEuODE0IDIuNzI0IDEuODE1IDIuNzIzYy4xNTMuMjMuMDkxLjU0LS4xMzkuNjkzLS4wODUuMDU3LS4xODEuMDg0LS4yNzcuMDg0eiIvPjxwYXRoIGQ9Im0xNS41IDE2Yy0uMDk1IDAtLjE5MS0uMDI3LS4yNzctLjA4NC0uMjMtLjE1My0uMjkyLS40NjMtLjEzOS0uNjkzbDEuODE1LTIuNzIzLTEuODE1LTIuNzIzYy0uMTUzLS4yMy0uMDkxLS41NC4xMzktLjY5M3MuNTQtLjA5Mi42OTMuMTM5bDIgM2MuMTEyLjE2OC4xMTIuMzg3IDAgLjU1NWwtMiAzYy0uMDk2LjE0NC0uMjU1LjIyMi0uNDE2LjIyMnoiLz48cGF0aCBkPSJtMTAuNSAxN2MtLjA1OSAwLS4xMTgtLjAxLS4xNzYtLjAzMi0uMjU4LS4wOTctLjM4OS0uMzg1LS4yOTItLjY0NGwzLThjLjA5Ny0uMjU5LjM4NS0uMzg4LjY0NC0uMjkyLjI1OC4wOTcuMzg5LjM4NS4yOTIuNjQ0bC0zIDhjLS4wNzUuMi0uMjY2LjMyNC0uNDY4LjMyNHoiLz48L3N2Zz4='
            },
            {
                value:
                    'server-monitor',
                label:
                    'Server',
                icon:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNTEyIDUxMjsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxnPg0KCQkJPHBhdGggZD0iTTQzNy4zMzMsNDA1LjMyM0gyNjYuNjY3Yy01Ljg4OCwwLTEwLjY2Nyw0Ljc3OS0xMC42NjcsMTAuNjY3czQuNzc5LDEwLjY2NywxMC42NjcsMTAuNjY3aDE3MC42NjcNCgkJCQljNS44ODgsMCwxMC42NjctNC43NzksMTAuNjY3LTEwLjY2N1M0NDMuMjIxLDQwNS4zMjMsNDM3LjMzMyw0MDUuMzIzeiIvPg0KCQkJPHBhdGggZD0iTTQzNy4zMzMsNDQ3Ljk4OUgyNjYuNjY3Yy01Ljg4OCwwLTEwLjY2Nyw0Ljc3OS0xMC42NjcsMTAuNjY3YzAsNS44ODgsNC43NzksMTAuNjY3LDEwLjY2NywxMC42NjdoMTcwLjY2Nw0KCQkJCWM1Ljg4OCwwLDEwLjY2Ny00Ljc3OSwxMC42NjctMTAuNjY3QzQ0OCw0NTIuNzY4LDQ0My4yMjEsNDQ3Ljk4OSw0MzcuMzMzLDQ0Ny45ODl6Ii8+DQoJCQk8cGF0aCBkPSJNNzQuNjY3LDQwNS4zMjNjLTE3LjY0MywwLTMyLDE0LjM1Ny0zMiwzMmMwLDE3LjY0MywxNC4zNTcsMzIsMzIsMzJjMTcuNjQzLDAsMzItMTQuMzU3LDMyLTMyDQoJCQkJQzEwNi42NjcsNDE5LjY4LDkyLjMwOSw0MDUuMzIzLDc0LjY2Nyw0MDUuMzIzeiBNNzQuNjY3LDQ0Ny45ODljLTUuODg4LDAtMTAuNjY3LTQuNzc5LTEwLjY2Ny0xMC42NjcNCgkJCQljMC01Ljg4OCw0Ljc3OS0xMC42NjcsMTAuNjY3LTEwLjY2N3MxMC42NjcsNC43NzksMTAuNjY3LDEwLjY2N0M4NS4zMzMsNDQzLjIxMSw4MC41NTUsNDQ3Ljk4OSw3NC42NjcsNDQ3Ljk4OXoiLz4NCgkJCTxwYXRoIGQ9Ik03NC42NjcsMjc3LjMyM2MtMTcuNjQzLDAtMzIsMTQuMzU3LTMyLDMyYzAsMTcuNjQzLDE0LjM1NywzMiwzMiwzMmMxNy42NDMsMCwzMi0xNC4zNTcsMzItMzINCgkJCQlDMTA2LjY2NywyOTEuNjgsOTIuMzA5LDI3Ny4zMjMsNzQuNjY3LDI3Ny4zMjN6IE03NC42NjcsMzE5Ljk4OWMtNS44ODgsMC0xMC42NjctNC43NzktMTAuNjY3LTEwLjY2Nw0KCQkJCXM0Ljc3OS0xMC42NjcsMTAuNjY3LTEwLjY2N3MxMC42NjcsNC43NzksMTAuNjY3LDEwLjY2N1M4MC41NTUsMzE5Ljk4OSw3NC42NjcsMzE5Ljk4OXoiLz4NCgkJCTxwYXRoIGQ9Ik00MzcuMzMzLDE5MS45ODlIMjY2LjY2N2MtNS44ODgsMC0xMC42NjcsNC43NzktMTAuNjY3LDEwLjY2N3M0Ljc3OSwxMC42NjcsMTAuNjY3LDEwLjY2N2gxNzAuNjY3DQoJCQkJYzUuODg4LDAsMTAuNjY3LTQuNzc5LDEwLjY2Ny0xMC42NjdTNDQzLjIyMSwxOTEuOTg5LDQzNy4zMzMsMTkxLjk4OXoiLz4NCgkJCTxwYXRoIGQ9Ik01MTIsMjAyLjY1NnYtNDIuNjY3YzAtMTAuMjQtMy4wNTEtMTkuNzMzLTguMDg1LTI3Ljg4M2MtMC4xNDktMC4yOTktMC4xNzEtMC42NC0wLjM0MS0wLjkxN0w0MzcuNjExLDI1LjE2Mw0KCQkJCUM0MjcuODE5LDkuNDE5LDQxMC44OCwwLjAxMSwzOTIuMzIsMC4wMTFIMTE5Ljc0NGMtMTguNTgxLDAtMzUuNDk5LDkuNDA4LTQ1LjI5MSwyNS4xNTJMOC40OTEsMTMxLjE4OQ0KCQkJCWMtMC4xMDcsMC4xNzEtMC4xMDcsMC4zNjMtMC4yMTMsMC41NTVDMy4xMTUsMTM5Ljk1NywwLDE0OS42LDAsMTU5Ljk4OXY0Mi42NjdjMCwxNy40OTMsOC41OTcsMzIuOTM5LDIxLjY3NSw0Mi42NjcNCgkJCQlDOC41OTcsMjU1LjA3MiwwLDI3MC40OTYsMCwyODcuOTg5djQyLjY2N2MwLDE3LjQ5Myw4LjU5NywzMi45MzksMjEuNjc1LDQyLjY2N0M4LjU5NywzODMuMDcyLDAsMzk4LjQ5NiwwLDQxNS45ODl2NDIuNjY3DQoJCQkJYzAsMjkuMzk3LDIzLjkzNiw1My4zMzMsNTMuMzMzLDUzLjMzM2g0MDUuMzMzYzI5LjM5NywwLDUzLjMzMy0yMy45MzYsNTMuMzMzLTUzLjMzM3YtNDIuNjY3DQoJCQkJYzAtMTcuNDkzLTguNTk3LTMyLjkzOS0yMS42NzUtNDIuNjY3QzUwMy40MDMsMzYzLjU5NSw1MTIsMzQ4LjE0OSw1MTIsMzMwLjY1NnYtNDIuNjY3YzAtMTcuNDkzLTguNTk3LTMyLjkzOS0yMS42NzUtNDIuNjY3DQoJCQkJQzUwMy40MDMsMjM1LjU5NSw1MTIsMjIwLjE3MSw1MTIsMjAyLjY1NnogTTkyLjU2NSwzNi40MjdjNS44NjctOS40NTEsMTYuMDIxLTE1LjEwNCwyNy4xNTctMTUuMTA0aDI3Mi41NzYNCgkJCQljMTEuMTM2LDAsMjEuMjkxLDUuNjUzLDI3LjE1NywxNS4xMDRsNDQuMDExLDcwLjcyYy0xLjYtMC4xNDktMy4xNTctMC40OTEtNC44LTAuNDkxSDUzLjMzM2MtMS42NDMsMC0zLjE3OSwwLjM0MS00Ljc3OSwwLjQ5MQ0KCQkJCUw5Mi41NjUsMzYuNDI3eiBNNDkwLjY2Nyw0MTUuOTg5djQyLjY2N2MwLDE3LjY0My0xNC4zNTcsMzItMzIsMzJINTMuMzMzYy0xNy42NDMsMC0zMi0xNC4zNTctMzItMzJ2LTQyLjY2Nw0KCQkJCWMwLTE3LjY0MywxNC4zNTctMzIsMzItMzJoNDA1LjMzM0M0NzYuMzA5LDM4My45ODksNDkwLjY2NywzOTguMzQ3LDQ5MC42NjcsNDE1Ljk4OXogTTQ5MC42NjcsMjg3Ljk4OXY0Mi42NjcNCgkJCQljMCwxNy42NDMtMTQuMzU3LDMyLTMyLDMySDUzLjMzM2MtMTcuNjQzLDAtMzItMTQuMzU3LTMyLTMydi00Mi42NjdjMC0xNy42NDMsMTQuMzU3LTMyLDMyLTMyaDQwNS4zMzMNCgkJCQlDNDc2LjMwOSwyNTUuOTg5LDQ5MC42NjcsMjcwLjM0Nyw0OTAuNjY3LDI4Ny45ODl6IE00OTAuNjY3LDIwMi42NTZjMCwxNy42NDMtMTQuMzU3LDMyLTMyLDMySDUzLjMzM2MtMTcuNjQzLDAtMzItMTQuMzU3LTMyLTMyDQoJCQkJdi00Mi42NjdjMC0xNy42NDMsMTQuMzU3LTMyLDMyLTMyaDQwNS4zMzNjMTcuNjQzLDAsMzIsMTQuMzU3LDMyLDMyVjIwMi42NTZ6Ii8+DQoJCQk8cGF0aCBkPSJNNDM3LjMzMywxNDkuMzIzSDI2Ni42NjdjLTUuODg4LDAtMTAuNjY3LDQuNzc5LTEwLjY2NywxMC42NjdzNC43NzksMTAuNjY3LDEwLjY2NywxMC42NjdoMTcwLjY2Nw0KCQkJCWM1Ljg4OCwwLDEwLjY2Ny00Ljc3OSwxMC42NjctMTAuNjY3UzQ0My4yMjEsMTQ5LjMyMyw0MzcuMzMzLDE0OS4zMjN6Ii8+DQoJCQk8cGF0aCBkPSJNNDM3LjMzMywzMTkuOTg5SDI2Ni42NjdjLTUuODg4LDAtMTAuNjY3LDQuNzc5LTEwLjY2NywxMC42NjdzNC43NzksMTAuNjY3LDEwLjY2NywxMC42NjdoMTcwLjY2Nw0KCQkJCWM1Ljg4OCwwLDEwLjY2Ny00Ljc3OSwxMC42NjctMTAuNjY3UzQ0My4yMjEsMzE5Ljk4OSw0MzcuMzMzLDMxOS45ODl6Ii8+DQoJCQk8cGF0aCBkPSJNNDM3LjMzMywyNzcuMzIzSDI2Ni42NjdjLTUuODg4LDAtMTAuNjY3LDQuNzc5LTEwLjY2NywxMC42NjdzNC43NzksMTAuNjY3LDEwLjY2NywxMC42NjdoMTcwLjY2Nw0KCQkJCWM1Ljg4OCwwLDEwLjY2Ny00Ljc3OSwxMC42NjctMTAuNjY3UzQ0My4yMjEsMjc3LjMyMyw0MzcuMzMzLDI3Ny4zMjN6Ii8+DQoJCQk8cGF0aCBkPSJNNzQuNjY3LDE0OS4zMjNjLTE3LjY0MywwLTMyLDE0LjM1Ny0zMiwzMmMwLDE3LjY0MywxNC4zNTcsMzIsMzIsMzJjMTcuNjQzLDAsMzItMTQuMzU3LDMyLTMyDQoJCQkJQzEwNi42NjcsMTYzLjY4LDkyLjMwOSwxNDkuMzIzLDc0LjY2NywxNDkuMzIzeiBNNzQuNjY3LDE5MS45ODljLTUuODg4LDAtMTAuNjY3LTQuNzc5LTEwLjY2Ny0xMC42NjcNCgkJCQlzNC43NzktMTAuNjY3LDEwLjY2Ny0xMC42NjdzMTAuNjY3LDQuNzc5LDEwLjY2NywxMC42NjdTODAuNTU1LDE5MS45ODksNzQuNjY3LDE5MS45ODl6Ii8+DQoJCTwvZz4NCgk8L2c+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8L3N2Zz4NCg==',
            },
            {
                value:
                    'incomingHttpRequest',
                label:
                    'Incoming Request',
                icon:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgNDY5LjMzMyA0NjkuMzMzIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA0NjkuMzMzIDQ2OS4zMzM7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4NCjxnPg0KCTxnPg0KCQk8Zz4NCgkJCTxwb2x5Z29uIHBvaW50cz0iNzQuNjY3LDIxMy4zMzMgMzIsMjEzLjMzMyAzMiwxNzAuNjY3IDAsMTcwLjY2NyAwLDI5OC42NjcgMzIsMjk4LjY2NyAzMiwyNDUuMzMzIDc0LjY2NywyNDUuMzMzIA0KCQkJCTc0LjY2NywyOTguNjY3IDEwNi42NjcsMjk4LjY2NyAxMDYuNjY3LDE3MC42NjcgNzQuNjY3LDE3MC42NjcgCQkJIi8+DQoJCQk8cG9seWdvbiBwb2ludHM9IjEyOCwyMDIuNjY3IDE2MCwyMDIuNjY3IDE2MCwyOTguNjY3IDE5MiwyOTguNjY3IDE5MiwyMDIuNjY3IDIyNCwyMDIuNjY3IDIyNCwxNzAuNjY3IDEyOCwxNzAuNjY3IAkJCSIvPg0KCQkJPHBvbHlnb24gcG9pbnRzPSIyNDUuMzMzLDIwMi42NjcgMjc3LjMzMywyMDIuNjY3IDI3Ny4zMzMsMjk4LjY2NyAzMDkuMzMzLDI5OC42NjcgMzA5LjMzMywyMDIuNjY3IDM0MS4zMzMsMjAyLjY2NyANCgkJCQkzNDEuMzMzLDE3MC42NjcgMjQ1LjMzMywxNzAuNjY3IAkJCSIvPg0KCQkJPHBhdGggZD0iTTQzNy4zMzMsMTcwLjY2N2gtNzQuNjY3djEyOGgzMlYyNTZoNDIuNjY3YzE4LjEzMywwLDMyLTEzLjg2NywzMi0zMnYtMjEuMzMzDQoJCQkJQzQ2OS4zMzMsMTg0LjUzMyw0NTUuNDY3LDE3MC42NjcsNDM3LjMzMywxNzAuNjY3eiBNNDM3LjMzMywyMjRoLTQyLjY2N3YtMjEuMzMzaDQyLjY2N1YyMjR6Ii8+DQoJCTwvZz4NCgk8L2c+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8L3N2Zz4NCg==',
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
                                                                            marginTop:'30px',                                                                       
                                                                        }}>
                                                        <label className="bs-Fieldset-label">
                                                        What would you like to monitor?
                                                        </label>

                                                        <div className="radio-field">
                                                            <span className="flex">
                                                            <div className="monitor-type-grid">
                                                                {monitorTypesOptions.map((el)=>(
                                                                        <label
                                                                        key={el.value}
                                                                        htmlFor={el.value}
                                                                        style={{
                                                                            cursor: 'pointer',
                                                                        }}
                                                                    >
                                                                        <div className={`radio-field Flex-justifyContent--center monitor-type-item Box-background--white`}
                                                                        style={{
                                                                            border:`1px solid ${(this.props.type === el.value)?'black':'rgba(0,0,0,0.2)'}`,                                                                                                                                     
                                                                        }}> 
                                                                        <div className="radioButtonStyle">
                                                                            <Field
                                                                                required={true}
                                                                                component="input"
                                                                                type="radio"
                                                                                id={el.value}
                                                                                name={`type_${this.props.index}`}
                                                                                className="Margin-left--4 Margin-top--4"
                                                                                validate={
                                                                                    ValidateField.select
                                                                                }
                                                                                disabled={
                                                                                    requesting
                                                                                }
                                                                                onChange={(
                                                                                    e,
                                                                                    v
                                                                                ) => {                                                                                    
                                                                                    this.changeBox(
                                                                                        e,
                                                                                        v
                                                                                    )
                                                                                }
                                                                                }
                                                                                value={el.value}
                                                                            />
                                                                        </div>                                                                          
                                                                            <span className="imageAndLabel"
                                                                            >
                                                                                <img src={el.icon}
                                                                            style={{
                                                                                width:'70%',
                                                                                height:'100%',                                                                              
                                                                            }}/>
                                                                            <span style={{
                                                                               marginTop:'13%',                                                                          
                                                                            }}>
                                                                                {el.label}
                                                                            </span>
                                                                            </span>                                                                            
                                                                        </div>
                                                                    </label>
                                                                ))}
                                                            </div>                                                                                                                                        
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
