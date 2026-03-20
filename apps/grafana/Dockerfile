FROM grafana/grafana:11.5.1

# Install Infinity datasource plugin (for HTTP/REST/JSON polling)
ENV GF_INSTALL_PLUGINS=yesoreyeram-infinity-datasource

# Grafana config via env vars
ENV GF_SECURITY_ADMIN_USER=admin
ENV GF_SECURITY_ADMIN_PASSWORD=sportssim
ENV GF_SERVER_HTTP_PORT=3000
ENV GF_AUTH_ANONYMOUS_ENABLED=true
ENV GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer
ENV GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH=/var/lib/grafana/dashboards/sportssim-health.json

# Provisioning configs
COPY provisioning/datasources/ /etc/grafana/provisioning/datasources/
COPY provisioning/dashboards/ /etc/grafana/provisioning/dashboards/
COPY dashboards/ /var/lib/grafana/dashboards/

EXPOSE 3000
