FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/nginx.conf

CMD ["/bin/sh", "-c", "mkdir -p /etc/nginx/certs && test -f /etc/nginx/certs/tls.crt || openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost -keyout /etc/nginx/certs/tls.key -out /etc/nginx/certs/tls.crt && exec nginx -g 'daemon off;'"]
