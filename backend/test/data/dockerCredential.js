module.exports = {
    dockerUsername: process.env.DOCKERHUBUSERNAME,
    dockerPassword: process.env.DOCKERHUBPASSWORD,
    dockerRegistryUrl: process.env.DOCKER_SECURITY_SCAN_REGISTRY_URL,
    imagePath: process.env.DOCKER_SECURITY_SCAN_IMAGE_PATH,
    imageTags: process.env.DOCKER_SECURITY_SCAN_IMAGE_TAGS,
};
