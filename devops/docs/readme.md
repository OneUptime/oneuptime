# Fyipe Database Backup/Restore

To carry out backup/restore from a remote vm you first have to setup your local system for remote access.

## Set up local VM

-   ssh into the local VN and upload scripts install.sh, backup.sh and restore.sh

The script install.sh will automatically install the latest kubectl version if non is present, create default backup path and kube-config paths as well as ssh into the remote server where database is setup.

-   Open a new terminal on the VN and run script: `install.sh -a <IP_ADDRESS>`

The _IP_ADDRESS_ is the address of remote server.

You will be asked for your login credentials, and proceed to backup or restore.

## Backing up the database

**_Step 1 : Test backup_**

The first thing to take note of is passing the right arguments.

-   cd into folder containing backup script.
-   Enter command `bash backup.sh -h` to see list of all available commands

| Argument | Function                                                                        | Default                      |
| -------- | :------------------------------------------------------------------------------ | :--------------------------- |
| -l       | Backup path on local system where backup file will be stored.                   | /Users/root/Documents/backup |
| -n       | Database name.                                                                  | 'fyipedb'                    |
| -p       | Database password.                                                              | 'password'                   |
| -r       | Helm release name.                                                              | 'fi'                         |
| -t       | Backup retain days. Set the number of days backup is kept before it is deleted. | 14                           |
| -u       | Set database username.                                                          | 'fyipe'                      |
| -h       | Help                                                                            | null                         |

_ex: To create a backup of a database without username or password and database name is 'fyipe'_

The command will be `/Users/root/Document/backup bash backup.sh -u '' -p '' -n 'fyipe'`

**_Step 2 : Set-up a cronJob_**

-   Update the computer’s local package index: `sudo apt update`.
-   Install cron: `sudo apt install cron`.
-   Set it to run on background: `sudo systemctl enable cron`.

The next step is to schedule the job

-   Visit `https://crontab.guru/` to create a cron schedule.
-   Edit user crontab: `crontab -e`
-   Select your default text editor _(For first time use)_
-   Proceed to schedule your job. For example, to backup the database every 12 hours, the command would be

`0 */12 * * * /Users/root/Document/backup/backup.sh -u '' -p '' -n 'fyipe'`

-   Save crontab and exit.

## Restore a backup

The first thing to take note of is passing the right arguments.

-   cd into folder containing backup script.
-   Enter command `bash backup.sh -h` to see list of all available commands

| Argument | Function                                                                        | Default                       |
| -------- | :------------------------------------------------------------------------------ | :---------------------------- |
| -f       | Name of file to be restored.                                                    | No default. Compulsary field. |
| -l       | File path on local system where file will be restored from.                     | /Users/root/Documents/backup  |
| -n       | Database name. Default value                                                    | 'fyipedb'                     |
| -p       | Database password. Default value                                                | 'password'                    |
| -r       | Helm release name.                                                              | 'fi'                          |
| -t       | Backup retain days. Set the number of days backup is kept before it is deleted. | 14                            |
| -u       | Set database username.                                                          | 'fyipe'                       |
| -h       | Help                                                                            | null                          |

_ex: To restore a backup with name fyipe-backup-1613551425.archive to a database without username or password and database name is 'fyipe'._

The command will be `/<Path to script> bash restore.sh -f fyipe-backup-1613551425.archive -p '' -u ''`
