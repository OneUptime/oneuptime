const version = (req: $TSFixMe, res: $TSFixMe) => {
    res.send({ docsVersion: process.env.npm_package_version });
};

export default version;
