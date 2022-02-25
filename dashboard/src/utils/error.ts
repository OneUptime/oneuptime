export const getErrorMessageFromResponse = error => {
    if (error && error.response && error.response.data)
        error = error.response.data;
    if (error && error.data) {
        error = error.data;
    }
    if (error && error.message) {
        error = error.message;
    } else {
        error = 'Network Error';
    }

    if (error.toString() === 'Error: Network Error') {
        return 'Check your network connection.';
    }

    return error;
};
