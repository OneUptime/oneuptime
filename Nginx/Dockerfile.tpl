FROM nginx
COPY ./Nginx/default.conf /etc/nginx/conf.d/default.conf
COPY ./Certs /etc/nginx/certs