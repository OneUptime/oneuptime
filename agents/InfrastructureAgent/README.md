# OneUptime Infrastructure Agent

The OneUptime Infrastructure Agent is a lightweight, open-source agent that collects system metrics and sends them to the OneUptime platform. It is designed to be easy to install and use, and to be extensible.

### Installation

Debian and Ubuntu (apt):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://packages.oneuptime.com/gpg.key -o /etc/apt/keyrings/oneuptime.asc
sudo chmod a+r /etc/apt/keyrings/oneuptime.asc
echo "deb [signed-by=/etc/apt/keyrings/oneuptime.asc] https://packages.oneuptime.com/deb stable main" | sudo tee /etc/apt/sources.list.d/oneuptime.list
sudo apt-get update
sudo apt-get install oneuptime-infrastructure-agent
```

RHEL, Rocky Linux, AlmaLinux, Fedora and Amazon Linux (dnf, or yum):

```bash
sudo curl -fsSL https://packages.oneuptime.com/rpm/oneuptime.repo -o /etc/yum.repos.d/oneuptime.repo
sudo dnf install oneuptime-infrastructure-agent
```

macOS (Homebrew):

```bash
brew install oneuptime/tap/oneuptime-infrastructure-agent
```

Windows (winget, from an Administrator prompt):

```shell
winget install --id OneUptime.InfrastructureAgent --exact --scope machine
```

Intune, Configuration Manager or Group Policy: the release's `oneuptime-infrastructure-agent-amd64.msi` or `oneuptime-infrastructure-agent-arm64.msi`. It installs per machine into `C:\Program Files\OneUptimeInfrastructureAgent`, and a newer MSI upgrades it in place and restarts the agent ([windows/oneuptime-infrastructure-agent.wxs](windows/oneuptime-infrastructure-agent.wxs) says how). An MSI from before that change installed per user and cannot be upgraded: uninstall it once.

Anywhere else, the install script. Run with `sudo`, it installs the agent in `/usr/local/bin` (`-b <directory>` installs it elsewhere):

```bash
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash
```

The [Server / VM Monitor docs](https://oneuptime.com/docs/monitor/server-monitor) cover every way, and upgrades. Each release publishes the packages, the Homebrew cask and the winget manifests: see [Scripts/PackageManagers](../../Scripts/PackageManagers/README.md). [RELEASING.md](RELEASING.md) says how to tell whether a release has reached each of them, and what to do when it has not.

### Configure the agent

Configure the agent as a system service

- You can change the host to your own host if you're self hosting the OneUptime platform.
- You can find the secret key on OneUptime Dashboard. Click on "View Monitor" and go to "Settings" tab.

Run the commands below with `sudo` on Linux and macOS, and from an Administrator prompt on Windows. Each prints what it did, or why it failed.

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com
```

### Starting the agent

```
sudo oneuptime-infrastructure-agent start
sudo oneuptime-infrastructure-agent status
```

Once its up and running you should see the metrics on the OneUptime Dashboard.

### Stopping the agent

```
sudo oneuptime-infrastructure-agent stop
```

### Restarting the agent

```
sudo oneuptime-infrastructure-agent restart
```

### Uninstalling the agent

If the install script installed it:

```
sudo oneuptime-infrastructure-agent uninstall && sudo rm -f /usr/local/bin/oneuptime-infrastructure-agent
```

An agent the install script installed before it used `/usr/local/bin` is in `/root/bin` (or the `$HOME/bin` of the user who ran it): remove it from there.

If a package manager installed it, run `sudo oneuptime-infrastructure-agent uninstall`, then remove the package with that package manager (for example `sudo apt-get remove oneuptime-infrastructure-agent`).

### Viewing agent logs

```
sudo oneuptime-infrastructure-agent logs
```

You can also use the following options:

- Show specific number of lines: `oneuptime-infrastructure-agent logs -n 50`
- Follow logs in real-time: `oneuptime-infrastructure-agent logs -f`

### Supported Platforms

- Linux
- MacOS
- Windows

## Development

This section is for developers who want to contribute to the agent. The agent is written in Go.

### Building the agent

```bash
go mod tidy
go install
go build
```

### Configure the agent

```bash
sudo ./oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://localhost
```

### Starting the agent

```bash
sudo ./oneuptime-infrastructure-agent start
```

### Stopping the agent

```bash
sudo ./oneuptime-infrastructure-agent stop
```

### Viewing logs

```bash
sudo ./oneuptime-infrastructure-agent logs
```
