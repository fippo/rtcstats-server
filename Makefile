REGISTRY:=jitsi-dev
IMAGE:=rtcstats-server
REPOSITORY:=$(REGISTRY)/$(IMAGE)
TAG:=latest

build:
	@docker build -t $(REPOSITORY) .

run:
	@docker run \
		-p 3000:3000 \
		-p 8085:8085 \
		$(REPOSITORY):$(TAG)

debug:
	@docker run \
		-p 3000:3000 \
		-p 8085:8085 \
		-v $(PWD):/rtcstats-server \
		--entrypoint npm \
		$(REPOSITORY):$(TAG) \
		run watch:dev

push: build
	@echo "Push not configured."
	#@docker push $(REGISTRY)/$(IMAGE)
