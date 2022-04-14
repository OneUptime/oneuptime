import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { IS_LOCALHOST, User } from '../../config';
import isSubProjectViewer from '../../utils/isSubProjectViewer';
import ShouldRender from '../basic/ShouldRender';

interface RowDataProps {
    statusPage: object;
    switchStatusPages: Function;
    project?: object;
    switchToProjectViewerNav?: boolean;
}

export class RowData extends Component<RowDataProps>{
    public static displayName = '';
    public static propTypes = {};
    override render() {

        const { statusPage, project }: $TSFixMe = this.props;
        const userId: $TSFixMe = User.getUserId();
        const monitorIds: $TSFixMe = statusPage.monitorNames;
        const gt: Function = (i: $TSFixMe) => monitorIds && monitorIds.length > i;
        let monitors = gt(0) ? monitorIds[0] : 'Not Yet Added';
        monitors += gt(1)
            ? ` and ${monitorIds.length - 1} other${gt(2) ? 's' : ''}`
            : '';
        const path:string: $TSFixMe = `/dashboard/project/${project.slug}/StatusPage/${statusPage.slug}`;
        let publicStatusPageurl: URL, statusPageSlug;
        if (statusPage) {
            statusPageSlug = statusPage.slug;
        }

        if (IS_LOCALHOST) {
            publicStatusPageUrl = `http://${statusPageSlug}.localhost:3006`;
        } else {
            publicStatusPageUrl =
                window.location.origin + '/StatusPage/' + statusPageSlug;
        }

        return (
            <tr
                className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink statusPageListItem"
                onClick={() => {
                    isSubProjectViewer(userId, project)
                        ? window.open(publicStatusPageUrl, '_blank')

                        : this.props.switchStatusPages(statusPage, path);
                }}
            >
                <td
                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                    style={{ height: '1px', minWidth: '270px' }}
                >
                    <div className="bs-ObjectList-cell bs-u-v-middle">
                        <div
                            className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted"
                            id={`viewStatusPage_${statusPage.name}`}
                        >
                            {statusPage.name || 'Unknown'}
                        </div>
                        {statusPage.domains.length > 0 ? (
                            <div
                                id="domainSet"
                                className="bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted"
                            >
                                {statusPage.domains[0].domain}
                            </div>
                        ) : (
                            <div
                                id="domainNotSet"
                                className="bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted"
                            >
                                Domain(s) not set yet
                            </div>
                        )}
                    </div>
                </td>
                <td
                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                    style={{ height: '1px', minWidth: '270px' }}
                >
                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                        <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <div className="Box-root Margin-right--16">
                                <span>
                                    {statusPage.description ||
                                        'No description added'}
                                </span>
                            </div>
                        </span>
                    </div>
                </td>

                <ShouldRender if={!this.props.switchToProjectViewerNav}>
                    <td
                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                        style={{ height: '1px', minWidth: '270px' }}
                    >
                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                            <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <div className="Box-root Margin-right--16">
                                    <span>{monitors}</span>
                                </div>
                            </span>
                        </div>
                    </td>
                </ShouldRender>

                <td
                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                    style={{ height: '1px', minWidth: '270px' }}
                >
                    <div
                        className="db-ListViewItem-cellContent Box-root Padding-all--8 table-view-item-btn-cell"
                        style={{ display: 'flex', justifyContent: 'flex-end' }}
                    >
                        <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <div
                                className="Box-root"
                                style={{ marginRight: '4px' }}
                            >
                                <button className="Button" id="viewStatusPage">
                                    <span className="bs-Button">
                                        View Status Page
                                    </span>
                                </button>
                            </div>
                        </span>
                    </div>
                </td>
            </tr>
        );
    }
}


RowData.displayName = 'StatusPage RowData';


RowData.propTypes = {
    statusPage: PropTypes.object.isRequired,
    switchStatusPages: PropTypes.func.isRequired,
    project: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({}, dispatch);

export default connect(null, mapDispatchToProps)(RowData);
