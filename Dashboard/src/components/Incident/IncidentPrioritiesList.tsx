import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { openModal } from 'CommonUI/actions/Modal';

interface IncidentPrioritiesListClassProps {
    incidentPrioritiesList: unknown[];
    handleEditIncidentPriority: Function;
    handleDeleteIncidentPriority: Function;
}

class IncidentPrioritiesListClass extends React.Component<IncidentPrioritiesListClassProps> {
    override render() {
        return (
            <div
                id="incidentPrioritiesList"
                className="bs-ContentSection-content Box-root"
            >
                <div className="bs-ObjectList db-UserList">
                    <div style={{ overflow: 'auto hidden' }}>
                        <div className="bs-ObjectList-rows">
                            <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                <div
                                    className="bs-ObjectList-cell"
                                    style={{ width: '70%' }}
                                >
                                    Name
                                </div>
                                <div
                                    className="bs-ObjectList-cell incident-priority-table"
                                    style={{
                                        width: '30%',
                                        float: 'right',
                                        marginRight: '8px',
                                        textAlign: 'right',
                                    }}
                                >
                                    Action
                                </div>
                            </header>

                            {this.props.incidentPrioritiesList.map(
                                (incidentPriority: $TSFixMe, index: $TSFixMe) => (
                                    <div
                                        key={index}
                                        className="bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                    >
                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                            <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted"></div>
                                            <div className="bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted">
                                                <div
                                                    className="Flex-flex Flex-alignItems--center"
                                                    id="priorities"
                                                >
                                                    <span
                                                        className="Margin-right--4"
                                                        style={{
                                                            display:
                                                                'inline-block',
                                                            backgroundColor: `rgba(${incidentPriority.color.r},${incidentPriority.color.g},${incidentPriority.color.b},${incidentPriority.color.a})`,
                                                            height: '15px',
                                                            width: '15px',
                                                            borderRadius: '30%',
                                                        }}
                                                    ></span>
                                                    <span
                                                        id={`priority_${incidentPriority.name}_${index}`}
                                                        className="Text-fontWeight--medium"
                                                        style={{
                                                            color: `rgba(${incidentPriority.color.r},${incidentPriority.color.g},${incidentPriority.color.b},${incidentPriority.color.a})`,
                                                        }}
                                                    >
                                                        {incidentPriority.name}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexEnd"
                                                style={{ marginRight: '5px' }}
                                            >
                                                <div className="Box-root">
                                                    <button
                                                        id={`priorityEdit_${incidentPriority.name}_${index}`}
                                                        className="Button bs-ButtonLegacy"
                                                        type="button"
                                                        onClick={() =>

                                                            this.props.handleEditIncidentPriority(
                                                                incidentPriority._id
                                                            )
                                                        }
                                                    >
                                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                <span>
                                                                    Edit
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </button>
                                                </div>
                                                <div className="Box-root Margin-left--8">
                                                    <button
                                                        id={`priorityDelete_${incidentPriority.name}_${index}`}
                                                        className="Button bs-ButtonLegacy"
                                                        type="button"
                                                        onClick={() => {

                                                            this.props.handleDeleteIncidentPriority(
                                                                incidentPriority._id
                                                            );
                                                        }}
                                                    >
                                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                <span>
                                                                    Delete
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


IncidentPrioritiesListClass.displayName = 'IncidentPrioritiesList';

IncidentPrioritiesListClass.propTypes = {
    incidentPrioritiesList: PropTypes.array.isRequired,
    handleEditIncidentPriority: PropTypes.func.isRequired,
    handleDeleteIncidentPriority: PropTypes.func.isRequired,
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
    },
    dispatch
);

export const IncidentPrioritiesList: $TSFixMe = connect(
    null,
    mapDispatchToProps
)(IncidentPrioritiesListClass);
