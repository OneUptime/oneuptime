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
                icon:"data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDc0IDc0IiB3aWR0aD0iNTEyIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxnIGlkPSJJY29ucyI+PHBhdGggZD0ibTY4IDU2Ljc5aC02MmE0IDQgMCAwIDEgLTQtNHYtNDVhNCA0IDAgMCAxIDQtNGg2MmE0IDQgMCAwIDEgNCA0djQ1YTQgNCAwIDAgMSAtNCA0em0tNjItNTFhMiAyIDAgMCAwIC0yIDJ2NDVhMiAyIDAgMCAwIDIgMmg2MmEyIDIgMCAwIDAgMi0ydi00NWEyIDIgMCAwIDAgLTItMnoiLz48cGF0aCBkPSJtNTQuMzIgNzAuMjFoLTM0LjY0YTEgMSAwIDAgMSAtLjcwOS0xLjcgMTUuNDE5IDE1LjQxOSAwIDAgMCA0LjgyOS0xMi42NDMgMSAxIDAgMCAxIDEuOTk0LS4xNTQgMTcuMjI5IDE3LjIyOSAwIDAgMSAtMy44NzkgMTIuNWgzMC4xNzlhMTcuMTg0IDE3LjE4NCAwIDAgMSAtMy45LTEyLjUgMSAxIDAgMCAxIDIgLjE2MiAxNS40NiAxNS40NiAwIDAgMCA0Ljg0NiAxMi42MzggMSAxIDAgMCAxIC0uNzE0IDEuN3oiLz48cGF0aCBkPSJtNTMuNDQgNDUuNzloLTIuOTdhMSAxIDAgMCAxIDAtMmgyLjk3YTEgMSAwIDAgMSAwIDJ6Ii8+PHBhdGggZD0ibTMzLjU2IDQ1Ljc5aC0zMC41NmExIDEgMCAwIDEgMC0yaDMwLjU2YTEgMSAwIDAgMSAwIDJ6Ii8+PHBhdGggZD0ibTQzLjQ3IDQ1Ljc5aC0yLjkxYTEgMSAwIDAgMSAwLTJoMi45MWExIDEgMCAwIDEgMCAyeiIvPjxwYXRoIGQ9Im03MSA0NS43OWgtMTAuNTZhMSAxIDAgMCAxIDAtMmgxMC41NmExIDEgMCAwIDEgMCAyeiIvPjxwYXRoIGQ9Im0xNS4zMzMgNTFoLTQuMzMzYTEgMSAwIDAgMSAwLTJoNC4zMzNhMSAxIDAgMCAxIDAgMnoiLz48cGF0aCBkPSJtMzcgNDAuMjM2YTE1LjQ0NiAxNS40NDYgMCAxIDEgMTUuNDQ2LTE1LjQ0NiAxNS40NjMgMTUuNDYzIDAgMCAxIC0xNS40NDYgMTUuNDQ2em0wLTI4Ljg5MmExMy40NDYgMTMuNDQ2IDAgMSAwIDEzLjQ0NiAxMy40NDYgMTMuNDYxIDEzLjQ2MSAwIDAgMCAtMTMuNDQ2LTEzLjQ0NnoiLz48cGF0aCBkPSJtMzYuOTkxIDQwLjIzNmMtNC40NzkgMC03Ljk4NC02Ljc5MS03Ljk3Ny0xNS40NTJhMjUuMDc3IDI1LjA3NyAwIDAgMSAyLjE1Ni0xMC42NWMxLjUtMy4wODkgMy41NzMtNC43OSA1Ljg0My00Ljc5IDIuMjcxIDAgNC4zNDQgMS43MDYgNS44MzkgNC44YTI1LjA1NyAyNS4wNTcgMCAwIDEgMi4xMzggMTAuNjU2IDI1LjA3NiAyNS4wNzYgMCAwIDEgLTIuMTU2IDEwLjY0OWMtMS40OTggMy4wODYtMy41NzMgNC43ODctNS44NDMgNC43ODd6bS4wMTgtMjguODkyYy0xLjQ0MSAwLTIuOTE0IDEuMzM1LTQuMDQzIDMuNjYzYTIzLjAzMiAyMy4wMzIgMCAwIDAgLTEuOTU2IDkuNzc4Yy0uMDEgOC4wNDQgMy4wOSAxMy40NDkgNS45NzkgMTMuNDUxIDEuNDQxIDAgMi45MTQtMS4zMzUgNC4wNDMtMy42NjNhMjMuMDI5IDIzLjAyOSAwIDAgMCAxLjk1OC05Ljc3MyAyMy4wNCAyMy4wNCAwIDAgMCAtMS45MzktOS43ODFjLTEuMTI2LTIuMzMxLTIuNi0zLjY2OS00LjA0LTMuNjd6Ii8+PHBhdGggZD0ibTM3LjAxMiA0MC4yMzZhMSAxIDAgMCAxIC0xLTF2LTI4Ljg5MmExIDEgMCAwIDEgMiAwdjI4Ljg5MmExIDEgMCAwIDEgLTEgMXoiLz48cGF0aCBkPSJtNTEuNDU4IDI1Ljc5aC0yOC44OTNhMSAxIDAgMCAxIDAtMmgyOC44OTNhMSAxIDAgMCAxIDAgMnoiLz48cGF0aCBkPSJtNDkuNTQyIDE4LjYxMWgtMjUuMDg0YTEgMSAwIDAgMSAwLTJoMjUuMDg0YTEgMSAwIDAgMSAwIDJ6Ii8+PHBhdGggZD0ibTQ5LjU0MiAzMi45NjloLTI1LjA4NGExIDEgMCAwIDEgMC0yaDI1LjA4NGExIDEgMCAwIDEgMCAyeiIvPjwvZz48L3N2Zz4=",
            },
            {
                value:
                    'device',
                label:
                    'IoT Device',
                icon:"data:image/svg+xml;base64,PHN2ZyBpZD0iaWNvbnMiIGVuYWJsZS1iYWNrZ3JvdW5kPSJuZXcgMCAwIDY0IDY0IiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDY0IDY0IiB3aWR0aD0iNTEyIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Im00OS44OCAxNC4wNmMtMy4zMzQtNi42MTctMTAuMjI0LTExLjA1NS0xNy44OC0xMS4wNTUtMTAuMDA2IDAtMTguMjk1IDcuMzk0LTE5Ljc1IDE3aC0uMjVjLTYuNjE3IDAtMTIgNS4zODMtMTIgMTJzNS4zODMgMTIgMTIgMTJoNS4wMDh2OC45OWMwIDEuNjU0IDEuMzQ2IDMgMyAzaDYuNzczbC0uNiAzaC0xLjE4MWMtLjU1MyAwLTEgLjQ0Ny0xIDFzLjQ0NyAxIDEgMWgxNGMuNTUzIDAgMS0uNDQ3IDEtMXMtLjQ0Ny0xLTEtMWgtMS4xODJsLS42LTNoNi43NzNjMS42NTQgMCAzLTEuMzQ2IDMtM3YtOC45OWgyLjAwOWM4LjI3MSAwIDE1LTYuNzI5IDE1LTE1IDAtNy45MjEtNi4yNzktMTQuNDg0LTE0LjEyLTE0Ljk0NXptLTQuODg4IDM1LjkzNWgtMjUuOTg0di0xNC45ODhjMC0uNTUyLjQ0OC0xIDEtMWgyMy45ODRjLjU1MiAwIDEgLjQ0OCAxIDF6bS05LjIxMyA5aC03LjU1OWwuNi0zaDYuMzU5em04LjIxMy01aC0xMS45NjItMTIuMDIyYy0uNTUyIDAtMS0uNDQ4LTEtMXYtMWgxMy4wMTJjLS41NTIgMC0uOTk0LjQ0Ny0uOTk0IDFzLjQ1MiAxIDEuMDA1IDFjLjU1MiAwIDEtLjQ0NyAxLTFzLS40NDgtMS0xLTFoMTIuOTYydjFjLS4wMDEuNTUyLS40NDkgMS0xLjAwMSAxem01LjAwOC0xMS45OWgtMi4wMDh2LTYuOTk4YzAtMS42NTQtMS4zNDYtMy0zLTNoLTIzLjk4NGMtMS42NTQgMC0zIDEuMzQ2LTMgM3Y2Ljk5OGgtNS4wMDhjLTUuNTE0IDAtMTAtNC40ODYtMTAtMTBzNC40ODYtMTAgMTAtMTBoLjA1MWMtLjAxNy4zMzMtLjA1MS42NjItLjA1MSAxIDAgLjU1My40NDcgMSAxIDFzMS0uNDQ3IDEtMWMwLTkuOTI1IDguMDc1LTE4IDE4LTE4IDguNDI3IDAgMTUuODI3IDUuOTY5IDE3LjU5NyAxNC4xOTMuMjY3IDEuMjQuNDAzIDIuNTIyLjQwMyAzLjgwNyAwIC41NTMuNDQ3IDEgMSAxczEtLjQ0NyAxLTFjMC0xLjQyNy0uMTUtMi44NS0uNDQ4LTQuMjI4LS4xOTUtLjkwNS0uNDY4LTEuNzc4LS43OC0yLjYzMSA2LjMxNy44NzUgMTEuMjI4IDYuMzM4IDExLjIyOCAxMi44NTkgMCA3LjE2OC01LjgzMiAxMy0xMyAxM3oiLz48cGF0aCBkPSJtMzYuNzA5IDE3LjI5NGMtLjA5Mi0uMDkzLS4yMDMtLjE2Ni0uMzI2LS4yMTctLjI0NC0uMTAyLS41Mi0uMTAyLS43NjQgMC0uMTIzLjA1MS0uMjM0LjEyNC0uMzI2LjIxN2wtMS45OTkgMS45OTljLS4zOTEuMzkxLS4zOTEgMS4wMjMgMCAxLjQxNC4xOTUuMTk1LjQ1MS4yOTMuNzA3LjI5M3MuNTEyLS4wOTguNzA3LS4yOTNsLjI5My0uMjkzdjcuNTg4YzAgLjU1My40NDcgMSAxIDFzMS0uNDQ3IDEtMXYtNy41ODhsLjI5My4yOTNjLjE5NS4xOTUuNDUxLjI5My43MDcuMjkzcy41MTItLjA5OC43MDctLjI5M2MuMzkxLS4zOTEuMzkxLTEuMDIzIDAtMS40MTR6Ii8+PHBhdGggZD0ibTI5LjI5MSAyNS4yOTUtLjI5My4yOTN2LTcuNTg4YzAtLjU1My0uNDQ3LTEtMS0xcy0xIC40NDctMSAxdjcuNTg4bC0uMjkzLS4yOTNjLS4zOTEtLjM5MS0xLjAyMy0uMzkxLTEuNDE0IDBzLS4zOTEgMS4wMjMgMCAxLjQxNGwxLjk5OSAxLjk5OWMuMDkyLjA5My4yMDMuMTY2LjMyNi4yMTcuMTIyLjA1MS4yNTIuMDc3LjM4Mi4wNzdzLjI2LS4wMjYuMzgyLS4wNzdjLjEyMy0uMDUxLjIzNC0uMTI0LjMyNi0uMjE3bDEuOTk5LTEuOTk5Yy4zOTEtLjM5MS4zOTEtMS4wMjMgMC0xLjQxNHMtMS4wMjMtLjM5MS0xLjQxNCAweiIvPjwvc3ZnPg==",
            },
            {
                value:
                    'manual',
                label:
                    'Manual',
                icon:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNTEyIDUxMjsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik00NzUsMEg3N0M0OS40MywwLDI3LDIyLjQzLDI3LDUwdjQ5LjY2N2MwLDUuNTIyLDQuNDc3LDEwLDEwLDEwczEwLTQuNDc4LDEwLTEwVjUwYzAtMTYuNTQyLDEzLjQ1OC0zMCwzMC0zMGgxNHYzMjcuMzMzDQoJCQljMCw1LjUyMiw0LjQ3NywxMCwxMCwxMHMxMC00LjQ3OCwxMC0xMFYyMGgzNTR2MzkySDc3Yy0xMS4yNDgsMC0yMS42MzcsMy43MzUtMzAsMTAuMDI3VjE5MWMwLTUuNTIyLTQuNDc3LTEwLTEwLTEwDQoJCQlzLTEwLDQuNDc4LTEwLDEwdjI3MWMwLDI3LjU3LDIyLjQzLDUwLDUwLDUwaDM5OGM1LjUyMywwLDEwLTQuNDc4LDEwLTEwVjEwQzQ4NSw0LjQ3OCw0ODAuNTIzLDAsNDc1LDB6IE00NjUsNDUyaC04Ni44OA0KCQkJYy01LjUyMywwLTEwLDQuNDc4LTEwLDEwYzAsNS41MjIsNC40NzcsMTAsMTAsMTBINDY1djIwSDc3Yy0xNi41NDIsMC0zMC0xMy40NTgtMzAtMzBzMTMuNDU4LTMwLDMwLTMwaDM4OFY0NTJ6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik00NC4wNywxNDEuOTNDNDIuMjEsMTQwLjA3LDM5LjYzLDEzOSwzNywxMzlzLTUuMjEsMS4wNjktNy4wNywyLjkzQzI4LjA3LDE0My43OSwyNywxNDYuMzcsMjcsMTQ5czEuMDcsNS4yMSwyLjkzLDcuMDY5DQoJCQlDMzEuNzksMTU3LjkzLDM0LjM3LDE1OSwzNywxNTlzNS4yMS0xLjA3LDcuMDctMi45MzFDNDUuOTMsMTU0LjIxLDQ3LDE1MS42Myw0NywxNDlTNDUuOTMsMTQzLjc5LDQ0LjA3LDE0MS45M3oiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHBhdGggZD0iTTEwOC4wNywzNzcuMDMxYy0xLjg2LTEuODctNC40NC0yLjkzMS03LjA3LTIuOTMxcy01LjIxLDEuMDYxLTcuMDcsMi45MzFDOTIuMDcsMzc4Ljg5LDkxLDM4MS40Niw5MSwzODQuMQ0KCQkJYzAsMi42MywxLjA3LDUuMiwyLjkzLDcuMDdjMS44NiwxLjg2LDQuNDQsMi45Myw3LjA3LDIuOTNzNS4yMS0xLjA3LDcuMDctMi45M3MyLjkzLTQuNDQsMi45My03LjA3DQoJCQlDMTExLDM4MS40NiwxMDkuOTMsMzc4Ljg4LDEwOC4wNywzNzcuMDMxeiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cGF0aCBkPSJNNDM1LjkwOSwxNzkuNTQ2aC01LjA3NGMtOC45NjUsMC0xNy4wMDgtNS40NjctMjAuNDc4LTEzLjg5NWwtMC4xOS0wLjQ2Yy0zLjUzMi04LjQ5Ny0xLjcyMi0xOC4wODEsNC42MTItMjQuNDE1DQoJCQlsMy41ODUtMy41ODVjMy45MDUtMy45MDUsMy45MDUtMTAuMjM3LDAtMTQuMTQzTDM4MC45NSw4NS42MzRjLTEuODc1LTEuODc1LTQuNDE5LTIuOTI5LTcuMDcxLTIuOTI5DQoJCQljLTIuNjUyLDAtNS4xOTYsMS4wNTQtNy4wNzEsMi45MjlsLTMuNTg0LDMuNTg1Yy02LjMzNCw2LjMzNS0xNS45MTksOC4xNDQtMjQuNDEyLDQuNjE1bC0wLjQzMi0wLjE3OQ0KCQkJYy04LjQ2LTMuNDgyLTEzLjkyNy0xMS41MjUtMTMuOTI3LTIwLjQ5MXYtNS4wNzNjMC01LjUyMi00LjQ3Ny0xMC0xMC0xMGgtNTIuOTExYy01LjUyMywwLTEwLDQuNDc4LTEwLDEwdjUuMTczDQoJCQljMCw4LjkzNi01LjQ0MywxNi45NTQtMTMuODQ1LDIwLjQybC0wLjQ3OCwwLjE5N2MtOC40ODMsMy41MzctMTguMDUyLDEuNzMzLTI0LjM3Ni00LjU5MWwtMy42NTYtMy42NTYNCgkJCWMtMS44NzUtMS44NzUtNC40MTktMi45MjktNy4wNzEtMi45MjlzLTUuMTk2LDEuMDU0LTcuMDcxLDIuOTI5bC0zNy40MTQsMzcuNDE0Yy0xLjg3NSwxLjg3Ni0yLjkyOSw0LjQxOS0yLjkyOSw3LjA3MQ0KCQkJYzAsMi42NTIsMS4wNTQsNS4xOTYsMi45MjksNy4wNzFsMy43MzIsMy43MzJjNi4zMDgsNi4zMDgsOC4xMTMsMTUuODUyLDQuNjA4LDI0LjI5M2wtMC4xODEsMC40NDcNCgkJCWMtMy40NjgsOC40MzQtMTEuNDgyLDEzLjg4My0yMC40MTcsMTMuODgzaC01LjI4M2MtNS41MjMsMC0xMCw0LjQ3OC0xMCwxMHY1Mi45MWMwLDUuNTIyLDQuNDc3LDEwLDEwLDEwaDUuMzcyDQoJCQljOC45MSwwLDE2LjkwNSw1LjQzLDIwLjM3LDEzLjgzNWwwLjE3OSwwLjQzMmMzLjUyLDguNDU0LDEuNzIyLDE3Ljk4OS00LjU4LDI0LjI5MmwtMy43OTYsMy43OTYNCgkJCWMtMS44NzUsMS44NzUtMi45MjksNC40MTktMi45MjksNy4wNzFjMCwyLjY1MiwxLjA1NCw1LjE5NSwyLjkyOSw3LjA3MWwzNy40MTQsMzcuNDE0YzEuODc1LDEuODc1LDQuNDE5LDIuOTI5LDcuMDcyLDIuOTI5DQoJCQlzNS4xOTYtMS4wNTQsNy4wNzEtMi45M2wzLjc5NS0zLjc5NmM2LjMwNC02LjMwMywxNS44MzgtOC4wOTksMjQuMjgyLTQuNTg1bDAuNDQzLDAuMTg0YzguNDAzLDMuNDY0LDEzLjgzMywxMS40NiwxMy44MzMsMjAuMzY5DQoJCQl2NS4zNzJjMCw1LjUyMiw0LjQ3NywxMCwxMCwxMGg1Mi45MTFjNS41MjMsMCwxMC00LjQ3OCwxMC0xMHYtNS4yODJjMC04LjkzNSw1LjQ0OS0xNi45NDksMTMuOTIzLTIwLjQzNGwwLjM4NC0wLjE1OQ0KCQkJYzguNDYxLTMuNTEzLDE4LjAwNi0xLjcxLDI0LjMxNCw0LjZsMy43MzMsMy43MzJjMy45MDUsMy45MDQsMTAuMjM3LDMuOTA0LDE0LjE0MiwwbDM3LjQxNC0zNy40MTQNCgkJCWMxLjg3NS0xLjg3NiwyLjkyOS00LjQyLDIuOTI5LTcuMDcycy0xLjA1NC01LjE5NS0yLjkzLTcuMDcxbC0zLjY1NS0zLjY1NGMtNi4zMjUtNi4zMjUtOC4xMjctMTUuODk0LTQuNTktMjQuMzc4bDAuMTg4LTAuNDU0DQoJCQljMy40NzUtOC40MjQsMTEuNDkzLTEzLjg2NywyMC40MjgtMTMuODY3aDUuMTczYzUuNTIzLDAsMTAtNC40NzgsMTAtMTB2LTUyLjkxQzQ0NS45MDksMTg0LjAyNCw0NDEuNDMyLDE3OS41NDYsNDM1LjkwOSwxNzkuNTQ2eg0KCQkJIE0yMTkuNzMsMzE2Ljk4NWMtMC4wNTIsMC4wNTItMC4wOTYsMC4xMDktMC4xNDcsMC4xNjJjLTYuMjQzLDEuMzQzLTEyLjE2OCw0LjA5Ni0xNy4yODMsOC4xODdMMTc4LjY2NywzMDEuNw0KCQkJYzMuODE5LTQuNzc1LDYuNDU4LTEwLjI2LDcuODg1LTE2LjA0OGMwLjE5Ni0wLjE2OCwwLjM5Mi0wLjMzNiwwLjU3OC0wLjUyMmwzOS4yNjItMzkuMjYzYzIuNjU4LTIuNjU4LDMuNjAxLTYuNTgyLDIuNDQxLTEwLjE1Nw0KCQkJYy03LjI0MS0yMi4zMjItMS40NC00Ni40ODksMTUuMTM5LTYzLjA2OGMxMy43NjUtMTMuNzY2LDMyLjgyNy0yMC4wNTQsNTEuNTMxLTE3LjcxN2wtMjkuMjgsMjkuMjc5DQoJCQljLTIuNDgzLDIuNDg0LTMuNDgyLDYuMDg5LTIuNjMsOS40OTdsNy45ODMsMzEuOTM1YzAuODk2LDMuNTgyLDMuNjkzLDYuMzgsNy4yNzYsNy4yNzVsMzEuOTM1LDcuOTg0DQoJCQljMy40MSwwLjg1NCw3LjAxMy0wLjE0Niw5LjQ5Ny0yLjYzbDI5LjE2NS0yOS4xNjVjMi4yNDQsMTguNjI0LTQuMDU0LDM3LjU4NS0xNy43NDQsNTEuMjc0DQoJCQljLTE2LjU0MywxNi41NDItNDAuNjY2LDIyLjM1Ny02Mi45NTQsMTUuMTc3Yy0zLjkxNy0xLjI2LTguMTI5LDAuMDMzLTEwLjcwNSwzLjExOEwyMTkuNzMsMzE2Ljk4NXogTTQyNS45MDksMjMyLjczMw0KCQkJYy0xNS4wNzQsMS43MzktMjguMTQzLDExLjU0My0zNC4wODgsMjUuOTU5bC0wLjE2MywwLjM5M2MtNi4wMzEsMTQuNDctMy43NDQsMzAuNjk1LDUuNjkxLDQyLjYwMmwtMjMuNjU2LDIzLjY1Ng0KCQkJYy0xMS44ODgtOS40Ny0yOC4xMjQtMTEuNzg4LTQyLjYyMS01Ljc2OWwtMC4zNCwwLjE0MWMtMTQuNDc2LDUuOTUyLTI0LjMwNywxOS4wNjktMjYuMDEyLDM0LjE5NmgtMzMuNDMNCgkJCWMtMS42NzUtMTUuMTI3LTExLjQ4NC0yOC4yNTctMjUuOTY0LTM0LjIzNGwyMy4zNzctMjMuMzc3YzI3LjcwMSw2LjY2Niw1Ni43NjktMS40MDYsNzcuMTQ1LTIxLjc4DQoJCQljMjMuMjUyLTIzLjI1MywzMC4zNzctNTguMDA4LDE4LjE1LTg4LjU0M2MtMS4yNDktMy4xMTktMy45ODItNS40MDMtNy4yNzQtNi4wNzhjLTMuMjkzLTAuNjc5LTYuNzAzLDAuMzUtOS4wOCwyLjcyNQ0KCQkJbC0zNy40OTgsMzcuNDk4bC0yMC42MjItNS4xNTVsLTUuMTU1LTIwLjYyMWwzNy41Ni0zNy41NmMyLjM3My0yLjM3MywzLjM5Ny01Ljc3NywyLjcyOC05LjA2NQ0KCQkJYy0wLjY2OS0zLjI4OC0yLjk0My02LjAyMS02LjA1NC03LjI3OGMtMzAuNTk4LTEyLjM1OC02NS40NDItNS4yNzEtODguNzc0LDE4LjA2Yy0yMC40NCwyMC40NDEtMjguNDkxLDQ5LjYwMi0yMS43MjUsNzcuMzcyDQoJCQlsLTIzLjUwMiwyMy41MDJjLTAuMDQ5LTAuMTItMC4wODYtMC4yNDEtMC4xMzYtMC4zNjFsLTAuMTQzLTAuMzQ2Yy01Ljk2Mi0xNC40NjYtMTkuMDk4LTI0LjI4Mi0zNC4yMzItMjUuOTU3di0zMy40Mw0KCQkJYzE1LjEyNy0xLjcwNywyOC4yNDMtMTEuNTM5LDM0LjE5OS0yNi4wMjFsMC4xNDctMC4zNTRjNi4wMTItMTQuNDc3LDMuNjkzLTMwLjcxMS01Ljc3Ny00Mi42MDFsMjMuNjU2LTIzLjY1Ng0KCQkJYzExLjkwNSw5LjQzNSwyOC4xMzIsMTEuNzI0LDQyLjYxMiw1LjY4N2wwLjM3Ni0wLjE1NmMxNC40MjEtNS45NDcsMjQuMjI2LTE5LjAxNiwyNS45NjQtMzQuMDloMzMuNDc2DQoJCQljMS43NzEsMTUuMDY4LDExLjU5NSwyOC4xMTksMjYuMDQ3LDM0LjA2N2wwLjM0MSwwLjE0MmMxNC40NDYsNi4wMDUsMzAuNjQyLDMuNzMsNDIuNTQ0LTUuNjU3bDIzLjY4MSwyMy42ODINCgkJCWMtOS4zODgsMTEuOTAxLTExLjY2MywyOC4wOTYtNS42Niw0Mi41MzdjMC4wMDEsMC4wMDEsMC4wMzksMC4wOTMsMC4wNCwwLjA5NWwwLjExMywwLjI3NA0KCQkJYzUuOTQxLDE0LjQzMywxOC45OTIsMjQuMjU1LDM0LjA1OSwyNi4wMjZWMjMyLjczM3oiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHBhdGggZD0iTTM0Ny42OSw0NTQuOTNjLTEuODctMS44NjEtNC40NC0yLjkzLTcuMDgtMi45M2MtMi42MywwLTUuMiwxLjA2OS03LjA3LDIuOTNjLTEuODYsMS44Ni0yLjkzLDQuNDQtMi45Myw3LjA3DQoJCQlzMS4wNyw1LjIxLDIuOTMsNy4wNjljMS44NywxLjg2LDQuNDQsMi45MzEsNy4wNywyLjkzMWMyLjY0LDAsNS4yMi0xLjA3LDcuMDgtMi45MzFjMS44Ni0xLjg1OSwyLjkzLTQuNDM5LDIuOTMtNy4wNjkNCgkJCVMzNDkuNTUsNDU2Ljc5LDM0Ny42OSw0NTQuOTN6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPC9zdmc+DQo=',
            },
            {
                value:
                    'api',
                label:
                    'API',
                icon:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJMYXllcl8xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4PSIwcHgiIHk9IjBweCINCgkgdmlld0JveD0iMCAwIDUxMS45OTkgNTExLjk5OSIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNTExLjk5OSA1MTEuOTk5OyIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSI+DQo8Zz4NCgk8Zz4NCgkJPHBhdGggZD0iTTQ3MC4zMTYsMzIuNDI3SDQxLjY4M0MxOC43LDMyLjQyNywwLDUxLjEyNywwLDc0LjExMXY0MC40MzNjMCw0Ljk2NSw0LjAyNCw4Ljk5MSw4Ljk5MSw4Ljk5MQ0KCQkJYzQuOTY3LDAsOC45OTEtNC4wMjYsOC45OTEtOC45OTFWNzQuMTExYzAtMTMuMDY5LDEwLjYzMi0yMy43MDEsMjMuNzAxLTIzLjcwMWg0MjguNjM0YzEzLjA2OSwwLDIzLjcwMSwxMC42MzIsMjMuNzAxLDIzLjcwMQ0KCQkJdjI2Ny4wMDJjMCw0Ljk2NSw0LjAyNCw4Ljk5MSw4Ljk5MSw4Ljk5MXM4Ljk5MS00LjAyNSw4Ljk5MS04Ljk5MVY3NC4xMTFDNTEyLDUxLjEyNyw0OTMuMywzMi40MjcsNDcwLjMxNiwzMi40Mjd6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik01MDMuMDA5LDM2NS40MTljLTQuOTY3LDAtOC45OTEsNC4wMjUtOC45OTEsOC45OTFjMCwxMy4wNjktMTAuNjMyLDIzLjcwMS0yMy43MDEsMjMuNzAxSDQxLjY4Mw0KCQkJYy0xMy4wNjksMC4wMDEtMjMuNzAxLTEwLjYzMi0yMy43MDEtMjMuNzAxVjE0OS4zMDhjMC00Ljk2NS00LjAyNC04Ljk5MS04Ljk5MS04Ljk5MWMtNC45NjYsMC04Ljk5MSw0LjAyNi04Ljk5MSw4Ljk5MVYzNzQuNDENCgkJCWMwLDIyLjk4NCwxOC43LDQxLjY4NCw0MS42ODMsNDEuNjg0aDE3MS44MzlsLTEwLjkyMyw0NS40OTZoLTQyLjUwM2MtNC45NjYsMC04Ljk5MSw0LjAyNS04Ljk5MSw4Ljk5MXM0LjAyNCw4Ljk5MSw4Ljk5MSw4Ljk5MQ0KCQkJaDQ5LjU5aDkyLjYyM0gzNTEuOWM0Ljk2NiwwLDguOTkxLTQuMDI1LDguOTkxLTguOTkxcy00LjAyNC04Ljk5MS04Ljk5MS04Ljk5MWgtNDIuNTAzbC0xMC45MjItNDUuNDk2aDE3MS44MzkNCgkJCWMyMi45ODQsMCw0MS42ODMtMTguNjk4LDQxLjY4My00MS42ODNDNTEyLDM2OS40NDUsNTA3Ljk3NSwzNjUuNDE5LDUwMy4wMDksMzY1LjQxOXogTTIyMS4wOTQsNDYxLjU4OWwxMC45MjMtNDUuNDk2aDQ3Ljk2OA0KCQkJbDEwLjkyMiw0NS40OTZIMjIxLjA5NHoiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHBhdGggZD0iTTQ3Mi42NSwzNTMuMjY0SDM5LjM1Yy00Ljk2NiwwLTguOTkxLDQuMDI1LTguOTkxLDguOTkxczQuMDI2LDguOTkxLDguOTkxLDguOTkxSDQ3Mi42NWM0Ljk2NywwLDguOTkxLTQuMDI1LDguOTkxLTguOTkxDQoJCQlTNDc3LjYxNywzNTMuMjY0LDQ3Mi42NSwzNTMuMjY0eiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cGF0aCBkPSJNNDcyLjY1LDc3LjI3NkgzOS4zNWMtNC45NjYsMC04Ljk5MSw0LjAyNi04Ljk5MSw4Ljk5MXM0LjAyNCw4Ljk5MSw4Ljk5MSw4Ljk5MUg0NzIuNjVjNC45NjYsMCw4Ljk5MS00LjAyNSw4Ljk5MS04Ljk5MQ0KCQkJUzQ3Ny42MTcsNzcuMjc2LDQ3Mi42NSw3Ny4yNzZ6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik0yNzYuMzgyLDE0Ni45MzhoLTMwLjI3MXYwLjAwMWMtNC45NjcsMC04Ljk5MSw0LjAyNS04Ljk5MSw4Ljk5MXYxMzYuNjZjMCw0Ljk2NSw0LjAyNCw4Ljk5MSw4Ljk5MSw4Ljk5MQ0KCQkJczguOTkxLTQuMDI2LDguOTkxLTguOTkxdi0zNC43OTNoMjEuMjgxYzE4LjIxOCwwLDMzLjA0MS0xNC44MjIsMzMuMDQxLTMzLjA0MXYtNDQuNzc4DQoJCQlDMzA5LjQyMywxNjEuNzYsMjk0LjYwMSwxNDYuOTM4LDI3Ni4zODIsMTQ2LjkzOHogTTI5MS40NCwyMjQuNzU4YzAsOC4zMDQtNi43NTUsMTUuMDU5LTE1LjA1OSwxNS4wNTlIMjU1LjF2LTc0Ljg5NWgyMS4yODENCgkJCWM4LjMwNC0wLjAwMSwxNS4wNTksNi43NTQsMTUuMDU5LDE1LjA1OFYyMjQuNzU4eiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KCTxnPg0KCQk8cGF0aCBkPSJNMjAyLjk3MywyOTAuMzU2bC0xMS4wOTItNDMuMjNjLTEuMjM0LTQuODA4LTYuMTI4LTcuNzA4LTEwLjk0NC02LjQ3NWMtNC44MDksMS4yMzUtNy43MDgsNi4xMzMtNi40NzMsMTAuOTQ0DQoJCQlsMC45NDEsMy42NjlIMTQyLjk5bDE2LjIwNy02My4xNjFsOC40NzQsMzMuMDE4YzEuMjM0LDQuODA4LDYuMTMxLDcuNzExLDEwLjk0NCw2LjQ3M2M0LjgxLTEuMjM1LDcuNzA4LTYuMTM0LDYuNDczLTEwLjk0NA0KCQkJbC0xNy4xODEtNjYuOTU1Yy0xLjAyMS0zLjk3Ni00LjYwNC02Ljc1Ni04LjcwOS02Ljc1NmMtNC4xMDUsMC03LjY4OCwyLjc4LTguNzA5LDYuNzU2bC0zNS4wNjgsMTM2LjY2DQoJCQljLTEuMjM0LDQuODEsMS42NjUsOS43MDksNi40NzMsMTAuOTQ0YzAuNzUsMC4xOTIsMS41MDEsMC4yODQsMi4yNCwwLjI4NGM0LjAwOCwwLDcuNjYxLTIuNjk4LDguNzAzLTYuNzU5bDUuNTM3LTIxLjU3OWg0MS42NDMNCgkJCWw1LjUzNywyMS41NzljMS4wNDIsNC4wNiw0LjY5Niw2Ljc1OSw4LjcwMyw2Ljc1OWMwLjczOCwwLDEuNDkxLTAuMDkyLDIuMjQtMC4yODQNCgkJCUMyMDEuMzA5LDMwMC4wNjUsMjA0LjIwOCwyOTUuMTY2LDIwMi45NzMsMjkwLjM1NnoiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHBhdGggZD0iTTM4Ny44NjgsMjgzLjU5OWgtMTUuNTg0VjE2NC45MjFoMTUuNTg0YzQuOTY2LDAsOC45OTEtNC4wMjUsOC45OTEtOC45OTFzLTQuMDI0LTguOTkxLTguOTkxLTguOTkxaC00OS4xNQ0KCQkJYy00Ljk2NiwwLTguOTkxLDQuMDI1LTguOTkxLDguOTkxczQuMDI0LDguOTkxLDguOTkxLDguOTkxaDE1LjU4NHYxMTguNjc5aC0xNS41ODRjLTQuOTY2LDAtOC45OTEsNC4wMjYtOC45OTEsOC45OTENCgkJCWMwLDQuOTY1LDQuMDI0LDguOTkxLDguOTkxLDguOTkxaDQ5LjE1YzQuOTY2LDAsOC45OTEtNC4wMjYsOC45OTEtOC45OTFDMzk2Ljg1OSwyODcuNjI1LDM5Mi44MzUsMjgzLjU5OSwzODcuODY4LDI4My41OTl6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPC9zdmc+DQo=',
            },
            {
                value:
                    'script',
                label:
                    'Script',
                icon:'data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjUxMXB0IiB2aWV3Qm94PSItNjEgMSA1MTEgNTExLjk5OTk5IiB3aWR0aD0iNTExcHQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0ibTM2MS4yODUxNTYgMzg5LjUxOTUzMWgtMTAuMjV2LTM3MC45NTMxMjVjMC0xMC4yMzgyODEtOC4zMjgxMjUtMTguNTY2NDA2LTE4LjU2NjQwNi0xOC41NjY0MDZoLTEyNS4yNTM5MDZjLTQuMjE0ODQ0IDAtNy42MTcxODggMy40MTQwNjItNy42MTcxODggNy42MTcxODggMCA0LjIwNzAzMSAzLjQwMjM0NCA3LjYxNzE4NyA3LjYxNzE4OCA3LjYxNzE4N2gxMjUuMjUzOTA2YzEuODM1OTM4IDAgMy4zMzIwMzEgMS40OTYwOTQgMy4zMzIwMzEgMy4zMzIwMzF2MzcwLjk1MzEyNWgtMjMyLjU4OTg0M2MtMTUuMDQyOTY5IDAtMjcuMjgxMjUgMTIuMjMwNDY5LTI3LjI4MTI1IDI3LjI3MzQzOHY1MC4zMDA3ODFjMCAxNy45NjQ4NDQtMTYuMzk4NDM4IDMxLjEyODkwNi0yOS42MDkzNzYgMjkuNjYwMTU2LTE1LjY0ODQzNyAwLTMwLjA2MjUtMTIuOTA2MjUtMzAuNTg1OTM3LTMwLjE1NjI1LjAxOTUzMS0yODkuNDE3OTY4LjAyMzQzNy0zMjcuMDQ2ODc1LjAyMzQzNy0zMzAuOTUzMTI1IDAtLjI4OTA2MiAwLS4zOTg0MzcgMC0uNDAyMzQzdi0uMDA3ODEzaDk2LjkzMzU5NGMxOC4zNTE1NjMgMCAzMy4yOTI5NjktMTQuOTQxNDA2IDMzLjI5Mjk2OS0zMy4yOTI5Njl2LTg2LjcwNzAzMWgzMC43NTc4MTNjNC4yMDcwMzEgMCA3LjYxNzE4Ny0zLjQxMDE1NiA3LjYxNzE4Ny03LjYxNzE4NyAwLTQuMjAzMTI2LTMuNDEwMTU2LTcuNjE3MTg4LTcuNjE3MTg3LTcuNjE3MTg4aC0zMy41MDc4MTNjLTUuMDUwNzgxIDAtOS44NDc2NTYgMS44NzUtMTMuNjEzMjgxIDUuMzEyNS0xMzAuMTk1MzEzIDEyMC40NzY1NjItMTI1LjA1ODU5NCAxMTMuNzUzOTA2LTEyNy4zMDQ2ODggMTE5LjUxMTcxOS0xLjE3NTc4MSAyLjU3MDMxMi0xLjc5Njg3NSA1LjQxNDA2Mi0xLjc5Njg3NSA4LjI1NzgxMiAwIDM2LjQ0NTMxMy0uMDE1NjI1IDI5Ny4xOTkyMTktLjAxOTUzMSAzMzMuODk4NDM4LjcyNjU2MiAyNS4xMDkzNzUgMjEuMzI4MTI1IDQ1LjAxOTUzMSA0Ni4zNDc2NTYgNDUuMDE5NTMxIDg0LjY0MDYyNSAwIDYzLjA5NzY1Ni0uMDExNzE5IDI5Ni41NzAzMTMgMCAuMDYyNSAwIC4xMzI4MTIgMCAuMTkxNDA2LS4wMTE3MTloLjA1MDc4MWMxNC4xMjg5MDYgMCAyNy42Mjg5MDYtNi44MjQyMTkgMzYuMDg5ODQ0LTE4LjI1IDIuNTExNzE5LTMuMzgyODEyIDEuODAwNzgxLTguMTQ4NDM3LTEuNTgyMDMxLTEwLjY1NjI1LTMuMzc1LTIuNS04LjE0ODQzOC0xLjc5Njg3NS0xMC42NTYyNSAxLjU4NTkzOC00LjEwNTQ2OSA1LjUzNTE1Ni05Ljk3NjU2MyA5LjQzMzU5My0xNi40NzY1NjMgMTEuMTI4OTA2LTUuMjQ2MDk0IDEuMzg2NzE5IDE3LjI5Mjk2OS45NTcwMzEtMjcwLjkxMDE1Ni45NTcwMzEgNi45MDYyNS03Ljk3MjY1NiAxMS4wNDI5NjktMTguMzg2NzE4IDExLjA0Mjk2OS0yOS42NjAxNTZ2LTUwLjMwMDc4MWMwLTYuNjMyODEzIDUuNDAyMzQzLTEyLjAzNTE1NyAxMi4wNDI5NjktMTIuMDM1MTU3aDI1OC4wNzQyMThjNi42NDQ1MzIgMCAxMi4wNDY4NzUgNS40MDIzNDQgMTIuMDQ2ODc1IDEyLjAzNTE1N3Y0My41MjczNDNjMCA0LjIwMzEyNiAzLjQxNDA2MyA3LjYxNzE4OCA3LjYxNzE4OCA3LjYxNzE4OCA0LjIwNzAzMSAwIDcuNjE3MTg3LTMuNDE0MDYyIDcuNjE3MTg3LTcuNjE3MTg4di00My41MjczNDNjMC0xNS4wNDI5NjktMTIuMjM4MjgxLTI3LjI3MzQzOC0yNy4yODEyNS0yNy4yNzM0Mzh6bS0yMzAuNTM1MTU2LTM2NC41MjM0Mzd2NzYuOTQ1MzEyYzAgOS45NTMxMjUtOC4xMDU0NjkgMTguMDU4NTk0LTE4LjA1ODU5NCAxOC4wNTg1OTRoLTg1LjAzOTA2MnptMCAwIi8+PHBhdGggZD0ibTI5OS40NDUzMTIgMzQzLjQ3NjU2MmgtMTcyLjY3NTc4MWMtNC4yMDcwMzEgMC03LjYyMTA5MyAzLjQxNDA2My03LjYyMTA5MyA3LjYxNzE4OCAwIDQuMjA3MDMxIDMuNDE0MDYyIDcuNjE3MTg4IDcuNjIxMDkzIDcuNjE3MTg4aDE3Mi42NzU3ODFjNC4yMDcwMzIgMCA3LjYxNzE4OC0zLjQxMDE1NyA3LjYxNzE4OC03LjYxNzE4OCAwLTQuMjAzMTI1LTMuNDEwMTU2LTcuNjE3MTg4LTcuNjE3MTg4LTcuNjE3MTg4em0wIDAiLz48cGF0aCBkPSJtNTEuMjc3MzQ0IDM0My40NzY1NjJjLTQuMjA3MDMyIDAtNy42MTcxODggMy40MTQwNjMtNy42MTcxODggNy42MTcxODggMCA0LjIwNzAzMSAzLjQxMDE1NiA3LjYxNzE4OCA3LjYxNzE4OCA3LjYxNzE4OGg0NS4wMTk1MzFjNC4yMDMxMjUgMCA3LjYxNzE4Ny0zLjQxMDE1NyA3LjYxNzE4Ny03LjYxNzE4OCAwLTQuMjAzMTI1LTMuNDE0MDYyLTcuNjE3MTg4LTcuNjE3MTg3LTcuNjE3MTg4em0wIDAiLz48cGF0aCBkPSJtMjk5LjQ0NTMxMiAyOTUuMDU0Njg4aC0yNDguMTY3OTY4Yy00LjIxMDkzOCAwLTcuNjIxMDk0IDMuNDEwMTU2LTcuNjIxMDk0IDcuNjE3MTg3IDAgNC4yMTA5MzcgMy40MTAxNTYgNy42MTcxODcgNy42MjEwOTQgNy42MTcxODdoMjQ4LjE2Nzk2OGM0LjIwNzAzMiAwIDcuNjE3MTg4LTMuNDA2MjUgNy42MTcxODgtNy42MTcxODcgMC00LjIwNzAzMS0zLjQxMDE1Ni03LjYxNzE4Ny03LjYxNzE4OC03LjYxNzE4N3ptMCAwIi8+PHBhdGggZD0ibTI5OS40NDUzMTIgMjQ2LjYyODkwNmgtMjQ4LjE2Nzk2OGMtNC4yMTA5MzggMC03LjYyMTA5NCAzLjQxMDE1Ni03LjYyMTA5NCA3LjYyMTA5NCAwIDQuMjA3MDMxIDMuNDEwMTU2IDcuNjE3MTg4IDcuNjIxMDk0IDcuNjE3MTg4aDI0OC4xNjc5NjhjNC4yMDcwMzIgMCA3LjYxNzE4OC0zLjQxMDE1NyA3LjYxNzE4OC03LjYxNzE4OCAwLTQuMjEwOTM4LTMuNDEwMTU2LTcuNjIxMDk0LTcuNjE3MTg4LTcuNjIxMDk0em0wIDAiLz48cGF0aCBkPSJtMjk5LjQ0NTMxMiAxOTguMjAzMTI1aC00NS4wMTU2MjRjLTQuMjA3MDMyIDAtNy42MjEwOTQgMy40MTQwNjMtNy42MjEwOTQgNy42MTcxODcgMCA0LjIxODc1IDMuNDE0MDYyIDcuNjIxMDk0IDcuNjIxMDk0IDcuNjIxMDk0aDQ1LjAxNTYyNGM0LjIwNzAzMiAwIDcuNjE3MTg4LTMuNDAyMzQ0IDcuNjE3MTg4LTcuNjIxMDk0IDAtNC4yMDMxMjQtMy40MTAxNTYtNy42MTcxODctNy42MTcxODgtNy42MTcxODd6bTAgMCIvPjxwYXRoIGQ9Im01MS4yNzczNDQgMjEzLjQ0MTQwNmgxNzIuNjc5Njg3YzQuMjAzMTI1IDAgNy42MTcxODgtMy40MDIzNDQgNy42MTcxODgtNy42MjEwOTQgMC00LjIwMzEyNC0zLjQxNDA2My03LjYxNzE4Ny03LjYxNzE4OC03LjYxNzE4N2gtMTcyLjY3OTY4N2MtNC4yMDcwMzIgMC03LjYxNzE4OCAzLjQxNDA2My03LjYxNzE4OCA3LjYxNzE4NyAwIDQuMjE4NzUgMy40MTAxNTYgNy42MjEwOTQgNy42MTcxODggNy42MjEwOTR6bTAgMCIvPjxwYXRoIGQ9Im0yOTkuNDQ1MzEyIDE0OS43ODUxNTZoLTI0OC4xNjc5NjhjLTQuMjEwOTM4IDAtNy42MjEwOTQgMy40MTAxNTYtNy42MjEwOTQgNy42MTcxODggMCA0LjIwNzAzMSAzLjQxMDE1NiA3LjYxNzE4NyA3LjYyMTA5NCA3LjYxNzE4N2gyNDguMTY3OTY4YzQuMjA3MDMyIDAgNy42MTcxODgtMy40MTAxNTYgNy42MTcxODgtNy42MTcxODcgMC00LjIwNzAzMi0zLjQxMDE1Ni03LjYxNzE4OC03LjYxNzE4OC03LjYxNzE4OHptMCAwIi8+PHBhdGggZD0ibTI5OS40NDUzMTIgMTAxLjM1OTM3NWgtMTE4LjAzMTI1Yy00LjIwNzAzMSAwLTcuNjE3MTg3IDMuNDEwMTU2LTcuNjE3MTg3IDcuNjE3MTg3IDAgNC4yMTA5MzggMy40MTAxNTYgNy42MjEwOTQgNy42MTcxODcgNy42MjEwOTRoMTE4LjAzMTI1YzQuMjA3MDMyIDAgNy42MTcxODgtMy40MTAxNTYgNy42MTcxODgtNy42MjEwOTQgMC00LjIwNzAzMS0zLjQxMDE1Ni03LjYxNzE4Ny03LjYxNzE4OC03LjYxNzE4N3ptMCAwIi8+PHBhdGggZD0ibTI5OS40NDUzMTIgNTIuOTM3NWgtMTE4LjAzMTI1Yy00LjIwNzAzMSAwLTcuNjE3MTg3IDMuNDEwMTU2LTcuNjE3MTg3IDcuNjE3MTg4IDAgNC4yMDcwMzEgMy40MTAxNTYgNy42MTcxODcgNy42MTcxODcgNy42MTcxODdoMTE4LjAzMTI1YzQuMjA3MDMyIDAgNy42MTcxODgtMy40MTAxNTYgNy42MTcxODgtNy42MTcxODcgMC00LjIwNzAzMi0zLjQxMDE1Ni03LjYxNzE4OC03LjYxNzE4OC03LjYxNzE4OHptMCAwIi8+PC9zdmc+'
            },
            {
                value:
                    'server-monitor',
                label:
                    'Server',
                icon:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iNzUwcHQiIHZlcnNpb249IjEuMSIgdmlld0JveD0iMCAwIDc1MCA3NTAuMDAyMiIgd2lkdGg9Ijc1MHB0Ij4KPGcgaWQ9InN1cmZhY2UxIj4KPHBhdGggZD0iTSA1MCA2NTAuMDAzOTA2IEwgMTgxLjk2MDkzOCA2NTAuMDAzOTA2IEwgMTUzLjgzNTkzOCA3MjUuMDAzOTA2IEwgMTI1IDcyNS4wMDM5MDYgTCAxMjUgNzUwLjAwMzkwNiBMIDM3NC45OTYwOTQgNzUwLjAwMzkwNiBMIDM3NC45OTYwOTQgNzI1LjAwMzkwNiBMIDM0Ni4xNjAxNTYgNzI1LjAwMzkwNiBMIDMxOC4wMzkwNjIgNjUwLjAwMzkwNiBMIDQ2Mi40OTIxODggNjUwLjAwMzkwNiBDIDQ5MC4xMDkzNzUgNjUwLjAwMzkwNiA1MTIuNDkyMTg4IDYyNy42MTcxODggNTEyLjQ5MjE4OCA2MDAuMDAzOTA2IEwgNTEyLjQ5MjE4OCAzODcuNTA3ODEyIEwgNDg3LjQ5MjE4OCAzODcuNTA3ODEyIEwgNDg3LjQ5MjE4OCA1NTAuMDAzOTA2IEwgMjUgNTUwLjAwMzkwNiBMIDI1IDMwMC4wMTE3MTkgQyAyNSAyODYuMjA3MDMxIDM2LjE5NTMxMiAyNzUuMDExNzE5IDUwIDI3NS4wMTE3MTkgTCAxNTAgMjc1LjAxMTcxOSBMIDE1MCAyNTAuMDExNzE5IEwgNTAgMjUwLjAxMTcxOSBDIDIyLjM4NjcxOSAyNTAuMDExNzE5IDAgMjcyLjM5ODQzOCAwIDMwMC4wMTE3MTkgTCAwIDYwMC4wMDM5MDYgQyAwIDYyNy42MTcxODggMjIuMzg2NzE5IDY1MC4wMDM5MDYgNTAgNjUwLjAwMzkwNiBaIE0gMzE5LjQ1NzAzMSA3MjUuMDAzOTA2IEwgMTgwLjUzOTA2MiA3MjUuMDAzOTA2IEwgMjA4LjY2NDA2MiA2NTAuMDAzOTA2IEwgMjkxLjMzMjAzMSA2NTAuMDAzOTA2IFogTSA0ODcuNDkyMTg4IDU3NS4wMDM5MDYgTCA0ODcuNDkyMTg4IDYwMC4wMDM5MDYgQyA0ODcuNDkyMTg4IDYxMy44MDg1OTQgNDc2LjMwMDc4MSA2MjUuMDAzOTA2IDQ2Mi40OTIxODggNjI1LjAwMzkwNiBMIDUwIDYyNS4wMDM5MDYgQyAzNi4xOTUzMTIgNjI1LjAwMzkwNiAyNSA2MTMuODA4NTk0IDI1IDYwMC4wMDM5MDYgTCAyNSA1NzUuMDAzOTA2IFogTSA0ODcuNDkyMTg4IDU3NS4wMDM5MDYgIiBzdHlsZT0iIHN0cm9rZTpub25lO2ZpbGwtcnVsZTpub256ZXJvO2ZpbGw6cmdiKDAlLDAlLDAlKTtmaWxsLW9wYWNpdHk6MTsiIC8+CjxwYXRoIGQ9Ik0gNjk5LjgyODEyNSAxNTYuNDUzMTI1IEMgNjk5Ljk4NDM3NSAxNTQuMzEyNSA2OTkuOTg0Mzc1IDE1Mi4xNjQwNjIgNjk5Ljk4NDM3NSAxNTAuMDE1NjI1IEMgNzAwLjAyNzM0NCA4My4xMjg5MDYgNjU1Ljc2MTcxOSAyNC4zMTI1IDU5MS40NzY1NjIgNS44Mzk4NDQgQyA1MjcuMTk1MzEyIC0xMi42MjUgNDU4LjQ0OTIxOSAxMy43MjI2NTYgNDIyLjk4MDQ2OSA3MC40Mjk2ODggQyA0MDUuNjMyODEyIDU3LjEyNSAzODQuMzU5Mzc1IDQ5Ljk0NTMxMiAzNjIuNDk2MDk0IDUwLjAxOTUzMSBDIDMxMS4wNTg1OTQgNTAuMDc4MTI1IDI2OC4wMzUxNTYgODkuMTA1NDY5IDI2Mi45NjA5MzggMTQwLjI5Mjk2OSBDIDIwNy4xMzI4MTIgMTUyLjkyNTc4MSAxNjkuNjk1MzEyIDIwNS40NjQ4NDQgMTc1Ljk3MjY1NiAyNjIuMzU5Mzc1IEMgMTgyLjI1MzkwNiAzMTkuMjU3ODEyIDIzMC4yNTc4MTIgMzYyLjM1OTM3NSAyODcuNDk2MDk0IDM2Mi41MDc4MTIgTCA2MzcuNDg0Mzc1IDM2Mi41MDc4MTIgQyA2ODcuMDMxMjUgMzYyLjQ0OTIxOSA3MzAuNjkxNDA2IDMzMCA3NDUuMDMxMjUgMjgyLjU4OTg0NCBDIDc1OS4zNzg5MDYgMjM1LjE3NTc4MSA3NDEuMDIzNDM4IDE4My45NTcwMzEgNjk5LjgyODEyNSAxNTYuNDUzMTI1IFogTSA2MzcuNDg0Mzc1IDMzNy41MDc4MTIgTCAyODcuNDk2MDk0IDMzNy41MDc4MTIgQyAyNDEuNTMxMjUgMzM3LjE4NzUgMjAzLjY1NjI1IDMwMS4zNTE1NjIgMjAwLjc3NzM0NCAyNTUuNDc2NTYyIEMgMTk3LjkxNDA2MiAyMDkuNjAxNTYyIDIzMS4wMzEyNSAxNjkuMzI4MTI1IDI3Ni42MDE1NjIgMTYzLjI3NzM0NCBDIDI4Mi45NjQ4NDQgMTYyLjA4NTkzOCAyODcuNTcwMzEyIDE1Ni40OTYwOTQgMjg3LjQ5NjA5NCAxNTAuMDE1NjI1IEMgMjg3LjUzOTA2MiAxMDguNjEzMjgxIDMyMS4wOTM3NSA3NS4wNTg1OTQgMzYyLjQ5NjA5NCA3NS4wMTk1MzEgQyAzODMuMjQ2MDk0IDc0Ljk0NTMxMiA0MDMuMDc0MjE5IDgzLjU1NDY4OCA0MTcuMTc5Njg4IDk4Ljc2MTcxOSBDIDQyMCAxMDEuNzc3MzQ0IDQyNC4xMTMyODEgMTAzLjE5NTMxMiA0MjguMTgzNTk0IDEwMi41ODIwMzEgQyA0MzIuMjUzOTA2IDEwMS45NTcwMzEgNDM1Ljc2NTYyNSA5OS4zNzUgNDM3LjU1ODU5NCA5NS42NjQwNjIgQyA0NjIuODYzMjgxIDQzLjE2MDE1NiA1MjEuMTI1IDE1LjEzMjgxMiA1NzcuOTQ5MjE5IDI4LjE0MDYyNSBDIDYzNC43Njk1MzEgNDEuMTQwNjI1IDY3NS4wNDI5NjkgOTEuNzIyNjU2IDY3NC45ODQzNzUgMTUwLjAxNTYyNSBDIDY3NC45ODQzNzUgMTU0LjAzNTE1NiA2NzQuNzUzOTA2IDE1OC4wMTU2MjUgNjc0LjM3NSAxNjEuOTQxNDA2IEMgNjczLjkyMTg3NSAxNjYuODI4MTI1IDY3Ni4zNjcxODggMTcxLjUzMTI1IDY4MC42MjUgMTczLjk2ODc1IEMgNzE1LjExNzE4OCAxOTMuNTg1OTM4IDczMi4wNzgxMjUgMjMzLjk2MDkzOCA3MjEuOTU3MDMxIDI3Mi4zMjQyMTkgQyA3MTEuODM5ODQ0IDMxMC42OTUzMTIgNjc3LjE3MTg3NSAzMzcuNDQ5MjE5IDYzNy40ODQzNzUgMzM3LjUwNzgxMiBaIE0gNjM3LjQ4NDM3NSAzMzcuNTA3ODEyICIgc3R5bGU9IiBzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOnJnYigwJSwwJSwwJSk7ZmlsbC1vcGFjaXR5OjE7IiAvPgo8cGF0aCBkPSJNIDYyLjUgMjAwLjAxNTYyNSBMIDg3LjUgMjAwLjAxNTYyNSBMIDg3LjUgMjI1LjAxMTcxOSBMIDYyLjUgMjI1LjAxMTcxOSBaIE0gNjIuNSAyMDAuMDE1NjI1ICIgc3R5bGU9IiBzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOnJnYigwJSwwJSwwJSk7ZmlsbC1vcGFjaXR5OjE7IiAvPgo8cGF0aCBkPSJNIDYyLjUgMTUwLjAxNTYyNSBMIDg3LjUgMTUwLjAxNTYyNSBMIDg3LjUgMTc1LjAxNTYyNSBMIDYyLjUgMTc1LjAxNTYyNSBaIE0gNjIuNSAxNTAuMDE1NjI1ICIgc3R5bGU9IiBzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOnJnYigwJSwwJSwwJSk7ZmlsbC1vcGFjaXR5OjE7IiAvPgo8cGF0aCBkPSJNIDYyLjUgMTAwLjAxOTUzMSBMIDg3LjUgMTAwLjAxOTUzMSBMIDg3LjUgMTI1LjAxOTUzMSBMIDYyLjUgMTI1LjAxOTUzMSBaIE0gNjIuNSAxMDAuMDE5NTMxICIgc3R5bGU9IiBzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOnJnYigwJSwwJSwwJSk7ZmlsbC1vcGFjaXR5OjE7IiAvPgo8cGF0aCBkPSJNIDYyLjUgNTAuMDE5NTMxIEwgODcuNSA1MC4wMTk1MzEgTCA4Ny41IDc1LjAxOTUzMSBMIDYyLjUgNzUuMDE5NTMxIFogTSA2Mi41IDUwLjAxOTUzMSAiIHN0eWxlPSIgc3Ryb2tlOm5vbmU7ZmlsbC1ydWxlOm5vbnplcm87ZmlsbDpyZ2IoMCUsMCUsMCUpO2ZpbGwtb3BhY2l0eToxOyIgLz4KPHBhdGggZD0iTSAxMTIuNSA1MC4wMTk1MzEgTCAxMzcuNSA1MC4wMTk1MzEgTCAxMzcuNSA3NS4wMTk1MzEgTCAxMTIuNSA3NS4wMTk1MzEgWiBNIDExMi41IDUwLjAxOTUzMSAiIHN0eWxlPSIgc3Ryb2tlOm5vbmU7ZmlsbC1ydWxlOm5vbnplcm87ZmlsbDpyZ2IoMCUsMCUsMCUpO2ZpbGwtb3BhY2l0eToxOyIgLz4KPHBhdGggZD0iTSAxNjIuNSA1MC4wMTk1MzEgTCAxODcuNDk2MDk0IDUwLjAxOTUzMSBMIDE4Ny40OTYwOTQgNzUuMDE5NTMxIEwgMTYyLjUgNzUuMDE5NTMxIFogTSAxNjIuNSA1MC4wMTk1MzEgIiBzdHlsZT0iIHN0cm9rZTpub25lO2ZpbGwtcnVsZTpub256ZXJvO2ZpbGw6cmdiKDAlLDAlLDAlKTtmaWxsLW9wYWNpdHk6MTsiIC8+CjxwYXRoIGQ9Ik0gMjEyLjQ5NjA5NCA1MC4wMTk1MzEgTCAyMzcuNDk2MDk0IDUwLjAxOTUzMSBMIDIzNy40OTYwOTQgNzUuMDE5NTMxIEwgMjEyLjQ5NjA5NCA3NS4wMTk1MzEgWiBNIDIxMi40OTYwOTQgNTAuMDE5NTMxICIgc3R5bGU9IiBzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOnJnYigwJSwwJSwwJSk7ZmlsbC1vcGFjaXR5OjE7IiAvPgo8cGF0aCBkPSJNIDYzNy40ODQzNzUgMzg3LjUwNzgxMiBMIDY2Mi40ODQzNzUgMzg3LjUwNzgxMiBMIDY2Mi40ODQzNzUgNDEyLjUwNzgxMiBMIDYzNy40ODQzNzUgNDEyLjUwNzgxMiBaIE0gNjM3LjQ4NDM3NSAzODcuNTA3ODEyICIgc3R5bGU9IiBzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOnJnYigwJSwwJSwwJSk7ZmlsbC1vcGFjaXR5OjE7IiAvPgo8cGF0aCBkPSJNIDYzNy40ODQzNzUgNDM3LjUwNzgxMiBMIDY2Mi40ODQzNzUgNDM3LjUwNzgxMiBMIDY2Mi40ODQzNzUgNDYyLjUwNzgxMiBMIDYzNy40ODQzNzUgNDYyLjUwNzgxMiBaIE0gNjM3LjQ4NDM3NSA0MzcuNTA3ODEyICIgc3R5bGU9IiBzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOnJnYigwJSwwJSwwJSk7ZmlsbC1vcGFjaXR5OjE7IiAvPgo8cGF0aCBkPSJNIDYzNy40ODQzNzUgNDg3LjUwNzgxMiBMIDY2Mi40ODQzNzUgNDg3LjUwNzgxMiBMIDY2Mi40ODQzNzUgNTEyLjUwNzgxMiBMIDYzNy40ODQzNzUgNTEyLjUwNzgxMiBaIE0gNjM3LjQ4NDM3NSA0ODcuNTA3ODEyICIgc3R5bGU9IiBzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOnJnYigwJSwwJSwwJSk7ZmlsbC1vcGFjaXR5OjE7IiAvPgo8cGF0aCBkPSJNIDYzNy40ODQzNzUgNTM3LjUwNzgxMiBMIDY2Mi40ODQzNzUgNTM3LjUwNzgxMiBMIDY2Mi40ODQzNzUgNTYyLjUwMzkwNiBMIDYzNy40ODQzNzUgNTYyLjUwMzkwNiBaIE0gNjM3LjQ4NDM3NSA1MzcuNTA3ODEyICIgc3R5bGU9IiBzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOnJnYigwJSwwJSwwJSk7ZmlsbC1vcGFjaXR5OjE7IiAvPgo8cGF0aCBkPSJNIDU4Ny40ODQzNzUgNTM3LjUwNzgxMiBMIDYxMi40ODQzNzUgNTM3LjUwNzgxMiBMIDYxMi40ODQzNzUgNTYyLjUwMzkwNiBMIDU4Ny40ODQzNzUgNTYyLjUwMzkwNiBaIE0gNTg3LjQ4NDM3NSA1MzcuNTA3ODEyICIgc3R5bGU9IiBzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOnJnYigwJSwwJSwwJSk7ZmlsbC1vcGFjaXR5OjE7IiAvPgo8cGF0aCBkPSJNIDUzNy40ODgyODEgNTM3LjUwNzgxMiBMIDU2Mi40ODgyODEgNTM3LjUwNzgxMiBMIDU2Mi40ODgyODEgNTYyLjUwMzkwNiBMIDUzNy40ODgyODEgNTYyLjUwMzkwNiBaIE0gNTM3LjQ4ODI4MSA1MzcuNTA3ODEyICIgc3R5bGU9IiBzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOnJnYigwJSwwJSwwJSk7ZmlsbC1vcGFjaXR5OjE7IiAvPgo8L2c+Cjwvc3ZnPg==',
            },
            {
                value:
                    'incomingHttpRequest',
                label:
                    'Incoming HTTP Request',
                icon:'data:image/svg+xml;base64,PHN2ZyBpZD0iSWNvbnMiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgNzQgNzQiIHdpZHRoPSI1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0ibTMgMjAuMDFhMSAxIDAgMCAxIC0xLTF2LTIuOTdhMSAxIDAgMCAxIDIgMHYyLjk3YTEgMSAwIDAgMSAtMSAxeiIvPjxwYXRoIGQ9Im02NyA1NmgtNjBhNS4wMDYgNS4wMDYgMCAwIDEgLTUtNXYtMTUuMDhhMSAxIDAgMCAxIDIgMHYxNS4wOGEzIDMgMCAwIDAgMyAzaDYwYTMgMyAwIDAgMCAzLTN2LTQzLjk5YTMgMyAwIDAgMCAtMy0zaC02MGEzIDMgMCAwIDAgLTMgM3YyLjAzYTEgMSAwIDAgMSAtMiAwdi0yLjAzYTUuMDA2IDUuMDA2IDAgMCAxIDUtNWg2MGE1LjAwNiA1LjAwNiAwIDAgMSA1IDV2NDMuOTlhNS4wMDYgNS4wMDYgMCAwIDEgLTUgNXoiLz48cGF0aCBkPSJtMyAyOS45MmExIDEgMCAwIDEgLTEtMXYtMi45MWExIDEgMCAwIDEgMiAwdjIuOTFhMSAxIDAgMCAxIC0xIDF6Ii8+PHBhdGggZD0ibTcxIDQ1LjAxOGgtNjhhMSAxIDAgMCAxIDAtMmg2OGExIDEgMCAwIDEgMCAyeiIvPjxwYXRoIGQ9Im0xNC4yNSA1MC4yNThoLTIuNjI1YTEgMSAwIDAgMSAwLTJoMi42MjVhMSAxIDAgMCAxIDAgMnoiLz48cGF0aCBkPSJtNDguNDE3IDYzLjkxMWgtMjIuODM0YTEgMSAwIDAgMSAtMS0xdi03LjkxMWExIDEgMCAwIDEgMS0xaDIyLjgzNGExIDEgMCAwIDEgMSAxdjcuOTExYTEgMSAwIDAgMSAtMSAxem0tMjEuODM0LTJoMjAuODM0di01LjkxMWgtMjAuODM0eiIvPjxwYXRoIGQ9Im01My41NjIgNzIuMDA4aC0zMy4xMjRhMSAxIDAgMCAxIC0xLTF2LTMuOWE1LjIgNS4yIDAgMCAxIDUuMTkzLTUuMTk0aDI0LjczOGE1LjIgNS4yIDAgMCAxIDUuMTkzIDUuMTk0djMuOWExIDEgMCAwIDEgLTEgMXptLTMyLjEyNC0yaDMxLjEyNHYtMi45YTMuMiAzLjIgMCAwIDAgLTMuMTkzLTMuMTk0aC0yNC43MzhhMy4yIDMuMiAwIDAgMCAtMy4xOTMgMy4xOTR6Ii8+PHBhdGggZD0ibTExLjkyNCAxOC40MjZoMS4yNjN2NC4zMzFoLjAyOGEyLjM0MiAyLjM0MiAwIDAgMSAuOS0uODg5IDIuNiAyLjYgMCAwIDEgMS4yOTEtLjM1OGMuOTMyIDAgMi40MjQuNTczIDIuNDI0IDIuOTY5djQuMTNoLTEuMjU4di0zLjk4N2MwLTEuMTE5LS40MTYtMi4wNjUtMS42MDctMi4wNjVhMS44MTEgMS44MTEgMCAwIDAgLTEuNjkyIDEuMjYyIDEuNTIgMS41MiAwIDAgMCAtLjA4Ni42djQuMTg4aC0xLjI2M3oiLz48cGF0aCBkPSJtMTcuODM0IDI4LjczNGgtMS4yNjNhLjEyNS4xMjUgMCAwIDEgLS4xMjUtLjEyNXYtMy45ODdjMC0uODg1LS4yNTctMS45NC0xLjQ4MS0xLjk0YTEuNjgzIDEuNjgzIDAgMCAwIC0xLjU3NCAxLjE3NiAxLjQ0IDEuNDQgMCAwIDAgLS4wNzkuNTYzdjQuMTg4YS4xMjUuMTI1IDAgMCAxIC0uMTI1LjEyNWgtMS4yNjNhLjEyNS4xMjUgMCAwIDEgLS4xMjUtLjEyNXYtMTAuMTgzYS4xMjUuMTI1IDAgMCAxIC4xMjUtLjEyNWgxLjI2M2EuMTI1LjEyNSAwIDAgMSAuMTI1LjEyNXYzLjk2NGEyLjUyNiAyLjUyNiAwIDAgMSAuNzQ2LS42MzEgMi43MjUgMi43MjUgMCAwIDEgMS4zNTItLjM3NGMxLjE3NiAwIDIuNTQ5LjgxIDIuNTQ5IDMuMDk0djQuMTNhLjEyNS4xMjUgMCAwIDEgLS4xMjUuMTI1em0tMS4xMzgtLjI1aDEuMDEzdi00LjAwNWMwLTIuNzA3LTEuOTE1LTIuODQ0LTIuMy0yLjg0NGEyLjQ3IDIuNDcgMCAwIDAgLTEuMjI5LjM0MiAyLjIzNSAyLjIzNSAwIDAgMCAtLjg1Ny44NDFjLS4wNTUuMS0uMjYyLjA1My0uMjYyLS4wNjF2LTQuMjA2aC0xLjAxMnY5LjkzM2gxLjAxM3YtNC4wNjNhMS42MzMgMS42MzMgMCAwIDEgLjEtLjY1IDEuOTIzIDEuOTIzIDAgMCAxIDEuODA4LTEuMzM5YzEuMTE3IDAgMS43MzEuNzc3IDEuNzMxIDIuMTl6Ii8+PHBhdGggZD0ibTIyLjM1MiAxOS42NzR2MS45OTNoMS44MDh2Ljk2MWgtMS44MDh2My43NDRjMCAuODYuMjQ0IDEuMzQ4Ljk0NyAxLjM0OGEyLjgxNSAyLjgxNSAwIDAgMCAuNzMyLS4wODZsLjA1Ny45NDdhMy4xIDMuMSAwIDAgMSAtMS4xMTkuMTcyIDEuNzUxIDEuNzUxIDAgMCAxIC0xLjM2My0uNTMxIDIuNTc1IDIuNTc1IDAgMCAxIC0uNDg3LTEuODA3di0zLjc4N2gtMS4wNzZ2LS45NjFoMS4wNzZ2LTEuNjY3eiIvPjxwYXRoIGQ9Im0yMi45NjkgMjguODc4YTEuODY3IDEuODY3IDAgMCAxIC0xLjQ1Ny0uNTczIDIuNjU2IDIuNjU2IDAgMCAxIC0uNTE4LTEuODl2LTMuNjYyaC0uOTUxYS4xMjUuMTI1IDAgMCAxIC0uMTI1LS4xMjV2LS45NjFhLjEyNi4xMjYgMCAwIDEgLjEyNS0uMTI1aC45NTF2LTEuNTQyYS4xMjUuMTI1IDAgMCAxIC4wOTItLjEyMWwxLjIzNC0uMzI5YS4xMi4xMiAwIDAgMSAuMTA5LjAyMi4xMjYuMTI2IDAgMCAxIC4wNDkuMXYxLjg2OGgxLjY4MmEuMTI2LjEyNiAwIDAgMSAuMTI1LjEyNXYuOTYxYS4xMjUuMTI1IDAgMCAxIC0uMTI1LjEyNWgtMS42ODJ2My42MTljMCAuODU3LjI0NSAxLjIyMy44MjEgMS4yMjNhMi43NTQgMi43NTQgMCAwIDAgLjctLjA4MS4xMjYuMTI2IDAgMCAxIC4xMDUuMDE5LjEyOC4xMjggMCAwIDEgLjA1Mi4wOTRsLjA1Ny45NDdhLjEyNi4xMjYgMCAwIDEgLS4wNzguMTIzIDMuMjQ5IDMuMjQ5IDAgMCAxIC0xLjE2Ni4xODN6bS0yLjgtNi4zNzVoLjk1MWEuMTI1LjEyNSAwIDAgMSAuMTI1LjEyNXYzLjc4N2EyLjQzOCAyLjQzOCAwIDAgMCAuNDUyIDEuNzIxIDEuNjMgMS42MyAwIDAgMCAxLjI3My40OTIgMy4yNDYgMy4yNDYgMCAwIDAgLjk4OS0uMTMybC0uMDQzLS43MDdhMy4xODggMy4xODggMCAwIDEgLS42MTYuMDU2Yy0uOTYgMC0xLjA3MS0uODQxLTEuMDcxLTEuNDczdi0zLjc0NGEuMTI1LjEyNSAwIDAgMSAuMTI1LS4xMjVoMS42ODJ2LS43MTFoLTEuNjgzYS4xMjUuMTI1IDAgMCAxIC0uMTI1LS4xMjV2LTEuODMxbC0uOTg0LjI2M3YxLjU2OGEuMTI1LjEyNSAwIDAgMSAtLjEyNS4xMjVoLS45NTF6Ii8+PHBhdGggZD0ibTI4LjEgMTkuNjc0djEuOTkzaDEuODF2Ljk2MWgtMS44MXYzLjc0NGMwIC44Ni4yNDQgMS4zNDguOTQ3IDEuMzQ4YTIuODA2IDIuODA2IDAgMCAwIC43MzEtLjA4NmwuMDU4Ljk0N2EzLjEwOCAzLjEwOCAwIDAgMSAtMS4xMTkuMTcyIDEuNzUxIDEuNzUxIDAgMCAxIC0xLjM2My0uNTMxIDIuNTcgMi41NyAwIDAgMSAtLjQ4OC0xLjgwN3YtMy43ODdoLTEuMDczdi0uOTYxaDEuMDc2di0xLjY2N3oiLz48cGF0aCBkPSJtMjguNzIgMjguODc4YTEuODY0IDEuODY0IDAgMCAxIC0xLjQ1Ny0uNTczIDIuNjUxIDIuNjUxIDAgMCAxIC0uNTE5LTEuODl2LTMuNjYyaC0uOTUxYS4xMjYuMTI2IDAgMCAxIC0uMTI1LS4xMjV2LS45NjFhLjEyNi4xMjYgMCAwIDEgLjEyNS0uMTI1aC45NTF2LTEuNTQyYS4xMjUuMTI1IDAgMCAxIC4wOTMtLjEyMWwxLjIzNC0uMzI5YS4xMTguMTE4IDAgMCAxIC4xMDguMDIyLjEyMy4xMjMgMCAwIDEgLjA0OS4xdjEuODY4aDEuNjgzYS4xMjYuMTI2IDAgMCAxIC4xMjUuMTI1di45NjFhLjEyNi4xMjYgMCAwIDEgLS4xMjUuMTI1aC0xLjY4M3YzLjYxOWMwIC44NTcuMjQ2IDEuMjIzLjgyMiAxLjIyM2EyLjcyMiAyLjcyMiAwIDAgMCAuNy0uMDgxLjEyNS4xMjUgMCAwIDEgLjE1OC4xMTJsLjA1Ny45NDdhLjEyNS4xMjUgMCAwIDEgLS4wNzcuMTI0IDMuMjQ1IDMuMjQ1IDAgMCAxIC0xLjE2OC4xODN6bS0yLjgtNi4zNzVoLjk1MWEuMTI1LjEyNSAwIDAgMSAuMTI1LjEyNXYzLjc4N2EyLjQzOCAyLjQzOCAwIDAgMCAuNDUzIDEuNzIxIDEuNjI3IDEuNjI3IDAgMCAwIDEuMjczLjQ5MiAzLjIzOSAzLjIzOSAwIDAgMCAuOTg4LS4xMzJsLS4wNDMtLjcwNmEzLjI4IDMuMjggMCAwIDEgLS42MTUuMDU1Yy0uOTYxIDAtMS4wNzItLjg0MS0xLjA3Mi0xLjQ3M3YtMy43NDRhLjEyNS4xMjUgMCAwIDEgLjEyLS4xMjhoMS42ODN2LS43MTFoLTEuNjgzYS4xMjUuMTI1IDAgMCAxIC0uMTI1LS4xMjV2LTEuODI4bC0uOTg0LjI2M3YxLjU2OGEuMTI1LjEyNSAwIDAgMSAtLjEyNS4xMjVoLS45NTF6Ii8+PHBhdGggZD0ibTMyLjMzMiAyMy45MzRjMC0uODktLjAyOC0xLjYwNy0uMDU3LTIuMjY3aDEuMTMzbC4wNTggMS4xOWguMDI4YTIuNzI5IDIuNzI5IDAgMCAxIDIuNDY3LTEuMzQ3YzEuNjc4IDAgMi45NDEgMS40MTkgMi45NDEgMy41MjggMCAyLjUtMS41MjEgMy43MjktMy4xNTYgMy43MjlhMi40MzUgMi40MzUgMCAwIDEgLTIuMTM3LTEuMDloLS4wMjl2My43NzJoLTEuMjQ4em0xLjI0OCAxLjg1YTIuODE2IDIuODE2IDAgMCAwIC4wNTguNTE2IDEuOTQ2IDEuOTQ2IDAgMCAwIDEuODkzIDEuNDc3YzEuMzM0IDAgMi4xMDgtMS4wODkgMi4xMDgtMi42ODIgMC0xLjM5MS0uNzMxLTIuNTgyLTIuMDY1LTIuNTgyYTIuMDE0IDIuMDE0IDAgMCAwIC0xLjkwOCAxLjU2NCAyLjA4NiAyLjA4NiAwIDAgMCAtLjA4Ni41MTZ6Ii8+PHBhdGggZD0ibTMzLjU4MSAzMS41NzRoLTEuMjQ4YS4xMjUuMTI1IDAgMCAxIC0uMTI1LS4xMjV2LTcuNTE1YzAtLjg2Mi0uMDI3LTEuNTYxLS4wNTgtMi4yNjFhLjEyOS4xMjkgMCAwIDEgLjAzNS0uMDkyLjEyNi4xMjYgMCAwIDEgLjA5LS4wMzloMS4xMzNhLjEyNS4xMjUgMCAwIDEgLjEyNS4xMmwuMDQyLjg1NmEyLjg2MyAyLjg2MyAwIDAgMSAyLjM4Ni0xLjEzM2MxLjc3NiAwIDMuMDY2IDEuNTM2IDMuMDY2IDMuNjUzIDAgMi42NjItMS42NDggMy44NTQtMy4yODEgMy44NTRhMi42NCAyLjY0IDAgMCAxIC0yLjA0LS44Njh2My40MjVhLjEyNi4xMjYgMCAwIDEgLS4xMjUuMTI1em0tMS4xMjMtLjI1aDF2LTMuNjQ3YS4xMjUuMTI1IDAgMCAxIC4xMjUtLjEyNS4xOC4xOCAwIDAgMSAuMTM1LjA2IDIuMzEgMi4zMSAwIDAgMCAyLjAzIDEuMDNjMS41MDkgMCAzLjAzMS0xLjExNCAzLjAzMS0zLjYgMC0yLTEuMTU4LTMuNC0yLjgxNi0zLjRhMi41OTQgMi41OTQgMCAwIDAgLTIuMzYzIDEuMjhjLS4wNTkuMS0uMjU2LjA1Mi0uMjYxLS4wNTlsLS4wNTItMS4wNzFoLS44ODNjLjAyOC42Ni4wNTIgMS4zMjkuMDUyIDIuMTQyem0zLjA3My0zLjQyNGEyLjA2NSAyLjA2NSAwIDAgMSAtMi4wMTQtMS41NyAyLjk1MiAyLjk1MiAwIDAgMSAtLjA2MS0uNTQ4di0xLjE4OWEyLjE4OSAyLjE4OSAwIDAgMSAuMDg5LS41NDkgMi4xNCAyLjE0IDAgMCAxIDIuMDI5LTEuNjU1YzEuMjkgMCAyLjE5MSAxLjExMiAyLjE5MSAyLjcwNiAwIDEuNzA1LS44NzcgMi44MDUtMi4yMzQgMi44MDV6bS4wNDMtNS4yNjNhMS44OSAxLjg5IDAgMCAwIC0xLjc4NyAxLjQ2OSAxLjk4MyAxLjk4MyAwIDAgMCAtLjA4MS40ODV2MS4xOTFhMi42ODMgMi42ODMgMCAwIDAgLjA1NS40OTMgMS44MTYgMS44MTYgMCAwIDAgMS43NyAxLjM3NWMxLjIyMyAwIDEuOTg0LS45OCAxLjk4NC0yLjU1NyAwLTEuMjItLjYtMi40NTQtMS45NDEtMi40NTR6Ii8+PHBhdGggZD0ibTQxLjMyNiAyNy4zMThhMy4zMDggMy4zMDggMCAwIDAgMS42NjUuNWMuOTE4IDAgMS4zNDctLjQ1OSAxLjM0Ny0xLjAzMyAwLS42LS4zNTgtLjkzMy0xLjI5LTEuMjc3LTEuMjQ4LS40NDQtMS44MzYtMS4xMzMtMS44MzYtMS45NjVhMi4xNDEgMi4xNDEgMCAwIDEgMi4zOTUtMi4wMzYgMy40NyAzLjQ3IDAgMCAxIDEuNzA3LjQyOWwtLjMxNC45MjFhMi43MDggMi43MDggMCAwIDAgLTEuNDE5LS40Yy0uNzQ3IDAtMS4xNjIuNDMxLTEuMTYyLjk0NyAwIC41NzMuNDE1LjgzMSAxLjMxOSAxLjE3NiAxLjIwNS40NTkgMS44MjIgMS4wNjIgMS44MjIgMi4wOTQgMCAxLjIxOS0uOTQ3IDIuMDgtMi42IDIuMDhhMy45NyAzLjk3IDAgMCAxIC0xLjk1LS40NzN6Ii8+PHBhdGggZD0ibTQyLjk2MSAyOC44NzhhNC4xMDUgNC4xMDUgMCAwIDEgLTIuMDE0LS40OS4xMjUuMTI1IDAgMCAxIC0uMDU1LS4xNDdsLjMxNi0uOTYyYS4xMjQuMTI0IDAgMCAxIC4xODctLjA2NSAzLjE3NSAzLjE3NSAwIDAgMCAxLjYuNDgxYy43NjUgMCAxLjIyMi0uMzM5IDEuMjIyLS45MDcgMC0uNTMzLS4zLS44MjYtMS4yMDktMS4xNi0xLjU4NC0uNTY0LTEuOTE3LTEuNDQ0LTEuOTE3LTIuMDgyYTIuMjU4IDIuMjU4IDAgMCAxIDIuNTItMi4xNjEgMy42MiAzLjYyIDAgMCAxIDEuNzcxLjQ0Ny4xMjUuMTI1IDAgMCAxIC4wNTUuMTQ4bC0uMzE2LjkxOGEuMTI1LjEyNSAwIDAgMSAtLjA3Ny4wNzcuMTIyLjEyMiAwIDAgMSAtLjEwOC0uMDEyIDIuNTU2IDIuNTU2IDAgMCAwIC0xLjM1My0uMzgyYy0uNjIxIDAtMS4wMzcuMzMtMS4wMzcuODIyIDAgLjQ1NS4yNzcuNjkzIDEuMjM5IDEuMDU5IDEuMzE1LjUgMS45IDEuMTgzIDEuOSAyLjIxMS0uMDAyIDEuMzM5LTEuMDcxIDIuMjA1LTIuNzI0IDIuMjA1em0tMS44LS42NTdhMy45MjUgMy45MjUgMCAwIDAgMS44LjQwN2MxLjUyNSAwIDIuNDcyLS43NDkgMi40NzItMS45NTUgMC0uOTIxLS41MjEtMS41MTItMS43NDEtMS45NzctLjk0OS0uMzYyLTEuNC0uNjQ4LTEuNC0xLjI5M2ExLjE0MiAxLjE0MiAwIDAgMSAxLjI4Ny0xLjA3MiAyLjgzMSAyLjgzMSAwIDAgMSAxLjM1MS4zNDFsLjIzMi0uNjcyYTMuNDE4IDMuNDE4IDAgMCAwIC0xLjU1NS0uMzYzIDIuMDIxIDIuMDIxIDAgMCAwIC0yLjI3IDEuOTExYzAgLjguNjA2IDEuNDM5IDEuNzUzIDEuODQ3Ljg0OC4zMTQgMS4zNzMuNjU2IDEuMzczIDEuMzk1IDAgLjU2LS4zODYgMS4xNTctMS40NzIgMS4xNTdhMy40OCAzLjQ4IDAgMCAxIC0xLjU5NS0uNDM4eiIvPjxwYXRoIGQ9Im00OC45MjMgMjIuODE1YS44NTUuODU1IDAgMSAxIDEuNzA3IDAgLjg1NC44NTQgMCAxIDEgLTEuNzA3IDB6bTAgNS4wNjNhLjg1NS44NTUgMCAxIDEgMS43MDcgMCAuODU0Ljg1NCAwIDEgMSAtMS43MDcgMHoiLz48cGF0aCBkPSJtNDkuNzY5IDI4Ljg5MmEuOTYuOTYgMCAwIDEgLS45NzEtMS4wMTQuOTguOTggMCAxIDEgMS45NTcgMCAuOTU4Ljk1OCAwIDAgMSAtLjk4NiAxLjAxNHptLjAxNS0xLjc5MmEuNzcyLjc3MiAwIDAgMCAtLjAxNSAxLjU0Mi43MS43MSAwIDAgMCAuNzM2LS43NjQuNzE4LjcxOCAwIDAgMCAtLjcyMS0uNzc4em0tLjAxNS0zLjI3MWEuOTYxLjk2MSAwIDAgMSAtLjk3MS0xLjAxNC45NzUuOTc1IDAgMCAxIC45ODYtMS4wMjkgMS4wMjIgMS4wMjIgMCAwIDEgLS4wMTUgMi4wNDN6bS4wMTUtMS43OTNhLjc3My43NzMgMCAwIDAgLS4wMTUgMS41NDMuNzEuNzEgMCAwIDAgLjczNi0uNzY0LjcxOS43MTkgMCAwIDAgLS43MjEtLjc3OXoiLz48cGF0aCBkPSJtNTYuOTY4IDI5LjE4MyA0LTEwLjRoMS4xMDZsLTQuMDE3IDEwLjR6Ii8+PHBhdGggZD0ibTU4LjA1OSAyOS4zMDhoLTEuMDkxYS4xMjQuMTI0IDAgMCAxIC0uMS0uMDU0LjEyMy4xMjMgMCAwIDEgLS4wMTQtLjExNmw0LTEwLjRhLjEyNi4xMjYgMCAwIDEgLjExNy0uMDhoMS4xMDZhLjEyOC4xMjggMCAwIDEgLjEuMDU0LjEyNi4xMjYgMCAwIDEgLjAxMy4xMTZsLTQuMDE2IDEwLjRhLjEyNi4xMjYgMCAwIDEgLS4xMTUuMDh6bS0uOTA5LS4yNWguODIzbDMuOTIxLTEwLjE0OWgtLjgzOHoiLz48cGF0aCBkPSJtNTMuMTc1IDI5LjE4MyA0LTEwLjRoMS4xMDZsLTQuMDE3IDEwLjR6Ii8+PHBhdGggZD0ibTU0LjI2NyAyOS4zMDhoLTEuMDkyYS4xMjQuMTI0IDAgMCAxIC0uMTE2LS4xN2w0LTEwLjRhLjEyNC4xMjQgMCAwIDEgLjExNi0uMDhoMS4xMDZhLjEyOC4xMjggMCAwIDEgLjEuMDU0LjEyNi4xMjYgMCAwIDEgLjAxMy4xMTZsLTQuMDE2IDEwLjRhLjEyNS4xMjUgMCAwIDEgLS4xMTEuMDh6bS0uOTEtLjI1aC44MjRsMy45MTktMTAuMTQ5aC0uODM4eiIvPjwvc3ZnPg==',
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
                                                                        <div className={`bs-Fieldset-fields Flex-justifyContent--center monitor-type-item Box-background--white`}
                                                                        style={{
                                                                            flex: 1,
                                                                            padding: 0,   
                                                                            flexDirection:'row',
                                                                            cursor: 'pointer',
                                                                            border:'1px solid rgba(0,0,0,0.2)',
                                                                            textAlign:'center',                                                              
                                                                        }}> 
                                                                        <div
                                                                            className="radioButtonClass"
                                                                            style={{ height: '100%', display: 'flex',
                                                                            justifyContent: 'center',
                                                                            color: '#4c4c4c', }}
                                                                        >
                                                                            <Field
                                                                                required={true}
                                                                                component="input"
                                                                                type="radio"
                                                                                id="type"
                                                                                name={`type_${this.props.index}`}
                                                                                className="Margin-left--4 Margin-top--4"
                                                                                validate={
                                                                                    ValidateField.select
                                                                                }
                                                                                disabled={
                                                                                    requesting
                                                                                }                                                                                              
                                                                                // id={id}
                                                                                //value={value}
                                                                            />
                                                                        </div>                                                                          
                                                                            <span
                                                                            style={{
                                                                                display:'flex',
                                                                                flexDirection:'column',
                                                                                alignItems:'center',
                                                                            }}
                                                                            >
                                                                                <img src={el.icon}
                                                                            style={{
                                                                                width:'70%',
                                                                                height:'100%',                                                                              
                                                                            }}/>
                                                                            <span>
                                                                                {el.label}
                                                                            </span>
                                                                            </span>                                                                            
                                                                        </div>
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
