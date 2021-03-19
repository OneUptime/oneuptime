import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { v4 as uuidv4 } from 'uuid';
import { connect } from 'react-redux';
import MessageBox from '../modals/MessageBox';
import { openModal } from '../../actions/modal';
import {updateDefaultIncidentSettings} from '../../actions/incidentBasicsSettings'
import ShouldRender from '../basic/ShouldRender';

class IncidentPrioritiesListClass extends React.Component {
    render() {       
        const projectId = this.props.currentProject._id;
        console.log("Project ID :", projectId);
        console.log("The Props", this.props);
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
                                (incidentPriority, index) => (
                                    <div
                                        key={index}
                                        className="bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                    >
                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                            <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted"></div>
                                            <div className="bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted">
                                                <div className="Flex-flex Flex-alignItems--center">
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
                                                        <ShouldRender if={ this.props.selectedIncidentPriority === incidentPriority._id}>
                                                            <img
                                                                style={{
                                                                    marginLeft: 10,
                                                                    verticalAlign: 'middle',
                                                                    height: '20px',
                                                                    width: '20px',
                                                                }}
                                                                alt="default"
                                                                src={
                                                                    'data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjUxMnB0IiB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgd2lkdGg9IjUxMnB0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Im01MTIgNTguNjY3OTY5YzAtMzIuMzYzMjgxLTI2LjMwNDY4OC01OC42Njc5NjktNTguNjY3OTY5LTU4LjY2Nzk2OWgtMzk0LjY2NDA2MmMtMzIuMzYzMjgxIDAtNTguNjY3OTY5IDI2LjMwNDY4OC01OC42Njc5NjkgNTguNjY3OTY5djM5NC42NjQwNjJjMCAzMi4zNjMyODEgMjYuMzA0Njg4IDU4LjY2Nzk2OSA1OC42Njc5NjkgNTguNjY3OTY5aDM5NC42NjQwNjJjMzIuMzYzMjgxIDAgNTguNjY3OTY5LTI2LjMwNDY4OCA1OC42Njc5NjktNTguNjY3OTY5em0wIDAiIGZpbGw9IiM0Y2FmNTAiLz48cGF0aCBkPSJtMzg1Ljc1IDE3MS41ODU5MzhjOC4zMzk4NDQgOC4zMzk4NDMgOC4zMzk4NDQgMjEuODIwMzEyIDAgMzAuMTY0MDYybC0xMzguNjY3OTY5IDEzOC42NjQwNjJjLTQuMTYwMTU2IDQuMTYwMTU3LTkuNjIxMDkzIDYuMjUzOTA3LTE1LjA4MjAzMSA2LjI1MzkwN3MtMTAuOTIxODc1LTIuMDkzNzUtMTUuMDgyMDMxLTYuMjUzOTA3bC02OS4zMzIwMzEtNjkuMzMyMDMxYy04LjM0Mzc1LTguMzM5ODQzLTguMzQzNzUtMjEuODI0MjE5IDAtMzAuMTY0MDYyIDguMzM5ODQzLTguMzQzNzUgMjEuODIwMzEyLTguMzQzNzUgMzAuMTY0MDYyIDBsNTQuMjUgNTQuMjUgMTIzLjU4NTkzOC0xMjMuNTgyMDMxYzguMzM5ODQzLTguMzQzNzUgMjEuODIwMzEyLTguMzQzNzUgMzAuMTY0MDYyIDB6bTAgMCIgZmlsbD0iI2ZhZmFmYSIvPjwvc3ZnPg=='
                                                                }
                                                            />
                                                        </ShouldRender>                                                        
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexEnd"
                                                style={{ marginRight: '5px' }}
                                            >
                                            <ShouldRender if={this.props.selectedIncidentPriority !== incidentPriority._id}>
                                            <div className="Box-root"
                                                style={{
                                                    marginRight:'10px'
                                                }}
                                            >
                                                    <button
                                                        id={`priorityEdit_${incidentPriority.name}_${index}`}
                                                        className="Button bs-ButtonLegacy"
                                                        type="button"
                                                        onClick={() =>
                                                            this.props.updateDefaultIncidentSettings(
                                                                incidentPriority._id
                                                            )
                                                        }
                                                    >
                                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                <span>
                                                                    Set as Default
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </button>
                                                </div>
                                                </ShouldRender>
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
                                                            if (
                                                                this.props
                                                                    .selectedIncidentPriority ===
                                                                incidentPriority._id
                                                            )
                                                                this.props.openModal(
                                                                    {
                                                                        id: uuidv4(),
                                                                        content: MessageBox,
                                                                        title:
                                                                            'Warning',
                                                                        message:
                                                                            'This incident priority is marked as default and cannot be deleted.',
                                                                    }
                                                                );
                                                            else
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
    updateDefaultIncidentSettings: PropTypes.func.isRequired,
    handleDeleteIncidentPriority: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    selectedIncidentPriority: PropTypes.string.isRequired,
};
const mapStateToProps = state =>{
    return{
        currentProject: state.project.currentProject,
    }
}
const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            openModal, 
            updateDefaultIncidentSettings
        },
        dispatch
    );

export const IncidentPrioritiesList = connect(
    mapStateToProps,
    mapDispatchToProps
)(IncidentPrioritiesListClass);
