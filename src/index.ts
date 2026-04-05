import './config'; // dotenv 最先加载
import logger from './utils/logger';
import { getDB, closeDB } from './storage/database';
import { startAPIServer } from './api/server';
import { startAllSchedulers } from './scheduler/scheduler';

logger.info('🥇 Gold Sentinel v0.1.0 starting...');

async function main() {
  // 初始化数据库
  getDB();
  logger.info('[boot] database initialized');

  // 启动 REST API + WebSocket 服务
  startAPIServer();

  // 启动所有定时任务调度器
  startAllSchedulers();

  logger.info('🚀 Gold Sentinel is running. All systems nominal.');
}

// 优雅退出
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  closeDB();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  closeDB();
  process.exit(0);
});

main().catch(err => {
  logger.error('Fatal startup error', { err });
  process.exit(1);
});
