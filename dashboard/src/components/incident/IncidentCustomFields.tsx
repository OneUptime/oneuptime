import React, { Component } from 'react';

import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';
import { ListLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal } from 'common-ui/actions/modal';
import { fetchCustomFields, paginate } from '../../actions/customField';
import DeleteCustomField from '../modals/DeleteCustomField';
import CreateCustomField from '../modals/CreateCustomField';

import DataPathHoC from '../DataPathHoC';
import EditCustomField from '../modals/EditCustomField';

interface IncidentCustomFieldsProps {
    currentProject?: object;
    error?: string;
    requesting?: boolean;
    customFields?: unknown[];
    count?: number;
    limit?: number;
    skip?: number;
    openModal: Function;
    fetchCustomFields: Function;
    paginate?: Function;
    page?: number;
}

class IncidentCustomFields extends Component<IncidentCustomFieldsProps> {
    componentDidMount() {

        const { fetchCustomFields, currentProject, limit } = this.props;
        const projectId = currentProject._id;
        fetchCustomFields(projectId, 0, limit);
    }

    prevClicked = (projectId: $TSFixMe) => {

        const { fetchCustomFields, skip, limit } = this.props;
        fetchCustomFields(
            projectId,
            skip ? Number(skip) - limit : limit,
            limit
        );

        this.props.paginate('prev');
    };

    nextClicked = (projectId: $TSFixMe) => {

        const { fetchCustomFields, skip, limit } = this.props;
        fetchCustomFields(projectId, skip ? Number(skip) + limit : limit, 10);

        this.props.paginate('next');
    };

    render() {
        const {

            limit,

            count,

            skip,

            openModal,

            currentProject,

            customFields,

            error,

            requesting,
        } = this.props;
        const footerBorderTopStyle = { margin: 0, padding: 0 };

        const canNext = count > Number(skip) + Number(limit) ? true : false;
        const canPrev = Number(skip) <= 0 ? false : true;
        const projectName = currentProject ? currentProject.name : '';
        const numberOfPages = Math.ceil(parseInt(count) / 10);
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Custom Fields</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Setup custom fields for {projectName} to be
                                    used in created incidents
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <button
                                    id="addCustomField"
                                    onClick={() => {

                                        this.props.openModal({
                                            id: currentProject._id,
                                            content: DataPathHoC(
                                                CreateCustomField,
                                                {
                                                    projectId:
                                                        currentProject._id,
                                                }
                                            ),
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
                                            <span>Add Field</span>
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
                                id="scheduledEventsList"
                                className="bs-ObjectList-rows"
                            >
                                <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                    <div className="bs-ObjectList-cell">
                                        Field Name
                                    </div>
                                    <div className="bs-ObjectList-cell">
                                        Field Type
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
                                {customFields.length > 0 &&
                                    customFields.map((field: $TSFixMe, index: $TSFixMe) => (
                                        <div
                                            key={field._id}
                                            className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                            style={{
                                                backgroundColor: 'white',
                                                cursor: 'pointer',
                                            }}
                                            id={`customfield_${field.fieldName}`}
                                        >
                                            {field.uniqueField ? (
                                                <div
                                                    className="bs-ObjectList-cell bs-u-v-middle"
                                                    style={{
                                                        display: 'flex',
                                                        whiteSpace: 'normal',
                                                    }}
                                                >
                                                    <div className="bs-ObjectList-cell-row">
                                                        {field.fieldName}
                                                    </div>
                                                    <div
                                                        style={{
                                                            marginLeft: 5,
                                                        }}
                                                        className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                    >
                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                            <span>Unique</span>
                                                        </span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div
                                                    className="bs-ObjectList-cell bs-u-v-middle"
                                                    style={{
                                                        display: 'flex',
                                                        whiteSpace: 'normal',
                                                    }}
                                                >
                                                    <div className="bs-ObjectList-cell-row">
                                                        {field.fieldName}
                                                    </div>
                                                </div>
                                            )}
                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                <div
                                                    className="bs-ObjectList-cell-row"
                                                    style={{
                                                        textTransform:
                                                            'capitalize',
                                                    }}
                                                >
                                                    {field.fieldType}
                                                </div>
                                            </div>
                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                <div className="Box-root Flex-flex Flex-justifyContent--flexEnd">
                                                    <button
                                                        id={`editCustomField_${index}`}
                                                        title="edit"
                                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                                        style={{
                                                            marginLeft: 20,
                                                        }}
                                                        type="button"
                                                        onClick={() => {
                                                            openModal({
                                                                id:
                                                                    currentProject._id,
                                                                content: EditCustomField,
                                                                customField: field,
                                                                projectId:
                                                                    currentProject._id,
                                                            });
                                                        }}
                                                    >
                                                        <span>Edit</span>
                                                    </button>
                                                    <button
                                                        id={`deleteCustomField_${index}`}
                                                        title="delete"
                                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete"
                                                        style={{
                                                            marginLeft: 20,
                                                        }}
                                                        type="button"
                                                        onClick={() => {
                                                            openModal({
                                                                id: field._id,
                                                                content: DataPathHoC(
                                                                    DeleteCustomField,
                                                                    {
                                                                        projectId:
                                                                            currentProject._id,
                                                                        customFieldId:
                                                                            field._id,
                                                                    }
                                                                ),
                                                            });
                                                        }}
                                                    >
                                                        <span>Delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                <ShouldRender
                                    if={
                                        !(
                                            (!customFields ||
                                                customFields.length === 0) &&
                                            !requesting &&
                                            !error
                                        )
                                    }
                                >
                                    <div style={footerBorderTopStyle}></div>
                                </ShouldRender>
                            </div>
                        </div>
                        <ShouldRender if={requesting}>
                            <ListLoader />
                        </ShouldRender>
                        <ShouldRender
                            if={
                                (!customFields || customFields.length === 0) &&
                                !requesting &&
                                !error
                            }
                        >
                            <div
                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                style={{
                                    textAlign: 'center',
                                    backgroundColor: 'white',
                                    padding: '20px 10px 0',
                                }}
                                id="noCustomFields"
                            >
                                <span>
                                    {(!customFields ||
                                        customFields.length === 0) &&
                                        !requesting &&
                                        !error
                                        ? 'You have no custom field at this time'
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
                                            id="scheduledEventCount"
                                            className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                        >
                                            {numberOfPages > 0
                                                ? `Page ${this.props.page
                                                } of ${numberOfPages} (${count} Custom field${count === 1 ? '' : 's'
                                                })`
                                                : `${count} Custom field${count === 1 ? '' : 's'
                                                }`}
                                        </span>
                                    </span>
                                </span>
                            </div>
                            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Margin-right--8">
                                        <button
                                            id="btnPrevCustomFields"
                                            onClick={() =>
                                                this.prevClicked(
                                                    currentProject._id,

                                                    skip
                                                )
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
                                            id="btnNextCustomFields"
                                            onClick={() =>
                                                this.nextClicked(
                                                    currentProject._id,

                                                    skip
                                                )
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


IncidentCustomFields.displayName = 'IncidentCustomFields';


IncidentCustomFields.propTypes = {
    currentProject: PropTypes.object,
    error: PropTypes.string,
    requesting: PropTypes.bool,
    customFields: PropTypes.array,
    count: PropTypes.number,
    limit: PropTypes.number,
    skip: PropTypes.number,
    openModal: PropTypes.func.isRequired,
    fetchCustomFields: PropTypes.func.isRequired,
    paginate: PropTypes.func,
    page: PropTypes.number,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
        fetchCustomFields,
        paginate,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        customFields: state.customField.customFields.fields,
        requesting: state.customField.customFields.requesting,
        error: state.customField.customFields.error,
        count: state.customField.customFields.count,
        limit: state.customField.customFields.limit,
        skip: state.customField.customFields.skip,
        page: state.customField.page,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(withRouter(IncidentCustomFields));
