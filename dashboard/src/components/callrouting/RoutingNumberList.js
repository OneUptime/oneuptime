import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { openModal, closeModal } from '../../actions/modal';
import { removeNumbers } from '../../actions/callRouting';
import ConfirmNumberDeleteModal from './ConfirmNumberDeleteModal';
import AddScheduleModal from './AddScheduleModal';
import { Spinner, FormLoader } from '../basic/Loader';
import DataPathHoC from '../DataPathHoC';
import ShouldRender from '../basic/ShouldRender';

export class RoutingNumberList extends Component {
    removeNumber = async callRoutingId => {
        const { currentProject, removeNumbers } = this.props;
        removeNumbers(currentProject._id, callRoutingId);
    };
    getName = number => {
        const { teamMembers, schedules } = this.props;
        const type =
            number &&
            number.routingSchema &&
            number.routingSchema.type &&
            number.routingSchema.type.length
                ? number.routingSchema.type
                : null;
        const id =
            number &&
            number.routingSchema &&
            number.routingSchema.id &&
            number.routingSchema.id.length
                ? number.routingSchema.id
                : null;
        if (type && type === 'TeamMember' && id) {
            const teamMember = teamMembers.find(t => t.userId === id);
            if (teamMember && teamMember.name && teamMember.name.length) {
                return {
                    result: `${teamMember.name} (Team Member)`,
                };
            } else return { result: 'No scheduled added yet' };
        } else if (type && type === 'Schedule' && id) {
            const schedule = schedules.find(s => s._id === id);
            if (schedule && schedule.name && schedule.name.length) {
                return {
                    result: `${schedule.name} (On-Call Duty)`,
                };
            } else return { result: 'No scheduled added yet' };
        } else return { result: 'No scheduled added yet' };
    };
    render() {
        const {
            callRoutingNumbers,
            removeNumber,
            openModal,
            allNumbers,
        } = this.props;
        const _this = this;
        const isRequesting = allNumbers && allNumbers.requesting;
        const count =
            callRoutingNumbers && callRoutingNumbers.length
                ? callRoutingNumbers.length
                : 0;
        const canNext = false;
        const canPrev = false;
        return (
            <div>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        minWidth: '210px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Phone Number</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        minWidth: '210px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Call Routing To</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    id="overflow"
                                    type="action"
                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Actions</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    id="overflow"
                                    type="action"
                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {!isRequesting &&
                            callRoutingNumbers &&
                            callRoutingNumbers.length > 0 ? (
                                callRoutingNumbers.map((number, i) => {
                                    const { result } = _this.getName(number);
                                    return (
                                        <tr
                                            id={`routing_number_${number._id}_${i}`}
                                            key={number._id}
                                            className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                        >
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                style={{
                                                    height: '1px',
                                                    minWidth: '210px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root Margin-right--16">
                                                            <span>
                                                                {
                                                                    number.phoneNumber
                                                                }
                                                            </span>
                                                        </div>
                                                    </span>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                style={{
                                                    height: '1px',
                                                    minWidth: '210px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root Margin-right--16">
                                                            <span>
                                                                {result}
                                                            </span>
                                                        </div>
                                                    </span>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                    minWidth: '210px',
                                                }}
                                            ></td>
                                            <td
                                                className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Flex">
                                                                <div className="Box-root Flex-flex">
                                                                    <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                        <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                            <button
                                                                                title="addSchedule"
                                                                                id={`add_schedule_${number._id}`}
                                                                                disabled={
                                                                                    removeNumber &&
                                                                                    removeNumber.requesting &&
                                                                                    removeNumber.requesting ===
                                                                                        number._id
                                                                                }
                                                                                onClick={() =>
                                                                                    openModal(
                                                                                        {
                                                                                            id: number,
                                                                                            onClose: () =>
                                                                                                '',
                                                                                            onConfirm: () =>
                                                                                                '',
                                                                                            content: DataPathHoC(
                                                                                                AddScheduleModal,
                                                                                                {
                                                                                                    number:
                                                                                                        number.phoneNumber,
                                                                                                    callRoutingId:
                                                                                                        number._id,
                                                                                                }
                                                                                            ),
                                                                                        }
                                                                                    )
                                                                                }
                                                                                className="bs-Button bs-DeprecatedButton"
                                                                                type="button"
                                                                            >
                                                                                <span>
                                                                                    Edit
                                                                                    Call
                                                                                    Routing
                                                                                </span>
                                                                            </button>
                                                                            <button
                                                                                title="removeNumber"
                                                                                id={`remove_number_${number._id}`}
                                                                                disabled={
                                                                                    removeNumber &&
                                                                                    removeNumber.requesting &&
                                                                                    removeNumber.requesting ===
                                                                                        number._id
                                                                                }
                                                                                onClick={() =>
                                                                                    openModal(
                                                                                        {
                                                                                            id: number,
                                                                                            onClose: () =>
                                                                                                '',
                                                                                            onConfirm: () =>
                                                                                                this.removeNumber(
                                                                                                    number._id
                                                                                                ),
                                                                                            content: ConfirmNumberDeleteModal,
                                                                                        }
                                                                                    )
                                                                                }
                                                                                className={
                                                                                    removeNumber &&
                                                                                    removeNumber.requesting &&
                                                                                    removeNumber.requesting ===
                                                                                        number._id
                                                                                        ? 'bs-Button bs-Button--blue'
                                                                                        : 'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete Margin-left--8'
                                                                                }
                                                                                type="button"
                                                                            >
                                                                                <ShouldRender
                                                                                    if={
                                                                                        removeNumber &&
                                                                                        removeNumber.requesting &&
                                                                                        removeNumber.requesting ===
                                                                                            number._id
                                                                                    }
                                                                                >
                                                                                    <FormLoader />
                                                                                </ShouldRender>
                                                                                <ShouldRender
                                                                                    if={
                                                                                        !(
                                                                                            removeNumber &&
                                                                                            removeNumber.requesting &&
                                                                                            removeNumber.requesting ===
                                                                                                number._id
                                                                                        )
                                                                                    }
                                                                                >
                                                                                    <span>
                                                                                        Release
                                                                                        Number
                                                                                    </span>
                                                                                </ShouldRender>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"></td>
                                        </tr>
                                    );
                                })
                            ) : isRequesting ? (
                                <tr>
                                    <td
                                        colSpan="5"
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    >
                                        <div
                                            className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Padding-vertical--2"
                                            style={{
                                                boxShadow: 'none',
                                            }}
                                        >
                                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                <div
                                                    className="db-Trend"
                                                    style={{
                                                        height: '100%',
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    <div className="block-chart-side line-chart">
                                                        <div className="db-TrendRow">
                                                            <div
                                                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                                                style={{
                                                                    textAlign:
                                                                        'center',
                                                                    width:
                                                                        '100%',
                                                                    fontSize: 14,
                                                                }}
                                                            >
                                                                <Spinner
                                                                    style={{
                                                                        stroke:
                                                                            '#8898aa',
                                                                    }}
                                                                />{' '}
                                                                <span
                                                                    style={{
                                                                        width: 10,
                                                                    }}
                                                                />
                                                                We are currently
                                                                fetching your
                                                                number please
                                                                wait.
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div
                    style={{
                        textAlign: 'center',
                        marginTop: '10px',
                        padding: '0 10px',
                    }}
                >
                    {!callRoutingNumbers ||
                    (callRoutingNumbers && !callRoutingNumbers.length)
                        ? 'You have not added any phone numbers yet'
                        : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {count
                                        ? count +
                                          (count > 1 ? ' Numbers' : ' Number')
                                        : '0 Numbers'}
                                </span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnPrev"
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
                                    id="btnNext"
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
        );
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        { openModal, closeModal, removeNumbers },
        dispatch
    );
};

function mapStateToProps(state) {
    const teamMembersAndSchedules = state.callRouting.teamMembersAndSchedules;
    const teamMembers = teamMembersAndSchedules.teamMembers;
    const schedules = teamMembersAndSchedules.schedules;
    const project = state.project.currentProject;
    const numbers =
        state.callRouting.allNumbers && state.callRouting.allNumbers.numbers
            ? state.callRouting.allNumbers.numbers
            : [];
    return {
        currentProject: project,
        callRoutingNumbers: numbers,
        allNumbers: state.callRouting.allNumbers,
        removeNumber: state.callRouting.removeNumber,
        teamMembers,
        schedules,
    };
}

RoutingNumberList.displayName = 'RoutingNumberList';

RoutingNumberList.propTypes = {
    allNumbers: PropTypes.shape({
        requesting: PropTypes.any,
    }),
    callRoutingNumbers: PropTypes.shape({
        length: PropTypes.number,
        map: PropTypes.func,
        phoneNumber: PropTypes.shape({
            length: PropTypes.any,
        }),
    }),
    currentProject: PropTypes.shape({
        _id: PropTypes.any,
    }),
    openModal: PropTypes.func,
    removeNumber: PropTypes.shape({
        requesting: PropTypes.any,
    }),
    removeNumbers: PropTypes.func,
    schedules: PropTypes.shape({
        find: PropTypes.func,
    }),
    teamMembers: PropTypes.shape({
        find: PropTypes.func,
    }),
};

export default connect(mapStateToProps, mapDispatchToProps)(RoutingNumberList);
