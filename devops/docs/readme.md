# Fyipe Database Backup/Restore

## Backing up the database

**_Step 1 : Files Upload_**

-   ssh into the local VN and upload scripts install.sh, backup.sh and restore.sh to `/root/fyipe_bk_files`.

The script install.sh will automatically install the latest kubectl version if non is present, create default backup path and kube-config paths, copy the remote server kubernetes config file, create backup service and run the service with a timer.

**_Step 2 : Pass Arguments_**

The first thing to take note of is passing the right arguments.

-   cd into folder containing install scripts `/root/fyipe_bk_files`.
-   Enter command `bash install.sh -h` to see list of all available commands

| Argument | Function                                                                        | Default                         |
| -------- | :------------------------------------------------------------------------------ | :------------------------------ |
| -a       | IP Address of remote server                                                     | No Default. Compulsory argument |
| -l       | Backup path on local system where backup file will be stored.                   | /root/Documents/backup          |
| -n       | Database name.                                                                  | 'fyipedb'                       |
| -p       | Database password.                                                              | 'password'                      |
| -t       | Backup retain days. Set the number of days backup is kept before it is deleted. | 14                              |
| -u       | Set database username.                                                          | 'fyipe'                         |
| -h       | Help                                                                            | null                            |

_ex: To create a backup of a database without username or password and database name is 'fyipe'_

The command will be `bash install.sh -u '' -p '' -n 'fyipe'`

**_Step 3 : Run backup_**

-   Simply hit the enter button, enter the remote server password and any other credentials being requested for.

-   A timer (backup.timer) which runs service (backup.service) has been created to back up the database at 12:00 am and 12:00 pm daily. Useful commands include:

`sudo systemctl status backup.service` to check status of the service

`journalctl -u backup.service` to view logs

`sudo systemctl status backup.timer` to check if timer is running and time left to when the service will be ran next.

`sudo systemctl stop backup.timer` to pause backup

`sudo systemctl start backup.timer` to start backup

## Restore a backup

The first thing to take note of is passing the right arguments.

-   cd into folder containing backup script.
-   Enter command `bash backup.sh -h` to see list of all available commands

| Argument | Function                                                    | Default                          |
| -------- | :---------------------------------------------------------- | :------------------------------- |
| -f       | Name of file to be restored.                                | No default. Compulsory argument. |
| -l       | File path on local system where file will be restored from. | /root/Documents/backup           |
| -n       | Database name. Default value                                | 'fyipedb'                        |
| -p       | Database password. Default value                            | 'password'                       |
| -u       | Set database username.                                      | 'fyipe'                          |
| -h       | Help                                                        | null                             |

_ex: To restore a backup with name fyipe-backup-1613551425.archive to a database without username or password and database name is 'fyipe'._

The command will be `/root/fyipe_bk_files bash restore.sh -f fyipe-backup-1613551425.archive -p '' -u ''`
