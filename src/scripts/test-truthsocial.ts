/**
 * Truth Social 采集测试脚本
 * 用法: npx tsx src/scripts/test-truthsocial.ts
 *
 * 功能：
 *   1. 从 Truth Social 抓取 Trump 最新帖子
 *   2. 写入本地数据库
 *   3. 发送钉钉测试通知
 */
import { getDB } from '../storage/database';
import { insertNews } from '../storage/dao';
import { fetchTruthSocialPosts } from '../collectors/news/truthsocial.collector';
import { sendDingTalkBrief } from '../push/dingtalk';
import dayjs from 'dayjs';

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Truth Social 采集测试');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. 初始化数据库
  console.log('\n[1/3] 初始化数据库...');
  getDB();
  console.log('  ✓ 数据库就绪');

  // 2. 抓取 Truth Social 帖子
  console.log('\n[2/3] 抓取 Trump Truth Social 帖子...');
  let posts;
  try {
    posts = await fetchTruthSocialPosts(20, false); // 取最新20条，不过滤
    console.log(`  ✓ 抓取成功，共 ${posts.length} 条帖子`);
  } catch (err) {
    console.error('  ✗ 抓取失败:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 3. 写入数据库，统计新增/已存在
  console.log('\n[3/3] 写入数据库...');
  let inserted = 0;
  let skipped  = 0;
  for (const post of posts) {
    try {
      const id = insertNews(post);
      if (id > 0) inserted++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
  console.log(`  ✓ 新增 ${inserted} 条，已存在跳过 ${skipped} 条`);

  // 4. 构建钉钉通知内容
  const goldRelated = posts.filter(p => (p.aiImpact ?? 0) >= 3);

  const postLines = posts.slice(0, 5).map((p, i) => {
    const time    = dayjs(p.timestamp).format('MM-DD HH:mm');
    const tag     = (p.aiImpact ?? 0) >= 3 ? '⭐ ' : '';
    const snippet = p.title.slice(0, 80).replace(/\n/g, ' ');
    return `${i + 1}. ${tag}[${time}] ${snippet}${p.title.length > 80 ? '…' : ''}`;
  });

  const ddContent = [
    `## 🦅 Truth Social 采集测试报告`,
    `**时间**: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`,
    '',
    `### 采集结果`,
    `- 抓取帖子: **${posts.length}** 条`,
    `- 新入库: **${inserted}** 条 · 已存在: ${skipped} 条`,
    `- 与黄金/宏观相关 ⭐: **${goldRelated.length}** 条`,
    '',
    `### 最新 ${Math.min(5, posts.length)} 条预览`,
    ...postLines,
    '',
    goldRelated.length > 0
      ? `### ⭐ 黄金相关帖子（共 ${goldRelated.length} 条）\n` +
        goldRelated.slice(0, 3).map(p =>
          `- [${dayjs(p.timestamp).format('HH:mm')}] ${p.title.slice(0, 100)}`
        ).join('\n')
      : '> 本批次无黄金/宏观相关帖子',
    '',
    `> Gold Sentinel · Truth Social 数据源测试 ✅`,
  ].join('\n');

  console.log('\n─── 钉钉通知内容预览 ───────────────────');
  console.log(ddContent);
  console.log('────────────────────────────────────────');

  // 5. 发送钉钉
  console.log('\n发送钉钉通知...');
  const ok = await sendDingTalkBrief('🦅 Truth Social 采集测试', ddContent);
  if (ok) {
    console.log('  ✓ 钉钉通知发送成功');
  } else {
    console.warn('  ! 钉钉通知发送失败（可能未配置 DINGTALK_WEBHOOK）');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  测试完成');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(err => {
  console.error('\n[fatal]', err);
  process.exit(1);
});
