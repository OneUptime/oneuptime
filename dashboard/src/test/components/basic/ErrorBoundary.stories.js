import React from 'react';
import PropTypes from 'prop-types'
import { storiesOf } from '@storybook/react';
import ErrorBoundary from '../../../components/basic/ErrorBoundary'


class WithError extends React.Component {
    render() {
        return (
            <div>{this.props.IdontExists.SomeNullObject.NameThatIsNull}</div>
        )
    }
}
WithError.propTypes = {
    IdontExists: PropTypes.any
}
WithError.displayName = ''


storiesOf('Basic', module)
    .addDecorator(story => (
        <div id='login' className='register-page' style={{ overflow: 'auto' }} >
            <div style={{ margin: '20%' }} >
                {story()}
            </div>
        </div>
    ))
    .add('ErrorBoundary No errors', () =>
        <ErrorBoundary>
            <div>No childern have errors</div>
        </ErrorBoundary>
    )

