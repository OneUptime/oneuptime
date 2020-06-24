module.exports = {
    dockerUsername: process.env.DOCKERUSERNAME,
    dockerPassword: process.env.DOCKERPASSWORD,
    dockerRegistryUrl: process.env.DOCKER_SECURITY_SCAN_REGISTRY_URL,
    imagePath: process.env.DOCKER_SECURITY_SCAN_IMAGE_PATH,
    imageTags: process.env.DOCKER_SECURITY_SCAN_IMAGE_TAGS,
};
