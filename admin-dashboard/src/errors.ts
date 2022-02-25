export default error => {
    switch (error.toString()) {
        case 'Error: Network Error':
            return 'Check your network connection.';
        default:
            return error;
    }
};
