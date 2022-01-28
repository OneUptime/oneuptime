###
#
#   Please make sure kubectl is installed nad context is pointed to the cluster you want to resotre to.
#
#	RUN THIS BY:
#	bash restore.sh -f <FILENAME>.archive
#
###

# Variables, please check these before you run the script.

MONGO_SERVER_HOST='a59a474aad89940889c1eb69b1a8f884-135820180.us-east-2.elb.amazonaws.com'
MONGO_SERVER_PORT="27017"

ONEUPTIME_DB_USERNAME='oneuptime'
ONEUPTIME_DB_PASSWORD='password'
ONEUPTIME_DB_NAME='oneuptimedb'
CURRENT_DATE=$(date +%s)
CURRENT_USER=$(whoami)
FILE_NAME="oneuptime-backup-1638534940.archive"
FILE_PATH=~/db-backup
TODAY=$(date +"%d-%b-%Y")
ENVIRONMENT='Staging'

function HELP() {
	echo ""
	echo "OneUptime DB restore command line documentation."
	echo ""
	echo "all arguments are optional and have a default value when not set"
	echo ""
	echo " -f       Name of file to be restored"
	echo " -l       File path on local system where file will be restored from. Default value - $FILE_PATH"
	echo " -n       Database name. Default value 'oneuptimedb'"
	echo " -p       Database password. Default value 'password'"
	echo " -u       Set database username. Default value 'oneuptime'."
	echo " -v       Set database environment. Enums {Production, Staging}, defaults to 'Staging'."
	echo ""
	echo " -h       Help."
	echo ""
	exit 1
}

# PASS IN ARGUMENTS
while getopts "u:p:n:l:f:v:h" opt; do
	case $opt in
	u)
		ONEUPTIME_DB_USERNAME="$OPTARG"
		;;
	p)
		ONEUPTIME_DB_PASSWORD="$OPTARG"
		;;
	n)
		ONEUPTIME_DB_NAME="$OPTARG"
		;;
	l)
		FILE_PATH="$OPTARG"
		;;
	f)
		FILE_NAME="$OPTARG"
		;;
	v)
		ENVIRONMENT="$OPTARG"
		;;
	h)
		HELP
		;;
	\?)
		echo "Invalid option -$OPTARG" >&2
		HELP
		echo -e "Use -h to see the help documentation."
		exit 2
		;;
	esac
done

function RESTORE_SUCCESS() {
	echo " Send Backup success message to slack"

	curl -X POST -H 'Content-type: application/json' --data '{
	"blocks": [
		{
			"type": "divider"
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": "*'$ENVIRONMENT' Restore Complete*\n Date: '$TODAY'\nFile Name: '${FILE_NAME}'"
			}
		},
		{
			"type": "divider"
		}
	]
}' https://hooks.slack.com/services/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
	exit 1
}

function RESTORE_FAIL_SERVER() {
	echo "Send failure message to slack"

	curl -X POST -H 'Content-type: application/json' --data '{
	"blocks": [
		{
			"type": "divider"
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": "*'$ENVIRONMENT' Restore Failed*\n Date: '$TODAY'\nReason: Could not restore database.\nFile Name: '${FILE_NAME}'"
			}
		},
		{
			"type": "divider"
		}
	]
}' https://hooks.slack.com/services/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
	exit 1
}

function RESTORE_FAIL_LOCAL() {
	echo "Send failure message to slack"

	curl -X POST -H 'Content-type: application/json' --data '{
	"blocks": [
		{
			"type": "divider"
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": "*'$ENVIRONMENT' Restore Failed*\n Date: '$TODAY'\nReason: Could not copy backup to container.\nFile Name: '${FILE_NAME}'"
			}
		},
		{
			"type": "divider"
		}
	]
}' https://hooks.slack.com/services/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
	exit 1
}

echo "Restoring Database. This will take some time...."
echo ""
if mongorestore --authenticationDatabase="${ONEUPTIME_DB_NAME}" --host="${MONGO_SERVER_HOST}" --port="${MONGO_SERVER_PORT}" --username="${ONEUPTIME_DB_USERNAME}" --password="${ONEUPTIME_DB_PASSWORD}" --archive="$FILE_PATH/$FILE_NAME"; then
	echo "Restore success"
	RESTORE_SUCCESS
else
	echo "Restore Failed, exit status: $?"
	RESTORE_FAIL_SERVER
fi
