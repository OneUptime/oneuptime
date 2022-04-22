export default (error: $TSFixMe): void => {
    switch (error.toString()) {
        case 'Error: Network Error':
            return 'Check your network connection.';
        default:
            return error;
    }
};
