/**
 * 上海黄金交易所 (SGE) Au99.99 价格采集器
 * 来源: 新浪财经行情 API（免费，无需Key）
 * 频率: 5分钟
 */
import axios from 'axios';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IPriceData } from '../../types';

// 新浪财经 Au99.99 行情接口
const SINA_GOLD_URL = 'https://hq.sinajs.cn/list=Au9999';
// 东方财富备用
const EASTMONEY_URL = 'https://push2.eastmoney.com/api/qt/stock/get?ut=fa5fd1943c7b386f172d6893dbfba10b&fields=f43,f57,f58&secid=0.Au9999';

interface SGEPrice {
  price: number;  // CNY/g
  source: string;
}

async function fetchFromSina(): Promise<SGEPrice> {
  const res = await axios.get(SINA_GOLD_URL, {
    headers: {
      Referer: 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
    timeout: 10000,
    responseType: 'arraybuffer',
  });

  // 新浪返回 GBK 编码，先转 string
  const text = Buffer.from(res.data as ArrayBuffer).toString('latin1');
  // 格式: var hq_str_Au9999="Au9999,价格,涨跌,涨跌幅,昨收,今开,最高,最低,..."
  const match = text.match(/"([^"]+)"/);
  if (!match) throw new Error('SGE Sina: parse failed');

  const parts = match[1].split(',');
  const price = parseFloat(parts[1]);
  if (!price || isNaN(price)) throw new Error(`SGE Sina: invalid price "${parts[1]}"`);

  return { price, source: 'sina-sge' };
}

async function fetchFromEastmoney(): Promise<SGEPrice> {
  const res = await axios.get(EASTMONEY_URL, {
    headers: { Referer: 'https://www.eastmoney.com/' },
    timeout: 10000,
  });

  const data = res.data as { data?: { f43?: number } };
  const raw = data?.data?.f43;
  if (!raw) throw new Error('Eastmoney SGE: no data');

  const price = raw / 100; // 东方财富价格放大了100倍
  return { price, source: 'eastmoney-sge' };
}

export async function fetchSGEPrice(): Promise<IPriceData | null> {
  return withRetry(
    async () => {
      let result: SGEPrice;
      try {
        result = await fetchFromSina();
      } catch (err) {
        logger.warn('[sge] Sina failed, trying Eastmoney', { err });
        result = await fetchFromEastmoney();
      }

      logger.debug('[sge] Au99.99 price', result);
      return {
        source: result.source,
        timestamp: Date.now(),
        xauCny: result.price,  // CNY/g (Au99.99)
      } satisfies IPriceData;
    },
    'SGE-Price',
    { maxAttempts: 3, baseDelayMs: 2000 }
  );
}
