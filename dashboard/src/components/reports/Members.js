import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import humanize from 'humanize-duration';
import { ListLoader } from '../basic/Loader';
import {
  getActiveMembers,
  getActiveMembersError,
  getActiveMembersRequest,
  getActiveMembersSuccess
} from '../../actions/reports';

class MembersList extends Component {
  constructor(props) {
    super(props);
    this.state = {
      members: [],
      skip: 0,
      limit: 10
    };
    this.handleNext = this.handleNext.bind(this);
    this.handlePrevious = this.handlePrevious.bind(this);
  }

  componentDidMount() {
    const { getActiveMembers, currentProject, startDate, endDate } = this.props;

    getActiveMembers(currentProject, startDate, endDate, this.state.skip, 10);
  }

  UNSAFE_componentWillReceiveProps(nextProps, prevState) {
    const {
      getActiveMembers,
      currentProject,
      startDate,
      endDate,
      activeMembers
    } = nextProps;

    if (startDate !== this.props.startDate || endDate !== this.props.endDate) {
      getActiveMembers(currentProject, startDate, endDate, this.state.skip, 10);
    }

    if (prevState.members !== activeMembers.members) {
      this.setState({
        members: nextProps.activeMembers.members
      });
    }
  }

  handleNext(event) {
    event.preventDefault();
    const { currentProject, startDate, endDate, getActiveMembers } = this.props;
    const skip = this.state.skip + this.state.limit;
    getActiveMembers(currentProject, startDate, endDate, skip, 10)
    this.setState({
      skip
    })
  }

  handlePrevious(event) {
    event.preventDefault()
    const { currentProject, startDate, endDate, getActiveMembers } = this.props;
    const skip = this.state.skip - this.state.limit;
    getActiveMembers(currentProject, startDate, endDate, skip, 10)
    this.setState({
      skip
    })
  }

  render() {
    let canNext = (this.props.activeMembers && this.props.activeMembers.count) && (this.props.activeMembers.count > (this.state.skip + this.state.limit)) ? true : false;
    let canPrev = (this.props.activeMembers && this.state.skip <= 0) ? false : true;

    if (this.props.activeMembers && (this.props.activeMembers.requesting || !this.props.activeMembers.members)) {
        canNext = false;
        canPrev = false;
    }
    return (
      <div>
        <table className="Table">
          <thead className="Table-body">
            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
              <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                style={{
                  height: '1px',
                  minWidth: '48px',
                  width: '48px'
                }}
              >
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                  <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                    <span>User</span>
                  </span>
                </div>
              </td>
              <td
                className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                style={{ height: '1px' }}
              >
                <div
                  className="db-ListViewItem-cellContent Box-root Padding-all--8"
                  style={{ display: 'flex' }}
                >
                  <span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                    <span>Incidents Acknowledged</span>
                  </span>
                </div>
              </td>
              <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                style={{ height: '1px' }}
              >
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                  <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                    <span>Incidents Resolved</span>
                  </span>
                </div>
              </td>
              <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                style={{ height: '1px' }}
              >
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                  <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                    <span>Average Acknowledge Time</span>
                  </span>
                </div>
              </td>
              <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                style={{ height: '1px' }}
              >
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                  <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                    <span>Average Resolve Time</span>
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
                  <span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap" />
                </div>
              </td>
            </tr>
          </thead>
          <tbody className="Table-body">
            {this.state.members.map(member => {
              const {
                memberName,
                incidents,
                memberId,
                averageAcknowledgeTime,
                averageResolved
              } = member;
              return (
                <tr
                  className="Table-row db-ListViewItem bs-ActionsParent"
                  key={memberId}
                >
                  <td
                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                    style={{ height: '1px', width: '187px', minWidth: '120px' }}
                  >
                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                      <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <div className="Box-root Margin-right--16">
                          <span>{memberName}</span>
                        </div>
                      </span>
                    </div>
                  </td>
                  <td
                    aria-hidden="true"
                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                    style={{
                      height: '1px'
                    }}
                  >
                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8" style={{ textAlign: 'center'}}>
                      ⁣{' '}
                      <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <div className="Box-root Flex-inlineFlex Flex-alignItems--center">
                          <div>{incidents}</div>
                        </div>
                      </span>
                    </div>
                  </td>
                  <td
                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                    style={{ height: '1px' }}
                  >
                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8" style={{ textAlign: 'center'}}>
                      <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <div className="Box-root Flex-inlineFlex Flex-alignItems--center">
                          <div>{incidents}</div>
                        </div>
                      </span>
                    </div>
                  </td>
                  <td
                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                    style={{ height: '1px' }}
                  >
                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                      <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <div className="Box-root Flex-inlineFlex Flex-alignItems--center">
                          <div style={{ color: 'darkorange' }}>
                          { humanize(averageAcknowledgeTime, { round: true, largest: 2 }) }
                          </div>
                        </div>
                      </span>
                    </div>
                  </td>
                  <td
                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                    style={{ height: '1px' }}
                  >
                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                      <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <div className="Box-root Flex-inlineFlex Flex-alignItems--center">
                          <div style={{ color: 'green' }}>
                          { humanize(averageResolved, { round: true, largest: 2 }) }
                          </div>
                        </div>
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(this.props.activeMembers && this.props.activeMembers.requesting)
        ? (
          <ListLoader />
        ) : null}
        <div style={{ textAlign: 'center', marginTop: '10px' }}>
          {this.props.activeMembers && (!this.props.activeMembers.members || !this.props.activeMembers.members.length) && !this.props.activeMembers.requesting && !this.props.activeMembers.error ? 'We don\'t have any reports for this period' : null}
          {this.props.activeMembers && this.props.activeMembers.error ? this.props.activeMembers.error : null}
        </div>
        <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
          <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
              <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                  <span>
                      <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">{this.props.activeMembers && this.props.activeMembers.count ? this.props.activeMembers.count + (this.props.activeMembers && this.props.activeMembers.count > 1 ? ' Members' : ' Member') : null}</span>
                  </span>
              </span>
          </div>
          <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
              <div className="Box-root Margin-right--8">
                  <button onClick={this.handlePrevious} className={'Button bs-ButtonLegacy' + (canPrev ? '' : 'Is--disabled')} disabled={!canPrev} data-db-analytics-name="list_view.pagination.previous" type="button">
                      <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>Previous</span></span></div>
                  </button>
              </div>
              <div className="Box-root">
                  <button onClick={this.handleNext} className={'Button bs-ButtonLegacy' + (canNext ? '' : 'Is--disabled')} disabled={!canNext} data-db-analytics-name="list_view.pagination.next" type="button">
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

const actionCreators = {
  getActiveMembers,
  getActiveMembersError,
  getActiveMembersRequest,
  getActiveMembersSuccess
};

const mapDispatchToProps = dispatch => ({
  ...bindActionCreators(actionCreators, dispatch)
});

const mapStateToProps = state => {
  return {
    activeMembers: state.report.activeMembers
  };
};

MembersList.displayName = 'MembersList';

MembersList.propTypes = {
  getActiveMembers: PropTypes.func,
  activeMembers: PropTypes.object,
  startDate: PropTypes.string,
  endDate: PropTypes.string,
  currentProject: PropTypes.object
};

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(MembersList);
