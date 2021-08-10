import React, { Component } from 'react';
import PropTypes from 'prop-types';
import DataPathHoC from '../DataPathHoC';
import { v4 as uuidv4 } from 'uuid';
import EditExternalStatusPageModal from '../modals/EditExternalStatusPageModal';
import RemoveExternalStatusPage from '../modals/RemoveExternalStatusPage';
import { openModal } from '../../actions/modal';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';

export class ExternalStatusPagesTable extends Component {
    state = {
        deleteExternalStatusPageModalId: uuidv4(),
    };
    render() {
        const { statusPage, openModal } = this.props;
        const { deleteExternalStatusPageModalId } = this.state;

        return (
            <div>
                <table className="Table">
                    <header className="bs-ObjectList-row bs-ObjectList-row--header">
                        <div className="bs-ObjectList-cell">Name</div>
                        <div className="bs-ObjectList-cell">URl</div>
                        <div
                            className="bs-ObjectList-cell"
                            style={{
                                float: 'right',
                                marginRight: '10px',
                            }}
                        >
                            Action
                        </div>
                    </header>
                    {statusPage.externalStatusPages.externalStatusPagesList.map(
                        (link, i) => {
                            return (
                                <div
                                    key={i}
                                    className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                    style={{
                                        backgroundColor: 'white',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <div className="bs-ObjectList-cell bs-u-v-middle bs-ActionsParent">
                                        <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">
                                            {link.name}
                                        </div>
                                    </div>
                                    <div className="bs-ObjectList-cell bs-u-v-middle">
                                        <div className="bs-ObjectList-cell-row">
                                            {link.url}
                                        </div>
                                    </div>

                                    <div
                                        className="bs-ObjectList-cell bs-u-v-middle"
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'flex-end',
                                            alignItems: 'center',
                                            paddingTop: '20px',
                                        }}
                                    >
                                        <button
                                            title="edit"
                                            className="bs-Button bs-DeprecatedButton"
                                            type="button"
                                            style={{
                                                float: 'right',
                                                marginLeft: 10,
                                            }}
                                            onClick={() =>
                                                openModal({
                                                    id: deleteExternalStatusPageModalId,
                                                    content: DataPathHoC(
                                                        EditExternalStatusPageModal,
                                                        { link }
                                                    ),
                                                })
                                            }
                                        >
                                            <span>Edit</span>
                                        </button>
                                        <button
                                            title="delete"
                                            className="bs-Button bs-DeprecatedButton"
                                            type="button"
                                            style={{
                                                float: 'right',
                                                marginLeft: 10,
                                            }}
                                            onClick={() => {
                                                openModal({
                                                    id: deleteExternalStatusPageModalId,
                                                    content: DataPathHoC(
                                                        RemoveExternalStatusPage,
                                                        { link }
                                                    ),
                                                });
                                            }}
                                        >
                                            <span>Delete</span>
                                        </button>
                                    </div>
                                </div>
                            );
                        }
                    )}
                </table>
            </div>
        );
    }
}

ExternalStatusPagesTable.displayName = 'ExternalStatusPagesTable';

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            openModal,
        },
        dispatch
    );
};

ExternalStatusPagesTable.propTypes = {
    statusPage: PropTypes.object,
    openModal: PropTypes.func.isRequired,
};

export default connect(null, mapDispatchToProps)(ExternalStatusPagesTable);
