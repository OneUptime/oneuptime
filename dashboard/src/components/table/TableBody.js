
import React, { Component } from 'react';
import TableColumns from './TableColumns';

export default class TableDescription extends Component {

    constructor(props) {
        super(props);
    }

    render() {
        const { columns } = this.props;

        return (
            <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                

                                <ShouldRender if={!props.switchToProjectViewerNav}>
                                    <td>
                                        <div className="bs-ObjectList-cell Text-typeface--upper Text-fontWeight--medium">
                                            Monitors
                                        </div>
                                    </td>
                                </ShouldRender>

                                <td
                                    colSpan="6"
                                    style={{ float: 'right' }}
                                    className="status-page-btn-action-col"
                                >
                                    <div
                                        className="bs-ObjectList-cell table-row-cell Text-typeface--upper Text-fontWeight--medium"
                                        style={{
                                            paddingLeft: '124px',
                                            paddingRight: '24px',
                                        }}
                                    >
                                        Actions
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody id="statusPagesListContainer">
                            {statusPages.map((o, i) => {
                                return (
                                    <StatusPage
                                        projectId={props.currentProjectId}
                                        switchStatusPages={props.switchStatusPages}
                                        key={i}
                                        statusPage={o}
                                        project={props.project}
                                        switchToProjectViewerNav={
                                            props.switchToProjectViewerNav
                                        }
                                    />
                                );
                            })}
                        </tbody>
                    </table>
                </div>
        )
    }
}



