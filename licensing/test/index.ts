try {
    require('./license.test');
} catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    throw error;
}
