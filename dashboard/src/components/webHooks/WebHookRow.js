import React from 'react';
import PropTypes from 'prop-types'

 function WebHookTableHeader ({ text, style }) {
  return (
    <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={Object.assign({ width: 'calc(100% / 3)' },style)}>
        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
            <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                <span>{text}</span>
            </span>
        </div>
    </td>
  )
}

WebHookTableHeader.displayName = 'WebHookTableHeader';

WebHookTableHeader.propTypes = {
    text: PropTypes.string,
    style: PropTypes.object
}

 function WebHookTableBody ({ text }) {
  return (
    <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell">
        <div className="db-ListViewItem-cellContent Box-root Padding-vertical--16 Padding-horizontal--8">
            <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                <div className="Box-root">
                    <span>{text}</span>
                </div>
            </span>
        </div>
    </td>
  )
}

WebHookTableBody.displayName = 'WebHookTableBody'

WebHookTableBody.propTypes = {
    text:PropTypes.string
}

function WebHookBadgeTableBody ({ text, primary = true}) {
    return (
        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell">
            <div className="db-ListViewItem-cellContent Box-root Padding-vertical--16 Padding-horizontal--8">
                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                        <span className={`Badge-text ${primary ? 'Text-color--green' : 'Text-color--blue'} Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap`}>
                            <span>
                                {text}
                            </span>
                        </span>
                    </div>
            </div>
        </td>
    )
}

WebHookBadgeTableBody.displayName = 'WebHookBadeTableBody'

WebHookBadgeTableBody.propTypes = {
    text:PropTypes.string,
    primary: PropTypes.bool
}

export {WebHookTableBody, WebHookTableHeader, WebHookBadgeTableBody}
