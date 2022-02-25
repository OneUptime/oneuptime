const version = (req, res) => {
    res.send({ docsVersion: process.env.npm_package_version });
};

export default version;
