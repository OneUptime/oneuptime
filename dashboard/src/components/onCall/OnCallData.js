import React from 'react';
import PropTypes from 'prop-types'

 function OnCallTableHeader ({ text }) {
  return (
    <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ width: 'calc(100% / 3)' }}>
        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
            <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                <span>{text}</span>
            </span>
        </div>
    </td>
  )
}

OnCallTableHeader.displayName = 'OnCallTableHeader'

OnCallTableHeader.propTypes = {
    text:PropTypes.string.isRequired
}

 function OnCallTableBody ({ text }) {
  return (
    <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell">
        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
            <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                <div className="Box-root">
                    <span>{text}</span>
                </div>
            </span>
        </div>
    </td>
  )
}

OnCallTableBody.displayName = 'OnCallTableBody'

OnCallTableBody.propTypes = {
    text:PropTypes.string.isRequired
}

export {OnCallTableBody,OnCallTableHeader}
