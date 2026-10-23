#!/usr/bin/env bash
# Whale Girl — Ubuntu 24.04 installer (M4.2 pattern 2: cloud server).
#
# Usage:
#   sudo bash scripts/install-ubuntu.sh <domain>   # recommended: Let's Encrypt TLS
#   sudo bash scripts/install-ubuntu.sh            # no domain: self-signed TLS
#   bash scripts/install-ubuntu.sh --check         # dry-run: print the resolved config
#
# What it does (idempotent — safe to re-run after "git pull"):
#   1. apt: nginx, certbot, python3-certbot-nginx, python3-venv, python3-pip, ufw,
#      curl, ca-certificates, lsof, nodejs, npm
#   2. npm ci (server dependencies)
#   3. python venv + pip install (brain dependencies)
#   4. systemd: whale-girl (server, loopback-only by default) + whale-girl-brain
#      (parameter driver), both enabled
#   5. ufw 'Nginx Full' when ufw is active (before certbot, so port 80 is open)
#   6. nginx: HTTP -> node :3000, /ws -> node :3001 (upgraded); TLS via certbot
#      (domain) or a self-signed certificate (no domain). The ACME challenge is
#      served from /var/www/whale-girl-acme (0755) so www-data can read it.
#
# Security notes:
# - The server unit (whale-girl.service) is restricted to loopback with
#   IPAddressAllow=localhost + IPAddressDeny=any: nginx and SSH tunnels reach it
#   on 127.0.0.1, but the raw :3000/:3001 sockets are not exposed. The brain unit
#   stays unrestricted (edge-tts needs outbound HTTPS). Set WHALE_ALLOW_LAN=1 to
#   omit the restriction and use the documented LAN-direct pattern.
# - Both units run as root (systemd default) — accepted risk for a home box; the
#   process needs no privileged ports. Harden with a dedicated User= if you care.
# - The brain runs on this host: say frames carry "/audio/<file>" URLs that the
#   browser fetches from the page origin, so the audio files must live next to
#   the server. Stop whale-girl-brain and run the driver elsewhere only if you
#   accept silent speech.
# - The WebSocket origin guard compares the page host with the WS host, so the
#   site passes "proxy_set_header Host $host" and the page + WS share one hostname.
#   The page needs an explicit ?ws=wss://<domain>/ws in a split deploy (the
#   frontend default is ws://localhost:3001, for dev only).
# - No secrets in this script (git over https; certbot without an email).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVER_DIR="$REPO_ROOT/whale-girl-server"
FRONTEND_DIR="$REPO_ROOT/whale-girl-frontend"
PORT="${WHALE_PORT:-3000}"
WS_PORT="${WHALE_WS_PORT:-3001}"
NODE_BIN="$(command -v node || true)"
CERT_DIR="/etc/letsencrypt/live"
SELFSIGNED_DIR="/etc/ssl/whale-girl"
DOMAIN_FILE="/etc/whale-girl/domain"
ACME_WEBROOT="/var/www/whale-girl-acme"
ALLOW_LAN="${WHALE_ALLOW_LAN:-0}"

CHECK=0
DOMAIN=""
DOMAIN_SRC="none"
FORGET_DOMAIN=0

say()  { printf '[install-ubuntu] %s\n' "$*"; }
warn() { printf '[install-ubuntu] WARN: %s\n' "$*" >&2; }
die()  { printf '[install-ubuntu] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  printf '%s\n' \
    'Usage:' \
    '  sudo bash scripts/install-ubuntu.sh <domain>   # TLS via certbot (recommended)' \
    '  sudo bash scripts/install-ubuntu.sh            # no arg: reuse the remembered domain' \
    '  sudo bash scripts/install-ubuntu.sh --no-domain  # forget it: self-signed certificate' \
    '  sudo bash scripts/install-ubuntu.sh --allow-lan  # LAN-direct: no loopback restriction' \
    '  bash scripts/install-ubuntu.sh --check         # dry-run: print the resolved config' \
    '' \
    'Env: WHALE_DOMAIN (alternative to the positional domain; a previous domain is' \
    '     remembered in /etc/whale-girl/domain), WHALE_PORT (default 3000),' \
    '     WHALE_WS_PORT (default 3001), WHALE_ALLOW_LAN=1 (same as --allow-lan;' \
    '     use sudo WHALE_ALLOW_LAN=1 bash ... if you prefer the env).' \
    '     The script is idempotent: re-run after git pull.'
}

for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --allow-lan) ALLOW_LAN=1 ;;
    --no-domain) FORGET_DOMAIN=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option: $arg (try --help)" ;;
    *) DOMAIN="$arg" ;;
  esac
done
DOMAIN="${DOMAIN:-${WHALE_DOMAIN:-}}"

# A previous install remembers its domain: re-running without the argument must
# not silently downgrade a Let's Encrypt certificate to self-signed.
if [ -n "$DOMAIN" ]; then
  DOMAIN_SRC="argument"
fi
if [ -z "$DOMAIN" ] && [ -s "$DOMAIN_FILE" ]; then
  DOMAIN="$(tr -d '\n' < "$DOMAIN_FILE")"
  DOMAIN_SRC="remembered in $DOMAIN_FILE"
fi
if [ "$FORGET_DOMAIN" -eq 1 ]; then
  DOMAIN=""
  DOMAIN_SRC="--no-domain"
fi

# --- repo layout ------------------------------------------------------------
for f in "$SERVER_DIR/server.js" "$SERVER_DIR/package.json" "$SERVER_DIR/package-lock.json" \
         "$SERVER_DIR/requirements.txt" "$SERVER_DIR/control_whale.py" \
         "$FRONTEND_DIR/index.html"; do
  [ -f "$f" ] || die "missing $f — run this script from inside the whale-girl repo (scripts/install-ubuntu.sh)"
done

if [ -n "$DOMAIN" ]; then
  case "$DOMAIN" in
    *[!A-Za-z0-9.-]*) die "invalid domain '$DOMAIN' (letters, digits, dots and dashes only)" ;;
  esac
fi

# --- TLS state --------------------------------------------------------------
TLS_MODE="none"
TLS_CERT=""
TLS_KEY=""
resolve_tls() {
  TLS_MODE="none"; TLS_CERT=""; TLS_KEY=""
  if [ -n "$DOMAIN" ] && [ -f "$CERT_DIR/$DOMAIN/fullchain.pem" ]; then
    TLS_MODE="certbot"
    TLS_CERT="$CERT_DIR/$DOMAIN/fullchain.pem"
    TLS_KEY="$CERT_DIR/$DOMAIN/privkey.pem"
  elif [ -f "$SELFSIGNED_DIR/selfsigned.crt" ]; then
    TLS_MODE="selfsigned"
    TLS_CERT="$SELFSIGNED_DIR/selfsigned.crt"
    TLS_KEY="$SELFSIGNED_DIR/selfsigned.key"
  fi
}

# --- rendered files ---------------------------------------------------------
render_ws_map() {
  cat <<'NGINXMAP'
# Whale Girl — WebSocket upgrade map (installed by scripts/install-ubuntu.sh).
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
NGINXMAP
}

render_unit_server() {
  local net=""
  if [ "$ALLOW_LAN" != "1" ]; then
    net="IPAddressAllow=localhost
IPAddressDeny=any"
  fi
  cat <<EOF
[Unit]
Description=Whale Girl server (static :$PORT, WebSocket proxy :$WS_PORT)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$SERVER_DIR
Environment=PORT=$PORT
Environment=WS_PORT=$WS_PORT
ExecStart=$NODE_BIN server.js
Restart=on-failure
RestartSec=2
NoNewPrivileges=yes
$net
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
}

render_unit_brain() {
  cat <<EOF
[Unit]
Description=Whale Girl brain (30 FPS parameter driver + TTS)
After=network-online.target whale-girl.service
Wants=network-online.target

[Service]
Type=simple
# Unrestricted network: edge-tts needs outbound HTTPS; the WS target is loopback.
WorkingDirectory=$SERVER_DIR
Environment=WHALE_MODE=live
Environment=WHALE_WS=ws://127.0.0.1:$WS_PORT?role=python
ExecStart=$SERVER_DIR/.venv/bin/python control_whale.py
# Restart=always: a displaced driver exits 0 (4001); on-failure would leave the
# box brain dead. Stop this unit before running a manual driver on the same server.
Restart=always
RestartSec=2
NoNewPrivileges=yes
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
}

render_site() {
  local server_name="_"
  [ -n "$DOMAIN" ] && server_name="$DOMAIN"
  local acme_location="location /.well-known/acme-challenge/ { root $ACME_WEBROOT; }"
  if [ "$TLS_MODE" = "none" ]; then
    cat <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $server_name;
    $acme_location
    location /ws {
        proxy_pass http://127.0.0.1:$WS_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
    return 0
  fi
  cat <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $server_name;
    $acme_location
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $server_name;
    ssl_certificate     $TLS_CERT;
    ssl_certificate_key $TLS_KEY;
    location /ws {
        proxy_pass http://127.0.0.1:$WS_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
}

# --- check (dry-run) --------------------------------------------------------
if [ "$CHECK" -eq 1 ]; then
  say "check: repo     $REPO_ROOT"
  say "check: server   $SERVER_DIR"
  say "check: frontend $FRONTEND_DIR"
  say "check: domain   ${DOMAIN:-<none: self-signed fallback>} (${DOMAIN_SRC})"
  if [ -n "$NODE_BIN" ]; then
    say "check: node     $("$NODE_BIN" -v)"
  else
    warn "check: node not found (the Ubuntu host needs node >= 18)"
  fi
  if command -v npm >/dev/null 2>&1; then
    say "check: npm      $(npm -v)"
  else
    warn "check: npm not found (the Ubuntu host needs npm — the installer apt-installs it)"
  fi
  if command -v python3 >/dev/null 2>&1; then
    say "check: python3  $(python3 -V 2>&1)"
  else
    warn "check: python3 not found (the Ubuntu host needs >= 3.9)"
  fi
  for b in apt-get systemctl nginx certbot openssl ufw curl; do
    command -v "$b" >/dev/null 2>&1 || warn "check: $b not on this machine (fine on macOS — the Ubuntu host provides it)"
  done
  say "check: acme     $ACME_WEBROOT (0755, served by nginx for certbot)"
  if [ "$ALLOW_LAN" = "1" ]; then
    say "check: network  LAN mode — the server unit is NOT loopback-restricted"
  else
    say "check: network  loopback-only server unit (--allow-lan or WHALE_ALLOW_LAN=1 disables)"
  fi
  resolve_tls
  if [ "$TLS_MODE" = "none" ]; then
    if [ -n "$DOMAIN" ]; then
      say "check: TLS      certbot will request $DOMAIN (needs its A record and port 80)"
    else
      say "check: TLS      self-signed fallback (created on the host)"
    fi
  else
    say "check: TLS      $TLS_MODE ($TLS_CERT)"
  fi
  say "check: --- whale-girl.service ---"
  render_unit_server
  say "check: --- whale-girl-brain.service ---"
  render_unit_brain
  say "check: --- nginx site (whale-girl) ---"
  render_site
  say "check: OK — no changes made"
  exit 0
fi

# --- install phases ---------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "run as root: sudo bash scripts/install-ubuntu.sh ${DOMAIN:-<domain>}"

# --no-domain must forget the remembered domain even if a later phase fails.
if [ "$FORGET_DOMAIN" -eq 1 ]; then
  rm -f "$DOMAIN_FILE"
  say "forgot the remembered domain — using self-signed TLS"
fi

assert_ubuntu() {
  [ -r /etc/os-release ] || die "cannot read /etc/os-release (this installer targets Ubuntu 24.04 LTS)"
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] || die "this installer targets Ubuntu (found ID=${ID:-unknown})"
  case "${VERSION_ID:-}" in
    24.04*) ;;
    *) die "this installer targets Ubuntu 24.04 LTS (found ${VERSION_ID:-unknown}); other releases need the NodeSource PPA and are out of scope" ;;
  esac
}

step_apt() {
  say "step 1/6: apt packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  local pkgs=(nginx certbot python3-certbot-nginx python3-venv python3-pip ufw curl \
    ca-certificates lsof nodejs)
  # Stock Ubuntu 24.04's nodejs does NOT pull npm (and --no-install-recommends
  # suppresses it); NodeSource's nodejs PROVIDES npm and Conflicts: npm, so asking
  # apt for the distro npm package there is unsatisfiable. Install npm only when
  # the host has none.
  if ! command -v npm >/dev/null 2>&1; then
    pkgs+=(npm)
  fi
  apt-get install -y --no-install-recommends "${pkgs[@]}"
  NODE_BIN="$(command -v node || true)"
  [ -n "$NODE_BIN" ] || die "node is missing after apt; on Ubuntu 24.04 the 'nodejs' package provides it — check the apt output above"
  local v
  v="$("$NODE_BIN" -v)"
  case "$v" in
    v1[89].*|v[2-9][0-9].*) ;;
    *) die "node $v is too old (need >= 18)" ;;
  esac
  command -v npm >/dev/null 2>&1 || die "npm is missing after apt (Ubuntu: 'apt-get install npm') — re-run this installer"
  v="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
  case "$v" in
    3.9|3.1[0-9]) ;;
    *) die "python3 $v is too old (need >= 3.9)" ;;
  esac
  say "step 1/6 done: node $("$NODE_BIN" -v), npm $(npm -v), python3 $v"
}

step_npm() {
  say "step 2/6: npm ci (server dependencies)"
  ( cd "$SERVER_DIR" && npm ci --no-audit --no-fund )
}

step_venv() {
  say "step 3/6: python venv + pip (brain dependencies)"
  if [ ! -x "$SERVER_DIR/.venv/bin/python" ]; then
    say "creating $SERVER_DIR/.venv"
    python3 -m venv "$SERVER_DIR/.venv"
  fi
  "$SERVER_DIR/.venv/bin/pip" install -q -U pip
  "$SERVER_DIR/.venv/bin/pip" install -q -r "$SERVER_DIR/requirements.txt"
}

step_systemd() {
  say "step 4/6: systemd units (server + brain)"
  # A user-level stack supervisor (scripts/stack.sh) owns the ports; stop it so
  # the systemd units can bind them.
  if [ -f "$SERVER_DIR/run/stack.pid" ] && kill -0 "$(cat "$SERVER_DIR/run/stack.pid")" 2>/dev/null; then
    say "stopping the user-level stack supervisor (it holds :$PORT/:$WS_PORT)"
    bash "$SERVER_DIR/scripts/stack.sh" stop || true
  fi
  local unit_dir=/etc/systemd/system
  render_unit_server > "$unit_dir/whale-girl.service.tmp"
  install -m 0644 "$unit_dir/whale-girl.service.tmp" "$unit_dir/whale-girl.service"
  render_unit_brain > "$unit_dir/whale-girl-brain.service.tmp"
  install -m 0644 "$unit_dir/whale-girl-brain.service.tmp" "$unit_dir/whale-girl-brain.service"
  rm -f "$unit_dir/whale-girl.service.tmp" "$unit_dir/whale-girl-brain.service.tmp"
  systemctl daemon-reload
  systemctl enable whale-girl whale-girl-brain
  systemctl restart whale-girl
  systemctl restart whale-girl-brain
  sleep 2
  systemctl is-active --quiet whale-girl || die "whale-girl did not start — run: journalctl -u whale-girl -n 50 --no-pager"
  systemctl is-active --quiet whale-girl-brain || die "whale-girl-brain did not start — run: journalctl -u whale-girl-brain -n 50 --no-pager"
  say "step 4/6 done: both units active"
}

# Render + install the site, test it BEFORE touching the running service, and
# keep the last site nginx accepted (site.prev) so a failed render can restore it
# (a bad site left in sites-enabled would break nginx on the next boot).
apply_site() {
  local site=/etc/nginx/sites-available/whale-girl
  local enabled=/etc/nginx/sites-enabled/whale-girl
  local prev=/etc/nginx/sites-available/whale-girl.prev
  local out
  resolve_tls
  render_site > "$site.tmp"
  install -m 0644 "$site.tmp" "$site"
  rm -f "$site.tmp"
  ln -sfn "$site" "$enabled"
  if ! out="$(nginx -t 2>&1)"; then
    printf '%s\n' "$out" >&2
    if [ -f "$prev" ]; then
      install -m 0644 "$prev" "$site"
      nginx -t >/dev/null 2>&1 || warn "the last good site also fails nginx -t — check the config manually"
      die "nginx config test failed — the last good site was restored"
    fi
    rm -f "$enabled" "$site"
    die "nginx config test failed — the site was removed (no previous site existed)"
  fi
  install -m 0644 "$site" "$prev"   # remember the last site nginx accepted
}

step_nginx() {
  say "step 6/6: nginx site + TLS"
  local map_file=/etc/nginx/conf.d/whale-girl-ws-upgrade.conf
  local site=/etc/nginx/sites-available/whale-girl
  render_ws_map > "$map_file.tmp"
  install -m 0644 "$map_file.tmp" "$map_file"
  rm -f "$map_file.tmp"

  mkdir -p "$ACME_WEBROOT"
  chmod 0755 "$ACME_WEBROOT"
  rm -f "$site.bak"   # pre-round-2 backup name; harmless if absent

  rm -f /etc/nginx/sites-enabled/default
  apply_site
  systemctl enable --now nginx
  systemctl reload nginx

  if [ -n "$DOMAIN" ] && [ ! -f "$CERT_DIR/$DOMAIN/fullchain.pem" ]; then
    say "requesting a Let's Encrypt certificate for $DOMAIN (needs its A record and port 80)"
    certbot certonly --webroot -w "$ACME_WEBROOT" -d "$DOMAIN" \
      --non-interactive --agree-tos --register-unsafely-without-email \
      --deploy-hook "systemctl reload nginx" \
      || die "certbot failed: check that $DOMAIN resolves to this server and that port 80 is open (the ACME webroot is $ACME_WEBROOT)"
  fi
  if [ -z "$DOMAIN" ]; then
    local need_ss=0
    if [ ! -f "$SELFSIGNED_DIR/selfsigned.crt" ]; then
      need_ss=1
    elif ! openssl x509 -in "$SELFSIGNED_DIR/selfsigned.crt" -checkend 2592000 -noout >/dev/null 2>&1; then
      say "the self-signed certificate expires within 30 days — regenerating it"
      need_ss=1
    fi
    if [ "$need_ss" -eq 1 ]; then
      say "no domain given: creating a self-signed certificate (browsers will warn)"
      mkdir -p "$SELFSIGNED_DIR"
      openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
        -subj "/CN=whale-girl" \
        -keyout "$SELFSIGNED_DIR/selfsigned.key" \
        -out "$SELFSIGNED_DIR/selfsigned.crt" >/dev/null 2>&1 \
        || die "openssl could not create the self-signed certificate"
    fi
  fi

  # Persist the domain whenever a Let's Encrypt cert exists, so a later no-argument
  # re-run reuses it (and never silently downgrades to self-signed).
  if [ -n "$DOMAIN" ] && [ -f "$CERT_DIR/$DOMAIN/fullchain.pem" ]; then
    if [ ! -f "$DOMAIN_FILE" ] || [ "$(cat "$DOMAIN_FILE" 2>/dev/null)" != "$DOMAIN" ]; then
      mkdir -p "$(dirname "$DOMAIN_FILE")"
      printf '%s\n' "$DOMAIN" > "$DOMAIN_FILE"
    fi
  fi

  apply_site
  systemctl reload nginx

  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/ || true)"
  if [ "$TLS_MODE" = "none" ]; then
    [ "$code" = "200" ] || die "nginx is not answering on port 80 (got HTTP $code) — check: journalctl -u whale-girl; nginx -t"
  else
    [ "$code" = "301" ] || [ "$code" = "302" ] || die "the HTTP->HTTPS redirect is not answering on port 80 (got HTTP $code)"
    code="$(curl -ks -o /dev/null -w '%{http_code}' https://127.0.0.1/ || true)"
    [ "$code" = "200" ] || die "nginx is not answering on 443 (got HTTP $code) — check: journalctl -u whale-girl; nginx -t"
  fi
  say "step 6/6 done: the page answers through nginx"
}

step_ufw() {
  say "step 5/6: firewall (allow 80/443 before certbot)"
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow 'Nginx Full' >/dev/null 2>&1 || { ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; }
    say "step 5/6 done: ufw allowed 'Nginx Full' (or 80/443/tcp)"
  else
    say "step 5/6 done: ufw inactive — open 80/tcp + 443/tcp in the provider firewall if it filters"
  fi
  if [ "$ALLOW_LAN" = "1" ]; then
    say "note: LAN mode — the raw :$PORT/:$WS_PORT sockets are reachable on the LAN"
  else
    say "note: the raw :$PORT/:$WS_PORT sockets are loopback-only (--allow-lan or WHALE_ALLOW_LAN=1 for LAN-direct)"
  fi
}

final_report() {
  local scheme="https"
  [ "$TLS_MODE" = "none" ] && scheme="http"
  local page="$scheme://<server-ip>"
  [ -n "$DOMAIN" ] && page="$scheme://$DOMAIN"
  local ws_scheme="wss"
  [ "$scheme" = "http" ] && ws_scheme="ws"
  local ws_host="<server-ip>"
  [ -n "$DOMAIN" ] && ws_host="$DOMAIN"
  cat <<EOF

[install-ubuntu] done — Whale Girl is deployed.
  page:         $page/
  browser/OBS:  $page/?ws=$ws_scheme://$ws_host/ws   <- the ?ws= override is required
  brain:        runs on this host (systemd whale-girl-brain); journalctl -u whale-girl-brain -f
  server logs:  journalctl -u whale-girl -f
  network:      $([ "$ALLOW_LAN" = "1" ] && echo "LAN-direct (raw :$PORT/:$WS_PORT open)" || echo "loopback-only server socket; nginx + SSH tunnels reach it")
  domain:       $([ -n "$DOMAIN" ] && echo "$DOMAIN (remembered in $DOMAIN_FILE)" || echo "none (self-signed TLS)")
  update:       cd $REPO_ROOT && git pull && sudo bash whale-girl-server/scripts/install-ubuntu.sh $([ -n "$DOMAIN" ] && printf '%s' "$DOMAIN" || printf '%s' '--no-domain')
  (an rsync-deployed copy has no .git — re-run scripts/deploy-ubuntu.sh from your Mac)
EOF
  if [ "$TLS_MODE" = "selfsigned" ]; then
    cat <<'EOF'
  NOTE: the certificate is self-signed — browsers/OBS will warn and the wss probe
        rejects it. Re-run with a domain to get a Let's Encrypt certificate.
EOF
  fi
  cat <<EOF
  model:        whale-girl-frontend/model/ is gitignored; upload it once to see the
                whale (the page shows the placeholder until then):
                rsync -az whale-girl-frontend/model/ you@server:$FRONTEND_DIR/model/
EOF
}

assert_ubuntu
step_apt
step_npm
step_venv
step_systemd
step_ufw
step_nginx
final_report
