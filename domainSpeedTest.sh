#!/usr/bin/env bash

# ================= 说明 =================
# 1. jpyy分布了很多镜像站点，一些域名经常被墙或失效，本脚本用于测试这些域名的可用性和访问速度。
# 2. 域名的查找方法这里做个介绍： 一种是： jpyy.com会重定向到最新的可用域名。 另一种方式是借助fofo.info 查找 ‘body="3688baihuo.com/upload/site_ico"’ 这里是发现所有站点的内容是一直的，所以通过站点的ico来查找所有站点。


# ================= 配置 =================
domains=(
  "jpyy.podjgng.com"
  "0996zp.com"
  "www.lwdys.com"
  "jpyy5.com"
  "www.x8kb9k8.com"
  "www.hhduc.com"
  "www.610pkea.com"
  "www.kuhh4jo.com"
  "ghw9zwp5.com"
  "jpyy.com"
  "610pkea.com"
)

PATH_TEST="/vod/show/id/1"
CONNECT_TIMEOUT=5
MAX_TIME=20

# ================= 依赖检查 =================
if ! command -v curl >/dev/null 2>&1; then
  echo "错误：未找到 curl，请先安装 curl。"
  exit 1
fi

# ================= 自动解析可用域名（www / 裸域） =================
resolve_domain() {
  local raw="$1"
  local bare="${raw#www.}"          # 去掉开头的 www.
  local candidates=()

  # 候选顺序：https 裸域 → https www → http 裸域 → http www
  candidates+=("https://$bare")
  candidates+=("https://www.$bare")
  candidates+=("http://$bare")
  candidates+=("http://www.$bare")

  for base in "${candidates[@]}"; do
    local code
    code=$(curl -L -s -o /dev/null -w "%{http_code}" \
      --connect-timeout 3 --max-time 8 \
      -A "Mozilla/5.0" \
      "$base$PATH_TEST" 2>/dev/null)
    if [ -n "$code" ] && [ "$code" != "000" ]; thens
      # 返回可用的完整域名（不带协议）
      echo "${base#*://}"
      return
    fi
  done

  # 全失败，返回原始域名
  echo "$raw"
}

# ================= 主测速循环 =================
tmpfile=$(mktemp)
echo "开始测速: $PATH_TEST"
echo "════════════════════════════════════════════════════════════════"
echo

for raw in "${domains[@]}"; do
  domain=$(resolve_domain "$raw")
  echo "────────────────────────────────────────────────────────────"
  echo "🌐 原始: $raw  →  实际测试: $domain"

  # 详细耗时字段
  fmt="%{http_code}|%{size_download}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_pretransfer}|%{time_redirect}|%{time_starttransfer}|%{time_total}|%{url_effective}|%{num_redirects}|%{remote_ip}"

  result=$(curl -L -s -o /dev/null -w "$fmt" \
    --connect-timeout "$CONNECT_TIMEOUT" \
    --max-time "$MAX_TIME" \
    -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" \
    "https://$domain$PATH_TEST" 2>/dev/null)
  rc=$?

  if [ $rc -ne 0 ]; then
    # 试 HTTP
    result=$(curl -L -s -o /dev/null -w "$fmt" \
      --connect-timeout "$CONNECT_TIMEOUT" \
      --max-time "$MAX_TIME" \
      -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" \
      "http://$domain$PATH_TEST" 2>/dev/null)
    rc=$?
  fi

  if [ $rc -ne 0 ]; then
    echo "   ❌ 失败/超时"
    echo "$raw|$domain|失败|0|0|0|0|0|0|0|0|0|999999|0|-|-" >> "$tmpfile"
    echo
    continue
  fi

  IFS='|' read -r http_code size t_dns t_conn t_tls t_pretrans t_redir t_ttfb t_total final_url num_redir remote_ip <<< "$result"

  # 毫秒换算
  ms_dns=$(awk "BEGIN{printf \"%.1f\", $t_dns*1000}")
  ms_conn=$(awk "BEGIN{printf \"%.1f\", ($t_conn-$t_dns)*1000}")
  ms_tls=$(awk "BEGIN{printf \"%.1f\", ($t_tls-$t_conn)*1000}")
  ms_pretrans=$(awk "BEGIN{printf \"%.1f\", ($t_pretrans-$t_tls)*1000}")
  ms_redir=$(awk "BEGIN{printf \"%.1f\", $t_redir*1000}")
  ms_ttfb=$(awk "BEGIN{printf \"%.1f\", ($t_ttfb-$t_pretrans-$t_redir)*1000}")
  ms_body=$(awk "BEGIN{printf \"%.1f\", ($t_total-$t_ttfb)*1000}")
  ms_total=$(awk "BEGIN{printf \"%.1f\", $t_total*1000}")

  # 人类可读大小
  if [ "$size" -ge 1048576 ] 2>/dev/null; then
    human_size=$(awk "BEGIN{printf \"%.2f MB\", $size/1048576}")
  elif [ "$size" -ge 1024 ] 2>/dev/null; then
    human_size=$(awk "BEGIN{printf \"%.2f KB\", $size/1024}")
  else
    human_size="${size} B"
  fi

  echo "   IP:       $remote_ip"
  echo "   HTTP:     $http_code   |  大小: $human_size   |  重定向次数: $num_redir"
  echo "   ├─ DNS 解析        : ${ms_dns} ms"
  echo "   ├─ TCP 连接        : ${ms_conn} ms"
  echo "   ├─ TLS 握手        : ${ms_tls} ms"
  echo "   ├─ 请求发送准备    : ${ms_pretrans} ms"
  echo "   ├─ 重定向耗时      : ${ms_redir} ms"
  echo "   ├─ 等待首字节 TTFB : ${ms_ttfb} ms"
  echo "   ├─ 内容传输        : ${ms_body} ms"
  echo "   └─ 总耗时          : ${ms_total} ms"
  echo "   最终URL:  $final_url"

  echo "$raw|$domain|$http_code|$size|$ms_dns|$ms_conn|$ms_tls|$ms_pretrans|$ms_redir|$ms_ttfb|$ms_body|$ms_total|$num_redir|$remote_ip|$final_url" >> "$tmpfile"
  echo
done

echo "════════════════════════════════════════════════════════════════"
echo
echo "📊 速度排名（按总耗时从快到慢）："
echo
printf "%-4s %-24s %-8s %-8s %-8s %-8s %-8s %-8s %-8s\n" "#" "实际域名" "DNS" "TCP" "TLS" "TTFB" "传输" "总耗时" "大小"
echo "──────────────────────────────────────────────────────────────────────────────────────────────"

sort -t'|' -k12 -n "$tmpfile" | awk -F'|' '
{
  if ($3 == "失败") {
    printf "%-4d %-24s %s\n", NR, $2, "失败/超时"
  } else {
    if ($4 >= 1048576) {
      hs = sprintf("%.2f MB", $4/1048576)
    } else if ($4 >= 1024) {
      hs = sprintf("%.2f KB", $4/1024)
    } else {
      hs = $4 " B"
    }
    printf "%-4d %-24s %-8s %-8s %-8s %-8s %-8s %-8s %-8s\n", NR, $2, $5"ms", $6"ms", $7"ms", $10"ms", $11"ms", $12"ms", hs
  }
}'

echo
echo "🔀 重定向落地页："
echo
awk -F'|' '$15 != "" && $15 !~ /^https?:\/\/[^\/]+\/vod\/show\/id\/1$/ {
  printf "  %-26s -> %s\n", $2, $15
}' "$tmpfile"

rm -f "$tmpfile"