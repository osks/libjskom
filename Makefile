.PHONY: build e2e test-unit test help

build: ## Build TypeScript
	npm run build

e2e: ## Run e2e tests (testcontainers manages lifecycle)
	npm run test:e2e

test-unit: ## Run unit tests
	npm run test:unit

test: test-unit e2e ## Run all tests

help: ## Show this help
	@grep -E '^[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
