const version = (req, res) => {
    res.send({ helmChartVersion: process.env.npm_package_version });
};

module.exports = version;
