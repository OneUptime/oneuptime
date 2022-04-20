export default {
    dockerUsername: process.env.DOCKER_UNMASKED_USERNAME,
    dockerPassword: process.env.DOCKER_UNMASKED_PASSWORD,
    dockerRegistryUrl: process.env.DOCKER_SECURITY_SCAN_REGISTRY_URL,
    imagePath: process.env.DOCKER_SECURITY_SCAN_IMAGE_PATH,
    imageTags: process.env.DOCKER_SECURITY_SCAN_IMAGE_TAGS,
};
