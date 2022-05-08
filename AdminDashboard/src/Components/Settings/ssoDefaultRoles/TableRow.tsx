import React from 'react';
import moment from 'moment';
import {
    fetchSsoDefaultRole,
    deleteSsoDefaultRole,
} from '../../../actions/ssoDefaultRoles';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { openModal } from '../../../actions/Modal';
import RoleDeleteModal from './RoleDeleteModal';
import { UpdateDefaultRoleModal } from './DefaultRoleModal';
import PropTypes from 'prop-types';

const TableRow: Function = ({
    data,
    fetchSsoDefaultRole,
    deleteSsoDefaultRole,
    openModal
}: $TSFixMe) => (
    <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink">
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
            style={{
                height: '1px',
                minWidth: '270px',
            }}
        >
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                    <div className="Box-root Margin-right--16">
                        <span>{data && data.domain && data.domain.domain}</span>
                    </div>
                </span>
            </div>
        </td>
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
            style={{
                height: '1px',
                minWidth: '270px',
            }}
        >
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                    <div className="Box-root Margin-right--16">
                        <span>
                            {data && data.project && (
                                <>
                                    {data.project._id}/
                                    <br />
                                    {data.project.name}
                                </>
                            )}
                        </span>
                    </div>
                </span>
            </div>
        </td>
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
            style={{
                height: '1px',
                minWidth: '130px',
            }}
        >
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                    <div className="Box-root Margin-right--16">
                        <span>{data && data.role}</span>
                    </div>
                </span>
            </div>
        </td>

        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
            style={{ height: '1px' }}
        >
            <div className="db-ListViewItem-link">
                <button
                    className="bs-Button bs-Button--blue Box-background--blue edit-button"
                    onClick={() => {
                        fetchSsoDefaultRole(data && data._id);
                        openModal({
                            onConfirm: async () => {
                                return await deleteSsoDefaultRole(
                                    data && data._id
                                );
                            },
                            content: UpdateDefaultRoleModal,
                        });
                    }}
                >
                    Edit
                </button>
                <button
                    className="bs-Button bs-Button--red Box-background--red delete-button"
                    onClick={() =>
                        openModal({
                            onConfirm: async () => {
                                return await deleteSsoDefaultRole(
                                    data && data._id
                                );
                            },
                            content: RoleDeleteModal,
                        })
                    }
                >
                    Delete
                </button>
            </div>
        </td>
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
            style={{ height: '1px' }}
        >
            <div className="db-ListViewItem-link">
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    {data && data.createdAt && moment(data.createdAt).fromNow()}
                </div>
            </div>
        </td>
        <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"></td>
    </tr>
);

TableRow.displayName = 'ssoDefaultTableRow';

TableRow.propTypes = {
    data: PropTypes.object,
    fetchSsoDefaultRole: PropTypes.func,
    deleteSsoDefaultRole: PropTypes.func,
    openModal: PropTypes.func,
};
export default connect(null, dispatch =>
    bindActionCreators(
        {
            openModal,
            fetchSsoDefaultRole,
            deleteSsoDefaultRole,
        },
        dispatch
    )
)(TableRow);
