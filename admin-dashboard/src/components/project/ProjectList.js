import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import { ListLoader } from '../basic/Loader';
import { history } from '../../store';

export class ProjectList extends Component {

    render() {
        if(this.props.projects && this.props.projects.skip && typeof this.props.projects.skip === 'string'){
            this.props.projects.skip = parseInt(this.props.projects.skip,10);
        }
        if(this.props.projects && this.props.projects.limit && typeof this.props.projects.limit === 'string'){
            this.props.projects.limit = parseInt(this.props.projects.limit,10);
        }
        if(!this.props.projects.skip) this.props.projects.skip = 0;
        if(!this.props.projects.limit) this.props.projects.limit = 0;

        let canNext = (this.props.projects && this.props.projects.count) && (this.props.projects.count > (this.props.projects.skip + this.props.projects.limit)) ? true : false;
        let canPrev = (this.props.projects && this.props.projects.skip <= 0) ? false : true;

        if (this.props.projects && (this.props.requesting || !this.props.projects.projects)) {
            canNext = false;
            canPrev = false;
        }
        return(
            <div>
                <table className="Table">
                    <thead className="Table-body">
                        <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                            <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', minWidth: '270px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Project Name</span></span></div>
                            </td>
                            <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Users</span></span></div>
                            </td>
                            <td id="placeholder-left" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
                            </td>
                            <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Status</span></span></div>
                            </td>
                            <td id="placeholder-right" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
                            </td>
                            <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Created At</span></span></div>
                            </td>
                            <td id="overflow" type="action" className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
                            </td>
                        </tr>
                    </thead>
                    <tbody className="Table-body">
                        { this.props.requesting ?
                            <Fragment> 
                                <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink" >
                                    <td colSpan={7} className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                        <a className="db-ListViewItem-link" >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root"><ListLoader /></div>
                                                </span>
                                            </div>
                                        </a>
                                    </td>
                                </tr> 
                            </Fragment>
                        :
                            this.props.projects && this.props.projects.projects && this.props.projects.projects.length > 0 ? (
                                this.props.projects.projects.map((project) => (
                                        <tr key={project._id} className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink" onClick={() => { history.push('/projects/' + project._id) }} >
                                            <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord" style={{ height: '1px', minWidth: '270px' }}>
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root Margin-right--16"><span>{ project.name }</span></div>
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                                <a className="db-ListViewItem-link" >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root"><span>{ `${project.users[0] ? project.users[0].name : ''}`} { (project.users.length - 1) > 0 ? project.users.length - 1 > 1 ? `and ${project.users.length - 1} others` : 'and 1 other' : ''}</span></div>
                                                        </span>
                                                    </div>
                                                </a>
                                            </td>
                                            <td aria-hidden="true" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                                                <a className="db-ListViewItem-link" >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">⁣</div>
                                                </a>
                                            </td>
                                            <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                                <a className="db-ListViewItem-link" >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Flex-flex">
                                                                <div className="Box-root Flex-flex">
                                                                    <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                    {
                                                                        project.deleted ? 
                                                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                <span>Deleted</span>
                                                                            </span>
                                                                        </div>
                                                                        :
                                                                        project.isBlocked ?
                                                                        <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                            <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                <span>Blocked</span>
                                                                            </span>
                                                                        </div> :
                                                                         <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                            <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                <span>
                                                                                    Active
                                                                                </span>
                                                                            </span>
                                                                        </div>
                                                                    }
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </a>
                                            </td>

                                            <td aria-hidden="true" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                                                <a className="db-ListViewItem-link" >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">⁣</div>
                                                </a>
                                            </td>
                                            <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                                <a className="db-ListViewItem-link" >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        {moment(project.createdAt).fromNow()}
                                                    </div>
                                                </a>
                                            </td>
                                            <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell">
                                            </td>
                                        </tr>
                                ))
                            ) :
                                <tr></tr> 
                        }
                    </tbody>

                </table>

                <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    {this.props.projects && (!this.props.projects.projects || !this.props.projects.projects.length) && !this.props.requesting && !this.props.projects.error ? 'We don\'t have any projects yet' : null}
                    {this.props.projects && this.props.projects.error ? this.props.projects.error : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">{this.props.projects && this.props.projects.count ? this.props.projects.count + (this.props.projects && this.props.projects.count > 1 ? ' projects' : ' Project') : null}</span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button id="btnPrev" onClick={()=>{this.props.prevClicked(this.props.projects.skip, this.props.projects.limit)}} className={'Button bs-ButtonLegacy' + (canPrev ? '' : 'Is--disabled')} disabled={!canPrev} data-db-analytics-name="list_view.pagination.previous" type="button">
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>Previous</span></span></div>
                                </button>
                            </div>
                            <div className="Box-root">
                                <button id="btnNext" onClick={()=>{this.props.nextClicked(this.props.projects.skip, this.props.projects.limit)}} className={'Button bs-ButtonLegacy' + (canNext ? '' : 'Is--disabled')} disabled={!canNext} data-db-analytics-name="list_view.pagination.next" type="button">
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>Next</span></span></div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({}, dispatch)
}

function mapStateToProps(state) {
    return {
        users: state.user.users.users
    }
}

ProjectList.displayName = 'ProjectList'

ProjectList.propTypes = {
    nextClicked:PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    projects: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null,undefined])
    ]),
    requesting: PropTypes.bool
}

export default connect(mapStateToProps, mapDispatchToProps)(ProjectList);