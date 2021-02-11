FROM node:14.5-alpine

RUN apk add --no-cache git && \
  rm -rf /var/lib/apt/lists/* /var/cache/apk /usr/share/man /tmp/*


ENV app rtcstats-server

WORKDIR /$app

RUN adduser --disabled-password $app
RUN chown -R $app:$app /$app

USER $app

# Use cached node_modules in case package.json doesn't change.
COPY package.json package-lock.json /$app/

RUN npm install

COPY --chown=$app:$app . /$app

# This will run in k8s context so we use the heartbeat from there.
# HEALTHCHECK --interval=10s --timeout=10s --start-period=10s \
#   CMD curl --silent --fail http://localhost:3000/healthcheck \
#   || exit 1

EXPOSE 3000

ENTRYPOINT [ "npm" ]

CMD [ "start" ]
