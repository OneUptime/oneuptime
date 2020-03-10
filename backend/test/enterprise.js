try {
    require('./enterpriseUser.test');
    require('./enterpriseProject.test');
    require('./enterpriseMonitor.test');
} catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    throw error;
}
