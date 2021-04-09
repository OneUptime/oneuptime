# Backup Fyipe Database

## Setting up Backup Service

**Step 1:** SSH into VM

Eg:

```
ssh root@<ip>
```

**Step 2:** Copy `backup.sh` and `install.sh` to ~/

Eg:

```
cd ~/
vi backup.sh
<copy all the file contents and save it>

vi install.sh
<copy all the file contents and save it>
```

**Step 3:**: Setup kubectl and kubernetes

```
#Install Kubectl
echo "RUNNING COMMAND: curl -LO https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl"
curl -LO https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl
echo "RUNNING COMMAND: chmod +x ./kubectl"
chmod +x ./kubectl
echo "RUNNING COMMAND: sudo mv ./kubectl /usr/local/bin/kubectl"
sudo mv ./kubectl /usr/local/bin/kubectl

# Get kube config. This is specific to digital ocean.
doctl kubernetes cluster kubeconfig save <cluster-id>
```

**Step 4:** Run install.sh

```
#if this fails use sudo
bash install.sh
```

The cron job should be installed and will run once/day!

# Force backup now!

Run:

```
bash backup.sh
```

# Restore Fyipe Database

**Step 1**: Copy restore.sh to root directory.

```
vi restore.sh
# Copy the file contents.
```

**Step 2**: Run the restore command

```
bash restore.sh -f <FILENAME>.archive
```

**Step 3**: This will copy the file from the VM to remote machine and run the restore.
