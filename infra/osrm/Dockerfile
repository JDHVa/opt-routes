FROM ghcr.io/project-osrm/osrm-backend:v5.27.1
COPY data/nuevo-leon.osrm* /data/
ENV PORT=5000
EXPOSE 5000
CMD ["sh", "-c", "exec osrm-routed --algorithm mld --max-table-size 500 --port ${PORT:-5000} /data/nuevo-leon.osrm"]
