import React from 'react';
import { storiesOf, action } from '@storybook/react';
import {FeedbackModal} from '../../components/FeedbackModal'
import {reduxForm} from 'redux-form'

const props = {
    createFeedback:action('createFeedback'),
    closeFeedbackModal:action('closeFeedbackModal'),
    reset:action('reset'),
    feedback:{
        feedbackModalVisble:true
    },
    handleSubmit:action('handleSubmit')
}

const FeedbackModalForm = reduxForm({
	form: 'FeedbackModal', // a unique identifier for this form
})(FeedbackModal);


storiesOf('Modals', module)
    .addDecorator(story => (
        <div style={{ margin: '20%' }} >
            {story()}</div>
    ))
    .add('FeedbackModal', () =>
        <FeedbackModalForm  {...props} />
    )
