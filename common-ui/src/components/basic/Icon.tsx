import React from 'react'
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module '@fortawesome/react-fontawesome... Remove this comment to see the full error message
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'Icon'.
export default Icon = ({
    icon,
    size
}: $TSFixMe) => (
    <span>
        <FontAwesomeIcon icon={icon} size={size} />
    </span>
)