FROM nginx:alpine
COPY . /usr/share/nginx/html
RUN sed -i 's/listen[[:space:]][[:space:]]*80;/listen 8080;/' /etc/nginx/conf.d/default.conf \
    && chmod -R 644 /usr/share/nginx/html \
    && find /usr/share/nginx/html -type d -exec chmod 755 {} +
EXPOSE 8080
