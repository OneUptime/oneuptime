import React from 'react';
const TableHeader: Function = () => (
    <thead className="Table-body">
        <tr className="Table-row db-ListViewItem db-ListViewItem-header">
            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                style={{
                    height: '1px',
                    minWidth: '270px',
                }}
            >
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                        <span>domain</span>
                    </span>
                </div>
            </td>
            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                style={{
                    height: '1px',
                    minWidth: '270px',
                }}
            >
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                        <span>Project</span>
                    </span>
                </div>
            </td>
            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                style={{
                    height: '1px',
                    minWidth: '130px',
                }}
            >
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                        <span>Role</span>
                    </span>
                </div>
            </td>

            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                style={{ height: '1px' }}
            >
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                        <span>actions</span>
                    </span>
                </div>
            </td>
            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                style={{ height: '1px' }}
            >
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                        <span>Created At</span>
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
);

TableHeader.displayName = 'TableHeader';

export default TableHeader;
