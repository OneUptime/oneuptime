# Create .env file if it does not exist. 
touch config.env

#Run a scirpt to merge config.env.tpl to config.env
ts-node-esm ./Scripts/Install/MergeEnvTemplate.ts

cat config.env.temp | gomplate > config.env


rm config.env.temp

# Load env values from config.env
export $(grep -v '^#' config.env | xargs)

# Write env vars in config files. 


for directory_name in $(find . -maxdepth 1 -type d) ; do
    if [ -f "$directory_name/.env.tpl" ]; then
        cat $directory_name/.env.tpl | gomplate > $directory_name/.env
    fi

    if [ -f "$directory_name/Dockerfile.tpl" ]; then
        cat $directory_name/Dockerfile.tpl | gomplate > $directory_name/Dockerfile
    fi
done

# Convert template to docker-compose. 
cat docker-compose.tpl.yml | gomplate > docker-compose.yml


# Convert nginx conf template to nginx
cat ./Nginx/default.tpl.conf | gomplate > ./Nginx/default.conf