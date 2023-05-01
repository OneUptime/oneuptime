CREATE ROLE readonlyuser WITH LOGIN PASSWORD '<password>'
GRANT pg_read_all_data TO readonlyuser;