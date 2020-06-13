import React from 'react';
import PropTypes from 'prop-types';

const ProcessedDescription = text => {
    if (!text || typeof text !== 'string') return text;

    const tempArr = text.split(/\[Learn more\]/i);
    return (
        <span>
            {tempArr && tempArr[0]}{' '}
            {tempArr && tempArr[1] ? (
                <a
                    href={tempArr[1].replace(/^\(|\)|\.$/gi, '')}
                    rel="noopener noreferrer"
                    target="_blank"
                >
                    <b>Learn more.</b>
                </a>
            ) : null}
        </span>
    );
};

ProcessedDescription.displayName = 'ProcessedDescription';

const WebsiteIssuesList = ({ monitorIssue }) => {
    return (
        <div>
            <table className="Table">
                <thead className="Table-body">
                    <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                        <td
                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                            style={{ height: '1px', minWidth: '210px' }}
                        >
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                    <span>Title</span>
                                </span>
                            </div>
                        </td>
                        <td
                            className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                            style={{ height: '1px' }}
                        >
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                    <span>Description</span>
                                </span>
                            </div>
                        </td>
                    </tr>
                </thead>
                <tbody className="Table-body">
                    {monitorIssue.data && monitorIssue.data.length > 0 ? (
                        monitorIssue.data.map((issue, i) => {
                            return (
                                <tr
                                    id={`incident_timeline_${i}`}
                                    key={i}
                                    className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                >
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                        style={{
                                            height: '1px',
                                            width: '30%',
                                        }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                {issue.title}
                                            </span>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                        style={{ height: '1px', width: '70%' }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                {ProcessedDescription(
                                                    issue.description
                                                )}
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })
                    ) : (
                        <tr></tr>
                    )}
                </tbody>
            </table>

            <div
                style={{
                    textAlign: 'center',
                    marginTop: '10px',
                    padding: '10px 20px 20px',
                }}
            >
                {!monitorIssue.data || !monitorIssue.data.length
                    ? "We don't have any activity yet"
                    : null}
            </div>
        </div>
    );
};

WebsiteIssuesList.displayName = 'IncidentTimelineList';

WebsiteIssuesList.propTypes = {
    monitorIssue: PropTypes.object,
};

export default WebsiteIssuesList;
