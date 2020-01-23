import React from 'react';
import PropTypes from 'prop-types';

const RenderAlertOptions = ({ call, sms, email}) => {
  return (
    <div style={{ display: 'flex',  marginLeft: '2%'}}>
      <h4 style={{ marginTop: 5, marginRight: 15 }}>Alert Options:</h4>
      <div className="bs-Fieldset-fields" style={{ maxWidth: '100px' }}>
          <div className="Box-root" style={{ height: '5px' }}></div>
          <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
              <label className="Checkbox">
                <input checked={email} type="checkbox" className="Checkbox-source" />
                  {/* <Field
                      component="input"
                      type="checkbox"
                      name={`${policy}.email`}
                      data-test="RetrySettings-failedPaymentsCheckbox"
                      className="Checkbox-source"
                  /> */}
                  <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                      <div className="Checkbox-target Box-root">
                          <div className="Checkbox-color Box-root"></div>
                      </div>
                  </div>
                  <div style={{ marginTop: -2}} className="Checkbox-label Box-root Margin-left--8">
                      <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                          <span>Email</span>
                      </span>
                  </div>
              </label>
          </div>
      </div>
      {/* <div className="Box-root Padding-left--24">
          <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
              <div className="Box-root">
                  <div className="Box-root">

                  </div>
              </div>
          </div>
      </div> */}
    <div className="bs-Fieldset-fields" style={{ maxWidth: '100px' }}>
        <div className="Box-root" style={{ height: '5px' }}></div>
        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
            <label className="Checkbox">
              <input checked={sms} type="checkbox" className="Checkbox-source" />
                {/* <Field
                    component="input"
                    type="checkbox"
                    name={`${policy}.sms`}
                    data-test="RetrySettings-failedPaymentsCheckbox"
                    className="Checkbox-source"
                /> */}
                <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                    <div className="Checkbox-target Box-root">
                        <div className="Checkbox-color Box-root"></div>
                    </div>
                </div>
                <div style={{ marginTop: -2}} className="Checkbox-label Box-root Margin-left--8">
                    <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <span>SMS</span>
                    </span>
                </div>
            </label>
        </div>
    </div>
    {/* <div className="Box-root Padding-left--24">
        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
            <div className="Box-root">
                <div className="Box-root">

                </div>
            </div>
        </div>
    </div> */}
    <div className="bs-Fieldset-fields" style={{ maxWidth: '100px' }}>
        <div className="Box-root" style={{ height: '5px' }}></div>
        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
            <label className="Checkbox">
                {/* <Field
                    component="input"
                    type="checkbox"
                    name={`${policy}.call`}
                    data-test="RetrySettings-failedPaymentsCheckbox"
                    className="Checkbox-source"
                /> */}
                <input checked={call} type="checkbox" className="Checkbox-source" />
                <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                    <div className="Checkbox-target Box-root">
                        <div className="Checkbox-color Box-root"></div>
                    </div>
                </div>
                <div style={{ marginTop: -2}} className="Checkbox-label Box-root Margin-left--8">
                    <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <span>Call</span>
                    </span>
                </div>
            </label>
        </div>
    </div>

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