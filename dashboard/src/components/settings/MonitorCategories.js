import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import moment from 'moment';

import { fetchMonitorCategories, deleteMonitorCategory } from '../../actions/monitorCategories';
import AddMonitorCategoryForm from '../../components/modals/AddMonitorCategory';
import { openModal, closeModal } from '../../actions/modal';
import uuid from 'uuid';

export class MonitorCategories extends Component {

    state = {
        CreateMonitorCategoryModalId: uuid.v4()
    }

    handleDeleteMonitorCategory(_id) {
        this.props.deleteMonitorCategory(_id, this.props.projectId)
    }
    prevClicked = () => {
        this.props.fetchMonitorCategories(this.props.projectId, (this.props.skip ? (parseInt(this.props.skip, 10) - 10) : 10), 10);
    }

    nextClicked = () => {
        this.props.fetchMonitorCategories(this.props.projectId, (this.props.skip ? (parseInt(this.props.skip, 10) + 10) : 10), 10);
    }

    render() {

        let canNext = (this.props.count > (parseInt(this.props.skip) + parseInt(this.props.limit))) ? true : false;
        let canPrev = (parseInt(this.props.skip) <= 0) ? false : true;

        if (this.props.isRequesting || !this.props.monitorCategories) {
            canNext = false;
            canPrev = false;
        }
        const { monitorCategories } = this.props;
        let footerBorderTopStyle = { margin: 0, padding: 0, borderTop: '1px solid #e6ebf1' }
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Categories</span>
                                </span>
                                <p>
                                    <span>
                                        {'Add Monitor Categories options like "US East", "US West", "Mumbai".'}
                                    </span>
                                </p>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div className="Box-root">
                                    <button onClick={() => {
                                        this.props.openModal({
                                            id: this.state.CreateMonitorCategoryModalId,
                                            content: AddMonitorCategoryForm
                                        })
                                    }} className="Button bs-ButtonLegacy ActionIconParent" type="button">
                                        <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                            <div className="Box-root Margin-right--8">
                                                <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex">
                                                </div>
                                            </div>
                                            <span id="createMonitorCategoryButton" className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                <span>Create Monitor Category</span>
                                            </span>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div id="monitorCategoryList" className="bs-ContentSection-content Box-root">
                            <div className="bs-ObjectList db-UserList">
                                <div className="bs-ObjectList-rows">
                                    <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                        <div className="bs-ObjectList-cell">
                                            Monitor category
										</div>
                                        <div className="bs-ObjectList-cell">
                                            Created at
										</div>
                                        <div className="bs-ObjectList-cell">
                                            Action
										</div>
                                    </header>
                                    {monitorCategories.map(({ createdAt, name, _id }) =>
                                        (<div key={_id}className="bs-ObjectList-row db-UserListRow db-UserListRow--withName">
                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">{this.props.name}</div>
                                                <div className="bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted">
                                                    {name}
                                                </div>
                                            </div>
                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                <div className="bs-ObjectList-cell-row">
                                                    {moment(createdAt).fromNow()}
                                                </div>
                                            </div>
                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                <button onClick={() => this.handleDeleteMonitorCategory(_id)} className="Button bs-ButtonLegacy" type="button">
                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>Delete</span></span></div>
                                                </button>
                                            </div>
                                        </div>))}
                                </div>
                            </div>
                        </div>
                        <div style={footerBorderTopStyle}></div>
                        <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                            <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        <span id="monitorCategoryCount"className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">{ this.props.count ? this.props.count + (this.props.count > 1 ? ' Monitor Categories' : ' Monitor Category') : '0 Monitor Category'}</span>
                                    </span>
                                </span>
                            </div>
                            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Margin-right--8">
                                        <button onClick={() => this.prevClicked()} className={'Button bs-ButtonLegacy' + (canPrev ? '' : 'Is--disabled')} disabled={!canPrev} data-db-analytics-name="list_view.pagination.previous" type="button">
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>Previous</span></span></div>
                                        </button>
                                    </div>
                                    <div className="Box-root">
                                        <button onClick={() => this.nextClicked()} className={'Button bs-ButtonLegacy' + (canNext ? '' : 'Is--disabled')} disabled={!canNext} data-db-analytics-name="list_view.pagination.next" type="button">
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>Next</span></span></div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div >
        )
    }
}

MonitorCategories.displayName = 'MonitorCategories'

MonitorCategories.propTypes = {
    projectId: PropTypes.string,
    monitorCategories: PropTypes.array,
    isRequesting: PropTypes.bool,
    deleteMonitorCategory: PropTypes.func.isRequired,
    fetchMonitorCategories: PropTypes.func.isRequired,
    skip: PropTypes.number,
    count: PropTypes.number,
    limit: PropTypes.number,
    name: PropTypes.string,
    openModal: PropTypes.func.isRequired
}


const mapDispatchToProps = dispatch => (
    bindActionCreators({ fetchMonitorCategories, deleteMonitorCategory, openModal, closeModal }, dispatch)
)

const mapStateToProps = state => (
    {
        projectId: state.project.currentProject !== null && state.project.currentProject._id,
        monitorCategories: state.monitorCategories.monitorCategoryList.monitorCategories,
        skip: state.monitorCategories.monitorCategoryList.skip,
        limit: state.monitorCategories.monitorCategoryList.limit,
        count: state.monitorCategories.monitorCategoryList.count,
        isRequesting: state.monitorCategories.monitorCategoryList.requesting
    }
)

export default connect(mapStateToProps, mapDispatchToProps)(MonitorCategories);