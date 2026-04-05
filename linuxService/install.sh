#!/bin/bash
# =============================================================
# Gold Sentinel — systemd 服务注册脚本
# 用法: sudo bash linuxService/install.sh
# 说明: 首次部署时执行，将服务注册到 systemd
#       执行前请先运行: bash linuxService/build.sh
# =============================================================
set -e

APP_DIR="/var/www/GoldMarketComprehensiveIntelligenceSystem"
SERVICE_DIR="/etc/systemd/system"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "======================================================"
echo "  Gold Sentinel — 服务注册"
echo "======================================================"

# 检查前端是否已构建
if [ ! -d "$APP_DIR/web/dist" ]; then
  echo ""
  echo "[错误] 未找到 web/dist/，请先执行构建："
  echo "       bash linuxService/build.sh"
  exit 1
fi

# 1. 部署 service 文件
echo ""
echo "[1/2] 部署 systemd service 文件..."
cp "$SCRIPT_DIR/goldmarket.service"     "$SERVICE_DIR/goldmarket.service"
cp "$SCRIPT_DIR/goldmarket-web.service" "$SERVICE_DIR/goldmarket-web.service"
echo "      ✓ 已复制到 $SERVICE_DIR"

# 2. 启用并启动服务
echo ""
echo "[2/2] 启用并启动服务..."
systemctl daemon-reload
systemctl enable goldmarket
systemctl enable goldmarket-web
systemctl start goldmarket
echo "      ✓ goldmarket (后端) 已启动，等待就绪..."
sleep 3
systemctl start goldmarket-web
echo "      ✓ goldmarket-web (前端) 已启动"

echo ""
echo "======================================================"
echo "  安装完成！"
echo ""
echo "  后端 API  : http://$(hostname -I | awk '{print $1}'):3001"
echo "  前端页面  : http://$(hostname -I | awk '{print $1}'):8081"
echo ""
echo "  常用命令："
echo "    sudo systemctl start   goldmarket"
echo "    sudo systemctl stop    goldmarket"
echo "    sudo systemctl restart goldmarket"
echo "    sudo systemctl status  goldmarket"
echo "    journalctl -u goldmarket -f        # 实时后端日志"
echo "    journalctl -u goldmarket-web -f    # 实时前端日志"
echo "======================================================"
