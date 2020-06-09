import React from 'react';

function ApiDoc() {
    return (
        <div className="Flex-flex Flex-alignContent--stretch tut-Main row">
            <div className="bs-u-justify--center col-sm-12 Flex-justifyContent--center Padding-all--20 Vertical">
                <a href=" https://docs.fyipe.com" target="_blank">
                    <div className="Flex-flex Flex-alignItems--center">
                        <img
                            src={
                                process.env.PUBLIC_URL + '/assets/icons/api.svg'
                            }
                            alt=""
                            className="Margin-right--20"
                            height="75"
                            width="75"
                        />
                        <div>
                            <article className="Text-wrap--wrap col-sm-12">
                                Anything you do here on Fyipe Dashboard can also
                                be done via the API. We have built an extensive
                                RESTful API documentation for you. Please check
                                it out here
                            </article>
                        </div>
                    </div>
                </a>
            </div>
        </div>
    );
}

ApiDoc.displayName = 'ApiDoc';

export default ApiDoc;
