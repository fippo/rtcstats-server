REGISTRY:=juandebravo
IMAGE:=rtcstats-server
REPOSITORY:=$(REGISTRY)/$(IMAGE)
TAG:=latest

build:
	@docker build -t $(REPOSITORY) .
