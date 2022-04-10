export default (error: $TSFixMe) => {
    switch (error.toString()) {
        case 'Error: Network Error':
            return 'Check your network connection.';
        default:
            return error;
    }
};
