#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
ENV_FILE="${SCRIPT_DIR}/.env"
ENV_TEMPLATE="${SCRIPT_DIR}/.env.staging.example"

log() {
  printf '[staging-deploy] %s\n' "$*"
}

fail() {
  printf '[staging-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

require_command() {
  local cmd="$1"
  command -v "${cmd}" >/dev/null 2>&1 || fail "Required command not found: ${cmd}"
}

check_required_vars() {
  local missing=()
  local required_vars=(
    COMPOSE_PROJECT_NAME
    APP_HOST
    PUBLIC_URL
    ACME_EMAIL
    POSTGRES_PASSWORD
    SESSION_SECRET
    AUTH_PROVIDER
  )

  for var_name in "${required_vars[@]}"; do
    if [[ -z "${!var_name:-}" ]]; then
      missing+=("${var_name}")
    fi
  done

  if ((${#missing[@]} > 0)); then
    fail "Missing required vars in deploy/.env: ${missing[*]}"
  fi
}

check_placeholder_values() {
  local placeholder_error=false

  case "${POSTGRES_PASSWORD}" in
    "replace-with-"*)
      printf '[staging-deploy] ERROR: POSTGRES_PASSWORD still has placeholder value\n' >&2
      placeholder_error=true
      ;;
  esac

  case "${SESSION_SECRET}" in
    "replace-with-"*|"your-random-"*)
      printf '[staging-deploy] ERROR: SESSION_SECRET still has placeholder value\n' >&2
      placeholder_error=true
      ;;
  esac

  case "${APP_HOST}" in
    "beta.example.com"|"training.example.com")
      printf '[staging-deploy] ERROR: APP_HOST still has placeholder host value\n' >&2
      placeholder_error=true
      ;;
  esac

  case "${ACME_EMAIL}" in
    "ops@example.com"|"admin@example.com")
      printf '[staging-deploy] ERROR: ACME_EMAIL still has placeholder email value\n' >&2
      placeholder_error=true
      ;;
  esac

  case "${PUBLIC_URL}" in
    "https://beta.example.com"|"https://training.example.com"|"http://localhost:3001")
      printf '[staging-deploy] ERROR: PUBLIC_URL still has placeholder/local value\n' >&2
      placeholder_error=true
      ;;
  esac

  if [[ "${AUTH_PROVIDER}" != "dev" ]]; then
    printf '[staging-deploy] ERROR: AUTH_PROVIDER must be "dev" right now (other providers are not implemented)\n' >&2
    placeholder_error=true
  fi

  local public_url_host
  public_url_host="${PUBLIC_URL#https://}"
  public_url_host="${public_url_host#http://}"
  public_url_host="${public_url_host%%/*}"

  if [[ "${public_url_host}" != "${APP_HOST}" ]]; then
    printf '[staging-deploy] ERROR: PUBLIC_URL host (%s) must match APP_HOST (%s)\n' "${public_url_host}" "${APP_HOST}" >&2
    placeholder_error=true
  fi

  if [[ "${placeholder_error}" == "true" ]]; then
    fail "Fix deploy/.env values and re-run."
  fi
}

wait_for_migrate_success() {
  local timeout_seconds=300
  local interval_seconds=2
  local elapsed=0

  log "Waiting for migrate service to complete..."

  while ((elapsed < timeout_seconds)); do
    local container_id
    container_id="$(compose ps -q migrate)"

    if [[ -n "${container_id}" ]]; then
      local status
      status="$(docker inspect -f '{{.State.Status}}' "${container_id}" 2>/dev/null || true)"

      if [[ "${status}" == "exited" ]]; then
        local exit_code
        exit_code="$(docker inspect -f '{{.State.ExitCode}}' "${container_id}")"
        if [[ "${exit_code}" == "0" ]]; then
          log "Migrations completed successfully."
          return 0
        fi
        compose logs migrate || true
        fail "Migration service failed with exit code ${exit_code}."
      fi
    fi

    sleep "${interval_seconds}"
    elapsed=$((elapsed + interval_seconds))
  done

  compose logs migrate || true
  fail "Timed out waiting for migration service."
}

wait_for_app_healthy() {
  local timeout_seconds=300
  local interval_seconds=2
  local elapsed=0

  log "Waiting for app service health check..."

  while ((elapsed < timeout_seconds)); do
    local container_id
    container_id="$(compose ps -q app)"
    if [[ -n "${container_id}" ]]; then
      local health
      health="$(
        docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
          "${container_id}" 2>/dev/null || true
      )"

      case "${health}" in
        healthy)
          log "App service is healthy."
          return 0
          ;;
        unhealthy|exited|dead)
          compose logs app || true
          fail "App service became ${health}."
          ;;
      esac
    fi

    sleep "${interval_seconds}"
    elapsed=$((elapsed + interval_seconds))
  done

  compose logs app || true
  fail "Timed out waiting for app health check."
}

main() {
  require_command docker
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is required."
  docker info >/dev/null 2>&1 || fail "Docker daemon is not running or not accessible."

  if [[ ! -f "${ENV_FILE}" ]]; then
    fail "Missing ${ENV_FILE}. Copy ${ENV_TEMPLATE} to ${ENV_FILE} and fill in real values."
  fi

  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a

  check_required_vars
  check_placeholder_values

  log "Validating docker compose configuration..."
  compose config >/dev/null

  log "Building and starting staging stack..."
  compose up -d --build

  wait_for_migrate_success
  wait_for_app_healthy

  log "Deployment complete."
  compose ps
  log "URL: ${PUBLIC_URL}"
  log "Useful logs: docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} logs -f app caddy"
}

main "$@"
