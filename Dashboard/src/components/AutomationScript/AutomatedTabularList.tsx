import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { openModal } from 'CommonUI/actions/modal';
import ShouldRender from '../basic/ShouldRender';
import moment from 'moment';

import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import { bindActionCreators, Dispatch } from 'redux';
import RunAutomationScript from '../modals/RunAutomationScript';
import { fetchAutomatedScript } from '../../actions/automatedScript';

interface AutomatedTabularListProps {
    scriptsObj?: object;
    history: object;
    openModal?: Function;
    currentProject?: object;
    fetchAutomatedScript?: Function;
    toggleNewScript?: Function;
    subProjectName?: string;
    showProjectName?: boolean;
}

const AutomatedTabularList = (props: AutomatedTabularListProps) => {
    const [automatedId] = useState(uuidv4);
    const { scripts, count, requesting } = props.scriptsObj;
    let { skip, limit } = props.scriptsObj;
    const projectId = props.currentProject && props.currentProject._id;
    const pathName = props.history.location.pathname;

    const handleNewScript = (e: $TSFixMe) => {
        if (e.keyCode === 78) {
            props.toggleNewScript();
        }
    };

    useEffect(() => {
        window.addEventListener('keydown', handleNewScript);

        return () => {
            window.removeEventListener('keydown', handleNewScript);
        };
    }, [handleNewScript]);

    if (skip && typeof skip === 'string') {
        skip = parseInt(skip, 10);
    }
    if (limit && typeof limit === 'string') {
        limit = parseInt(limit, 10);
    }
    if (!skip) skip = 0;
    if (!limit) limit = 0;

    let canNext = count && count > skip + limit ? true : false;
    let canPrev = skip <= 0 ? false : true;

    if (requesting || !scripts) {
        canNext = false;
        canPrev = false;
    }

    const nextClicked = async () => {
        const projectId = props.currentProject && props.currentProject._id;
        const { skip } = props.scriptsObj;
        await props.fetchAutomatedScript(
            projectId,
            parseInt(skip, 10) + 10,
            10
        );
    };

    const prevClicked = async () => {
        const projectId = props.currentProject && props.currentProject._id;
        const { skip } = props.scriptsObj;
        await props.fetchAutomatedScript(
            projectId,
            parseInt(skip, 10) - 10,
            10
        );
    };

    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div>
                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="bs-script-display">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                        <span
                                            style={{
                                                textTransform: 'capitalize',
                                            }}
                                        >
                                            Automation Script{' '}
                                            <span
                                                style={{
                                                    textTransform: 'lowercase',
                                                }}
                                            >
                                                for
                                            </span>{' '}
                                            {props.showProjectName
                                                ? props.subProjectName
                                                : props.currentProject.name}
                                        </span>
                                    </span>
                                    <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Automated script are script created
                                            for yor project
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <div>
                                <button
                                    className="bs-Button bs-DeprecatedButton"
                                    title="New Script"
                                    disabled={false}
                                    onClick={props.toggleNewScript}
                                >
                                    <span>New Script</span>
                                    <span className="new-btn__keycode">N</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div
                    className="Box-root"
                    style={{ overflow: 'hidden', overflowX: 'auto' }}
                >
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
                                            <span>Name</span>
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
                                            <span>Script Type</span>
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
                                            <span>Last ran at</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 bs-table-display-end">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Action</span>
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {scripts.length > 0 &&
                                scripts.map((script: $TSFixMe, index: $TSFixMe) => (
                                    <tr
                                        key={index}
                                        className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                        style={{
                                            height: '50px',
                                            width: '100%',
                                        }}
                                    >
                                        <td
                                            className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{
                                                height: '1px',
                                                minWidth: '210px',
                                            }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                {script.name}
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{
                                                height: '1px',
                                                minWidth: '210px',
                                            }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                {script.scriptType}
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{
                                                height: '1px',
                                                minWidth: '210px',
                                            }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <ShouldRender
                                                    if={
                                                        script.createdAt ===
                                                        script.updatedAt
                                                    }
                                                >
                                                    <span>
                                                        {moment(
                                                            script.createdAt
                                                        ).format(
                                                            'MMMM Do YYYY, h:mm a'
                                                        )}
                                                    </span>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        script.updatedAt >
                                                        script.createdAt
                                                    }
                                                >
                                                    <span>
                                                        {moment(
                                                            script.updatedAt
                                                        ).format(
                                                            'MMMM Do YYYY, h:mm a'
                                                        )}
                                                    </span>
                                                </ShouldRender>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{
                                                height: '1px',
                                            }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8 bs-table-display-end">
                                                <button
                                                    className="bs-Button bs-Button--icon bs-Button--play"
                                                    title="run"
                                                    disabled={false}
                                                    onClick={() =>
                                                        props.openModal({
                                                            id: automatedId,
                                                            content: DataPathHoC(
                                                                RunAutomationScript,
                                                                {
                                                                    automatedScriptId:
                                                                        script._id,
                                                                    projectId,
                                                                    automatedSlug:
                                                                        script.slug,
                                                                    navigate: true,
                                                                }
                                                            ),
                                                        })
                                                    }
                                                >
                                                    <span>Run</span>
                                                </button>
                                                <button
                                                    className="bs-Button bs-DeprecatedButton"
                                                    title="view"
                                                    disabled={false}
                                                    onClick={() => {
                                                        props.history.push({
                                                            pathname: `${pathName}/${script.slug}`,
                                                        });
                                                    }}
                                                >
                                                    <span>View</span>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                    <ShouldRender if={scripts.length < 1}>
                        <div
                            style={{ textAlign: 'center', paddingTop: '15px' }}
                        >
                            You don&apos;t have any scripts so far.
                        </div>
                    </ShouldRender>
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <ShouldRender if={count}>
                                        <span id="numberOfSubscribers">
                                            {count}
                                        </span>{' '}
                                        {count && count > 1
                                            ? 'Scripts'
                                            : 'Script'}
                                    </ShouldRender>
                                </span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnPrevSubscriber"
                                    onClick={prevClicked}
                                    className={'Button bs-ButtonLegacy'}
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
                                    id="btnNextSubscriber"
                                    onClick={nextClicked}
                                    className={'Button bs-ButtonLegacy'}
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
    );
};

AutomatedTabularList.propTypes = {
    scriptsObj: PropTypes.object,
    history: PropTypes.object.isRequired,
    openModal: PropTypes.func,
    currentProject: PropTypes.object,
    fetchAutomatedScript: PropTypes.func,
    toggleNewScript: PropTypes.func,
    subProjectName: PropTypes.string,
    showProjectName: PropTypes.bool,
};

const mapStateToProps = (state: RootState) => {
    return {
        scriptsObj: state.automatedScripts.fetchScripts,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ openModal, fetchAutomatedScript }, dispatch);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(AutomatedTabularList);
