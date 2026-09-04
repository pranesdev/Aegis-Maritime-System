#!/bin/sh
set -e

# If NEXT_PUBLIC_BACKEND_URL is explicitly provided, use it as-is
# (e.g. pointing at a cloud-hosted backend instead of LAN auto-detect).
if [ -n "$NEXT_PUBLIC_BACKEND_URL" ]; then
  BACKEND_URL="$NEXT_PUBLIC_BACKEND_URL"
  SOCKET_URL="${NEXT_PUBLIC_SOCKET_URL:-$BACKEND_URL}"
else
  detect_lan_ip() {
    if [ -n "$HOST_LAN_IP" ]; then
      echo "$HOST_LAN_IP"
      return
    fi
    ip_val=$(ip route show default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
    if [ -n "$ip_val" ]; then
      echo "$ip_val"
      return
    fi
    echo "127.0.0.1"
  }
  HOST_LAN_IP="$(detect_lan_ip)"
  BACKEND_PORT="${BACKEND_PORT:-4000}"
  BACKEND_URL="http://${HOST_LAN_IP}:${BACKEND_PORT}"
  SOCKET_URL="$BACKEND_URL"
fi

mkdir -p /app/dist
cat > /app/dist/env.js <<EOF
window.__ENV__ = {
  NEXT_PUBLIC_BACKEND_URL: "${BACKEND_URL}",
  NEXT_PUBLIC_API_URL:     "${BACKEND_URL}",
  NEXT_PUBLIC_SOCKET_URL:  "${SOCKET_URL}"
};
EOF

echo "✅ Wrote /app/dist/env.js -> BACKEND_URL=${BACKEND_URL}"