const testAuth = (z, bundle) => {
    // Normally you want to make a request to an endpoint that is either specifically designed to test auth, or one that
    // every user will have access to, such as an account or profile endpoint like /me.
    // In this example, we'll hit httpbin, which validates the Authorization Header against the arguments passed in the URL path

    // This method can return any truthy value to indicate the credentials are valid.
    // Raise an error to show
    if (bundle.cleanedRequest) return bundle.cleanedRequest;
    return z.request({
        url: 'https://api.fyipe.com/zapier/test',
    }).then((response) => {
        if (response.status === 400) {
            throw new Error('The API Key or Project ID you supplied is invalid!');
        }
        else if (response.status === 401) {
            throw new Error('The API Key or Project ID you supplied is invalid!');
        }
        else if(response.status === 500) {
            throw new Error('Server Error!');
        }
        else if(response.status !== 200) {
            throw new Error('An Error has occured please try after sometime!');
        }
        return response.json;
    });
};

module.exports = {
    type: 'custom',
    // Define any auth fields your app requires here. The user will be prompted to enter this info when
    // they connect their account.
    fields: [
        {
            key: 'projectId', 
            label: 'Project ID', 
            helpText: 'Your Project ID and API Key are found on the project settings page on your Fyipe dashboard.',
            required: true, 
            type: 'string'
        },
        {
            key: 'apiKey', 
            label: 'API Key',
            required: true, 
            type: 'string'
        }
        
    ],
    // The test method allows Zapier to verify that the credentials a user provides are valid. We'll execute this
    // method whenver a user connects their account for the first time.
    test: testAuth,
    // assuming "username" is a key in the json returned from testAuth
    connectionLabel: (z, bundle) => bundle.inputData.projectName
};