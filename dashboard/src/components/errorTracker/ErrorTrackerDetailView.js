import React, { Component } from 'react';
import Dropdown, { MenuItem } from '@trendmicro/react-dropdown';
import ErrorTrackerIssue from './ErrorTrackerIssue';
import { connect } from 'react-redux';
import { ListLoader } from '../basic/Loader';
import PropTypes from 'prop-types';

class ErrorTrackerDetailView extends Component {
    render() {
        const {
            errorTrackerIssues,
            errorTracker,
            projectId,
            componentId,
        } = this.props;
        return (
            <div>
                <div
                    style={{
                        overflow: 'hidden',
                        overflowX: 'auto',
                    }}
                >
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                    }}
                                >
                                    <div
                                        className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexEnd Flex-alignItems--center"
                                        style={{
                                            height: '100%',
                                        }}
                                    >
                                        <input type="checkbox" />
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        minWidth: '350px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex">
                                        <button
                                            className="bs-Button bs-Button--icon bs-Button--check"
                                            type="button"
                                        >
                                            <span>Resolve</span>
                                            <img
                                                src="/dashboard/assets/img/down.svg"
                                                alt=""
                                                style={{
                                                    margin: '0px 10px',
                                                    height: '10px',
                                                    width: '10px',
                                                }}
                                            />
                                        </button>
                                        <button
                                            className="bs-Button bs-Button--icon bs-Button--block"
                                            type="button"
                                        >
                                            <span>Ignore</span>
                                            <img
                                                src="/dashboard/assets/img/down.svg"
                                                alt=""
                                                style={{
                                                    margin: '0px 10px',
                                                    height: '10px',
                                                    width: '10px',
                                                }}
                                            />
                                        </button>
                                        <button
                                            className="bs-Button"
                                            type="button"
                                            disabled={true}
                                        >
                                            <span>Merge</span>
                                        </button>
                                        <span className="Margin-left--8">
                                            <Dropdown>
                                                <Dropdown.Toggle
                                                    id="filterToggle"
                                                    className="bs-Button bs-DeprecatedButton"
                                                />
                                                <Dropdown.Menu>
                                                    <MenuItem title="clear">
                                                        Clear Filters
                                                    </MenuItem>
                                                    <MenuItem title="unacknowledged">
                                                        Unacknowledged
                                                    </MenuItem>
                                                    <MenuItem title="unresolved">
                                                        Unresolved
                                                    </MenuItem>
                                                </Dropdown.Menu>
                                            </Dropdown>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--spaceBetween">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Graph</span>
                                        </span>
                                        <div className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-wrap--wrap">
                                            <span className="Padding-right--8">
                                                24h
                                            </span>
                                            <span className="Text-color--slate">
                                                14d
                                            </span>
                                        </div>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--center">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Events</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--center">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Users</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--center">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Assigned To</span>
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {errorTrackerIssues &&
                            errorTrackerIssues.errorTrackerIssues &&
                            errorTrackerIssues.errorTrackerIssues.length > 0 ? (
                                errorTrackerIssues.errorTrackerIssues.map(
                                    (errorTrackerIssue, i) => {
                                        return (
                                            <ErrorTrackerIssue
                                                errorTrackerIssue={
                                                    errorTrackerIssue
                                                }
                                                errorTracker={errorTracker}
                                                key={i}
                                                projectId={projectId}
                                                componentId={componentId}
                                            />
                                        );
                                    }
                                )
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                    {errorTrackerIssues && errorTrackerIssues.requesting ? (
                        <ListLoader />
                    ) : null}
                </div>
                <div
                    style={{
                        textAlign: 'center',
                        padding: '10px',
                    }}
                >
                    {!errorTrackerIssues ||
                    (errorTrackerIssues &&
                        (!errorTrackerIssues.errorTrackerIssues ||
                            !errorTrackerIssues.errorTrackerIssues.length) &&
                        !errorTrackerIssues.requesting &&
                        !errorTrackerIssues.error)
                        ? "We don't have any tracked error event yet"
                        : null}
                    {errorTrackerIssues && errorTrackerIssues.error
                        ? errorTrackerIssues.error
                        : null}
                </div>
            </div>
        );
    }
}

function mapStateToProps(state, ownProps) {
    // get current error event tracker
    const errorTracker = ownProps.errorTracker;
    // get its list of error tracker issues
    const errorTrackerIssues =
        state.errorTracker.errorTrackerIssues[errorTracker._id];
    return {
        errorTrackerIssues,
    };
}
ErrorTrackerDetailView.propTypes = {
    errorTrackerIssues: PropTypes.object,
    errorTracker: PropTypes.object,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
};
ErrorTrackerDetailView.displayName = 'ErrorTrackerDetailView';
export default connect(mapStateToProps, null)(ErrorTrackerDetailView);
