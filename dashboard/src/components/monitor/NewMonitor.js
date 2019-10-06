import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import { reduxForm, Field, formValueSelector } from 'redux-form';
import { createMonitor, createMonitorSuccess, createMonitorFailure, resetCreateMonitor, editMonitor, editMonitorSwitch, addSeat } from '../../actions/monitor';
import { RenderField } from '../basic/RenderField';
import { makeCriteria } from '../../config';
import { FormLoader } from '../basic/Loader';
import AddSeats from '../modals/AddSeats';
import { openModal, closeModal } from '../../actions/modal';
import { fetchMonitorsIncidents, fetchMonitorsSubscribers } from '../../actions/monitor';
//import { showUpgradeForm } from '../../actions/project';
import ShouldRender from '../basic/ShouldRender';
import SubProjectSelector from '../basic/SubProjectSelector';
import { fetchSchedules, scheduleSuccess } from '../../actions/schedule';
import ApiAdvance from './ApiAdvance';
import ResponseComponent from './ResponseComponent';
import { User } from '../../config';
import { ValidateField } from '../../config';
import { RenderSelect } from '../basic/RenderSelect';
import AceEditor from 'react-ace';
import 'brace/mode/javascript';
import 'brace/theme/github';

const selector = formValueSelector('NewMonitor');

class NewMonitor extends Component {

    constructor(props) {
        super(props);
        this.state = {
            upgradeModalId: uuid.v4(),
            advance: false,
            script: '',
            type: props.edit ? props.editMonitorProp.type : props.type
        }
    }

    componentDidMount() {
        const userId = User.getUserId();
        const projectMember = this.props.currentProject.users.find(user => user.userId === userId);
        //load call schedules
        if (projectMember) this.props.fetchSchedules(this.props.currentProject._id);
    }

    //Client side validation
    validate = (values) => {
        const errors = {};
        if (!ValidateField.text(values[`name_${this.props.index}`])) {
            errors.name = 'Name is required.'
        }
        if (values[`type_${this.props.index}`] === 'url') {
            if (!ValidateField.text(values[`url_${this.props.index}`])) {
                errors.url = 'URL is required.'
            } else if (!ValidateField.url(values[`url_${this.props.index}`])) {
                errors.url = 'URL is invalid.'
            }
        }


        if (values[`type_${this.props.index}`] === 'device') {
            if (!ValidateField.text(values[`deviceId_${this.props.index}`])) {
                errors.deviceId = 'Device ID is required.'
            } else if (!ValidateField.url(values[`deviceId_${this.props.index}`])) {
                errors.deviceId = 'Device ID is invalid.'
            }
        }

        if (!values['monitorCategoriesId']) {
            errors.monitorCategories = 'Monitor Category is required'
        }

        return errors;
    }

    /*  componentDidUpdate() {
          const { monitor } = this.props
          if (monitor.newMonitor.error === 'You can\'t add any more monitors. Please upgrade plan.') {
              this.showUpgradeForm()
          }
      }*/

    submitForm = (values) => {
        var thisObj = this;

        var { upgradeModalId } = this.state;
        const postObj = { data: {}, criteria: { up: {}, down: {}, degraded: {} } };
        postObj.projectId = values[`subProject_${this.props.index}`]
        postObj.name = values[`name_${this.props.index}`];
        postObj.type = values[`type_${this.props.index}`] ? values[`type_${this.props.index}`] : this.props.editMonitorProp.type;
        postObj.monitorCategoryId = values[`monitorCategoryId_${this.props.index}`]
        postObj.callScheduleId = values[`callSchedule_${this.props.index}`];
        if (!postObj.projectId) postObj.projectId = this.props.currentProject._id;
        if (postObj.type === 'url' || postObj.type === 'manual')
            postObj.data.url = values[`url_${this.props.index}`] || null;

        if (postObj.type === 'device')
            postObj.data.deviceId = values[`deviceId_${this.props.index}`];

        if (postObj.type === 'api')
            postObj.data.url = values[`url_${this.props.index}`];

        if (postObj.type === 'script') {
            postObj.data.script = thisObj.state.script;
        }

        if (postObj.type === 'url' || postObj.type === 'api' || postObj.type === 'server-monitor') {
            if (values && values[`up_${this.props.index}`] && values[`up_${this.props.index}`].length) {
                postObj.criteria.up = makeCriteria(values[`up_${this.props.index}`]);
                postObj.criteria.up.createAlert = values && values[`up_${this.props.index}_createAlert`] ? true : false;
                postObj.criteria.up.autoAcknowledge = values && values[`up_${this.props.index}_autoAcknowledge`] ? true : false;
                postObj.criteria.up.autoResolve = values && values[`up_${this.props.index}_autoResolve`] ? true : false;
            }

            if (values && values[`degraded_${this.props.index}`] && values[`degraded_${this.props.index}`].length) {
                postObj.criteria.degraded = makeCriteria(values[`degraded_${this.props.index}`]);
                postObj.criteria.degraded.createAlert = values && values[`degraded_${this.props.index}_createAlert`] ? true : false;
                postObj.criteria.degraded.autoAcknowledge = values && values[`degraded_${this.props.index}_autoAcknowledge`] ? true : false;
                postObj.criteria.degraded.autoResolve = values && values[`degraded_${this.props.index}_autoResolve`] ? true : false;
            }

            if (values && values[`down_${this.props.index}`] && values[`down_${this.props.index}`].length) {
                postObj.criteria.down = makeCriteria(values[`down_${this.props.index}`]);
                postObj.criteria.down.createAlert = values && values[`down_${this.props.index}_createAlert`] ? true : false;
                postObj.criteria.down.autoAcknowledge = values && values[`down_${this.props.index}_autoAcknowledge`] ? true : false;
                postObj.criteria.down.autoResolve = values && values[`down_${this.props.index}_autoResolve`] ? true : false;
            }
        }
        if (postObj.type === 'api') {
            if (values && values[`method_${this.props.index}`] && values[`method_${this.props.index}`].length) {
                postObj.method = values[`method_${this.props.index}`];
            }
            if (values && values[`headers_${this.props.index}`] && values[`headers_${this.props.index}`].length) {
                postObj.headers = values[`headers_${this.props.index}`];
            }
            if (values && values[`bodyType_${this.props.index}`] && values[`bodyType_${this.props.index}`].length) {
                postObj.bodyType = values[`bodyType_${this.props.index}`];
            }
            if (values && values[`formData_${this.props.index}`] && values[`formData_${this.props.index}`].length && (postObj.bodyType === 'form-data' || postObj.bodyType === 'x-www-form-urlencoded')) {
                postObj.formData = values[`formData_${this.props.index}`];
            }
            if (values && values[`text_${this.props.index}`] && values[`text_${this.props.index}`].length && !(postObj.bodyType === 'form-data' || postObj.bodyType === 'x-www-form-urlencoded')) {
                postObj.text = values[`text_${this.props.index}`];
            }
        }

        if (this.props.edit) {
            const { monitorId } = this.props;
            postObj._id = this.props.editMonitorProp._id;
            this.props.editMonitor(postObj.projectId, postObj)
                .then(() => {
                    thisObj.props.destroy();
                    if (monitorId === this.props.editMonitorProp._id) {
                        this.props.fetchMonitorsIncidents(postObj.projectId, this.props.editMonitorProp._id, 0, 5);
                        this.props.fetchMonitorsSubscribers(postObj.projectId, this.props.editMonitorProp._id, 0, 5);
                    } else {
                        this.props.fetchMonitorsIncidents(postObj.projectId, this.props.editMonitorProp._id, 0, 3);
                    }
                    if (window.location.href.indexOf('localhost') <= -1) {
                        thisObj.context.mixpanel.track('Monitor Edit', values);
                    }
                })
        } else {

            this.props.createMonitor(postObj.projectId, postObj)
                .then(() => {
                    thisObj.props.reset();
                    if (window.location.href.indexOf('localhost') <= -1) {
                        thisObj.context.mixpanel.track('Add New Monitor', values);
                    }
                }, error => {
                    if (error && error.message && error.message === 'You can\'t add any more monitors. Please add an extra seat to add more monitors.') {
                        thisObj.props.openModal({
                            id: upgradeModalId,
                            onClose: () => '',
                            onConfirm: () => thisObj.props.addSeat(thisObj.props.currentProject._id),
                            content: AddSeats
                        })
                    }
                });
        }
    }

    scheduleChange = (e) => {
        //load call schedules
        if (e.target.value && e.target.value !== '') {
            this.props.fetchSchedules(e.target.value);
        } else {
            const userId = User.getUserId();
            const projectMember = this.props.currentProject.users.find(user => user.userId === userId);
            if (projectMember) this.props.fetchSchedules(this.props.currentProject._id);
        }
    }

    cancelEdit = () => {
        this.props.editMonitorSwitch(this.props.index);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Monitor Edit Cancelled', {});
        }
    }

    openAdvance = () => {
        this.setState({ advance: !this.state.advance });
    }
    changeBox = (e) => {
        this.setState({ advance: false, type: e.target.value });
    }

    scriptTextChange = (newValue) => {
        this.setState({ script: newValue });
    }

    render() {
        let requesting = ((this.props.monitor.newMonitor.requesting && !this.props.edit) || (this.props.monitor.editMonitor.requesting && this.props.edit));

        const { handleSubmit, subProjects, schedules } = this.props;
        const { monitorCategoryList } = this.props;
        let type = '';
        if (this.props.edit) {
            type = this.props.editMonitorProp.type;
        }
        else {
            type = this.props.type;
        }

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
                                                {
                                                    this.props.editMonitorProp && this.props.editMonitorProp.name ? ' - ' + this.props.editMonitorProp.name : null
                                                }
                                            </span>
                                        </ShouldRender>
                                    </span>
                                </span>
                                <p>
                                    <ShouldRender if={!this.props.edit}>
                                        <span>
                                            Monitor pings your website every minute and checks uptime, performance and notifies you when things are down.
                                        </span>
                                    </ShouldRender>
                                    <ShouldRender if={this.props.edit}>
                                        <span>
                                            Edit Name and URL of
                                                {
                                                this.props.editMonitorProp && this.props.editMonitorProp.name ? ` ${this.props.editMonitorProp.name}` : ''
                                            }
                                        </span>
                                    </ShouldRender>
                                </p>
                            </div>
                        </div>

                        <form id='frmNewMonitor' onSubmit={handleSubmit(this.submitForm)}>
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2" style={{ boxShadow: 'none' }}>
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">Name</label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={RenderField}
                                                            type="text"
                                                            name={`name_${this.props.index}`}
                                                            id="name"
                                                            placeholder="Home Page"
                                                            disabled={requesting}
                                                            validate={ValidateField.text}
                                                        />
                                                    </div>
                                                </div>
                                                <ShouldRender if={!this.props.edit}>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">Monitor Type</label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={RenderSelect}
                                                                name={`type_${this.props.index}`}
                                                                id="type"
                                                                placeholder="Monitor Type"
                                                                disabled={requesting}
                                                                onChange={(e) => this.changeBox(e)}
                                                                validate={ValidateField.select}
                                                            >
                                                                <option value="">Select monitor type</option>
                                                                <option value="url">URL</option>
                                                                <option value="device">Device</option>
                                                                <option value="manual">Manual</option>
                                                                <option value="api">API</option>
                                                                <option value="script">Script</option>
                                                                <option value="server-monitor">Server Monitor</option>
                                                            </Field>
                                                        </div>
                                                    </div>
                                                    <ShouldRender if={subProjects && subProjects.length > 0}>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">Sub Project</label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    name={`subProject_${this.props.index}`}
                                                                    id="subProjectId"
                                                                    required="required"
                                                                    disabled={requesting}
                                                                    component={SubProjectSelector}
                                                                    props={{ subProjects }}
                                                                    onChange={this.scheduleChange}
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                />
                                                            </div>
                                                        </div>
                                                    </ShouldRender>
                                                    <ShouldRender if={!this.props.edit && schedules && schedules.length > 0}>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">Call Schedule</label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={'select'}
                                                                    name={`callSchedule_${this.props.index}`}
                                                                    id="callSchedule"
                                                                    placeholder="Call Schedule"
                                                                    disabled={requesting}
                                                                >
                                                                    <option value="">Select call schedule</option>
                                                                    {schedules && schedules.map((schedule, i) => <option key={i} value={schedule._id}>{schedule.name}</option>)}
                                                                </Field>
                                                            </div>
                                                        </div>
                                                    </ShouldRender>
                                                    <ShouldRender if={monitorCategoryList && monitorCategoryList.length > 0}>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">Monitor Category</label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={'select'}
                                                                    name={`monitorCategoryId_${this.props.index}`}
                                                                    id="monitorCategory"
                                                                    placeholder="Choose Monitor Category"
                                                                    disabled={requesting}
                                                                    validate={ValidateField.select}
                                                                >
                                                                    <option value="">Select monitor category</option>
                                                                    {monitorCategoryList && monitorCategoryList.map(monitorCategory => <option key={monitorCategory._id} value={monitorCategory._id}>{monitorCategory.name}</option>)}
                                                                </Field>
                                                            </div>
                                                        </div>
                                                    </ShouldRender>
                                                    <ShouldRender if={type === 'api'}>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">HTTP Method</label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={RenderSelect}
                                                                    name={`method_${this.props.index}`}
                                                                    id="method"
                                                                    placeholder="Http Method"
                                                                    disabled={requesting}
                                                                    validate={ValidateField.select}
                                                                >
                                                                    <option value="">Select method</option>
                                                                    <option value="get">GET</option>
                                                                    <option value="post">POST</option>
                                                                    <option value="put">PUT</option>
                                                                    <option value="delete">DELETE</option>
                                                                </Field>
                                                            </div>
                                                        </div>
                                                    </ShouldRender>

                                                    {/**  <div className="bs-Fieldset-row">
                                                    {/**  <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">Sub project</label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={'select'}
                                                            name={`type_${this.props.index}`}
                                                            id="type"
                                                            placeholder="Monitor Type"
                                                            required="required"
                                                            disabled={requesting}
                                                        >
                                                            <option value="">Select monitor type</option>
                                                            <option value="url">URL</option>
                                                            <option value="device">Device</option>
                                                            <option value="manual">Manual</option>
                                                        </Field>
                                                    </div>
                                                </div> */}
                                                    {(type === 'url' || type === 'manual' || type === 'api') && <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">URL{type === 'manual' && '(optional)'}</label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={RenderField}
                                                                type="url"
                                                                name={`url_${this.props.index}`}
                                                                id="url"
                                                                placeholder="https://mywebsite.com"
                                                                disabled={requesting}
                                                                validate={[ValidateField.required, ValidateField.url]}
                                                            />
                                                        </div>
                                                    </div>}

                                                    {type === 'device' && <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">Device ID</label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={RenderField}
                                                                type="deviceId"
                                                                name={`deviceId_${this.props.index}`}
                                                                id="deviceId"
                                                                placeholder="of234dfgqwe"
                                                                disabled={requesting}
                                                                validate={ValidateField.required}
                                                            />
                                                        </div>
                                                    </div>}
                                                    <ShouldRender if={type && (type === 'api' || type === 'url' || type === 'server-monitor') && !this.state.advance}>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label"></label>
                                                            <div className="bs-Fieldset-fields">
                                                                <a onClick={() => this.openAdvance()} style={{ cursor: 'pointer' }}> Advance Options.</a>
                                                            </div>
                                                        </div>
                                                    </ShouldRender>
                                                    <ShouldRender if={type === 'script'}>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">Script</label>
                                                            <div className="bs-Fieldset-fields">
                                                                <span>
                                                                    <span>
                                                                        <AceEditor
                                                                            placeholder="Enter script here"
                                                                            mode="javascript"
                                                                            theme="github"
                                                                            value={this.state.script}
                                                                            name={`script_${this.props.index}`}
                                                                            id="script"
                                                                            editorProps={{ $blockScrolling: true }}
                                                                            height={150}
                                                                            highlightActiveLine={true}
                                                                            onChange={this.scriptTextChange}
                                                                        />
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </ShouldRender>
                                                    <ShouldRender if={this.state.advance && (type === 'api' || type === 'url' || type === 'server-monitor')}>
                                                        <ShouldRender if={this.state.advance && type === 'api'}>
                                                            <ApiAdvance index={this.props.index} />
                                                        </ShouldRender>
                                                        <ResponseComponent head='Monitor up criteria' tagline='This is where you describe when your monitor is considered up' fieldname={`up_${this.props.index}`} index={this.props.index} type={this.state.type} />
                                                        <ResponseComponent head='Monitor degraded criteria' tagline='This is where you describe when your monitor is considered degraded' fieldname={`degraded_${this.props.index}`} index={this.props.index} type={this.state.type} />
                                                        <ResponseComponent head='Monitor down criteria' tagline='This is where you describe when your monitor is considered down' fieldname={`down_${this.props.index}`} index={this.props.index} type={this.state.type} />
                                                    </ShouldRender>
                                                </ShouldRender>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <div className="bs-Tail-copy">
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                        <ShouldRender if={this.props.monitor.newMonitor.error || this.props.monitor.editMonitor.error}>

                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                                </div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {this.props.monitor.newMonitor.error || this.props.monitor.editMonitor.error}
                                                </span>
                                            </div>

                                        </ShouldRender>

                                    </div>
                                </div>
                                <div>
                                    <ShouldRender if={!requesting && this.props.edit}>
                                        <button className="bs-Button"
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
                                        <ShouldRender if={!this.props.edit && !requesting}>
                                            <span>Add Monitor</span>
                                        </ShouldRender>

                                        <ShouldRender if={this.props.edit && !requesting}>
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

let NewMonitorForm = new reduxForm({
    form: 'NewMonitor',
    enableReinitialize: true,
    destroyOnUnmount: false,
})(NewMonitor);

const mapDispatchToProps = dispatch => bindActionCreators(
    {
        createMonitor,
        createMonitorSuccess,
        createMonitorFailure,
        resetCreateMonitor,
        editMonitorSwitch,
        openModal,
        closeModal,
        editMonitor,
        addSeat,
        fetchMonitorsIncidents,
        fetchMonitorsSubscribers,
        fetchSchedules,
        scheduleSuccess
    }
    , dispatch);

const mapStateToProps = (state, ownProps) => {
    if (ownProps.edit) {
        const monitorId = ownProps.match ? ownProps.match.params ? ownProps.match.params.monitorId : null : null;
        return {
            monitor: state.monitor,
            currentProject: state.project.currentProject,
            type: selector(state, 'type_1000'),
            subProjects: state.subProject.subProjects.subProjects,
            schedules: state.schedule.schedules.data,
            monitorId
        };
    }
    else {
        const initialvalue = {
            up_1000: [{ match: 'all', responseType: 'doesRespond', filter: 'isUp', field1: '', field2: '', field3: false }], up_1000_createAlert: false, up_1000_autoAcknowledge: false, up_1000_autoResolve: false,
            down_1000: [{ match: 'all', responseType: 'doesRespond', filter: 'isDown', field1: '', field2: '', field3: false }], down_1000_createAlert: true, down_1000_autoAcknowledge: true, down_1000_autoResolve: true,
            degraded_1000: [{ match: 'all', responseType: 'responseTime', filter: 'greaterThan', field1: '5000', field2: '', field3: false }], degraded_1000_createAlert: true, degraded_1000_autoAcknowledge: true, degraded_1000_autoResolve: true,
        }
        return {
            initialValues: initialvalue,
            monitor: state.monitor,
            currentProject: state.project.currentProject,
            type: selector(state, 'type_1000'),
            monitorCategoryList: state.monitorCategories.monitorCategoryListForNewMonitor.monitorCategories,
            subProjects: state.subProject.subProjects.subProjects,
            schedules: state.schedule.schedules.data
        };
    }
};

NewMonitor.propTypes = {
    index: PropTypes.number.isRequired,
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
    type: PropTypes.string,
    subProjects: PropTypes.array,
    monitorCategoryList: PropTypes.array,
    schedules: PropTypes.array,
    monitorId: PropTypes.string.isRequired
};

NewMonitor.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(NewMonitorForm);