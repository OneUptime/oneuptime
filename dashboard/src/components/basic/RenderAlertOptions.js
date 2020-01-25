import React from 'react';
import PropTypes from 'prop-types';

const RenderAlertOptions = ({ call, sms, email }) => {
  return (
    <div style={{ display: 'flex' }}>
      <h4 style={{ marginTop: 5, marginRight: 15 }}>Alert Options:</h4>
      {email && (
        <div className="bs-Fieldset-fields" style={{ maxWidth: '100px' }}>
        <div className="Box-root" style={{ height: '5px' }}></div>
        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
            <label className="Checkbox">
                <div style={{ marginTop: -2}} className="Checkbox-label Box-root Margin-left--8">
                    <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <span>Email</span>
                    </span>
                </div>
            </label>
        </div>
    </div>
      )}
    {sms && (
      <div className="bs-Fieldset-fields" style={{ maxWidth: '100px' }}>
          <div className="Box-root" style={{ height: '5px' }}></div>
          <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
              <label className="Checkbox">
                  <div style={{ marginTop: -2}} className="Checkbox-label Box-root Margin-left--8">
                      <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                          <span>SMS</span>
                      </span>
                  </div>
              </label>
          </div>
      </div>
    )}
    {call && (
      <div className="bs-Fieldset-fields" style={{ maxWidth: '100px' }}>
          <div className="Box-root" style={{ height: '5px' }}></div>
          <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
              <label className="Checkbox">
                  <div style={{ marginTop: -2}} className="Checkbox-label Box-root Margin-left--8">
                      <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                          <span>Call</span>
                      </span>
                  </div>
              </label>
          </div>
      </div>
    )}

</div>
  )
}

RenderAlertOptions.displayName = 'RenderAlertOptions';
RenderAlertOptions.propTypes = {
  call: PropTypes.bool,
  email: PropTypes.bool,
  sms: PropTypes.bool
}

export { RenderAlertOptions }