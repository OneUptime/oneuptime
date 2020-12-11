import React from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import uuid from 'uuid';
import { openModal } from '../../actions/modal';
import AlertDetails from '../modals/AlertDetails';
import countryTelephoneCode from 'country-telephone-code';
import DataPathHoC from '../DataPathHoC';

function HTD1() {
    return (
        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell">
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                    <span>Monitor</span>
                </span>
            </div>
        </td>
    );
}

function HTD2({ name, style }) {
    return (
        <td
            className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
            style={style}
        >
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                    <span>{name}</span>
                </span>
            </div>
        </td>
    );
}

HTD2.propTypes = {
    name: PropTypes.string.isRequired,
    style: PropTypes.object,
};

function HTD3() {
    return (
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
            style={{ height: '1px' }}
        >
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                    <span>Alert via</span>
                </span>
            </div>
        </td>
    );
}

function HTD4() {
    return (
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
            style={{ height: '1px' }}
        >
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                    <span>Alert Sent</span>
                </span>
            </div>
        </td>
    );
}

function HTD5() {
    return (
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
            style={{
                height: '1px',
            }}
        >
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                    <span>Event type</span>
                </span>
            </div>
        </td>
    );
}

function HTD6() {
    return (
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
            style={{
                height: '1px',
            }}
        >
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                    <span>Status</span>
                </span>
            </div>
        </td>
    );
}

function TD1({ text }) {
    return (
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
            style={{ height: '1px', minWidth: '270px' }}
        >
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                    <div className="Box-root Margin-right--16">
                        <span>{text}</span>
                    </div>
                </span>
            </div>
        </td>
    );
}

TD1.propTypes = {
    text: PropTypes.any,
};

function TD2({ text }) {
    return (
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
            style={{ height: '1px' }}
        >
            <div className="db-ListViewItem-link">
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <div className="Box-root">
                            <span>{text}</span>
                        </div>
                    </span>
                </div>
            </div>
        </td>
    );
}

TD2.propTypes = {
    text: PropTypes.any,
};

function TD3({ text }) {
    return (
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
            style={{ height: '1px' }}
        >
            <div className="db-ListViewItem-link">
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <div className="Box-root Flex-flex">
                            <div className="Box-root Flex-flex">
                                <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                    <div
                                        className="Box-root Flex-flex Flex-alignItems--center"
                                        style={{ height: '100%' }}
                                    >
                                        <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                            <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                <span>{text}</span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </span>
                </div>
            </div>
        </td>
    );
}

TD3.propTypes = {
    text: PropTypes.any,
};

function TD4({ text }) {
    return (
        <td
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
            style={{ height: '1px' }}
        >
            <div className="db-ListViewItem-link">
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <span>{moment(text).format('lll')}</span>
                    </span>
                </div>
            </div>
        </td>
    );
}

TD4.propTypes = {
    text: PropTypes.any,
};

function TD5({ text }) {
    return (
        <td
            aria-hidden="true"
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
            style={{
                height: '1px',
            }}
        >
            <div className="db-ListViewItem-link">
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        {text === 'acknowledged' && (
                            <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                    {text}
                                </span>
                            </div>
                        )}
                        {text === 'resolved' && (
                            <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                    {text}
                                </span>
                            </div>
                        )}
                        {text === 'identified' && (
                            <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                    {text}
                                </span>
                            </div>
                        )}
                    </span>
                </div>
            </div>
        </td>
    );
}

TD5.propTypes = {
    text: PropTypes.string,
};

function TD6({ text }) {
    return (
        <td
            aria-hidden="true"
            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
            style={{
                height: '1px',
            }}
        >
            <div className="db-ListViewItem-link">
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        {text === 'Pending' ? (
                            <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                    {text}
                                </span>
                            </div>
                        ) : text === 'Success' || text === 'Sent' ? (
                            <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                    {text === 'Success' ? 'Sent' : text}
                                </span>
                            </div>
                        ) : text === 'Disabled' ? (
                            <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                    Disabled
                                </span>
                            </div>
                        ) : (
                            <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                    {text ? text : 'Error'}
                                </span>
                            </div>
                        )}
                    </span>
                </div>
            </div>
        </td>
    );
}

TD6.propTypes = {
    text: PropTypes.string,
};

function SubscriberAlertTableHeader() {
    return (
        <tr className="Table-row db-ListViewItem db-ListViewItem-header">
            <HTD1 />
            <HTD2 name="Subscriber" />
            <HTD3 />
            <HTD4 />
            <HTD5 />
            <HTD6 />
        </tr>
    );
}

class SubscriberAlertTableRowsClass extends React.Component {
    render() {
        const { alerts, monitor } = this.props;
        return alerts.length > 0
            ? alerts.map((alert, index) => (
                  <tr
                      key={`alert ${index}`}
                      className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink"
                      onClick={() =>
                          this.props.openModal({
                              id: uuid.v4(),
                              content: DataPathHoC(AlertDetails, {
                                  monitor: monitor ? monitor.name : 'Unknown',
                                  subscriber: alert.subscriberId
                                      ? alert.subscriberId.contactEmail ||
                                        (alert.subscriberId.contactPhone &&
                                            `+${countryTelephoneCode(
                                                alert.subscriberId.countryCode.toUpperCase()
                                            )}${
                                                alert.subscriberId.contactPhone
                                            }`) ||
                                        alert.subscriberId.contactWebhook
                                      : 'Unknown',
                                  alertVia: alert.alertVia,
                                  createdAt: alert.createdAt,
                                  alertStatus: alert.alertStatus,
                                  eventType: alert.eventType,
                                  errorMessage: alert.errorMessage,
                              }),
                          })
                      }
                  >
                      <TD1 text={monitor ? monitor.name : 'Unknown'} />

                      <TD2
                          text={
                              alert.subscriberId
                                  ? alert.alertVia === 'webhook'
                                      ? alert.subscriberId.contactWebhook
                                      : alert.subscriberId.contactEmail ||
                                        (alert.subscriberId.contactPhone &&
                                            `+${countryTelephoneCode(
                                                alert.subscriberId.countryCode.toUpperCase()
                                            )}${
                                                alert.subscriberId.contactPhone
                                            }`) ||
                                        alert.subscriberId.contactWebhook
                                  : 'Unknown'
                          }
                      />
                      <TD3 text={alert.alertVia} />
                      <TD4 text={alert.createdAt} />
                      <TD5 text={alert.eventType} />
                      <TD6 text={alert.alertStatus || alert.errorMessage} />
                  </tr>
              ))
            : null;
    }
}
SubscriberAlertTableRowsClass.displayName = 'SubscriberAlertTableRowsClass';
SubscriberAlertTableRowsClass.propTypes = {
    alerts: PropTypes.array.isRequired,
    monitor: PropTypes.object.isRequired,
    openModal: PropTypes.func.isRequired,
};

const SubscriberAlertTableRows = connect(null, dispatch =>
    bindActionCreators(
        {
            openModal,
        },
        dispatch
    )
)(SubscriberAlertTableRowsClass);

HTD1.displayName = 'HTD1';
HTD2.displayName = 'HTD2';
HTD3.displayName = 'HTD3';
HTD4.displayName = 'HTD4';
HTD5.displayName = 'HTD5';
HTD6.displayName = 'HTD6';
TD1.displayName = 'TD1';
TD2.displayName = 'TD2';
TD3.displayName = 'TD3';
TD4.displayName = 'TD4';
TD5.displayName = 'TD5';
TD6.displayName = 'TD6';
SubscriberAlertTableHeader.displayName = 'SubscriberAlertTableHeader';

export {
    HTD1,
    HTD2,
    HTD3,
    HTD4,
    HTD5,
    TD1,
    TD2,
    TD3,
    TD4,
    TD5,
    SubscriberAlertTableHeader,
    SubscriberAlertTableRows,
};
