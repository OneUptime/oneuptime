## OneUptime Copilot

This folder contains the configuration files for the OneUptime Copilot. The Copilot is a tool that automatically improves your code. It can fix issues, improve code quality, and help you ship faster.

This folder has the following structure:

- `config.js`: The configuration file for the Copilot. You can customize the Copilot's behavior by changing this file.
- `scripts`: A folder containing scripts that the Copilot runs. These are hooks that run at different stages of the Copilot's process.
    - `on-after-clone.sh`: A script that runs after the Copilot clones your repository.
    - `on-before-code-change.sh`: A script that runs before the Copilot makes changes to your code.
    - `on-after-code-change.sh`: A script that runs after the Copilot makes changes to your code.
    - `on-before-commit.sh`: A script that runs before the Copilot commits changes to your repository.
    - `on-after-commit.sh`: A script that runs after the Copilot commits changes to your repository.

    