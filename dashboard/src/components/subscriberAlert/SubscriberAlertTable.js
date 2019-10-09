import React from 'react';
import PropTypes from 'prop-types'
import moment from 'moment';

 function HTD1() {
    return (
        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', minWidth: '270px' }}>
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Monitor</span></span></div>
        </td>
    )
}

 function HTD2() {
    return (
        <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Subscriber</span></span></div>
        </td>
    )
}
 function HTD3() {
    return (
        <td id="placeholder-left" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
        </td>
    )
}
 function HTD4() {
    return (
        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Alert via</span></span></div>
        </td>
    )
}

 function HTD5() {
    return (
        <td id="placeholder-right" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
        </td>
    )
}

 function HTD6() {
    return (
        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Alert Sent</span></span></div>
        </td>
    )
}

 function HTD7() {
    return (
        <td id="overflow" type="action" className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
        </td>
    )
}

 function TD1({ text }) {
    return (
        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord" style={{ height: '1px', minWidth: '270px' }}>

            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                    <div className="Box-root Margin-right--16"><span>{text}</span></div>
                </span>
            </div>

        </td>
    )
}

TD1.propTypes = {
    text: PropTypes.any
}

 function TD2({ text }) {
    return (
        <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
            <div className="db-ListViewItem-link" >
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <div className="Box-root"><span>{text}</span></div>
                    </span>
                </div>
            </div>
        </td>
    )
}

TD2.propTypes = {
    text: PropTypes.any
}


 function TD3() {
    return (
        <td aria-hidden="true" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
            <div className="db-ListViewItem-link">
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">⁣</div>
            </div>
        </td>
    )
}
 function TD4({ text }) {
    return (
        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
            <div className="db-ListViewItem-link">
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <div className="Box-root Flex-flex">
                            <div className="Box-root Flex-flex">
                                <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Flex-flex Flex-alignItems--center" style={{ height: '100%' }}><div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"><span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap"><span>{text}</span></span></div></div>
                                </div>
                            </div>
                        </div>
                    </span>
                </div>
            </div>
        </td>
    )
}

TD4.propTypes = {
    text: PropTypes.any
}

 function TD5() {
    return (
        <td aria-hidden="true" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
            <div className="db-ListViewItem-link">
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">⁣</div>
            </div>
        </td>
    )
}

 function TD6({ text }) {
    return (
        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
            <div className="db-ListViewItem-link">
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"><span>{moment(text).format('lll')}</span></span></div>
            </div>
        </td>
    )
}

TD6.propTypes = {
    text: PropTypes.any
}

 function SubscriberAlertTableHeader() {
    return (
        <tr className="Table-row db-ListViewItem db-ListViewItem-header">
            <HTD1 />
            <HTD2 />
            <HTD3 />
            <HTD4 />
            <HTD5 />
            <HTD6 />
        </tr>
    )
}

 function SubscriberAlertTableRows({ alerts,monitor }) {
    return alerts.length > 0 ? (
        alerts.map((alert, index) => (
            <tr key={`alert ${index}`} className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink">
                <TD1 text={monitor ? monitor.name : 'Unknown'} />
                <TD2 text={alert.subscriberId ? alert.subscriberId.contactEmail || alert.subscriberId.contactPhone || alert.subscriberId.contactWebhook : 'Unknown'} />
                <TD3 />
                <TD4 text={alert.alertVia} />
                <TD5 />
                <TD6 text={alert.createdAt} />
            </tr>
        ))
    ) : null;
}


HTD1.displayName = 'HTD1'
HTD2.displayName = 'HTD2'
HTD3.displayName = 'HTD3'
HTD4.displayName = 'HTD4'
HTD5.displayName = 'HTD5'
HTD6.displayName = 'HTD6'
HTD7.displayName = 'HTD7'
TD1.displayName = 'TD1'
TD2.displayName = 'TD2'
TD3.displayName = 'TD3'
TD4.displayName = 'TD4'
TD5.displayName = 'TD5'
TD6.displayName = 'TD6'
SubscriberAlertTableHeader.displayName = 'SubscriberAlertTableHeader'

export { HTD1, HTD2, HTD3, HTD4, HTD5, HTD6, HTD7, TD1, TD2, TD3, TD4, TD5, TD6, SubscriberAlertTableHeader, SubscriberAlertTableRows}