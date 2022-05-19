import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { openModal } from 'CommonUI/actions/Modal';
import DataPathHoC from '../DataPathHoC';
import { ListLoader } from '../basic/Loader';
import CreateIncidentTemplate from '../Modals/CreateIncidentTemplate';
import {
    fetchIncidentTemplates,
    setDefaultTemplate,
    setActiveTemplate,
} from '../../actions/incidentBasicsSettings';
import EditIncidentTemplate from '../Modals/EditIncidentTemplate';
import DeleteIncidentTemplate from '../Modals/DeleteIncidentTemplate';

interface IncidentTemplatesProps {
    openModal: Function;
    skip?: string | number;
    limit?: string | number;
    count?: string | number;
    currentProject?: object;
    fetchingTemplates?: boolean;
    settingDefaultTemplate?: boolean;
    templates?: unknown[];
    fetchIncidentTemplates?: Function;
    setDefaultTemplate?: Function;
    activeTemplate?: string;
    setActiveTemplate?: Function;
    fetchTemplateError?: string;
    setDefaultTemplateError?: string;
}

class IncidentTemplates extends Component<ComponentProps> {
    limit: PositiveNumber;
    constructor() {

        super();
        this.limit = 10;
        this.state = {
            flag: false,
            page: 1,
        };
    }

    override componentDidMount() {

        const { currentProject, fetchIncidentTemplates }: $TSFixMe = this.props;
        if (currentProject) {
            fetchIncidentTemplates({
                projectId: currentProject._id,
                skip: 0,
                limit: this.limit,
            });
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            JSON.stringify(prevProps.currentProject) !==

            JSON.stringify(this.props.currentProject)
        ) {

            if (this.props.currentProject) {

                this.props.fetchIncidentTemplates({

                    projectId: this.props.currentProject._id,
                    skip: 0,
                    limit: this.limit,
                });
            }
        }
    }

    prevClicked = (skip: PositiveNumber, limit: PositiveNumber) => {

        const { currentProject, fetchIncidentTemplates }: $TSFixMe = this.props;
        if (currentProject) {
            this.setState({
                flag: false,
            });

            fetchIncidentTemplates({
                projectId: currentProject._id,
                skip: (skip || 0) > (limit || 10) ? skip - limit : 0,
                limit,
            });

            this.setState({

                page: this.state.page > 1 ? this.state.page - 1 : 1,
            });
        }
    };

    nextClicked = (skip: PositiveNumber, limit: PositiveNumber) => {

        const { currentProject, fetchIncidentTemplates }: $TSFixMe = this.props;
        if (currentProject) {
            this.setState({
                flag: false,
            });
            fetchIncidentTemplates({
                projectId: currentProject._id,
                skip: skip + limit,
                limit,
            });
            this.setState({
                page:

                    this.state.page < this.props.count

                        ? this.state.page + 1

                        : this.props.count,
            });
        }
    };

    setAsDefault = ({
        projectId,
        templateId
    }: $TSFixMe) => {

        const { setDefaultTemplate, setActiveTemplate }: $TSFixMe = this.props;
        setActiveTemplate(templateId);
        setDefaultTemplate({ projectId, templateId });
    };

    handleTemplateList = () => {
        const {

            fetchingTemplates,

            currentProject,

            openModal,

            activeTemplate,

            templates,

            settingDefaultTemplate,
        } = this.props;

        return !fetchingTemplates &&
            currentProject &&
            templates &&
            templates.length > 0 &&
            templates.map((template: $TSFixMe) => {
                return (
                    <div
                        key={template._id}
                        id={`incident_template_${template.name}`}
                        className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                        style={{
                            backgroundColor: 'white',
                            cursor: 'pointer',
                        }}
                    >
                        {template.isDefault ? (
                            <div
                                className="bs-ObjectList-cell bs-u-v-middle"
                                style={{
                                    display: 'flex',
                                    width: '20vw',
                                }}
                            >
                                <div className="bs-ObjectList-cell-row">
                                    {template.name}
                                </div>
                                <div
                                    style={{
                                        marginLeft: 5,
                                    }}
                                    className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                >
                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                        <span>Default</span>
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div
                                className="bs-ObjectList-cell bs-u-v-middle"
                                style={{
                                    display: 'flex',
                                    width: '20vw',
                                }}
                            >
                                <div className="bs-ObjectList-cell-row">
                                    {template.name}
                                </div>
                            </div>
                        )}
                        <div
                            className="bs-ObjectList-cell bs-u-v-middle"
                            style={{ width: '20vw' }}
                        >
                            <div
                                className="bs-ObjectList-cell-row"
                                style={{
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                    marginRight: 15,
                                }}
                            >
                                <ShouldRender if={!template.isDefault}>
                                    <button
                                        id={`defaultIncidentTemplateBtn_${template.name}`}
                                        title="set default"
                                        className="bs-Button bs-DeprecatedButton"
                                        style={{
                                            marginLeft: 20,
                                            minWidth: 100,
                                        }}
                                        type="button"
                                        onClick={() => {
                                            this.setAsDefault({
                                                projectId: currentProject._id,
                                                templateId: template._id,
                                            });
                                            this.setState({
                                                flag: true,
                                            });
                                        }}
                                        disabled={
                                            fetchingTemplates &&
                                            settingDefaultTemplate
                                        }
                                    >
                                        <ShouldRender
                                            if={
                                                !settingDefaultTemplate ||
                                                String(activeTemplate) !==
                                                String(template._id)
                                            }
                                        >
                                            <span>Set as Default</span>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                settingDefaultTemplate &&
                                                String(activeTemplate) ===
                                                String(template._id)
                                            }
                                        >
                                            <ListLoader
                                                style={{
                                                    marginTop: 0,
                                                }}
                                            />
                                        </ShouldRender>
                                    </button>
                                </ShouldRender>
                                <button
                                    id={`editIncidentTemplateBtn_${template.name}`}
                                    title="edit"
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                    style={{
                                        marginLeft: 20,
                                    }}
                                    type="button"
                                    onClick={() => {
                                        openModal({
                                            id: template._id,
                                            content: DataPathHoC(
                                                EditIncidentTemplate,
                                                { template }
                                            ),
                                        });
                                    }}
                                >
                                    <span>Edit</span>
                                </button>
                                {!template.isDefault && (
                                    <button
                                        id={`deleteIncidentTemplateBtn_${template.name}`}
                                        title="delete"
                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete"
                                        style={{
                                            marginLeft: 20,
                                        }}
                                        type="button"
                                        onClick={() => {
                                            openModal({
                                                content: DeleteIncidentTemplate,
                                                templateId: template._id,
                                                projectId: currentProject._id,
                                            });
                                        }}
                                    >
                                        <span>Delete</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                );
            });
    };

    override render() {
        const {

            limit,

            count,

            skip,

            currentProject,

            fetchingTemplates,

            fetchTemplateError,

            setDefaultTemplateError,

            templates,
        } = this.props;
        const footerBorderTopStyle: $TSFixMe = { margin: 0, padding: 0 };

        const canNext: $TSFixMe = count > Number(skip) + Number(limit) ? true : false;
        const canPrev: $TSFixMe = Number(skip) <= 0 ? false : true;
        const projectName: $TSFixMe = currentProject ? currentProject.name : '';

        const numberOfPages: $TSFixMe = Math.ceil(parseInt(this.props.count) / 10);
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Incident Templates</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Setup incident templates which will be used
                                    when a new incident is created on the
                                    project {projectName}.
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <button
                                    id="addIncidentTemplateBtn"
                                    onClick={() => {

                                        this.props.openModal({
                                            id: currentProject
                                                ? currentProject._id
                                                : '',
                                            content: CreateIncidentTemplate,
                                        });
                                    }}
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    type="button"
                                >
                                    <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <div className="Box-root Margin-right--8">
                                            <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                        </div>
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                            <span>
                                                Create Incident Template
                                            </span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection-content Box-root">
                    <div className="bs-ObjectList db-UserList">
                        <div
                            style={{
                                overflow: 'hidden',
                                overflowX: 'auto',
                            }}
                        >
                            <div
                                id="incidentTemplateList"
                                className="bs-ObjectList-rows"
                            >
                                <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                    <div className="bs-ObjectList-cell">
                                        Name
                                    </div>
                                    <div
                                        className="bs-ObjectList-cell"
                                        style={{
                                            float: 'right',
                                            marginRight: '10px',
                                        }}
                                    >
                                        Action
                                    </div>
                                </header>
                                {this.handleTemplateList()}
                                <ShouldRender
                                    if={
                                        !(
                                            (!templates ||
                                                templates.length === 0) &&
                                            !fetchingTemplates &&
                                            !fetchTemplateError &&
                                            !setDefaultTemplateError
                                        )
                                    }
                                >
                                    <div style={footerBorderTopStyle}></div>
                                </ShouldRender>
                            </div>
                        </div>
                        <ShouldRender

                            if={fetchingTemplates && !this.state.flag}
                        >
                            <ListLoader />
                        </ShouldRender>
                        <ShouldRender
                            if={
                                (!templates || templates.length === 0) &&
                                !fetchingTemplates &&
                                !fetchTemplateError &&
                                !setDefaultTemplateError
                            }
                        >
                            <div
                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                style={{
                                    textAlign: 'center',
                                    backgroundColor: 'white',
                                    padding: '20px 10px 0',
                                }}
                            >
                                <span>
                                    {(!templates || templates.length === 0) &&
                                        !fetchingTemplates &&
                                        !fetchTemplateError &&
                                        !setDefaultTemplateError
                                        ? 'You have no incident template'
                                        : null}
                                    {fetchTemplateError
                                        ? fetchTemplateError
                                        : null}
                                    {setDefaultTemplateError
                                        ? setDefaultTemplateError
                                        : null}
                                </span>
                            </div>
                        </ShouldRender>
                        <div
                            className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween"
                            style={{ backgroundColor: 'white' }}
                        >
                            <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        <span
                                            id="templateCount"
                                            className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                        >
                                            {numberOfPages > 0
                                                ? `Page ${this.state.page
                                                } of ${numberOfPages} (${this.props.count
                                                } Template${this.props.count === 1
                                                    ? ''
                                                    : 's'
                                                })`
                                                : `${this.props.count
                                                } Template${this.props.count === 1
                                                    ? ''
                                                    : 's'
                                                }`}
                                        </span>
                                    </span>
                                </span>
                            </div>
                            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Margin-right--8">
                                        <button
                                            id="btnPrevIncidentTemplate"
                                            onClick={() =>
                                                this.prevClicked(skip, limit)
                                            }
                                            className={
                                                'Button bs-ButtonLegacy' +
                                                (canPrev ? '' : 'Is--disabled')
                                            }
                                            disabled={!canPrev}
                                            data-db-analytics-name="list_view.pagination.previous"
                                            type="button"
                                        >
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span>Previous</span>
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                    <div className="Box-root">
                                        <button
                                            id="btnNextIncidentTemplate"
                                            onClick={() =>
                                                this.nextClicked(skip, limit)
                                            }
                                            className={
                                                'Button bs-ButtonLegacy' +
                                                (canNext ? '' : 'Is--disabled')
                                            }
                                            disabled={!canNext}
                                            data-db-analytics-name="list_view.pagination.next"
                                            type="button"
                                        >
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span>Next</span>
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


IncidentTemplates.displayName = 'IncidentTemplates';


IncidentTemplates.propTypes = {
    openModal: PropTypes.func.isRequired,
    skip: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    limit: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    count: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    currentProject: PropTypes.object,
    fetchingTemplates: PropTypes.bool,
    settingDefaultTemplate: PropTypes.bool,
    templates: PropTypes.array,
    fetchIncidentTemplates: PropTypes.func,
    setDefaultTemplate: PropTypes.func,
    activeTemplate: PropTypes.string,
    setActiveTemplate: PropTypes.func,
    fetchTemplateError: PropTypes.string,
    setDefaultTemplateError: PropTypes.string,
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
        fetchIncidentTemplates,
        setDefaultTemplate,
        setActiveTemplate,
    },
    dispatch
);

const mapStateToProps: Function = (state: RootState) => {
    return {
        fetchingTemplates:
            state.incidentBasicSettings.incidentTemplates.requesting,
        skip: state.incidentBasicSettings.incidentTemplates.skip,
        limit: state.incidentBasicSettings.incidentTemplates.limit,
        count: state.incidentBasicSettings.incidentTemplates.count,
        currentProject: state.project.currentProject,
        settingDefaultTemplate:
            state.incidentBasicSettings.setDefaultTemplate.requesting,
        templates: state.incidentBasicSettings.incidentTemplates.templates,
        activeTemplate: state.incidentBasicSettings.activeTemplate,
        fetchTemplateError: state.incidentBasicSettings.incidentTemplates.error,
        setDefaultTemplateError:
            state.incidentBasicSettings.setDefaultTemplate.error,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(IncidentTemplates);
