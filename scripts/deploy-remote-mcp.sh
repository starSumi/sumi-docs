#!/usr/bin/env bash

set -euo pipefail

stable_name="sumi-docs-mcp"

fail() {
  printf 'Deployment failed: %s\n' "$1" >&2
  exit 1
}

require_sha256() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "$2 must be a sha256 digest"
}

require_commit() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || fail "$2 must be a full lowercase Git SHA"
}

container_exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

label_value() {
  docker container inspect "$1" --format "{{index .Config.Labels \"$2\"}}"
}

require_hostname_csv() {
  local value="$1"
  local label="$2"
  [[ -n "$value" && "$value" != *'*'* && "$value" != *'://'* ]] || fail "$label must contain explicit hostnames"
  local -A seen=()
  local host
  IFS=',' read -ra hosts <<< "$value"
  ((${#hosts[@]} > 0)) || fail "$label must not be empty"
  for host in "${hosts[@]}"; do
    [[ "$host" =~ ^([a-z0-9]([a-z0-9.-]*[a-z0-9])?|127\.0\.0\.1)$ ]] || fail "$label contains an invalid hostname"
    [[ -z "${seen[$host]:-}" ]] || fail "$label contains a duplicate hostname"
    seen[$host]=1
  done
}

transaction_name_for() {
  printf 'sumi-docs-mcp-transaction-%s\n' "${1:0:12}"
}

completion_name_for() {
  printf 'sumi-docs-mcp-completion-%s\n' "${1:0:12}"
}

terminal_name_for() {
  printf 'sumi-docs-mcp-terminal-%s\n' "${1:0:12}"
}

write_transaction_terminal() {
  local commit="$1"
  local image_ref="$2"
  local image_id="$3"
  local outcome="$4"
  local prior_state="$5"
  local restored_image="$6"
  local restored_image_id="$7"
  local restored_build_revision="$8"
  local restored_corpus_revision="$9"
  local terminal_name
  terminal_name="$(terminal_name_for "$commit")"
  container_exists "$terminal_name" && fail "deployment terminal evidence already exists"
  [[ "$outcome" = committed || "$outcome" = rolled-back ]] || fail "terminal outcome is invalid"
  [[ "$prior_state" = present || "$prior_state" = absent ]] || fail "terminal prior state is invalid"
  docker create \
    --name "$terminal_name" \
    --label 'io.sumi.docs.terminal-schema=1' \
    --label "io.sumi.docs.terminal-outcome=$outcome" \
    --label "io.sumi.docs.terminal-commit=$commit" \
    --label "io.sumi.docs.terminal-new-image=$image_ref" \
    --label "io.sumi.docs.terminal-new-image-id=$image_id" \
    --label "io.sumi.docs.terminal-prior-state=$prior_state" \
    --label "io.sumi.docs.terminal-restored-image=$restored_image" \
    --label "io.sumi.docs.terminal-restored-image-id=$restored_image_id" \
    --label "io.sumi.docs.terminal-restored-build-revision=$restored_build_revision" \
    --label "io.sumi.docs.terminal-restored-corpus-revision=$restored_corpus_revision" \
    "$image_id" >/dev/null
}

validate_terminal_identity() {
  local terminal_name="$1"
  local commit="$2"
  local image_ref="$3"
  local image_id="$4"
  [[ "$(label_value "$terminal_name" io.sumi.docs.terminal-schema)" = 1 ]] || fail "terminal evidence schema is invalid"
  [[ "$(label_value "$terminal_name" io.sumi.docs.terminal-commit)" = "$commit" ]] || fail "terminal evidence commit differs"
  [[ "$(label_value "$terminal_name" io.sumi.docs.terminal-new-image)" = "$image_ref" ]] || fail "terminal evidence image differs"
  [[ "$(label_value "$terminal_name" io.sumi.docs.terminal-new-image-id)" = "$image_id" ]] || fail "terminal evidence image ID differs"
  [[ "$(docker container inspect "$terminal_name" --format '{{.Image}}')" = "$image_id" ]] || fail "terminal marker container image differs"
}

cleanup_transaction_evidence() {
  local commit="$1"
  local rollback_name="sumi-docs-mcp-rollback-${commit:0:12}"
  local transaction_name
  local completion_name
  transaction_name="$(transaction_name_for "$commit")"
  completion_name="$(completion_name_for "$commit")"
  local cleanup_failed=false
  local evidence_name
  local attempt
  for evidence_name in "$rollback_name" "$completion_name" "$transaction_name"; do
    if container_exists "$evidence_name"; then
      for attempt in 1 2 3; do
        docker rm "$evidence_name" >/dev/null 2>&1 && break
        sleep 1
      done
      if container_exists "$evidence_name"; then
        printf 'Deployment cleanup deferred for %s\n' "$evidence_name" >&2
        cleanup_failed=true
      fi
    fi
  done
  [[ "$cleanup_failed" = false ]]
}

write_transaction_intent() {
  local commit="$1"
  local image_ref="$2"
  local image_id="$3"
  local state="$4"
  local prior_state="$5"
  local old_image="$6"
  local old_image_id="$7"
  local old_build_revision="$8"
  local old_corpus_revision="$9"
  local transaction_name
  transaction_name="$(transaction_name_for "$commit")"
  container_exists "$transaction_name" && fail "a deployment transaction marker already exists"
  docker create \
    --name "$transaction_name" \
    --label 'io.sumi.docs.transaction-schema=1' \
    --label "io.sumi.docs.transaction-state=$state" \
    --label "io.sumi.docs.transaction-commit=$commit" \
    --label "io.sumi.docs.transaction-new-image=$image_ref" \
    --label "io.sumi.docs.transaction-new-image-id=$image_id" \
    --label "io.sumi.docs.transaction-prior-state=$prior_state" \
    --label "io.sumi.docs.transaction-old-image=$old_image" \
    --label "io.sumi.docs.transaction-old-image-id=$old_image_id" \
    --label "io.sumi.docs.transaction-old-build-revision=$old_build_revision" \
    --label "io.sumi.docs.transaction-old-corpus-revision=$old_corpus_revision" \
    "$image_id" >/dev/null
}

write_transaction_completion() {
  local commit="$1"
  local image_ref="$2"
  local image_id="$3"
  local completion_name
  completion_name="$(completion_name_for "$commit")"
  container_exists "$completion_name" && fail "deployment completion evidence already exists"
  docker create \
    --name "$completion_name" \
    --label 'io.sumi.docs.completion-schema=1' \
    --label "io.sumi.docs.completion-commit=$commit" \
    --label "io.sumi.docs.completion-image=$image_ref" \
    --label "io.sumi.docs.completion-image-id=$image_id" \
    "$image_id" >/dev/null
}

verify_container() {
  local name="$1"
  local commit="$2"
  local corpus_revision="$3"
  docker exec \
    --env "EXPECTED_BUILD_REVISION=$commit" \
    --env "EXPECTED_CORPUS_REVISION=$corpus_revision" \
    "$name" \
    node -e '
      const response = await fetch("http://127.0.0.1:3000/readyz");
      if (!response.ok) process.exit(1);
      const value = await response.json();
      if (value.status !== "ready" ||
          value.buildRevision !== process.env.EXPECTED_BUILD_REVISION ||
          value.corpus?.revision !== process.env.EXPECTED_CORPUS_REVISION ||
          !Number.isInteger(value.corpus?.documentCount) ||
          value.corpus.documentCount <= 0) process.exit(1);
    '
}

wait_until_ready() {
  local name="$1"
  local commit="$2"
  local corpus_revision="$3"
  local attempt
  for attempt in {1..30}; do
    if verify_container "$name" "$commit" "$corpus_revision"; then
      return
    fi
    if [[ "$attempt" = 30 ]]; then
      docker logs "$name" >&2 || true
      fail "$name did not expose the expected readiness evidence"
    fi
    sleep 1
  done
}

run_container() {
  local name="$1"
  local port="$2"
  local image_id="$3"
  local image_ref="$4"
  local commit="$5"
  local corpus_revision="$6"
  local allowed_hosts="$7"
  local allowed_origin_hosts="$8"
  docker run --detach \
    --name "$name" \
    --init \
    --restart unless-stopped \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
    --pids-limit 128 \
    --publish "127.0.0.1:${port}:3000" \
    --env "SUMI_DOCS_ALLOWED_HOSTS=$allowed_hosts" \
    --env "SUMI_DOCS_ALLOWED_ORIGINS=$allowed_origin_hosts" \
    --env "SUMI_DOCS_BUILD_REVISION=$commit" \
    --env "SUMI_DOCS_EXPECTED_CORPUS_REVISION=$corpus_revision" \
    --label "io.sumi.docs.deployed-image=$image_ref" \
    --label "io.sumi.docs.build-revision=$commit" \
    --label "io.sumi.docs.corpus-revision=$corpus_revision" \
    "$image_id" >/dev/null
}

stage() {
  [[ "$#" = 7 ]] || fail "stage requires archive, image ID, image ref, commit, corpus revision, allowed hosts, and allowed origins"
  local archive="$1"
  local image_id="$2"
  local image_ref="$3"
  local commit="$4"
  local corpus_revision="$5"
  local allowed_hosts="$6"
  local allowed_origin_hosts="$7"
  local prior_state="absent"
  if container_exists "$stable_name"; then
    prior_state="present"
  fi
  require_sha256 "$image_id" "image ID"
  [[ "$image_ref" =~ ^ghcr\.io/[a-z0-9._-]+/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || fail "image ref must be a GHCR digest reference"
  require_commit "$commit" "commit"
  require_sha256 "$corpus_revision" "corpus revision"
  [[ -f "$archive" && ! -L "$archive" ]] || fail "image archive is missing or symbolic"
  require_hostname_csv "$allowed_hosts" "allowed hosts"
  [[ ",$allowed_hosts," == *",localhost,"* && ",$allowed_hosts," == *",127.0.0.1,"* ]] || fail "allowed hosts must include loopback names"
  require_hostname_csv "$allowed_origin_hosts" "allowed origin hosts"

  local token="${commit:0:12}"
  local candidate_name="sumi-docs-mcp-candidate-$token"
  local rollback_name="sumi-docs-mcp-rollback-$token"
  local transaction_name
  local completion_name
  local terminal_name
  transaction_name="$(transaction_name_for "$commit")"
  completion_name="$(completion_name_for "$commit")"
  terminal_name="$(terminal_name_for "$commit")"

  if container_exists "$terminal_name"; then
    validate_terminal_identity "$terminal_name" "$commit" "$image_ref" "$image_id"
    local terminal_outcome
    local terminal_prior_state
    terminal_outcome="$(label_value "$terminal_name" io.sumi.docs.terminal-outcome)"
    terminal_prior_state="$(label_value "$terminal_name" io.sumi.docs.terminal-prior-state)"
    [[ "$terminal_prior_state" = present || "$terminal_prior_state" = absent ]] || fail "terminal prior state is invalid"
    if [[ "$terminal_outcome" = committed ]]; then
      container_exists "$stable_name" || fail "committed deployment has no stable container"
      [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$image_ref" ]] || fail "committed stable image differs"
      [[ "$(docker container inspect "$stable_name" --format '{{.Image}}')" = "$image_id" ]] || fail "committed stable image ID differs"
      [[ "$(label_value "$stable_name" io.sumi.docs.build-revision)" = "$commit" ]] || fail "committed stable build revision differs"
      [[ "$(label_value "$stable_name" io.sumi.docs.corpus-revision)" = "$corpus_revision" ]] || fail "committed stable corpus revision differs"
      wait_until_ready "$stable_name" "$commit" "$corpus_revision"
      if ! cleanup_transaction_evidence "$commit"; then
        printf 'Committed transaction cleanup will be retried by a later release.\n' >&2
      fi
      trap - ERR INT TERM HUP
      printf '{"schemaVersion":1,"changed":false,"token":"%s","newImage":"%s","newImageId":"%s","oldImage":null,"oldImageId":null}\n' "$token" "$image_ref" "$image_id"
      return
    fi
    [[ "$terminal_outcome" = rolled-back ]] || fail "terminal outcome is invalid"
    ! container_exists "$rollback_name" || fail "rolled-back terminal still has rollback evidence"
    ! container_exists "$completion_name" || fail "rolled-back terminal still has completion evidence"
    ! container_exists "$transaction_name" || fail "rolled-back terminal still has transaction evidence"
    if [[ "$terminal_prior_state" = present ]]; then
      container_exists "$stable_name" || fail "rolled-back terminal has no restored stable container"
      local restored_image
      local restored_image_id
      local restored_build_revision
      local restored_corpus_revision
      restored_image="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-image)"
      restored_image_id="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-image-id)"
      restored_build_revision="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-build-revision)"
      restored_corpus_revision="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-corpus-revision)"
      [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$restored_image" ]] || fail "rolled-back stable image differs"
      [[ "$(docker container inspect "$stable_name" --format '{{.Image}}')" = "$restored_image_id" ]] || fail "rolled-back stable image ID differs"
      [[ "$(label_value "$stable_name" io.sumi.docs.build-revision)" = "$restored_build_revision" ]] || fail "rolled-back stable build revision differs"
      [[ "$(label_value "$stable_name" io.sumi.docs.corpus-revision)" = "$restored_corpus_revision" ]] || fail "rolled-back stable corpus revision differs"
      wait_until_ready "$stable_name" "$restored_build_revision" "$restored_corpus_revision"
    else
      ! container_exists "$stable_name" || fail "rolled-back bootstrap terminal contradicts a stable container"
    fi
    # A completed rollback may be superseded only before the new intent exists.
    docker rm "$terminal_name" >/dev/null
  fi
  stage_compensate() {
    local status="$1"
    trap - ERR INT TERM HUP
    rollback "$commit" "$image_ref" "$prior_state" || true
    exit "$status"
  }
  trap 'stage_compensate $?' ERR
  trap 'stage_compensate 130' INT
  trap 'stage_compensate 143' TERM
  trap 'stage_compensate 129' HUP
  if container_exists "$rollback_name"; then
    fail "a preserved rollback container already exists for this deployment"
  fi
  if container_exists "$transaction_name"; then
    fail "a deployment transaction marker already exists for this deployment"
  fi
  if container_exists "$completion_name"; then
    fail "deployment completion evidence already exists for this deployment"
  fi

  docker load --input "$archive" >&2
  local actual_image_id
  actual_image_id="$(docker image inspect "$image_id" --format '{{.Id}}')"
  [[ "$actual_image_id" = "$image_id" ]] || fail "loaded image ID differs from the build record"
  local image_revision
  image_revision="$(docker image inspect "$image_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
  [[ "$image_revision" = "$commit" ]] || fail "image provenance revision differs from the deployment commit"

  if container_exists "$stable_name" &&
    [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$image_ref" ]] &&
    [[ "$(label_value "$stable_name" io.sumi.docs.build-revision)" = "$commit" ]] &&
    [[ "$(label_value "$stable_name" io.sumi.docs.corpus-revision)" = "$corpus_revision" ]]; then
    wait_until_ready "$stable_name" "$commit" "$corpus_revision"
    write_transaction_intent "$commit" "$image_ref" "$image_id" idempotent absent "" "" "" ""
    trap - ERR INT TERM HUP
    printf '{"schemaVersion":1,"changed":false,"token":"%s","newImage":"%s","newImageId":"%s","oldImage":null,"oldImageId":null}\n' "$token" "$image_ref" "$image_id"
    return
  fi

  if container_exists "$candidate_name"; then
    docker rm --force "$candidate_name" >/dev/null
  fi
  run_container "$candidate_name" 3001 "$image_id" "$image_ref" "$commit" "$corpus_revision" "$allowed_hosts" "$allowed_origin_hosts"
  wait_until_ready "$candidate_name" "$commit" "$corpus_revision"
  docker rm --force "$candidate_name" >/dev/null

  local old_image=""
  local old_image_id=""
  local old_build_revision=""
  local old_corpus_revision=""
  if container_exists "$stable_name"; then
    local old_image_value
    local old_image_id_value
    old_image_value="$(label_value "$stable_name" io.sumi.docs.deployed-image)"
    old_image_id_value="$(docker container inspect "$stable_name" --format '{{.Image}}')"
    old_build_revision="$(label_value "$stable_name" io.sumi.docs.build-revision)"
    old_corpus_revision="$(label_value "$stable_name" io.sumi.docs.corpus-revision)"
    [[ "$old_image_value" =~ ^ghcr\.io/.+@sha256:[0-9a-f]{64}$ ]] || fail "stable container has no rollback image digest"
    require_sha256 "$old_image_id_value" "stable container image ID"
    require_commit "$old_build_revision" "stable container build revision"
    require_sha256 "$old_corpus_revision" "stable container corpus revision"
    old_image="$old_image_value"
    old_image_id="$old_image_id_value"
  fi

  # The immutable intent is durable before the first stable-service mutation.
  write_transaction_intent "$commit" "$image_ref" "$image_id" prepared "$prior_state" "$old_image" "$old_image_id" "$old_build_revision" "$old_corpus_revision"
  if [[ "$prior_state" = present ]]; then
    docker stop --time 10 "$stable_name" >/dev/null
    docker rename "$stable_name" "$rollback_name"
  fi

  if ! run_container "$stable_name" 3000 "$image_id" "$image_ref" "$commit" "$corpus_revision" "$allowed_hosts" "$allowed_origin_hosts" ||
    ! wait_until_ready "$stable_name" "$commit" "$corpus_revision"; then
    docker rm --force "$stable_name" >/dev/null 2>&1 || true
    if container_exists "$rollback_name"; then
      docker rename "$rollback_name" "$stable_name"
      docker start "$stable_name" >/dev/null
    fi
    fail "stable-port switch failed and was compensated"
  fi

  # Completion is a second immutable fact; intent remains available for recovery.
  write_transaction_completion "$commit" "$image_ref" "$image_id"
  trap - ERR INT TERM HUP
  if [[ "$prior_state" = present ]]; then
    printf '{"schemaVersion":1,"changed":true,"token":"%s","newImage":"%s","newImageId":"%s","oldImage":"%s","oldImageId":"%s"}\n' "$token" "$image_ref" "$image_id" "$old_image" "$old_image_id"
  else
    printf '{"schemaVersion":1,"changed":true,"token":"%s","newImage":"%s","newImageId":"%s","oldImage":null,"oldImageId":null}\n' "$token" "$image_ref" "$image_id"
  fi
}

finalize() {
  [[ "$#" = 2 ]] || fail "finalize requires commit and image ref"
  local commit="$1"
  local image_ref="$2"
  require_commit "$commit" "commit"
  local transaction_name
  local completion_name
  local terminal_name
  transaction_name="$(transaction_name_for "$commit")"
  completion_name="$(completion_name_for "$commit")"
  terminal_name="$(terminal_name_for "$commit")"
  container_exists "$stable_name" || fail "stable container is missing"
  [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$image_ref" ]] || fail "stable container no longer matches the deployment"
  local stable_image_id
  local stable_build_revision
  local stable_corpus_revision
  stable_image_id="$(docker container inspect "$stable_name" --format '{{.Image}}')"
  stable_build_revision="$(label_value "$stable_name" io.sumi.docs.build-revision)"
  stable_corpus_revision="$(label_value "$stable_name" io.sumi.docs.corpus-revision)"
  require_sha256 "$stable_image_id" "stable image ID"
  [[ "$stable_build_revision" = "$commit" ]] || fail "stable build revision differs"
  require_sha256 "$stable_corpus_revision" "stable corpus revision"
  wait_until_ready "$stable_name" "$stable_build_revision" "$stable_corpus_revision"

  if container_exists "$terminal_name"; then
    validate_terminal_identity "$terminal_name" "$commit" "$image_ref" "$stable_image_id"
    [[ "$(label_value "$terminal_name" io.sumi.docs.terminal-outcome)" = committed ]] || fail "rolled-back deployment cannot be finalized"
    [[ "$(label_value "$terminal_name" io.sumi.docs.terminal-restored-image)" = "$image_ref" ]] || fail "committed terminal image differs"
    [[ "$(label_value "$terminal_name" io.sumi.docs.terminal-restored-image-id)" = "$stable_image_id" ]] || fail "committed terminal image ID differs"
    [[ "$(label_value "$terminal_name" io.sumi.docs.terminal-restored-build-revision)" = "$stable_build_revision" ]] || fail "committed terminal build revision differs"
    [[ "$(label_value "$terminal_name" io.sumi.docs.terminal-restored-corpus-revision)" = "$stable_corpus_revision" ]] || fail "committed terminal corpus revision differs"
    if ! cleanup_transaction_evidence "$commit"; then
      printf 'Committed transaction cleanup will be retried by recovery.\n' >&2
    fi
    return
  fi

  container_exists "$transaction_name" || fail "deployment intent is missing"
  local image_id
  local prior_state
  image_id="$(label_value "$transaction_name" io.sumi.docs.transaction-new-image-id)"
  prior_state="$(label_value "$transaction_name" io.sumi.docs.transaction-prior-state)"
  require_sha256 "$image_id" "transaction image ID"
  [[ "$stable_image_id" = "$image_id" ]] || fail "stable image ID differs from deployment intent"
  [[ "$prior_state" = present || "$prior_state" = absent ]] || fail "deployment prior state is invalid"
  local intent_state
  intent_state="$(label_value "$transaction_name" io.sumi.docs.transaction-state)"
  [[ "$intent_state" = idempotent || "$intent_state" = prepared ]] || fail "deployment intent state is invalid"
  if [[ "$intent_state" = prepared ]]; then
    container_exists "$completion_name" || fail "deployment completion evidence is missing"
  else
    ! container_exists "$completion_name" || fail "idempotent deployment has unexpected completion evidence"
  fi
  write_transaction_terminal "$commit" "$image_ref" "$image_id" committed "$prior_state" \
    "$image_ref" "$stable_image_id" "$stable_build_revision" "$stable_corpus_revision"
  if ! cleanup_transaction_evidence "$commit"; then
    printf 'Committed transaction cleanup will be retried by recovery.\n' >&2
  fi
}

observe() {
  [[ "$#" = 3 ]] || fail "observe requires commit, image ref, and image ID"
  local commit="$1"
  local image_ref="$2"
  local image_id="$3"
  require_commit "$commit" "commit"
  [[ "$image_ref" =~ ^ghcr\.io/[a-z0-9._-]+/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || fail "image ref must be a GHCR digest reference"
  require_sha256 "$image_id" "image ID"
  local token="${commit:0:12}"
  local rollback_name="sumi-docs-mcp-rollback-$token"
  local transaction_name
  local completion_name
  local terminal_name
  transaction_name="$(transaction_name_for "$commit")"
  completion_name="$(completion_name_for "$commit")"
  terminal_name="$(terminal_name_for "$commit")"

  if container_exists "$terminal_name"; then
    validate_terminal_identity "$terminal_name" "$commit" "$image_ref" "$image_id"
    local terminal_outcome
    local terminal_prior_state
    local restored_image
    local restored_image_id
    local restored_build_revision
    local restored_corpus_revision
    terminal_outcome="$(label_value "$terminal_name" io.sumi.docs.terminal-outcome)"
    terminal_prior_state="$(label_value "$terminal_name" io.sumi.docs.terminal-prior-state)"
    restored_image="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-image)"
    restored_image_id="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-image-id)"
    restored_build_revision="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-build-revision)"
    restored_corpus_revision="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-corpus-revision)"
    [[ "$terminal_prior_state" = present || "$terminal_prior_state" = absent ]] || fail "terminal prior state is invalid"
    if [[ "$terminal_outcome" = committed ]]; then
      [[ "$restored_image" = "$image_ref" && "$restored_image_id" = "$image_id" ]] || fail "committed terminal restored identity differs"
      [[ "$restored_build_revision" = "$commit" ]] || fail "committed terminal build revision differs"
      require_sha256 "$restored_corpus_revision" "committed terminal corpus revision"
      container_exists "$stable_name" || fail "committed terminal has no stable container"
      [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$restored_image" ]] || fail "committed stable image differs"
      [[ "$(docker container inspect "$stable_name" --format '{{.Image}}')" = "$restored_image_id" ]] || fail "committed stable image ID differs"
      [[ "$(label_value "$stable_name" io.sumi.docs.build-revision)" = "$restored_build_revision" ]] || fail "committed stable build revision differs"
      [[ "$(label_value "$stable_name" io.sumi.docs.corpus-revision)" = "$restored_corpus_revision" ]] || fail "committed stable corpus revision differs"
      wait_until_ready "$stable_name" "$restored_build_revision" "$restored_corpus_revision"
      printf '{"schemaVersion":1,"state":"committed","priorState":"%s","rollbackRequired":false,"switch":null}\n' "$terminal_prior_state"
      return
    fi
    [[ "$terminal_outcome" = rolled-back ]] || fail "terminal outcome is invalid"
    if [[ "$terminal_prior_state" = present ]]; then
      [[ "$restored_image" =~ ^ghcr\.io/.+@sha256:[0-9a-f]{64}$ ]] || fail "rolled-back terminal image is invalid"
      require_sha256 "$restored_image_id" "rolled-back terminal image ID"
      require_commit "$restored_build_revision" "rolled-back terminal build revision"
      require_sha256 "$restored_corpus_revision" "rolled-back terminal corpus revision"
      container_exists "$stable_name" || fail "rolled-back terminal has no restored stable container"
      [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$restored_image" ]] || fail "rolled-back stable image differs"
      [[ "$(docker container inspect "$stable_name" --format '{{.Image}}')" = "$restored_image_id" ]] || fail "rolled-back stable image ID differs"
      [[ "$(label_value "$stable_name" io.sumi.docs.build-revision)" = "$restored_build_revision" ]] || fail "rolled-back stable build revision differs"
      [[ "$(label_value "$stable_name" io.sumi.docs.corpus-revision)" = "$restored_corpus_revision" ]] || fail "rolled-back stable corpus revision differs"
      wait_until_ready "$stable_name" "$restored_build_revision" "$restored_corpus_revision"
    else
      [[ -z "$restored_image" && -z "$restored_image_id" && -z "$restored_build_revision" && -z "$restored_corpus_revision" ]] || fail "rolled-back bootstrap terminal claims a restored tuple"
      ! container_exists "$stable_name" || fail "rolled-back bootstrap terminal contradicts a stable container"
    fi
    printf '{"schemaVersion":1,"state":"rolled-back","priorState":"%s","rollbackRequired":false,"switch":null}\n' "$terminal_prior_state"
    return
  fi

  if ! container_exists "$transaction_name"; then
    container_exists "$completion_name" && fail "completion evidence exists without deployment intent"
    container_exists "$rollback_name" && fail "switch state is unknown because rollback exists without transaction evidence"
    if container_exists "$stable_name" &&
      [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$image_ref" ]] &&
      [[ "$(docker container inspect "$stable_name" --format '{{.Image}}')" = "$image_id" ]]; then
      fail "switch state is unknown because the candidate is stable without transaction evidence"
    fi
    printf '{"schemaVersion":1,"state":"absent","priorState":"absent","rollbackRequired":false,"switch":null}\n'
    return
  fi

  [[ "$(label_value "$transaction_name" io.sumi.docs.transaction-schema)" = 1 ]] || fail "transaction marker schema is invalid"
  [[ "$(label_value "$transaction_name" io.sumi.docs.transaction-commit)" = "$commit" ]] || fail "transaction marker commit differs"
  [[ "$(label_value "$transaction_name" io.sumi.docs.transaction-new-image)" = "$image_ref" ]] || fail "transaction marker image differs"
  [[ "$(label_value "$transaction_name" io.sumi.docs.transaction-new-image-id)" = "$image_id" ]] || fail "transaction marker image ID differs"
  [[ "$(docker container inspect "$transaction_name" --format '{{.Image}}')" = "$image_id" ]] || fail "transaction marker container image differs"
  local state
  local prior_state
  local old_image
  local old_image_id
  local old_build_revision
  local old_corpus_revision
  state="$(label_value "$transaction_name" io.sumi.docs.transaction-state)"
  prior_state="$(label_value "$transaction_name" io.sumi.docs.transaction-prior-state)"
  old_image="$(label_value "$transaction_name" io.sumi.docs.transaction-old-image)"
  old_image_id="$(label_value "$transaction_name" io.sumi.docs.transaction-old-image-id)"
  old_build_revision="$(label_value "$transaction_name" io.sumi.docs.transaction-old-build-revision)"
  old_corpus_revision="$(label_value "$transaction_name" io.sumi.docs.transaction-old-corpus-revision)"
  [[ "$state" = prepared || "$state" = idempotent ]] || fail "transaction marker state is invalid"

  if [[ "$state" = idempotent ]]; then
    [[ "$prior_state" = absent && -z "$old_image" && -z "$old_image_id" && -z "$old_build_revision" && -z "$old_corpus_revision" ]] || fail "idempotent transaction claims rollback state"
    ! container_exists "$rollback_name" || fail "idempotent transaction has an unexpected rollback container"
    ! container_exists "$completion_name" || fail "idempotent transaction has unexpected completion evidence"
    container_exists "$stable_name" || fail "idempotent transaction has no stable container"
    [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$image_ref" ]] || fail "idempotent stable image differs"
    [[ "$(docker container inspect "$stable_name" --format '{{.Image}}')" = "$image_id" ]] || fail "idempotent stable image ID differs"
    printf '{"schemaVersion":1,"state":"idempotent","priorState":"absent","rollbackRequired":false,"switch":{"schemaVersion":1,"changed":false,"token":"%s","newImage":"%s","newImageId":"%s","oldImage":null,"oldImageId":null}}\n' \
      "$token" "$image_ref" "$image_id"
    return
  fi

  [[ "$prior_state" = present || "$prior_state" = absent ]] || fail "prepared transaction prior state is invalid"
  local stable_state="missing"
  if container_exists "$stable_name"; then
    local stable_image
    local stable_image_id
    stable_image="$(label_value "$stable_name" io.sumi.docs.deployed-image)"
    stable_image_id="$(docker container inspect "$stable_name" --format '{{.Image}}')"
    if [[ "$stable_image" = "$image_ref" && "$stable_image_id" = "$image_id" ]]; then
      stable_state="new"
    elif [[ "$prior_state" = present && "$stable_image" = "$old_image" && "$stable_image_id" = "$old_image_id" ]]; then
      [[ "$(label_value "$stable_name" io.sumi.docs.build-revision)" = "$old_build_revision" ]] || fail "stable prior build revision differs from transaction evidence"
      [[ "$(label_value "$stable_name" io.sumi.docs.corpus-revision)" = "$old_corpus_revision" ]] || fail "stable prior corpus revision differs from transaction evidence"
      stable_state="old"
    else
      fail "stable container differs from both transaction identities"
    fi
  fi

  local topology="prepared"
  local stable_switched=false
  if [[ "$prior_state" = present ]]; then
    [[ -n "$old_image" && -n "$old_image_id" ]] || fail "prepared transaction lacks prior identity"
    require_commit "$old_build_revision" "prepared prior build revision"
    require_sha256 "$old_corpus_revision" "prepared prior corpus revision"
    if container_exists "$rollback_name"; then
      [[ "$(label_value "$rollback_name" io.sumi.docs.deployed-image)" = "$old_image" ]] || fail "rollback image differs from transaction evidence"
      [[ "$(docker container inspect "$rollback_name" --format '{{.Image}}')" = "$old_image_id" ]] || fail "rollback image ID differs from transaction evidence"
      [[ "$(label_value "$rollback_name" io.sumi.docs.build-revision)" = "$old_build_revision" ]] || fail "rollback build revision differs from transaction evidence"
      [[ "$(label_value "$rollback_name" io.sumi.docs.corpus-revision)" = "$old_corpus_revision" ]] || fail "rollback corpus revision differs from transaction evidence"
      [[ "$stable_state" = new || "$stable_state" = missing ]] || fail "rollback topology contains duplicate prior state"
      [[ "$stable_state" = new ]] && stable_switched=true
    else
      [[ "$stable_state" = old ]] || fail "prior container is missing from the prepared topology"
    fi
  else
    [[ -z "$old_image" && -z "$old_image_id" && -z "$old_build_revision" && -z "$old_corpus_revision" ]] || fail "bootstrap transaction claims an old image"
    ! container_exists "$rollback_name" || fail "bootstrap transaction has an unexpected rollback container"
    [[ "$stable_state" = missing || "$stable_state" = new ]] || fail "bootstrap topology is invalid"
    [[ "$stable_state" = new ]] && stable_switched=true
  fi

  if container_exists "$completion_name"; then
    [[ "$(label_value "$completion_name" io.sumi.docs.completion-schema)" = 1 ]] || fail "completion evidence schema is invalid"
    [[ "$(label_value "$completion_name" io.sumi.docs.completion-commit)" = "$commit" ]] || fail "completion evidence commit differs"
    [[ "$(label_value "$completion_name" io.sumi.docs.completion-image)" = "$image_ref" ]] || fail "completion evidence image differs"
    [[ "$(label_value "$completion_name" io.sumi.docs.completion-image-id)" = "$image_id" ]] || fail "completion evidence image ID differs"
    [[ "$stable_switched" = true ]] || fail "completion evidence contradicts a prepared topology"
    topology="changed"
  fi

  if [[ "$topology" = prepared ]]; then
    printf '{"schemaVersion":1,"state":"prepared","priorState":"%s","rollbackRequired":true,"switch":null}\n' "$prior_state"
  elif [[ "$prior_state" = present ]]; then
    printf '{"schemaVersion":1,"state":"changed","priorState":"present","rollbackRequired":true,"switch":{"schemaVersion":1,"changed":true,"token":"%s","newImage":"%s","newImageId":"%s","oldImage":"%s","oldImageId":"%s"}}\n' \
      "$token" "$image_ref" "$image_id" "$old_image" "$old_image_id"
  else
    printf '{"schemaVersion":1,"state":"changed","priorState":"absent","rollbackRequired":true,"switch":{"schemaVersion":1,"changed":true,"token":"%s","newImage":"%s","newImageId":"%s","oldImage":null,"oldImageId":null}}\n' \
      "$token" "$image_ref" "$image_id"
  fi
}

rollback() {
  [[ "$#" = 3 ]] || fail "rollback requires commit, image ref, and prior state"
  local commit="$1"
  local image_ref="$2"
  local prior_state="$3"
  require_commit "$commit" "commit"
  [[ "$prior_state" = "present" || "$prior_state" = "absent" ]] || fail "prior state must be present or absent"
  local rollback_name="sumi-docs-mcp-rollback-${commit:0:12}"
  local transaction_name
  local completion_name
  local terminal_name
  transaction_name="$(transaction_name_for "$commit")"
  completion_name="$(completion_name_for "$commit")"
  terminal_name="$(terminal_name_for "$commit")"

  if container_exists "$terminal_name"; then
    local terminal_image_id
    local terminal_outcome
    terminal_image_id="$(label_value "$terminal_name" io.sumi.docs.terminal-new-image-id)"
    require_sha256 "$terminal_image_id" "terminal image ID"
    validate_terminal_identity "$terminal_name" "$commit" "$image_ref" "$terminal_image_id"
    terminal_outcome="$(label_value "$terminal_name" io.sumi.docs.terminal-outcome)"
    [[ "$terminal_outcome" = rolled-back ]] || fail "committed deployment must not be rolled back"
    [[ "$(label_value "$terminal_name" io.sumi.docs.terminal-prior-state)" = "$prior_state" ]] || fail "terminal prior state differs"
    if [[ "$prior_state" = present ]]; then
      local terminal_restored_image
      local terminal_restored_image_id
      local terminal_restored_build_revision
      local terminal_restored_corpus_revision
      terminal_restored_image="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-image)"
      terminal_restored_image_id="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-image-id)"
      terminal_restored_build_revision="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-build-revision)"
      terminal_restored_corpus_revision="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-corpus-revision)"
      container_exists "$stable_name" || fail "rolled-back terminal has no stable container"
      [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$terminal_restored_image" ]] || fail "rolled-back stable image differs"
      [[ "$(docker container inspect "$stable_name" --format '{{.Image}}')" = "$terminal_restored_image_id" ]] || fail "rolled-back stable image ID differs"
      [[ "$(label_value "$stable_name" io.sumi.docs.build-revision)" = "$terminal_restored_build_revision" ]] || fail "rolled-back stable build revision differs"
      [[ "$(label_value "$stable_name" io.sumi.docs.corpus-revision)" = "$terminal_restored_corpus_revision" ]] || fail "rolled-back stable corpus revision differs"
      wait_until_ready "$stable_name" "$terminal_restored_build_revision" "$terminal_restored_corpus_revision"
      printf '{"schemaVersion":1,"restored":true,"image":"%s","imageId":"%s","buildRevision":"%s","corpusRevision":"%s"}\n' \
        "$terminal_restored_image" "$terminal_restored_image_id" "$terminal_restored_build_revision" "$terminal_restored_corpus_revision"
    else
      ! container_exists "$stable_name" || fail "rolled-back bootstrap terminal contradicts a stable container"
      printf '{"schemaVersion":1,"restored":false,"image":null,"imageId":null,"buildRevision":null,"corpusRevision":null}\n'
    fi
    return
  fi

  container_exists "$transaction_name" || fail "rollback requires durable deployment intent"
  [[ "$(label_value "$transaction_name" io.sumi.docs.transaction-schema)" = 1 ]] || fail "rollback intent schema is invalid"
  [[ "$(label_value "$transaction_name" io.sumi.docs.transaction-state)" = prepared ]] || fail "idempotent deployment must not be rolled back"
  [[ "$(label_value "$transaction_name" io.sumi.docs.transaction-commit)" = "$commit" ]] || fail "rollback intent commit differs"
  [[ "$(label_value "$transaction_name" io.sumi.docs.transaction-new-image)" = "$image_ref" ]] || fail "rollback intent image differs"
  [[ "$(label_value "$transaction_name" io.sumi.docs.transaction-prior-state)" = "$prior_state" ]] || fail "rollback prior state differs from intent"
  local intent_new_image_id
  local intent_old_image
  local intent_old_image_id
  local intent_old_build_revision
  local intent_old_corpus_revision
  intent_new_image_id="$(label_value "$transaction_name" io.sumi.docs.transaction-new-image-id)"
  require_sha256 "$intent_new_image_id" "rollback intent new image ID"
  intent_old_image="$(label_value "$transaction_name" io.sumi.docs.transaction-old-image)"
  intent_old_image_id="$(label_value "$transaction_name" io.sumi.docs.transaction-old-image-id)"
  intent_old_build_revision="$(label_value "$transaction_name" io.sumi.docs.transaction-old-build-revision)"
  intent_old_corpus_revision="$(label_value "$transaction_name" io.sumi.docs.transaction-old-corpus-revision)"
  if [[ "$prior_state" = present ]]; then
    [[ "$intent_old_image" =~ ^ghcr\.io/.+@sha256:[0-9a-f]{64}$ ]] || fail "rollback intent has no prior image digest"
    require_sha256 "$intent_old_image_id" "rollback intent prior image ID"
    require_commit "$intent_old_build_revision" "rollback intent prior build revision"
    require_sha256 "$intent_old_corpus_revision" "rollback intent prior corpus revision"
  else
    [[ -z "$intent_old_image" && -z "$intent_old_image_id" && -z "$intent_old_build_revision" && -z "$intent_old_corpus_revision" ]] || fail "bootstrap rollback intent claims prior state"
  fi
  local restored_name=""
  if container_exists "$rollback_name"; then
    [[ "$prior_state" = "present" ]] || fail "rollback container contradicts absent prior state"
    local old_image
    local old_image_id
    local old_build_revision
    local old_corpus_revision
    old_image="$(label_value "$rollback_name" io.sumi.docs.deployed-image)"
    old_image_id="$(docker container inspect "$rollback_name" --format '{{.Image}}')"
    old_build_revision="$(label_value "$rollback_name" io.sumi.docs.build-revision)"
    old_corpus_revision="$(label_value "$rollback_name" io.sumi.docs.corpus-revision)"
    [[ "$old_image" =~ ^ghcr\.io/.+@sha256:[0-9a-f]{64}$ ]] || fail "rollback container has no image digest"
    require_sha256 "$old_image_id" "rollback container image ID"
    require_commit "$old_build_revision" "rollback container build revision"
    require_sha256 "$old_corpus_revision" "rollback container corpus revision"
    [[ "$old_image" = "$intent_old_image" && "$old_image_id" = "$intent_old_image_id" && "$old_build_revision" = "$intent_old_build_revision" && "$old_corpus_revision" = "$intent_old_corpus_revision" ]] || fail "rollback container differs from durable prior identity"
    if container_exists "$stable_name"; then
      [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$image_ref" ]] || fail "stable container drifted before rollback"
      docker rm --force "$stable_name" >/dev/null
    fi
    docker rename "$rollback_name" "$stable_name"
    docker start "$stable_name" >/dev/null
    restored_name="$stable_name"
  elif container_exists "$stable_name"; then
    if [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$image_ref" ]]; then
      if [[ "$prior_state" = "present" ]]; then
        fail "expected rollback container is missing; current stable was preserved"
      fi
      docker rm --force "$stable_name" >/dev/null
    else
      [[ "$prior_state" = "present" ]] || fail "stable container contradicts absent prior state"
      [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$intent_old_image" ]] || fail "stable image differs from durable prior identity"
      [[ "$(docker container inspect "$stable_name" --format '{{.Image}}')" = "$intent_old_image_id" ]] || fail "stable image ID differs from durable prior identity"
      [[ "$(label_value "$stable_name" io.sumi.docs.build-revision)" = "$intent_old_build_revision" ]] || fail "stable build revision differs from durable prior identity"
      [[ "$(label_value "$stable_name" io.sumi.docs.corpus-revision)" = "$intent_old_corpus_revision" ]] || fail "stable corpus revision differs from durable prior identity"
      restored_name="$stable_name"
    fi
  elif [[ "$prior_state" = "present" ]]; then
    fail "expected rollback container and stable service are both missing"
  fi

  if [[ -z "$restored_name" ]]; then
    write_transaction_terminal "$commit" "$image_ref" "$intent_new_image_id" rolled-back absent "" "" "" ""
    printf '{"schemaVersion":1,"restored":false,"image":null,"imageId":null,"buildRevision":null,"corpusRevision":null}\n'
    return
  fi

  local restored_image
  local restored_image_id
  local restored_build_revision
  local restored_corpus_revision
  restored_image="$(label_value "$restored_name" io.sumi.docs.deployed-image)"
  restored_image_id="$(docker container inspect "$restored_name" --format '{{.Image}}')"
  restored_build_revision="$(label_value "$restored_name" io.sumi.docs.build-revision)"
  restored_corpus_revision="$(label_value "$restored_name" io.sumi.docs.corpus-revision)"
  [[ "$restored_image" =~ ^ghcr\.io/.+@sha256:[0-9a-f]{64}$ ]] || fail "restored container has no image digest"
  require_sha256 "$restored_image_id" "restored container image ID"
  require_commit "$restored_build_revision" "restored container build revision"
  require_sha256 "$restored_corpus_revision" "restored container corpus revision"
  if [[ "$prior_state" = present ]]; then
    [[ "$restored_image" = "$intent_old_image" && "$restored_image_id" = "$intent_old_image_id" && "$restored_build_revision" = "$intent_old_build_revision" && "$restored_corpus_revision" = "$intent_old_corpus_revision" ]] || fail "restored tuple differs from durable prior identity"
  fi
  if [[ "$(docker container inspect "$restored_name" --format '{{.State.Running}}')" != true ]]; then
    docker start "$restored_name" >/dev/null
  fi
  wait_until_ready "$restored_name" "$restored_build_revision" "$restored_corpus_revision"
  write_transaction_terminal "$commit" "$image_ref" "$intent_new_image_id" rolled-back present \
    "$restored_image" "$restored_image_id" "$restored_build_revision" "$restored_corpus_revision"
  printf '{"schemaVersion":1,"restored":true,"image":"%s","imageId":"%s","buildRevision":"%s","corpusRevision":"%s"}\n' \
    "$restored_image" "$restored_image_id" "$restored_build_revision" "$restored_corpus_revision"
}

complete_rollback() {
  [[ "$#" = 2 ]] || fail "complete-rollback requires commit and image ref"
  local commit="$1"
  local image_ref="$2"
  require_commit "$commit" "commit"
  local terminal_name
  local image_id
  local prior_state
  terminal_name="$(terminal_name_for "$commit")"
  container_exists "$terminal_name" || fail "rolled-back terminal evidence is missing"
  image_id="$(label_value "$terminal_name" io.sumi.docs.terminal-new-image-id)"
  require_sha256 "$image_id" "terminal image ID"
  validate_terminal_identity "$terminal_name" "$commit" "$image_ref" "$image_id"
  [[ "$(label_value "$terminal_name" io.sumi.docs.terminal-outcome)" = rolled-back ]] || fail "only a rolled-back transaction can be completed"
  prior_state="$(label_value "$terminal_name" io.sumi.docs.terminal-prior-state)"
  if [[ "$prior_state" = present ]]; then
    local restored_image
    local restored_image_id
    local restored_build_revision
    local restored_corpus_revision
    restored_image="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-image)"
    restored_image_id="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-image-id)"
    restored_build_revision="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-build-revision)"
    restored_corpus_revision="$(label_value "$terminal_name" io.sumi.docs.terminal-restored-corpus-revision)"
    container_exists "$stable_name" || fail "rolled-back stable container is missing"
    [[ "$(label_value "$stable_name" io.sumi.docs.deployed-image)" = "$restored_image" ]] || fail "rolled-back stable image differs"
    [[ "$(docker container inspect "$stable_name" --format '{{.Image}}')" = "$restored_image_id" ]] || fail "rolled-back stable image ID differs"
    [[ "$(label_value "$stable_name" io.sumi.docs.build-revision)" = "$restored_build_revision" ]] || fail "rolled-back stable build revision differs"
    [[ "$(label_value "$stable_name" io.sumi.docs.corpus-revision)" = "$restored_corpus_revision" ]] || fail "rolled-back stable corpus revision differs"
    wait_until_ready "$stable_name" "$restored_build_revision" "$restored_corpus_revision"
  elif [[ "$prior_state" = absent ]]; then
    ! container_exists "$stable_name" || fail "rolled-back bootstrap transaction has a stable container"
  else
    fail "rolled-back terminal prior state is invalid"
  fi
  cleanup_transaction_evidence "$commit"
}

command="${1:-}"
shift || true
case "$command" in
  stage) stage "$@" ;;
  finalize) finalize "$@" ;;
  observe) observe "$@" ;;
  rollback) rollback "$@" ;;
  complete-rollback) complete_rollback "$@" ;;
  *) fail "expected stage, finalize, observe, rollback, or complete-rollback" ;;
esac
