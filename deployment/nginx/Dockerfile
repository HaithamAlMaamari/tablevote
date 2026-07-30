FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/nginx.conf

CMD ["/bin/sh", "-c", "mkdir -p /etc/nginx/certs && test -f /etc/nginx/certs/tls.crt || openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost -keyout /etc/nginx/certs/tls.key -out /etc/nginx/certs/tls.crt && exec nginx -g 'daemon off;'"]
