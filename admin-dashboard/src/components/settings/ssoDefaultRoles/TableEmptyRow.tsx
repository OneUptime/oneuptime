import React from 'react';

const TableEmptyRow = () => (
    <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink">
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
            style={{
                height: '1px',
                minWidth: '270px',
            }}
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
            colSpan="5"
        >
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                    <div
                        id="no-sso-message"
                        style={{
                            textAlign: 'center',
                            marginTop: '10px',
                        }}
                        className="Box-root Margin-right--16"
                    >
                        <span>No Roles created yet</span>
                    </div>
                </span>
            </div>
        </td>
    </tr>
);

TableEmptyRow.displayName = 'TableEmptyRow';

export default TableEmptyRow;
