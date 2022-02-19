import React, { Component, createRef } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { isEqual } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import {
    reduxForm,
    Field,
    formValueSelector,
    change,
    isValid,
    FieldArray,
} from 'redux-form';
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
    uploadConfigurationFile,
    logConfigFile,
    setConfigInputKey,
    resetConfigFile,
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
import { PricingPlan as PlanListing } from '../../config';
import Tooltip from '../basic/Tooltip';
import PricingPlan from '../basic/PricingPlan';
import { history } from '../../store';
import { fetchCommunicationSlas } from '../../actions/incidentCommunicationSla';
import { fetchMonitorSlas } from '../../actions/monitorSla';
import { UploadFile } from '../basic/UploadFile';
import CRITERIA_TYPES from '../../constants/CRITERIA_TYPES';
import ScheduleInput from '../schedule/ScheduleInput';
const selector = formValueSelector('NewMonitor');
const dJSON = require('dirty-json');
import { fetchAutomatedScript } from '../../actions/automatedScript';

const defaultScript =
    '// modules available - request, puppeteer, axios (We can add more later).' +
    ' e.g - const request = require("request")\n\n' +
    '// To inspect your script or add comments, use console.log\n\n' +
    'async function (done) {\n' +
    '   // write any javascript here \n' +
    '   done();\n' +
    '}\n';

class NewMonitor extends Component {
    constructor(props) {
        super(props);
        this.state = {
            advance: false,
            script:
                props.editMonitorProp &&
                props.editMonitorProp.data &&
                props.editMonitorProp.data.script,

            showAllMonitors: false,
            type: props.edit ? props.editMonitorProp.type : props.type,
            httpRequestLink: `${API_URL}/incomingHttpRequest/${uuidv4()}`,
            mode: props.edit ? props.editMonitorProp.mode : props.mode,
            authentication: props.edit
                ? props.editMonitorProp.authentication
                : props.authentication,
            criteria:
                (props.currentMonitorCriteria &&
                    props.currentMonitorCriteria.filter(cr => {
                        if (
                            props.type === 'kubernetes' &&
                            cr.type === 'degraded' &&
                            !props.edit
                        ) {
                            return false;
                        }
                        return true;
                    })) ||
                [],
            tabValidity: {
                up: true,
                degraded: true,
                down: true,
            },
            processingMonitor: false,
        };

        this.tabIndexRef = createRef();
    }

    componentDidMount() {
        const { editMonitorProp } = this.props;
        const userId = User.getUserId();
        const projectMember = this.props.currentProject.users.find(
            user => user.userId === userId
        );
        const link =
            editMonitorProp && editMonitorProp.data
                ? editMonitorProp.data.link
                : `${API_URL}/incomingHttpRequest/${uuidv4()}`;
        //load call schedules/duties
        if (projectMember) {
            this.props.fetchMonitorSlas(this.props.currentProject._id);
            this.props.fetchCommunicationSlas(this.props.currentProject._id);
            this.props.fetchSchedules(this.props.currentProject._id);
            this.props.fetchAutomatedScript(
                this.props.currentProject._id,
                0,
                10
            );
        }
        this.props.fetchMonitorCriteria();
        this.props.setFileInputKey(new Date());
        this.props.setConfigInputKey(new Date());
        this.setHttpRequestLink(link);
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Enter':
                // prevent form submission while using ace editor
                if (e.target.name === `script_editor_${this.props.index}`) {
                    return true;
                }
                if (document.getElementById('addMonitorButton'))
                    return document.getElementById('addMonitorButton').click();
                else return false;
            default:
                return false;
        }
    };

    componentDidUpdate(prevProps) {
        const { monitor, editMonitorProp } = this.props;
        const link =
            editMonitorProp && editMonitorProp.data
                ? editMonitorProp.data.link
                : `${API_URL}/incomingHttpRequest/${uuidv4()}`;
        if (
            monitor.newMonitor.error ===
            "You can't add any more monitors. Please upgrade plan."
        ) {
            this.props.showUpgradeForm();
        }
        if (
            prevProps.editMonitorProp &&
            prevProps.editMonitorProp.data &&
            editMonitorProp &&
            editMonitorProp.data &&
            prevProps.editMonitorProp.data.link !== editMonitorProp.data.link
        ) {
            this.setHttpRequestLink(link);
        }

        if (!this.props.edit) {
            // setup criteria for up, down, and degraded events
            // update automatically when monitor type is changed

            const areCriterionInitialValuesEqual = isEqual(
                prevProps.initialValues,
                this.props.initialValues
            );

            if (!areCriterionInitialValuesEqual) {
                const criteria = [];

                // add a default criterion as a down criterion
                const defaultDownCriterion = {
                    type: CRITERIA_TYPES.DOWN.type,
                    id: uuidv4(),
                    default: true,
                    name: CRITERIA_TYPES.DOWN.name,
                };
                this.addCriterionFieldsToReduxForm(defaultDownCriterion);
                criteria.push(defaultDownCriterion);

                [CRITERIA_TYPES.UP, CRITERIA_TYPES.DEGRADED].forEach(
                    criterion => {
                        if (
                            this.props.type === 'kubernetes' &&
                            criterion.type === 'degraded'
                        ) {
                            // do nothing
                        } else {
                            const id = uuidv4();

                            const newCriterion = {
                                id,
                                type: criterion.type,
                                name:
                                    CRITERIA_TYPES[criterion.type.toUpperCase()]
                                        .name,
                            };
                            criteria.push(newCriterion);

                            this.addCriterionFieldsToReduxForm(newCriterion);
                        }
                    }
                );

                // eslint-disable-next-line react/no-did-update-set-state
                this.setState({ ...this.state, criteria });
            }
        }
    }

    setHttpRequestLink = httpRequestLink => this.setState({ httpRequestLink });

    /**
     * adds all necessary criterion fields to redux form
     *
     * @param { {id : string, type: string}} criterion criterion to add fields for
     * @memberof NewMonitor
     */
    addCriterionFieldsToReduxForm(criterion) {
        if (!criterion.id || !criterion.type) {
            return;
        }

        const { change } = this.props;

        /** @type {{bodyField:Object[] | undefined, createAlert:boolean, autoAcknowledge: boolean, autoResolve:boolean}} */
        const criterionFieldName = `${criterion.type}_${criterion.id}`;
        // add filter criteria if the criterion is not default

        const criterionValues = this.getCriterionInitialValue(criterion.type);
        change(criterionFieldName, criterionValues.bodyField);

        change(`name_${criterionFieldName}`, criterion.name);
        change(
            `createAlert_${criterionFieldName}`,
            criterionValues.createAlert
        );
        change(
            `autoAcknowledge_${criterionFieldName}`,
            criterionValues.autoAcknowledge
        );
        change(
            `autoResolve_${criterionFieldName}`,
            criterionValues.autoResolve
        );
    }

    /**
     * gets a criterion's initial value depending on its type
     *
     * @param {string} criterionType type of criterion, up, down or degraded
     * @returns {{bodyField: object, createAlert: boolean, autoAcknowledge: boolean, autoResolve: boolean} | {}} initial values for a criterion
     * @memberof NewMonitor
     */
    getCriterionInitialValue(criterionType) {
        let { initialValues } = this.props;
        const { edit, monitor, editMonitorProp } = this.props;

        if (edit) {
            initialValues = monitor.monitorCriteria
                ? monitor.monitorCriteria.criteria[editMonitorProp.type]
                : {};
        }

        try {
            const initialCriterionValue = {};

            switch (criterionType) {
                case CRITERIA_TYPES.UP.type:
                    initialCriterionValue.bodyField = initialValues.up_1000;
                    initialCriterionValue.createAlert =
                        initialValues.up_1000_createAlert;
                    initialCriterionValue.autoAcknowledge =
                        initialValues.up_1000_autoAcknowledge;
                    initialCriterionValue.autoResolve =
                        initialValues.up_1000_autoResolve;
                    break;
                case CRITERIA_TYPES.DOWN.type:
                    initialCriterionValue.bodyField = initialValues.down_1000;
                    initialCriterionValue.createAlert =
                        initialValues.down_1000_createAlert;
                    initialCriterionValue.autoAcknowledge =
                        initialValues.down_1000_autoAcknowledge;
                    initialCriterionValue.autoResolve =
                        initialValues.down_1000_autoResolve;
                    break;

                case CRITERIA_TYPES.DEGRADED.type:
                    initialCriterionValue.bodyField =
                        initialValues.degraded_1000;
                    initialCriterionValue.createAlert =
                        initialValues.degraded_1000_createAlert;
                    initialCriterionValue.autoAcknowledge =
                        initialValues.degraded_1000_autoAcknowledge;
                    initialCriterionValue.autoResolve =
                        initialValues.degraded_1000_autoResolve;
                    break;
                default:
                    initialCriterionValue.bodyField = initialValues.up_1000;
                    initialCriterionValue.createAlert =
                        initialValues.up_1000_createAlert;
                    initialCriterionValue.autoAcknowledge =
                        initialValues.up_1000_autoAcknowledge;
                    initialCriterionValue.autoResolve =
                        initialValues.up_1000_autoResolve;
                    break;
            }
            return initialCriterionValue;
        } catch (error) {
            return {};
        }
    }

    /**
     * removes a criterion
     *
     * @param {*} id id of the criterion to remove
     * @memberof NewMonitor
     */
    removeCriterion(id) {
        const indexOfTargetCriterion = this.state.criteria.findIndex(
            criterion => criterion.id === id
        );
        if (indexOfTargetCriterion !== -1) {
            const newCriteria = [
                ...this.state.criteria.slice(0, indexOfTargetCriterion),
                ...this.state.criteria.slice(
                    indexOfTargetCriterion + 1,
                    this.state.criteria.length
                ),
            ];
            this.setState({ ...this.state, criteria: newCriteria });
        }
    }

    /**
     *
     * @param {criterion} criterion
     * @returns {string} name computed name
     */
    getDefaultCriterionName(criterion) {
        const criteriaWithSameType = this.state.criteria.reduce(
            (acc, criterionItem) => {
                return (
                    acc +
                    (criterion.id !== criterionItem.id &&
                    criterion.type === criterionItem.type
                        ? 1
                        : 0)
                );
            },
            0
        );
        const defaultCriterionName =
            CRITERIA_TYPES[criterion.type.toUpperCase()].name;
        const name =
            criteriaWithSameType === 0
                ? defaultCriterionName
                : `${defaultCriterionName} ${criteriaWithSameType + 1}`;
        return name;
    }

    /**
     *
     * adds a criteria to the state
     * @param {{ type:string, id:string}} [criterion={}] data of the new criteria
     * @memberof NewMonitor
     */
    addCriterion(criterion = {}) {
        if (!criterion.id || !criterion.type) {
            return;
        }

        const newCriterion = {
            ...criterion,
            name: this.getDefaultCriterionName(criterion),
        };

        this.addCriterionFieldsToReduxForm(newCriterion);

        this.setState({
            ...this.state,
            criteria: [...this.state.criteria, newCriterion],
        });
    }

    submitForm = values => {
        const thisObj = this;
        const postObj = { data: {}, criteria: {} };
        thisObj.setState({ processingMonitor: true });

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
        const callSchedules = values[`callSchedules_${this.props.index}`];
        let monitorSchedules = [];
        if (callSchedules && callSchedules.length) {
            monitorSchedules = callSchedules
                .filter(schedule => Object.values(schedule)[0] === true)
                .map(schedule => {
                    return Object.keys(schedule)[0];
                });
        }

        postObj.callScheduleIds = monitorSchedules;
        if (postObj.type === 'manual')
            postObj.data.description =
                values[`description_${this.props.index}`] || null;

        if (postObj.type === 'url' || postObj.type === 'api')
            postObj.data.url = values[`url_${this.props.index}`];

        if (postObj.type === 'script') {
            postObj.data.script = thisObj.state.script;
        }
        if (postObj.type === 'ip')
            postObj.data.IPAddress = values[`ip_${this.props.index}`];

        if (
            postObj.type === 'server-monitor' &&
            values[`mode_${this.props.index}`] === 'agentless'
        ) {
            postObj.agentlessConfig = {
                host: values[`host_${this.props.index}`],
                port: values[`port_${this.props.index}`],
                username: values[`username_${this.props.index}`],
                authentication: values[`authentication_${this.props.index}`],
            };
            if (
                values[`authentication_${this.props.index}`] === 'identityFile'
            ) {
                postObj.agentlessConfig.identityFile = this.props.identityFile;
            } else {
                postObj.agentlessConfig.password =
                    values[`password_${this.props.index}`];
            }
        }

        if (postObj.type === 'kubernetes' && !this.props.edit) {
            postObj.kubernetesConfig = this.props.configurationFile;
            postObj.kubernetesNamespace =
                values[`kubernetesNamespace_${this.props.index}`];
        }
        if (
            postObj.type === 'kubernetes' &&
            this.props.edit &&
            this.props.configurationFile
        ) {
            postObj.kubernetesConfig = this.props.configurationFile;
        }

        if (postObj.type === 'incomingHttpRequest')
            postObj.data.link = thisObj.state.httpRequestLink;

        if (
            postObj.type === 'url' ||
            postObj.type === 'api' ||
            postObj.type === 'server-monitor' ||
            postObj.type === 'script' ||
            postObj.type === 'incomingHttpRequest' ||
            postObj.type === 'kubernetes' ||
            postObj.type === 'ip'
        ) {
            // collect and organize all criteria data
            const criteria = { up: [], down: [], degraded: [] };
            this.state.criteria.forEach(criterion => {
                const criterionData = {};

                const criterionFieldName = `${criterion.type}_${criterion.id}`;

                // add conditions only if the criterion isn't a default one
                if (criterion.default) {
                    criterionData.default = true;
                } else {
                    const conditions = makeCriteria(
                        values[`${criterionFieldName}`]
                    );
                    criterionData.criteria = conditions;
                }

                const criterionSchedules =
                    values[`criterion_${criterion.id}_schedules`];
                const schedules = criterionSchedules
                    ? criterionSchedules
                          .filter(scheduleObject => {
                              return Object.values(scheduleObject)[0] === true;
                          })
                          .map(scheduleObject => Object.keys(scheduleObject)[0])
                    : [];

                criterionData.scheduleIds = schedules;
                criterionData.name = values[`name_${criterionFieldName}`];
                criterionData.createAlert =
                    values[`createAlert_${criterionFieldName}`];
                criterionData.autoAcknowledge =
                    values[`autoAcknowledge_${criterionFieldName}`];
                criterionData.autoResolve =
                    values[`autoResolve_${criterionFieldName}`];
                criterionData.title =
                    values[`incidentTitle_${criterionFieldName}`];
                criterionData.description =
                    values[`incidentDescription_${criterionFieldName}`];
                const scriptValues =
                    values[`script_${criterionFieldName}`] || [];
                const scriptArr = scriptValues.map(script => {
                    return {
                        scriptId: script.value,
                    };
                });
                criterionData.scripts = scriptArr || [];

                if (Array.isArray(criteria[criterion.type])) {
                    criteria[criterion.type].push(criterionData);
                }
            });
            postObj.criteria = criteria;
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
                    } catch (e) {
                        //
                    }
                }
                postObj.text = text;
            }
        }

        if (this.props.edit) {
            const { monitorId } = this.props;
            postObj._id = this.props.editMonitorProp._id;
            this.props
                .editMonitor(postObj.projectId, postObj)
                .then(data => {
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

                    thisObj.setState({ processingMonitor: false });
                    history.replace(
                        `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.component.slug}/monitoring/${data.data.slug}`
                    );
                })
                .finally(() => thisObj.setState({ processingMonitor: false }));
        } else {
            this.props
                .createMonitor(postObj.projectId, postObj)
                .then(
                    data => {
                        thisObj.props.reset();

                        thisObj.setState({ processingMonitor: false });
                        history.push(
                            `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.componentSlug}/monitoring/${data.data.slug}`
                        );
                    },
                    error => {
                        if (error && error.message) {
                            return error;
                        }
                    }
                )
                .finally(() => thisObj.setState({ processingMonitor: false }));
        }

        this.setState({
            advance: false,
            script: defaultScript,
            type: this.props.edit
                ? this.props.editMonitorProp.type
                : this.props.type,
        });
    };

    scheduleChange = (e, value) => {
        //load call schedules/duties
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

    componentWillUnmount() {
        if (this.props.edit) {
            this.cancelEdit();
        }
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    openAdvance = () => {
        this.setState({ advance: !this.state.advance });
    };

    changeBox = (e, value) => {
        this.setState({ advance: false, type: value });
        this.props.setMonitorCriteria(
            this.props.name,
            this.props.category,
            this.props.subProject,
            this.props.monitorSchedules,
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
        } catch (error) {
            return;
        }
    };

    changeConfigFile = e => {
        e.preventDefault();

        const {
            logConfigFile,
            uploadConfigurationFile,
            projectId,
        } = this.props;

        const reader = new FileReader();
        const file = e.target.files[0];

        reader.onloadend = () => {
            const fileResult = reader.result;
            logConfigFile(fileResult);
            uploadConfigurationFile(projectId, file);
        };
        try {
            reader.readAsDataURL(file);
        } catch (error) {
            return;
        }
    };

    removeConfigFile = () => {
        const { setConfigInputKey, resetConfigFile } = this.props;

        setConfigInputKey(new Date());
        resetConfigFile();
    };

    removeFile = () => {
        const { setFileInputKey, resetFile } = this.props;

        setFileInputKey(new Date());
        resetFile();
    };

    scriptTextChange = newValue => {
        this.setState({ script: newValue });
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

    renderMonitorConfiguration = name => {
        return (
            <div className="bs-ContentSection-content Box-root  Flex-flex Flex-alignItems--center Padding-horizontal--29 Padding-vertical--16">
                <label className="bs-Fieldset-label" />
                <div className="Box-root">
                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                        <span>{name} Monitor Configuration</span>
                    </span>
                    <p>
                        <span>
                            Setup your new monitor&apos;s configuration as per
                            your needs.
                        </span>
                    </p>
                </div>
            </div>
        );
    };
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
            uploadingIdentityFile,
            fileInputKey,
            uploadingConfigurationFile,
            configurationFile,
            configFileInputKey,
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
        const monitorTypesOptions = [
            {
                value: 'url',
                label: 'Website',
                description:
                    'Monitor your website and get notified when it goes down or performs poorly.',
                icon:
                    'data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjQxNHB0IiB2aWV3Qm94PSIwIC0yNCA0MTQgNDE0IiB3aWR0aD0iNDE0cHQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0ibTM2NyAzNjUuMzA0Njg4aC0zMjBjLTI1LjkxNDA2MiAwLTQ3LTIxLjA4NTkzOC00Ny00N3YtMjcxLjMwNDY4OGMwLTI1LjkxNDA2MiAyMS4wODU5MzgtNDcgNDctNDdoMzIwYzI1LjkxNDA2MiAwIDQ3IDIxLjA4NTkzOCA0NyA0N3YyNzEuMzA0Njg4YzAgMjUuOTE0MDYyLTIxLjA4NTkzOCA0Ny00NyA0N3ptLTMyMC0zNTEuMzA0Njg4Yy0xOC4xOTUzMTIgMC0zMyAxNC44MDQ2ODgtMzMgMzN2MjcxLjMwNDY4OGMwIDE4LjE5NTMxMiAxNC44MDQ2ODggMzMgMzMgMzNoMzIwYzE4LjE5NTMxMiAwIDMzLTE0LjgwNDY4OCAzMy0zM3YtMjcxLjMwNDY4OGMwLTE4LjE5NTMxMi0xNC44MDQ2ODgtMzMtMzMtMzN6bTAgMCIvPjxwYXRoIGQ9Im0zNTAuODIwMzEyIDI1OC40MzM1OTRoLTEwOS45OTYwOTNjLTMuODY3MTg4IDAtNy0zLjEzMjgxMy03LTcgMC0zLjg2MzI4MiAzLjEzMjgxMi03IDctN2gxMDkuOTk2MDkzYzMuODYzMjgyIDAgNyAzLjEzNjcxOCA3IDcgMCAzLjg2NzE4Ny0zLjEzMjgxMiA3LTcgN3ptMCAwIi8+PHBhdGggZD0ibTM1MC44MjAzMTIgMzA5LjA0Mjk2OWgtMTA5Ljk5NjA5M2MtMy44NjcxODggMC03LTMuMTMyODEzLTctNyAwLTMuODYzMjgxIDMuMTMyODEyLTcgNy03aDEwOS45OTYwOTNjMy44NjMyODIgMCA3IDMuMTM2NzE5IDcgNyAwIDMuODY3MTg3LTMuMTMyODEyIDctNyA3em0wIDAiLz48cGF0aCBkPSJtMzUwLjgyMDMxMiAxNTcuMjE0ODQ0aC0xMDkuOTk2MDkzYy0zLjg2NzE4OCAwLTctMy4xMzI4MTMtNy03IDAtMy44NjMyODIgMy4xMzI4MTItNyA3LTdoMTA5Ljk5NjA5M2MzLjg2MzI4MiAwIDcgMy4xMzY3MTggNyA3IDAgMy44NjcxODctMy4xMzI4MTIgNy03IDd6bTAgMCIvPjxwYXRoIGQ9Im0zNTAuODIwMzEyIDIwNy44MjQyMTloLTEwOS45OTYwOTNjLTMuODY3MTg4IDAtNy0zLjEzMjgxMy03LTcgMC0zLjg2MzI4MSAzLjEzMjgxMi03IDctN2gxMDkuOTk2MDkzYzMuODYzMjgyIDAgNyAzLjEzNjcxOSA3IDcgMCAzLjg2NzE4Ny0zLjEzMjgxMiA3LTcgN3ptMCAwIi8+PHBhdGggZD0ibTQwNyA5My43MzA0NjloLTQwMGMtMy44NjcxODggMC03LTMuMTMyODEzLTctNyAwLTMuODY3MTg4IDMuMTMyODEyLTcgNy03aDQwMGMzLjg2NzE4OCAwIDcgMy4xMzI4MTIgNyA3IDAgMy44NjcxODctMy4xMzI4MTIgNy03IDd6bTAgMCIvPjxwYXRoIGQ9Im0xMDAuOTE0MDYyIDY4Ljc4MTI1Yy0xMi4wMTE3MTggMC0yMS43ODUxNTYtOS43Njk1MzEtMjEuNzg1MTU2LTIxLjc4MTI1czkuNzczNDM4LTIxLjc4MTI1IDIxLjc4NTE1Ni0yMS43ODEyNWMxMi4wMTE3MTkgMCAyMS43ODEyNSA5Ljc2OTUzMSAyMS43ODEyNSAyMS43ODEyNXMtOS43Njk1MzEgMjEuNzgxMjUtMjEuNzgxMjUgMjEuNzgxMjV6bTAtMjkuNTYyNWMtNC4yOTI5NjggMC03Ljc4NTE1NiAzLjQ5MjE4OC03Ljc4NTE1NiA3Ljc4MTI1czMuNDkyMTg4IDcuNzgxMjUgNy43ODUxNTYgNy43ODEyNWM0LjI4OTA2MyAwIDcuNzgxMjUtMy40OTIxODggNy43ODEyNS03Ljc4MTI1cy0zLjQ5MjE4Ny03Ljc4MTI1LTcuNzgxMjUtNy43ODEyNXptMCAwIi8+PHBhdGggZD0ibTUwLjQ3NjU2MiA2OC43ODEyNWMtMTIuMDA3ODEyIDAtMjEuNzgxMjUtOS43Njk1MzEtMjEuNzgxMjUtMjEuNzgxMjVzOS43NzM0MzgtMjEuNzgxMjUgMjEuNzgxMjUtMjEuNzgxMjVjMTIuMDExNzE5IDAgMjEuNzg1MTU3IDkuNzY5NTMxIDIxLjc4NTE1NyAyMS43ODEyNXMtOS43NzM0MzggMjEuNzgxMjUtMjEuNzg1MTU3IDIxLjc4MTI1em0wLTI5LjU2MjVjLTQuMjg5MDYyIDAtNy43ODEyNSAzLjQ5MjE4OC03Ljc4MTI1IDcuNzgxMjVzMy40OTIxODggNy43ODEyNSA3Ljc4MTI1IDcuNzgxMjVjNC4yOTI5NjkgMCA3Ljc4NTE1Ny0zLjQ5MjE4OCA3Ljc4NTE1Ny03Ljc4MTI1cy0zLjQ5MjE4OC03Ljc4MTI1LTcuNzg1MTU3LTcuNzgxMjV6bTAgMCIvPjxwYXRoIGQ9Im0xNTEuMzQ3NjU2IDY4Ljc4MTI1Yy0xMi4wMTE3MTggMC0yMS43ODEyNS05Ljc2OTUzMS0yMS43ODEyNS0yMS43ODEyNXM5Ljc2OTUzMi0yMS43ODEyNSAyMS43ODEyNS0yMS43ODEyNWMxMi4wMTE3MTkgMCAyMS43ODUxNTYgOS43Njk1MzEgMjEuNzg1MTU2IDIxLjc4MTI1cy05Ljc3MzQzNyAyMS43ODEyNS0yMS43ODUxNTYgMjEuNzgxMjV6bTAtMjkuNTYyNWMtNC4yOTI5NjggMC03Ljc4MTI1IDMuNDkyMTg4LTcuNzgxMjUgNy43ODEyNXMzLjQ5MjE4OCA3Ljc4MTI1IDcuNzgxMjUgNy43ODEyNWM0LjI5Mjk2OSAwIDcuNzg1MTU2LTMuNDkyMTg4IDcuNzg1MTU2LTcuNzgxMjVzLTMuNDkyMTg3LTcuNzgxMjUtNy43ODUxNTYtNy43ODEyNXptMCAwIi8+PHBhdGggZD0ibTE4OCAzMDkuMDQyOTY5aC0xMjdjLTMuODY3MTg4IDAtNy0zLjEzMjgxMy03LTd2LTE1MS44MjgxMjVjMC0zLjg2MzI4MiAzLjEzMjgxMi03IDctN2gxMjdjMy44NjcxODggMCA3IDMuMTM2NzE4IDcgN3YxNTEuODI4MTI1YzAgMy44NjcxODctMy4xMzI4MTIgNy03IDd6bS0xMjAtMTRoMTEzdi0xMzcuODI4MTI1aC0xMTN6bTAgMCIvPjwvc3ZnPg==',
            },
            {
                value: 'api',
                label: 'API',
                description:
                    'Monitor REST endpoints constantly and notify your team when they do not behave the way you want.',
                icon:
                    'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNTEyIDUxMjsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik00NjcsNzMuNTZINDVjLTI0LjgxMywwLTQ1LDIwLjE4Ny00NSw0NXYyNzQuODgxYzAsMjQuODEzLDIwLjE4Nyw0NSw0NSw0NWg0MjJjMjQuODEzLDAsNDUtMjAuMTg3LDQ1LTQ1VjExOC41Ng0KCQkJQzUxMiw5My43NDYsNDkxLjgxMyw3My41Niw0NjcsNzMuNTZ6IE00ODIsMzkzLjQ0MWMwLDguMjcxLTYuNzI5LDE1LTE1LDE1SDQ1Yy04LjI3MSwwLTE1LTYuNzI5LTE1LTE1VjE3Ny45NjVoNDUyVjM5My40NDF6DQoJCQkgTTQ4MiwxNDcuOTY1SDMwVjExOC41NmMwLTguMjcxLDYuNzI5LTE1LDE1LTE1aDQyMmM4LjI3MSwwLDE1LDYuNzI5LDE1LDE1VjE0Ny45NjV6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik0xNzEuNzQxLDIxNy4yNjRjLTI2Ljc0OSwwLTQ4LjUxMiwyMS43NjMtNDguNTEyLDQ4LjUxMnY2NS40NjFjMCw4LjI4NCw2LjcxNiwxNSwxNSwxNXMxNS02LjcxNiwxNS0xNXYtMjguNDM1aDM3LjAyMw0KCQkJdjI4LjQzNWMwLDguMjg0LDYuNzE2LDE1LDE1LDE1czE1LTYuNzE2LDE1LTE1di02NS40NjFDMjIwLjI1MywyMzkuMDI3LDE5OC40OSwyMTcuMjY0LDE3MS43NDEsMjE3LjI2NHogTTE5MC4yNTMsMjcyLjgwM0gxNTMuMjMNCgkJCXYtNy4wMjZoLTAuMDAxYzAtMTAuMjA4LDguMzA1LTE4LjUxMiwxOC41MTItMTguNTEyYzEwLjIwNywwLDE4LjUxMiw4LjMwNCwxOC41MTIsMTguNTEyVjI3Mi44MDN6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik0yOTUuMjU1LDIxNy4yNjRIMjU2Yy04LjI4NCwwLTE1LDYuNzE2LTE1LDE1djk4Ljk3M2MwLDguMjg0LDYuNzE2LDE1LDE1LDE1czE1LTYuNzE2LDE1LTE1di0yOC40MzVoMjQuMjU1DQoJCQljMjMuNTgzLDAsNDIuNzctMTkuMTg3LDQyLjc3LTQyLjc3QzMzOC4wMjUsMjM2LjQ1LDMxOC44MzgsMjE3LjI2NCwyOTUuMjU1LDIxNy4yNjR6IE0yOTUuMjU1LDI3Mi44MDNIMjcxdi0yNS41MzhoMjQuMjU1DQoJCQljNy4wNDEsMCwxMi43Nyw1LjcyOSwxMi43NywxMi43N0MzMDguMDI1LDI2Ny4wNzcsMzAyLjI5NiwyNzIuODAzLDI5NS4yNTUsMjcyLjgwM3oiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCgk8Zz4NCgkJPHBhdGggZD0iTTM3My43NzEsMjE3LjI2NGMtOC4yODQsMC0xNSw2LjcxNi0xNSwxNXY5OC45NzNjMCw4LjI4NCw2LjcxNiwxNSwxNSwxNXMxNS02LjcxNiwxNS0xNXYtOTguOTczDQoJCQlDMzg4Ljc3MSwyMjMuOTgsMzgyLjA1NSwyMTcuMjY0LDM3My43NzEsMjE3LjI2NHoiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8L3N2Zz4NCg==',
            },
            {
                value: 'manual',
                label: 'Manual',
                description:
                    'Manual monitors do not monitor any resource. You can change monitor status by using OneUptime’s API. This is helpful when you use different monitoring tool but want to record monitor status on OneUptime.',
                icon:
                    'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgNDI2LjY2NyA0MjYuNjY3IiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA0MjYuNjY3IDQyNi42Njc7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4NCjxnPg0KCTxnPg0KCQk8cGF0aCBkPSJNMjEzLjMzMywwQzk1LjQ2NywwLDAsOTUuNDY3LDAsMjEzLjMzM3M5NS40NjcsMjEzLjMzMywyMTMuMzMzLDIxMy4zMzNTNDI2LjY2NywzMzEuMiw0MjYuNjY3LDIxMy4zMzNTMzMxLjIsMCwyMTMuMzMzLDANCgkJCXogTTIxMy4zMzMsMzg0Yy05NC4yOTMsMC0xNzAuNjY3LTc2LjM3My0xNzAuNjY3LTE3MC42NjdTMTE5LjA0LDQyLjY2NywyMTMuMzMzLDQyLjY2N1MzODQsMTE5LjA0LDM4NCwyMTMuMzMzDQoJCQlTMzA3LjYyNywzODQsMjEzLjMzMywzODR6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPC9zdmc+DQo=',
            },
            {
                value: 'server-monitor',
                label: 'Server',
                description:
                    'Monitor servers constantly and notify your team when they do not behave the way you want.',
                icon:
                    'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNTEyIDUxMjsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxnPg0KCQkJPHBhdGggZD0iTTQzNy4zMzMsNDA1LjMyM0gyNjYuNjY3Yy01Ljg4OCwwLTEwLjY2Nyw0Ljc3OS0xMC42NjcsMTAuNjY3czQuNzc5LDEwLjY2NywxMC42NjcsMTAuNjY3aDE3MC42NjcNCgkJCQljNS44ODgsMCwxMC42NjctNC43NzksMTAuNjY3LTEwLjY2N1M0NDMuMjIxLDQwNS4zMjMsNDM3LjMzMyw0MDUuMzIzeiIvPg0KCQkJPHBhdGggZD0iTTQzNy4zMzMsNDQ3Ljk4OUgyNjYuNjY3Yy01Ljg4OCwwLTEwLjY2Nyw0Ljc3OS0xMC42NjcsMTAuNjY3YzAsNS44ODgsNC43NzksMTAuNjY3LDEwLjY2NywxMC42NjdoMTcwLjY2Nw0KCQkJCWM1Ljg4OCwwLDEwLjY2Ny00Ljc3OSwxMC42NjctMTAuNjY3QzQ0OCw0NTIuNzY4LDQ0My4yMjEsNDQ3Ljk4OSw0MzcuMzMzLDQ0Ny45ODl6Ii8+DQoJCQk8cGF0aCBkPSJNNzQuNjY3LDQwNS4zMjNjLTE3LjY0MywwLTMyLDE0LjM1Ny0zMiwzMmMwLDE3LjY0MywxNC4zNTcsMzIsMzIsMzJjMTcuNjQzLDAsMzItMTQuMzU3LDMyLTMyDQoJCQkJQzEwNi42NjcsNDE5LjY4LDkyLjMwOSw0MDUuMzIzLDc0LjY2Nyw0MDUuMzIzeiBNNzQuNjY3LDQ0Ny45ODljLTUuODg4LDAtMTAuNjY3LTQuNzc5LTEwLjY2Ny0xMC42NjcNCgkJCQljMC01Ljg4OCw0Ljc3OS0xMC42NjcsMTAuNjY3LTEwLjY2N3MxMC42NjcsNC43NzksMTAuNjY3LDEwLjY2N0M4NS4zMzMsNDQzLjIxMSw4MC41NTUsNDQ3Ljk4OSw3NC42NjcsNDQ3Ljk4OXoiLz4NCgkJCTxwYXRoIGQ9Ik03NC42NjcsMjc3LjMyM2MtMTcuNjQzLDAtMzIsMTQuMzU3LTMyLDMyYzAsMTcuNjQzLDE0LjM1NywzMiwzMiwzMmMxNy42NDMsMCwzMi0xNC4zNTcsMzItMzINCgkJCQlDMTA2LjY2NywyOTEuNjgsOTIuMzA5LDI3Ny4zMjMsNzQuNjY3LDI3Ny4zMjN6IE03NC42NjcsMzE5Ljk4OWMtNS44ODgsMC0xMC42NjctNC43NzktMTAuNjY3LTEwLjY2Nw0KCQkJCXM0Ljc3OS0xMC42NjcsMTAuNjY3LTEwLjY2N3MxMC42NjcsNC43NzksMTAuNjY3LDEwLjY2N1M4MC41NTUsMzE5Ljk4OSw3NC42NjcsMzE5Ljk4OXoiLz4NCgkJCTxwYXRoIGQ9Ik00MzcuMzMzLDE5MS45ODlIMjY2LjY2N2MtNS44ODgsMC0xMC42NjcsNC43NzktMTAuNjY3LDEwLjY2N3M0Ljc3OSwxMC42NjcsMTAuNjY3LDEwLjY2N2gxNzAuNjY3DQoJCQkJYzUuODg4LDAsMTAuNjY3LTQuNzc5LDEwLjY2Ny0xMC42NjdTNDQzLjIyMSwxOTEuOTg5LDQzNy4zMzMsMTkxLjk4OXoiLz4NCgkJCTxwYXRoIGQ9Ik01MTIsMjAyLjY1NnYtNDIuNjY3YzAtMTAuMjQtMy4wNTEtMTkuNzMzLTguMDg1LTI3Ljg4M2MtMC4xNDktMC4yOTktMC4xNzEtMC42NC0wLjM0MS0wLjkxN0w0MzcuNjExLDI1LjE2Mw0KCQkJCUM0MjcuODE5LDkuNDE5LDQxMC44OCwwLjAxMSwzOTIuMzIsMC4wMTFIMTE5Ljc0NGMtMTguNTgxLDAtMzUuNDk5LDkuNDA4LTQ1LjI5MSwyNS4xNTJMOC40OTEsMTMxLjE4OQ0KCQkJCWMtMC4xMDcsMC4xNzEtMC4xMDcsMC4zNjMtMC4yMTMsMC41NTVDMy4xMTUsMTM5Ljk1NywwLDE0OS42LDAsMTU5Ljk4OXY0Mi42NjdjMCwxNy40OTMsOC41OTcsMzIuOTM5LDIxLjY3NSw0Mi42NjcNCgkJCQlDOC41OTcsMjU1LjA3MiwwLDI3MC40OTYsMCwyODcuOTg5djQyLjY2N2MwLDE3LjQ5Myw4LjU5NywzMi45MzksMjEuNjc1LDQyLjY2N0M4LjU5NywzODMuMDcyLDAsMzk4LjQ5NiwwLDQxNS45ODl2NDIuNjY3DQoJCQkJYzAsMjkuMzk3LDIzLjkzNiw1My4zMzMsNTMuMzMzLDUzLjMzM2g0MDUuMzMzYzI5LjM5NywwLDUzLjMzMy0yMy45MzYsNTMuMzMzLTUzLjMzM3YtNDIuNjY3DQoJCQkJYzAtMTcuNDkzLTguNTk3LTMyLjkzOS0yMS42NzUtNDIuNjY3QzUwMy40MDMsMzYzLjU5NSw1MTIsMzQ4LjE0OSw1MTIsMzMwLjY1NnYtNDIuNjY3YzAtMTcuNDkzLTguNTk3LTMyLjkzOS0yMS42NzUtNDIuNjY3DQoJCQkJQzUwMy40MDMsMjM1LjU5NSw1MTIsMjIwLjE3MSw1MTIsMjAyLjY1NnogTTkyLjU2NSwzNi40MjdjNS44NjctOS40NTEsMTYuMDIxLTE1LjEwNCwyNy4xNTctMTUuMTA0aDI3Mi41NzYNCgkJCQljMTEuMTM2LDAsMjEuMjkxLDUuNjUzLDI3LjE1NywxNS4xMDRsNDQuMDExLDcwLjcyYy0xLjYtMC4xNDktMy4xNTctMC40OTEtNC44LTAuNDkxSDUzLjMzM2MtMS42NDMsMC0zLjE3OSwwLjM0MS00Ljc3OSwwLjQ5MQ0KCQkJCUw5Mi41NjUsMzYuNDI3eiBNNDkwLjY2Nyw0MTUuOTg5djQyLjY2N2MwLDE3LjY0My0xNC4zNTcsMzItMzIsMzJINTMuMzMzYy0xNy42NDMsMC0zMi0xNC4zNTctMzItMzJ2LTQyLjY2Nw0KCQkJCWMwLTE3LjY0MywxNC4zNTctMzIsMzItMzJoNDA1LjMzM0M0NzYuMzA5LDM4My45ODksNDkwLjY2NywzOTguMzQ3LDQ5MC42NjcsNDE1Ljk4OXogTTQ5MC42NjcsMjg3Ljk4OXY0Mi42NjcNCgkJCQljMCwxNy42NDMtMTQuMzU3LDMyLTMyLDMySDUzLjMzM2MtMTcuNjQzLDAtMzItMTQuMzU3LTMyLTMydi00Mi42NjdjMC0xNy42NDMsMTQuMzU3LTMyLDMyLTMyaDQwNS4zMzMNCgkJCQlDNDc2LjMwOSwyNTUuOTg5LDQ5MC42NjcsMjcwLjM0Nyw0OTAuNjY3LDI4Ny45ODl6IE00OTAuNjY3LDIwMi42NTZjMCwxNy42NDMtMTQuMzU3LDMyLTMyLDMySDUzLjMzM2MtMTcuNjQzLDAtMzItMTQuMzU3LTMyLTMyDQoJCQkJdi00Mi42NjdjMC0xNy42NDMsMTQuMzU3LTMyLDMyLTMyaDQwNS4zMzNjMTcuNjQzLDAsMzIsMTQuMzU3LDMyLDMyVjIwMi42NTZ6Ii8+DQoJCQk8cGF0aCBkPSJNNDM3LjMzMywxNDkuMzIzSDI2Ni42NjdjLTUuODg4LDAtMTAuNjY3LDQuNzc5LTEwLjY2NywxMC42NjdzNC43NzksMTAuNjY3LDEwLjY2NywxMC42NjdoMTcwLjY2Nw0KCQkJCWM1Ljg4OCwwLDEwLjY2Ny00Ljc3OSwxMC42NjctMTAuNjY3UzQ0My4yMjEsMTQ5LjMyMyw0MzcuMzMzLDE0OS4zMjN6Ii8+DQoJCQk8cGF0aCBkPSJNNDM3LjMzMywzMTkuOTg5SDI2Ni42NjdjLTUuODg4LDAtMTAuNjY3LDQuNzc5LTEwLjY2NywxMC42NjdzNC43NzksMTAuNjY3LDEwLjY2NywxMC42NjdoMTcwLjY2Nw0KCQkJCWM1Ljg4OCwwLDEwLjY2Ny00Ljc3OSwxMC42NjctMTAuNjY3UzQ0My4yMjEsMzE5Ljk4OSw0MzcuMzMzLDMxOS45ODl6Ii8+DQoJCQk8cGF0aCBkPSJNNDM3LjMzMywyNzcuMzIzSDI2Ni42NjdjLTUuODg4LDAtMTAuNjY3LDQuNzc5LTEwLjY2NywxMC42NjdzNC43NzksMTAuNjY3LDEwLjY2NywxMC42NjdoMTcwLjY2Nw0KCQkJCWM1Ljg4OCwwLDEwLjY2Ny00Ljc3OSwxMC42NjctMTAuNjY3UzQ0My4yMjEsMjc3LjMyMyw0MzcuMzMzLDI3Ny4zMjN6Ii8+DQoJCQk8cGF0aCBkPSJNNzQuNjY3LDE0OS4zMjNjLTE3LjY0MywwLTMyLDE0LjM1Ny0zMiwzMmMwLDE3LjY0MywxNC4zNTcsMzIsMzIsMzJjMTcuNjQzLDAsMzItMTQuMzU3LDMyLTMyDQoJCQkJQzEwNi42NjcsMTYzLjY4LDkyLjMwOSwxNDkuMzIzLDc0LjY2NywxNDkuMzIzeiBNNzQuNjY3LDE5MS45ODljLTUuODg4LDAtMTAuNjY3LTQuNzc5LTEwLjY2Ny0xMC42NjcNCgkJCQlzNC43NzktMTAuNjY3LDEwLjY2Ny0xMC42NjdzMTAuNjY3LDQuNzc5LDEwLjY2NywxMC42NjdTODAuNTU1LDE5MS45ODksNzQuNjY3LDE5MS45ODl6Ii8+DQoJCTwvZz4NCgk8L2c+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8L3N2Zz4NCg==',
            },
            {
                value: 'incomingHttpRequest',
                label: 'Incoming Request',
                description:
                    'Receives incoming HTTP get or post request and evaluates response body.',
                icon:
                    'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgNDY5LjMzMyA0NjkuMzMzIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA0NjkuMzMzIDQ2OS4zMzM7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4NCjxnPg0KCTxnPg0KCQk8Zz4NCgkJCTxwb2x5Z29uIHBvaW50cz0iNzQuNjY3LDIxMy4zMzMgMzIsMjEzLjMzMyAzMiwxNzAuNjY3IDAsMTcwLjY2NyAwLDI5OC42NjcgMzIsMjk4LjY2NyAzMiwyNDUuMzMzIDc0LjY2NywyNDUuMzMzIA0KCQkJCTc0LjY2NywyOTguNjY3IDEwNi42NjcsMjk4LjY2NyAxMDYuNjY3LDE3MC42NjcgNzQuNjY3LDE3MC42NjcgCQkJIi8+DQoJCQk8cG9seWdvbiBwb2ludHM9IjEyOCwyMDIuNjY3IDE2MCwyMDIuNjY3IDE2MCwyOTguNjY3IDE5MiwyOTguNjY3IDE5MiwyMDIuNjY3IDIyNCwyMDIuNjY3IDIyNCwxNzAuNjY3IDEyOCwxNzAuNjY3IAkJCSIvPg0KCQkJPHBvbHlnb24gcG9pbnRzPSIyNDUuMzMzLDIwMi42NjcgMjc3LjMzMywyMDIuNjY3IDI3Ny4zMzMsMjk4LjY2NyAzMDkuMzMzLDI5OC42NjcgMzA5LjMzMywyMDIuNjY3IDM0MS4zMzMsMjAyLjY2NyANCgkJCQkzNDEuMzMzLDE3MC42NjcgMjQ1LjMzMywxNzAuNjY3IAkJCSIvPg0KCQkJPHBhdGggZD0iTTQzNy4zMzMsMTcwLjY2N2gtNzQuNjY3djEyOGgzMlYyNTZoNDIuNjY3YzE4LjEzMywwLDMyLTEzLjg2NywzMi0zMnYtMjEuMzMzDQoJCQkJQzQ2OS4zMzMsMTg0LjUzMyw0NTUuNDY3LDE3MC42NjcsNDM3LjMzMywxNzAuNjY3eiBNNDM3LjMzMywyMjRoLTQyLjY2N3YtMjEuMzMzaDQyLjY2N1YyMjR6Ii8+DQoJCTwvZz4NCgk8L2c+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8L3N2Zz4NCg==',
            },
            {
                value: 'script',
                label: 'Script',
                description:
                    'Run custom JavaScript script and alerts you when script fails.',
                icon:
                    'data:image/svg+xml;base64,PHN2ZyBpZD0iX3gzMV9weCIgZW5hYmxlLWJhY2tncm91bmQ9Im5ldyAwIDAgMjQgMjQiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHdpZHRoPSI1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0ibTE5LjUgMjRoLTE1Yy0xLjM3OCAwLTIuNS0xLjEyMi0yLjUtMi41di0xOWMwLTEuMzc4IDEuMTIyLTIuNSAyLjUtMi41aDE1YzEuMzc4IDAgMi41IDEuMTIyIDIuNSAyLjV2MTljMCAxLjM3OC0xLjEyMiAyLjUtMi41IDIuNXptLTE1LTIzYy0uODI3IDAtMS41LjY3My0xLjUgMS41djE5YzAgLjgyNy42NzMgMS41IDEuNSAxLjVoMTVjLjgyNyAwIDEuNS0uNjczIDEuNS0xLjV2LTE5YzAtLjgyNy0uNjczLTEuNS0xLjUtMS41eiIvPjxwYXRoIGQ9Im04LjUgMTZjLS4xNjIgMC0uMzItLjA3OC0uNDE3LS4yMjNsLTItM2MtLjExMi0uMTY4LS4xMTItLjM4NyAwLS41NTVsMi0zYy4xNTItLjIzLjQ2Mi0uMjkyLjY5My0uMTM5LjIzLjE1My4yOTIuNDYzLjEzOS42OTNsLTEuODE0IDIuNzI0IDEuODE1IDIuNzIzYy4xNTMuMjMuMDkxLjU0LS4xMzkuNjkzLS4wODUuMDU3LS4xODEuMDg0LS4yNzcuMDg0eiIvPjxwYXRoIGQ9Im0xNS41IDE2Yy0uMDk1IDAtLjE5MS0uMDI3LS4yNzctLjA4NC0uMjMtLjE1My0uMjkyLS40NjMtLjEzOS0uNjkzbDEuODE1LTIuNzIzLTEuODE1LTIuNzIzYy0uMTUzLS4yMy0uMDkxLS41NC4xMzktLjY5M3MuNTQtLjA5Mi42OTMuMTM5bDIgM2MuMTEyLjE2OC4xMTIuMzg3IDAgLjU1NWwtMiAzYy0uMDk2LjE0NC0uMjU1LjIyMi0uNDE2LjIyMnoiLz48cGF0aCBkPSJtMTAuNSAxN2MtLjA1OSAwLS4xMTgtLjAxLS4xNzYtLjAzMi0uMjU4LS4wOTctLjM4OS0uMzg1LS4yOTItLjY0NGwzLThjLjA5Ny0uMjU5LjM4NS0uMzg4LjY0NC0uMjkyLjI1OC4wOTcuMzg5LjM4NS4yOTIuNjQ0bC0zIDhjLS4wNzUuMi0uMjY2LjMyNC0uNDY4LjMyNHoiLz48L3N2Zz4=',
            },
            {
                value: 'ip',
                label: 'IP',
                description:
                    'Monitor routers, IoT devices, or any device which has an IP address.',
                icon:
                    'data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjUxMnB0IiB2aWV3Qm94PSItNDEgMCA1MTIgNTEyIiB3aWR0aD0iNTEycHQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0ibTM2Ny4yNjU2MjUgNjMuMDExNzE5Yy00MC42MzI4MTMtNDAuNjMyODEzLTk0LjY2MDE1Ni02My4wMTE3MTktMTUyLjEyNS02My4wMTE3MTktNTcuNDY4NzUgMC0xMTEuNDkyMTg3IDIyLjM3ODkwNi0xNTIuMTI4OTA2IDYzLjAxMTcxOS00MC42MzI4MTMgNDAuNjM2NzE5LTYzLjAxMTcxOSA5NC42NjQwNjItNjMuMDExNzE5IDE1Mi4xMjg5MDYgMCA1MC4yNSAxNy43MDMxMjUgOTkuMTUyMzQ0IDQ5Ljg0NzY1NiAxMzcuNjk5MjE5di4wMDM5MDZjOC4xNzk2ODggOS44MDQ2ODggMTcuMjgxMjUgMTguOTMzNTk0IDI3LjA2MjUgMjcuMTQ0NTMxbDEyNy42MDkzNzUgMTI3LjYxMzI4MWMyLjkzMzU5NCAyLjkzMzU5NCA2Ljc3NzM0NCA0LjM5ODQzOCAxMC42MjEwOTQgNC4zOTg0MzhzNy42ODc1LTEuNDY0ODQ0IDEwLjYxNzE4Ny00LjM5ODQzOGwxMjcuNjEzMjgyLTEyNy42MTMyODFjOS43ODEyNS04LjIxMDkzNyAxOC44ODI4MTItMTcuMzM5ODQzIDI3LjA1ODU5NC0yNy4xNDg0MzcgMzIuMTQ4NDM3LTM4LjU0Njg3NSA0OS44NTE1NjItODcuNDQ5MjE5IDQ5Ljg1MTU2Mi0xMzcuNjk5MjE5IDAtNTcuNDY0ODQ0LTIyLjM3ODkwNi0xMTEuNDkyMTg3LTYzLjAxNTYyNS0xNTIuMTI4OTA2em0tMzQuNjYwMTU2IDI5NS4yNjU2MjUtMTE3LjQ2NDg0NCAxMTcuNDY0ODQ0LTExNy40NjQ4NDQtMTE3LjQ2NDg0NGMtLjMyMDMxMi0uMzE2NDA2LS42NTIzNDMtLjYyNS0xLS45MTQwNjMtOC41OTc2NTYtNy4xNjc5NjktMTYuNTg5ODQzLTE1LjE2MDE1Ni0yMy43NjE3MTktMjMuNzU3ODEyLTI3LjY0ODQzNy0zMy4xNTYyNS00Mi44Nzg5MDYtNzUuMjMwNDY5LTQyLjg3ODkwNi0xMTguNDY0ODQ0IDAtMTAyLjA2NjQwNiA4My4wMzkwNjMtMTg1LjEwNTQ2OSAxODUuMTA1NDY5LTE4NS4xMDU0NjlzMTg1LjEwNTQ2OSA4My4wMzkwNjMgMTg1LjEwNTQ2OSAxODUuMTA1NDY5YzAgNDMuMjM0Mzc1LTE1LjIzMDQ2OSA4NS4zMDQ2ODctNDIuODgyODEzIDExOC40NjQ4NDQtNy4xNjc5NjkgOC41OTc2NTYtMTUuMTY0MDYyIDE2LjU4OTg0My0yMy43NTc4MTIgMjMuNzU3ODEyLS4zNDc2NTcuMjg5MDYzLS42Nzk2ODguNTk3NjU3LTEgLjkxNDA2M3ptMCAwIi8+PHBhdGggZD0ibTI2Mi4xNTYyNSAxNjUuODc1aC01My4zMzk4NDRjLTguMjkyOTY4IDAtMTUuMDE5NTMxIDYuNzIyNjU2LTE1LjAxOTUzMSAxNS4wMTU2MjV2OTIuOTg4MjgxYzAgOC4yOTY4NzUgNi43MjY1NjMgMTUuMDE5NTMyIDE1LjAxOTUzMSAxNS4wMTk1MzIgOC4yOTI5NjkgMCAxNS4wMTk1MzItNi43MjI2NTcgMTUuMDE5NTMyLTE1LjAxOTUzMnYtMzEuNDc2NTYyaDM4LjMyMDMxMmMyMS4xMDE1NjIgMCAzOC4yNjU2MjUtMTcuMTY0MDYzIDM4LjI2NTYyNS0zOC4yNjU2MjUgMC0yMS4wOTc2NTctMTcuMTY0MDYzLTM4LjI2MTcxOS0zOC4yNjU2MjUtMzguMjYxNzE5em0wIDQ2LjQ5MjE4OGgtMzguMzIwMzEydi0xNi40NTcwMzJoMzguMzIwMzEyYzQuNTM5MDYyIDAgOC4yMzA0NjkgMy42OTE0MDYgOC4yMzA0NjkgOC4yMzA0NjkgMCA0LjUzNTE1Ni0zLjY5MTQwNyA4LjIyNjU2My04LjIzMDQ2OSA4LjIyNjU2M3ptMCAwIi8+PHBhdGggZD0ibTE2NC4zODY3MTkgMTY1Ljg3NWMtOC4yOTI5NjkgMC0xNS4wMTk1MzEgNi43MjI2NTYtMTUuMDE5NTMxIDE1LjAxNTYyNXY5Mi45ODgyODFjMCA4LjI5Njg3NSA2LjcyNjU2MiAxNS4wMTk1MzIgMTUuMDE5NTMxIDE1LjAxOTUzMnMxNS4wMTk1MzEtNi43MjI2NTcgMTUuMDE5NTMxLTE1LjAxOTUzMnYtOTIuOTg4MjgxYzAtOC4yOTI5NjktNi43MjY1NjItMTUuMDE1NjI1LTE1LjAxOTUzMS0xNS4wMTU2MjV6bTAgMCIvPjwvc3ZnPg==',
            },
            {
                value: 'kubernetes',
                label: 'Kubernetes',
                description: 'Monitor kubernete clusters',
                icon:
                    'data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjMDAwMDAwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciICB2aWV3Qm94PSIwIDAgNTAgNTAiIHdpZHRoPSI1MHB4IiBoZWlnaHQ9IjUwcHgiPjxwYXRoIGQ9Ik0gMjUgMi4yNzczNDM4IEMgMjQuNDc3MjE4IDIuMjc3NTI4OCAyMy45NTQ5NzUgMi4zOTM4MjA4IDIzLjQ3MjY1NiAyLjYyNjk1MzEgTCA4LjAxMTcxODggMTAuMDkxNzk3IEMgNy4wNDk5NzM4IDEwLjU1NTg5NSA2LjM1MDY0NjIgMTEuNDM0OTUgNi4xMTMyODEyIDEyLjQ3NjU2MiBMIDIuMjkyOTY4OCAyOS4yNTk3NjYgQyAyLjA1Njg4NzggMzAuMjk5MDggMi4zMDU2Nzk4IDMxLjM5MTc5MiAyLjk2ODc1IDMyLjIyNjU2MiBMIDEzLjY3MTg3NSA0NS42ODM1OTQgQyAxNC4zMzgwNjYgNDYuNTIxNTY5IDE1LjM1MjEzMyA0Ny4wMDk3NjYgMTYuNDIxODc1IDQ3LjAwOTc2NiBMIDMzLjU3ODEyNSA0Ny4wMDk3NjYgQyAzNC42NDc4NjcgNDcuMDA5NzY2IDM1LjY2MTkzNCA0Ni41MjE1NjkgMzYuMzI4MTI1IDQ1LjY4MzU5NCBMIDQ3LjAzMTI1IDMyLjIyODUxNiBMIDQ3LjAzMTI1IDMyLjIyNjU2MiBDIDQ3LjY5NDE4NSAzMS4zOTI0OCA0Ny45NDQ3MjEgMzAuMzAwOTExIDQ3LjcwODk4NCAyOS4yNjE3MTkgQSAxLjAwMDEgMS4wMDAxIDAgMCAwIDQ3LjcwODk4NCAyOS4yNTk3NjYgTCA0My44ODY3MTkgMTIuNDc2NTYyIEEgMS4wMDAxIDEuMDAwMSAwIDAgMCA0My44ODY3MTkgMTIuNDc0NjA5IEMgNDMuNjQ5NDEyIDExLjQzNDY0NyA0Mi45NTA0NjQgMTAuNTU2ODI5IDQxLjk4ODI4MSAxMC4wOTE3OTcgTCAyNi41MjkyOTcgMi42MjY5NTMxIEEgMS4wMDAxIDEuMDAwMSAwIDAgMCAyNi41MjczNDQgMi42MjUgQyAyNi4wNDQ5ODYgMi4zOTI4ODI4IDI1LjUyMjc4MiAyLjI3NzE1ODcgMjUgMi4yNzczNDM4IHogTSAyNSA0LjI3NzM0MzggQyAyNS4yMjQ2NTMgNC4yNzc0MTQ3IDI1LjQ0ODc4IDQuMzI3Mjk5OSAyNS42NTgyMDMgNC40Mjc3MzQ0IEwgNDEuMTE5MTQxIDExLjg5MjU3OCBDIDQxLjUzNDk1OCAxMi4wOTM1NDYgNDEuODM0ODA3IDEyLjQ2OTg4NSA0MS45Mzc1IDEyLjkxOTkyMiBMIDQ1Ljc1NzgxMiAyOS43MDMxMjUgQyA0NS44NTk5NDMgMzAuMTUzMzQ2IDQ1Ljc1MzAxMiAzMC42MjI2ODQgNDUuNDY2Nzk3IDMwLjk4MjQyMiBMIDM0Ljc2MzY3MiA0NC40Mzk0NTMgQyAzNC40NzU4NjMgNDQuODAxNDc3IDM0LjA0MDM4MyA0NS4wMDk3NjYgMzMuNTc4MTI1IDQ1LjAwOTc2NiBMIDE2LjQyMTg3NSA0NS4wMDk3NjYgQyAxNS45NTk2MTcgNDUuMDA5NzY2IDE1LjUyNjA5MSA0NC44MDE0NzcgMTUuMjM4MjgxIDQ0LjQzOTQ1MyBMIDQuNTM1MTU2MiAzMC45ODI0MjIgQyA0LjI0ODIyNjYgMzAuNjIxMTkzIDQuMTQwMjY4MyAzMC4xNTE4MTEgNC4yNDIxODc1IDI5LjcwMzEyNSBMIDguMDY0NDUzMSAxMi45MjE4NzUgQyA4LjE2NzA4ODIgMTIuNDcxNDg4IDguNDY2NjA0MyAxMi4wOTQ0MzMgOC44ODA4NTk0IDExLjg5NDUzMSBBIDEuMDAwMSAxLjAwMDEgMCAwIDAgOC44ODA4NTk0IDExLjg5MjU3OCBMIDI0LjM0MTc5NyA0LjQyNzczNDQgQyAyNC41NTAxNjkgNC4zMjcwMTYxIDI0Ljc3NTM0NyA0LjI3NzI3MjggMjUgNC4yNzczNDM4IHogTSAyNC45OTIxODggOC40ODQzNzUgQyAyNC44NTEwOTQgOC40ODQ2ODc1IDI0LjcwNzgxMiA4LjUxMjgxMjUgMjQuNTcwMzEyIDguNTcwMzEyNSBDIDI0LjAyMDMxMiA4LjgxMDMxMjUgMjMuNzYgOS40NSAyNCAxMCBDIDI0LjIzIDEwLjU0IDI0LjMwOTE0MSAxMS4wNzkxNDEgMjQuMzY5MTQxIDExLjYxOTE0MSBDIDI0LjM4OTE0MSAxMS44OTkxNDEgMjQuNDAwNjI1IDEyLjE2OTQ1MyAyNC4zOTA2MjUgMTIuNDM5NDUzIEMgMjQuNDIwNjI1IDEyLjcwOTQ1MyAyNC4yODAwNzggMTIuOTggMjQuMDgwMDc4IDEzLjI1IEMgMjMuODcwMDc4IDEzLjUyIDIzLjg1MDMxMiAxMy43OTA1NDcgMjMuODIwMzEyIDE0LjA2MDU0NyBDIDIxLjA3NjA5MSAxNC4zMjk5MDQgMTguNjA1NjE4IDE1LjUzMjUxIDE2LjcxNjc5NyAxNy4zMzk4NDQgTCAxNi42OTkyMTkgMTcuMzMwMDc4IEMgMTYuNDY5MjE5IDE3LjE4MDA3OCAxNi4yNTAzOTEgMTcuMDI5NTMxIDE1LjkwMDM5MSAxNy4wMTk1MzEgQyAxNS41NzAzOTEgMTYuOTk5NTMxIDE1LjI3MDA3OCAxNi45NDAyMzQgMTUuMDgwMDc4IDE2Ljc0MDIzNCBDIDE0Ljg3MDA3OCAxNi41ODAyMzQgMTQuNjYwNzAzIDE2LjQwMDkzOCAxNC40NzA3MDMgMTYuMjEwOTM4IEMgMTQuMDgwNzAzIDE1LjgzMDkzNyAxMy43MDk0NTMgMTUuNDIwMzkxIDEzLjQzOTQ1MyAxNC45MDAzOTEgQyAxMy4zMDk0NTMgMTQuNjUwMzkxIDEzLjA2OTI5NyAxNC40NDkzNzUgMTIuNzc5Mjk3IDE0LjM1OTM3NSBDIDEyLjE5OTI5NyAxNC4xOTkzNzUgMTEuNTk5Njg4IDE0LjUyOTM3NSAxMS40Mjk2ODggMTUuMTA5Mzc1IEMgMTEuMjU5Njg4IDE1LjY3OTM3NSAxMS41OTk2ODcgMTYuMjg5MjE5IDEyLjE3OTY4OCAxNi40NDkyMTkgQyAxMi43Mzk2ODggMTYuNjE5MjE5IDEzLjIwOTkyMiAxNi44OTkyMTkgMTMuNjY5OTIyIDE3LjE5OTIxOSBDIDEzLjg4OTkyMiAxNy4zNDkyMTkgMTQuMTAwNTQ3IDE3LjUwOTQ1MyAxNC4zMTA1NDcgMTcuNjg5NDUzIEMgMTQuNTQwNTQ3IDE3LjgzOTQ1MyAxNC42NiAxOC4xMTk0NTMgMTQuNzUgMTguNDM5NDUzIEMgMTQuODE1OTkyIDE4Ljc1OTk4NCAxNC45OTk5MjEgMTguOTQ1NDE2IDE1LjE3OTY4OCAxOS4xMjUgQyAxMy44MTA4OCAyMS4wNzQyNjkgMTMgMjMuNDQzMTU3IDEzIDI2IEMgMTMgMjYuNDIyOTY0IDEzLjAyMzQ3MiAyNi44NDAxMzkgMTMuMDY2NDA2IDI3LjI1MTk1MyBDIDEyLjg0MjA3MyAyNy4zMzA0NzggMTIuNjIwMDQgMjcuNDE1NjYzIDEyLjQyOTY4OCAyNy42NDA2MjUgQyAxMi4yMDk2ODcgMjcuODkwNjI1IDExLjk2OTIxOSAyOC4wODkzNzUgMTEuNjk5MjE5IDI4LjEwOTM3NSBDIDExLjQzOTIxOSAyOC4xNzkzNzUgMTEuMTcwMzkxIDI4LjIyOTc2NiAxMC45MDAzOTEgMjguMjU5NzY2IEMgMTAuMzYwMzkxIDI4LjMyOTc2NiA5LjgxMDIzNDQgMjguMzcgOS4yNDAyMzQ0IDI4LjI1IEMgOC45NjAyMzQ0IDI4LjIgOC42NTAzOTA2IDI4LjI1OTQ1MyA4LjQwMDM5MDYgMjguNDM5NDUzIEMgNy45MTAzOTA2IDI4Ljc3OTQ1MyA3LjgwMDYyNSAyOS40NTkyMTkgOC4xNDA2MjUgMjkuOTQ5MjE5IEMgOC40OTA2MjUgMzAuNDM5MjE5IDkuMTcwMTU2MiAzMC41NjA5MzcgOS42NjAxNTYyIDMwLjIxMDkzOCBDIDEwLjE0MDE1NiAyOS44NzA5MzggMTAuNjQ5OTIyIDI5LjY3OTc2NiAxMS4xNjk5MjIgMjkuNTA5NzY2IEMgMTEuNDI5OTIyIDI5LjQyOTc2NiAxMS42OTA5MzggMjkuMzYwNTQ3IDExLjk2MDkzOCAyOS4zMTA1NDcgQyAxMi4yMjA5MzcgMjkuMjIwNTQ3IDEyLjUxMDMxMyAyOS4yOTk2ODggMTIuODIwMzEyIDI5LjQyOTY4OCBDIDEzLjA3Nzg5NSAyOS41NjI2MzMgMTMuMzA1OTU0IDI5LjU1MjA0NSAxMy41MzEyNSAyOS41MjkyOTcgQyAxNC40MTE0NzcgMzIuMzgzMDg3IDE2LjMzNjE1NSAzNC43NzM5MjYgMTguODQ5NjA5IDM2LjI4MzIwMyBDIDE4Ljc2MzczMyAzNi41MjM0ODUgMTguNjgzMTY5IDM2Ljc3Mzg4NCAxOC43NTk3NjYgMzcuMDg5ODQ0IEMgMTguODE5NzY2IDM3LjQxOTg0NCAxOC44Mjk0NTMgMzcuNzMwOTM4IDE4LjY4OTQ1MyAzNy45NjA5MzggQyAxOC41Nzk0NTMgMzguMjEwOTM4IDE4LjQ2MDA3OCAzOC40NDk0NTMgMTguMzMwMDc4IDM4LjY4OTQ1MyBDIDE4LjA1MDA3OCAzOS4xNDk0NTMgMTcuNzUwNTQ3IDM5LjYwOTc2NiAxNy4zMTA1NDcgNDAuMDA5NzY2IEMgMTcuMTAwNTQ3IDQwLjE5OTc2NiAxNi45NTkyMTkgNDAuNDY5Mjk3IDE2Ljk0OTIxOSA0MC43NzkyOTcgQyAxNi45MjkyMTkgNDEuMzc5Mjk3IDE3LjQgNDEuODgwMzkxIDE4IDQxLjkwMDM5MSBDIDE4LjYgNDEuOTIwMzkxIDE5LjExMDg1OSA0MS40NDk2MDkgMTkuMTMwODU5IDQwLjg0OTYwOSBDIDE5LjE0MDg1OSA0MC4yNTk2MDkgMTkuMzAwNDY5IDM5Ljc0MDcwMyAxOS40ODA0NjkgMzkuMjIwNzAzIEMgMTkuNTcwNDY5IDM4Ljk3MDcwMyAxOS42ODA3ODEgMzguNzIwNDY5IDE5LjgwMDc4MSAzOC40ODA0NjkgQyAxOS44OTA3ODEgMzguMjIwNDY5IDIwLjEyOTkyMiAzOC4wMjkxNDEgMjAuNDE5OTIyIDM3Ljg2OTE0MSBDIDIwLjcwODc5NiAzNy43MjAwNDQgMjAuODM4NzM5IDM3LjUwOTIyNCAyMC45Njg3NSAzNy4yODcxMDkgQyAyMi4yMzA5OTEgMzcuNzM5NTU2IDIzLjU4NDMgMzggMjUgMzggQyAyNi40Mzk4NjcgMzggMjcuODE1Mjk4IDM3LjczMDk3OSAyOS4wOTU3MDMgMzcuMjYzNjcyIEMgMjkuMjMxMTM1IDM3LjQ5NDgxNSAyOS4zNzAzMjYgMzcuNzE0NTY0IDI5LjY2MDE1NiAzNy44NjkxNDEgQyAyOS45NTAxNTYgMzguMDM5MTQxIDMwLjE4OTI5NyAzOC4yMjA0NjkgMzAuMjc5Mjk3IDM4LjQ4MDQ2OSBDIDMwLjM5OTI5NyAzOC43MzA0NjkgMzAuNDk5ODQ0IDM4Ljk4MDQ2OSAzMC41ODk4NDQgMzkuMjMwNDY5IEMgMzAuNzY5ODQ0IDM5Ljc1MDQ2OSAzMC45MTk0NTMgNDAuMjY5Mzc1IDMwLjkzOTQ1MyA0MC44NTkzNzUgQyAzMC45Mzk0NTMgNDEuMTQ5Mzc1IDMxLjA1OTA2MiA0MS40MzA2MjUgMzEuMjg5MDYyIDQxLjY0MDYyNSBDIDMxLjczOTA2MiA0Mi4wNDA2MjUgMzIuNDIwMDc4IDQyLjAxMDMxMiAzMi44MzAwNzggNDEuNTcwMzEyIEMgMzMuMjMwMDc4IDQxLjEyMDMxMiAzMy4xOTk3NjYgNDAuNDM5Mjk3IDMyLjc1OTc2NiA0MC4wMjkyOTcgQyAzMi4zMTk3NjYgMzkuNjM5Mjk3IDMyLjAyIDM5LjE2OTIxOSAzMS43NSAzOC42OTkyMTkgQyAzMS42MiAzOC40NjkyMTkgMzEuNTAwNjI1IDM4LjIyMDQ2OSAzMS4zOTA2MjUgMzcuOTgwNDY5IEMgMzEuMjUwNjI1IDM3Ljc0MDQ2OSAzMS4yNjAwNzggMzcuNDM5Mzc1IDMxLjMzMDA3OCAzNy4xMDkzNzUgQyAzMS40MTAwNzggMzYuNzY5Mzc1IDMxLjMyMDIzNCAzNi41MTk3NjYgMzEuMjQwMjM0IDM2LjI1OTc2NiBMIDMxLjIzMjQyMiAzNi4yMzQzNzUgQyAzMy43MjU4NjMgMzQuNzEwMDUxIDM1LjYyNTI1MyAzMi4zMTE5MjYgMzYuNDg2MzI4IDI5LjQ1ODk4NCBMIDM2LjUxOTUzMSAyOS40NjA5MzggQyAzNi43OTk1MzEgMjkuNDgwOTM3IDM3LjA2OTE0MSAyOS41MDk4NDQgMzcuMzY5MTQxIDI5LjMzOTg0NCBDIDM3LjY2OTE0MSAyOS4xOTk4NDQgMzcuOTcwNDY5IDI5LjExOTIxOSAzOC4yMzA0NjkgMjkuMTk5MjE5IEMgMzguNDkwNDY5IDI5LjIzOTIxOSAzOC43NTk1MzEgMjkuMjk5MTQxIDM5LjAxOTUzMSAyOS4zNjkxNDEgQyAzOS41Mzk1MzEgMjkuNTE5MTQxIDQwLjA2MDc4MSAyOS42OTkyOTcgNDAuNTUwNzgxIDMwLjAyOTI5NyBDIDQwLjc5MDc4MSAzMC4xNzkyOTcgNDEuMDkwNjI1IDMwLjI0OTY4NyA0MS4zOTA2MjUgMzAuMTc5Njg4IEMgNDEuOTgwNjI1IDMwLjA0OTY4OCA0Mi4zNTA3MDMgMjkuNDcwNjI1IDQyLjIyMDcwMyAyOC44OTA2MjUgQyA0Mi4wOTA3MDMgMjguMzAwNjI1IDQxLjUwOTkyMiAyNy45MzA1NDcgNDAuOTE5OTIyIDI4LjA2MDU0NyBDIDQwLjMzOTkyMiAyOC4xOTA1NDcgMzkuOCAyOC4xNjkxNDEgMzkuMjUgMjguMTE5MTQxIEMgMzguOTggMjguMDg5MTQxIDM4LjcxOTIxOSAyOC4wNTAyMzQgMzguNDQ5MjE5IDI3Ljk5MDIzNCBDIDM4LjE3OTIxOSAyNy45NzAyMzQgMzcuOTQwOTM4IDI3Ljc5MDc4MSAzNy43MTA5MzggMjcuNTUwNzgxIEMgMzcuNDgwOTM4IDI3LjI4MDc4MSAzNy4yMjA5MzcgMjcuMjEwODU5IDM2Ljk2MDkzOCAyNy4xMzA4NTkgTCAzNi45NDMzNTkgMjcuMTI1IEMgMzYuOTc4MDcyIDI2Ljc1NDA3NSAzNyAyNi4zNzk4MjggMzcgMjYgQyAzNyAyMy41MjA3MTQgMzYuMjQzMDgzIDIxLjIxMzY3OSAzNC45NDkyMTkgMTkuMjk4ODI4IEMgMzUuMTM4ODggMTkuMDk5MjE5IDM1LjMzMDUxNSAxOC45MDk3MDcgMzUuNDAwMzkxIDE4LjU3MDMxMiBDIDM1LjQ5MDM5MSAxOC4yNTAzMTIgMzUuNjA5ODQ0IDE3Ljk3MDMxMiAzNS44Mzk4NDQgMTcuODIwMzEyIEMgMzYuMDM5ODQ0IDE3LjY0MDMxMyAzNi4yNjA0NjkgMTcuNDgwMzEyIDM2LjQ4MDQ2OSAxNy4zMjAzMTIgQyAzNi45MzA0NjkgMTcuMDIwMzEyIDM3LjQwMDkzNyAxNi43MzAzMTIgMzcuOTYwOTM4IDE2LjU3MDMxMiBDIDM4LjI0MDkzOCAxNi40OTAzMTMgMzguNDc5MTQxIDE2LjI5OTUzMSAzOC42MTkxNDEgMTYuMDE5NTMxIEMgMzguODk5MTQxIDE1LjQ4OTUzMSAzOC42OTAzOTEgMTQuODMwNTQ3IDM4LjE1MDM5MSAxNC41NjA1NDcgQyAzNy42MjAzOTEgMTQuMjgwNTQ3IDM2Ljk1OTQ1MyAxNC40ODkyOTcgMzYuNjg5NDUzIDE1LjAyOTI5NyBDIDM2LjQxOTQ1MyAxNS41NDkyOTcgMzYuMDQ5OTIyIDE1Ljk1OTg0NCAzNS42Njk5MjIgMTYuMzM5ODQ0IEMgMzUuNDY5OTIyIDE2LjUyOTg0NCAzNS4yNzA1NDcgMTYuNzEwODU5IDM1LjA2MDU0NyAxNi44ODA4NTkgQyAzNC44NzA1NDcgMTcuMDgwODU5IDM0LjU3MDIzNCAxNy4xNDAxNTYgMzQuMjQwMjM0IDE3LjE2MDE1NiBDIDMzLjg5MDIzNCAxNy4xNzAxNTYgMzMuNjY5NDUzIDE3LjMzMDQ2OSAzMy40Mzk0NTMgMTcuNDgwNDY5IEMgMzEuNTMyNTY2IDE1LjU5MTMzOCAyOC45OTc1MTUgMTQuMzM3MTI5IDI2LjE3OTY4OCAxNC4wNjA1NDcgQyAyNi4xNDk2ODcgMTMuNzkwNTQ3IDI2LjEyOTkyMiAxMy41MiAyNS45MTk5MjIgMTMuMjUgQyAyNS43MTk5MjIgMTIuOTggMjUuNTc5Mzc1IDEyLjcwOTQ1MyAyNS42MDkzNzUgMTIuNDM5NDUzIEMgMjUuNTk5Mzc1IDEyLjE2OTQ1MyAyNS42MTA4NTkgMTEuODk5MTQxIDI1LjYzMDg1OSAxMS42MTkxNDEgQyAyNS42OTA4NTkgMTEuMDc5MTQxIDI1Ljc3IDEwLjU0IDI2IDEwIEMgMjYuMTEgOS43NCAyNi4xMiA5LjQzMDYyNSAyNiA5LjE0MDYyNSBDIDI1LjgyIDguNzI4MTI1IDI1LjQxNTQ2OSA4LjQ4MzQzNzUgMjQuOTkyMTg4IDguNDg0Mzc1IHogTSAyMy41NTg1OTQgMTYuMTE1MjM0IEwgMjMuNTA5NzY2IDE2LjUgQyAyMy4zNjk3NjYgMTcuNTggMjMuMjY5OTIyIDE4LjY3IDIzLjE2OTkyMiAxOS43NSBDIDIzLjEwOTkyMiAyMC4zMiAyMy4wNTk1MzEgMjAuOTAwNzAzIDIzLjAxOTUzMSAyMS40NzA3MDMgQyAyMi41Mjk1MzEgMjEuMTIwNzAzIDIyLjAzOTUzMSAyMC43NDk5MjIgMjEuNTE5NTMxIDIwLjQxOTkyMiBDIDIwLjYxOTUzMSAxOS44MDk5MjIgMTkuNzE5MDYyIDE5LjE5OTE0MSAxOC43ODkwNjIgMTguNjE5MTQxIEwgMTguNDc0NjA5IDE4LjQyMzgyOCBDIDE5Ljg4MTA4NCAxNy4yMTE5MzUgMjEuNjI5MDQ5IDE2LjM5MzAzOSAyMy41NTg1OTQgMTYuMTE1MjM0IHogTSAyNi40NDE0MDYgMTYuMTE1MjM0IEMgMjguNDQ5OTUxIDE2LjQwNDQxMyAzMC4yNTg3ODggMTcuMjg0IDMxLjY5MzM1OSAxOC41NzgxMjUgTCAzMS4zNTkzNzUgMTguNzg5MDYyIEMgMzAuNDM5Mzc1IDE5LjM3OTA2MiAyOS41NTAzOTEgMTkuOTg5NjA5IDI4LjY1MDM5MSAyMC41OTk2MDkgQyAyOC4yOTAzOTEgMjAuODM5NjA5IDI3LjkzOTYwOSAyMS4wODk4NDQgMjcuNTk5NjA5IDIxLjMzOTg0NCBDIDI3LjMyOTYwOSAyMS41Mjk4NDQgMjYuOTU5NDUzIDIxLjM1OTI5NyAyNi45Mzk0NTMgMjEuMDI5Mjk3IEMgMjYuOTA5NDUzIDIwLjU5OTI5NyAyNi44NzAwNzggMjAuMTggMjYuODMwMDc4IDE5Ljc1IEMgMjYuNzMwMDc4IDE4LjY3IDI2LjYzMDIzNCAxNy41OCAyNi40OTAyMzQgMTYuNSBMIDI2LjQ0MTQwNiAxNi4xMTUyMzQgeiBNIDE2LjU4MjAzMSAyMC42MDc0MjIgTCAxNi45MDAzOTEgMjAuOTM5NDUzIEMgMTcuNjYwMzkxIDIxLjcyOTQ1MyAxOC40MzA5MzcgMjIuNDg5NzY2IDE5LjIxMDkzOCAyMy4yNTk3NjYgQyAxOS41NDA5MzcgMjMuNTg5NzY2IDE5Ljg3MDkzNyAyMy45MDA5MzcgMjAuMjEwOTM4IDI0LjIxMDkzOCBDIDIwLjQ1MDkzNyAyNC40MzA5MzcgMjAuMzYwNzgxIDI0LjgyMDE1NiAyMC4wNTA3ODEgMjQuOTEwMTU2IEMgMTkuNTYwNzgxIDI1LjA2MDE1NiAxOS4wNzAwNzggMjUuMTk5Mzc1IDE4LjU4MDA3OCAyNS4zNTkzNzUgQyAxNy41NTAwNzggMjUuNjk5Mzc1IDE2LjUxMDQ2OSAyNi4wMjA2MjUgMTUuNDgwNDY5IDI2LjM5MDYyNSBMIDE1LjAyNzM0NCAyNi41NDg4MjggQyAxNS4wMTc0MzkgMjYuMzY1ODU1IDE1IDI2LjE4NTUwNCAxNSAyNiBDIDE1IDI0LjAwOTcwNyAxNS41ODUwOTIgMjIuMTYzMjI0IDE2LjU4MjAzMSAyMC42MDc0MjIgeiBNIDMzLjUzNzEwOSAyMC44MDQ2ODggQyAzNC40NTg5NTUgMjIuMzE5MTc5IDM1IDI0LjA5MjQgMzUgMjYgQyAzNSAyNi4xNjcwMzIgMzQuOTgyNjUgMjYuMzI5MTUgMzQuOTc0NjA5IDI2LjQ5NDE0MSBMIDM0LjYxOTE0MSAyNi4zODA4NTkgQyAzMy41NzkxNDEgMjYuMDQwODU5IDMyLjU0MDIzNCAyNS43NDkyMTkgMzEuNDkwMjM0IDI1LjQ0OTIxOSBDIDMwLjgxMDIzNCAyNS4yNDkyMTkgMzAuMTI5MjE5IDI1LjA3MDM5MSAyOS40NDkyMTkgMjQuOTAwMzkxIEMgMjkuOTU5MjE5IDI0LjQxMDM5MSAzMC40OTA0NjkgMjMuOTI5Njg3IDMwLjk4MDQ2OSAyMy40Mjk2ODggQyAzMS43NTA0NjkgMjIuNjU5Njg4IDMyLjUxOTUzMSAyMS44ODk4NDQgMzMuMjY5NTMxIDIxLjA4OTg0NCBMIDMzLjUzNzEwOSAyMC44MDQ2ODggeiBNIDI0LjM4MDg1OSAyNCBMIDI1LjU5OTYwOSAyNCBDIDI1Ljc4OTYwOSAyNCAyNS45NzAzMTMgMjQuMDkwNDY5IDI2LjA3MDMxMiAyNC4yMzA0NjkgTCAyNi44NDk2MDkgMjUuMjEwOTM4IEMgMjYuOTU5NjA5IDI1LjM0MDkzNyAyNy4wMDA3MDMgMjUuNTI5MjE5IDI2Ljk3MDcwMyAyNS42OTkyMTkgTCAyNi42ODk0NTMgMjYuOTEwMTU2IEMgMjYuNjU5NDUzIDI3LjEwMDE1NiAyNi41MjkxNDEgMjcuMjQ5ODQ0IDI2LjM2OTE0MSAyNy4zMzk4NDQgTCAyNS4yNSAyNy44NTkzNzUgQyAyNS4wOSAyNy45NDkzNzUgMjQuODkwNDY5IDI3Ljk0OTM3NSAyNC43MzA0NjkgMjcuODU5Mzc1IEwgMjMuNjA5Mzc1IDI3LjMzOTg0NCBDIDIzLjQ0OTM3NSAyNy4yNDk4NDQgMjMuMzA5MDYyIDI3LjEwMDE1NiAyMy4yODkwNjIgMjYuOTEwMTU2IEwgMjMuMDA5NzY2IDI1LjY5OTIxOSBDIDIyLjk3OTc2NiAyNS41MjkyMTkgMjMuMDIwODU5IDI1LjM0MDkzOCAyMy4xMzA4NTkgMjUuMjEwOTM4IEwgMjMuOTEwMTU2IDI0LjIzMDQ2OSBDIDI0LjAxMDE1NiAyNC4wOTA0NjkgMjQuMTkwODU5IDI0IDI0LjM4MDg1OSAyNCB6IE0gMjAuNzY5NTMxIDI4Ljc2OTUzMSBDIDIxLjA3OTUzMSAyOC43MTk1MzEgMjEuMzMwOTM4IDI5LjAzMDMxMiAyMS4yMTA5MzggMjkuMzIwMzEyIEMgMjEuMDIwOTM3IDI5LjgyMDMxMiAyMC44Mzk5MjIgMzAuMzEwNTQ3IDIwLjY2OTkyMiAzMC44MTA1NDcgQyAyMC4yOTk5MjIgMzEuODQwNTQ3IDE5LjkzOTYwOSAzMi44NjAzOTEgMTkuNTk5NjA5IDMzLjkwMDM5MSBMIDE5LjQ2Mjg5MSAzNC4zMzAwNzggQyAxNy42ODMwOTUgMzMuMTQ2NjQ3IDE2LjMxNjEyIDMxLjQwNTI1NCAxNS41ODc4OTEgMjkuMzU1NDY5IEwgMTYuMTE5MTQxIDI5LjMxMDU0NyBDIDE3LjIwOTE0MSAyOS4yMTA1NDcgMTguMjc5MTQxIDI5LjA3OTIxOSAxOS4zNjkxNDEgMjguOTQ5MjE5IEMgMTkuODM5MTQxIDI4Ljg5OTIxOSAyMC4yOTk1MzEgMjguODI5NTMxIDIwLjc2OTUzMSAyOC43Njk1MzEgeiBNIDI5LjQxMDE1NiAyOC45MTAxNTYgQyAyOS44ODAxNTYgMjguOTYwMTU2IDMwLjM0MDU0NyAyOS4wMTA3ODEgMzAuODEwNTQ3IDI5LjA1MDc4MSBDIDMxLjkwMDU0NyAyOS4xNTA3ODEgMzIuOTgwMzEyIDI5LjI1MDMxMiAzNC4wNzAzMTIgMjkuMzIwMzEyIEwgMzQuNDE3OTY5IDI5LjMzOTg0NCBDIDMzLjcwMjg2MiAzMS4zNjM0OTQgMzIuMzY1OTMgMzMuMDg4NDM3IDMwLjYyMzA0NyAzNC4yNzM0MzggTCAzMC41MDk3NjYgMzMuOTEwMTU2IEMgMzAuMTc5NzY2IDMyLjg3MDE1NiAyOS44MjA3MDMgMzEuODQwMzEyIDI5LjQ3MDcwMyAzMC44MjAzMTIgQyAyOS4zMTA3MDMgMzAuMzYwMzEyIDI5LjE1MDQ2OSAyOS45MTA5MzggMjguOTgwNDY5IDI5LjQ2MDkzOCBDIDI4Ljg3MDQ2OSAyOS4xNzA5MzggMjkuMTEwMTU2IDI4Ljg3MDE1NiAyOS40MTAxNTYgMjguOTEwMTU2IHogTSAyNS4wNzQyMTkgMzAuODgyODEyIEMgMjUuMjE2NzE5IDMwLjg4MjgxMiAyNS4zNTk0NTMgMzAuOTU0NjA5IDI1LjQzOTQ1MyAzMS4wOTk2MDkgQyAyNS42NTk0NTMgMzEuNTE5NjA5IDI1Ljg5MDg1OSAzMS45Mjk4NDQgMjYuMTMwODU5IDMyLjMzOTg0NCBDIDI2LjY3MDg1OSAzMy4yNzk4NDQgMjcuMjA5MDYzIDM0LjIzMDM5MSAyNy43ODkwNjIgMzUuMTUwMzkxIEwgMjguMDI1MzkxIDM1LjUzMzIwMyBDIDI3LjA3MTI1MiAzNS44MzQ0MyAyNi4wNTU0NzEgMzYgMjUgMzYgQyAyMy45NzYzMTIgMzYgMjIuOTg5NTgxIDM1Ljg0NDU3MiAyMi4wNjA1NDcgMzUuNTYwNTQ3IEwgMjIuMzEwNTQ3IDM1LjE2MDE1NiBDIDIyLjg5MDU0NyAzNC4yNDAxNTYgMjMuNDQwMjM0IDMzLjI5OTM3NSAyMy45OTAyMzQgMzIuMzU5Mzc1IEMgMjQuMjQwMjM0IDMxLjk0OTM3NSAyNC40ODA5MzcgMzEuNTI5NjA5IDI0LjcxMDkzOCAzMS4wOTk2MDkgQyAyNC43OTA5MzcgMzAuOTU0NjA5IDI0LjkzMTcxOSAzMC44ODI4MTIgMjUuMDc0MjE5IDMwLjg4MjgxMiB6Ii8+PC9zdmc+',
            },
        ];

        const scriptsObj =
            this.props.scripts &&
            this.props.scripts.length > 0 &&
            this.props.scripts.map(script => {
                return {
                    value: script._id,
                    label: script.name,
                };
            });

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
                                                <div className="bs-ContentSection-content Box-root  Flex-flex Flex-alignItems--center Padding-horizontal--29 Padding-vertical--16">
                                                    <label className="bs-Fieldset-label" />
                                                    <div className="Box-root">
                                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                Basic
                                                                Configuration
                                                            </span>
                                                        </span>
                                                        <p>
                                                            <span>
                                                                Basic
                                                                Configuration
                                                                for your new
                                                                Monitor.
                                                            </span>
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="nm-Fieldset-row">
                                                    <label className="bs-Fieldset-label" />
                                                    <label className="new-monitor-label">
                                                        Monitor Name
                                                    </label>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label" />
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
                                                    if={!this.props.edit}
                                                >
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{
                                                            marginTop: '30px',
                                                        }}
                                                    >
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            What would you like
                                                            to monitor?
                                                        </label>
                                                    </div>
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{
                                                            marginBottom:
                                                                '30px',
                                                        }}
                                                    >
                                                        <label className="bs-Fieldset-label" />

                                                        <div className="radio-field">
                                                            <span className="flex">
                                                                <div className="monitor-type-grid">
                                                                    {monitorTypesOptions
                                                                        .slice(
                                                                            0,
                                                                            this
                                                                                .state
                                                                                .showAllMonitors
                                                                                ? monitorTypesOptions.length
                                                                                : 4
                                                                        )
                                                                        .map(
                                                                            el => (
                                                                                <label
                                                                                    key={
                                                                                        el.value
                                                                                    }
                                                                                    htmlFor={`type_${el.value}`}
                                                                                    style={{
                                                                                        cursor:
                                                                                            'pointer',
                                                                                    }}
                                                                                >
                                                                                    <div
                                                                                        className={`radio-field monitor-type-item Box-background--white`}
                                                                                        style={{
                                                                                            border: `1px solid ${
                                                                                                this
                                                                                                    .props
                                                                                                    .type ===
                                                                                                el.value
                                                                                                    ? 'black'
                                                                                                    : 'rgba(0,0,0,0.2)'
                                                                                            }`,
                                                                                        }}
                                                                                    >
                                                                                        <div className="radioButtonStyle">
                                                                                            <Field
                                                                                                required={
                                                                                                    true
                                                                                                }
                                                                                                component="input"
                                                                                                type="radio"
                                                                                                data-testId={`type_${el.value}`}
                                                                                                id={`type_${el.value}`}
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
                                                                                                    );
                                                                                                }}
                                                                                                value={
                                                                                                    el.value
                                                                                                }
                                                                                            />
                                                                                        </div>
                                                                                        <span className="imageAndLabel">
                                                                                            <img
                                                                                                alt=""
                                                                                                src={
                                                                                                    el.icon
                                                                                                }
                                                                                                style={{
                                                                                                    width:
                                                                                                        '10%',
                                                                                                    height:
                                                                                                        '100%',
                                                                                                    marginRight:
                                                                                                        '5%',
                                                                                                }}
                                                                                            />
                                                                                            <span
                                                                                                className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                                                                style={{
                                                                                                    marginRight:
                                                                                                        '5%',
                                                                                                    minWidth:
                                                                                                        '68px',
                                                                                                }}
                                                                                            >
                                                                                                {
                                                                                                    el.label
                                                                                                }
                                                                                            </span>
                                                                                            {
                                                                                                el.description
                                                                                            }
                                                                                        </span>
                                                                                    </div>
                                                                                </label>
                                                                            )
                                                                        )}
                                                                    {this.state
                                                                        .showAllMonitors ? null : (
                                                                        <div className="bs-Fieldset-fields">
                                                                            <button
                                                                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--moreMonitorTypes"
                                                                                type="button"
                                                                                data-testId="show_all_monitors"
                                                                                id="showMoreMonitors"
                                                                                onClick={() => {
                                                                                    this.setState(
                                                                                        {
                                                                                            showAllMonitors: true,
                                                                                        }
                                                                                    );
                                                                                }}
                                                                            >
                                                                                <span>
                                                                                    Show
                                                                                    more
                                                                                    monitor
                                                                                    types
                                                                                </span>
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
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
                                                    {this.renderMonitorConfiguration(
                                                        'Server'
                                                    )}
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            Mode
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
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
                                                                                'Agentless (with SSH)',
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
                                                        <div className="nm-Fieldset-row">
                                                            <label className="bs-Fieldset-label" />
                                                            <label className="new-monitor-label">
                                                                Host
                                                            </label>
                                                        </div>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label" />
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

                                                        <div className="nm-Fieldset-row">
                                                            <label className="bs-Fieldset-label" />
                                                            <label className="new-monitor-label">
                                                                Port
                                                            </label>
                                                        </div>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label" />
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

                                                        <div className="nm-Fieldset-row">
                                                            <label className="bs-Fieldset-label" />
                                                            <label className="new-monitor-label">
                                                                Username
                                                            </label>
                                                        </div>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label" />
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

                                                        <div className="nm-Fieldset-row">
                                                            <label className="bs-Fieldset-label" />
                                                            <label className="new-monitor-label">
                                                                Authentication
                                                                Method
                                                            </label>
                                                        </div>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label" />

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
                                                            <div className="nm-Fieldset-row">
                                                                <label className="bs-Fieldset-label" />
                                                                <label className="new-monitor-label">
                                                                    Password
                                                                </label>
                                                            </div>
                                                            <div className="bs-Fieldset-row">
                                                                <label className="bs-Fieldset-label" />
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
                                                            <div className="nm-Fieldset-row">
                                                                <label className="bs-Fieldset-label" />
                                                                <label className="new-monitor-label">
                                                                    Identity
                                                                    File
                                                                </label>
                                                            </div>
                                                            <div className="bs-Fieldset-row">
                                                                <label className="bs-Fieldset-label" />
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
                                                                                        disabled={
                                                                                            uploadingIdentityFile
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
                                                                                    disabled={
                                                                                        uploadingIdentityFile
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
                                                    if={type === 'kubernetes'}
                                                >
                                                    {this.renderMonitorConfiguration(
                                                        'Kubernetes'
                                                    )}
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            Kubernetes Namespace
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="text"
                                                                name={`kubernetesNamespace_${this.props.index}`}
                                                                id="kubernetesNamespace"
                                                                placeholder="default"
                                                                disabled={
                                                                    requesting
                                                                }
                                                                validate={[
                                                                    ValidateField.required,
                                                                ]}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            Configuration File
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
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
                                                                                !configurationFile
                                                                            }
                                                                        >
                                                                            <span className="bs-Button--icon bs-Button--new"></span>
                                                                            <span>
                                                                                Upload
                                                                                Configuration
                                                                                File
                                                                            </span>
                                                                        </ShouldRender>
                                                                        <ShouldRender
                                                                            if={
                                                                                configurationFile
                                                                            }
                                                                        >
                                                                            <span className="bs-Button--icon bs-Button--edit"></span>
                                                                            <span>
                                                                                Change
                                                                                Configuration
                                                                                File
                                                                            </span>
                                                                        </ShouldRender>
                                                                        <div className="bs-FileUploadButton-inputWrap">
                                                                            <Field
                                                                                className="bs-FileUploadButton-input"
                                                                                component={
                                                                                    UploadFile
                                                                                }
                                                                                name={`configurationFile_${this.props.index}`}
                                                                                id="configurationFile"
                                                                                accept="config"
                                                                                onChange={
                                                                                    this
                                                                                        .changeConfigFile
                                                                                }
                                                                                disabled={
                                                                                    uploadingConfigurationFile
                                                                                }
                                                                                fileInputKey={
                                                                                    configFileInputKey
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </label>
                                                                </div>
                                                                <ShouldRender
                                                                    if={
                                                                        configurationFile
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
                                                                                    .removeConfigFile
                                                                            }
                                                                            disabled={
                                                                                uploadingConfigurationFile
                                                                            }
                                                                            style={{
                                                                                margin:
                                                                                    '10px 10px 0 0',
                                                                            }}
                                                                        >
                                                                            <span className="bs-Button--icon bs-Button--delete"></span>
                                                                            <span>
                                                                                Remove
                                                                                Configuration
                                                                                File
                                                                            </span>
                                                                        </button>
                                                                    </div>
                                                                </ShouldRender>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={type === 'api'}
                                                >
                                                    {this.renderMonitorConfiguration(
                                                        'API'
                                                    )}
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            HTTP Method
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
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
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            URL
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
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
                                                    if={type === 'url'}
                                                >
                                                    {this.renderMonitorConfiguration(
                                                        'Website'
                                                    )}
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            URL
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
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
                                                    if={type === 'ip'}
                                                >
                                                    {this.renderMonitorConfiguration(
                                                        'IP Monitor'
                                                    )}
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            IP Address
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                name={`ip_${this.props.index}`}
                                                                id="IPAddress"
                                                                placeholder="192.168.1.1"
                                                                disabled={
                                                                    requesting
                                                                }
                                                                validate={
                                                                    ValidateField.required
                                                                }
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
                                                    {this.renderMonitorConfiguration(
                                                        'Incoming HTTP Request'
                                                    )}
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            Incoming URL
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
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
                                                    {this.renderMonitorConfiguration(
                                                        'Manual'
                                                    )}
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            Description
                                                            (optional)
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
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
                                                <ShouldRender
                                                    if={type === 'script'}
                                                >
                                                    {this.renderMonitorConfiguration(
                                                        'Script'
                                                    )}
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            Script
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
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
                                                                        defaultValue={
                                                                            defaultScript
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
                                                                        fontSize="14px"
                                                                        onLoad={editor => {
                                                                            // give the inner text area a name
                                                                            // so that we can reference it later
                                                                            const elem = editor.textInput.getElement();
                                                                            elem.name = `script_editor_${this.props.index}`;
                                                                        }}
                                                                        wrapEnabled={
                                                                            true
                                                                        }
                                                                    />
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        false &&
                                                        resourceCategoryList &&
                                                        resourceCategoryList.length >
                                                            0
                                                    }
                                                >
                                                    <div className="bs-ContentSection-content Box-root  Flex-flex Flex-alignItems--center Padding-horizontal--29 Padding-vertical--16">
                                                        <label className="bs-Fieldset-label" />
                                                        <div className="Box-root">
                                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Resource
                                                                    Category
                                                                </span>
                                                            </span>
                                                            <p>
                                                                <span>
                                                                    Resource
                                                                    Category
                                                                    lets you
                                                                    categorize
                                                                    monitors on
                                                                    your status
                                                                    page.
                                                                </span>
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            Resource Category
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
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
                                                    if={
                                                        schedules &&
                                                        schedules.length > 0
                                                    }
                                                >
                                                    <div className="bs-ContentSection-content Box-root  Flex-flex Flex-alignItems--center Padding-horizontal--29 Padding-vertical--16">
                                                        <label className="bs-Fieldset-label" />
                                                        <div className="Box-root">
                                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Call Duties
                                                                </span>
                                                            </span>
                                                            <p className="Flex-flex Flex-alignItems--center">
                                                                <span>
                                                                    Set the
                                                                    configuration
                                                                    for your
                                                                    Monitor&apos;s
                                                                    Call duties.
                                                                </span>

                                                                <Tooltip title="Call Schedule">
                                                                    <div>
                                                                        <p>
                                                                            Call
                                                                            Schedules
                                                                            let&apos;s
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
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label"></label>
                                                        <div className="bs-Fieldset-fields">
                                                            <span className="flex">
                                                                <FieldArray
                                                                    className="db-select-nw"
                                                                    component={
                                                                        ScheduleInput
                                                                    }
                                                                    name={`callSchedules_${this.props.index}`}
                                                                    id={`callSchedules_${this.props.index}`}
                                                                    placeholder="Call Duty"
                                                                    disabled={
                                                                        requesting
                                                                    }
                                                                    style={{
                                                                        height:
                                                                            '28px',
                                                                    }}
                                                                    schedules={
                                                                        this
                                                                            .props
                                                                            .schedules
                                                                    }
                                                                    currentProject={
                                                                        this
                                                                            .props
                                                                            .currentProject
                                                                    }
                                                                />
                                                            </span>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        this.props.monitorSlas
                                                            .length > 0 ||
                                                        this.props.incidentSlas
                                                            .length > 0
                                                    }
                                                >
                                                    <div className="bs-ContentSection-content Box-root  Flex-flex Flex-alignItems--center Padding-horizontal--29 Padding-vertical--16">
                                                        <label className="bs-Fieldset-label" />
                                                        <div className="Box-root">
                                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Service
                                                                    Level
                                                                    Agreement
                                                                </span>
                                                            </span>
                                                            <p>
                                                                <span>
                                                                    Select the
                                                                    SLAs for
                                                                    your new
                                                                    monitor.
                                                                </span>
                                                            </p>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        this.props.monitorSlas
                                                            .length > 0
                                                    }
                                                >
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            Monitor SLA
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />

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
                                                    <div className="nm-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />
                                                        <label className="new-monitor-label">
                                                            Incident
                                                            Communication SLA
                                                        </label>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label" />

                                                        <div className="bs-Fieldset-fields">
                                                            <span className="flex">
                                                                {this.props
                                                                    .edit ? (
                                                                    <Field
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
                                                                            ...this.props.incidentSlas.map(
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
                                                                    />
                                                                )}

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
                                                                'incomingHttpRequest' ||
                                                            type ===
                                                                'kubernetes' ||
                                                            type === 'ip') &&
                                                        !this.state.advance
                                                    }
                                                >
                                                    <div className="bs-ContentSection-content Box-root  Flex-flex Flex-alignItems--center Padding-horizontal--29 Padding-vertical--16">
                                                        <label className="bs-Fieldset-label" />
                                                        <div className="Box-root">
                                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Advanced
                                                                </span>
                                                            </span>
                                                            <p>
                                                                <span>
                                                                    Advanced
                                                                    Configuration
                                                                    settings for
                                                                    your new
                                                                    monitor.
                                                                </span>
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label"></label>
                                                        <div className="bs-Fieldset-fields">
                                                            <button
                                                                id="advanceOptions"
                                                                type="button"
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
                                                                'incomingHttpRequest' ||
                                                            type ===
                                                                'kubernetes' ||
                                                            type === 'ip')
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

                                                    {Object.values(
                                                        CRITERIA_TYPES
                                                    ).map(criterionType => {
                                                        const criteria = [
                                                            ...this.state.criteria.filter(
                                                                criterion => {
                                                                    if (
                                                                        criterionType.type ===
                                                                            criterion.type &&
                                                                        type ===
                                                                            'ip' &&
                                                                        criterionType.type ===
                                                                            'degraded'
                                                                    )
                                                                        return false;
                                                                    else {
                                                                        return (
                                                                            criterionType.type ===
                                                                            criterion.type
                                                                        );
                                                                    }
                                                                }
                                                            ),
                                                        ];
                                                        return (
                                                            <div
                                                                key={
                                                                    criterionType.type
                                                                }
                                                            >
                                                                {[
                                                                    criteria.map(
                                                                        (
                                                                            criterion,
                                                                            index
                                                                        ) => {
                                                                            return (
                                                                                <ResponseComponent
                                                                                    key={
                                                                                        index
                                                                                    }
                                                                                    type={
                                                                                        this
                                                                                            .state
                                                                                            .type
                                                                                    }
                                                                                    addCriterion={data =>
                                                                                        this.addCriterion(
                                                                                            data
                                                                                        )
                                                                                    }
                                                                                    removeCriterion={id =>
                                                                                        this.removeCriterion(
                                                                                            id
                                                                                        )
                                                                                    }
                                                                                    criterion={
                                                                                        criterion
                                                                                    }
                                                                                    schedules={
                                                                                        this
                                                                                            .props
                                                                                            .schedules
                                                                                    }
                                                                                    edit={
                                                                                        this
                                                                                            .props
                                                                                            .edit
                                                                                    }
                                                                                    scriptsObj={
                                                                                        scriptsObj
                                                                                    }
                                                                                />
                                                                            );
                                                                        }
                                                                    ),
                                                                ]}

                                                                {criteria.length ===
                                                                    0 && (
                                                                    <div>
                                                                        <div
                                                                            className="bs-ContentSection Card-root Card-shadow--clear Padding-all--16 Margin-vertical--16"
                                                                            style={{
                                                                                borderRadius:
                                                                                    '0',
                                                                                boxShadow:
                                                                                    'none',
                                                                                display:
                                                                                    'flex',
                                                                                justifyContent:
                                                                                    'space-between',
                                                                                alignContent:
                                                                                    'center',
                                                                            }}
                                                                        >
                                                                            <div className="Margin-bottom--16">
                                                                                <span
                                                                                    style={{
                                                                                        display:
                                                                                            'inline-block',
                                                                                        borderRadius:
                                                                                            '2px',
                                                                                        height:
                                                                                            '8px',
                                                                                        width:
                                                                                            '8px',
                                                                                        margin:
                                                                                            '0 8px 1px 0',
                                                                                        backgroundColor:
                                                                                            criterionType.type ===
                                                                                            'up'
                                                                                                ? 'rgb(117, 211, 128)'
                                                                                                : 'rgb(255, 222, 36)',
                                                                                    }}
                                                                                ></span>
                                                                                <span className="Text-fontSize--16 Text-fontWeight--medium">
                                                                                    Monitor{' '}
                                                                                    {`${criterionType.type
                                                                                        .charAt(
                                                                                            0
                                                                                        )
                                                                                        .toUpperCase() +
                                                                                        criterionType.type.slice(
                                                                                            1
                                                                                        )}`}{' '}
                                                                                    Criteria
                                                                                </span>
                                                                                <p>
                                                                                    <span className="Margin-left--16">
                                                                                        This
                                                                                        is
                                                                                        where
                                                                                        you
                                                                                        describe
                                                                                        when
                                                                                        your
                                                                                        monitor
                                                                                        is
                                                                                        considered
                                                                                        {` ${criterionType.type.toLowerCase()}`}
                                                                                    </span>
                                                                                </p>
                                                                            </div>
                                                                            <button
                                                                                className="Button bs-ButtonLegacy ActionIconParent Margin-top--8"
                                                                                id="Add-Criteria-Button"
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    this.addCriterion(
                                                                                        {
                                                                                            type:
                                                                                                criterionType.type,
                                                                                            id: uuidv4(),
                                                                                        }
                                                                                    );
                                                                                }}
                                                                            >
                                                                                <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                                                    <span>
                                                                                        {`Add ${criterionType.type[0].toUpperCase()}${criterionType.type
                                                                                            .substr(
                                                                                                1
                                                                                            )
                                                                                            .toLocaleLowerCase()} Criteria`}
                                                                                    </span>
                                                                                </span>
                                                                            </button>
                                                                        </div>
                                                                        <div className="bs-ContentSection-content Box-root Box-background--offset  Padding-horizontal--8 Padding-vertical--16">
                                                                            <p className="Flex-flex Flex-justifyContent--center Text-fontSize--15">
                                                                                You
                                                                                do
                                                                                not
                                                                                have
                                                                                any
                                                                                Monitor{' '}
                                                                                {`${criterionType.type
                                                                                    .charAt(
                                                                                        0
                                                                                    )
                                                                                    .toUpperCase() +
                                                                                    criterionType.type.slice(
                                                                                        1
                                                                                    )}`}{' '}
                                                                                Criteria,
                                                                                feel
                                                                                free
                                                                                to
                                                                                add
                                                                                one
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
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
                                        if={
                                            !requesting &&
                                            this.props.edit &&
                                            !this.state.processingMonitor
                                        }
                                    >
                                        <button
                                            className="bs-Button"
                                            disabled={requesting}
                                            onClick={this.cancelEdit}
                                            type="button"
                                        >
                                            <span>Cancel</span>
                                        </button>
                                    </ShouldRender>
                                    <ShouldRender
                                        if={
                                            !requesting &&
                                            this.props.toggleForm &&
                                            this.props.showCancelBtn &&
                                            !this.state.processingMonitor
                                        }
                                    >
                                        <button
                                            className="bs-Button"
                                            disabled={requesting}
                                            onClick={this.props.toggleForm}
                                            type="button"
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
                                                    !requesting &&
                                                    !this.state
                                                        .processingMonitor
                                                }
                                            >
                                                <span>Add Monitor</span>
                                            </ShouldRender>
                                        </PricingPlan>
                                        <ShouldRender
                                            if={
                                                this.props.edit &&
                                                !requesting &&
                                                !this.state.processingMonitor
                                            }
                                        >
                                            <span>Edit Monitor </span>
                                        </ShouldRender>

                                        <ShouldRender
                                            if={
                                                requesting ||
                                                this.state.processingMonitor
                                            }
                                        >
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
            change,
            uploadConfigurationFile,
            logConfigFile,
            setConfigInputKey,
            resetConfigFile,
            fetchAutomatedScript,
        },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const name = selector(state, 'name_1000');
    const type = selector(state, 'type_1000');
    const mode = selector(state, 'mode_1000');
    const authentication = selector(state, 'authentication_1000');
    const category = selector(state, 'resourceCategory_1000');
    const monitorSchedules = selector(state, 'callSchedules_1000');
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

    const currentPlanId =
        state.project &&
        state.project.currentProject &&
        state.project.currentProject.stripePlanId
            ? state.project.currentProject.stripePlanId
            : '';

    if (ownProps.edit) {
        const { monitorSlug } = ownProps.match.params;
        const monitorCollection = state.monitor.monitorsList.monitors.find(
            el => {
                return projectId === el._id;
            }
        );
        const currentMonitor =
            monitorCollection &&
            monitorCollection.monitors.find(el => {
                return el.slug === monitorSlug;
            });
        const monitorId = currentMonitor && currentMonitor._id;
        return {
            monitor: state.monitor,
            currentProject: state.project.currentProject,
            name,
            type,
            mode,
            authentication,
            category,
            identityFile: state.monitor.file,
            uploadingIdentityFile: state.monitor.uploadFileRequest,
            monitorSchedules,
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
            fetchMonitorSlaError: state.monitorSla.monitorSlas.error,
            isValid: isValid('NewMonitor')(state),
            configurationFile: state.monitor.configFile,
            uploadingConfigurationFile: state.monitor.uploadConfigRequest,
            configFileInputKey: state.monitor.configFileInputKey,
            scripts: state.automatedScripts.fetchScripts.scripts,
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
            uploadingIdentityFile: state.monitor.uploadFileRequest,
            monitorSchedules,
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
            fetchMonitorSlaError: state.monitorSla.monitorSlas.error,
            isValid: isValid('NewMonitor')(state),
            configurationFile: state.monitor.configFile,
            uploadingConfigurationFile: state.monitor.uploadConfigRequest,
            configFileInputKey: state.monitor.configFileInputKey,
            scripts: state.automatedScripts.fetchScripts.scripts,
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
    component: PropTypes.object,
    edit: PropTypes.bool,
    name: PropTypes.string,
    type: PropTypes.string,
    mode: PropTypes.string,
    authentication: PropTypes.string,
    category: PropTypes.string,
    subProject: PropTypes.string,
    monitorSchedules: PropTypes.array,
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
    componentSlug: PropTypes.string,
    subProjects: PropTypes.array,
    toggleEdit: PropTypes.func,
    logFile: PropTypes.func,
    resetFile: PropTypes.func,
    identityFile: PropTypes.string,
    configurationFile: PropTypes.string,
    uploadingIdentityFile: PropTypes.bool,
    uploadingConfigurationFile: PropTypes.bool,
    setFileInputKey: PropTypes.func,
    fileInputKey: PropTypes.string,
    uploadIdentityFile: PropTypes.func,
    fetchCommunicationSlas: PropTypes.func,
    incidentSlas: PropTypes.array,
    requestingSla: PropTypes.bool,
    fetchMonitorSlas: PropTypes.func,
    monitorSlas: PropTypes.array,
    requestingMonitorSla: PropTypes.bool,
    change: PropTypes.func,
    initialValues: PropTypes.objectOf(PropTypes.any),
    currentMonitorCriteria: PropTypes.arrayOf(
        PropTypes.objectOf(PropTypes.any)
    ),
    uploadConfigurationFile: PropTypes.func,
    logConfigFile: PropTypes.func,
    setConfigInputKey: PropTypes.func,
    resetConfigFile: PropTypes.func,
    configFileInputKey: PropTypes.string,
    fetchAutomatedScript: PropTypes.func,
    scripts: PropTypes.array,
    showCancelBtn: PropTypes.bool,
    toggleForm: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(NewMonitorForm);
