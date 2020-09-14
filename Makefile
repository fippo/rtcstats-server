REGISTRY:=jitsi-dev
IMAGE:=rtcstats-server
REPOSITORY:=$(REGISTRY)/$(IMAGE)
TAG:=latest

build:
	@docker build -t $(REPOSITORY) .

run:
	@docker run \
		-p 3000:3000 \
		-p 8095:8095 \
		$(REPOSITORY):$(TAG)

test:
	@docker run \
		-p 3000:3000 \
		-p 8095:8095 \
		-v $(PWD):/rtcstats-server \
		--env RTCSTATS_LOG_LEVEL=debug \
		--entrypoint npm \
		--cpus=2 \
		$(REPOSITORY):$(TAG) \
		run test

debug-restricted:
	@docker run \
		-p 3000:3000 \
		-p 8095:8095 \
		--env RTCSTATS_LOG_LEVEL=info \
		--entrypoint npm \
		--cpuset-cpus=0 \
		$(REPOSITORY):$(TAG) \
		run debug

debug:
	@docker run \
		-p 3000:3000 \
		-p 8095:8095 \
		-v $(PWD):/rtcstats-server \
		--entrypoint npm \
		$(REPOSITORY):$(TAG) \
		run watch:dev

push: build
	@echo "Push not configured."
	#@docker push $(REGISTRY)/$(IMAGE)
