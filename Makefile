.PHONY: help install dev build test lint typecheck clean

help:
	@echo "HWPX Viewer — available targets:"
	@echo "  make install    - pnpm install (web deps)"
	@echo "  make dev        - start web dev server (Vite)"
	@echo "  make build      - build web for production"
	@echo "  make test       - run all unit tests"
	@echo "  make lint       - lint all packages"
	@echo "  make typecheck  - tsc --noEmit for web"
	@echo "  make clean      - remove node_modules, dist, caches"

install:
	pnpm install

dev:
	pnpm -C apps/web dev

build:
	pnpm -C apps/web build

test:
	pnpm -C apps/web test

lint:
	pnpm -C apps/web lint

typecheck:
	pnpm -C apps/web typecheck

clean:
	rm -rf node_modules apps/*/node_modules apps/*/dist apps/*/.vite
	rm -rf coverage playwright-report test-results
