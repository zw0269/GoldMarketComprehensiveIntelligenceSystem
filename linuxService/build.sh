#!/bin/bash
# =============================================================
# Gold Sentinel — 构建脚本（安装依赖 + 编译前端）
# 用法: bash linuxService/build.sh
# 说明: 首次部署或代码更新后执行，无需 sudo
# =============================================================
set -e

APP_DIR="/var/www/GoldMarketComprehensiveIntelligenceSystem"

echo "======================================================"
echo "  Gold Sentinel — 构建"
echo "======================================================"

# 检查 .env
if [ ! -f "$APP_DIR/.env" ]; then
  echo ""
  echo "[错误] 未找到 $APP_DIR/.env"
  echo "       请先执行: cp $APP_DIR/.env.example $APP_DIR/.env"
  echo "       然后填写 API Keys 后重新运行本脚本"
  exit 1
fi

# 1. 安装后端依赖
echo ""
echo "[1/2] 安装后端依赖..."
cd "$APP_DIR"
npm install
echo "      ✓ 后端依赖安装完成"

# 2. 安装前端依赖并构建静态文件
echo ""
echo "[2/2] 构建前端静态文件..."
cd "$APP_DIR/web"
npm install
npm run build
echo "      ✓ 前端构建完成 → web/dist/"

echo ""
echo "======================================================"
echo "  构建完成！"
echo ""
echo "  下一步：首次部署请执行"
echo "    sudo bash linuxService/install.sh"
echo ""
echo "  若已安装过服务，更新代码后只需重启："
echo "    sudo systemctl restart goldmarket"
echo "    sudo systemctl restart goldmarket-web"
echo "======================================================"
