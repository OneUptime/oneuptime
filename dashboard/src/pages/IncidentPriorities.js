import React from 'react';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import Dashboard from '../components/Dashboard';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { IncidentPrioritiesList } from '../components/incident/IncidentPrioritiesList';
import { openModal, closeModal } from '../actions/modal';
import CreateIncidentPriorityForm from '../components/modals/CreateIncidentPriority';
import EditIncidentPriorityForm from '../components/modals/EditIncidentPriority';
import RemoveIncidentPriorityForm from '../components/modals/RemoveIncidentPriority';
import { fetchIncidentPriorities } from '../actions/incidentPriorities';
import DataPathHoC from '../components/DataPathHoC';

class IncidentPriorities extends React.Component {
    handleCreateNewIncidentPriority() {
        const { openModal } = this.props;
        openModal({
            content: CreateIncidentPriorityForm,
        });
    }

    handleEditIncidentPriority(id) {
        const { openModal } = this.props;
        openModal({
            content: DataPathHoC(EditIncidentPriorityForm, {
                selectedIncidentPriority: id,
            }),
        });
    }

    handleDeleteIncidentPriority(id) {
        const { openModal } = this.props;
        openModal({
            content: DataPathHoC(RemoveIncidentPriorityForm, {
                selectedIncidentPriority: id,
            }),
        });
    }
    async ready() {
        await this.props.fetchIncidentPriorities(this.props.currentProject._id);
    }

    prevClicked() {
        const { skip, limit } = this.props.incidentPrioritiesList;
        this.props.fetchIncidentPriorities(
            this.props.currentProject._id,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );
    }
    nextClicked() {
        const { skip, limit } = this.props.incidentPrioritiesList;
        this.props.fetchIncidentPriorities(
            this.props.currentProject._id,
            skip + limit,
            10
        );
    }
    render() {
        const {
            location: { pathname },
        } = this.props;
        const { skip, limit, count } = this.props.incidentPrioritiesList;
        const canPaginateForward =
            !this.props.incidentPrioritiesList.requesting &&
            count &&
            count > skip + limit
                ? true
                : false;
        const canPaginateBackward =
            !this.props.incidentPrioritiesList.requesting && skip && skip > 0
                ? true
                : false;

        return (
            <Dashboard ready={() => this.ready()}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <BreadCrumbItem route={pathname} name="Incident Settings" />
                    <div className="Box-root Margin-vertical--12">
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                <div className="Box-root">
                                    <div>
                                        <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                    <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                        <span>Priorities</span>
                                                    </span>
                                                    <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <span>DESCRIPTION</span>
                                                    </span>
                                                </div>
                                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                    <div className="Box-root">
                                                        <button
                                                            id="addNewPriority"
                                                            className="Button bs-ButtonLegacy ActionIconParent"
                                                            type="button"
                                                            onClick={() =>
                                                                this.handleCreateNewIncidentPriority()
                                                            }
                                                        >
                                                            <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                <div className="Box-root Margin-right--8">
                                                                    <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                                                </div>
                                                                <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                                    <span>
                                                                        Add
                                                                        Priority
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <IncidentPrioritiesList
                                            incidentPrioritiesList={
                                                this.props.incidentPriorities
                                            }
                                            handleEditIncidentPriority={id =>
                                                this.handleEditIncidentPriority(
                                                    id
                                                )
                                            }
                                            handleDeleteIncidentPriority={id =>
                                                this.handleDeleteIncidentPriority(
                                                    id
                                                )
                                            }
                                        />
                                    </div>
                                    <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                        <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    <span
                                                        id="status_page_count_Unnamed Project"
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                                    >
                                                        {
                                                            this.props
                                                                .incidentPriorities
                                                                .length
                                                        }{' '}
                                                        Priorit
                                                        {this.props
                                                            .incidentPriorities
                                                            .length === 1
                                                            ? 'y'
                                                            : 'ies'}
                                                    </span>
                                                </span>
                                            </span>
                                        </div>
                                        <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                                <div className="Box-root Margin-right--8">
                                                    <button
                                                        id="btnPrev"
                                                        className={`Button bs-ButtonLegacy ${
                                                            !canPaginateBackward
                                                                ? 'Is--disabled'
                                                                : ''
                                                        }`}
                                                        data-db-analytics-name="list_view.pagination.previous"
                                                        disabled={
                                                            !canPaginateBackward
                                                        }
                                                        type="button"
                                                        onClick={() =>
                                                            this.prevClicked()
                                                        }
                                                    >
                                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                <span>
                                                                    Previous
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </button>
                                                </div>
                                                <div className="Box-root">
                                                    <button
                                                        id="btnNext"
                                                        className={`Button bs-ButtonLegacy ${
                                                            !canPaginateForward
                                                                ? 'Is--disabled'
                                                                : ''
                                                        }`}
                                                        data-db-analytics-name="list_view.pagination.next"
                                                        disabled={
                                                            !canPaginateForward
                                                        }
                                                        type="button"
                                                        onClick={() =>
                                                            this.nextClicked()
                                                        }
                                                    >
                                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                <span>
                                                                    Next
                                                                </span>
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
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

IncidentPriorities.displayName = 'IncidentPriorities';
IncidentPriorities.propTypes = {
    openModal: PropTypes.func.isRequired,
    fetchIncidentPriorities: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    incidentPrioritiesList: PropTypes.object.isRequired,
    location: PropTypes.object.isRequired,
    incidentPriorities: PropTypes.array.isRequired,
};
const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
        incidentPriorities:
            state.incidentPriorities.incidentPrioritiesList.incidentPriorities,
        incidentPrioritiesList: state.incidentPriorities.incidentPrioritiesList,
    };
};
const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            openModal,
            closeModal,
            fetchIncidentPriorities,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(IncidentPriorities);
