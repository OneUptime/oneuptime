const slugify = require('slugify');
const generate = require('nanoid/generate');
const projectModel = require('../../backend/models/project');

module.exports.init = async function() {
    const projects = await projectModel.find({ slug: { $exist: false } });

    projects.forEach(async project => {
        let name = project.name;
        name = slugify(name);
        name = `${name}-${generate('1234567890', 5)}`;

        projectModel.update(
            { _id: project._id },
            {
                $set: {
                    slug: name,
                },
            }
        );
    });
};
